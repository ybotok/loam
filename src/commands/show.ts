import type { Command } from "commander";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { loadConfig } from "../core/config.js";
import { emitJson, fail, repoPath, reportNoConfig } from "../core/json.js";
import { listField, readFrontmatter, stringField } from "../core/frontmatter.js";
import { loadFile, serviceResolver, type Elem } from "../core/likec4.js";
import { readOpenapi } from "../core/openapi.js";
import {
  DocsRepoUnavailableError,
  featurePaths,
  featureSpecPaths,
  landscapePath,
  listServices,
  resolveFeature,
  servicePaths,
  type FeatureEntry,
} from "../core/repo.js";
import { parseRequirements, type Requirement } from "../core/spec.js";
import { docsRepoReady, reportDocsRepoError } from "./validate.js";

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
        fail(json, "invalid-option", `Unknown --type '${opts.type}'. Expected: service | feature.`);
        return;
      }
      const forced = opts.type as TargetType | undefined;

      const config = await loadConfig();
      if (!config) {
        reportNoConfig(json);
        return;
      }
      const { docsDir } = config;
      // "No service or feature 'x' in <dir>" is a lie when <dir> is not a docs
      // repo at all — the same refusal validate and list owe (docsRepoReady).
      // `docs`, not `services`: a feature is readable from a repo whose
      // services/ is missing, and if the target turns out to be a service the
      // enumeration below refuses with `services-missing` anyway.
      if (!docsRepoReady(json, docsDir, "docs")) return;

      try {
        // A feature id is distinctive (FEAT-101); a service name is arbitrary. When
        // both could match, the feature wins and --type forces the other reading.
        const feature =
          forced === "service" ? null : await resolveFeature(docsDir, target, "include");
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
        fail(json, "unknown-target", `No ${looked} '${target}' in ${docsDir}.`);
      } catch (err) {
        if (err instanceof DocsRepoUnavailableError) {
          reportDocsRepoError(json, err);
          return;
        }
        // An artifact that exists but cannot be read used to escape as a stack
        // trace (`internal` in --json), naming nothing. `show` reads one target,
        // so it has nothing to fall back on — but it can at least say WHICH file.
        const path = (err as NodeJS.ErrnoException).path;
        if (path === undefined) throw err;
        fail(
          json,
          "repository-unavailable",
          `${path} could not be read, so '${target}' cannot be shown. ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
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
    // The architecture-obligations axis. It was invisible here and in `list`,
    // which made the whole axis unnavigable: a service could carry twenty arch
    // requirements — the outbox, the retries, the alerts — and every command a
    // reader uses to find out what a service documents showed none of them.
    archSpec: existsSync(paths.archSpec),
    openapi: existsSync(paths.openapi),
    runbook: existsSync(paths.runbook),
    health: existsSync(paths.health),
  };

  const model = has.model
    ? await loadFile(paths.model)
    : { errors: [], elements: [], relationships: [] };
  const reqs = has.spec ? parseRequirements(await readFile(paths.spec, "utf8")) : [];
  const archReqs = has.archSpec ? parseRequirements(await readFile(paths.archSpec, "utf8")) : [];
  const adrs = await countAdrs(paths.adrsDir);
  // `readOpenapi`, not `operationIds`: a contract that exists but does not parse
  // came back from operationIds as an EMPTY operation list, indistinguishable
  // from a service with no endpoints. `show` is what a reader opens to find out
  // what a service offers, and answering "nothing" over a YAML error is the
  // worst possible lie for that question. `x-loam-remove` entries are filtered
  // out for the same reason validate filters them: they are deletion markers
  // from a delta, not operations anybody can call.
  const api = await readOpenapi(paths.openapi);
  const ops = api.ops.filter((o) => !o.remove).map((o) => o.id);

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

  const requirementJson = (r: Requirement): Record<string, unknown> => ({
    id: r.id,
    name: r.name,
    kind: r.kind,
    scenarios: r.scenarios.length,
    operations: r.operations,
    covers: r.covers,
  });

  if (json) {
    emitJson({
      type: "service",
      id,
      path: repoPath(docsDir, paths.dir),
      has,
      adrs,
      frontmatter: provenance,
      model: {
        elements: model.elements.length,
        relationships: model.relationships.length,
        errors: model.errors.map(errorText),
      },
      requirements: reqs.map(requirementJson),
      archSpec: {
        requirements: archReqs.length,
        scenarios: scenarioCount(archReqs),
        entries: archReqs.map(requirementJson),
      },
      openapi: {
        unreadable: api.unreadable,
        ...(api.error === undefined ? {} : { error: api.error }),
      },
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
  const specNote = (rs: Requirement[]): string =>
    `${count(rs.length, "requirement")} · ${count(scenarioCount(rs), "scenario")}`;
  console.log(`    ${mark(has.spec)} spec.md         ${has.spec ? specNote(reqs) : ""}`.trimEnd());
  console.log(
    `    ${mark(has.archSpec)} arch.spec.md    ${has.archSpec ? specNote(archReqs) : ""}`.trimEnd(),
  );
  const apiNote = api.unreadable ? "does not parse" : count(ops.length, "operation");
  console.log(`    ${mark(has.openapi)} openapi.yaml    ${has.openapi ? apiNote : ""}`.trimEnd());
  console.log(`    ${mark(has.runbook)} runbook.md`);
  console.log(`    ${mark(has.health)} health.yaml`);
  console.log(`    ${mark(adrs > 0)} adrs/           ${adrs > 0 ? count(adrs, "decision") : ""}`.trimEnd());

  const requirementLine = (r: Requirement): string => {
    const govern = r.operations.length > 0 ? `  → ${r.operations.join(", ")}` : "";
    const covers = r.covers.length > 0 ? `  covers ${r.covers.join(", ")}` : "";
    return `    ${r.name}  (${count(r.scenarios.length, "scenario")})${govern}${covers}`;
  };
  if (reqs.length > 0) {
    console.log("\n  requirements");
    for (const r of reqs) console.log(requirementLine(r));
  }
  if (archReqs.length > 0) {
    console.log("\n  arch requirements");
    for (const r of archReqs) console.log(requirementLine(r));
  }

  if (api.unreadable) {
    console.log("\n  operations");
    console.log(`    ✗ openapi.yaml does not parse — nothing here lists what ${id} offers`);
    if (api.error !== undefined) console.log(`      ${api.error}`);
  } else if (ops.length > 0) {
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
  // Edges are filed under the service an element is BOUND to, not under what the
  // box is titled — otherwise renaming a box empties this list without a word —
  // and an edge into a modelled container belongs to the service that owns it.
  const known = new Set((await listServices(docsDir)).map((s) => s.id));
  const svcOf = serviceResolver(land.elements, known);

  const inbound: Edge[] = [];
  const outbound: Edge[] = [];
  for (const r of land.relationships) {
    const edge = (service: string): Edge => ({
      service,
      op: r.op ?? null,
      title: r.title ?? null,
    });
    if (svcOf(r.target) === service) inbound.push(edge(svcOf(r.source)));
    else if (svcOf(r.source) === service) outbound.push(edge(svcOf(r.target)));
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

/** "-" for absent, matching `list`: ✗ is the error glyph here, and a missing runbook is not an error. */
function mark(present: boolean): string {
  return present ? "✓" : "-";
}

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

/** ADRs are markdown files under adrs/ — the same rule `list` counts by. */
async function countAdrs(dir: string): Promise<number> {
  if (!existsSync(dir)) return 0;
  const entries = await readdir(dir, { withFileTypes: true });
  return entries.filter((e) => e.isFile() && e.name.endsWith(".md")).length;
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
