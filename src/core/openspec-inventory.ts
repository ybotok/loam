/** Strictly read-only OpenSpec inventory used by `migrate-openspec`. */
import { existsSync } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import { basename, join, relative, resolve, sep } from "node:path";
import { compareIds } from "./repo.js";
import { isRequirementsHeading, parseRequirements, sectionHeadings } from "./spec.js";

export interface OpenSpecCounts {
  specFiles: number;
  requirements: number;
  scenarios: number;
}

export interface OpenSpecCapability extends OpenSpecCounts {
  id: string;
  files: string[];
}

export interface OpenSpecChange extends OpenSpecCounts {
  id: string;
  files: string[];
}

export interface OpenSpecRenamedUsage {
  path: string;
  line: number;
}

export interface OpenSpecUnsupportedShape {
  code: string;
  path: string;
  message: string;
}

export interface CapabilityMappingDecision {
  capability: string;
  service: null;
  suggestedService: string;
  status: "needsMapping";
}

export interface OpenSpecInventory {
  inputRoot: string;
  root: string;
  ready: boolean;
  mechanicallyCompatible: boolean;
  living: OpenSpecCounts & { capabilities: OpenSpecCapability[] };
  changes: {
    active: OpenSpecChange[];
    archived: OpenSpecChange[];
    counts: { active: number; archived: number };
  };
  renamed: OpenSpecRenamedUsage[];
  unsupported: OpenSpecUnsupportedShape[];
  needsMapping: CapabilityMappingDecision[];
}

export class OpenSpecRootError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpenSpecRootError";
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function looksLikeOpenSpec(path: string): Promise<boolean> {
  return existsSync(join(path, "project.md"))
    || existsSync(join(path, ".openspec.yaml"))
    || await isDirectory(join(path, "specs"))
    || await isDirectory(join(path, "changes"));
}

async function locateOpenSpecRoot(input: string): Promise<{ inputRoot: string; root: string }> {
  const inputRoot = resolve(input);
  if (!await isDirectory(inputRoot)) {
    throw new OpenSpecRootError(`OpenSpec root is missing or is not a directory: ${inputRoot}`);
  }
  const nested = join(inputRoot, "openspec");
  if (await looksLikeOpenSpec(nested)) return { inputRoot, root: nested };
  if (await looksLikeOpenSpec(inputRoot)) return { inputRoot, root: inputRoot };
  throw new OpenSpecRootError(
    `No OpenSpec workspace found at ${inputRoot} (expected specs/, changes/, project.md, or openspec/).`,
  );
}

function portable(root: string, path: string): string {
  return relative(root, path).split(sep).join("/");
}

async function subdirs(path: string): Promise<string[]> {
  if (!await isDirectory(path)) return [];
  return (await readdir(path, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .sort(compareIds);
}

async function walkFiles(path: string): Promise<string[]> {
  if (!await isDirectory(path)) return [];
  const files: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    const entries = (await readdir(dir, { withFileTypes: true }))
      .filter((entry) => !entry.name.startsWith("."))
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

function countsFor(requirements: ReturnType<typeof parseRequirements>): Omit<OpenSpecCounts, "specFiles"> {
  return {
    requirements: requirements.length,
    scenarios: requirements.reduce((sum, requirement) => sum + requirement.scenarios.length, 0),
  };
}

function addCounts(target: OpenSpecCounts, source: OpenSpecCounts): void {
  target.specFiles += source.specFiles;
  target.requirements += source.requirements;
  target.scenarios += source.scenarios;
}

function renameUsages(path: string, raw: string): OpenSpecRenamedUsage[] {
  return sectionHeadings(raw)
    .filter((heading) => /^##\s+RENAMED\s+Requirements?\s*:?\s*$/i.test(heading.text))
    .map((heading) => ({ path, line: heading.line }));
}

function inspectLivingShape(
  path: string,
  raw: string,
  unsupported: OpenSpecUnsupportedShape[],
): void {
  const requirements = parseRequirements(raw);
  if (requirements.length === 0) {
    unsupported.push({
      code: "openspec.living-empty",
      path,
      message: "Living spec has no parseable Requirement headings.",
    });
    return;
  }
  const outside = requirements.filter(
    (requirement) => requirement.section === undefined || !isRequirementsHeading(requirement.section),
  );
  if (outside.length > 0) {
    unsupported.push({
      code: "openspec.living-requirements-outside-section",
      path,
      message: `${outside.length} requirement(s) are outside the canonical ## Requirements section.`,
    });
  }
  if (requirements.some((requirement) => requirement.kind !== "BASE")) {
    unsupported.push({
      code: "openspec.living-delta-section",
      path,
      message: "Living spec contains delta-kind requirements.",
    });
  }
}

function inspectChangeShape(
  path: string,
  raw: string,
  unsupported: OpenSpecUnsupportedShape[],
): void {
  const requirements = parseRequirements(raw);
  if (requirements.length === 0) {
    unsupported.push({
      code: "openspec.change-empty",
      path,
      message: "Change spec has no parseable Requirement headings.",
    });
  } else if (requirements.every((requirement) => requirement.kind === "BASE")) {
    unsupported.push({
      code: "openspec.change-without-delta-sections",
      path,
      message: "Change requirements are not under ADDED, MODIFIED, or REMOVED sections.",
    });
  }
}

async function inspectSpecFile(
  root: string,
  absolute: string,
  kind: "living" | "change",
  renamed: OpenSpecRenamedUsage[],
  unsupported: OpenSpecUnsupportedShape[],
): Promise<{ path: string; counts: OpenSpecCounts }> {
  const path = portable(root, absolute);
  const raw = await readFile(absolute, "utf8");
  const requirements = parseRequirements(raw);
  const counts = { specFiles: 1, ...countsFor(requirements) };
  const usages = renameUsages(path, raw);
  renamed.push(...usages);
  for (const usage of usages) {
    unsupported.push({
      code: "openspec.renamed-unsupported",
      path: usage.path,
      message: `RENAMED Requirements at line ${usage.line} needs an explicit loam identity decision.`,
    });
  }
  if (kind === "living") inspectLivingShape(path, raw, unsupported);
  else inspectChangeShape(path, raw, unsupported);
  return { path, counts };
}

async function inventoryChanges(
  root: string,
  base: string,
  ids: string[],
  renamed: OpenSpecRenamedUsage[],
  unsupported: OpenSpecUnsupportedShape[],
): Promise<OpenSpecChange[]> {
  const changes: OpenSpecChange[] = [];
  for (const id of ids) {
    const dir = join(base, id);
    const specRoot = join(dir, "specs");
    const all = await walkFiles(specRoot);
    const specFiles = all.filter((path) => basename(path) === "spec.md");
    const counts: OpenSpecCounts = { specFiles: 0, requirements: 0, scenarios: 0 };
    const files: string[] = [];
    for (const specFile of specFiles) {
      const inspected = await inspectSpecFile(root, specFile, "change", renamed, unsupported);
      files.push(inspected.path);
      addCounts(counts, inspected.counts);
    }
    if (specFiles.length === 0) {
      unsupported.push({
        code: "openspec.change-no-specs",
        path: portable(root, dir),
        message: "Change has no specs/<capability>/spec.md files.",
      });
    }
    for (const file of all.filter((path) => path.endsWith(".md") && basename(path) !== "spec.md")) {
      unsupported.push({
        code: "openspec.nonstandard-change-spec",
        path: portable(root, file),
        message: "Markdown under a change specs/ tree is not named spec.md.",
      });
    }
    changes.push({ id, files, ...counts });
  }
  return changes;
}

export async function inventoryOpenSpec(input: string): Promise<OpenSpecInventory> {
  const { inputRoot, root } = await locateOpenSpecRoot(input);
  const renamed: OpenSpecRenamedUsage[] = [];
  const unsupported: OpenSpecUnsupportedShape[] = [];
  const specsRoot = join(root, "specs");
  const capabilityIds = await subdirs(specsRoot);
  if (!await isDirectory(specsRoot)) {
    unsupported.push({
      code: "openspec.specs-missing",
      path: "specs",
      message: "Living specs/ directory is missing.",
    });
  }

  const capabilities: OpenSpecCapability[] = [];
  const livingCounts: OpenSpecCounts = { specFiles: 0, requirements: 0, scenarios: 0 };
  for (const id of capabilityIds) {
    const dir = join(specsRoot, id);
    const all = await walkFiles(dir);
    const specFiles = all.filter((path) => basename(path) === "spec.md");
    const counts: OpenSpecCounts = { specFiles: 0, requirements: 0, scenarios: 0 };
    const files: string[] = [];
    for (const specFile of specFiles) {
      const inspected = await inspectSpecFile(root, specFile, "living", renamed, unsupported);
      files.push(inspected.path);
      addCounts(counts, inspected.counts);
    }
    if (specFiles.length === 0) {
      unsupported.push({
        code: "openspec.capability-no-spec",
        path: portable(root, dir),
        message: "Capability has no spec.md.",
      });
    }
    capabilities.push({ id, files, ...counts });
    addCounts(livingCounts, counts);
  }

  const changesRoot = join(root, "changes");
  const activeIds = (await subdirs(changesRoot)).filter((id) => id !== "archive");
  const archiveRoot = join(changesRoot, "archive");
  const archivedIds = await subdirs(archiveRoot);
  const active = await inventoryChanges(root, changesRoot, activeIds, renamed, unsupported);
  const archived = await inventoryChanges(root, archiveRoot, archivedIds, renamed, unsupported);

  renamed.sort((a, b) => compareIds(a.path, b.path) || a.line - b.line);
  unsupported.sort((a, b) => compareIds(a.path, b.path) || compareIds(a.code, b.code));
  const mechanicallyCompatible = unsupported.length === 0;
  const needsMapping: CapabilityMappingDecision[] = capabilities.map((capability) => ({
    capability: capability.id,
    service: null,
    suggestedService: capability.id,
    status: "needsMapping",
  }));
  return {
    inputRoot,
    root,
    // Syntax compatibility and migration readiness are separate.  A normal
    // OpenSpec capability still needs an owner/service decision even when its
    // Markdown can be carried over mechanically.
    ready: mechanicallyCompatible && needsMapping.length === 0,
    mechanicallyCompatible,
    living: { ...livingCounts, capabilities },
    changes: {
      active,
      archived,
      counts: { active: active.length, archived: archived.length },
    },
    renamed,
    unsupported,
    needsMapping,
  };
}
