/**
 * `loam validate` — argument grammar, target selection, and the run's one
 * filesystem snapshot.
 *
 * The checks themselves live beside it, one module per target kind
 * (`landscape.ts`, `service/`, `feature/`) over the document checks they share
 * (`requirements.ts`). Every one of them produces findings and none of them
 * print: printing is `render/emit.ts`'s, and it happens once, after the last
 * target is graded.
 */
import type { Command } from "commander";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { agentsStaleFinding, binaryBehindFinding } from "../../core/agent/agents-stamp.js";
import { inOrder } from "../../core/kernel/concurrency.js";
import type { RawServiceId } from "../../core/kernel/ids/service.js";
import { resolveServiceTarget } from "../../core/repo/service-target.js";
import type { LoadedDoc } from "../../core/c4/likec4.js";
import type { FeatureEntry } from "../../core/repo/entries.js";
import { loamOwnedFiles } from "../../core/envelope/config.js";
import { configOrRefuse, fail, NO_VALIDATE_TARGET_MESSAGE } from "../../core/envelope/json.js";
import { DocsRepoUnavailableError } from "../../core/repo/state.js";
import { agentsPath as agentsFile, landscapePath as landscapeFile } from "../../core/repo/paths.js";
import { listFeatures, listServices, missingFeatureMessage, resolveFeature } from "../../core/repo/repo.js";
import { countSeverity, reportValid, type TargetReport } from "../../core/vocabulary/report.js";
import { LOAM_VERSION } from "../../core/envelope/version.js";
import { FleetContext } from "../../core/fleet-context.js";
import {
  docsRepoReady,
  reportDocsRepoError,
  reportRepositoryUnavailable,
} from "../policy/gate.js";
import { interruptedCommitFinding } from "../../core/staging/recovery/finding.js";
import { scopeSince, type ValidateScope } from "../../core/diff/scope/changed-paths.js";
import { validateLandscape } from "./fleet/landscape.js";
import { prefetchFleetDocuments, readLandscape } from "./fleet/load.js";
import { buildScorecard } from "./fleet/scorecard/scorecard.js";
import { validateFeature } from "./feature.js";
import { validateService } from "./service/service.js";
import { scopedLandscapeFindings } from "./scope.js";
import { introducedBinding, type IntroducedBinding } from "./checks/introduced.js";
import { ambiguousTarget, capDetails, guarded, summary, unverifiableSubjects } from "./report.js";
import { emitValidateReport } from "./render/emit.js";
import { applySpineLens, SPINE_REFUSES_FEATURE } from "./lens/spine.js";
import { spineMeter } from "./lens/joins.js";

interface ValidateOptions {
  service?: string;
  feature?: string;
  all?: boolean;
  base?: string;
  strict?: boolean;
  errorsOnly?: boolean;
  spine?: boolean;
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
    .option("--base <ref>", "with --all: grade only the targets changed since a base git ref of the docs repo — the adoption ratchet")
    .option("--strict", "exit 1 on any warning too — a per-invocation CI lever; the report and --json payload do not change")
    .option("--errors-only", "print only errors and warnings — a rendering lever; the --json payload does not change")
    .option(
      "--spine",
      "grade only the fleet spine — every operation and message a map edge names, against the contracts at both ends, " +
        "and whatever would stop that check running; findings on the adoption axes are counted, not graded, and features are not graded",
    )
    .option("--json", "emit the machine contract instead of the human view")
    .action(async (target: string | undefined, opts: ValidateOptions) => {
      const json = opts.json === true;
      // The lens grades the LIVING map's joins. A feature is a proposal its own
      // gate grades in full, and a feature graded through a partition built for
      // a fleet that has adopted nothing would pass deltas that gate refuses.
      // The positional and the bound-service spellings of a feature are refused
      // where they resolve, below, with the same sentence.
      if (opts.spine === true && opts.feature !== undefined) {
        fail(json, "invalid-option", SPINE_REFUSES_FEATURE);
        return;
      }

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
      // `--base` NARROWS a whole-fleet run; it does not name one. Beside a
      // positional, `--service` or `--feature` it is a scope over a scope — a
      // contradiction rather than a narrowing, whose "this service if it
      // changed" reading nobody could tell apart from a green over a service
      // never looked at. `--base` and not `--since`: `--base <ref>` is already
      // loam's word for a base git ref of the docs repo on diff and vouch.
      if (opts.base !== undefined && opts.all !== true) {
        fail(
          json,
          "invalid-option",
          target !== undefined || opts.service || opts.feature
            ? "--base narrows --all to what changed since a ref; a named target is already a scope. Pass one or the other."
            : "--base narrows --all to what changed since a ref — pass --all with it.",
        );
        return;
      }

      const config = await configOrRefuse(json);
      if (config === null) return;
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
      // What loam itself wrote into that repository, which no `sources` list owes a reading of.
      const loamOwned = loamOwnedFiles(config);

      /**
       * One service target, from a name the enumeration or the grammar approved.
       * `land` is --all's landscape, read once for the whole run and handed to
       * the service. Null is PASSED — it means "there is no landscape file" —
       * so the test is `=== undefined`, never truthiness: a repo with no
       * landscape would otherwise re-load per service and double-report.
       *
       * `landscapeReported` says whether this run ALSO emits a landscape target
       * to carry the map's parse errors, and it is the caller's to state: a
       * preloaded map does not imply one. It used to be read off `land`, and
       * under `--base` the landscape is a target only when the branch changed
       * `architecture/` — so a broken committed map and a branch touching only
       * a service told that service "reported once, on the landscape target"
       * with no details, and the parser output was reported nowhere.
       */
      const serviceTarget = (id: RawServiceId, land?: LoadedDoc | null, landscapeReported = false): Promise<TargetReport> =>
        guarded({ kind: "service", id }, docsDir, () =>
          validateService({
            docsDir, service: id, repoDir: repoOf(id), loamOwned, gherkinDir: config.gherkinDir, contracts: config.contracts, fleet,
            ...(land === undefined ? {} : { preloaded: land }),
            landscapeReported,
          }),
        );
      /** One feature target; `land` as above, and left undefined it means "load it if you need it". */
      const featureTarget = (feature: FeatureEntry, land?: LoadedDoc | null): Promise<TargetReport> =>
        guarded({ kind: "feature", id: feature.id }, docsDir, () => validateFeature(docsDir, feature, land, fleet));

      const targets: TargetReport[] = [];
      /** What the positional argument turned out to name, for the JSON payload. */
      let resolvedKind: "service" | "feature" | undefined;
      /** The `--base` narrowing, once it is known. Null on every unscoped run — including every run without --base. */
      let scope: ValidateScope | null = null;
      /** The features a bare run validated in place of a bound service they introduce. Null on every other run. */
      let introduced: IntroducedBinding | null = null;
      /** Under --spine on --all: the active (or, under --base, changed) features the lens did not build. */
      let featuresSkipped = 0;

      try {
        if (opts.all) {
          // ONE workspace per document kind for the whole run — the block moved
          // to `fleet/load.ts` (`prefetchFleetDocuments`), which is where the
          // rule about which shape parses in which workspace belongs.
          const lp = landscapeFile(docsDir);
          const enumerated = await listServices(docsDir, fleet);
          const active = await listFeatures(docsDir, {}, fleet);
          // `--base` narrows the enumerations and nothing else: a kept target is
          // graded by exactly the checks `--all` would have run on it, at the
          // same severities, through the same `--strict`. It matches through the
          // ENUMERATIONS' own directories — changed-paths.ts says why a split
          // on "/" silently drops every filed service.
          if (opts.base !== undefined) {
            const narrowed = await scopeSince({ docsDir, ref: opts.base, services: enumerated, features: active });
            if (narrowed.kind === "refused") {
              fail(json, narrowed.code, narrowed.message);
              return;
            }
            scope = narrowed;
          }
          const services = scope === null ? enumerated : scope.services;
          const features = scope === null ? active : scope.features;
          // No feature delta is parsed under the lens: none is graded, and the
          // fleet checks reach a feature only for a service no directory holds,
          // which an enumerated fleet never has.
          await prefetchFleetDocuments({ docsDir, fleet, services, features: opts.spine === true ? [] : features });
          // Read whether or not the landscape is a TARGET: every service check
          // below joins against it, so a scoped run needs the map in hand even
          // when it does not grade the map itself. Through the fleet index, so
          // the single-service path — which now reads the same project — answers
          // out of the same memo rather than parsing it a second time.
          const land = existsSync(lp) ? await readLandscape(() => fleet.architecture(docsDir)) : null;
          // The fleet-level cross-check first: it frames everything below it, and a
          // service nobody drew is worth knowing before its own findings scroll past.
          // Under `--base` it is a target only when `architecture/` changed — the
          // landscape owns no service directory, so that is its whole footprint —
          // and even then not whole: `scope.ts` drops what grades a file the
          // branch left alone and adds the call edges it wrote.
          const landscapeIsTarget = scope === null || scope.landscape;
          if (landscapeIsTarget) {
            const landscape = await validateLandscape(docsDir, land, fleet);
            targets.push(landscape);
            // The agent contract check, --all only: AGENTS.md is written once and
            // never refreshed (the ownership contract), so the one thing the
            // docs-repo-wide mode owes it is detection — a stamp older than the
            // binary means agents are branching on tables the binary no longer
            // honours. It grades the repo, not any service, so it rides on the
            // landscape target.
            const agentsPath = agentsFile(docsDir);
            const agentsText = existsSync(agentsPath) ? await readFile(agentsPath, "utf8") : null;
            const agents = agentsStaleFinding(agentsText, LOAM_VERSION);
            if (agents !== null) landscape.findings.push(agents);
            // The other direction, and the one that changes what a PASS means:
            // this binary predates the corpus, so a directive it cannot parse is
            // read as prose and produces no join to fail.
            const behind = binaryBehindFinding(agentsText, LOAM_VERSION);
            if (behind !== null) landscape.findings.push(behind);
            if (scope !== null) {
              landscape.findings = await scopedLandscapeFindings(landscape.findings, {
                docsDir, scope, land, services: enumerated, fleet,
              });
            }
          }
          targets.push(...(await inOrder(services, (svc) => serviceTarget(svc.id, land, landscapeIsTarget))));
          // A feature is a proposal its own gate grades (the refusals above), so
          // the lens builds none — and counts them, so the skip is said, not silent.
          if (opts.spine === true) featuresSkipped = features.length;
          else targets.push(...(await inOrder(features, (feat) => featureTarget(feat, land))));
        } else if (opts.feature) {
          const feature = await resolveFeature(docsDir, opts.feature, "exclude", fleet);
          if (!feature) {
            fail(json, "unknown-target", await missingFeatureMessage(docsDir, opts.feature, fleet));
            return;
          }
          targets.push(await featureTarget(feature));
        } else if (target !== undefined) {
          // The positional reads the way `show` reads one: try the feature first
          // (ids like FEAT-101 are distinctive, service names are arbitrary), then
          // the service. --service/--feature stay as the explicit spellings for a
          // name that could be both — and when both readings exist, the run says
          // so out loud instead of silently taking one (`target.ambiguous`).
          const feature = await resolveFeature(docsDir, target, "exclude", fleet);
          const isService = (await listServices(docsDir, fleet)).some((s) => s.id === target);
          if (feature) {
            if (opts.spine === true) return fail(json, "invalid-option", SPINE_REFUSES_FEATURE);
            resolvedKind = "feature";
            const report = await featureTarget(feature);
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
          if (!service) return fail(json, "invalid-option", NO_VALIDATE_TARGET_MESSAGE);
          const resolved = await resolveServiceTarget(docsDir, service, "--service", fleet);
          if (!resolved.ok) return fail(json, "invalid-option", resolved.problem);
          // A bound service a feature in flight introduces has no services/ directory yet, so its documents are
          // validated where they are — the binding's reading only, since `--service` forces a service target.
          introduced = opts.service === undefined ? await introducedBinding(docsDir, resolved, fleet) : null;
          if (introduced !== null && opts.spine === true) return fail(json, "invalid-option", SPINE_REFUSES_FEATURE);
          if (introduced === null) targets.push(await serviceTarget(resolved.id));
          else targets.push(...(await inOrder(introduced.features, (feat) => featureTarget(feat))));
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

      // A journal in the repo outranks everything graded above: the docs may
      // be half-merged, and in CI a green over them merges. Led, not appended
      // — it is the reason nothing below can be trusted — and attached to the
      // first target because a finding lives in one. `lead` keeps it leading
      // in the fleet report too, which orders targets by kind rather than by
      // position (render/text.ts) and would otherwise print it wherever the
      // first target landed.
      const interrupted = await interruptedCommitFinding(docsDir);
      if (interrupted !== null && targets.length > 0) {
        targets[0]!.findings.unshift({ ...interrupted, text: { ...interrupted.text, lead: true } });
      }
      // `--spine` PARTITIONS what was graded — every check above ran exactly as
      // it runs without the flag, at the same severity — and from here on every
      // rollup reads the shown half: `valid`, the summary, `fixes`, the
      // unverifiable count, the text report and `--strict` (lens/spine.ts). The
      // journal finding above is partitioned too, and the lens always shows it.
      const lensed = opts.spine === true ? applySpineLens(targets) : null;
      const graded = lensed?.targets ?? targets;
      // How many joins THIS run graded (lens/joins.ts): the whole map's on an
      // unscoped `--all`; otherwise those bound to a service it graded, plus
      // under `--base` the edges the branch wrote — never the map's total
      // beside a scope line saying something narrower was looked at.
      const whole = opts.all === true && scope === null;
      const gradedServices = graded.filter((t) => t.kind === "service").map((t) => t.id);
      const joins = lensed === null ? null : await spineMeter({
        docsDir, fleet, graded: whole ? null : new Set(gradedServices), changed: scope?.edges ?? new Set<string>(),
      });
      // By subject, not by finding — the rule lives with the rollup in report.ts.
      const unverifiable = unverifiableSubjects(graded);

      // The fleet scorecard, --all only: recomputed per invocation off the same
      // memoized reads this run already made — loam stores no history — and it
      // fails closed per axis, never whole (fleet/scorecard/scorecard.ts).
      //
      // Suppressed under `--base`: its denominators are the graded targets, so
      // over a narrowed set it reads "2 of 2 services documented" for a fleet
      // where ten more are not — and its axes license report.ts's grouping,
      // which would drop real warnings because an unlooked-at axis reads zero.
      // Suppressed under `--spine` for the same reason one level up: every one
      // of its denominators is an adoption measure, the axes the lens counts
      // instead of grading, so beside a lensed green it would grade them anyway.
      const scorecard =
        opts.all && scope === null && lensed === null
          ? await buildScorecard({ docsDir, targets, fleet, boundService: config.service })
          : null;

      const valid = reportValid(graded);
      // Printing is a phase of its own (render/emit.ts): every target is
      // graded by now, and nothing it does can move a finding or the exit code.
      // One rollup for both views: the --json summary and the text footer
      // print this object, never a count of their own.
      emitValidateReport({
        json, all: opts.all === true, errorsOnly: opts.errorsOnly === true,
        targets: graded, capped: graded.map(capDetails), totals: summary(graded),
        valid, resolvedKind, scope, introduced, unverifiable, scorecard,
        lens: lensed === null ? null : {
          hidden: lensed.hidden, joins, featuresSkipped,
          over: whole ? null : opts.all === true ? "in this run's scope" : `on ${gradedServices.join(", ")}`,
        },
      });
      // --strict is a per-invocation CI lever: it fails the run on any error or
      // warning (ok-severity confirmations never trip it — virtually every
      // clean target emits some), and changes nothing else — `valid` keeps meaning "no
      // errors" in text and JSON alike, so two pipelines reading the same repo
      // may grade the same report differently and both are telling the truth.
      // Under `--spine` it counts what the lens SHOWS, so `--spine --strict`
      // fails on a deprecated join and never on an adoption warning.
      const strictFailed =
        opts.strict === true &&
        countSeverity(graded, "error") + countSeverity(graded, "warn") > 0;
      if (!valid || strictFailed) process.exitCode = 1;
    });
}
