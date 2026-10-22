/**
 * Who owes a service its `openapi.yaml`, and which features in flight already
 * carry one. Shared between the artifact table and the fleet form, because the
 * two must never disagree about whether a feature owes a contract.
 */
import { existsSync } from "node:fs";
import { calledServices } from "../coherence/calls/called.js";
import type { FleetContext } from "../fleet-context.js";
import { featureSpecPaths } from "../repo/paths.js";
import type { FeatureEntry, ServiceEntry } from "../repo/entries.js";
import { listFeatures } from "../repo/repo.js";
import type { DocsDir } from "../kernel/ids/dirs.js";
import { governedServices, type DeltaScan } from "./scan.js";

/**
 * Does this feature owe `svc` an openapi.yaml?
 *
 * Keyed on the living CONTRACT FILE, never on `services/<svc>/` merely existing
 * as a directory. A service adopted without a contract is precisely the case
 * where a feature that governs operations has to write one, and the directory
 * test answered "none owed" there — printing `(not written — none owed)` beside
 * the `spec-api.op-undefined` finding, in the same payload, about that very
 * file, while suppressing the only step that names it.
 *
 * Two ways to owe nothing, both about somebody else discharging it: the living
 * docs already carry the contract, or another feature in flight brings it — the
 * same softening coherence applies with its `*-pending` codes, where an
 * operation "defined by another feature still in flight" is an ordering fact
 * and not a hole.
 *
 * Otherwise the contract is owed exactly when something this feature wrote
 * already joins into it (`evidence`, see {@link contractEvidence}): a
 * requirement's `Operations:` line, or a tagged delta edge calling an
 * operation on the service. Those are the two links the gates grade against
 * the file — `spec-api.op-undefined` and `c4-api.op-undefined` — and the same
 * two `service.no-openapi` reads once the service is living, where a service
 * nothing joins into is the documented silence. A UI, a worker, a service whose
 * only edges go OUT has no API to write down, and that holds for a service the
 * feature introduces exactly as for an adopted one. Demanding a file from a new
 * one regardless was loam telling an author to invent a contract — and authors
 * did, as `paths: {}` stubs the archive then published as living contracts.
 *
 * `evidence` undefined means loam could not look — the delta does not parse —
 * and then the old reading stands: owed for a service the living docs have
 * never heard of, not for an adopted one. `delta.invalid` gates either way.
 */
export function owesContract(
  entry: ServiceEntry | undefined,
  contracted: boolean,
  evidence: boolean | undefined,
): boolean {
  // Both living facts come off the ENUMERATION's entry rather than root
  // existsSync probes: a service filed into a subsystem lives wherever the
  // tree walk found it, so the root probe read every filed service as "living
  // docs have never heard of it" and demanded a contract from all of them.
  // `undefined` IS that never-heard-of case — nothing enumerated the id
  // anywhere. `contracted` arrives resolved by the caller, and deliberately
  // not through the entry: another feature in flight discharges the debt for
  // a service the living docs have NOT heard of yet — that is the ordinary
  // introduce-then-build ordering, and it must keep answering "none owed".
  if (entry?.has.openapi === true) return false;
  if (contracted) return false;
  return evidence ?? entry === undefined;
}

/**
 * Per service, whether this feature wrote anything that joins into its
 * contract — `true`/`false`, or `undefined` when the delta could not be read.
 * One function for both status forms, so they cannot disagree about whether a
 * feature owes a contract: the `Operations:` lines come off the scan they have
 * already made, and the op-linked edges off the delta parse they have already
 * paid for (the coherence pass in one, the dependency graph in the other).
 */
export async function contractEvidence(
  docsDir: DocsDir,
  feature: FeatureEntry,
  scans: readonly DeltaScan[],
  context: FleetContext,
): Promise<(service: string) => boolean | undefined> {
  const governs = governedServices(scans);
  const called = await calledServices({ docsDir, featureDir: feature.dir, featureId: feature.id }, context);
  return (service) => (governs.has(service) ? true : called === "unreadable" ? undefined : called.has(service));
}

/**
 * Which features in flight carry an `openapi.yaml` for which service — one
 * enumeration of the whole index, service by service.
 *
 * The owners are recorded as feature IDS rather than directories because that
 * is the comparison {@link contractsHeldElsewhere} makes: two directories that
 * spell the same id are one feature as far as this question goes, and an index
 * keyed by directory would let a duplicated id answer "somebody else has it"
 * about its own twin.
 *
 * Enumeration only — the feature list and its `specs/` subdirectories are
 * already in the request-scoped index by the time anything asks.
 */
export async function contractOwners(docsDir: DocsDir, context: FleetContext): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  for (const f of await listFeatures(docsDir, {}, context)) {
    for (const svc of f.services) {
      if (!existsSync(featureSpecPaths(f.dir, svc).openapi)) continue;
      const owners = out.get(svc);
      if (owners === undefined) out.set(svc, new Set([f.id]));
      else owners.add(f.id);
    }
  }
  return out;
}

/**
 * Services some OTHER active feature already carries an `openapi.yaml` for.
 *
 * Derived from the shared index rather than re-walked, because the answer for
 * feature A and the answer for feature B are two readings of one enumeration:
 * asking it once per feature made the fleet form pay F²·S `existsSync` calls
 * over the two quantities that actually grow.
 */
export function contractsHeldElsewhere(owners: ReadonlyMap<string, ReadonlySet<string>>, self: string): Set<string> {
  const out = new Set<string>();
  for (const [svc, ids] of owners) {
    for (const id of ids) {
      if (id !== self) {
        out.add(svc);
        break;
      }
    }
  }
  return out;
}
