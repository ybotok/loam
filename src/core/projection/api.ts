/**
 * The OpenAPI half of projecting a feature onto one service: which operations
 * its contract delta defines, as slots rather than names.
 *
 * Moved out of `commands/delta/slices.ts` (rule 8 in docs/DESIGN.md) when
 * `loam context` became the second caller — a command may not import another
 * command, and a second copy of a projection is a second chance for the brief
 * and the pack to disagree about what a feature changes. The answers here are
 * what `loam delta --json` serializes verbatim, so they are computed once and
 * never re-derived while printing — a printed number that disagrees with the
 * payload beside it is the failure this separation prevents.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import { readOpenapi, type Operation } from "../openapi/doc.js";
import { isRecord } from "../kernel/records.js";
import { compareIds } from "../repo/entries.js";

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
  // The summary walk below descends four levels into a document nobody has
  // validated, and `isRecord` is what it asks at each step: a cast there would
  // assert a shape the parser never promised, and a sequence or a scalar in any of
  // those slots would be indexed as a mapping.
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
