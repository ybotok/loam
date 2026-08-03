import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { featureSpecPaths, servicePaths } from "./repo.js";

/**
 * The path-item keys that hold operations. A path item also carries `summary`,
 * `parameters`, `servers` and vendor `x-*` extensions — an object-valued one with
 * an `operationId` inside (x-legacy and friends) is not an operation, and a
 * phantom id from it would make a broken contract look "available" to the
 * op-exists checks. Shared with archive's merge, which asks the same question
 * of the same keys.
 */
export const HTTP_METHODS = new Set(["get", "put", "post", "delete", "options", "head", "patch", "trace"]);

/** One operation as the reader sees it: its id, and whether the contract marks it `deprecated: true`. */
export interface Operation {
  id: string;
  /**
   * The standard per-operation OpenAPI `deprecated` flag — lifecycle
   * visibility, the documented first step of retiring an op. loam has no
   * removal semantics: the operation stays defined and callable until a human
   * deletes it from the contract.
   */
  deprecated: boolean;
}

/**
 * Extract operations from an OpenAPI document by walking the parsed YAML
 * structure (paths.<path>.<method>, method filtered to the HTTP set).
 * Structure-aware on purpose: a regex scan both drops legal ids (kebab-case,
 * dotted) and picks up phantom ids from description text. Each operation
 * carries its id and its `deprecated: true` flag (exactly `true` counts —
 * strings and truthy noise do not). Returns the defined set (deduped by id,
 * document order, first occurrence wins).
 * An unreadable document yields [] — its contract can prove nothing.
 */
export async function operations(openapiPath: string): Promise<Operation[]> {
  if (!existsSync(openapiPath)) return [];
  const text = await readFile(openapiPath, "utf8");
  let doc: unknown;
  try {
    doc = parse(text);
  } catch {
    return [];
  }
  const paths = (doc as { paths?: unknown } | null)?.paths;
  if (!paths || typeof paths !== "object") return [];
  const ops = new Map<string, Operation>();
  for (const item of Object.values(paths as Record<string, unknown>)) {
    if (!item || typeof item !== "object") continue;
    for (const [method, op] of Object.entries(item as Record<string, unknown>)) {
      if (!HTTP_METHODS.has(method)) continue;
      if (!op || typeof op !== "object") continue;
      const id = (op as Record<string, unknown>)["operationId"];
      if (typeof id === "string" && id.length > 0 && !ops.has(id)) {
        ops.set(id, { id, deprecated: (op as Record<string, unknown>)["deprecated"] === true });
      }
    }
  }
  return [...ops.values()];
}

/** The operationIds alone — `operations` for every caller that asks only "does it exist". */
export async function operationIds(openapiPath: string): Promise<string[]> {
  return (await operations(openapiPath)).map((o) => o.id);
}

/**
 * The operationIds a service provides — its living `openapi.yaml`, plus a feature's
 * `openapi.yaml` delta for that service (a feature can add endpoints to a service, or
 * define a brand-new service's API).
 */
export async function serviceOperationIds(
  docsDir: string,
  service: string,
  featureDir?: string,
): Promise<string[]> {
  const ids = new Set<string>();
  if (featureDir) {
    for (const id of await operationIds(featureSpecPaths(featureDir, service).openapi)) ids.add(id);
  }
  for (const id of await operationIds(servicePaths(docsDir, service).openapi)) ids.add(id);
  return [...ids];
}
