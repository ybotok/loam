/**
 * The fleet total over the capability join, built once and reused by the fleet
 * grade, `loam list capabilities` and `loam explore --capability` — one walk,
 * so the unrealized warning and the rollup a reader diffs can never disagree
 * about what "realized" means.
 *
 * Deterministic and diff-stable by construction: rows sorted with compareIds,
 * realizedBy sorted by (service, file, requirement), statuses' keys sorted —
 * no timestamps, no absolute paths, no readdir-order dependence. The reader is
 * INJECTED (`read`) rather than a FleetContext, because fleet-context.ts
 * imports this package for its memo and an import back would be a package
 * cycle (see the memo's comment); callers pass `fleet.readRequirements` bound,
 * so under `validate --all` every parse is already cached from the service
 * targets and the rollup costs no additional per-service read.
 */
import { existsSync } from "node:fs";
import type { Requirement } from "../document/spec.js";
import { compareIds, type ServiceEntry } from "../repo/entries.js";
import { SPEC_AXES, servicePathsAt } from "../repo/paths.js";
import type { CapabilityVocabulary } from "./capabilities.js";

/** One requirement realizing one capability, located exactly. */
export interface CapabilityRealization {
  service: string;
  file: "spec.md" | "arch.spec.md";
  /** The requirement's `### Requirement:` name. */
  requirement: string;
}

/** One declared capability with everything the fleet says about it. */
export interface CapabilityRow {
  id: string;
  description?: string;
  owner?: string;
  realizedBy: CapabilityRealization[];
  /** Distinct realizing services, sorted. */
  services: string[];
  /**
   * Realizing requirements counted by their service's frontmatter status
   * (`unset` for a service nobody has marked) — the draft/verified split the
   * roadmap asks the total to answer.
   */
  statuses: Record<string, number>;
}

export interface CapabilityRollupInput {
  services: ServiceEntry[];
  vocab: CapabilityVocabulary;
  /** The requirement reader — pass a FleetContext's readRequirements, bound. */
  read: (path: string) => Promise<Requirement[]>;
}

/**
 * Walk every service's spec.md and arch.spec.md (existsSync-guarded, exactly
 * like permissionFindings: an absent OPTIONAL artifact must never take a whole
 * `--all` run down) and join non-REMOVED requirements' `Capability:` entries to
 * the declared vocabulary. Rows exist for every DECLARED id — an unrealized
 * declaration is a row with empty realizedBy, which is what the unrealized
 * grade and the list's `0 — unrealized` marker both read.
 */
export async function capabilityRollup(input: CapabilityRollupInput): Promise<CapabilityRow[]> {
  const { services, vocab, read } = input;
  const rows = new Map<string, CapabilityRow>();
  for (const id of [...vocab.byId.keys()].sort(compareIds)) {
    const decl = vocab.byId.get(id)!;
    rows.set(id, {
      id,
      ...(decl.description !== undefined ? { description: decl.description } : {}),
      ...(decl.owner !== undefined ? { owner: decl.owner } : {}),
      realizedBy: [],
      services: [],
      statuses: {},
    });
  }
  for (const entry of services) {
    const paths = servicePathsAt(entry.dir);
    for (const axis of SPEC_AXES) {
      const path = paths[axis.key];
      if (!existsSync(path)) continue;
      for (const r of await read(path)) {
        if (r.kind === "REMOVED") continue;
        for (const capability of r.capabilities) {
          const row = rows.get(capability);
          if (row === undefined) continue; // undeclared — capability.unknown's business, not the rollup's
          row.realizedBy.push({ service: entry.id, file: axis.file, requirement: r.name });
          const status = entry.status ?? "unset";
          row.statuses[status] = (row.statuses[status] ?? 0) + 1;
        }
      }
    }
  }
  for (const row of rows.values()) {
    row.realizedBy.sort(
      (a, b) =>
        compareIds(a.service, b.service) ||
        a.file.localeCompare(b.file) ||
        compareIds(a.requirement, b.requirement),
    );
    row.services = [...new Set(row.realizedBy.map((r) => r.service))].sort(compareIds);
    row.statuses = Object.fromEntries(Object.entries(row.statuses).sort(([a], [b]) => compareIds(a, b)));
  }
  return [...rows.values()];
}

/** The declared ids something realizes — the set the unrealized grade is taken against. */
export function usedCapabilities(rows: CapabilityRow[]): Set<string> {
  return new Set(rows.filter((row) => row.realizedBy.length > 0).map((row) => row.id));
}

/**
 * The requested ids the rollup cannot seed from: undeclared, or declared but
 * realized by nothing. One list on purpose — explore's contract is 'every miss
 * is a field', and splitting the two miss kinds waits for a consumer to ask.
 */
export function unresolvedCapabilities(rows: CapabilityRow[], requested: string[]): string[] {
  const realized = usedCapabilities(rows);
  return requested.filter((id) => !realized.has(id));
}
