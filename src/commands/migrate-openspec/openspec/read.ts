/**
 * Bytes out of somebody else's repository, decoded or refused by name.
 *
 * Every other phase reads its input through here rather than calling `readFile`
 * itself, which is the point: the encoding rule below is one line of code, and
 * the defect it prevents is a migration that reports success over requirements
 * it silently dropped. A read added later to a materializer has to come through
 * this module to reach the source at all.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { decodeDocument, NotUtf8DocumentError } from "../../../core/kernel/document-bytes.js";
import { OpenSpecCommandError } from "./error.js";

/**
 * A document this command is about to migrate, decoded or refused BY NAME.
 *
 * Every other read on this path used `readFile(…, "utf8")`, which never fails:
 * bytes that are not UTF-8 become U+FFFD and a UTF-16 spec.md becomes text with
 * no headings in it. Downstream that is not a wrong answer but a silent one —
 * `parseRequirements` returns [], the capability materializes as a `spec.md`
 * with an empty `## Requirements`, and the migration reports success over a file
 * whose every requirement was dropped. Migration is the one command whose input
 * is somebody else's repository, written by tooling loam does not control, so
 * this is where lossy decoding is both most likely and least acceptable.
 *
 * The ingest scan already refuses non-UTF-8 artifacts up front
 * (`openspec.non-utf8-artifact`); holding the same rule at the point of use
 * means a read added later cannot quietly skip it, and it is what catches the
 * encoding the scan's `isUtf8` cannot see — UTF-16 written without a BOM, whose
 * bytes are valid UTF-8 with a NUL between every character.
 */
export function decodeSource(bytes: Buffer, path: string, label: string): string {
  try {
    return decodeDocument(bytes, path);
  } catch (error) {
    if (!(error instanceof NotUtf8DocumentError)) throw error;
    // `error.message` already opens with the path; the label says which of the
    // two inputs it is — the corpus being migrated, or the mapping about it.
    throw new OpenSpecCommandError("invalid-option", `${label}: ${error.message}`);
  }
}

/** A path under the audited OpenSpec root, decoded the same way. */
export async function readSourceArtifact(root: string, artifactPath: string): Promise<string> {
  const absolute = join(root, artifactPath);
  return decodeSource(await readFile(absolute), absolute, "OpenSpec source artifact");
}
