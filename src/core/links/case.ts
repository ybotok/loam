/**
 * Is a path spelled the way it is stored — the half of "does this link resolve"
 * that `existsSync` cannot answer.
 *
 * `[Order](Order.md)` beside a file called `order.md` resolves on Windows and
 * macOS and 404s on GitHub, which renders these documents and is
 * case-sensitive, as is every Linux CI runner. That is the exact shape loam
 * refuses everywhere else: a check that is green on the author's machine and red
 * where the work is actually read. `link.unresolved` shipped without it as a
 * recorded limit; this closes it.
 *
 * THE ANSWER IS A DIRECTORY LISTING, not a filesystem probe, because a probe is
 * what is already wrong: on a case-insensitive volume every spelling of a name
 * stats successfully, so the only place the true spelling exists is the parent's
 * own listing. Each path segment between the docs root and the target is
 * checked against that listing, verbatim.
 *
 * THE INDEX IS PER-INVOCATION AND PASSED, never module-level. A cached listing
 * that outlived one command would answer for a directory that has since
 * changed, and in this repository's forked test processes a module-level memo
 * leaks between fixtures — `AGENTS.md` names that hazard directly. Cost is one
 * `readdir` per distinct directory a link points into, which for a docs repo is
 * a handful.
 */
import { readdirSync } from "node:fs";
import { relative, resolve, sep } from "node:path";

export interface PathCaseIndex {
  /**
   * True when every segment of `target` below `root` is spelled exactly as the
   * filesystem stores it. `target` must already be known to lie inside `root`;
   * this asks only about spelling.
   */
  spelledExactly(root: string, target: string): boolean;
  /**
   * The name `dir` actually stores for `name`, when one differs from it only by
   * case — the hint that turns "resolves to nothing" into "you spelled it
   * `Order.md` and it is stored as `order.md`".
   *
   * Asked on both platforms and not only the case-insensitive one, which is the
   * whole point: on Linux the same link fails `existsSync` outright and on
   * Windows it fails `spelledExactly`, and a diagnosis that differed by
   * operating system would be a machine contract that does not hold.
   */
  storedAs(dir: string, name: string): string | undefined;
}

/** A fresh index. One per command invocation — see the module note on why it is not shared. */
export function pathCaseIndex(): PathCaseIndex {
  const listings = new Map<string, Set<string>>();
  const namesIn = (dir: string): Set<string> => {
    let names = listings.get(dir);
    if (names === undefined) {
      try {
        names = new Set(readdirSync(dir));
      } catch {
        // An unreadable directory answers nothing, and the honest reading is
        // "not disproved": the target stat'ed, so something is there. Refusing
        // a link because its parent denied a listing would convict the author
        // for a permission bit.
        names = new Set<string>();
      }
      listings.set(dir, names);
    }
    return names;
  };

  return {
    spelledExactly(root, target) {
      const rootAbs = resolve(root);
      const rel = relative(rootAbs, resolve(target));
      if (rel === "") return true;
      let dir = rootAbs;
      for (const segment of rel.split(sep)) {
        const names = namesIn(dir);
        // The empty set is the unreadable-directory case above: stop asking
        // rather than convict every segment beneath it.
        if (names.size > 0 && !names.has(segment)) return false;
        dir = resolve(dir, segment);
      }
      return true;
    },
    storedAs(dir, name) {
      const wanted = name.toLowerCase();
      for (const stored of namesIn(resolve(dir))) {
        if (stored !== name && stored.toLowerCase() === wanted) return stored;
      }
      return undefined;
    },
  };
}
