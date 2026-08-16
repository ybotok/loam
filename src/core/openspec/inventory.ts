/**
 * One whole OpenSpec workspace, read and graded in one pass.
 *
 * The order below is the contract: everything is SCANNED before anything is
 * DECIDED, because a decision graded against a half-read corpus is worse than
 * no decision — it reads as reviewed. So this module locates the root, walks
 * it, reads every document through `./scan/`, and only then hands the result to
 * `./decide/`, which is the half a human's mapping can change.
 *
 * The digest is taken over the non-archive artifacts only. It binds a mapping
 * to the truth it was reviewed against, and frozen archive history is neither
 * migrated nor allowed to block readiness — covering it meant a colleague's typo
 * fix under `changes/archive/` killed a completed mapping, with no `--force` and
 * no indication of which file had moved.
 */
import { isUtf8 } from "node:buffer";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { compareIds } from "../repo/entries.js";
import { parseRequirements } from "../document/parse.js";
import { emptyMapping, type OpenSpecMapping } from "./model/mapping.js";
import { type OpenSpecInventory, type OpenSpecRenamedUsage, type OpenSpecUnsupportedShape } from "./model/model.js";
import { locateOpenSpecRoot, type Ingest } from "./scan/workspace.js";
import {
  digestInventory,
  hiddenSubdirs,
  isSymbolicLink,
  portable,
  sourceInventoryPath,
  subdirs,
  walkFiles,
  walkSymlinks,
} from "./scan/walk.js";
import { inspectSpecFile, issue } from "./scan/shape.js";
import { inspectConfig } from "./scan/config.js";
import { artifactFor, artifactScope, inventoryChanges } from "./scan/changes.js";
import { capabilityDecisions } from "./decide/capabilities.js";
import { resolveRenames } from "./decide/renames.js";
import { artifactDispositions } from "./decide/dispositions.js";
import { inventoryVerdict } from "./decide/verdict.js";
import { isDirectory } from "./scan/walk.js";
import { addCounts } from "./scan/shape.js";
import { type OpenSpecCapability, type OpenSpecCounts } from "./model/model.js";

export async function inventoryOpenSpec(
  input: string,
  options: { mapping?: OpenSpecMapping } = {},
): Promise<OpenSpecInventory> {
  const located = await locateOpenSpecRoot(input);
  const { inputRoot, root } = located;
  const mapping = emptyMapping(options.mapping);
  const renamed: OpenSpecRenamedUsage[] = [];
  const blockers: OpenSpecUnsupportedShape[] = [];
  // The read in progress. Every reader below appends to these two lists rather
  // than returning findings, because the ORDER they land in is what the `--json`
  // contract pins — five arrays merged afterwards would be a different report.
  const ingest: Ingest = { root, mapping, renamed, unsupported: blockers };
  const archiveDiagnostics: OpenSpecUnsupportedShape[] = [];
  for (const absolute of await walkSymlinks(root)) {
    const path = portable(root, absolute);
    const scope = artifactScope(path);
    issue(scope === "archive" ? archiveDiagnostics : blockers, scope, {
      code: "openspec.symlink-unsupported",
      path: path,
      message: "Symbolic links are not followed by migration inventory; replace this link with an in-tree regular file or directory.",
    });
  }
  const config = await inspectConfig(root, blockers);
  const specsRoot = join(root, "specs");
  const changesRoot = join(root, "changes");
  const inputStoreMetadata = join(inputRoot, ".openspec-store", "store.yaml");
  const parentStoreMetadata = basename(root) === "openspec"
    ? join(dirname(root), ".openspec-store", "store.yaml")
    : inputStoreMetadata;
  const storeMetadata = existsSync(inputStoreMetadata) ? inputStoreMetadata : parentStoreMetadata;
  const storeMetadataExists = existsSync(storeMetadata);
  const storeMetadataSymlink = storeMetadataExists && await isSymbolicLink(storeMetadata);
  if (storeMetadataSymlink) {
    issue(blockers, "workspace", {
      code: "openspec.symlink-unsupported",
      path: sourceInventoryPath(root, storeMetadata),
      message: "Symbolic Store metadata is not followed; replace it with an in-tree regular file.",
    });
  }
  const hasModernEmptyShape = config !== null || (storeMetadataExists && !storeMetadataSymlink);
  if (!await isDirectory(specsRoot) && !hasModernEmptyShape) {
    issue(blockers, "living", {
      code: "openspec.specs-missing",
      path: "specs",
      message: "Living specs/ directory is missing.",
    });
  }
  if (config !== null && config.store !== null && !await isDirectory(specsRoot) && !await isDirectory(changesRoot)) {
    issue(blockers, "workspace", {
      code: "openspec.external-store-pointer",
      path: "config.yaml",
      message: `Planning is externalized to Store '${config.store}'; audit that registered Store checkout directly.`,
    });
  }

  const capabilities: OpenSpecCapability[] = [];
  const livingRequirements = new Map<string, ReturnType<typeof parseRequirements>>();
  const livingCounts: OpenSpecCounts = { specFiles: 0, requirements: 0, scenarios: 0 };
  const livingTree = await walkFiles(specsRoot);
  const livingFiles = livingTree.filter((path) => basename(path) === "spec.md");
  // The living twin of openspec.nonstandard-change-spec. Selecting living specs
  // by exact basename is right, but without the mirror a mis-cased or renamed
  // file simply disappears: specs/payments/Spec.md audited as a clean, empty
  // corpus while the identical shape under a change was reported.
  for (const file of livingTree.filter((path) =>
    /\.md$/i.test(path) && basename(path) !== "spec.md" && basename(path) !== "design.md")) {
    blockers.push({
      code: "openspec.nonstandard-living-spec",
      path: portable(root, file),
      message: "Markdown under specs/ is named neither spec.md nor design.md, so no capability reads it.",
      scope: "living",
    });
  }
  for (const specFile of livingFiles) {
    const id = portable(specsRoot, dirname(specFile));
    const inspected = await inspectSpecFile(ingest, specFile, "living", null);
    livingRequirements.set(id, inspected.requirements);
    const capability = { id, files: [inspected.path], ...inspected.counts };
    capabilities.push(capability);
    addCounts(livingCounts, inspected.counts);
  }
  capabilities.sort((a, b) => compareIds(a.id, b.id));

  const activeIds = (await subdirs(changesRoot)).filter((id) => id !== "archive");
  const archiveRoot = join(changesRoot, "archive");
  const archivedIds = await subdirs(archiveRoot);
  for (const id of await hiddenSubdirs(changesRoot)) {
    blockers.push({
      code: "openspec.hidden-change-directory",
      path: portable(root, join(changesRoot, id)),
      message: "A dot-prefixed change directory is not enumerated as a change, so nothing under it is migrated; rename it or move it out of changes/.",
      scope: "active",
    });
  }
  for (const id of await hiddenSubdirs(archiveRoot)) {
    archiveDiagnostics.push({
      code: "openspec.hidden-change-directory",
      path: portable(root, join(archiveRoot, id)),
      message: "A dot-prefixed archive directory is not enumerated as a change; frozen history is retained read-only where it is.",
      scope: "archive",
    });
  }
  const fallbackSchema = config?.schema ?? "spec-driven";
  const active = await inventoryChanges(ingest, {
    base: changesRoot,
    ids: activeIds,
    scope: "active",
    fallbackSchema,
    findings: blockers,
  });
  const archived = await inventoryChanges(ingest, {
    base: archiveRoot,
    ids: archivedIds,
    scope: "archive",
    fallbackSchema,
    findings: archiveDiagnostics,
  });

  // Last-resort backstop under the whole "audited past the corpus" family, and
  // the one check that does not depend on root selection being right: an
  // inventory that read no living spec AND no active change describes nothing,
  // so no verdict over it can be `ready`. That is exactly the shape the Store
  // misdetection produced — ready, mechanically compatible, zero capabilities,
  // zero unsupported shapes — where the failure verdict was more confident than
  // any success verdict. A greenfield workspace whose only requirements live
  // under changes/ has an active change and is not caught here.
  if (livingCounts.specFiles === 0 && active.length === 0) {
    blockers.push({
      code: "openspec.workspace-empty",
      path: ".",
      message: `Planning root ${root} holds no living spec and no active change; there is nothing to migrate, so confirm this is the directory that really holds the corpus.`,
      scope: "workspace",
    });
  }

  const artifactFiles = await walkFiles(root);
  if (storeMetadataExists && !storeMetadataSymlink && !artifactFiles.includes(storeMetadata)) {
    artifactFiles.push(storeMetadata);
  }
  for (const absolute of artifactFiles) {
    const bytes = await readFile(absolute);
    if (isUtf8(bytes)) continue;
    const rootPath = portable(root, absolute);
    const artifactPath = sourceInventoryPath(root, absolute);
    const scope = absolute === storeMetadata ? "workspace" : artifactScope(rootPath);
    issue(scope === "archive" ? archiveDiagnostics : blockers, scope, {
      code: "openspec.non-utf8-artifact",
      path: artifactPath,
      message: "Migration can preserve only valid UTF-8 authored artifacts; convert this file to UTF-8 before apply.",
    });
  }
  // The digest binds a mapping to the truth it was reviewed against, and frozen
  // archive history is neither migrated nor allowed to block readiness. Covering
  // it meant a colleague's typo fix under changes/archive/ killed a completed
  // mapping, with no --force and no indication of which file moved.
  const inventoryDigest = await digestInventory(
    root,
    artifactFiles.filter((absolute) => artifactScope(portable(root, absolute)) !== "archive"),
  );
  const artifacts = artifactFiles
    .map((path) => artifactFor(root, path))
    .sort((a, b) => compareIds(a.path, b.path));

  const { mappingIssues, mappingDecisions, changeDecisions, routing } = capabilityDecisions({
    root,
    mapping,
    // An audit grades no source binding: there is no mapping to bind yet.
    bound: options.mapping !== undefined,
    inventoryDigest,
    livingRequirements,
    active,
    renamed,
  });
  resolveRenames(
    { root, mapping, bound: options.mapping !== undefined, inventoryDigest, livingRequirements, active, renamed },
    routing,
    mappingIssues,
  );
  const artifactDecisions = artifactDispositions(
    artifacts,
    mapping,
    new Set(active.map((change) => change.id)),
    mappingIssues,
  );

  return inventoryVerdict({
    located,
    mapping,
    inventoryDigest,
    config,
    storeMetadataPath: storeMetadataExists ? sourceInventoryPath(root, storeMetadata) : null,
    livingCounts,
    capabilities,
    active,
    archived,
    renamed,
    blockers,
    archiveDiagnostics,
    artifacts,
    mappingDecisions,
    changeDecisions,
    mappingIssues,
    artifactDecisions,
  });
}
