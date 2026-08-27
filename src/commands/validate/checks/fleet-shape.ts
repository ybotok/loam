/**
 * Fleet-shape advisories over the parsed landscape: the two ways a fleet map
 * stops answering questions as it grows, caught while the map is already in
 * memory.
 *
 * Both shapes become visible at service three rather than service two.
 * Ubiquitous infrastructure — logging Kafka, an identity provider, service
 * discovery — takes one inbound edge per modelled service until the map is a
 * hairball around it; deleting the element fixes the picture and loses "who
 * depends on the Identity Provider", which is the question the map exists to
 * answer during an incident. Tagging keeps both: the fleet view excludes
 * `#platform`, and a platform view keeps the dependents. And a datastore drawn as a fleet-level
 * peer makes a claim its consumer count either supports or refutes: one
 * consumer means the drawing is false — the store is that service's
 * internals, not a system in its own right — while two or more mean the
 * strongest coupling two services can have, which deserves to be stated
 * rather than inferred.
 *
 * Everything here is O(relationships) over data the fleet target already
 * holds. loam still reads no code and decides no policy: the team chooses
 * what counts as platform and which data is truly shared — these warnings
 * only name the shapes that are usually wrong.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { type Elem, type LoadedDoc, type Rel } from "../../../core/c4/likec4.js";
import { type DeclaredService, type RawServiceId } from "../../../core/kernel/ids/service.js";
import { type Finding } from "../../../core/vocabulary/report.js";
import { type ServiceEntry } from "../../../core/repo/entries.js";
import { capabilitiesPath, permissionsPath, servicePathsAt } from "../../../core/repo/paths.js";
import { readVocabulary } from "../../../core/permissions/permissions.js";
import { readCapabilities } from "../../../core/capabilities/capabilities.js";
import { invalidVocabularyFinding, unrealizedFindings } from "../../../core/capabilities/findings.js";
import { capabilityRollup, usedCapabilities } from "../../../core/capabilities/rollup.js";
import { parseRequirements } from "../../../core/document/parse.js";
import { type Requirement } from "../../../core/document/spec.js";
import { FleetContext } from "../../../core/fleet-context.js";
import { EXTERNAL_TAG, PLATFORM_TAG } from "../../../core/vocabulary/maturity.js";
import type { DocsDir } from "../../../core/kernel/ids/dirs.js";

/**
 * Consumers at which an untagged external hub starts to warn. Three, not two:
 * two services sharing a dependency is a fact about those two services, the
 * same edge from three is a pattern about the element — and three is where
 * the shared hub starts making the map unreadable.
 */
export const PLATFORM_CANDIDATE_MIN_CONSUMERS = 3;

/** The element kind read as a datastore, compared case-insensitively. */
const DATASTORE_KIND = "database";

export interface FleetShape {
  /** Service-LEVEL elements — the fleet map's own boxes (landscape.ts `drawn`). */
  drawn: Elem[];
  relationships: Rel[];
  /** The services/<id>/ directories that exist. */
  services: ReadonlySet<string>;
  /** The shared element→service resolver every edge join uses. */
  resolve: (id: string) => string;
  /**
   * Where a service id's directory actually sits, repo-relative and without a
   * trailing slash. Injected rather than joined: only the enumeration knows
   * whether a service is filed under a subsystem, and a fix instruction naming
   * the wrong directory is worse than one naming none.
   */
  pathOf: (id: string) => string;
}

export function fleetShapeFindings(shape: FleetShape): Finding[] {
  const { drawn, relationships, services, resolve } = shape;
  const findings: Finding[] = [];

  // Distinct consumer SERVICES of an element, its nested children included: an
  // edge into `kafka.paymentEvents` is consumption of `kafka`. Persons, other
  // external systems and unresolved sources never count — a consumer is a
  // source the shared resolver files under a real services/<id>/, so two edges
  // from one service are one consumer.
  const consumersOf = (e: Elem): string[] => {
    const out = new Set<string>();
    for (const r of relationships) {
      if (r.target !== e.id && !r.target.startsWith(`${e.id}.`)) continue;
      const svc = resolve(r.source);
      if (services.has(svc)) out.add(svc);
    }
    return [...out].sort();
  };

  for (const e of drawn) {
    // An element that stands for a real service is the fleet itself, not its
    // shape: many consumers is what a well-used service looks like, and a
    // datastore bound to a directory is graded by the binding checks instead.
    if (e.service !== undefined || services.has(e.title)) continue;
    const consumers = consumersOf(e);

    if (
      e.tags.includes(EXTERNAL_TAG) &&
      !e.tags.includes(PLATFORM_TAG) &&
      consumers.length >= PLATFORM_CANDIDATE_MIN_CONSUMERS
    ) {
      findings.push({
        severity: "warn",
        code: "landscape.platform-candidate",
        subject: e.title,
        message:
          `landscape: '${e.title}' is consumed by ${consumers.length} services (${consumers.join(", ")}) ` +
          `and is not tagged #platform — a hub like this takes one more edge per modelled service until ` +
          `the fleet view is unreadable. Declare \`tag platform\` in the specification block and tag the ` +
          `element (LikeC4 refuses an undeclared tag, so both steps are needed): the fleet view then ` +
          `excludes it, and a platform view over \`include * -> element.tag = #platform\` keeps ` +
          `"who depends on it" answerable`,
      });
    }

    if (e.kind.toLowerCase() !== DATASTORE_KIND || consumers.length === 0) continue;
    if (consumers.length === 1) {
      findings.push({
        severity: "warn",
        code: "landscape.datastore-private",
        subject: e.title,
        message:
          `landscape: '${e.title}' is a datastore with a single consumer at fleet level ` +
          `('${consumers[0]!}') — drawn as a peer it reads as a system in its own right, available to ` +
          `be depended on. Move it into ${shape.pathOf(consumers[0]!)}/model.likec4 as a nested container ` +
          `and delete it here, or add the second consumer's edge if another service really reaches ` +
          `the same data`,
      });
    } else {
      findings.push({
        severity: "warn",
        code: "landscape.datastore-shared",
        subject: e.title,
        message:
          `landscape: '${e.title}' is a datastore shared by ${consumers.length} services ` +
          `(${consumers.join(", ")}) — the strongest coupling two services can have, and the hardest ` +
          `to undo. Shared means the same DATA: if they read the same tables or keys, keep it drawn ` +
          `and let this warning state the coupling; if they only share a host or cluster (two schemas, ` +
          `two lock paths), that is operational blast radius — a runbook fact — and the honest model ` +
          `is one private store per service`,
      });
    }
  }
  return findings;
}

/**
 * The #external element that declares it PUBLISHES this message, or null —
 * the landscape-side half of the event spine's fleet question, beside the
 * other checks that read tags off the drawn map.
 *
 * Positive evidence only: an edge carrying `metadata { publishes '<msg>' }`
 * whose source element — itself or a declared ancestor, since the edge may
 * point out of a topic nested inside the broker — is tagged #external and
 * resolves to no known service directory. The resolution guard is what keeps
 * a mis-tagged internal service reading as unproduced: a tag is cheap to
 * write, and a services/<id>/ directory outranks it.
 */
/**
 * The authorization vocabulary graded against the fleet that uses it — the half
 * of the axis no single service can answer.
 *
 * `permissions.invalid` is an error and it is the only one reported when it
 * fires: a vocabulary nobody can read resolves nothing, so every `Requires:`
 * line in the fleet would follow it as `permissions.unknown`, and a hundred
 * findings about one broken file is a cascade, not a diagnosis.
 *
 * `permissions.unenforced` is the mirror of `api.ungoverned`, and it earns its
 * place for the same reason: a vocabulary is only worth what cites it. A
 * permission nothing requires is either a rule that was removed and left its
 * word behind, or a word nobody adopted — both are drift, and neither is
 * visible from inside the file. Warn, because the honest answer is sometimes
 * "not modelled yet".
 */
export async function permissionFindings(
  docsDir: DocsDir,
  services: ServiceEntry[],
  fleet: FleetContext | undefined,
): Promise<Finding[]> {
  const vocabulary = await readVocabulary(permissionsPath(docsDir));
  if (!vocabulary.present) return [];
  if (vocabulary.invalid !== undefined) {
    return [
      {
        severity: "error",
        code: "permissions.invalid",
        message:
          `landscape: architecture/permissions.yaml does not read as a vocabulary — ${vocabulary.invalid}. ` +
          "Every `Requires:` line in the fleet resolves against this file, so none of them can be graded until it parses. " +
          "The shape is `subjects: {<kind>: {description}}` then `permissions: {<kind>: {<name>: {description, owned_by, enforced_by}}}`.",
      },
    ];
  }
  const used = new Set<string>();
  for (const entry of services) {
    const paths = servicePathsAt(entry.dir);
    for (const path of [paths.spec, paths.archSpec]) {
      // Existence first, and for BOTH readers: arch.spec.md is optional (most
      // of a legacy fleet has none) and spec.md is missing on a half-adopted
      // service. `FleetContext.readRequirements` throws ENOENT, which surfaces
      // as `repository-unavailable` and takes the whole `--all` run down — an
      // absent optional artifact must never be able to do that.
      if (!existsSync(path)) continue;
      const reqs = fleet === undefined ? await readRequirementsAt(path) : await fleet.readRequirements(path);
      for (const r of reqs) {
        if (r.kind !== "REMOVED") for (const p of r.requires) used.add(p);
      }
    }
  }
  const unenforced = [...vocabulary.byId.keys()].filter((id) => !used.has(id));
  if (unenforced.length === 0) return [];
  return [
    {
      severity: "warn",
      code: "permissions.unenforced",
      message: `landscape: ${unenforced.length} declared permission(s) that no requirement's \`Requires:\` line names — write the requirement that gates on each, or drop the declaration`,
      details: unenforced,
    },
  ];
}

/** The uncached read, for the `--service` path where no fleet context exists. */
async function readRequirementsAt(path: string): Promise<Requirement[]> {
  if (!existsSync(path)) return [];
  return parseRequirements(await readFile(path, "utf8"));
}

/**
 * The capability vocabulary graded against the fleet that realizes it — the
 * axis's fleet half, beside permissionFindings and shaped by the same two
 * verdicts. `capability.invalid` is a `validate --all` run's ONE finding about
 * an unreadable file — fleet scope, so single-target runs stay silent about
 * it — and it suppresses the rest of the family (the unknown
 * grades at every service target return [] for the same vocabulary — one
 * breach, one finding, never a cascade). `capability.unrealized` is one warn
 * PER declared-but-unnamed capability, subject = the id, because the roadmap's
 * criterion is 'one warning per capability, not one per service'. An absent
 * file is total silence: the FILE is this axis's opt-in.
 *
 * The used set comes through capabilityRollup with the fleet's own cached
 * reader, so under --all the walk re-parses nothing the service targets have
 * not already paid for — and the rollup, the warn and `loam list capabilities`
 * can never disagree about what "realized" means.
 */
export async function capabilityFleetFindings(
  docsDir: DocsDir,
  services: ServiceEntry[],
  fleet: FleetContext | undefined,
): Promise<Finding[]> {
  const path = capabilitiesPath(docsDir);
  const vocab = fleet === undefined ? await readCapabilities(path) : await fleet.capabilities(path);
  if (!vocab.present) return [];
  const invalid = invalidVocabularyFinding(vocab);
  if (invalid !== null) return [invalid];
  const rows = await capabilityRollup({
    services,
    vocab,
    read: fleet === undefined ? readRequirementsAt : (p) => fleet.readRequirements(p),
  });
  return unrealizedFindings(vocab, usedCapabilities(rows));
}

export function externalProducerOf(
  message: string,
  land: LoadedDoc | null,
  landSvcOf: ((id: string) => DeclaredService) | null,
  known: ReadonlySet<RawServiceId>,
): string | null {
  if (land === null || land.errors.length > 0 || landSvcOf === null) return null;
  const knownIds: ReadonlySet<string> = known;
  const byId = new Map(land.elements.map((e) => [e.id, e]));
  for (const r of land.relationships) {
    if (r.publishes !== message) continue;
    if (knownIds.has(landSvcOf(r.source))) continue;
    for (let id = r.source; ; ) {
      const e = byId.get(id);
      if (e !== undefined && e.tags.includes(EXTERNAL_TAG)) return e.title;
      const dot = id.lastIndexOf(".");
      if (dot === -1) break;
      id = id.slice(0, dot);
    }
  }
  return null;
}
