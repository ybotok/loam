/**
 * The per-service projection itself: which services exist, which the feature
 * introduces, what its contract changes, and what its architecture adds.
 *
 * These are the answers `--json` serializes verbatim, so they are computed
 * here and never re-derived while printing — a printed number that disagrees
 * with the payload beside it is the failure this separation prevents.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import { elementService, serviceOf, type Elem, type LoadedDoc, type Rel } from "../../core/c4/likec4.js";
import { readOpenapi, type Operation } from "../../core/openapi/doc.js";
import { isRecord } from "../../core/kernel/records.js";
import { compareIds } from "../../core/repo/entries.js";
import { DocsRepoUnavailableError } from "../../core/repo/state.js";
import { listServices } from "../../core/repo/repo.js";

/** One end of a feature edge, as seen from the projected service. */
export interface Edge {
  service: string;
  op: string | null;
  title: string | null;
}

export interface ArchSlice {
  isNew: boolean;
  inbound: Edge[];
  outbound: Edge[];
  errors: string[];
}

/**
 * One operation the feature's OpenAPI delta defines for this service. The
 * projection is a task brief, and "implement createSplit" without the path and
 * the method is not a task — it is a name to go look up in a file the reader
 * was not told about.
 */
export interface ApiChange {
  path: string;
  method: string;
  operationId: string;
  summary: string | null;
  /** `x-loam-remove: true` — this operation is being retired, not added. */
  remove: boolean;
}

/**
 * The contract axis of the brief: the operations, and whether the document they
 * came from could be read at all.
 *
 * The two have to travel together. A feature `openapi.yaml` that does not parse
 * yields zero operations, which is the same answer as a delta that genuinely
 * changes no endpoints — and this projection is a task brief, so "no contract
 * work here" over a YAML error is the vacuously-green trap the architecture
 * axis already guards against.
 */
export interface ApiSlice {
  changes: ApiChange[];
  unreadable: boolean;
  /** The parser's own message, when there is one to quote back. */
  error?: string;
}

export async function livingServices(docsDir: string): Promise<string[]> {
  try {
    return (await listServices(docsDir)).map((s) => s.id);
  } catch (err) {
    // "There is no docs repo at all" is a different diagnosis with its own
    // command (`loam doctor`); turning it into "unknown service" here would
    // send the reader after a typo that is not there.
    if (!(err instanceof DocsRepoUnavailableError)) throw err;
    return [];
  }
}

/** Services the feature's C4 delta introduces — its own tagged top-level elements. */
export function introducedServices(doc: LoadedDoc | null, featureId: string): string[] {
  if (doc === null || doc.errors.length > 0) return [];
  return doc.elements.filter((e: Elem) => e.tags.includes(featureId)).map(elementService);
}

/**
 * The feature's OpenAPI delta for one service, as slots rather than names.
 *
 * The operation set comes from core/openapi/doc.ts — the same structure-aware reader
 * every other check uses, so this view cannot see an operation validate does not.
 * `summary` is the one field that reader does not carry, and it is the sentence
 * an implementer most wants, so it is looked up by the path+method the reader
 * already resolved: a second read of the same document, never a second opinion
 * about what an operation IS.
 */
export async function apiChanges(openapiPath: string): Promise<ApiSlice> {
  if (!existsSync(openapiPath)) return { changes: [], unreadable: false };
  // `readOpenapi`, not `operations`: the operation list alone cannot tell a
  // contract that defines nothing from one that could not be read, and this is
  // the command whose output IS the implementation task.
  const api = await readOpenapi(openapiPath);
  if (api.unreadable) {
    return { changes: [], unreadable: true, ...(api.error === undefined ? {} : { error: api.error }) };
  }
  const ops = api.ops;
  if (ops.length === 0) return { changes: [], unreadable: false };
  let doc: unknown;
  try {
    doc = parseYaml(await readFile(openapiPath, "utf8"));
  } catch {
    // Unreadable is impossible here (the reader above said otherwise), but a
    // summary is decoration and must never be the reason a task brief fails to
    // print.
    doc = null;
  }
  const summaryOf = (op: Operation): string | null => {
    if (!isRecord(doc)) return null;
    const paths = doc["paths"];
    if (!isRecord(paths)) return null;
    const item = paths[op.path];
    if (!isRecord(item)) return null;
    const entry = item[op.method];
    if (!isRecord(entry)) return null;
    const summary = entry["summary"];
    return typeof summary === "string" && summary.length > 0 ? summary : null;
  };
  return {
    changes: ops
      .map((op): ApiChange => ({
        path: op.path,
        method: op.method.toUpperCase(),
        operationId: op.id,
        summary: summaryOf(op),
        remove: op.remove,
      }))
      .sort((a, b) => compareIds(a.path, b.path) || compareIds(a.method, b.method)),
    unreadable: false,
  };
}

/** The feature's tagged edges around one service, plus whether the service is new. */
export function archSlice(doc: LoadedDoc | null, service: string, featureId: string): ArchSlice {
  const empty: ArchSlice = { isNew: false, inbound: [], outbound: [], errors: [] };
  if (doc === null) return empty;

  const { errors, elements, relationships } = doc;
  if (errors.length > 0) {
    return { ...empty, errors: errors.map((e) => (typeof e.line === "number" ? `L${e.line}: ${e.message}` : e.message)) };
  }

  // Which service an element stands for is the binding's call, not the title's.
  const svcOf = (id: string): string => serviceOf(elements, id);
  const edge = (r: Rel, other: string): Edge => ({
    service: other,
    op: r.op ?? null,
    title: r.title ?? null,
  });
  const featRels = relationships.filter((r) => r.tags.includes(featureId));

  return {
    isNew: elements.some((e) => elementService(e) === service && e.tags.includes(featureId)),
    inbound: featRels.filter((r) => svcOf(r.target) === service).map((r) => edge(r, svcOf(r.source))),
    outbound: featRels.filter((r) => svcOf(r.source) === service).map((r) => edge(r, svcOf(r.target))),
    errors: [],
  };
}

export function stripFrontmatter(md: string): string {
  if (!md.startsWith("---")) return md;
  const close = md.indexOf("\n---", 3);
  if (close === -1) return md;
  const nl = md.indexOf("\n", close + 1);
  return nl === -1 ? "" : md.slice(nl + 1).trimStart();
}

/**
 * The requirement delta, in full.
 *
 * The text view used to print headings and scenario NAMES only, which made it a
 * table of contents for a file the reader then had to open — while `--json`
 * carried the requirement body and the Given/When/Then lines verbatim. The two
 * are the same briefing, so they carry the same content: a person reading this
 * in a terminal is being asked to implement it, exactly like the agent reading
 * the payload.
 */
