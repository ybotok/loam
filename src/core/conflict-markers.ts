/**
 * Git conflict markers left in a document, and the findings they become.
 *
 * Split out of `fleet-context.ts` — the module that owes every READER the
 * check — because the rule itself is a leaf: doctor, validate's three target
 * kinds and coherence all grade marker breaches on text they already hold, and
 * none of them should have to import the whole read index (and the fleet it
 * pulls in behind it) to spell one line rule. The context keeps its
 * `conflictMarkers()` convenience over `readText`; the rule lives here.
 */
import type { Finding } from "./vocabulary/report.js";

/**
 * The three-way merge left its markers in the file — 1-based line numbers.
 *
 * The rule is `loam doctor`'s, verbatim, and it lives here now because doctor
 * checked exactly one file (`architecture/landscape.likec4`) from a command
 * that gates nothing. The same markers in a living `services/<svc>/spec.md`
 * parse as prose: `loam validate --all` reported `valid: true`, and the next
 * `loam archive` rewrote the requirements section and dropped the `=======`
 * line with it, turning a conflict anyone can see into a document nobody can
 * tell is wrong. For a shared docs repo where a fleet lands through PRs this is
 * the DEFAULT failure, not an edge.
 */
const CONFLICT_MARKERS = ["<<<<<<<", "=======", ">>>>>>>"];

export function conflictMarkerLines(source: string): number[] {
  const out: number[] = [];
  source.split(/\r?\n/).forEach((line, i) => {
    if (CONFLICT_MARKERS.some((m) => line.startsWith(m))) out.push(i + 1);
  });
  return out;
}

/** One sentence for the breach, wherever it is found — doctor, validate, either axis. */
function conflictMessage(label: string, lines: number[]): string {
  return (
    `${label} still contains git conflict markers (line${lines.length === 1 ? "" : "s"} ${lines.join(", ")}) — ` +
    `both sides of somebody's merge are in the file, so nothing it says is anyone's text. ` +
    `Resolve the conflict before anything else: loam rewrites this document on archive, and a rewrite deletes ` +
    `whichever marker lines fall inside the section it owns — a visible conflict becomes a silently malformed file.`
  );
}

/**
 * The conflict-marker finding for a requirement document (living spec.md /
 * arch.spec.md, or a feature's delta of one). Null when the text is clean.
 *
 * An error because the document is not valid — nobody wrote what it now says —
 * and because the merge that would consume it is unsafe. It does not carry
 * `gates`: that field is coherence's (issue.ts), and the archive gate has to
 * ask this question itself.
 */
export function documentConflictFinding(label: string, subject: string, text: string): Finding | null {
  const lines = conflictMarkerLines(text);
  if (lines.length === 0) return null;
  return {
    severity: "error",
    code: "spec.merge-conflict",
    subject,
    message: conflictMessage(label, lines),
  };
}

/** The same breach in the fleet map, where it costs every cross-service check at once. */
export function landscapeConflictFinding(label: string, text: string): Finding | null {
  const lines = conflictMarkerLines(text);
  if (lines.length === 0) return null;
  return {
    severity: "error",
    code: "landscape.merge-conflict",
    message: conflictMessage(label, lines),
  };
}
