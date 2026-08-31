/**
 * `$ref` as a pair of plain questions — which ones does this tree contain, and
 * what does one point at — and the component closure the merge answers them
 * for.
 *
 * The closure is verdict-driven, not reachability-driven: every component the
 * feature DECLARES is classified against its `x-loam-baselines` entry exactly
 * as an operation is classified against its pin, and reachability decides only
 * one thing — whether a genuinely NEW component rides along — whenever the
 * delta merges paths at all. The old rule, "copy everything reachable from any
 * feature path item", let a QUOTED operation drag its authoring-time component
 * copy over someone else's landed change; the walk now starts from what this
 * merge actually WROTE, so a quote pulls nothing.
 *
 * Where the delta merges no path, that walk starts from nothing, and "is a new
 * component reachable?" has no meaningful answer to give: a components-only
 * delta declared every one of them on purpose and there is no operation for
 * them to hide behind. Parking them forever is what made such a delta merge
 * nothing at all, at exit 0 — `componentsAreTheDelta` is that case, and only
 * that case.
 */
import { isDeepStrictEqual } from "node:util";
import { isMap, isScalar, type Document } from "yaml";
import { classifyBaselineDigests, valueDigest, withoutFeatureKeysDeep } from "../digest.js";
import { entryFor, restatedSurfaces, surfaceIn, type BaselineRecord } from "../baseline/record.js";

export function collectRefs(node: unknown): string[] {
  const out: string[] = [];
  const walk = (current: unknown): void => {
    if (Array.isArray(current)) {
      for (const value of current) walk(value);
      return;
    }
    if (current !== null && typeof current === "object") {
      for (const [key, value] of Object.entries(current)) {
        if (key === "$ref" && typeof value === "string") out.push(value);
        else walk(value);
      }
    }
  };
  walk(node);
  return out;
}

/** Resolve a local JSON pointer (`#/a/b~1c`) against a plain JS tree. */
export function resolvePointer(root: unknown, ref: string): { found: boolean; value: unknown } {
  let current: unknown = root;
  for (const raw of ref.slice(2).split("/")) {
    const segment = raw.replace(/~1/g, "/").replace(/~0/g, "~");
    if (Array.isArray(current)) {
      const index = Number(segment);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) {
        return { found: false, value: undefined };
      }
      current = current[index];
    } else if (current !== null && typeof current === "object" && segment in (current as Record<string, unknown>)) {
      current = (current as Record<string, unknown>)[segment];
    } else {
      return { found: false, value: undefined };
    }
  }
  return { found: true, value: current };
}

/** Everything the closure needs; one object because the merge is its only caller. */
export interface ComponentClosureInput {
  /** The living document the copies are written into. */
  living: Document;
  featPlain: unknown;
  livingPlain: unknown;
  /** The feature's `x-loam-baselines` record, read once by the merge. */
  record: BaselineRecord;
  /** The plain values the path merge actually wrote, labelled for the ref sweep. */
  written: Array<{ from: string; value: unknown }>;
  /**
   * True only when the feature's `paths` holds no entry at all, so `written` is
   * empty and nothing this merge wrote can reach a new component. The merge
   * computes it from the path ENTRIES, not from what the path loop happened to
   * write: one path entry, even an entirely quoted one, means the reachability
   * question is real and this stays false. Widening it past that would copy the
   * authoring-time component a quoted operation carries — the exact revert the
   * verdict-driven closure exists to stop.
   */
  componentsAreTheDelta: boolean;
}

/** What the closure computed: components overwritten, added, quoted, stale, and refs nothing resolves. */
export interface ComponentClosureOutcome {
  componentsModified: string[];
  /** `<kind>/<name>` of components written where the living contract had none. */
  componentsAdded: string[];
  componentsQuoted: string[];
  componentsStale: string[];
  unresolved: Array<{ ref: string; from: string }>;
}

/**
 * Merge the feature's components into the living document by verdict:
 *
 *  - quote → skipped; the living copy stays, whatever landed on it since.
 *  - edit, stale (under --approve), or unpinned-and-differing → copied; the
 *    unpinned copy is the old upsert, kept for never-rebased deltas.
 *  - unpinned and living-equal → skipped, as it always was: nothing to write.
 *  - unfounded (pinned, living gone — the gate refused; --approve) → copied,
 *    because a written operation may reference it and the merge must never
 *    leave a dangling ref behind.
 *  - NEW (unpinned, living-absent) → copied only when reachable from written
 *    content or from another copied component's own refs. The visited-set
 *    fixpoint is what keeps A↔B cycles terminating and unrelated namespaces
 *    uncopied. When the components ARE the delta there is no written content
 *    to be reachable from, so every one of them is copied outright.
 *
 * The unresolved sweep is unchanged in meaning: every local ref reachable from
 * written content and copied components must resolve in the copy set or the
 * living document.
 */
/**
 * Write one component's value, matching the existing key AS A STRING: a
 * living `404:` response is the YAML number 404, and a plain `setIn` with the
 * string "404" misses it and APPENDS a second pair — the contract then
 * declares the component twice, forever, with the pre-merge copy first in
 * reading order. Exported for the strip's twin write on the feature side.
 */
export function setComponentValue(doc: Document, kind: string, name: string, value: unknown): void {
  const kindNode = doc.getIn(["components", kind]);
  const existing = isMap(kindNode)
    ? kindNode.items.find((it) => isScalar(it.key) && String(it.key.value) === name)
    : undefined;
  if (existing !== undefined) existing.value = doc.createNode(value);
  else doc.setIn(["components", kind, name], value);
}

export function mergeComponentClosure(input: ComponentClosureInput): ComponentClosureOutcome {
  const { living, featPlain, livingPlain, record, written, componentsAreTheDelta } = input;
  const componentsModified: string[] = [];
  const componentsAdded: string[] = [];
  const componentsQuoted: string[] = [];
  const componentsStale: string[] = [];
  const unresolved: ComponentClosureOutcome["unresolved"] = [];
  const copies: Array<{ kind: string; name: string; value: unknown }> = [];
  const copied = new Set<string>();
  /** Genuinely new components, parked until something written reaches them. */
  const parked = new Map<string, { kind: string; name: string; value: unknown }>();
  /**
   * Which declared surfaces the living contract does not have — recorded here,
   * during classification, because this is the one place that asks. What was
   * ADDED is decided at the write below instead: a parked component the
   * fixpoint never reaches is absent from living and stays that way, and
   * calling it added would name a component the merge did not write.
   */
  const absentFromLiving = new Set<string>();

  // ONE enumeration (baseline/record.ts) with the rebase plan and the gate —
  // and ONE living lookup — so "which components does this delta declare, and
  // do they exist" cannot drift between the command that pins, the gate that
  // grades and this closure that writes.
  for (const surface of restatedSurfaces(featPlain)) {
    if (surface.kind !== "component") continue;
    const cut = surface.id.indexOf("/");
    const entry = { kind: surface.id.slice(0, cut), name: surface.id.slice(cut + 1), value: surface.value };
    const inLiving = surfaceIn(livingPlain, surface);
    if (!inLiving.found) absentFromLiving.add(surface.id);
    const verdict = classifyBaselineDigests(
      entryFor(record, surface),
      valueDigest(surface.value),
      inLiving.found ? valueDigest(inLiving.value) : undefined,
    );
    if (verdict === "quote") {
      componentsQuoted.push(surface.id);
      continue;
    }
    if (verdict === "unpinned") {
      if (!inLiving.found) {
        parked.set(surface.id, entry);
        continue;
      }
      if (isDeepStrictEqual(inLiving.value, surface.value)) continue;
      componentsModified.push(surface.id);
    } else {
      if (verdict === "stale") componentsStale.push(surface.id);
      if (inLiving.found && !isDeepStrictEqual(inLiving.value, surface.value)) componentsModified.push(surface.id);
    }
    copies.push(entry);
    copied.add(surface.id);
  }

  // A components-only delta wrote no path, so the fixpoint below would start
  // from an empty queue and every parked component would stay parked forever —
  // the merge published a document byte-identical to the living one and archive
  // said `ok`. The promotion happens HERE, before the queue is built, and that
  // order is the whole point: a component promoted afterwards would carry its
  // own `$ref`s past the sweep, and `openapi.ref-unresolved` would stop firing
  // for exactly the deltas that most need it — a new schema pointing at a
  // second one the author forgot to bring. Iterated as a SNAPSHOT: this loop
  // empties `parked` as it goes and `visitRef` deletes from the same Map below,
  // and neither may read it live while writing it.
  if (componentsAreTheDelta) {
    const promotions = [...parked.entries()];
    for (const [id, entry] of promotions) {
      parked.delete(id);
      copies.push(entry);
      copied.add(id);
    }
  }

  // The reachability fixpoint: refs out of written content and out of every
  // copy — classification copies and any promotions now, parked promotions as
  // they join.
  const queue: Array<{ node: unknown; from: string }> = [
    ...written.map((w) => ({ node: w.value, from: w.from })),
    ...copies.map((c) => ({ node: c.value, from: `components/${c.kind}/${c.name}` })),
  ];
  const visited = new Set<string>();
  const visitRef = (ref: string, from: string): void => {
    if (!ref.startsWith("#/")) return;
    const match = /^#\/components\/([^/]+)\/([^/]+)(?:\/|$)/.exec(ref);
    if (!match) {
      if (!resolvePointer(featPlain, ref).found && !resolvePointer(livingPlain, ref).found) {
        unresolved.push({ ref, from });
      }
      return;
    }
    const key = `${match[1]!}/${match[2]!}`;
    if (visited.has(key)) return;
    visited.add(key);
    // Already copied by verdict: its own refs are in the queue from the start.
    if (copied.has(key)) return;
    const parkedEntry = parked.get(key);
    if (parkedEntry !== undefined) {
      parked.delete(key);
      copies.push(parkedEntry);
      copied.add(key);
      queue.push({ node: parkedEntry.value, from: `components/${key}` });
      return;
    }
    // Not copied and not new: a quoted or unchanged declaration, or something
    // the feature never spells. Either way the LIVING document must have it.
    if (!resolvePointer(livingPlain, `#/components/${key}`).found) {
      unresolved.push({ ref, from });
    }
  };
  while (queue.length > 0) {
    const { node, from } = queue.pop()!;
    for (const ref of collectRefs(node)) visitRef(ref, from);
  }

  for (const { kind, name, value } of copies) {
    // Decided at the write, over the copies that actually happened: a promoted
    // component is an addition, a parked one that nothing reached is not.
    if (absentFromLiving.has(`${kind}/${name}`)) componentsAdded.push(`${kind}/${name}`);
    // The value is deep-stripped of loam's bookkeeping keys — a component
    // holding an operation shape nests them where the path-level strip never
    // walks, and `--approve` once published `x-loam-remove: true` into a
    // living component. Promoted copies go through this same write, so a
    // components-only delta cannot be the one shape that publishes a marker.
    setComponentValue(living, kind, name, withoutFeatureKeysDeep(value));
  }

  return { componentsModified, componentsAdded, componentsQuoted, componentsStale, unresolved };
}
