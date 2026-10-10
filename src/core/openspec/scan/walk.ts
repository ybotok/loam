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
 * Exactly what `subdirs` drops. walkTree does not drop it, so a change behind a
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

/**
 * Every regular file and every symbolic link under `path`, sorted and
 * depth-first, skipping `.git`. Links are inventoried, never followed into
 * unbound source trees. One walk serves both answers because a link's Dirent
 * is neither a directory nor a file, so recording links separately leaves the
 * file set and the set of directories descended exactly what two walks gave.
 */
export async function walkTree(path: string): Promise<{ files: string[]; links: string[] }> {
  const files: string[] = [];
  const links: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    const entries = (await readdir(dir, { withFileTypes: true }))
      .filter((entry) => entry.name !== ".git")
      .sort((a, b) => compareIds(a.name, b.name));
    for (const entry of entries) {
      const absolute = join(dir, entry.name);
      if (entry.isSymbolicLink()) links.push(absolute);
      else if (entry.isDirectory()) await walk(absolute);
      else if (entry.isFile()) files.push(absolute);
    }
  };
  if (await isDirectory(path)) await walk(path);
  return { files, links };
}

export async function isSymbolicLink(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isSymbolicLink();
  } catch {
    return false;
  }
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
