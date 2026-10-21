/**
 * The shapes every view of `loam show` is written in: a tick for a file that
 * exists, a scenario count, an edge note, and one requirement as a line and as
 * a `--json` entry. (The parse-error line is `errorText` in `core/c4/likec4.ts`,
 * shared with validate.)
 *
 * A leaf of its own because the service view, the feature view and the view of
 * a service a feature introduces all use them, and none should have to import
 * another to reach a tick. The requirement shapes moved here from the service
 * view when the introduced view arrived: a delta requirement is listed exactly
 * as a living one is, and two spellings of one entry are two entries a
 * consumer has to learn.
 */
import { type Requirement } from "../../core/document/spec.js";
import { plural } from "../policy/format.js";
import { type Edge } from "./service.js";

export function mark(present: boolean): string {
  return present ? "✓" : "-";
}

export function scenarioCount(reqs: Requirement[]): number {
  return reqs.reduce((n, r) => n + r.scenarios.length, 0);
}

export function edgeNote(e: Edge): string {
  if (e.op) return `  ${e.op}`;
  return e.title ? `  "${e.title}"` : "";
}

/** A requirement's `--json` entry — `requirements[]` and `archSpec.entries[]` alike. */
export function requirementJson(r: Requirement): Record<string, unknown> {
  return {
    id: r.id,
    name: r.name,
    kind: r.kind,
    scenarios: r.scenarios.length,
    operations: r.operations,
    covers: r.covers,
  };
}

/** A requirement as one line, unindented: its name, its scenarios, what it governs and covers. */
export function requirementLine(r: Requirement): string {
  const govern = r.operations.length > 0 ? `  → ${r.operations.join(", ")}` : "";
  const covers = r.covers.length > 0 ? `  covers ${r.covers.join(", ")}` : "";
  return `${r.name}  (${plural(r.scenarios.length, "scenario")})${govern}${covers}`;
}

/** A requirement delta's ADDED / MODIFIED / REMOVED counts — one spelling for `show <FEAT>` and the introduced-service view. */
export function kindCounts(reqs: Requirement[]): { added: number; modified: number; removed: number } {
  return {
    added: reqs.filter((r) => r.kind === "ADDED").length,
    modified: reqs.filter((r) => r.kind === "MODIFIED").length,
    removed: reqs.filter((r) => r.kind === "REMOVED").length,
  };
}
