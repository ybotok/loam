import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import {
  elementService,
  loadFile,
  serviceOf,
  serviceResolver,
  type Elem,
  type LoadedDoc,
  type Rel,
} from "./c4/likec4.js";
import { closeIds } from "./c4/arch.js";
import { deltaShapeIssues } from "./delta.js";
import type { Issue } from "./vocabulary/issue.js";
import { repoPath } from "./envelope/json.js";
import type { Finding } from "./vocabulary/report.js";
import {
  docsRepoState,
  featurePaths,
  featureSpecPaths,
  featureSpecServices,
  landscapePath,
  listFeatures,
  listServices,
  servicePaths,
  SPEC_AXES,
} from "./repo.js";
import { parseRequirements, type Requirement } from "./document/spec.js";
import {
  OPENAPI_BASELINE_KEY,
  OPERATION_DIGEST_LENGTH,
  OPERATION_DIGEST_RE,
  classifyBaselineDigests,
  operations,
  readOpenapi,
  serviceOperationIds,
} from "./openapi.js";
import {
  documentConflictFinding,
  landscapeConflictFinding,
  type FleetContext,
} from "./fleet-context.js";

export type { Issue, IssueCode } from "./vocabulary/issue.js";

/**
 * Cross-axis consistency for a feature: do C4 (architecture), requirements (behaviour),
 * and OpenAPI (contract) agree? Errors are hard (would corrupt the living docs on archive);
 * warnings surface softer misalignments.
 *
 * `preloadedDelta` is the feature's already-parsed delta.likec4, when the caller
 * has it — loading a LikeC4 document spins up a fresh Langium workspace, the
 * dominant per-feature cost, and validate/archive have both parsed the same file
 * moments earlier. Standalone calls omit it and nothing changes: the file is
 * loaded here, exactly as before.
 */
export async function featureCoherence(
  docsDir: string,
  featureDir: string,
  featureId: string,
  preloadedDelta?: LoadedDoc,
  context?: FleetContext,
): Promise<Issue[]> {
  // Delta shape first: a diff that does not apply to the living spec explains
  // everything downstream, and it is the one breach that is silent without a check.
  const issues: Issue[] = await deltaShapeIssues(docsDir, featureDir, featureId, context);

  // --- C4 delta ---
  let elements: Elem[] = [];
  let taggedEls: Elem[] = [];
  let taggedRels: Rel[] = [];
  const deltaPath = featurePaths(featureDir).delta;
  if (existsSync(deltaPath)) {
    const res = preloadedDelta ?? (context === undefined ? await loadFile(deltaPath) : await context.loadLikeC4(deltaPath));
    if (res.errors.length > 0) {
      // An unreadable architecture axis can prove nothing — it must never count as coherent.
      issues.push({
        severity: "error",
        code: "delta.invalid",
        message: `delta.likec4 has ${res.errors.length} parse error(s) — architecture axis unreadable (run \`loam validate --feature ${featureId}\`)`,
      });
    } else {
      elements = res.elements;
      taggedEls = res.elements.filter((e) => e.tags.includes(featureId));
      taggedRels = res.relationships.filter((r) => r.tags.includes(featureId));
      // Every rule below filters by the feature tag, so a delta whose author
      // forgot the tags entirely passes every check and archives while merging
      // nothing. Whole-file only: once ANYTHING is tagged, deciding that an
      // untagged edge "looks intended" would be guessing.
      if (
        (res.elements.length > 0 || res.relationships.length > 0) &&
        taggedEls.length === 0 &&
        taggedRels.length === 0
      ) {
        issues.push({
          severity: "error",
          code: "delta.nothing-tagged",
          message: `delta.likec4 declares elements/relationships but none are tagged #${featureId}; loam cannot see untagged changes`,
        });
      }
    }
  }
  // Every axis below joins on the service id, so endpoints resolve through the
  // element's `metadata { service }` binding — never through what the box is called.
  const svcOf = (id: string): string => serviceOf(elements, id);

  // --- per-service specs (requirement operations) + openapi deltas ---
  const svcNames = await featureSpecServices(featureDir, context);
  const reqOps = new Map<string, string[]>();
  const removedReqOps = new Map<string, Set<string>>();
  /** Per service: operations this feature genuinely retires (markers minus relocations). */
  const removingOps = new Map<string, Set<string>>();
  /** Per service: every id a removal marker names, relocations included. */
  const allMarkerIds = new Map<string, Set<string>>();
  /** Per service: does the feature contract carry a marker with no operationId? */
  const anonymousMarkers = new Map<string, boolean>();
  const featureApiOps = new Set<string>();
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
    }
    // Only operations genuinely NEW to this service count as feature-added: authors
    // restate the full living API in the delta file (it is a complete document, not a patch).
    const featDoc = await readOpenapi(paths.openapi, context);
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

    const livingDoc = await readOpenapi(servicePaths(docsDir, svc).openapi, context);
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
    // The baseline axis: which of the operations this delta SPELLS does it
    // actually edit? A feature's openapi.yaml is a complete document, so most of
    // it is quotation — and until the pin existed the merge upserted quotations
    // too, which reverted whatever had landed on them since. Slot-keyed, exactly
    // as the merge writes (path + method), never by operationId.
    const livingBySlot = new Map(livingOps.map((op) => [`${op.method} ${op.path}`, op]));
    let unpinned = 0;
    for (const op of featOps) {
      // A removal marker is not a restatement of anything; its own exactness
      // check (`openapi.remove-target-mismatch`) already guards the slot.
      if (op.remove) continue;
      const where = `${op.method.toUpperCase()} ${op.path}`;
      const livingOp = livingBySlot.get(`${op.method} ${op.path}`);
      if (op.basedOn !== undefined && !OPERATION_DIGEST_RE.test(op.basedOn)) {
        issues.push({
          severity: "error",
          code: "openapi.baseline-invalid",
          subject: svc,
          message: `${svc}: ${where} has invalid ${OPENAPI_BASELINE_KEY} '${op.basedOn}' — expected ${OPERATION_DIGEST_LENGTH} lowercase hex characters, as \`loam rebase\` writes them`,
        });
        continue;
      }
      const verdict = classifyBaselineDigests(op.basedOn, op.digest, livingOp?.digest);
      if (verdict === "unfounded") {
        issues.push({
          severity: "error",
          code: "openapi.baseline-invalid",
          subject: svc,
          message: `${svc}: ${where} ('${op.id}') carries ${OPENAPI_BASELINE_KEY}, but the living contract has no operation at that slot — a new operation has no living version to be based on; drop the marker`,
        });
      } else if (verdict === "stale") {
        issues.push({
          severity: "error",
          code: "openapi.baseline-stale",
          subject: svc,
          message: `${svc}: ${where} ('${op.id}') was written against living version ${op.basedOn}, but the living contract now holds ${livingOp!.digest} — somebody landed a change to it in between, and merging this would replace theirs outright. Re-read the living operation, fold in what you still mean, then run \`loam rebase ${featureId}\`.`,
        });
      } else if (verdict === "unpinned" && livingOp !== undefined) {
        // Counted, not listed. A delta over a thirty-operation service quotes
        // twenty-nine of them, and twenty-nine identical warnings naming a fix
        // that is ONE command teaches people to filter the code out.
        unpinned += 1;
      }
    }
    if (unpinned > 0) {
      issues.push({
        severity: "warn",
        code: "openapi.baseline-missing",
        subject: svc,
        message: `${svc}: ${unpinned} operation(s) in this feature's openapi.yaml carry no ${OPENAPI_BASELINE_KEY}, so the merge cannot tell which ones this delta EDITS from the ones it merely restates — it will upsert all of them, reverting anything that landed on the restated ones. Run \`loam rebase ${featureId} --service ${svc}\`.`,
      });
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

  // Living specs also govern: an edge calling a pre-existing endpoint is coherent if the
  // target's living spec.md declares the op — the feature need not restate the requirement.
  const livingReqs = new Map<string, Requirement[]>();
  const livingRequirements = async (service: string): Promise<Requirement[]> => {
    let reqs = livingReqs.get(service);
    if (reqs === undefined) {
      const p = servicePaths(docsDir, service).spec;
      reqs = existsSync(p)
        ? context === undefined
          ? parseRequirements(await readFile(p, "utf8"))
          : await context.readRequirements(p)
        : [];
      livingReqs.set(service, reqs);
    }
    return reqs;
  };
  const governedByLivingSpec = async (service: string, op: string): Promise<boolean> => {
    return (await livingRequirements(service)).some((r) => r.operations.includes(op));
  };

  // --- retiring an operation the fleet still calls ---
  //
  // A removal marker is checked against the living CONTRACT (does the slot
  // exist) and the feature's own requirements (is the retirement governed).
  // Neither question asks the one that matters to the other ninety-nine repos:
  // is anybody still calling it? The living landscape is the fleet's own answer
  // — an edge with `metadata { op }` is a consumer somebody drew — and another
  // service's living requirements naming the operation are a second. Both are
  // gating: the merge deletes the operation from the contract while the edge
  // and the requirement stay, so the very next `validate --all` reports a
  // broken contract on a repository whose author was never in this feature.
  //
  // Lazy on purpose: the landscape is a full LikeC4 workspace spin-up and the
  // requirement scan reads every service's living spec, and a feature that
  // removes nothing must pay for neither.
  let livingLandscape: LoadedDoc | null | undefined;
  const edgeConsumers = async (service: string, op: string): Promise<string[]> => {
    if (livingLandscape === undefined) {
      const path = landscapePath(docsDir);
      livingLandscape = existsSync(path)
        ? context === undefined
          ? await loadFile(path)
          : await context.loadLikeC4(path)
        : null;
    }
    // An unreadable landscape proves nothing either way; `landscape.invalid`
    // is validate's finding to make, and inventing a removal refusal out of a
    // parse error would point the author at the wrong file.
    if (livingLandscape === null || livingLandscape.errors.length > 0) return [];
    const resolve = serviceResolver(livingLandscape.elements);
    return livingLandscape.relationships
      .filter((r) => r.op === op && resolve(r.target) === service)
      .map((r) => `edge ${resolve(r.source)} → ${resolve(r.target)}${r.title === undefined ? "" : ` ("${r.title}")`}`);
  };
  const requirementConsumers = async (service: string, op: string): Promise<string[]> => {
    let others: string[];
    try {
      others = (await (context === undefined ? listServices(docsDir) : context.listServices(docsDir)))
        .map((s) => s.id)
        .filter((id) => id !== service);
    } catch {
      // No enumerable services/ — validate's `services-missing` is that
      // repository's finding, not this feature's.
      return [];
    }
    const out: string[] = [];
    for (const other of others) {
      for (const r of await livingRequirements(other)) {
        if (r.operations.includes(op)) out.push(`${other}'s living requirement '${r.name}'`);
      }
    }
    return out;
  };
  for (const [svc, retiring] of removingOps) {
    for (const op of retiring) {
      const consumers = [...(await edgeConsumers(svc, op)), ...(await requirementConsumers(svc, op))];
      if (consumers.length === 0) continue;
      issues.push({
        severity: "error",
        code: "openapi.remove-op-consumed",
        subject: svc,
        message: `${svc}: this feature retires '${op}', but the living fleet still consumes it — ${consumers.join("; ")}. Retire the consumer in the same feature (drop the edge from architecture/landscape.likec4, or the requirement that names it), or archive with --approve to break it deliberately.`,
      });
    }
  }

  // What OTHER features in flight define, per (service, op). Cross-service work
  // normally lands as feature A calling an op that in-flight feature B introduces;
  // that is an ordering dependency, not a broken contract, and the requirements
  // axis already grades the same shape as a warn (delta.modified-pending). Lazy
  // like delta.ts's activeAdditions — the common case (op resolves) never pays
  // for the fleet scan.
  let inFlightOps: Map<string, string> | null = null;
  const definedElsewhere = async (service: string, op: string): Promise<string | undefined> => {
    inFlightOps ??= await activeOpAdditions(docsDir, featureId, context);
    return inFlightOps.get(`${service} ${op}`);
  };

  // E1: Spec -> API — every operation a requirement governs must exist in that service's OpenAPI.
  for (const [svc, ops] of reqOps) {
    const available = await serviceOperationIds(docsDir, svc, featureDir, context);
    for (const op of ops) {
      if (available.includes(op)) continue;
      const other = await definedElsewhere(svc, op);
      if (other !== undefined) {
        issues.push({ severity: "warn", code: "spec-api.op-pending", message: `requirement in ${svc} governs '${op}', defined by in-flight ${other} — archive it first` });
        continue;
      }
      issues.push({ severity: "error", code: "spec-api.op-undefined", message: `requirement in ${svc} governs '${op}', not defined in ${svc}'s OpenAPI` });
    }
  }

  // What the LIVING provider contracts mark `deprecated: true`, read lazily
  // per service. Living only, on purpose: the feature's own openapi delta
  // restates the full API, and the question here is whether the fleet as
  // shipped is already retiring the op this feature starts leaning on.
  const livingDeprecated = new Map<string, Set<string>>();
  const deprecatedInLiving = async (service: string, op: string): Promise<boolean> => {
    let set = livingDeprecated.get(service);
    if (!set) {
      const list = await operations(servicePaths(docsDir, service).openapi, context);
      set = new Set(list.filter((o) => o.deprecated).map((o) => o.id));
      livingDeprecated.set(service, set);
    }
    return set.has(op);
  };

  // ...unless this feature IS the un-deprecation: an openapi delta that
  // restates the op WITHOUT `deprecated: true` retires the flag on archive
  // (the path-item overwrite is wholesale), so "prefer the replacement
  // operation" would point the author away from the exact change they are
  // shipping. A delta that restates the op still deprecated — or has no
  // delta for the service at all — keeps the warning.
  const featureUndeprecated = new Map<string, Set<string>>();
  const undeprecatedByFeature = async (service: string, op: string): Promise<boolean> => {
    let set = featureUndeprecated.get(service);
    if (!set) {
      const list = await operations(featureSpecPaths(featureDir, service).openapi, context);
      set = new Set(list.filter((o) => !o.deprecated).map((o) => o.id));
      featureUndeprecated.set(service, set);
    }
    return set.has(op);
  };

  // E2 / W1 / W4: C4 edges vs API + requirements.
  for (const r of taggedRels) {
    if (r.op === undefined) {
      if ((r.title ?? "").toLowerCase().startsWith("call")) {
        issues.push({ severity: "warn", code: "c4.op-link-missing", message: `edge ${svcOf(r.source)} → ${svcOf(r.target)} ("${r.title}") has no operation link (metadata { op })` });
      }
      continue;
    }
    const target = svcOf(r.target);
    const available = await serviceOperationIds(docsDir, target, featureDir, context);
    if (removingOps.get(target)?.has(r.op) === true) {
      issues.push({ severity: "error", code: "c4-api.op-removing", message: `${svcOf(r.source)} builds new consumption on '${r.op}', which this feature removes from ${target}` });
    } else if (!available.includes(r.op)) {
      const other = await definedElsewhere(target, r.op);
      if (other !== undefined) {
        issues.push({ severity: "warn", code: "c4-api.op-pending", message: `${svcOf(r.source)} calls '${r.op}' on ${target}, defined by in-flight ${other} — archive it first` });
      } else {
        issues.push({ severity: "error", code: "c4-api.op-undefined", message: `${svcOf(r.source)} calls '${r.op}' on ${target}, but ${target}'s OpenAPI does not define it (contract broken)` });
      }
    }
    // Governed by THIS target's requirements, not by anybody's. An operationId
    // is unique only inside one contract, so the fleet-wide set this used to
    // ask meant a `getStatus` governed in service A silenced the question for
    // service B's entirely unrelated `getStatus` — the warning went quiet for
    // the edge that needed it, and only in repos where some other service
    // happened to reuse the name. The living half on the same line has always
    // joined per service (`governedByLivingSpec(target, …)`); this is the delta
    // half asking it the same way.
    if (!(reqOps.get(target) ?? []).includes(r.op) && !(await governedByLivingSpec(target, r.op))) {
      issues.push({ severity: "warn", code: "c4.op-ungoverned", message: `'${r.op}' is called by ${svcOf(r.source)} but no requirement governs it` });
    }
    // Lifecycle: this NEW tagged edge builds consumption on an operation the
    // living provider contract already marks deprecated. Advisory, never an
    // archive gate — the edge is legal and the contract holds — but new
    // consumption of a dying op deserves an eye before it ships. Quiet when
    // the feature's own openapi delta drops the flag: that state is the fix
    // in progress, not new consumption of a dying op.
    if ((await deprecatedInLiving(target, r.op)) && !(await undeprecatedByFeature(target, r.op))) {
      issues.push({ severity: "warn", code: "c4-api.op-deprecated", message: `${svcOf(r.source)} builds new consumption on '${r.op}', which ${target}'s living OpenAPI marks deprecated — prefer the replacement operation` });
    }
  }

  // W2: API -> C4 — every operation the feature adds should be consumed by some edge.
  const consumed = new Set(taggedRels.map((r) => r.op).filter((o): o is string => o !== undefined));
  for (const op of featureApiOps) {
    if (!consumed.has(op)) {
      issues.push({ severity: "warn", code: "api.op-unconsumed", message: `operation '${op}' is added but no architecture edge consumes it (provider-only or unmodeled)` });
    }
  }

  // W3: a new service should carry a requirement delta.
  for (const e of taggedEls) {
    const svc = elementService(e);
    if (e.kind === "softwareSystem" && !svcNames.some((n) => n === svc)) {
      issues.push({ severity: "warn", code: "service.no-requirement-delta", message: `new service ${svc} has no requirement delta under specs/` });
    }
  }

  return issues;
}

/* ------------------------------------------------------------------ */
/* What the merge would do to the LIVING documents                     */
/* ------------------------------------------------------------------ */

/**
 * Per-service deltas addressed to a service that exists nowhere: no
 * `services/<svc>/`, and nothing in this feature's own tagged delta introducing
 * one.
 *
 * `validate` grades this (`delta.service-unknown`); `archive` is where it costs
 * something, because `specs/<svc>/` is what the merge MATERIALISES
 * `services/<svc>/` from — one wrong character in `--touches` and the fleet
 * acquires a living service nobody meant to adopt, under a banner saying the
 * living docs are complete. Both gates read this function so they cannot drift
 * into disagreeing about which service ids are real; the `code:` literal lives
 * here, once, where the drift collector sees it.
 *
 * A delta that did not parse proves nothing either way — whether it introduces
 * the service is exactly what nobody can read — so the question is suspended
 * there rather than answered by guessing. `delta.invalid` is that file's
 * finding, and coherence already makes it.
 *
 * `services/<svc>/` is asked for directly rather than through the enumeration:
 * a feature may be graded in a docs repo with no `services/` at all (repo.ts
 * takes the same position), where enumerating is a refusal, not an answer.
 */
export async function unknownDeltaServices(
  docsDir: string,
  featureDir: string,
  featureId: string,
  preloadedDelta?: LoadedDoc,
  context?: FleetContext,
): Promise<Finding[]> {
  const deltaPath = featurePaths(featureDir).delta;
  let delta: LoadedDoc | undefined;
  if (existsSync(deltaPath)) {
    delta = preloadedDelta ?? (context === undefined ? await loadFile(deltaPath) : await context.loadLikeC4(deltaPath));
  }
  if (delta !== undefined && delta.errors.length > 0) return [];

  const introduces = new Set(
    (delta?.elements ?? []).filter((e) => e.tags.includes(featureId)).map(elementService),
  );
  const unknown = (await featureSpecServices(featureDir, context)).filter(
    (svc) => !existsSync(servicePaths(docsDir, svc).dir) && !introduces.has(svc),
  );
  if (unknown.length === 0) return [];

  // The near-miss hint, on the same rule `service.unknown` uses — a typo is
  // only diagnosable against the ids that DO exist.
  const closeTo =
    docsRepoState(docsDir).kind === "ok" ? (await listServices(docsDir, context)).map((s) => s.id) : [];
  return unknown.map((svc) => deltaServiceUnknownFinding(svc, closeTo));
}

/**
 * The finding itself, for the two gates that reach this conclusion by different
 * routes.
 *
 * `archive` gets there through `unknownDeltaServices` above; `validate` gets
 * there through its own enumeration, because it suspends the question on an
 * unreadable delta rather than returning early on it, and that difference is
 * deliberate. What must NOT differ is the sentence: the two were spelled out
 * word for word in two files, so a reworded hint in one of them would have made
 * `loam validate` and `loam archive` describe the same typo differently, on the
 * same code, in the same repo.
 *
 * `knownIds` is the fleet's real service ids — already enumerated by the caller,
 * which is also the caller's chance to skip the enumeration entirely when there
 * is nothing to diagnose.
 */
export function deltaServiceUnknownFinding(svc: string, knownIds: string[]): Finding {
  const close = closeIds(svc, knownIds);
  return {
    severity: "error",
    code: "delta.service-unknown",
    subject: svc,
    message:
      `specs/${svc}/ addresses a service that does not exist: there is no services/${svc}/ and this feature's ` +
      `delta.likec4 does not introduce one — archiving would create it out of the typo.` +
      (close.length > 0 ? ` Did you mean: ${close.join(", ")}?` : " `loam list services` shows what exists."),
  };
}

/**
 * Git conflict markers in the LIVING documents a merge of this feature would
 * rewrite: each touched service's requirement files, and the fleet map.
 *
 * The rule and the sentence are fleet-context's — one spelling of the breach,
 * wherever it is found. What this adds is the SET: the documents `archive`
 * rewrites. A conflicted `services/<svc>/spec.md` parses as prose, so every
 * check upstream of the merge reads it as a valid document with some odd
 * headings in it; the rewrite then drops whichever marker lines fall inside the
 * requirements run it owns, and a conflict anyone could see becomes a file
 * nobody can tell is wrong. For a shared docs repo that a fleet lands in
 * through PRs, that is the default failure and not an edge.
 *
 * `openapi.yaml` is deliberately absent: markers make it unparseable, so the
 * YAML reader already refuses it by name and a second finding would only say
 * the same thing later.
 */
export async function livingMergeConflicts(
  docsDir: string,
  services: string[],
  context?: FleetContext,
): Promise<Finding[]> {
  const out: Finding[] = [];
  const read = async (path: string): Promise<string> =>
    context === undefined ? readFile(path, "utf8") : context.readText(path);

  for (const svc of services) {
    const paths = servicePaths(docsDir, svc);
    for (const axis of SPEC_AXES) {
      const path = paths[axis.key];
      if (!existsSync(path)) continue;
      const finding = documentConflictFinding(repoPath(docsDir, path), svc, await read(path));
      if (finding !== null) out.push(finding);
    }
  }

  const landscape = landscapePath(docsDir);
  if (existsSync(landscape)) {
    const finding = landscapeConflictFinding(repoPath(docsDir, landscape), await read(landscape));
    if (finding !== null) out.push(finding);
  }
  return out;
}

/**
 * (service, operationId) pairs other ACTIVE features' openapi deltas define,
 * mapped to the feature id — the openapi mirror of delta.ts's activeAdditions.
 * Archived features are excluded: their ops are in the living openapi already or
 * gone for good, and neither is "pending". First feature wins a clash — one name
 * to archive first is enough to make progress.
 */
async function activeOpAdditions(
  docsDir: string,
  exclude: string,
  context?: FleetContext,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const feature of await listFeatures(docsDir, {}, context)) {
    if (feature.id === exclude) continue;
    for (const service of feature.services) {
      for (const op of await operations(featureSpecPaths(feature.dir, service).openapi, context)) {
        if (op.remove) continue;
        const k = `${service} ${op.id}`;
        if (!map.has(k)) map.set(k, feature.id);
      }
    }
  }
  return map;
}
