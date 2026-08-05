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
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { loadConfig } from "../core/config.js";
import { decodeDocument, NotUtf8DocumentError } from "../core/fleet-context.js";
import { emitJson, emitJsonError, fail, reportNoConfig } from "../core/json.js";
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
  type PlannedFeature,
  type StampedFeature,
} from "../core/gherkin.js";
import { LOAM_VERSION } from "../core/version.js";
import { resolveInside, UnsafePathError } from "../core/path-safety.js";

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
      let mode: "feature" | "living" = "living";
      let featureId: string | undefined;
      const byAxis: Array<{ axis: SpecAxis; reqs: Requirement[] }> = [];
      const readSpec = async (path: string): Promise<Requirement[]> =>
        parseRequirements(decodeDocument(await readFile(path), path));
      try {
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
              ? (await readSpec(path)).filter((r) => r.kind === "ADDED" || r.kind === "MODIFIED")
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
      const plan = planEmission(byAxis, { service, featureTag: featureId, version: LOAM_VERSION });

      // Orphans of THIS scope, inside loam/ and nowhere else. Feature mode owns
      // only its own emissions: stamped files carrying this feature's tag whose
      // file is no longer in the plan (a requirement renamed or dropped).
      // Living mode owns the whole suite — any .feature not in the plan goes —
      // EXCEPT files tagged with a feature still in flight: those answer to
      // their feature's delta until it archives, and `loam gherkin <FEAT>` is
      // their regeneration.
      const planned = new Set(plan.map((f) => f.fileName));
      // Needed by BOTH modes now: living mode exempts in-flight files from
      // deletion and replacement, and feature mode has to recognise another
      // feature's in-flight file to refuse overwriting it.
      const activeIds = new Set((await listFeatures(config.docsDir)).map((f) => f.id));
      const orphans: string[] = [];
      if (existsSync(root)) {
        for (const abs of await featureFilesUnder(root)) {
          if (planned.has(relative(root, abs).split(/[\\/]/).join("/"))) continue;
          const stamped = parseStampedFeature(await readFile(abs, "utf8"));
          if (mode === "feature") {
            if (stamped !== null && stamped.tags.includes(featureId!)) orphans.push(abs);
          } else {
            if (stamped !== null && stamped.tags.some((t) => activeIds.has(t))) continue;
            orphans.push(abs);
          }
        }
      }

      // The in-flight exemption guards the OVERWRITE path too, not only the
      // orphan scan above: files are named by requirement slug in both modes,
      // so a MODIFIED requirement's living emission always collides with the
      // active feature's file — and replacing it reverted the delta's wording
      // mid-flight, feature tag and new digest stamps destroyed, invisibly
      // (the reverted file grades current against the living spec). A planned
      // path whose existing content is stamped and tagged with a feature still
      // in flight is KEPT and reported as such; it answers to its feature's
      // delta until the feature archives, and then living regeneration
      // replaces it normally.
      //
      // FEATURE mode has the same collision and cannot solve it by keeping:
      // two features in flight against one requirement slug want the same
      // file, and whichever runs second used to `replace` — silently reverting
      // the other feature's wording, feature tag and digest stamps, so its
      // `verify --results` could never confirm a scenario again. Nothing loam
      // can write is right here (the file holds ONE feature's delta), so the
      // run refuses and names the owner: the two features have to be sequenced,
      // or the requirement renamed.
      type Action = "written" | "replaced" | "kept" | "conflict";
      const actions: Array<
        PlannedFeature & { path: string; action: Action; kept?: StampedFeature; owners?: string[] }
      > = [];
      for (const f of plan) {
        let path: string;
        try {
          // Check the final file as well as the owned root: a pre-planted
          // `<slug>.feature` symlink must not turn writeFile into an overwrite
          // outside the repository.
          path = resolveInside(
            repoDir,
            relative(repoDir, join(root, f.fileName)),
            `gherkin file '${f.fileName}'`,
          );
        } catch (err) {
          if (!(err instanceof UnsafePathError)) throw err;
          return fail(json, "invalid-option", `Cannot emit Gherkin: ${err.message}.`);
        }
        if (!existsSync(path)) {
          actions.push({ ...f, path, action: "written" });
          continue;
        }
        const existing = parseStampedFeature(await readFile(path, "utf8"));
        if (mode === "living") {
          if (existing !== null && existing.tags.some((t) => activeIds.has(t))) {
            actions.push({ ...f, path, action: "kept", kept: existing });
            continue;
          }
        } else {
          const owners =
            existing === null
              ? []
              : existing.tags.filter((t) => t !== featureId && activeIds.has(t));
          if (owners.length > 0) {
            actions.push({ ...f, path, action: "conflict", kept: existing!, owners });
            continue;
          }
        }
        actions.push({ ...f, path, action: "replaced" });
      }

      // All or nothing: one conflicting file refuses the whole emission, so a
      // half-written suite can never be the state an agent has to reason about.
      const conflicts = actions.filter((a) => a.action === "conflict");
      if (conflicts.length > 0) {
        const detail = conflicts
          .map((c) => `${rel(c.path)} is @${c.owners!.join(" @")} (requirement '${c.requirement.name}')`)
          .join("; ");
        const message =
          `Cannot emit gherkin for ${featureId}: ${conflicts.length} file(s) belong to another feature still in flight — ${detail}. ` +
          `A .feature file carries one feature's delta; overwriting would revert that feature's wording and destroy the digest stamps \`loam verify --results\` matches on. ` +
          `Archive (or abandon) the owning feature first, or rename the requirement in ${featureId}'s delta so the two stop sharing a file name.`;
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

      if (!dryRun) {
        // The root is created only when something lands in it: an emission with
        // nothing to emit must not flip the repo into "opted in" — an empty
        // loam/ tells `loam validate` the whole living suite is missing.
        if (writes.length > 0) await mkdir(root, { recursive: true });
        for (const a of writes) await writeFile(a.path, a.content, "utf8");
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
            // A kept file's numbers describe what STAYS on disk (the in-flight
            // emission), not the emission that was withheld.
            scenarios: a.action === "kept" ? a.kept!.scenarios.length : a.digests.length,
            digests: a.action === "kept" ? a.kept!.scenarios.map((s) => s.digest) : a.digests,
            ...(a.action === "kept"
              ? { inFlight: a.kept!.tags.filter((t) => activeIds.has(t)) }
              : { stepless: a.stepless }),
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
      // `conflict` never reaches here — the run refused above — but the map is
      // total so a future action cannot silently print `undefined`.
      const VERB: Record<Action, string> = {
        written: "write  ",
        replaced: "replace",
        kept: "keep   ",
        conflict: "CONFLICT",
      };
      for (const a of actions) {
        if (a.action === "kept") {
          const owners = a.kept!.tags.filter((t) => activeIds.has(t));
          console.log(
            `  keep     ${a.fileName}  —  ${a.requirement.name}  (in flight: @${owners.join(" @")} — \`loam gherkin ${owners[0]}\` regenerates it)`,
          );
          continue;
        }
        const n = a.digests.length;
        const arch = a.axis.key === "archSpec" ? ", arch" : "";
        console.log(
          `  ${VERB[a.action]}  ${a.fileName}  —  ${a.requirement.name}  (${n} scenario${n === 1 ? "" : "s"}${arch})`,
        );
        for (const name of a.stepless) {
          console.log(
            `      ⚠ scenario '${name}' has NO recognizable steps — cucumber runs it vacuously green and \`verify --results\` can never confirm it; reword its body as \`- **Given/When/Then**\` bullets`,
          );
        }
      }
      for (const o of orphans) console.log(`  delete   ${relative(root, o).split(/[\\/]/).join("/")}  —  no longer in this scope`);
      const wrote = `${writes.length} file(s)`;
      const keptNote = actions.length > writes.length ? `, ${actions.length - writes.length} kept in flight` : "";
      const dropped = orphans.length > 0 ? `, ${orphans.length} deletion(s)` : "";
      console.log(
        dryRun
          ? `\n  ${wrote}${keptNote}${dropped} — dry run, nothing was written.`
          : `\n  ${wrote} written${keptNote}${dropped}. Write step definitions OUTSIDE ${rel(root)}/ — regeneration rewrites it.`,
      );
    });
}
