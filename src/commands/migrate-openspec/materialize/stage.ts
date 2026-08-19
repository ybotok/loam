/**
 * Every refusal that stands between a finished migration plan and the disk.
 *
 * Three questions, one module because all three are answered at the same
 * moment and none of them may be skipped: may the target hold these bytes at
 * all (it must be empty, not a symlink, outside the OpenSpec source and outside
 * any live loam fleet), do two planned writes claim one path once portable
 * case/Unicode folding is applied, and would the requirements about to be
 * serialized still parse as a loam spec.
 *
 * They sit beside the writers rather than under `../openspec/` because they
 * grade the *output*: `../openspec/paths.ts` holds the path arithmetic they are
 * built from, and knows nothing about a plan.
 */
import { existsSync } from "node:fs";
import { lstat, readFile, readdir, realpath, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { findConfigPath, parseConfig } from "../../../core/envelope/config.js";
import { docsDirOf, type DocsDir } from "../../../core/kernel/ids/dirs.js";
import { CAPABILITY_LINE_RE, requirementIdProblems, type Requirement } from "../../../core/document/spec.js";
import { decodeDocument } from "../../../core/kernel/document-bytes.js";
import { type OpenSpecInventory } from "../../../core/openspec/model/model.js";
import { type PlannedWrite } from "../../../core/staging/writes.js";
import { OpenSpecCommandError } from "../openspec/error.js";
import { canonicalForCreate, contains } from "../openspec/paths.js";

/**
 * The other half of "never writes into … live loam docs". Overlap with the
 * OpenSpec source was the only thing checked, so `--target <docs>/features` on a
 * fresh fleet passed and put phantom features into every `loam list`.
 *
 * The line is the docs tree, not the repository: every enumerating command reads
 * `<docsDir>/services` and `<docsDir>/features`, so a target under docsDir joins
 * the live fleet, while a sibling of it is merely a directory. A config that
 * governs the target but cannot be parsed is refused too — an unreadable
 * docsDir cannot be shown to be somewhere else.
 */
async function assertOutsideLoamDocs(stage: string): Promise<void> {
  const canonicalStage = await canonicalForCreate(stage);
  const governing = findConfigPath(canonicalStage);
  if (governing !== null) {
    const docsDir = await governingDocsDir(governing);
    if (docsDir === null || contains(docsDir, canonicalStage)) {
      throw new OpenSpecCommandError(
        "invalid-option",
        `Refusing to stage a migration inside the live loam docs ${docsDir ?? `governed by ${governing}`}: ${stage}. Migrate into a standalone directory and cut over after review.`,
      );
    }
  }
  // A docs repo checked out without its loam.json — the landscape is the file
  // no docs repo is without, and `loam init` scaffolds it before anything else.
  for (let dir = canonicalStage; ; dir = dirname(dir)) {
    if (existsSync(join(dir, "architecture", "landscape.likec4"))) {
      throw new OpenSpecCommandError(
        "invalid-option",
        `Refusing to stage a migration inside a loam docs repository: ${join(dir, "architecture", "landscape.likec4")} is above ${stage}. Migrate into a standalone directory and cut over after review.`,
      );
    }
    if (dirname(dir) === dir) return;
  }
}

/**
 * Canonical docsDir of the config at `path`, or null when it cannot be read —
 * including "read as UTF-8 it would have said something else", which is why the
 * bytes go through `decodeDocument`. Null is the conservative answer here: the
 * caller refuses to stage rather than accept a docsDir it cannot establish.
 */
async function governingDocsDir(path: string): Promise<DocsDir | null> {
  try {
    // Re-branded after canonicalization: the path came out of `parseConfig`
    // already resolved (a `DocsDir`), and `canonicalForCreate` only follows
    // symlinks — same root, same provenance, canonical spelling.
    return docsDirOf(await canonicalForCreate(
      parseConfig(decodeDocument(await readFile(path), path), dirname(path)).docsDir,
    ));
  } catch {
    return null;
  }
}

export async function assertEmptyNonOverlappingStage(inventory: OpenSpecInventory, stage: string): Promise<void> {
  const canonicalStage = await canonicalForCreate(stage);
  const canonicalSource = await realpath(inventory.inputRoot);
  if (contains(canonicalSource, canonicalStage) || contains(canonicalStage, canonicalSource)) {
    throw new OpenSpecCommandError(
      "invalid-option",
      `Staging directory must not overlap the OpenSpec source workspace: ${stage}`,
    );
  }
  await assertOutsideLoamDocs(stage);
  try {
    if ((await lstat(stage)).isSymbolicLink()) {
      throw new OpenSpecCommandError(
        "invalid-option",
        `Staging target must not be a symbolic link: ${stage}`,
      );
    }
  } catch (error) {
    if (error instanceof OpenSpecCommandError) throw error;
    const code = typeof error === "object" && error !== null && "code" in error ? error.code : null;
    if (code !== "ENOENT") throw error;
  }
  if (!existsSync(stage)) return;
  const info = await stat(stage);
  if (!info.isDirectory() || (await readdir(stage)).length > 0) {
    throw new OpenSpecCommandError("already-exists", `Staging target must be absent or an empty directory: ${stage}`);
  }
}

export function assertDistinctPlannedPaths(writes: PlannedWrite[]): void {
  const writePaths = new Map<string, string>();
  for (const write of writes) {
    const collisionKey = resolve(write.path).normalize("NFC").toLowerCase();
    const existing = writePaths.get(collisionKey);
    if (existing !== undefined) {
      throw new OpenSpecCommandError(
        "invalid-option",
        `Migration paths '${existing}' and '${write.path}' collide after portable case/Unicode normalization; refine mappings before apply.`,
      );
    }
    writePaths.set(collisionKey, write.path);
  }
}

/**
 * The requirement with a `Capability: <id>` body line — the join that keeps
 * the source capability's identity on every requirement it routed, instead of
 * dissolving it into service files and leaving the id only in legacy/. The
 * serializeRequirements Requirement-ID pattern: never a second line when the
 * author already wrote one (a rare but legal delta authored against a loam
 * target), and appended after the body the way active.ts appends its
 * OpenSpec-Living-Source annotation, so a MODIFIED requirement's wholesale
 * replace carries the line into the living document rather than stripping it.
 */
export function requirementWithCapability(requirement: Requirement, capabilityId: string): Requirement {
  if (requirement.text.some((line) => CAPABILITY_LINE_RE.test(line))) return requirement;
  const line = `Capability: ${capabilityId}`;
  return {
    ...requirement,
    capabilities: [capabilityId],
    text: requirement.text.length === 0 ? [line] : [...requirement.text, "", line],
  };
}

export function assertMaterializedRequirementIds(where: string, requirements: Requirement[]): void {
  const problems = requirementIdProblems(requirements);
  if (problems.length === 0) return;
  const first = problems[0]!;
  const detail = first.kind === "invalid"
    ? `requirement '${first.requirement}' has invalid Requirement-ID '${first.value}'`
    : first.kind === "repeated"
      ? `requirement '${first.requirement}' declares Requirement-ID ${first.values.length} times`
      : `Requirement-ID '${first.id}' is shared by ${first.requirements.map((name) => `'${name}'`).join(", ")}`;
  throw new OpenSpecCommandError(
    "invalid-option",
    `${where} would materialize an invalid loam spec: ${detail}. Repair the source or refine routing before apply.`,
  );
}
