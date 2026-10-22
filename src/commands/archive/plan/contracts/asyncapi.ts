/**
 * The AsyncAPI contract merge: the feature's asyncapi deltas folded into each
 * living event contract — the event axis's mirror of ./openapi.ts, slot-keyed
 * where that one is path-keyed.
 *
 * Nothing is written. Everything lands in the `Plan`, so a failure on any axis
 * leaves the living docs exactly as they were.
 */
import { existsSync } from "node:fs";
import { parse } from "yaml";
import { CodedFailure, repoPath } from "../../../../core/envelope/json.js";
import { planWrite, readUtf8 } from "../../../../core/staging/writes.js";
import { featureSpecPaths } from "../../../../core/repo/paths.js";
import { locateServicePaths } from "../../../../core/repo/service-target.js";
import { readAsyncapi } from "../../../../core/asyncapi/read.js";
import { asyncapiSlots, type AsyncapiSection } from "../../../../core/asyncapi/digest.js";
import { asyncapiSurfaces } from "../../../../core/asyncapi/baseline/surfaces.js";
import { AsyncapiMergeError } from "../../../../core/asyncapi/merge/error.js";
import { stripAsyncapiMarkers } from "../../../../core/asyncapi/merge/markers.js";
import { mergeAsyncapiSlots, type AsyncapiMergeResult } from "../../../../core/asyncapi/merge/merge.js";
import { type Gated, type Plan } from "../state.js";
import { consumerClause, type ContractConsumers } from "./consumers.js";
import { infoDrift, sayQuoted, sayStale, warnInfoDrift, warnOverwrite } from "./verdict-lines.js";
import type { FleetContext } from "../../../../core/fleet-context.js";
import type { IssueCode } from "../../../../core/vocabulary/issue.js";
import type { DocsDir } from "../../../../core/kernel/ids/dirs.js";

/** The per-section overwrite code — three codes, one per slot shape, mirroring the OpenAPI axis's. */
function modifiedCode(section: AsyncapiSection): IssueCode {
  if (section === "components.messages") return "asyncapi.message-modified";
  return section === "channels" ? "asyncapi.channel-modified" : "asyncapi.operation-modified";
}

export async function planAsyncapiContracts(
  config: { docsDir: DocsDir; fleet: FleetContext; consumers: ContractConsumers },
  gated: Gated,
  plan: Plan,
  say: (line?: string) => void,
): Promise<void> {
  const { featureDir, deltaServices } = gated;
  const { writes, planGates, asyncapiRemovals } = plan;
  for (const svc of deltaServices) {
    const featAsyncapi = featureSpecPaths(featureDir, svc).asyncapi;
    if (!existsSync(featAsyncapi)) continue;
    const featText = await readUtf8(featAsyncapi);
    const featDoc = await readAsyncapi(featAsyncapi);
    // Coherence grades `asyncapi.invalid` and gates on it; the merge stays
    // mechanical under --approve for the OpenAPI planner's reason: a document
    // loam cannot read is one it cannot merge, and that is the same answer as
    // any other merge it could not compute — nothing is written.
    if (featDoc.unreadable) {
      throw new CodedFailure(
        "merge-failed",
        `feature asyncapi ${repoPath(config.docsDir, featAsyncapi)} for ${svc} does not read as an AsyncAPI document (${featDoc.error ?? "not a YAML mapping"}) — the event axis cannot be merged; fix the file, or delete it if this feature has no contract delta`,
      );
    }
    const names = featDoc.messages.filter((m) => m.remove !== true).map((m) => m.name);
    // An `x-loam-remove` NESTED on an inline channel message retires nothing:
    // an inline message is channel-slot interior (SCHEMA.md's decision), so
    // the marker is just channel content — and when the restated channel is
    // otherwise identical to living, not even that: the merge deduplicates it
    // away and the marker lands in no bucket at all. The merge is safe either
    // way (the deep strip keeps the key out of living), but the author asked
    // for a removal that will not happen, and silence there is how a retired
    // message would stay on the wire — openapi.remove-marker-path-level's
    // lesson at the nested depth. Gated like the other plan-visible breaches,
    // --approve and all.
    for (const m of featDoc.messages) {
      if (m.remove !== true || !m.slot.startsWith("channels.")) continue;
      const channel = m.slot.slice("channels.".length, m.slot.lastIndexOf(".messages."));
      planGates.push({
        severity: "error",
        code: "asyncapi.remove-marker-inline",
        subject: svc,
        message: `${svc}: '${m.slot}' carries x-loam-remove nested on an inline channel message — inline messages are channel interior, not slots, so this retires nothing. Retire the whole channel (x-loam-remove: true at channels.${channel}), or declare the message under components.messages (the channel $ref-ing it) and put the marker there.`,
      });
    }
    // The shared context, for the OpenAPI planner's reason: once per delta
    // service must not mean one fleet walk per delta service.
    const livingAsyncapi = (await locateServicePaths(config.docsDir, svc, config.fleet)).asyncapi;
    try {
      if (!existsSync(livingAsyncapi)) {
        // A removal against a non-existent contract is gated by coherence;
        // under --approve the strip drops the markers, so the one thing left
        // to decide is whether a document remains. It must not when nothing
        // survives: an asyncapi.yaml's very PRESENCE is graded on this axis
        // (absence is `service.no-asyncapi`'s question, silence otherwise),
        // so a slotless or all-markers delta creating an empty living
        // contract would put a presence claim on a service that has none.
        // SLOTS only, deliberately, now that component surfaces merge: a
        // document holding schemas and no channel, operation or message
        // declares no event at all, and creating it would make exactly the
        // presence claim this branch exists to refuse.
        const surviving = asyncapiSlots(parse(featText)).filter((slot) => !slot.remove);
        if (surviving.length === 0) {
          say(`  asyncapi: ${svc} — nothing to merge (the delta declares no surviving slots), no living asyncapi.yaml created`);
          continue;
        }
        writes.push(planWrite(livingAsyncapi, stripAsyncapiMarkers(featText, svc)));
        say(`  asyncapi: ${svc} — created (${names.join(", ")})`);
        continue;
      }
      const livingText = await readUtf8(livingAsyncapi);
      const merge: AsyncapiMergeResult = mergeAsyncapiSlots(livingText, featText, svc);
      // What the delta declares OUTSIDE the three slot sections — the one
      // question the merge result cannot answer for the silence below, because
      // a merge that wrote nothing reports nothing to distinguish "the delta
      // was all quotes" from "the delta was all schemas and I dropped them".
      const surfaces = asyncapiSurfaces(parse(featText));
      if (merge.text !== null) {
        writes.push(planWrite(livingAsyncapi, merge.text));
        // The parenthesised list names the MESSAGES the delta declares, and a
        // delta whose whole change is a component surface has none — so this
        // printed `merged ()`, the same empty-parenthesis lie the create
        // branch above is commented for: it reads as "this merge wrote
        // nothing" about a merge that just published a shared schema to every
        // consumer of the fleet. Drop the parentheses when there is nothing to
        // put in them; the surface lines below name what actually moved.
        say(`  asyncapi: ${svc} — merged${names.length > 0 ? ` (${names.join(", ")})` : ""}`);
      } else if (surfaces.length > 0) {
        // "The plan wrote less than my delta spells" is the sentence a reader
        // cannot infer from an unchanged file — the quote line's own comment
        // (./verdict-lines.ts) names it for slots, and a components-only
        // delta is the shape where silence is indistinguishable from the
        // defect that made it merge nothing at all. Not a warning: every
        // surface being a quote is correct authoring and the correct merge.
        say(`  asyncapi: ${svc} — nothing to write: every one of the ${surfaces.length} component surface(s) this delta declares already stands as living has it`);
      }
      // Asked whatever the merge wrote: a delta whose ONLY change is its `info`
      // merges nothing at all, and that is exactly the shape that archived in
      // silence (./verdict-lines.ts).
      warnInfoDrift(plan, say, {
        svc, code: "asyncapi.info-not-merged", file: "asyncapi.yaml", carries: "channels, operations and components",
        labels: infoDrift(parse(livingText), parse(featText)),
      });
      if (merge.removed.length > 0) {
        asyncapiRemovals.push({ service: svc, slots: merge.removed.map((slot) => slot.label) });
        for (const slot of merge.removed) say(`      - removes ${slot.label}`);
      }
      // The quote and stale lines (./verdict-lines.ts says why each is said),
      // the component surfaces' lines mirroring the slots' around them.
      sayQuoted(say, merge.quoted.map((slot) => slot.label));
      sayQuoted(say, merge.componentsQuoted.map((id) => `components.${id}`));
      sayStale(say, merge.baselineStale.map((slot) => slot.label));
      sayStale(say, merge.componentsStale.map((id) => `components.${id}`));
      for (const id of merge.componentsModified) {
        warnOverwrite(plan, say, {
          svc, code: "asyncapi.component-modified", label: `components.${id}`,
          message: `${svc}: the delta declares components.${id}, which the living AsyncAPI already has with different content — the merge overwrites the living component wholesale`,
        });
      }
      for (const slot of merge.modified) {
        // A message is the one slot a consumer names (`Consumes:` lines,
        // `consumes` edges), so only `asyncapi.message-modified` says who the
        // overwrite lands on — the OpenAPI planner's sentence, through the
        // same scan (./consumers.ts). Channels and operations join by nothing.
        const name = merge.modifiedMessageNames.get(slot.label);
        const named = name === undefined ? null : consumerClause(await config.consumers.message(svc, name));
        warnOverwrite(plan, say, {
          svc, code: modifiedCode(slot.section), label: slot.label, named,
          message: `${svc}: the delta redefines ${slot.label}, which the living AsyncAPI already has — the merge overwrites the living slot wholesale`,
        });
      }
      for (const ref of merge.unresolved) {
        planGates.push({
          severity: "error",
          code: "asyncapi.ref-unresolved",
          subject: svc,
          message: `${svc}: $ref '${ref}' resolves in neither the feature's asyncapi.yaml nor the living one — the merged document would carry a dangling reference`,
        });
      }
    } catch (err) {
      if (err instanceof AsyncapiMergeError) throw new CodedFailure("merge-failed", err.message);
      throw err;
    }
  }
}
