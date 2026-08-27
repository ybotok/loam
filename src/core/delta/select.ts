/**
 * What each delta requirement SELECTS in the living document, and whether the
 * merge would do what its author meant.
 *
 * This is the half that needs both documents at once, which is why it is not in
 * `./document.ts`. Every refusal here is a shape the merge would apply cleanly
 * and silently: MODIFIED of a requirement that does not exist is merged as a
 * creation, ADDED of one that does exist REPLACES it scenarios and all, and a
 * stale `Based-On:` means someone landed a change in between that this delta
 * would overwrite with text written against a document that no longer exists.
 */
import { type Issue } from "../vocabulary/issue.js";
import { isRequirementsHeading } from "../document/parse.js";
import {
  basedOnDeclarations,
  REQUIREMENT_DIGEST_RE,
  requirementDigest,
  type Requirement,
} from "../document/spec.js";
import { type ClaimLookup } from "./claims.js";
import { type DeltaScope, type LivingIndex } from "./scope.js";

export async function selectionIssues(
  scope: DeltaScope,
  reqs: Requirement[],
  living: LivingIndex,
  claims: ClaimLookup,
): Promise<Issue[]> {
  const { featureId, subject, where, livingDoc } = scope;
  const issues: Issue[] = [];
  /**
   * The pin, against the living requirement this delta actually selects.
   *
   * This is the check `delta.modified-conflict` cannot be: that one names
   * the other feature while BOTH are in flight, and the collision that
   * happens on a fleet outlives the window. A archives, leaves `features/`,
   * and stops being an active claim; B revalidates GREEN, and its MODIFIED —
   * carrying the full text it wrote against the pre-A document — replaces
   * A's requirement wholesale, scenarios and all, with `+0 ~1 -0` and exit
   * 0. Nothing downstream can even detect it afterwards: `unarchive A`
   * refuses `snapshot-stale`, and `--force` takes B out with it.
   *
   * A digest of what the author read closes that by not depending on
   * timing at all. Stale is an ERROR and gates, because there is no reading
   * of a stale delta under which the merge is what its author meant.
   * Missing is a warning that GATES: the document is legal — a delta
   * adopted from OpenSpec never had the line — but an unpinned MODIFIED or
   * REMOVED is exactly the timing hole the pin exists to close, and letting
   * it through archived the silent rollback at exit 0. The migrated corpus
   * is why this stays a warning rather than an error, and why the refusal
   * is not an outage: `loam rebase <feat>` pins every delta in one command,
   * and `--approve` remains the way to say the unpinned merge is meant.
   */
  const checkBaseline = (r: Requirement, selected: Requirement): void => {
    // A pin the document pass already refused is not also stale: that would
    // send its author to `loam rebase` for a problem rebase does not fix.
    const declared = basedOnDeclarations(r);
    if (declared.length > 1) return;
    if (r.basedOn !== undefined && !REQUIREMENT_DIGEST_RE.test(r.basedOn)) return;
    const current = requirementDigest(selected);
    if (r.basedOn === undefined) {
      issues.push({
        severity: "warn",
        gates: true,
        code: "delta.baseline-missing",
        subject,
        message: `${where}: ${r.kind} requirement '${r.name}' carries no Based-On, so nothing can say whether the living text moved since this delta was written — merging it would replace whatever landed in between. Run \`loam rebase ${featureId}\` to pin it (Based-On: ${current}), or archive with --approve to merge unpinned deliberately.`,
      });
      return;
    }
    if (r.basedOn === current) return;
    issues.push({
      severity: "error",
      code: "delta.baseline-stale",
      subject,
      message:
        `${where}: ${r.kind} requirement '${r.name}' was written against living version ${r.basedOn}, but the ${livingDoc} now holds ${current} — someone landed a change to it in between. ` +
        (r.kind === "MODIFIED"
          ? `This MODIFIED carries its FULL new text, so merging it would replace theirs outright.`
          : `Merging this REMOVED would delete what they landed.`) +
        ` Re-read the living requirement, fold in what you still mean, then run \`loam rebase ${featureId}\`.`,
    });
  };

  for (const r of reqs) {
    // BASE in a delta file means the requirement is under no delta section, so
    // the merge skips it. Reported rather than merged: deciding that `## Behavior`
    // means ADDED would be archive guessing at intent, and it would guess wrong
    // for every prose section that quotes a requirement as documentation. A
    // requirement above every heading has no heading to name, and no claim to be
    // written in the delta grammar at all — same judgement as `## Requirements`.
    //
    // A warning that GATES archive — the one check where the two axes
    // diverge. Severity says whether the document is valid: this shape is
    // legal OpenSpec, so an error would fail `loam validate` on every
    // adopted repo whose active deltas still use it. Gating says whether
    // the merge is safe: it is not — the merge would silently drop authored
    // content, the exact loss this module exists to prevent — so archive
    // refuses, and `--approve` remains the way to say the loss is meant.
    if (r.kind === "BASE") {
      if (r.section !== undefined && !isRequirementsHeading(r.section)) {
        issues.push({
          severity: "warn",
          gates: true,
          code: "delta.requirement-not-merged",
          subject,
          message: `${where}: requirement '${r.name}' sits under '${r.section}', which is not a delta section — archive will NOT merge it. Move it under '## ADDED Requirements' (or MODIFIED/REMOVED), or drop it if it is documentation.`,
        });
      }
      continue;
    }

    if (r.kind === "ADDED") {
      const idMatches = r.id === undefined ? [] : (living.byId.get(r.id) ?? []);
      const nameMatches = living.byName.get(r.name) ?? [];
      const nameSelectsOther = r.id !== undefined && nameMatches.some((candidate) => candidate.id !== r.id);
      if (nameSelectsOther) {
        issues.push({
          severity: "error",
          code: "delta.requirement-identity-collision",
          subject,
          message: `${where}: ADDED requirement '${r.name}' carries Requirement-ID '${r.id}', but that heading already identifies a different living requirement — ID and name cannot select different identities`,
        });
        continue;
      }
      if ((r.id === undefined && living.names.has(r.name)) || idMatches.length > 0) {
        issues.push({
          severity: "error",
          code: "delta.added-duplicate",
          subject,
          message: r.id === undefined
            ? `${where}: ADDED requirement '${r.name}' already exists in the ${livingDoc} — the merge would REPLACE it, scenarios and all. Use MODIFIED, or rename.`
            : `${where}: ADDED requirement '${r.name}' uses Requirement-ID '${r.id}', which already exists in the ${livingDoc} — use MODIFIED to change that identity`,
        });
        continue;
      }
      // Merge identity is exact string equality (applyRequirementDelta), so a
      // name that differs only in case slips past the duplicate check above and
      // lands as a SECOND requirement next to the living one. A warning, not an
      // error: the author may genuinely mean a distinct requirement, but with
      // LLM authors the case drift is the likely story. Never fires together
      // with added-duplicate — an exact match continues before this runs.
      const near = living.folded.get(r.name.toLowerCase());
      if (near !== undefined) {
        issues.push({
          severity: "warn",
          code: "delta.added-near-duplicate",
          subject,
          message: `${where}: ADDED requirement '${r.name}' differs only in case from living requirement '${near}' — the merge matches names exactly, so both would coexist. Match the living spelling and use MODIFIED, or pick a distinct name.`,
        });
      }
      const other = await claims.added(scope, r);
      if (other !== undefined) {
        issues.push({
          severity: "warn",
          code: "delta.added-conflict",
          subject,
          message: `${where}: requirement '${r.name}' is also added by ${other} — whichever archives first lands it, and the second archive is refused (delta.added-duplicate) unless --approve`,
        });
      }
      continue;
    }

    // MODIFIED vs MODIFIED on ONE living requirement. The ADDED case has
    // been caught since delta.added-conflict: two features adding the same
    // name collide loudly, because the second archive is refused. Two
    // features CHANGING the same requirement collide in total silence —
    // both deltas apply cleanly, and whichever archives second replaces
    // the first's text, scenarios and all, with a version written against
    // a document that no longer exists. A warning, not a gate: the second
    // author may well be rewriting on purpose, and only they can say.
    const alsoChanged = await claims.changed(scope, r);
    if (alsoChanged !== undefined) {
      issues.push({
        severity: "warn",
        code: "delta.modified-conflict",
        subject,
        message: `${where}: ${r.kind} requirement '${r.name}' is also changed by ${alsoChanged} — both deltas apply cleanly, so whichever archives second REPLACES the other's text wholesale. Agree on one owner, or fold the two changes together.`,
      });
    }

    if (r.id !== undefined) {
      const idMatches = living.byId.get(r.id) ?? [];
      const nameMatches = living.byName.get(r.name) ?? [];
      const nameSelectsOther = nameMatches.some((candidate) => candidate.id !== r.id);
      // The second disjunct is defensive rather than reachable: a living
      // requirement under this heading that the ID did NOT select must carry
      // some other ID, which is what `nameSelectsOther` already says. It is
      // kept because it states the rule the reader is being told — ID and
      // heading must select the same identity — without depending on that
      // derivation holding after the next edit.
      if (nameSelectsOther || (idMatches.length === 0 && nameMatches.length > 0)) {
        issues.push({
          severity: "error",
          code: "delta.requirement-identity-collision",
          subject,
          message: `${where}: ${r.kind} requirement '${r.name}' carries Requirement-ID '${r.id}', but its ID and heading select different living requirements — fix the ID or heading; archive will not guess`,
        });
        continue;
      }
      // A differing heading is the explicit loam rename mechanism: the
      // stable ID selects the old requirement, MODIFIED supplies its new name.
      //
      // Total in the ID, deliberately: an ID that matches SEVERAL living
      // requirements has already been refused as
      // `delta.living-requirement-id-invalid` (severity error, so archive is
      // gated either way), and the living document is where it gets fixed.
      // Falling through instead added `delta.modified-unknown` — "does not
      // exist … Did you mean ADDED?" — beside it, which is both false and
      // the more actionable-sounding of the two, and it sends the author to
      // edit the delta over a problem that is not in the delta. There is no
      // baseline to check against an ambiguous selection, so the pin is
      // simply not graded until the ambiguity is gone.
      if (idMatches.length > 0) {
        const selected = idMatches.length === 1 ? idMatches[0] : undefined;
        if (selected !== undefined) checkBaseline(r, selected);
        continue;
      }
    } else if (living.names.has(r.name)) {
      // Twins under one heading are already refused
      // (`delta.living-duplicate-requirement`), and applyRequirementDelta
      // takes the first either way — so the pin is compared against the
      // same requirement the merge would rewrite.
      checkBaseline(r, living.byName.get(r.name)![0]!);
      continue;
    }

    const other = await claims.added(scope, r);
    if (other !== undefined) {
      issues.push({
        severity: "warn",
        code: r.kind === "MODIFIED" ? "delta.modified-pending" : "delta.removed-pending",
        subject,
        message: `${where}: ${r.kind} requirement '${r.name}' is not in the ${livingDoc} yet — ${other} introduces it. Archive ${other} first.`,
      });
      continue;
    }
    issues.push({
      severity: "error",
      code: r.kind === "MODIFIED" ? "delta.modified-unknown" : "delta.removed-unknown",
      subject,
      message:
        r.kind === "MODIFIED"
          ? `${where}: MODIFIED requirement '${r.name}' does not exist in the ${livingDoc} — the merge would create it. Did you mean ADDED?`
          : `${where}: REMOVED requirement '${r.name}' does not exist in the ${livingDoc} — there is nothing to remove`,
    });
  }
  return issues;
}
