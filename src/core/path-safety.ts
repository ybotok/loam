/**
 * Resolve caller-controlled paths without letting them leave an owned tree.
 *
 * A lexical `relative()` check is not enough: an existing component may be a
 * symlink whose target lives elsewhere. Conversely, checking only the final
 * path misses destinations that do not exist yet but whose nearest existing
 * parent is a symlink. This helper checks both views before a caller reads,
 * writes, walks, or removes anything.
 */
import { lstatSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep, win32 } from "node:path";

export class UnsafePathError extends Error {
  constructor(
    readonly candidate: string,
    message: string,
  ) {
    super(message);
    this.name = "UnsafePathError";
  }
}

/** True when `target` is `root` or one of its descendants. */
export function isPathInside(root: string, target: string): boolean {
  const rel = relative(resolve(root), resolve(target));
  return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`));
}

/**
 * Resolve a relative path beneath `root`, rejecting absolute paths, explicit
 * parent traversal, and symlink escape. The final path may be absent: its
 * nearest existing ancestor is checked in that case.
 */
export function resolveInside(root: string, candidate: string, label = "path"): string {
  if (candidate.length === 0) {
    throw new UnsafePathError(candidate, `${label} must not be empty`);
  }
  // win32.isAbsolute is intentional even on POSIX. Persisted/configured paths
  // may be moved between operating systems, and `C:\\...` must never turn into
  // an innocuous relative filename merely because validation ran on Linux.
  if (isAbsolute(candidate) || win32.isAbsolute(candidate)) {
    throw new UnsafePathError(candidate, `${label} must be relative to its owning directory`);
  }
  if (candidate.split(/[\\/]/).includes("..")) {
    throw new UnsafePathError(candidate, `${label} must not contain '..' path segments`);
  }

  const rootAbs = resolve(root);
  const target = resolve(rootAbs, candidate);
  if (!isPathInside(rootAbs, target)) {
    throw new UnsafePathError(candidate, `${label} resolves outside its owning directory`);
  }

  let rootReal: string;
  let existing: string;
  try {
    rootReal = realpathSync(rootAbs);
    existing = nearestExisting(target, rootAbs);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new UnsafePathError(candidate, `${label} cannot be resolved safely: ${detail}`);
  }

  let existingReal: string;
  try {
    existingReal = realpathSync(existing);
  } catch (err) {
    // A broken symlink is an existing path according to lstat, but realpath
    // cannot prove where a later write through it would land. Refuse it.
    const detail = err instanceof Error ? err.message : String(err);
    throw new UnsafePathError(candidate, `${label} crosses an unreadable or broken symlink: ${detail}`);
  }
  if (!isPathInside(rootReal, existingReal)) {
    throw new UnsafePathError(candidate, `${label} crosses a symlink outside its owning directory`);
  }
  return target;
}

/**
 * Snapshot manifests are portable data, so their path spelling is stricter
 * than an interactive path: forward slashes, no redundant components, and a
 * file (not directory) name at the end.
 */
export function resolvePortableFileInside(root: string, candidate: string, label = "path"): string {
  if (candidate.includes("\\")) {
    throw new UnsafePathError(candidate, `${label} must use forward slashes`);
  }
  const parts = candidate.split("/");
  if (parts.some((part) => part === "" || part === "." || part === "..")) {
    throw new UnsafePathError(candidate, `${label} must be a canonical relative file path`);
  }
  return resolveInside(root, candidate, label);
}

/** Find the closest lexically contained path that exists, including symlinks. */
function nearestExisting(target: string, root: string): string {
  let current = target;
  for (;;) {
    try {
      lstatSync(current);
      return current;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ENOTDIR") throw err;
    }
    if (current === root) return root;
    const parent = dirname(current);
    if (parent === current || !isPathInside(root, parent)) return root;
    current = parent;
  }
}
