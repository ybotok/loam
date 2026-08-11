import type { Command } from "commander";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { agentsStaleFinding } from "../core/agent/agents-stamp.js";
import { inOrder } from "../core/kernel/concurrency.js";
import type { RawServiceId } from "../core/kernel/ids.js";
import { resolveServiceTarget } from "../core/repo/service-target.js";
import { loadConfig } from "../core/envelope/config.js";
import { listField, readFrontmatter } from "../core/document/frontmatter.js";
import { emitJson, fail, NO_SERVICE_MESSAGE, reportNoConfig } from "../core/envelope/json.js";
import {
  elementService,
  loadFile,
  serviceResolver,
  type Elem,
  type LikeC4Error,
  type LoadedDoc,
  type Rel,
} from "../core/c4/likec4.js";
import { type FeatureEntry } from "../core/repo/entries.js";
import { featurePaths, featureSpecPaths, servicePaths, SPEC_AXES } from "../core/repo/paths.js";
import { DocsRepoUnavailableError, docsRepoState } from "../core/repo/state.js";
import { agentsPath as agentsFile, landscapePath as landscapeFile } from "../core/repo/paths.js";
import { featureSpecServices, listFeatures, listServices, missingFeatureMessage, resolveFeature, serviceIdFindings } from "../core/repo/repo.js";
import {
  countSeverity,
  reportValid,
  SEVERITY_MARK,
  targetJson,
  targetValid,
  type Finding,
  type TargetReport,
} from "../core/vocabulary/report.js";
import {
  parseRequirements,
  requirementIdProblems,
  requirementsMissingScenarios,
  steplessFindings,
  type Requirement,
} from "../core/document/spec.js";
import { readOpenapi } from "../core/openapi.js";
import { producersByMessage, readAsyncapi, slotsOf } from "../core/asyncapi.js";
import { deltaServiceUnknownFinding, featureCoherence } from "../core/coherence.js";
import { gatesArchive } from "../core/vocabulary/issue.js";
import {
  emptySourcesMessage,
  expandSourceFiles,
  featureProvenance,
  missingSources,
  patternSources,
  serviceProvenance,
  unsafeSources,
} from "../core/provenance.js";
import {
  closeIds,
  coversCandidates,
  coversEdge,
  coversElement,
  entryResolves,
  parseCoversEntry,
  type CoverageScope,
  type CoversEntry,
} from "../core/c4/arch.js";
import { gherkinFindings } from "../core/gherkin.js";
import { readHealth } from "../core/vocabulary/health.js";
import { LOAM_VERSION } from "../core/envelope/version.js";
import {
  FleetContext,
  documentConflictFinding,
  landscapeConflictFinding,
} from "../core/fleet-context.js";
import {
  docsRepoReady,
  reportDocsRepoError,
  reportRepositoryUnavailable,
} from "./docs-repo-gate.js";
import { plural } from "./format.js";

interface ValidateOptions {
  service?: string;
  feature?: string;
  all?: boolean;
  strict?: boolean;
  errorsOnly?: boolean;
  json?: boolean;
}

export function registerValidate(program: Command): void {
  program
    .command("validate")
    .argument("[target]", "service or feature id (a feature wins when both match; --service/--feature force the reading)")
    .description("Validate a service (C4 + requirement coverage) or a feature (delta + coverage)")
    .option("--service <id>", "service to validate (defaults to the configured service)")
    .option("--feature <id>", "validate a feature delta instead of a service")
    .option("--all", "validate every service and every active feature")
    .option("--strict", "exit 1 on any warning too — a per-invocation CI lever; the report and --json payload do not change")
    .option("--errors-only", "print only errors and warnings — a rendering lever; the --json payload does not change")
    .option("--json", "emit the machine contract instead of the human view")
    .action(async (target: string | undefined, opts: ValidateOptions) => {
      const json = opts.json === true;

      if (target !== undefined && (opts.all || opts.service || opts.feature)) {
        fail(json, "invalid-option", `'${target}' already names the target; drop --all/--service/--feature.`);
        return;
      }
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
      // Before anything is enumerated: a docsDir that is not a docs repo must
      // refuse, not report an empty fleet. See docsRepoReady. `--feature` is the
      // one mode that never enumerates services, so it asks for less.
      if (!docsRepoReady(json, docsDir, opts.feature ? "docs" : "services")) return;
      // One invocation, one filesystem snapshot. Nothing is global: a later
      // command gets a fresh index and therefore cannot observe stale files.
      const fleet = new FleetContext();

      // `sources` are paths into a service's own repository, so they only mean
      // something when loam is standing in that repository — which is exactly
      // what loam.json's `service` records.
      const repoOf = (service: string): string | undefined =>
        config.service === service ? process.cwd() : undefined;

      /** One service target, from a name the enumeration or the grammar approved. */
      const serviceTarget = (id: RawServiceId): Promise<TargetReport> =>
        guarded({ kind: "service", id }, () =>
          validateService({ docsDir, service: id, repoDir: repoOf(id), gherkinDir: config.gherkinDir, fleet }),
        );

      const targets: TargetReport[] = [];
      /** What the positional argument turned out to name, for the JSON payload. */
      let resolvedKind: "service" | "feature" | undefined;

      try {
        if (opts.all) {
          // Parse the living landscape ONCE for the whole run: loadFile spins up
          // a fresh LikeC4 workspace per call, and paying that per service makes
          // the fleet's main CI command O(services) re-parses of the same file.
          const lp = landscapeFile(docsDir);
          const land = existsSync(lp) ? await readLandscape(() => fleet.loadLikeC4(lp)) : null;
          // The fleet-level cross-check first: it frames everything below it, and a
          // service nobody drew is worth knowing before its own findings scroll past.
          targets.push(await validateLandscape(docsDir, land, fleet));
          const landscape = targets[0]!;
          // The agent contract check, --all only: AGENTS.md is written once and
          // never refreshed (the ownership contract), so the one thing the
          // docs-repo-wide mode owes it is detection — a stamp older than the
          // binary means agents are branching on tables the binary no longer
          // honours. It grades the repo, not any service, so it rides on the
          // landscape target.
          const agentsPath = agentsFile(docsDir);
          const agents = agentsStaleFinding(
            existsSync(agentsPath) ? await readFile(agentsPath, "utf8") : null,
            LOAM_VERSION,
          );
          if (agents !== null) landscape.findings.push(agents);
          targets.push(
            ...(await inOrder(await listServices(docsDir, fleet), (svc) =>
              guarded({ kind: "service", id: svc.id }, () =>
                validateService({
                  docsDir,
                  service: svc.id,
                  repoDir: repoOf(svc.id),
                  preloaded: land,
                  gherkinDir: config.gherkinDir,
                  fleet,
                  landscapeReported: true,
                }),
              ),
            )),
          );
          targets.push(
            ...(await inOrder(await listFeatures(docsDir, {}, fleet), (feat) =>
              guarded({ kind: "feature", id: feat.id }, () =>
                validateFeature(docsDir, feat, land, fleet),
              ),
            )),
          );
        } else if (opts.feature) {
          const feature = await resolveFeature(docsDir, opts.feature, "exclude", fleet);
          if (!feature) {
            fail(json, "unknown-target", await missingFeatureMessage(docsDir, opts.feature, fleet));
            return;
          }
          targets.push(
            await guarded({ kind: "feature", id: feature.id }, () =>
              validateFeature(docsDir, feature, undefined, fleet),
            ),
          );
        } else if (target !== undefined) {
          // The positional reads the way `show` reads one: try the feature first
          // (ids like FEAT-101 are distinctive, service names are arbitrary), then
          // the service. --service/--feature stay as the explicit spellings for a
          // name that could be both — and when both readings exist, the run says
          // so out loud instead of silently taking one (`target.ambiguous`).
          const feature = await resolveFeature(docsDir, target, "exclude", fleet);
          const isService = (await listServices(docsDir, fleet)).some((s) => s.id === target);
          if (feature) {
            resolvedKind = "feature";
            const report = await guarded({ kind: "feature", id: feature.id }, () =>
              validateFeature(docsDir, feature, undefined, fleet),
            );
            if (isService) report.findings.unshift(ambiguousTarget(target, "feature"));
            targets.push(report);
          } else {
            // Neither reading exists. An archived feature is its own diagnosis
            // ("already archived", not "no such thing"); anything else reads as a
            // service, so the did-you-mean hints in service.unknown fire.
            if (!isService && (await resolveFeature(docsDir, target, "only", fleet)) !== null) {
              fail(json, "unknown-target", await missingFeatureMessage(docsDir, target, fleet));
              return;
            }
            resolvedKind = "service";
            const resolved = await resolveServiceTarget(docsDir, target, "target", fleet);
            if (!resolved.ok) return fail(json, "invalid-option", resolved.problem);
            targets.push(await serviceTarget(resolved.id));
          }
        } else {
          const service = opts.service ?? config.service;
          if (!service) {
            fail(json, "invalid-option", NO_SERVICE_MESSAGE);
            return;
          }
          const resolved = await resolveServiceTarget(docsDir, service, "--service", fleet);
          if (!resolved.ok) return fail(json, "invalid-option", resolved.problem);
          targets.push(await serviceTarget(resolved.id));
        }
      } catch (err) {
        // The docs repo went away between the gate above and the enumeration.
        if (err instanceof DocsRepoUnavailableError) {
          reportDocsRepoError(json, err);
          return;
        }
        // An IO failure that `guarded` could not localise to one target — it
        // happened in the ENUMERATION, which reads every living spec's
        // frontmatter to build the service list. There is no partial report to
        // give: without the list, no service was checked, including the ones
        // that are fine. Say which file, and refuse; the one thing that must
        // not happen is a stack trace on stdout's sibling stream and an
        // `internal` envelope that names nothing.
        reportRepositoryUnavailable(
          json,
          err,
          "the service list itself is unknown and nothing was validated",
          docsDir,
        );
        return;
      }

      // Counted off the findings rather than alongside them, so the rollup line
      // and the per-service findings can never disagree about how many services
      // this run could not check.
      //
      // Counted by SUBJECT, not by finding: a service whose spec.md and
      // arch.spec.md both name `sources` raises two findings — each document
      // has its own list and its own answer — but it is one service nobody
      // here can check, and "2 services' sources" over a fleet of one is a
      // number that sends the reader looking for a service that does not exist.
      const unverifiable = new Set(
        targets.flatMap((t) =>
          t.findings.filter((f) => f.code === UNVERIFIABLE).map((f) => f.subject ?? t.id),
        ),
      ).size;
      const valid = reportValid(targets);
      const capped = targets.map(capDetails);
      if (json) {
        emitJson({
          valid,
          summary: summary(targets),
          ...(resolvedKind === undefined ? {} : { resolvedKind }),
          // Emitted in every mode now that it is derived per service: a
          // single-service run knows exactly as much about its own blind spot
          // as `--all` knows about the fleet's.
          sourcesUnverifiableFromHere: unverifiable,
          targets: capped.map(targetJson),
        });
      } else {
        renderText(capped, opts.all === true, unverifiable, opts.errorsOnly === true);
      }
      // --strict is a per-invocation CI lever: it fails the run on any error or
      // warning (ok-severity confirmations never trip it — virtually every
      // clean target emits some), and changes nothing else — `valid` keeps meaning "no
      // errors" in text and JSON alike, so two pipelines reading the same repo
      // may grade the same report differently and both are telling the truth.
      const strictFailed =
        opts.strict === true &&
        countSeverity(targets, "error") + countSeverity(targets, "warn") > 0;
      if (!valid || strictFailed) process.exitCode = 1;
    });
}

/**
 * The rollup `--json` carries and the `--all` footer prints.
 *
 * Four named fields rather than a `Record<string, number>`: the keys ARE the
 * contract, and under an index signature every read of them was an assertion
 * (`s.errors!`) that tsc could not check — rename one and the compiler stayed
 * quiet while the footer printed `undefined errors`.
 */
interface ValidateSummary {
  services: number;
  features: number;
  errors: number;
  warnings: number;
}

function summary(targets: TargetReport[]): ValidateSummary {
  return {
    services: targets.filter((t) => t.kind === "service").length,
    features: targets.filter((t) => t.kind === "feature").length,
    errors: countSeverity(targets, "error"),
    warnings: countSeverity(targets, "warn"),
  };
}

/** The one code the rollup line counts; spelled once so the two cannot drift. */
const UNVERIFIABLE = "sources.unverifiable-from-here";

/**
 * How many `details` lines any one finding may print before the rest are
 * summarised away.
 *
 * A finding's details are evidence, not a log: LikeC4 reports one syntax error
 * as dozens of cascading diagnostics, and a fleet-sized repo multiplies that by
 * every target that mentions the file. The report is read by a person scrolling
 * a CI log and by an agent with a context window, and neither of them is helped
 * by the four-hundredth copy. The cap is applied to the JSON payload too, on
 * purpose: `--json` is the interface an agent pipes, and an unbounded array is
 * the same denial-of-attention there, just machine-readable.
 */
const DETAIL_LIMIT = 10;

/** Truncate every finding's details, marking what was dropped so nothing looks complete when it is not. */
function capDetails(t: TargetReport): TargetReport {
  return {
    ...t,
    findings: t.findings.map((f) => {
      const details = f.details ?? [];
      if (details.length <= DETAIL_LIMIT) return f;
      return {
        ...f,
        details: [...details.slice(0, DETAIL_LIMIT), `… (+${details.length - DETAIL_LIMIT} more)`],
      };
    }),
  };
}

/**
 * One target's checks, with an IO exception turned into a finding ON that
 * target instead of aborting the run.
 *
 * A fleet gate that dies on the first unreadable file reports nothing about the
 * other ninety-nine services — one bad permission bit, one file that is a
 * dangling symlink, and CI's answer to "how is the fleet" becomes a stack
 * trace. The failure is real and it is an error, so the run still exits 1; what
 * changes is that everything else is still graded, and the finding names the
 * service and the path instead of arriving as the `internal` catch-all.
 */
async function guarded(
  target: { kind: "service" | "feature"; id: string },
  run: () => Promise<TargetReport>,
): Promise<TargetReport> {
  try {
    return await run();
  } catch (err) {
    // A docs repo that vanished mid-run is not one target's problem — it is the
    // whole run's, and the action's own catch reports it.
    if (err instanceof DocsRepoUnavailableError) throw err;
    const path = (err as NodeJS.ErrnoException).path;
    const reason = err instanceof Error ? err.message : String(err);
    return {
      kind: target.kind,
      id: target.id,
      findings: [
        {
          severity: "error",
          code: target.kind === "service" ? "service.unreadable" : "feature.unreadable",
          subject: target.id,
          message:
            `${target.id}: ${path === undefined ? "an artifact" : path} could not be read — ` +
            `nothing about this ${target.kind} was checked. ${reason}`,
        },
      ],
    };
  }
}

/**
 * `target.ambiguous` — the positional named a service AND a feature. The tie is
 * still broken the way it always was (the feature wins), because changing which
 * one is picked would silently re-target every script that relies on it; what
 * is new is that the run says which reading it took and how to force the other.
 */
function ambiguousTarget(arg: string, chosen: "service" | "feature"): Finding {
  const other = chosen === "feature" ? "service" : "feature";
  return {
    severity: "warn",
    code: "target.ambiguous",
    subject: arg,
    message:
      `'${arg}' names both a service and a feature — validated as the ${chosen}. ` +
      `Pass --${other} ${arg} for the other reading.`,
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
 * A landscape that could not be READ, shaped as one that did not PARSE.
 *
 * The landscape is the one artifact no target owns: it is read once for the
 * whole run and it is graded on a target of its own, which runs OUTSIDE
 * `guarded`. So a landscape.likec4 that is a directory, or that carries a
 * permission bit this process cannot open, escaped every per-target catch and
 * became the whole run's `repository-unavailable` — one file, and a fleet gate
 * that said nothing about the ninety-nine services that are fine. A DANGLING
 * symlink is not one of those shapes and never was: every read of the file is
 * gated on an `existsSync` that follows the link, so a broken one resolves as
 * `landscape.missing` long before anything opens it.
 *
 * What this contains is the FLEET-level reads, and only those: the `--all`
 * preload, and both reads inside `validateLandscape` — the conflict-marker
 * `readFile` and the parse. `loam validate --service <id>` and
 * `loam validate --feature <id>` hand in no preloaded doc, so `validateService`
 * and `validateFeature` open the same file again on demand, unwrapped and
 * INSIDE `guarded`: an EISDIR there is still reported as `service.unreadable`
 * or `feature.unreadable`, which files the fleet map's failure against the one
 * target the caller happened to name. That is the wrong subject on a finding
 * that does at least carry the offending path, and it costs those runs nothing
 * further — they grade a single target either way, so there is no report left
 * unwritten — which is why the remainder was left for the change that gives the
 * landscape one load path instead of three.
 *
 * `guarded` is deliberately NOT widened to cover the landscape target instead.
 * Its code ternary knows only services and features, so it would file the fleet
 * map's failure as `feature.unreadable`; and a guarded failure yields no
 * document, so all N services would go on to re-open the same broken file
 * inside their own guards and emit N copies of it. Containing the IO here needs
 * no new code and no new sentence: "could not be read" and "did not parse" have
 * the same consequence — nothing may be concluded from this file — and
 * `landscape.invalid` is already how that is said.
 */
function unreadableLandscape(err: unknown): LoadedDoc {
  return {
    errors: [{ message: err instanceof Error ? err.message : String(err) }],
    elements: [],
    relationships: [],
  };
}

/** One landscape load, answering with `unreadableLandscape` rather than throwing. */
async function readLandscape(load: () => Promise<LoadedDoc>): Promise<LoadedDoc> {
  try {
    return await load();
  } catch (err) {
    return unreadableLandscape(err);
  }
}

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
 * An ABSENT landscape is a finding, not a skipped check. It used to return null
 * — no target, no findings, and a fleet gate that went green over a docs repo
 * with no fleet map at all, which is the single artifact every derived view and
 * every spine check is computed from. It is graded by what its absence proves:
 * with services in `services/` it is an ERROR (a fleet that exists is undrawn),
 * with none it is a WARNING (a docs repo before its first adopt legitimately
 * has nothing to draw, but the file still belongs there — `loam init` scaffolds
 * it, and a repo missing it will silently accept never getting one).
 *
 * `preloaded` is the already-parsed landscape under --all — the same doc every
 * service check gets.
 */
async function validateLandscape(
  docsDir: string,
  preloaded?: LoadedDoc | null,
  fleet?: FleetContext,
): Promise<TargetReport> {
  const path = landscapeFile(docsDir);
  const findings: Finding[] = [];
  const report: TargetReport = { kind: "landscape", id: "landscape", findings };

  // The SET of service directories is this target's other subject, so it is
  // graded before the map is even opened: `service.id-invalid` is a fact about
  // `services/` that holds whether or not a landscape exists or parses, and
  // both of those return early below. Emitted here and nowhere else — the
  // enumeration is what makes the id a question, and one finding per fleet is
  // what the rename fixes.
  const entries = await listServices(docsDir, fleet);
  findings.push(...serviceIdFindings(entries));

  if (!existsSync(path)) {
    const count = entries.length;
    findings.push({
      severity: count > 0 ? "error" : "warn",
      code: "landscape.missing",
      message:
        `landscape: architecture/landscape.likec4 does not exist — ` +
        (count > 0
          ? `${count} service(s) are adopted and nothing draws the fleet. `
          : "nothing draws the fleet. ") +
        "It is the one map every derived view and the C4↔API spine are computed from: " +
        "write a `specification { element softwareSystem }` + `model { … }` document there " +
        "with one element per services/<id>/, bound with `metadata { service '<id>' }`.",
    });
    return report;
  }

  // Conflict markers before the parse — `loam doctor`'s order, and for its
  // reason: the markers are the cause and the parse errors are the cascade.
  // Nothing may be concluded from a file that is two halves of two different
  // maps, least of all that a service nobody drew is unmodelled, so this
  // returns the way `landscape.invalid` does. An error, gating by the default
  // rule and deliberately not carrying `gates` — that field is coherence's,
  // and the archive gate has to ask this question itself (it does not yet).
  // Read plainly rather than through FleetContext: this target runs outside
  // `guarded`, and a document refused for its encoding would surface here as
  // the whole run's `repository-unavailable` instead of one finding.
  //
  // Both reads are contained for that same reason — see `unreadableLandscape`.
  // The conflict-marker read is the FIRST touch of the file, so it is the one
  // that fails when the file cannot be opened at all, and it runs before
  // `preloaded ??` can spare it.
  let land: LoadedDoc;
  try {
    const conflict = landscapeConflictFinding(
      "architecture/landscape.likec4",
      await readFile(path, "utf8"),
    );
    if (conflict !== null) {
      findings.push(conflict);
      return report;
    }
    land = preloaded ?? (fleet === undefined ? await loadFile(path) : await fleet.loadLikeC4(path));
  } catch (err) {
    land = unreadableLandscape(err);
  }
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

  const services: ReadonlySet<string> = new Set(entries.map((s) => s.id));
  // Depth is not a fact about a service. This used to keep only top-level
  // elements (`!e.id.includes(".")`), which ordinary C4 breaks the moment it
  // groups services under a parent: every nested element was thrown away, so a
  // bound service read as unmodelled — an ERROR, on every service in the fleet
  // — and a binding written one level down was never checked at all. The tree
  // is walked instead, the way `serviceResolver` walks it for edges: a binding
  // wins at any depth, then a title naming a real services/<id>/, and what sits
  // INSIDE one of those is that service's container, not a service of its own.
  const byId = new Map(land.elements.map((e) => [e.id, e]));
  /** Declared ancestors of an element, nearest first. */
  const ancestorsOf = (e: Elem): Elem[] => {
    const out: Elem[] = [];
    for (let dot = e.id.lastIndexOf("."); dot !== -1; dot = e.id.lastIndexOf(".", dot - 1)) {
      const parent = byId.get(e.id.slice(0, dot));
      if (parent !== undefined) out.push(parent);
    }
    return out;
  };
  const standsForService = (e: Elem): boolean => e.service !== undefined || services.has(e.title);
  /** Service-LEVEL elements: everything not drawn inside something that is already a service. */
  const drawn = land.elements.filter((e) => !ancestorsOf(e).some(standsForService));
  // Which services the landscape models, answered by the same resolver every
  // edge join uses — so "modelled" here and "inbound edge" in the spine check
  // can never disagree about what an element stands for.
  const landSvcOf = serviceResolver(land.elements, services);
  const modelled: ReadonlySet<string> = new Set(land.elements.map((e) => landSvcOf(e.id)));

  // Two boxes standing for one service directory. Every join in loam is
  // `element -> service`, computed by picking the FIRST element that resolves —
  // so with two of them, which one wins is readdir order, and the edges of the
  // loser are attributed to a service they do not belong to. Silent until now,
  // and unfixable by staring at either element on its own.
  const perService = new Map<string, Elem[]>();
  for (const e of drawn) {
    if (e.tags.includes(EXTERNAL_TAG)) continue;
    const id = elementService(e);
    perService.set(id, [...(perService.get(id) ?? []), e]);
  }
  for (const [id, elems] of perService) {
    if (elems.length < 2) continue;
    // A collision only matters where it decides something: a real directory to
    // attribute to, or a binding somebody wrote down on purpose.
    if (!services.has(id) && !elems.some((e) => e.service !== undefined)) continue;
    findings.push({
      severity: "warn",
      code: "landscape.binding-duplicate",
      subject: id,
      message: `landscape: ${elems.length} elements resolve to service '${id}' (${elems.map((e) => e.id).join(", ")}) — every element→service join picks one of them arbitrarily, so the others' edges are filed under a service that does not own them; keep one element per services/<id>/`,
    });
  }

  for (const id of services) {
    if (modelled.has(id)) continue;
    findings.push({
      severity: "error",
      code: "landscape.service-unmodelled",
      subject: id,
      message: `landscape: services/${id}/ exists but nothing in architecture/landscape.likec4 models it — add an element, or bind one with metadata { service '${id}' }`,
    });
  }

  // A binding is a claim about this repo wherever it is written — including
  // inside another element, which the old top-level filter never looked at, so
  // a typo one level down bound an edge to a service that does not exist and
  // nothing said so. Every element with a binding answers for it, at any depth.
  for (const e of land.elements) {
    if (e.tags.includes(EXTERNAL_TAG) || e.service === undefined) continue;
    if (services.has(e.service)) continue;
    findings.push({
      severity: "error",
      code: "landscape.binding-unknown",
      subject: e.service,
      message: `landscape: '${e.title}' binds to service '${e.service}', but services/${e.service}/ does not exist`,
    });
  }

  for (const e of drawn) {
    if (e.tags.includes(EXTERNAL_TAG)) continue;
    if (e.service !== undefined) continue; // graded by the binding pass above
    if (ACTOR_KINDS.has(e.kind.toLowerCase())) continue;
    if (services.has(e.title)) continue;
    // An element that CONTAINS a service is a grouping — a domain, a boundary,
    // an enterprise — not a service nobody adopted. There is nothing to bind on
    // it and nothing to tag #external, so asking for either would be a warning
    // with no correct fix; the services under it answer for themselves.
    if (land.elements.some((c) => c.id.startsWith(`${e.id}.`) && standsForService(c))) continue;
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
 * adopt is the right hint. Every check that does not read the model still runs
 * (spec coverage, the arch axis, provenance, gherkin staleness): archive
 * creates exactly this state for a new service, and those signals must not go
 * quiet there.
 * `service.no-spec` / `service.no-openapi` (warn): the adopt brief marks both
 * required, but a fleet mid-rollout legitimately has part-adopted services —
 * the absence must stay visible without gating CI for months. The openapi warn
 * keeps quiet when the landscape proves nobody calls an operation on this
 * service: a worker with no API is not missing one.
 * `api.ops-unlinked` (warn): an OpenAPI and requirements that never name each
 * other pass every cross-axis check vacuously — a repo migrated from OpenSpec
 * does exactly that by default, and vacuous is not the same as checked.
 */
interface ServiceCheck {
  docsDir: string;
  service: string;
  /** The service's own repo, when loam is standing in it. Undefined from the docs repo. */
  repoDir?: string;
  /** The living landscape under --all; undefined means "load it if you need it", null means "there is none". */
  preloaded?: LoadedDoc | null;
  gherkinDir?: string;
  fleet?: FleetContext;
  /**
   * True when this run ALSO emits a `landscape` target. It decides one thing:
   * whether a landscape parse error's details are repeated here. Under --all
   * they are not — the landscape target already carries them once, and N copies
   * of one parser's cascade is the whole report.
   */
  landscapeReported?: boolean;
}

async function validateService(check: ServiceCheck): Promise<TargetReport> {
  const { docsDir, service, repoDir, preloaded, gherkinDir, fleet } = check;
  const findings: Finding[] = [];
  const report: TargetReport = { kind: "service", id: service, findings };
  const paths = servicePaths(docsDir, service);

  // A directory that does not exist is a different fact from a directory with
  // everything missing: validating a typo must say "typo", not "unadopted".
  if (!existsSync(paths.dir)) {
    const close = closeIds(service, (await listServices(docsDir, fleet)).map((s) => s.id));
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

  // C4 model. Its absence is an error — this is where `adopt` comes in — but it
  // must NOT silence the rest of the gate stack: `loam archive` of a feature
  // introducing a new service creates exactly this state (spec.md, arch.spec.md,
  // openapi.yaml, no model.likec4), and an early return here suspended arch
  // coverage, health.uncovered, provenance (content_digest included) and the
  // gherkin staleness chain for the very services vouch had just promised them
  // to. So the finding is emitted and the walk CONTINUES; only the checks that
  // read the model itself are guarded.
  const hasModel = existsSync(paths.model);
  let elements: Elem[] = [];
  let relationships: Rel[] = [];
  if (!hasModel) {
    findings.push({
      severity: "error",
      code: "service.no-model",
      message: `No C4 model at ${paths.model}. Run \`loam adopt\` for '${service}' first.`,
      text: { marker: false },
    });
  } else {
    const model = fleet === undefined ? await loadFile(paths.model) : await fleet.loadLikeC4(paths.model);
    elements = model.elements;
    relationships = model.relationships;
    if (model.errors.length > 0) {
      findings.push({
        severity: "error",
        code: "c4.invalid",
        message: `${service}: C4 model has ${model.errors.length} error(s)`,
        details: model.errors.map(errorText),
      });
    } else {
      findings.push({
        severity: "ok",
        code: "c4.valid",
        message: `${service}: C4 model valid (${elements.length} elements · ${relationships.length} relationships)`,
      });
    }
  }

  // The living landscape, parsed at most once per run: under --all the caller
  // hands in the doc it already loaded, single-service runs load on demand. It
  // serves two checks below — the no-openapi grace and the spine.
  const land =
    preloaded ??
    (existsSync(landscapeFile(docsDir))
      ? fleet === undefined
        ? await loadFile(landscapeFile(docsDir))
        : await fleet.loadLikeC4(landscapeFile(docsDir))
      : null);

  // Which service directories actually exist — the positive evidence
  // `serviceOf` needs to resolve an edge drawn into a modelled CONTAINER
  // (`paymentService.api`) back to the service that owns it. Without it every
  // such edge resolves to the container's own title, i.e. to a service nobody
  // has ever adopted, and drops out of the spine unnoticed.
  const known = new Set((await listServices(docsDir, fleet)).map((s) => s.id));

  // Requirement coverage.
  let reqs: Requirement[] = [];
  if (existsSync(paths.spec)) {
    const specText =
      fleet === undefined ? await readFile(paths.spec, "utf8") : await fleet.readText(paths.spec);
    reqs = fleet === undefined ? parseRequirements(specText) : await fleet.readRequirements(paths.spec);
    // Conflict markers first, because they say that nothing below this line is
    // anyone's text. An error, gating by the default rule and deliberately
    // without `gates`: that field is coherence's (issue.ts) and archive does
    // not read validate's findings, so claiming it here would be a promise
    // about a gate that is not wired. What makes it an error rather than a
    // warning is what the next merge does — `loam archive` rewrites the
    // requirements section of this very file and takes whichever marker lines
    // fall inside it, turning a conflict anyone can see into a document nobody
    // can tell is wrong.
    const conflict = documentConflictFinding(`${service}: spec.md`, service, specText);
    if (conflict !== null) findings.push(conflict);
    // A living spec with no `### Requirement:` block at all is the baseline
    // `loam adopt` scaffolds and nobody ever filled in. "requirements covered
    // (0 requirements, all with scenarios)" is true of it and says the opposite
    // of what a reader needs: every cross-axis check downstream — API
    // governance, the Operations: spine, gherkin generation — is vacuous here,
    // and the green tick is what let a whole fleet score `sourced` over empty
    // files.
    if (reqs.length === 0) {
      findings.push({
        severity: "warn",
        code: "spec.no-requirements",
        subject: service,
        message: `${service}: spec.md holds no '### Requirement:' blocks — every requirement-driven check below is vacuous, and nothing here can go out of date because nothing is written down`,
      });
    } else {
      findings.push(coverageFinding(`${service}: requirements`, reqs));
    }
    // The other half of the coverage question, and an error for the same
    // reason the first half is: the whole claim of coverage is that a
    // requirement has a scenario something can RUN. A heading with no steps
    // satisfies the count and tests nothing — cucumber runs it vacuously green
    // and `loam verify --results` can never confirm it — so a fleet gate that
    // called it covered was certifying the absence of a test.
    findings.push(...steplessFindings(`${service}: requirements`, service, reqs));
    findings.push(...duplicateRequirementFindings(reqs, `${service}: spec.md`, service));
    findings.push(...requirementIdFindings(reqs, `${service}: spec.md`, service));
    findings.push(...repeatedListLineFindings(reqs, `${service}: spec.md`, service));
  } else {
    findings.push({
      severity: "warn",
      code: "service.no-spec",
      message: `No living spec at ${paths.spec} — requirement coverage and API governance are unchecked`,
    });
  }

  // The requirements that still govern anything. A REMOVED requirement is on
  // its way out together with the operations it names: it makes no claim on the
  // contract and governs nothing once the retiring feature archives — the same
  // position coherence.ts takes on the delta side.
  //
  // Spelled once because it was spelled three times and dropped on the fourth:
  // `governedOps` filtered, `spec-api.op-undefined` filtered, and the
  // `api.covered` join did not — so an operation whose only requirement was
  // REMOVED counted as governed, and the one operation about to be left without
  // a requirement was the one the report called covered.
  const livingReqs = reqs.filter((r) => r.kind !== "REMOVED");

  // API coverage: every operation in openapi.yaml is governed by a requirement.
  const api = await readOpenapi(paths.openapi, fleet);
  const removeMarkers = api.ops.filter((o) => o.remove);
  const liveOps = api.ops.filter((o) => !o.remove);
  const ops = liveOps.map((o) => o.id);
  const deprecatedOps = new Set(liveOps.filter((o) => o.deprecated).map((o) => o.id));
  // The living landscape's element→service resolver, container-aware and
  // memoized. Every question below that asks "does this edge point at me?"
  // asks it through this one function, so the no-openapi grace and the spine
  // check can never disagree about which edges are inbound.
  const landSvcOf = land === null ? null : serviceResolver(land.elements, known);
  // Inbound calls the landscape can PROVE: op-linked edges whose target
  // resolves to this service. Null when the landscape proves nothing at all
  // (absent, or it did not parse) — which is not the same fact as "nobody
  // calls me", and the two must not be graded alike.
  const inboundOps =
    land === null || land.errors.length > 0
      ? null
      : land.relationships.filter((r) => r.op !== undefined && landSvcOf!(r.target) === service);
  // The other half of the evidence a contract is owed: the living spec's own
  // `Operations:` lines. A requirement on its way out governs nothing.
  const governedOps = livingReqs.flatMap((r) => r.operations);
  /** No contract to read: deleted, renamed, or never written. */
  const contractMissing = !existsSync(paths.openapi);
  if (contractMissing) {
    // A contract that is gone is not a reason to stop grading the API axis —
    // it IS the axis's answer, and every check below used to live inside the
    // file-exists branch, so deleting or misspelling the file turned the whole
    // axis (including the documented `spec-api.op-undefined`) green.
    //
    // What decides the severity is whether anything already written down is
    // holding a join into it: a living `Operations:` line, or an op-linked
    // landscape edge. With one of those, the absence breaks a link somebody
    // authored — an error. With neither, this is a service that legitimately
    // has no HTTP surface (a worker nobody calls), and a fleet mid-rollout
    // must not go red for it — a warning, or, when the landscape PROVES nobody
    // calls it, the documented silence.
    //
    // One finding, not one per dangling link: the fix is a single file, and
    // the links it strands ride along as details.
    const dangling = [...new Set([...governedOps, ...(inboundOps ?? []).map((r) => r.op!)])].sort();
    if (dangling.length > 0) {
      findings.push({
        severity: "error",
        code: "service.no-openapi",
        subject: service,
        message:
          `No OpenAPI contract at ${paths.openapi}, and ${dangling.length} operation link(s) already point into it — ` +
          `every requirement and landscape edge naming one of them resolves to nothing until the file is back`,
        details: dangling,
      });
    } else if (inboundOps === null) {
      findings.push({
        severity: "warn",
        code: "service.no-openapi",
        message: `No OpenAPI contract at ${paths.openapi} — API coverage and the landscape spine are unchecked`,
      });
    }
  } else if (api.unreadable) {
    // A contract that EXISTS but does not read is a broken source of truth, not
    // an empty one: swallowing it into zero operations used to grade every
    // inbound landscape edge `spine.op-undefined` — a false diagnosis pointing
    // at the landscape when the truth was this file. So the file is the error,
    // and every check that reads the contract (api.*, the spine's op
    // resolution) is suspended below, the landscape.invalid discipline.
    findings.push({
      severity: "error",
      code: "openapi.invalid",
      message: `${service}: openapi.yaml does not parse — API coverage and the landscape spine are unchecked`,
      ...(api.error === undefined ? {} : { details: [api.error] }),
    });
  } else {
    if (removeMarkers.length > 0) {
      findings.push({
        severity: "error",
        code: "openapi.remove-marker-living",
        message: `${service}: living openapi.yaml contains ${removeMarkers.length} x-loam-remove marker(s) (${removeMarkers.map((op) => op.id).join(", ")}) — removal markers are valid only in feature deltas`,
      });
    }
    // The same marker written at PATH level, beside the methods. `readOpenapi`
    // is keyed by (path, method), which is precisely why the check above cannot
    // see this one and precisely how one reached a living contract in the first
    // place: it addresses no operation, so it retired nothing, and it stayed
    // invisible afterwards. Error, like its method-level sibling — a
    // feature-only key published to every consumer of the fleet, and one that
    // keeps the empty-path cleanup from ever firing. Same code as the archive
    // plan's: one breach, one name, wherever it is found.
    for (const removed of api.pathLevelRemovals) {
      findings.push({
        severity: "error",
        code: "openapi.remove-marker-path-level",
        subject: service,
        message:
          `${service}: living openapi.yaml carries x-loam-remove at PATH level on '${removed}' — ` +
          `a removal marker names ONE operation, so beside the methods it retires nothing and is not a contract key either, ` +
          `and no id-keyed check can see it. Delete it from the living contract; retire an operation through a feature delta whose marker sits inside the operation.`,
      });
    }
    // Two slots claiming one operationId in a LIVING contract. `readOpenapi`
    // has computed this since the merge needed it, and only the feature path
    // (coherence) ever read it — so the ambiguity was reachable only when some
    // unrelated feature happened to carry a delta for this service, and the
    // fleet gate that actually runs in CI was blind to it. Same code and same
    // sentence as the feature-scope check: one breach, one name.
    for (const id of api.duplicateIds) {
      const slots = api.ops.filter((op) => op.id === id).map((op) => `${op.method} ${op.path}`);
      findings.push({
        severity: "warn",
        code: "openapi.duplicate-operationid",
        subject: service,
        message: `${service}: the living OpenAPI defines operationId '${id}' at ${slots.join(" and ")} — every join on the id (a requirement's Operations: line, an edge's metadata { op }, a removal marker) picks one of those slots arbitrarily`,
      });
    }
    const defined = new Set(ops);
    // `Operations:` on a LIVING requirement, resolved against this service's own
    // contract. Nothing did this before: the same spine is checked inside a
    // feature delta (coherence's spec-api.op-undefined) and then never again, so
    // a typo that shipped, or an operation later renamed out of openapi.yaml,
    // left a living requirement governing an operation that does not exist —
    // green forever, and every downstream join through that id silently empty.
    // Same code and severity as the feature-scope check on purpose: one breach,
    // one name, wherever it is found.
    for (const r of livingReqs) {
      for (const op of r.operations) {
        if (defined.has(op)) continue;
        const close = closeIds(op, ops);
        findings.push({
          severity: "error",
          code: "spec-api.op-undefined",
          subject: service,
          message:
            `${service}: requirement '${r.name}' governs '${op}', not defined in ${service}'s OpenAPI` +
            (close.length > 0 ? `. Did you mean: ${close.join(", ")}?` : ""),
        });
      }
    }
    if (ops.length > 0) {
    const governed = new Set(livingReqs.flatMap((r) => r.operations));
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
    // Lifecycle: a requirement whose `Operations:` list resolves ONLY to
    // deprecated operations governs behaviour the contract is retiring.
    // Deprecation is the documented first step of removing an op; the explicit
    // feature marker is the final step. Until that delta archives, the op stays
    // live, so the fix is migration or a coordinated retirement. Ops the contract does not define at all
    // prove nothing here and are left to spec-api.op-undefined above.
    for (const r of reqs) {
      const resolved = r.operations.filter((op) => defined.has(op));
      if (resolved.length === 0 || !resolved.every((op) => deprecatedOps.has(op))) continue;
      findings.push({
        severity: "warn",
        code: "api.requirement-deprecated",
        message: `${service}: requirement '${r.name}' governs only deprecated operation(s) (${resolved.join(", ")}) — the behaviour it describes is on its way out; migrate it to the replacement operation, or retire it`,
      });
    }
    }
  }

  // Landscape spine: cross-system edges calling THIS service must resolve to a real
  // operation in its OpenAPI — the C4↔API contract, checked in the living landscape,
  // not only in feature mode. Catches dangling / de-linked op edges.
  if (land !== null) {
    if (land.errors.length > 0) {
      // A living landscape that does not parse disables the C4↔API spine check —
      // that is a broken source of truth, not a skippable detail.
      //
      // The parser's own output is attached ONCE per run, and not here when the
      // run has a landscape target to carry it. One syntax error in one file
      // becomes N copies of a dozen cascading diagnostics on a fleet of N
      // services — the report stops being readable at exactly the moment
      // somebody needs to read it, and the fix is one file either way.
      findings.push({
        severity: "error",
        code: "spine.landscape-invalid",
        subject: service,
        message:
          `${service}: landscape.likec4 has ${land.errors.length} error(s) — spine check impossible` +
          (check.landscapeReported === true
            ? "; the parser output is reported once, on the landscape target"
            : ""),
        ...(check.landscapeReported === true ? {} : { details: land.errors.map(errorText) }),
      });
    } else {
      // Which element IS this service is the binding's call, then a title that
      // names a real services/<id>/, and an edge into a modelled container
      // counts as an edge into its service — matching the exact id alone meant a
      // container edge left the spine without a word.
      const svcOf = landSvcOf!;
      const opset = new Set(ops);
      let checked = 0;
      let broken = 0;
      for (const r of land.relationships) {
        if (svcOf(r.target) !== service) continue;
        if (r.op !== undefined) {
          // A contract that cannot be read — broken, or not there at all —
          // proves nothing about this edge, neither broken nor resolved.
          // Grading the edges against an empty operation set turned ONE root
          // cause (the file) into one `spine.op-undefined` per inbound edge, so
          // a service with twelve consumers reported twelve landscape defects
          // and never named the file. `openapi.invalid` / `service.no-openapi`
          // already did; only op-link-missing (which never reads the contract)
          // stays live, and `checked` stays 0 so no false spine.resolved is
          // claimed either.
          if (api.unreadable || contractMissing) continue;
          checked += 1;
          if (!opset.has(r.op)) {
            broken += 1;
            findings.push({
              severity: "error",
              code: "spine.op-undefined",
              message: `${service}: landscape edge ${svcOf(r.source)} → ${service} calls '${r.op}', not defined in ${service}'s OpenAPI`,
            });
          } else if (deprecatedOps.has(r.op)) {
            // The contract holds — the op is defined — but it is marked
            // `deprecated: true`: the consumer is standing on a contract being
            // retired, and should be migrating off it. Warn per inbound edge;
            // a deprecated op nobody calls raises no spine finding at all.
            findings.push({
              severity: "warn",
              code: "spine.op-deprecated",
              message: `${service}: landscape edge ${svcOf(r.source)} → ${service} calls '${r.op}', which ${service}'s OpenAPI marks deprecated — the consumer should migrate off it`,
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

  /* ------------------------------------------------------------------ */
  /* The async contract axis — AsyncAPI messages on the landscape spine  */
  /* ------------------------------------------------------------------ */
  //
  // The HTTP spine above and this one are mirror images, and the mirror is the
  // whole reason this is a second axis rather than a second `metadata` key. On
  // the HTTP axis the PROVIDER owns the contract: an edge names an operation and
  // the target's openapi.yaml settles it, locally, in one file. Here the
  // PRODUCER owns the message and the consumer joins to it from another
  // repository — so "is this message declared" is local, while "does anybody
  // publish it" is a fleet question with no local answer at all.
  // The architecture spec, read HERE rather than with the rest of its axis
  // below, because the event links are a requirement-level join and both
  // requirement files carry them. Events are architecture as often as they are
  // business — the outbox requirement in a service's arch.spec.md is the
  // canonical place a `Publishes:` line belongs — so reading only spec.md would
  // silently ignore the lines most authors write.
  const archText = existsSync(paths.archSpec)
    ? fleet === undefined
      ? await readFile(paths.archSpec, "utf8")
      : await fleet.readText(paths.archSpec)
    : null;
  const archReqs =
    archText === null
      ? []
      : fleet === undefined
        ? parseRequirements(archText)
        : await fleet.readRequirements(paths.archSpec);

  // Where this axis started, so the closing ok-finding can be "nothing here
  // broke" rather than a second, independently-computed claim about the same
  // facts. A positive finding derived from the same walk cannot disagree with it.
  const eventFindingsAt = findings.length;
  const events = await readAsyncapi(paths.asyncapi, fleet);
  const sentHere = new Set(events.sent);
  const receivedHere = new Set(events.received);

  // Every edge that binds THIS service to a message: `publishes` binds the
  // edge's source (a service produces what it declares an `action: send` for),
  // `consumes` binds its target. One edge may legitimately carry both — a relay
  // that reads one topic and writes another is a single arrow in most fleet maps.
  const eventEdges =
    land === null || land.errors.length > 0
      ? []
      : land.relationships.flatMap((r) => {
          const bound: { direction: "publishes" | "consumes"; message: string; other: string }[] = [];
          if (r.publishes !== undefined && landSvcOf!(r.source) === service) {
            bound.push({ direction: "publishes", message: r.publishes, other: landSvcOf!(r.target) });
          }
          if (r.consumes !== undefined && landSvcOf!(r.target) === service) {
            bound.push({ direction: "consumes", message: r.consumes, other: landSvcOf!(r.source) });
          }
          return bound;
        });
  // Both requirement namespaces, and a REMOVED requirement links nothing —
  // the `livingReqs` rule the API axis already follows, applied to the pair.
  const eventLinks = [...livingReqs, ...archReqs.filter((r) => r.kind !== "REMOVED")].flatMap((r) => [
    ...r.publishes.map((m) => ({ direction: "publishes" as const, message: m, requirement: r.name })),
    ...r.consumes.map((m) => ({ direction: "consumes" as const, message: m, requirement: r.name })),
  ]);

  if (!existsSync(paths.asyncapi)) {
    // Deliberately TWO grades, not the three `service.no-openapi` uses. Its
    // middle grade — warn when the landscape cannot prove nobody calls this
    // service — rests on HTTP being the default: most services expose one, so
    // "I could not look" is worth saying. An event contract is genuinely
    // optional; most services in a legacy fleet touch no topic at all. Warning
    // every one of them the moment a landscape fails to parse would put a
    // finding on the whole fleet that names a file nobody owes.
    //
    // So: something already joins into the absent file, or silence.
    const dangling = [
      ...new Set([...eventEdges.map((e) => e.message), ...eventLinks.map((e) => e.message)]),
    ].sort();
    if (dangling.length > 0) {
      findings.push({
        severity: "error",
        code: "service.no-asyncapi",
        subject: service,
        message:
          `No async contract at ${paths.asyncapi}, and ${dangling.length} message link(s) already point into it — ` +
          `every landscape edge and requirement naming one of them resolves to nothing until the file is back`,
        details: dangling,
      });
    }
  } else if (events.unreadable) {
    // The openapi.invalid discipline: a contract that EXISTS but does not read
    // is a broken source of truth, not an empty one. Grading the links against
    // an empty message set would turn one file into one `spine.message-undefined`
    // per edge, every one of them pointing at the landscape.
    findings.push({
      severity: "error",
      code: "asyncapi.invalid",
      subject: service,
      message: `${service}: asyncapi.yaml does not parse — the event spine is unchecked for this service`,
      ...(events.error === undefined ? {} : { details: [events.error] }),
    });
  } else {
    for (const name of events.duplicateNames) {
      findings.push({
        severity: "warn",
        code: "asyncapi.duplicate-message",
        subject: service,
        message: `${service}: asyncapi.yaml declares message '${name}' in ${slotsOf(events, name).join(" and ")} — every join on the name (an edge's metadata { publishes }, a requirement's Publishes: line) picks one of those slots arbitrarily`,
      });
    }
    // Local resolution, both directions and both sources of a claim. An edge and
    // a requirement making the same broken claim get the same sentence under
    // different codes, matching how `spine.op-undefined` and
    // `spec-api.op-undefined` split the HTTP axis: one is the fleet map's
    // mistake, the other is this document's, and the fix is in a different file.
    const declares = (direction: "publishes" | "consumes", message: string): boolean =>
      direction === "publishes" ? sentHere.has(message) : receivedHere.has(message);
    const action = (direction: "publishes" | "consumes"): string =>
      direction === "publishes" ? "send" : "receive";
    for (const e of eventEdges) {
      if (declares(e.direction, e.message)) continue;
      findings.push({
        severity: "error",
        code: "spine.message-undefined",
        subject: service,
        message:
          `${service}: landscape edge ${e.direction === "publishes" ? `${service} → ${e.other}` : `${e.other} → ${service}`} ` +
          `${e.direction} '${e.message}', but ${service}'s asyncapi.yaml declares no operation with action: ${action(e.direction)} for it`,
      });
    }
    for (const e of eventLinks) {
      if (declares(e.direction, e.message)) continue;
      findings.push({
        severity: "error",
        code: "spec-event.message-undefined",
        subject: service,
        message: `${service}: requirement '${e.requirement}' ${e.direction} '${e.message}', but ${service}'s asyncapi.yaml declares no operation with action: ${action(e.direction)} for it`,
      });
    }
    // The migration-debt case, `api.ops-unlinked`'s twin: a contract and
    // requirements that never name each other leave this axis vacuously green.
    if (events.messages.length > 0 && reqs.length + archReqs.length > 0 && eventLinks.length === 0) {
      findings.push({
        severity: "warn",
        code: "event.messages-unlinked",
        subject: service,
        message: `${service}: asyncapi.yaml declares ${events.messages.length} message(s) but no requirement links any — the event axis is unchecked for this service`,
      });
    }
  }

  // The fleet question, and the one check on either spine that a single
  // repository cannot answer: a consumer joins to a message whose schema lives
  // in the producer's contract, in the producer's repo. Paid only when something
  // actually consumes — a fleet where nobody has adopted the axis walks nothing.
  const consumed = [
    ...new Set([
      ...eventEdges.filter((e) => e.direction === "consumes").map((e) => e.message),
      ...eventLinks.filter((e) => e.direction === "consumes").map((e) => e.message),
    ]),
  ].sort();
  if (consumed.length > 0) {
    const producers = await producersByMessage(docsDir, [...known], fleet);
    for (const message of consumed) {
      const who = producers.byMessage.get(message) ?? [];
      // "Nobody produces this" is an argument from absence, and it is only
      // sound over a fleet loam could actually read. One unreadable contract
      // anywhere suspends it — that service may be the producer, and the
      // alternative is blaming every consumer for somebody else's broken YAML.
      // The contested answer below rests on positive evidence and needs no such
      // guard.
      if (who.length === 0 && producers.unreadable.length === 0) {
        findings.push({
          severity: "error",
          code: "spine.message-unproduced",
          subject: service,
          message: `${service}: consumes '${message}', but no service in the fleet declares an operation with action: send for it — the message has no producer, so nothing defines its payload`,
        });
      } else if (who.length > 1) {
        findings.push({
          severity: "warn",
          code: "asyncapi.message-contested",
          subject: service,
          message: `${service}: consumes '${message}', which ${who.length} services declare they send (${who.join(", ")}) — every consumer's join picks one of them arbitrarily, so the payload this service reads is whichever one happens to win`,
        });
      }
    }
  }

  // Positive confirmation, on the same rule `spine.resolved` follows: claimed
  // only where the axis actually checked something. A service that touches no
  // topic says nothing here — an "event axis clean" on every worker in the fleet
  // would be a green tick for work nobody did.
  const eventChecks = eventEdges.length + eventLinks.length;
  if (eventChecks > 0 && findings.length === eventFindingsAt) {
    findings.push({
      severity: "ok",
      code: "event.covered",
      message: `${service}: event spine (${eventChecks} message link(s) resolve to asyncapi.yaml)`,
    });
  }

  // The architecture spec axis — the obligations a business spec never carries
  // (the transactional outbox, retries, metrics, alerts). arch.spec.md is
  // optional and its ABSENCE is not a finding (partial adoption is supported);
  // what exists must hold together: every requirement needs a scenario, every
  // `Covers:` entry must resolve (covers.unknown), and every alert/SLI that
  // health.yaml declares wants a covering requirement (health.uncovered) — the
  // moment health.yaml stops being inert. Warnings, never gates: `--strict` is
  // the CI escalation.
  const health = await readHealth(paths.health);
  if (archText !== null) {
    // The arch axis is advisory in what it ASKS for (covers.unknown,
    // health.uncovered are warnings) but not in whether the file is readable:
    // both breaches below are about the document itself, and they are graded
    // exactly as they are on the business axis — one file, one rule.
    const conflict = documentConflictFinding(`${service}: arch.spec.md`, service, archText);
    if (conflict !== null) findings.push(conflict);
    findings.push(coverageFinding(`${service}: arch requirements`, archReqs));
    findings.push(...steplessFindings(`${service}: arch requirements`, service, archReqs));
    findings.push(...duplicateRequirementFindings(archReqs, `${service}: arch.spec.md`, service));
    findings.push(...requirementIdFindings(archReqs, `${service}: arch.spec.md`, service));
    findings.push(...repeatedListLineFindings(archReqs, `${service}: arch.spec.md`, service));
  }
  // A health.yaml that exists but does not read is reported once, and the
  // checks that read it go quiet BOTH ways: its ids are unknown, so no
  // health.uncovered obligation exists (the empty id set below is already
  // silent), and no `Covers: alert:/sli:` entry may be graded a typo against
  // ids nobody could read (coversUnknownFindings mutes on the flag). A warn,
  // not an error: the axis it feeds is advisory end to end.
  if (health.unreadable) {
    findings.push({
      severity: "warn",
      code: "health.invalid",
      subject: service,
      message: `${service}: health.yaml does not parse — alert/SLI ids are unreadable, so Covers: alert:/sli: entries and health coverage are unchecked`,
      ...(health.error === undefined ? {} : { details: [health.error] }),
    });
  }
  const landParses = land !== null && land.errors.length === 0 ? land : null;
  const scope: CoverageScope = {
    elements: [...elements, ...(landParses?.elements ?? [])],
    relationships: [...relationships, ...(landParses?.relationships ?? [])],
    health: health.ids,
  };
  findings.push(
    ...coversUnknownFindings(archReqs, `${service}: arch.spec.md`, service, scope, health.unreadable),
  );
  const activeCovers = coversEntries(archReqs);
  for (const { form, ids } of [
    { form: "alert" as const, ids: health.ids.alerts },
    { form: "sli" as const, ids: health.ids.slis },
  ]) {
    for (const id of ids) {
      if (activeCovers.some((e) => e.form === form && e.id === id)) continue;
      findings.push({
        severity: "warn",
        code: "health.uncovered",
        subject: service,
        message: `${service}: health.yaml declares ${form === "alert" ? "alert" : "SLI"} '${id}' but no arch.spec.md requirement covers it — write one with 'Covers: ${form}:${id}', or the signal ships with nothing testing it`,
      });
    }
  }

  // Provenance last: who vouched for this, and what code it was written from.
  findings.push(...(await serviceProvenance(docsDir, service, { repoDir })));
  findings.push(...(await sourceScopeFindings(docsDir, service, repoDir)));

  // The generated-gherkin freshness chain, service-repo-scoped like sources.*:
  // it needs the repo (the suite lives there), and it stays quiet until
  // <gherkinDir>/loam/ exists — a service that never generated has not opted in.
  findings.push(...(await gherkinFindings({ docsDir, service, repoDir, gherkinDir, fleet })));

  return report;
}

/** The parsed Covers entries of every requirement that will live (REMOVED covers nothing). */
function coversEntries(reqs: Requirement[]): CoversEntry[] {
  return reqs.filter((r) => r.kind !== "REMOVED").flatMap((r) => r.covers.map(parseCoversEntry));
}

/**
 * `spec.duplicate-requirement` — two `### Requirement:` blocks with one name in
 * one LIVING document. Nothing else catches it, and the merge algebra
 * (applyRequirementDelta) matches by name and edits only the FIRST match: a
 * later archive rewrites one copy and the other survives as a stale snapshot
 * of whatever the requirement used to say. Per file on purpose — spec.md and
 * arch.spec.md are separate requirement namespaces (their merges never cross
 * files), so one name appearing in both is legal and unflagged.
 */
function duplicateRequirementFindings(reqs: Requirement[], where: string, subject: string): Finding[] {
  const counts = new Map<string, number>();
  for (const r of reqs) counts.set(r.name, (counts.get(r.name) ?? 0) + 1);
  return [...counts]
    .filter(([, n]) => n > 1)
    .map(([name, n]) => ({
      severity: "error" as const,
      code: "spec.duplicate-requirement",
      subject,
      message: `${where}: requirement '${name}' is defined ${n} times — a merge edits only the first, every other copy lives on stale; keep exactly one`,
    }));
}

/** Stable IDs are optional, but once authored they must select exactly one requirement. */
function requirementIdFindings(reqs: Requirement[], where: string, subject: string): Finding[] {
  return requirementIdProblems(reqs).map((problem) => {
    if (problem.kind === "invalid") {
      return {
        severity: "error" as const,
        code: "spec.requirement-id-invalid",
        subject,
        message: `${where}: requirement '${problem.requirement}' has invalid Requirement-ID '${problem.value}' — use 1-128 characters matching [A-Za-z][A-Za-z0-9._-]*`,
      };
    }
    if (problem.kind === "repeated") {
      return {
        severity: "error" as const,
        code: "spec.requirement-id-repeated",
        subject,
        message: `${where}: requirement '${problem.requirement}' declares Requirement-ID ${problem.values.length} times — identity must be declared exactly once`,
      };
    }
    return {
      severity: "error" as const,
      code: "spec.requirement-id-duplicate",
      subject,
      message: `${where}: Requirement-ID '${problem.id}' is shared by ${problem.requirements.map((name) => `'${name}'`).join(", ")} — one ID may identify only one requirement`,
    };
  });
}

/**
 * The two list lines of the requirement grammar, exactly as core/document/spec.ts spells
 * them (mirrored here, not exported from there, because the parser's grammar is
 * its own; a drift shows up as this check counting differently than the parser
 * assigns). A SECOND matching line in one requirement body REPLACES the first —
 * assignment, not append, the documented keep-last quirk — so the author's
 * "long list in two lines" pattern silently loses its first line.
 */
const OPERATIONS_LINE_RE = /^\s*Operations?:\s*(.+?)\s*$/i;
const COVERS_LINE_RE = /^\s*Covers?:\s*(.+?)\s*$/i;

/**
 * `spec.repeated-operations` / `spec.repeated-covers` — warn on the silent
 * loss, keep the keep-last semantics (changing them would re-read every spec
 * in the fleet). Scenario bodies never count: the parser only assigns from the
 * requirement's own body lines, and `Requirement.text` is exactly those.
 * REMOVED requirements are exempt the way coversEntries exempts them — content
 * on its way out obliges nothing.
 */
function repeatedListLineFindings(reqs: Requirement[], where: string, subject: string): Finding[] {
  const out: Finding[] = [];
  for (const r of reqs) {
    if (r.kind === "REMOVED") continue;
    for (const { re, label, code } of [
      { re: OPERATIONS_LINE_RE, label: "Operations:", code: "spec.repeated-operations" },
      { re: COVERS_LINE_RE, label: "Covers:", code: "spec.repeated-covers" },
    ]) {
      const n = r.text.filter((line) => re.test(line)).length;
      if (n < 2) continue;
      out.push({
        severity: "warn",
        code,
        subject,
        message: `${where}: requirement '${r.name}' has ${n} '${label}' lines — the last REPLACES the others (assignment, not append), the earlier list is silently lost; merge them into one comma-separated line`,
      });
    }
  }
  return out;
}

/**
 * `covers.unknown` — the typo guard on the Covers: line. Warn, not error: the
 * axis is advisory end to end, and a wrong id already costs its author the
 * coverage they wrote the line for. The hint offers only real ids (closeIds's
 * rule), and says where resolution looked when there is nothing close.
 * `healthUnreadable` mutes the alert:/sli: forms only: against a health.yaml
 * nobody could read, "did you mean" is a false diagnosis of a typo —
 * health.invalid (emitted by the service target) is the honest one.
 */
function coversUnknownFindings(
  reqs: Requirement[],
  where: string,
  subject: string,
  scope: CoverageScope,
  healthUnreadable = false,
): Finding[] {
  const out: Finding[] = [];
  for (const r of reqs) {
    if (r.kind === "REMOVED") continue;
    for (const raw of r.covers) {
      const entry = parseCoversEntry(raw);
      if (healthUnreadable && (entry.form === "alert" || entry.form === "sli")) continue;
      if (entryResolves(entry, scope)) continue;
      const close = coversCandidates(entry, scope);
      out.push({
        severity: "warn",
        code: "covers.unknown",
        subject,
        message:
          `${where}: requirement '${r.name}' — Covers: '${raw}' resolves to nothing` +
          (close.length > 0
            ? `. Did you mean: ${close.join(", ")}?`
            : " in the model, the landscape or health.yaml"),
      });
    }
  }
  return out;
}

async function validateFeature(
  docsDir: string,
  feature: FeatureEntry,
  preloadedLand?: LoadedDoc | null,
  fleet?: FleetContext,
): Promise<TargetReport> {
  const findings: Finding[] = [];
  const featureDir = feature.dir;
  const featureId = feature.id;

  // delta.likec4 parse + collect tagged edges. The loaded doc is kept and
  // handed to featureCoherence below — loading it is a Langium workspace spin,
  // and paying it twice per feature was the dominant cost of `validate --all`.
  let taggedEls: Elem[] = [];
  let taggedRels: Rel[] = [];
  let elements: Elem[] = [];
  let deltaRels: Rel[] = [];
  let deltaDoc: LoadedDoc | undefined;
  const deltaPath = featurePaths(featureDir).delta;
  if (existsSync(deltaPath)) {
    const res = fleet === undefined ? await loadFile(deltaPath) : await fleet.loadLikeC4(deltaPath);
    deltaDoc = res;
    if (res.errors.length > 0) {
      findings.push({
        severity: "error",
        code: "delta.invalid",
        message: `delta.likec4 has ${res.errors.length} error(s)`,
        details: res.errors.map(errorText),
      });
    } else {
      elements = res.elements;
      deltaRels = res.relationships;
      taggedEls = res.elements.filter((e) => e.tags.includes(featureId));
      taggedRels = res.relationships.filter((r) => r.tags.includes(featureId));
      findings.push({
        severity: "ok",
        code: "delta.valid",
        message: `delta.likec4 valid (${res.elements.length} elements · ${res.relationships.length} relationships)`,
      });
    }
  }

  findings.push(...(await featureProvenance(featureDir, featureId)));

  // Who this feature is allowed to address. `specs/<svc>/` is what the archive
  // materialises `services/<svc>/` from, and nothing used to ask whether that
  // name means anything: one wrong character in `--touches` passed
  // `validate --all` with zero errors, and archive then created the phantom
  // directory. A delta may legitimately name a service that does not exist yet
  // — but only one it INTRODUCES itself, in its own tagged C4. A delta that did
  // not parse proves neither (`delta.invalid` is that finding), so the question
  // is suspended there rather than answered by guessing.
  //
  // `services/<svc>/` is asked for directly rather than through the
  // enumeration: `validate --feature` is allowed to run in a docs repo with no
  // services/ at all (repo.ts takes the same position), where enumerating is a
  // refusal, not an answer.
  const featureServices = await featureSpecServices(featureDir, fleet);
  const introduces: ReadonlySet<string> = new Set(taggedEls.map(elementService));
  const deltaReadable = deltaDoc === undefined || deltaDoc.errors.length === 0;
  const unknownServices = deltaReadable
    ? featureServices.filter(
        (svc) => !existsSync(servicePaths(docsDir, svc).dir) && !introduces.has(svc),
      )
    : [];
  // The near-miss hint, on the same rule `service.unknown` uses — a typo is
  // only diagnosable against the ids that DO exist.
  const closeTo =
    unknownServices.length > 0 && docsRepoState(docsDir).kind === "ok"
      ? (await listServices(docsDir, fleet)).map((s) => s.id)
      : [];
  // The finding is coherence.ts's — the same words archive refuses with, because
  // it is the same conclusion about the same directory.
  for (const svc of unknownServices) findings.push(deltaServiceUnknownFinding(svc, closeTo));

  // Requirement coverage across every per-service delta — the business spec and
  // the arch spec through the same check — and collect scenario text.
  let scenarioText = "";
  const archDeltas: Array<{ service: string; reqs: Requirement[] }> = [];
  for (const svc of featureServices) {
    const p = featureSpecPaths(featureDir, svc);
    if (existsSync(p.spec)) {
      const raw = fleet === undefined ? await readFile(p.spec, "utf8") : await fleet.readText(p.spec);
      scenarioText += "\n" + raw.toLowerCase();
      const reqs = fleet === undefined ? parseRequirements(raw) : await fleet.readRequirements(p.spec);
      // Both document-level breaches carry into the living spec through the
      // merge, so a delta is graded for them exactly as a living document is:
      // conflict markers merge as prose under someone's requirement, and a
      // stepless scenario merges as a requirement the coverage rule calls
      // covered forever after.
      const conflict = documentConflictFinding(`${svc}: spec.md`, svc, raw);
      if (conflict !== null) findings.push(conflict);
      findings.push({ ...coverageFinding(`${svc}: requirements`, reqs), subject: svc });
      findings.push(...steplessFindings(`${svc}: requirements`, svc, reqs));
      // The keep-last quirk loses lines in a delta exactly as in a living spec
      // — and a delta's lost Operations: line then merges into the living one.
      findings.push(...repeatedListLineFindings(reqs, `${svc}: spec.md`, svc));
    }
    if (existsSync(p.archSpec)) {
      const raw = fleet === undefined ? await readFile(p.archSpec, "utf8") : await fleet.readText(p.archSpec);
      scenarioText += "\n" + raw.toLowerCase();
      const reqs = fleet === undefined ? parseRequirements(raw) : await fleet.readRequirements(p.archSpec);
      archDeltas.push({ service: svc, reqs });
      const conflict = documentConflictFinding(`${svc}: arch.spec.md`, svc, raw);
      if (conflict !== null) findings.push(conflict);
      findings.push({ ...coverageFinding(`${svc}: arch requirements`, reqs), subject: svc });
      findings.push(...steplessFindings(`${svc}: arch requirements`, svc, reqs));
      findings.push(...repeatedListLineFindings(reqs, `${svc}: arch.spec.md`, svc));
    }
  }

  // The delta's own element→service resolver, built once for the whole feature.
  // `serviceOf` is a one-shot wrapper that rebuilds its index on every call, and
  // the two loops below ask it up to five times per tagged edge — so a delta
  // over a large model paid for one Map of every element per question asked.
  // Identical answers by construction: `serviceOf(elements, id)` IS
  // `serviceResolver(elements)(id)`, and nothing reassigns `elements` after the
  // delta parse.
  const svcOf = serviceResolver(elements);

  // Arch-edge coverage (heuristic, warn-only): each new tagged edge should be named by a scenario.
  for (const r of taggedRels) {
    const target = svcOf(r.target);
    const covered = edgeCovered(target, r.title, scenarioText);
    findings.push({
      severity: covered ? "ok" : "warn",
      code: covered ? "archedge.covered" : "archedge.uncovered",
      subject: target,
      message: `${svcOf(r.source)} → ${target}  "${r.title ?? ""}"${covered ? "" : "  — no scenario names it"}`,
      text: { indent: 4, header: "arch-edge coverage (heuristic):" },
    });
  }

  // The architecture spec axis, feature scope — the mechanical counterpart of
  // the heuristic above. Every NEW tagged element and edge in the delta wants a
  // `Covers:` line in one of the feature's arch.spec.md deltas (c4.uncovered):
  // this is where agent-built code cuts its corners — the outbox, the retries,
  // the alerts — because no business scenario was ever going to mention them.
  // Grouping-only elements follow the landscape checks' exemptions (person
  // kinds, #external). Warnings, never archive gates; `--strict` escalates.
  //
  // Only requirements the archive will MERGE grant coverage here. In a delta,
  // BASE means "the living state, quoted": it merges nothing, emits no
  // .feature, and yields no scenario.tested claim — so a Covers: line under a
  // plain `## Requirements` quote is an obligation that ships nowhere, and
  // counting it silenced c4.uncovered for free. (The service-scope pass keeps
  // the unfiltered call: a LIVING spec is legitimately all BASE.)
  const activeCovers = archDeltas.flatMap(({ reqs }) =>
    coversEntries(reqs.filter((r) => r.kind === "ADDED" || r.kind === "MODIFIED")),
  );

  // What the living landscape ALREADY holds. A delta has to re-declare the
  // elements its new edges attach to, and authors tag those re-declarations
  // along with everything else — so a requirements-only feature that touches an
  // existing service was told to write `Covers:` lines for architecture it is
  // not adding. c4.uncovered is an obligation on NEW architecture; an element
  // the living landscape already resolves is not new, whatever the tag says.
  // Loaded lazily: a delta with nothing tagged never pays for the parse.
  let living: LoadedDoc | null | undefined = preloadedLand;
  const livingLandscape = async (): Promise<LoadedDoc | null> => {
    if (living === undefined) {
      const lp = landscapeFile(docsDir);
      living = existsSync(lp)
        ? fleet === undefined
          ? await loadFile(lp)
          : await fleet.loadLikeC4(lp)
        : null;
    }
    return living;
  };
  const alreadyLiving = async (): Promise<LoadedDoc | null> => {
    if (taggedEls.length === 0 && taggedRels.length === 0) return null;
    const doc = await livingLandscape();
    return doc !== null && doc.errors.length === 0 ? doc : null;
  };
  const base = await alreadyLiving();
  const baseSvcOf = base === null ? null : serviceResolver(base.elements);
  const baseIds = new Set(base?.elements.map((e) => e.id) ?? []);
  const baseServices = new Set((base?.elements ?? []).map(elementService));
  // How a service→service pair is keyed, spelled ONCE. The two sides used to
  // join with different separators — a NUL where the set was built, a space
  // where it was queried — so the exemption never matched anything, and every
  // edge a delta re-declares verbatim (which it must, to attach anything to
  // it) was reported as new architecture nobody covers. The join is structural
  // rather than a separator character: the last one was a NUL, and a raw NUL in
  // a template literal makes the source read as binary to `file` and invisible
  // to `grep` — which is how a one-character mismatch survived review.
  const edgeKey = (source: string, target: string): string => JSON.stringify([source, target]);
  const baseEdges = new Set(
    (base?.relationships ?? []).map((r) => edgeKey(baseSvcOf!(r.source), baseSvcOf!(r.target))),
  );

  for (const e of taggedEls) {
    if (ACTOR_KINDS.has(e.kind.toLowerCase()) || e.tags.includes(EXTERNAL_TAG)) continue;
    if (baseIds.has(e.id) || baseServices.has(elementService(e))) continue;
    if (activeCovers.some((c) => coversElement(c, e))) continue;
    findings.push({
      severity: "warn",
      code: "c4.uncovered",
      subject: elementService(e),
      message: `delta adds '${e.title}' (${e.id}) but no arch requirement covers it — add 'Covers: ${e.id}' to a specs/<svc>/arch.spec.md delta, or its architectural obligations ship unchecked`,
    });
  }
  for (const r of taggedRels) {
    if (baseEdges.has(edgeKey(svcOf(r.source), svcOf(r.target)))) continue;
    if (activeCovers.some((c) => coversEdge(c, r, elements))) continue;
    findings.push({
      severity: "warn",
      code: "c4.uncovered",
      subject: svcOf(r.target),
      message: `delta adds edge ${svcOf(r.source)} → ${svcOf(r.target)} ("${r.title ?? ""}") but no arch requirement covers it — add 'Covers: ${r.source} -> ${r.target}' to a specs/<svc>/arch.spec.md delta`,
    });
  }

  // covers.unknown, feature scope. Resolution looks at the delta itself, the
  // living landscape, the service's own model and its health.yaml — a delta's
  // arch requirement may cover an element it adds, one that already exists, or
  // an alert the service declares. The landscape and each model are loaded
  // lazily, and only when an entry fails against what is already in hand: the
  // clean path never pays for a workspace spin.
  if (archDeltas.some(({ reqs }) => coversEntries(reqs).length > 0)) {
    const land = await livingLandscape();
    const landParses = land !== null && land.errors.length === 0 ? land : null;
    const baseElements = [...elements, ...(landParses?.elements ?? [])];
    const baseRels = [...deltaRels, ...(landParses?.relationships ?? [])];
    for (const { service: svc, reqs } of archDeltas) {
      // An unreadable living health.yaml mutes the alert:/sli: entries here
      // exactly as in service scope — the health.invalid finding itself
      // belongs to the service target, which owns the file's diagnosis.
      const health = await readHealth(servicePaths(docsDir, svc).health);
      let scope: CoverageScope = { elements: baseElements, relationships: baseRels, health: health.ids };
      const unresolved = coversUnknownFindings(reqs, `${svc}: arch.spec.md`, svc, scope, health.unreadable);
      if (unresolved.length > 0) {
        const modelPath = servicePaths(docsDir, svc).model;
        const model = existsSync(modelPath)
          ? fleet === undefined
            ? await loadFile(modelPath)
            : await fleet.loadLikeC4(modelPath)
          : null;
        if (model !== null && model.errors.length === 0) {
          scope = {
            elements: [...baseElements, ...model.elements],
            relationships: [...baseRels, ...model.relationships],
            health: health.ids,
          };
        }
        findings.push(...coversUnknownFindings(reqs, `${svc}: arch.spec.md`, svc, scope, health.unreadable));
      }
    }
  }

  // Coherence — cross-axis consistency (C4 ↔ requirements ↔ OpenAPI).
  const issues = await featureCoherence(docsDir, featureDir, featureId, deltaDoc, fleet);
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

/**
 * `--errors-only` is a RENDERING lever, the way `--strict` is an exit-code
 * lever: neither changes the report, and the `--json` payload is unaffected by
 * both. On a fleet of a hundred services the clean run prints several hundred
 * `ok` confirmations, and the two warnings that matter are somewhere inside it;
 * anyone reading a CI log wants the exceptions, and anyone auditing wants all
 * of it. Both are available, from the same run, and neither is the default.
 */
function renderText(
  targets: TargetReport[],
  all: boolean,
  unverifiable: number,
  errorsOnly: boolean,
): void {
  for (const t of targets) {
    const shown = errorsOnly ? t.findings.filter((f) => f.severity !== "ok") : t.findings;
    if (shown.length === 0) continue;
    // A feature announces itself; a service's findings already carry its name.
    if (t.kind === "feature") console.log(t.id);
    let header: string | undefined;
    for (const f of shown) {
      const hint = f.text ?? {};
      if (hint.header && hint.header !== header) {
        header = hint.header;
        console.log(`  ${header}`);
      }
      // The whole report goes to stdout, in document order. Splitting errors
      // onto stderr meant a piped stdout silently lost them from the middle of
      // the report and 2>&1 could reorder it; the exit code carries failure,
      // and stderr stays reserved for refusals (the fail() path).
      const marker = hint.marker === false ? "" : `${SEVERITY_MARK[f.severity]} `;
      console.log(`${" ".repeat(hint.indent ?? 0)}${marker}${f.message}`);
      for (const d of f.details ?? []) console.log(`    ${hint.detailPrefix ?? ""}${d}`);
    }
  }

  if (!all) {
    // Without the --all footer there would be nothing at all to print for a
    // clean single target under --errors-only — and silence is the one output
    // that must never mean "checked, fine".
    if (errorsOnly && targets.every((t) => t.findings.every((f) => f.severity === "ok"))) {
      console.log(`${targets.map((t) => t.id).join(", ")}: no errors or warnings`);
    }
    return;
  }
  const s = summary(targets);
  console.log(
    `\n${plural(s.services, "service")}, ${plural(s.features, "feature")} — ` +
      `${plural(s.errors, "error")}, ${plural(s.warnings, "warning")}`,
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
 * The two things a `sources` list can be that `serviceProvenance` cannot say.
 *
 * `sources.unverifiable-from-here` — the spec names sources and loam is NOT in
 * that service's repository, so every sources check (existence, digest,
 * staleness) is skipped. serviceProvenance returns an empty list in that case
 * and the silence read as "checked and fine". It used to be counted only under
 * `--all` and printed as one rollup line, which meant `validate --service X`
 * run from the docs repo — the single most common way anyone looks at one
 * service — reported nothing at all about its own blind spot. Severity `ok`,
 * deliberately: nothing is WRONG with the docs, the check simply cannot run
 * here, and grading it a warning would make a correctly-adopted fleet
 * permanently yellow and `--strict` permanently red in the docs repo's CI.
 *
 * `sources.empty` — the paths exist, and expand to no files at all: an empty
 * directory, or a tree the repository itself ignores. A digest over nothing
 * never changes, so the stamp would read as current forever. `loam vouch`
 * already refuses to stamp it; until now `validate` said nothing, so an author
 * got a green run followed by a refusal, two commands contradicting each other
 * about one document. The sentence comes from `emptySourcesMessage`, the same
 * definition vouch refuses with, under the label vouch uses.
 */
async function sourceScopeFindings(
  docsDir: string,
  service: string,
  repoDir: string | undefined,
): Promise<Finding[]> {
  const paths = servicePaths(docsDir, service);
  const out: Finding[] = [];
  // The axis pair is SPEC_AXES', not this function's: `serviceProvenance` grades
  // the same two files from the same list, and a scope check that walked a
  // shorter list than the grading would go quiet on the axis it forgot.
  for (const { path, file } of SPEC_AXES.map((axis) => ({ path: paths[axis.key], file: axis.file }))) {
    if (!existsSync(path)) continue;
    const sources = listField(await readFrontmatter(path), "sources");
    if (sources.length === 0) continue;
    // vouch's own labelling: a bare service id for spec.md, qualified for the
    // arch axis. The refusal and the finding must be the same sentence.
    const label = file === "spec.md" ? service : `${service}: ${file}`;
    if (repoDir === undefined) {
      out.push({
        severity: "ok",
        code: UNVERIFIABLE,
        subject: service,
        message: `${label}: ${sources.length} source(s) declared, but this is not ${service}'s repository — nothing here can resolve them. Run \`loam validate --service ${service}\` from inside it.`,
      });
      continue;
    }
    // Every other shape of broken list is serviceProvenance's to grade, and
    // grading them twice would send an author fixing one thing from two
    // findings. "Covers no files" is only meaningful once the paths are real.
    if (
      patternSources(sources).length > 0 ||
      unsafeSources(repoDir, sources).length > 0 ||
      missingSources(repoDir, sources).length > 0
    ) {
      continue;
    }
    const expansion = await expandSourceFiles(repoDir, sources, label);
    if (expansion.files.length > 0) continue;
    out.push({
      severity: "warn",
      code: "sources.empty",
      subject: service,
      message: expansion.empty ?? emptySourcesMessage(label, sources),
    });
  }
  return out;
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
