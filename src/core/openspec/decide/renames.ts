/**
 * Every active RENAMED pair resolved against the living source of truth.
 *
 * This is the identity problem the whole package exists for: OpenSpec renames
 * by writing FROM/TO bullets, loam renames by carrying one stable
 * `Requirement-ID` through a MODIFIED requirement, and nothing mechanical
 * bridges the two. So each pair is either resolved to an id the living text
 * already carries, or it becomes a decision a human has to make — never a
 * guess, because a wrong identity silently merges one requirement's text over
 * another's.
 *
 * It MUTATES the usages it resolves rather than returning new ones: a rename is
 * one fact seen in one file, and two copies of it — one resolved, one not — is
 * exactly the bug this resolution exists to prevent.
 */
import { ownValue } from "../../kernel/records.js";
import { REQUIREMENT_ID_RE, requirementIdDeclarations } from "../../document/spec.js";
import { type OpenSpecMappingIssue } from "../model/mapping.js";
import { type OpenSpecRenamedUsage } from "../model/model.js";
import { type Scan, type Routing } from "./capabilities.js";

export function resolveRenames(scan: Scan, routing: Routing, mappingIssues: OpenSpecMappingIssue[]): void {
  const { mapping, livingRequirements, renamed } = scan;
  const { livingByService, servicesForRequirement } = routing;
    const activeRenames = renamed.filter((rename) => rename.scope === "active");
    const renameKeys = new Set(activeRenames.map((rename) => rename.key));
    for (const [key, requirementId] of Object.entries(mapping.renames)) {
      if (!renameKeys.has(key)) {
        mappingIssues.push({
          code: "mapping.unknown-rename",
          key,
          message: `Mapping names unknown RENAMED pair '${key}'.`,
        });
      } else if (!REQUIREMENT_ID_RE.test(requirementId)) {
        mappingIssues.push({
          code: "mapping.invalid-requirement-id",
          key,
          message: `RENAMED pair '${key}' has invalid Requirement-ID '${requirementId}'.`,
        });
      }
    }

    // Resolve every rename against the living source of truth. A mapped id is
    // only needed when the source requirement does not already carry one.
    for (const rename of activeRenames) {
      if (rename.from === null || rename.from === "" || rename.to === null || rename.to === "") continue;
      const living = livingRequirements.get(rename.capability) ?? [];
      const matches = living.filter((requirement) => requirement.name === rename.from);
      if (matches.length === 0) {
        mappingIssues.push({
          code: "mapping.rename-source-missing",
          key: rename.key,
          message: `RENAMED source '${rename.from}' does not exist in living capability '${rename.capability}'.`,
        });
        rename.requirementId = null;
        rename.status = "needsIdentity";
        continue;
      }
      if (matches.length > 1) {
        mappingIssues.push({
          code: "mapping.rename-source-ambiguous",
          key: rename.key,
          message: `RENAMED source '${rename.from}' matches ${matches.length} living requirements in '${rename.capability}'.`,
        });
        rename.requirementId = null;
        rename.status = "needsIdentity";
        continue;
      }
      const source = matches[0]!;
      const declarations = requirementIdDeclarations(source);
      if (declarations.length > 0
        && (declarations.length !== 1 || !REQUIREMENT_ID_RE.test(declarations[0]!))) {
        rename.existingRequirementId = source.id ?? null;
        rename.requirementId = null;
        rename.status = "needsIdentity";
        mappingIssues.push({
          code: "mapping.rename-source-id-invalid",
          key: rename.key,
          message: `RENAMED source '${rename.from}' has ${declarations.length === 1 ? "an invalid" : "repeated"} Requirement-ID declaration; repair the living source before migration.`,
        });
        continue;
      }
      rename.existingRequirementId = source.id ?? null;
      const requestedId = ownValue(mapping.renames, rename.key) ?? null;
      if (source.id !== undefined && requestedId !== null && requestedId !== source.id) {
        mappingIssues.push({
          code: "mapping.rename-existing-id-conflict",
          key: rename.key,
          message: `RENAMED source '${rename.from}' already has Requirement-ID '${source.id}'; mapping cannot replace it with '${requestedId}'.`,
        });
      }
      rename.requirementId = source.id ?? requestedId;
      rename.status = rename.requirementId === null ? "needsIdentity" : "mapped";
      const routedServices = servicesForRequirement(rename.capability, rename.from);
      if (rename.requirementId !== null) {
        const collisionServices = routedServices.filter((service) =>
          (livingByService.get(service) ?? []).some(
            (entry) => entry.requirement !== source && entry.requirement.id === rename.requirementId,
          ));
        if (collisionServices.length > 0) {
          mappingIssues.push({
            code: "mapping.rename-id-conflict",
            key: rename.key,
            message: `RENAMED identity '${rename.requirementId}' already belongs to another living requirement in mapped service(s): ${collisionServices.join(", ")}.`,
          });
        }
      }
      const targetCollisionServices = routedServices.filter((service) =>
        (livingByService.get(service) ?? []).some(
          (entry) => entry.requirement !== source && entry.requirement.name === rename.to,
        ));
      if (rename.to === rename.from || targetCollisionServices.length > 0) {
        mappingIssues.push({
          code: "mapping.rename-target-conflict",
          key: rename.key,
          message: rename.to === rename.from
            ? `RENAMED target '${rename.to}' is the same as its living source.`
            : `RENAMED target '${rename.to}' conflicts in mapped service(s): ${targetCollisionServices.join(", ")}.`,
        });
      }
    }

    const renameSources = new Map<string, OpenSpecRenamedUsage[]>();
    const renameTargets = new Map<string, OpenSpecRenamedUsage[]>();
    for (const rename of activeRenames) {
      if (rename.from === null || rename.to === null) continue;
      for (const service of servicesForRequirement(rename.capability, rename.from)) {
        const sourceKey = `${service}\0${rename.from}`;
        const targetKey = `${service}\0${rename.to}`;
        const sources = renameSources.get(sourceKey) ?? [];
        sources.push(rename);
        renameSources.set(sourceKey, sources);
        const targets = renameTargets.get(targetKey) ?? [];
        targets.push(rename);
        renameTargets.set(targetKey, targets);
      }
    }
    for (const [key, uses] of renameSources) {
      if (uses.length > 1) {
        mappingIssues.push({
          code: "mapping.rename-double-source",
          key: key.replace("\0", ":"),
          message: `Living requirement '${uses[0]!.from}' is renamed by multiple active changes: ${uses.map((item) => item.changeId).join(", ")}.`,
        });
      }
    }
    for (const [key, uses] of renameTargets) {
      if (uses.length > 1) {
        mappingIssues.push({
          code: "mapping.rename-double-target",
          key: key.replace("\0", ":"),
          message: `Multiple active renames target '${uses[0]!.to}' in mapped service '${key.split("\0")[0]}'.`,
        });
      }
      if (renameSources.has(key)) {
        mappingIssues.push({
          code: "mapping.rename-chain",
          key: key.replace("\0", ":"),
          message: `Active rename chain through '${uses[0]!.to}' must be collapsed into one reviewed rename.`,
        });
      }
    }
    const renameIdOwners = new Map<string, Set<string>>();
    for (const rename of activeRenames) {
      if (rename.requirementId === null || rename.from === null) continue;
      for (const service of servicesForRequirement(rename.capability, rename.from)) {
        const key = `${service}\0${rename.requirementId}`;
        const owners = renameIdOwners.get(key) ?? new Set<string>();
        owners.add(`${rename.capability}:${rename.from}`);
        renameIdOwners.set(key, owners);
      }
    }
    for (const [key, owners] of renameIdOwners) {
      if (owners.size > 1) {
        const [service, requirementId] = key.split("\0");
        mappingIssues.push({
          code: "mapping.rename-id-conflict",
          key,
          message: `Requirement-ID '${requirementId}' is assigned to different RENAMED sources in mapped service '${service}': ${[...owners].join(", ")}.`,
        });
      }
    }
}
