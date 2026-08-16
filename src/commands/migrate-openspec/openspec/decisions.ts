/**
 * The mapping document on the way out: the blank skeleton `audit-openspec`
 * offers, the normalized record `migrate-openspec --apply` writes beside the
 * staged docs, and the one query that reads a decision back.
 *
 * `selectedServices` belongs here rather than beside either materializer
 * because it is the single spelling of the routing rule. It was written out
 * twice once — once on the living side and once on the delta side — and the two
 * copies drifted, so a split capability routed a living requirement and its own
 * delta to different services. Both materializers now call this one.
 */
import { existsSync } from "node:fs";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { stringify as stringifyYaml } from "yaml";
import { dictionary, ownValue } from "../../../core/kernel/records.js";
import { type OpenSpecMapping, type OpenSpecMappingSkeleton } from "../../../core/openspec/model/mapping.js";
import { type OpenSpecInventory } from "../../../core/openspec/model/model.js";
import { OpenSpecCommandError } from "./error.js";
import { canonicalForCreate, contains } from "./paths.js";

export async function writeMappingSkeleton(
  inventory: OpenSpecInventory,
  outputArg: string,
  skeleton: OpenSpecMappingSkeleton,
): Promise<string> {
  const output = resolve(outputArg);
  const canonicalOutput = await canonicalForCreate(output);
  const canonicalSource = await realpath(inventory.inputRoot);
  if (contains(canonicalSource, canonicalOutput)) {
    throw new OpenSpecCommandError(
      "invalid-option",
      `Refusing to write the mapping inside the OpenSpec source workspace: ${output}`,
    );
  }
  if (existsSync(output)) {
    throw new OpenSpecCommandError("already-exists", `Mapping output already exists; refusing to overwrite it: ${output}`);
  }
  await mkdir(dirname(output), { recursive: true });
  try {
    await writeFile(output, stringifyYaml(skeleton, { lineWidth: 0 }), { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if (existsSync(output)) {
      throw new OpenSpecCommandError("already-exists", `Mapping output already exists; refusing to overwrite it: ${output}`);
    }
    throw error;
  }
  return output;
}

export function normalizedMapping(inventory: OpenSpecInventory, mapping: OpenSpecMapping): Record<string, unknown> {
  return {
    version: 1,
    source: { root: inventory.root, inventoryDigest: inventory.inventoryDigest },
    capabilities: Object.fromEntries(inventory.mappingDecisions.map((decision) => [
      decision.capability,
      {
        services: ownValue(mapping.capabilities, decision.capability)?.services ?? [],
        requirementServices: ownValue(mapping.capabilities, decision.capability)?.requirementServices ?? dictionary(),
      },
    ])),
    changes: Object.fromEntries(inventory.changeDecisions.map((decision) => [
      decision.change,
      {
        feature: ownValue(mapping.changes, decision.change)?.feature ?? null,
        // The decision's title, which is the mapping's own title trimmed.
        // `readMapping` (`./mapping.ts`) trims `feature` but not `title`, and
        // materialization writes the trimmed one into the frontmatter, the H1
        // and the directory slug — so recording the raw one made the plan
        // disagree with the files beside it about what the feature is called.
        title: decision.title,
      },
    ])),
    renames: Object.fromEntries(
      inventory.renamed
        .filter((rename) => rename.scope === "active")
        .map((rename) => [rename.key, {
          from: rename.from,
          to: rename.to,
          existingRequirementId: rename.existingRequirementId,
          requirementId: rename.requirementId,
        }]),
    ),
    artifacts: Object.fromEntries(inventory.artifactDecisions.map((decision) => [
      decision.path,
      {
        kind: decision.kind,
          disposition: ownValue(mapping.artifacts, decision.path) ?? null,
      },
    ])),
  };
}

export function selectedServices(
  mapping: OpenSpecMapping,
  capability: string,
  requirement: string,
): string[] {
  const selected = ownValue(mapping.capabilities, capability);
  if (selected === undefined) return [];
  return selected.services.length === 1
    ? selected.services
    : ownValue(selected.requirementServices, requirement) ?? [];
}
