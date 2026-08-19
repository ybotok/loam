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
import { repoPath } from "../../../../core/envelope/json.js";
import { planWrite, readUtf8 } from "../../../../core/staging/writes.js";
import { featureSpecPaths, servicePaths } from "../../../../core/repo/paths.js";
import { readAsyncapi } from "../../../../core/asyncapi/read.js";
import { asyncapiSlots, type AsyncapiSection } from "../../../../core/asyncapi/digest.js";
import { AsyncapiMergeError } from "../../../../core/asyncapi/merge/error.js";
import { stripAsyncapiMarkers } from "../../../../core/asyncapi/merge/markers.js";
import { mergeAsyncapiSlots, type AsyncapiMergeResult } from "../../../../core/asyncapi/merge/merge.js";
import { ArchiveFailure } from "../refusal.js";
import { type Gated, type Plan } from "../state.js";
import type { IssueCode } from "../../../../core/vocabulary/issue.js";
import type { DocsDir } from "../../../../core/kernel/ids/dirs.js";

/** The per-section overwrite code — three codes, one per slot shape, mirroring the OpenAPI axis's. */
function modifiedCode(section: AsyncapiSection): IssueCode {
  if (section === "components.messages") return "asyncapi.message-modified";
  return section === "channels" ? "asyncapi.channel-modified" : "asyncapi.operation-modified";
}

export async function planAsyncapiContracts(
  config: { docsDir: DocsDir },
  gated: Gated,
  plan: Plan,
  say: (line?: string) => void,
): Promise<void> {
  const { featureDir, deltaServices } = gated;
  const { writes, planWarns, planGates, asyncapiRemovals } = plan;
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
      throw new ArchiveFailure(
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
    const livingAsyncapi = servicePaths(config.docsDir, svc).asyncapi;
    try {
      if (!existsSync(livingAsyncapi)) {
        // A removal against a non-existent contract is gated by coherence;
        // under --approve the strip drops the markers, so the one thing left
        // to decide is whether a document remains. It must not when nothing
        // survives: an asyncapi.yaml's very PRESENCE is graded on this axis
        // (absence is `service.no-asyncapi`'s question, silence otherwise),
        // so a slotless or all-markers delta creating an empty living
        // contract would put a presence claim on a service that has none.
        const surviving = asyncapiSlots(parse(featText)).filter((slot) => !slot.remove);
        if (surviving.length === 0) {
          say(`  asyncapi: ${svc} — nothing to merge (the delta declares no surviving slots), no living asyncapi.yaml created`);
          continue;
        }
        writes.push(planWrite(livingAsyncapi, stripAsyncapiMarkers(featText, svc)));
        say(`  asyncapi: ${svc} — created (${names.join(", ")})`);
        continue;
      }
      const merge: AsyncapiMergeResult = mergeAsyncapiSlots(await readUtf8(livingAsyncapi), featText, svc);
      if (merge.text !== null) {
        writes.push(planWrite(livingAsyncapi, merge.text));
        say(`  asyncapi: ${svc} — merged (${names.join(", ")})`);
      }
      if (merge.removed.length > 0) {
        asyncapiRemovals.push({ service: svc, slots: merge.removed.map((slot) => slot.label) });
        for (const slot of merge.removed) say(`      - removes ${slot.label}`);
      }
      // Said out loud, because "the plan wrote less than my delta spells" is
      // the one thing a reader cannot infer from a merged file. Not a warning:
      // quoting the contract around your change is correct authoring, and
      // leaving the quote alone is the correct merge.
      for (const slot of merge.quoted) {
        say(`      · quotes ${slot.label} — unchanged since it was pinned, left as living has it`);
      }
      // Stale surfaces reaching the merge at all means --approve pushed past
      // the gate's asyncapi.baseline-stale — the plan still names what it cost.
      for (const slot of merge.baselineStale) {
        say(`      ⚠ stale baseline on ${slot.label} — the living value moved since this delta was pinned; the overwrite is what --approve chose`);
      }
      for (const slot of merge.modified) {
        planWarns.push({
          severity: "warn",
          code: modifiedCode(slot.section),
          subject: svc,
          message: `${svc}: the delta redefines ${slot.label}, which the living AsyncAPI already has — the merge overwrites the living slot wholesale`,
        });
        say(`      ⚠ overwrites ${slot.label} — the living definition differs`);
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
      if (err instanceof AsyncapiMergeError) throw new ArchiveFailure("merge-failed", err.message);
      throw err;
    }
  }
}
