/**
 * What the archive still owes the fleet after its merge — the lines that stand
 * in for "living spec + landscape are now complete + current.".
 *
 * That closing line is a claim about the whole docs repo, and it is the line a
 * reader stops at. It may be printed only when this archive leaves nothing the
 * next `validate --all` will fail on, so every reason it cannot be is listed
 * here, once, for the real run and the dry run alike. The dry run used to print
 * none of them: `--json` carried `service.no-model` in `warnings`, the real run
 * printed it after the commit, and the text dry run — the one a person reads
 * before deciding — said nothing (the real-fleet review, 2026-10-21).
 *
 * FOUR REASONS, each a breach the next `validate --all` reports:
 *
 *  - a plan finding of ERROR severity that does not gate — `service.no-model`,
 *    a service this archive brings in without writing its model (a binding the
 *    map gains with no directory; one whose directory the archive creates and
 *    the merged map draws gets an empty model, `plan/landscape.ts`). Read off the
 *    severity, not a code list: the plan files an error exactly when it knows
 *    validate will, and a second list here is the copy that drifts;
 *  - an advisory that orders this feature behind another one still in flight
 *    and softens a fleet-gate error (four of the `*-pending` family): archived
 *    first, the merge lands a reference the other feature's merge has not made
 *    true yet;
 *  - gating issues the caller merged past with `--approve`;
 *  - a generated views file the new map no longer matches — read off the tree
 *    after the commit, and predicted for the dry run from the map the merge
 *    preview stages (`core/c4/project/staged.ts`, `staleViewsAfterMerge`). The
 *    dry run used to say it could not know. The archive regenerates both files
 *    in its own commit now (`./views.ts`), so what reaches this line is a file
 *    it could not write: one loam did not author, named with the refusal every
 *    writer of the path prints, or one whose merged map would not parse.
 */
import type { Issue, IssueCode } from "../../core/vocabulary/issue.js";
import { authoredRefusal } from "../../core/repo/tree/render/service/header.js";

/**
 * The advisories that mean "archive the other feature first" AND name an error
 * the fleet gate reports once this one lands alone — `spec-api.op-undefined`,
 * `spine.op-undefined`, `spec-event.message-undefined`,
 * `spine.message-unproduced`. The delta pair (`delta.modified-pending`,
 * `delta.removed-pending`) is NOT here, because the line below would be false
 * for it: the merge appends a MODIFIED it cannot find and drops a REMOVED one,
 * so `validate --all` reports nothing — the cost lands on the OTHER feature's
 * archive (`delta.added-duplicate`) or nowhere, which is that warning's own
 * sentence to say.
 */
const ORDERING: ReadonlySet<IssueCode> = new Set<IssueCode>([
  "spec-api.op-pending",
  "c4-api.op-pending",
  "spec-event.message-pending",
  "c4-event.message-pending",
]);

/** Everything the archive knows about what it leaves behind. */
export interface Outstanding {
  /** The coherence gate's advisory warnings. */
  advisory: readonly Issue[];
  /** The plan's own findings — overwrites, and the services it creates with no model. */
  planWarns: readonly Issue[];
  /** Gating issues `--approve` walked past. */
  overridden: readonly Issue[];
  /** Generated views the committed map no longer matches — or, for a dry run, would not. */
  staleViews: readonly string[];
  /**
   * Of those, the ones holding a file loam did not write, which the archive
   * left alone (`./views.ts`). `loam subsystem sync` refuses them too, so the
   * line names the refusal rather than sending the reader to it.
   */
  authored: readonly string[];
  /** Phrase it as what WOULD remain — the dry run's tense. */
  dryRun: boolean;
}

/** The `⚠` lines owed in place of the closing claim — empty when the claim is true. */
export function outstandingLines(state: Outstanding): string[] {
  const lines: string[] = [];
  // One line per stale file rather than one line listing them: each names a file
  // a reader opens, and a comma-joined series would have to choose a verb that
  // reads wrong for one of the two counts.
  for (const path of state.staleViews) {
    if (state.authored.includes(path)) {
      lines.push(`  ⚠ ${authoredRefusal(path)}`);
      continue;
    }
    lines.push(
      state.dryRun
        ? `  ⚠ ${path} would no longer match the tree and this map — run \`loam subsystem sync\` after the archive.`
        : `  ⚠ ${path} no longer matches the tree and this map — run \`loam subsystem sync\`.`,
    );
  }
  for (const w of state.planWarns) if (w.severity === "error") lines.push(`  ⚠ ${w.message}`);
  const ordering = state.advisory.filter((i) => ORDERING.has(i.code));
  if (ordering.length > 0) {
    lines.push(
      `  ⚠ ${state.dryRun ? "archiving this now lands" : "this archive landed"} ahead of ${ordering.length} change(s) still in flight ` +
        "that it waits on (the pending warnings above) — `loam validate --all` reports each as an error until that feature archives too.",
    );
  }
  if (state.overridden.length > 0) {
    lines.push(
      state.dryRun
        ? `  ⚠ --approve would merge past ${state.overridden.length} gating issue(s) — the living docs would carry them; \`loam validate --all\` says what they cost.`
        : `  ⚠ merged past ${state.overridden.length} gating issue(s) with --approve — the living docs carry them now; \`loam validate --all\` says what they cost.`,
    );
  }
  return lines;
}
