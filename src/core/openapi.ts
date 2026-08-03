import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { featureSpecPaths, servicePaths } from "./repo.js";

/**
 * The path-item keys that hold operations. A path item also carries `summary`,
 * `parameters`, `servers` and vendor `x-*` extensions — an object-valued one with
 * an `operationId` inside (x-legacy and friends) is not an operation, and a
 * phantom id from it would make a broken contract look "available" to the
 * op-exists checks.
 */
const HTTP_METHODS = new Set(["get", "put", "post", "delete", "options", "head", "patch", "trace"]);

/**
 * Extract operationIds from an OpenAPI document by walking the parsed YAML
 * structure (paths.<path>.<method>.operationId, method filtered to the HTTP
 * set). Structure-aware on purpose: a regex scan both drops legal ids
 * (kebab-case, dotted) and picks up phantom ids from description text.
 * Returns the defined set (deduped, document order).
 * An unreadable document yields [] — its contract can prove nothing.
 */
export async function operationIds(openapiPath: string): Promise<string[]> {
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
  const ids = new Set<string>();
  for (const item of Object.values(paths as Record<string, unknown>)) {
    if (!item || typeof item !== "object") continue;
    for (const [method, op] of Object.entries(item as Record<string, unknown>)) {
      if (!HTTP_METHODS.has(method)) continue;
      if (!op || typeof op !== "object") continue;
      const id = (op as Record<string, unknown>)["operationId"];
      if (typeof id === "string" && id.length > 0) ids.add(id);
    }
  }
  return [...ids];
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
