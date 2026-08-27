/**
 * A report file as an artifact: resolved, read, digested, parsed — the
 * plumbing `--results` and `--contract-results` share, extracted from
 * `../results.ts` when the contract path became its second consumer. One
 * spelling on purpose: the two flags must agree byte-for-byte about what "the
 * file loam read" means, because both pins end up on the same record making
 * the same promise.
 *
 * `repoDir` is set in federated mode, and there the report must be a file
 * INSIDE the repository being attested, resolved by the same rules as evidence
 * (`portablePathOf` then `resolveInside`): an attestation says "at this
 * commit, in this repository", and a report living somewhere else answers for
 * a run nobody standing here can find. The legacy all-at-once form binds to no
 * repository at all, so it takes the path as spelled — its looser contract,
 * unchanged.
 *
 * Every refusal is `answers-unreadable` with the failing fact named — a path
 * that is a directory arrives here as the read's own EISDIR, a file that is
 * not UTF-8 is refused by name rather than parsed through U+FFFD substitution
 * (JSON.parse's "unexpected token" over bytes nobody wrote is a message that
 * sends the caller hunting a typo that is not there), and broken JSON carries
 * the parser's message. Never `internal`: the file is the caller's, so the
 * refusal must name the file.
 */
import { isUtf8 } from "node:buffer";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { resolvePortableFileInside } from "../../../core/kernel/path-safety.js";

export type ReportArtifactRead =
  | {
      ok: true;
      /** The path as the caller spelled it — what goes on the record. */
      spelled: string;
      /** Full sha256 of the exact bytes read. */
      digest: string;
      /** ISO-8601 mtime of the report file. */
      mtime: string;
      /** The parsed JSON document, for the format reader to grade. */
      doc: unknown;
    }
  | { ok: false; code: "answers-unreadable"; message: string };

export async function readReportArtifact(
  spelled: string,
  repoDir: string | undefined,
  label: string,
): Promise<ReportArtifactRead> {
  const refuse = (message: string): ReportArtifactRead => ({ ok: false, code: "answers-unreadable", message });
  let path: string;
  if (repoDir === undefined) {
    path = resolve(process.cwd(), spelled);
  } else {
    try {
      path = resolvePortableFileInside(repoDir, spelled, label);
    } catch (err) {
      return refuse(
        `Cannot answer from ${spelled}: ${err instanceof Error ? err.message : String(err)}. ` +
          "A federated attestation rests on a report inside the repository it attests — give the path relative to the repo root.",
      );
    }
  }

  let bytes: Buffer;
  let mtime: Date;
  try {
    bytes = await readFile(path);
    mtime = (await stat(path)).mtime;
  } catch (err) {
    return refuse(`Cannot read ${spelled} as a ${label}: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!isUtf8(bytes)) {
    return refuse(`Cannot read ${spelled} as a ${label}: the file is not valid UTF-8`);
  }
  let doc: unknown;
  try {
    doc = JSON.parse(bytes.toString("utf8"));
  } catch (err) {
    return refuse(`Cannot read ${spelled} as a ${label}: ${err instanceof Error ? err.message : String(err)}`);
  }
  return {
    ok: true,
    spelled,
    digest: createHash("sha256").update(bytes).digest("hex"),
    mtime: mtime.toISOString(),
    doc,
  };
}
