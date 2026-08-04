import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { elementService, loadFile, serviceOf, type Elem, type LoadedDoc, type Rel } from "./likec4.js";
import { deltaShapeIssues } from "./delta.js";
import type { Issue } from "./issue.js";
import { featurePaths, featureSpecPaths, featureSpecServices, listFeatures, servicePaths } from "./repo.js";
import { parseRequirements } from "./spec.js";
import { operationIds, operations, serviceOperationIds } from "./openapi.js";
import type { FleetContext } from "./fleet-context.js";

export type { Issue, IssueCode } from "./issue.js";

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
    }
    // Only operations genuinely NEW to this service count as feature-added: authors
    // restate the full living API in the delta file (it is a complete document, not a patch).
    const featOps = await operationIds(paths.openapi, context);
    if (featOps.length > 0) {
      const living = new Set(await operationIds(servicePaths(docsDir, svc).openapi, context));
      for (const op of featOps) if (!living.has(op)) featureApiOps.add(op);
    }
  }
  const declaredOps = new Set([...reqOps.values()].flat());

  // Living specs also govern: an edge calling a pre-existing endpoint is coherent if the
  // target's living spec.md declares the op — the feature need not restate the requirement.
  const livingGoverned = new Map<string, Set<string>>();
  const governedByLivingSpec = async (service: string, op: string): Promise<boolean> => {
    let ops = livingGoverned.get(service);
    if (!ops) {
      const p = servicePaths(docsDir, service).spec;
      const reqs = existsSync(p)
        ? context === undefined
          ? parseRequirements(await readFile(p, "utf8"))
          : await context.readRequirements(p)
        : [];
      ops = new Set(reqs.flatMap((r) => r.operations));
      livingGoverned.set(service, ops);
    }
    return ops.has(op);
  };

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
    if (!available.includes(r.op)) {
      const other = await definedElsewhere(target, r.op);
      if (other !== undefined) {
        issues.push({ severity: "warn", code: "c4-api.op-pending", message: `${svcOf(r.source)} calls '${r.op}' on ${target}, defined by in-flight ${other} — archive it first` });
      } else {
        issues.push({ severity: "error", code: "c4-api.op-undefined", message: `${svcOf(r.source)} calls '${r.op}' on ${target}, but ${target}'s OpenAPI does not define it (contract broken)` });
      }
    }
    if (!declaredOps.has(r.op) && !(await governedByLivingSpec(target, r.op))) {
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
    if (e.kind === "softwareSystem" && !svcNames.includes(svc)) {
      issues.push({ severity: "warn", code: "service.no-requirement-delta", message: `new service ${svc} has no requirement delta under specs/` });
    }
  }

  return issues;
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
      for (const op of await operationIds(featureSpecPaths(feature.dir, service).openapi, context)) {
        const k = `${service} ${op}`;
        if (!map.has(k)) map.set(k, feature.id);
      }
    }
  }
  return map;
}
