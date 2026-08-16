/**
 * `openspec/config.yaml` and the project schemas it can point at.
 *
 * The schema policy is here rather than with the change reader because it is a
 * WORKSPACE fact: a change inherits its schema from the config unless it
 * overrides it, so a per-change reader that resolved schemas itself would
 * resolve the same registered file once per change and could disagree with
 * itself about whether it validates.
 */
import { existsSync } from "node:fs";
import { lstat, readdir, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import { asRecord } from "../../kernel/records.js";
import { compareIds } from "../../repo/entries.js";
import { type OpenSpecConfigSummary, type OpenSpecUnsupportedShape } from "../model/model.js";
import { isSymbolicLink, isStringArray, yamlRecord } from "./walk.js";
import { issue } from "./shape.js";

export async function inspectConfig(
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
    issue(unsupported, "workspace", {
      code: "openspec.config-invalid",
      path: "config.yaml",
      message: `OpenSpec config.yaml is invalid: ${error instanceof Error ? error.message : String(error)}`,
    });
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

export function isContainedPath(parent: string, candidate: string): boolean {
  const rel = relative(parent, candidate);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

/**
 * Resolve only a schema that OpenSpec could enumerate as one direct, portable
 * member of this workspace's schemas/ directory. Constructing a path from the
 * metadata value first would let `../` (or a platform-specific separator) read
 * bytes outside the inventoried tree and then authorize `skip_specs` with them.
 */
export async function registeredProjectSchemaPath(
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

export function validArtifactSchema(document: Record<string, unknown>): boolean {
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

export async function schemaSpecPolicy(
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
