import type { Command } from "commander";
import { loadConfig } from "../../core/envelope/config.js";
import { emitJson, fail, reportNoConfig } from "../../core/envelope/json.js";
import { parseServiceId } from "../../core/kernel/ids/service.js";
import { FleetContext } from "../../core/fleet-context.js";
import { assemblePack, packHoles } from "../../core/pack/pack.js";
import { nearestIds, type FeatureEntry } from "../../core/repo/entries.js";
import { missingFeatureMessage, resolveFeature } from "../../core/repo/repo.js";
import { DocsRepoUnavailableError } from "../../core/repo/state.js";
import { docsRepoReady, reportDocsRepoError, reportRepositoryUnavailable } from "../policy/gate.js";
import { printPack } from "./print.js";

interface ContextOptions {
  feature?: string;
  json?: boolean;
}

export function registerContext(program: Command): void {
  program
    .command("context")
    .argument("<service>", "service id, e.g. payment-service")
    .description(
      "Assemble one service's docs slice — spec, contracts, edges, permissions, capabilities, and the deltas in flight over it — as one deterministic briefing; writes nothing",
    )
    .option("--feature <FEAT>", "narrow the in-flight section to this one feature")
    .option("--json", "emit the machine contract instead of the human view")
    .action(async (serviceArg: string, opts: ContextOptions) => {
      const json = opts.json === true;

      const loaded = await loadConfig();
      if (loaded.kind !== "loaded") {
        reportNoConfig(json, loaded);
        return;
      }
      const { docsDir } = loaded.config;
      // `services`, not `docs`: the pack is a statement about one service in
      // the fleet, and an empty pack read out of a directory that is not a
      // docs repo would say "nothing is documented here" about a repo nobody
      // looked in.
      if (!docsRepoReady(json, docsDir, "services")) return;

      const context = new FleetContext();
      try {
        // The feature is resolved BEFORE the service is looked up (delta's
        // ordering): its refusal is about the flag, and it must not depend on
        // whether the service half of the invocation was right.
        let feature: FeatureEntry | null = null;
        if (opts.feature !== undefined) {
          feature = await resolveFeature(docsDir, opts.feature, "exclude", context);
          if (!feature) {
            fail(json, "unknown-target", await missingFeatureMessage(docsDir, opts.feature, context));
            return;
          }
        }

        // The enumeration answers first and the grammar second —
        // core/repo/service-target.ts's settled order, and the pack is exactly
        // the case its banner argues from: `services/payment service/` is a
        // directory `validate --all` grades and `service.id-invalid` tells the
        // team to rename, so refusing it on the grammar would make the one
        // service loam complains about the one service nobody can be briefed
        // on. The enumerated id is safe to use onward — a readdir produced it,
        // which is `RawServiceId`'s whole provenance. A name that is neither
        // enumerated nor legal is refused before any path is built; a legal
        // name with no directory is `unknown-service`, because a typo must
        // never be indistinguishable from an undocumented service — an EMPTY
        // pack reads as "nothing to know here".
        const entries = await context.listServices(docsDir);
        const entry = entries.find((e) => e.id === serviceArg);
        if (entry === undefined) {
          const parsed = parseServiceId(serviceArg, "service");
          if (!parsed.ok) {
            fail(json, "invalid-option", parsed.problem);
            return;
          }
          const near = nearestIds(serviceArg, entries.map((e) => e.id));
          fail(
            json,
            "unknown-service",
            `No service '${serviceArg}' under ${docsDir}/services/.` +
              (near.length === 0 ? "" : ` Did you mean ${near.map((n) => `'${n}'`).join(" or ")}?`),
          );
          return;
        }

        const pack = await assemblePack({ docsDir, entry, feature, context });
        // A document behind the pack that exists but does not parse empties
        // its section, and an agent loading the pack as a briefing would read
        // that as "nothing here" — the vacuously-green pattern. The output
        // stays as informative as ever (and `ok` stays true under --json: the
        // command ran); the exit code is what stops a pipeline from building
        // on it, so it is set BEFORE the format fork — the guard is about the
        // pack, not about how it is rendered.
        if (packHoles(pack)) process.exitCode = 1;

        if (json) {
          emitJson({ command: "context", docsDir, ...pack });
          return;
        }
        printPack(pack);
      } catch (err) {
        if (err instanceof DocsRepoUnavailableError) {
          reportDocsRepoError(json, err);
          return;
        }
        // The assembly is all-or-nothing, like explore's scan: it reads every
        // document the pack quotes, so the honest answer to an unreadable FILE
        // (a directory where a document belongs, bytes that are not UTF-8) is
        // a refusal naming the path, not a briefing with a silent hole in it.
        reportRepositoryUnavailable(json, err, "the pack would be missing a document", docsDir);
      }
    });
}
