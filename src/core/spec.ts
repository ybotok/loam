/**
 * Parser for OpenSpec-style requirement documents.
 *
 * Living specs use `## Requirements` with `### Requirement:` + `#### Scenario:`.
 * Feature deltas group requirements under `## ADDED|MODIFIED|REMOVED Requirements`.
 * Scenarios are the acceptance criteria (Given/When/Then) and the source for tests.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { decodeDocument } from "./fleet-context.js";
import { scenarioGherkin } from "./gherkin.js";
import type { Finding } from "./report.js";

export type DeltaKind = "ADDED" | "MODIFIED" | "REMOVED" | "BASE";

export interface Scenario {
  name: string;
  lines: string[];
}

export interface Requirement {
  /** BASE for a living spec; ADDED/MODIFIED/REMOVED inside a feature delta. */
  kind: DeltaKind;
  /**
   * Stable identity from a `Requirement-ID:` body line. Optional so existing
   * OpenSpec-compatible documents continue to use their heading as identity.
   */
  id?: string;
  /**
   * The living requirement this delta was WRITTEN AGAINST, from a `Based-On:`
   * body line — `requirementDigest` of that requirement at authoring time.
   *
   * Delta-only, and meaningful on MODIFIED/REMOVED alone: those two address a
   * requirement that already exists, and a MODIFIED carries its full new text,
   * so archive does not merge the living wording — it REPLACES it. Two features
   * rewriting one requirement therefore lose the loser's text outright, and the
   * in-flight warning (`delta.modified-conflict`) cannot see the case that
   * actually happens: once the first archives it leaves `changes/`, the second
   * goes green again, and its stale text lands on top without a word. This is
   * the pin that closes that window — the same trick as `sources_digest`
   * (core/provenance.ts), one requirement wide.
   *
   * Absent on requirements adopted from OpenSpec, which never had the line;
   * those keep the older, weaker protection and are told so once (warn).
   */
  basedOn?: string;
  name: string;
  text: string[];
  /** OpenAPI operationIds this requirement governs, from an `Operations:` line. */
  operations: string[];
  /**
   * What this requirement's scenarios exercise, from a `Covers:` line — the
   * architecture analog of `Operations:`. Entries are C4 element ids, edges
   * (`source -> target`), or health signals (`alert:<id>` / `sli:<id>`);
   * core/arch.ts owns the grammar and the resolution. Parsed everywhere for one
   * grammar's sake, meaningful in arch.spec.md.
   */
  covers: string[];
  scenarios: Scenario[];
  /**
   * The H2 heading of its SOURCE DOCUMENT this requirement was parsed under,
   * verbatim (`## Behavior`), or absent if it preceded every heading. Records where
   * the text came from, so it stays true after a merge re-homes the requirement.
   *
   * `kind` alone cannot explain why a requirement is BASE, and the two BASE cases
   * differ completely: under `## Requirements` a delta is legally quoting the
   * living state, while under `## Behavior` the author wrote a change that archive
   * will silently not merge. `delta.requirement-not-merged` tells them apart.
   */
  section?: string;
  /**
   * 1-based line of this requirement's `### Requirement:` heading in its source
   * document. Body line `text[i]` is therefore at line `line + 1 + i` — the
   * capture is contiguous from the heading to the first scenario — which is what
   * lets `loam rebase` rewrite one `Based-On:` line by surgery instead of
   * reserializing the document and flattening the author's sections and prose.
   */
  line?: number;
}

export const KIND_RE = /^##\s+(ADDED|MODIFIED|REMOVED)\s+Requirements\s*$/i;
const REQ_RE = /^###\s+Requirement:\s*(.+?)\s*$/;
const SCN_RE = /^####\s+Scenario:\s*(.+?)\s*$/;
const REQUIREMENT_ID_LINE_RE = /^\s*Requirement-ID:\s*(.*?)\s*$/i;
const BASED_ON_LINE_RE = /^\s*Based-On:\s*(.*?)\s*$/i;

/** Portable, review-friendly stable IDs. Case-sensitive by design. */
export const REQUIREMENT_ID_RE = /^[A-Za-z][A-Za-z0-9._-]{0,127}$/;

/**
 * How much of the sha256 a `Based-On:` line carries — the length
 * `sources_digest` already uses (core/provenance.ts), for one reason a reader
 * can hold: every digest loam writes into a document reads the same.
 */
export const REQUIREMENT_DIGEST_LENGTH = 16;

/** The value shape of a `Based-On:` line, exactly as `requirementDigest` writes it. */
export const REQUIREMENT_DIGEST_RE = new RegExp(`^[0-9a-f]{${REQUIREMENT_DIGEST_LENGTH}}$`);

export type RequirementIdProblem =
  | { kind: "invalid"; requirement: string; value: string }
  | { kind: "repeated"; requirement: string; values: string[] }
  | { kind: "duplicate"; id: string; requirements: string[] };

/** Every authored Requirement-ID value in a requirement body, including blanks. */
export function requirementIdDeclarations(requirement: Requirement): string[] {
  return requirement.text.flatMap((line) => {
    const match = REQUIREMENT_ID_LINE_RE.exec(line);
    return match === null ? [] : [match[1]!.trim()];
  });
}

/** Structural ID problems within one spec/delta document. */
export function requirementIdProblems(reqs: Requirement[]): RequirementIdProblem[] {
  const problems: RequirementIdProblem[] = [];
  const owners = new Map<string, string[]>();
  for (const requirement of reqs) {
    const declarations = requirementIdDeclarations(requirement);
    const values = declarations.length > 0
      ? declarations
      : requirement.id === undefined
        ? []
        : [requirement.id];
    if (declarations.length > 1) {
      problems.push({ kind: "repeated", requirement: requirement.name, values: declarations });
    }
    for (const value of values) {
      if (!REQUIREMENT_ID_RE.test(value)) {
        problems.push({ kind: "invalid", requirement: requirement.name, value });
      }
    }
    // A repeated declaration is already an error. Do not also pretend its
    // keep-last parse result is an unambiguous document identity.
    if (values.length !== 1 || !REQUIREMENT_ID_RE.test(values[0]!)) continue;
    const names = owners.get(values[0]!) ?? [];
    names.push(requirement.name);
    owners.set(values[0]!, names);
  }
  for (const [id, requirements] of owners) {
    if (requirements.length > 1) problems.push({ kind: "duplicate", id, requirements });
  }
  return problems;
}

/** Every authored `Based-On:` value in a requirement body, including blanks. */
export function basedOnDeclarations(requirement: Requirement): string[] {
  return requirement.text.flatMap((line) => {
    const match = BASED_ON_LINE_RE.exec(line);
    return match === null ? [] : [match[1]!.trim()];
  });
}

/**
 * The requirement without its baseline marker — what a digest is taken over,
 * and what archive merges into the living document.
 *
 * `Based-On:` is a statement ABOUT a delta ("this was written against that"),
 * never part of the requirement it describes, and both consequences of
 * forgetting that are bad. Left in the digest input, a requirement's digest
 * would depend on the pin pointing at it, so no baseline could ever be
 * self-consistent. Left in the merged text — `applyRequirementDelta` copies the
 * delta's body into living wholesale — the living document would grow a pin to
 * a version of itself, and the NEXT feature's baseline would be taken over a
 * document containing the previous feature's bookkeeping.
 */
function withoutBaseline(requirement: Requirement): Requirement {
  const { basedOn: _dropped, ...rest } = requirement;
  return { ...rest, text: requirement.text.filter((line) => !BASED_ON_LINE_RE.test(line)) };
}

/**
 * The identity of a requirement's CONTENT: sha256 over its canonical
 * serialization, truncated like every other digest loam stamps.
 *
 * Canonical, not raw bytes, and deliberately: a living spec is rewritten by
 * `serializeRequirements` on every archive, so hashing the file's bytes would
 * make a baseline go stale over reflowed blank lines — a false alarm on the one
 * check whose whole value is that it only fires when something real moved.
 * What the hash therefore covers is exactly what survives a round trip: the
 * heading, the body (`Requirement-ID:` and `Operations:`/`Covers:` lines
 * included), and every scenario with its Given/When/Then lines. `kind` and
 * `section` are not serialized and so are not hashed — a requirement does not
 * change because the document quoting it moved it under another heading.
 */
export function requirementDigest(requirement: Requirement): string {
  return createHash("sha256")
    .update(serializeRequirements([withoutBaseline(requirement)]), "utf8")
    .digest("hex")
    .slice(0, REQUIREMENT_DIGEST_LENGTH);
}

/**
 * THE requirements section: the one H2 a living spec keeps its requirements
 * under, the one section `loam archive` rewrites, and the one heading a delta
 * may legally quote the living state beneath. One definition on purpose — the
 * archive cut point, archive's stray-requirement guard, and the delta-shape
 * exemption (core/delta.ts) used to spell this invariant three different ways,
 * and the cut point's substring `indexOf("\n## Requirements")` was a PREFIX
 * match that also hit `## Requirements Extra`. Full-line match on a trimmed
 * heading, with KIND_RE's case and interior-whitespace tolerance.
 */
export const REQUIREMENTS_SECTION_RE = /^##\s+Requirements\s*$/i;

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
      req = { kind, name: mr[1]!, text: [], operations: [], covers: [], scenarios: [], section, line: index + 1 };
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
    }
  }

  return out;
}

/** Requirements with no scenario — the OpenSpec coverage rule (every requirement needs ≥1). */
export function requirementsMissingScenarios(reqs: Requirement[]): Requirement[] {
  return reqs.filter((r) => r.kind !== "REMOVED" && r.scenarios.length === 0);
}

/** A `#### Scenario:` heading whose body holds nothing a runner would execute. */
export interface SteplessScenario {
  requirement: string;
  scenario: string;
}

/**
 * Scenarios that satisfy the coverage rule above and test nothing.
 *
 * `requirementsMissingScenarios` counts HEADINGS, so a `#### Scenario:` with no
 * recognizable Given/When/Then line satisfied the fleet gate's coverage claim
 * outright — and it is not a hypothetical shape: it is what `loam new`
 * scaffolds and what an agent writes when it puts the criteria in prose.
 * Downstream the same emptiness is fatal twice over: cucumber runs a stepless
 * scenario vacuously green, and `loam verify --results` can never confirm it.
 *
 * The detector is `loam gherkin`'s own — `scenarioGherkin` decides what a step
 * IS, and a second opinion here would mean the gate and the emitted suite could
 * disagree about whether a scenario has any. That import is the one place these
 * two modules are circular (gherkin.ts parses requirements); both sides export
 * only function declarations, which are hoisted, so neither evaluation order
 * can observe a half-built module.
 */
export function steplessScenarios(reqs: Requirement[]): SteplessScenario[] {
  const out: SteplessScenario[] = [];
  for (const r of reqs) {
    if (r.kind === "REMOVED") continue;
    for (const s of r.scenarios) {
      if (scenarioGherkin(s.lines).steps.length === 0) out.push({ requirement: r.name, scenario: s.name });
    }
  }
  return out;
}

/**
 * The stepless half of the coverage check, as findings — the missing-scenario
 * half stays where it is (`requirementsMissingScenarios`), because the two are
 * different states with different fixes: one requirement owes acceptance
 * criteria, the other owes STEPS in criteria somebody has already written.
 *
 * `label` is the coverage check's own label (`payment-service: requirements`),
 * so both halves of one document name it the same way.
 */
export function steplessFindings(label: string, subject: string, reqs: Requirement[]): Finding[] {
  const bare = steplessScenarios(reqs);
  if (bare.length === 0) return [];
  return [
    {
      severity: "error",
      code: "requirements.stepless-scenario",
      subject,
      message:
        `${label}: ${bare.length} scenario(s) have a heading and no recognizable steps — ` +
        `they satisfy the coverage rule and test nothing. Cucumber runs a stepless scenario vacuously green and ` +
        `\`loam verify --results\` can never confirm it. Write the body as \`- **Given/When/Then**\` bullets.`,
      details: bare.map((s) => `${s.requirement} — ${s.scenario}`),
      text: { detailPrefix: "- " },
    },
  ];
}

/** Serialize requirements back to OpenSpec markdown (`### Requirement:` + `#### Scenario:`). */
export function serializeRequirements(reqs: Requirement[]): string {
  // Framing (blank lines between sections) is normalized here; body content is
  // only edge-trimmed, never collapsed — blank lines inside a scenario (e.g. in
  // fenced code blocks) are verbatim content.
  const chunks: string[] = [];
  for (const r of reqs) {
    const chunk: string[] = [`### Requirement: ${r.name}`];
    const body = [...r.text];
    // Parsed documents already carry the authored line in `text`. This branch
    // also makes programmatically constructed Requirements serialize fully.
    if (r.id !== undefined && !body.some((line) => REQUIREMENT_ID_LINE_RE.test(line))) {
      body.unshift(`Requirement-ID: ${r.id}`);
    }
    // Directly under the identity it pins, which is where `loam rebase` writes
    // it too — the two lines are read together, so they are never apart.
    if (r.basedOn !== undefined && !body.some((line) => BASED_ON_LINE_RE.test(line))) {
      body.splice(body.findIndex((line) => REQUIREMENT_ID_LINE_RE.test(line)) + 1, 0, `Based-On: ${r.basedOn}`);
    }
    const text = body.join("\n").trim();
    if (text) chunk.push("", text);
    for (const s of r.scenarios) {
      chunk.push("", `#### Scenario: ${s.name}`);
      const body = s.lines.join("\n").trim();
      if (body) chunk.push(body);
    }
    chunks.push(chunk.join("\n"));
  }
  return chunks.join("\n\n").trim() + "\n";
}

/**
 * A delta requirement as it lands in the living document, with the bookkeeping
 * that belongs to the DELTA left behind: the `Based-On:` pin (a claim about
 * which living version this was written against — meaningless once it IS the
 * living version, and poison for the next feature's baseline, which would then
 * hash the previous feature's pin) and the line it was parsed from.
 */
function asLiving(d: Requirement): Requirement {
  const { line: _dropped, ...rest } = withoutBaseline(d);
  return { ...rest, kind: "BASE" };
}

/** Apply a feature's ADDED/MODIFIED/REMOVED requirements onto a living requirement set. */
export function applyRequirementDelta(living: Requirement[], delta: Requirement[]): Requirement[] {
  const malformed = [...requirementIdProblems(living), ...requirementIdProblems(delta)];
  if (malformed.length > 0) {
    throw new Error("cannot merge requirements with invalid, repeated, or duplicate Requirement-ID declarations");
  }
  let result: Requirement[] = living.map((r) => ({ ...r, kind: "BASE" as DeltaKind }));
  for (const d of delta) {
    // BASE is not a delta kind — a requirement outside an ADDED/MODIFIED/REMOVED
    // section (e.g. quoted under ## Notes) is documentation, not a change.
    if (d.kind === "BASE") continue;
    if (d.id !== undefined) {
      const idMatches = result
        .map((r, i) => (r.id === d.id ? i : -1))
        .filter((i) => i >= 0);
      const nameMatches = result
        .map((r, i) => (r.name === d.name ? i : -1))
        .filter((i) => i >= 0);
      const otherNameMatches = nameMatches.filter((i) => !idMatches.includes(i));
      if (idMatches.length > 1 || otherNameMatches.length > 0) {
        throw new Error(
          `ambiguous requirement identity for '${d.name}' (${d.id}): Requirement-ID and heading select different living requirements`,
        );
      }
      if (d.kind === "REMOVED") {
        const selected = new Set(idMatches);
        result = result.filter((_, i) => !selected.has(i));
      } else {
        const merged: Requirement = asLiving(d);
        if (idMatches.length === 1) result[idMatches[0]!] = merged;
        else result.push(merged);
      }
    } else if (d.kind === "REMOVED") {
      result = result.filter((r) => r.name !== d.name);
    } else {
      const i = result.findIndex((r) => r.name === d.name);
      // A legacy delta may still modify an ID-bearing living requirement by
      // its exact heading. Keep the identity while the repository migrates.
      const inheritedId = i >= 0 ? result[i]!.id : undefined;
      const merged: Requirement = {
        ...asLiving(d),
        ...(inheritedId === undefined ? {} : { id: inheritedId }),
      };
      if (i >= 0) result[i] = merged;
      else result.push(merged);
    }
  }
  return result;
}
