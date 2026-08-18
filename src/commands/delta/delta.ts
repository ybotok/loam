import type { Command } from "commander";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { loadConfig } from "../../core/envelope/config.js";
import { InvalidIdError, assertServiceId } from "../../core/kernel/ids.js";
import { emitJson, emitJsonError, fail, repoPath, reportNoConfig } from "../../core/envelope/json.js";
import { loadFile } from "../../core/c4/likec4.js";
import { compareIds, nearestIds } from "../../core/repo/entries.js";
import { featurePaths, featureSpecPaths } from "../../core/repo/paths.js";
import { missingFeatureMessage, resolveFeature } from "../../core/repo/repo.js";
import { parseRequirements } from "../../core/document/parse.js";
import { type Requirement } from "../../core/document/spec.js";
import { apiChanges, archSlice, introducedServices, livingServices, stripFrontmatter } from "./slices.js";
import { printApi, printArchSlice, printRequirements } from "./print.js";
import { indent } from "./print.js";

// The summary walk below descends four levels into a document nobody has
// validated, and `isRecord` is what it asks at each step: a cast there would
// assert a shape the parser never promised, and a sequence or a scalar in any of
// those slots would be indexed as a mapping.

interface DeltaOptions {
  service?: string;
  json?: boolean;
}





export function registerDelta(program: Command): void {
  program
    .command("delta")
    .argument("<featureId>", "feature id, e.g. FEAT-101")
    .description("Project a feature onto a service: why + requirement delta + C4 changes")
    .option("--service <id>", "service to project onto (defaults to the configured service)")
    .option("--json", "emit the machine contract instead of the human view")
    .action(async (featureId: string, opts: DeltaOptions) => {
      const json = opts.json === true;
      const loaded = await loadConfig();
      if (loaded.kind !== "loaded") {
        reportNoConfig(json, loaded);
        return;
      }
      const config = loaded.config;

      // The id grammar first, and on the RAW argument: `--service ../../etc`
      // reaches `featureSpecPaths` and reads from outside the feature directory.
      // One grammar for the whole tool (core/kernel/ids.ts).
      if (opts.service !== undefined) {
        try {
          assertServiceId(opts.service, "--service");
        } catch (err) {
          if (!(err instanceof InvalidIdError)) throw err;
          fail(json, "invalid-option", err.message);
          return;
        }
      }

      // The feature is resolved BEFORE the service is chosen, because every
      // sentence about the service ("which ones does this feature touch?") is
      // only answerable once the feature is known.
      const feature = await resolveFeature(config.docsDir, featureId, "exclude");
      if (!feature) {
        fail(json, "unknown-target", await missingFeatureMessage(config.docsDir, featureId));
        return;
      }
      // Canonical id from here on — the delta's tags carry `#FEAT-5`, so a raw
      // `FEAT-5-slug` argument used to empty the architecture slice silently.
      const { id } = feature;
      const paths = featurePaths(feature.dir);

      const deltaDoc = existsSync(paths.delta) ? await loadFile(paths.delta) : null;
      // Services the feature speaks about at all: one with a requirement delta,
      // or one its C4 delta introduces. This is the list a refusal quotes.
      const featureServices = [
        ...new Set([...feature.services, ...introducedServices(deltaDoc, id)]),
      ].sort(compareIds);

      const service = opts.service ?? config.service;
      if (!service) {
        // The refusal NAMES the choices. "No service. Pass --service <id>" told
        // the reader the shape of the flag and nothing about the answer, so the
        // next step was always to go list the feature's specs/ by hand — and an
        // agent had no way to recover at all. The list rides the JSON envelope
        // for the same reason.
        const message =
          `No service to project ${id} onto. Pass --service <id> or set 'service' in loam.json.` +
          (featureServices.length === 0
            ? ` ${id} carries no per-service delta yet.`
            : ` ${id} touches: ${featureServices.join(", ")}.`);
        if (json) emitJsonError("invalid-option", message, { feature: id, services: featureServices });
        else {
          console.error(message);
          process.exitCode = 1;
        }
        return;
      }

      // A service nobody has heard of produces a perfectly plausible EMPTY
      // report — no requirements, no edges, "no architecture change" — which an
      // agent consuming this as a task brief reads as "nothing to do here".
      // A typo must never be indistinguishable from a finished service.
      const living = await livingServices(config.docsDir);
      if (!featureServices.includes(service) && !living.includes(service)) {
        const near = nearestIds(service, [...new Set([...featureServices, ...living])]);
        fail(
          json,
          "unknown-target",
          `No service '${service}': it is neither a services/${service}/ in the docs repo nor a service ${id} touches` +
            (featureServices.length === 0 ? "" : ` (${featureServices.join(", ")})`) +
            (near.length === 0 ? "." : ` — did you mean ${near.map((n) => `'${n}'`).join(" or ")}?`),
        );
        return;
      }

      // Why — business intent
      const intent = existsSync(paths.intent)
        ? stripFrontmatter(await readFile(paths.intent, "utf8")).trim()
        : null;

      // Requirement delta for this service (OpenSpec style), business and arch:
      // the same projection covers both axes, in the same shape, so the payload
      // stays one task — the arch requirements are the integration/ops half the
      // business ones never mention.
      const specPaths = featureSpecPaths(feature.dir, service);
      const reqs = existsSync(specPaths.spec)
        ? parseRequirements(await readFile(specPaths.spec, "utf8"))
        : [];
      const archReqs = existsSync(specPaths.archSpec)
        ? parseRequirements(await readFile(specPaths.archSpec, "utf8"))
        : [];

      // The contract axis. Until now no command surfaced it at all: the feature's
      // openapi.yaml was read by validate and by archive, and the one command
      // whose output IS the implementation task never mentioned it — so "add the
      // endpoint" was the half of the work the brief left out.
      const api = await apiChanges(specPaths.openapi);

      // C4 architecture slice. The fleet union mirrors coherence's: services/
      // plus the feature's own specs/ names, so the slice and the validator
      // resolve a container-targeted edge to the same owner.
      const arch = archSlice(deltaDoc, service, id, new Set([...living, ...featureServices]));

      // An unparseable delta.likec4 empties the C4 slice, and a consumer
      // reading this projection as a task brief — the JSON payload and the
      // printed view alike — would take that as "no architecture change": the
      // vacuously-green pattern. The output stays as informative as ever (and
      // `ok` stays true under --json: the command ran); the exit code is what
      // stops a pipeline from building on it, so it is set BEFORE the format
      // fork — the guard is about the delta, not about how it is rendered.
      //
      // The contract axis fails the same way and now earns the same guard: an
      // openapi.yaml that does not parse projected as an empty operation list,
      // and nothing upstream catches it either — `loam validate` grades
      // `openapi.invalid` on LIVING service contracts only, never on a
      // feature's delta.
      if (arch.errors.length > 0 || api.unreadable) process.exitCode = 1;

      if (json) {
        const reqJson = (r: Requirement): Record<string, unknown> => ({
          kind: r.kind,
          id: r.id,
          name: r.name,
          text: r.text.join("\n").trim(),
          operations: r.operations,
          covers: r.covers,
          // Scenarios go out verbatim: they are the acceptance criteria and the
          // source for the tests whoever picks this up is expected to write.
          scenarios: r.scenarios.map((s) => ({ name: s.name, lines: s.lines })),
        });
        emitJson({
          feature: id,
          service,
          services: featureServices,
          path: repoPath(config.docsDir, feature.dir),
          intent,
          requirements: reqs.map(reqJson),
          // Same shape, separate section: an arch requirement's scenarios are
          // integration/ops tests, and a consumer must not have to parse prose
          // to tell the two apart.
          archRequirements: archReqs.map(reqJson),
          api: api.changes,
          // `api` stays exactly the operations array it has always been — a
          // consumer indexing it must not have to learn a new shape — so the
          // readability of the document rides alongside as its own key,
          // spelled the way `loam show` already spells it for a living
          // contract. Additive, which the envelope permits (core/envelope/json.ts).
          openapi: {
            unreadable: api.unreadable,
            ...(api.error === undefined ? {} : { error: api.error }),
          },
          architecture: arch,
        });
        return;
      }

      console.log(`${id} · ${service}\n`);
      if (intent) {
        console.log(indent(intent, "  "));
        console.log();
      }
      if (existsSync(specPaths.spec)) printRequirements(reqs, "Requirements");
      else console.log("Requirements: (none for this service)\n");
      if (existsSync(specPaths.archSpec)) printRequirements(archReqs, "Arch requirements");
      if (existsSync(specPaths.openapi)) printApi(api);
      if (existsSync(paths.delta)) printArchSlice(arch, service);
    });
}

/** Every service in the docs repo, or none when there is no docs repo to ask. */
