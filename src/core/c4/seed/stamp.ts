/**
 * The generated-by stamp on a seeded landscape: line 1, self-verifying, no
 * state anywhere else. `loam seed` may regenerate the fleet map wholesale
 * exactly when it can PROVE no human work would be lost, and the only proof
 * that needs no side channel is the file testifying about itself — a digest of
 * every byte after the stamp line, written into the stamp line. A database of
 * "files loam wrote" would be a second source of truth that drifts the first
 * time somebody copies a docs repo; the digest travels with the bytes it
 * covers.
 *
 * The stamp is recognised by its PREFIX and digest alone — the prose after the
 * digest is free to be reworded (it is advice to a reader, not part of the
 * proof), so a future loam rewording the sentence still recognises every file
 * an older loam sealed. The digest covers everything after the first newline,
 * with line endings normalised out: `core.autocrlf` is Git for Windows'
 * installer default and the docs repo ships no `.gitattributes`, so an
 * ordinary Windows clone of a seeded landscape rewrites every line of it and
 * changes not one fact. Calling that "hand-edited" would stand `loam seed`
 * against `loam status`, which reads the same file through
 * `isLandscapeStub`'s CRLF-normalised compare and tells the reader to run
 * seed. What the digest proves is that the CONTENT is still a pure function of
 * fleet.yaml — which is what "no human work here" means.
 */
import { createHash } from "node:crypto";

/**
 * What the landscape's bytes say about who wrote them:
 *
 * - `seed-stamped` — the stamp is present and its digest matches: every byte
 *   is a pure function of fleet.yaml, so regenerating loses nothing.
 * - `seed-edited` — the stamp is present but the digest does not match: a
 *   human edited a seeded file, and those edits are theirs to keep.
 * - `foreign` — no stamp: the file was authored some other way (by hand, or by
 *   the scaffold; the caller recognises the scaffold's stub separately, through
 *   `isLandscapeStub`, because the stub predates the stamp).
 */
export type LandscapeProvenance = "seed-stamped" | "seed-edited" | "foreign";

const STAMP_PREFIX = "// loam-seed sha256:";

/** Line 1 must OPEN with the prefix and a full digest; the prose after is free. */
const STAMP_LINE = /^\/\/ loam-seed sha256:([0-9a-f]{64})(?:\s|$)/;

/** The digest the stamp carries: content, with line endings normalised out. See the header. */
function digestOf(body: string): string {
  return createHash("sha256").update(body.replace(/\r\n/g, "\n"), "utf8").digest("hex");
}

/** Prepend the self-verifying stamp line to a rendered landscape body. */
export function sealLandscape(body: string): string {
  return (
    `${STAMP_PREFIX}${digestOf(body)} — generated from fleet.yaml by \`loam seed\`. ` +
    "Hand edits make this file yours: seed will then refuse to regenerate it.\n" +
    body
  );
}

/** Classify a landscape's text by its own testimony. See {@link LandscapeProvenance}. */
export function landscapeProvenance(text: string): LandscapeProvenance {
  const newline = text.indexOf("\n");
  const first = newline === -1 ? text : text.slice(0, newline);
  const m = STAMP_LINE.exec(first);
  if (m === null) return "foreign";
  const body = newline === -1 ? "" : text.slice(newline + 1);
  return digestOf(body) === m[1] ? "seed-stamped" : "seed-edited";
}
