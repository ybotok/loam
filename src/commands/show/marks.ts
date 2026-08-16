/**
 * The four one-line shapes both halves of `loam show` are written in: a tick
 * for a file that exists, a scenario count, an edge note, a parse error.
 *
 * A leaf of its own because the service view and the feature view both use
 * them, and neither should have to import the other to reach a tick.
 */
import { type Requirement } from "../../core/document/spec.js";
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

export function errorText(e: { message: string; line?: number }): string {
  return typeof e.line === "number" ? `L${e.line}: ${e.message}` : e.message;
}
