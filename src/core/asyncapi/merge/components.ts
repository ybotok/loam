/**
 * The SURFACE half of the event merge: every `components/<kind>/<name>` the
 * feature declares outside `messages`, folded into the living contract by the
 * same verdict the slot loop takes.
 *
 * Verdict-driven and nothing else. A surface is classified against its
 * `x-loam-baselines` entry exactly as a slot is classified against its
 * in-value pin, so a QUOTE is skipped whatever landed on the living value
 * since, and an EDIT is written. There is deliberately no reachability
 * machinery here — the OpenAPI closure parks a genuinely new component until
 * something written reaches it, because on that axis a quoted OPERATION can
 * drag its authoring-time component copy along. This axis has no such carrier:
 * a surface is only ever copied because the delta declares it, and the ref
 * discipline is the post-hoc `danglingRefs` diff the merge runs over the whole
 * merged tree (../depth.ts) rather than the closure's queued `{ref, from}`.
 * Borrowing the parked set would mean a schema the author wrote on purpose
 * silently not merging, which is the defect this module closes.
 */
import { isDeepStrictEqual } from "node:util";
import type { Document } from "yaml";
import { entryFor, surfaceIn, type BaselineRecord } from "../../openapi/baseline/record.js";
import { classifyBaselineDigests, valueDigest, withoutFeatureKeysDeep } from "../../openapi/digest.js";
// The OpenAPI axis's component writer, imported rather than respelled: it is
// path-agnostic and string-key-matched, so a numeric component name (`404:` is
// the YAML number) is REPLACED rather than appended a second time — the same
// hazard every slot writer on this axis goes through `slotPair` for.
import { setComponentValue } from "../../openapi/merge/components.js";
import { asyncapiSurfaces } from "../baseline/surfaces.js";
import { writableSection } from "./markers.js";

/** Everything the surface merge needs; one object because the merge is its only caller. */
export interface AsyncapiComponentsInput {
  /** The living document the copies are written into. */
  living: Document;
  featPlain: unknown;
  livingPlain: unknown;
  /** The feature's `x-loam-baselines` record, read once by the merge. */
  record: BaselineRecord;
  service: string;
}

/** What the surface merge computed. */
export interface AsyncapiComponentsOutcome {
  /** `<kind>/<name>` of living surfaces overwritten with different content. */
  componentsModified: string[];
  /** Surfaces the delta QUOTED — not copied, living's copy kept. */
  componentsQuoted: string[];
  /** Surfaces written on a stale record entry — under `--approve`, like the slots. */
  componentsStale: string[];
  /**
   * Whether anything was actually written. The merge turns this into `edited`:
   * without it the surface verdicts would be computed, reported, and then
   * dropped on the floor by the `!edited` early return that keeps an all-quote
   * delta byte-identical — the defect surviving in a new shape, with the plan
   * naming components it never wrote.
   */
  copied: boolean;
}

/**
 * Merge the feature's component surfaces into the living document by verdict:
 *
 *  - quote → skipped; the living copy stays, whatever landed on it since.
 *  - edit, or stale (under `--approve`) → copied, and reported.
 *  - unpinned and living-equal → skipped: there is nothing to write, and a
 *    never-rebased delta that merely restates the contract must not churn its
 *    bytes (the slot loop's rule, at surface depth).
 *  - unpinned and differing → copied, the old upsert kept for never-rebased
 *    deltas, and reported as a modification like any other overwrite.
 *  - unfounded (pinned, living gone — the gate refused; `--approve`) and NEW
 *    (unpinned, living-absent) → copied. Both write a surface the living
 *    contract does not have, which is the ordinary shape of a delta that adds
 *    a schema.
 *
 * Every write goes through the deep strip first: a component's value can nest
 * loam's keys anywhere (a schema `properties` entry, a `$ref` sibling), and
 * publishing one into a living contract is the failure `--approve` already
 * caused once on the OpenAPI axis.
 */
export function mergeAsyncapiComponents(input: AsyncapiComponentsInput): AsyncapiComponentsOutcome {
  const { living, featPlain, livingPlain, record, service } = input;
  const componentsModified: string[] = [];
  const componentsQuoted: string[] = [];
  const componentsStale: string[] = [];
  const copies: Array<{ kind: string; name: string; value: unknown }> = [];

  // ONE enumeration (../baseline/surfaces.ts) with the rebase plan and the
  // gate, and ONE living lookup (surfaceIn), so "which surfaces does this
  // delta declare, and does living have this one" cannot have two answers.
  for (const surface of asyncapiSurfaces(featPlain)) {
    // The first `/` is the kind boundary, exactly as `surfaceIn` reads it back
    // — a component name cannot legally contain one.
    const cut = surface.id.indexOf("/");
    const inLiving = surfaceIn(livingPlain, surface);
    const verdict = classifyBaselineDigests(
      entryFor(record, surface),
      valueDigest(surface.value),
      inLiving.found ? valueDigest(inLiving.value) : undefined,
    );
    // A QUOTE is not a merge input, on this axis for the slot loop's reason:
    // the author wrote the surface down because an AsyncAPI delta is a
    // COMPLETE document, not because they changed it. Mechanical, not a
    // judgement — `--approve` does not turn it back on.
    if (verdict === "quote") {
      componentsQuoted.push(surface.id);
      continue;
    }
    if (verdict === "stale") componentsStale.push(surface.id);
    const publish = withoutFeatureKeysDeep(surface.value);
    if (inLiving.found && isDeepStrictEqual(inLiving.value, publish)) continue;
    if (inLiving.found) componentsModified.push(surface.id);
    copies.push({ kind: surface.id.slice(0, cut), name: surface.id.slice(cut + 1), value: publish });
  }

  for (const { kind, name, value } of copies) {
    // Guarded at the write, like every slot write: a living `components:
    // *alias` (or an aliased `components.schemas`) is one shared value behind
    // every use of the anchor, so writing a surface through it would rewrite
    // every other node that aliases it.
    writableSection(living, livingPlain, ["components", kind], service);
    setComponentValue(living, kind, name, value);
  }

  return { componentsModified, componentsQuoted, componentsStale, copied: copies.length > 0 };
}
