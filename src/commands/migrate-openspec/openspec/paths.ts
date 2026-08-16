/**
 * The path arithmetic every write decision in this command rests on.
 *
 * Three rules, kept together because they answer one question in two
 * directions: is a path inside a tree it must stay out of (`contains`), what
 * tree is it really in once symlinks are resolved (`canonicalForCreate`), and
 * does a path claimed by the OpenSpec source stay inside the directory it was
 * listed under (`safeArtifactRelative`). `materialize/stage.ts` builds the
 * staging refusals out of the first two; `openspec/decisions.ts` uses them to
 * keep a mapping skeleton out of the workspace it describes.
 */
import { existsSync } from "node:fs";
import { realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { OpenSpecCommandError } from "./error.js";

export function contains(parent: string, candidate: string): boolean {
  const rel = relative(parent, candidate);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

/** Resolve symlinks in the nearest existing ancestor of a not-yet-created path. */
export async function canonicalForCreate(path: string): Promise<string> {
  let cursor = path;
  const suffix: string[] = [];
  while (!existsSync(cursor)) {
    const parent = dirname(cursor);
    if (parent === cursor) break;
    suffix.unshift(basename(cursor));
    cursor = parent;
  }
  return resolve(await realpath(cursor), ...suffix);
}

export function safeArtifactRelative(artifactPath: string, prefix: string, owner: string): string[] {
  if (!artifactPath.startsWith(prefix)) {
    throw new OpenSpecCommandError(
      "invalid-option",
      `${owner} contains an artifact outside its own directory: ${artifactPath}.`,
    );
  }
  const segments = artifactPath.slice(prefix.length).split("/");
  if (segments.length === 0 || segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new OpenSpecCommandError("invalid-option", `OpenSpec artifact has an unsafe relative path: ${artifactPath}.`);
  }
  return segments;
}
