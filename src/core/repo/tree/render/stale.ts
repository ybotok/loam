/**
 * Is the generated file on disk what this tree and this map render to?
 *
 * One function, because the question now has three askers — `validate --all`
 * (which turns a disagreement into `subsystem.views-stale`), `loam subsystem
 * sync`, the write verbs and `loam archive` (which regenerate it), and `loam
 * archive` and `loam unarchive` again after their commits (which must not report
 * a repo current while a file they could not write is stale). Three
 * private compares would be three chances to answer differently about one
 * file, and the module that mints the bytes is the one that owes the answer.
 *
 * The PATH arrives as a parameter rather than a `DocsDir`: `repo/paths.ts`
 * owns the spelling of every file in a docs repo, and importing it here would
 * close the package cycle `repo → repo/tree → repo/tree/render → repo` that
 * `scripts/package-graph.mjs` exists to refuse. `walk.ts` pays the same price
 * for the same reason and says so.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import type { FleetTree } from "../walk.js";
import type { PlannedWrite } from "../../../staging/writes.js";
import { type MapFacts, renderPlatformOverview, renderServiceOverviews, renderSubsystemViews } from "./views.js";

/**
 * The three states, kept apart: absent, must-be-absent, and
 * present-but-different are three different sentences, and a fleet whose views
 * file does not exist is not a fleet whose views file is blank.
 */
export interface ViewsState {
  /** The bytes on disk, or null when the file is not there. */
  actual: string | null;
  /** The bytes the tree renders to, or null when the file must be absent. */
  expected: string | null;
  /** Do the two say the same thing? Content, not bytes — `viewsAgree` says why. */
  agrees: boolean;
}

export async function viewsState(path: string, tree: FleetTree, map: MapFacts): Promise<ViewsState> {
  return stateOf(path, renderSubsystemViews(tree, map));
}

/**
 * The same question about the OTHER generated file, `architecture/services.likec4`.
 *
 * A second exported function rather than a `which` parameter, and a second call
 * at every asker rather than one that answers about both: the two files go stale
 * for different reasons and are repaired in one command, so a caller that wants
 * both asks twice and names each file in its own finding —
 * `subsystem.views-stale` carries the path precisely so one code can honestly
 * cover two files. Folding them into one state would lose which one drifted,
 * which is the only thing the message has to say.
 */
export async function serviceViewsState(path: string, tree: FleetTree, map: MapFacts): Promise<ViewsState> {
  return stateOf(path, renderServiceOverviews(tree, map));
}

/** The same question about the third generated file, `architecture/platform.likec4`, for the same reason. */
export async function platformViewsState(path: string, tree: FleetTree, map: MapFacts): Promise<ViewsState> {
  return stateOf(path, renderPlatformOverview(tree, map).content);
}

/** Read the file, or record its absence, and compare — the half both askers share. */
async function stateOf(path: string, expected: string | null): Promise<ViewsState> {
  const actual = existsSync(path) ? await readFile(path, "utf8") : null;
  return { actual, expected, agrees: viewsAgree(actual, expected) };
}

/**
 * Does the file on disk already SAY what `renderSubsystemViews` renders?
 *
 * The generators in `./views.ts` only ever emit LF. `core.autocrlf=true` is Git for
 * Windows' installer default and a docs repo ships no `.gitattributes`, so an
 * ordinary Windows clone hands the file back with CRLF and not one fact
 * changed. Four call sites asked this question with a byte equality and all
 * four answered "stale" on such a clone: `loam validate` reported an error,
 * `loam subsystem sync` reported `updated` and rewrote with LF, git then showed
 * the file permanently modified, and the next checkout restored the CRLF. That
 * is a loop rather than a diagnosis, which is why the comparison lives here
 * now — in the render package, one file from the generators, which owes an
 * answer about the bytes it mints — and three near-copies of this rule would go
 * stale one at a time. It sat in `./views.ts` itself until that file reached the
 * line limit carrying three generators.
 *
 * Still never a parse: a views-only document does not parse standalone, and no
 * check anywhere reads this file's content. The narrowing is from BYTES to
 * CONTENT, which is what `subsystem.views-stale`'s own message ("does not match
 * the tree") already claims. The symmetric cost is accepted and is the one
 * `core/verify/pins/pin.ts` documents for `pinnedDigest`: a pure line-ending
 * change is invisible, correctly, because it is not a change to what the file
 * says.
 *
 * `null` is carried through as itself rather than collapsing into `""`: absent,
 * must-be-absent and present-but-different are three distinct states with three
 * distinct messages, and a fleet whose views file does not exist is not a fleet
 * whose views file is blank.
 */
export function viewsAgree(actual: string | null, expected: string | null): boolean {
  const lf = (text: string | null): string | null => (text === null ? null : text.replace(/\r\n|\r/g, "\n"));
  return lf(actual) === lf(expected);
}

/**
 * ONE generated file: where it lives, and the bytes it must hold — `null` for
 * "this file must not exist", which is a state of its own and not a blank file
 * (`render/stale.ts` keeps the same three apart on the reading side).
 */
export interface ExpectedFile {
  path: string;
  content: string | null;
}

/** What a commit does to one generated file once every writer's own veto has passed. */
export type ViewsAction = "created" | "updated" | "removed" | "current";

/**
 * Compare ONE generated file against what it must say: the write when they
 * differ, and what that write is. Every writer of these files puts its own veto
 * in front of this and nothing else — `loam subsystem sync`'s `planFile`
 * (`commands/subsystem/sync.ts`), the subsystem verbs' `stageGenerated`
 * (`commands/subsystem/txn/txn.ts`) and the archive's `planGeneratedViews`
 * (`commands/archive/views.ts`) — because the rule is one rule, and a second
 * spelling of it would be a second chance for two writers to answer
 * differently about the same file. It lives down here, beside `viewsAgree`,
 * because the archive became the third caller and a command importing another
 * command's helper is the exception DESIGN rule 5 refuses to grow. A veto one
 * writer needs (sync's `blocked` over an unreadable map, the verbs' refusal to
 * protect an authored file) stays in that writer, never in here.
 *
 * The compare is over CONTENT, not bytes: `viewsAgree` records why, beside the
 * generator. A Windows clone hands a generated file back CRLF with not one fact
 * changed, and a byte compare made `sync` answer `updated` and rewrite it LF —
 * after which git shows the file permanently modified and the next checkout puts
 * the CRLF back — and folded the same rewrite into every subsystem move's
 * transaction and journal. `validate` stopped demanding that rewrite; the
 * writers must stop offering it, or they disagree about the same file. What gets
 * WRITTEN is still the LF render as a Buffer, so the decode is a comparison only.
 */
export function planGenerated(file: ExpectedFile, current: string | null): { action: ViewsAction; write: PlannedWrite | null } {
  if (viewsAgree(current, file.content)) return { action: "current", write: null };
  const bytes = file.content === null ? null : Buffer.from(file.content, "utf8");
  return {
    action: current === null ? "created" : bytes === null ? "removed" : "updated",
    write: { path: file.path, content: bytes },
  };
}
