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
 * orphans are deleted (and reported), and nothing outside `loam/` is touched.
 *
 * It refuses to run anywhere but the service's own repo — vouch's discipline,
 * for vouch's reason: the output lands in the repo loam is standing in, and
 * from anywhere else that repo is somebody else's.
 */
import type { Command } from "commander";
import { existsSync } from "node:fs";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { loadConfig } from "../core/config.js";
import { emitJson, fail, reportNoConfig } from "../core/json.js";
import {
  featureSpecPaths,
  listFeatures,
  missingFeatureMessage,
  resolveFeature,
  servicePaths,
  SPEC_AXES,
  type SpecAxis,
} from "../core/repo.js";
import { parseRequirements, type Requirement } from "../core/spec.js";
import {
  axisLabel,
  featureFilesUnder,
  gherkinRoot,
  parseStampedFeature,
  planEmission,
} from "../core/gherkin.js";
import { LOAM_VERSION } from "../core/version.js";

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
    .option("--dry-run", "print the plan (writes, replacements, deletions) and write nothing")
    .option("--json", "emit the machine contract instead of the human view")
    .action(async (featureArg: string | undefined, opts: GherkinOptions) => {
      const json = opts.json === true;
      const dryRun = opts.dryRun === true;

      const config = await loadConfig();
      if (!config) {
        reportNoConfig(json);
        return;
      }
      const service = opts.service ?? config.service;
      if (service === undefined) {
        return fail(json, "invalid-option", "No service. Pass --service <id> or set it in loam.json.");
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

      const repoDir = process.cwd();
      const root = gherkinRoot(repoDir, config.gherkinDir);
      const rel = (abs: string): string => relative(repoDir, abs).split(/[\\/]/).join("/");

      // The requirement set, by scope. Feature mode takes ADDED and MODIFIED —
      // a BASE requirement is the living state quoted, a REMOVED one is being
      // retired, and neither is behaviour anybody is about to test. Living mode
      // takes everything the living files hold.
      let mode: "feature" | "living" = "living";
      let featureId: string | undefined;
      const byAxis: Array<{ axis: SpecAxis; reqs: Requirement[] }> = [];
      if (featureArg !== undefined) {
        const feature = await resolveFeature(config.docsDir, featureArg, "exclude");
        if (!feature) {
          return fail(json, "unknown-target", await missingFeatureMessage(config.docsDir, featureArg));
        }
        mode = "feature";
        featureId = feature.id;
        const paths = featureSpecPaths(feature.dir, service);
        for (const axis of SPEC_AXES) {
          const path = paths[axis.key];
          const reqs = existsSync(path)
            ? parseRequirements(await readFile(path, "utf8")).filter(
                (r) => r.kind === "ADDED" || r.kind === "MODIFIED",
              )
            : [];
          byAxis.push({ axis, reqs });
        }
      } else {
        const paths = servicePaths(config.docsDir, service);
        if (!existsSync(paths.spec)) {
          return fail(
            json,
            "unknown-target",
            `No living spec at ${paths.spec}. Run \`loam adopt\` for '${service}' first.`,
          );
        }
        for (const axis of SPEC_AXES) {
          const path = paths[axis.key];
          const reqs = existsSync(path)
            ? parseRequirements(await readFile(path, "utf8")).filter((r) => r.kind !== "REMOVED")
            : [];
          byAxis.push({ axis, reqs });
        }
      }

      const plan = planEmission(byAxis, { featureTag: featureId, version: LOAM_VERSION });

      // Orphans of THIS scope, inside loam/ and nowhere else. Feature mode owns
      // only its own emissions: stamped files carrying this feature's tag whose
      // file is no longer in the plan (a requirement renamed or dropped).
      // Living mode owns the whole suite — any .feature not in the plan goes —
      // EXCEPT files tagged with a feature still in flight: those answer to
      // their feature's delta until it archives, and `loam gherkin <FEAT>` is
      // their regeneration.
      const planned = new Set(plan.map((f) => f.fileName));
      const orphans: string[] = [];
      if (existsSync(root)) {
        const activeIds =
          mode === "living" ? new Set((await listFeatures(config.docsDir)).map((f) => f.id)) : null;
        for (const abs of await featureFilesUnder(root)) {
          if (planned.has(relative(root, abs).split(/[\\/]/).join("/"))) continue;
          const stamped = parseStampedFeature(await readFile(abs, "utf8"));
          if (mode === "feature") {
            if (stamped !== null && stamped.tags.includes(featureId!)) orphans.push(abs);
          } else {
            if (stamped !== null && stamped.tags.some((t) => activeIds!.has(t))) continue;
            orphans.push(abs);
          }
        }
      }

      const actions = plan.map((f) => {
        const path = join(root, f.fileName);
        return { ...f, path, action: existsSync(path) ? ("replaced" as const) : ("written" as const) };
      });

      if (!dryRun) {
        // The root is created only when something lands in it: an emission with
        // nothing to emit must not flip the repo into "opted in" — an empty
        // loam/ tells `loam validate` the whole living suite is missing.
        if (actions.length > 0) await mkdir(root, { recursive: true });
        for (const a of actions) await writeFile(a.path, a.content, "utf8");
        for (const o of orphans) await unlink(o);
      }

      if (json) {
        emitJson({
          mode,
          ...(featureId === undefined ? {} : { feature: featureId }),
          service,
          root: rel(root),
          written: !dryRun,
          files: actions.map((a) => ({
            path: rel(a.path),
            action: a.action,
            axis: axisLabel(a.axis),
            requirement: a.requirement.name,
            scenarios: a.digests.length,
            digests: a.digests,
          })),
          deleted: orphans.map(rel),
        });
        return;
      }

      const head = mode === "feature" ? `${featureId} · ${service}` : `${service} (living suite)`;
      console.log(`gherkin ${head} → ${rel(root)}/${dryRun ? "  (dry run)" : ""}\n`);
      if (actions.length === 0) {
        console.log(
          mode === "feature"
            ? `  ${featureId} has no ADDED or MODIFIED requirements for ${service} — nothing to emit.`
            : `  the living specs hold no requirements for ${service} — nothing to emit.`,
        );
      }
      for (const a of actions) {
        const n = a.digests.length;
        const arch = a.axis.key === "archSpec" ? ", arch" : "";
        console.log(
          `  ${a.action === "written" ? "write  " : "replace"}  ${a.fileName}  —  ${a.requirement.name}  (${n} scenario${n === 1 ? "" : "s"}${arch})`,
        );
      }
      for (const o of orphans) console.log(`  delete   ${relative(root, o).split(/[\\/]/).join("/")}  —  no longer in this scope`);
      const wrote = `${actions.length} file(s)`;
      const dropped = orphans.length > 0 ? `, ${orphans.length} deletion(s)` : "";
      console.log(
        dryRun
          ? `\n  ${wrote}${dropped} — dry run, nothing was written.`
          : `\n  ${wrote} written${dropped}. Write step definitions OUTSIDE ${rel(root)}/ — regeneration rewrites it.`,
      );
    });
}
