/**
 * A service's OpenAPI contract as loam reads it: which keys hold operations,
 * what an operation is once loam's own markers are accounted for, and what the
 * fleet will provide after a feature is applied.
 *
 * Split from `./digest.ts` because the two answer different questions about the
 * same file. This one is about STRUCTURE — a path item's operation-bearing
 * keys, an `operationId`, a removal marker — and every reader of a contract
 * comes through here. The digest is about IDENTITY, and only the pin and the
 * merge need it.
 */
import { isUtf8 } from "node:buffer";
import { danglingRefs, failureCodesOf, responseUndescribed } from "./depth.js";
import { operationBaselineOf, operationDigest } from "./digest.js";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import type { FleetContext } from "../fleet-context.js";
import type { PathableService } from "../kernel/ids/service.js";
import { featureSpecPaths, servicePaths } from "../repo/paths.js";

/**
 * The path-item keys that hold operations. A path item also carries `summary`,
 * `parameters`, `servers` and vendor `x-*` extensions — an object-valued one with
 * an `operationId` inside (x-legacy and friends) is not an operation, and a
 * phantom id from it would make a broken contract look "available" to the
 * op-exists checks. Shared with archive's merge, which asks the same question
 * of the same keys.
 */
export const HTTP_METHODS = new Set(["get", "put", "post", "delete", "options", "head", "patch", "trace"]);

/** One operation as the reader sees it, including loam's feature-only removal marker. */
export interface Operation {
  id: string;
  /**
   * The standard per-operation OpenAPI `deprecated` flag — lifecycle
   * visibility, the documented first step of retiring an op.
   */
  deprecated: boolean;
  /**
   * `x-loam-remove: true` asks a FEATURE delta to remove this exact operation
   * on archive. The marker is never a callable operation and is illegal in a
   * living contract.
   */
  remove: boolean;
  /** Exact slot the marker/upsert addresses; removal is deliberately path+method-safe. */
  path: string;
  method: string;
  /**
   * `operationDigest` of this operation as it stands in ITS OWN document —
   * computed here so every caller compares content the one way the merge does.
   */
  digest: string;
  /**
   * The living version this operation was written against, from
   * `x-loam-based-on`. Feature deltas only: a living contract never carries one
   * (the merge strips it), and an adopted contract never had one.
   */
  basedOn?: string;
  /**
   * Present when no response declares content with a schema while at least one
   * should carry a body (`depth.ts`). Set only when true, so the many callers
   * that compare operations structurally never see the field on a described
   * contract.
   */
  undescribed?: true;
  /**
   * Declared non-2xx response codes, in document order — the refusals this
   * operation promises. `default` and any `4XX`/`5XX` wildcard are excluded:
   * neither names a case a scenario could be written for.
   *
   * The contract is the only place in the corpus that enumerates what an
   * operation REFUSES, and until this was read nothing joined those refusals to
   * anything. `api.ungoverned` grades whole operations against requirements,
   * so an operation documented by its happy path alone — one requirement, one
   * scenario, twelve declared failure codes — passed every check loam had.
   */
  failureCodes: string[];
}

/** A `x-loam-remove: true` marker with no usable operationId — a slot named but no operation named. */
export interface AnonymousRemoval {
  path: string;
  method: string;
}

/** The parse of one OpenAPI document: its operations, and whether the file could be read at all. */
export interface OpenapiDoc {
  ops: Operation[];
  /**
   * operationIds this document defines in more than one (path, method) slot.
   * A LIVING contract with two slots claiming one id is ambiguous to every
   * check that joins on the id — a requirement's `Operations:` line, an edge's
   * `metadata { op }`, a removal marker — and the join silently picks one.
   */
  duplicateIds: string[];
  /**
   * Removal markers the operation reader cannot name. They are invisible to
   * every id-keyed check, so a delta carrying one used to archive cleanly and
   * write `x-loam-remove: true` straight into a living contract.
   */
  anonymousRemovals: AnonymousRemoval[];
  /**
   * Paths carrying `x-loam-remove: true` at PATH level, beside the methods
   * rather than inside one.
   *
   * Not an operation, so nothing keyed by (path, method) could see it — and this
   * reader is method-keyed like the merge was. A marker written there addressed
   * no operation, so archive copied it into the living contract verbatim, where
   * it was invisible to `openapi.remove-marker-living` for the same reason and
   * kept the empty-path cleanup from ever firing. Reported as its own list
   * because the answer differs by document: in a FEATURE delta it is an
   * authoring mistake, in a LIVING contract it is a marker that must never have
   * been published.
   */
  pathLevelRemovals: string[];
  /**
   * True when the file EXISTS but cannot be read as an OpenAPI document —
   * broken YAML, or a document that is not a mapping. A missing file is not
   * unreadable (absence is `service.no-openapi`'s question), and an empty one
   * parses to null and honestly defines nothing.
   */
  unreadable: boolean;
  /** The parser's own message, when there is one to quote back. */
  error?: string;
  /** Internal `#/` refs that resolve to nothing in this document (`depth.ts`). */
  danglingRefs: string[];
}

/**
 * Extract operations from an OpenAPI document by walking the parsed YAML
 * structure (paths.<path>.<method>, method filtered to the HTTP set).
 * Structure-aware on purpose: a regex scan both drops legal ids (kebab-case,
 * dotted) and picks up phantom ids from description text. Each operation
 * carries its id and its `deprecated: true` flag (exactly `true` counts —
 * strings and truthy noise do not). `ops` is the defined set, keyed by the
 * (path, method) SLOT — not by operationId.
 *
 * Keying by id used to drop the second slot claiming a name, which made the
 * single most common contract edit invisible: relocating an endpoint is a
 * removal marker at the old slot plus an upsert at the new one, the SAME
 * operationId twice. Whichever came second in document order vanished, so
 * either the marker addressed a slot loam could not see (`remove-target-missing`
 * on a perfectly good delta) or the new definition did. Two slots claiming one
 * id in a LIVING contract is a real ambiguity rather than a merge failure, so
 * it rides out as `duplicateIds` for the caller to grade.
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
  if (!existsSync(openapiPath)) return empty();
  const bytes = await readFile(openapiPath);
  // A contract whose bytes are not UTF-8 is as unreadable as broken YAML, and
  // for a worse reason: `toString("utf8")` would substitute U+FFFD and hand the
  // parser a document nobody wrote. It travels as `unreadable` so validate
  // grades it `openapi.invalid` — the file is the error, and every check that
  // reads the contract stays suspended.
  if (!isUtf8(bytes)) return { ...empty(), unreadable: true, error: "file is not valid UTF-8" };
  let doc: unknown;
  try {
    doc = parse(bytes.toString("utf8"));
  } catch (e) {
    return { ...empty(), unreadable: true, error: e instanceof Error ? e.message : String(e) };
  }
  // A scalar or sequence document is as unreadable as broken YAML: there is no
  // mapping to look `paths` up in, so nothing can be concluded from it. null
  // (an empty file) stays readable — it defines nothing, and says so honestly.
  if (doc !== null && (typeof doc !== "object" || Array.isArray(doc))) {
    return { ...empty(), unreadable: true, error: "document is not a YAML mapping" };
  }
  // Refs are probed over the WHOLE document: a schema in `components` that
  // `$ref`s a neighbour nobody wrote is exactly as broken as one under a path.
  const refs = danglingRefs(doc);
  const paths = (doc as { paths?: unknown } | null)?.paths;
  if (!paths || typeof paths !== "object") return { ...empty(), danglingRefs: refs };
  const ops: Operation[] = [];
  const anonymousRemovals: AnonymousRemoval[] = [];
  const pathLevelRemovals: string[] = [];
  const seen = new Map<string, number>();
  for (const [path, item] of Object.entries(paths as Record<string, unknown>)) {
    if (!item || typeof item !== "object") continue;
    if ((item as Record<string, unknown>)["x-loam-remove"] === true) pathLevelRemovals.push(path);
    for (const [method, op] of Object.entries(item as Record<string, unknown>)) {
      if (!HTTP_METHODS.has(method)) continue;
      if (!op || typeof op !== "object") continue;
      const id = (op as Record<string, unknown>)["operationId"];
      const remove = (op as Record<string, unknown>)["x-loam-remove"] === true;
      if (typeof id !== "string" || id.length === 0) {
        if (remove) anonymousRemovals.push({ path, method });
        continue;
      }
      seen.set(id, (seen.get(id) ?? 0) + 1);
      const basedOn = operationBaselineOf(op);
      ops.push({
        id,
        deprecated: (op as Record<string, unknown>)["deprecated"] === true,
        remove,
        path,
        method,
        digest: operationDigest(op),
        ...(basedOn === undefined ? {} : { basedOn }),
        ...(responseUndescribed(op) ? { undescribed: true as const } : {}),
        failureCodes: failureCodesOf(op),
      });
    }
  }
  const duplicateIds = [...seen].filter(([, n]) => n > 1).map(([id]) => id);
  return { ops, duplicateIds, anonymousRemovals, pathLevelRemovals, unreadable: false, danglingRefs: refs };
}

function empty(): OpenapiDoc {
  return {
    ops: [],
    duplicateIds: [],
    anonymousRemovals: [],
    pathLevelRemovals: [],
    unreadable: false,
    danglingRefs: [],
  };
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
 * The operationIds a service will provide after a feature is applied: living
 * operations, plus feature upserts, minus explicit feature removals.
 *
 * Removals are applied BEFORE upserts, which is what makes the answer
 * independent of the order the feature's document happens to spell them in.
 * Interleaving them one operation at a time meant a relocation — the same id
 * removed from `/old` and defined on `/new` — answered "defined" or "gone"
 * depending on which path sorted first in the YAML, and the requirement
 * governing it was reported undefined (`spec-api.op-undefined`) on exactly one
 * of the two spellings of the same change.
 *
 * A context is threaded into the READS and never asked for the answer. It used
 * to own a second copy of this function, and that copy interleaved removals
 * with upserts — the exact bug the paragraph above describes as fixed. So the
 * commands that pass a context (`validate`, `status`) and the one that does not
 * (`archive`) disagreed about whether a relocated operation still existed, and
 * `spec-api.op-undefined` — an error that gates archive — fired or not
 * depending on which path key the author happened to type first. Memoising is
 * the context's job; the ordering rule is this function's, and there is one of
 * it.
 */
export async function serviceOperationIds(
  docsDir: string,
  service: PathableService,
  featureDir?: string,
  context?: FleetContext,
): Promise<string[]> {
  const ids = new Set(
    (await operations(servicePaths(docsDir, service).openapi, context)).filter((op) => !op.remove).map((op) => op.id),
  );
  // Absence is `undefined`, the shape the optional parameter declares. The
  // truthiness test also read "" as "no feature", which is a caller mistake
  // worth surfacing rather than answering as though the feature carried no
  // contract delta.
  if (featureDir !== undefined) {
    const featOps = await operations(featureSpecPaths(featureDir, service).openapi, context);
    for (const op of featOps) if (op.remove) ids.delete(op.id);
    for (const op of featOps) if (!op.remove) ids.add(op.id);
  }
  return [...ids];
}

