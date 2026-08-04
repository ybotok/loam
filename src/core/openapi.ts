import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import type { FleetContext } from "./fleet-context.js";
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

/** The parse of one OpenAPI document: its operations, and whether the file could be read at all. */
export interface OpenapiDoc {
  ops: Operation[];
  /**
   * True when the file EXISTS but cannot be read as an OpenAPI document —
   * broken YAML, or a document that is not a mapping. A missing file is not
   * unreadable (absence is `service.no-openapi`'s question), and an empty one
   * parses to null and honestly defines nothing.
   */
  unreadable: boolean;
  /** The parser's own message, when there is one to quote back. */
  error?: string;
}

/**
 * Extract operations from an OpenAPI document by walking the parsed YAML
 * structure (paths.<path>.<method>, method filtered to the HTTP set).
 * Structure-aware on purpose: a regex scan both drops legal ids (kebab-case,
 * dotted) and picks up phantom ids from description text. Each operation
 * carries its id and its `deprecated: true` flag (exactly `true` counts —
 * strings and truthy noise do not). `ops` is the defined set (deduped by id,
 * document order, first occurrence wins).
 *
 * An unreadable document yields [] ops PLUS the `unreadable` flag. Parsers
 * never diagnose — the policy of every reader here — so the failure travels as
 * a flag for validate to grade (`openapi.invalid`). Swallowing it into a bare
 * [] made a broken contract indistinguishable from an EMPTY one, and the spine
 * check then reported every inbound edge broken (`spine.op-undefined`) — a
 * false diagnosis pointing at the landscape when the truth was this file.
 */
export async function readOpenapi(openapiPath: string, context?: FleetContext): Promise<OpenapiDoc> {
  if (context !== undefined) return context.readOpenapi(openapiPath);
  if (!existsSync(openapiPath)) return { ops: [], unreadable: false };
  const text = await readFile(openapiPath, "utf8");
  let doc: unknown;
  try {
    doc = parse(text);
  } catch (e) {
    return { ops: [], unreadable: true, error: e instanceof Error ? e.message : String(e) };
  }
  // A scalar or sequence document is as unreadable as broken YAML: there is no
  // mapping to look `paths` up in, so nothing can be concluded from it. null
  // (an empty file) stays readable — it defines nothing, and says so honestly.
  if (doc !== null && (typeof doc !== "object" || Array.isArray(doc))) {
    return { ops: [], unreadable: true, error: "document is not a YAML mapping" };
  }
  const paths = (doc as { paths?: unknown } | null)?.paths;
  if (!paths || typeof paths !== "object") return { ops: [], unreadable: false };
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
  return { ops: [...ops.values()], unreadable: false };
}

/** The operations alone — for every caller whose own finding already covers the unreadable case. */
export async function operations(openapiPath: string, context?: FleetContext): Promise<Operation[]> {
  return (await readOpenapi(openapiPath, context)).ops;
}

/** The operationIds alone — `operations` for every caller that asks only "does it exist". */
export async function operationIds(openapiPath: string, context?: FleetContext): Promise<string[]> {
  return (await operations(openapiPath, context)).map((o) => o.id);
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
  context?: FleetContext,
): Promise<string[]> {
  if (context !== undefined) return context.serviceOperationIds(docsDir, service, featureDir);
  const ids = new Set<string>();
  if (featureDir) {
    for (const id of await operationIds(featureSpecPaths(featureDir, service).openapi)) ids.add(id);
  }
  for (const id of await operationIds(servicePaths(docsDir, service).openapi)) ids.add(id);
  return [...ids];
}
