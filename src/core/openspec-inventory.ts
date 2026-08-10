/** Read-only OpenSpec workspace inventory shared by audit and migration planning. */
import { createHash } from "node:crypto";
import { isUtf8 } from "node:buffer";
import { existsSync } from "node:fs";
import { lstat, readFile, readdir, realpath, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { parse as parseYaml } from "yaml";
import { asRecord, dictionary, ownValue } from "./kernel/records.js";
import { FEATURE_ID_RULE, isFeatureId } from "./kernel/ids.js";
import { compareIds } from "./repo.js";
import {
  isRequirementsHeading,
  parseRequirements,
  REQUIREMENT_ID_RE,
  requirementIdDeclarations,
  requirementIdProblems,
  sectionHeadings,
} from "./document/spec.js";

/** Released behavior and the newer upstream snapshot used as a compatibility canary. */
export const OPENSPEC_BASELINES = Object.freeze({
  release: Object.freeze({
    version: "1.7.0",
    ref: "v1.7.0",
    commit: "4e16790d90d8f54d4773ad9a5e71a57cd9f1e86b",
  }),
  mainCanary: Object.freeze({
    ref: "main",
    commit: "45cca5db6137ed209117cc70510eb3e057fb981b",
  }),
});

export interface OpenSpecCounts {
  specFiles: number;
  requirements: number;
  scenarios: number;
}

export interface OpenSpecCapability extends OpenSpecCounts {
  /** Nested capability ids retain their complete relative directory, e.g. payments/refunds. */
  id: string;
  files: string[];
}

export interface OpenSpecChangeMetadata {
  path: string | null;
  schema: string | null;
  skipSpecs: boolean;
  created: string | null;
  fields: string[];
}

export interface OpenSpecChangeSpec extends OpenSpecCounts {
  capability: string;
  path: string;
  requirementNames: string[];
}

export interface OpenSpecChange extends OpenSpecCounts {
  id: string;
  files: string[];
  specs: OpenSpecChangeSpec[];
  artifacts: string[];
  metadata: OpenSpecChangeMetadata;
}

export type OpenSpecIssueScope = "workspace" | "living" | "active" | "archive";

export interface OpenSpecRenamedUsage {
  /** Stable key used by the mapping file. */
  key: string;
  path: string;
  line: number;
  scope: "active" | "archive";
  changeId: string;
  capability: string;
  from: string | null;
  to: string | null;
  existingRequirementId: string | null;
  requirementId: string | null;
  status: "needsIdentity" | "mapped";
}

export interface OpenSpecUnsupportedShape {
  code: string;
  path: string;
  message: string;
  scope: OpenSpecIssueScope;
}

export interface CapabilityMappingDecision {
  capability: string;
  /** Backward-compatible convenience for consumers that only understand one owner. */
  service: string | null;
  /** One capability may need to be split across multiple loam services. */
  services: string[];
  /** Required only when a capability is split across more than one service. */
  requirementServices: Record<string, string[]>;
  suggestedService: string;
  hasLivingSpec: boolean;
  activeChanges: string[];
  status: "needsMapping" | "mapped";
}

export interface OpenSpecCapabilityMapping {
  services: string[];
  requirementServices: Record<string, string[]>;
}

export interface OpenSpecChangeMapping {
  feature: string | null;
  title: string;
}

export interface OpenSpecChangeDecision {
  change: string;
  feature: string | null;
  title: string;
  suggestedFeature: string;
  suggestedTitle: string;
  status: "needsFeature" | "mapped";
}

export interface OpenSpecMapping {
  source: { root: string; inventoryDigest: string } | null;
  capabilities: Record<string, OpenSpecCapabilityMapping>;
  changes: Record<string, OpenSpecChangeMapping>;
  renames: Record<string, string>;
  /**
   * Whatever a human wrote, not what the type wishes they had written. Declaring
   * this as the disposition union meant the parser had to assert its way into
   * it, so an unrecognised disposition arrived typed as a valid one and only
   * `mapping.invalid-artifact-disposition` — a check downstream of the parse —
   * stood between it and code comparing it against a literal. The union is
   * recovered where it is needed, through `isOpenSpecArtifactDisposition`.
   */
  artifacts: Record<string, string>;
}

export interface OpenSpecMappingIssue {
  code:
    | "mapping.source-missing"
    | "mapping.source-root-mismatch"
    | "mapping.source-digest-mismatch"
    | "mapping.unknown-capability"
    | "mapping.unknown-requirement"
    | "mapping.requirement-allocation-missing"
    | "mapping.requirement-service-unknown"
    | "mapping.service-allocation-empty"
    | "mapping.unknown-change"
    | "mapping.change-title-missing"
    | "mapping.feature-id-invalid"
    | "mapping.feature-id-duplicate"
    | "mapping.unknown-rename"
    | "mapping.invalid-requirement-id"
    | "mapping.rename-source-missing"
    | "mapping.rename-source-ambiguous"
    | "mapping.rename-source-id-invalid"
    | "mapping.rename-target-conflict"
    | "mapping.rename-existing-id-conflict"
    | "mapping.rename-id-conflict"
    | "mapping.rename-double-source"
    | "mapping.rename-double-target"
    | "mapping.rename-chain"
    | "mapping.unknown-artifact"
    | "mapping.invalid-artifact-disposition";
  key: string;
  message: string;
}

export type OpenSpecArtifactScope = "workspace" | "living" | "active" | "archive";
export type OpenSpecArtifactKind =
  | "config"
  | "store-metadata"
  | "project-context"
  | "agent-instructions"
  | "living-spec"
  | "living-design"
  | "change-metadata"
  | "proposal"
  | "tasks"
  | "change-design"
  | "delta-spec"
  | "custom-schema"
  | "schema-template"
  | "other";
/**
 * The dispositions as values, not only as a type, because a mapping file names
 * one as a plain string and the parse boundary has to be able to ask whether
 * that string is one of these. A hand-written second spelling of the same list
 * is how a disposition added here would go on being unrecognised where it is
 * read from somebody else's YAML.
 */
export const OPENSPEC_ARTIFACT_DISPOSITIONS = [
  "translate-project-context",
  "record-external-planning-root",
  "remove-after-cutover",
  "map-requirements",
  "review-as-service-adr",
  "translate-change-metadata",
  "convert-to-intent",
  "preserve-as-legacy-checklist",
  "review-as-feature-adr",
  "map-delta",
  "review-custom-workflow",
  "retain-read-only",
  "manual-review",
] as const;
export type OpenSpecArtifactDisposition = (typeof OPENSPEC_ARTIFACT_DISPOSITIONS)[number];

/** Whether an authored string names a disposition this codebase actually defines. */
export function isOpenSpecArtifactDisposition(value: string): value is OpenSpecArtifactDisposition {
  return (OPENSPEC_ARTIFACT_DISPOSITIONS as readonly string[]).includes(value);
}

export interface OpenSpecArtifact {
  /** Workspace-relative, so store metadata outside openspec/ remains representable. */
  path: string;
  scope: OpenSpecArtifactScope;
  kind: OpenSpecArtifactKind;
  disposition: OpenSpecArtifactDisposition;
  changeId?: string;
  capability?: string;
}

export interface OpenSpecArtifactDecision {
  path: string;
  kind: "proposal" | "tasks" | "change-design";
  suggestedDisposition: OpenSpecArtifactDisposition;
  /**
   * What the mapping selected, verbatim. This is the field the invalid-value
   * report is written from, so it has to be able to hold the invalid value —
   * narrowing it to the union would only mean asserting one back into it.
   */
  disposition: string | null;
  status: "needsDisposition" | "mapped";
}

export interface OpenSpecConfigSummary {
  path: string;
  schema: string | null;
  store: string | null;
  hasContext: boolean;
  ruleArtifacts: string[];
  references: string[];
}

export interface OpenSpecInventory {
  baselines: typeof OPENSPEC_BASELINES;
  inputRoot: string;
  root: string;
  /** SHA-256 over every inventoried OpenSpec source path and byte sequence. */
  inventoryDigest: string;
  workspace: {
    kind: "project" | "store" | "openspec-root";
    config: OpenSpecConfigSummary | null;
    storeMetadataPath: string | null;
  };
  ready: boolean;
  mechanicallyCompatible: boolean;
  readiness: {
    living: { compatible: boolean; issueCount: number };
    active: { compatible: boolean; issueCount: number };
    sourceCurrent: boolean;
    mappingsResolved: boolean;
    changesResolved: boolean;
    renamesResolved: boolean;
    dispositionsResolved: boolean;
    migrationReady: boolean;
  };
  living: OpenSpecCounts & { capabilities: OpenSpecCapability[] };
  changes: {
    active: OpenSpecChange[];
    archived: OpenSpecChange[];
    counts: { active: number; archived: number };
  };
  renamed: OpenSpecRenamedUsage[];
  /** Living/active blockers only. Frozen archive history never blocks migration readiness. */
  unsupported: OpenSpecUnsupportedShape[];
  /** Historical anomalies are retained for review, but are not migration blockers. */
  archiveDiagnostics: OpenSpecUnsupportedShape[];
  mappingDecisions: CapabilityMappingDecision[];
  needsMapping: CapabilityMappingDecision[];
  changeDecisions: OpenSpecChangeDecision[];
  needsChangeMapping: OpenSpecChangeDecision[];
  mappingIssues: OpenSpecMappingIssue[];
  artifacts: OpenSpecArtifact[];
  artifactDecisions: OpenSpecArtifactDecision[];
  needsDisposition: OpenSpecArtifactDecision[];
}

export interface OpenSpecMappingSkeleton {
  version: 1;
  source: { root: string; inventoryDigest: string };
  capabilities: Record<string, {
    services: string[];
    suggestedServices: string[];
    requirementServices: Record<string, string[]>;
  }>;
  changes: Record<string, {
    feature: null;
    suggestedFeature: string;
    title: string;
  }>;
  renames: Record<string, {
    from: string | null;
    to: string | null;
    existingRequirementId: string | null;
    requirementId: string | null;
  }>;
  artifacts: Record<string, {
    kind: "proposal" | "tasks" | "change-design";
    disposition: null;
    suggestedDisposition: OpenSpecArtifactDisposition;
  }>;
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
  return existsSync(join(path, "config.yaml"))
    || existsSync(join(path, "project.md"))
    || existsSync(join(path, ".openspec.yaml"))
    || await isDirectory(join(path, "specs"))
    || await isDirectory(join(path, "changes"));
}

async function locateOpenSpecRoot(
  input: string,
): Promise<{ inputRoot: string; root: string; kind: "project" | "store" | "openspec-root" }> {
  const requestedRoot = resolve(input);
  if (!await isDirectory(requestedRoot)) {
    throw new OpenSpecRootError(`OpenSpec root is missing or is not a directory: ${requestedRoot}`);
  }
  const inputRoot = await realpath(requestedRoot);
  const nested = join(inputRoot, "openspec");
  const storeMarker = join(inputRoot, ".openspec-store", "store.yaml");
  const hasNestedShape = await looksLikeOpenSpec(nested);
  const hasDirectShape = await looksLikeOpenSpec(inputRoot);
  if (hasNestedShape && hasDirectShape) {
    throw new OpenSpecRootError(
      `Ambiguous OpenSpec root ${inputRoot}: both the directory itself and ${nested} contain OpenSpec planning shapes. Pass the intended root explicitly.`,
    );
  }
  if (hasNestedShape) {
    await assertPlanningRootNotLinked(nested);
    return { inputRoot, root: nested, kind: existsSync(storeMarker) ? "store" : "project" };
  }
  // The shape decides the root, the Store marker only decides the kind. Deciding
  // "store" first sent `root` to <store>/openspec for a checkout that keeps its
  // planning shape at the checkout root: a directory that does not exist reads
  // as an empty, fully compatible workspace, and apply then stages nothing.
  if (hasDirectShape) {
    const parentStoreMarker = basename(inputRoot) === "openspec"
      ? join(dirname(inputRoot), ".openspec-store", "store.yaml")
      : "";
    const store = existsSync(storeMarker) || (parentStoreMarker !== "" && existsSync(parentStoreMarker));
    return { inputRoot, root: inputRoot, kind: store ? "store" : "openspec-root" };
  }
  // OpenSpec stores may omit empty planning directories. Keep their canonical
  // future root at <store>/openspec so paths do not change after the first spec
  // — but only when that directory is really there. Auditing a root that does
  // not exist is how a Store checkout came back `ready` over invisible content.
  if (existsSync(storeMarker)) {
    await assertPlanningRootNotLinked(nested);
    if (!await isDirectory(nested)) {
      throw new OpenSpecRootError(
        `Store checkout ${inputRoot} has no OpenSpec planning content: neither ${nested} nor config.yaml, project.md, specs/ or changes/ at the checkout root.`,
      );
    }
    return { inputRoot, root: nested, kind: "store" };
  }
  throw new OpenSpecRootError(
    `No OpenSpec workspace found at ${inputRoot} (expected openspec/config.yaml, specs/, changes/, project.md, or .openspec-store/store.yaml).`,
  );
}

async function assertPlanningRootNotLinked(path: string): Promise<void> {
  if (await isSymbolicLink(path)) {
    throw new OpenSpecRootError(
      `OpenSpec planning root must not be a symbolic link: ${path}. Pass the canonical planning directory explicitly.`,
    );
  }
}

function portable(root: string, path: string): string {
  return relative(root, path).split(sep).join("/");
}

/** Stable inventory namespace: planning-root relative, with one explicit external prefix. */
function sourceInventoryPath(root: string, absolute: string): string {
  const rel = relative(root, absolute);
  if (rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel))) {
    return rel.split(sep).join("/");
  }
  return `@workspace/${portable(dirname(root), absolute)}`;
}

async function subdirs(path: string): Promise<string[]> {
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
async function hiddenSubdirs(path: string): Promise<string[]> {
  if (!await isDirectory(path)) return [];
  return (await readdir(path, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("."))
    .map((entry) => entry.name)
    .sort(compareIds);
}

async function walkFiles(path: string): Promise<string[]> {
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
async function walkSymlinks(path: string): Promise<string[]> {
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

async function isSymbolicLink(path: string): Promise<boolean> {
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
function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

async function yamlRecord(path: string): Promise<Record<string, unknown>> {
  const parsed: unknown = parseYaml(await readFile(path, "utf8"));
  const record = asRecord(parsed);
  if (record === null) throw new Error("expected a YAML mapping");
  return record;
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

function cleanRenameName(value: string): string {
  return value
    .trim()
    .replace(/^`|`$/g, "")
    .replace(/^###\s+Requirement:\s*/i, "")
    .trim();
}

function changeSpecCoordinates(
  path: string,
  scope: "active" | "archive",
): { changeId: string; capability: string } {
  const prefix = scope === "active" ? /^changes\/([^/]+)\/specs\/(.+)\/spec\.md$/ : /^changes\/archive\/([^/]+)\/specs\/(.+)\/spec\.md$/;
  const match = prefix.exec(path);
  return { changeId: match?.[1] ?? "", capability: match?.[2] ?? "" };
}

/**
 * Which lines are fenced content, marker included \u2014 the same rule
 * `parseRequirements` and `sectionHeadings` apply, which spec.ts keeps private.
 * Without it a FROM/TO line inside a fenced example of the rename syntax became
 * a phantom pair, and the only cure was editing the OpenSpec source migration
 * promises never to touch.
 */
function fencedLines(lines: string[]): boolean[] {
  let fence: string | null = null;
  return lines.map((line) => {
    const marker = /^\s*(```|~~~)/.exec(line);
    if (marker === null) return fence !== null;
    if (fence === null) fence = marker[1]!;
    else if (fence === marker[1]!) fence = null;
    return true;
  });
}

function renameUsages(
  path: string,
  raw: string,
  scope: "active" | "archive",
  mapped: Record<string, string>,
): OpenSpecRenamedUsage[] {
  const lines = raw.replace(/^\uFEFF/, "").split(/\r?\n/);
  const fenced = fencedLines(lines);
  const headings = sectionHeadings(raw);
  const coordinates = changeSpecCoordinates(path, scope);
  const output: OpenSpecRenamedUsage[] = [];
  for (const [headingIndex, heading] of headings.entries()) {
    if (!/^##\s+RENAMED\s+Requirements?\s*:?\s*$/i.test(heading.text)) continue;
    const end = headings[headingIndex + 1]?.line ?? lines.length + 1;
    const pairs: Array<{ from: string | null; to: string | null }> = [];
    let pendingFrom: string | null = null;
    for (let line = heading.line; line < end - 1; line += 1) {
      if (fenced[line] === true) continue;
      const text = lines[line] ?? "";
      const from = /^\s*-\s*FROM:\s*(.*?)\s*$/i.exec(text);
      if (from !== null) {
        if (pendingFrom !== null) pairs.push({ from: pendingFrom, to: null });
        pendingFrom = cleanRenameName(from[1] ?? "");
        continue;
      }
      const to = /^\s*-\s*TO:\s*(.*?)\s*$/i.exec(text);
      if (to !== null) {
        pairs.push({ from: pendingFrom, to: cleanRenameName(to[1] ?? "") });
        pendingFrom = null;
      }
    }
    if (pendingFrom !== null) pairs.push({ from: pendingFrom, to: null });
    if (pairs.length === 0) pairs.push({ from: null, to: null });
    pairs.forEach((pair, pairIndex) => {
      const key = `${path}:${heading.line}:${pairIndex + 1}`;
      const requirementId = ownValue(mapped, key) ?? null;
      output.push({
        key,
        path,
        line: heading.line,
        scope,
        changeId: coordinates.changeId,
        capability: coordinates.capability,
        from: pair.from,
        to: pair.to,
        existingRequirementId: null,
        requirementId,
        status: requirementId === null ? "needsIdentity" : "mapped",
      });
    });
  }
  return output;
}

function issue(
  target: OpenSpecUnsupportedShape[],
  scope: OpenSpecIssueScope,
  code: string,
  path: string,
  message: string,
): void {
  target.push({ code, path, message, scope });
}

function inspectLivingShape(
  path: string,
  raw: string,
  unsupported: OpenSpecUnsupportedShape[],
): void {
  const requirements = parseRequirements(raw);
  if (requirements.length === 0) {
    issue(unsupported, "living", "openspec.living-empty", path, "Living spec has no parseable Requirement headings.");
    return;
  }
  const outside = requirements.filter(
    (requirement) => requirement.section === undefined || !isRequirementsHeading(requirement.section),
  );
  if (outside.length > 0) {
    issue(
      unsupported,
      "living",
      "openspec.living-requirements-outside-section",
      path,
      `${outside.length} requirement(s) are outside the canonical ## Requirements section.`,
    );
  }
  if (requirements.some((requirement) => requirement.kind !== "BASE")) {
    issue(unsupported, "living", "openspec.living-delta-section", path, "Living spec contains delta-kind requirements.");
  }
}

function inspectChangeShape(
  path: string,
  raw: string,
  scope: "active" | "archive",
  renames: OpenSpecRenamedUsage[],
  unsupported: OpenSpecUnsupportedShape[],
): void {
  const requirements = parseRequirements(raw);
  const fileRenames = renames.filter((rename) => rename.path === path);
  for (const rename of fileRenames) {
    if (rename.from === null || rename.from === "" || rename.to === null || rename.to === "") {
      issue(
        unsupported,
        scope,
        "openspec.renamed-malformed",
        path,
        `RENAMED Requirements at line ${rename.line} must contain a FROM/TO pair.`,
      );
    }
  }
  if (requirements.length === 0) {
    // A well-formed rename-only delta is meaningful even though the requirement
    // parser correctly returns no requirement blocks for it.
    if (fileRenames.length === 0) {
      issue(unsupported, scope, "openspec.change-empty", path, "Change spec has no parseable Requirement headings.");
    }
    return;
  }
  // `## Requirements` is the heading OpenSpec's own living-spec template
  // mandates, so this is the shape a team produces by copying a living spec into
  // a change directory. It parses, it is counted, and nothing routes it: only
  // delta-kind requirements reach the staged feature. Blocking is what keeps the
  // per-change counters and what actually lands the same number.
  const quoted = requirements.filter(
    (requirement) => requirement.kind === "BASE"
      && requirement.section !== undefined
      && isRequirementsHeading(requirement.section),
  );
  if (quoted.length > 0) {
    unsupported.push({
      code: "openspec.change-quoted-requirements",
      path,
      message: `${quoted.length} requirement(s) sit under ## Requirements in a change delta, which stages nothing; re-home them under ADDED, MODIFIED, or REMOVED.`,
      scope,
    });
  }
  const stranded = requirements.filter(
    (requirement) => requirement.kind === "BASE"
      && (requirement.section === undefined || !isRequirementsHeading(requirement.section)),
  );
  if (stranded.length === requirements.length) {
    issue(
      unsupported,
      scope,
      "openspec.change-without-delta-sections",
      path,
      "Change requirements are not under ADDED, MODIFIED, REMOVED, or the explicitly non-merging ## Requirements section.",
    );
  } else if (stranded.length > 0) {
    issue(
      unsupported,
      scope,
      "openspec.change-requirements-outside-delta-sections",
      path,
      `${stranded.length} requirement(s) would be stranded outside delta sections.`,
    );
  }
}

/**
 * The parsed requirements come back with the counts because both callers wanted
 * them and each opened the file a second time to get its own copy — two reads
 * of the same bytes per spec.md, and two readings of it: the counts came from
 * this parse while the requirement names, and the living corpus every rename is
 * resolved against, came from the other. A file edited mid-audit could be
 * counted from one of them and routed from the other.
 */
async function inspectSpecFile(
  root: string,
  absolute: string,
  kind: "living" | "change",
  scope: "active" | "archive" | null,
  mapping: OpenSpecMapping,
  renamed: OpenSpecRenamedUsage[],
  unsupported: OpenSpecUnsupportedShape[],
): Promise<{ path: string; counts: OpenSpecCounts; requirements: ReturnType<typeof parseRequirements> }> {
  const path = portable(root, absolute);
  const raw = await readFile(absolute, "utf8");
  const requirements = parseRequirements(raw);
  const counts = { specFiles: 1, ...countsFor(requirements) };
  const issueScope = kind === "living" ? "living" : scope ?? "active";
  for (const problem of requirementIdProblems(requirements)) {
    if (problem.kind === "invalid") {
      issue(
        unsupported,
        issueScope,
        "openspec.requirement-id-invalid",
        path,
        `Requirement '${problem.requirement}' has invalid Requirement-ID '${problem.value}'; use [A-Za-z][A-Za-z0-9._-]{0,127}.`,
      );
    } else if (problem.kind === "repeated") {
      issue(
        unsupported,
        issueScope,
        "openspec.requirement-id-repeated",
        path,
        `Requirement '${problem.requirement}' declares Requirement-ID ${problem.values.length} times; keep exactly one identity line.`,
      );
    } else {
      issue(
        unsupported,
        issueScope,
        "openspec.requirement-id-duplicate",
        path,
        `Requirement-ID '${problem.id}' is shared by ${problem.requirements.map((name) => `'${name}'`).join(", ")}.`,
      );
    }
  }
  if (kind === "living") {
    inspectLivingShape(path, raw, unsupported);
  } else {
    const changeScope = scope ?? "active";
    const usages = renameUsages(path, raw, changeScope, mapping.renames);
    renamed.push(...usages);
    inspectChangeShape(path, raw, changeScope, usages, unsupported);
  }
  return { path, counts, requirements };
}

async function inspectConfig(
  root: string,
  unsupported: OpenSpecUnsupportedShape[],
): Promise<OpenSpecConfigSummary | null> {
  const path = join(root, "config.yaml");
  if (!existsSync(path)) return null;
  if (await isSymbolicLink(path)) return null;
  try {
    const config = await yamlRecord(path);
    const rules = asRecord(config.rules);
    return {
      path: "config.yaml",
      schema: typeof config.schema === "string" ? config.schema : null,
      store: typeof config.store === "string" ? config.store : null,
      hasContext: typeof config.context === "string" && config.context.trim() !== "",
      ruleArtifacts: rules === null ? [] : Object.keys(rules).sort(compareIds),
      references: Array.isArray(config.references)
        ? config.references.filter((item): item is string => typeof item === "string").sort(compareIds)
        : [],
    };
  } catch (error) {
    issue(
      unsupported,
      "workspace",
      "openspec.config-invalid",
      "config.yaml",
      `OpenSpec config.yaml is invalid: ${error instanceof Error ? error.message : String(error)}`,
    );
    return {
      path: "config.yaml",
      schema: null,
      store: null,
      hasContext: false,
      ruleArtifacts: [],
      references: [],
    };
  }
}

/**
 * A calendar date, optionally with a time. OpenSpec's template writes the plain
 * date, but a timestamp is still a date — and rejecting it blocked every change
 * and every capability in the workspace over one field nobody reads, fixable
 * only by editing the source migration promises not to touch.
 */
const CHANGE_CREATED_RE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

async function inspectChangeMetadata(
  root: string,
  dir: string,
  scope: "active" | "archive",
  fallbackSchema: string | null,
  unsupported: OpenSpecUnsupportedShape[],
): Promise<OpenSpecChangeMetadata> {
  const absolute = join(dir, ".openspec.yaml");
  if (!existsSync(absolute)) {
    return { path: null, schema: fallbackSchema, skipSpecs: false, created: null, fields: [] };
  }
  const path = portable(root, absolute);
  if (await isSymbolicLink(absolute)) {
    return { path, schema: fallbackSchema, skipSpecs: false, created: null, fields: [] };
  }
  try {
    const metadata = await yamlRecord(absolute);
    let valid = true;
    const invalid = (message: string): void => {
      valid = false;
      issue(unsupported, scope, "openspec.change-metadata-invalid", path, message);
    };
    const schema = typeof metadata.schema === "string" && metadata.schema.trim() !== ""
      ? metadata.schema.trim()
      : null;
    if (schema === null) {
      invalid(
        "Present .openspec.yaml metadata requires a non-empty string schema; fallback applies only when the file is absent.",
      );
    }
    if ("skip_specs" in metadata && typeof metadata.skip_specs !== "boolean") {
      invalid("skip_specs must be a boolean when present.");
    }
    if ("created" in metadata
      && (typeof metadata.created !== "string" || !CHANGE_CREATED_RE.test(metadata.created))) {
      invalid("created must be a string date in YYYY-MM-DD or ISO-8601 date-time form when present.");
    }
    if ("goal" in metadata && (typeof metadata.goal !== "string" || metadata.goal.length === 0)) {
      invalid("goal must be a non-empty string when present.");
    }
    if ("affected_areas" in metadata
      && (!isStringArray(metadata.affected_areas)
        || metadata.affected_areas.some((value) => value.length === 0))) {
      invalid("affected_areas must be an array of non-empty strings when present.");
    }
    if ("initiative" in metadata) {
      const initiative = asRecord(metadata.initiative);
      const keys = initiative === null ? [] : Object.keys(initiative).sort(compareIds);
      const kebabId = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
      if (initiative === null
        || keys.length !== 2
        || keys[0] !== "id"
        || keys[1] !== "store"
        || typeof initiative.id !== "string"
        || !kebabId.test(initiative.id)
        || typeof initiative.store !== "string"
        || !kebabId.test(initiative.store)) {
        invalid("initiative must be exactly { store, id }, with both values portable kebab-case identifiers.");
      }
    }
    return {
      path,
      schema,
      skipSpecs: valid && schema !== null && metadata.skip_specs === true,
      created: typeof metadata.created === "string" && CHANGE_CREATED_RE.test(metadata.created)
        ? metadata.created
        : null,
      fields: Object.keys(metadata).sort(compareIds),
    };
  } catch (error) {
    issue(
      unsupported,
      scope,
      "openspec.change-metadata-invalid",
      path,
      `Change metadata is invalid: ${error instanceof Error ? error.message : String(error)}`,
    );
    return { path, schema: fallbackSchema, skipSpecs: false, created: null, fields: [] };
  }
}

function isContainedPath(parent: string, candidate: string): boolean {
  const rel = relative(parent, candidate);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

/**
 * Resolve only a schema that OpenSpec could enumerate as one direct, portable
 * member of this workspace's schemas/ directory. Constructing a path from the
 * metadata value first would let `../` (or a platform-specific separator) read
 * bytes outside the inventoried tree and then authorize `skip_specs` with them.
 */
async function registeredProjectSchemaPath(
  root: string,
  schema: string,
): Promise<{ registered: boolean; path: string | null }> {
  const windowsStem = schema.split(".")[0]!.toUpperCase();
  const windowsReserved = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/.test(windowsStem);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(schema)
    || schema === "."
    || schema === ".."
    || schema.endsWith(".")
    || windowsReserved) {
    return { registered: false, path: null };
  }

  const schemasRoot = join(root, "schemas");
  try {
    const schemasStat = await lstat(schemasRoot);
    if (!schemasStat.isDirectory() || schemasStat.isSymbolicLink()) return { registered: false, path: null };
    const entries = await readdir(schemasRoot, { withFileTypes: true });
    const registered = entries.find((entry) => entry.name === schema);
    if (registered === undefined) return { registered: false, path: null };
    if (!registered.isDirectory() || registered.isSymbolicLink()) return { registered: true, path: null };

    const schemaDir = join(schemasRoot, registered.name);
    const schemaFile = join(schemaDir, "schema.yaml");
    const [schemaDirStat, schemaFileStat] = await Promise.all([lstat(schemaDir), lstat(schemaFile)]);
    if (!schemaDirStat.isDirectory() || schemaDirStat.isSymbolicLink()
      || !schemaFileStat.isFile() || schemaFileStat.isSymbolicLink()) {
      return { registered: true, path: null };
    }

    const [canonicalRoot, canonicalSchemasRoot, canonicalSchemaDir, canonicalSchemaFile] = await Promise.all([
      realpath(root),
      realpath(schemasRoot),
      realpath(schemaDir),
      realpath(schemaFile),
    ]);
    if (!isContainedPath(canonicalRoot, canonicalSchemasRoot)
      || !isContainedPath(canonicalSchemasRoot, canonicalSchemaDir)
      || !isContainedPath(canonicalSchemaDir, canonicalSchemaFile)) {
      return { registered: true, path: null };
    }
    return { registered: true, path: schemaFile };
  } catch {
    return { registered: false, path: null };
  }
}

function validArtifactSchema(document: Record<string, unknown>): boolean {
  if (typeof document.name !== "string" || document.name.length === 0
    || typeof document.version !== "number"
    || !Number.isInteger(document.version)
    || document.version <= 0
    || ("description" in document && typeof document.description !== "string")
    || !Array.isArray(document.artifacts)
    || document.artifacts.length === 0) {
    return false;
  }

  const artifacts: Array<{ id: string; requires: string[] }> = [];
  for (const value of document.artifacts) {
    const artifact = asRecord(value);
    if (artifact === null
      || typeof artifact.id !== "string"
      || artifact.id.length === 0
      || typeof artifact.generates !== "string"
      || artifact.generates.length === 0
      || typeof artifact.description !== "string"
      || typeof artifact.template !== "string"
      || artifact.template.length === 0
      || ("instruction" in artifact && typeof artifact.instruction !== "string")
      || ("requires" in artifact && !isStringArray(artifact.requires))) {
      return false;
    }
    artifacts.push({
      id: artifact.id,
      requires: isStringArray(artifact.requires) ? artifact.requires : [],
    });
  }

  if ("apply" in document) {
    const apply = asRecord(document.apply);
    if (apply === null
      || !isStringArray(apply.requires)
      || apply.requires.length === 0
      || ("tracks" in apply && apply.tracks !== null && typeof apply.tracks !== "string")
      || ("instruction" in apply && typeof apply.instruction !== "string")) {
      return false;
    }
  }

  const ids = new Set<string>();
  for (const artifact of artifacts) {
    if (ids.has(artifact.id)) return false;
    ids.add(artifact.id);
  }
  if (artifacts.some((artifact) => artifact.requires.some((dependency) => !ids.has(dependency)))) return false;

  const byId = new Map(artifacts.map((artifact) => [artifact.id, artifact]));
  const complete = new Set<string>();
  const visiting = new Set<string>();
  const visit = (id: string): boolean => {
    if (complete.has(id)) return true;
    if (visiting.has(id)) return false;
    visiting.add(id);
    for (const dependency of byId.get(id)?.requires ?? []) {
      if (!visit(dependency)) return false;
    }
    visiting.delete(id);
    complete.add(id);
    return true;
  };
  return artifacts.every((artifact) => visit(artifact.id));
}

async function schemaSpecPolicy(
  root: string,
  schema: string | null,
): Promise<{ resolved: boolean }> {
  if (schema === null) return { resolved: false };
  const projectSchema = await registeredProjectSchemaPath(root, schema);
  // A project-local entry shadows the known built-in, but migration refuses
  // unsafe/symlinked entries instead of following them outside the inventory.
  if (!projectSchema.registered) return { resolved: schema === "spec-driven" };
  if (projectSchema.path === null) return { resolved: false };
  try {
    const document = await yamlRecord(projectSchema.path);
    return { resolved: validArtifactSchema(document) };
  } catch {
    return { resolved: false };
  }
}

async function inventoryChanges(
  root: string,
  base: string,
  ids: string[],
  scope: "active" | "archive",
  fallbackSchema: string | null,
  mapping: OpenSpecMapping,
  renamed: OpenSpecRenamedUsage[],
  unsupported: OpenSpecUnsupportedShape[],
): Promise<OpenSpecChange[]> {
  const changes: OpenSpecChange[] = [];
  for (const id of ids) {
    const dir = join(base, id);
    const allArtifacts = await walkFiles(dir);
    const specRoot = join(dir, "specs");
    const allSpecs = await walkFiles(specRoot);
    const specFiles = allSpecs.filter((path) => basename(path) === "spec.md");
    const metadata = await inspectChangeMetadata(root, dir, scope, fallbackSchema, unsupported);
    const counts: OpenSpecCounts = { specFiles: 0, requirements: 0, scenarios: 0 };
    const files: string[] = [];
    const specs: OpenSpecChangeSpec[] = [];
    for (const specFile of specFiles) {
      const inspected = await inspectSpecFile(root, specFile, "change", scope, mapping, renamed, unsupported);
      files.push(inspected.path);
      specs.push({
        capability: portable(specRoot, dirname(specFile)),
        path: inspected.path,
        requirementNames: [...new Set(
          inspected.requirements.filter((item) => item.kind !== "BASE").map((item) => item.name),
        )].sort(compareIds),
        ...inspected.counts,
      });
      addCounts(counts, inspected.counts);
    }
    const schemaPolicy = await schemaSpecPolicy(root, metadata.schema);
    if (!schemaPolicy.resolved) {
      issue(
        unsupported,
        scope,
        "openspec.change-schema-unresolved",
        metadata.path ?? portable(root, dir),
        `Change schema '${metadata.schema ?? "<missing>"}' cannot be resolved to a readable built-in or project schema.`,
      );
    }
    if (metadata.skipSpecs && allSpecs.length > 0) {
      issue(
        unsupported,
        scope,
        "openspec.skip-specs-with-specs",
        portable(root, specRoot),
        "skip_specs: true conflicts with authored content under specs/; remove the marker or review and remove the spec tree.",
      );
    }
    const permitsNoSpecs = schemaPolicy.resolved && metadata.skipSpecs;
    if (specFiles.length === 0 && schemaPolicy.resolved && !permitsNoSpecs) {
      issue(
        unsupported,
        scope,
        "openspec.change-no-specs",
        portable(root, dir),
        "Change has no specs/<capability>/spec.md files and does not opt out with a valid, schema-resolved skip_specs: true marker.",
      );
    }
    for (const file of allSpecs.filter((path) => path.endsWith(".md") && basename(path) !== "spec.md")) {
      issue(
        unsupported,
        scope,
        "openspec.nonstandard-change-spec",
        portable(root, file),
        "Markdown under a change specs/ tree is not named spec.md.",
      );
    }
    changes.push({
      id,
      files,
      specs: specs.sort((a, b) => compareIds(a.capability, b.capability)),
      artifacts: allArtifacts.map((path) => portable(root, path)),
      metadata,
      ...counts,
    });
  }
  return changes;
}

function artifactScope(path: string): OpenSpecArtifactScope {
  if (path.startsWith("changes/archive/")) return "archive";
  if (/^changes\/[^/]+\//.test(path)) return "active";
  if (path.startsWith("specs/")) return "living";
  return "workspace";
}

function artifactFor(root: string, absolute: string): OpenSpecArtifact {
  const rootPath = portable(root, absolute);
  const path = sourceInventoryPath(root, absolute);
  const scope = artifactScope(rootPath);
  const pieces = rootPath.split("/");
  const archived = scope === "archive";
  const changeId = scope === "active" ? pieces[1] : scope === "archive" ? pieces[2] : undefined;
  const deltaSpecIndex = pieces.indexOf("specs");
  const capability = basename(absolute) === "spec.md" && deltaSpecIndex >= 0
    ? pieces.slice(deltaSpecIndex + 1, -1).join("/")
    : undefined;
  let kind: OpenSpecArtifactKind = "other";
  let disposition: OpenSpecArtifactDisposition = "manual-review";

  // A Store checkout that keeps its planning shape at the checkout root holds
  // its own metadata inside the planning root, not beside it.
  if (path === "@workspace/.openspec-store/store.yaml" || rootPath === ".openspec-store/store.yaml") {
    [kind, disposition] = ["store-metadata", "record-external-planning-root"];
  } else if (rootPath === "config.yaml") [kind, disposition] = ["config", "translate-project-context"];
  else if (rootPath === "project.md") [kind, disposition] = ["project-context", "translate-project-context"];
  else if (rootPath === "AGENTS.md") [kind, disposition] = ["agent-instructions", "remove-after-cutover"];
  else if (/^specs\/.+\/spec\.md$/.test(rootPath)) [kind, disposition] = ["living-spec", "map-requirements"];
  else if (/^specs\/.+\/design\.md$/.test(rootPath)) [kind, disposition] = ["living-design", "review-as-service-adr"];
  else if (/^changes\/(?:archive\/[^/]+|[^/]+)\/\.openspec\.yaml$/.test(rootPath)) {
    [kind, disposition] = ["change-metadata", "translate-change-metadata"];
  } else if (basename(absolute) === "proposal.md" && (scope === "active" || scope === "archive")) {
    [kind, disposition] = ["proposal", "convert-to-intent"];
  } else if (basename(absolute) === "tasks.md" && (scope === "active" || scope === "archive")) {
    [kind, disposition] = ["tasks", "preserve-as-legacy-checklist"];
  } else if (basename(absolute) === "design.md" && (scope === "active" || scope === "archive")) {
    [kind, disposition] = ["change-design", "review-as-feature-adr"];
  } else if (basename(absolute) === "spec.md" && (scope === "active" || scope === "archive")) {
    [kind, disposition] = ["delta-spec", "map-delta"];
  } else if (/^schemas\/[^/]+\/schema\.yaml$/.test(rootPath)) {
    [kind, disposition] = ["custom-schema", "review-custom-workflow"];
  } else if (/^schemas\/[^/]+\/templates\//.test(rootPath)) {
    [kind, disposition] = ["schema-template", "review-custom-workflow"];
  }

  if (archived) disposition = "retain-read-only";
  return { path, scope, kind, disposition, ...(changeId ? { changeId } : {}), ...(capability ? { capability } : {}) };
}

function sortIssues(issues: OpenSpecUnsupportedShape[]): void {
  issues.sort((a, b) => compareIds(a.path, b.path) || compareIds(a.code, b.code));
}

function titleFromChangeId(id: string): string {
  const words = id.split(/[-_]+/).filter(Boolean);
  const text = words.join(" ");
  return text === "" ? id : text[0]!.toUpperCase() + text.slice(1);
}

function emptyMapping(mapping?: OpenSpecMapping): OpenSpecMapping {
  if (mapping === undefined) {
    return {
      source: null,
      capabilities: dictionary(),
      changes: dictionary(),
      renames: dictionary(),
      artifacts: dictionary(),
    };
  }
  // Keep the core inventory tolerant of programmatic v0 callers while the CLI
  // parser enforces the complete v1 document, including explicit `changes`.
  return {
    source: mapping.source ?? null,
    capabilities: mapping.capabilities ?? dictionary(),
    changes: mapping.changes ?? dictionary(),
    renames: mapping.renames ?? dictionary(),
    artifacts: mapping.artifacts ?? dictionary(),
  };
}

export function createOpenSpecMappingSkeleton(inventory: OpenSpecInventory): OpenSpecMappingSkeleton {
  return {
    version: 1,
    source: { root: inventory.root, inventoryDigest: inventory.inventoryDigest },
    capabilities: Object.fromEntries(inventory.mappingDecisions.map((decision) => [
      decision.capability,
      {
        services: decision.services,
        suggestedServices: [decision.suggestedService],
        requirementServices: decision.requirementServices,
      },
    ])),
    changes: Object.fromEntries(inventory.changeDecisions.map((decision) => [
      decision.change,
      {
        feature: null,
        suggestedFeature: decision.suggestedFeature,
        title: decision.title,
      },
    ])),
    renames: Object.fromEntries(
      inventory.renamed
        .filter((rename) => rename.scope === "active")
        .map((rename) => [rename.key, {
          from: rename.from,
          to: rename.to,
          existingRequirementId: rename.existingRequirementId,
          // The identity the inventory settled on, which is the field the
          // skeleton is asking a human to fill in. `existingRequirementId` is
          // the living source's own id and happens to equal it on the only path
          // that reaches here today — but a caller that audits WITH a mapping
          // would have a settled id and no existing one, and the skeleton would
          // hand that decision back as unmade.
          requirementId: rename.requirementId,
        }]),
    ),
    artifacts: Object.fromEntries(inventory.artifactDecisions.map((decision) => [
      decision.path,
      {
        kind: decision.kind,
        disposition: null,
        suggestedDisposition: decision.suggestedDisposition,
      },
    ])),
  };
}

async function digestInventory(root: string, files: string[]): Promise<string> {
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

export async function inventoryOpenSpec(
  input: string,
  options: { mapping?: OpenSpecMapping } = {},
): Promise<OpenSpecInventory> {
  const located = await locateOpenSpecRoot(input);
  const { inputRoot, root } = located;
  const mapping = emptyMapping(options.mapping);
  const renamed: OpenSpecRenamedUsage[] = [];
  const blockers: OpenSpecUnsupportedShape[] = [];
  const archiveDiagnostics: OpenSpecUnsupportedShape[] = [];
  for (const absolute of await walkSymlinks(root)) {
    const path = portable(root, absolute);
    const scope = artifactScope(path);
    issue(
      scope === "archive" ? archiveDiagnostics : blockers,
      scope,
      "openspec.symlink-unsupported",
      path,
      "Symbolic links are not followed by migration inventory; replace this link with an in-tree regular file or directory.",
    );
  }
  const config = await inspectConfig(root, blockers);
  const specsRoot = join(root, "specs");
  const changesRoot = join(root, "changes");
  const inputStoreMetadata = join(inputRoot, ".openspec-store", "store.yaml");
  const parentStoreMetadata = basename(root) === "openspec"
    ? join(dirname(root), ".openspec-store", "store.yaml")
    : inputStoreMetadata;
  const storeMetadata = existsSync(inputStoreMetadata) ? inputStoreMetadata : parentStoreMetadata;
  const storeMetadataExists = existsSync(storeMetadata);
  const storeMetadataSymlink = storeMetadataExists && await isSymbolicLink(storeMetadata);
  if (storeMetadataSymlink) {
    issue(
      blockers,
      "workspace",
      "openspec.symlink-unsupported",
      sourceInventoryPath(root, storeMetadata),
      "Symbolic Store metadata is not followed; replace it with an in-tree regular file.",
    );
  }
  const hasModernEmptyShape = config !== null || (storeMetadataExists && !storeMetadataSymlink);
  if (!await isDirectory(specsRoot) && !hasModernEmptyShape) {
    issue(blockers, "living", "openspec.specs-missing", "specs", "Living specs/ directory is missing.");
  }
  if (config !== null && config.store !== null && !await isDirectory(specsRoot) && !await isDirectory(changesRoot)) {
    issue(
      blockers,
      "workspace",
      "openspec.external-store-pointer",
      "config.yaml",
      `Planning is externalized to Store '${config.store}'; audit that registered Store checkout directly.`,
    );
  }

  const capabilities: OpenSpecCapability[] = [];
  const livingRequirements = new Map<string, ReturnType<typeof parseRequirements>>();
  const livingCounts: OpenSpecCounts = { specFiles: 0, requirements: 0, scenarios: 0 };
  const livingTree = await walkFiles(specsRoot);
  const livingFiles = livingTree.filter((path) => basename(path) === "spec.md");
  // The living twin of openspec.nonstandard-change-spec. Selecting living specs
  // by exact basename is right, but without the mirror a mis-cased or renamed
  // file simply disappears: specs/payments/Spec.md audited as a clean, empty
  // corpus while the identical shape under a change was reported.
  for (const file of livingTree.filter((path) =>
    /\.md$/i.test(path) && basename(path) !== "spec.md" && basename(path) !== "design.md")) {
    blockers.push({
      code: "openspec.nonstandard-living-spec",
      path: portable(root, file),
      message: "Markdown under specs/ is named neither spec.md nor design.md, so no capability reads it.",
      scope: "living",
    });
  }
  for (const specFile of livingFiles) {
    const id = portable(specsRoot, dirname(specFile));
    const inspected = await inspectSpecFile(root, specFile, "living", null, mapping, renamed, blockers);
    livingRequirements.set(id, inspected.requirements);
    const capability = { id, files: [inspected.path], ...inspected.counts };
    capabilities.push(capability);
    addCounts(livingCounts, inspected.counts);
  }
  capabilities.sort((a, b) => compareIds(a.id, b.id));

  const activeIds = (await subdirs(changesRoot)).filter((id) => id !== "archive");
  const archiveRoot = join(changesRoot, "archive");
  const archivedIds = await subdirs(archiveRoot);
  for (const id of await hiddenSubdirs(changesRoot)) {
    blockers.push({
      code: "openspec.hidden-change-directory",
      path: portable(root, join(changesRoot, id)),
      message: "A dot-prefixed change directory is not enumerated as a change, so nothing under it is migrated; rename it or move it out of changes/.",
      scope: "active",
    });
  }
  for (const id of await hiddenSubdirs(archiveRoot)) {
    archiveDiagnostics.push({
      code: "openspec.hidden-change-directory",
      path: portable(root, join(archiveRoot, id)),
      message: "A dot-prefixed archive directory is not enumerated as a change; frozen history is retained read-only where it is.",
      scope: "archive",
    });
  }
  const fallbackSchema = config?.schema ?? "spec-driven";
  const active = await inventoryChanges(
    root,
    changesRoot,
    activeIds,
    "active",
    fallbackSchema,
    mapping,
    renamed,
    blockers,
  );
  const archived = await inventoryChanges(
    root,
    archiveRoot,
    archivedIds,
    "archive",
    fallbackSchema,
    mapping,
    renamed,
    archiveDiagnostics,
  );

  // Last-resort backstop under the whole "audited past the corpus" family, and
  // the one check that does not depend on root selection being right: an
  // inventory that read no living spec AND no active change describes nothing,
  // so no verdict over it can be `ready`. That is exactly the shape the Store
  // misdetection produced — ready, mechanically compatible, zero capabilities,
  // zero unsupported shapes — where the failure verdict was more confident than
  // any success verdict. A greenfield workspace whose only requirements live
  // under changes/ has an active change and is not caught here.
  if (livingCounts.specFiles === 0 && active.length === 0) {
    blockers.push({
      code: "openspec.workspace-empty",
      path: ".",
      message: `Planning root ${root} holds no living spec and no active change; there is nothing to migrate, so confirm this is the directory that really holds the corpus.`,
      scope: "workspace",
    });
  }

  const artifactFiles = await walkFiles(root);
  if (storeMetadataExists && !storeMetadataSymlink && !artifactFiles.includes(storeMetadata)) {
    artifactFiles.push(storeMetadata);
  }
  for (const absolute of artifactFiles) {
    const bytes = await readFile(absolute);
    if (isUtf8(bytes)) continue;
    const rootPath = portable(root, absolute);
    const artifactPath = sourceInventoryPath(root, absolute);
    const scope = absolute === storeMetadata ? "workspace" : artifactScope(rootPath);
    issue(
      scope === "archive" ? archiveDiagnostics : blockers,
      scope,
      "openspec.non-utf8-artifact",
      artifactPath,
      "Migration can preserve only valid UTF-8 authored artifacts; convert this file to UTF-8 before apply.",
    );
  }
  // The digest binds a mapping to the truth it was reviewed against, and frozen
  // archive history is neither migrated nor allowed to block readiness. Covering
  // it meant a colleague's typo fix under changes/archive/ killed a completed
  // mapping, with no --force and no indication of which file moved.
  const inventoryDigest = await digestInventory(
    root,
    artifactFiles.filter((absolute) => artifactScope(portable(root, absolute)) !== "archive"),
  );
  const artifacts = artifactFiles
    .map((path) => artifactFor(root, path))
    .sort((a, b) => compareIds(a.path, b.path));

  // Capability ownership must cover the active horizon too: a brand-new
  // capability may exist only under changes/<id>/specs until archive.
  //
  // `routedNames` is the subset a split capability must actually allocate. A
  // renamed requirement is routed by its FROM — that is what keeps the delta in
  // the same services as the living text it rewrites — so demanding an
  // allocation for its TO as well asked a reviewer for a decision apply ignores.
  const requirementNamesByCapability = new Map<string, Set<string>>();
  const routedNamesByCapability = new Map<string, Set<string>>();
  const activeChangesByCapability = new Map<string, Set<string>>();
  const activeRenamePairs = renamed.filter((rename) =>
    rename.scope === "active"
    && rename.from !== null && rename.from !== ""
    && rename.to !== null && rename.to !== "");
  for (const [capability, requirements] of livingRequirements) {
    requirementNamesByCapability.set(capability, new Set(requirements.map((item) => item.name)));
    routedNamesByCapability.set(capability, new Set(requirements.map((item) => item.name)));
  }
  for (const change of active) {
    for (const spec of change.specs) {
      const names = requirementNamesByCapability.get(spec.capability) ?? new Set<string>();
      const routed = routedNamesByCapability.get(spec.capability) ?? new Set<string>();
      for (const name of spec.requirementNames) {
        names.add(name);
        const pairs = activeRenamePairs.filter((rename) =>
          rename.changeId === change.id
          && rename.capability === spec.capability
          && (name === rename.from || name === rename.to));
        routed.add(pairs.length === 1 ? pairs[0]!.from! : name);
      }
      requirementNamesByCapability.set(spec.capability, names);
      routedNamesByCapability.set(spec.capability, routed);
      const changes = activeChangesByCapability.get(spec.capability) ?? new Set<string>();
      changes.add(change.id);
      activeChangesByCapability.set(spec.capability, changes);
    }
  }
  const allCapabilityIds = [...requirementNamesByCapability.keys()].sort(compareIds);

  const mappingIssues: OpenSpecMappingIssue[] = [];
  if (options.mapping !== undefined) {
    if (mapping.source === null) {
      mappingIssues.push({
        code: "mapping.source-missing",
        key: "source",
        message: "Mapping is not bound to an audited source root and inventory digest.",
      });
    } else {
      if (resolve(mapping.source.root) !== root) {
        mappingIssues.push({
          code: "mapping.source-root-mismatch",
          key: "source.root",
          message: `Mapping was created for ${mapping.source.root}, not ${root}.`,
        });
      }
      if (mapping.source.inventoryDigest !== inventoryDigest) {
        mappingIssues.push({
          code: "mapping.source-digest-mismatch",
          key: "source.inventoryDigest",
          message: `OpenSpec source changed after audit (${mapping.source.inventoryDigest} != ${inventoryDigest}).`,
        });
      }
    }
  }
  const capabilityIds = new Set(allCapabilityIds);
  for (const capability of Object.keys(mapping.capabilities)) {
    if (!capabilityIds.has(capability)) {
      mappingIssues.push({
        code: "mapping.unknown-capability",
        key: capability,
        message: `Mapping names unknown capability '${capability}'.`,
      });
    }
  }
  const mappingDecisions: CapabilityMappingDecision[] = allCapabilityIds.map((capability) => {
    const capabilityMapping = ownValue(mapping.capabilities, capability)
      ?? { services: [], requirementServices: dictionary<string[]>() };
    const services = [...new Set(capabilityMapping.services)]
      .filter((service) => service.trim() !== "")
      .sort(compareIds);
    const requirementNames = [...(requirementNamesByCapability.get(capability) ?? [])].sort(compareIds);
    const requirementNameSet = new Set(requirementNames);
    const routedNames = [...(routedNamesByCapability.get(capability) ?? [])].sort(compareIds);
    const requirementServices = dictionary<string[]>();
    for (const [requirement, allocated] of Object.entries(capabilityMapping.requirementServices)) {
      if (!requirementNameSet.has(requirement)) {
        mappingIssues.push({
          code: "mapping.unknown-requirement",
          key: `${capability}:${requirement}`,
          message: `Capability '${capability}' mapping names unknown requirement '${requirement}'.`,
        });
        continue;
      }
      const selected = [...new Set(allocated)].filter(Boolean).sort(compareIds);
      requirementServices[requirement] = selected;
      for (const service of selected) {
        if (!services.includes(service)) {
          mappingIssues.push({
            code: "mapping.requirement-service-unknown",
            key: `${capability}:${requirement}`,
            message: `Requirement '${requirement}' is allocated to '${service}', which is not in capability '${capability}' services.`,
          });
        }
      }
    }
    // Only routed names get an empty slot in the skeleton: an unroutable name
    // offered for allocation is a decision that changes nothing.
    for (const requirement of routedNames) {
      if (ownValue(requirementServices, requirement) === undefined) requirementServices[requirement] = [];
    }
    if (services.length > 1) {
      for (const requirement of routedNames) {
        if ((ownValue(requirementServices, requirement) ?? []).length === 0) {
          mappingIssues.push({
            code: "mapping.requirement-allocation-missing",
            key: `${capability}:${requirement}`,
            message: `Split capability '${capability}' must allocate requirement '${requirement}' to at least one selected service.`,
          });
        }
      }
      for (const service of services) {
        if (!Object.values(requirementServices).some((selected) => selected.includes(service))) {
          mappingIssues.push({
            code: "mapping.service-allocation-empty",
            key: `${capability}:${service}`,
            message: `Split capability '${capability}' selects service '${service}' but allocates no requirement to it.`,
          });
        }
      }
    }
    return {
      capability,
      service: services.length === 1 ? services[0]! : null,
      services,
      requirementServices,
      suggestedService: capability.split("/").at(-1) ?? capability,
      hasLivingSpec: livingRequirements.has(capability),
      activeChanges: [...(activeChangesByCapability.get(capability) ?? [])].sort(compareIds),
      status: services.length === 0 ? "needsMapping" : "mapped",
    };
  });
  const decisionsByCapability = new Map(mappingDecisions.map((decision) => [decision.capability, decision]));
  const servicesForRequirement = (capability: string, requirement: string): string[] => {
    const decision = decisionsByCapability.get(capability);
    if (decision === undefined) return [];
    return decision.services.length === 1
      ? decision.services
      : ownValue(decision.requirementServices, requirement) ?? [];
  };
  const livingByService = new Map<string, Array<{ capability: string; requirement: ReturnType<typeof parseRequirements>[number] }>>();
  for (const [capability, requirements] of livingRequirements) {
    for (const requirement of requirements) {
      for (const service of servicesForRequirement(capability, requirement.name)) {
        const routed = livingByService.get(service) ?? [];
        routed.push({ capability, requirement });
        livingByService.set(service, routed);
      }
    }
  }

  const activeChangeIds = new Set(active.map((change) => change.id));
  for (const change of Object.keys(mapping.changes)) {
    if (!activeChangeIds.has(change)) {
      mappingIssues.push({
        code: "mapping.unknown-change",
        key: change,
        message: `Mapping names unknown active change '${change}'.`,
      });
    }
  }
  const changeDecisions: OpenSpecChangeDecision[] = active.map((change, index) => {
    const suggestedTitle = titleFromChangeId(change.id);
    const selected = ownValue(mapping.changes, change.id);
    const feature = selected?.feature ?? null;
    const title = selected?.title?.trim() ?? suggestedTitle;
    if (selected !== undefined && title === "") {
      mappingIssues.push({
        code: "mapping.change-title-missing",
        key: change.id,
        message: `Active change '${change.id}' needs a non-empty title.`,
      });
    }
    if (feature !== null && !isFeatureId(feature)) {
      mappingIssues.push({
        code: "mapping.feature-id-invalid",
        key: change.id,
        message: `Active change '${change.id}' maps to invalid loam feature id '${feature}'. ${FEATURE_ID_RULE}`,
      });
    }
    return {
      change: change.id,
      feature,
      title,
      suggestedFeature: `FEAT-${index + 1}`,
      suggestedTitle,
      status: feature === null || title === "" ? "needsFeature" : "mapped",
    };
  });
  const featureOwners = new Map<string, string[]>();
  for (const decision of changeDecisions) {
    if (decision.feature === null || !isFeatureId(decision.feature)) continue;
    const key = decision.feature.toLowerCase();
    const owners = featureOwners.get(key) ?? [];
    owners.push(decision.change);
    featureOwners.set(key, owners);
  }
  for (const [feature, owners] of featureOwners) {
    if (owners.length > 1) {
      mappingIssues.push({
        code: "mapping.feature-id-duplicate",
        key: feature,
        message: `Loam feature id '${feature}' is assigned to multiple OpenSpec changes: ${owners.join(", ")}.`,
      });
    }
  }

  const activeRenames = renamed.filter((rename) => rename.scope === "active");
  const renameKeys = new Set(activeRenames.map((rename) => rename.key));
  for (const [key, requirementId] of Object.entries(mapping.renames)) {
    if (!renameKeys.has(key)) {
      mappingIssues.push({
        code: "mapping.unknown-rename",
        key,
        message: `Mapping names unknown RENAMED pair '${key}'.`,
      });
    } else if (!REQUIREMENT_ID_RE.test(requirementId)) {
      mappingIssues.push({
        code: "mapping.invalid-requirement-id",
        key,
        message: `RENAMED pair '${key}' has invalid Requirement-ID '${requirementId}'.`,
      });
    }
  }

  // Resolve every rename against the living source of truth. A mapped id is
  // only needed when the source requirement does not already carry one.
  for (const rename of activeRenames) {
    if (rename.from === null || rename.from === "" || rename.to === null || rename.to === "") continue;
    const living = livingRequirements.get(rename.capability) ?? [];
    const matches = living.filter((requirement) => requirement.name === rename.from);
    if (matches.length === 0) {
      mappingIssues.push({
        code: "mapping.rename-source-missing",
        key: rename.key,
        message: `RENAMED source '${rename.from}' does not exist in living capability '${rename.capability}'.`,
      });
      rename.requirementId = null;
      rename.status = "needsIdentity";
      continue;
    }
    if (matches.length > 1) {
      mappingIssues.push({
        code: "mapping.rename-source-ambiguous",
        key: rename.key,
        message: `RENAMED source '${rename.from}' matches ${matches.length} living requirements in '${rename.capability}'.`,
      });
      rename.requirementId = null;
      rename.status = "needsIdentity";
      continue;
    }
    const source = matches[0]!;
    const declarations = requirementIdDeclarations(source);
    if (declarations.length > 0
      && (declarations.length !== 1 || !REQUIREMENT_ID_RE.test(declarations[0]!))) {
      rename.existingRequirementId = source.id ?? null;
      rename.requirementId = null;
      rename.status = "needsIdentity";
      mappingIssues.push({
        code: "mapping.rename-source-id-invalid",
        key: rename.key,
        message: `RENAMED source '${rename.from}' has ${declarations.length === 1 ? "an invalid" : "repeated"} Requirement-ID declaration; repair the living source before migration.`,
      });
      continue;
    }
    rename.existingRequirementId = source.id ?? null;
    const requestedId = ownValue(mapping.renames, rename.key) ?? null;
    if (source.id !== undefined && requestedId !== null && requestedId !== source.id) {
      mappingIssues.push({
        code: "mapping.rename-existing-id-conflict",
        key: rename.key,
        message: `RENAMED source '${rename.from}' already has Requirement-ID '${source.id}'; mapping cannot replace it with '${requestedId}'.`,
      });
    }
    rename.requirementId = source.id ?? requestedId;
    rename.status = rename.requirementId === null ? "needsIdentity" : "mapped";
    const routedServices = servicesForRequirement(rename.capability, rename.from);
    if (rename.requirementId !== null) {
      const collisionServices = routedServices.filter((service) =>
        (livingByService.get(service) ?? []).some(
          (entry) => entry.requirement !== source && entry.requirement.id === rename.requirementId,
        ));
      if (collisionServices.length > 0) {
        mappingIssues.push({
          code: "mapping.rename-id-conflict",
          key: rename.key,
          message: `RENAMED identity '${rename.requirementId}' already belongs to another living requirement in mapped service(s): ${collisionServices.join(", ")}.`,
        });
      }
    }
    const targetCollisionServices = routedServices.filter((service) =>
      (livingByService.get(service) ?? []).some(
        (entry) => entry.requirement !== source && entry.requirement.name === rename.to,
      ));
    if (rename.to === rename.from || targetCollisionServices.length > 0) {
      mappingIssues.push({
        code: "mapping.rename-target-conflict",
        key: rename.key,
        message: rename.to === rename.from
          ? `RENAMED target '${rename.to}' is the same as its living source.`
          : `RENAMED target '${rename.to}' conflicts in mapped service(s): ${targetCollisionServices.join(", ")}.`,
      });
    }
  }

  const renameSources = new Map<string, OpenSpecRenamedUsage[]>();
  const renameTargets = new Map<string, OpenSpecRenamedUsage[]>();
  for (const rename of activeRenames) {
    if (rename.from === null || rename.to === null) continue;
    for (const service of servicesForRequirement(rename.capability, rename.from)) {
      const sourceKey = `${service}\0${rename.from}`;
      const targetKey = `${service}\0${rename.to}`;
      const sources = renameSources.get(sourceKey) ?? [];
      sources.push(rename);
      renameSources.set(sourceKey, sources);
      const targets = renameTargets.get(targetKey) ?? [];
      targets.push(rename);
      renameTargets.set(targetKey, targets);
    }
  }
  for (const [key, uses] of renameSources) {
    if (uses.length > 1) {
      mappingIssues.push({
        code: "mapping.rename-double-source",
        key: key.replace("\0", ":"),
        message: `Living requirement '${uses[0]!.from}' is renamed by multiple active changes: ${uses.map((item) => item.changeId).join(", ")}.`,
      });
    }
  }
  for (const [key, uses] of renameTargets) {
    if (uses.length > 1) {
      mappingIssues.push({
        code: "mapping.rename-double-target",
        key: key.replace("\0", ":"),
        message: `Multiple active renames target '${uses[0]!.to}' in mapped service '${key.split("\0")[0]}'.`,
      });
    }
    if (renameSources.has(key)) {
      mappingIssues.push({
        code: "mapping.rename-chain",
        key: key.replace("\0", ":"),
        message: `Active rename chain through '${uses[0]!.to}' must be collapsed into one reviewed rename.`,
      });
    }
  }
  const renameIdOwners = new Map<string, Set<string>>();
  for (const rename of activeRenames) {
    if (rename.requirementId === null || rename.from === null) continue;
    for (const service of servicesForRequirement(rename.capability, rename.from)) {
      const key = `${service}\0${rename.requirementId}`;
      const owners = renameIdOwners.get(key) ?? new Set<string>();
      owners.add(`${rename.capability}:${rename.from}`);
      renameIdOwners.set(key, owners);
    }
  }
  for (const [key, owners] of renameIdOwners) {
    if (owners.size > 1) {
      const [service, requirementId] = key.split("\0");
      mappingIssues.push({
        code: "mapping.rename-id-conflict",
        key,
        message: `Requirement-ID '${requirementId}' is assigned to different RENAMED sources in mapped service '${service}': ${[...owners].join(", ")}.`,
      });
    }
  }

  const decisionKinds = new Set<OpenSpecArtifactKind>(["proposal", "tasks", "change-design"]);
  const artifactDecisions: OpenSpecArtifactDecision[] = artifacts
    // Never offer a disposition for an artifact no enumerated change owns —
    // dot-prefixed change directories are refused, not migrated, and a
    // `selectedDisposition` recorded for one is a decision about nothing.
    .filter((artifact): artifact is OpenSpecArtifact & { kind: "proposal" | "tasks" | "change-design" } =>
      artifact.scope === "active"
      && decisionKinds.has(artifact.kind)
      && artifact.changeId !== undefined
      && activeChangeIds.has(artifact.changeId))
    .map((artifact) => {
      const selected = ownValue(mapping.artifacts, artifact.path) ?? null;
      return {
        path: artifact.path,
        kind: artifact.kind,
        suggestedDisposition: artifact.disposition,
        disposition: selected,
        status: selected === null ? "needsDisposition" as const : "mapped" as const,
      };
    });
  const artifactPaths = new Set(artifactDecisions.map((decision) => decision.path));
  // Sets of plain strings: the question being asked is "is this authored value
  // one of the ones this kind accepts", and a set of the union could not be
  // asked it without an assertion putting the answer back where it started.
  const dispositionsByKind: Record<OpenSpecArtifactDecision["kind"], ReadonlySet<string>> = {
    proposal: new Set(["convert-to-intent", "retain-read-only", "manual-review"]),
    tasks: new Set(["preserve-as-legacy-checklist", "retain-read-only", "manual-review"]),
    "change-design": new Set(["review-as-feature-adr", "retain-read-only", "manual-review"]),
  };
  for (const [path, disposition] of Object.entries(mapping.artifacts)) {
    if (!artifactPaths.has(path)) {
      mappingIssues.push({
        code: "mapping.unknown-artifact",
        key: path,
        message: `Mapping names unknown active authored artifact '${path}'.`,
      });
    } else {
      const decision = artifactDecisions.find((item) => item.path === path)!;
      if (dispositionsByKind[decision.kind].has(disposition)) continue;
      mappingIssues.push({
        code: "mapping.invalid-artifact-disposition",
        key: path,
        message: `${decision.kind} artifact '${path}' has unsupported disposition '${disposition}'.`,
      });
    }
  }
  mappingIssues.sort((a, b) => compareIds(a.key, b.key) || compareIds(a.code, b.code));

  renamed.sort((a, b) => compareIds(a.path, b.path) || a.line - b.line || compareIds(a.key, b.key));
  sortIssues(blockers);
  sortIssues(archiveDiagnostics);
  const livingIssueCount = blockers.filter((item) => item.scope === "workspace" || item.scope === "living").length;
  const activeIssueCount = blockers.filter((item) => item.scope === "active").length;
  const needsMapping = mappingDecisions.filter((decision) => decision.status === "needsMapping");
  const needsChangeMapping = changeDecisions.filter((decision) => decision.status === "needsFeature");
  const needsDisposition = artifactDecisions.filter((decision) => decision.status === "needsDisposition");
  const unresolvedActiveRenames = renamed.filter(
    (rename) => rename.scope === "active" && rename.status === "needsIdentity",
  );
  const mechanicallyCompatible = livingIssueCount === 0 && activeIssueCount === 0;
  const ready = mechanicallyCompatible
    && needsMapping.length === 0
    && needsChangeMapping.length === 0
    && unresolvedActiveRenames.length === 0
    && needsDisposition.length === 0
    && mappingIssues.length === 0;

  return {
    baselines: OPENSPEC_BASELINES,
    inputRoot,
    root,
    inventoryDigest,
    workspace: {
      kind: located.kind,
      config,
      storeMetadataPath: storeMetadataExists ? sourceInventoryPath(root, storeMetadata) : null,
    },
    ready,
    mechanicallyCompatible,
    readiness: {
      living: { compatible: livingIssueCount === 0, issueCount: livingIssueCount },
      active: { compatible: activeIssueCount === 0, issueCount: activeIssueCount },
      sourceCurrent: !mappingIssues.some((item) => item.code.startsWith("mapping.source-")),
      mappingsResolved: needsMapping.length === 0 && !mappingIssues.some((item) =>
        item.code === "mapping.unknown-capability"
        || item.code === "mapping.unknown-requirement"
        || item.code.startsWith("mapping.requirement-")
        || item.code === "mapping.service-allocation-empty"),
      changesResolved: needsChangeMapping.length === 0 && !mappingIssues.some((item) =>
        item.code === "mapping.unknown-change"
        || item.code === "mapping.change-title-missing"
        || item.code.startsWith("mapping.feature-id-")),
      renamesResolved: unresolvedActiveRenames.length === 0 && !mappingIssues.some((item) => item.code.includes("rename") || item.code.includes("requirement-id")),
      dispositionsResolved: needsDisposition.length === 0 && !mappingIssues.some((item) => item.code.includes("artifact")),
      migrationReady: ready,
    },
    living: { ...livingCounts, capabilities },
    changes: {
      active,
      archived,
      counts: { active: active.length, archived: archived.length },
    },
    renamed,
    unsupported: blockers,
    archiveDiagnostics,
    mappingDecisions,
    needsMapping,
    changeDecisions,
    needsChangeMapping,
    mappingIssues,
    artifacts,
    artifactDecisions,
    needsDisposition,
  };
}
