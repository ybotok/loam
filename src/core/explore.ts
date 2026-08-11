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
 * So this states the work the same way `brief.ts` does. It reads the fleet map
 * and the living contracts, reports the ring of services around the seeds, the
 * features already in flight over the same ground, and how far each service's
 * documentation has got — and stops. Which of those neighbours the feature
 * really touches is a judgement about intent, and loam does not make those.
 *
 * The landscape is parsed ONCE for the whole exploration. Per-service reads of
 * it exist (`brief.ts`'s `landscapeContext`) and are correct for one service;
 * calling one of those per seed is how `validate --all` came to cost 13 seconds
 * on 120 services, and this command sits in front of authoring, where that is
 * the difference between a habit and a thing people skip.
 */
import { existsSync } from "node:fs";
import { FleetContext } from "./fleet-context.js";
import { serviceResolver, type Elem, type Rel } from "./c4/likec4.js";
import {
  maturityGaps,
  serviceMaturity,
  type Maturity,
} from "./vocabulary/maturity.js";
import { compareIds, nearestIds, type ServiceEntry } from "./repo/entries.js";
import { landscapePath, servicePaths } from "./repo/paths.js";

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
  /** Seeds first, then the ring, each in id order. */
  services: ExploreService[];
  /** Ids the ring added that were not asked for — the candidates to weigh. */
  neighbours: string[];
  overlaps: ExploreOverlap[];
  landscape: { present: boolean; parses: boolean };
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
  docsDir: string;
  /** Service ids to explore around. Checked at the command boundary. */
  services: ServiceEntry["id"][];
  /** operationIds to explore around; each resolves to the service that defines it. */
  operations: string[];
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

  const landPath = landscapePath(docsDir);
  const present = existsSync(landPath);
  const land = present ? await context.loadLikeC4(landPath) : null;
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
    const owner = await operationOwner(docsDir, entries, op, context);
    if (owner === null) unresolvedOperations.push(op);
    else opSeeds.push(owner);
  }

  const seeds = [...new Set([...req.services, ...opSeeds])];
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
        docsDir,
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
    services,
    neighbours: [...ring.keys()].sort(compareIds),
    overlaps,
    landscape: { present, parses },
    scaffold: newCommand(featureId, seeds, known),
  };
}

/* ------------------------------------------------------------------ */

interface DescribeRequest {
  id: string;
  reason: ExploreReason;
  entry: ServiceEntry | undefined;
  docsDir: string;
  relationships: Rel[];
  svcOf: (id: string) => string;
  elements: Elem[];
  /** Whether the landscape parsed — what makes its silence evidence rather than absence. */
  parses: boolean;
  context: FleetContext;
}

async function describe(req: DescribeRequest): Promise<ExploreService> {
  const { id, reason, entry, docsDir, relationships, svcOf } = req;

  const inbound: ExploreEdge[] = [];
  const outbound: ExploreEdge[] = [];
  for (const r of relationships) {
    const edge = { op: r.op ?? null, title: r.title ?? null };
    if (svcOf(r.target) === id) inbound.push({ service: svcOf(r.source), ...edge });
    else if (svcOf(r.source) === id) outbound.push({ service: svcOf(r.target), ...edge });
  }
  const modelled = req.elements.some((e) => svcOf(e.id) === id);

  // A service that does not exist has no rung: `empty` would be a claim about a
  // directory nobody has made, and it reads as "exists, nothing in it" — the
  // one state a caller most needs to tell it apart from.
  if (entry === undefined) {
    return {
      id,
      reason,
      known: false,
      maturity: null,
      missing: [],
      modelled,
      operations: [],
      // Not `unreadable`: there is no contract here to fail to read. A service
      // with no directory owes nothing, and reporting a parse failure over an
      // absent file would send a reader looking for a document to fix.
      openapi: { unreadable: false },
      inbound,
      outbound,
    };
  }

  const archSpec = existsSync(servicePaths(docsDir, entry.id).archSpec);
  // Positive evidence only, and the rule is `list`'s verbatim: an inbound edge
  // carrying an operation is proof somebody calls this service, while a
  // landscape that is absent or does not parse proves nothing about who calls
  // it — so the contract is still owed. Spelling this differently here is how
  // the same service would grade `partial` in one command and `vouched` in the
  // other.
  const apiExpected = !req.parses || inbound.some((e) => e.op !== null);
  const input = { entry, archSpec, apiExpected };

  // `readOpenapi`, not `operationIds`: a contract that exists but does not
  // parse comes back from the id list as an EMPTY set, indistinguishable from a
  // service with no endpoints — and "this service offers nothing" is the worst
  // possible lie to tell somebody deciding whether to call it.
  const api = await req.context.readOpenapi(servicePaths(docsDir, entry.id).openapi);
  const operations = api.ops.filter((o) => !o.remove).map((o) => o.id);

  return {
    id,
    reason,
    known: true,
    maturity: serviceMaturity(input),
    missing: maturityGaps(input),
    modelled,
    operations,
    openapi: {
      unreadable: api.unreadable,
      ...(api.error === undefined ? {} : { error: api.error }),
    },
    inbound,
    outbound,
  };
}

/**
 * The service whose living contract defines an operationId, or null.
 *
 * Reads every service's `openapi.yaml`, which is the cost of asking a question
 * nothing indexes. It is YAML, not LikeC4 — the expensive parse in this
 * codebase — and it happens only when somebody passes `--op`.
 */
async function operationOwner(
  docsDir: string,
  entries: ServiceEntry[],
  op: string,
  context: FleetContext,
): Promise<ServiceEntry["id"] | null> {
  for (const entry of entries) {
    if (!entry.has.openapi) continue;
    const api = await context.readOpenapi(servicePaths(docsDir, entry.id).openapi);
    if (api.ops.some((o) => o.id === op && !o.remove)) return entry.id;
  }
  return null;
}

/**
 * The `loam new` line the seeds imply. A seed that names no existing service is
 * `--new-service`, not `--touches`: those are different scaffolds, and getting
 * it wrong is what leaves a feature with a requirement delta for a service that
 * has no directory to archive into.
 */
function newCommand(featureId: string, seeds: string[], known: ReadonlySet<string>): string {
  const flags = [...seeds]
    .sort(compareIds)
    .map((id) => (known.has(id) ? `--touches ${id}` : `--new-service ${id}`));
  return `loam new ${featureId}${flags.length > 0 ? ` ${flags.join(" ")}` : ""}`;
}
