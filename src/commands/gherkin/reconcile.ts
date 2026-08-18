/**
 * The plan against what is already on disk: which files are orphans, which are
 * written, replaced, kept, or owned by another feature.
 *
 * A module of its own because it is the only part of `loam gherkin` that
 * DELETES, and the reasoning that makes deletion safe is all here: a candidate
 * is an orphan only when its containing directory really resolves inside the
 * owned root, and a root that does not resolve proves nothing about what lives
 * beneath it, so nothing is collected. Leaving an orphan behind is
 * self-repairing — `loam validate` grades it and the next run removes it — and a
 * deletion taken on an unproven path is not.
 *
 * The in-flight exemption is here for the same reason: files are named by
 * requirement slug in both modes, so a MODIFIED requirement's living emission
 * always collides with the active feature's file, and replacing it reverted the
 * delta's wording mid-flight with its digest stamps destroyed.
 */
import { existsSync, realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { type PlannedFeature } from "../../core/gherkin/emit.js";
import { parseStampedFeature, type StampedFeature } from "../../core/gherkin/read.js";
import { featureFilesUnder } from "../../core/gherkin/stale.js";
import { isPathInside, resolveInside, UnsafePathError } from "../../core/kernel/path-safety.js";

/**
 * The run's scope as ONE value, not a mode with an id lying beside it that only
 * one of the modes ever fills in: the emission tag, the orphan filter, the
 * overwrite rule and the conflict refusal all want the feature id exactly when
 * the run is a feature run. A union states that; two variables could only be
 * asserted to agree.
 */
export type Scope = { mode: "living" } | { mode: "feature"; featureId: string };

export type Emission = PlannedFeature & { path: string };

/**
 * The row's shape follows its action instead of carrying every field any action
 * might want: only a kept or a conflicting row has read the file that is
 * already there, and only a conflicting one has owners. Held as one flat row
 * with optional fields, every reader had to assert what the writer three lines
 * up already knew.
 */
export type ActionRow =
  | (Emission & { action: "written" })
  // A replaced row carries the exact bytes it was graded against, so the
  // commit can prove the file did not move between the grading and the swap —
  // planning and committing must compare the same read, or a mismatch is
  // buried instead of refused.
  | (Emission & { action: "replaced"; raw: Buffer })
  | (Emission & { action: "kept"; kept: StampedFeature })
  | (Emission & { action: "conflict"; kept: StampedFeature; owners: string[] });

export type Action = ActionRow["action"];

/** Where the suite lives: the owned root, inside the service repository. */
export interface EmissionRoot {
  root: string;
  repoDir: string;
}

export interface Reconciliation {
  /** Each orphan with the bytes its grading read — the commit compares them before deleting. */
  orphans: { path: string; raw: Buffer }[];
  actions: ActionRow[];
  /** Non-empty only in feature mode; one entry refuses the whole emission. */
  conflicts: Extract<ActionRow, { action: "conflict" }>[];
}

export async function reconcile(
  plan: PlannedFeature[],
  where: EmissionRoot,
  scope: Scope,
  activeIds: ReadonlySet<string>,
): Promise<Reconciliation> {
  const { root, repoDir } = where;
  // Living mode owns the whole suite — any .feature not in the plan goes —
  // EXCEPT files tagged with a feature still in flight: those answer to
  // their feature's delta until it archives, and `loam gherkin <FEAT>` is
  // their regeneration.
  const planned = new Set(plan.map((f) => f.fileName));
  // "Inside loam/" has to hold after the links are resolved, not merely in
  // the spelling of the path. `featureFilesUnder` FOLLOWS symlinks and
  // recurses with the LINK's path, so a planted `<gherkinDir>/loam/sub ->
  // /outside` hands back candidates that read as ours while `unlink`
  // resolves them and destroys files that were never in this repo. Planned
  // names are flat, so nothing nested is ever spared by `planned.has(...)`,
  // and deletion is the one irreversible thing this command does: a
  // candidate is an orphan only when its CONTAINING directory really
  // resolves inside the owned root. The write path below refuses the same
  // attack for the same reason.
  //
  // The candidate FILE is deliberately NOT resolved. A symlinked .feature
  // sitting directly in loam/ is loam's to remove — unlinking it takes the
  // link and leaves its target alone — so only the directory chain has to
  // be ours.
  const realOrNull = (p: string): string | null => {
    try {
      return realpathSync(p);
    } catch {
      return null;
    }
  };
  // A root that does not resolve — absent, dangling, or vanished mid-run —
  // proves nothing about what lives beneath it, so nothing is collected.
  // Leaving an orphan behind is self-repairing (`loam validate` grades it
  // `gherkin.orphaned` and the next run removes it); a deletion taken on an
  // unproven path is not.
  const rootReal = realOrNull(root);
  const orphans: { path: string; raw: Buffer }[] = [];
  if (rootReal !== null) {
    for (const abs of await featureFilesUnder(root)) {
      if (planned.has(relative(root, abs).split(/[\\/]/).join("/"))) continue;
      const holder = realOrNull(dirname(abs));
      if (holder === null || !isPathInside(rootReal, holder)) continue;
      const raw = await readFile(abs);
      const stamped = parseStampedFeature(raw.toString("utf8"));
      if (scope.mode === "feature") {
        if (stamped !== null && stamped.tags.includes(scope.featureId)) orphans.push({ path: abs, raw });
      } else {
        if (stamped !== null && stamped.tags.some((t) => activeIds.has(t))) continue;
        orphans.push({ path: abs, raw });
      }
    }
  }

  // The in-flight exemption guards the OVERWRITE path too, not only the
  // orphan scan above: files are named by requirement slug in both modes,
  // so a MODIFIED requirement's living emission always collides with the
  // active feature's file — and replacing it reverted the delta's wording
  // mid-flight, feature tag and new digest stamps destroyed, invisibly
  // (the reverted file grades current against the living spec). A planned
  // path whose existing content is stamped and tagged with a feature still
  // in flight is KEPT and reported as such; it answers to its feature's
  // delta until the feature archives, and then living regeneration
  // replaces it normally.
  //
  // FEATURE mode has the same collision and cannot solve it by keeping:
  // two features in flight against one requirement slug want the same
  // file, and whichever runs second used to `replace` — silently reverting
  // the other feature's wording, feature tag and digest stamps, so its
  // `verify --results` could never confirm a scenario again. Nothing loam
  // can write is right here (the file holds ONE feature's delta), so the
  // run refuses and names the owner: the two features have to be sequenced,
  // or the requirement renamed.
  const actions: ActionRow[] = [];
  for (const f of plan) {
    let path: string;
    try {
      // Check the final file as well as the owned root: a pre-planted
      // `<slug>.feature` symlink must not turn writeFile into an overwrite
      // outside the repository.
      path = resolveInside(
        repoDir,
        relative(repoDir, join(root, f.fileName)),
        `gherkin file '${f.fileName}'`,
      );
    } catch (err) {
      if (!(err instanceof UnsafePathError)) throw err;
      throw err;
    }
    if (!existsSync(path)) {
      actions.push({ ...f, path, action: "written" });
      continue;
    }
    const raw = await readFile(path);
    const existing = parseStampedFeature(raw.toString("utf8"));
    if (scope.mode === "living") {
      if (existing !== null && existing.tags.some((t) => activeIds.has(t))) {
        actions.push({ ...f, path, action: "kept", kept: existing });
        continue;
      }
    } else if (existing !== null) {
      // An unstamped file is nobody's delta — it owns nothing, so it is
      // replaced like any other, which is what the empty owner list used
      // to say the long way round.
      const owners = existing.tags.filter((t) => t !== scope.featureId && activeIds.has(t));
      if (owners.length > 0) {
        actions.push({ ...f, path, action: "conflict", kept: existing, owners });
        continue;
      }
    }
    actions.push({ ...f, path, action: "replaced", raw });
  }

  // All or nothing: one conflicting file refuses the whole emission, so a
  // half-written suite can never be the state an agent has to reason about.
  // Only a feature run can conflict — living mode keeps the in-flight file
  // rather than refusing — and standing inside that scope is also how the
  // message names the feature without asserting there is one.
  const conflicts = scope.mode === "feature"
    ? actions.filter((a): a is Extract<ActionRow, { action: "conflict" }> => a.action === "conflict")
    : [];

  return { orphans, actions, conflicts };
}
