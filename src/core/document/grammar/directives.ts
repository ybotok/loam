/**
 * The requirement BODY-LINE grammar, and what a key nearly was.
 *
 * Split out of `commands/validate/service/specs.ts`, which reads and grades a
 * service's two spec axes — a different subject: that module is about one
 * service's documents, this one is about the shape of a requirement body
 * wherever it appears. Nothing here touches the filesystem or knows what a
 * service is, which is what lets it sit in `core/` beside the parser whose
 * patterns it borrows.
 *
 * Its sibling is `../scenarios.ts`: same shape (requirements in, findings out,
 * no I/O), one level down the document — that one grades a scenario's steps,
 * this one grades the keys in the body above them.
 */
import { type Finding } from "../../vocabulary/report.js";
import {
  BASED_ON_LINE_RE,
  CAPABILITY_LINE_RE,
  REALIZES_LINE_RE,
  REQUIREMENT_ID_LINE_RE,
  type Requirement,
} from "../spec.js";

/**
 * Every body-line directive the requirement grammar recognises, as the patterns
 * that recognise them.
 *
 * The REGEXES are the recognition half and they are not a copy: three are the
 * exported constants `core/document/spec.ts` owns, and the rest are the same
 * literals `core/document/parse.ts` matches with. Recognition therefore cannot
 * drift into calling a real directive unknown.
 *
 * The NAMES below are the did-you-mean half, and they are the half that could
 * drift — so `test/spec-unknown-directive.test.ts` asserts that every name here,
 * spelled as a line, is matched by one of the patterns above it. A name that
 * stops being a directive fails that test rather than going on being suggested.
 */
const DIRECTIVE_PATTERNS: readonly RegExp[] = [
  REQUIREMENT_ID_LINE_RE,
  BASED_ON_LINE_RE,
  CAPABILITY_LINE_RE,
  REALIZES_LINE_RE,
  /^\s*Operations?:\s*(.+?)\s*$/i,
  /^\s*Covers?:\s*(.+?)\s*$/i,
  /^\s*Publishes?:\s*(.+?)\s*$/i,
  /^\s*Consumes?:\s*(.+?)\s*$/i,
  /^\s*Requires?:\s*(.+?)\s*$/i,
];

/** The canonical spelling of each directive — what a near miss is measured against. */
export const DIRECTIVE_NAMES: readonly string[] = [
  "Requirement-ID",
  "Based-On",
  "Capabilities",
  "Realizes",
  "Operations",
  "Covers",
  "Publishes",
  "Consumes",
  "Requires",
];

/** A body line that LOOKS like a directive: a short capitalised key, a colon, a value. */
const CANDIDATE_LINE_RE = /^\s*([A-Za-z][A-Za-z-]{2,30}):\s*\S/;

/**
 * A fenced block's opening or closing line — three or more backticks or
 * tildes, optionally indented, optionally with an info string.
 *
 * A requirement body legitimately holds a fenced example, and inside one
 * `Realises:` is a sample value rather than a misspelled directive. Grading it
 * would make the check fire on documents that are exactly right, which is the
 * one thing a near-miss guard may never do — a warning nobody can act on is
 * worse than no warning. Tables need no equivalent: a `| Realises: |` cell
 * begins with the pipe, so `CANDIDATE_LINE_RE` never matches it.
 */
const FENCE_LINE_RE = /^\s*(`{3,}|~{3,})/;

/**
 * Levenshtein distance, capped — a local one rather than `closeIds`, and the
 * difference matters here.
 *
 * `closeIds` accepts a shared three-character prefix, which is right for ids
 * drawn from a known vocabulary the author was aiming at. Applied to arbitrary
 * prose keys it fires on words that merely start alike: `Context:` would be
 * reported as a near miss for `Consumes:`, in a check whose whole value is that
 * it does not cry wolf. Edit distance separates the two cleanly — `Context` is
 * five edits from `Consumes`, `Realises` is one from `Realizes`.
 */
function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(
        prev[j]! + 1,
        row[j - 1]! + 1,
        prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = row;
  }
  return prev[b.length]!;
}

/**
 * `spec.unknown-directive` — a body line whose key is one or two characters
 * away from a directive and is not one.
 *
 * THE ONE PLACE THE CORPUS IS QUIETER THAN IT LOOKS. Every join in the product
 * is an existence check on a parsed value, so a line the parser did not
 * recognise produces no value, no join, and therefore no finding: `Realises:`,
 * `Capabilties:` and `Require:` all read as ordinary prose, and every check
 * downstream stays green because there is nothing to fail. This is the same
 * judgement `obligation.unknown` already makes one axis over — "a mistyped tag
 * reads exactly like a rule" — applied to the keys themselves.
 *
 * A WARNING, not an error, and the threshold is deliberately mean. A body line
 * is free prose and a fleet may legitimately write `Owner:` or `Context:` in
 * one; the check only speaks when the key is within two edits of a directive,
 * which is close enough that a typo is far likelier than a coincidence. It
 * gates nothing.
 */
export function unknownDirectiveFindings(
  reqs: readonly Requirement[],
  target: { where: string; subject: string },
): Finding[] {
  const findings: Finding[] = [];
  for (const r of reqs) {
    if (r.kind === "REMOVED") continue;
    let inFence = false;
    for (const line of r.text) {
      if (FENCE_LINE_RE.test(line)) {
        inFence = !inFence;
        continue;
      }
      if (inFence) continue;
      const candidate = CANDIDATE_LINE_RE.exec(line);
      if (candidate === null) continue;
      if (DIRECTIVE_PATTERNS.some((re) => re.test(line))) continue;
      const key = candidate[1]!;
      const near = DIRECTIVE_NAMES.filter(
        (name) => editDistance(key.toLowerCase(), name.toLowerCase()) <= 2,
      );
      if (near.length === 0) continue;
      findings.push({
        severity: "warn",
        code: "spec.unknown-directive",
        subject: target.subject,
        message:
          `${target.where}: requirement '${r.name}' has a line beginning '${key}:', which is not a directive loam reads — ` +
          `did you mean ${near.map((n) => `\`${n}:\``).join(" or ")}? ` +
          "A key loam does not recognise is prose: the join it looks like simply does not exist, and every check over it " +
          "stays green because there is nothing to fail. Correct the spelling, or reword the line so it does not read as a directive",
      });
    }
  }
  return findings;
}
