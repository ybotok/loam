import type { Command } from "commander";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { loadConfig } from "../core/config.js";
import { emitJson, fail, repoPath, reportNoConfig } from "../core/json.js";
import { elementService, loadFile, serviceOf, type Rel } from "../core/likec4.js";
import { featurePaths, featureSpecPaths, missingFeatureMessage, resolveFeature } from "../core/repo.js";
import { parseRequirements, type Requirement } from "../core/spec.js";

interface DeltaOptions {
  service?: string;
  json?: boolean;
}

/** One end of a feature edge, as seen from the projected service. */
interface Edge {
  service: string;
  op: string | null;
  title: string | null;
}

interface ArchSlice {
  isNew: boolean;
  inbound: Edge[];
  outbound: Edge[];
  errors: string[];
}

export function registerDelta(program: Command): void {
  program
    .command("delta")
    .argument("<featureId>", "feature id, e.g. FEAT-101")
    .description("Project a feature onto a service: why + requirement delta + C4 changes")
    .option("--service <id>", "service to project onto (defaults to the configured service)")
    .option("--json", "emit the machine contract instead of the human view")
    .action(async (featureId: string, opts: DeltaOptions) => {
      const json = opts.json === true;
      const config = await loadConfig();
      if (!config) {
        reportNoConfig(json);
        return;
      }
      const service = opts.service ?? config.service;
      if (!service) {
        fail(json, "invalid-option", "No service. Pass --service <id> or set it in loam.json.");
        return;
      }

      const feature = await resolveFeature(config.docsDir, featureId, "exclude");
      if (!feature) {
        fail(json, "unknown-target", await missingFeatureMessage(config.docsDir, featureId));
        return;
      }
      // Canonical id from here on — the delta's tags carry `#FEAT-5`, so a raw
      // `FEAT-5-slug` argument used to empty the architecture slice silently.
      const { id } = feature;
      const paths = featurePaths(feature.dir);

      // Why — business intent
      const intent = existsSync(paths.intent)
        ? stripFrontmatter(await readFile(paths.intent, "utf8")).trim()
        : null;

      // Requirement delta for this service (OpenSpec style), business and arch:
      // the same projection covers both axes, in the same shape, so the payload
      // stays one task — the arch requirements are the integration/ops half the
      // business ones never mention.
      const specPaths = featureSpecPaths(feature.dir, service);
      const reqs = existsSync(specPaths.spec)
        ? parseRequirements(await readFile(specPaths.spec, "utf8"))
        : [];
      const archReqs = existsSync(specPaths.archSpec)
        ? parseRequirements(await readFile(specPaths.archSpec, "utf8"))
        : [];

      // C4 architecture slice
      const arch = await archSlice(paths.delta, service, id);

      // An unparseable delta.likec4 empties the C4 slice, and a consumer
      // reading this projection as a task brief — the JSON payload and the
      // printed view alike — would take that as "no architecture change": the
      // vacuously-green pattern. The output stays as informative as ever (and
      // `ok` stays true under --json: the command ran); the exit code is what
      // stops a pipeline from building on it, so it is set BEFORE the format
      // fork — the guard is about the delta, not about how it is rendered.
      if (arch.errors.length > 0) process.exitCode = 1;

      if (json) {
        const reqJson = (r: Requirement): Record<string, unknown> => ({
          kind: r.kind,
          id: r.id,
          name: r.name,
          text: r.text.join("\n").trim(),
          operations: r.operations,
          covers: r.covers,
          // Scenarios go out verbatim: they are the acceptance criteria and the
          // source for the tests whoever picks this up is expected to write.
          scenarios: r.scenarios.map((s) => ({ name: s.name, lines: s.lines })),
        });
        emitJson({
          feature: id,
          service,
          path: repoPath(config.docsDir, feature.dir),
          intent,
          requirements: reqs.map(reqJson),
          // Same shape, separate section: an arch requirement's scenarios are
          // integration/ops tests, and a consumer must not have to parse prose
          // to tell the two apart.
          archRequirements: archReqs.map(reqJson),
          architecture: arch,
        });
        return;
      }

      console.log(`${id} · ${service}\n`);
      if (intent) {
        console.log(indent(intent, "  "));
        console.log();
      }
      if (existsSync(specPaths.spec)) printRequirements(reqs, "Requirements");
      else console.log("Requirements: (none for this service)\n");
      if (existsSync(specPaths.archSpec)) printRequirements(archReqs, "Arch requirements");
      if (existsSync(paths.delta)) printArchSlice(arch, service);
    });
}

/** The feature's tagged edges around one service, plus whether the service is new. */
async function archSlice(deltaPath: string, service: string, featureId: string): Promise<ArchSlice> {
  const empty: ArchSlice = { isNew: false, inbound: [], outbound: [], errors: [] };
  if (!existsSync(deltaPath)) return empty;

  const { errors, elements, relationships } = await loadFile(deltaPath);
  if (errors.length > 0) {
    return { ...empty, errors: errors.map((e) => (typeof e.line === "number" ? `L${e.line}: ${e.message}` : e.message)) };
  }

  // Which service an element stands for is the binding's call, not the title's.
  const svcOf = (id: string): string => serviceOf(elements, id);
  const edge = (r: Rel, other: string): Edge => ({
    service: other,
    op: r.op ?? null,
    title: r.title ?? null,
  });
  const featRels = relationships.filter((r) => r.tags.includes(featureId));

  return {
    isNew: elements.some((e) => elementService(e) === service && e.tags.includes(featureId)),
    inbound: featRels.filter((r) => svcOf(r.target) === service).map((r) => edge(r, svcOf(r.source))),
    outbound: featRels.filter((r) => svcOf(r.source) === service).map((r) => edge(r, svcOf(r.target))),
    errors: [],
  };
}

function stripFrontmatter(md: string): string {
  if (!md.startsWith("---")) return md;
  const close = md.indexOf("\n---", 3);
  if (close === -1) return md;
  const nl = md.indexOf("\n", close + 1);
  return nl === -1 ? "" : md.slice(nl + 1).trimStart();
}

function printRequirements(reqs: Requirement[], label: string): void {
  if (reqs.length === 0) {
    console.log(`${label}: (none)\n`);
    return;
  }
  console.log(`${label}:`);
  for (const r of reqs) {
    const tag = r.kind === "BASE" ? "" : `[${r.kind}] `;
    const n = r.scenarios.length;
    console.log(`  ${tag}${r.name}  (${n} scenario${n === 1 ? "" : "s"})`);
    for (const s of r.scenarios) console.log(`      · ${s.name}`);
  }
  console.log();
}

function printArchSlice(arch: ArchSlice, service: string): void {
  if (arch.errors.length > 0) {
    console.log("Architecture: delta.likec4 has errors — run `loam validate`.");
    return;
  }
  console.log("Architecture:");
  if (arch.isNew) console.log(`  NEW service — create ${service}`);
  if (arch.outbound.length > 0) {
    console.log("  Outbound (new calls from this service):");
    for (const e of arch.outbound) console.log(`    → ${e.service}  "${e.title ?? ""}"`);
  }
  if (arch.inbound.length > 0) {
    console.log("  Inbound (this service is newly called):");
    for (const e of arch.inbound) console.log(`    ← ${e.service}  "${e.title ?? ""}"`);
  }
  if (!arch.isNew && arch.outbound.length === 0 && arch.inbound.length === 0) {
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
