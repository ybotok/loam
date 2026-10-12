/**
 * The decode-tolerant read of a contract's text, shared by both contract axes'
 * feature gates.
 *
 * A leaf of its own, named for what it does, at the lowest package both gates
 * already import: kept in the event axis's walk, the OpenAPI gate reached a
 * general-purpose read through a module about AsyncAPI deltas.
 */
import { readFile } from "node:fs/promises";
import { NotUtf8DocumentError } from "../kernel/document-bytes.js";
import type { FleetContext } from "../fleet-context.js";

/**
 * Read a document's text, answering undefined for bytes that do not decode.
 *
 * `context.readText` DECODES and THROWS on non-UTF-8 bytes, where the
 * no-context `readFile` substitutes U+FFFD and lets the contract reader flag
 * the document unreadable. Uncaught, one service's UTF-16 living contract took
 * down the whole feature target under validate's context while archive's
 * no-context path sailed past. Either text failing to decode gets the answer
 * the baseline gates give an unreadable parse: that side's checks are skipped.
 * Both contract axes' feature gates read this way: ../coherence/declared.ts for
 * OpenAPI and ../coherence/events/declared.ts for AsyncAPI.
 */
export async function readOr(p: string, context?: FleetContext): Promise<string | undefined> {
  try {
    return context === undefined ? await readFile(p, "utf8") : await context.readText(p);
  } catch (err) {
    if (err instanceof NotUtf8DocumentError) return undefined;
    throw err;
  }
}
