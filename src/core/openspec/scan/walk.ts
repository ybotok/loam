/**
 * Reading the tree: which directories exist, which files are under them, which
 * of them are symlinks, and the digest that binds a mapping to what was audited.
 *
 * Symlinks are enumerated rather than followed. The whole package reads
 * somebody else's repository, so "what is under this directory" has to be a
 * question about THIS workspace — a link out of it is a finding, never a file
 * to walk into.
 */
import { createHash } from "node:crypto";
import { lstat, readFile, readdir, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { parse as parseYaml } from "yaml";
import { asRecord } from "../../kernel/records.js";
import { compareIds } from "../../repo/entries.js";

export async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

export function portable(root: string, path: string): string {
  return relative(root, path).split(sep).join("/");
}

/** Stable inventory namespace: planning-root relative, with one explicit external prefix. */
export function sourceInventoryPath(root: string, absolute: string): string {
  const rel = relative(root, absolute);
  if (rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel))) {
    return rel.split(sep).join("/");
  }
  return `@workspace/${portable(dirname(root), absolute)}`;
}

export async function subdirs(path: string): Promise<string[]> {
  if (!await isDirectory(path)) return [];
  return (await readdir(path, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .sort(compareIds);
}

/**
 * Exactly what `subdirs` drops. walkFiles does not drop it, so a change behind a
 * dot-directory was never enumerated as a change while its files were still
 * classified, counted and given a disposition slot — a decision recorded as
 * selected for an artifact nothing migrates.
 */
export async function hiddenSubdirs(path: string): Promise<string[]> {
  if (!await isDirectory(path)) return [];
  return (await readdir(path, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("."))
    .map((entry) => entry.name)
    .sort(compareIds);
}

export async function walkFiles(path: string): Promise<string[]> {
  if (!await isDirectory(path)) return [];
  const files: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    const entries = (await readdir(dir, { withFileTypes: true }))
      .filter((entry) => entry.name !== ".git")
      .sort((a, b) => compareIds(a.name, b.name));
    for (const entry of entries) {
      const absolute = join(dir, entry.name);
      if (entry.isDirectory()) await walk(absolute);
      else if (entry.isFile()) files.push(absolute);
    }
  };
  await walk(path);
  return files;
}

/** Inventory symbolic links without following them into unbound source trees. */
export async function walkSymlinks(path: string): Promise<string[]> {
  if (!await isDirectory(path)) return [];
  const links: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    const entries = (await readdir(dir, { withFileTypes: true }))
      .filter((entry) => entry.name !== ".git")
      .sort((a, b) => compareIds(a.name, b.name));
    for (const entry of entries) {
      const absolute = join(dir, entry.name);
      if (entry.isSymbolicLink()) links.push(absolute);
      else if (entry.isDirectory()) await walk(absolute);
    }
  };
  await walk(path);
  return links;
}

export async function isSymbolicLink(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isSymbolicLink();
  } catch {
    return false;
  }
}

/**
 * `Array.isArray` narrows an `unknown` to `any[]`, which is how a checked
 * element type went on being asserted back in a line later. Deciding both
 * halves in one predicate makes the narrowing carry the check.
 */
export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export async function yamlRecord(path: string): Promise<Record<string, unknown>> {
  const parsed: unknown = parseYaml(await readFile(path, "utf8"));
  const record = asRecord(parsed);
  if (record === null) throw new Error("expected a YAML mapping");
  return record;
}

export async function digestInventory(root: string, files: string[]): Promise<string> {
  const hash = createHash("sha256");
  // v3 narrowed the covered set to living + active. The version string is what
  // stops a v2 mapping from being accepted against a v3 reading of the same tree.
  hash.update("loam-openspec-inventory-v3\0");
  for (const absolute of [...new Set(files)].sort((a, b) => compareIds(sourceInventoryPath(root, a), sourceInventoryPath(root, b)))) {
    const path = sourceInventoryPath(root, absolute);
    const bytes = await readFile(absolute);
    hash.update(`${path.length}:${path}:${bytes.length}:`);
    hash.update(bytes);
    hash.update("\0");
  }
  return `sha256:${hash.digest("hex")}`;
}
