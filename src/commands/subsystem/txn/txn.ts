/**
 * The shared commit window every subsystem WRITE verb goes through — `new`,
 * `rm`, `move` and `rename` all land here: lock, recover a predecessor's
 * journal, plan against the walked tree, regenerate BOTH generated views files
 * from the PLANNED post-state, commit through the journaled transaction
 * (directory renames included), report. One window, because those files must
 * land in the same commit as whatever changed the tree — a marker without its
 * view, or renames without theirs, is exactly the `subsystem.views-stale` state
 * the generated files' contract refuses to leave between two commits. The
 * per-service file is in that rule and not beside it: its titles are
 * `<subsystem path> / <service id>`, so the placement a verb changes is written
 * into it too.
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
 *
 * NEITHER generated file is written over a document loam did not write, and
 * that guard is checked HERE as well as in `../sync.ts` — see the comment at
 * the check. Both are filenames loam RESERVES inside a directory the team
 * owns, both are rewritten whole, and until the check below existed all four
 * verbs took an authored file at either path without a word. Unlike sync,
 * which reports the one file `refused` and completes the rest, a verb refuses
 * WHOLE: the file has to land in this commit, so half of this commit is not a
 * lesser version of it.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import type { DocsDir } from "../../../core/kernel/ids/dirs.js";
import { fail, repoPath, type ErrorCode } from "../../../core/envelope/json.js";
import { listFleetTree } from "../../../core/repo/repo.js";
import type { FleetTree } from "../../../core/repo/tree/walk.js";
import { stageWrites } from "../../../core/staging/commit.js";
import { type CommitRecovery } from "../../../core/staging/interrupted.js";
import { openCommitWindow } from "../../../core/staging/recovery/recover.js";
import { commitStaged } from "../../../core/staging/txn/transaction.js";
import { type PlannedWrite } from "../../../core/staging/writes.js";
import { authoredGeneratedPaths, authoredRefusal } from "../../../core/repo/tree/render/service/header.js";
import { expectedViews, LANDSCAPE_UNREADABLE_NOTE } from "./views.js";
import { type ExpectedFile, planGenerated, type ViewsAction } from "../../../core/repo/tree/render/views.js";

/**
 * What one commit did to EACH generated file, kept apart.
 *
 * One action per file rather than one folded answer, for the reason
 * `./views.ts` gives about the expected bytes: the two files change for
 * different reasons and are named separately everywhere a person or a `--json`
 * reader meets them. The `views` key a verb has always emitted still carries
 * `subsystems` and nothing else — a payload key's meaning is frozen, so the
 * second file arrives as a key of its own beside it.
 */
export interface ViewsActions {
  /** `architecture/subsystems.likec4` — the verb's `--json` `views` key, unchanged. */
  subsystems: ViewsAction;
  /** `architecture/services.likec4` — the per-service overviews, one per service the map draws. */
  services: ViewsAction;
}

/** The text tail a verb's success line carries about the generated files — one clause per file that moved. */
export function reportViews(views: ViewsActions): string {
  return (
    [
      ["architecture/subsystems.likec4", views.subsystems] as const,
      ["architecture/services.likec4", views.services] as const,
    ]
      // `current` says nothing: the tail hangs off a success line, and a verb
      // that renamed one directory must not print two clauses about files that
      // did not move.
      .filter(([, action]) => action !== "current")
      .map(([file, action]) => ` — ${file} ${action}`)
      .join("")
  );
}

/** What one subsystem verb asks the shared commit window to land. */
export interface SubsystemTxn {
  /** The journal's `target` — what this commit is FOR. */
  target: string;
  /**
   * Marker writes (create/delete), or a move's link rewrites (`./links.ts`) —
   * planned at the document's pre-move path, which the swap lands on before
   * the renames carry it; the views write is derived and appended.
   */
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
  report: (views: ViewsActions, recovered: CommitRecovery | null) => void | Promise<void>;
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
  // Refuse-fast (0), as archive takes the lock: two concurrent verbs answer
  // `docs-busy` rather than queue behind each other.
  const opened = await openCommitWindow(docsDir, 0);
  if (!opened.ok) {
    fail(json, opened.code, opened.message);
    return;
  }
  const { recovered } = opened;
  try {
    const txn = await plan(await listFleetTree(docsDir));
    if (txn === null) return;

    const expected = await expectedViews(docsDir, txn.tree);
    // OWNERSHIP BEFORE ANYTHING IS STAGED, and the WHOLE verb is refused.
    //
    // The guard first shipped in `../sync.ts` alone, and this window is the
    // other writer of exactly the same two reserved paths — for `subsystem
    // new`, `rm`, `move` and `rename` at once. Reproduced before this call
    // existed: with a hand-authored `architecture/services.likec4` in the tree,
    // `loam subsystem new platform` printed "architecture/services.likec4
    // updated" and destroyed it, first line and all. One predicate, one
    // sentence, shared from beneath every writer
    // (`core/repo/tree/render/service/header.ts`).
    //
    // WHY THE WHOLE OPERATION AND NOT JUST THE FILE. `sync` can decline one file
    // and still do the rest, because nothing else it writes depends on that file
    // and every part of it is idempotent. This window cannot: its entire reason
    // for existing is that the generated files land in the SAME commit as the
    // change to the tree, so completing the structural half and reporting the
    // file as refused would MANUFACTURE the `subsystem.views-stale` state the
    // banner above says this window refuses to leave between two commits — and
    // it would do so irreversibly, since `move` and `rename` also stage their
    // renames in git. A half-done move nobody asked for is worse than a refusal
    // a person can act on, and a refusal is re-runnable the moment the authored
    // file is out of the reserved path.
    //
    // It runs AFTER `plan`, which writes nothing and has already answered the
    // verb-specific refusals (`unknown-target`, `subsystem-not-empty`,
    // `move-uncommitted`): a caller whose name is wrong AND whose tree holds an
    // authored views file is better told about the name.
    const authored = await authoredGeneratedPaths([expected.subsystems.path, expected.services.path]);
    if (authored.length > 0) {
      fail(
        json,
        // The code is `already-exists` and not a new one because it is exactly
        // what that code has always meant here — "refusing to create over
        // something that already exists, because overwriting would destroy work
        // nobody asked to lose" — and it is already this command's documented
        // refusal for the flat namespace. A second code for the same sentence
        // would be a second branch an agent has to learn for no new decision.
        "already-exists",
        authored.map((path) => authoredRefusal(repoPath(docsDir, path))).join(" ") +
          " NOTHING was written and nothing was renamed: this command lands the generated views file in the same " +
          "commit as the change to the tree, so it refuses whole rather than leaving the tree changed — and, for " +
          "`move` and `rename`, renames staged in git — with a views file it may not write.",
      );
      return;
    }
    const writes = [...txn.writes];
    // BOTH generated files, in the ONE commit that changes the tree. The
    // per-service file is not a bystander here: its view titles are
    // `<subsystem path> / <service id>`, so every `move` and `rename` restales
    // it exactly as it restales the subsystem views, and leaving it for a later
    // `sync` is the failing-between-two-commits state this window exists to
    // refuse.
    const views: ViewsActions = {
      subsystems: await stageGenerated(expected.subsystems, writes, false),
      // PROTECTED when the map did not parse as a project, and only this file
      // is: `renderSubsystemViews` answers null off the TREE, which is readable
      // either way, while `renderServiceOverviews` answers null whenever no
      // service resolves to an element — which is what an unreadable map looks
      // like from here. Under `known: false` a null render is therefore not
      // evidence of absence, and writing it would delete the whole file over a
      // sibling document that does not parse. A verb still rewrites a file it
      // CAN render (the tolerant arm this window has always taken), and the
      // person is told by the note at the foot of this function.
      services: await stageGenerated(expected.services, writes, !expected.known),
    };
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
    await opened.release();
  }
}

/**
 * Compare ONE generated file against what it must say, append the write when
 * they differ, and name what happened. The compare is `planGenerated`'s, the
 * one `../sync.ts` and the archive make too — `core/repo/tree/render/views.ts`
 * says why it is over CONTENT, not bytes, and why there is one spelling of it.
 *
 * `protect` is the caller's statement that a NULL render is not evidence: the
 * file is left exactly as it is rather than deleted. It is never a licence to
 * skip a real rewrite — a file loam can render is rendered, which is the
 * difference between this window and `../sync.ts`'s `blocked`.
 */
async function stageGenerated(file: ExpectedFile, writes: PlannedWrite[], protect: boolean): Promise<ViewsAction> {
  const current = existsSync(file.path) ? await readFile(file.path, "utf8") : null;
  const planned = planGenerated(file, current);
  if (planned.write === null || (protect && file.content === null)) return "current";
  writes.push(planned.write);
  return planned.action;
}
