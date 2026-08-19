/**
 * Markdown in: headings, fences, and the one `## Requirements` cut point.
 *
 * The cut point is spelled once here on purpose. The archive cut, archive's
 * stray-requirement guard and the delta-shape exemption used to spell the same
 * invariant three different ways, and one of them was a PREFIX match that also
 * hit `## Requirements Extra`.
 *
 * Fence tracking is why this is not a set of regexes at the call sites: a
 * `### Requirement:` inside a fenced code block is prose about a requirement,
 * not one, and every heading walk here has to agree about that.
 */
import { readFile } from "node:fs/promises";
import { decodeDocument } from "../kernel/document-bytes.js";
import {
  BASED_ON_LINE_RE, CAPABILITY_LINE_RE, KIND_RE, REQUIREMENT_ID_LINE_RE,
  type DeltaKind, type Requirement, type Scenario,
} from "./spec.js";

const REQ_RE = /^###\s+Requirement:\s*(.+?)\s*$/;
const SCN_RE = /^####\s+Scenario:\s*(.+?)\s*$/;

/**
 * THE requirements section: the one H2 a living spec keeps its requirements
 * under, the one section `loam archive` rewrites, and the one heading a delta
 * may legally quote the living state beneath. One definition on purpose — the
 * archive cut point, archive's stray-requirement guard, and the delta-shape
 * exemption (core/delta/document.ts) used to spell this invariant three different ways,
 * and the cut point's substring `indexOf("\n## Requirements")` was a PREFIX
 * match that also hit `## Requirements Extra`. Full-line match on a trimmed
 * heading, with KIND_RE's case and interior-whitespace tolerance.
 */
const REQUIREMENTS_SECTION_RE = /^##\s+Requirements\s*$/i;

/** Is this H2 heading line (as sectionHeadings/`Requirement.section` spell it) the `## Requirements` heading? */
export function isRequirementsHeading(heading: string): boolean {
  return REQUIREMENTS_SECTION_RE.test(heading.trim());
}

/**
 * Track ``` / ~~~ fences line by line. Returns true while the line is fenced
 * content — including the fence marker itself — so heading-like lines inside a
 * code block are never mistaken for structure.
 */
function fenceTracker(): (line: string) => boolean {
  let fence: string | null = null;
  return (line) => {
    const m = /^\s*(```|~~~)/.exec(line);
    if (m) {
      if (fence === null) fence = m[1]!;
      else if (fence === m[1]!) fence = null;
      return true;
    }
    return fence !== null;
  };
}

/**
 * Strip a leading UTF-8 BOM (U+FEFF), which editors on Windows write unasked.
 *
 * It has to happen here, at the two functions that take raw markdown, rather than
 * at each `readFile` call: those are spread across half the commands, so any one of
 * them could forget, and the failure is invisible. One byte was enough to void an
 * entire delta — `KIND_RE` is anchored `^##`, delta files routinely open with
 * `## MODIFIED Requirements` on line 1, and behind a BOM that line stopped being a
 * heading, so every requirement in the file fell back to BASE and
 * `applyRequirementDelta` skips BASE. Archive merged nothing and said nothing.
 * OpenSpec's own reader strips it for exactly this reason.
 *
 * Only at position 0: elsewhere U+FEFF is a zero-width no-break space and belongs
 * to the author's text.
 */
function stripBom(md: string): string {
  return md.charCodeAt(0) === 0xfeff ? md.slice(1) : md;
}

/** Every H2 heading outside a fenced block, with its 1-based line number. */
export function sectionHeadings(md: string): Array<{ text: string; line: number }> {
  const fenced = fenceTracker();
  const out: Array<{ text: string; line: number }> = [];
  stripBom(md).split(/\r?\n/).forEach((line, i) => {
    if (fenced(line)) return;
    if (/^##\s+/.test(line) && !line.startsWith("###")) out.push({ text: line.trim(), line: i + 1 });
  });
  return out;
}

/**
 * Split a living spec around its requirements RUN — the stretch of
 * `### Requirement:` blocks inside the `## Requirements` section — so a merge
 * can rewrite exactly that and nothing else. All three slices reassemble the
 * input byte-for-byte (`head + run + tail === text`):
 *
 * - `head` — everything before the first requirement in the section: the
 *   intro, the heading line itself, any prose under the heading.
 * - `run`  — from the first `### Requirement:` line to the section's end (the
 *   next `## ` heading, or EOF). Empty when the section holds no requirements.
 * - `tail` — everything from the section's end onward.
 *
 * Returns null when the document has no `## Requirements` heading at all.
 * Only the FIRST matching heading opens the section; a caller that must not
 * lose content behind a duplicate (archive) counts matches via
 * sectionHeadings() and refuses. Heading detection matches parseRequirements:
 * fenced lines are never structure, and a leading BOM hides no heading — but
 * the slices themselves are raw bytes, BOM and CRLF included.
 */
export function splitRequirementsSection(
  text: string,
): { head: string; run: string; tail: string } | null {
  const fenced = fenceTracker();
  let inSection = false;
  let sectionStart = -1;
  let runStart = -1;
  let sectionEnd = text.length;
  let offset = 0;
  while (offset < text.length) {
    const nl = text.indexOf("\n", offset);
    const lineEnd = nl === -1 ? text.length : nl + 1;
    let line = text.slice(offset, nl === -1 ? text.length : nl);
    if (line.endsWith("\r")) line = line.slice(0, -1);
    // Position 0 only, mirroring stripBom: elsewhere U+FEFF is content.
    if (offset === 0 && line.charCodeAt(0) === 0xfeff) line = line.slice(1);
    if (!fenced(line)) {
      if (/^##\s+/.test(line) && !line.startsWith("###")) {
        if (inSection) {
          sectionEnd = offset;
          inSection = false;
        } else if (sectionStart === -1 && isRequirementsHeading(line)) {
          sectionStart = offset;
          inSection = true;
        }
      } else if (inSection && runStart === -1 && REQ_RE.test(line)) {
        runStart = offset;
      }
    }
    offset = lineEnd;
  }
  if (sectionStart === -1) return null;
  const cut = runStart === -1 ? sectionEnd : runStart;
  return { head: text.slice(0, cut), run: text.slice(cut, sectionEnd), tail: text.slice(sectionEnd) };
}

/**
 * A requirement document from disk as text — decoded, or refused by name.
 *
 * The read that belongs with the parser, because `readFile(path, "utf8")` and
 * `parseRequirements` together are a trap: a UTF-16 spec.md decodes to a string
 * in which no line matches `^###\s+Requirement:`, so the parser returns [] and
 * the document grades as an empty baseline instead of an unreadable one. Every
 * question loam asks of a spec — is it covered, does the delta merge, what does
 * the C4 spine touch — is then answered about a file nobody read.
 *
 * It THROWS (`NotUtf8DocumentError`, which names the path), unlike
 * `readFrontmatter` next door, because the two failures are not the same
 * failure. Frontmatter is read by the fleet enumeration, where one bad file
 * must not cost the other 119 services, so there it is a flag. A requirement
 * document is read by ONE target, and the caller is the only one who knows what
 * to do about it: a read-only command turns it into a finding on that target
 * (validate's `guarded`, which names the file and keeps grading the rest), a
 * command that writes refuses outright rather than computing over mojibake.
 */
export async function readRequirementsDocument(path: string): Promise<string> {
  return decodeDocument(await readFile(path), path);
}

/** Parse all requirements (with their scenarios and delta kind) from a markdown doc. */
export function parseRequirements(md: string): Requirement[] {
  const out: Requirement[] = [];
  let kind: DeltaKind = "BASE";
  let section: string | undefined;
  let req: Requirement | null = null;
  let scn: Scenario | null = null;
  const fenced = fenceTracker();

  for (const [index, line] of stripBom(md).split(/\r?\n/).entries()) {
    if (fenced(line)) {
      // Fenced content, marker included: body of whatever is open, never structure.
      if (scn) scn.lines.push(line);
      else if (req) req.text.push(line);
      continue;
    }
    // Any H2 heading ends the current requirement/scenario capture — section prose
    // must not leak into the previous scenario's body.
    if (/^##\s+/.test(line) && !line.startsWith("###")) {
      req = null;
      scn = null;
      section = line.trim();
      const mk = KIND_RE.exec(line);
      // A non-delta H2 (## Notes, ## Requirements…) starts an unrelated section:
      // requirements under it are plain BASE, not part of a stale delta section.
      kind = mk ? (mk[1]!.toUpperCase() as DeltaKind) : "BASE";
      continue;
    }
    const mr = REQ_RE.exec(line);
    if (mr) {
      req = {
        kind,
        name: mr[1]!,
        text: [],
        operations: [],
        covers: [],
        publishes: [],
        consumes: [],
        requires: [],
        capabilities: [],
        scenarios: [],
        section,
        line: index + 1,
      };
      out.push(req);
      scn = null;
      continue;
    }
    const ms = SCN_RE.exec(line);
    if (ms && req) {
      scn = { name: ms[1]!, lines: [] };
      req.scenarios.push(scn);
      continue;
    }
    if (scn) {
      scn.lines.push(line);
    } else if (req) {
      req.text.push(line);
      const mi = REQUIREMENT_ID_LINE_RE.exec(line);
      if (mi) req.id = mi[1]!.trim();
      // Same keep-last quirk as Operations:/Covers: below — a repeated line is
      // a document problem, reported as one (`delta.baseline-invalid`), never
      // resolved differently by whoever happens to be reading.
      const mb = BASED_ON_LINE_RE.exec(line);
      if (mb) req.basedOn = mb[1]!.trim();
      const mo = /^\s*Operations?:\s*(.+?)\s*$/i.exec(line);
      if (mo) req.operations = mo[1]!.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
      // The Covers: mirror — same placement (requirement body, not a scenario),
      // same comma grammar, and deliberately the same quirk: a second line
      // REPLACES the first (assignment, not append), so the two lists can never
      // drift apart in how they read a repeated line.
      const mc = /^\s*Covers?:\s*(.+?)\s*$/i.exec(line);
      if (mc) req.covers = mc[1]!.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
      // The event axis, same grammar and the same keep-last quirk again. Note
      // what is NOT happening here: the line stays in `req.text` like every
      // other body line (the push above is unconditional), so it round-trips
      // through `serializeRequirements` and rides inside `requirementDigest`
      // exactly as `Operations:` does. That is what makes this parse purely
      // additive — no living document's digest moves, and no `Based-On:` pin
      // goes stale because loam learned to read one more line.
      const mp = /^\s*Publishes?:\s*(.+?)\s*$/i.exec(line);
      if (mp) req.publishes = mp[1]!.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
      const mcon = /^\s*Consumes?:\s*(.+?)\s*$/i.exec(line);
      if (mcon) req.consumes = mcon[1]!.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
      // The authorization axis. Same grammar, same keep-last quirk, same purely
      // additive parse — the line rides in `req.text` and therefore inside
      // `requirementDigest`, so no living document moves because loam learned
      // to read it.
      const mreq = /^\s*Requires?:\s*(.+?)\s*$/i.exec(line);
      if (mreq) req.requires = mreq[1]!.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
      // The capability axis. Same grammar, same keep-last quirk, same purely
      // additive parse as Requires: above — but note the OPT-IN differs: the
      // vocabulary FILE (architecture/capabilities.yaml) is the opt-in for this
      // axis, not the line, so entries parsed here grade as nothing at all
      // until a fleet writes that file (core/capabilities/findings.ts).
      const mcap = CAPABILITY_LINE_RE.exec(line);
      if (mcap) req.capabilities = mcap[1]!.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
    }
  }

  return out;
}

