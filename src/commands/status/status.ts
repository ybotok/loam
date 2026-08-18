import type { Command } from "commander";
import { loadConfig } from "../../core/envelope/config.js";
import { FleetContext } from "../../core/fleet-context.js";
import { emitJson, fail, reportNoConfig } from "../../core/envelope/json.js";
import { DocsRepoUnavailableError } from "../../core/repo/state.js";
import { featureCandidates, missingFeatureMessage, resolveFeature } from "../../core/repo/repo.js";
import { featureStatus } from "../../core/status/feature/feature.js";
import { fleetStatus } from "../../core/status/fleet/fleet.js";
import { docsRepoReady, reportDocsRepoError, reportRepositoryUnavailable } from "../policy/gate.js";
import { featureJson, fleetJson } from "./json.js";
import { printFeature, printFleet } from "./print.js";

/**
 * `loam status` — the read-only projection. Nothing here computes anything: the
 * derivation lives in core/status/ (and, underneath it, in the same coherence
 * and verification calls `validate`, `verify` and `archive` make). This file
 * resolves the target, refuses the arguments it cannot honour, and renders.
 *
 * It reports and does not gate, which is why it never sets a non-zero exit code
 * on a successful run — see `registerStatus`.
 */

interface StatusOptions {
  json?: boolean;
  service?: string;
}

export function registerStatus(program: Command): void {
  program
    .command("status")
    .argument("[feature]", "feature id or directory name; omit for the whole repository")
    .description("Report where the work stands and what to do next, derived from the files")
    .option("--json", "emit the machine contract instead of the human view")
    .option("--service <id>", "narrow the per-service view to one service")
    .action(async (featureArg: string | undefined, opts: StatusOptions) => {
      const json = opts.json === true;
      const loaded = await loadConfig();
      if (loaded.kind !== "loaded") {
        reportNoConfig(json, loaded);
        return;
      }
      const config = loaded.config;
      const { docsDir } = config;
      // A docsDir that is not a docs repo is refused, never rendered as a repo
      // with nothing in it — the doctrine docs-repo-gate.ts's docsRepoReady exists
      // for. `status` counts services, so it needs services/ in both modes.
      if (!docsRepoReady(json, docsDir, "services")) return;
      const context = new FleetContext();
      // What the refusal below says it was answering when it gave up.
      let scope = "this repository";

      try {
        if (featureArg === undefined) {
          // `bound` is what THIS repo says it is, which is a different fact from
          // `--service` (which narrows the view). Passing it is what lets the
          // fleet form notice that the repository it is standing in has never
          // been adopted — the one thing a fleet count cannot see.
          const report = await fleetStatus(docsDir, {
            service: opts.service,
            bound: config.service,
            context,
          });
          // A `--service` that names nothing is refused rather than answered
          // with an empty fleet: "no services and no features" and "you
          // misspelled it" are opposite facts, and only one of them is worth
          // acting on.
          if (opts.service !== undefined && report.services.total === 0) {
            fail(json, "unknown-service", `No service '${opts.service}' under ${docsDir}/services/.`);
            return;
          }
          if (json) emitJson({ command: "status", docsDir, scope: "fleet", ...fleetJson(report) });
          else printFleet(report);
          return;
        }

        // Archived features are IN scope: an agent asking where FEAT-101 stands
        // after it shipped deserves "it shipped", not "no such feature" — the
        // same reading `show` takes. An argument naming two directories is
        // still answered (status writes nothing), with the tie broken the way
        // resolveFeature always breaks it.
        const feature = await resolveFeature(docsDir, featureArg, "include", context);
        if (!feature) {
          fail(json, "unknown-target", await missingFeatureMessage(docsDir, featureArg, context));
          return;
        }
        scope = feature.id;
        // `config.service` is not a lens like `--service`: it says which
        // repository this IS, and three of the steps (`loam gherkin`, `verify
        // --record --service`) refuse anywhere else. Without it status handed a
        // docs-repo reader commands only a service repo can run, and never told
        // a service repo that the work in front of it was its own.
        const report = await featureStatus(docsDir, feature, {
          service: opts.service,
          boundService: config.service,
          context,
        });
        if (opts.service !== undefined && !report.feature.services.includes(opts.service)) {
          fail(
            json,
            "unknown-service",
            `${feature.id} carries no delta for '${opts.service}'. It touches: ${
              report.feature.services.length > 0 ? report.feature.services.join(", ") : "(no services)"
            }.`,
          );
          return;
        }
        const ambiguous = await featureCandidates(docsDir, featureArg, "include", context);
        if (json) {
          emitJson({ command: "status", docsDir, scope: "feature", ...featureJson(report) });
        } else {
          printFeature(report, ambiguous.length > 1 ? ambiguous.map((c) => c.dirName) : []);
        }
      } catch (err) {
        if (err instanceof DocsRepoUnavailableError) {
          reportDocsRepoError(json, err);
          return;
        }
        // One unreadable artifact must not escape as a stack trace and an
        // `internal` envelope that names nothing: the projection is
        // all-or-nothing (a status missing one artifact reads as a feature that
        // does not owe it), so the honest answer is a refusal naming the path.
        // The errno-vs-path reading this branch depends on — the reason one
        // directory where a file belongs used to kill BOTH forms of status —
        // now lives once, with its reasoning, on the shared helper.
        reportRepositoryUnavailable(
          json,
          err,
          `the status of ${scope} would be missing an artifact`,
          docsDir,
        );
      }
      // No exit code is set on any path above that succeeded, deliberately.
      // `doctor` exits 1 because a broken installation makes every later
      // command lie, and `validate` exits 1 because it IS the fleet gate. This
      // command is a question, and its answer is equally true whether the
      // feature is finished or not — an agent runs it precisely BECAUSE work is
      // outstanding, and exiting 1 there would make every `set -e` script and
      // every CI step read "there is work to do" as a failure.
    });
}

/* ------------------------------------------------------------------ */
/* JSON                                                                */
/* ------------------------------------------------------------------ */
