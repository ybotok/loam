import type { Command } from "commander";
import { loadConfig } from "../core/envelope/config.js";
import { analyzeDependencies } from "../core/dependencies/dependencies.js";
import { type DependencyGraph, type DependencyReason } from "../core/dependencies/facts.js";
import { FleetContext } from "../core/fleet-context.js";
import { emitJson, fail, reportNoConfig } from "../core/envelope/json.js";
import { missingFeatureMessage, resolveFeature } from "../core/repo/repo.js";

interface DependenciesOptions {
  json?: boolean;
}

export function registerDependencies(program: Command): void {
  program
    .command("dependencies")
    .argument("[featureId]", "active feature id; omit for the whole in-flight graph")
    .description("Show dependencies and conflicts derived from active feature artifacts")
    .option("--json", "emit the machine contract instead of the human view")
    .action(async (featureArg: string | undefined, opts: DependenciesOptions) => {
      const json = opts.json === true;
      const config = await loadConfig();
      if (!config) {
        reportNoConfig(json);
        return;
      }

      const context = new FleetContext();
      const feature = featureArg === undefined
        ? null
        : await resolveFeature(config.docsDir, featureArg, "exclude", context);
      if (featureArg !== undefined && feature === null) {
        // The shared miss message rather than a local one: this command resolves
        // in `exclude` mode, so the commonest miss is an id that HAS shipped, and
        // "no active feature" leaves the reader to discover that themselves. The
        // helper reuses the context already built above, so saying so costs one
        // enumeration this invocation has already paid for.
        fail(json, "unknown-target", await missingFeatureMessage(config.docsDir, featureArg, context));
        return;
      }

      const graph = await analyzeDependencies(config.docsDir, feature?.id, context);
      if (json) {
        emitJson({
          command: "dependencies",
          docsDir: config.docsDir,
          feature: feature?.id ?? null,
          ...graph,
        });
        return;
      }
      printGraph(graph, feature?.id);
    });
}

function reasonText(reason: DependencyReason): string {
  return reason.kind === "operation"
    ? `${reason.service} operation ${reason.operationId}`
    : `${reason.service}/${reason.axis} ${reason.identity}`;
}

function printGraph(graph: DependencyGraph, featureId?: string): void {
  const scope = featureId === undefined ? "active features" : `${featureId} and prerequisites`;
  console.log(`dependencies — ${scope} (${graph.nodes.length})`);
  console.log(`  order: ${graph.order.length === 0 ? "(none)" : graph.order.join(" → ")}`);

  for (const node of graph.nodes) {
    console.log(`\n  ${node.id}${node.dependsOn.length === 0 ? "  (independent)" : ""}`);
    for (const edge of graph.edges.filter((candidate) => candidate.from === node.id)) {
      console.log(`    depends on ${edge.to}`);
      for (const reason of edge.reasons) console.log(`      - ${reasonText(reason)}`);
    }
  }

  if (graph.conflicts.length > 0) {
    console.log("\n  conflicts");
    for (const conflict of graph.conflicts) {
      const where = conflict.kind === "requirement"
        ? `${conflict.service}/${conflict.axis}`
        : conflict.service;
      // "added by" vs "changed by": the two collisions want different fixes.
      // Two features ADDING the same identity is usually duplicated work that
      // should become one feature; two features CHANGING it is usually genuine
      // parallel work whose second archive would silently overwrite the first's
      // full text, so the losers need to be re-based, not merged.
      const how = conflict.change === "added" ? "added by" : "changed by";
      console.log(`    ! ${where} ${conflict.identity} — ${how} ${conflict.features.join(", ")}`);
    }
  }

  if (graph.cycles.length > 0) {
    console.log("\n  cycles");
    for (const cycle of graph.cycles) console.log(`    ! ${cycle.join(" ↔ ")}`);
  }
}
