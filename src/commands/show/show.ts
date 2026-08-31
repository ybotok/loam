import type { Command } from "commander";
import { loadConfig } from "../../core/envelope/config.js";
import { FleetContext } from "../../core/fleet-context.js";
import { fail, reportNoConfig } from "../../core/envelope/json.js";
import { DocsRepoUnavailableError } from "../../core/repo/state.js";
import { listServices, resolveFeature } from "../../core/repo/repo.js";
import { docsRepoReady, reportDocsRepoError, reportRepositoryUnavailable } from "../policy/gate.js";
import { showFeature } from "./feature.js";
import { showService } from "./service.js";

type TargetType = "service" | "feature";

interface ShowOptions {
  json?: boolean;
  type?: string;
}

export function registerShow(program: Command): void {
  program
    .command("show")
    .argument("<target>", "service id or feature id")
    .description("Show everything loam knows about a service or a feature")
    .option("--json", "emit the machine contract instead of the human view")
    .option("--type <kind>", "force the reading: service | feature")
    .action(async (target: string, opts: ShowOptions) => {
      const json = opts.json === true;
      if (opts.type !== undefined && opts.type !== "service" && opts.type !== "feature") {
        fail(json, "invalid-option", `Unknown --type '${opts.type}'. Expected: service | feature.`);
        return;
      }
      const forced = opts.type as TargetType | undefined;

      const loaded = await loadConfig();
      if (loaded.kind !== "loaded") {
        reportNoConfig(json, loaded);
        return;
      }
      const config = loaded.config;
      const { docsDir } = config;
      // "No service or feature 'x' in <dir>" is a lie when <dir> is not a docs
      // repo at all — the same refusal validate and list owe (docsRepoReady).
      // `docs`, not `services`: a feature is readable from a repo whose
      // services/ is missing, and if the target turns out to be a service the
      // enumeration below refuses with `services-missing` anyway.
      if (!docsRepoReady(json, docsDir, "docs")) return;
      // One read index for the invocation. Deciding the target is a service
      // enumerates the fleet, and so does resolving the landscape's edges to the
      // services that own them — `loam show <service>` walked services/ twice for
      // one answer. The context memoises only within this invocation, so a later
      // run still sees whatever is on disk then.
      const context = new FleetContext();

      try {
        // A feature id is distinctive (FEAT-101); a service name is arbitrary. When
        // both could match, the feature wins and --type forces the other reading.
        const feature =
          forced === "service" ? null : await resolveFeature(docsDir, target, "include", context);
        if (feature) {
          await showFeature(docsDir, feature, json, context);
          return;
        }
        // The enumeration's own id travels on — `entry.id` rather than the raw
        // argument (repo/service-target.ts's rule): equal as strings, and only
        // one of them carries the fact that a readdir produced it.
        const entry =
          forced === "feature" ? undefined : (await listServices(docsDir, context)).find((s) => s.id === target);
        if (entry !== undefined) {
          await showService(docsDir, entry.id, json, context);
          return;
        }

        const looked = forced ? forced : "service or feature";
        fail(json, "unknown-target", `No ${looked} '${target}' in ${docsDir}.`);
      } catch (err) {
        if (err instanceof DocsRepoUnavailableError) {
          reportDocsRepoError(json, err);
          return;
        }
        // An artifact that exists but cannot be read used to escape as a stack
        // trace (`internal` in --json), naming nothing. `show` reads one target,
        // so it has nothing to fall back on — but it can at least say WHICH file.
        reportRepositoryUnavailable(json, err, `'${target}' cannot be shown`, docsDir);
      }
    });
}

/* ------------------------------------------------------------------ */
/* Service                                                             */
/* ------------------------------------------------------------------ */
