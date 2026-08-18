/**
 * Which service owns which capability, and which feature owns which change —
 * the two decisions a human has to make, graded against what the scan found.
 *
 * The routing this produces is what everything downstream selects with, which
 * is why `servicesForRequirement` is returned as a function rather than as a
 * map: a split capability routes per REQUIREMENT and a single-service one
 * routes wholesale, and a caller that reimplemented that choice would put a
 * living requirement and its own delta in different services.
 */
import { resolve } from "node:path";
import { dictionary, ownValue } from "../../kernel/records.js";
import { FEATURE_ID_RULE, isFeatureId } from "../../kernel/ids/service.js";
import { compareIds } from "../../repo/entries.js";
import { parseRequirements } from "../../document/parse.js";
import { type Requirement } from "../../document/spec.js";
import {
  type OpenSpecMapping,
  type CapabilityMappingDecision,
  type OpenSpecChangeDecision,
  type OpenSpecMappingIssue,
} from "../model/mapping.js";
import { type OpenSpecChange, type OpenSpecRenamedUsage } from "../model/model.js";
import { titleFromChangeId } from "../scan/changes.js";

/** Everything the workspace scan found, before any decision is graded. */
export interface Scan {
  root: string;
  mapping: OpenSpecMapping;
  /** Whether a mapping was SUPPLIED — an audit grades no source binding. */
  bound: boolean;
  inventoryDigest: string;
  livingRequirements: Map<string, Requirement[]>;
  active: OpenSpecChange[];
  renamed: OpenSpecRenamedUsage[];
}

/** How a requirement reaches a service, once the capability decisions are in. */
export interface Routing {
  servicesForRequirement(capability: string, requirement: string): string[];
  livingByService: Map<string, Array<{ capability: string; requirement: Requirement }>>;
}

export interface Decisions {
  mappingIssues: OpenSpecMappingIssue[];
  mappingDecisions: CapabilityMappingDecision[];
  changeDecisions: OpenSpecChangeDecision[];
  routing: Routing;
}

export function capabilityDecisions(scan: Scan): Decisions {
  const { root, mapping, bound, inventoryDigest, livingRequirements, active, renamed } = scan;
    // Capability ownership must cover the active horizon too: a brand-new
    // capability may exist only under changes/<id>/specs until archive.
    //
    // `routedNames` is the subset a split capability must actually allocate. A
    // renamed requirement is routed by its FROM — that is what keeps the delta in
    // the same services as the living text it rewrites — so demanding an
    // allocation for its TO as well asked a reviewer for a decision apply ignores.
    const requirementNamesByCapability = new Map<string, Set<string>>();
    const routedNamesByCapability = new Map<string, Set<string>>();
    const activeChangesByCapability = new Map<string, Set<string>>();
    const activeRenamePairs = renamed.filter((rename) =>
      rename.scope === "active"
      && rename.from !== null && rename.from !== ""
      && rename.to !== null && rename.to !== "");
    for (const [capability, requirements] of livingRequirements) {
      requirementNamesByCapability.set(capability, new Set(requirements.map((item) => item.name)));
      routedNamesByCapability.set(capability, new Set(requirements.map((item) => item.name)));
    }
    for (const change of active) {
      for (const spec of change.specs) {
        const names = requirementNamesByCapability.get(spec.capability) ?? new Set<string>();
        const routed = routedNamesByCapability.get(spec.capability) ?? new Set<string>();
        for (const name of spec.requirementNames) {
          names.add(name);
          const pairs = activeRenamePairs.filter((rename) =>
            rename.changeId === change.id
            && rename.capability === spec.capability
            && (name === rename.from || name === rename.to));
          routed.add(pairs.length === 1 ? pairs[0]!.from! : name);
        }
        requirementNamesByCapability.set(spec.capability, names);
        routedNamesByCapability.set(spec.capability, routed);
        const changes = activeChangesByCapability.get(spec.capability) ?? new Set<string>();
        changes.add(change.id);
        activeChangesByCapability.set(spec.capability, changes);
      }
    }
    const allCapabilityIds = [...requirementNamesByCapability.keys()].sort(compareIds);

    const mappingIssues: OpenSpecMappingIssue[] = [];
    if (bound) {
      if (mapping.source === null) {
        mappingIssues.push({
          code: "mapping.source-missing",
          key: "source",
          message: "Mapping is not bound to an audited source root and inventory digest.",
        });
      } else {
        if (resolve(mapping.source.root) !== root) {
          mappingIssues.push({
            code: "mapping.source-root-mismatch",
            key: "source.root",
            message: `Mapping was created for ${mapping.source.root}, not ${root}.`,
          });
        }
        if (mapping.source.inventoryDigest !== inventoryDigest) {
          mappingIssues.push({
            code: "mapping.source-digest-mismatch",
            key: "source.inventoryDigest",
            message: `OpenSpec source changed after audit (${mapping.source.inventoryDigest} != ${inventoryDigest}).`,
          });
        }
      }
    }
    const capabilityIds = new Set(allCapabilityIds);
    for (const capability of Object.keys(mapping.capabilities)) {
      if (!capabilityIds.has(capability)) {
        mappingIssues.push({
          code: "mapping.unknown-capability",
          key: capability,
          message: `Mapping names unknown capability '${capability}'.`,
        });
      }
    }
    const mappingDecisions: CapabilityMappingDecision[] = allCapabilityIds.map((capability) => {
      const capabilityMapping = ownValue(mapping.capabilities, capability)
        ?? { services: [], requirementServices: dictionary<string[]>() };
      const services = [...new Set(capabilityMapping.services)]
        .filter((service) => service.trim() !== "")
        .sort(compareIds);
      const requirementNames = [...(requirementNamesByCapability.get(capability) ?? [])].sort(compareIds);
      const requirementNameSet = new Set(requirementNames);
      const routedNames = [...(routedNamesByCapability.get(capability) ?? [])].sort(compareIds);
      const requirementServices = dictionary<string[]>();
      for (const [requirement, allocated] of Object.entries(capabilityMapping.requirementServices)) {
        if (!requirementNameSet.has(requirement)) {
          mappingIssues.push({
            code: "mapping.unknown-requirement",
            key: `${capability}:${requirement}`,
            message: `Capability '${capability}' mapping names unknown requirement '${requirement}'.`,
          });
          continue;
        }
        const selected = [...new Set(allocated)].filter(Boolean).sort(compareIds);
        requirementServices[requirement] = selected;
        for (const service of selected) {
          if (!services.includes(service)) {
            mappingIssues.push({
              code: "mapping.requirement-service-unknown",
              key: `${capability}:${requirement}`,
              message: `Requirement '${requirement}' is allocated to '${service}', which is not in capability '${capability}' services.`,
            });
          }
        }
      }
      // Only routed names get an empty slot in the skeleton: an unroutable name
      // offered for allocation is a decision that changes nothing.
      for (const requirement of routedNames) {
        if (ownValue(requirementServices, requirement) === undefined) requirementServices[requirement] = [];
      }
      if (services.length > 1) {
        for (const requirement of routedNames) {
          if ((ownValue(requirementServices, requirement) ?? []).length === 0) {
            mappingIssues.push({
              code: "mapping.requirement-allocation-missing",
              key: `${capability}:${requirement}`,
              message: `Split capability '${capability}' must allocate requirement '${requirement}' to at least one selected service.`,
            });
          }
        }
        for (const service of services) {
          if (!Object.values(requirementServices).some((selected) => selected.includes(service))) {
            mappingIssues.push({
              code: "mapping.service-allocation-empty",
              key: `${capability}:${service}`,
              message: `Split capability '${capability}' selects service '${service}' but allocates no requirement to it.`,
            });
          }
        }
      }
      return {
        capability,
        service: services.length === 1 ? services[0]! : null,
        services,
        requirementServices,
        suggestedService: capability.split("/").at(-1) ?? capability,
        hasLivingSpec: livingRequirements.has(capability),
        activeChanges: [...(activeChangesByCapability.get(capability) ?? [])].sort(compareIds),
        status: services.length === 0 ? "needsMapping" : "mapped",
      };
    });
    const decisionsByCapability = new Map(mappingDecisions.map((decision) => [decision.capability, decision]));
    const servicesForRequirement = (capability: string, requirement: string): string[] => {
      const decision = decisionsByCapability.get(capability);
      if (decision === undefined) return [];
      return decision.services.length === 1
        ? decision.services
        : ownValue(decision.requirementServices, requirement) ?? [];
    };
    const livingByService = new Map<string, Array<{ capability: string; requirement: ReturnType<typeof parseRequirements>[number] }>>();
    for (const [capability, requirements] of livingRequirements) {
      for (const requirement of requirements) {
        for (const service of servicesForRequirement(capability, requirement.name)) {
          const routed = livingByService.get(service) ?? [];
          routed.push({ capability, requirement });
          livingByService.set(service, routed);
        }
      }
    }

    const activeChangeIds = new Set(active.map((change) => change.id));
    for (const change of Object.keys(mapping.changes)) {
      if (!activeChangeIds.has(change)) {
        mappingIssues.push({
          code: "mapping.unknown-change",
          key: change,
          message: `Mapping names unknown active change '${change}'.`,
        });
      }
    }
    const changeDecisions: OpenSpecChangeDecision[] = active.map((change, index) => {
      const suggestedTitle = titleFromChangeId(change.id);
      const selected = ownValue(mapping.changes, change.id);
      const feature = selected?.feature ?? null;
      const title = selected?.title?.trim() ?? suggestedTitle;
      if (selected !== undefined && title === "") {
        mappingIssues.push({
          code: "mapping.change-title-missing",
          key: change.id,
          message: `Active change '${change.id}' needs a non-empty title.`,
        });
      }
      if (feature !== null && !isFeatureId(feature)) {
        mappingIssues.push({
          code: "mapping.feature-id-invalid",
          key: change.id,
          message: `Active change '${change.id}' maps to invalid loam feature id '${feature}'. ${FEATURE_ID_RULE}`,
        });
      }
      return {
        change: change.id,
        feature,
        title,
        suggestedFeature: `FEAT-${index + 1}`,
        suggestedTitle,
        status: feature === null || title === "" ? "needsFeature" : "mapped",
      };
    });
    const featureOwners = new Map<string, string[]>();
    for (const decision of changeDecisions) {
      if (decision.feature === null || !isFeatureId(decision.feature)) continue;
      const key = decision.feature.toLowerCase();
      const owners = featureOwners.get(key) ?? [];
      owners.push(decision.change);
      featureOwners.set(key, owners);
    }
    for (const [feature, owners] of featureOwners) {
      if (owners.length > 1) {
        mappingIssues.push({
          code: "mapping.feature-id-duplicate",
          key: feature,
          message: `Loam feature id '${feature}' is assigned to multiple OpenSpec changes: ${owners.join(", ")}.`,
        });
      }
    }
  return {
    mappingIssues,
    mappingDecisions,
    changeDecisions,
    routing: { servicesForRequirement, livingByService },
  };
}
