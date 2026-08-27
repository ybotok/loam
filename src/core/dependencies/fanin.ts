/**
 * Fleet fan-in: for each service, how many DISTINCT other known services
 * depend on it — the blast radius behind `loam list --needs-work
 * --review-order`. Reviewing the most-depended-on service first is the one
 * ordering a campaign lead cannot derive by eye from the worklist.
 *
 * Pure derivation, derived-never-stored, in the package that already owns
 * who-depends-on-whom: `core/dependencies/` derives the feature ordering from
 * artifact identities, and this module derives the service-level analog. The
 * command layer (commands/list/review.ts) gathers the inputs from reads the
 * repository already pays for and hands them in as data, so the module itself
 * imports nothing — no IO, no parser import, never prints. The edge slice is
 * structural for the same reason `core/vocabulary/maturity.ts`'s EdgeSource
 * is: `core/c4/likec4.ts`'s `Rel` satisfies it without an import edge into
 * the parser.
 */

/** The slice of a drawn relationship the joins read. */
export interface FanInEdge {
  source: string;
  target: string;
  /** AsyncAPI message this edge CONSUMES — binds the TARGET as the consumer. */
  consumes?: string;
}

/** One service's contract slice: what it declares it sends, and what its living requirements consume. */
export interface FanInContracts {
  /** Message names this service's asyncapi.yaml reaches from an `action: send` operation. */
  sent: readonly string[];
  /** Message names the service's living (non-REMOVED) spec/arch requirements carry on `Consumes:` lines. */
  consumed: readonly string[];
}

/**
 * The fleet map's contribution, as a variant rather than optional fields: a
 * landscape either parses — and then it has relationships and a resolver — or
 * it proves nothing, and there is no half-state in which `parses: false`
 * arrives carrying edges anyway. Positive evidence only, the rule
 * `landscapeEvidence` (core/vocabulary/maturity.ts) spells for the same map:
 * an absent or unparseable landscape contributes NOTHING to the edge joins,
 * while the requirement join below still counts.
 */
export type FanInLandscape =
  | {
      parses: true;
      relationships: readonly FanInEdge[];
      /** The shared container-aware resolver (`core/c4/resolve/service.ts` serviceResolver), widened to plain strings. */
      svcOf: (id: string) => string;
    }
  | { parses: false };

export interface FanInRequest {
  /** Every known service id — the universe both ends of every join are filtered to. */
  services: readonly string[];
  landscape: FanInLandscape;
  contracts: ReadonlyMap<string, FanInContracts>;
}

/**
 * Distinct known consumers per service, as a count for every id in
 * `req.services` (0 when nothing depends on it — a proven zero, since only
 * positive evidence ever increments it).
 *
 * Three joins, unioned by DISTINCT consumer so overlapping evidence for one
 * caller counts once:
 *  1. a drawn edge WITHOUT `consumes` into a service — its source is a
 *     caller, whether or not the edge carries an `op` (an op edge and a plain
 *     edge are one claim of dependence each);
 *  2. a drawn edge carrying `consumes` — the rule of
 *     commands/validate/service/events/events.ts: `consumes` binds the edge's
 *     TARGET as the consumer and its SOURCE as the producer, so an edge drawn
 *     producer→consumer is fan-in on the SOURCE. Such an edge contributes
 *     join 2 ONLY: on the event spine THE ARROW FOLLOWS THE MESSAGE (the
 *     scaffolded landscape's own doctrine, examples/docs' landscape spells
 *     it), so the arrow of a delivery edge is not a call into its target —
 *     reading it as one would rank a pure event sink above a real dependency
 *     and hand a bound broker service one phantom dependant per consumer;
 *  3. the landscape-independent requirement join — a service consumes a
 *     message some other service declares `action: send` for.
 * Self-dependence proves nothing, and an endpoint outside the known-service
 * set (an actor, an `#external` system, an unresolved id) is not a fleet
 * caller — review order ranks work the FLEET depends on.
 */
export function fleetFanIn(req: FanInRequest): Map<string, number> {
  const known = new Set(req.services);
  const consumers = new Map<string, Set<string>>();
  const depend = (producer: string, consumer: string): void => {
    if (producer === consumer) return;
    if (!known.has(producer) || !known.has(consumer)) return;
    const set = consumers.get(producer) ?? new Set<string>();
    set.add(consumer);
    consumers.set(producer, set);
  };

  if (req.landscape.parses) {
    const { relationships, svcOf } = req.landscape;
    for (const r of relationships) {
      const source = svcOf(r.source);
      const target = svcOf(r.target);
      // The variants of the join comment above: a delivery edge (consumes)
      // claims producer→consumer, never a call into its target.
      if (r.consumes === undefined) depend(target, source);
      else depend(source, target);
    }
  }

  // Join 3. Producer index first: message name → every service declaring it
  // sent. A message more than one service declares lands its subscribers on
  // every declarer — the derivation never guesses which declaration wins.
  const producers = new Map<string, string[]>();
  for (const [id, slice] of req.contracts) {
    if (!known.has(id)) continue;
    for (const message of slice.sent) {
      producers.set(message, [...(producers.get(message) ?? []), id]);
    }
  }
  for (const [id, slice] of req.contracts) {
    if (!known.has(id)) continue;
    for (const message of slice.consumed) {
      for (const producer of producers.get(message) ?? []) depend(producer, id);
    }
  }

  return new Map(req.services.map((id) => [id, consumers.get(id)?.size ?? 0]));
}
