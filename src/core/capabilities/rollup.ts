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
import { splitRealizesEntry } from "./realizes/join.js";

/** One requirement realizing one capability, located exactly. */
export interface CapabilityRealization {
  service: string;
  file: "spec.md" | "arch.spec.md";
  /** The requirement's `### Requirement:` name. */
  requirement: string;
}

/** One requirement OF a capability document, and what realizes it. */
export interface CapabilityRequirementRow {
  /** Its `Requirement-ID:`. A requirement without one is absent here — see `capabilityRequirementRows`. */
  id: string;
  /** Its `### Requirement:` heading. */
  name: string;
  /** Service requirements whose `Realizes:` line names `<capability>#<id>`. */
  realizedBy: CapabilityRealization[];
}

/** One declared capability with everything the fleet says about it. */
export interface CapabilityRow {
  id: string;
  description?: string;
  owner?: string;
  /**
   * Service requirements realizing this capability BY EITHER JOIN, deduplicated
   * on (service, file, requirement).
   *
   * Both joins land here on purpose. `Realizes: checkout#CHK-1` realizes part of
   * `checkout` as surely as `Capability: checkout` does, and a rollup that
   * counted only the second would report a capability as realized by nobody
   * while the fleet pointed at its individual promises — which would then be
   * one spurious `capability.unrealized` per capability an author had documented
   * carefully enough to join at requirement level. The deduplication is what
   * lets a requirement carry both lines, which is the normal shape: the theme
   * and the promise are different claims.
   */
  realizedBy: CapabilityRealization[];
  /** Distinct realizing services, sorted. */
  services: string[];
  /**
   * Realizing requirements counted by their service's frontmatter status
   * (`unset` for a service nobody has marked) — the draft/verified split the
   * roadmap asks the total to answer. Counted over the DEDUPLICATED set above,
   * so a requirement writing both joins is one requirement.
   */
  statuses: Record<string, number>;
  /**
   * The capability document's own requirements, each with what realizes it.
   * Present only for a capability that HAS a document — absent and empty are
   * different answers, and only the second means "the document declares none".
   */
  requirements?: CapabilityRequirementRow[];
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
  // Rows exist only for DECLARED ids, so an empty vocabulary (absent file, or
  // present with nothing declared) can build nothing — walking every service's
  // two spec files to produce zero rows is what a vocabless 120-service fleet
  // would otherwise pay on every `list`/`explore` that asks.
  if (vocab.byId.size === 0) return [];
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
  // The documents, before the services, because a `Realizes:` entry can only
  // land on a requirement row that already exists.
  for (const doc of vocab.tree.docs) {
    const row = rows.get(doc.id);
    if (row === undefined) continue; // unreachable: the tree is one half of byId
    row.requirements = capabilityRequirementRows(await read(doc.spec));
  }

  // Realizations are collected as a SET per row before they become a list, so
  // the two joins cannot count one requirement twice — see `CapabilityRow.realizedBy`.
  const claimed = new Map<CapabilityRow, Map<string, CapabilityRealization>>();
  for (const entry of services) {
    const paths = servicePathsAt(entry.dir);
    for (const axis of SPEC_AXES) {
      const path = paths[axis.key];
      if (!existsSync(path)) continue;
      for (const r of await read(path)) {
        if (r.kind === "REMOVED") continue;
        const where: CapabilityRealization = { service: entry.id, file: axis.file, requirement: r.name };
        for (const capability of r.capabilities) claim(rows, claimed, capability, where);
        for (const target of r.realizes.map(splitRealizesEntry)) {
          if (target === null) continue; // malformed — capability.realizes-unknown's business
          claim(rows, claimed, target.capability, where);
          // The requirement-level half. An entry naming an id the document does
          // not declare lands nowhere, which is exactly right: it is already
          // `capability.realizes-unknown`, and inventing a row for it here would
          // make a typo look like a promise somebody wrote.
          rows
            .get(target.capability)
            ?.requirements?.find((req) => req.id === target.requirement)
            ?.realizedBy.push(where);
        }
      }
    }
  }

  for (const row of rows.values()) {
    row.realizedBy = [...(claimed.get(row)?.values() ?? [])].sort(compareRealizations);
    row.services = [...new Set(row.realizedBy.map((r) => r.service))].sort(compareIds);
    const byStatus: Record<string, number> = {};
    for (const r of row.realizedBy) {
      const status = statusOf(services, r.service);
      byStatus[status] = (byStatus[status] ?? 0) + 1;
    }
    row.statuses = Object.fromEntries(Object.entries(byStatus).sort(([a], [b]) => compareIds(a, b)));
    for (const req of row.requirements ?? []) req.realizedBy.sort(compareRealizations);
  }
  return [...rows.values()];
}

/** Deterministic realization order — the diff-stable rule this module states for its rows. */
function compareRealizations(a: CapabilityRealization, b: CapabilityRealization): number {
  return (
    compareIds(a.service, b.service) ||
    a.file.localeCompare(b.file) ||
    compareIds(a.requirement, b.requirement)
  );
}

/** The service's declared frontmatter status, or `unset` for one nobody has marked. */
function statusOf(services: ServiceEntry[], id: string): string {
  return services.find((s) => s.id === id)?.status ?? "unset";
}

/** Record one realization of one capability, deduplicated on where it came from. */
function claim(
  rows: Map<string, CapabilityRow>,
  claimed: Map<CapabilityRow, Map<string, CapabilityRealization>>,
  capability: string,
  where: CapabilityRealization,
): void {
  const row = rows.get(capability);
  if (row === undefined) return; // undeclared — capability.unknown's business, not the rollup's
  const seen = claimed.get(row) ?? new Map<string, CapabilityRealization>();
  seen.set(`${where.service}\0${where.file}\0${where.requirement}`, where);
  claimed.set(row, seen);
}

/**
 * A capability document's requirements as rows, keyed by their stable id.
 *
 * A requirement WITHOUT a `Requirement-ID:` is dropped rather than keyed by its
 * heading, and the drop is the honest answer rather than a shortcut: nothing
 * can address it — `Realizes:` names an id — so a row for it would be a promise
 * reported as unrealized that no author could ever mark realized.
 * `capability.requirement-unidentified` is the finding that names it, and it is
 * an ERROR, so the state does not persist quietly.
 *
 * A duplicate id keeps the FIRST, matching `requirementIdProblems`' own
 * `duplicate` grade: the document already earns an error for it, and picking a
 * winner here is only about not producing two identical rows.
 */
export function capabilityRequirementRows(reqs: Requirement[]): CapabilityRequirementRow[] {
  const rows = new Map<string, CapabilityRequirementRow>();
  for (const r of reqs) {
    if (r.kind === "REMOVED" || r.id === undefined || rows.has(r.id)) continue;
    rows.set(r.id, { id: r.id, name: r.name, realizedBy: [] });
  }
  return [...rows.values()].sort((a, b) => compareIds(a.id, b.id));
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
