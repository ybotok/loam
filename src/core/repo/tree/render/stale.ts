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
import { type MapFacts, renderServiceOverviews, renderSubsystemViews, viewsAgree } from "./views.js";

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

/** Read the file, or record its absence, and compare — the half both askers share. */
async function stateOf(path: string, expected: string | null): Promise<ViewsState> {
  const actual = existsSync(path) ? await readFile(path, "utf8") : null;
  return { actual, expected, agrees: viewsAgree(actual, expected) };
}
