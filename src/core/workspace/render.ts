/**
 * Deterministic `.code-workspace` rendering — pure computation, no printing.
 *
 * The output is a derived file: same members plus same target path must
 * produce the same bytes on every machine, which is why every path is spelled
 * with forward slashes (VS Code and Cursor accept them on Windows too, and
 * they are the one spelling that diffs identically across checkouts) and why
 * the JSON shape follows saveConfig's convention — 2-space indent, trailing
 * newline.
 */
import { dirname, isAbsolute, relative } from "node:path";
import type { WorkspaceMember } from "./discover.js";

/** One folder row, still carrying the member it was derived from. */
export interface RenderedFolder {
  member: WorkspaceMember;
  /** Exactly what lands in the file's `name`. */
  name: string;
  /** Exactly what lands in the file's `path` — the forward-slash spelling. */
  path: string;
}

/**
 * The `path` a folder entry gets, from the already-computed relative and the
 * member's absolute path.
 *
 * Split out of `renderWorkspace` because the fallback decision is win32-only
 * on a win32 host — `relative()` answers a cross-drive pair with the ABSOLUTE
 * target, since no `..` chain crosses drives — and a POSIX test host can
 * therefore never steer the platform `relative()` into producing one. Taking
 * `rel` as data lets the suite exercise the branch with win32-shaped input.
 *
 * The drive-letter test backs up `isAbsolute` because that check is also
 * platform-bound: on POSIX, `D:\other\svc` reads as a relative name. A POSIX
 * directory literally named `D:` would match too and get the absolute
 * spelling instead of the relative one — a stranger workspace file, but a
 * correct one, and the pathological name is not worth a platform fork here.
 */
export function workspacePathSpelling(rel: string, absolute: string): string {
  const spelling = rel === "" ? "." : isAbsolute(rel) || /^[A-Za-z]:[\\/]/.test(rel) ? absolute : rel;
  return spelling.split(/[\\/]/).join("/");
}

/**
 * Render the workspace document for `members`, targeted at `outPath`.
 *
 * Folder paths are relative to the file's own directory, so the committed
 * side-by-side layout opens on every machine that checks it out; a member on
 * another drive keeps its absolute path, because no relative spelling exists.
 * The folders are returned still attached to their members so the command can
 * echo the exact written spelling into its `--json` payload without joining
 * two arrays by position.
 */
export function renderWorkspace(
  members: readonly WorkspaceMember[],
  outPath: string,
): { text: string; folders: RenderedFolder[] } {
  const outDir = dirname(outPath);
  const folders = members.map((member) => ({
    member,
    name: member.name,
    path: workspacePathSpelling(relative(outDir, member.path), member.path),
  }));
  const text =
    JSON.stringify({ folders: folders.map(({ name, path }) => ({ name, path })) }, null, 2) + "\n";
  return { text, folders };
}
