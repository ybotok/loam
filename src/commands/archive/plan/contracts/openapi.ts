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
import { repoPath } from "../../../../core/envelope/json.js";
import { planWrite, readUtf8 } from "../../../../core/staging/writes.js";
import { featureSpecPaths } from "../../../../core/repo/paths.js";
import { locateServicePaths } from "../../../../core/repo/service-target.js";
import { readOpenapi } from "../../../../core/openapi/doc.js";
import { OpenapiMergeError } from "../../../../core/openapi/merge/error.js";
import { stripOpenapiRemovalMarkers } from "../../../../core/openapi/merge/markers.js";
import { mergeOpenapiPaths, type OpenapiMergeResult } from "../../../../core/openapi/merge/merge.js";
import { ArchiveFailure } from "../refusal.js";
import { type Gated, type Plan } from "../state.js";
import type { DocsDir } from "../../../../core/kernel/ids/dirs.js";
import type { FleetContext } from "../../../../core/fleet-context.js";

export async function planOpenapiContracts(
  config: { docsDir: DocsDir; fleet?: FleetContext },
  gated: Gated,
  plan: Plan,
  say: (line?: string) => void,
): Promise<void> {
  const { featureDir, deltaServices } = gated;
  const { writes, planWarns, planGates, openapiRemovals } = plan;
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
      throw new ArchiveFailure(
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
      writes.push(planWrite(livingOpenapi, content));
      say(`  openapi: ${svc} — created (${ops.join(", ")})`);
    } else {
      let merge: OpenapiMergeResult;
      try {
        merge = mergeOpenapiPaths(await readUtf8(livingOpenapi), featText, svc);
      } catch (err) {
        if (err instanceof OpenapiMergeError) throw new ArchiveFailure("merge-failed", err.message);
        throw err;
      }
      const {
        text, modified, pathItemModified, removed, quoted,
        pathItemQuoted, pathItemStale, componentsModified, componentsQuoted, componentsStale, unresolved,
      } = merge;
      if (text !== null) {
        writes.push(planWrite(livingOpenapi, text));
        say(`  openapi: ${svc} — merged (${ops.join(", ")})`);
      }
      if (removed.length > 0) {
        openapiRemovals.push({ service: svc, operations: removed });
        for (const label of removed) say(`      - removes ${label}`);
      }
      // Said out loud, because "the plan wrote less than my delta spells" is
      // the one thing a reader cannot infer from a merged file. Not a warning:
      // quoting the contract around your change is correct authoring, and
      // leaving the quote alone is the correct merge. The path-level and
      // component quotes get the same sentence for the same reason.
      for (const label of quoted) say(`      · quotes ${label} — unchanged since it was pinned, left as living has it`);
      for (const label of pathItemQuoted) {
        say(`      · quotes path-level ${label} — unchanged since it was pinned, left as living has it`);
      }
      for (const comp of componentsQuoted) {
        say(`      · quotes component ${comp} — unchanged since it was pinned, left as living has it`);
      }
      // Stale surfaces reaching the merge at all means --approve pushed past
      // the gate's openapi.baseline-stale — the plan still names what it cost.
      for (const label of pathItemStale) {
        say(`      ⚠ stale baseline on path-level ${label} — the living value moved since this delta was pinned; the overwrite is what --approve chose`);
      }
      for (const comp of componentsStale) {
        say(`      ⚠ stale baseline on component ${comp} — the living value moved since this delta was pinned; the overwrite is what --approve chose`);
      }
      for (const label of modified) {
        planWarns.push({
          severity: "warn",
          code: "openapi.op-modified",
          subject: svc,
          message: `${svc}: the delta redefines ${label}, which the living OpenAPI already has — the merge overwrites the living operation wholesale`,
        });
        say(`      ⚠ overwrites ${label} — the living definition differs`);
      }
      for (const label of pathItemModified) {
        planWarns.push({
          severity: "warn",
          code: "openapi.path-item-modified",
          subject: svc,
          message: `${svc}: the delta redefines the path-level key ${label}, which the living OpenAPI already has — the merge overwrites it wholesale, and it applies to EVERY operation on that path, including ones this feature never mentions`,
        });
        say(`      ⚠ overwrites path-level ${label} — the living definition differs`);
      }
      for (const comp of componentsModified) {
        planWarns.push({
          severity: "warn",
          code: "openapi.component-modified",
          subject: svc,
          message: `${svc}: the delta declares component '${comp}', which the living OpenAPI already defines differently — the merge overwrites the living component wholesale`,
        });
        say(`      ⚠ overwrites component ${comp} — the living definition differs`);
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
