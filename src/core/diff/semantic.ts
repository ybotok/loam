/**
 * The diff computation: join the base fleet (`./base-state.ts`) against the
 * working tree (`./current-state.ts`) and say, per service, what changed in
 * FLEET-MEANINGFUL terms — requirements by identity and digest, operations
 * and messages by their join tokens, cross-service joins by tuple — with the
 * current consumers of every removal named (`./victims.ts`).
 *
 * Two disciplines rule every branch here. Removal is graded against who still
 * depends on it: a removal nobody names is a warning, a removal the fleet
 * still joins to is an error and sets `breaking`. And "nobody could look" is
 * never "nothing changed": an unreadable artifact on EITHER side suspends
 * that subject's axis — recorded in `unreadable[]`, counted in the summary,
 * carried into the exit code by the command — instead of letting an
 * unreadable base read as everything-added or an unreadable working file
 * read as everything-removed.
 */
import { requirementDigest, type Requirement } from "../document/spec.js";
import type { Severity, Finding } from "../vocabulary/report.js";
import type { AxisState, BaseFleet, ServiceState } from "./base-state.js";
import type { CurrentFleet } from "./current-state.js";
import { consumerJoinChanges, type VictimIndex } from "./victims.js";

/**
 * The stable finding codes `loam diff` emits. Codes are the machine contract;
 * prose may be reworded, these may not. Documented (backticked) in the
 * generated AGENTS.md's diff section — codes-drift enforces that.
 */
export type DiffCode =
  /** A `services/<id>/` directory exists now that did not at the base ref. */
  | "diff.service-added"
  /** A service present at the base ref is gone from the working tree. */
  | "diff.service-removed"
  /** A living requirement (by `Requirement-ID:`, else heading) not present at base. */
  | "diff.requirement-added"
  /** A base requirement no longer in the living spec. */
  | "diff.requirement-removed"
  /** Same requirement identity on both sides, `requirementDigest` moved — rebase pins never move it. */
  | "diff.requirement-modified"
  /** An operationId in the living contract absent at base. */
  | "diff.op-added"
  /** A base operationId gone from the living contract, and no current consumer names it. */
  | "diff.op-removed"
  /** Removed since base AND the current fleet still names it — landscape edge or foreign living requirement; details list the victims. Sets `breaking`. */
  | "diff.op-removed-consumed"
  /** `deprecated: true` introduced since base; details name the current consumers. */
  | "diff.op-deprecated"
  /** An AsyncAPI message name absent at base. */
  | "diff.message-added"
  /** A base message gone, nothing currently consumes it (or another service still declares it — the details say). */
  | "diff.message-removed"
  /** Removed since base AND still consumed — a `Consumes:` line or a consumes-edge; details list the victims. Sets `breaking`. */
  | "diff.message-removed-consumed"
  /** A cross-service join appeared since base: another service's living requirement now names this service's operation or message. */
  | "diff.consumer-added"
  /** A cross-service join present at base is gone. */
  | "diff.consumer-removed";

/** Severity is a fact about the code, not a call-site choice — one table, no drift. */
const DIFF_SEVERITY: Record<DiffCode, Severity> = {
  "diff.service-added": "ok",
  "diff.service-removed": "warn",
  "diff.requirement-added": "ok",
  "diff.requirement-removed": "warn",
  "diff.requirement-modified": "ok",
  "diff.op-added": "ok",
  "diff.op-removed": "warn",
  "diff.op-removed-consumed": "error",
  "diff.op-deprecated": "warn",
  "diff.message-added": "ok",
  "diff.message-removed": "warn",
  "diff.message-removed-consumed": "error",
  "diff.consumer-added": "ok",
  "diff.consumer-removed": "ok",
};

function found(code: DiffCode, message: string, details?: string[]): Finding {
  const carry = details !== undefined && details.length > 0;
  return { severity: DIFF_SEVERITY[code], code, message, ...(carry ? { details } : {}) };
}

/** One suspended axis: which side could not be read, and why. */
export interface UnreadableEntry {
  side: "base" | "current";
  axis: "spec" | "archSpec" | "openapi" | "asyncapi";
  path: string;
  error: string;
}

export interface ServiceDiff {
  id: string;
  change: "added" | "removed" | "changed" | "unchanged";
  findings: Finding[];
  unreadable: UnreadableEntry[];
  /** Directories claiming this id when more than one does, on either side — every finding suspended. */
  ambiguous?: string[];
}

export interface FleetDiff {
  services: ServiceDiff[];
  /** True iff any error-severity finding — a removal the fleet still consumes. */
  breaking: boolean;
  /** `unreadable` counts suspended axes plus ambiguous base identities: places nobody could look. */
  summary: { added: number; removed: number; modified: number; deprecated: number; unreadable: number };
}

/** A side the service does not exist on: absence everywhere, honestly. */
const ABSENT = { kind: "absent" } as const;
const emptyState = (id: string): ServiceState => ({ id, dir: "", spec: ABSENT, archSpec: ABSENT, openapi: ABSENT, asyncapi: ABSENT });

/**
 * Guard one axis pair: record unreadable sides on the sink and say whether
 * the axis may be compared at all. Reading one good side against a suspended
 * one would grade absence it never proved.
 */
function comparable(sink: ServiceDiff, axis: UnreadableEntry["axis"], pair: { base: AxisState<unknown>; current: AxisState<unknown> }): boolean {
  for (const side of ["base", "current"] as const) {
    const state = pair[side];
    if (state.kind === "unreadable") sink.unreadable.push({ side, axis, path: state.path, error: state.error });
  }
  return pair.base.kind !== "unreadable" && pair.current.kind !== "unreadable";
}

const valueOr = <T>(axis: AxisState<T[]>): T[] => (axis.kind === "read" ? axis.value : []);

/** Identity: `Requirement-ID:` when authored, the heading otherwise — the same join `loam rebase` pins against. */
const reqKey = (r: Requirement): string => (r.id !== undefined ? `id:${r.id}` : `name:${r.name}`);
const reqLabel = (r: Requirement): string => (r.id !== undefined ? `${r.name} [${r.id}]` : r.name);

/** First declaration wins a duplicated key — the same arbitrary-but-stated pick every join on these axes makes. */
function firstWins<T>(items: T[], key: (item: T) => string): Map<string, T> {
  const map = new Map<string, T>();
  for (const item of items) if (!map.has(key(item))) map.set(key(item), item);
  return map;
}

/** Entry comparator by map key — explicit, because the default sort stringifies whole entries. */
const byKey = <T>(a: [string, T], b: [string, T]): number => (a[0] < b[0] ? -1 : 1);

function requirementsDiff(sink: ServiceDiff, pair: { base: ServiceState; current: ServiceState }): void {
  // v1 diffs spec.md's requirements only; arch.spec.md is read for the
  // Consumes: join but its requirement inventory is deferred (the two axes
  // are separate namespaces, and diffing both doubles the surface). Both
  // pairs are guarded BEFORE the early return, so a service whose two spec
  // files are both unreadable reports both suspensions, not just the first.
  const specComparable = comparable(sink, "spec", { base: pair.base.spec, current: pair.current.spec });
  comparable(sink, "archSpec", { base: pair.base.archSpec, current: pair.current.archSpec });
  if (!specComparable) return;
  const base = firstWins(valueOr(pair.base.spec), reqKey);
  const current = firstWins(valueOr(pair.current.spec), reqKey);
  for (const [key, r] of [...current].sort(byKey)) {
    const before = base.get(key);
    if (before === undefined) sink.findings.push(found("diff.requirement-added", `living requirement added since base: '${reqLabel(r)}'`));
    else if (requirementDigest(before) !== requirementDigest(r)) {
      sink.findings.push(found("diff.requirement-modified", `living requirement modified since base: '${reqLabel(r)}'`));
    }
  }
  for (const [key, r] of [...base].sort(byKey)) {
    if (!current.has(key)) sink.findings.push(found("diff.requirement-removed", `living requirement removed since base: '${reqLabel(r)}'`));
  }
}

async function opsDiff(sink: ServiceDiff, pair: { base: ServiceState; current: ServiceState }, victims: VictimIndex): Promise<void> {
  if (!comparable(sink, "openapi", { base: pair.base.openapi, current: pair.current.openapi })) return;
  const base = firstWins(valueOr(pair.base.openapi), (op) => op.id);
  const current = firstWins(valueOr(pair.current.openapi), (op) => op.id);
  for (const [id, op] of [...current].sort(byKey)) {
    const before = base.get(id);
    if (before === undefined) {
      sink.findings.push(found("diff.op-added", `operation '${id}' added since base (${op.method.toUpperCase()} ${op.path})`));
    } else if (!before.deprecated && op.deprecated) {
      const scan = await victims.opConsumers(sink.id, id);
      // Three honest phrasings — never a confident negative over a scan that skipped an unreadable consumer document.
      const stance = scan.victims.length > 0 ? `${scan.victims.length} current consumer(s) still name it`
        : scan.suspended.length > 0 ? "whether current consumers name it could not be fully answered"
        : "no current consumer names it";
      sink.findings.push(found("diff.op-deprecated", `operation '${id}' is deprecated since base — ${stance}`, [...scan.victims, ...scan.suspended]));
    }
  }
  for (const [id] of [...base].sort(byKey)) {
    if (current.has(id)) continue;
    const scan = await victims.opConsumers(sink.id, id);
    if (scan.victims.length > 0) {
      sink.findings.push(found("diff.op-removed-consumed", `operation '${id}' was removed since base and the current fleet still names it — these joins break`, [...scan.victims, ...scan.suspended]));
    } else if (scan.suspended.length > 0) {
      // "Nobody could be scanned" is not "nobody names it" — the consumer's own
      // unreadable[] entry already carries the run to exit 1; this message must
      // not assert a negative the scan never proved.
      sink.findings.push(found("diff.op-removed", `operation '${id}' was removed since base; whether the current fleet still names it could NOT be fully answered — ${scan.suspended.length} consumer document(s) were not scannable`, scan.suspended));
    } else {
      sink.findings.push(found("diff.op-removed", `operation '${id}' was removed since base; no current landscape edge or living requirement names it`));
    }
  }
}

async function messagesDiff(sink: ServiceDiff, pair: { base: ServiceState; current: ServiceState }, victims: VictimIndex): Promise<void> {
  if (!comparable(sink, "asyncapi", { base: pair.base.asyncapi, current: pair.current.asyncapi })) return;
  const base = firstWins(valueOr(pair.base.asyncapi), (m) => m.name);
  const current = firstWins(valueOr(pair.current.asyncapi), (m) => m.name);
  for (const [name] of [...current].sort(byKey)) {
    if (!base.has(name)) sink.findings.push(found("diff.message-added", `message '${name}' added since base`));
  }
  for (const [name] of [...base].sort(byKey)) {
    if (current.has(name)) continue;
    // Fleet-global join: a name another current service still declares is not
    // orphaned (positive evidence only — an unreadable contract never vouches).
    const elsewhere = victims.declarers(name).filter((d) => d !== sink.id);
    if (elsewhere.length > 0) {
      sink.findings.push(found("diff.message-removed", `message '${name}' was removed since base; still declared by ${elsewhere.join(", ")}`));
      continue;
    }
    const scan = await victims.messageConsumers(sink.id, name);
    if (scan.victims.length > 0) {
      sink.findings.push(found("diff.message-removed-consumed", `message '${name}' was removed since base and the current fleet still consumes it — these joins break`, [...scan.victims, ...scan.suspended]));
    } else if (scan.suspended.length > 0) {
      sink.findings.push(found("diff.message-removed", `message '${name}' was removed since base; whether anything still consumes it could NOT be fully answered — ${scan.suspended.length} consumer document(s) were not scannable`, scan.suspended));
    } else {
      sink.findings.push(found("diff.message-removed", `message '${name}' was removed since base; nothing currently consumes it`));
    }
  }
}

/** The graded join changes (`victims.ts`) as findings on each PROVIDER — the service whose surface the join lands on. */
function consumerFindings(input: { base: BaseFleet; current: CurrentFleet }): Map<string, Finding[]> {
  const changes = consumerJoinChanges({
    base: input.base.services,
    baseAmbiguous: new Set(input.base.ambiguous.keys()),
    current: input.current.services,
    currentAmbiguous: new Set(input.current.ambiguous.keys()),
  });
  const byProvider = new Map<string, Finding[]>();
  for (const { t, change } of changes) {
    const what = t.kind === "op" ? `operation '${t.token}'` : `message '${t.token}'`;
    const message = change === "added"
      ? `${t.consumer}'s living requirements now name this service's ${what} — a cross-service join appeared since base`
      : `${t.consumer}'s living requirements no longer name this service's ${what} — a cross-service join went away`;
    // The call sits directly in the push — assigned to a `const x = found(…)`
    // it reads as an arrow-function DECLARATION to the stable-code collector,
    // and both consumer codes silently leave the guarded set.
    byProvider.set(t.provider, [
      ...(byProvider.get(t.provider) ?? []),
      found(change === "added" ? "diff.consumer-added" : "diff.consumer-removed", message),
    ]);
  }
  return byProvider;
}

async function diffService(unit: { id: string; base?: ServiceState; current?: ServiceState; victims: VictimIndex }): Promise<ServiceDiff> {
  const sink: ServiceDiff = { id: unit.id, change: "unchanged", findings: [], unreadable: [] };
  if (unit.base === undefined) sink.findings.push(found("diff.service-added", `service '${unit.id}' added since base`));
  if (unit.current === undefined && unit.base !== undefined) {
    sink.findings.push(found("diff.service-removed", `service '${unit.id}' (${unit.base.dir}) is gone from the working tree`));
  }
  const pair = { base: unit.base ?? emptyState(unit.id), current: unit.current ?? emptyState(unit.id) };
  requirementsDiff(sink, pair);
  await opsDiff(sink, pair, unit.victims);
  await messagesDiff(sink, pair, unit.victims);
  return sink;
}

export async function computeDiff(input: { base: BaseFleet; current: CurrentFleet; victims: VictimIndex }): Promise<FleetDiff> {
  const sides = [input.base.services, input.base.ambiguous, input.current.services, input.current.ambiguous];
  const ids = [...new Set(sides.flatMap((side) => [...side.keys()]))].sort();
  const joins = consumerFindings({ base: input.base, current: input.current });
  const services: ServiceDiff[] = [];
  // Sequential on purpose: the report's order IS the contract (identical
  // states must emit identical bytes), the work per service is in-memory
  // joins, and the one expensive read — the victim index's landscape — is
  // memoised behind its first ask, so a fan-out would buy nothing.
  for (const id of ids) {
    const claimants = [...(input.base.ambiguous.get(id) ?? []), ...(input.current.ambiguous.get(id) ?? [])];
    if (claimants.length > 0) {
      // An id two directories claim — either side — has no single state to
      // diff; the whole subject suspends (containment), and the live walk's
      // `subsystem.name-collision` names the same defect for validate.
      services.push({ id, change: "changed", findings: [], unreadable: [], ambiguous: claimants });
      continue;
    }
    const sink = await diffService({ id, base: input.base.services.get(id), current: input.current.services.get(id), victims: input.victims });
    sink.findings.push(...(joins.get(id) ?? []));
    if (input.base.services.has(id) && !input.current.services.has(id)) sink.change = "removed";
    else if (!input.base.services.has(id)) sink.change = "added";
    else sink.change = sink.findings.length > 0 || sink.unreadable.length > 0 ? "changed" : "unchanged";
    services.push(sink);
  }
  const all = services.flatMap((s) => s.findings);
  const count = (codes: (f: Finding) => boolean): number => all.filter(codes).length;
  return {
    services,
    breaking: all.some((f) => f.severity === "error"),
    summary: {
      added: count((f) => f.code.endsWith("-added")),
      removed: count((f) => f.code.endsWith("-removed") || f.code.endsWith("-removed-consumed")),
      modified: count((f) => f.code === "diff.requirement-modified"),
      deprecated: count((f) => f.code === "diff.op-deprecated"),
      unreadable:
        services.reduce((n, s) => n + s.unreadable.length, 0) +
        services.filter((s) => s.ambiguous !== undefined).length,
    },
  };
}
