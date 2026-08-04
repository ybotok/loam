import { existsSync } from "node:fs";
import { lstat, mkdir, readFile, readdir, realpath, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { Command } from "commander";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { fail, emitJson, type ErrorCode } from "../core/json.js";
import {
  createOpenSpecMappingSkeleton,
  inventoryOpenSpec,
  OpenSpecRootError,
  type OpenSpecInventory,
  type OpenSpecArtifactDisposition,
  type OpenSpecMapping,
  type OpenSpecMappingSkeleton,
} from "../core/openspec-inventory.js";
import {
  parseRequirements,
  requirementIdProblems,
  serializeRequirements,
  type Requirement,
} from "../core/spec.js";
import {
  message,
  rollbackError,
  rollbackStaged,
  stageWrites,
  swapStaged,
  type PlannedWrite,
} from "../core/staging.js";

interface AuditOpenSpecOptions {
  json?: boolean;
  writeMapping?: string;
}

interface MigrateOpenSpecOptions {
  json?: boolean;
  map?: string;
  mapping?: string;
  apply?: boolean;
  target?: string;
}

class OpenSpecCommandError extends Error {
  constructor(readonly code: ErrorCode, message: string) {
    super(message);
    this.name = "OpenSpecCommandError";
  }
}

/** Registers the read-only audit and the separate, mapping-driven migration planner. */
export function registerMigrateOpenSpec(program: Command): void {
  program
    .command("audit-openspec")
    .argument("<root>", "OpenSpec root, Store checkout, or workspace containing openspec/")
    .description("Audit an OpenSpec workspace without treating human mapping decisions as command failure")
    .option("--write-mapping <path>", "write a non-overwriting, digest-bound decision skeleton outside the source workspace")
    .option("--json", "emit the machine contract instead of the human view")
    .action(async (root: string, opts: AuditOpenSpecOptions) => {
      const json = opts.json === true;
      try {
        const inventory = await inventoryOpenSpec(root);
        const skeleton = createOpenSpecMappingSkeleton(inventory);
        const mappingWritten = opts.writeMapping === undefined
          ? null
          : await writeMappingSkeleton(inventory, opts.writeMapping, skeleton);
        if (json) {
          emitJson({
            command: "audit-openspec",
            readOnly: mappingWritten === null,
            mappingWritten,
            mappingSkeleton: skeleton,
            ...inventory,
          });
        } else {
          printInventory(inventory, "audit");
          if (mappingWritten !== null) console.log(`\n  mapping skeleton  ${mappingWritten}`);
          else console.log("\n  read-only audit: no files were created or changed");
        }
        // Finding incompatibilities is a successful audit result. Root/YAML/IO
        // failures still exit 1 through the catch below; migration readiness has
        // its own boolean and migrate-openspec exit status.
      } catch (error) {
        reportCommandError(json, error);
      }
    });

  program
    .command("migrate-openspec")
    .argument("<root>", "OpenSpec root, Store checkout, or workspace containing openspec/")
    .description("Validate explicit migration mappings and optionally materialize staged migration docs")
    .option("--map <path>", "YAML mapping created from `audit-openspec --write-mapping`")
    .option("--mapping <path>", "deprecated alias for --map")
    .option("--apply", "materialize staged migration docs; dry-run is the default")
    .option("--target <directory>", "empty standalone target for --apply; never writes into the OpenSpec source or live loam docs")
    .option("--json", "emit the machine contract instead of the human view")
    .action(async (root: string, opts: MigrateOpenSpecOptions) => {
      const json = opts.json === true;
      try {
        if (opts.map !== undefined && opts.mapping !== undefined) {
          throw new OpenSpecCommandError("invalid-option", "Pass --map or its deprecated --mapping alias, not both.");
        }
        const mapArg = opts.map ?? opts.mapping;
        if (mapArg === undefined) {
          throw new OpenSpecCommandError(
            "invalid-option",
            "migrate-openspec requires --map <path>; run `loam audit-openspec <root> --write-mapping <path>` first.",
          );
        }
        if (opts.apply === true && opts.target === undefined) {
          throw new OpenSpecCommandError("invalid-option", "--apply requires an explicit --target <empty-directory>.");
        }
        if (opts.apply !== true && opts.target !== undefined) {
          throw new OpenSpecCommandError("invalid-option", "--target only has effect with explicit --apply.");
        }
        const mappingPath = resolve(mapArg);
        const mapping = await readMapping(mappingPath);
        // Re-audit the source at the point of use. inventoryOpenSpec compares
        // the fresh digest and canonical root to the binding in the mapping.
        const inventory = await inventoryOpenSpec(root, { mapping });
        const target = opts.apply === true
          ? resolve(opts.target!)
          : join(dirname(mappingPath), ".loam-openspec-dry-run-target");
        const planned = inventory.ready
          ? await planMigrationWrites(inventory, mapping, target)
          : null;
        let applied: { directory: string; files: string[]; followUpBlockers: string[] } | null = null;
        if (opts.apply === true) {
          if (!inventory.ready || planned === null) {
            throw new OpenSpecCommandError(
              "invalid-option",
              "Migration cannot be applied until living/active shapes, capability mappings, change-to-feature decisions, active RENAMED identities, authored artifact dispositions, and source digest binding are resolved.",
            );
          }
          applied = await writeMigrationTarget(inventory, mapping, target, planned);
        }

        if (json) {
          emitJson({
            command: "migrate-openspec",
            dryRun: applied === null,
            mappingPath,
            applied,
            ...inventory,
          });
        } else {
          printInventory(inventory, "migration");
          if (applied === null) console.log("\n  dry-run: no files were created or changed");
          else {
            console.log(`\n  staged migration docs  ${applied.directory}`);
            console.log(`  follow-up blockers      ${applied.followUpBlockers.length} (see FOLLOW-UP.md)`);
          }
        }
        if (!inventory.ready) process.exitCode = 1;
      } catch (error) {
        reportCommandError(json, error);
      }
    });
}

function reportCommandError(json: boolean, error: unknown): void {
  if (error instanceof OpenSpecRootError) {
    fail(json, "unknown-target", error.message);
    return;
  }
  if (error instanceof OpenSpecCommandError) {
    fail(json, error.code, error.message);
    return;
  }
  throw error;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function dictionary<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}

function ownValue<T>(record: Record<string, T>, key: string): T | undefined {
  return Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined;
}

function stringList(value: unknown, label: string): string[] {
  if (typeof value === "string") return value.trim() === "" ? [] : [value.trim()];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new OpenSpecCommandError("invalid-option", `${label} must be a string or an array of service ids.`);
  }
  return [...new Set(value.map((item) => (item as string).trim()).filter(Boolean))];
}

function serviceList(value: unknown, label: string): string[] {
  const services = stringList(value, label);
  for (const service of services) {
    const windowsStem = service.split(".")[0]!.toUpperCase();
    const windowsReserved = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/.test(windowsStem);
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(service)
      || service === "."
      || service === ".."
      || service.endsWith(".")
      || windowsReserved) {
      throw new OpenSpecCommandError(
        "invalid-option",
        `${label} contains unsafe service id '${service}'; use letters, digits, dot, underscore, or hyphen.`,
      );
    }
  }
  return services;
}

async function readMapping(path: string): Promise<OpenSpecMapping> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    throw new OpenSpecCommandError("unknown-target", `Cannot read OpenSpec mapping ${path}: ${message(error)}`);
  }
  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (error) {
    throw new OpenSpecCommandError("invalid-option", `OpenSpec mapping ${path} is invalid YAML: ${message(error)}`);
  }
  const document = asRecord(parsed);
  if (document === null || document.version !== 1) {
    throw new OpenSpecCommandError("invalid-option", `OpenSpec mapping ${path} must be a YAML mapping with version: 1.`);
  }
  const sourceNode = asRecord(document.source);
  const source = sourceNode !== null
    && typeof sourceNode.root === "string"
    && typeof sourceNode.inventoryDigest === "string"
    ? { root: sourceNode.root, inventoryDigest: sourceNode.inventoryDigest }
    : null;
  const capabilitiesNode = asRecord(document.capabilities);
  if (capabilitiesNode === null) {
    throw new OpenSpecCommandError("invalid-option", `OpenSpec mapping ${path} must contain a capabilities mapping.`);
  }
  const capabilities = dictionary<OpenSpecMapping["capabilities"][string]>();
  for (const [capability, value] of Object.entries(capabilitiesNode)) {
    const record = asRecord(value);
    const services = serviceList(record?.services ?? value, `capabilities.${capability}.services`);
    const requirementServices = dictionary<string[]>();
    if (record?.requirementServices !== undefined) {
      const allocations = asRecord(record.requirementServices);
      if (allocations === null) {
        throw new OpenSpecCommandError(
          "invalid-option",
          `capabilities.${capability}.requirementServices must be a mapping.`,
        );
      }
      for (const [requirement, selected] of Object.entries(allocations)) {
        requirementServices[requirement] = serviceList(
          selected,
          `capabilities.${capability}.requirementServices.${requirement}`,
        );
      }
    }
    capabilities[capability] = { services, requirementServices };
  }

  const changesNode = asRecord(document.changes);
  if (changesNode === null) {
    throw new OpenSpecCommandError("invalid-option", `OpenSpec mapping ${path} must contain a changes mapping.`);
  }
  const changes = dictionary<OpenSpecMapping["changes"][string]>();
  for (const [change, value] of Object.entries(changesNode)) {
    const record = asRecord(value);
    if (record === null) {
      throw new OpenSpecCommandError(
        "invalid-option",
        `changes.${change} must be a mapping with explicit feature and title fields.`,
      );
    }
    const featureValue = record.feature;
    if (featureValue !== null && typeof featureValue !== "string") {
      throw new OpenSpecCommandError("invalid-option", `changes.${change}.feature must be a string or null.`);
    }
    if (typeof record.title !== "string") {
      throw new OpenSpecCommandError("invalid-option", `changes.${change}.title must be a string.`);
    }
    changes[change] = {
      feature: typeof featureValue === "string" && featureValue.trim() !== "" ? featureValue.trim() : null,
      title: record.title,
    };
  }

  const renames = dictionary<string>();
  if (document.renames !== undefined) {
    const renamesNode = asRecord(document.renames);
    if (renamesNode === null) {
      throw new OpenSpecCommandError("invalid-option", `OpenSpec mapping ${path} renames must be a mapping.`);
    }
    for (const [key, value] of Object.entries(renamesNode)) {
      const record = asRecord(value);
      const requirementId = record !== null && "requirementId" in record ? record.requirementId : value;
      // A freshly generated skeleton deliberately uses null: it remains a
      // needsIdentity decision rather than becoming a malformed mapping.
      if (requirementId === null || requirementId === "") continue;
      if (typeof requirementId !== "string") {
        throw new OpenSpecCommandError("invalid-option", `renames.${key}.requirementId must be a string or null.`);
      }
      renames[key] = requirementId.trim();
    }
  }
  const artifacts = dictionary<OpenSpecArtifactDisposition>();
  if (document.artifacts !== undefined) {
    const artifactsNode = asRecord(document.artifacts);
    if (artifactsNode === null) {
      throw new OpenSpecCommandError("invalid-option", `OpenSpec mapping ${path} artifacts must be a mapping.`);
    }
    for (const [artifactPath, value] of Object.entries(artifactsNode)) {
      const record = asRecord(value);
      const disposition = record !== null && "disposition" in record ? record.disposition : value;
      if (disposition === null || disposition === "") continue;
      if (typeof disposition !== "string") {
        throw new OpenSpecCommandError("invalid-option", `artifacts.${artifactPath}.disposition must be a string or null.`);
      }
      artifacts[artifactPath] = disposition as OpenSpecArtifactDisposition;
    }
  }
  return { source, capabilities, changes, renames, artifacts };
}

function contains(parent: string, candidate: string): boolean {
  const rel = relative(parent, candidate);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

/** Resolve symlinks in the nearest existing ancestor of a not-yet-created path. */
async function canonicalForCreate(path: string): Promise<string> {
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

async function writeMappingSkeleton(
  inventory: OpenSpecInventory,
  outputArg: string,
  skeleton: OpenSpecMappingSkeleton,
): Promise<string> {
  const output = resolve(outputArg);
  const canonicalOutput = await canonicalForCreate(output);
  const canonicalSource = await realpath(inventory.inputRoot);
  if (contains(canonicalSource, canonicalOutput)) {
    throw new OpenSpecCommandError(
      "invalid-option",
      `Refusing to write the mapping inside the OpenSpec source workspace: ${output}`,
    );
  }
  if (existsSync(output)) {
    throw new OpenSpecCommandError("already-exists", `Mapping output already exists; refusing to overwrite it: ${output}`);
  }
  await mkdir(dirname(output), { recursive: true });
  try {
    await writeFile(output, stringifyYaml(skeleton, { lineWidth: 0 }), { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if (existsSync(output)) {
      throw new OpenSpecCommandError("already-exists", `Mapping output already exists; refusing to overwrite it: ${output}`);
    }
    throw error;
  }
  return output;
}

async function assertEmptyNonOverlappingStage(inventory: OpenSpecInventory, stage: string): Promise<void> {
  const canonicalStage = await canonicalForCreate(stage);
  const canonicalSource = await realpath(inventory.inputRoot);
  if (contains(canonicalSource, canonicalStage) || contains(canonicalStage, canonicalSource)) {
    throw new OpenSpecCommandError(
      "invalid-option",
      `Staging directory must not overlap the OpenSpec source workspace: ${stage}`,
    );
  }
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

function normalizedMapping(inventory: OpenSpecInventory, mapping: OpenSpecMapping): Record<string, unknown> {
  return {
    version: 1,
    source: { root: inventory.root, inventoryDigest: inventory.inventoryDigest },
    capabilities: Object.fromEntries(inventory.mappingDecisions.map((decision) => [
      decision.capability,
      {
        services: ownValue(mapping.capabilities, decision.capability)?.services ?? [],
        requirementServices: ownValue(mapping.capabilities, decision.capability)?.requirementServices ?? dictionary(),
      },
    ])),
    changes: Object.fromEntries(inventory.changeDecisions.map((decision) => [
      decision.change,
      {
        feature: ownValue(mapping.changes, decision.change)?.feature ?? null,
        title: ownValue(mapping.changes, decision.change)?.title ?? decision.title,
      },
    ])),
    renames: Object.fromEntries(
      inventory.renamed
        .filter((rename) => rename.scope === "active")
        .map((rename) => [rename.key, {
          from: rename.from,
          to: rename.to,
          existingRequirementId: rename.existingRequirementId,
          requirementId: rename.requirementId,
        }]),
    ),
    artifacts: Object.fromEntries(inventory.artifactDecisions.map((decision) => [
      decision.path,
      {
        kind: decision.kind,
          disposition: ownValue(mapping.artifacts, decision.path) ?? null,
      },
    ])),
  };
}

async function writeMigrationTarget(
  inventory: OpenSpecInventory,
  mapping: OpenSpecMapping,
  target: string,
  planned: { livingWrites: PlannedWrite[]; activeWrites: PlannedWrite[] },
): Promise<{ directory: string; files: string[]; followUpBlockers: string[] }> {
  await assertEmptyNonOverlappingStage(inventory, target);
  // All migration content was read while planning. Re-hash after those reads so
  // a source edit between audit and materialization cannot produce a mixed snapshot.
  const refreshed = await inventoryOpenSpec(inventory.inputRoot, { mapping });
  if (!refreshed.ready || refreshed.inventoryDigest !== inventory.inventoryDigest) {
    throw new OpenSpecCommandError(
      "invalid-option",
      "OpenSpec source changed while the migration plan was being materialized; re-audit and review a new mapping.",
    );
  }
  const followUpBlockers = [
    "Add architecture/landscape.likec4 and bind every staged service to a C4 element.",
    "Add each service model.likec4 and OpenAPI contract; migrated requirements have no Operations/Covers links yet unless authored upstream.",
    "Set truthful sources from each service repository, validate, and have a human run loam vouch; staged specs remain status: draft.",
    ...(inventory.changes.active.length === 0
      ? []
      : [
          `Review ${inventory.changes.active.length} staged feature(s), add their LikeC4/OpenAPI deltas, and resolve any retained or manual-review OpenSpec artifacts recorded in migration-plan.json.`,
          // OpenSpec has no equivalent of `Based-On:`, so every migrated
          // MODIFIED/REMOVED requirement arrives unpinned (`delta.baseline-missing`,
          // a warning by design — a corpus that cannot archive is not a safety
          // property). Until someone runs this, two migrated features rewriting
          // one requirement still lose the loser's text silently.
          "Run `loam rebase <FEAT>` per staged feature: OpenSpec deltas carry no Based-On, so no MODIFIED/REMOVED requirement is pinned to the living text it was written against.",
        ]),
    "Review config context/rules, Purpose prose, Stores/references, custom schemas, and every artifact disposition in migration-plan.json.",
  ];
  const plan = {
    version: 1,
    generatedBy: "loam migrate-openspec",
    source: { inputRoot: inventory.inputRoot, root: inventory.root },
    baselines: inventory.baselines,
    readiness: inventory.readiness,
    mapping: normalizedMapping(inventory, mapping),
    living: inventory.living,
    activeChanges: inventory.changes.active,
    archiveDiagnostics: inventory.archiveDiagnostics,
    artifactDisposition: inventory.artifacts.map((artifact) => ({
      ...artifact,
      disposition: ownValue(mapping.artifacts, artifact.path) ?? artifact.disposition,
      selectedDisposition: ownValue(mapping.artifacts, artifact.path) ?? null,
    })),
    followUpBlockers,
    note: "Staged migration docs only. Living specs and mapped active changes were materialized without changing the OpenSpec source or live loam docs. The result is intentionally not expected to validate green until the listed architecture, API, provenance, and review work is completed.",
  };
  const writes: PlannedWrite[] = [
    { path: join(target, "migration-plan.json"), content: `${JSON.stringify(plan, null, 2)}\n` },
    { path: join(target, "mapping.yaml"), content: stringifyYaml(normalizedMapping(inventory, mapping), { lineWidth: 0 }) },
    { path: join(target, "FOLLOW-UP.md"), content: renderFollowUp(followUpBlockers) },
    ...planned.livingWrites,
    ...planned.activeWrites,
  ];
  assertDistinctPlannedPaths(writes);
  for (const write of writes) write.exclusive = true;
  const staged = await stageWrites(writes);
  if (staged.some((item) => item.before !== null)) {
    await rollbackStaged(staged);
    throw new OpenSpecCommandError(
      "already-exists",
      "Staging target changed after its emptiness check; refusing to overwrite a concurrently created file.",
    );
  }
  try {
    await swapStaged(staged);
  } catch (error) {
    const failures = await rollbackStaged(staged);
    const code = typeof error === "object" && error !== null && "code" in error ? error.code : null;
    if (code === "EEXIST" && failures.length === 0) {
      throw new OpenSpecCommandError(
        "already-exists",
        "Staging target changed during apply; the migration was rolled back without overwriting the concurrent file.",
      );
    }
    throw rollbackError(error, failures);
  }
  return { directory: target, files: writes.map((write) => write.path), followUpBlockers };
}

async function planMigrationWrites(
  inventory: OpenSpecInventory,
  mapping: OpenSpecMapping,
  target: string,
): Promise<{ livingWrites: PlannedWrite[]; activeWrites: PlannedWrite[] }> {
  const livingWrites = await materializeLivingSpecs(inventory, mapping, target);
  const activeWrites = await materializeActiveChanges(inventory, mapping, target);
  assertDistinctPlannedPaths([...livingWrites, ...activeWrites]);
  return { livingWrites, activeWrites };
}

function assertDistinctPlannedPaths(writes: PlannedWrite[]): void {
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

function assertMaterializedRequirementIds(where: string, requirements: Requirement[]): void {
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

async function materializeLivingSpecs(
  inventory: OpenSpecInventory,
  mapping: OpenSpecMapping,
  target: string,
): Promise<PlannedWrite[]> {
  const byService = new Map<string, Requirement[]>();
  const renameIds = new Map(
    inventory.renamed
      .filter((rename) => rename.scope === "active" && rename.from !== null && rename.requirementId !== null)
      .map((rename) => [`${rename.capability}\0${rename.from}`, rename.requirementId!] as const),
  );
  for (const capability of inventory.living.capabilities) {
    const selected = ownValue(mapping.capabilities, capability.id);
    if (selected === undefined) continue; // readiness prevents this on --apply
    const raw = await readFile(join(inventory.root, capability.files[0]!), "utf8");
    const requirements = parseRequirements(raw);
    for (const parsed of requirements) {
      const renamedId = renameIds.get(`${capability.id}\0${parsed.name}`);
      const requirement = renamedId === undefined ? parsed : { ...parsed, id: renamedId };
      const services = selected.services.length === 1
        ? selected.services
        : ownValue(selected.requirementServices, requirement.name) ?? [];
      for (const service of services) {
        const existing = byService.get(service) ?? [];
        const identity = requirement.id === undefined ? `heading '${requirement.name}'` : `Requirement-ID '${requirement.id}'`;
        if (existing.some((item) =>
          item.name === requirement.name
          || (item.id !== undefined && requirement.id !== undefined && item.id === requirement.id))) {
          throw new OpenSpecCommandError(
            "invalid-option",
            `Mapped living specs collide in service '${service}' on ${identity}; refine the capability/requirement allocation before --apply.`,
          );
        }
        existing.push({ ...requirement, kind: "BASE" });
        byService.set(service, existing);
      }
    }
  }
  return [...byService.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([service, requirements]) => {
      assertMaterializedRequirementIds(`Mapped living service '${service}'`, requirements);
      return {
        path: join(target, "services", service, "spec.md"),
        content: `---\n${stringifyYaml({ service, status: "draft" }, { lineWidth: 0 }).trimEnd()}\n---\n\n# ${service}\n\n<!-- Staged from OpenSpec. Add truthful sources and complete C4/OpenAPI links before validation/vouch. -->\n\n## Requirements\n\n${serializeRequirements(requirements)}`,
      };
    });
}

function featureSlug(title: string, changeId: string): string {
  const slug = (text: string): string => text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug(title) || slug(changeId) || "openspec-change";
}

function selectedServices(
  mapping: OpenSpecMapping,
  capability: string,
  requirement: string,
): string[] {
  const selected = ownValue(mapping.capabilities, capability);
  if (selected === undefined) return [];
  return selected.services.length === 1
    ? selected.services
    : ownValue(selected.requirementServices, requirement) ?? [];
}

function serializeDeltaRequirements(requirements: Requirement[]): string {
  const sections: string[] = [];
  for (const kind of ["ADDED", "MODIFIED", "REMOVED"] as const) {
    const group = requirements.filter((requirement) => requirement.kind === kind);
    if (group.length > 0) sections.push(`## ${kind} Requirements\n\n${serializeRequirements(group).trimEnd()}`);
  }
  return `${sections.join("\n\n")}\n`;
}

function migrationFrontmatter(feature: string, title: string): string {
  return `---\n${stringifyYaml({ feature, title, status: "proposed" }, { lineWidth: 0 }).trimEnd()}\n---`;
}

interface AuthoredArtifactCopy {
  path: string;
  disposition: OpenSpecArtifactDisposition;
  raw: string;
}

function renderAuthoredBundle(heading: string, artifacts: AuthoredArtifactCopy[]): string {
  return `${heading}\n\n${artifacts.map((artifact) => [
    `<!-- OpenSpec source: ${artifact.path}; disposition: ${artifact.disposition}. -->`,
    artifact.raw.trimEnd(),
  ].join("\n\n")).join("\n\n---\n\n")}\n`;
}

function safeArtifactRelative(changeId: string, artifactPath: string): string[] {
  const prefix = `changes/${changeId}/`;
  if (!artifactPath.startsWith(prefix)) {
    throw new OpenSpecCommandError(
      "invalid-option",
      `OpenSpec change '${changeId}' contains an artifact outside its change directory: ${artifactPath}.`,
    );
  }
  const segments = artifactPath.slice(prefix.length).split("/");
  if (segments.length === 0 || segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new OpenSpecCommandError("invalid-option", `OpenSpec artifact has an unsafe relative path: ${artifactPath}.`);
  }
  return segments;
}

async function materializeActiveChanges(
  inventory: OpenSpecInventory,
  mapping: OpenSpecMapping,
  target: string,
): Promise<PlannedWrite[]> {
  const writes: PlannedWrite[] = [];
  const livingByCapability = new Map<string, Requirement[]>();
  for (const capability of inventory.living.capabilities) {
    livingByCapability.set(
      capability.id,
      parseRequirements(await readFile(join(inventory.root, capability.files[0]!), "utf8")),
    );
  }
  const inventoryArtifactsByPath = new Map(inventory.artifacts.map((artifact) => [artifact.path, artifact]));

  for (const change of inventory.changes.active) {
    const decision = inventory.changeDecisions.find((item) => item.change === change.id);
    const feature = ownValue(mapping.changes, change.id)?.feature ?? null;
    if (decision === undefined || feature === null) continue; // readiness prevents this on --apply
    const featureDir = join(target, "features", `${feature}-${featureSlug(decision.title, change.id)}`);

    // Preserve the complete authored source change tree, including metadata,
    // rename syntax, custom artifacts, and original delta section ordering.
    for (const artifactPath of change.artifacts) {
      const segments = safeArtifactRelative(change.id, artifactPath);
      writes.push({
        path: join(featureDir, "legacy", "openspec", ...segments),
        content: await readFile(join(inventory.root, artifactPath), "utf8"),
      });
    }

    const authored: Array<AuthoredArtifactCopy & { kind: "proposal" | "tasks" | "change-design" }> = [];
    for (const artifactDecision of inventory.artifactDecisions) {
      const artifact = inventoryArtifactsByPath.get(artifactDecision.path);
      if (artifact?.changeId !== change.id) continue;
      const disposition = ownValue(mapping.artifacts, artifactDecision.path);
      if (disposition === undefined) continue; // readiness prevents this on --apply
      authored.push({
        path: artifactDecision.path,
        kind: artifactDecision.kind,
        disposition,
        raw: await readFile(join(inventory.root, artifactDecision.path), "utf8"),
      });
    }

    const convertedProposals = authored.filter(
      (artifact) => artifact.kind === "proposal" && artifact.disposition === "convert-to-intent",
    );
    const retainedProposals = authored.filter(
      (artifact) => artifact.kind === "proposal" && artifact.disposition !== "convert-to-intent",
    );
    const intentBody = convertedProposals.length > 0
      ? renderAuthoredBundle("## Migrated OpenSpec proposal", convertedProposals)
      : "No proposal was converted into this intent. Review the retained OpenSpec artifacts and migration-plan.json before promotion.\n";
    writes.push({
      path: join(featureDir, "intent.md"),
      content: `${migrationFrontmatter(feature, decision.title)}\n\n# ${decision.title}\n\n<!-- Staged from OpenSpec change '${change.id}'. This feature is deliberately not validation-green yet. -->\n\n${intentBody}`,
    });
    if (retainedProposals.length > 0) {
      writes.push({
        path: join(featureDir, "legacy", "proposal.md"),
        content: renderAuthoredBundle("# Retained OpenSpec proposal", retainedProposals),
      });
    }

    const tasks = authored.filter((artifact) => artifact.kind === "tasks");
    if (tasks.length > 0) {
      writes.push({
        path: join(featureDir, "legacy", "tasks.md"),
        content: renderAuthoredBundle("# OpenSpec task checklist", tasks),
      });
    }
    const reviewedDesigns = authored.filter(
      (artifact) => artifact.kind === "change-design" && artifact.disposition === "review-as-feature-adr",
    );
    if (reviewedDesigns.length > 0) {
      writes.push({
        path: join(featureDir, "adrs", "openspec-design.md"),
        content: renderAuthoredBundle("# OpenSpec design (review required)", reviewedDesigns),
      });
    }
    const retainedDesigns = authored.filter(
      (artifact) => artifact.kind === "change-design" && artifact.disposition !== "review-as-feature-adr",
    );
    if (retainedDesigns.length > 0) {
      writes.push({
        path: join(featureDir, "legacy", "design.md"),
        content: renderAuthoredBundle("# Retained OpenSpec design", retainedDesigns),
      });
    }

    if (change.metadata.skipSpecs) continue;
    const deltaByService = new Map<string, Requirement[]>();
    const changeRenames = inventory.renamed.filter(
      (item) => item.scope === "active" && item.changeId === change.id,
    );
    const materializedRenameKeys = new Set<string>();
    const addDelta = (service: string, requirement: Requirement, origin: string): void => {
      const existing = deltaByService.get(service) ?? [];
      const collision = existing.find((item) =>
        item.name === requirement.name
        || (item.id !== undefined && requirement.id !== undefined && item.id === requirement.id));
      if (collision !== undefined) {
        const identity = requirement.id === undefined ? requirement.name : requirement.id;
        throw new OpenSpecCommandError(
          "invalid-option",
          `Active change '${change.id}' produces colliding requirement '${identity}' in service '${service}' while materializing ${origin}.`,
        );
      }
      existing.push(requirement);
      deltaByService.set(service, existing);
    };

    for (const spec of change.specs) {
      const requirements = parseRequirements(await readFile(join(inventory.root, spec.path), "utf8"))
        .filter((requirement) => requirement.kind !== "BASE");
      for (const parsed of requirements) {
        const matchingRenames = changeRenames.filter((rename) =>
          rename.capability === spec.capability
          && rename.from !== null
          && rename.to !== null
          && (parsed.name === rename.from || parsed.name === rename.to));
        if (matchingRenames.length > 1) {
          throw new OpenSpecCommandError(
            "invalid-option",
            `Active change '${change.id}' requirement '${parsed.name}' matches multiple RENAMED pairs.`,
          );
        }
        const rename = matchingRenames[0];
        let requirement = parsed;
        let routingName = parsed.name;
        if (rename !== undefined && rename.from !== null && rename.to !== null && rename.requirementId !== null) {
          if (parsed.kind !== "MODIFIED") {
            throw new OpenSpecCommandError(
              "invalid-option",
              `Active change '${change.id}' combines RENAMED '${rename.from}' → '${rename.to}' with ${parsed.kind} '${parsed.name}'; review the conflicting delta before --apply.`,
            );
          }
          if (parsed.id !== undefined && parsed.id !== rename.requirementId) {
            throw new OpenSpecCommandError(
              "invalid-option",
              `Active change '${change.id}' MODIFIED requirement '${parsed.name}' has Requirement-ID '${parsed.id}', but its RENAMED source resolves to '${rename.requirementId}'.`,
            );
          }
          const annotation = `OpenSpec-Living-Source: ${rename.capability} :: ${rename.from}`;
          requirement = {
            ...parsed,
            id: rename.requirementId,
            name: rename.to,
            text: parsed.text.includes(annotation) ? parsed.text : [...parsed.text, "", annotation],
            section: "## MODIFIED Requirements",
          };
          routingName = rename.from;
          materializedRenameKeys.add(rename.key);
        }
        for (const service of selectedServices(mapping, spec.capability, routingName)) {
          addDelta(service, requirement, spec.path);
        }
      }
    }
    for (const rename of changeRenames) {
      if (materializedRenameKeys.has(rename.key)) continue;
      if (rename.from === null || rename.to === null || rename.requirementId === null) continue;
      const source = (livingByCapability.get(rename.capability) ?? [])
        .filter((requirement) => requirement.name === rename.from)[0];
      if (source === undefined) continue; // readiness prevents this on --apply
      const annotation = `OpenSpec-Living-Source: ${rename.capability} :: ${rename.from}`;
      const text = source.text.includes(annotation) ? source.text : [...source.text, "", annotation];
      const modified: Requirement = {
        ...source,
        kind: "MODIFIED",
        id: rename.requirementId,
        name: rename.to,
        text,
        section: "## MODIFIED Requirements",
      };
      for (const service of selectedServices(mapping, rename.capability, rename.from)) {
        addDelta(service, modified, rename.path);
      }
    }
    for (const [service, requirements] of [...deltaByService].sort(([a], [b]) => a.localeCompare(b))) {
      assertMaterializedRequirementIds(
        `Active change '${change.id}' mapped to service '${service}'`,
        requirements,
      );
      writes.push({
        path: join(featureDir, "specs", service, "spec.md"),
        content: serializeDeltaRequirements(requirements),
      });
    }
  }
  return writes;
}

function renderFollowUp(blockers: string[]): string {
  return `# Staged OpenSpec migration: required follow-up\n\nThis target contains migrated living requirements, mapped active feature deltas, preserved source artifacts, and a review plan. It is deliberately not presented as a fully valid loam fleet. Complete every item before moving it into live docs.\n\n${blockers.map((item) => `- [ ] ${item}`).join("\n")}\n`;
}

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

function printInventory(inventory: OpenSpecInventory, mode: "audit" | "migration"): void {
  const status = inventory.ready
    ? "ready"
    : inventory.mechanicallyCompatible
      ? "compatible; explicit mapping/identity decisions remain"
      : "living or active blockers found";
  console.log(`OpenSpec ${mode} inventory — ${status}`);
  console.log(`  root          ${inventory.root}`);
  console.log(
    `  baseline      release ${inventory.baselines.release.version}@${inventory.baselines.release.commit} · main canary ${inventory.baselines.mainCanary.commit.slice(0, 7)}`,
  );
  console.log(
    `  living       ${plural(inventory.living.capabilities.length, "capability", "capabilities")} · ${plural(inventory.living.specFiles, "spec file")} · ${plural(inventory.living.requirements, "requirement")} · ${plural(inventory.living.scenarios, "scenario")}`,
  );
  console.log(
    `  changes      ${inventory.changes.counts.active} active · ${inventory.changes.counts.archived} archived`,
  );
  console.log(
    `  readiness    living ${inventory.readiness.living.compatible ? "ok" : "blocked"} · active ${inventory.readiness.active.compatible ? "ok" : "blocked"} · source ${inventory.readiness.sourceCurrent ? "current" : "stale"} · capabilities ${inventory.readiness.mappingsResolved ? "resolved" : "open"} · changes ${inventory.readiness.changesResolved ? "resolved" : "open"} · dispositions ${inventory.readiness.dispositionsResolved ? "resolved" : "open"} · archive ${inventory.archiveDiagnostics.length} diagnostic(s)`,
  );

  if (inventory.needsMapping.length > 0) {
    console.log("\n  capability → service decisions");
    for (const decision of inventory.needsMapping) {
      console.log(`    ? ${decision.capability} → ${decision.suggestedService}  [${decision.status}]`);
    }
  }
  if (inventory.needsChangeMapping.length > 0) {
    console.log("\n  change → feature decisions");
    for (const decision of inventory.needsChangeMapping) {
      console.log(`    ? ${decision.change} → ${decision.suggestedFeature}  [${decision.status}]`);
    }
  }
  const activeRenames = inventory.renamed.filter((rename) => rename.scope === "active");
  if (activeRenames.length > 0) {
    console.log("\n  RENAMED identity decisions");
    for (const rename of activeRenames) {
      console.log(
        `    ${rename.status === "mapped" ? "✓" : "?"} ${rename.key}  ${rename.from ?? "<missing FROM>"} → ${rename.to ?? "<missing TO>"}${rename.requirementId ? `  [${rename.requirementId}]` : ""}`,
      );
    }
  }
  if (inventory.needsDisposition.length > 0) {
    console.log(`\n  authored artifact decisions (${inventory.needsDisposition.length})`);
    for (const decision of inventory.needsDisposition.slice(0, 12)) {
      console.log(`    ? ${decision.path} → ${decision.suggestedDisposition}  [${decision.status}]`);
    }
    if (inventory.needsDisposition.length > 12) {
      console.log(`    … ${inventory.needsDisposition.length - 12} more in --json/mapping output`);
    }
  }
  if (inventory.mappingIssues.length > 0) {
    console.log("\n  mapping issues");
    for (const item of inventory.mappingIssues) console.log(`    ✗ ${item.code}  ${item.message}`);
  }
  if (inventory.unsupported.length > 0) {
    console.log("\n  living/active blockers");
    for (const item of inventory.unsupported) {
      console.log(`    ✗ ${item.code}  ${item.path} — ${item.message}`);
    }
  }
  if (inventory.archiveDiagnostics.length > 0) {
    console.log(`\n  archive diagnostics (non-blocking, ${inventory.archiveDiagnostics.length})`);
    for (const item of inventory.archiveDiagnostics.slice(0, 12)) {
      console.log(`    · ${item.code}  ${item.path} — ${item.message}`);
    }
    if (inventory.archiveDiagnostics.length > 12) {
      console.log(`    … ${inventory.archiveDiagnostics.length - 12} more in --json output`);
    }
  }
  const dispositions = new Map<string, number>();
  for (const artifact of inventory.artifacts) {
    dispositions.set(artifact.disposition, (dispositions.get(artifact.disposition) ?? 0) + 1);
  }
  if (dispositions.size > 0) {
    console.log("\n  artifact disposition");
    for (const [disposition, count] of [...dispositions].sort(([a], [b]) => a.localeCompare(b))) {
      console.log(`    · ${disposition}  ${count}`);
    }
  }
}
