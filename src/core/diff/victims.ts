/**
 * Who, in the CURRENT fleet, still depends on a thing the diff says was
 * removed or deprecated — the joins that turn "an operation left the
 * contract" into "and these named consumers break".
 *
 * THREE SOURCES answer that, and only the first two are copies of anything.
 *
 * The first two are deliberately a SECOND copy of the consumer join the
 * coherence gate asks, built on the same shared primitives, and both copies
 * say so:
 *
 *  - the operation half mirrors `core/coherence/lookups.ts`'s
 *    `edgeConsumers`/`requirementConsumers` (landscape edges with
 *    `metadata { op }` resolved through `serviceResolver` WITH the enumerated
 *    fleet — the container lesson recorded there — plus other services'
 *    living `Operations:` lines, spec.md only, exactly as that module scans);
 *  - the message half mirrors `core/coherence/events/lookups.ts`'s
 *    `messageConsumers` (every `consumes` edge naming the message except one
 *    INTO the provider, plus other services' `Consumes:` lines over BOTH spec
 *    axes — the outbox requirement lives in arch.spec.md as often as in
 *    spec.md, that module's lesson).
 *
 * The copies cannot be one module today: coherence's lookups are closures
 * over a feature's `DeltaScope` and its lazy caches; this one is an index
 * over an already-read fleet. Rule 13 (docs/DESIGN.md) governs — a THIRD
 * copy of this join forces the shared extraction, and whoever changes the
 * victim strings or the scan rules in either module owes the other the same
 * change. The victim string spellings are kept byte-compatible with the
 * coherence findings on purpose, so a reader meets one vocabulary.
 *
 * The THIRD source is not a copy and does not fall under that rule: the fleet's
 * USE CASES, joined in `core/usecases/operations.ts`. A hop of a
 * capability-tagged `dynamic view` that the model attributes to the operation
 * being removed is a business flow that stops working, and saying so — "step 4
 * of Checkout breaks" — is the only one of the three that names a consequence a
 * human weighs rather than a document they then have to open. It has its own
 * module because it asks a different question of a different reader (an
 * attribution over the whole `architecture/` PROJECT, not a scan of one
 * landscape file), and because the attributed/contested distinction it turns on
 * belongs beside `attributeStep`, not beside a requirement scan. Coherence has
 * no equivalent to keep in step with, so nothing here owes it a mirror.
 */
import { existsSync } from "node:fs";
import { type LoadedDoc, type Rel } from "../c4/likec4.js";
import { serviceResolver } from "../c4/resolve/service.js";
import { landscapePath } from "../repo/paths.js";
import { readUseCases, type UseCaseScan } from "../usecases/fleet.js";
import { hopsConsuming, hopsExercising } from "../usecases/operations.js";
import type { DocsDir } from "../kernel/ids/dirs.js";
import type { FleetContext } from "../fleet-context.js";
import type { Requirement } from "../document/spec.js";
import type { ServiceState } from "./base-state.js";

/**
 * One consumer scan's answer, honest about its own coverage. `victims` is
 * positive evidence; `suspended` names the consumers whose relevant document
 * could not be read (or whose identity is ambiguous), because a scan that
 * skipped a file loam REFUSED to read must never let the caller assert
 * "nobody names it" — the fail-open shape this type exists to forbid.
 */
export interface ConsumerScan {
  victims: string[];
  suspended: string[];
}

/** The current-state consumer questions `semantic.ts` asks per removal. */
export interface VictimIndex {
  /** Current consumers of `provider`'s operation `op`: landscape edges into the provider, then other services' living requirements, then the use-case hops the model attributes to it (contested hops ride as suspensions). */
  opConsumers(provider: string, op: string): Promise<ConsumerScan>;
  /** Current consumers of message `name` a `provider` is dropping: consumes-edges (not into the provider), then other services' `Consumes:` lines over both spec axes, then the use-case hops backed by such an edge. */
  messageConsumers(provider: string, name: string): Promise<ConsumerScan>;
  /** Current services whose asyncapi declares `name` — positive evidence only; a message still declared elsewhere is not orphaned by one producer dropping it. */
  declarers(name: string): string[];
}

/** The requirements one current service contributes to a scan, per axis rule. */
function reqsOf(state: ServiceState, axes: readonly ("spec" | "archSpec")[]): Requirement[] {
  return axes.flatMap((axis) => {
    const a = state[axis];
    return a.kind === "read" ? a.value : [];
  });
}

const EDGE = (resolve: (id: string) => string, r: Rel): string =>
  `edge ${resolve(r.source)} → ${resolve(r.target)}${r.title === undefined ? "" : ` ("${r.title}")`}`;

/** Entry comparator by map key — deterministic suspension order. */
const byFirst = <T>(a: [string, T], b: [string, T]): number => (a[0] < b[0] ? -1 : 1);

/** The landscape half of the index, loaded at most once and only when a removal actually asks. */
interface Drawn {
  usable: LoadedDoc | null;
  resolve: ((id: string) => string) | null;
}

export function victimIndex(snap: {
  docsDir: DocsDir;
  context: FleetContext;
  current: ReadonlyMap<string, ServiceState>;
  /** Ids the working tree claims twice (current-state.ts) — their documents cannot be scanned, so they ride as suspended consumers. */
  ambiguous: ReadonlyMap<string, string[]>;
}): VictimIndex {
  // Lazy on purpose, the coherence lookups' own discipline: the landscape is
  // a full LikeC4 workspace spin-up, and a diff that removes nothing must not
  // pay for it. An absent landscape proves nothing; an unreadable one proves
  // nothing either way — `landscape.invalid` is validate's finding to make,
  // and inventing victims out of a parse error would point the reader at the
  // wrong file (core/coherence/lookups.ts's doctrine, verbatim).
  let drawn: Promise<Drawn> | undefined;
  const landscape = (): Promise<Drawn> =>
    (drawn ??= (async (): Promise<Drawn> => {
      const path = landscapePath(snap.docsDir);
      const doc: LoadedDoc | null = existsSync(path) ? await snap.context.loadLikeC4(path) : null;
      const usable = doc !== null && doc.errors.length === 0 ? doc : null;
      // The enumerated fleet rides into the resolver so a landscape that
      // models CONTAINERS stays visible: without `known`, an edge into
      // `payment.api` resolves to a service called "api" that has never
      // existed and the join finds nobody — the exact defect DESIGN's
      // serviceResolver-known row records.
      return {
        usable,
        resolve: usable === null ? null : serviceResolver(usable.elements, new Set(snap.current.keys())),
      };
    })());

  // Sorted, so victim order never depends on the enumeration's walk order.
  const ids = [...snap.current.keys()].sort();

  /**
   * The use-case half, lazy for the same reason and one step further.
   *
   * `readUseCases` carries its own cheap gate — a byte scan for the reserved
   * tag prefix — so a fleet that declares no use case never starts LikeC4 here
   * at all, and a fleet that does pays for the `architecture/` project exactly
   * once per `loam diff`, at the first removal that asks. The fleet set is the
   * same one the landscape resolver above is built from, so the two halves
   * cannot disagree about which service an element stands for.
   */
  let flows: Promise<UseCaseScan> | undefined;
  const useCases = (): Promise<UseCaseScan> =>
    (flows ??= readUseCases({ docsDir: snap.docsDir, known: new Set(snap.current.keys()) }));

  /**
   * The requirement half of one scan, `tupleVisible`'s own discipline applied
   * to victims: an unreadable consumer axis contributes a SUSPENSION, never a
   * silent nothing — "consuming nothing" and "loam refused to read the file"
   * are opposite facts, and collapsing them is how a breaking removal used to
   * grade down to a confident warning.
   */
  const scanRequirements = (unit: { provider: string; axes: readonly ("spec" | "archSpec")[]; hit: (r: Requirement) => boolean }): ConsumerScan => {
    const out: ConsumerScan = { victims: [], suspended: [] };
    for (const other of ids.filter((id) => id !== unit.provider)) {
      const state = snap.current.get(other)!;
      for (const axis of unit.axes) {
        const a = state[axis];
        if (a.kind === "unreadable") {
          out.suspended.push(`${other} — ${a.path} could not be read, so its requirements could not be scanned`);
          continue;
        }
        if (a.kind !== "read") continue;
        for (const r of a.value) if (unit.hit(r)) out.victims.push(`${other}'s living requirement '${r.name}'`);
      }
    }
    for (const [id, dirs] of [...snap.ambiguous].sort(byFirst)) {
      if (id !== unit.provider) out.suspended.push(`${id} — claimed by ${dirs.join(" and ")}, so its documents could not be scanned`);
    }
    return out;
  };

  const opConsumers = async (provider: string, op: string): Promise<ConsumerScan> => {
    const { usable, resolve } = await landscape();
    const scan = scanRequirements({ provider, axes: ["spec"], hit: (r) => r.operations.includes(op) });
    const edges: string[] = [];
    if (usable !== null && resolve !== null) {
      for (const r of usable.relationships) {
        if (r.op === op && resolve(r.target) === provider) edges.push(EDGE(resolve, r));
      }
    }
    // Flows last in each list, deliberately: the edge and the requirement say
    // WHICH document to open, and the flow says what the reader is about to
    // break — so a `details[]` scanned top-down ends on the consequence.
    const hops = hopsExercising(await useCases(), { provider, op });
    return {
      victims: [...edges, ...scan.victims, ...hops.breaks],
      suspended: [...scan.suspended, ...hops.unsure],
    };
  };

  const messageConsumers = async (provider: string, name: string): Promise<ConsumerScan> => {
    const { usable, resolve } = await landscape();
    const scan = scanRequirements({ provider, axes: ["spec", "archSpec"], hit: (r) => r.consumes.includes(name) });
    const edges: string[] = [];
    if (usable !== null && resolve !== null) {
      for (const r of usable.relationships) {
        // The message join is fleet-global, so every edge naming it counts —
        // except one into the provider itself, whose consumption leaves with
        // the same change (events/lookups.ts's exclusion, verbatim).
        if (r.consumes === name && resolve(r.target) !== provider) edges.push(EDGE(resolve, r));
      }
    }
    const hops = hopsConsuming(await useCases(), { provider, name });
    return { victims: [...edges, ...scan.victims, ...hops], suspended: scan.suspended };
  };

  const declarers = (name: string): string[] =>
    ids.filter((id) => {
      const axis = snap.current.get(id)!.asyncapi;
      return axis.kind === "read" && axis.value.some((m) => m.name === name);
    });

  return { opConsumers, messageConsumers, declarers };
}

/**
 * One cross-service join: `consumer`'s living requirements name a `token` that
 * `provider`'s contract defines. The same "who depends on what" question the
 * index above answers per removal, asked here of a WHOLE state — base or
 * current — so `semantic.ts` can report joins that appeared or went away.
 */
export interface ConsumerTuple {
  kind: "op" | "message";
  consumer: string;
  provider: string;
  token: string;
}

/** The map key a tuple is joined on between the two states. */
function tupleKey(t: ConsumerTuple): string {
  return `${t.kind}\0${t.consumer}\0${t.provider}\0${t.token}`;
}

/**
 * Every cross-service join one state holds, keyed for the base/current join.
 * Axis rules mirror the two consumer scans above: `Operations:` from spec.md
 * only, `Consumes:` from both spec axes. Unreadable axes simply contribute
 * nothing here — `semantic.ts` guards the GRADING so a join is never called
 * added or removed off a side nobody could read.
 */
export function consumerTuples(states: ReadonlyMap<string, ServiceState>): Map<string, ConsumerTuple> {
  const providersOf = (pick: (s: ServiceState) => string[]): Map<string, string[]> => {
    const map = new Map<string, string[]>();
    for (const id of [...states.keys()].sort()) {
      for (const token of pick(states.get(id)!)) map.set(token, [...(map.get(token) ?? []), id]);
    }
    return map;
  };
  const opProviders = providersOf((s) => (s.openapi.kind === "read" ? s.openapi.value.map((op) => op.id) : []));
  const msgProviders = providersOf((s) => (s.asyncapi.kind === "read" ? s.asyncapi.value.map((m) => m.name) : []));
  const out = new Map<string, ConsumerTuple>();
  const add = (t: ConsumerTuple): void => {
    out.set(tupleKey(t), t);
  };
  for (const consumer of [...states.keys()].sort()) {
    const state = states.get(consumer)!;
    for (const r of reqsOf(state, ["spec"])) {
      for (const op of r.operations) {
        for (const p of opProviders.get(op) ?? []) if (p !== consumer) add({ kind: "op", consumer, provider: p, token: op });
      }
    }
    for (const r of reqsOf(state, ["spec", "archSpec"])) {
      for (const name of r.consumes) {
        for (const p of msgProviders.get(name) ?? []) if (p !== consumer) add({ kind: "message", consumer, provider: p, token: name });
      }
    }
  }
  return out;
}

/** May a tuple be graded off this side? Absence answers; unreadable does not; an ambiguous base identity answers nothing. */
function tupleVisible(states: ReadonlyMap<string, ServiceState>, ambiguous: ReadonlySet<string>, t: ConsumerTuple): boolean {
  if (ambiguous.has(t.consumer) || ambiguous.has(t.provider)) return false;
  const readable = (id: string, axes: ("spec" | "archSpec" | "openapi" | "asyncapi")[]): boolean => {
    const state = states.get(id);
    return state === undefined || axes.every((axis) => state[axis].kind !== "unreadable");
  };
  return (
    readable(t.consumer, t.kind === "op" ? ["spec"] : ["spec", "archSpec"]) &&
    readable(t.provider, [t.kind === "op" ? "openapi" : "asyncapi"])
  );
}

/** One graded cross-service join change between the two states. */
export interface ConsumerChange {
  t: ConsumerTuple;
  change: "added" | "removed";
}

/**
 * The joins that appeared or went away between base and current, sorted for
 * deterministic output (provider, kind, token, consumer). The visibility
 * guard is the containment rule: a join is never called "added" off a base
 * side nobody could read, nor "removed" off an unreadable working file — the
 * suspended axis already carries that fact.
 */
export function consumerJoinChanges(input: {
  base: ReadonlyMap<string, ServiceState>;
  baseAmbiguous: ReadonlySet<string>;
  current: ReadonlyMap<string, ServiceState>;
  currentAmbiguous: ReadonlySet<string>;
}): ConsumerChange[] {
  const baseTuples = consumerTuples(input.base);
  const currentTuples = consumerTuples(input.current);
  const graded: ConsumerChange[] = [];
  for (const [key, t] of currentTuples) {
    if (!baseTuples.has(key) && tupleVisible(input.base, input.baseAmbiguous, t)) graded.push({ t, change: "added" });
  }
  for (const [key, t] of baseTuples) {
    if (!currentTuples.has(key) && tupleVisible(input.current, input.currentAmbiguous, t)) graded.push({ t, change: "removed" });
  }
  return graded.sort((a, b) => {
    const ka = `${a.t.provider}\0${a.t.kind}\0${a.t.token}\0${a.t.consumer}\0${a.change}`;
    const kb = `${b.t.provider}\0${b.t.kind}\0${b.t.token}\0${b.t.consumer}\0${b.change}`;
    return ka < kb ? -1 : 1;
  });
}
