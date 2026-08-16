/**
 * The two verbs of the OpenSpec on-ramp, and nothing else.
 *
 * They are one module because they are two halves of one procedure and share
 * the failure mapping below: `audit-openspec` reads a workspace and offers the
 * decision skeleton, `migrate-openspec` takes that skeleton back filled in and
 * — only with `--apply` — materializes a staged target. Finding
 * incompatibilities is a successful audit, so exit status is decided here and
 * only here; every phase under `./openspec/` and `./materialize/` refuses by
 * throwing `OpenSpecCommandError` and never touches `process.exitCode`.
 */
import { dirname, join, resolve } from "node:path";
import type { Command } from "commander";
import { fail, emitJson } from "../../core/envelope/json.js";
import { inventoryOpenSpec } from "../../core/openspec/inventory.js";
import { createOpenSpecMappingSkeleton } from "../../core/openspec/model/mapping.js";
import { OpenSpecRootError } from "../../core/openspec/model/model.js";
import { writeMappingSkeleton } from "./openspec/decisions.js";
import { OpenSpecCommandError } from "./openspec/error.js";
import { readMapping } from "./openspec/mapping.js";
import { planMigrationWrites, writeMigrationTarget } from "./materialize/target.js";
import { printInventory } from "./print.js";

interface AuditOpenSpecOptions {
  json?: boolean;
  writeMapping?: string;
}

interface MigrateOpenSpecOptions {
  json?: boolean;
  map?: string;
  mapping?: string;
  apply?: boolean;
  target?: string;
}

/** Registers the read-only audit and the separate, mapping-driven migration planner. */
export function registerMigrateOpenSpec(program: Command): void {
  program
    .command("audit-openspec")
    .argument("<root>", "OpenSpec root, Store checkout, or workspace containing openspec/")
    .description("Audit an OpenSpec workspace without treating human mapping decisions as command failure")
    .option("--write-mapping <path>", "write a non-overwriting, digest-bound decision skeleton outside the source workspace")
    .option("--json", "emit the machine contract instead of the human view")
    .action(async (root: string, opts: AuditOpenSpecOptions) => {
      const json = opts.json === true;
      try {
        const inventory = await inventoryOpenSpec(root);
        const skeleton = createOpenSpecMappingSkeleton(inventory);
        const mappingWritten = opts.writeMapping === undefined
          ? null
          : await writeMappingSkeleton(inventory, opts.writeMapping, skeleton);
        if (json) {
          emitJson({
            command: "audit-openspec",
            readOnly: mappingWritten === null,
            mappingWritten,
            mappingSkeleton: skeleton,
            ...inventory,
          });
        } else {
          printInventory(inventory, "audit");
          if (mappingWritten !== null) console.log(`\n  mapping skeleton  ${mappingWritten}`);
          else console.log("\n  read-only audit: no files were created or changed");
        }
        // Finding incompatibilities is a successful audit result. Root/YAML/IO
        // failures still exit 1 through the catch below; migration readiness has
        // its own boolean and migrate-openspec exit status.
      } catch (error) {
        reportCommandError(json, error);
      }
    });

  program
    .command("migrate-openspec")
    .argument("<root>", "OpenSpec root, Store checkout, or workspace containing openspec/")
    .description("Validate explicit migration mappings and optionally materialize staged migration docs")
    .option("--map <path>", "YAML mapping created from `audit-openspec --write-mapping`")
    .option("--mapping <path>", "deprecated alias for --map")
    .option("--apply", "materialize staged migration docs; dry-run is the default")
    .option("--target <directory>", "empty standalone target for --apply; never writes into the OpenSpec source or live loam docs")
    .option("--json", "emit the machine contract instead of the human view")
    .action(async (root: string, opts: MigrateOpenSpecOptions) => {
      const json = opts.json === true;
      try {
        if (opts.map !== undefined && opts.mapping !== undefined) {
          throw new OpenSpecCommandError("invalid-option", "Pass --map or its deprecated --mapping alias, not both.");
        }
        const mapArg = opts.map ?? opts.mapping;
        if (mapArg === undefined) {
          throw new OpenSpecCommandError(
            "invalid-option",
            "migrate-openspec requires --map <path>; run `loam audit-openspec <root> --write-mapping <path>` first.",
          );
        }
        if (opts.apply === true && opts.target === undefined) {
          throw new OpenSpecCommandError("invalid-option", "--apply requires an explicit --target <empty-directory>.");
        }
        if (opts.apply !== true && opts.target !== undefined) {
          throw new OpenSpecCommandError("invalid-option", "--target only has effect with explicit --apply.");
        }
        const mappingPath = resolve(mapArg);
        const mapping = await readMapping(mappingPath);
        // Re-audit the source at the point of use. inventoryOpenSpec compares
        // the fresh digest and canonical root to the binding in the mapping.
        const inventory = await inventoryOpenSpec(root, { mapping });
        const target = opts.apply === true
          ? resolve(opts.target!)
          : join(dirname(mappingPath), ".loam-openspec-dry-run-target");
        const planned = inventory.ready
          ? await planMigrationWrites(inventory, mapping, target)
          : null;
        let applied: { directory: string; files: string[]; followUpBlockers: string[] } | null = null;
        if (opts.apply === true) {
          if (!inventory.ready || planned === null) {
            throw new OpenSpecCommandError(
              "invalid-option",
              "Migration cannot be applied until living/active shapes, capability mappings, change-to-feature decisions, active RENAMED identities, authored artifact dispositions, and source digest binding are resolved.",
            );
          }
          applied = await writeMigrationTarget(inventory, mapping, target, planned);
        }

        if (json) {
          emitJson({
            command: "migrate-openspec",
            dryRun: applied === null,
            mappingPath,
            applied,
            ...inventory,
          });
        } else {
          printInventory(inventory, "migration");
          if (applied === null) console.log("\n  dry-run: no files were created or changed");
          else {
            console.log(`\n  staged migration docs  ${applied.directory}`);
            console.log(`  follow-up blockers      ${applied.followUpBlockers.length} (see FOLLOW-UP.md)`);
          }
        }
        if (!inventory.ready) process.exitCode = 1;
      } catch (error) {
        reportCommandError(json, error);
      }
    });
}

function reportCommandError(json: boolean, error: unknown): void {
  if (error instanceof OpenSpecRootError) {
    fail(json, "unknown-target", error.message);
    return;
  }
  if (error instanceof OpenSpecCommandError) {
    fail(json, error.code, error.message);
    return;
  }
  throw error;
}
