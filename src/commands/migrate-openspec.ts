import type { Command } from "commander";
import { fail, emitJson } from "../core/json.js";
import {
  inventoryOpenSpec,
  OpenSpecRootError,
  type OpenSpecInventory,
} from "../core/openspec-inventory.js";

interface MigrateOpenSpecOptions {
  json?: boolean;
}

export function registerMigrateOpenSpec(program: Command): void {
  program
    .command("migrate-openspec")
    .argument("<root>", "OpenSpec root, or a workspace containing openspec/")
    .description("Inventory an OpenSpec workspace and report migration decisions (dry-run only)")
    .option("--json", "emit the machine contract instead of the human view")
    .action(async (root: string, opts: MigrateOpenSpecOptions) => {
      const json = opts.json === true;
      let inventory: OpenSpecInventory;
      try {
        inventory = await inventoryOpenSpec(root);
      } catch (error) {
        if (error instanceof OpenSpecRootError) {
          fail(json, "unknown-target", error.message);
          return;
        }
        throw error;
      }

      if (json) emitJson({ command: "migrate-openspec", dryRun: true, ...inventory });
      else printInventory(inventory);
      if (!inventory.ready) process.exitCode = 1;
    });
}

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

function printInventory(inventory: OpenSpecInventory): void {
  const status = inventory.ready
    ? "ready"
    : inventory.mechanicallyCompatible
      ? "mechanically compatible; mapping decisions remain"
      : "unsupported shapes found";
  console.log(`OpenSpec migration inventory — ${status}`);
  console.log(`  root          ${inventory.root}`);
  console.log(
    `  living       ${plural(inventory.living.capabilities.length, "capability", "capabilities")} · ${plural(inventory.living.specFiles, "spec file")} · ${plural(inventory.living.requirements, "requirement")} · ${plural(inventory.living.scenarios, "scenario")}`,
  );
  console.log(
    `  changes      ${inventory.changes.counts.active} active · ${inventory.changes.counts.archived} archived`,
  );

  if (inventory.needsMapping.length > 0) {
    console.log("\n  capability → service decisions");
    for (const decision of inventory.needsMapping) {
      console.log(`    ? ${decision.capability} → ${decision.suggestedService}  [${decision.status}]`);
    }
  }
  if (inventory.renamed.length > 0) {
    console.log("\n  RENAMED usage");
    for (const usage of inventory.renamed) console.log(`    ! ${usage.path}:${usage.line}`);
  }
  if (inventory.unsupported.length > 0) {
    console.log("\n  unsupported shapes");
    for (const issue of inventory.unsupported) {
      console.log(`    ✗ ${issue.code}  ${issue.path} — ${issue.message}`);
    }
  }
  console.log("\n  dry-run: no loam files were created or changed");
}
