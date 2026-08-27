/**
 * Re-checking evidence pins against a working tree: pure data out, one grade
 * per pin, and no verdict anywhere in the result on purpose — the lint demotes
 * reviewer confidence, it never promotes or demotes a claim. Prints nothing;
 * the validate command turns the grades into findings.
 *
 * The claim shape is structural rather than an import of `../record.js`'s
 * `RecordedClaim`, and not only for the smallest-parameter rule: this package
 * is imported BY `core/verify` (`../file.ts` asks `./pin.ts` for the read
 * guard, `../answers.ts` for the shape), so importing the parent back would
 * put a cycle in the package graph that `import/no-cycle` cannot see.
 */
import { readFile, stat } from "node:fs/promises";
import { inOrder } from "../../kernel/concurrency.js";
import { resolvePortableFileInside, UnsafePathError } from "../../kernel/path-safety.js";
import { pinnedDigest, pinnedText, sourceLines, type EvidencePin } from "./pin.js";

/** What the lint reads off a recorded claim — structurally, see the header. */
export interface PinnedClaim {
  id: string;
  /** Present in federated (schema 2) records — the service whose code answers it. */
  subject?: string;
  verdict: string;
  /** Absent counts as agent — the `attestedClaims` rule for records that predate `--results`. */
  answered_by?: string;
  evidence: string[];
  evidence_pins?: EvidencePin[];
}

/** One pin's disagreement with the working tree. `grade` is what a finding code is made from. */
export interface PinDrift {
  claim: string;
  /** The `path:line` citation the pin belongs to. */
  evidence: string;
  grade: "unresolved" | "moved" | "line-changed" | "token-missing";
  /** What changed, in one clause — rendered into a finding's detail line. */
  what: string;
}

export interface PinLint {
  /** Pins that resolved clean: file digest unchanged against the working tree. */
  checked: number;
  /** In record order — claim by claim, citation by citation — so two runs diff. */
  drifts: PinDrift[];
  /** Agent-confirmed citations carrying no pin, plus claims with no pins at all. */
  unpinned: number;
}

/** What one cited file turned out to be, read and hashed once per lint call. */
type FileState =
  | { state: "unreadable"; what: string }
  | { state: "ok"; digest: string; lines: string[]; text: string };

/**
 * Grade one record's pins for one service against that service's working tree.
 *
 * Only agent-confirmed claims of `service` are graded: a runner's or contract
 * runner's evidence names a report entry, not a file, so there is nothing to
 * re-check, and an unconfirmed claim pinned nothing. Absent `answered_by`
 * counts as agent — the `attestedClaims` rule.
 *
 * Containment is per citation: one unreadable cited file degrades exactly the
 * pins that cite it (graded `unresolved`), never the sibling pins and never
 * the whole record. And "could not look" is never "looks fine": every failure
 * to read is a drift entry, not a skip — fail closed at the validator.
 */
export async function lintEvidencePins(
  claims: readonly PinnedClaim[],
  service: string,
  repoDir: string,
): Promise<PinLint> {
  // The closed side of the answerer test, on purpose: `answered_by` is an open
  // string here (a record is hand-editable YAML, and a newer loam may add
  // answerers), so excluding the known mechanical values would sweep every
  // FUTURE mechanical answerer's report-entry citations into the `unpinned`
  // tally with false "recorded before pins existed" advice. Only what is
  // positively an agent's word is graded; absent counts as agent — the
  // `attestedClaims` rule for records that predate `--results`.
  const mine = claims.filter(
    (c) =>
      c.subject === service &&
      c.verdict === "confirmed" &&
      (c.answered_by === undefined || c.answered_by === "agent"),
  );

  // Join pins to evidence entries by the `path:line` key, never by position:
  // a record is hand-editable YAML, and a positional join would let a deleted
  // evidence line silently shift every later pin onto the wrong citation.
  const joined: Array<{ claim: string; evidence: string; pin: EvidencePin }> = [];
  let unpinned = 0;
  for (const claim of mine) {
    const pins = new Map((claim.evidence_pins ?? []).map((pin) => [`${pin.path}:${pin.line}`, pin]));
    // A pin no evidence entry names pins nothing this claim cites (a hand
    // edit); grading it would report drift about a citation the claim does not
    // make, so only the joined pairs are graded. The reverse direction — a
    // citation without a pin — is the `unpinned` tally.
    for (const evidence of claim.evidence) {
      const pin = pins.get(evidence);
      if (pin === undefined) unpinned += 1;
      else joined.push({ claim: claim.id, evidence, pin });
    }
  }

  // Each distinct cited file is read and hashed once per call — a local map,
  // per invocation, because module-level state leaks across tests and hosts.
  // The reads are independent, so they go through the bounded pool; grading
  // stays sequential below so `drifts` keeps record order.
  const paths = [...new Set(joined.map((j) => j.pin.path))];
  const states = new Map(
    await inOrder(paths, async (path): Promise<[string, FileState]> => [path, await readCited(repoDir, path)]),
  );

  let checked = 0;
  const drifts: PinDrift[] = [];
  for (const { claim, evidence, pin } of joined) {
    const file = states.get(pin.path);
    if (file === undefined || file.state === "unreadable") {
      drifts.push({ claim, evidence, grade: "unresolved", what: file?.what ?? "the cited file was not read" });
      continue;
    }
    const cited = file.lines[pin.line - 1];
    if (cited === undefined) {
      drifts.push({
        claim,
        evidence,
        grade: "unresolved",
        // `continue`, like the unreadable-file arm: an unresolvable CITATION
        // is one finding, and a token scan on top would report the same
        // damaged citation twice under two codes.
        what: `the cited line is past the end — the file now has ${file.lines.length} line(s)`,
      });
      continue;
    }
    if (file.digest === pin.file_sha256) {
      checked += 1;
    } else if (pinnedText(cited) === pin.text) {
      // The mildest drift: the file changed around the cited line, which
      // still reads as pinned — "reads as", not "is": both sides of the
      // comparison are capped at PIN_TEXT_CAP, so a change past the cap on a
      // pathological line is invisible to this grade (and visible to the
      // digest, which is why this is a drift and not a clean pin).
      drifts.push({
        claim,
        evidence,
        grade: "moved",
        what: "the file changed around the cited line, which still reads as pinned",
      });
    } else {
      drifts.push({
        claim,
        evidence,
        grade: "line-changed",
        what: `the cited line now reads '${pinnedText(cited)}' where the record pinned '${pin.text}'`,
      });
    }
    // Independent of the grades above, clean pins included — a digest match
    // must not read as "the token is still there", because content identical
    // to record time says nothing once the file drifts back. "No longer" is
    // the honest word here: the write side stamps `token` only when the
    // attested blob contained it (EvidencePin.token), so this grade always
    // convicts a disappearance, never re-litigates an absence the record-time
    // notice already reported.
    if (pin.token !== undefined && !file.text.includes(pin.token)) {
      drifts.push({
        claim,
        evidence,
        grade: "token-missing",
        what: `the cited file no longer contains '${pin.token}' — the literal string the claim asserts`,
      });
    }
  }
  return { checked, drifts, unpinned };
}

/** One cited file against the working tree, every failure named rather than thrown. */
async function readCited(repoDir: string, path: string): Promise<FileState> {
  let absolute: string;
  try {
    absolute = resolvePortableFileInside(repoDir, path, "pinned evidence");
  } catch (err) {
    if (!(err instanceof UnsafePathError)) throw err;
    return { state: "unreadable", what: `the pinned path is unsafe: ${err.message}` };
  }
  try {
    const info = await stat(absolute);
    if (!info.isFile()) return { state: "unreadable", what: "the cited path is not a regular file" };
    const text = await readFile(absolute, "utf8");
    return { state: "ok", digest: pinnedDigest(text), lines: sourceLines(text), text };
  } catch (err) {
    // ENOENT is the common drift — the cited file is gone from the tree; any
    // other errno (EACCES, EISDIR racing the stat) is named as itself, because
    // "could not read" and "does not exist" call for different repairs.
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { state: "unreadable", what: "the cited file does not exist in this working tree" };
    }
    return { state: "unreadable", what: err instanceof Error ? err.message : String(err) };
  }
}
