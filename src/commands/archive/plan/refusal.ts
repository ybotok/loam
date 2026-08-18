/**
 * How `loam archive` refuses, and what a refusal prints.
 *
 * Every arm here keeps one property: a refusal means nothing was written. The
 * `--json` shapes carry the issues that caused it so an agent can act on the
 * list rather than on the sentence, and `ArchiveFailure` exists so a merge that
 * could not be computed reports as a merge failure rather than as `internal` —
 * a read-only directory or an unreadable pre-image is not a bug in loam, and
 * saying so sends the reader looking for one.
 */
import { existsSync } from "node:fs";
import { emitJsonError, repoPath, type ErrorCode } from "../../../core/envelope/json.js";
import { approveOverrides, gatesArchive, type Issue } from "../../../core/vocabulary/issue.js";
import { type CommitRecovery } from "../../../core/staging/interrupted.js";
import { type PlannedWrite } from "../../../core/staging/writes.js";
import { findingJson, type Finding } from "../../../core/vocabulary/report.js";

export interface ArchiveOptions {
  approve?: boolean;
  dryRun?: boolean;
  json?: boolean;
}


/**
 * A refusal or failure with its stable `--json` code attached. Thrown from the
 * plan phase (nothing written yet) and from the commit's rollback path (whose
 * message says whether the rollback held). Anything ELSE that escapes runArchive
 * is a bug, and the action handler reports it as `internal`.
 */
export class ArchiveFailure extends Error {
  constructor(
    readonly code: ErrorCode,
    msg: string,
  ) {
    super(msg);
  }
}

/**
 * An Issue as the `--json` envelope spells it — the Finding shape, minus details.
 * `gates` and `overridable` are always present and already resolved: a consumer
 * must not have to re-implement the severity default to know what blocks
 * archive, nor keep a code list to know what `--approve` can move.
 */
export function issueJson(i: Issue): Record<string, unknown> {
  return {
    severity: i.severity,
    code: i.code,
    gates: gatesArchive(i),
    overridable: approveOverrides(i),
    ...(i.subject === undefined ? {} : { subject: i.subject }),
    message: i.message,
  };
}

/** The failure envelope plus the issues that caused it, so a caller need not re-run validate. */
export function refuseJson(code: ErrorCode, msg: string, issues: Issue[]): void {
  emitJsonError(code, msg, { issues: issues.map(issueJson) });
}

/**
 * The same envelope for a refusal computed from `Finding`s rather than
 * `Issue`s — the plan-time checks whose codes are not coherence's (they belong
 * to the LIVING documents, not to the feature) and so are not `IssueCode`s.
 *
 * `gates: true` is asserted rather than derived: every finding listed in a
 * refusal is a reason archive stopped, which is what the field means. Nothing
 * advisory reaches here.
 */
export function refuseFindings(code: ErrorCode, msg: string, findings: Finding[]): void {
  emitJsonError(code, msg, { issues: findings.map((f) => ({ ...findingJson(f), gates: true })) });
}

/**
 * Take the docs repo's advisory lock for the WHOLE plan+commit window, then
 * archive.
 *
 * The window is the point. Two archives that overlap do not fight over a
 * rename: they each read the living landscape, each splice their additions into
 * the bytes they read, and the second write replaces the first — both exit 0,
 * and `validate` stays green over a landscape that is missing one feature's
 * architecture, because a document with fewer elements is not an invalid one.
 * That is the only silent-loss path in loam that a later command cannot even
 * detect, so it is closed at the coarsest possible granularity: one writer per
 * docs repo, refusing rather than queueing, because a CLI that blocks for an
 * unknown time is worse for an agent than one that says `docs-busy`.
 */

/**
 * What the recovery did, before this command's own output — a docs repo that
 * changed under the caller is the first thing they have to be told, not a
 * footnote. Shared by archive and unarchive through the same CommitRecovery.
 */
export function sayRecovery(r: CommitRecovery): void {
  const what = `an interrupted \`loam ${r.command} ${r.feature}\``;
  if (r.outcome === "completed") {
    console.log(`⚠ ${what} had in fact finished — cleared its commit record.\n`);
    return;
  }
  if (r.outcome === "consistent") {
    console.log(`⚠ ${what} was rolled back before it wrote anything — cleared its commit record.\n`);
    return;
  }
  // An interrupted archive is UNDONE and an interrupted unarchive is FINISHED —
  // the merged text a restore was replacing is written down nowhere, so there is
  // nothing to go back to. Say which happened; the paths are the same either way.
  const what_ = r.command === "archive" ? "put them back from" : "finished them from";
  console.log(`⚠ ${what} left ${r.repaired.length} file(s) half-written; ${what_} its snapshot:`);
  for (const p of r.repaired) console.log(`  ↩ ${p}`);
  console.log("");
}

/** The full plan, as files: what a dry run shows instead of doing. */
export function printPlan(docsDir: string, writes: PlannedWrite[], dirName: string): void {
  console.log(`\n  plan — ${writes.length} file(s):`);
  for (const w of writes) {
    const verb = existsSync(w.path) ? "update" : "create";
    console.log(`    ${verb}  ${repoPath(docsDir, w.path)}`);
  }
  console.log(`    move    features/${dirName} → features/archive/${dirName}`);
  console.log("\n  dry run — nothing was written.");
}
