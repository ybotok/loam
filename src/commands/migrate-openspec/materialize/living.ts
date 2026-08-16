/**
 * The living OpenSpec corpus as draft loam service specs — one `spec.md` per
 * service a capability was routed to.
 *
 * Separate from `./active.js` because the two materialize different documents
 * from the same corpus: this one emits BASE requirements a service owns, that
 * one emits the ADDED/MODIFIED/REMOVED deltas a feature proposes. They share
 * the routing rule (`../openspec/decisions.js`) and the spec guard
 * (`./stage.js`) and nothing else, and keeping them apart is what stopped a
 * rename resolved on one side from being written beside a spec built on the
 * other.
 */
import { join } from "node:path";
import { stringify as stringifyYaml } from "yaml";
import { serializeRequirements, type Requirement } from "../../../core/document/spec.js";
import { ownValue } from "../../../core/kernel/records.js";
import { type OpenSpecInventory, type OpenSpecMapping } from "../../../core/openspec-inventory.js";
import { planWrite, type PlannedWrite } from "../../../core/staging.js";
import { selectedServices } from "../openspec/decisions.js";
import { OpenSpecCommandError } from "../openspec/error.js";
import { assertMaterializedRequirementIds } from "./stage.js";

export async function materializeLivingSpecs(
  inventory: OpenSpecInventory,
  mapping: OpenSpecMapping,
  target: string,
  livingByCapability: ReadonlyMap<string, Requirement[]>,
): Promise<PlannedWrite[]> {
  const byService = new Map<string, Requirement[]>();
  const renameIds = new Map(
    inventory.renamed
      .filter((rename) => rename.scope === "active" && rename.from !== null && rename.requirementId !== null)
      .map((rename) => [`${rename.capability}\0${rename.from}`, rename.requirementId!] as const),
  );
  for (const capability of inventory.living.capabilities) {
    const selected = ownValue(mapping.capabilities, capability.id);
    if (selected === undefined) continue; // readiness prevents this on --apply
    for (const parsed of livingByCapability.get(capability.id) ?? []) {
      const renamedId = renameIds.get(`${capability.id}\0${parsed.name}`);
      const requirement = renamedId === undefined ? parsed : { ...parsed, id: renamedId };
      // The one spelling of the routing rule, and the reason it lives in
      // `../openspec/decisions.js` rather than here. Written out again here, it
      // drifted from the copy the delta side uses, so a split capability could
      // route a living requirement and its own delta to different services.
      const services = selectedServices(mapping, capability.id, requirement.name);
      for (const service of services) {
        const existing = byService.get(service) ?? [];
        const identity = requirement.id === undefined ? `heading '${requirement.name}'` : `Requirement-ID '${requirement.id}'`;
        if (existing.some((item) =>
          item.name === requirement.name
          || (item.id !== undefined && requirement.id !== undefined && item.id === requirement.id))) {
          throw new OpenSpecCommandError(
            "invalid-option",
            `Mapped living specs collide in service '${service}' on ${identity}; refine the capability/requirement allocation before --apply.`,
          );
        }
        existing.push({ ...requirement, kind: "BASE" });
        byService.set(service, existing);
      }
    }
  }
  return [...byService.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([service, requirements]) => {
      assertMaterializedRequirementIds(`Mapped living service '${service}'`, requirements);
      return planWrite(
        join(target, "services", service, "spec.md"),
        `---\n${stringifyYaml({ service, status: "draft" }, { lineWidth: 0 }).trimEnd()}\n---\n\n# ${service}\n\n<!-- Staged from OpenSpec. Purpose/section prose and capability design.md are preserved verbatim under legacy/openspec/specs/. Add truthful sources and complete C4/OpenAPI links before validation/vouch. -->\n\n## Requirements\n\n${serializeRequirements(requirements)}`,
      );
    });
}
