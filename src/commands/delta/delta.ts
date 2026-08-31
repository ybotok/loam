import type { Command } from "commander";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { loadConfig } from "../../core/envelope/config.js";
import { InvalidIdError, assertServiceId } from "../../core/kernel/ids/service.js";
import { emitJson, emitJsonError, fail, repoPath, reportNoConfig, sayExplain } from "../../core/envelope/json.js";
import { loadFile } from "../../core/c4/likec4.js";
import { compareIds, nearestIds } from "../../core/repo/entries.js";
import { featurePaths, featureSpecPaths } from "../../core/repo/paths.js";
import { missingFeatureMessage, resolveFeature } from "../../core/repo/repo.js";
import { parseRequirements } from "../../core/document/parse.js";
import { type Requirement } from "../../core/document/spec.js";
import { stripFrontmatter } from "../../core/document/frontmatter.js";
import { apiChanges } from "../../core/projection/api.js";
import { eventChanges } from "../../core/projection/events.js";
import { archSlice, introducedServices, livingServices } from "../../core/projection/arch-slice.js";
import { useCaseBlastRadius } from "../../core/usecases/touch.js";
import { featureCapabilityDeltas } from "../../core/capabilities/delta/tree.js";
import { capabilityDeltaSummaries } from "../../core/capabilities/delta/summary.js";
import { printApi, printArchSlice, printCapabilities, printEvents, printRequirements, printUseCases } from "./print.js";
import { indent } from "./print.js";

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
      // One grammar for the whole tool (core/kernel/ids/service.ts).
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
          // This arm refuses by hand because the envelope carries `services` as
          // data, which `fail()` has no room for — so the code and its lookup
          // are asked for explicitly, with the same code the branch above
          // emits. Without it this was one of the two refusals that most needed
          // `loam explain` and had no way to name it.
          sayExplain("invalid-option");
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

      // The event axis, same reasoning: a feature's asyncapi.yaml is merged by
      // archive and graded by validate, so the brief must name what it changes
      // — a message the implementer was never told to publish is the same
      // dropped work as an endpoint the brief left out.
      const events = await eventChanges(specPaths.asyncapi);

      // C4 architecture slice. The fleet union mirrors coherence's: services/
      // plus the feature's own specs/ names, so the slice and the validator
      // resolve a container-targeted edge to the same owner.
      const fleet = new Set([...living, ...featureServices]);
      const arch = archSlice(deltaDoc, service, id, fleet);

      // The use-case axis, and the one section here that is a fact about the
      // FLEET rather than about the feature's own files: which declared business
      // flows already run through this service, and at which hop. An implementer
      // handed "add the endpoint" and not told that step 4 of Checkout is the
      // caller has to go find that out, and on a fleet of a hundred nobody does.
      //
      // The fleet set is `living ∪ featureServices`, the same union `archSlice`
      // resolves with, so a service this feature INTRODUCES resolves to itself
      // rather than to a container's title. And `useCaseBlastRadius` gates its
      // own load: a docs repo whose architecture/ never mentions the reserved
      // tag prefix costs a readdir and a few file reads here, not a LikeC4
      // workspace — which is what keeps this command usable inside
      // /loam-implement's inner loop.
      const useCases = await useCaseBlastRadius({
        docsDir: config.docsDir,
        known: fleet,
        services: new Set([service]),
      });

      // The business axis. Like the use-case section above it is a fact about
      // the FEATURE rather than about this service's own files, and it is here
      // for the sharper version of that section's reason: a capability delta
      // NAMES NO SERVICE, so projecting the feature onto a service would drop
      // it entirely — and the implementer handed "add the endpoint" would never
      // learn which business promise the requirement they are about to write is
      // supposed to keep. `Realizes: <capability>#<id>` is the line that says
      // so, it is written on the SERVICE requirement, and the id in it is the
      // one thing here that cannot be guessed.
      //
      // Not narrowed by `--service`, deliberately: the promise is what the
      // whole feature is for, and narrowing it would report a capability-only
      // feature as having nothing to say about every service in turn. One
      // `existsSync` for a fleet that has not adopted the axis.
      const capabilities = await capabilityDeltaSummaries(
        (await featureCapabilityDeltas(feature.dir)).docs,
        async (path) => parseRequirements(await readFile(path, "utf8")),
      );

      // An unparseable delta.likec4 empties the C4 slice, and a consumer
      // reading this projection as a task brief — the JSON payload and the
      // printed view alike — would take that as "no architecture change": the
      // vacuously-green pattern. The output stays as informative as ever (and
      // `ok` stays true under --json: the command ran); the exit code is what
      // stops a pipeline from building on it, so it is set BEFORE the format
      // fork — the guard is about the delta, not about how it is rendered.
      //
      // The two contract axes fail the same way and earn the same guard: an
      // openapi.yaml or asyncapi.yaml that does not parse projects as an empty
      // change list. `validate --feature` does catch both these days
      // (`openapi.invalid` / `asyncapi.invalid` on the feature's own files),
      // but the guard stays this command's own: the brief is consumed by
      // agents that never ran validate, so the exit code must carry the
      // failure itself.
      if (arch.errors.length > 0 || api.unreadable || events.unreadable) process.exitCode = 1;

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
          command: "delta",
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
          // The event axis arrives after the api/openapi pair settled its
          // split shape, so it is one additive key carrying both halves:
          // the declarations and the document's readability.
          events: {
            changes: events.changes,
            unreadable: events.unreadable,
            ...(events.error === undefined ? {} : { error: events.error }),
          },
          architecture: arch,
          // Additive, which the envelope permits (core/envelope/json.ts), and
          // deliberately NOT wired into the exit-code guard above. The three
          // conditions there are about the FEATURE's own documents; an
          // `architecture/` that does not parse is a pre-existing fleet defect
          // `validate` already reports as `landscape.invalid`, and making every
          // `loam delta` in such a repo exit 1 would be a new gate wearing the
          // clothes of a new field. `unreadable` is how this payload says it
          // could not look.
          useCases: {
            unreadable: useCases.unreadable,
            ...(useCases.error === undefined ? {} : { error: useCases.error }),
            flows: useCases.flows,
          },
          // Additive, and an empty array rather than an absent key for the same
          // reason `loam show`'s is: a consumer must not have to tell "this
          // feature changes no capability" from "this loam does not report
          // them". The shape is `show`'s, verbatim — the two commands are read
          // side by side, and a second shape for one idea is a second thing to
          // learn.
          capabilities: capabilities.map((c) => ({
            id: c.id,
            path: repoPath(config.docsDir, c.spec),
            added: c.added,
            modified: c.modified,
            removed: c.removed,
            promises: c.promises,
          })),
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
      if (existsSync(specPaths.asyncapi)) printEvents(events);
      if (existsSync(paths.delta)) printArchSlice(arch, service);
      printCapabilities(capabilities);
      printUseCases(useCases, service);
    });
}
