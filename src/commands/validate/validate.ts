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
import { agentsStaleFinding } from "../../core/agent/agents-stamp.js";
import { inOrder } from "../../core/kernel/concurrency.js";
import type { RawServiceId } from "../../core/kernel/ids.js";
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
import {
  docsRepoReady,
  reportDocsRepoError,
  reportRepositoryUnavailable,
} from "../docs-repo-gate.js";
import { readLandscape, validateLandscape } from "./landscape.js";
import { validateFeature } from "./feature.js";
import { validateService } from "./service/service.js";
import { ambiguousTarget, capDetails, guarded, renderText, summary } from "./report.js";
import { UNVERIFIABLE } from "./checks/vocabulary.js";

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

export { targetValid };
