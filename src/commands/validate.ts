import type { Command } from "commander";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { loadConfig } from "../core/config.js";
import { emitJson, emitJsonError, reportNoConfig } from "../core/json.js";
import {
  elementService,
  loadFile,
  serviceOf,
  type Elem,
  type LikeC4Error,
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
        return fail(json, "invalid-option", "--all validates everything; drop --service/--feature.");
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
      if (opts.all) {
        // The fleet-level cross-check first: it frames everything below it, and a
        // service nobody drew is worth knowing before its own findings scroll past.
        const landscape = await validateLandscape(docsDir);
        if (landscape) targets.push(landscape);
        for (const svc of await listServices(docsDir)) {
          targets.push(await validateService(docsDir, svc.id, repoOf(svc.id)));
        }
        for (const feat of await listFeatures(docsDir)) {
          targets.push(await validateFeature(docsDir, feat));
        }
      } else if (opts.feature) {
        const feature = await resolveFeature(docsDir, opts.feature);
        if (!feature) {
          return fail(json, "unknown-target", `No feature '${opts.feature}' under ${featuresDir(docsDir)}.`);
        }
        targets.push(await validateFeature(docsDir, feature));
      } else {
        const service = opts.service ?? config.service;
        if (!service) {
          return fail(json, "invalid-option", "No service. Pass --service <id> or set it in loam.json.");
        }
        targets.push(await validateService(docsDir, service, repoOf(service)));
      }

      const valid = reportValid(targets);
      if (json) {
        emitJson({
          valid,
          summary: summary(targets),
          targets: targets.map(targetJson),
        });
      } else {
        renderText(targets, opts.all === true);
      }
      if (!valid) process.exitCode = 1;
    });
}

function fail(json: boolean, code: "invalid-option" | "unknown-target", message: string): void {
  if (json) {
    emitJsonError(code, message);
    return;
  }
  console.error(message);
  process.exitCode = 1;
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
 * Returns null when there is no landscape to check against.
 */
async function validateLandscape(docsDir: string): Promise<TargetReport | null> {
  const path = landscapeFile(docsDir);
  if (!existsSync(path)) return null;

  const findings: Finding[] = [];
  const report: TargetReport = { kind: "landscape", id: "landscape", findings };

  const land = await loadFile(path);
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

async function validateService(
  docsDir: string,
  service: string,
  repoDir?: string,
): Promise<TargetReport> {
  const findings: Finding[] = [];
  const report: TargetReport = { kind: "service", id: service, findings };
  const paths = servicePaths(docsDir, service);

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

  // Requirement coverage.
  let reqs: Requirement[] = [];
  if (existsSync(paths.spec)) {
    reqs = parseRequirements(await readFile(paths.spec, "utf8"));
    findings.push(coverageFinding(`${service}: requirements`, reqs));
  }

  // API coverage: every operation in openapi.yaml is governed by a requirement.
  const ops = await operationIds(paths.openapi);
  if (ops.length > 0) {
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
  }

  // Landscape spine: cross-system edges calling THIS service must resolve to a real
  // operation in its OpenAPI — the C4↔API contract, checked in the living landscape,
  // not only in feature mode. Catches dangling / de-linked op edges.
  const landscapePath = landscapeFile(docsDir);
  if (existsSync(landscapePath)) {
    const land = await loadFile(landscapePath);
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

function renderText(targets: TargetReport[], all: boolean): void {
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
}

/* ------------------------------------------------------------------ */

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
