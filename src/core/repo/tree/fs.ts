/**
 * Directory-entry questions the enumerations share, symlinks followed.
 *
 * Moved here from `repo/repo.ts` when the tree walk arrived: the walk and the
 * feature enumeration must answer "what IS this entry" identically, and the
 * package direction is `repo → repo/tree` (never back — `walk.ts` says why),
 * so the shared spelling lives on this side of the edge.
 */
import { existsSync, statSync, type Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

/**
 * What a directory entry IS, following a symlink to find out.
 *
 * `readdir(withFileTypes)` does not follow symlinks: for a symlink `Dirent`
 * every `isDirectory()`/`isFile()` is false, whatever it points at. That made a
 * symlinked `services/<id>/` or `features/<id>/` vanish from every enumeration
 * at once — `list`, `validate --all`, the fleet gate — with no diagnostic
 * anywhere, which is the one outcome a shared docs repo cannot survive: the
 * fleet gate reported a service that is not there as fine because it never saw
 * it. Composing a docs repo out of symlinks (a worktree, a submodule, one
 * service's directory shared between two checkouts) is legitimate, so they are
 * FOLLOWED rather than refused. A dangling link stats as nothing and is skipped
 * exactly as an absent directory is — it is not a service, and saying so would
 * mean inventing an entry to hang the complaint on.
 */
export function entryIs(dir: string, e: Dirent, want: "dir" | "file"): boolean {
  if (!e.isSymbolicLink()) return want === "dir" ? e.isDirectory() : e.isFile();
  try {
    const s = statSync(join(dir, e.name));
    return want === "dir" ? s.isDirectory() : s.isFile();
  } catch {
    return false;
  }
}

/**
 * Markdown files sitting directly in `dir` — the ADR count, and the only place
 * that rule is spelled. Exported because `show` kept a second copy that tested
 * `Dirent.isFile()` itself: always false for a symlink, whatever it points at,
 * so a docs repo composed of symlinks (the layout `entryIs` above exists to
 * support) had `loam list` and `loam show` reporting different ADR counts for
 * the same service. One rule, one answer.
 */
export async function countMarkdown(dir: string): Promise<number> {
  if (!existsSync(dir)) return 0;
  const entries = await readdir(dir, { withFileTypes: true });
  return entries.filter((e) => e.name.endsWith(".md") && entryIs(dir, e, "file")).length;
}
