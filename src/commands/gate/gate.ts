/**
 * `loam gate` — can this service deploy, as far as RECORDED evidence can say?
 *
 * A pure query for DEPLOY pipelines outside loam's own lifecycle (Pact's
 * can-i-deploy insight: the gate executes nothing and queries evidence
 * previously recorded). It reads, never writes, never takes the docs lock, and
 * deliberately changes NOTHING about what gates `loam archive` — verify still
 * never gates the merge (WORKFLOW.md, "What actually gates"); this command's
 * verdict is advice to a pipeline loam does not own. Advisory by default:
 * warnings exit 0, errors exit 1, and `--strict` is the CI lever that
 * escalates warnings — validate's exact idiom, not a second spelling of it.
 *
 * Not to be confused with `commands/policy/gate.ts`, which is the docs-repo
 * READINESS doctrine (docsRepoReady and friends) every reading command shares
 * — including this one, one import below.
 */
import type { Command } from "commander";
import { loadConfig } from "../../core/envelope/config.js";
import { emitJson, fail, NO_SERVICE_MESSAGE, reportNoConfig } from "../../core/envelope/json.js";
import { FleetContext } from "../../core/fleet-context.js";
import { gateReport } from "../../core/gate/checks.js";
import { gateSummary, gateVerdict } from "../../core/gate/report.js";
import { nearestIds } from "../../core/repo/entries.js";
import { enumeratedServiceIds, resolveServiceTarget } from "../../core/repo/service-target.js";
import { DocsRepoUnavailableError } from "../../core/repo/state.js";
import { findingJson } from "../../core/vocabulary/report.js";
import {
  docsRepoReady,
  reportDocsRepoError,
  reportRepositoryUnavailable,
} from "../policy/gate.js";
import { printGate } from "./print.js";

interface GateOptions {
  service?: string;
  strict?: boolean;
  json?: boolean;
}

export function registerGate(program: Command): void {
  program
    .command("gate")
    .description("Can this service deploy? A read-only query over recorded evidence — advisory by default")
    .option("--service <id>", "the service being deployed (defaults to the configured service)")
    .option("--strict", "exit 1 on any warning too — a per-invocation CI lever; the report and --json payload do not change")
    .option("--json", "emit the machine contract instead of the human view")
    .action(async (opts: GateOptions) => {
      const json = opts.json === true;
      const loaded = await loadConfig();
      if (loaded.kind !== "loaded") {
        reportNoConfig(json, loaded);
        return;
      }
      const config = loaded.config;
      const { docsDir } = config;
      // The gate joins partners and enumerates features against services/ —
      // a docsDir that is not a docs repo must refuse, never answer "pass"
      // over an empty fleet (docsRepoReady's whole doctrine).
      if (!docsRepoReady(json, docsDir, "services")) return;
      // The deploy-pipeline invocation is literally `loam gate --json` in a
      // bound service repo: the binding IS the service being deployed.
      const service = opts.service ?? config.service;
      if (!service) {
        fail(json, "invalid-option", NO_SERVICE_MESSAGE);
        return;
      }
      // One invocation, one filesystem snapshot (validate's rule).
      const fleet = new FleetContext();

      try {
        // Enumeration first, grammar second — service-target.ts's banner: the
        // one directory a caller most needs to ask about may carry a name the
        // grammar refuses, so the raw argument is never assertServiceId'd here.
        const resolved = await resolveServiceTarget(docsDir, service, "--service", fleet);
        if (!resolved.ok) {
          fail(json, "invalid-option", resolved.problem);
          return;
        }
        if (resolved.dir === undefined) {
          // Grammar-legal but unenumerated: a question recorded evidence
          // cannot answer — Pact's gate answers unknown participants with a
          // refusal, not a pass (status's `unknown-service` precedent).
          const near = nearestIds(resolved.id, await enumeratedServiceIds(docsDir, fleet));
          fail(
            json,
            "unknown-service",
            `No service '${resolved.id}' under ${docsDir}/services/ — nothing is recorded for a service nobody adopted, so the deploy question is unanswerable.` +
              (near.length > 0 ? ` Did you mean: ${near.join(", ")}?` : "") +
              ` Run \`loam adopt --service ${resolved.id}\` to write its baseline first.`,
          );
          return;
        }
        // `sources` only mean something from inside the service's own
        // repository — validate's repoOf rule. `config.root` rather than
        // process.cwd(): the config's own directory is the repo root, and a
        // run from src/deep/ must grade the same paths as one from the root.
        const bound: string | undefined = config.service;
        const report = await gateReport({
          docsDir,
          service: resolved.id,
          repoDir: bound === resolved.id ? (config.root ?? process.cwd()) : undefined,
          fleet,
        });
        const verdict = gateVerdict(report.checks);
        const summary = gateSummary(report.checks);
        if (json) {
          emitJson({
            command: "gate",
            docsDir,
            service: report.service,
            verdict,
            strict: opts.strict === true,
            landscape: report.landscape,
            partners: report.partners,
            features: report.features,
            checks: report.checks.map((c) => ({
              check: c.check,
              findings: c.findings.map((finding) => findingJson(finding)),
            })),
            summary,
          });
        } else {
          printGate(report, verdict, summary);
        }
        // --strict moves only the exit code, never the verdict or the payload
        // — validate's exact stance, documented on its own strict block: two
        // pipelines reading one repo may grade the same report differently
        // and both are telling the truth.
        if (verdict === "fail" || (opts.strict === true && summary.warnings > 0)) {
          process.exitCode = 1;
        }
      } catch (err) {
        // The docs repo went away between the gate above and the reads.
        if (err instanceof DocsRepoUnavailableError) {
          reportDocsRepoError(json, err);
          return;
        }
        // An IO failure the per-subject containment could not localise — it
        // happened in an enumeration, so no partial report exists to give.
        // The recognizer throws anything carrying no errno untouched.
        reportRepositoryUnavailable(
          json,
          err,
          `the deploy question for '${service}' is unanswerable`,
          docsDir,
        );
      }
    });
}
