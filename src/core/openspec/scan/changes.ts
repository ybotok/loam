/**
 * One `changes/<id>/` directory read end to end: its metadata, its spec files,
 * and every artifact it holds.
 *
 * Active and archived changes come through the same reader with a different
 * scope, because they are the same shape and only the consequences differ — an
 * archive finding is a diagnostic, an active one blocks. Keeping that in the
 * scope rather than in two readers is what stops the two drifting into two
 * ideas of what a change looks like.
 */
import { existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { asRecord } from "../../kernel/records.js";
import { compareIds } from "../../repo/entries.js";
import { inspectSpecFile } from "./shape.js";
import {
  type OpenSpecArtifact,
  type OpenSpecArtifactDisposition,
  type OpenSpecArtifactKind,
  type OpenSpecArtifactScope,
  type OpenSpecChange,
  type OpenSpecChangeMetadata,
  type OpenSpecChangeSpec,
  type OpenSpecCounts,
  type OpenSpecUnsupportedShape,
} from "../model/model.js";
import { schemaSpecPolicy } from "./config.js";
import {
  isSymbolicLink,
  isStringArray,
  portable,
  sourceInventoryPath,
  walkFiles,
  yamlRecord,
} from "./walk.js";
import { addCounts, issue } from "./shape.js";
import { type Ingest } from "./workspace.js";

const CHANGE_CREATED_RE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

export async function inspectChangeMetadata(
  ingest: Ingest,
  dir: string,
  scope: "active" | "archive",
  fallbackSchema: string | null,
): Promise<OpenSpecChangeMetadata> {
  const { root, unsupported } = ingest;
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
      issue(unsupported, scope, {
        code: "openspec.change-metadata-invalid",
        path: path,
        message: message,
      });
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
    issue(unsupported, scope, {
      code: "openspec.change-metadata-invalid",
      path: path,
      message: `Change metadata is invalid: ${error instanceof Error ? error.message : String(error)}`,
    });
    return { path, schema: fallbackSchema, skipSpecs: false, created: null, fields: [] };
  }
}

/** One tree of change directories — `changes/` or `changes/archive/`. */
export interface ChangeTree {
  /** The directory the ids sit under. */
  base: string;
  ids: string[];
  /** Active findings block a migration; archive findings are diagnostics. */
  scope: "active" | "archive";
  /** The workspace schema a change inherits unless it overrides it. */
  fallbackSchema: string | null;
  /**
   * Where this tree's findings land, and the only reason the tree is a record
   * rather than four arguments: an ACTIVE finding blocks a migration while an
   * ARCHIVE one is a diagnostic over frozen history, so the two walks are the
   * same code writing to different lists. Reading the list off the `Ingest`
   * instead put an archive diagnostic among the blockers and made a corpus with
   * a specless archived change unmigratable.
   */
  findings: OpenSpecUnsupportedShape[];
}

export async function inventoryChanges(ingest: Ingest, tree: ChangeTree): Promise<OpenSpecChange[]> {
  const { base, ids, scope, fallbackSchema, findings: unsupported } = tree;
  const { root } = ingest;
  const scoped: Ingest = { ...ingest, unsupported };
  const changes: OpenSpecChange[] = [];
  for (const id of ids) {
    const dir = join(base, id);
    const allArtifacts = await walkFiles(dir);
    const specRoot = join(dir, "specs");
    const allSpecs = await walkFiles(specRoot);
    const specFiles = allSpecs.filter((path) => basename(path) === "spec.md");
    const metadata = await inspectChangeMetadata(scoped, dir, scope, fallbackSchema);
    const counts: OpenSpecCounts = { specFiles: 0, requirements: 0, scenarios: 0 };
    const files: string[] = [];
    const specs: OpenSpecChangeSpec[] = [];
    for (const specFile of specFiles) {
      const inspected = await inspectSpecFile(scoped, specFile, "change", scope);
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
      issue(unsupported, scope, {
        code: "openspec.change-schema-unresolved",
        path: metadata.path ?? portable(root, dir),
        message: `Change schema '${metadata.schema ?? "<missing>"}' cannot be resolved to a readable built-in or project schema.`,
      });
    }
    if (metadata.skipSpecs && allSpecs.length > 0) {
      issue(unsupported, scope, {
        code: "openspec.skip-specs-with-specs",
        path: portable(root, specRoot),
        message: "skip_specs: true conflicts with authored content under specs/; remove the marker or review and remove the spec tree.",
      });
    }
    const permitsNoSpecs = schemaPolicy.resolved && metadata.skipSpecs;
    if (specFiles.length === 0 && schemaPolicy.resolved && !permitsNoSpecs) {
      issue(unsupported, scope, {
        code: "openspec.change-no-specs",
        path: portable(root, dir),
        message: "Change has no specs/<capability>/spec.md files and does not opt out with a valid, schema-resolved skip_specs: true marker.",
      });
    }
    for (const file of allSpecs.filter((path) => path.endsWith(".md") && basename(path) !== "spec.md")) {
      issue(unsupported, scope, {
        code: "openspec.nonstandard-change-spec",
        path: portable(root, file),
        message: "Markdown under a change specs/ tree is not named spec.md.",
      });
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

export function artifactScope(path: string): OpenSpecArtifactScope {
  if (path.startsWith("changes/archive/")) return "archive";
  if (/^changes\/[^/]+\//.test(path)) return "active";
  if (path.startsWith("specs/")) return "living";
  return "workspace";
}

export function artifactFor(root: string, absolute: string): OpenSpecArtifact {
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

export function sortIssues(issues: OpenSpecUnsupportedShape[]): void {
  issues.sort((a, b) => compareIds(a.path, b.path) || compareIds(a.code, b.code));
}

export function titleFromChangeId(id: string): string {
  const words = id.split(/[-_]+/).filter(Boolean);
  const text = words.join(" ");
  return text === "" ? id : text[0]!.toUpperCase() + text.slice(1);
}
