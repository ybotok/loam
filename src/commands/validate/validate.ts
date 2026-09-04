/**
 * `loam validate` — argument grammar, target selection, and the run's one
 * filesystem snapshot.
 *
 * The checks themselves live beside it, one module per target kind
 * (`landscape.ts`, `service/`, `feature/`) over the document checks they share
 * (`requirements.ts`). Every one of them produces findings and none of them
 * print: printing is `report.ts`'s, and it happens once, after the last target
 * is graded.
 */
import type { Command } from "commander";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { agentsStaleFinding, binaryBehindFinding } from "../../core/agent/agents-stamp.js";
import { inOrder } from "../../core/kernel/concurrency.js";
import type { RawServiceId } from "../../core/kernel/ids/service.js";
import { resolveServiceTarget } from "../../core/repo/service-target.js";
import { loadConfig } from "../../core/envelope/config.js";
import { emitJson, fail, NO_SERVICE_MESSAGE, reportNoConfig } from "../../core/envelope/json.js";
import { DocsRepoUnavailableError } from "../../core/repo/state.js";
import { agentsPath as agentsFile, landscapePath as landscapeFile } from "../../core/repo/paths.js";
import { listFeatures, listServices, missingFeatureMessage, resolveFeature } from "../../core/repo/repo.js";
import {
  countSeverity,
  reportValid,
  targetJson,
  targetValid,
  type TargetReport,
} from "../../core/vocabulary/report.js";
import { LOAM_VERSION } from "../../core/envelope/version.js";
import { FleetContext } from "../../core/fleet-context.js";
import { fixesFor } from "../policy/format.js";
import {
  docsRepoReady,
  reportDocsRepoError,
  reportRepositoryUnavailable,
} from "../policy/gate.js";
import { interruptedCommitFinding } from "../../core/staging/recovery/finding.js";
import { scopeJson, scopeLine, scopeSince, type ValidateScope } from "../../core/diff/scope/changed-paths.js";
import { validateLandscape } from "./fleet/landscape.js";
import { prefetchFleetDocuments, readLandscape } from "./fleet/load.js";
import { buildScorecard } from "./fleet/scorecard/scorecard.js";
import { printScorecard } from "./fleet/scorecard/print.js";
import { validateFeature } from "./feature.js";
import { validateService } from "./service/service.js";
import { ambiguousTarget, capDetails, guarded, renderText, summary, unverifiableSubjects } from "./report.js";

interface ValidateOptions {
  service?: string;
  feature?: string;
  all?: boolean;
  base?: string;
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
    .option("--base <ref>", "with --all: grade only the targets changed since a base git ref of the docs repo — the adoption ratchet")
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

      const loaded = await loadConfig();
      if (loaded.kind !== "loaded") {
        reportNoConfig(json, loaded);
        return;
      }
      const config = loaded.config;
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
          validateService({ docsDir, service: id, repoDir: repoOf(id), gherkinDir: config.gherkinDir, contracts: config.contracts, fleet }),
        );

      const targets: TargetReport[] = [];
      /** What the positional argument turned out to name, for the JSON payload. */
      let resolvedKind: "service" | "feature" | undefined;
      /** The `--base` narrowing, once it is known. Null on every unscoped run — including every run without --base. */
      let scope: ValidateScope | null = null;

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
          await prefetchFleetDocuments({ docsDir, fleet, services, features });
          // Read whether or not the landscape is a TARGET: every service check
          // below joins against it, so a scoped run needs the map in hand even
          // when it does not grade the map itself. Through the fleet index, so
          // the single-service path — which now reads the same project — answers
          // out of the same memo rather than parsing it a second time.
          const land = existsSync(lp) ? await readLandscape(() => fleet.architecture(docsDir)) : null;
          // The fleet-level cross-check first: it frames everything below it, and a
          // service nobody drew is worth knowing before its own findings scroll past.
          // Under `--base` it is a target only when `architecture/` changed — the
          // landscape owns no service directory, so that is its whole footprint.
          if (scope === null || scope.landscape) {
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
          }
          targets.push(
            ...(await inOrder(services, (svc) =>
              guarded({ kind: "service", id: svc.id }, () =>
                validateService({
                  docsDir,
                  service: svc.id,
                  repoDir: repoOf(svc.id),
                  preloaded: land,
                  gherkinDir: config.gherkinDir,
                  contracts: config.contracts,
                  fleet,
                  landscapeReported: true,
                }),
              ),
            )),
          );
          targets.push(
            ...(await inOrder(features, (feat) =>
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

      // By subject, not by finding — the rule lives with the rollup in report.ts.
      const unverifiable = unverifiableSubjects(targets);
      // A journal in the repo outranks everything graded above: the docs may
      // be half-merged, and in CI a green over them merges. Led, not appended
      // — it is the reason nothing below can be trusted — and attached to the
      // first target because a finding lives in one.
      const interrupted = await interruptedCommitFinding(docsDir);
      if (interrupted !== null && targets.length > 0) targets[0]!.findings.unshift(interrupted);

      // The fleet scorecard, --all only: recomputed per invocation off the same
      // memoized reads this run already made — loam stores no history — and it
      // fails closed per axis, never whole (fleet/scorecard/scorecard.ts).
      //
      // Suppressed under `--base`: its denominators are the graded targets, so
      // over a narrowed set it reads "2 of 2 services documented" for a fleet
      // where ten more are not — and its axes license report.ts's grouping,
      // which would drop real warnings because an unlooked-at axis reads zero.
      const scorecard =
        opts.all && scope === null
          ? await buildScorecard({ docsDir, targets, fleet, boundService: config.service })
          : null;

      const valid = reportValid(targets);
      const capped = targets.map(capDetails);
      if (json) {
        emitJson({
          command: "validate",
          valid,
          summary: summary(targets),
          ...(resolvedKind === undefined ? {} : { resolvedKind }),
          // What this run looked at. Only under `--base`, so an unscoped payload
          // is today's document and its ABSENCE says `summary` counts the whole
          // fleet — scopeJson has why a scoped one may not stay silent.
          ...(scope === null ? {} : { scope: scopeJson(scope) }),
          // Emitted in every mode now that it is derived per service: a
          // single-service run knows exactly as much about its own blind spot
          // as `--all` knows about the fleet's.
          sourcesUnverifiableFromHere: unverifiable,
          ...(scorecard === null ? {} : { scorecard }),
          // What to do about every code this run raised — the one thing the
          // payload could not previously answer. `validate` is step 1 of every
          // generated protocol and the command an agent reads first, and until
          // now it replied in prose: a finding names a code and says what is
          // wrong, and nothing in it said that `loam explain <code>` knows what
          // to do next.
          //
          // A top-level MAP, not a field on each finding, for the reason
          // report.ts's DETAIL_LIMIT gives about evidence: a hundred-service
          // fleet raising one code a hundred times would ship the same
          // sentence a hundred times, in the interface an agent pipes into a
          // context window. The consumer joins `findings[].code` to
          // `fixes[code]` — one lookup, no round trip, no repetition.
          //
          // Keyed ONLY by codes a non-`ok` finding raised. A confirmation has
          // nothing to fix, and on a clean fleet the `ok` codes are the
          // overwhelming majority of findings; attaching fixes to them would
          // pay the whole vocabulary's byte cost to tell a reader that nothing
          // is wrong. `targets` is read here rather than `capped` because
          // capping truncates evidence, not findings — the two raise the same
          // codes, and reading the uncapped set keeps this rollup computed off
          // the same targets as `summary()`.
          //
          // Not behind a flag, deliberately. It is additive, so no consumer
          // that ignores it is affected; it is small, because it carries only
          // the handful of codes this run actually raised rather than the
          // 227-row vocabulary; and a flag would mean an agent has to already
          // know the fixes exist in order to ask for them — which is the exact
          // gap being closed. It is emitted on a green run too, as `{}`, so a
          // consumer never has to branch on the key's presence before looking
          // a code up in it.
          fixes: fixesFor(
            targets.flatMap((t) => t.findings.filter((f) => f.severity !== "ok").map((f) => f.code)),
          ),
          targets: capped.map(targetJson),
        });
      } else {
        // The scope FIRST: a reader has to know what the report below is a
        // report ABOUT, and in the zero-target case there is nothing below at
        // all — printed after the findings, the one run that most needs words
        // would read as a green over the whole system.
        if (scope !== null) console.log(scopeLine(scope));
        renderText(capped, {
          all: opts.all === true,
          errorsOnly: opts.errorsOnly === true,
          unverifiable,
          scorecard,
        });
        if (scorecard !== null) printScorecard(scorecard);
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

export { targetValid };
