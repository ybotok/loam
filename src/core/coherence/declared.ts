/**
 * What a feature's own delta DECLARES, per service, indexed once.
 *
 * Seven indexes over the same four files (the delta spec.md, arch.spec.md,
 * openapi.yaml, and the living contract they are graded against), built in one
 * walk because every check downstream joins on the service id and would
 * otherwise re-read the delta per question. The distinctions here are the ones
 * the checks cannot make for themselves: an operation a REMOVED requirement
 * governs is being retired, so it neither claims the contract nor governs
 * anything after the merge; a removal marker that names an id also defined
 * elsewhere in the delta is a RELOCATION, not a retirement; and a marker with
 * no `operationId` at all is a shape only this walk can see. The capability
 * gate rides the same loop: both delta spec documents are graded against the
 * fleet vocabulary here, because coherence.ts and this package's file count
 * are both at their limits and the walk already holds the parsed documents.
 */
import { existsSync } from "node:fs";
import { NotUtf8DocumentError } from "../kernel/document-bytes.js";
import { readFile } from "node:fs/promises";
import { type PathableService } from "../kernel/ids/service.js";
import type { Issue } from "../vocabulary/issue.js";
import { featureSpecPaths } from "../repo/paths.js";
import { locateServicePaths } from "../repo/service-target.js";
import { parseRequirements } from "../document/parse.js";
import { readCapabilityVocabulary } from "../capabilities/capabilities.js";
import { capabilityRequirementIndex } from "../capabilities/findings.js";
import { withFeatureCapabilities, withFeatureRequirements } from "../capabilities/delta/overlay.js";
import { featureCapabilityDeltas } from "../capabilities/delta/tree.js";
import { realizesUnknownIssues } from "../capabilities/realizes/findings.js";
import type { CapabilityRequirementIndex } from "../capabilities/realizes/join.js";
import { capabilityUnknownIssues } from "../capabilities/findings.js";
import type { Requirement } from "../document/spec.js";
import { openapiBaselineIssues } from "../openapi/baseline/gate.js";
import { readOpenapi } from "../openapi/doc.js";
import type { FleetContext } from "../fleet-context.js";
import type { DocsDir, FeatureDir } from "../kernel/ids/dirs.js";

/** Everything one feature's delta says about its own services. */
export interface Declared {
  /** Per service: the operations its non-REMOVED requirements govern. */
  reqOps: Map<PathableService, string[]>;
  /** Per service: the operations its REMOVED requirements governed. */
  removedReqOps: Map<string, Set<string>>;
  /** Per service: operations this feature genuinely retires (markers minus relocations). */
  removingOps: Map<string, Set<string>>;
  /** Per service: every id a removal marker names, relocations included. */
  allMarkerIds: Map<string, Set<string>>;
  /** Per service: does the feature contract carry a marker with no operationId? */
  anonymousMarkers: Map<string, boolean>;
  /** The operationIds genuinely NEW to their service across the whole feature. */
  featureApiOps: Set<string>;
  /**
   * Services whose FEATURE openapi.yaml exists but does not parse. Every check
   * that joins on the feature contract must suspend itself for these — an
   * unreadable document yields the same empty op set as an absent one, and
   * grading against that emptiness produced false errors pointing everywhere
   * but at the broken file.
   */
  unreadableApis: Set<string>;
}

/** The three facts this walk needs about the feature it is reading. */
export interface DeltaScope {
  docsDir: DocsDir;
  featureDir: FeatureDir;
  featureId: string;
}

export async function declaredByService(
  scope: DeltaScope,
  svcNames: PathableService[],
  issues: Issue[],
  context?: FleetContext,
): Promise<Declared> {
  const { docsDir, featureDir, featureId } = scope;
    const reqOps = new Map<PathableService, string[]>();
    const removedReqOps = new Map<string, Set<string>>();
    /** Per service: operations this feature genuinely retires (markers minus relocations). */
    const removingOps = new Map<string, Set<string>>();
    /** Per service: every id a removal marker names, relocations included. */
    const allMarkerIds = new Map<string, Set<string>>();
    /** Per service: does the feature contract carry a marker with no operationId? */
    const anonymousMarkers = new Map<string, boolean>();
    const featureApiOps = new Set<string>();
    const unreadableApis = new Set<string>();
    // The capability gate's vocabulary, once per call. Absent or invalid stays
    // SILENT here — capability.invalid is validate --all's one finding about a
    // broken file, and an absent file means the fleet never opted in — so with
    // either, nothing new gates archive (the roadmap's own trade; the
    // /loam-check row tells agents to fix the YAML first). `grading` is that
    // silence hoisted into a guard, so a silent axis also skips the reads that
    // exist only to feed it.
    //
    // The vocabulary is the one this feature's MERGE would leave behind, not
    // the one on disk: a feature that adds a capability requirement in its own
    // capability delta and `Realizes:` it from its own service delta is the
    // flow the whole axis exists for, and graded against the living tree alone
    // it is refused with `capability.realizes-unknown` — an error, gating
    // archive, for a target the same archive creates. `capabilities/delta/
    // overlay.ts` states the whole judgement. One `existsSync` for a feature
    // that carries no capability delta, which is every feature in a fleet that
    // has not adopted the axis.
    const capabilityDeltas =
      context === undefined ? await featureCapabilityDeltas(featureDir) : await context.featureCapabilityDeltas(featureDir);
    const capabilityVocab = withFeatureCapabilities(
      context === undefined ? await readCapabilityVocabulary(docsDir) : await context.capabilities(docsDir),
      capabilityDeltas.docs.map((d) => d.id),
    );
    const grading = capabilityVocab.present && capabilityVocab.invalid === undefined;
    // The `Realizes:` index, built at most ONCE per feature and only if some
    // delta document actually reaches the grading branch. Lazy rather than
    // eager because it reads every capability document in the fleet, and a
    // feature whose deltas carry no requirement file at all must not pay for
    // that — the same "a silent axis skips the reads that feed it" rule
    // `grading` above states, one level deeper.
    let pendingIndex: Promise<CapabilityRequirementIndex> | null = null;
    const capabilityReqs = (): Promise<CapabilityRequirementIndex> => {
      const read = context === undefined
        ? async (p: string): Promise<Requirement[]> => parseRequirements(await readFile(p, "utf8"))
        : (p: string): Promise<Requirement[]> => context.readRequirements(p);
      // The living index first, then widened by what this feature's capability
      // deltas ADD or MODIFY. Both halves are inside the lazy thunk, so a
      // feature whose deltas carry no requirement file at all pays for neither.
      pendingIndex ??= capabilityRequirementIndex(capabilityVocab, read).then(async (index) =>
        withFeatureRequirements(
          index,
          await Promise.all(capabilityDeltas.docs.map(async (d) => ({ id: d.id, reqs: await read(d.spec) }))),
        ),
      );
      return pendingIndex;
    };
    for (const svc of svcNames) {
      const paths = featureSpecPaths(featureDir, svc);
      if (existsSync(paths.spec)) {
        const reqs = context === undefined
          ? parseRequirements(await readFile(paths.spec, "utf8"))
          : await context.readRequirements(paths.spec);
        // REMOVED requirements are being retired along with their operations — their
        // ops neither claim the contract (E1) nor govern anything after the merge.
        reqOps.set(svc, reqs.filter((r) => r.kind !== "REMOVED").flatMap((r) => r.operations));
        removedReqOps.set(
          svc,
          new Set(reqs.filter((r) => r.kind === "REMOVED").flatMap((r) => r.operations)),
        );
        if (grading) {
          const target = { where: `${svc}: spec.md`, subject: svc };
          issues.push(...capabilityUnknownIssues(reqs, target, capabilityVocab));
          issues.push(...realizesUnknownIssues(reqs, target, await capabilityReqs()));
        }
      }
      // The delta arch.spec.md carries the same grammar and merges the same
      // way, so an undeclared capability in it gates identically. Nothing else
      // in this walk needs the arch delta, so the read itself sits behind
      // `grading` — and it is NOT always cached: `validate --feature` passes a
      // context, but archive's plan gate (commands/archive/plan/gate.ts) calls
      // featureCoherence without one, so this parse is paid fresh there.
      if (grading && existsSync(paths.archSpec)) {
        const archReqs = context === undefined
          ? parseRequirements(await readFile(paths.archSpec, "utf8"))
          : await context.readRequirements(paths.archSpec);
        const archTarget = { where: `${svc}: arch.spec.md`, subject: svc };
        issues.push(...capabilityUnknownIssues(archReqs, archTarget, capabilityVocab));
        issues.push(...realizesUnknownIssues(archReqs, archTarget, await capabilityReqs()));
      }
      // Only operations genuinely NEW to this service count as feature-added: authors
      // restate the full living API in the delta file (it is a complete document, not a patch).
      const featDoc = await readOpenapi(paths.openapi, context);
      // A feature contract that EXISTS but does not read is a broken document,
      // not an empty one — the living-side `openapi.invalid` discipline
      // (validate/service/api.ts), applied to the delta. Before this check,
      // `validate --feature` said nothing about the file at all: the empty
      // parse silently skipped every baseline pin and removal marker in it,
      // and E1 graded requirements against a contract that was never read.
      // The rest of this service's contract-axis checks are suspended — every
      // one of them would be an opinion about a document nobody could open.
      if (featDoc.unreadable) {
        unreadableApis.add(svc);
        issues.push({
          severity: "error",
          code: "openapi.invalid",
          subject: svc,
          message: `${svc}: this feature's openapi.yaml does not parse${featDoc.error === undefined ? "" : ` (${featDoc.error})`} — the contract axis is unchecked and the merge would have nothing true to write. Fix the YAML first.`,
        });
        continue;
      }
      const featOps = featDoc.ops;
      const removals = featOps.filter((op) => op.remove);
      // A relocation — same operationId, removal marker on the old slot, upsert
      // on the new one — retires nothing. Every rule that asks "is this operation
      // going away" must therefore ask the NET set (markers this feature does not
      // redefine), while "did the author write a marker at all" asks the raw one.
      // Conflating them made moving an endpoint fail three checks at once for a
      // change that removes nothing.
      const redefined = new Set(featOps.filter((op) => !op.remove).map((op) => op.id));
      const markerIds = new Set(removals.map((op) => op.id));
      const netRemoved = new Set([...markerIds].filter((id) => !redefined.has(id)));
      removingOps.set(svc, netRemoved);
      allMarkerIds.set(svc, markerIds);
      anonymousMarkers.set(svc, featDoc.anonymousRemovals.length > 0);

      // A marker with no operationId names a slot but no operation. Every
      // id-keyed check is blind to it, so it used to travel all the way into the
      // living contract as a literal `x-loam-remove: true` — the one feature-only
      // key that must never be published.
      for (const marker of featDoc.anonymousRemovals) {
        issues.push({
          severity: "error",
          code: "openapi.remove-marker-anonymous",
          subject: svc,
          message: `${svc}: ${marker.method} ${marker.path} carries x-loam-remove: true but declares no operationId — loam cannot tell which operation it retires; name the operation the living contract has at that slot`,
        });
      }

      const livingDoc = await readOpenapi((await locateServicePaths(docsDir, svc, context)).openapi, context);
      const livingOps = livingDoc.ops;
      for (const id of livingDoc.duplicateIds) {
        const slots = livingOps.filter((op) => op.id === id).map((op) => `${op.method} ${op.path}`);
        issues.push({
          severity: "warn",
          code: "openapi.duplicate-operationid",
          subject: svc,
          message: `${svc}: the living OpenAPI defines operationId '${id}' at ${slots.join(" and ")} — every join on the id (a requirement's Operations: line, an edge's metadata { op }, a removal marker) picks one of those slots arbitrarily`,
        });
      }
      // The baseline axis — operation pins, path-item keys and components —
      // graded in its own package (openapi/baseline/gate.ts), slot-keyed
      // exactly as the merge writes. Texts come through the context's memoized
      // read when there is one, mirroring the readRequirements pattern above;
      // the gate itself never touches the filesystem.
      if (existsSync(paths.openapi)) {
        const livingOpenapiPath = (await locateServicePaths(docsDir, svc, context)).openapi;
        // `context.readText` DECODES and THROWS on non-UTF-8 bytes, where the
        // no-context `readFile` substitutes U+FFFD and lets `readOpenapi`
        // flag the document unreadable. Uncaught, one service's UTF-16 living
        // contract took down the whole feature target under validate's
        // context while archive's no-context path sailed past — the exact
        // context/no-context divergence doc.ts documents as paid for once.
        // Either text failing to decode gets the same answer the gate gives
        // an unreadable parse: that side's surface checks are skipped.
        const readOr = async (p: string): Promise<string | undefined> => {
          try {
            return context === undefined ? await readFile(p, "utf8") : await context.readText(p);
          } catch (err) {
            if (err instanceof NotUtf8DocumentError) return undefined;
            throw err;
          }
        };
        const featureText = await readOr(paths.openapi);
        const livingText = !existsSync(livingOpenapiPath) ? undefined : await readOr(livingOpenapiPath);
        if (featureText !== undefined) {
          issues.push(
            ...openapiBaselineIssues({ featDoc, livingDoc, featureText, livingText, service: svc, featureId }),
          );
        }
      }

      if (featOps.length > 0) {
        const living = new Set(livingOps.filter((op) => !op.remove).map((op) => op.id));
        for (const op of featOps) {
          if (!op.remove && !living.has(op.id)) featureApiOps.add(op.id);
        }

        // Removal is exact: the feature names both an operationId and the
        // path+method slot it expects to delete. That catches stale deltas whose
        // target moved or was already retired before the archive planner runs.
        const justified = removedReqOps.get(svc) ?? new Set<string>();
        for (const marker of removals) {
          const target = livingOps.find((op) => op.path === marker.path && op.method === marker.method);
          if (target === undefined) {
            issues.push({
              severity: "error",
              code: "openapi.remove-target-missing",
              subject: svc,
              message: `${svc}: removal marker for '${marker.id}' addresses ${marker.method} ${marker.path}, but no living operation exists there`,
            });
          } else if (target.id !== marker.id) {
            issues.push({
              severity: "error",
              code: "openapi.remove-target-mismatch",
              subject: svc,
              message: `${svc}: removal marker names '${marker.id}' at ${marker.method} ${marker.path}, but the living operation there is '${target.id}'`,
            });
          }
          // A relocation needs no REMOVED requirement: the requirement governing
          // the operation stays, the operation only changes address.
          if (!netRemoved.has(marker.id)) continue;
          if (!justified.has(marker.id)) {
            issues.push({
              severity: "error",
              code: "openapi.remove-marker-unjustified",
              subject: svc,
              message: `${svc}: removal marker for '${marker.id}' is not governed by a REMOVED requirement's Operations: line`,
            });
          }
        }
      }
    }
    for (const [svc, required] of removedReqOps) {
      // The markers live in the unreadable file — "no matching marker" would
      // be a claim about a document nobody could open.
      if (unreadableApis.has(svc)) continue;
      const marked = allMarkerIds.get(svc) ?? new Set<string>();
      for (const op of required) {
        if (marked.has(op)) continue;
        // Distinguish "no marker at all" from "a marker is there but loam cannot
        // read which operation it names" — the first asks the author to write the
        // marker, the second to write the operationId, and telling somebody who
        // already wrote the marker that there is none sends them looking for a
        // file they are staring at.
        issues.push({
          severity: "error",
          code: "openapi.remove-marker-missing",
          subject: svc,
          message: anonymousMarkers.get(svc) === true
            ? `${svc}: REMOVED requirement governs '${op}', and its feature openapi.yaml carries an x-loam-remove: true marker with no operationId — name '${op}' on that marker`
            : `${svc}: REMOVED requirement governs '${op}', but its feature openapi.yaml has no matching x-loam-remove: true marker`,
        });
      }
    }
  return { reqOps, removedReqOps, removingOps, allMarkerIds, anonymousMarkers, featureApiOps, unreadableApis };
}
