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
 * A relative file path in the portable spelling — forward slashes, no
 * redundant components. The brand's provenance is `portablePathOf` below: the
 * spelling checks there are the only way to construct one, so a value carrying
 * it has demonstrably passed them. Deliberately thin: it says nothing about
 * containment (that stays `resolveInside`'s question, asked per root), and it
 * is consumed by `resolvePortableInside` below — the one signature that
 * demands it — and every boundary (verify's evidence, unarchive's manifests)
 * reaches it through `resolvePortableFileInside`, the pair's one spelling.
 * The staging manifests keep their plain strings until the writer work that
 * owns those formats re-keys them.
 */
declare const portable: unique symbol;
export type PortablePath = string & { readonly [portable]: true };

/**
 * Snapshot manifests are portable data, so their path spelling is stricter
 * than an interactive path: forward slashes, no redundant components, and a
 * file (not directory) name at the end. The one constructor of `PortablePath`,
 * because these checks are what the brand asserts.
 */
export function portablePathOf(candidate: string, label = "path"): PortablePath {
  if (candidate.includes("\\")) {
    throw new UnsafePathError(candidate, `${label} must use forward slashes`);
  }
  const parts = candidate.split("/");
  if (parts.some((part) => part === "" || part === "." || part === "..")) {
    throw new UnsafePathError(candidate, `${label} must be a canonical relative file path`);
  }
  // The cast, on the line immediately after the checks that earn it.
  return candidate as PortablePath;
}

/**
 * Containment for a path that already EARNED the portable spelling — the one
 * signature that demands the brand, so `PortablePath` has a consumer the
 * compiler checks rather than a comment claiming the order of two calls.
 */
function resolvePortableInside(root: string, portable: PortablePath, label: string): string {
  return resolveInside(root, portable, label);
}

/** The portable spelling checks, then `resolveInside`'s containment proof — the ONE spelling of the pair. */
export function resolvePortableFileInside(root: string, candidate: string, label = "path"): string {
  return resolvePortableInside(root, portablePathOf(candidate, label), label);
}

/**
 * The same portable spelling rules, with containment judged LEXICALLY — for a
 * path that names a file the docs repo itself mounts.
 *
 * Every spelling defence above is kept, and for its reason: a snapshot manifest
 * is loam's own file, but a corrupted or hostile one could carry `..` segments,
 * an absolute path or a `C:\` spelling, and what comes out of this join is a
 * path a caller then goes and reads.
 *
 * What is deliberately not applied is the realpath test. Composing a docs repo
 * out of symlinks — a worktree, a submodule, one service's directory shared
 * between two checkouts — is a supported layout that every walk of the repo
 * FOLLOWS rather than refuses (repo.ts's `entryIs` says so in full), and that
 * `archive` already writes through: its living-document writes are planned from
 * `servicePaths()` and never see this file. With the realpath test in force on
 * the manifest's `path` field, a `services/<svc>/` mounted that way made an
 * interrupted archive permanently unrepairable — the retry was told the
 * snapshot could not be read when it was perfectly intact, and the half-merge it
 * was the only record of could never be repaired.
 *
 * This is only ever safe on a READ. A symlink that leaves the repo is
 * lexically indistinguishable from a service directory the operator mounted on
 * purpose — `escape/owned.txt` and `services/<svc>/spec.md` are both "inside
 * docsDir" until something resolves them — so the realpath test is the only
 * check that can refuse the first, at the price of also refusing the second.
 * A caller that goes on to WRITE through the path must pay that price and use
 * `resolvePortableFileInside`; `unarchive` does, and says so where it does.
 * A caller that only reads a file and compares a digest it never discloses
 * gains nothing from refusing, and loses the operator's ability to repair an
 * interrupted archive.
 */
export function resolvePortableFileInsideLexically(root: string, candidate: string, label = "path"): string {
  if (candidate.length === 0) {
    throw new UnsafePathError(candidate, `${label} must not be empty`);
  }
  if (candidate.includes("\\")) {
    throw new UnsafePathError(candidate, `${label} must use forward slashes`);
  }
  const parts = candidate.split("/");
  if (parts.some((part) => part === "" || part === "." || part === "..")) {
    throw new UnsafePathError(candidate, `${label} must be a canonical relative file path`);
  }
  // win32.isAbsolute is intentional even on POSIX, for the reason `resolveInside`
  // gives: a snapshot travels with its feature directory between operating
  // systems, and `C:\...` must never turn into an innocuous relative filename
  // merely because the question was asked on Linux.
  if (isAbsolute(candidate) || win32.isAbsolute(candidate)) {
    throw new UnsafePathError(candidate, `${label} must be relative to its owning directory`);
  }
  const rootAbs = resolve(root);
  const target = resolve(rootAbs, ...parts);
  // Already implied by the segment test above, and asked anyway: this line is
  // the containment claim itself, so a later loosening of the spelling rules
  // cannot quietly stop making it.
  if (!isPathInside(rootAbs, target)) {
    throw new UnsafePathError(candidate, `${label} resolves outside its owning directory`);
  }
  return target;
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
