/**
 * The human decisions an audit asks for, and the blank form it hands over.
 *
 * Separate from `./model.ts` because these are the only shapes a PERSON edits.
 * The skeleton is generated from a finished inventory rather than from the
 * workspace, so every slot in it is a decision the audit actually reached — a
 * form with a field nothing grades is a form somebody fills in for nothing.
 */
import { dictionary } from "../../kernel/records.js";
import { type OpenSpecInventory } from "./model.js";
import { type OpenSpecArtifactDisposition } from "./model.js";

export interface CapabilityMappingDecision {
  capability: string;
  /** Backward-compatible convenience for consumers that only understand one owner. */
  service: string | null;
  /** One capability may need to be split across multiple loam services. */
  services: string[];
  /** Required only when a capability is split across more than one service. */
  requirementServices: Record<string, string[]>;
  suggestedService: string;
  hasLivingSpec: boolean;
  activeChanges: string[];
  status: "needsMapping" | "mapped";
}

export interface OpenSpecCapabilityMapping {
  services: string[];
  requirementServices: Record<string, string[]>;
}

export interface OpenSpecChangeMapping {
  feature: string | null;
  title: string;
}

export interface OpenSpecChangeDecision {
  change: string;
  feature: string | null;
  title: string;
  suggestedFeature: string;
  suggestedTitle: string;
  status: "needsFeature" | "mapped";
}

export interface OpenSpecMapping {
  source: { root: string; inventoryDigest: string } | null;
  capabilities: Record<string, OpenSpecCapabilityMapping>;
  changes: Record<string, OpenSpecChangeMapping>;
  renames: Record<string, string>;
  /**
   * Whatever a human wrote, not what the type wishes they had written. Declaring
   * this as the disposition union meant the parser had to assert its way into
   * it, so an unrecognised disposition arrived typed as a valid one and only
   * `mapping.invalid-artifact-disposition` — a check downstream of the parse —
   * stood between it and code comparing it against a literal. The union is
   * recovered where it is needed, through `isOpenSpecArtifactDisposition`.
   */
  artifacts: Record<string, string>;
}

export interface OpenSpecMappingIssue {
  code:
    | "mapping.source-missing"
    | "mapping.source-root-mismatch"
    | "mapping.source-digest-mismatch"
    | "mapping.unknown-capability"
    | "mapping.unknown-requirement"
    | "mapping.requirement-allocation-missing"
    | "mapping.requirement-service-unknown"
    | "mapping.service-allocation-empty"
    | "mapping.unknown-change"
    | "mapping.change-title-missing"
    | "mapping.feature-id-invalid"
    | "mapping.feature-id-duplicate"
    | "mapping.unknown-rename"
    | "mapping.invalid-requirement-id"
    | "mapping.rename-source-missing"
    | "mapping.rename-source-ambiguous"
    | "mapping.rename-source-id-invalid"
    | "mapping.rename-target-conflict"
    | "mapping.rename-existing-id-conflict"
    | "mapping.rename-id-conflict"
    | "mapping.rename-double-source"
    | "mapping.rename-double-target"
    | "mapping.rename-chain"
    | "mapping.unknown-artifact"
    | "mapping.invalid-artifact-disposition";
  key: string;
  message: string;
}

export interface OpenSpecMappingSkeleton {
  version: 1;
  source: { root: string; inventoryDigest: string };
  capabilities: Record<string, {
    services: string[];
    suggestedServices: string[];
    requirementServices: Record<string, string[]>;
  }>;
  changes: Record<string, {
    feature: null;
    suggestedFeature: string;
    title: string;
  }>;
  renames: Record<string, {
    from: string | null;
    to: string | null;
    existingRequirementId: string | null;
    requirementId: string | null;
  }>;
  artifacts: Record<string, {
    kind: "proposal" | "tasks" | "change-design";
    disposition: null;
    suggestedDisposition: OpenSpecArtifactDisposition;
  }>;
}

export function emptyMapping(mapping?: OpenSpecMapping): OpenSpecMapping {
  if (mapping === undefined) {
    return {
      source: null,
      capabilities: dictionary(),
      changes: dictionary(),
      renames: dictionary(),
      artifacts: dictionary(),
    };
  }
  // Keep the core inventory tolerant of programmatic v0 callers while the CLI
  // parser enforces the complete v1 document, including explicit `changes`.
  return {
    source: mapping.source ?? null,
    capabilities: mapping.capabilities ?? dictionary(),
    changes: mapping.changes ?? dictionary(),
    renames: mapping.renames ?? dictionary(),
    artifacts: mapping.artifacts ?? dictionary(),
  };
}

export function createOpenSpecMappingSkeleton(inventory: OpenSpecInventory): OpenSpecMappingSkeleton {
  return {
    version: 1,
    source: { root: inventory.root, inventoryDigest: inventory.inventoryDigest },
    capabilities: Object.fromEntries(inventory.mappingDecisions.map((decision) => [
      decision.capability,
      {
        services: decision.services,
        suggestedServices: [decision.suggestedService],
        requirementServices: decision.requirementServices,
      },
    ])),
    changes: Object.fromEntries(inventory.changeDecisions.map((decision) => [
      decision.change,
      {
        feature: null,
        suggestedFeature: decision.suggestedFeature,
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
          // The identity the inventory settled on, which is the field the
          // skeleton is asking a human to fill in. `existingRequirementId` is
          // the living source's own id and happens to equal it on the only path
          // that reaches here today — but a caller that audits WITH a mapping
          // would have a settled id and no existing one, and the skeleton would
          // hand that decision back as unmade.
          requirementId: rename.requirementId,
        }]),
    ),
    artifacts: Object.fromEntries(inventory.artifactDecisions.map((decision) => [
      decision.path,
      {
        kind: decision.kind,
        disposition: null,
        suggestedDisposition: decision.suggestedDisposition,
      },
    ])),
  };
}
