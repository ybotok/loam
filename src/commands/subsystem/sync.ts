/**
 * `loam subsystem sync` — the writer of everything under the tree that exists
 * only to be RENDERED, which is the renderer's reading of the tree twice over:
 *
 *  - `architecture/subsystems.likec4`, the GENERATED views file. Recomputed from
 *    the tree on every run, compared, written when it differs, removed when the
 *    tree has no subsystems. The ONE repair for `subsystem.views-stale`.
 *  - `services/<…>/<id>/likec4.config.json`, one LikeC4 project file beside
 *    every `model.likec4`. CREATE-ONLY: never compared, never rewritten, never
 *    removed.
 *
 * The two rules differ because the two files answer to different owners. The
 * views file is a pure function of the tree and the committed landscape, so
 * every byte of it is loam's and a hand edit is by definition stale. The
 * project file's bytes are a function of the service id ALONE — the identity
 * no verb ever changes — so nothing can make it stale, and the keys LikeC4
 * lets a team add to it (`title`, styles, a contact) are the team's; a compare
 * would fight them, and a rewrite would take them. `core/repo/tree/render/projects.ts`
 * records the measurement behind the file and the naming rule; here, presence
 * is the one question asked of it, through the SAME predicate `validate --all`
 * grades with (`missingProjects`), so the grader can never name a gap this
 * writer would not fill.
 *
 * The project files are written only when the ROOT `likec4.config.json` exists.
 * Without it the tree is not a loadable workspace at all — every model would
 * merge into one project and report every declaration as a duplicate — and a
 * nested project beside a missing root is a promise about a renderer that
 * cannot be opened. `loam doctor` prints the root file; sync says so and
 * writes nothing for the services until it is there.
 *
 * Every write goes through the same lock + journaled transaction every docs
 * writer uses (`commitStaged`), and both kinds land in ONE commit: a
 * predecessor's interrupted commit is recovered first and a sync killed
 * mid-swap is rolled forward by the next writer. Idempotent by construction:
 * the expected views bytes are a pure function of the tree, and a project
 * file, once present, is never a gap again — so a second run reports
 * `current` and writes nothing.
 *
 * The expected views bytes come from `./txn/views.ts` — the same module every
 * writer verb renders from, so sync and the transactions cannot disagree
 * about what the file should say. The subsystem verbs' own commit window
 * (`./txn/txn.ts`) does NOT write project files, and records why.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import type { DocsDir } from "../../core/kernel/ids/dirs.js";
import { emitJson, fail, repoPath } from "../../core/envelope/json.js";
import {
  LIKEC4_ROOT_PROJECT,
  rootProjectPath,
  serviceRenderPaths,
  subsystemViewsPath,
} from "../../core/repo/paths.js";
import { listFleetTree } from "../../core/repo/repo.js";
import { type ProjectGap, renderServiceProject, surveyProjects } from "../../core/repo/tree/render/projects.js";
import type { WalkedService } from "../../core/repo/tree/walk.js";
import { stageWrites } from "../../core/staging/commit.js";
import { type CommitRecovery, InterruptedCommitError } from "../../core/staging/interrupted.js";
import { acquireDocsLockWaiting, DocsBusyError, LOCK_WAIT_MS } from "../../core/staging/lock.js";
import { recoverInterruptedCommit } from "../../core/staging/recovery/recover.js";
import { commitStaged } from "../../core/staging/txn/transaction.js";
import { planWrite, type PlannedWrite } from "../../core/staging/writes.js";
import { viewsAgree } from "../../core/repo/tree/render/views.js";
import { expectedViews } from "./txn/views.js";

/** What one sync did to the views file — and ONLY that file; the projects report separately. */
type SyncAction = "current" | "created" | "updated" | "removed";

/**
 * The per-service project half of one sync, before the write: what the
 * predicate found, and the two counts the report needs beside it.
 */
interface ProjectPlan {
  /** Whether the root project file exists — the gate on every service write. */
  root: boolean;
  /** The files this run will create. Empty whenever `root` is false. */
  gaps: ProjectGap<WalkedService>[];
  /** Model-bearing services that ALREADY had a file; 0 whenever `root` is false. */
  current: number;
  /** Model-bearing services, root or no root — what the root-missing note is owed to. */
  modelled: number;
}

/** The additive `projects` payload key, and what the text lines are composed from. */
interface ProjectsReport {
  root: boolean;
  /** Repo-relative POSIX paths written this run, sorted by id. */
  created: string[];
  current: number;
  modelled: number;
}

export async function runSync(docsDir: DocsDir, json: boolean): Promise<void> {
  let releaseLock: () => Promise<void>;
  try {
    releaseLock = await acquireDocsLockWaiting(docsDir, LOCK_WAIT_MS);
  } catch (err) {
    if (!(err instanceof DocsBusyError)) throw err;
    fail(json, "docs-busy", err.message);
    return;
  }
  try {
    // A predecessor's journal is recovered (or refused) before the tree is
    // read: the views file itself may be the half-written one.
    let recovered: CommitRecovery | null;
    try {
      recovered = await recoverInterruptedCommit(docsDir);
    } catch (err) {
      if (!(err instanceof InterruptedCommitError)) throw err;
      fail(json, "commit-interrupted", err.message);
      return;
    }

    const tree = await listFleetTree(docsDir);
    const expected = await expectedViews(docsDir, tree);
    const path = subsystemViewsPath(docsDir);
    const expectedBytes = expected === null ? null : Buffer.from(expected, "utf8");
    // Content, not bytes: `viewsAgree` records why, beside the generator. A
    // Windows clone hands this file back CRLF with not one fact changed, and a
    // byte compare made `sync` answer `updated` and rewrite it LF — after which
    // git shows the file permanently modified and the next checkout puts the
    // CRLF back. `validate` stopped demanding that rewrite; `sync` must stop
    // offering it, or the two disagree about the same file.
    const actual = existsSync(path) ? await readFile(path, "utf8") : null;
    const agree = viewsAgree(actual, expected);
    const plan = planProjects(docsDir, tree.services);
    const projects = (created: string[]): ProjectsReport => ({
      root: plan.root,
      created,
      current: plan.current,
      modelled: plan.modelled,
    });
    if (agree && plan.gaps.length === 0) {
      report(json, { action: "current", subsystems: tree.subsystems.length, recovered, projects: projects([]) });
      return;
    }
    // `action` still describes the views file alone: a run that only created
    // project files answers `current` for it, exactly as before the projects
    // existed, so nothing reading the key sees a new meaning.
    const action: SyncAction = agree
      ? "current"
      : actual === null
        ? "created"
        : expectedBytes === null
          ? "removed"
          : "updated";
    const writes: PlannedWrite[] = agree ? [] : [{ path, content: expectedBytes }];
    // `planWrite` marks a non-existent target exclusive — a no-clobber create
    // that fails EEXIST rather than replacing a file another writer landed in
    // the same instant. That IS the create-only rule, enforced by the write
    // path rather than by the `existsSync` the predicate already ran: a file
    // that appears between the check and the swap is somebody's, and stays.
    for (const gap of plan.gaps) {
      writes.push(planWrite(gap.path, renderServiceProject(gap.service.id, LIKEC4_ROOT_PROJECT)));
    }
    // One lock, one journal, one commit for both kinds of file — a sync killed
    // between the views swap and the project creates would otherwise leave a
    // half-state no later run could tell from a team's deliberate deletion.
    const staged = await stageWrites(writes);
    const committed = await commitStaged(
      { root: docsDir, command: "subsystem", rerun: "loam subsystem sync", target: "subsystems" },
      staged,
      "synced",
    );
    if (!committed.ok) {
      fail(json, committed.code, committed.message);
      return;
    }
    const created = plan.gaps.map((gap) => repoPath(docsDir, gap.path));
    report(json, { action, subsystems: tree.subsystems.length, recovered, projects: projects(created) });
  } finally {
    await releaseLock();
  }
}

/**
 * What the project half of this run owes, from ONE predicate. `surveyProjects`
 * is the shared spelling of "has a model, a legal id, and no file", and it
 * hands back the size of the domain it counted against, so `current` is a
 * subtraction rather than a second reading of the same two paths — a loop
 * here re-spelling "has a model" was the drift the shared predicate exists to
 * prevent, and it would have kept counting a directory the survey had
 * skipped. Without the root file the gaps are real but stay unfilled —
 * writing them would promise a renderer nobody can open — and `current` is 0
 * because "already had a file" is only a fact about a workspace that exists.
 */
function planProjects(docsDir: DocsDir, services: readonly WalkedService[]): ProjectPlan {
  const root = existsSync(rootProjectPath(docsDir));
  const survey = surveyProjects(services, serviceRenderPaths);
  if (!root) return { root, gaps: [], current: 0, modelled: survey.modelled };
  return { root, gaps: survey.gaps, current: survey.modelled - survey.gaps.length, modelled: survey.modelled };
}

function report(
  json: boolean,
  out: { action: SyncAction; subsystems: number; recovered: CommitRecovery | null; projects: ProjectsReport },
): void {
  if (json) {
    emitJson({
      command: "subsystem",
      path: "architecture/subsystems.likec4",
      action: out.action,
      subsystems: out.subsystems,
      ...(out.recovered === null ? {} : { recovered: out.recovered }),
      projects: { root: out.projects.root, created: out.projects.created, current: out.projects.current },
    });
    return;
  }
  if (out.recovered !== null && out.recovered.outcome !== "consistent") {
    console.log(
      `note: recovered an interrupted \`loam ${out.recovered.command}\` commit first (${out.recovered.outcome}).`,
    );
  }
  const wrote = out.projects.created.length;
  // "nothing to write" is a claim about the whole run, and it is false the
  // moment a project file landed beside a current views file.
  const sentence: Record<SyncAction, string> = {
    current: `architecture/subsystems.likec4 is current (${out.subsystems} subsystem(s))${wrote === 0 ? " — nothing to write." : "."}`,
    created: `wrote architecture/subsystems.likec4 — ${out.subsystems} subsystem view(s).`,
    updated: `updated architecture/subsystems.likec4 — ${out.subsystems} subsystem view(s).`,
    removed: `removed architecture/subsystems.likec4 — the tree has no subsystems, so the generated file must be absent.`,
  };
  console.log(sentence[out.action]);
  if (wrote > 0) {
    console.log(
      `wrote ${wrote} services/<…>/likec4.config.json — one LikeC4 project per service model, create-only ` +
        "(a file that already exists is yours and is never touched; commit the new ones before a " +
        "`loam subsystem move`, which refuses over untracked paths). With more than one project, " +
        "likec4 validate at the docs root needs --project <name>; build and export take every project.",
    );
  }
  if (!out.projects.root && out.projects.modelled > 0) {
    console.log(
      "note: no likec4.config.json at the docs root, so no service project files were written — " +
        "`loam doctor` prints the root file.",
    );
  }
}
