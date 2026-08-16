/**
 * What an OpenSpec workspace IS, as loam models it.
 *
 * `core/openspec-inventory.ts` was the one foreign model in this codebase and
 * this package is still it: OpenSpec's vocabulary — capabilities, changes,
 * RENAMED pairs, `.openspec.yaml` — is named here and nowhere else, and nothing
 * outside `commands/migrate-openspec/` may import an `OpenSpec*` type. That
 * quarantine is the point of the package, not a side effect of its size.
 *
 * Types only, plus the one error the root search throws. Every module below
 * fills these in; none of them redefines one.
 */
import {
  type CapabilityMappingDecision,
  type OpenSpecChangeDecision,
  type OpenSpecMappingIssue,
} from "./mapping.js";

export const OPENSPEC_BASELINES = Object.freeze({
  release: Object.freeze({
    version: "1.7.0",
    ref: "v1.7.0",
    commit: "4e16790d90d8f54d4773ad9a5e71a57cd9f1e86b",
  }),
  mainCanary: Object.freeze({
    ref: "main",
    commit: "45cca5db6137ed209117cc70510eb3e057fb981b",
  }),
});

export interface OpenSpecCounts {
  specFiles: number;
  requirements: number;
  scenarios: number;
}

export interface OpenSpecCapability extends OpenSpecCounts {
  /** Nested capability ids retain their complete relative directory, e.g. payments/refunds. */
  id: string;
  files: string[];
}

export interface OpenSpecChangeMetadata {
  path: string | null;
  schema: string | null;
  skipSpecs: boolean;
  created: string | null;
  fields: string[];
}

export interface OpenSpecChangeSpec extends OpenSpecCounts {
  capability: string;
  path: string;
  requirementNames: string[];
}

export interface OpenSpecChange extends OpenSpecCounts {
  id: string;
  files: string[];
  specs: OpenSpecChangeSpec[];
  artifacts: string[];
  metadata: OpenSpecChangeMetadata;
}

export type OpenSpecIssueScope = "workspace" | "living" | "active" | "archive";

export interface OpenSpecRenamedUsage {
  /** Stable key used by the mapping file. */
  key: string;
  path: string;
  line: number;
  scope: "active" | "archive";
  changeId: string;
  capability: string;
  from: string | null;
  to: string | null;
  existingRequirementId: string | null;
  requirementId: string | null;
  status: "needsIdentity" | "mapped";
}

export interface OpenSpecUnsupportedShape {
  code: string;
  path: string;
  message: string;
  scope: OpenSpecIssueScope;
}

export type OpenSpecArtifactScope = "workspace" | "living" | "active" | "archive";
export type OpenSpecArtifactKind =
  | "config"
  | "store-metadata"
  | "project-context"
  | "agent-instructions"
  | "living-spec"
  | "living-design"
  | "change-metadata"
  | "proposal"
  | "tasks"
  | "change-design"
  | "delta-spec"
  | "custom-schema"
  | "schema-template"
  | "other";
/**
 * The dispositions as values, not only as a type, because a mapping file names
 * one as a plain string and the parse boundary has to be able to ask whether
 * that string is one of these. A hand-written second spelling of the same list
 * is how a disposition added here would go on being unrecognised where it is
 * read from somebody else's YAML.
 */
export const OPENSPEC_ARTIFACT_DISPOSITIONS = [
  "translate-project-context",
  "record-external-planning-root",
  "remove-after-cutover",
  "map-requirements",
  "review-as-service-adr",
  "translate-change-metadata",
  "convert-to-intent",
  "preserve-as-legacy-checklist",
  "review-as-feature-adr",
  "map-delta",
  "review-custom-workflow",
  "retain-read-only",
  "manual-review",
] as const;
export type OpenSpecArtifactDisposition = (typeof OPENSPEC_ARTIFACT_DISPOSITIONS)[number];

/** Whether an authored string names a disposition this codebase actually defines. */
export function isOpenSpecArtifactDisposition(value: string): value is OpenSpecArtifactDisposition {
  return (OPENSPEC_ARTIFACT_DISPOSITIONS as readonly string[]).includes(value);
}

export interface OpenSpecArtifact {
  /** Workspace-relative, so store metadata outside openspec/ remains representable. */
  path: string;
  scope: OpenSpecArtifactScope;
  kind: OpenSpecArtifactKind;
  disposition: OpenSpecArtifactDisposition;
  changeId?: string;
  capability?: string;
}

export interface OpenSpecArtifactDecision {
  path: string;
  kind: "proposal" | "tasks" | "change-design";
  suggestedDisposition: OpenSpecArtifactDisposition;
  /**
   * What the mapping selected, verbatim. This is the field the invalid-value
   * report is written from, so it has to be able to hold the invalid value —
   * narrowing it to the union would only mean asserting one back into it.
   */
  disposition: string | null;
  status: "needsDisposition" | "mapped";
}

export interface OpenSpecConfigSummary {
  path: string;
  schema: string | null;
  store: string | null;
  hasContext: boolean;
  ruleArtifacts: string[];
  references: string[];
}

export interface OpenSpecInventory {
  baselines: typeof OPENSPEC_BASELINES;
  inputRoot: string;
  root: string;
  /** SHA-256 over every inventoried OpenSpec source path and byte sequence. */
  inventoryDigest: string;
  workspace: {
    kind: "project" | "store" | "openspec-root";
    config: OpenSpecConfigSummary | null;
    storeMetadataPath: string | null;
  };
  ready: boolean;
  mechanicallyCompatible: boolean;
  readiness: {
    living: { compatible: boolean; issueCount: number };
    active: { compatible: boolean; issueCount: number };
    sourceCurrent: boolean;
    mappingsResolved: boolean;
    changesResolved: boolean;
    renamesResolved: boolean;
    dispositionsResolved: boolean;
    migrationReady: boolean;
  };
  living: OpenSpecCounts & { capabilities: OpenSpecCapability[] };
  changes: {
    active: OpenSpecChange[];
    archived: OpenSpecChange[];
    counts: { active: number; archived: number };
  };
  renamed: OpenSpecRenamedUsage[];
  /** Living/active blockers only. Frozen archive history never blocks migration readiness. */
  unsupported: OpenSpecUnsupportedShape[];
  /** Historical anomalies are retained for review, but are not migration blockers. */
  archiveDiagnostics: OpenSpecUnsupportedShape[];
  mappingDecisions: CapabilityMappingDecision[];
  needsMapping: CapabilityMappingDecision[];
  changeDecisions: OpenSpecChangeDecision[];
  needsChangeMapping: OpenSpecChangeDecision[];
  mappingIssues: OpenSpecMappingIssue[];
  artifacts: OpenSpecArtifact[];
  artifactDecisions: OpenSpecArtifactDecision[];
  needsDisposition: OpenSpecArtifactDecision[];
}

export class OpenSpecRootError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpenSpecRootError";
  }
}
