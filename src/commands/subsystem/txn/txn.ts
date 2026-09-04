/**
 * The shared commit window every subsystem WRITE verb goes through — `new`,
 * `rm`, `move` and `rename` all land here: lock, recover a predecessor's
 * journal, plan against the walked tree, regenerate the views file from the
 * PLANNED post-state, commit through the journaled transaction (directory
 * renames included), report. One window, because the views file must land in
 * the same commit as whatever changed the tree — a marker without its view,
 * or renames without theirs, is exactly the `subsystem.views-stale` state
 * the generated file's contract refuses to leave between two commits.
 *
 * This window does NOT write the per-service project files
 * (`services/<…>/<id>/likec4.config.json`); only `../sync.ts` does, and the
 * asymmetry is deliberate rather than an omission. The views file must ride
 * in the verb's commit because its bytes depend on the PLACEMENT the verb is
 * changing. A project file's bytes depend on the service id alone, which no
 * verb here changes — and the file lives INSIDE the service directory, so a
 * `move` carries it to the new location as part of the rename it already
 * journals (in a git-backed repo that move REFUSES first, `move-uncommitted`,
 * until the files `sync` created are committed — the refusal names them, and
 * `sync`'s own output says to commit them), and `rm` never reaches one,
 * because it refuses any subsystem that still holds a member
 * (`subsystem-not-empty`, `../edit.ts`). No verb can
 * therefore leave a project file stale or orphaned, and a verb that filled
 * gaps in passing would silently write files a `--json` reader of `new` or
 * `rename` was never told to expect. The one state a verb can leave is a
 * model with no file beside it, and that is the state `validate --all` names
 * as `service.likec4-config-missing`, with `loam subsystem sync` as the
 * repair — one writer, so the create-only rule has one place to hold.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import type { DocsDir } from "../../../core/kernel/ids/dirs.js";
import { fail, type ErrorCode } from "../../../core/envelope/json.js";
import { subsystemViewsPath } from "../../../core/repo/paths.js";
import { listFleetTree } from "../../../core/repo/repo.js";
import type { FleetTree } from "../../../core/repo/tree/walk.js";
import { stageWrites } from "../../../core/staging/commit.js";
import { type CommitRecovery, InterruptedCommitError } from "../../../core/staging/interrupted.js";
import { acquireDocsLock, DocsBusyError } from "../../../core/staging/lock.js";
import { recoverInterruptedCommit } from "../../../core/staging/recovery/recover.js";
import { commitStaged } from "../../../core/staging/txn/transaction.js";
import { type PlannedWrite } from "../../../core/staging/writes.js";
import { viewsAgree } from "../../../core/repo/tree/render/views.js";
import { expectedViews, LANDSCAPE_UNREADABLE_NOTE } from "./views.js";

export type ViewsAction = "created" | "updated" | "removed" | "current";

/** The text tail a verb's success line carries about the generated file. */
export function reportViews(views: ViewsAction): string {
  return views === "current" ? "" : ` — architecture/subsystems.likec4 ${views}`;
}

/** What one subsystem verb asks the shared commit window to land. */
export interface SubsystemTxn {
  /** The journal's `target` — what this commit is FOR. */
  target: string;
  /** Marker writes (create/delete); the views write is derived and appended. */
  writes: PlannedWrite[];
  /** The tree AS THE COMMIT LEAVES IT — the views file is rendered from this. */
  tree: FleetTree;
  /** Directory renames, performed after the swaps, in this order. */
  moves?: { from: string; to: string }[];
  /** Remap of a RACED commit failure (new: a lost marker create is `already-exists`). */
  racedCode?: ErrorCode;
  /** Remap of a rolled-back commit failure (move: `move-failed` — no merge was computed). */
  failedCode?: ErrorCode;
  /** The rollback sentence's verb for half-state files. */
  what: string;
  report: (views: ViewsAction, recovered: CommitRecovery | null) => void | Promise<void>;
}

/**
 * Lock → recover → plan → stage (views included) → journaled commit → report.
 * `plan` returning null means it already reported a refusal; nothing was
 * staged and nothing is written.
 */
export async function commitWindow(
  docsDir: DocsDir,
  json: boolean,
  plan: (tree: FleetTree) => Promise<SubsystemTxn | null>,
): Promise<void> {
  let releaseLock: () => Promise<void>;
  try {
    releaseLock = await acquireDocsLock(docsDir);
  } catch (err) {
    if (!(err instanceof DocsBusyError)) throw err;
    fail(json, "docs-busy", err.message);
    return;
  }
  try {
    let recovered: CommitRecovery | null;
    try {
      recovered = await recoverInterruptedCommit(docsDir);
    } catch (err) {
      if (!(err instanceof InterruptedCommitError)) throw err;
      fail(json, "commit-interrupted", err.message);
      return;
    }
    const txn = await plan(await listFleetTree(docsDir));
    if (txn === null) return;

    const path = subsystemViewsPath(docsDir);
    const expected = await expectedViews(docsDir, txn.tree);
    const bytes = expected.content === null ? null : Buffer.from(expected.content, "utf8");
    // Content, not bytes — `viewsAgree` carries the reason. Without it every
    // subsystem move on a Windows clone folded a rewrite of this file into its
    // transaction that changed not one fact, and journalled it.
    const current = existsSync(path) ? await readFile(path, "utf8") : null;
    let views: ViewsAction = "current";
    const writes = [...txn.writes];
    if (!viewsAgree(current, expected.content)) {
      views = current === null ? "created" : bytes === null ? "removed" : "updated";
      writes.push({ path, content: bytes });
    }
    const staged = await stageWrites(writes);
    const committed = await commitStaged(
      {
        root: docsDir,
        command: "subsystem",
        rerun: "loam subsystem sync",
        target: txn.target,
        ...(txn.moves === undefined ? {} : { moves: txn.moves }),
      },
      staged,
      txn.what,
    );
    if (!committed.ok) {
      const code =
        committed.code === "rollback-incomplete"
          ? committed.code
          : committed.raced
            ? (txn.racedCode ?? txn.failedCode ?? committed.code)
            : (txn.failedCode ?? committed.code);
      fail(json, code, committed.message);
      return;
    }
    await txn.report(views, recovered);
    // A verb CANNOT leave this file behind the tree — its bytes depend on the
    // placement the verb just changed, so the tolerant render lands even when the
    // map is unreadable and the file loses its includes. `sync` may decline that
    // rewrite (`action: "blocked"`); a verb may not, so the person is told
    // instead, and the same note names the run that puts the includes back.
    if (!json && !expected.known) console.log(LANDSCAPE_UNREADABLE_NOTE);
  } finally {
    await releaseLock();
  }
}
