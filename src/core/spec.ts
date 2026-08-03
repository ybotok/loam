/**
 * Parser for OpenSpec-style requirement documents.
 *
 * Living specs use `## Requirements` with `### Requirement:` + `#### Scenario:`.
 * Feature deltas group requirements under `## ADDED|MODIFIED|REMOVED Requirements`.
 * Scenarios are the acceptance criteria (Given/When/Then) and the source for tests.
 */

export type DeltaKind = "ADDED" | "MODIFIED" | "REMOVED" | "BASE";

export interface Scenario {
  name: string;
  lines: string[];
}

export interface Requirement {
  /** BASE for a living spec; ADDED/MODIFIED/REMOVED inside a feature delta. */
  kind: DeltaKind;
  name: string;
  text: string[];
  /** OpenAPI operationIds this requirement governs, from an `Operations:` line. */
  operations: string[];
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
}

export const KIND_RE = /^##\s+(ADDED|MODIFIED|REMOVED)\s+Requirements\s*$/i;
const REQ_RE = /^###\s+Requirement:\s*(.+?)\s*$/;
const SCN_RE = /^####\s+Scenario:\s*(.+?)\s*$/;

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
    if (/^##\s+/.test(line) && !/^###/.test(line)) out.push({ text: line.trim(), line: i + 1 });
  });
  return out;
}

/** Parse all requirements (with their scenarios and delta kind) from a markdown doc. */
export function parseRequirements(md: string): Requirement[] {
  const out: Requirement[] = [];
  let kind: DeltaKind = "BASE";
  let section: string | undefined;
  let req: Requirement | null = null;
  let scn: Scenario | null = null;
  const fenced = fenceTracker();

  for (const line of stripBom(md).split(/\r?\n/)) {
    if (fenced(line)) {
      // Fenced content, marker included: body of whatever is open, never structure.
      if (scn) scn.lines.push(line);
      else if (req) req.text.push(line);
      continue;
    }
    // Any H2 heading ends the current requirement/scenario capture — section prose
    // must not leak into the previous scenario's body.
    if (/^##\s+/.test(line) && !/^###/.test(line)) {
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
      req = { kind, name: mr[1]!, text: [], operations: [], scenarios: [], section };
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
      const mo = /^\s*Operations?:\s*(.+?)\s*$/i.exec(line);
      if (mo) req.operations = mo[1]!.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
    }
  }

  return out;
}

/** Requirements with no scenario — the OpenSpec coverage rule (every requirement needs ≥1). */
export function requirementsMissingScenarios(reqs: Requirement[]): Requirement[] {
  return reqs.filter((r) => r.kind !== "REMOVED" && r.scenarios.length === 0);
}

/** Serialize requirements back to OpenSpec markdown (`### Requirement:` + `#### Scenario:`). */
export function serializeRequirements(reqs: Requirement[]): string {
  // Framing (blank lines between sections) is normalized here; body content is
  // only edge-trimmed, never collapsed — blank lines inside a scenario (e.g. in
  // fenced code blocks) are verbatim content.
  const chunks: string[] = [];
  for (const r of reqs) {
    const chunk: string[] = [`### Requirement: ${r.name}`];
    const text = r.text.join("\n").trim();
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

/** Apply a feature's ADDED/MODIFIED/REMOVED requirements onto a living requirement set. */
export function applyRequirementDelta(living: Requirement[], delta: Requirement[]): Requirement[] {
  let result: Requirement[] = living.map((r) => ({ ...r, kind: "BASE" as DeltaKind }));
  for (const d of delta) {
    // BASE is not a delta kind — a requirement outside an ADDED/MODIFIED/REMOVED
    // section (e.g. quoted under ## Notes) is documentation, not a change.
    if (d.kind === "BASE") continue;
    if (d.kind === "REMOVED") {
      result = result.filter((r) => r.name !== d.name);
    } else {
      const i = result.findIndex((r) => r.name === d.name);
      const merged: Requirement = { ...d, kind: "BASE" };
      if (i >= 0) result[i] = merged;
      else result.push(merged);
    }
  }
  return result;
}
