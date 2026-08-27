/**
 * The capability tree: `capabilities/<id>/spec.md`, and the rule that a
 * directory holding one IS a declared capability.
 *
 * WHY A TREE AND NOT A SECOND LIST IN YAML. `architecture/capabilities.yaml`
 * declares names; it cannot carry prose, and a capability a business analyst
 * actually wrote is mostly prose. The alternative — a single vocabulary file
 * grown to hold paragraphs — is the exact drift `loam init`'s removed
 * `loam.docs.json` was removed for: a second list nothing keeps current. So the
 * DIRECTORY is the list, and the general rule it settles is that an entry with
 * prose gets a file while an entry without prose stays a line in YAML
 * (`architecture/permissions.yaml` is the principled exception — a
 * `user/profile:read` pair has no prose, and a document per pair is ceremony).
 *
 * THE VOCABULARY IS THE UNION of this tree and the YAML, and the YAML is not
 * deprecated by it. A fleet that declared twenty names and has written four
 * documents is the normal state of an adoption, and a tree that refused to
 * grade the other sixteen would make adopting the axis a cliff.
 * `./capabilities.ts` merges the two and records which side declared each id.
 *
 * PRESENCE CLASSIFIES, one tree over from `isServiceArtifactName`: a directory
 * holding the document is a capability, and one holding only other directories
 * is a group the walk descends through. Both at once is legal and normal —
 * `payments` may be a capability with `payments/refunds` nested inside it —
 * because a capability id spells its own nesting wherever it is written and the
 * tree only mirrors that. What is NOT legal is a directory that is neither:
 * `capability.doc-missing` names it, rather than letting a half-created
 * capability sit in the tree looking declared.
 *
 * The walk reads directories only. It never parses a document — the requirement
 * reader is injected by whoever grades (`./findings.ts` takes parsed
 * requirements, `commands/validate/` supplies the fleet's cached reader), for
 * the reason `./rollup.ts` states: this package is imported by
 * `core/fleet-context.ts` and may never import it back.
 */
import { existsSync, realpathSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { compareIds } from "../repo/entries.js";
import { capabilityDocPathsAt } from "../repo/paths.js";
import { entryIs } from "../repo/tree/fs.js";

/** One authored capability: where its directory is, and where its document is. */
export interface CapabilityDoc {
  /** The id — the directory names between `capabilities/` and this one, joined with `/`. */
  id: string;
  dir: string;
  /** `<dir>/spec.md`. Its existence is what made this a capability. */
  spec: string;
}

export interface CapabilityTree {
  /**
   * False when `capabilities/` does not exist. The directory's existence is
   * this half of the axis's opt-in, so a fleet without one produces nothing
   * here — not an empty tree that then reads as "the capabilities went
   * missing" to anything counting.
   */
  present: boolean;
  /** Every capability found, at any depth, ordered by id. */
  docs: CapabilityDoc[];
  /**
   * Repo-relative paths of directories under `capabilities/` that hold no
   * document and have no capability beneath them — the half-created capability
   * `capability.doc-missing` names. Ordered, for a diff-stable finding list.
   */
  undocumented: string[];
}

/** One directory the walk is looking at: where it is, and how it was reached. */
interface Spot {
  dir: string;
  /** Directory names between `capabilities/` and this one, outermost first, including it. */
  chain: string[];
}

interface WalkState {
  tree: CapabilityTree;
  /** Realpaths already DESCENDED into — the symlink-cycle guard. */
  visited: Set<string>;
}

/**
 * Read the tree under `root` (`capabilityDocsDir(docsDir)`).
 *
 * Cost is one readdir per directory, capability directories included: their own
 * listing is what classifies them, and it is the same listing that finds the
 * capabilities nested inside. A fleet is expected to hold tens of these
 * documents rather than hundreds — the corpus is sized like the landscape, not
 * like the service tree — which is what keeps a second requirement corpus
 * reviewable at all, and what makes the walk's cost a non-question.
 */
export async function readCapabilityTree(root: string): Promise<CapabilityTree> {
  const tree: CapabilityTree = { present: existsSync(root), docs: [], undocumented: [] };
  if (!tree.present) return tree;
  const state: WalkState = { tree, visited: new Set() };
  if (descended(root, state)) {
    for (const name of await subdirNames(root)) {
      await visit({ dir: join(root, name), chain: [name] }, state);
    }
  }
  tree.docs.sort((a, b) => compareIds(a.id, b.id));
  tree.undocumented.sort(compareIds);
  return tree;
}

/**
 * Mark a directory as descended-into; false when it (or another name for it)
 * already was. The same guard `core/repo/tree/walk.ts` carries and for the same
 * reason: `entryIs` follows symlinks on purpose, and a followed cycle without a
 * visited set recurses until the stack ends.
 */
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

/** Sorted non-dot subdirectory names — the walk's deterministic child order. */
async function subdirNames(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  return entries.filter((e) => !e.name.startsWith(".") && entryIs(dir, e, "dir")).map((e) => e.name).sort();
}

/**
 * Classify one directory and walk what is inside it. Returns whether a
 * capability was found at or beneath it — the only thing a caller needs, since
 * a group directory earns no finding for being a group.
 *
 * A directory reached a SECOND time through a symlink answers `true` rather
 * than `false`, and the distinction is a quiet enumeration against a spurious
 * finding: it was already walked under its first name, so everything in it is
 * already recorded, and reporting it undocumented would name a directory whose
 * document loam has in fact already read.
 */
async function visit(spot: Spot, state: WalkState): Promise<boolean> {
  const entries = (await readdir(spot.dir, { withFileTypes: true })).filter((e) => !e.name.startsWith("."));
  const paths = capabilityDocPathsAt(spot.dir);
  const documented = entries.some((e) => join(spot.dir, e.name) === paths.spec && entryIs(spot.dir, e, "file"));
  if (documented) state.tree.docs.push({ id: spot.chain.join("/"), dir: spot.dir, spec: paths.spec });

  let beneath = false;
  if (descended(spot.dir, state)) {
    const dirs = entries.filter((e) => entryIs(spot.dir, e, "dir")).map((e) => e.name).sort();
    for (const child of dirs) {
      // Sequential, not Promise.all: the visited set is shared mutable state and
      // the walk's correctness under symlinks rests on a child being marked
      // before its sibling asks. These trees are tens of directories at most, so
      // there is nothing to win by racing them.
      if (await visit({ dir: join(spot.dir, child), chain: [...spot.chain, child] }, state)) beneath = true;
    }
  } else {
    beneath = true;
  }

  if (!documented && !beneath) state.tree.undocumented.push(["capabilities", ...spot.chain].join("/"));
  return documented || beneath;
}
