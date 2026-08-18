/**
 * What an unfinished write means for `loam validate`.
 *
 * `core/doctor/residue.ts` grades the same fact for `doctor`; this module
 * answers for the OTHER command that certifies the docs — the fleet gate. A
 * `.loam-commit` in the repo means the last writer's commit never finished:
 * some files hold the new bytes, some the old, and a validate that grades
 * that tree green is certifying a state no run ever produced. In CI that
 * green MERGES, which is why this is an error finding and not a warning.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { COMMIT_INTENT } from "../interrupted.js";
import { type Finding } from "../../vocabulary/report.js";
import { readTxnIntent } from "../txn/journal.js";
import { readCommitIntent } from "./intent.js";

/** The error every validate mode leads with while a journal sits in the repo, or null. */
export async function interruptedCommitFinding(docsDir: string): Promise<Finding | null> {
  if (!existsSync(join(docsDir, COMMIT_INTENT))) return null;
  const intent = (await readCommitIntent(docsDir)) ?? (await readTxnIntent(docsDir));
  const what =
    intent === null
      ? `a commit this loam cannot read — check the living docs against version control, delete ${COMMIT_INTENT}, then re-run`
      : "rerun" in intent
        ? `an interrupted \`${intent.rerun}\` — re-running it recovers first, and \`loam doctor\` names the files`
        : `an interrupted \`loam ${intent.command} ${intent.feature}\` — re-running it recovers first, and \`loam doctor\` names the files`;
  return {
    severity: "error",
    code: "docs.commit-interrupted",
    message:
      `${COMMIT_INTENT} records ${what}. ` +
      "Until it is gone the files under this journal's root may be half-committed, so nothing graded from them can be trusted to describe one state.",
  };
}
