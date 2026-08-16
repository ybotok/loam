import type { Command } from "commander";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import { loadConfig } from "../core/envelope/config.js";
import { InvalidIdError, assertServiceId } from "../core/kernel/ids.js";
import { emitJson, emitJsonError, fail, repoPath, reportNoConfig } from "../core/envelope/json.js";
import { elementService, loadFile, serviceOf, type Elem, type LoadedDoc, type Rel } from "../core/c4/likec4.js";
import { readOpenapi, type Operation } from "../core/openapi/doc.js";
// The summary walk below descends four levels into a document nobody has
// validated, and `isRecord` is what it asks at each step: a cast there would
// assert a shape the parser never promised, and a sequence or a scalar in any of
// those slots would be indexed as a mapping.
import { isRecord } from "../core/kernel/records.js";
import { compareIds, nearestIds } from "../core/repo/entries.js";
import { featurePaths, featureSpecPaths } from "../core/repo/paths.js";
import { DocsRepoUnavailableError } from "../core/repo/state.js";
import { listServices, missingFeatureMessage, resolveFeature } from "../core/repo/repo.js";
import { parseRequirements, type Requirement } from "../core/document/spec.js";

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

/**
 * One operation the feature's OpenAPI delta defines for this service. The
 * projection is a task brief, and "implement createSplit" without the path and
 * the method is not a task — it is a name to go look up in a file the reader
 * was not told about.
 */
interface ApiChange {
  path: string;
  method: string;
  operationId: string;
  summary: string | null;
  /** `x-loam-remove: true` — this operation is being retired, not added. */
  remove: boolean;
}

/**
 * The contract axis of the brief: the operations, and whether the document they
 * came from could be read at all.
 *
 * The two have to travel together. A feature `openapi.yaml` that does not parse
 * yields zero operations, which is the same answer as a delta that genuinely
 * changes no endpoints — and this projection is a task brief, so "no contract
 * work here" over a YAML error is the vacuously-green trap the architecture
 * axis already guards against.
 */
interface ApiSlice {
  changes: ApiChange[];
  unreadable: boolean;
  /** The parser's own message, when there is one to quote back. */
  error?: string;
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

      // The id grammar first, and on the RAW argument: `--service ../../etc`
      // reaches `featureSpecPaths` and reads from outside the feature directory.
      // One grammar for the whole tool (core/kernel/ids.ts).
      if (opts.service !== undefined) {
        try {
          assertServiceId(opts.service, "--service");
        } catch (err) {
          if (!(err instanceof InvalidIdError)) throw err;
          fail(json, "invalid-option", err.message);
          return;
        }
      }

      // The feature is resolved BEFORE the service is chosen, because every
      // sentence about the service ("which ones does this feature touch?") is
      // only answerable once the feature is known.
      const feature = await resolveFeature(config.docsDir, featureId, "exclude");
      if (!feature) {
        fail(json, "unknown-target", await missingFeatureMessage(config.docsDir, featureId));
        return;
      }
      // Canonical id from here on — the delta's tags carry `#FEAT-5`, so a raw
      // `FEAT-5-slug` argument used to empty the architecture slice silently.
      const { id } = feature;
      const paths = featurePaths(feature.dir);

      const deltaDoc = existsSync(paths.delta) ? await loadFile(paths.delta) : null;
      // Services the feature speaks about at all: one with a requirement delta,
      // or one its C4 delta introduces. This is the list a refusal quotes.
      const featureServices = [
        ...new Set([...feature.services, ...introducedServices(deltaDoc, id)]),
      ].sort(compareIds);

      const service = opts.service ?? config.service;
      if (!service) {
        // The refusal NAMES the choices. "No service. Pass --service <id>" told
        // the reader the shape of the flag and nothing about the answer, so the
        // next step was always to go list the feature's specs/ by hand — and an
        // agent had no way to recover at all. The list rides the JSON envelope
        // for the same reason.
        const message =
          `No service to project ${id} onto. Pass --service <id> or set 'service' in loam.json.` +
          (featureServices.length === 0
            ? ` ${id} carries no per-service delta yet.`
            : ` ${id} touches: ${featureServices.join(", ")}.`);
        if (json) emitJsonError("invalid-option", message, { feature: id, services: featureServices });
        else {
          console.error(message);
          process.exitCode = 1;
        }
        return;
      }

      // A service nobody has heard of produces a perfectly plausible EMPTY
      // report — no requirements, no edges, "no architecture change" — which an
      // agent consuming this as a task brief reads as "nothing to do here".
      // A typo must never be indistinguishable from a finished service.
      const living = await livingServices(config.docsDir);
      if (!featureServices.includes(service) && !living.includes(service)) {
        const near = nearestIds(service, [...new Set([...featureServices, ...living])]);
        fail(
          json,
          "unknown-target",
          `No service '${service}': it is neither a services/${service}/ in the docs repo nor a service ${id} touches` +
            (featureServices.length === 0 ? "" : ` (${featureServices.join(", ")})`) +
            (near.length === 0 ? "." : ` — did you mean ${near.map((n) => `'${n}'`).join(" or ")}?`),
        );
        return;
      }

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

      // The contract axis. Until now no command surfaced it at all: the feature's
      // openapi.yaml was read by validate and by archive, and the one command
      // whose output IS the implementation task never mentioned it — so "add the
      // endpoint" was the half of the work the brief left out.
      const api = await apiChanges(specPaths.openapi);

      // C4 architecture slice
      const arch = archSlice(deltaDoc, service, id);

      // An unparseable delta.likec4 empties the C4 slice, and a consumer
      // reading this projection as a task brief — the JSON payload and the
      // printed view alike — would take that as "no architecture change": the
      // vacuously-green pattern. The output stays as informative as ever (and
      // `ok` stays true under --json: the command ran); the exit code is what
      // stops a pipeline from building on it, so it is set BEFORE the format
      // fork — the guard is about the delta, not about how it is rendered.
      //
      // The contract axis fails the same way and now earns the same guard: an
      // openapi.yaml that does not parse projected as an empty operation list,
      // and nothing upstream catches it either — `loam validate` grades
      // `openapi.invalid` on LIVING service contracts only, never on a
      // feature's delta.
      if (arch.errors.length > 0 || api.unreadable) process.exitCode = 1;

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
          services: featureServices,
          path: repoPath(config.docsDir, feature.dir),
          intent,
          requirements: reqs.map(reqJson),
          // Same shape, separate section: an arch requirement's scenarios are
          // integration/ops tests, and a consumer must not have to parse prose
          // to tell the two apart.
          archRequirements: archReqs.map(reqJson),
          api: api.changes,
          // `api` stays exactly the operations array it has always been — a
          // consumer indexing it must not have to learn a new shape — so the
          // readability of the document rides alongside as its own key,
          // spelled the way `loam show` already spells it for a living
          // contract. Additive, which the envelope permits (core/envelope/json.ts).
          openapi: {
            unreadable: api.unreadable,
            ...(api.error === undefined ? {} : { error: api.error }),
          },
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
      if (existsSync(specPaths.openapi)) printApi(api);
      if (existsSync(paths.delta)) printArchSlice(arch, service);
    });
}

/** Every service in the docs repo, or none when there is no docs repo to ask. */
async function livingServices(docsDir: string): Promise<string[]> {
  try {
    return (await listServices(docsDir)).map((s) => s.id);
  } catch (err) {
    // "There is no docs repo at all" is a different diagnosis with its own
    // command (`loam doctor`); turning it into "unknown service" here would
    // send the reader after a typo that is not there.
    if (!(err instanceof DocsRepoUnavailableError)) throw err;
    return [];
  }
}

/** Services the feature's C4 delta introduces — its own tagged top-level elements. */
function introducedServices(doc: LoadedDoc | null, featureId: string): string[] {
  if (doc === null || doc.errors.length > 0) return [];
  return doc.elements.filter((e: Elem) => e.tags.includes(featureId)).map(elementService);
}

/**
 * The feature's OpenAPI delta for one service, as slots rather than names.
 *
 * The operation set comes from core/openapi/doc.ts — the same structure-aware reader
 * every other check uses, so this view cannot see an operation validate does not.
 * `summary` is the one field that reader does not carry, and it is the sentence
 * an implementer most wants, so it is looked up by the path+method the reader
 * already resolved: a second read of the same document, never a second opinion
 * about what an operation IS.
 */
async function apiChanges(openapiPath: string): Promise<ApiSlice> {
  if (!existsSync(openapiPath)) return { changes: [], unreadable: false };
  // `readOpenapi`, not `operations`: the operation list alone cannot tell a
  // contract that defines nothing from one that could not be read, and this is
  // the command whose output IS the implementation task.
  const api = await readOpenapi(openapiPath);
  if (api.unreadable) {
    return { changes: [], unreadable: true, ...(api.error === undefined ? {} : { error: api.error }) };
  }
  const ops = api.ops;
  if (ops.length === 0) return { changes: [], unreadable: false };
  let doc: unknown;
  try {
    doc = parseYaml(await readFile(openapiPath, "utf8"));
  } catch {
    // Unreadable is impossible here (the reader above said otherwise), but a
    // summary is decoration and must never be the reason a task brief fails to
    // print.
    doc = null;
  }
  const summaryOf = (op: Operation): string | null => {
    if (!isRecord(doc)) return null;
    const paths = doc["paths"];
    if (!isRecord(paths)) return null;
    const item = paths[op.path];
    if (!isRecord(item)) return null;
    const entry = item[op.method];
    if (!isRecord(entry)) return null;
    const summary = entry["summary"];
    return typeof summary === "string" && summary.length > 0 ? summary : null;
  };
  return {
    changes: ops
      .map((op): ApiChange => ({
        path: op.path,
        method: op.method.toUpperCase(),
        operationId: op.id,
        summary: summaryOf(op),
        remove: op.remove,
      }))
      .sort((a, b) => compareIds(a.path, b.path) || compareIds(a.method, b.method)),
    unreadable: false,
  };
}

/** The feature's tagged edges around one service, plus whether the service is new. */
function archSlice(doc: LoadedDoc | null, service: string, featureId: string): ArchSlice {
  const empty: ArchSlice = { isNew: false, inbound: [], outbound: [], errors: [] };
  if (doc === null) return empty;

  const { errors, elements, relationships } = doc;
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

/**
 * The requirement delta, in full.
 *
 * The text view used to print headings and scenario NAMES only, which made it a
 * table of contents for a file the reader then had to open — while `--json`
 * carried the requirement body and the Given/When/Then lines verbatim. The two
 * are the same briefing, so they carry the same content: a person reading this
 * in a terminal is being asked to implement it, exactly like the agent reading
 * the payload.
 */
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
    const body = r.text.join("\n").trim();
    if (body.length > 0) console.log(indent(body, "    "));
    if (r.operations.length > 0) console.log(`    Operations: ${r.operations.join(", ")}`);
    if (r.covers.length > 0) console.log(`    Covers: ${r.covers.join(", ")}`);
    for (const s of r.scenarios) {
      console.log(`\n    Scenario: ${s.name}`);
      // Verbatim, bullets and markdown emphasis included: these lines are the
      // acceptance criteria, and paraphrasing them here would put a second
      // wording of the contract in front of whoever implements it.
      for (const line of s.lines) console.log(`      ${line}`);
    }
    console.log();
  }
}

function printApi(api: ApiSlice): void {
  if (api.unreadable) {
    // Worded like `loam show`'s answer for the same failure on a living
    // contract, and deliberately WITHOUT a "run `loam validate`" hint: validate
    // grades `openapi.invalid` on living service contracts only, so it has
    // nothing to say about this file and sending the reader there is a dead end.
    console.log("API: openapi.yaml does not parse");
    if (api.error !== undefined) console.log(`  ${api.error}`);
    console.log();
    return;
  }
  if (api.changes.length === 0) {
    console.log("API: (the openapi delta defines no operations)\n");
    return;
  }
  console.log("API (this feature's openapi.yaml for the service):");
  for (const op of api.changes) {
    const marker = op.remove ? "REMOVE " : "";
    console.log(
      `  ${marker}${op.method} ${op.path}  ${op.operationId}${op.summary === null ? "" : ` — ${op.summary}`}`,
    );
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
