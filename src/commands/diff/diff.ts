/**
 * `loam diff --base <ref>` — the review lens over a docs-repo branch: what
 * changed in fleet-meaningful terms since a base git ref of the DOCS repo,
 * with the current consumers of every removal named. Read-only by
 * construction: the base state comes out of git's object store
 * (`core/diff/base-git.ts`), the current state off the working tree, and
 * nothing is written anywhere.
 *
 * Exit semantics: 0 when the diff was computed and nothing is breaking AND
 * every artifact on both sides could be read; 1 for a refusal, for any
 * error-severity finding (a removal the fleet still consumes — which is what
 * makes this a free gate on a docs-repo PR), and for a diff with suspended
 * axes — "nobody could look" must not exit as "nothing changed"
 * (`loam context` set that precedent for silent holes).
 */
import type { Command } from "commander";
import { loadConfig } from "../../core/envelope/config.js";
import { emitJson, fail, reportNoConfig } from "../../core/envelope/json.js";
import { findingJson } from "../../core/vocabulary/report.js";
import { docsRepoReady, reportDocsRepoError, reportRepositoryUnavailable } from "../policy/gate.js";
import { DocsRepoUnavailableError } from "../../core/repo/state.js";
import { FleetContext } from "../../core/fleet-context.js";
import { resolveBase } from "../../core/diff/base-git.js";
import { readBaseFleet } from "../../core/diff/base-state.js";
import { readCurrentFleet } from "../../core/diff/current-state.js";
import { victimIndex } from "../../core/diff/victims.js";
import { computeDiff, type FleetDiff } from "../../core/diff/semantic.js";
import { printDiff } from "./print.js";

interface DiffOptions {
  base: string;
  json?: boolean;
}

export function registerDiff(program: Command): void {
  program
    .command("diff")
    .description("Semantic diff of the living docs against a base git ref of the docs repo — fleet-meaningful changes, with the joined victims of every removal named")
    .requiredOption("--base <ref>", "base git ref of the docs repo (e.g. main, origin/main, a commit sha)")
    .option("--json", "emit the machine contract instead of the human view")
    .action(async (opts: DiffOptions) => {
      const json = opts.json === true;
      const loaded = await loadConfig();
      if (loaded.kind !== "loaded") {
        reportNoConfig(json, loaded);
        return;
      }
      const { docsDir } = loaded.config;
      // "services" on purpose: both sides of the diff are enumerations of the
      // fleet, and a docsDir with no services/ has no fleet to diff.
      if (!docsRepoReady(json, docsDir, "services")) return;

      const base = await resolveBase(docsDir, opts.base);
      // Unlike provenance's "git will not say", diff REFUSES when git cannot
      // answer: without the base there is no honest diff, and a silently
      // empty base would report the whole fleet as added.
      if (base.kind === "no-git") {
        fail(
          json,
          "repository-unavailable",
          `The docs repo at ${docsDir} is not somewhere git can answer from (${base.detail}) — ` +
            `loam diff reads the base state with read-only git questions (rev-parse/ls-tree/show), so it needs the docs repo ` +
            `to be a git checkout with the base ref present. Clone the docs repo with its history, then re-run.`,
        );
        return;
      }
      if (base.kind === "no-ref") {
        fail(
          json,
          "unknown-target",
          `--base ${opts.base} does not resolve to a commit in the docs repo at ${docsDir}` +
            `${base.detail === "" ? "" : ` (${base.detail})`}. ` +
            `Pass a ref that exists there — main, origin/main, a tag or a commit sha — fetching first if it lives on the remote.`,
        );
        return;
      }

      const context = new FleetContext();
      let diff: FleetDiff;
      try {
        const baseFleet = await readBaseFleet({ docsDir, commit: base.commit, prefix: base.prefix });
        if (baseFleet.kind === "failed") {
          fail(
            json,
            "repository-unavailable",
            `git could not list services/ at ${opts.base} in the docs repo at ${docsDir} (${baseFleet.detail}) — ` +
              `without the base tree there is no honest diff. Re-run once git can answer.`,
          );
          return;
        }
        const current = await readCurrentFleet(docsDir, context);
        const victims = victimIndex({ docsDir, context, current: current.services, ambiguous: current.ambiguous });
        diff = await computeDiff({ base: baseFleet.fleet, current, victims });
      } catch (err) {
        if (err instanceof DocsRepoUnavailableError) {
          reportDocsRepoError(json, err);
          return;
        }
        reportRepositoryUnavailable(json, err, "the fleet could not be diffed", docsDir);
        return;
      }

      // Error findings gate (the validate convention); suspended axes gate too,
      // because an exit 0 over a diff nobody could fully read would be the
      // "green over zero services" failure one step later.
      if (diff.breaking || diff.summary.unreadable > 0) process.exitCode = 1;
      if (json) {
        emitJson({
          command: "diff",
          docsDir,
          base: { ref: opts.base, commit: base.commit },
          services: diff.services.map((s) => ({
            id: s.id,
            change: s.change,
            findings: s.findings.map(findingJson),
            unreadable: s.unreadable,
            ...(s.ambiguous === undefined ? {} : { ambiguous: s.ambiguous }),
          })),
          breaking: diff.breaking,
          summary: diff.summary,
        });
        return;
      }
      printDiff(diff, { ref: opts.base, commit: base.commit });
    });
}
