import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Extract operationIds from an OpenAPI document. A light regex read (operationIds are
 * unique tokens under paths.*.*), avoiding a YAML dependency for the MVP.
 */
export async function operationIds(openapiPath: string): Promise<string[]> {
  if (!existsSync(openapiPath)) return [];
  const text = await readFile(openapiPath, "utf8");
  const ids: string[] = [];
  const re = /^\s*operationId:\s*['"]?([A-Za-z0-9_]+)['"]?\s*$/gm;
  for (const m of text.matchAll(re)) ids.push(m[1]!);
  return ids;
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
    for (const id of await operationIds(join(featureDir, "specs", service, "openapi.yaml"))) ids.add(id);
  }
  for (const id of await operationIds(join(docsDir, "services", service, "openapi.yaml"))) ids.add(id);
  return [...ids];
}
