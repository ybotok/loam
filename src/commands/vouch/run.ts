/**
 * The stamp itself: verify every spec, then write them all or none.
 *
 * Separate from the command because this half has nothing to say to a terminal.
 * It refuses on any spec it cannot verify and stamps none of them — a vouch is
 * a person's claim that the documents match the code, and a partial one would
 * put that claim on files nobody checked.
 *
 * What lands in each file: `status`, `last_verified`, `vouched_by`,
 * `sources_digest`, the `sources_files` index, `content_digest` — and
 * `vouch_scope` when the person read a sample rather than the document — with
 * every byte below the frontmatter left identical. Nothing is written unless
 * all of it can be stamped truthfully for EVERY file: a half-stamp (verified
 * with no digest behind it, or one file stamped and its sibling not) is
 * exactly the claim this command exists to stop being possible, so every
 * present file is verified before any is written, and the writing itself is
 * staged and swapped in like archive's merge, so a failure between the pair's
 * two writes rolls the first back instead of leaving it. The two digests are
 * the two halves of one promise — `sources_digest` pins the code that was
 * read, `content_digest` pins the words it was read against — so
 * `loam validate` can see either side move. (This paragraph came from a
 * docblock stranded at the foot of `vouch.ts` when the stamp moved down here.)
 */
import { existsSync } from "node:fs";
import { withFrontmatterFields } from "../../core/document/frontmatter.js";
import { encodeVouchScope } from "../../core/provenance/sample/scope.js";
import { contentDigest, encodeSourceIndex } from "../../core/provenance/stamp.js";
import { SPEC_AXES } from "../../core/repo/paths.js";
import { locateServicePaths } from "../../core/repo/service-target.js";
import { rollbackStaged, stageWrites } from "../../core/staging/commit.js";
import { join } from "node:path";
import { COMMIT_INTENT, type CommitRecovery, InterruptedCommitError } from "../../core/staging/interrupted.js";
import { acquireDocsLockWaiting, DocsBusyError, LOCK_WAIT_MS } from "../../core/staging/lock.js";
import { recoverInterruptedCommit } from "../../core/staging/recovery/recover.js";
import { commitStaged } from "../../core/staging/txn/transaction.js";
import { type PlannedWrite } from "../../core/staging/writes.js";
import { type StampedSpec, type VouchOutcome, type VouchRequest } from "./contract.js";
import { axisScope, sampleDrift } from "./sample/plan.js";
import { noLivingSpecMessage, verifySpec, type VerifiedSpec } from "./vet/verify.js";

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
  const paths = await locateServicePaths(req.docsDir, req.service);
  if (!existsSync(paths.spec)) {
    return {
      ok: false,
      code: "unknown-target",
      message: noLivingSpecMessage(paths.spec, req.service),
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

  // The READING window's race, which the commit window's byte compare cannot
  // see. Under `--sample` a person spends minutes on the list before they
  // answer, and the sample they were shown was chosen from digests taken
  // before that. If either digest moved — or a second axis file appeared —
  // the sections they read are not the sections this stamp would claim, and
  // `vouch_scope` would record a read that did not happen. Nothing is written.
  const raced = req.sample === undefined ? null : sampleDrift(req.sample, verified, req.service);
  if (raced !== null) return { ok: false, code: "vouch-raced", message: raced };

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
  //
  // The scope this file's stamp will carry — null both when the run is an
  // ordinary vouch and when a sampled run's `--sample <n>` covered the whole
  // file. Joined to the plan by FILENAME rather than taken positionally: the
  // two axes are stamped by two separate calls, and a scope written onto the
  // wrong file would claim a person read four sections of a document they
  // never opened.
  const planned = req.sample?.axes.find((axis) => axis.file === v.file);
  // A verified file with no planned axis is unreachable — `sampleDrift`
  // refuses that run before this line — and null is the safe direction if it
  // ever were: a full stamp that CLEARS any prior scope, never one claiming a
  // sample nobody was shown.
  const scope = planned === undefined ? null : axisScope(planned);
  const restamped = withFrontmatterFields(
    v.raw,
    {
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
      // Beside `vouched_by`, never inside `status`: the rung string `vouched`
      // and the status `verified` are a published contract, and a sampled read
      // is not a fourth status — it is a qualification of this one.
      ...(scope === null ? {} : { vouch_scope: encodeVouchScope(scope) }),
    },
    // A full vouch CLEARS any scope a previous sampled one left, rather than
    // stranding a claim that would keep a fully-read document reading as
    // partial forever. Removing a key that was never there is a no-op, so
    // this rides on every run that is not itself sampling.
    scope === null ? ["vouch_scope"] : [],
  );
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
      vouchScope: scope,
    },
  };
}

/** A spec-axis file whose sources all check out, carrying what the stamp needs. */
