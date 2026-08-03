import type { Command } from "commander";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { loadConfig } from "../core/config.js";
import { listField, readFrontmatter } from "../core/frontmatter.js";
import { emitJson, fail, reportNoConfig } from "../core/json.js";
import {
  elementService,
  loadFile,
  serviceOf,
  type Elem,
  type LikeC4Error,
  type LoadedDoc,
  type Rel,
} from "../core/likec4.js";
import {
  featurePaths,
  featureSpecPaths,
  featureSpecServices,
  featuresDir,
  landscapePath as landscapeFile,
  listFeatures,
  listServices,
  resolveFeature,
  servicePaths,
  type FeatureEntry,
} from "../core/repo.js";
import {
  countSeverity,
  reportValid,
  targetJson,
  targetValid,
  type Finding,
  type Severity,
  type TargetReport,
} from "../core/report.js";
import { parseRequirements, requirementsMissingScenarios, type Requirement } from "../core/spec.js";
import { operationIds } from "../core/openapi.js";
import { featureCoherence } from "../core/coherence.js";
import { gatesArchive } from "../core/issue.js";
import { featureProvenance, serviceProvenance } from "../core/provenance.js";

interface ValidateOptions {
  service?: string;
  feature?: string;
  all?: boolean;
  json?: boolean;
}

export function registerValidate(program: Command): void {
  program
    .command("validate")
    .description("Validate a service (C4 + requirement coverage) or a feature (delta + coverage)")
    .option("--service <id>", "service to validate (defaults to the configured service)")
    .option("--feature <id>", "validate a feature delta instead of a service")
    .option("--all", "validate every service and every active feature")
    .option("--json", "emit the machine contract instead of the human view")
    .action(async (opts: ValidateOptions) => {
      const json = opts.json === true;

      if (opts.all && (opts.service || opts.feature)) {
        fail(json, "invalid-option", "--all validates everything; drop --service/--feature.");
        return;
      }
      // Two targets is no target: silently validating only the feature taught
      // callers that --service had been honoured when it had been dropped.
      if (opts.service && opts.feature) {
        fail(json, "invalid-option", "--service and --feature name different targets; pass one or the other.");
        return;
      }

      const config = await loadConfig();
      if (!config) {
        reportNoConfig(json);
        return;
      }
      const { docsDir } = config;

      // `sources` are paths into a service's own repository, so they only mean
      // something when loam is standing in that repository — which is exactly
      // what loam.json's `service` records.
      const repoOf = (service: string): string | undefined =>
        config.service === service ? process.cwd() : undefined;

      const targets: TargetReport[] = [];
      // Services whose `sources` only their own repos can resolve — counted
      // under --all and reported ONCE (`sources.unverifiable-from-here`): from
      // the central docs repo the fleet gate checks zero of them, and without
      // this line that silence reads as "verified".
      let unverifiable = 0;
      if (opts.all) {
        // Parse the living landscape ONCE for the whole run: loadFile spins up
        // a fresh LikeC4 workspace per call, and paying that per service makes
        // the fleet's main CI command O(services) re-parses of the same file.
        const lp = landscapeFile(docsDir);
        const land = existsSync(lp) ? await loadFile(lp) : null;
        // The fleet-level cross-check first: it frames everything below it, and a
        // service nobody drew is worth knowing before its own findings scroll past.
        const landscape = await validateLandscape(docsDir, land);
        if (landscape) targets.push(landscape);
        for (const svc of await listServices(docsDir)) {
          targets.push(await validateService(docsDir, svc.id, repoOf(svc.id), land));
          if (repoOf(svc.id) === undefined && (await namesSources(docsDir, svc.id))) unverifiable += 1;
        }
        for (const feat of await listFeatures(docsDir)) {
          targets.push(await validateFeature(docsDir, feat));
        }
      } else if (opts.feature) {
        const feature = await resolveFeature(docsDir, opts.feature);
        if (!feature) {
          fail(json, "unknown-target", `No feature '${opts.feature}' under ${featuresDir(docsDir)}.`);
          return;
        }
        targets.push(await validateFeature(docsDir, feature));
      } else {
        const service = opts.service ?? config.service;
        if (!service) {
          fail(json, "invalid-option", "No service. Pass --service <id> or set it in loam.json.");
          return;
        }
        targets.push(await validateService(docsDir, service, repoOf(service)));
      }

      const valid = reportValid(targets);
      if (json) {
        emitJson({
          valid,
          summary: summary(targets),
          // --all only: single-target runs never counted, so a stable 0 there
          // would claim a check that did not happen.
          ...(opts.all ? { sourcesUnverifiableFromHere: unverifiable } : {}),
          targets: targets.map(targetJson),
        });
      } else {
        renderText(targets, opts.all === true, unverifiable);
      }
      if (!valid) process.exitCode = 1;
    });
}

function summary(targets: TargetReport[]): Record<string, number> {
  return {
    services: targets.filter((t) => t.kind === "service").length,
    features: targets.filter((t) => t.kind === "feature").length,
    errors: countSeverity(targets, "error"),
    warnings: countSeverity(targets, "warn"),
  };
}

/* ------------------------------------------------------------------ */
/* Checks — every one produces findings, none of them print            */
/* ------------------------------------------------------------------ */

/** C4 kinds that model people. A person is never a service directory. */
const ACTOR_KINDS = new Set(["person", "actor", "user"]);

/** Tag marking an element as somebody else's system — undocumented on purpose. */
const EXTERNAL_TAG = "external";

/**
 * The fleet cross-check: `services/` and the landscape both claim to name the
 * fleet, and nothing used to compare them. A directory nobody drew and an element
 * with nothing behind it were equally invisible.
 *
 * The two directions are graded differently because the evidence differs. A
 * directory that exists is a fact, so a landscape missing it is an error — every
 * view derived from that landscape is then incomplete. An element with no
 * directory may legitimately be someone else's system, so it warns, and
 * `#external` says "deliberately not ours" and silences it. An explicit
 * `metadata { service '<id>' }` naming nothing is an error either way: a binding
 * is a claim about this repo, not a guess at one.
 *
 * Returns null when there is no landscape to check against. `preloaded` is the
 * already-parsed landscape under --all — the same doc every service check gets.
 */
async function validateLandscape(
  docsDir: string,
  preloaded?: LoadedDoc | null,
): Promise<TargetReport | null> {
  const path = landscapeFile(docsDir);
  if (!existsSync(path)) return null;

  const findings: Finding[] = [];
  const report: TargetReport = { kind: "landscape", id: "landscape", findings };

  const land = preloaded ?? (await loadFile(path));
  if (land.errors.length > 0) {
    // Nothing may be concluded from a document that did not parse — in particular
    // not that every service is unmodelled.
    findings.push({
      severity: "error",
      code: "landscape.invalid",
      message: `landscape: architecture/landscape.likec4 has ${land.errors.length} error(s) — cross-check with services/ impossible`,
      details: land.errors.map(errorText),
    });
    return report;
  }

  const services = new Set((await listServices(docsDir)).map((s) => s.id));
  // Services are top-level; a dotted id is a container inside one.
  const drawn = land.elements.filter((e) => !e.id.includes("."));
  const modelled = new Set(drawn.map(elementService));

  for (const id of services) {
    if (modelled.has(id)) continue;
    findings.push({
      severity: "error",
      code: "landscape.service-unmodelled",
      subject: id,
      message: `landscape: services/${id}/ exists but nothing in architecture/landscape.likec4 models it — add an element, or bind one with metadata { service '${id}' }`,
    });
  }

  for (const e of drawn) {
    if (e.tags.includes(EXTERNAL_TAG)) continue;
    if (e.service !== undefined) {
      if (!services.has(e.service)) {
        findings.push({
          severity: "error",
          code: "landscape.binding-unknown",
          subject: e.service,
          message: `landscape: '${e.title}' binds to service '${e.service}', but services/${e.service}/ does not exist`,
        });
      }
      continue;
    }
    if (ACTOR_KINDS.has(e.kind.toLowerCase())) continue;
    if (services.has(e.title)) continue;
    findings.push({
      severity: "warn",
      code: "landscape.service-undocumented",
      subject: e.title,
      message: `landscape: '${e.title}' has no services/${e.title}/ — bind it with metadata { service '<id>' }, or tag it #${EXTERNAL_TAG} if it is not ours`,
    });
  }

  if (findings.length === 0) {
    findings.push({
      severity: "ok",
      code: "landscape.matched",
      message: `landscape: ${services.size} service(s) modelled — architecture/landscape.likec4 and services/ agree`,
    });
  }
  return report;
}

/**
 * A service's absences are graded by what each one proves.
 *
 * `service.unknown` (error): the directory itself does not exist — the id is a
 * typo until proven otherwise, so the hint names ids that DO exist and never
 * `loam adopt`, which would faithfully document the misspelling.
 * `service.no-model` (error): the directory is real but the C4 center is not —
 * nothing else has anywhere to hang, and adopt is the right hint.
 * `service.no-spec` / `service.no-openapi` (warn): the adopt brief marks both
 * required, but a fleet mid-rollout legitimately has part-adopted services —
 * the absence must stay visible without gating CI for months. The openapi warn
 * keeps quiet when the landscape proves nobody calls an operation on this
 * service: a worker with no API is not missing one.
 * `api.ops-unlinked` (warn): an OpenAPI and requirements that never name each
 * other pass every cross-axis check vacuously — a repo migrated from OpenSpec
 * does exactly that by default, and vacuous is not the same as checked.
 */
async function validateService(
  docsDir: string,
  service: string,
  repoDir?: string,
  preloaded?: LoadedDoc | null,
): Promise<TargetReport> {
  const findings: Finding[] = [];
  const report: TargetReport = { kind: "service", id: service, findings };
  const paths = servicePaths(docsDir, service);

  // A directory that does not exist is a different fact from a directory with
  // everything missing: validating a typo must say "typo", not "unadopted".
  if (!existsSync(paths.dir)) {
    const close = closeIds(service, (await listServices(docsDir)).map((s) => s.id));
    findings.push({
      severity: "error",
      code: "service.unknown",
      message:
        `No service directory at ${paths.dir}.` +
        (close.length > 0
          ? ` Did you mean: ${close.join(", ")}?`
          : " `loam list services` shows what exists."),
      text: { marker: false },
    });
    return report;
  }

  // C4 model. Without one there is nothing to validate — this is where `adopt` comes in.
  if (!existsSync(paths.model)) {
    findings.push({
      severity: "error",
      code: "service.no-model",
      message: `No C4 model at ${paths.model}. Run \`loam adopt\` for '${service}' first.`,
      text: { marker: false },
    });
    return report;
  }
  const { errors, elements, relationships } = await loadFile(paths.model);
  if (errors.length > 0) {
    findings.push({
      severity: "error",
      code: "c4.invalid",
      message: `${service}: C4 model has ${errors.length} error(s)`,
      details: errors.map(errorText),
    });
  } else {
    findings.push({
      severity: "ok",
      code: "c4.valid",
      message: `${service}: C4 model valid (${elements.length} elements · ${relationships.length} relationships)`,
    });
  }

  // The living landscape, parsed at most once per run: under --all the caller
  // hands in the doc it already loaded, single-service runs load on demand. It
  // serves two checks below — the no-openapi grace and the spine.
  const land =
    preloaded ?? (existsSync(landscapeFile(docsDir)) ? await loadFile(landscapeFile(docsDir)) : null);

  // Requirement coverage.
  let reqs: Requirement[] = [];
  if (existsSync(paths.spec)) {
    reqs = parseRequirements(await readFile(paths.spec, "utf8"));
    findings.push(coverageFinding(`${service}: requirements`, reqs));
  } else {
    findings.push({
      severity: "warn",
      code: "service.no-spec",
      message: `No living spec at ${paths.spec} — requirement coverage and API governance are unchecked`,
    });
  }

  // API coverage: every operation in openapi.yaml is governed by a requirement.
  const ops = await operationIds(paths.openapi);
  if (!existsSync(paths.openapi)) {
    // Quiet only on positive evidence — the landscape parsed and no edge calls
    // an operation on this service. A missing or broken landscape proves
    // nothing, so there the absence stays visible.
    const expected =
      land === null ||
      land.errors.length > 0 ||
      land.relationships.some((r) => r.op !== undefined && serviceOf(land.elements, r.target) === service);
    if (expected) {
      findings.push({
        severity: "warn",
        code: "service.no-openapi",
        message: `No OpenAPI contract at ${paths.openapi} — API coverage and the landscape spine are unchecked`,
      });
    }
  } else if (ops.length > 0) {
    const governed = new Set(reqs.flatMap((r) => r.operations));
    const orphans = ops.filter((op) => !governed.has(op));
    if (orphans.length === 0) {
      findings.push({
        severity: "ok",
        code: "api.covered",
        message: `${service}: API covered (${ops.length} operation(s) governed by requirements)`,
      });
    } else {
      findings.push({
        severity: "warn",
        code: "api.ungoverned",
        message: `${service}: ${orphans.length} operation(s) not governed by any requirement — ${orphans.join(", ")}`,
      });
    }
    // The migration-debt case: requirements exist, the API exists, and no
    // `Operations:` line ties them — every cross-axis check above and in
    // feature mode is vacuously green. Once per service, not per operation;
    // with zero requirements the spec (or its absence) is the finding instead.
    if (reqs.length > 0 && reqs.every((r) => r.operations.length === 0)) {
      findings.push({
        severity: "warn",
        code: "api.ops-unlinked",
        message: `${service}: openapi.yaml defines ${ops.length} operation(s) but no requirement links any — the API axis is unchecked for this service`,
      });
    }
  }

  // Landscape spine: cross-system edges calling THIS service must resolve to a real
  // operation in its OpenAPI — the C4↔API contract, checked in the living landscape,
  // not only in feature mode. Catches dangling / de-linked op edges.
  if (land !== null) {
    if (land.errors.length > 0) {
      // A living landscape that does not parse disables the C4↔API spine check —
      // that is a broken source of truth, not a skippable detail.
      findings.push({
        severity: "error",
        code: "spine.landscape-invalid",
        message: `${service}: landscape.likec4 has ${land.errors.length} error(s) — spine check impossible`,
        details: land.errors.map(errorText),
      });
    } else {
      // Which element IS this service is the binding's call, with the title as the
      // fallback — matching on the title alone means a renamed box silently drops
      // out of the spine, and the check goes on reporting nothing at all.
      const svcOf = (id: string): string => serviceOf(land.elements, id);
      const opset = new Set(ops);
      let checked = 0;
      let broken = 0;
      for (const r of land.relationships) {
        if (svcOf(r.target) !== service) continue;
        if (r.op !== undefined) {
          checked += 1;
          if (!opset.has(r.op)) {
            broken += 1;
            findings.push({
              severity: "error",
              code: "spine.op-undefined",
              message: `${service}: landscape edge ${svcOf(r.source)} → ${service} calls '${r.op}', not defined in ${service}'s OpenAPI`,
            });
          }
        } else if ((r.title ?? "").toLowerCase().startsWith("call")) {
          findings.push({
            severity: "warn",
            code: "spine.op-link-missing",
            message: `${service}: landscape edge ${svcOf(r.source)} → ${service} ("${r.title}") has no operation link (metadata { op })`,
          });
        }
      }
      if (broken === 0 && checked > 0) {
        findings.push({
          severity: "ok",
          code: "spine.resolved",
          message: `${service}: landscape spine (${checked} inbound call(s) resolve to OpenAPI)`,
        });
      }
    }
  }

  // Provenance last: who vouched for this, and what code it was written from.
  findings.push(...(await serviceProvenance(docsDir, service, { repoDir })));

  return report;
}

async function validateFeature(docsDir: string, feature: FeatureEntry): Promise<TargetReport> {
  const findings: Finding[] = [];
  const featureDir = feature.dir;
  const featureId = feature.id;

  // delta.likec4 parse + collect tagged edges
  let taggedRels: Rel[] = [];
  let elements: Elem[] = [];
  const deltaPath = featurePaths(featureDir).delta;
  if (existsSync(deltaPath)) {
    const res = await loadFile(deltaPath);
    if (res.errors.length > 0) {
      findings.push({
        severity: "error",
        code: "delta.invalid",
        message: `delta.likec4 has ${res.errors.length} error(s)`,
        details: res.errors.map(errorText),
      });
    } else {
      elements = res.elements;
      taggedRels = res.relationships.filter((r) => r.tags.includes(featureId));
      findings.push({
        severity: "ok",
        code: "delta.valid",
        message: `delta.likec4 valid (${res.elements.length} elements · ${res.relationships.length} relationships)`,
      });
    }
  }

  findings.push(...(await featureProvenance(featureDir, featureId)));

  // Requirement coverage across every per-service delta, and collect scenario text
  let scenarioText = "";
  for (const svc of await featureSpecServices(featureDir)) {
    const p = featureSpecPaths(featureDir, svc).spec;
    if (!existsSync(p)) continue;
    const raw = await readFile(p, "utf8");
    scenarioText += "\n" + raw.toLowerCase();
    findings.push({ ...coverageFinding(`${svc}: requirements`, parseRequirements(raw)), subject: svc });
  }

  // Arch-edge coverage (heuristic, warn-only): each new tagged edge should be named by a scenario.
  for (const r of taggedRels) {
    const target = serviceOf(elements, r.target);
    const covered = edgeCovered(target, r.title, scenarioText);
    findings.push({
      severity: covered ? "ok" : "warn",
      code: covered ? "archedge.covered" : "archedge.uncovered",
      subject: target,
      message: `${serviceOf(elements, r.source)} → ${target}  "${r.title ?? ""}"${covered ? "" : "  — no scenario names it"}`,
      text: { indent: 4, header: "arch-edge coverage (heuristic):" },
    });
  }

  // Coherence — cross-axis consistency (C4 ↔ requirements ↔ OpenAPI).
  const issues = await featureCoherence(docsDir, featureDir, featureId);
  if (issues.length === 0) {
    findings.push({
      severity: "ok",
      code: "coherence.ok",
      message: "coherence: ✓ C4 · requirements · OpenAPI agree",
      text: { indent: 2, marker: false },
    });
  } else {
    for (const i of issues) {
      findings.push({
        severity: i.severity,
        code: i.code,
        gates: gatesArchive(i),
        ...(i.subject === undefined ? {} : { subject: i.subject }),
        message: i.message,
        text: { indent: 4, header: "coherence:" },
      });
    }
  }

  return { kind: "feature", id: featureId, findings };
}

function coverageFinding(label: string, reqs: Requirement[]): Finding {
  const missing = requirementsMissingScenarios(reqs);
  if (missing.length === 0) {
    return {
      severity: "ok",
      code: "requirements.covered",
      message: `${label} covered (${reqs.length} requirement${reqs.length === 1 ? "" : "s"}, all with scenarios)`,
    };
  }
  return {
    severity: "error",
    code: "requirements.missing-scenarios",
    message: `${label}: ${missing.length} requirement(s) without a scenario`,
    details: missing.map((r) => r.name),
    text: { detailPrefix: "- " },
  };
}

/* ------------------------------------------------------------------ */
/* Text renderer                                                       */
/* ------------------------------------------------------------------ */

const MARKER: Record<Severity, string> = { ok: "✓", warn: "⚠", error: "✗" };

function renderText(targets: TargetReport[], all: boolean, unverifiable: number): void {
  for (const t of targets) {
    // A feature announces itself; a service's findings already carry its name.
    if (t.kind === "feature") console.log(t.id);
    let header: string | undefined;
    for (const f of t.findings) {
      const hint = f.text ?? {};
      if (hint.header && hint.header !== header) {
        header = hint.header;
        console.log(`  ${header}`);
      }
      const write = f.severity === "error" ? console.error : console.log;
      const marker = hint.marker === false ? "" : `${MARKER[f.severity]} `;
      write(`${" ".repeat(hint.indent ?? 0)}${marker}${f.message}`);
      for (const d of f.details ?? []) write(`    ${hint.detailPrefix ?? ""}${d}`);
    }
  }

  if (!all) return;
  const s = summary(targets);
  const plural = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? "" : "s"}`;
  console.log(
    `\n${plural(s.services!, "service")}, ${plural(s.features!, "feature")} — ` +
      `${plural(s.errors!, "error")}, ${plural(s.warnings!, "warning")}`,
  );
  // One line for the whole fleet, never one per service: honest about the blind
  // spot without drowning the report in a hundred copies of it.
  if (unverifiable > 0) {
    const whose = unverifiable === 1 ? "1 service's" : `${unverifiable} services'`;
    console.log(
      `⚠ sources.unverifiable-from-here: ${whose} sources can only be checked from their own repos`,
    );
  }
}

/* ------------------------------------------------------------------ */

/**
 * Existing ids near a misspelling — substring containment either way, else a
 * shared 3-character prefix. Deliberately dumb: no fuzzy library for one hint,
 * and every id offered is real, so the hint can never point at the typo itself.
 */
function closeIds(typo: string, ids: string[]): string[] {
  const t = typo.toLowerCase();
  return ids
    .filter((id) => {
      const i = id.toLowerCase();
      return i.includes(t) || t.includes(i) || (t.length >= 3 && i.startsWith(t.slice(0, 3)));
    })
    .slice(0, 5);
}

/** Does this service's living spec name any `sources`? The unverifiable-from-here count. */
async function namesSources(docsDir: string, service: string): Promise<boolean> {
  const spec = servicePaths(docsDir, service).spec;
  if (!existsSync(spec)) return false;
  return listField(await readFrontmatter(spec), "sources").length > 0;
}

/** Heuristic: an edge is "covered" if a scenario names the target or a keyword from the edge title. */
function edgeCovered(target: string, title: string | undefined, scenarioText: string): boolean {
  if (scenarioText.includes(target.toLowerCase())) return true;
  for (const token of (title ?? "").split(/[^A-Za-z0-9]+/)) {
    if (token.length >= 5 && scenarioText.includes(token.toLowerCase())) return true;
  }
  return false;
}

function errorText(e: LikeC4Error): string {
  return typeof e.line === "number" ? `L${e.line}: ${e.message}` : e.message;
}

export { targetValid };
