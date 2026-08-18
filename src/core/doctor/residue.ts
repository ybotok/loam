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
    // Three grades of one file. Held by a live process is a fact about right
    // now — wait and re-run. Held by a dead process is damage: nothing will
    // ever release it. And a lock that cannot NAME a holder — empty bytes from
    // a crash between create and flush, or JSON nothing understands — is the
    // same damage wearing a live lock's face: `breakStaleLock` rightly refuses
    // to guess about it, so "wait" is advice that can never work, while every
    // writer (archive, unarchive, rebase, verify --record) refuses `docs-busy`
    // forever.
    const unbreakable = residue.lock.stale || residue.lock.unreadable;
    findings.push({
      severity: unbreakable ? "blocker" : "warning",
      code: "doctor.docs-locked",
      message: residue.lock.unreadable
        ? `${residue.lock.path} exists but cannot be read as a lock record — no process can be identified as its holder, so nothing is ever going to release it, and every writing command refuses with \`docs-busy\` while it is there.`
        : residue.lock.stale
          ? `${residue.lock.path} is held by ${residue.lock.holder}, a process that no longer exists on this host — every command that writes through this root will refuse with \`docs-busy\` until it is gone.`
          : `${residue.lock.path} is held by ${residue.lock.holder}; another loam command is writing through this root.`,
      fix: unbreakable
        ? `Delete ${lockFile} — ${residue.lock.unreadable ? "it names no holder, so nothing is going to release it" : "its holder is dead, so nothing is going to release it"}. Check \`loam doctor\` again afterwards for an interrupted commit.`
        : "Wait for it to finish and re-run; nothing is read or written while it is held.",
    });
  }

  if (residue.intentUnreadable) {
    findings.push({
      severity: "blocker",
      code: "doctor.commit-unreadable",
      message: `${docsDir} holds a .loam-commit that cannot be read — a commit was interrupted and the one record of which files it had already written is unreadable.`,
      fix: "Hand this to a human: compare this root's files against version control before running any loam command that writes here. Every journaled writer refuses with `commit-interrupted` while it is there.",
    });
  } else if (residue.intent !== null && "rerun" in residue.intent) {
    // Version 2 — the smaller journaled transaction (rebase, vouch, new,
    // gherkin, and any writer after them). Its stored `rerun` IS the repair:
    // that command recovers first, rolling the staged bytes forward. The
    // string is journal data, so agent-commands-runnable cannot parse it here;
    // test/staging-txn.test.ts parses every writer's rerun template against
    // the real program instead.
    const i = residue.intent;
    findings.push({
      severity: "blocker",
      code: "doctor.commit-interrupted",
      message:
        `A \`${i.rerun}\` was killed mid-commit (${i.host}, pid ${i.pid}, ${i.at}) — `
        + `${i.files.length} file(s) may be half-written: ${i.files.map((f) => f.path).join(", ")}`,
      fix: `Re-run \`${i.rerun}\` — it recovers first, rolling the staged bytes forward, and refuses with \`commit-interrupted\` rather than guessing if a file has been edited since.`,
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

  // A version-2 journal's recorded temps are NOT litter: they are the only
  // durable copy of the after-bytes its roll-forward recovery renames in.
  // Advising their deletion beside a blocker that says "re-run to recover"
  // converted a one-command repair into a manual VCS restore.
  const journalTemps = new Set(
    residue.intent !== null && "rerun" in residue.intent
      ? residue.intent.files.flatMap((f) => (f.tmp === null ? [] : [f.tmp]))
      : [],
  );
  const litter = residue.temps.filter((t) => !journalTemps.has(t));
  if (litter.length > 0) {
    findings.push({
      severity: "warning",
      code: "doctor.staging-temps",
      message: `${litter.length} orphaned staging file(s) under ${docsDir}: ${litter.join(", ")} — a killed writer's scratch, never linked into place.`,
      fix: "The next journaled writer through this root removes its own; delete any that remain. Nothing reads them, so they cost disk and nothing else.",
    });
  }
}
