/**
 * Fleet-shape advisories over the parsed landscape: the way a fleet map stops
 * answering questions as it grows, caught while the map is already in memory.
 *
 * The shape becomes visible at service three rather than service two.
 * Ubiquitous infrastructure — logging Kafka, an identity provider, service
 * discovery — takes one inbound edge per modelled service until the map is a
 * hairball around it; deleting the element fixes the picture and loses "who
 * depends on the Identity Provider", which is the question the map exists to
 * answer during an incident. Tagging keeps both: the fleet view excludes
 * `#platform`, and a platform view keeps the dependents.
 *
 * The DATASTORE half of this pair moved to `../fleet/map/consumers.ts` when its
 * consumer count stopped being a fact about the map alone: a private store now
 * lives nested inside its owner's element, and the services reaching it are
 * attested in their own models (E3/R1). The census both checks read is built
 * there and handed in here as `consumers`, so a hub and a store can never
 * disagree about who consumes what.
 *
 * loam still reads no code and decides no policy: the team chooses what counts
 * as platform — this warning only names a shape that is usually wrong.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { type Elem, type LoadedDoc } from "../../../core/c4/likec4.js";
import { type DeclaredService, type RawServiceId } from "../../../core/kernel/ids/service.js";
import { type Finding } from "../../../core/vocabulary/report.js";
import { type ServiceEntry } from "../../../core/repo/entries.js";
import { permissionsPath, servicePathsAt } from "../../../core/repo/paths.js";
import { readVocabulary } from "../../../core/permissions/permissions.js";
import { readCapabilityVocabulary } from "../../../core/capabilities/capabilities.js";
import {
  capabilityDocFindings,
  capabilityRequirementIndex,
  docMissingFindings,
  gradableCapabilityIds,
  invalidVocabularyFinding,
  unrealizedFindings,
} from "../../../core/capabilities/findings.js";
import { useCaseRequirementClaims } from "../../../core/usecases/capability.js";
import type { ParsedView } from "../../../core/c4/parsed/dynamic-views.js";
import { capabilityRollup, usedCapabilities } from "../../../core/capabilities/rollup.js";
import { requirementUnrealizedFindings } from "../../../core/capabilities/realizes/findings.js";
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

export interface FleetShape {
  /** Service-LEVEL elements — the fleet map's own boxes (landscape.ts `drawn`). */
  drawn: Elem[];
  /** The services/<id>/ directories that exist. */
  services: ReadonlySet<string>;
  /**
   * Distinct consumer SERVICES of an element, its nested children included —
   * `../fleet/map/consumers.ts` owns the derivation and both checks that read a
   * consumer count share this one instance of it.
   */
  consumers: (elementId: string) => string[];
}

export function fleetShapeFindings(shape: FleetShape): Finding[] {
  const { drawn, services } = shape;
  const findings: Finding[] = [];

  for (const e of drawn) {
    // An element that stands for a real service is the fleet itself, not its
    // shape: many consumers is what a well-used service looks like.
    if (e.service !== undefined || services.has(e.title)) continue;
    if (!e.tags.includes(EXTERNAL_TAG) || e.tags.includes(PLATFORM_TAG)) continue;
    const consumers = shape.consumers(e.id);
    if (consumers.length < PLATFORM_CANDIDATE_MIN_CONSUMERS) continue;
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
 * criterion is 'one warning per capability, not one per service'. Holding
 * NEITHER `architecture/capabilities.yaml` nor `capabilities/` is total
 * silence: the fleet's own files are this axis's opt-in, either of them.
 *
 * The used set comes through capabilityRollup with the fleet's own cached
 * reader, so under --all the walk re-parses nothing the service targets have
 * not already paid for — and the rollup, the warn and `loam list capabilities`
 * can never disagree about what "realized" means.
 *
 * The AUTHORED documents are graded here too, and they ride this function
 * rather than a target of their own for `viewsStaleFindings`' reason one tree
 * over: a capability belongs to no service, so only the fleet run has the whole
 * vocabulary and the enumerated tree in view at once. Their reads are NOT
 * wrapped, deliberately — a `capabilities/<id>/spec.md` that is not UTF-8 takes
 * the run down exactly as a `services/<id>/spec.md` does, because a document
 * loam cannot decode is a refusal everywhere else in the product and a quiet
 * "zero requirements" here would grade a whole capability green on bytes
 * nobody read.
 */
export async function capabilityFleetFindings(
  docsDir: DocsDir,
  services: ServiceEntry[],
  fleet: FleetContext | undefined,
  flows: readonly ParsedView[] | null,
): Promise<Finding[]> {
  const vocab = fleet === undefined ? await readCapabilityVocabulary(docsDir) : await fleet.capabilities(docsDir);
  if (!vocab.present) return [];
  const read = fleet === undefined ? readRequirementsAt : (p: string) => fleet.readRequirements(p);
  const authored: Finding[] = docMissingFindings(vocab.tree);
  for (const doc of vocab.tree.docs) authored.push(...capabilityDocFindings(await read(doc.spec), doc.id));

  const invalid = invalidVocabularyFinding(vocab);
  if (invalid !== null) return [invalid, ...authored];
  // A USE CASE IS THE OTHER WAY TO KEEP A PROMISE, and it is the only carrier a
  // cross-service criterion has: "I enter a login and a password and I am in"
  // belongs to no single service's spec, so a fleet could satisfy it perfectly
  // through a `#cap-`/`#req-` tagged flow and still be told nobody realizes it.
  //
  // The claims go INTO the rollup rather than beside it, so both unrealized
  // grades and `loam list capabilities` read one set of rows. `flows === null`
  // means loam could not READ the flows (no preload, or an `architecture/` that
  // did not parse); the key is then OMITTED rather than empty, and every
  // `keptBy` below is `undefined` — the three-state contract `rollup.ts` states.
  const index = await capabilityRequirementIndex(vocab, read);
  const keptByFlows =
    flows === null
      ? undefined
      : useCaseRequirementClaims(flows, gradableCapabilityIds(vocab), (c) => index.byCapability.get(c));
  const rows = await capabilityRollup({ services, vocab, read, ...(keptByFlows === undefined ? {} : { keptByFlows }) });

  // The two unrealized grades read the SAME rollup, which is what keeps them
  // from disagreeing about the word: a capability is unrealized when nothing
  // names it by any join, and one of its requirements is unrealized when nothing
  // keeps that promise. Both are warnings, and the second is the one that
  // survives a healthy-looking row — a capability with four requirements and
  // three kept reports nothing at all through the first.
  //
  // The suspension falls out of the DATA rather than a branch: `keptBy` absent
  // means nobody looked, and a promise nobody looked for is not a promise
  // reported unkept.
  const unrealizedRequirements = rows.flatMap((row) =>
    (row.requirements ?? [])
      .filter((req) => req.realizedBy.length === 0 && req.keptBy?.length === 0)
      .map((req) => ({ capability: row.id, id: req.id, name: req.name })),
  );
  return [
    ...authored,
    ...unrealizedFindings(vocab, usedCapabilities(rows)),
    ...requirementUnrealizedFindings(unrealizedRequirements),
  ];
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
