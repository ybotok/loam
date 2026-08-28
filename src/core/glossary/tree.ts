/**
 * The glossary tree: `glossary/<term>.md`, and the rule that a markdown file
 * under it IS a declared term.
 *
 * WHY A TREE AND NOT A YAML VOCABULARY, at length in `repo/authored/paths.ts`'s
 * `glossaryDir`: a single vocabulary file at fleet scale is unworkable, and a
 * second list is the drift `loam init`'s removed service manifest was removed
 * for. A term is prose — that is what a definition is — so by this codebase's
 * own rule it gets a file.
 *
 * PRESENCE CLASSIFIES, one tree over from `capabilities/`: a `.md` file is a
 * term, a directory is a group the walk descends through. There is no
 * "half-created term" state to name, which is why this walk emits nothing like
 * `capability.doc-missing`: creating a term is writing one file, and an empty
 * grouping directory declares nothing and claims nothing.
 *
 * `README.md` IS NOT A TERM, and it is the one name excluded. A glossary big
 * enough to want an index page is normal, and reporting that page as a word
 * nobody uses would make the axis's only warning fire on the document that
 * explains the axis. Excluded by name rather than by a marker field: the
 * alternative is frontmatter nobody would remember to write.
 *
 * The walk reads directories only and never opens a file. What is IN a term
 * document is prose for a human, and the one thing loam reads from it — the
 * links it writes — is read by `core/links/`, where every other document's are.
 */
import { existsSync, realpathSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { compareIds } from "../repo/entries.js";
import { entryIs } from "../repo/tree/fs.js";

/** The one filename under `glossary/` that is not a term. */
const INDEX_PAGE = "README.md";

/** One defined term: what it is called, and where its definition is. */
export interface GlossaryTerm {
  /** The path from `glossary/` to the file, without `.md` — `order`, or `payments/order`. */
  id: string;
  /** Absolute path of the definition. */
  path: string;
}

export interface Glossary {
  /**
   * False when `glossary/` does not exist. The directory's existence is the
   * axis's opt-in, so a fleet without one produces nothing here — not an empty
   * glossary, which would read as "the terms went missing" to anything counting.
   */
  present: boolean;
  /** Every term found, at any depth, ordered by id. */
  terms: GlossaryTerm[];
}

/** One directory the walk is looking at: where it is, and how it was reached. */
interface Spot {
  dir: string;
  /** Directory names between `glossary/` and this one, outermost first. */
  chain: string[];
}

interface WalkState {
  terms: GlossaryTerm[];
  /** Realpaths already descended into — the symlink-cycle guard. */
  visited: Set<string>;
}

/**
 * Read the tree under `root` (`glossaryDir(docsDir)`).
 *
 * A fleet is expected to hold tens to low hundreds of these — a domain's
 * vocabulary, not its data — so the cost is one `readdir` per directory and the
 * walk's expense is a non-question. The symlink-cycle guard is the one
 * `core/repo/tree/walk.ts` and the capability walk both carry, and for the same
 * reason: `entryIs` follows symlinks on purpose, and a followed cycle without a
 * visited set recurses until the stack ends.
 */
export async function readGlossary(root: string): Promise<Glossary> {
  if (!existsSync(root)) return { present: false, terms: [] };
  const state: WalkState = { terms: [], visited: new Set() };
  await visit({ dir: root, chain: [] }, state);
  state.terms.sort((a, b) => compareIds(a.id, b.id));
  return { present: true, terms: state.terms };
}

/** Collect the terms in one directory and walk what is beneath it. */
async function visit(spot: Spot, state: WalkState): Promise<void> {
  if (!descended(spot.dir, state)) return;
  const entries = (await readdir(spot.dir, { withFileTypes: true })).filter((e) => !e.name.startsWith("."));
  for (const entry of entries.filter((e) => e.name.endsWith(".md")).sort((a, b) => compareIds(a.name, b.name))) {
    if (entry.name === INDEX_PAGE || !entryIs(spot.dir, entry, "file")) continue;
    state.terms.push({
      id: [...spot.chain, entry.name.slice(0, -".md".length)].join("/"),
      path: join(spot.dir, entry.name),
    });
  }
  // Sequential, not Promise.all: the visited set is shared mutable state and
  // the walk's correctness under symlinks rests on a child being marked before
  // its sibling asks. These trees are tens of directories at most.
  for (const child of entries.filter((e) => entryIs(spot.dir, e, "dir")).map((e) => e.name).sort()) {
    await visit({ dir: join(spot.dir, child), chain: [...spot.chain, child] }, state);
  }
}

/** Mark a directory as descended-into; false when it (or another name for it) already was. */
function descended(dir: string, state: WalkState): boolean {
  let real: string;
  try {
    real = realpathSync(dir);
  } catch {
    return false;
  }
  if (state.visited.has(real)) return false;
  state.visited.add(real);
  return true;
}
