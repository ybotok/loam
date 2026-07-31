import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { loadFile, type Elem, type Rel } from "./likec4.js";
import { parseRequirements } from "./spec.js";
import { operationIds, serviceOperationIds } from "./openapi.js";

export interface Issue {
  severity: "error" | "warn";
  message: string;
}

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
  const issues: Issue[] = [];

  // --- C4 delta ---
  let elements: Elem[] = [];
  let taggedEls: Elem[] = [];
  let taggedRels: Rel[] = [];
  const deltaPath = join(featureDir, "delta.likec4");
  if (existsSync(deltaPath)) {
    const res = await loadFile(deltaPath);
    if (res.errors.length === 0) {
      elements = res.elements;
      taggedEls = res.elements.filter((e) => e.tags.includes(featureId));
      taggedRels = res.relationships.filter((r) => r.tags.includes(featureId));
    }
  }
  const titleOf = (id: string): string => elements.find((e) => e.id === id)?.title ?? id;

  // --- per-service specs (requirement operations) + openapi deltas ---
  const specsDir = join(featureDir, "specs");
  const svcNames: string[] = [];
  const reqOps = new Map<string, string[]>();
  const featureApiOps = new Set<string>();
  if (existsSync(specsDir)) {
    for (const d of (await readdir(specsDir, { withFileTypes: true })).filter((e) => e.isDirectory())) {
      svcNames.push(d.name);
      const specPath = join(specsDir, d.name, "spec.md");
      if (existsSync(specPath)) {
        const reqs = parseRequirements(await readFile(specPath, "utf8"));
        reqOps.set(d.name, reqs.flatMap((r) => r.operations));
      }
      for (const op of await operationIds(join(specsDir, d.name, "openapi.yaml"))) featureApiOps.add(op);
    }
  }
  const declaredOps = new Set([...reqOps.values()].flat());

  // E1: Spec -> API — every operation a requirement governs must exist in that service's OpenAPI.
  for (const [svc, ops] of reqOps) {
    const available = await serviceOperationIds(docsDir, svc, featureDir);
    for (const op of ops) {
      if (!available.includes(op)) {
        issues.push({ severity: "error", message: `requirement in ${svc} governs '${op}', not defined in ${svc}'s OpenAPI` });
      }
    }
  }

  // E2 / W1 / W4: C4 edges vs API + requirements.
  for (const r of taggedRels) {
    if (r.op === undefined) {
      if ((r.title ?? "").toLowerCase().startsWith("call")) {
        issues.push({ severity: "warn", message: `edge ${titleOf(r.source)} → ${titleOf(r.target)} ("${r.title}") has no operation link (metadata { op })` });
      }
      continue;
    }
    const target = titleOf(r.target);
    const available = await serviceOperationIds(docsDir, target, featureDir);
    if (!available.includes(r.op)) {
      issues.push({ severity: "error", message: `${titleOf(r.source)} calls '${r.op}' on ${target}, but ${target}'s OpenAPI does not define it (contract broken)` });
    }
    if (!declaredOps.has(r.op)) {
      issues.push({ severity: "warn", message: `'${r.op}' is called by ${titleOf(r.source)} but no requirement governs it` });
    }
  }

  // W2: API -> C4 — every operation the feature adds should be consumed by some edge.
  const consumed = new Set(taggedRels.map((r) => r.op).filter((o): o is string => o !== undefined));
  for (const op of featureApiOps) {
    if (!consumed.has(op)) {
      issues.push({ severity: "warn", message: `operation '${op}' is added but no architecture edge consumes it (provider-only or unmodeled)` });
    }
  }

  // W3: a new service should carry a requirement delta.
  for (const e of taggedEls) {
    if (e.kind === "softwareSystem" && !svcNames.includes(e.title)) {
      issues.push({ severity: "warn", message: `new service ${e.title} has no requirement delta under specs/` });
    }
  }

  return issues;
}
