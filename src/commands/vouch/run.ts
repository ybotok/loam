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
import { message, rollbackStaged, stageWrites, swapStaged } from "../../core/staging/commit.js";
import { type PlannedWrite } from "../../core/staging/writes.js";
import { type StampedSpec, type VouchOutcome, type VouchRequest } from "./contract.js";
import { verifySpec, type VerifiedSpec } from "./verify.js";

export async function vouch(req: VouchRequest): Promise<VouchOutcome> {
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

  // Commit through archive's stage-and-swap machinery (core/staging.ts) rather
  // than a writeFile per file: every stamp is computed above in memory, so a
  // plain sequential write could only die BETWEEN the pair's writes — spec.md
  // verified, arch.spec.md still carrying the old stamp — the exact half-stamped
  // state the all-or-nothing verification exists to rule out, lost at the last
  // step to a full disk. Staging parks each file's new bytes beside it, swaps by
  // rename(2), and on failure restores what already swapped from its pre-image.
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

  try {
    await swapStaged(staged);
  } catch (err) {
    const failures = await rollbackStaged(staged);
    // Archive's two answers to "can I trust the repo?", reused rather than
    // minting vouch-only codes — a caller branches on the same fact either way:
    // rolled back → nothing changed, re-running can work; incomplete → the
    // files listed need a human. Only the prose is vouch's own.
    return failures.length > 0
      ? {
          ok: false,
          code: "rollback-incomplete",
          message: `${message(err)} — ROLLBACK INCOMPLETE, these files may be half-stamped and need checking by hand: ${failures.join(", ")}`,
        }
      : {
          ok: false,
          code: "merge-failed",
          message: `${message(err)} — the vouch was rolled back, no spec was stamped`,
        };
  }
  return {
    ok: true,
    status: "verified",
    lastVerified: req.today,
    vouchedBy: req.vouchedBy,
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
