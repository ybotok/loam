/**
 * The form a requirement takes in a context pack — built by both halves of
 * the pack, the living slice (`./living.ts`) and the deltas in flight
 * (`./features.ts`), so it is neither one's to own.
 */
import { type Requirement } from "../document/spec.js";

/**
 * A requirement as the pack carries it: the delta brief's `reqJson` shape plus
 * the four join lines (`Requires:`, `Capability:`, `Publishes:`, `Consumes:`)
 * the brief never needed. Verbatim on purpose — the pack is the briefing, and
 * a heading without its body is a table of contents for a file the reader then
 * has to open.
 */
export interface PackRequirement {
  kind: Requirement["kind"];
  id?: string;
  name: string;
  text: string;
  operations: string[];
  covers: string[];
  requires: string[];
  capabilities: string[];
  publishes: string[];
  consumes: string[];
  /** Verbatim: the acceptance criteria, and the source for the tests whoever picks this up writes. */
  scenarios: Array<{ name: string; lines: string[] }>;
}

export function packRequirement(r: Requirement): PackRequirement {
  return {
    kind: r.kind,
    ...(r.id === undefined ? {} : { id: r.id }),
    name: r.name,
    text: r.text.join("\n").trim(),
    operations: r.operations,
    covers: r.covers,
    requires: r.requires,
    capabilities: r.capabilities,
    publishes: r.publishes,
    consumes: r.consumes,
    scenarios: r.scenarios.map((s) => ({ name: s.name, lines: s.lines })),
  };
}
