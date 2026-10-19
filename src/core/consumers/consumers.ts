/**
 * THE consumer index: who in the fleet still depends on an operation or a
 * message — the join that turns "an operation left the contract" into "and
 * these named consumers break", and "an operation's shape moved" into "and these
 * are the consumers to check it against".
 *
 * ONE INDEX, FOUR READERS. `loam diff` names the victims of every removal,
 * deprecation and modification since a base ref (`core/diff/semantic.ts`); the
 * coherence gate refuses a feature that takes a consumed operation or message
 * out of the contract (`openapi.remove-op-consumed`, `asyncapi.remove-message-
 * consumed` — `core/coherence/consumed/operations.ts`, `core/coherence/events/events.ts`);
 * and `loam archive` names who an overwrite lands on
 * (`commands/archive/plan/contracts/consumers.ts`). They used to be THREE
 * copies — this module as `core/diff/victims.ts`, `edgeConsumers` /
 * `requirementConsumers` / `governorsAfterMerge` in `core/coherence/lookups.ts`,
 * `messageConsumers` in `core/coherence/events/lookups.ts` — kept "in step by
 * hand", and they were not: the gate read `architecture/landscape.likec4` alone
 * while the diff and the spine read the project, the gate never asked a use
 * case, and the diff excluded an internal edge the gate counted. Rule 13
 * (docs/DESIGN.md) fired at the third copy; this is the extraction it forces.
 *
 * THE SOURCES, per question:
 *
 *  - an operation `op` of `provider`: (1) every edge of the `architecture/`
 *    PROJECT with `metadata { op }` into the provider (`./current.ts` says why
 *    the project and never the one file); (2) other services' requirements —
 *    spec.md AND arch.spec.md — whose `Operations:` line names it, unless that
 *    service's own contract defines the same id (`ownsOperation` says why);
 *    (3) the use-case hops the model attributes to it
 *    (`core/usecases/operations.ts`); (4) the provider's OWN requirements and
 *    its own internal edges still naming it, filed apart as `own`.
 *  - a message `name` of `provider`: `consumes` edges, other services'
 *    `Consumes:` lines over both spec files, the use-case hops backed by such an
 *    edge, and — as `own` — the provider's own `Publishes:` lines.
 *
 * WHY `own` IS ITS OWN LIST. The gate's question is what the merge would leave
 * broken, and the provider's own documents break too: an overwrite carries no
 * removal marker, so nothing made the author restate the provider's requirement
 * still naming the old id, and the next `validate` reported
 * `spec-api.op-undefined` against the provider itself; a message re-keyed or no
 * longer sent left the provider's own `Publishes:` line behind for
 * `spec-event.message-undefined`. So the gate counts `own`. `loam diff` and the
 * archive's overwrite warnings answer a different question — who ELSE breaks —
 * and do not: the rule `usecase.step-unlinked` states, that a service owes no
 * operationId to itself, is why an internal edge stopped keeping every removal
 * `diff.op-removed-consumed` (verification 2026-09-04, R3), and why a hop whose
 * two ends are the provider is never a victim.
 *
 * WHAT A DOUBT IS WORTH. A consumer the index could not check is a typed
 * suspension (`./scan.ts`), never a silent nothing, and the readers weigh the
 * kinds differently: `loam diff` and the overwrite warnings list every one; the
 * gate refuses on a document nobody could read or place — a consumer's, in
 * `suspended`, or the provider's own, in `ownSuspended` — and never on a caller
 * drawn with no op or a contested hop (`documentDoubt` says why).
 *
 * READ AFTER A FEATURE, OR AS IT STANDS. With `afterFeature`, every requirement is read
 * as that feature's merge would leave it (`./after.ts` — a consumer the same
 * feature MODIFIES or REMOVES stops counting, and an unappliable delta fails
 * closed); without it, the living fleet as it stands, which is what the diff and
 * the overwrite warnings ask. Edges and hops read the same either way: no
 * feature can take a living one away.
 *
 * LAZY, AND PAID ONCE PER INVOCATION. The fleet's four documents per service and
 * the project load are behind the first question that needs them, and memoised
 * per FleetContext (`./current.ts`), so a removal-free feature pays for neither
 * and `validate --all` pays once for every feature it grades. Without a
 * context (the archive gate's coherence call) the index reads through one of its
 * own, for its own lifetime.
 */
import { type Rel } from "../c4/likec4.js";
import { hopsConsuming, hopsExercising } from "../usecases/operations.js";
import { FleetContext } from "../fleet-context.js";
import type { DocsDir, FeatureDir } from "../kernel/ids/dirs.js";
import type { Requirement } from "../document/spec.js";
import type { ServiceState } from "./state.js";
import type { ConsumerScan, Suspension } from "./scan.js";
import { livingFleet, livingMap } from "./current.js";
import { afterMerge, featureView, type MergedRequirement, type SpecAxis } from "./after.js";

/** One consumer question's answer: the scan, plus what of the provider's own still names it. */
export interface Consumers extends ConsumerScan {
  /**
   * The provider's own documents that still name what it is losing — an edge
   * it draws to itself, a requirement of its own. Positive evidence, like
   * `victims`, filed apart because only the gate counts it (the header says why).
   */
  own: string[];
  /**
   * The provider's own documents the scan could not read or place, on the axes
   * `own` reads — the gate's doubt about `own`, as `suspended` is every reader's
   * doubt about `victims`. Filed apart for `own`'s reason: the diff and the
   * overwrite warnings name who ELSE is affected, and the provider's broken file
   * is its own `validate` finding there. The gate refuses on it, because an
   * overwrite carries no REMOVED requirement and that file is where the old id
   * may still be governed.
   */
  ownSuspended: Suspension[];
}

/** The consumer questions every reader asks. */
export interface ConsumerIndex {
  /** Consumers of `provider`'s operation `op`: edges, other services' requirements, use-case hops; inbound op-less edges and contested hops ride as suspensions. */
  opConsumers(provider: string, op: string): Promise<Consumers>;
  /** Consumers of message `name` a `provider` is dropping or changing: consumes-edges (not into the provider), other services' `Consumes:` lines, the hops backed by such an edge. */
  messageConsumers(provider: string, name: string): Promise<Consumers>;
  /**
   * Living services whose asyncapi SENDS `name` — positive evidence only; a
   * message another service still sends is not orphaned by one producer
   * dropping it. Senders, never declarers: a consumer declares the message in
   * its own contract with `action: receive` (validate requires it to), so
   * counting declarations named the consumer as the message's producer —
   * `loam diff` said "still declared by" the very service the removal orphaned,
   * while the gate refused for it and the next `validate --all` reported
   * `spine.message-unproduced` there. The rule that check grades by
   * (`commands/validate/service/events/message-producers.ts`).
   */
  producers(name: string): Promise<string[]>;
}

/** Where the index reads, and after what. */
export interface ConsumerRequest {
  docsDir: DocsDir;
  /** The invocation's read index. Absent, the index reads through one of its own. */
  context?: FleetContext;
  /** The feature whose merge every requirement is read after (`./after.ts`). Absent: the living fleet as it stands. */
  afterFeature?: FeatureDir;
}

/**
 * Both spec files, for every question. The message half always read both — an
 * outbox requirement in arch.spec.md is the canonical home of a `Publishes:`
 * line, and a scan of spec.md alone answered "nobody consumes it" over the file
 * most authors use. The operation half read spec.md only, because that is
 * where `validate` grades an `Operations:` line; but an arch.spec.md line
 * naming another service's operation is exactly the cross-service dependency
 * `loam dependencies` already reads off both files, and a removal must not
 * read the same line as a dependency there and as nothing here.
 */
export const REQUIREMENT_AXES: readonly SpecAxis[] = ["spec", "archSpec"];

/**
 * Does this service's own living contract define `op`? Then an `Operations:`
 * line of its own names ITS operation, not another service's.
 *
 * The rule `validate` grades an `Operations:` line by: it resolves against the
 * requirement's own service's contract (`spec-api.op-undefined`), so in a green
 * fleet another service naming the same id is naming its own. Matching the bare
 * id fleet-wide refused a rename on payment-service because checkout-web's own
 * `capturePayment` requirement shared the name (review 2026-10-12, finding 1) —
 * and shared ids like `healthCheck` or `getStatus` are common across a fleet.
 *
 * A contract that is unreadable or absent proves no ownership, so the line stays
 * a consumer: the closed direction, and the reading every scan here gave before
 * ownership was asked at all.
 */
export function ownsOperation(state: ServiceState, op: string): boolean {
  return state.openapi.kind === "read" && state.openapi.value.some((o) => o.id === op);
}

const EDGE = (resolve: (id: string) => string, r: Rel): string =>
  `edge ${resolve(r.source)} → ${resolve(r.target)}${r.title === undefined ? "" : ` ("${r.title}")`}`;

/** Entry comparator by map key — deterministic suspension order. */
const byFirst = <T>(a: [string, T], b: [string, T]): number => (a[0] < b[0] ? -1 : 1);

/** How one requirement scan decides a hit — for another service, and for the provider itself. */
interface RequirementRule {
  provider: string;
  foreign: (state: ServiceState, r: Requirement) => Promise<boolean>;
  own: (r: Requirement) => boolean;
}

export function consumerIndex(request: ConsumerRequest): ConsumerIndex {
  const { docsDir } = request;
  const context = request.context ?? new FleetContext();
  const after = request.afterFeature === undefined ? undefined : featureView({ docsDir, featureDir: request.afterFeature, context });

  /** One service's requirements on one axis as `after`'s merge would leave them, read once per index. */
  const merged = new Map<string, Promise<MergedRequirement[] | { unreadable: string }>>();
  const requirementsOf = (state: ServiceState, axis: SpecAxis): Promise<MergedRequirement[] | { unreadable: string }> => {
    const key = `${state.id}\0${axis}`;
    let pending = merged.get(key);
    if (pending === undefined) {
      const a = state[axis];
      pending =
        a.kind === "unreadable"
          ? Promise.resolve({ unreadable: a.path })
          : (async () => afterMerge(a.kind === "read" ? a.value : [], await after?.delta(state.id, axis)))();
      merged.set(key, pending);
    }
    return pending;
  };

  const label = (service: string, m: MergedRequirement): string =>
    m.written
      ? `this feature's ${service} delta requirement '${m.requirement.name}'`
      : `${service}'s living requirement '${m.requirement.name}'`;

  /**
   * The requirement half of one scan, `tupleVisible`'s own discipline applied
   * to victims: an unreadable consumer axis contributes a SUSPENSION, never a
   * silent nothing — "consuming nothing" and "loam refused to read the file"
   * are opposite facts, and collapsing them is how a breaking removal used to
   * grade down to a confident warning. Sorted, so victim order never depends on
   * the enumeration's walk order. A REMOVED requirement governs nothing: the
   * rule `validate` reads living requirements by.
   *
   * The provider's own unreadable axis is NOT a suspension: it is not a
   * consumer anybody else must be warned about, and that file is the provider's
   * own finding (`validate`, and the delta checks when the feature restates it).
   * It is filed as `ownSuspended`, which only the gate reads.
   */
  const scanRequirements = async (rule: RequirementRule): Promise<Consumers> => {
    const { services, ambiguous } = await livingFleet(docsDir, context);
    const out: Consumers = { victims: [], suspended: [], own: [], ownSuspended: [] };
    for (const id of [...services.keys()].sort()) {
      const state = services.get(id)!;
      const mine = id === rule.provider;
      for (const axis of REQUIREMENT_AXES) {
        const reqs = await requirementsOf(state, axis);
        if (!Array.isArray(reqs)) {
          if (mine) out.ownSuspended.push({ kind: "unreadable", text: `${id} — ${reqs.unreadable} could not be read, so its own requirements could not be scanned` });
          else out.suspended.push({ kind: "unreadable", text: `${id} — ${reqs.unreadable} could not be read, so its requirements could not be scanned` });
          continue;
        }
        for (const m of reqs) {
          if (m.requirement.kind === "REMOVED") continue;
          if (mine ? rule.own(m.requirement) : await rule.foreign(state, m.requirement)) {
            (mine ? out.own : out.victims).push(label(id, m));
          }
        }
      }
    }
    for (const [id, dirs] of [...ambiguous].sort(byFirst)) {
      const text = `${id} — claimed by ${dirs.join(" and ")}, so its ${id === rule.provider ? "own " : ""}documents could not be scanned`;
      (id === rule.provider ? out.ownSuspended : out.suspended).push({ kind: "ambiguous", text });
    }
    return out;
  };

  /** Ownership as the merge leaves it: the feature's contract for a service it carries one for, the living one otherwise. */
  const owns = async (state: ServiceState, op: string): Promise<boolean> =>
    (await after?.defines(state.id, op)) ?? ownsOperation(state, op);

  const opConsumers = async (provider: string, op: string): Promise<Consumers> => {
    const map = await livingMap(docsDir, context);
    const edges: string[] = [];
    const internal: string[] = [];
    const unlinked: Suspension[] = [];
    for (const r of map.relationships ?? []) {
      if (map.resolve(r.target) !== provider) continue;
      // An edge whose SOURCE resolves to the provider as well is the provider's
      // own internal call — `own`, never a victim (the header says why). The
      // spine still grades it against the contract, so the gate counts it.
      const self = map.resolve(r.source) === provider;
      if (r.op === op) {
        (self ? internal : edges).push(EDGE(map.resolve, r));
      } else if (!self && r.op === undefined && r.publishes === undefined && r.consumes === undefined) {
        // A caller drawn with NO op is neither a victim nor proof of absence:
        // it calls the provider, and nobody wrote down which operation.
        // Dropping it silently made every removal on a seeded fleet (`loam
        // seed` draws every edge without an op) read "no current landscape
        // edge names it" while validate warned `spine.op-link-missing` on the
        // very edge. It rides as a suspension — a warning's worth of doubt,
        // never an error, so an op-less map does not turn every removal red:
        // its kind is `unlinked`, which the removal gate does not refuse on
        // (`documentDoubt` in ./scan.ts says which kinds it does, and why).
        // An edge naming a message instead (`publishes`/`consumes`) said what
        // it carries and is the message half's to grade.
        unlinked.push({ kind: "unlinked", text: `${EDGE(map.resolve, r)} has no \`metadata { op }\`, so whether it calls '${op}' is unknown` });
      }
    }
    const reqs = await scanRequirements({
      provider,
      foreign: async (state, r) => r.operations.includes(op) && !(await owns(state, op)),
      own: (r) => r.operations.includes(op),
    });
    // Flows last in each list, deliberately: the edge and the requirement say
    // WHICH document to open, and the flow says what the reader is about to
    // break — so a `details[]` scanned top-down ends on the consequence.
    const hops = hopsExercising(map.useCases, { provider, op });
    return {
      victims: [...edges, ...reqs.victims, ...hops.breaks],
      suspended: [...unlinked, ...reqs.suspended, ...hops.unsure.map((text): Suspension => ({ kind: "contested", text }))],
      own: [...internal, ...reqs.own],
      ownSuspended: reqs.ownSuspended,
    };
  };

  const messageConsumers = async (provider: string, name: string): Promise<Consumers> => {
    const map = await livingMap(docsDir, context);
    const edges: string[] = [];
    for (const r of map.relationships ?? []) {
      // The message join is fleet-global (names are not service-scoped), so
      // every edge naming it counts, whoever its producer is — except one INTO
      // the provider itself: its own consumption leaves in the same change, and
      // counting it would gate every self-consuming producer on its own
      // retirement.
      if (r.consumes === name && map.resolve(r.target) !== provider) edges.push(EDGE(map.resolve, r));
    }
    // No ownership rule here, and the asymmetry is the contract's: a consumer
    // declares the message in its OWN contract with `action: receive` — validate
    // requires it to — so its own contract naming the message proves nothing
    // about who sends it. The provider's own `Consumes:` line stays out for the
    // edge's reason above; its own `Publishes:` line is what `own` is for.
    const reqs = await scanRequirements({
      provider,
      foreign: async (_state, r) => r.consumes.includes(name),
      own: (r) => r.publishes.includes(name),
    });
    const hops = hopsConsuming(map.useCases, { provider, name });
    return { victims: [...edges, ...reqs.victims, ...hops], suspended: reqs.suspended, own: reqs.own, ownSuspended: reqs.ownSuspended };
  };

  const producers = async (name: string): Promise<string[]> => {
    const { services } = await livingFleet(docsDir, context);
    return [...services.keys()].sort().filter((id) => services.get(id)!.sent.includes(name));
  };

  return { opConsumers, messageConsumers, producers };
}
