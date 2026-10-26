/**
 * The hop join: for each hop of a fleet flow that one service answers, the
 * flows of that service that unfold it.
 *
 * The join is READ, never stored. A fleet flow and a service flow are separate
 * documents with separate authors, and a stored link between them would be a
 * third document to keep true. Here the link is the key both already carry
 * (`./keys.ts`): the hop's operation or message, the requirement that holds the
 * same name, and the `#req-` tag a service flow claims that requirement with.
 * Asked again, it answers again from whatever the documents say now.
 *
 * AN EMPTY INSIDE IS A FACT, NEVER A FINDING. `joined` with no flows says no
 * flow of the service claims a requirement holding the hop's key — which is
 * true, and is what the brief states. Nothing here grades it: no check may grade
 * the absence of a view (docs/DESIGN.md rule 26), and a nudge to draw one would
 * be presence owed in all but name. What the inside must never be is an empty
 * list that only LOOKS like that fact: a service whose flows could not be read
 * is `unread`, its keys kept, and no `flows` key a caller could count.
 *
 * NO FILTER. Every flow claiming a requirement that holds the key is listed,
 * with the requirement it came through (`via`), and a caller groups by that. A
 * narrower answer — only the flows whose own entry step carries the operation —
 * would need `op` on a service's internal entry edges, which a real fleet's
 * models almost never carry, and it would empty nearly every hop.
 */
import type { ParsedStep } from "../../c4/parsed/dynamic-views.js";
import { compareIds } from "../../repo/entries.js";
import type { UseCaseScan } from "../fleet.js";
import type { ViewPlace } from "../place.js";
import { flowsTouching, type TouchedStep, type TouchedUseCase } from "../touch.js";
import { hopAnswer, keyId, type HopKey } from "./keys.js";

/** Where a service flow comes from: the service's living documents, or the feature's slot the archive writes over them. */
export type FlowOrigin = "living" | "feature";

/** One service flow, located, with the requirement ids its `#req-` tags resolve to as the merge leaves them. */
export interface ServiceFlowClaims {
  id: string;
  /** The docs-relative file a reader opens. */
  file: string;
  origin: FlowOrigin;
  claims: ReadonlySet<string>;
}

/** A flow inside the hop, and which of its claimed requirements holds the hop's key. */
export interface InnerFlow {
  id: string;
  file: string;
  origin: FlowOrigin;
  via: string[];
}

/**
 * What a hop the service answers unfolds into.
 *
 * `joined` and `unread` carry the keys, so a reader knows what was looked for
 * either way; only `joined` carries `flows`, so an unreadable service can never
 * be counted as one with nothing inside. The other three are `./keys.ts`'s
 * answers, passed through: no key, no join.
 */
export type HopInside =
  | { state: "joined"; keys: HopKey[]; flows: InnerFlow[] }
  | { state: "unread"; keys: HopKey[] }
  | { state: "keyless" }
  | { state: "contested"; candidates: (string | null)[] }
  | { state: "unbacked" };

/** A touched hop, with its inside when the addressed service answers it — absent when it does not. */
export interface JoinedStep extends TouchedStep {
  inside?: HopInside;
}

export interface JoinedUseCase extends Omit<TouchedUseCase, "steps"> {
  steps: JoinedStep[];
}

export interface InsideRequest {
  service: string;
  /** Requirement ids by key (`requirementKeys`), over the service's requirements as the merge leaves them. */
  requirements: ReadonlyMap<string, ReadonlySet<string>>;
  /** The service's flows, as the merge leaves them — or `null` when its project could not be read. */
  flows: readonly ServiceFlowClaims[] | null;
  /** How the fleet flow's file is spelled (`flowsTouching`'s `place`); a fleet scan's by default. */
  place?: ViewPlace;
}

/**
 * The flows of a scan that touch the service, each hop joined.
 *
 * The same flows and the same hops `flowsTouching` reports, in its order — the
 * join adds a key to a step and never changes which steps there are, so a
 * consumer of the blast radius reads exactly what it read before.
 */
export function flowsInside(scan: UseCaseScan, req: InsideRequest): JoinedUseCase[] {
  if (scan.kind !== "read") return [];
  const out: JoinedUseCase[] = [];
  for (const flow of flowsTouching(scan, new Set([req.service]), req.place)) {
    const view = scan.views.find((v) => v.id === flow.id);
    const parsed = new Map((view?.steps ?? []).map((step) => [step.ordinal, step]));
    const steps = flow.steps.map((step): JoinedStep => {
      const hop = parsed.get(step.ordinal);
      const inside = hop === undefined ? null : insideOf(hop, scan, req);
      return inside === null ? step : { ...step, inside };
    });
    out.push({ ...flow, steps });
  }
  return out;
}

/**
 * Every requirement id a hop of the scan could be joined through — what a
 * caller reads the service's flows for, and the byte gate it reads them behind.
 * Empty means no hop the service answers holds a key any requirement carries,
 * and then no flow can be inside anything: the read is not worth paying for.
 */
export function joinableIds(scan: UseCaseScan, service: string, requirements: ReadonlyMap<string, ReadonlySet<string>>): Set<string> {
  const ids = new Set<string>();
  if (scan.kind !== "read") return ids;
  for (const view of scan.views) {
    for (const step of view.steps) {
      const answer = hopAnswer(step, scan, service);
      if (answer?.state !== "keyed") continue;
      for (const key of answer.keys) for (const id of requirements.get(keyId(key)) ?? []) ids.add(id);
    }
  }
  return ids;
}

function insideOf(hop: ParsedStep, scan: Extract<UseCaseScan, { kind: "read" }>, req: InsideRequest): HopInside | null {
  const answer = hopAnswer(hop, scan, req.service);
  if (answer === null) return null;
  if (answer.state !== "keyed") return answer;
  if (req.flows === null) return { state: "unread", keys: answer.keys };
  const wanted = new Set(answer.keys.flatMap((key) => [...(req.requirements.get(keyId(key)) ?? [])]));
  const flows = req.flows
    .flatMap((flow): InnerFlow[] => {
      const via = [...flow.claims].filter((id) => wanted.has(id)).sort(compareIds);
      return via.length === 0 ? [] : [{ id: flow.id, file: flow.file, origin: flow.origin, via }];
    })
    .sort((a, b) => compareIds(a.file, b.file) || compareIds(a.id, b.id));
  return { state: "joined", keys: answer.keys, flows };
}
