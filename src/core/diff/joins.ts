/**
 * The cross-service joins `loam diff` reports appearing or going away between
 * the base ref and the working tree — `diff.consumer-added` /
 * `diff.consumer-removed`.
 *
 * These lived in `./victims.ts` beside the per-removal victim index until that
 * index moved down to `core/consumers/` to become the one consumer answer the
 * coherence gate and the archive planner read too. The joins below stayed: they
 * compare two WHOLE states, which only the diff has, while the index answers
 * about one fleet.
 */
import type { Requirement } from "../document/spec.js";
import type { ServiceState } from "../consumers/state.js";
import { ownsOperation, REQUIREMENT_AXES } from "../consumers/consumers.js";

/** The requirements one service contributes to a join — both spec files, a REMOVED one governing nothing. */
function reqsOf(state: ServiceState): Requirement[] {
  return REQUIREMENT_AXES.flatMap((axis) => {
    const a = state[axis];
    return a.kind === "read" ? a.value.filter((r) => r.kind !== "REMOVED") : [];
  });
}

/**
 * One cross-service join: `consumer`'s living requirements name a `token` that
 * `provider`'s contract defines. The same "who depends on what" question the
 * consumer index (`core/consumers/consumers.ts`) answers per removal, asked
 * here of a WHOLE state — base or current — so `./semantic.ts` can report
 * joins that appeared or went away.
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
 * The rules are the consumer index's, read off it rather than restated: both
 * spec files for `Operations:` and `Consumes:` alike (`REQUIREMENT_AXES`), and
 * an `Operations:` line naming an id the consumer's own contract defines is
 * that consumer's own operation, no join onto anybody else's
 * (`ownsOperation`). An unreadable axis simply contributes nothing here — no
 * line from a spec file nobody could read, no ownership from a contract nobody
 * could read — and `tupleVisible` below guards the GRADING, so a join is never
 * called added or removed off a side nobody could read.
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
    for (const r of reqsOf(state)) {
      for (const op of r.operations) {
        if (ownsOperation(state, op)) continue;
        for (const p of opProviders.get(op) ?? []) if (p !== consumer) add({ kind: "op", consumer, provider: p, token: op });
      }
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
  // Both spec files on the consumer's side, for either kind: a line in the file
  // nobody could read may be the very one the join came or went by. NOT the
  // consumer's own contract, although an operation join reads it: it is asked
  // only whether the line names the consumer's OWN operation, and an
  // unreadable contract proves no ownership (`ownsOperation`), so the line
  // counts on that side — the index's own rule. A side holding it unread can
  // only have MORE joins, never hide one, and suppressing the join there kept
  // `diff.consumer-added` / `-removed` off a report whose victims named that
  // very consumer (the contract review, finding 4).
  return readable(t.consumer, ["spec", "archSpec"]) && readable(t.provider, [t.kind === "op" ? "openapi" : "asyncapi"]);
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
