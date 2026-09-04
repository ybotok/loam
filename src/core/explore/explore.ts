/**
 * The blast radius of a change nobody has written down yet.
 *
 * Everything else in loam answers a question about documents that exist. This
 * module answers the one that comes BEFORE the first document: which services
 * does this feature actually touch? On a fleet of a hundred that call is the
 * hardest one in the cycle and the only one made with no tool in hand —
 * `loam new FEAT-101 --touches a --touches b` takes the answer as an argument
 * and scaffolds whatever it was told. A `--touches` list short by one service
 * is not caught by anything: the feature validates, archives, and ships with a
 * consumer nobody updated.
 *
 * So this states the work the same way `brief/brief.ts` does. It reads the fleet map
 * and the living contracts, reports the ring of services around the seeds, the
 * features already in flight over the same ground, and how far each service's
 * documentation has got — and stops. Which of those neighbours the feature
 * really touches is a judgement about intent, and loam does not make those.
 *
 * "The fleet map" here is the `architecture/` PROJECT — the landscape plus every
 * other `.likec4` under it, minus the generated views file — and not the
 * landscape FILE. See the read below for the disagreement that reading one file
 * caused.
 *
 * It is parsed ONCE for the whole exploration. Per-service reads of it exist
 * (`brief/landscape.ts`'s `landscapeContext`) and are correct for one service;
 * calling one of those per seed is how `validate --all` came to cost 13 seconds
 * on 120 services, and this command sits in front of authoring, where that is
 * the difference between a habit and a thing people skip.
 */
import { existsSync } from "node:fs";
import { relative } from "node:path";
import { FleetContext } from "../fleet-context.js";
import { type Rel } from "../c4/likec4.js";
import { serviceResolver } from "../c4/resolve/service.js";
import { type Maturity } from "../vocabulary/maturity.js";
import { capabilityRollup, unresolvedCapabilities } from "../capabilities/rollup.js";
import { compareIds, nearestIds, type ServiceEntry } from "../repo/entries.js";
import { landscapePath } from "../repo/paths.js";
import { readUseCases } from "../usecases/fleet.js";
import { servicesInFlowsClaiming } from "../usecases/capability.js";
import { describe, newCommand, operationOwner } from "./describe.js";
import type { DocsDir } from "../kernel/ids/dirs.js";

/** One end of a call the fleet map already draws. */
export interface ExploreEdge {
  /** The service at the other end. */
  service: string;
  /** The operationId the call uses, or null for an edge nobody tied to one. */
  op: string | null;
  title: string | null;
}

/**
 * Why a service is in the answer. Seeds were asked for; the rest were derived.
 *
 * A neighbour on both sides of a seed reports `calls-seed` — see the overlap
 * rule in `explore`. The field is a hint about where to look, not a complete
 * description of the edges; `inbound`/`outbound` are that.
 */
export type ExploreReason = "seed" | "calls-seed" | "called-by-seed";

export interface ExploreService {
  id: string;
  reason: ExploreReason;
  /** Whether `services/<id>/` exists at all. */
  known: boolean;
  /**
   * How far this service's documentation has got, or null when it does not
   * exist yet. A `--touches` naming a service at `empty` or `partial` is a
   * different job from one naming a vouched service, and the difference decides
   * whether the feature starts with `loam adopt`.
   */
  maturity: Maturity | null;
  /** What stands between it and `vouched` — `maturityGaps`, so it matches `list --needs-work`. */
  missing: string[];
  /** Whether anything in the fleet map resolves to it. */
  modelled: boolean;
  /** operationIds its living contract exposes today, `x-loam-remove` markers excluded. */
  operations: string[];
  /**
   * Whether that contract could be read at all, beside the `error` the parser
   * gave when it could not.
   *
   * It rides next to `operations` rather than inside it for the reason `delta`
   * carries the same pair: an unreadable contract yields an EMPTY operation
   * list, indistinguishable from a service with no endpoints — and this is the
   * field the workflow tells an agent to read before deciding whether an
   * operation it is about to add already exists. Answering `[]` over a YAML
   * error is how a MODIFIED requirement gets authored as ADDED.
   */
  openapi: { unreadable: boolean; error?: string };
  inbound: ExploreEdge[];
  outbound: ExploreEdge[];
}

/** An active feature already working over ground the exploration covers. */
export interface ExploreOverlap {
  feature: string;
  /** The explored services it already carries a delta for. */
  services: string[];
}

export interface Exploration {
  /** The seed ids, as asked for. */
  seeds: string[];
  /**
   * Seeds that name no `services/<id>/`, each with the closest real ids. A seed
   * may legitimately be a service the feature INTRODUCES, so this is reported
   * rather than refused — but a typo produces exactly the same shape, and the
   * near-miss list is what tells the two apart.
   */
  unknown: Array<{ id: string; nearest: string[] }>;
  /** Operation seeds that resolved to no service's living contract. */
  unresolvedOperations: string[];
  /**
   * Capability seeds that seeded nothing: not declared in
   * architecture/capabilities.yaml (the file may not exist at all — explore
   * refuses nothing, every miss is a field), or declared and realized by no
   * living requirement. One list on purpose; splitting the two miss kinds
   * waits for a consumer to ask.
   */
  unresolvedCapabilities: string[];
  /** Seeds first, then the ring, each in id order. */
  services: ExploreService[];
  /** Ids the ring added that were not asked for — the candidates to weigh. */
  neighbours: string[];
  overlaps: ExploreOverlap[];
  /**
   * `broken` is the `architecture/` documents that failed, docs-relative POSIX,
   * deduped and sorted — `[]` while `parses` is true. `parses` answers for the
   * PROJECT, so the broken document is very often a SIBLING beside a landscape
   * that reads perfectly, and naming the landscape file was a claim about bytes
   * loam read fine (verification 2026-09-04). Spelled as `landscape.invalid`
   * spells it, so the two surfaces name one file one way.
   */
  landscape: { present: boolean; parses: boolean; broken: string[] };
  /**
   * The literal `loam new` line the seeds imply — seeds only. The ring is
   * deliberately NOT folded in: this module's whole claim is that it does not
   * know which neighbours the feature touches, and a command line that quietly
   * included them would make the guess on the reader's behalf and look derived
   * while doing it.
   *
   * Named for what it does rather than `command`, which is the envelope's key
   * for the command that RAN. The rename is not cosmetic: `emitJson` spreads
   * the payload LAST, so a payload field called `command` would silently
   * OVERRIDE the envelope's — `command` would come back as
   * `"loam new FEAT-000 …"`, and every consumer branching on
   * `command === "explore"` (the same key `status`, `doctor`, `dependencies`,
   * `archive` and `unarchive` emit) would quietly stop matching, with tsc and
   * the linter green throughout.
   */
  scaffold: string;
}

export interface ExploreRequest {
  docsDir: DocsDir;
  /** Service ids to explore around. Checked at the command boundary. */
  services: ServiceEntry["id"][];
  /** operationIds to explore around; each resolves to the service that defines it. */
  operations: string[];
  /** Declared capability ids to explore around; each seeds its realizing services. */
  capabilities: string[];
  /** Placeholder feature id for the suggested command line. */
  featureId: string;
  context?: FleetContext;
}

/**
 * Read the fleet around a proposed change. Reads only; writes nothing, and
 * refuses nothing — every miss is reported as a field.
 */
export async function explore(req: ExploreRequest): Promise<Exploration> {
  const { docsDir, featureId } = req;
  const context = req.context ?? new FleetContext();
  const entries = await context.listServices(docsDir);
  const byId = new Map<string, ServiceEntry>(entries.map((e) => [e.id, e]));
  const known: ReadonlySet<string> = new Set(byId.keys());

  // The `architecture/` PROJECT, never `architecture/landscape.likec4` alone.
  // The map is a project — the landscape merged with every use case, palette and
  // second `model { }` block beside it — and reading one file of it made this
  // command answer differently from `loam adopt` and `loam context` about the
  // same tree (reproduced: with a broken `architecture/palette.likec4` beside a
  // landscape that parses, `context checkout-web --json` reported
  // `landscape.parses: false` while `explore checkout-web --json` reported
  // `parses: true` and went on to describe every edge). `core/pack/living.ts`
  // named this module as the last reader that disagreed. Whichever answer is
  // right, an agent handed both has no way to tell — and the renderer's answer
  // is the project's.
  //
  // `present` stays a fact about the FILE, because that file is the WRITE target:
  // `loam new`'s scaffold and every brief ask for edits to
  // `architecture/landscape.likec4` by name, and "the project is empty" is not
  // the same instruction as "there is no map to edit".
  const present = existsSync(landscapePath(docsDir));
  const land = present ? await context.architecture(docsDir) : null;
  const parses = land !== null && land.errors.length === 0;
  const elements = parses ? land.elements : [];
  const relationships: Rel[] = parses ? land.relationships : [];
  // One resolver for the whole scan, built with the real service ids so an edge
  // drawn into a modelled container (`paymentService.api`) counts for the
  // service that owns it — the same resolution `list`, `show` and `validate`
  // use, so no two commands can disagree about who calls whom.
  const svcOf = serviceResolver(elements, known);

  // Operation seeds resolve through the living contracts, not the map: the map
  // says who CALLS an operation, and the question here is who DEFINES it.
  const opSeeds: ServiceEntry["id"][] = [];
  const unresolvedOperations: string[] = [];
  for (const op of req.operations) {
    const owner = await operationOwner(entries, op, context);
    if (owner === null) unresolvedOperations.push(op);
    else opSeeds.push(owner);
  }

  // Capability seeds resolve through the vocabulary and the fleet rollup —
  // one rollup pass for ALL requested ids, through this exploration's shared
  // context cache, never a fresh walk per capability. A realizing service is
  // by construction an enumerated one, so every seed it adds is `known`.
  //
  // And through the fleet's USE CASES, which answer the same question off a
  // different document. The rollup finds services whose living requirements
  // carry a `Capability:` line; a `dynamic view` tagged `#cap-<slug>` finds the
  // services the flow actually runs through — including ones whose spec.md has
  // never named the capability, which on a brownfield fleet is most of them.
  // The two are unioned rather than ranked because neither is a subset of the
  // other: a service can realize a capability without appearing in its drawn
  // flow, and a flow can pass through a service that has written nothing down.
  //
  // The scan gates its own load — a fleet whose documents mention no reserved
  // tag never starts LikeC4 for it — and this whole block is behind
  // `--capability` being passed at all. What it is no longer behind is the
  // project itself: the read above loads `architecture/` for every exploration,
  // so a `--capability` run pays for a SECOND parse of the same documents
  // (`readUseCases` takes a `DocsDir`, not this invocation's memo). Accepted
  // rather than unnoticed: the alternative is a seam that hands the scan a
  // pre-loaded project, which is a change to a module five callers share, and
  // the cost lands only on the flag that already opts into the fleet rollup.
  const capSeeds: ServiceEntry["id"][] = [];
  let unresolvedCaps: string[] = [];
  if (req.capabilities.length > 0) {
    const vocab = await context.capabilities(docsDir);
    const rows = await capabilityRollup({ services: entries, vocab, read: (p) => context.readRequirements(p) });
    const wanted = new Set(req.capabilities);
    const realizing = new Set(rows.filter((r) => wanted.has(r.id)).flatMap((r) => r.services));
    const scan = await readUseCases({ docsDir, known });
    for (const id of servicesInFlowsClaiming(scan, req.capabilities)) realizing.add(id);
    capSeeds.push(...entries.filter((e) => realizing.has(e.id)).map((e) => e.id));
    // `unresolvedCapabilities` is unchanged on purpose: it grades the
    // VOCABULARY — declared or not, realized by a living requirement or not —
    // and a capability drawn in a flow but realized by nobody is still a
    // capability nothing implements. Letting a tag silence that would hide the
    // gap the field exists to name.
    unresolvedCaps = unresolvedCapabilities(rows, req.capabilities);
  }

  const seeds = [...new Set([...req.services, ...opSeeds, ...capSeeds])];
  const unknown = seeds
    .filter((id) => !known.has(id))
    .map((id) => ({ id, nearest: nearestIds(id, [...known]) }));

  // The ring: one hop, both directions. A seed that is not modelled contributes
  // nothing here and that is the honest answer — an invisible service has no
  // neighbours anyone can derive, which is what `landscape.service-unmodelled`
  // is about.
  //
  // The two directions are collected separately rather than written into one
  // map as the loop goes, because a neighbour can be BOTH — it calls a seed and
  // the seed calls it — and a single-map version answers whichever edge the
  // parser happened to yield last. That is a field whose value depends on the
  // order lines appear in a `.likec4` file, which is the kind of answer that
  // reads as derived and is not.
  const seedSet = new Set<string>(seeds);
  const callsSeed = new Set<string>();
  const calledBySeed = new Set<string>();
  for (const r of relationships) {
    const from = svcOf(r.source);
    const to = svcOf(r.target);
    if (seedSet.has(from) && !seedSet.has(to)) calledBySeed.add(to);
    if (seedSet.has(to) && !seedSet.has(from)) callsSeed.add(from);
  }

  // `calls-seed` wins the overlap, deterministically. Of the two directions it
  // is the one that more often has to be touched: a consumer depends on the
  // seed's contract, so a change to that contract is what breaks it, while a
  // provider the seed merely calls is usually unaffected by the seed changing.
  const ring = new Map<string, ExploreReason>([
    ...[...calledBySeed].map((id) => [id, "called-by-seed" as const] as const),
    ...[...callsSeed].map((id) => [id, "calls-seed" as const] as const),
  ]);

  const ordered: Array<{ id: string; reason: ExploreReason }> = [
    ...[...seeds].sort(compareIds).map((id) => ({ id, reason: "seed" as const })),
    ...[...ring]
      .sort(([a], [b]) => compareIds(a, b))
      .map(([id, reason]) => ({ id, reason })),
  ];

  const services: ExploreService[] = [];
  for (const { id, reason } of ordered) {
    services.push(
      await describe({
        id,
        reason,
        entry: byId.get(id),
        relationships,
        svcOf,
        elements,
        parses,
        context,
      }),
    );
  }

  const covered = new Set(services.map((s) => s.id));
  const features = await context.listFeatures(docsDir);
  const overlaps: ExploreOverlap[] = features
    .map((f) => ({ feature: f.id, services: f.services.filter((s) => covered.has(s)) }))
    .filter((o) => o.services.length > 0)
    .sort((a, b) => compareIds(a.feature, b.feature));

  return {
    seeds,
    unknown,
    unresolvedOperations,
    unresolvedCapabilities: unresolvedCaps,
    services,
    neighbours: [...ring.keys()].sort(compareIds),
    overlaps,
    landscape: {
      present,
      parses,
      broken:
        land === null
          ? []
          : [...new Set(land.errors.map((e) => e.sourceFsPath).filter((p): p is string => p !== undefined))]
              .map((abs) => relative(docsDir, abs).split(/[\\/]/).join("/"))
              .sort(),
    },
    scaffold: newCommand(featureId, seeds, known),
  };
}
