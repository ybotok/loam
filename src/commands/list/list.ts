import type { Command } from "commander";
import { loadConfig } from "../../core/envelope/config.js";
import { emitJson, fail, reportNoConfig } from "../../core/envelope/json.js";
import { maturityRollup } from "../../core/vocabulary/maturity.js";
import { FleetContext } from "../../core/fleet-context.js";
import { DocsRepoUnavailableError } from "../../core/repo/state.js";
import { listFeatures, listFleetTree, listServices } from "../../core/repo/repo.js";
import { docsRepoReady, reportDocsRepoError, reportRepositoryUnavailable } from "../policy/gate.js";
import { featureVerification, serviceViews } from "./views.js";
import { featureJson, serviceJson, subsystemsJson } from "./json.js";
import { printFeatures, printServices, printWorklist } from "./print.js";

type Section = "services" | "features";
const SECTIONS: Section[] = ["services", "features"];

interface ListOptions {
  json?: boolean;
  archived?: boolean;
  needsWork?: boolean;
}

export function registerList(program: Command): void {
  program
    .command("list")
    .argument("[section]", "services | features (default: both)")
    .description("List the services and features in the docs repo")
    .option("--json", "emit the machine contract instead of the human view")
    .option("--archived", "include archived features")
    .option(
      "--needs-work",
      "services only: the adoption worklist — every service below `vouched`, with what it is missing",
    )
    .action(async (section: string | undefined, opts: ListOptions) => {
      const json = opts.json === true;
      const wanted = opts.needsWork
        ? SECTIONS.filter((s) => s === "services")
        : section
          ? SECTIONS.filter((s) => s === section)
          : SECTIONS;
      if (section && !SECTIONS.includes(section as Section)) {
        // `invalid-option`, same as show's bad --type: one mistake class, one code.
        fail(json, "invalid-option", `Unknown section '${section}'. Expected: ${SECTIONS.join(" | ")}.`);
        return;
      }
      if (opts.needsWork && section === "features") {
        fail(json, "invalid-option", "--needs-work is the service adoption worklist; drop the 'features' section.");
        return;
      }

      const loaded = await loadConfig();
      if (loaded.kind !== "loaded") {
        reportNoConfig(json, loaded);
        return;
      }
      const config = loaded.config;
      const { docsDir } = config;
      // A docsDir that is not a docs repo is refused, never rendered as an empty
      // fleet — the whole point of the gate (see docs-repo-gate.ts).
      // `list features` alone does not need services/, so it asks for less.
      if (!docsRepoReady(json, docsDir, wanted.includes("services") ? "services" : "docs")) return;

      try {
        // One context, one walk: the tree memo answers both the service
        // entries and the subsystem/unfiled counts beside them.
        const fleet = new FleetContext();
        const tree = wanted.includes("services") ? await listFleetTree(docsDir, fleet) : undefined;
        const services = wanted.includes("services") ? await listServices(docsDir, fleet) : undefined;
        const views = services ? await serviceViews(docsDir, services, config.service) : undefined;
        const features = wanted.includes("features")
          ? await listFeatures(docsDir, { includeArchived: opts.archived }, fleet)
          : undefined;
        const verification = features
          ? await Promise.all(features.map((f) => featureVerification(docsDir, f)))
          : undefined;

        const worklist = views?.filter((v) => v.maturity !== "vouched");

        if (json) {
          emitJson({
            docsDir,
            ...(views
              ? {
                  services: (opts.needsWork ? worklist! : views).map((v) => serviceJson(docsDir, v)),
                  maturity: maturityRollup(views),
                  // The tree beside the table — additive keys, wave 3 of the
                  // subsystem item: the groups, and how many services sit
                  // unfiled (a permanent, normal state, so a count, never a
                  // finding).
                  subsystems: subsystemsJson(docsDir, tree!),
                  unfiledServices: tree!.services.filter((s) => s.subsystem.length === 0).length,
                }
              : {}),
            ...(features
              ? { features: features.map((f, i) => featureJson(docsDir, f, verification![i] ?? null)) }
              : {}),
          });
          return;
        }

        if (opts.needsWork) {
          printWorklist(worklist!, views!.length);
          return;
        }
        if (views) printServices(views, tree);
        if (views && features) console.log("");
        if (features) printFeatures(features, verification!);
      } catch (err) {
        if (err instanceof DocsRepoUnavailableError) {
          reportDocsRepoError(json, err);
          return;
        }
        // One unreadable file used to escape as a stack trace (`internal` in
        // --json), naming nothing. The enumeration is all-or-nothing — it reads
        // every service's frontmatter to build one table — so the honest answer
        // is a refusal that says WHICH path could not be read.
        reportRepositoryUnavailable(json, err, "the listing would be missing a service", docsDir);
      }
    });
}

/* ------------------------------------------------------------------ */
/* The per-service view                                                */
/* ------------------------------------------------------------------ */

/**
 * The graded view: the rung's own inputs (core/vocabulary/maturity.ts) plus the one fact
 * only this command knows — whether anyone standing here could check the
 * service's `sources`, which needs loam.json's binding, not the directory.
 */
