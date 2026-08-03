import type { Command } from "commander";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { loadConfig } from "../core/config.js";
import { emitJson, emitJsonError, reportNoConfig } from "../core/json.js";
import { listField, readFrontmatter, stringField } from "../core/frontmatter.js";
import { loadFile, type Elem } from "../core/likec4.js";
import { operationIds } from "../core/openapi.js";
import { repoPath } from "./list.js";
import {
  featurePaths,
  featureSpecPaths,
  landscapePath,
  listServices,
  resolveFeature,
  servicePaths,
  type FeatureEntry,
} from "../core/repo.js";
import { parseRequirements, type Requirement } from "../core/spec.js";

type TargetType = "service" | "feature";

interface ShowOptions {
  json?: boolean;
  type?: string;
}

export function registerShow(program: Command): void {
  program
    .command("show")
    .argument("<target>", "service id or feature id")
    .description("Show everything loam knows about a service or a feature")
    .option("--json", "emit the machine contract instead of the human view")
    .option("--type <kind>", "force the reading: service | feature")
    .action(async (target: string, opts: ShowOptions) => {
      const json = opts.json === true;
      if (opts.type !== undefined && opts.type !== "service" && opts.type !== "feature") {
        const msg = `Unknown --type '${opts.type}'. Expected: service | feature.`;
        if (json) emitJsonError("invalid-option", msg);
        else {
          console.error(msg);
          process.exitCode = 1;
        }
        return;
      }
      const forced = opts.type as TargetType | undefined;

      const config = await loadConfig();
      if (!config) {
        reportNoConfig(json);
        return;
      }
      const { docsDir } = config;

      // A feature id is distinctive (FEAT-101); a service name is arbitrary. When
      // both could match, the feature wins and --type forces the other reading.
      const feature =
        forced === "service" ? null : await resolveFeature(docsDir, target, { includeArchived: true });
      if (feature) {
        await showFeature(docsDir, feature, json);
        return;
      }
      const isService =
        forced !== "feature" && (await listServices(docsDir)).some((s) => s.id === target);
      if (isService) {
        await showService(docsDir, target, json);
        return;
      }

      const looked = forced ? forced : "service or feature";
      const msg = `No ${looked} '${target}' in ${docsDir}.`;
      if (json) emitJsonError("unknown-target", msg);
      else {
        console.error(msg);
        process.exitCode = 1;
      }
    });
}

/* ------------------------------------------------------------------ */
/* Service                                                             */
/* ------------------------------------------------------------------ */

interface Edge {
  service: string;
  op: string | null;
  title: string | null;
}

async function showService(docsDir: string, id: string, json: boolean): Promise<void> {
  const paths = servicePaths(docsDir, id);
  const has = {
    model: existsSync(paths.model),
    spec: existsSync(paths.spec),
    openapi: existsSync(paths.openapi),
    runbook: existsSync(paths.runbook),
    health: existsSync(paths.health),
  };

  const model = has.model
    ? await loadFile(paths.model)
    : { errors: [], elements: [], relationships: [] };
  const reqs = has.spec ? parseRequirements(await readFile(paths.spec, "utf8")) : [];
  const ops = await operationIds(paths.openapi);

  const fm = await readFrontmatter(paths.spec);
  const provenance = {
    status: stringField(fm, "status") ?? null,
    owner: stringField(fm, "owner") ?? null,
    last_verified: stringField(fm, "last_verified") ?? null,
    sources: listField(fm, "sources"),
  };

  const governs = (op: string): string[] =>
    reqs.filter((r) => r.operations.includes(op)).map((r) => r.name);

  const { inbound, outbound } = await landscapeEdges(docsDir, id);

  if (json) {
    emitJson({
      type: "service",
      id,
      path: repoPath(docsDir, paths.dir),
      has,
      frontmatter: provenance,
      model: {
        elements: model.elements.length,
        relationships: model.relationships.length,
        errors: model.errors.map(errorText),
      },
      requirements: reqs.map((r) => ({
        name: r.name,
        kind: r.kind,
        scenarios: r.scenarios.length,
        operations: r.operations,
      })),
      operations: ops.map((op) => ({ id: op, governedBy: governs(op) })),
      landscape: { inbound, outbound },
    });
    return;
  }

  const badge = [provenance.status, provenance.owner].filter((s) => s !== null).join(" · ");
  console.log(`${id}   ${repoPath(docsDir, paths.dir)}${badge ? `   ${badge}` : ""}\n`);

  if (provenance.sources.length > 0 || provenance.last_verified !== null) {
    console.log("  provenance");
    if (provenance.last_verified !== null) console.log(`    verified  ${provenance.last_verified}`);
    for (const s of provenance.sources) console.log(`    sources   ${s}`);
    console.log("");
  }

  console.log("  artifacts");
  const modelNote =
    model.errors.length > 0
      ? `${model.errors.length} error(s)`
      : `${count(model.elements.length, "element")} · ${count(model.relationships.length, "relationship")}`;
  console.log(`    ${mark(has.model)} model.likec4    ${has.model ? modelNote : ""}`.trimEnd());
  const specNote = `${count(reqs.length, "requirement")} · ${count(scenarioCount(reqs), "scenario")}`;
  console.log(`    ${mark(has.spec)} spec.md         ${has.spec ? specNote : ""}`.trimEnd());
  console.log(`    ${mark(has.openapi)} openapi.yaml    ${has.openapi ? count(ops.length, "operation") : ""}`.trimEnd());
  console.log(`    ${mark(has.runbook)} runbook.md`);
  console.log(`    ${mark(has.health)} health.yaml`);

  if (reqs.length > 0) {
    console.log("\n  requirements");
    for (const r of reqs) {
      const govern = r.operations.length > 0 ? `  → ${r.operations.join(", ")}` : "";
      console.log(`    ${r.name}  (${count(r.scenarios.length, "scenario")})${govern}`);
    }
  }

  if (ops.length > 0) {
    console.log("\n  operations");
    for (const op of ops) {
      const by = governs(op);
      if (by.length > 0) console.log(`    ✓ ${op}  governed by ${by.map((n) => `"${n}"`).join(", ")}`);
      else console.log(`    ⚠ ${op}  not governed by any requirement`);
    }
  }

  if (inbound.length > 0 || outbound.length > 0) {
    console.log("\n  landscape");
    for (const e of inbound) console.log(`    ← ${e.service}${edgeNote(e)}`);
    for (const e of outbound) console.log(`    → ${e.service}${edgeNote(e)}`);
  }

  if (model.errors.length > 0) {
    console.log("\n  model errors");
    for (const e of model.errors) console.log(`    ✗ ${errorText(e)}`);
  }
}

/** Inbound/outbound edges for a service, read off the living landscape. */
async function landscapeEdges(
  docsDir: string,
  service: string,
): Promise<{ inbound: Edge[]; outbound: Edge[] }> {
  const path = landscapePath(docsDir);
  if (!existsSync(path)) return { inbound: [], outbound: [] };
  const land = await loadFile(path);
  if (land.errors.length > 0) return { inbound: [], outbound: [] };
  const titleOf = (id: string): string => land.elements.find((e) => e.id === id)?.title ?? id;

  const inbound: Edge[] = [];
  const outbound: Edge[] = [];
  for (const r of land.relationships) {
    const edge = (service: string): Edge => ({
      service,
      op: r.op ?? null,
      title: r.title ?? null,
    });
    if (titleOf(r.target) === service) inbound.push(edge(titleOf(r.source)));
    else if (titleOf(r.source) === service) outbound.push(edge(titleOf(r.target)));
  }
  return { inbound, outbound };
}

/* ------------------------------------------------------------------ */
/* Feature                                                             */
/* ------------------------------------------------------------------ */

async function showFeature(docsDir: string, feature: FeatureEntry, json: boolean): Promise<void> {
  const paths = featurePaths(feature.dir);
  const delta = feature.has.delta
    ? await loadFile(paths.delta)
    : { errors: [], elements: [] as Elem[], relationships: [] };
  const taggedEls = delta.elements.filter((e) => e.tags.includes(feature.id));
  const taggedRels = delta.relationships.filter((r) => r.tags.includes(feature.id));

  const services = [];
  for (const svc of feature.services) {
    const specPath = featureSpecPaths(feature.dir, svc).spec;
    const reqs = existsSync(specPath) ? parseRequirements(await readFile(specPath, "utf8")) : [];
    services.push({
      id: svc,
      added: reqs.filter((r) => r.kind === "ADDED").length,
      modified: reqs.filter((r) => r.kind === "MODIFIED").length,
      removed: reqs.filter((r) => r.kind === "REMOVED").length,
      operations: [...new Set(reqs.flatMap((r) => r.operations))],
    });
  }

  if (json) {
    emitJson({
      type: "feature",
      id: feature.id,
      dirName: feature.dirName,
      path: repoPath(docsDir, feature.dir),
      archived: feature.archived,
      has: feature.has,
      delta: {
        elements: taggedEls.length,
        relationships: taggedRels.length,
        errors: delta.errors.map(errorText),
      },
      services,
    });
    return;
  }

  const state = feature.archived ? "archived" : "active";
  console.log(`${feature.id}   ${repoPath(docsDir, feature.dir)}   ${state}\n`);

  console.log("  artifacts");
  console.log(`    ${mark(feature.has.intent)} intent.md`);
  const deltaNote =
    delta.errors.length > 0
      ? `${delta.errors.length} error(s)`
      : `${count(taggedEls.length, "element")} · ${count(taggedRels.length, "relationship")} tagged ${feature.id}`;
  console.log(`    ${mark(feature.has.delta)} delta.likec4  ${feature.has.delta ? deltaNote : ""}`.trimEnd());

  if (services.length > 0) {
    console.log("\n  services");
    const width = Math.max(...services.map((s) => s.id.length));
    for (const s of services) {
      const ops = s.operations.length > 0 ? ` · ${s.operations.join(", ")}` : "";
      console.log(
        `    ${s.id.padEnd(width)}  +${s.added} ~${s.modified} -${s.removed} requirements${ops}`,
      );
    }
  }

  if (delta.errors.length > 0) {
    console.log("\n  delta errors");
    for (const e of delta.errors) console.log(`    ✗ ${errorText(e)}`);
  }
}

/* ------------------------------------------------------------------ */

function mark(present: boolean): string {
  return present ? "✓" : "✗";
}

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

function scenarioCount(reqs: Requirement[]): number {
  return reqs.reduce((n, r) => n + r.scenarios.length, 0);
}

function edgeNote(e: Edge): string {
  if (e.op) return `  ${e.op}`;
  return e.title ? `  "${e.title}"` : "";
}

function errorText(e: { message: string; line?: number }): string {
  return typeof e.line === "number" ? `L${e.line}: ${e.message}` : e.message;
}
