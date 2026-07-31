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
  scenarios: Scenario[];
}

const KIND_RE = /^##\s+(ADDED|MODIFIED|REMOVED)\s+Requirements\s*$/i;
const REQ_RE = /^###\s+Requirement:\s*(.+?)\s*$/;
const SCN_RE = /^####\s+Scenario:\s*(.+?)\s*$/;

/** Parse all requirements (with their scenarios and delta kind) from a markdown doc. */
export function parseRequirements(md: string): Requirement[] {
  const out: Requirement[] = [];
  let kind: DeltaKind = "BASE";
  let req: Requirement | null = null;
  let scn: Scenario | null = null;

  for (const line of md.split("\n")) {
    const mk = KIND_RE.exec(line);
    if (mk) {
      kind = mk[1]!.toUpperCase() as DeltaKind;
      continue;
    }
    const mr = REQ_RE.exec(line);
    if (mr) {
      req = { kind, name: mr[1]!, text: [], scenarios: [] };
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
    if (scn) scn.lines.push(line);
    else if (req) req.text.push(line);
  }

  return out;
}

/** Requirements with no scenario — the OpenSpec coverage rule (every requirement needs ≥1). */
export function requirementsMissingScenarios(reqs: Requirement[]): Requirement[] {
  return reqs.filter((r) => r.kind !== "REMOVED" && r.scenarios.length === 0);
}

/** Serialize requirements back to OpenSpec markdown (`### Requirement:` + `#### Scenario:`). */
export function serializeRequirements(reqs: Requirement[]): string {
  const out: string[] = [];
  for (const r of reqs) {
    out.push(`### Requirement: ${r.name}`);
    const text = r.text.join("\n").trim();
    if (text) out.push("", text);
    for (const s of r.scenarios) {
      out.push("", `#### Scenario: ${s.name}`);
      const body = s.lines.join("\n").trim();
      if (body) out.push(body);
    }
    out.push("");
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

/** Apply a feature's ADDED/MODIFIED/REMOVED requirements onto a living requirement set. */
export function applyRequirementDelta(living: Requirement[], delta: Requirement[]): Requirement[] {
  const result: Requirement[] = living.map((r) => ({ ...r, kind: "BASE" as DeltaKind }));
  for (const d of delta) {
    const i = result.findIndex((r) => r.name === d.name);
    if (d.kind === "REMOVED") {
      if (i >= 0) result.splice(i, 1);
    } else {
      const merged: Requirement = { ...d, kind: "BASE" };
      if (i >= 0) result[i] = merged;
      else result.push(merged);
    }
  }
  return result;
}
