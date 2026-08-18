/**
 * The stamp itself: verify every spec, then write them all or none.
 *
 * Separate from the command because this half has nothing to say to a terminal.
 * It refuses on any spec it cannot verify and stamps none of them — a vouch is
 * a person's claim that the documents match the code, and a partial one would
 * put that claim on files nobody checked.
 */
import { existsSync } from "node:fs";
import { withFrontmatterFields } from "../../core/document/frontmatter.js";
import { contentDigest, encodeSourceIndex } from "../../core/provenance/stamp.js";
import { SPEC_AXES, servicePaths } from "../../core/repo/paths.js";
import { rollbackStaged, stageWrites } from "../../core/staging/commit.js";
import { join } from "node:path";
import { COMMIT_INTENT, type CommitRecovery, InterruptedCommitError } from "../../core/staging/interrupted.js";
import { acquireDocsLockWaiting, DocsBusyError, LOCK_WAIT_MS } from "../../core/staging/lock.js";
import { recoverInterruptedCommit } from "../../core/staging/recovery/recover.js";
import { commitStaged } from "../../core/staging/txn/transaction.js";
import { type PlannedWrite } from "../../core/staging/writes.js";
import { type StampedSpec, type VouchOutcome, type VouchRequest } from "./contract.js";
import { verifySpec, type VerifiedSpec } from "./verify.js";

export async function vouch(req: VouchRequest): Promise<VouchOutcome> {
  // A predecessor's journal is rolled forward BEFORE verification reads a
  // byte. Recovery under the commit lock alone was tried first and kept as
  // the backstop, but it changes files verification has already read, so the
  // run's own raced check then refused a sound stamp and the fix doctor
  // prints took two runs instead of one. Cheap when there is nothing to do:
  // one existsSync.
  let recoveredEarly: CommitRecovery | null = null;
  if (existsSync(join(req.docsDir, COMMIT_INTENT))) {
    let release: () => Promise<void>;
    try {
      release = await acquireDocsLockWaiting(req.docsDir, LOCK_WAIT_MS);
    } catch (err) {
      if (err instanceof DocsBusyError) return { ok: false, code: "docs-busy", message: err.message };
      throw err;
    }
    try {
      recoveredEarly = await recoverInterruptedCommit(req.docsDir);
    } catch (err) {
      if (err instanceof InterruptedCommitError) return { ok: false, code: "commit-interrupted", message: err.message };
      throw err;
    } finally {
      await release();
    }
  }
  const paths = servicePaths(req.docsDir, req.service);
  if (!existsSync(paths.spec)) {
    return {
      ok: false,
      code: "unknown-target",
      message: `No living spec at ${paths.spec}. Run \`loam adopt\` for '${req.service}' first.`,
    };
  }

  // Verify first, stamp after: spec.md is required (checked above), arch.spec.md
  // rides when it exists, and one file that cannot be verified refuses the run
  // before anything is written. The two axes are walked by name rather than
  // accumulated in a loop, because everything downstream needs to know WHICH
  // file it is holding — the required one or the optional one — and a loop can
  // only say that positionally.
  const [specAxis, archAxis] = SPEC_AXES;
  const specVerified = await verifySpec(req, paths[specAxis.key], specAxis.file);
  if (!specVerified.ok) return specVerified;
  let archVerified: VerifiedSpec | null = null;
  if (existsSync(paths[archAxis.key])) {
    const outcome = await verifySpec(req, paths[archAxis.key], archAxis.file);
    if (!outcome.ok) return outcome;
    archVerified = outcome;
  }
  const verified: VerifiedSpec[] = [specVerified, ...(archVerified === null ? [] : [archVerified])];

  const specPlan = planStamp(specVerified, req);
  const archPlan = archVerified === null ? null : planStamp(archVerified, req);
  const writes: PlannedWrite[] = [specPlan.write, ...(archPlan === null ? [] : [archPlan.write])];

  // The slow half — reading specs, hashing sources, composing stamps — ran
  // UNLOCKED above, so vouches for independent services do not serialise
  // behind one repo-wide mutex. Only the commit window takes the docs lock:
  // the same one archive, rebase and verify --record hold, in the waiting
  // form, because two vouches for different services are both supposed to
  // land. This is the lock the roadmap called missing: without it a vouch
  // could stage against bytes an archive was mid-swap over, and the byte
  // compare below would refuse a perfectly sound stamp — or worse, an
  // interrupted commit's journal would be silently written over.
  let releaseLock: () => Promise<void>;
  try {
    releaseLock = await acquireDocsLockWaiting(req.docsDir, LOCK_WAIT_MS);
  } catch (err) {
    if (err instanceof DocsBusyError) return { ok: false, code: "docs-busy", message: err.message };
    throw err;
  }
  try {
    // A journal under the lock means the last writer never finished; recover
    // or refuse before reading the pre-images this commit will compare.
    let recovered: CommitRecovery | null;
    try {
      recovered = await recoverInterruptedCommit(req.docsDir);
    } catch (err) {
      if (err instanceof InterruptedCommitError) return { ok: false, code: "commit-interrupted", message: err.message };
      throw err;
    }
    return await commitStamp(req, { writes, specPlan, archPlan, verified }, recovered ?? recoveredEarly);
  } finally {
    await releaseLock();
  }
}

/**
 * The commit window: stage, compare against what verification read, journal,
 * swap. Split from `vouch` so the lock's extent is visible in the code shape —
 * everything in here holds it, nothing above does.
 */
async function commitStamp(
  req: VouchRequest,
  plan: {
    writes: PlannedWrite[];
    specPlan: { write: PlannedWrite; stamped: StampedSpec };
    archPlan: { write: PlannedWrite; stamped: StampedSpec } | null;
    verified: VerifiedSpec[];
  },
  recovered: CommitRecovery | null,
): Promise<VouchOutcome> {
  const { writes, specPlan, archPlan, verified } = plan;
  const staged = await stageWrites(writes);

  // One shared docs repo, ten service repos, and nothing stopping two of them
  // from vouching at once. Between reading a spec and swapping the stamp in
  // there is a window in which somebody else's vouch (or an editor, or a merge)
  // can land in the same file — and because the new bytes were computed from
  // the OLD ones, swapping them in would take that stamp back out without a
  // word. `stageWrites` has already read what is on disk right now, so the
  // check is a comparison, not another read: if the file is not what was
  // verified, this run is describing a document that no longer exists.
  // Bytes, not text: `stageWrites` reads the file as a Buffer (a string
  // comparison against it is never equal, which made every vouch report
  // `vouch-raced` and stamp nothing). A file that is GONE is still a race —
  // `null` is not "empty", it is "the document this run described is not
  // there any more".
  // Joined by path, not by index: pairing the two lists positionally assumed
  // `stageWrites` returns one entry per planned write in order — true today,
  // promised nowhere, and a compare-and-set that silently compares the wrong
  // pair would stamp over somebody else's vouch. A staged write no verified
  // file claims has nothing to be compared against, so it counts as raced;
  // fail-closed is the only safe direction here.
  const verifiedByPath = new Map(verified.map((v) => [v.path, v] as const));
  const raced = staged.filter((s) => {
    const v = verifiedByPath.get(s.write.path);
    return v === undefined || s.before === null || !s.before.equals(Buffer.from(v.raw, "utf8"));
  });
  if (raced.length > 0) {
    // Nothing has swapped yet, so the rollback is only the temp files going
    // away — the other writer's stamp is left exactly as it landed.
    await rollbackStaged(staged);
    return {
      ok: false,
      code: "vouch-raced",
      message:
        `${req.service}: ${raced.map((s) => s.write.path).join(", ")} changed while this vouch was running — ` +
        `another vouch or an edit landed first. Nothing was stamped: re-read the document and re-run.`,
    };
  }

  // The journaled commit: intent fsynced before the first rename, so a kill
  // between the pair's two swaps is recoverable instead of invisible — the
  // exact half-stamped state the all-or-nothing verification exists to rule
  // out used to be reachable through that one window. The codes are archive's,
  // reused rather than minted: rolled back → nothing changed, re-running can
  // work; incomplete → the files listed need a human.
  const committed = await commitStaged(
    {
      root: req.docsDir,
      command: "vouch",
      // Runnable where vouch runs — the SERVICE repo, with --yes because the
      // journal's reader may be unattended. Any other journaled docs-repo
      // writer recovers this journal on its next run too.
      rerun: `loam vouch --service ${req.service} --yes`,
      target: req.service,
    },
    staged,
    "stamped",
  );
  if (!committed.ok) {
    return committed.raced
      ? {
          ok: false,
          code: "vouch-raced",
          message:
            `${req.service}: a document changed while this vouch was committing — ` +
            `another writer landed first. Nothing was stamped: re-read and re-run.`,
        }
      : { ok: false, code: committed.code, message: committed.message };
  }
  return {
    ok: true,
    status: "verified",
    lastVerified: req.today,
    vouchedBy: req.vouchedBy,
    recovered,
    stamped: { spec: specPlan.stamped, archSpec: archPlan === null ? null : archPlan.stamped },
  };
}

/**
 * One verified file's share of the commit: the bytes to write, and the record
 * of what was stamped into them. Kept beside each other because they are the
 * same computation — the report must describe the file that was actually
 * written, not a second guess at it.
 */
export function planStamp(v: VerifiedSpec, req: VouchRequest): { write: PlannedWrite; stamped: StampedSpec } {
  // Two passes on purpose: `content_digest` hashes the body BELOW the
  // frontmatter, and withFrontmatterFields promises that body byte-identical —
  // so hashing after the first stamp and writing the hash in a second one
  // yields a digest that is true of the file exactly as written. A re-vouch
  // takes the same road and refreshes every field, this one included.
  const restamped = withFrontmatterFields(v.raw, {
    status: "verified",
    last_verified: req.today,
    // WHO, beside when. Without it `status: verified` recorded that the word
    // had been written and nothing about who wrote it, so a vouch and an
    // agent's own draft left the same trace in the document — the one
    // distinction this command exists to make.
    vouched_by: req.vouchedBy,
    sources_digest: v.digest,
    // Beside the digest, what it was taken over. `sources_digest` alone can
    // only ever say THAT the code moved; the next `loam validate` reads this
    // back to say which files did.
    sources_files: encodeSourceIndex(v.index),
  });
  const bodyDigest = contentDigest(restamped);
  return {
    write: { path: v.path, content: withFrontmatterFields(restamped, { content_digest: bodyDigest }) },
    stamped: {
      path: v.path,
      file: v.file,
      digest: v.digest,
      contentDigest: bodyDigest,
      sources: v.sources,
      files: v.index.length,
      skipped: v.skipped,
    },
  };
}

/** A spec-axis file whose sources all check out, carrying what the stamp needs. */
