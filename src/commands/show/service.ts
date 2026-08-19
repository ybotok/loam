/**
 * One service as `loam show` presents it: its spec, its contract, and the
 * fleet edges into and out of it.
 *
 * Split from `./feature.ts` because a service and a feature answer different
 * questions — what a repository holds now, against what a change proposes —
 * and only the service view has to reach the landscape for its edges.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { FleetContext } from "../../core/fleet-context.js";
import { emitJson, repoPath } from "../../core/envelope/json.js";
import { listField, readFrontmatter, stringField } from "../../core/document/frontmatter.js";
import { loadFile, serviceResolver } from "../../core/c4/likec4.js";
import { readOpenapi } from "../../core/openapi/doc.js";
import type { PathableService } from "../../core/kernel/ids/service.js";
import { landscapePath, servicePaths } from "../../core/repo/paths.js";
import { listServices } from "../../core/repo/repo.js";
import { countMarkdown } from "../../core/repo/tree/fs.js";
import { parseRequirements } from "../../core/document/parse.js";
import { type Requirement } from "../../core/document/spec.js";
import { plural } from "../policy/format.js";
import { edgeNote, errorText, mark, scenarioCount } from "./marks.js";
import type { DocsDir } from "../../core/kernel/ids/dirs.js";

export interface Edge {
  service: string;
  op: string | null;
  title: string | null;
}

export async function showService(
  docsDir: DocsDir,
  id: PathableService,
  json: boolean,
  context: FleetContext,
): Promise<void> {
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
  const adrs = await countMarkdown(paths.adrsDir);
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

  const { inbound, outbound } = await landscapeEdges(docsDir, id, context);

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
      : `${plural(model.elements.length, "element")} · ${plural(model.relationships.length, "relationship")}`;
  console.log(`    ${mark(has.model)} model.likec4    ${has.model ? modelNote : ""}`.trimEnd());
  const specNote = (rs: Requirement[]): string =>
    `${plural(rs.length, "requirement")} · ${plural(scenarioCount(rs), "scenario")}`;
  console.log(`    ${mark(has.spec)} spec.md         ${has.spec ? specNote(reqs) : ""}`.trimEnd());
  console.log(
    `    ${mark(has.archSpec)} arch.spec.md    ${has.archSpec ? specNote(archReqs) : ""}`.trimEnd(),
  );
  const apiNote = api.unreadable ? "does not parse" : plural(ops.length, "operation");
  console.log(`    ${mark(has.openapi)} openapi.yaml    ${has.openapi ? apiNote : ""}`.trimEnd());
  console.log(`    ${mark(has.runbook)} runbook.md`);
  console.log(`    ${mark(has.health)} health.yaml`);
  console.log(`    ${mark(adrs > 0)} adrs/           ${adrs > 0 ? plural(adrs, "decision") : ""}`.trimEnd());

  const requirementLine = (r: Requirement): string => {
    const govern = r.operations.length > 0 ? `  → ${r.operations.join(", ")}` : "";
    const covers = r.covers.length > 0 ? `  covers ${r.covers.join(", ")}` : "";
    return `    ${r.name}  (${plural(r.scenarios.length, "scenario")})${govern}${covers}`;
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
export async function landscapeEdges(
  docsDir: DocsDir,
  service: string,
  context: FleetContext,
): Promise<{ inbound: Edge[]; outbound: Edge[] }> {
  const path = landscapePath(docsDir);
  if (!existsSync(path)) return { inbound: [], outbound: [] };
  const land = await loadFile(path);
  if (land.errors.length > 0) return { inbound: [], outbound: [] };
  // Edges are filed under the service an element is BOUND to, not under what the
  // box is titled — otherwise renaming a box empties this list without a word —
  // and an edge into a modelled container belongs to the service that owns it.
  const known = new Set((await listServices(docsDir, context)).map((s) => s.id));
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
