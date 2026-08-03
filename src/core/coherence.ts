import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { loadFile, type Elem, type Rel } from "./likec4.js";
import { deltaShapeIssues } from "./delta.js";
import type { Issue } from "./issue.js";
import { featurePaths, featureSpecPaths, featureSpecServices, servicePaths } from "./repo.js";
import { parseRequirements } from "./spec.js";
import { operationIds, serviceOperationIds } from "./openapi.js";

export type { Issue, IssueCode } from "./issue.js";

/**
 * Cross-axis consistency for a feature: do C4 (architecture), requirements (behaviour),
 * and OpenAPI (contract) agree? Errors are hard (would corrupt the living docs on archive);
 * warnings surface softer misalignments.
 */
export async function featureCoherence(
  docsDir: string,
  featureDir: string,
  featureId: string,
): Promise<Issue[]> {
  // Delta shape first: a diff that does not apply to the living spec explains
  // everything downstream, and it is the one breach that is silent without a check.
  const issues: Issue[] = await deltaShapeIssues(docsDir, featureDir, featureId);

  // --- C4 delta ---
  let elements: Elem[] = [];
  let taggedEls: Elem[] = [];
  let taggedRels: Rel[] = [];
  const deltaPath = featurePaths(featureDir).delta;
  if (existsSync(deltaPath)) {
    const res = await loadFile(deltaPath);
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
    }
  }
  const titleOf = (id: string): string => elements.find((e) => e.id === id)?.title ?? id;

  // --- per-service specs (requirement operations) + openapi deltas ---
  const svcNames = await featureSpecServices(featureDir);
  const reqOps = new Map<string, string[]>();
  const featureApiOps = new Set<string>();
  for (const svc of svcNames) {
    const paths = featureSpecPaths(featureDir, svc);
    if (existsSync(paths.spec)) {
      const reqs = parseRequirements(await readFile(paths.spec, "utf8"));
      // REMOVED requirements are being retired along with their operations — their
      // ops neither claim the contract (E1) nor govern anything after the merge.
      reqOps.set(svc, reqs.filter((r) => r.kind !== "REMOVED").flatMap((r) => r.operations));
    }
    // Only operations genuinely NEW to this service count as feature-added: authors
    // restate the full living API in the delta file (it is a complete document, not a patch).
    const featOps = await operationIds(paths.openapi);
    if (featOps.length > 0) {
      const living = new Set(await operationIds(servicePaths(docsDir, svc).openapi));
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
      ops = new Set(
        existsSync(p) ? parseRequirements(await readFile(p, "utf8")).flatMap((r) => r.operations) : [],
      );
      livingGoverned.set(service, ops);
    }
    return ops.has(op);
  };

  // E1: Spec -> API — every operation a requirement governs must exist in that service's OpenAPI.
  for (const [svc, ops] of reqOps) {
    const available = await serviceOperationIds(docsDir, svc, featureDir);
    for (const op of ops) {
      if (!available.includes(op)) {
        issues.push({ severity: "error", code: "spec-api.op-undefined", message: `requirement in ${svc} governs '${op}', not defined in ${svc}'s OpenAPI` });
      }
    }
  }

  // E2 / W1 / W4: C4 edges vs API + requirements.
  for (const r of taggedRels) {
    if (r.op === undefined) {
      if ((r.title ?? "").toLowerCase().startsWith("call")) {
        issues.push({ severity: "warn", code: "c4.op-link-missing", message: `edge ${titleOf(r.source)} → ${titleOf(r.target)} ("${r.title}") has no operation link (metadata { op })` });
      }
      continue;
    }
    const target = titleOf(r.target);
    const available = await serviceOperationIds(docsDir, target, featureDir);
    if (!available.includes(r.op)) {
      issues.push({ severity: "error", code: "c4-api.op-undefined", message: `${titleOf(r.source)} calls '${r.op}' on ${target}, but ${target}'s OpenAPI does not define it (contract broken)` });
    }
    if (!declaredOps.has(r.op) && !(await governedByLivingSpec(target, r.op))) {
      issues.push({ severity: "warn", code: "c4.op-ungoverned", message: `'${r.op}' is called by ${titleOf(r.source)} but no requirement governs it` });
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
    if (e.kind === "softwareSystem" && !svcNames.includes(e.title)) {
      issues.push({ severity: "warn", code: "service.no-requirement-delta", message: `new service ${e.title} has no requirement delta under specs/` });
    }
  }

  return issues;
}
