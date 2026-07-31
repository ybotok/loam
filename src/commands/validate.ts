import type { Command } from "commander";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { loadConfig } from "../core/config.js";
import { loadFile, type Elem, type Rel } from "../core/likec4.js";
import { parseRequirements, requirementsMissingScenarios, type Requirement } from "../core/spec.js";

interface ValidateOptions {
  service?: string;
  feature?: string;
}

export function registerValidate(program: Command): void {
  program
    .command("validate")
    .description("Validate a service (C4 + requirement coverage) or a feature (delta + coverage)")
    .option("--service <id>", "service to validate (defaults to the configured service)")
    .option("--feature <id>", "validate a feature delta instead of a service")
    .action(async (opts: ValidateOptions) => {
      const config = await loadConfig();
      if (!config) {
        console.error("No loam.json found. Run `loam init --docs <dir>` first.");
        process.exitCode = 1;
        return;
      }
      const ok = opts.feature
        ? await validateFeature(config.docsDir, opts.feature)
        : await validateService(config.docsDir, opts.service ?? config.service);
      if (!ok) process.exitCode = 1;
    });
}

async function validateService(docsDir: string, service: string | undefined): Promise<boolean> {
  if (!service) {
    console.error("No service. Pass --service <id> or set it in loam.json.");
    return false;
  }
  let ok = true;

  // C4 model
  const modelPath = join(docsDir, "services", service, "model.likec4");
  if (!existsSync(modelPath)) {
    console.error(`No C4 model at ${modelPath}. Run \`loam adopt\` for '${service}' first.`);
    return false;
  }
  const { errors, elements, relationships } = await loadFile(modelPath);
  if (errors.length > 0) {
    console.error(`✗ ${service}: C4 model has ${errors.length} error(s)`);
    for (const e of errors) console.error(`    ${line(e.line)}${e.message}`);
    ok = false;
  } else {
    console.log(`✓ ${service}: C4 model valid (${elements.length} elements · ${relationships.length} relationships)`);
  }

  // Requirement coverage
  const specPath = join(docsDir, "services", service, "spec.md");
  if (existsSync(specPath)) {
    const reqs = parseRequirements(await readFile(specPath, "utf8"));
    ok = reportCoverage(`${service}: requirements`, reqs) && ok;
  }
  return ok;
}

async function validateFeature(docsDir: string, featureId: string): Promise<boolean> {
  const featuresDir = join(docsDir, "features");
  const dirName = await findFeatureDirName(featuresDir, featureId);
  if (!dirName) {
    console.error(`No feature '${featureId}' under ${featuresDir}.`);
    return false;
  }
  const featureDir = join(featuresDir, dirName);
  let ok = true;

  console.log(`${featureId}`);

  // delta.likec4 parse + collect tagged edges
  let taggedRels: Rel[] = [];
  let elements: Elem[] = [];
  const deltaPath = join(featureDir, "delta.likec4");
  if (existsSync(deltaPath)) {
    const res = await loadFile(deltaPath);
    if (res.errors.length > 0) {
      console.error(`✗ delta.likec4 has ${res.errors.length} error(s)`);
      for (const e of res.errors) console.error(`    ${line(e.line)}${e.message}`);
      ok = false;
    } else {
      elements = res.elements;
      taggedRels = res.relationships.filter((r) => r.tags.includes(featureId));
      console.log(`✓ delta.likec4 valid (${res.elements.length} elements · ${res.relationships.length} relationships)`);
    }
  }

  // Requirement coverage across every per-service delta, and collect scenario text
  const specsDir = join(featureDir, "specs");
  let scenarioText = "";
  if (existsSync(specsDir)) {
    const svcs = (await readdir(specsDir, { withFileTypes: true })).filter((e) => e.isDirectory());
    for (const svc of svcs) {
      const p = join(specsDir, svc.name, "spec.md");
      if (!existsSync(p)) continue;
      const raw = await readFile(p, "utf8");
      scenarioText += "\n" + raw.toLowerCase();
      const reqs = parseRequirements(raw);
      ok = reportCoverage(`${svc.name}: requirements`, reqs) && ok;
    }
  }

  // Arch-edge coverage (heuristic, warn-only): each new tagged edge should be named by a scenario.
  if (taggedRels.length > 0) {
    console.log("  arch-edge coverage (heuristic):");
    for (const r of taggedRels) {
      const target = titleOf(elements, r.target);
      if (edgeCovered(target, r.title, scenarioText)) {
        console.log(`    ✓ ${titleOf(elements, r.source)} → ${target}  "${r.title ?? ""}"`);
      } else {
        console.log(`    ⚠ ${titleOf(elements, r.source)} → ${target}  "${r.title ?? ""}"  — no scenario names it`);
      }
    }
  }
  return ok;
}

function reportCoverage(label: string, reqs: Requirement[]): boolean {
  const missing = requirementsMissingScenarios(reqs);
  if (missing.length === 0) {
    console.log(`✓ ${label} covered (${reqs.length} requirement${reqs.length === 1 ? "" : "s"}, all with scenarios)`);
    return true;
  }
  console.error(`✗ ${label}: ${missing.length} requirement(s) without a scenario`);
  for (const r of missing) console.error(`    - ${r.name}`);
  return false;
}

/** Heuristic: an edge is "covered" if a scenario names the target or a keyword from the edge title. */
function edgeCovered(target: string, title: string | undefined, scenarioText: string): boolean {
  if (scenarioText.includes(target.toLowerCase())) return true;
  for (const token of (title ?? "").split(/[^A-Za-z0-9]+/)) {
    if (token.length >= 5 && scenarioText.includes(token.toLowerCase())) return true;
  }
  return false;
}

async function findFeatureDirName(featuresDir: string, featureId: string): Promise<string | null> {
  if (!existsSync(featuresDir)) return null;
  const entries = await readdir(featuresDir, { withFileTypes: true });
  const match = entries.find(
    (e) => e.isDirectory() && (e.name === featureId || e.name.startsWith(featureId + "-")),
  );
  return match ? match.name : null;
}

function titleOf(elements: Elem[], id: string): string {
  return elements.find((e) => e.id === id)?.title ?? id;
}

function line(n: number | undefined): string {
  return typeof n === "number" ? `L${n}: ` : "";
}
