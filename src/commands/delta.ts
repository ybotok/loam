import type { Command } from "commander";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { loadConfig } from "../core/config.js";
import { loadFile, type Elem, type Rel } from "../core/likec4.js";
import { featurePaths, featureSpecPaths, resolveFeature } from "../core/repo.js";
import { parseRequirements, type Requirement } from "../core/spec.js";

interface DeltaOptions {
  service?: string;
}

export function registerDelta(program: Command): void {
  program
    .command("delta")
    .argument("<featureId>", "feature id, e.g. FEAT-101")
    .description("Project a feature onto a service: why + requirement delta + C4 changes")
    .option("--service <id>", "service to project onto (defaults to the configured service)")
    .action(async (featureId: string, opts: DeltaOptions) => {
      const config = await loadConfig();
      if (!config) {
        console.error("No loam.json found. Run `loam init --docs <dir>` first.");
        process.exitCode = 1;
        return;
      }
      const service = opts.service ?? config.service;
      if (!service) {
        console.error("No service. Pass --service <id> or set it in loam.json.");
        process.exitCode = 1;
        return;
      }

      const feature = await resolveFeature(config.docsDir, featureId);
      if (!feature) {
        console.error(`No feature '${featureId}' under ${config.docsDir}/features/.`);
        process.exitCode = 1;
        return;
      }
      const paths = featurePaths(feature.dir);

      console.log(`${featureId} · ${service}\n`);

      // 1. Why — business intent
      if (existsSync(paths.intent)) {
        console.log(indent(stripFrontmatter(await readFile(paths.intent, "utf8")).trim(), "  "));
        console.log();
      }

      // 2. Requirement delta for this service (OpenSpec style)
      const reqPath = featureSpecPaths(feature.dir, service).spec;
      if (existsSync(reqPath)) {
        printRequirements(parseRequirements(await readFile(reqPath, "utf8")));
      } else {
        console.log("Requirements: (none for this service)\n");
      }

      // 3. C4 architecture slice
      const deltaPath = paths.delta;
      if (existsSync(deltaPath)) {
        const { errors, elements, relationships } = await loadFile(deltaPath);
        if (errors.length > 0) {
          console.log("Architecture: delta.likec4 has errors — run `loam validate`.");
        } else {
          printArchSlice(elements, relationships, service, featureId);
        }
      }
    });
}

function stripFrontmatter(md: string): string {
  if (!md.startsWith("---")) return md;
  const close = md.indexOf("\n---", 3);
  if (close === -1) return md;
  const nl = md.indexOf("\n", close + 1);
  return nl === -1 ? "" : md.slice(nl + 1).trimStart();
}

function printRequirements(reqs: Requirement[]): void {
  if (reqs.length === 0) {
    console.log("Requirements: (none)\n");
    return;
  }
  console.log("Requirements:");
  for (const r of reqs) {
    const tag = r.kind === "BASE" ? "" : `[${r.kind}] `;
    const n = r.scenarios.length;
    console.log(`  ${tag}${r.name}  (${n} scenario${n === 1 ? "" : "s"})`);
    for (const s of r.scenarios) console.log(`      · ${s.name}`);
  }
  console.log();
}

function printArchSlice(elements: Elem[], relationships: Rel[], service: string, featureId: string): void {
  const byId = new Map(elements.map((e): [string, Elem] => [e.id, e]));
  const titleOf = (id: string): string => byId.get(id)?.title ?? id;
  const featRels = relationships.filter((r) => r.tags.includes(featureId));
  const outbound = featRels.filter((r) => byId.get(r.source)?.title === service);
  const inbound = featRels.filter((r) => byId.get(r.target)?.title === service);
  const isNew = elements.some((e) => e.title === service && e.tags.includes(featureId));

  console.log("Architecture:");
  if (isNew) console.log(`  NEW service — create ${service}`);
  if (outbound.length > 0) {
    console.log("  Outbound (new calls from this service):");
    for (const r of outbound) console.log(`    → ${titleOf(r.target)}  "${r.title ?? ""}"`);
  }
  if (inbound.length > 0) {
    console.log("  Inbound (this service is newly called):");
    for (const r of inbound) console.log(`    ← ${titleOf(r.source)}  "${r.title ?? ""}"`);
  }
  if (!isNew && outbound.length === 0 && inbound.length === 0) {
    console.log("  (no architecture change for this service)");
  }
  console.log();
}

function indent(text: string, pad: string): string {
  return text
    .split("\n")
    .map((l) => (l.length > 0 ? pad + l : l))
    .join("\n");
}
