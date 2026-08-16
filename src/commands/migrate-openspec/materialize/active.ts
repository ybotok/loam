/**
 * Each active OpenSpec change as a staged loam feature: its intent, the
 * authored artifacts a disposition kept, a verbatim copy of the source change
 * tree, and one delta `spec.md` per service its requirements routed to.
 *
 * This is the phase that resolves RENAMED pairs, and the reason it is the
 * longest: a rename is the only place where the living corpus, the delta and
 * the human's identity decision all have to agree, and every disagreement
 * between them is a refusal rather than a guess. `./feature.js` holds the file
 * shapes this emits; `./living.js` is the same corpus read for the other half.
 */
import { join } from "node:path";
import { parseRequirements } from "../../../core/document/parse.js";
import { type Requirement } from "../../../core/document/spec.js";
import { ownValue } from "../../../core/kernel/records.js";
import { type OpenSpecMapping } from "../../../core/openspec/model/mapping.js";
import { isOpenSpecArtifactDisposition, type OpenSpecInventory } from "../../../core/openspec/model/model.js";
import { planWrite, type PlannedWrite } from "../../../core/staging/writes.js";
import { selectedServices } from "../openspec/decisions.js";
import { OpenSpecCommandError } from "../openspec/error.js";
import { safeArtifactRelative } from "../openspec/paths.js";
import { readSourceArtifact } from "../openspec/read.js";
import {
  featureSlug,
  migrationFrontmatter,
  renderAuthoredBundle,
  serializeDeltaRequirements,
  type AuthoredArtifactCopy,
} from "./feature.js";
import { assertMaterializedRequirementIds } from "./stage.js";

export async function materializeActiveChanges(
  inventory: OpenSpecInventory,
  mapping: OpenSpecMapping,
  target: string,
  livingByCapability: ReadonlyMap<string, Requirement[]>,
): Promise<PlannedWrite[]> {
  const writes: PlannedWrite[] = [];
  const inventoryArtifactsByPath = new Map(inventory.artifacts.map((artifact) => [artifact.path, artifact]));

  for (const change of inventory.changes.active) {
    const decision = inventory.changeDecisions.find((item) => item.change === change.id);
    const feature = ownValue(mapping.changes, change.id)?.feature ?? null;
    if (decision === undefined || feature === null) continue; // readiness prevents this on --apply
    const featureDir = join(target, "features", `${feature}-${featureSlug(decision.title, change.id)}`);

    // Preserve the complete authored source change tree, including metadata,
    // rename syntax, custom artifacts, and original delta section ordering.
    for (const artifactPath of change.artifacts) {
      const segments = safeArtifactRelative(artifactPath, `changes/${change.id}/`, `OpenSpec change '${change.id}'`);
      writes.push(planWrite(
        join(featureDir, "legacy", "openspec", ...segments),
        await readSourceArtifact(inventory.root, artifactPath),
      ));
    }

    const authored: Array<AuthoredArtifactCopy & { kind: "proposal" | "tasks" | "change-design" }> = [];
    for (const artifactDecision of inventory.artifactDecisions) {
      const artifact = inventoryArtifactsByPath.get(artifactDecision.path);
      if (artifact?.changeId !== change.id) continue;
      const disposition = ownValue(mapping.artifacts, artifactDecision.path);
      if (disposition === undefined) continue; // readiness prevents this on --apply
      // The mapping holds the authored string; everything below compares it
      // against disposition literals, so this is where the value has to become
      // one of them or stop being routed. `mapping.invalid-artifact-disposition`
      // already refuses an unknown one, so readiness prevents this too — but a
      // silent skip is the right failure for a value nothing here can act on.
      if (!isOpenSpecArtifactDisposition(disposition)) continue;
      authored.push({
        path: artifactDecision.path,
        kind: artifactDecision.kind,
        disposition,
        raw: await readSourceArtifact(inventory.root, artifactDecision.path),
      });
    }

    const convertedProposals = authored.filter(
      (artifact) => artifact.kind === "proposal" && artifact.disposition === "convert-to-intent",
    );
    const retainedProposals = authored.filter(
      (artifact) => artifact.kind === "proposal" && artifact.disposition !== "convert-to-intent",
    );
    const intentBody = convertedProposals.length > 0
      ? renderAuthoredBundle("## Migrated OpenSpec proposal", convertedProposals)
      : "No proposal was converted into this intent. Review the retained OpenSpec artifacts and migration-plan.json before promotion.\n";
    writes.push(planWrite(
      join(featureDir, "intent.md"),
      `${migrationFrontmatter(feature, decision.title)}\n\n# ${decision.title}\n\n<!-- Staged from OpenSpec change '${change.id}'. This feature is deliberately not validation-green yet. -->\n\n${intentBody}`,
    ));
    if (retainedProposals.length > 0) {
      writes.push(planWrite(
        join(featureDir, "legacy", "proposal.md"),
        renderAuthoredBundle("# Retained OpenSpec proposal", retainedProposals),
      ));
    }

    const tasks = authored.filter((artifact) => artifact.kind === "tasks");
    if (tasks.length > 0) {
      writes.push(planWrite(
        join(featureDir, "legacy", "tasks.md"),
        renderAuthoredBundle("# OpenSpec task checklist", tasks),
      ));
    }
    const reviewedDesigns = authored.filter(
      (artifact) => artifact.kind === "change-design" && artifact.disposition === "review-as-feature-adr",
    );
    if (reviewedDesigns.length > 0) {
      writes.push(planWrite(
        join(featureDir, "adrs", "openspec-design.md"),
        renderAuthoredBundle("# OpenSpec design (review required)", reviewedDesigns),
      ));
    }
    const retainedDesigns = authored.filter(
      (artifact) => artifact.kind === "change-design" && artifact.disposition !== "review-as-feature-adr",
    );
    if (retainedDesigns.length > 0) {
      writes.push(planWrite(
        join(featureDir, "legacy", "design.md"),
        renderAuthoredBundle("# Retained OpenSpec design", retainedDesigns),
      ));
    }

    if (change.metadata.skipSpecs) continue;
    const deltaByService = new Map<string, Requirement[]>();
    const changeRenames = inventory.renamed.filter(
      (item) => item.scope === "active" && item.changeId === change.id,
    );
    const materializedRenameKeys = new Set<string>();
    const addDelta = (service: string, requirement: Requirement, origin: string): void => {
      const existing = deltaByService.get(service) ?? [];
      const collision = existing.find((item) =>
        item.name === requirement.name
        || (item.id !== undefined && requirement.id !== undefined && item.id === requirement.id));
      if (collision !== undefined) {
        const identity = requirement.id === undefined ? requirement.name : requirement.id;
        throw new OpenSpecCommandError(
          "invalid-option",
          `Active change '${change.id}' produces colliding requirement '${identity}' in service '${service}' while materializing ${origin}.`,
        );
      }
      existing.push(requirement);
      deltaByService.set(service, existing);
    };

    for (const spec of change.specs) {
      const requirements = parseRequirements(await readSourceArtifact(inventory.root, spec.path))
        .filter((requirement) => requirement.kind !== "BASE");
      for (const parsed of requirements) {
        const matchingRenames = changeRenames.filter((rename) =>
          rename.capability === spec.capability
          && rename.from !== null
          && rename.to !== null
          && (parsed.name === rename.from || parsed.name === rename.to));
        if (matchingRenames.length > 1) {
          throw new OpenSpecCommandError(
            "invalid-option",
            `Active change '${change.id}' requirement '${parsed.name}' matches multiple RENAMED pairs.`,
          );
        }
        const rename = matchingRenames[0];
        let requirement = parsed;
        let routingName = parsed.name;
        if (rename !== undefined && rename.from !== null && rename.to !== null && rename.requirementId !== null) {
          if (parsed.kind !== "MODIFIED") {
            throw new OpenSpecCommandError(
              "invalid-option",
              `Active change '${change.id}' combines RENAMED '${rename.from}' → '${rename.to}' with ${parsed.kind} '${parsed.name}'; review the conflicting delta before --apply.`,
            );
          }
          if (parsed.id !== undefined && parsed.id !== rename.requirementId) {
            throw new OpenSpecCommandError(
              "invalid-option",
              `Active change '${change.id}' MODIFIED requirement '${parsed.name}' has Requirement-ID '${parsed.id}', but its RENAMED source resolves to '${rename.requirementId}'.`,
            );
          }
          const annotation = `OpenSpec-Living-Source: ${rename.capability} :: ${rename.from}`;
          requirement = {
            ...parsed,
            id: rename.requirementId,
            name: rename.to,
            text: parsed.text.includes(annotation) ? parsed.text : [...parsed.text, "", annotation],
            section: "## MODIFIED Requirements",
          };
          routingName = rename.from;
          materializedRenameKeys.add(rename.key);
        }
        for (const service of selectedServices(mapping, spec.capability, routingName)) {
          addDelta(service, requirement, spec.path);
        }
      }
    }
    for (const rename of changeRenames) {
      if (materializedRenameKeys.has(rename.key)) continue;
      if (rename.from === null || rename.to === null || rename.requirementId === null) continue;
      const source = (livingByCapability.get(rename.capability) ?? [])
        .filter((requirement) => requirement.name === rename.from)[0];
      if (source === undefined) continue; // readiness prevents this on --apply
      const annotation = `OpenSpec-Living-Source: ${rename.capability} :: ${rename.from}`;
      const text = source.text.includes(annotation) ? source.text : [...source.text, "", annotation];
      const modified: Requirement = {
        ...source,
        kind: "MODIFIED",
        id: rename.requirementId,
        name: rename.to,
        text,
        section: "## MODIFIED Requirements",
      };
      for (const service of selectedServices(mapping, rename.capability, rename.from)) {
        addDelta(service, modified, rename.path);
      }
    }
    for (const [service, requirements] of [...deltaByService].sort(([a], [b]) => a.localeCompare(b))) {
      assertMaterializedRequirementIds(
        `Active change '${change.id}' mapped to service '${service}'`,
        requirements,
      );
      writes.push(planWrite(
        join(featureDir, "specs", service, "spec.md"),
        serializeDeltaRequirements(requirements),
      ));
    }
  }
  return writes;
}
