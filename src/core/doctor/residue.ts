/**
 * What an unfinished write means for the health of the repo.
 *
 * `core/staging/recovery/residue.ts` reports what is on disk; this decides how
 * bad it is. A held lock and an interrupted commit are blockers because the docs
 * are, or may be, half-merged: a SIGKILL between two of archive's renames once
 * left `doctor: healthy: true` over a merged spec.md and an unmerged landscape,
 * and the next `loam archive` reported loam's own half-merge as the author's
 * bug. Temp files are the exception — a `.loam-*.tmp` was never linked into
 * place, so nothing reads it. Litter, not damage.
 */
import { join } from "node:path";
import { type WritePathResidue } from "../staging/recovery/residue.js";
import { type DoctorFinding } from "./report.js";

export function gradeWritePathResidue(
  docsDir: string,
  residue: WritePathResidue,
  findings: DoctorFinding[],
): void {
  if (residue.lock !== null) {
    const lockFile = join(docsDir, residue.lock.path);
    findings.push({
      // Held by a live process is a fact about right now — wait and re-run.
      // Held by a process that no longer exists is damage: nothing will ever
      // release it, and every archive and unarchive refuses `docs-busy` until
      // somebody deletes it.
      severity: residue.lock.stale ? "blocker" : "warning",
      code: "doctor.docs-locked",
      message: residue.lock.stale
        ? `${residue.lock.path} is held by ${residue.lock.holder}, a process that no longer exists on this host — every \`loam archive\` and \`loam unarchive\` will refuse with \`docs-busy\` until it is gone.`
        : `${residue.lock.path} is held by ${residue.lock.holder}; another archive or unarchive is running against this docs repo.`,
      fix: residue.lock.stale
        ? `Delete ${lockFile} — its holder is dead, so nothing is going to release it. Check \`loam doctor\` again afterwards for an interrupted commit.`
        : "Wait for it to finish and re-run; nothing is read or written while it is held.",
    });
  }

  if (residue.intentUnreadable) {
    findings.push({
      severity: "blocker",
      code: "doctor.commit-unreadable",
      message: `${docsDir} holds a .loam-commit that cannot be read — a commit was interrupted and the one record of which files it had already written is unreadable.`,
      fix: "Hand this to a human: compare the living docs against version control before running any loam command that writes. `loam archive` and `loam unarchive` both refuse with `commit-interrupted` while it is there.",
    });
  } else if (residue.intent !== null) {
    const i = residue.intent;
    // The command is spelled out per branch rather than interpolated into one
    // sentence: `loam ${i.command} ${i.feature}` reads fine to a person and is
    // opaque to test/agent-commands-runnable.test.ts, which parses the commands
    // loam prints against the real program. Same discipline as spelling `code:`
    // literally — be visible to your own guard.
    const repair = i.command === "archive"
      ? `\`loam archive ${i.feature}\` — it recovers first, under the lock, putting the half-written files back from the snapshot`
      : `\`loam unarchive ${i.feature}\` — it recovers first, under the lock, finishing the restore (an interrupted restore is FINISHED, never undone: the merged text it was replacing is written down nowhere)`;
    findings.push({
      severity: "blocker",
      code: "doctor.commit-interrupted",
      message:
        `A ${i.command === "archive" ? `\`loam archive ${i.feature}\`` : `\`loam unarchive ${i.feature}\``} `
        + `was killed mid-commit (${i.host}, pid ${i.pid}, ${i.at}) — `
        + `${i.files.length} file(s) may be half-written: ${i.files.map((f) => f.path).join(", ")}`,
      fix: `Re-run ${repair}, and refuses with \`commit-interrupted\` rather than guessing if a file has been edited since.`,
    });
  }

  if (residue.temps.length > 0) {
    findings.push({
      severity: "warning",
      code: "doctor.staging-temps",
      message: `${residue.temps.length} orphaned staging file(s) under ${docsDir}: ${residue.temps.join(", ")} — a killed writer's scratch, never linked into place.`,
      fix: "The next `loam archive` or `loam unarchive` removes its own; delete any that remain. Nothing reads them, so they cost disk and nothing else.",
    });
  }
}
