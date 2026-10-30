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
 * Without `--since` the verification check reads IN-FLIGHT features only: a
 * feature leaves it the moment it is archived, so a deploy that ships slices
 * after their feature archived would be gated without it. `--since <ref>` —
 * a docs-repo git ref, the commit the pipeline last deployed from — adds every
 * feature archived after it, read out of git exactly as `loam diff --base`
 * reads its base (`core/diff/base-git.ts`), with the same two refusals when
 * git cannot answer (`baseOrRefuse`). Nothing is stored: the pipeline already
 * knows its last-deployed ref, and loam keeps no deployment state.
 *
 * Not to be confused with `commands/policy/gate.ts`, which is the docs-repo
 * READINESS doctrine (docsRepoReady and friends, and `baseOrRefuse` for a git
 * ref) every reading command shares — including this one, one import below.
 */
import type { Command } from "commander";
import { configOrRefuse, emitJson, fail, NO_SERVICE_MESSAGE } from "../../core/envelope/json.js";
import { FleetContext } from "../../core/fleet-context.js";
import { listBaseSubdirs, subdirsChangedSince } from "../../core/diff/base-git.js";
import { gateReport } from "../../core/gate/checks.js";
import { gateSummary, gateVerdict, type GateSince } from "../../core/gate/report.js";
import type { DocsDir } from "../../core/kernel/ids/dirs.js";
import { nearestIds } from "../../core/repo/entries.js";
import { archiveDir } from "../../core/repo/paths.js";
import { enumeratedServiceIds, resolveServiceTarget } from "../../core/repo/service-target.js";
import { DocsRepoUnavailableError } from "../../core/repo/state.js";
import { findingJson } from "../../core/vocabulary/report.js";
import {
  baseOrRefuse,
  docsRepoReady,
  reportDocsRepoError,
  reportRepositoryUnavailable,
} from "../policy/gate.js";
import { printGate } from "./print.js";

interface GateOptions {
  service?: string;
  since?: string;
  strict?: boolean;
  json?: boolean;
}

/**
 * `--since <ref>` resolved against the docs repo's history, or null after
 * refusing. A listing git declines is a refusal too, never an empty one: "no
 * archive at the ref" grades every archived feature in the repo as shipped
 * since, and reading "could not list" as that would be a guess. The second
 * question — which of those directories changed since — has a safe answer to
 * fall to, and falls to it (see below).
 */
async function readSince(json: boolean, docsDir: DocsDir, ref: string): Promise<GateSince | null> {
  const base = await baseOrRefuse(json, docsDir, {
    flag: "--since",
    ref,
    reads: "loam gate --since reads which features were already archived at that ref",
  });
  if (base === null) return null;
  const listing = await listBaseSubdirs(base, archiveDir(docsDir));
  if (listing.kind === "failed") {
    fail(
      json,
      "repository-unavailable",
      `git could not list features/archive/ at ${ref} in the docs repo at ${docsDir} (${listing.detail}) — ` +
        `without it there is no telling which features shipped since, and the gate will not guess. Re-run once git can answer.`,
    );
    return null;
  }
  // Present at the ref is not enough to have shipped by then: a feature
  // unarchived, edited and archived again sits at the same path with
  // different contents, and it is this deploy's to answer for. Only a
  // directory whose contents are what they were at the ref stays out. When
  // git will not say what changed, every one of them is graded — the
  // direction this gate fails in is "looked at too much", never "skipped a
  // ship" — unlike the listing above, which has no safe default to fall to.
  const changed = await subdirsChangedSince(base, archiveDir(docsDir));
  const moved = changed.kind === "ok" ? changed.names : new Set(listing.names);
  return { ref, commit: base.commit, shippedAtRef: new Set(listing.names.filter((name) => !moved.has(name))) };
}

export function registerGate(program: Command): void {
  program
    .command("gate")
    .description("Can this service deploy? A read-only query over recorded evidence — advisory by default")
    .option("--service <id>", "the service being deployed (defaults to the configured service)")
    .option(
      "--since <ref>",
      "also grade the features archived after this docs-repo git ref (e.g. the docs commit your last deploy recorded) — without it only in-flight features are read",
    )
    .option("--strict", "exit 1 on any warning too — a per-invocation CI lever; the report and --json payload do not change")
    .option("--json", "emit the machine contract instead of the human view")
    .action(async (opts: GateOptions) => {
      const json = opts.json === true;
      const config = await configOrRefuse(json);
      if (config === null) return;
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
      const since = opts.since === undefined ? undefined : await readSince(json, docsDir, opts.since);
      if (since === null) return;
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
          since,
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
            since: report.since,
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
          printGate(report, verdict, summary, opts.strict === true);
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
