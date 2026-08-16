/**
 * Is this migration ready, and what does the answer look like?
 *
 * Readiness is one judgement over everything the scan and the decisions found,
 * and it lives in one function so the six conditions can be read together. Five
 * of them are human decisions and the sixth is the corpus itself; a migration
 * that satisfied five of six used to read as "nearly ready", which is not a
 * state `--apply` may act on.
 *
 * The per-axis `readiness` block exists so an agent can say WHICH of the six is
 * open without re-deriving it from the issue list — the same information, but
 * the derivation is here rather than in every reader.
 */
import { compareIds } from "../../repo/entries.js";
import {
  type OpenSpecMapping,
  type CapabilityMappingDecision,
  type OpenSpecChangeDecision,
  type OpenSpecMappingIssue,
} from "../model/mapping.js";
import {
  OPENSPEC_BASELINES,
  type OpenSpecArtifact,
  type OpenSpecArtifactDecision,
  type OpenSpecCapability,
  type OpenSpecChange,
  type OpenSpecCounts,
  type OpenSpecInventory,
  type OpenSpecRenamedUsage,
  type OpenSpecUnsupportedShape,
} from "../model/model.js";
import { sortIssues } from "../scan/changes.js";

/** Everything a finished read produced, before it is graded into a verdict. */
export interface Findings {
  located: { inputRoot: string; root: string; kind: OpenSpecInventory["workspace"]["kind"] };
  mapping: OpenSpecMapping;
  inventoryDigest: string;
  config: OpenSpecInventory["workspace"]["config"];
  storeMetadataPath: string | null;
  livingCounts: OpenSpecCounts;
  capabilities: OpenSpecCapability[];
  active: OpenSpecChange[];
  archived: OpenSpecChange[];
  renamed: OpenSpecRenamedUsage[];
  blockers: OpenSpecUnsupportedShape[];
  archiveDiagnostics: OpenSpecUnsupportedShape[];
  artifacts: OpenSpecArtifact[];
  mappingDecisions: CapabilityMappingDecision[];
  changeDecisions: OpenSpecChangeDecision[];
  mappingIssues: OpenSpecMappingIssue[];
  artifactDecisions: OpenSpecArtifactDecision[];
}

export function inventoryVerdict(found: Findings): OpenSpecInventory {
  const {
    located, inventoryDigest, config, storeMetadataPath, livingCounts, capabilities,
    active, archived, renamed, blockers, archiveDiagnostics, artifacts,
    mappingDecisions, changeDecisions, mappingIssues, artifactDecisions,
  } = found;
  const { inputRoot, root } = located;
  mappingIssues.sort((a, b) => compareIds(a.key, b.key) || compareIds(a.code, b.code));

  renamed.sort((a, b) => compareIds(a.path, b.path) || a.line - b.line || compareIds(a.key, b.key));
  sortIssues(blockers);
  sortIssues(archiveDiagnostics);
  const livingIssueCount = blockers.filter((item) => item.scope === "workspace" || item.scope === "living").length;
  const activeIssueCount = blockers.filter((item) => item.scope === "active").length;
  const needsMapping = mappingDecisions.filter((decision) => decision.status === "needsMapping");
  const needsChangeMapping = changeDecisions.filter((decision) => decision.status === "needsFeature");
  const needsDisposition = artifactDecisions.filter((decision) => decision.status === "needsDisposition");
  const unresolvedActiveRenames = renamed.filter(
    (rename) => rename.scope === "active" && rename.status === "needsIdentity",
  );
  const mechanicallyCompatible = livingIssueCount === 0 && activeIssueCount === 0;
  const ready = mechanicallyCompatible
    && needsMapping.length === 0
    && needsChangeMapping.length === 0
    && unresolvedActiveRenames.length === 0
    && needsDisposition.length === 0
    && mappingIssues.length === 0;

  return {
    baselines: OPENSPEC_BASELINES,
    inputRoot,
    root,
    inventoryDigest,
    workspace: {
      kind: located.kind,
      config,
      storeMetadataPath,
    },
    ready,
    mechanicallyCompatible,
    readiness: {
      living: { compatible: livingIssueCount === 0, issueCount: livingIssueCount },
      active: { compatible: activeIssueCount === 0, issueCount: activeIssueCount },
      sourceCurrent: !mappingIssues.some((item) => item.code.startsWith("mapping.source-")),
      mappingsResolved: needsMapping.length === 0 && !mappingIssues.some((item) =>
        item.code === "mapping.unknown-capability"
        || item.code === "mapping.unknown-requirement"
        || item.code.startsWith("mapping.requirement-")
        || item.code === "mapping.service-allocation-empty"),
      changesResolved: needsChangeMapping.length === 0 && !mappingIssues.some((item) =>
        item.code === "mapping.unknown-change"
        || item.code === "mapping.change-title-missing"
        || item.code.startsWith("mapping.feature-id-")),
      renamesResolved: unresolvedActiveRenames.length === 0 && !mappingIssues.some((item) => item.code.includes("rename") || item.code.includes("requirement-id")),
      dispositionsResolved: needsDisposition.length === 0 && !mappingIssues.some((item) => item.code.includes("artifact")),
      migrationReady: ready,
    },
    living: { ...livingCounts, capabilities },
    changes: {
      active,
      archived,
      counts: { active: active.length, archived: archived.length },
    },
    renamed,
    unsupported: blockers,
    archiveDiagnostics,
    mappingDecisions,
    needsMapping,
    changeDecisions,
    needsChangeMapping,
    mappingIssues,
    artifacts,
    artifactDecisions,
    needsDisposition,
  };
}
