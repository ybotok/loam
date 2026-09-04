/**
 * `loam subsystem sync` — the writer of everything under the tree that exists
 * only to be RENDERED, which is the renderer's reading of the tree twice over:
 *
 *  - `architecture/subsystems.likec4`, the GENERATED views file. Recomputed from
 *    the tree on every run, compared, written when it differs, removed when the
 *    tree has no subsystems. The ONE repair for `subsystem.views-stale`. Left
 *    exactly as it is when the `architecture/` project does not parse and the
 *    file already exists — `action: "blocked"`, below.
 *  - `services/<…>/<id>/likec4.config.json`, one LikeC4 project file beside
 *    every model that STANDS ALONE. Never compared, never rewritten. Created
 *    where a standalone model has none, and DELETED where an extending model has
 *    one: measured at the 1.59.2 pin, that nested project claims the model out of
 *    the root project and the fleet loses the service's interior
 *    (`core/repo/tree/render/projects.ts` carries the measurement). This is the
 *    repair `service.likec4-config-stray` has always named and, until now, did
 *    not perform.
 *  - the ROOT `likec4.config.json`'s `exclude` list, and ONLY that key. Derived
 *    from the shapes on disk on every run and rewritten when it differs, because
 *    the two shapes need opposite answers from it: a standalone model must be
 *    excluded (inside the root project every kind it declares is a duplicate)
 *    and an extending model must not be (the root project is the only place it
 *    parses). `planExclude` below states the gate that keeps an old repository
 *    untouched, and `core/c4/service-model/renderer.ts` states which half of the
 *    list is loam's and which is the team's. One entry loam did NOT write is
 *    taken anyway, and only this one: an entry naming a directory that HIDES an
 *    extending model — a subsystem-wide `services/platform/**` survived every
 *    sync while `service.model-excluded` named this command as the repair.
 *
 * The rules differ because the files answer to different owners. The
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
 * Nothing under `services/` is written, and no `exclude` is recomputed, unless
 * the ROOT `likec4.config.json` exists. Without it the tree is not a loadable
 * workspace at all — every model would merge into one project and report every
 * declaration as a duplicate — and a nested project beside a missing root is a
 * promise about a renderer that cannot be opened. `loam doctor` prints the root
 * file; sync says so and writes nothing for the services until it is there.
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
 * (`./txn/txn.ts`) does NOT write project files, and records why. What this run
 * SAYS it did is `./txn/report.ts`: the third answer about the same three files,
 * and the phase that is not part of the commit.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { readModelShapes, type ModelShape } from "../../core/c4/service-model/shape.js";
import type { DocsDir } from "../../core/kernel/ids/dirs.js";
import { fail, repoPath } from "../../core/envelope/json.js";
import {
  LIKEC4_ROOT_PROJECT,
  rootProjectPath,
  serviceRenderPaths,
  subsystemViewsPath,
} from "../../core/repo/paths.js";
import { listFleetTree } from "../../core/repo/repo.js";
import {
  type ProjectGap,
  renderServiceProject,
  surveyProjects,
  type SurveyedModel,
} from "../../core/repo/tree/render/projects.js";
import type { WalkedService } from "../../core/repo/tree/walk.js";
import { stageWrites } from "../../core/staging/commit.js";
import { type CommitRecovery, InterruptedCommitError } from "../../core/staging/interrupted.js";
import { acquireDocsLockWaiting, DocsBusyError, LOCK_WAIT_MS } from "../../core/staging/lock.js";
import { recoverInterruptedCommit } from "../../core/staging/recovery/recover.js";
import { commitStaged } from "../../core/staging/txn/transaction.js";
import { planWrite, type PlannedWrite } from "../../core/staging/writes.js";
import { viewsAgree } from "../../core/repo/tree/render/views.js";
import { NO_EXCLUDE, planExclude } from "./txn/exclude.js";
import { type ProjectsReport, reportSync, type SyncAction } from "./txn/report.js";
import { expectedViews } from "./txn/views.js";

/**
 * The per-service project half of one sync, before the write: what the
 * predicate found, and the two counts the report needs beside it.
 */
interface ProjectPlan {
  /** Whether the root project file exists — the gate on every service write. */
  root: boolean;
  /** The files this run will create. Empty whenever `root` is false. */
  gaps: ProjectGap<WalkedService>[];
  /** The files this run will DELETE — a project file beside an extending model. Empty whenever `root` is false. */
  strays: ProjectGap<WalkedService>[];
  /**
   * Services owed a project file that ALREADY had one — so STANDALONE models
   * only; 0 whenever `root` is false. An extending model is owed none, and
   * counting it here said a file was in place beside a model that must not have
   * one (`service.likec4-config-stray` grades exactly that state).
   */
  current: number;
  /** Model-bearing services, root or no root — what the root-missing note is owed to. */
  modelled: number;
  /** Every model this run considered, with its shape — the exclude list is derived from the same walk. */
  models: SurveyedModel<WalkedService>[];
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
    const expectedBytes = expected.content === null ? null : Buffer.from(expected.content, "utf8");
    // Content, not bytes: `viewsAgree` records why, beside the generator. A
    // Windows clone hands this file back CRLF with not one fact changed, and a
    // byte compare made `sync` answer `updated` and rewrite it LF — after which
    // git shows the file permanently modified and the next checkout puts the
    // CRLF back. `validate` stopped demanding that rewrite; `sync` must stop
    // offering it, or the two disagree about the same file.
    const actual = existsSync(path) ? await readFile(path, "utf8") : null;
    // The render cannot be trusted against a file that already exists when the
    // map is unreadable: without the element join and the style census it is a
    // title and a description, and writing it would take the `include` lines,
    // the boundary comment and the palette reference off a file whose only fault
    // is a sibling document that does not parse.
    const blocked = !expected.known && actual !== null;
    const agree = blocked || viewsAgree(actual, expected.content);
    // ONE read of every model's bytes for the whole run, and the same scan the
    // grader uses: it decides which directories are owed a project file AND
    // which the root project must exclude, and those are opposite answers for
    // the two shapes (`core/repo/tree/render/projects.ts`).
    const shapes = await readModelShapes(tree.services.map((svc) => serviceRenderPaths(svc.dir).model));
    const plan = planProjects(docsDir, tree.services, shapes);
    const exclude = plan.root ? await planExclude(docsDir, tree.services, plan.models) : NO_EXCLUDE;
    // The plan IS the report: every gap is created and every stray removed in
    // the one commit below, and the early return is the branch where both lists
    // are empty.
    const projects = (): ProjectsReport => ({
      root: plan.root,
      // SORTED BY PATH, which is what the contract says these keys hold and what
      // the survey's own order is not: `surveyProjects` sorts by service id, so
      // `services/svc-a/…` came out before `services/platform/svc-d/…` and a
      // consumer told the list was "sorted" got an order no path sort produces
      // (re-verification 2026-09-04, area C item 6). The text view prints the
      // same array, so the two orders cannot drift apart.
      created: plan.gaps.map((gap) => repoPath(docsDir, gap.path)).sort(),
      removed: plan.strays.map((stray) => repoPath(docsDir, stray.path)).sort(),
      current: plan.current,
      modelled: plan.modelled,
      exclude,
    });
    // `action` still describes the views file alone: a run that only created
    // project files answers `current` for it, exactly as before the projects
    // existed, so nothing reading the key sees a new meaning. `blocked` is the
    // one exception and it is about that same file: it was left as it is.
    const action: SyncAction = blocked
      ? "blocked"
      : agree
        ? "current"
        : actual === null
          ? "created"
          : expectedBytes === null
            ? "removed"
            : "updated";
    const say = (): void =>
      reportSync(json, {
        action,
        subsystems: tree.subsystems.length,
        recovered,
        projects: projects(),
        mapUnreadable: !expected.known,
      });
    if (agree && plan.gaps.length === 0 && plan.strays.length === 0 && exclude.write === null) {
      say();
      return;
    }
    const writes: PlannedWrite[] = agree ? [] : [{ path, content: expectedBytes }];
    // `planWrite` marks a non-existent target exclusive — a no-clobber create
    // that fails EEXIST rather than replacing a file another writer landed in
    // the same instant. That IS the create-only rule, enforced by the write
    // path rather than by the `existsSync` the predicate already ran: a file
    // that appears between the check and the swap is somebody's, and stays.
    for (const gap of plan.gaps) {
      writes.push(planWrite(gap.path, renderServiceProject(gap.service.id, LIKEC4_ROOT_PROJECT)));
    }
    // The one file this verb DELETES, and it rides the same journal as the rest,
    // so a run killed mid-swap is rolled forward rather than half-done.
    // `content: null` is the delete the views file already uses.
    for (const stray of plan.strays) writes.push({ path: stray.path, content: null });
    // The root project's `exclude`, in the SAME transaction as the files it
    // decides the fate of: a run that wrote the per-service projects and died
    // before the exclude would leave a tree where the renderer loads a
    // standalone model twice — once in the root project, where every kind it
    // declares is a duplicate — which is worse than either end state.
    if (exclude.write !== null) writes.push(exclude.write);
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
    say();
  } finally {
    await releaseLock();
  }
}

/**
 * What the project half of this run owes, from ONE predicate. `surveyProjects`
 * is the shared spelling of "has a model, a legal id, and no file", and it
 * hands back the sizes of the two domains it counted against — every model it
 * walked, and the standalone models a file is owed for — so `current` is a
 * subtraction rather than a second reading of the same two paths. A loop here
 * re-spelling "has a model" was the drift the shared predicate exists to
 * prevent, and it would have kept counting a directory the survey had
 * skipped. Without the root file the gaps are real but stay unfilled —
 * writing them would promise a renderer nobody can open — and `current` is 0
 * because "already had a file" is only a fact about a workspace that exists.
 */
function planProjects(
  docsDir: DocsDir,
  services: readonly WalkedService[],
  shapes: ReadonlyMap<string, ModelShape>,
): ProjectPlan {
  const root = existsSync(rootProjectPath(docsDir));
  // A model that EXTENDS the map is owed no file, and the survey is where that
  // is decided — one predicate for the writer and the grader, so `validate --all`
  // can never name a gap this run would not fill. An unreadable model classifies
  // as standalone (`readModelShapes`), which is the conservative arm: it gets a
  // project file, which is what every model got before shapes existed.
  const survey = surveyProjects(services, serviceRenderPaths, (model) => shapes.get(resolve(model)) !== "extending");
  if (!root) return { root, gaps: [], strays: [], current: 0, modelled: survey.modelled, models: survey.models };
  return {
    root,
    gaps: survey.gaps,
    // The removal is gated on the root file for the same reason the create is:
    // without it the docs root is not a LikeC4 workspace, so nothing there is
    // claiming anything out of a root project that does not exist, and deleting
    // a team's file over a renderer nobody can open is a writer acting on a
    // hazard it cannot see.
    strays: survey.strays,
    // Over the STANDALONE domain, which is the one `gaps` was drawn from: a
    // model that extends the map is owed no file, so it can neither be a gap nor
    // "already have one", and subtracting from `modelled` counted every
    // extending model as the latter.
    current: survey.standalone - survey.gaps.length,
    modelled: survey.modelled,
    models: survey.models,
  };
}
