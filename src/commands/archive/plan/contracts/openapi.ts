/**
 * The OpenAPI contract merge: the feature's openapi deltas folded into each
 * living service API — the half of the archive plan that answers to the
 * contract axis, split out of ../specs.ts so the requirements merge and the
 * contract merges stop sharing one file.
 *
 * Nothing is written. Everything lands in the `Plan`, so a failure on any axis
 * leaves the living docs exactly as they were.
 */
import { existsSync } from "node:fs";
import { parse } from "yaml";
import { CodedFailure, repoPath } from "../../../../core/envelope/json.js";
import { isRecord } from "../../../../core/kernel/records.js";
import { planWrite, readUtf8 } from "../../../../core/staging/writes.js";
import { featureSpecPaths } from "../../../../core/repo/paths.js";
import { locateServicePaths } from "../../../../core/repo/service-target.js";
import { readOpenapi } from "../../../../core/openapi/doc.js";
import { OpenapiMergeError } from "../../../../core/openapi/merge/error.js";
import { stripOpenapiRemovalMarkers } from "../../../../core/openapi/merge/markers.js";
import { mergeOpenapiPaths, type OpenapiMergeResult } from "../../../../core/openapi/merge/merge.js";
import { type Gated, type Plan } from "../state.js";
import { consumerClause, type ContractConsumers } from "./consumers.js";
import { sayQuoted, sayStale, warnOverwrite } from "./verdict-lines.js";
import type { DocsDir } from "../../../../core/kernel/ids/dirs.js";
import type { FleetContext } from "../../../../core/fleet-context.js";

export async function planOpenapiContracts(
  config: { docsDir: DocsDir; fleet: FleetContext; consumers: ContractConsumers },
  gated: Gated,
  plan: Plan,
  say: (line?: string) => void,
): Promise<void> {
  const { featureDir, deltaServices } = gated;
  const { writes, planGates, openapiRemovals } = plan;
  // OpenAPI merge — fold the feature's openapi deltas into the living service APIs.
  for (const svc of deltaServices) {
    const featOpenapi = featureSpecPaths(featureDir, svc).openapi;
    if (!existsSync(featOpenapi)) continue;
    const featText = await readUtf8(featOpenapi);
    // The shared context: this planner runs once per delta service, and a
    // context-less locate is a full fleet walk per service.
    const livingOpenapi = (await locateServicePaths(config.docsDir, svc, config.fleet)).openapi;
    const featDoc = await readOpenapi(featOpenapi);
    // Every other reader of this flag suspends its own judgement when it is set
    // — validate grades `openapi.invalid`, show and status print that the file
    // does not parse. Archive was the only one that never looked, and it is the
    // command that WRITES: a feature openapi.yaml holding a sequence instead of
    // a mapping was planned verbatim into services/<svc>/openapi.yaml, `ok:
    // true`, printing `created ()` because the reader saw no operations in it.
    // A document loam cannot read is one it cannot merge, and that is the same
    // answer as any other merge it could not compute: nothing is written.
    if (featDoc.unreadable) {
      throw new CodedFailure(
        "merge-failed",
        `feature openapi ${repoPath(config.docsDir, featOpenapi)} for ${svc} does not read as an OpenAPI document (${featDoc.error ?? "not a YAML mapping"}) — the API axis cannot be merged; fix the file, or delete it if this feature has no contract delta`,
      );
    }
    const ops = featDoc.ops.filter((op) => !op.remove).map((op) => op.id);
    // An `x-loam-remove: true` written at PATH level retires nothing: the marker
    // addresses one operation, and beside the methods there is no operation for
    // it to address. The merge now strips it on every branch, so the living
    // contract is safe either way — but the author asked for a removal that will
    // not happen, and silence there is how a retired endpoint stayed live.
    // Gated like the other plan-visible breaches, --approve and all.
    for (const path of featDoc.pathLevelRemovals) {
      planGates.push({
        severity: "error",
        code: "openapi.remove-marker-path-level",
        subject: svc,
        message: `${svc}: '${path}' carries x-loam-remove at PATH level, beside the methods — a removal marker names ONE operation, so this retires nothing and is not a contract key either. Move it inside the operation you are retiring (with its operationId), or delete it.`,
      });
    }
    if (!existsSync(livingOpenapi)) {
      // A removal against a non-existent contract is gated by coherence. Keep
      // the feature-only marker out of living docs even under --approve — and
      // ask the DOCUMENT, not the operation reader: a marker with no
      // operationId is invisible to `operations()`, so gating the strip on
      // "does the reader see a removal" let exactly that marker through into a
      // living contract, published to every consumer of the fleet.
      const content = stripOpenapiRemovalMarkers(featText, svc);
      // A contract that describes nothing is not created, on the spec axis's
      // rule for a delta that leaves no requirements (../specs.ts). A
      // `paths: {}` stub is what an author wrote to quiet a status that used to
      // demand a contract from every new service, and copying it in published
      // "this service exposes nothing" as a living contract the fleet then
      // joins against — announced as `created ()`. With no file, the service
      // reads as one with no HTTP surface, which `service.no-openapi` already
      // grades: silent while nothing calls it, an error once something does.
      if (describesNothing(content)) {
        say(`  openapi: ${svc} — nothing to merge (delta defines no paths or components), no living openapi.yaml created`);
        continue;
      }
      writes.push(planWrite(livingOpenapi, content));
      say(`  openapi: ${svc} — created (${ops.join(", ")})`);
    } else {
      let merge: OpenapiMergeResult;
      try {
        merge = mergeOpenapiPaths(await readUtf8(livingOpenapi), featText, svc);
      } catch (err) {
        if (err instanceof OpenapiMergeError) throw new CodedFailure("merge-failed", err.message);
        throw err;
      }
      const {
        text, modified, modifiedOperationIds, pathItemModified, removed, quoted, pathItemQuoted, pathItemStale,
        componentsModified, componentsAdded, componentsQuoted, componentsStale, unresolved,
      } = merge;
      if (text !== null) {
        writes.push(planWrite(livingOpenapi, text));
        // The parenthesised list names the OPERATIONS the delta merged, and a
        // delta whose whole change is a component has none — so this printed
        // `merged ()`, the same empty-parenthesis lie the create branch above
        // is commented for: it reads as "this merge wrote nothing" about a
        // merge that just published a shared schema to every consumer of the
        // fleet. Name the components it added instead, and drop the
        // parentheses entirely when there is nothing to put in them — a delta
        // that only EDITED existing surfaces is named by the lines below.
        const mergedNames = ops.length > 0 ? ops : componentsAdded.map((comp) => `component ${comp}`);
        say(`  openapi: ${svc} — merged${mergedNames.length > 0 ? ` (${mergedNames.join(", ")})` : ""}`);
      }
      if (removed.length > 0) {
        openapiRemovals.push({ service: svc, operations: removed });
        for (const label of removed) say(`      - removes ${label}`);
      }
      // The quote and stale lines (./verdict-lines.ts says why each is said).
      sayQuoted(say, quoted);
      sayQuoted(say, pathItemQuoted.map((label) => `path-level ${label}`));
      sayQuoted(say, componentsQuoted.map((comp) => `component ${comp}`));
      sayStale(say, pathItemStale.map((label) => `path-level ${label}`));
      sayStale(say, componentsStale.map((comp) => `component ${comp}`));
      for (const label of modified) {
        // Who the overwrite lands on: the living fleet's consumers of the
        // operation, through `loam diff`'s own scan (./consumers.ts). An
        // operation with no operationId on either side has nothing anyone can
        // name it by, so the warning stays the sentence it always was.
        const id = modifiedOperationIds.get(label);
        const named = id === undefined ? null : consumerClause(await config.consumers.op(svc, id));
        warnOverwrite(plan, say, {
          svc, code: "openapi.op-modified", label, named,
          message: `${svc}: the delta redefines ${label}, which the living OpenAPI already has — the merge overwrites the living operation wholesale`,
        });
      }
      for (const label of pathItemModified) {
        warnOverwrite(plan, say, {
          svc, code: "openapi.path-item-modified", label: `path-level ${label}`,
          message: `${svc}: the delta redefines the path-level key ${label}, which the living OpenAPI already has — the merge overwrites it wholesale, and it applies to EVERY operation on that path, including ones this feature never mentions`,
        });
      }
      for (const comp of componentsModified) {
        warnOverwrite(plan, say, {
          svc, code: "openapi.component-modified", label: `component ${comp}`,
          message: `${svc}: the delta declares component '${comp}', which the living OpenAPI already defines differently — the merge overwrites the living component wholesale`,
        });
      }
      for (const u of unresolved) {
        planGates.push({
          severity: "error",
          code: "openapi.ref-unresolved",
          subject: svc,
          message: `${svc}: $ref '${u.ref}' (referenced from ${u.from}) resolves in neither the feature's openapi.yaml nor the living one — the merged document would carry a dangling reference`,
        });
      }
    }
  }
}

/**
 * Does this contract describe no surface at all — no path, no webhook, and no
 * component in any section? Only the document's frame is left (`openapi`,
 * `info`, `servers`, `tags`), which is a title and nothing anyone can call.
 *
 * Conservative in one direction: anything that is not an empty mapping where a
 * mapping belongs counts as content, so a document this cannot classify is
 * created exactly as before. The reader above has already refused one that
 * does not parse.
 */
function describesNothing(text: string): boolean {
  let doc: unknown;
  try {
    doc = parse(text);
  } catch {
    // Not a document this can classify, so it is content: created as before.
    return false;
  }
  if (doc === null || doc === undefined) return true;
  if (!isRecord(doc)) return false;
  const components = doc["components"];
  const sections = components === undefined || components === null ? [] : isRecord(components) ? Object.values(components) : [components];
  return [doc["paths"], doc["webhooks"], ...sections].every(isEmptyMapping);
}

function isEmptyMapping(value: unknown): boolean {
  return value === undefined || value === null || (isRecord(value) && Object.keys(value).length === 0);
}
