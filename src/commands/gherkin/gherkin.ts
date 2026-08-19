/**
 * `loam gherkin` — the third writer in the CLI (after archive and vouch), and
 * the only one that writes into the SERVICE repo, never the docs repo: the
 * docs state what must be true, the tests live with the code that makes it so.
 *
 * Two scopes, one emitter. `loam gherkin <FEAT>` emits the feature's ADDED and
 * MODIFIED requirements for this service — both spec axes — as the acceptance
 * skeleton to implement against, each file tagged with the feature id.
 * `loam gherkin --service <id>` (no feature) emits the full living suite from
 * spec.md + arch.spec.md: the regression skeleton a legacy service gets at
 * adoption. Either way the output is `<gherkinDir>/loam/` inside this repo,
 * a directory loam owns outright: the scope's files are rewritten, the scope's
 * orphans are deleted (and reported), and nothing outside `loam/` is touched —
 * except that a living run neither deletes NOR overwrites a file tagged with a
 * feature still in flight: it answers to that feature's delta until it
 * archives, and is reported as kept. A FEATURE run cannot keep — the file it
 * wants holds one feature's delta — so when the file it would write belongs to
 * a different feature still in flight, the whole run refuses (`gherkin-conflict`)
 * and names the owner rather than reverting it.
 *
 * It refuses to run anywhere but the service's own repo — vouch's discipline,
 * for vouch's reason: the output lands in the repo loam is standing in, and
 * from anywhere else that repo is somebody else's.
 */
import type { Command } from "commander";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { relative } from "node:path";
import { loadConfig } from "../../core/envelope/config.js";
import { decodeDocument, NotUtf8DocumentError } from "../../core/kernel/document-bytes.js";
import {
  emitJson,
  emitJsonError,
  fail,
  NO_SERVICE_MESSAGE,
  reportNoConfig,
} from "../../core/envelope/json.js";
import { featureSpecPaths, SPEC_AXES, type SpecAxis } from "../../core/repo/paths.js";
import { locateServicePaths } from "../../core/repo/service-target.js";
import { listFeatures, missingFeatureMessage, resolveFeature } from "../../core/repo/repo.js";
import { parseRequirements } from "../../core/document/parse.js";
import { type Requirement } from "../../core/document/spec.js";
import { axisLabel, planEmission } from "../../core/gherkin/emit.js";
import { gherkinRoot } from "../../core/gherkin/stamp.js";
import { LOAM_VERSION } from "../../core/envelope/version.js";
import { UnsafePathError } from "../../core/kernel/path-safety.js";
import { commitEmission, recoverEmissionRoot } from "./commit.js";
import { reconcile, type Scope } from "./reconcile.js";
import { render } from "./render.js";
import { sayRecovered } from "../policy/format.js";

interface GherkinOptions {
  service?: string;
  dryRun?: boolean;
  json?: boolean;
}

export function registerGherkin(program: Command): void {
  program
    .command("gherkin")
    .argument("[featureId]", "feature id — emit its ADDED/MODIFIED requirements; omit for the full living suite")
    .description(
      "Emit Gherkin .feature files from spec scenarios into this service repo's <gherkinDir>/loam/",
    )
    .option("--service <id>", "service to emit for (defaults to the configured service)")
    .option(
      "--dry-run",
      "print the plan (writes, replacements, deletions) and write nothing — beyond first finishing a predecessor's interrupted commit, exactly as a real run would",
    )
    .option("--json", "emit the machine contract instead of the human view")
    .action(async (featureArg: string | undefined, opts: GherkinOptions) => {
      const json = opts.json === true;
      const dryRun = opts.dryRun === true;

      const loaded = await loadConfig();
      if (loaded.kind !== "loaded") {
        reportNoConfig(json, loaded);
        return;
      }
      const config = loaded.config;
      const service = opts.service ?? config.service;
      if (service === undefined) {
        return fail(json, "invalid-option", NO_SERVICE_MESSAGE);
      }
      // The emission writes into the repo loam is standing in, so it can only
      // run where that repo is this service's — vouch's refusal, verbatim logic.
      if (config.service !== service) {
        const here =
          config.service === undefined ? "this is not a service repo" : `this repo is '${config.service}'`;
        return fail(
          json,
          "invalid-option",
          `Cannot emit gherkin for '${service}' from here: ${here}. Generated .feature files land in the service's own repo — run it there.`,
        );
      }

      // The repo root, not the cwd: `config.root` is the directory loam.json
      // was actually found in, and config discovery walks upward. Taken from
      // `process.cwd()` this emitted the whole suite into whatever directory
      // the caller happened to stand in — `src/api/features/loam/…` inside the
      // source tree, which the next run from the root neither finds, replaces
      // nor deletes, and which `loam validate` grades as a suite that was never
      // generated.
      const repoDir = config.root ?? process.cwd();
      let root: string;
      try {
        root = gherkinRoot(repoDir, config.gherkinDir);
      } catch (err) {
        if (!(err instanceof UnsafePathError)) throw err;
        return fail(
          json,
          "invalid-option",
          `Cannot emit Gherkin: ${err.message}. The output directory must stay inside the service repo.`,
        );
      }
      const rel = (abs: string): string => relative(repoDir, abs).split(/[\\/]/).join("/");

      // A predecessor's interrupted emission is rolled forward before ANY
      // read — and before the feature argument resolves: reconcile grades the
      // very bytes a half-commit corrupts, and the journal's stored rerun may
      // name a feature that has since ARCHIVED, whose recovery must still
      // work. `new` fixed the same ordering and documented it; refusing
      // unknown-target over a wedged root left doctor printing a repair that
      // could never run.
      const early = await recoverEmissionRoot(root);
      if (!early.ok) return fail(json, early.code, early.message);
      let recovered = early.recovered;

      const feature =
        featureArg === undefined ? null : await resolveFeature(config.docsDir, featureArg, "exclude");
      if (featureArg !== undefined && feature === null) {
        return fail(json, "unknown-target", await missingFeatureMessage(config.docsDir, featureArg));
      }
      const scope: Scope =
        feature === null ? { mode: "living" } : { mode: "feature", featureId: feature.id };

      // The requirement set, by scope. Feature mode takes ADDED and MODIFIED —
      // a BASE requirement is the living state quoted, a REMOVED one is being
      // retired, and neither is behaviour anybody is about to test. Living mode
      // takes everything the living files hold.
      //
      // Read through `decodeDocument`, not `readFile(…, "utf8")`, and refused
      // rather than degraded: a spec.md saved as UTF-16 decodes to a document
      // with no requirements in it, which here is not merely a wrong answer but
      // a destructive one — an empty plan makes every existing .feature under
      // loam/ an orphan, and a living run DELETES its orphans. The whole
      // generated suite would go because a docs file was written by PowerShell.
      const byAxis: Array<{ axis: SpecAxis; reqs: Requirement[] }> = [];
      const readSpec = async (path: string): Promise<Requirement[]> =>
        parseRequirements(decodeDocument(await readFile(path), path));
      try {
        if (feature !== null) {
          // `config.service`, not `service`: the guard above proved they are
          // the same id, and only the config's copy carries the load-time
          // parse, so it is the pathable spelling — same as the else arm.
          const paths = featureSpecPaths(feature.dir, config.service);
          for (const axis of SPEC_AXES) {
            const path = paths[axis.key];
            const reqs = existsSync(path)
              ? (await readSpec(path)).filter((r) => r.kind === "ADDED" || r.kind === "MODIFIED")
              : [];
            byAxis.push({ axis, reqs });
          }
        } else {
          // The guard above proved `service` IS `config.service`; only the
          // latter carries the load-time parse, so it is the pathable spelling.
          const paths = await locateServicePaths(config.docsDir, config.service);
          if (!existsSync(paths.spec)) {
            return fail(
              json,
              "unknown-target",
              `No living spec at ${paths.spec}. Run \`loam adopt\` for '${service}' first.`,
            );
          }
          for (const axis of SPEC_AXES) {
            const path = paths[axis.key];
            const reqs = existsSync(path) ? (await readSpec(path)).filter((r) => r.kind !== "REMOVED") : [];
            byAxis.push({ axis, reqs });
          }
        }
      } catch (err) {
        if (!(err instanceof NotUtf8DocumentError)) throw err;
        return fail(json, "repository-unavailable", `Cannot emit gherkin: ${err.message}`);
      }

      // `service` is not decoration: it salts every `@loam-digest-…` stamp, and
      // it is the same string `loam verify` files the matching claims under.
      const plan = planEmission(byAxis, {
        service,
        featureTag: scope.mode === "feature" ? scope.featureId : undefined,
        version: LOAM_VERSION,
      });

      // Orphans of THIS scope, inside loam/ and nowhere else. Feature mode owns
      // only its own emissions: stamped files carrying this feature's tag whose
      // file is no longer in the plan (a requirement renamed or dropped).

      // `Set<string>`, not the ids' own brand: this set answers membership
      // questions for tags read out of .feature files — document text.
      const activeIds = new Set<string>((await listFeatures(config.docsDir)).map((f) => f.id));
      let reconciled;
      try {
        reconciled = await reconcile(plan, { root, repoDir }, scope, activeIds);
      } catch (err) {
        if (!(err instanceof UnsafePathError)) throw err;
        return fail(json, "invalid-option", `Cannot emit Gherkin: ${err.message}.`);
      }
      const { actions, orphans, conflicts } = reconciled;

      // All or nothing: one conflicting file refuses the whole emission, so a
      // half-written suite can never be the state an agent has to reason about.
      // Only a feature run can conflict — living mode keeps the in-flight file
      // rather than refusing — and standing inside that scope is also how the
      // message names the feature without asserting there is one.
      if (scope.mode === "feature" && conflicts.length > 0) {
        const detail = conflicts
          .map((c) => `${rel(c.path)} is @${c.owners.join(" @")} (requirement '${c.requirement.name}')`)
          .join("; ");
        const message =
          `Cannot emit gherkin for ${scope.featureId}: ${conflicts.length} file(s) belong to another feature still in flight — ${detail}. ` +
          `A .feature file carries one feature's delta; overwriting would revert that feature's wording and destroy the digest stamps \`loam verify --results\` matches on. ` +
          `Archive (or abandon) the owning feature first, or rename the requirement in ${scope.featureId}'s delta so the two stop sharing a file name.`;
        if (json) {
          emitJsonError("gherkin-conflict", message, {
            conflicts: conflicts.map((c) => ({
              path: rel(c.path),
              action: "conflict",
              requirement: c.requirement.name,
              inFlight: c.owners,
            })),
          });
          return;
        }
        return fail(json, "gherkin-conflict", message);
      }

      const writes = actions.filter((a) => a.action !== "kept");

      if (!dryRun && (writes.length > 0 || orphans.length > 0)) {
        // The commit window: locked, journaled, compared against the bytes
        // reconcile graded. A zero-op run takes no lock and creates no root —
        // an emission with nothing to emit must not flip the repo into
        // "opted in", where an empty loam/ tells `loam validate` the whole
        // living suite is missing.
        const committed = await commitEmission({ root, service, scope }, { writes, orphans });
        if (!committed.ok) return fail(json, committed.code, committed.message);
        recovered = committed.recovered ?? recovered;
      }

      if (json) {
        emitJson({
          mode: scope.mode,
          ...(scope.mode === "feature" ? { feature: scope.featureId } : {}),
          service,
          root: rel(root),
          written: !dryRun,
          files: actions.map((a) => ({
            path: rel(a.path),
            action: a.action,
            axis: axisLabel(a.axis),
            requirement: a.requirement.name,
            // A kept file's numbers describe what STAYS on disk (the in-flight
            // emission), not the emission that was withheld.
            scenarios: a.action === "kept" ? a.kept.scenarios.length : a.digests.length,
            digests: a.action === "kept" ? a.kept.scenarios.map((s) => s.digest) : a.digests,
            ...(a.action === "kept"
              ? { inFlight: a.kept.tags.filter((t) => activeIds.has(t)) }
              : { stepless: a.stepless, malformedExamples: a.malformedExamples }),
          })),
          deleted: orphans.map((o) => rel(o.path)),
          ...(recovered === null ? {} : { recovered }),
        });
        return;
      }

      if (recovered !== null) console.log(`${sayRecovered(recovered)}\n`);
      render(actions, {
        service,
        root: rel(root),
        absRoot: root,
        featureId: scope.mode === "feature" ? scope.featureId : null,
        dryRun,
        activeIds,
        writes: writes.length,
        orphans: orphans.map((o) => o.path),
      });
    });
}
