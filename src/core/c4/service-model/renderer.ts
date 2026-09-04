/**
 * The `exclude` list `loam subsystem sync` WRITES back into the root
 * `likec4.config.json` — the write half of the one file loam otherwise only
 * reads. The read half, and the matcher that decides whether an entry hides a
 * directory, are `../root-project/exclude.ts`: they moved down there when the
 * project loader became a reader of the same list, and this module is the only
 * thing left that computes new bytes for it.
 *
 * The ownership rule is stated once and holds for both halves: `exclude` is a
 * glob list in a tool's own config, the team owns the file, and loam maintains
 * exactly the `services/` entries that decide whether a model is renderable. An
 * entry loam does not recognise is left exactly where the team put it.
 */
import { excludedDirectory, excludingEntry } from "../root-project/exclude.js";

/** The `services/` prefix every tree path is spelled under, in the config and on disk alike. */
const SERVICES = "services";

/** The service trees a rewrite is computed against: which stand alone, and which exist at all. */
export interface ExcludeTrees {
  /** Every service whose model declares its own kinds, and so must be excluded. */
  standalone: readonly string[];
  /**
   * Every service whose model EXTENDS the map, and so must NOT be excluded by
   * anything — the trees a covering entry is measured against below.
   */
  extending: readonly string[];
  /** Every service the enumeration found — the domain loam's own entries are drawn from. */
  enumerated: readonly string[];
}

/**
 * The `exclude` list `loam subsystem sync` writes: loam's own entries
 * recomputed from the shapes on disk, everybody else's kept exactly as written
 * and in that order.
 *
 * WHICH ENTRIES ARE LOAM'S is the careful half, and it is decided by two
 * different questions rather than one.
 *
 * The first is AUTHORSHIP: the whole `services/` tree is loam's (it wrote that
 * entry into every scaffold before this axis), and so is any entry naming a
 * `services/<tree>` the enumeration actually found — those are the entries this
 * function produced on an earlier sync, and one of them must disappear the
 * moment that service's model becomes extending. This is why the enumeration is
 * a parameter rather than something inferred from the entries themselves: an
 * entry cannot say who wrote it, but the tree can say whether it names a service.
 *
 * The second is EFFECT, and it is the half that was missing. An entry only has
 * to cover an ANCESTOR of a tree to hide it — `excludingEntry` says so, because
 * that is how the renderer reads the list — so a root config saying
 * `services/platform/**` hides `services/platform/identity-service` just as
 * completely as `services/**` does, while naming a directory the enumeration
 * never returns as a service. Left alone it warned `service.model-excluded`
 * forever and `sync` answered `updated: false`: a repair loop that never closed,
 * with the message naming the command that would not perform it. So an entry
 * that covers a tree whose model EXTENDS the map is dropped as well — the
 * standalone trees such an entry also covered get their own entries back through
 * the append below.
 *
 * THE TWO QUESTIONS ARE ASKED THROUGH DIFFERENT FUNCTIONS, and that is the
 * correction this round made (verification 2026-09-04, review C). AUTHORSHIP is
 * about the directory an entry NAMES, so it goes through `excludedDirectory`,
 * which answers null for an entry naming no plain directory at all (a starred
 * middle segment, the `node_modules` glob). EFFECT is about what an entry HIDES,
 * so it goes through `excludingEntry` — the same matcher the read side uses,
 * whatever the entry's spelling. Asking effect through `excludedDirectory` too
 * meant an entry with a star where the subsystem name goes was `kept`
 * unconditionally: it hid an extending model forever while
 * `service.model-excluded` named this command as the repair, which is the very
 * loop the effect rule was added to close.
 *
 * Everything else survives untouched, INCLUDING a `services/legacy/**` for a
 * directory that is not a service at all, and including a covering entry that
 * hides only standalone trees: those are the team's own globs about their own
 * tree, they hide nothing that needs to be visible, and a sync that ate one
 * would be loam deleting a line it never wrote. Only the entries that make a
 * renderable model unrenderable are taken.
 *
 * A standalone model MUST be excluded: it declares its own kinds, so inside the
 * root project every one of them is a duplicate blamed on the fleet map as
 * well, which blanks the whole project. An extending model must NOT be: the
 * root project is the only place it parses at all.
 *
 * NOTHING IS APPENDED FOR A TREE THE SURVIVING LIST ALREADY COVERS. A second
 * entry would be a line a person did not write appearing in a file they own,
 * for a directory the renderer already skips — and SCHEMA.md promises exactly
 * that ("a directory the list already covers in any of those spellings earns no
 * second entry"). The risk it leaves is real and it is the recoverable one: if
 * the team narrows their covering glob tomorrow, the standalone model becomes
 * visible in the root project, `validate --all` says so as
 * `service.model-unexcluded`, and the next sync writes the entry. A duplicate
 * cannot be un-written by any command at all.
 *
 * The appended entries are sorted rather than kept in tree order because the
 * file is a diff a person reads: a service adopted into the middle of a
 * subsystem would otherwise move every line after it.
 */
export function standaloneExclude(exclude: readonly string[], trees: ExcludeTrees): string[] {
  const enumerated = new Set(trees.enumerated.map(treeUnderServices));
  const kept = exclude.filter((entry) => {
    // EFFECT first, and through the matcher rather than through the directory
    // the entry names: an entry that hides a model which only parses inside the
    // root project has to go whatever its spelling, and the authorship half
    // below cannot see half of those spellings.
    if (trees.extending.some((tree) => excludingEntry([entry], tree) !== null)) return false;
    const dir = servicesTreeOf(entry);
    if (dir === null) return true;
    // The whole `services/` tree, however spelled: loam wrote that entry into
    // every scaffold before the extending shape existed, and it is the one this
    // rewrite exists to take back.
    if (dir === "") return false;
    return !enumerated.has(dir);
  });
  const owed = [...new Set(trees.standalone.map(treeUnderServices))].sort();
  return [...kept, ...owed.filter((tree) => excludingEntry(kept, tree) === null).map((tree) => `${SERVICES}/${tree}/**`)];
}

/**
 * The service tree an entry names — the part under `services/` — or null when
 * the entry is about something else entirely. `""` is the `services/` root
 * itself.
 *
 * An entry that names no plain directory — a wildcard segment between two
 * literal ones, or the leading doubled star of the `node_modules` glob —
 * answers null: loam cannot say which trees such a line is about, so it is
 * never loam's to rewrite, whatever it happens to cover.
 */
function servicesTreeOf(entry: string): string | null {
  const dir = excludedDirectory(entry);
  if (dir === null) return null;
  if (dir === SERVICES) return "";
  return dir.startsWith(`${SERVICES}/`) ? dir.slice(SERVICES.length + 1) : null;
}

/** A tree path with the `services/` prefix stripped if the caller spelled it — `excludingEntry`'s normalisation, one level down. */
function treeUnderServices(tree: string): string {
  const spelled = tree.split(/[\\/]/).filter((s) => s.length > 0).join("/");
  return spelled.startsWith(`${SERVICES}/`) ? spelled.slice(SERVICES.length + 1) : spelled;
}
