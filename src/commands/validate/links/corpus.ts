/**
 * The link corpus: which documents `link.unresolved` is asked about, and where
 * the answer is filed.
 *
 * The RULE lives in `core/links/` — extract the links, resolve them, name the
 * ones that point at nothing. This module is the ORDER, the same division
 * `./service/service.ts` states about the axes it composes: a check that walks
 * a fleet needs enumerations, and enumerations are what the command layer
 * already holds.
 *
 * THE CORPUS IS EVERY AUTHORED MARKDOWN DOCUMENT, and the word doing the work
 * is authored. `AGENTS.md` and the scaffolded `README.md` are excluded because
 * loam WRITES them: a finding against generated prose names a defect its reader
 * cannot fix by editing, since the next `loam init` would restore it. Their
 * links are loam's problem, held by `test/docs-facts.test.ts` and
 * `test/package-docs.test.ts` on this side of the boundary.
 *
 * ADRs AND RUNBOOKS ARE IN IT, and they are the reason the convention was
 * written down: an ADR that supersedes another says which, by linking to it.
 * They are also the first documents loam reads that it previously only counted,
 * which is why `link.unreadable` exists — see `documentFindings` below.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { pathCaseIndex } from "../../../core/links/case.js";
import { unresolvedLinkFindings, type LinkScope } from "../../../core/links/findings.js";
import { decodeDocument } from "../../../core/kernel/document-bytes.js";
import { featureCapabilityDeltas } from "../../../core/capabilities/delta/tree.js";
import { readCapabilityTree } from "../../../core/capabilities/tree.js";
import {
  capabilityDocsDir,
  featurePaths,
  featureSpecPaths,
  fleetAdrsDir,
  type ServicePaths,
} from "../../../core/repo/paths.js";
import { featureSpecServices } from "../../../core/repo/repo.js";
import { markdownFiles } from "../../../core/repo/tree/fs.js";
import { repoPath } from "../../../core/envelope/json.js";
import { FleetContext } from "../../../core/fleet-context.js";
import { type Finding } from "../../../core/vocabulary/report.js";
import type { DocsDir, FeatureDir } from "../../../core/kernel/ids/dirs.js";

/** Where the findings are filed, and how the documents are read. */
export interface LinkCheck {
  docsDir: DocsDir;
  /** The service or feature the report is about; absent at fleet scope. */
  subject?: string;
  fleet?: FleetContext;
}

/**
 * One service's authored documents: the two requirement specs, the runbook, and
 * every ADR. The specs cost nothing extra — `FleetContext` has already read
 * both to parse their requirements, and the memo hands back the same text.
 */
export async function serviceLinkFindings(check: LinkCheck, paths: ServicePaths): Promise<Finding[]> {
  return documentFindings(
    [paths.spec, paths.archSpec, paths.runbook, ...(await markdownFiles(paths.adrsDir))],
    check,
  );
}

/**
 * One feature's authored documents: the intent, each addressed service's two
 * spec deltas, every ADR, and each capability delta document.
 *
 * `delta.likec4` is absent from the list on purpose — it is not markdown, and
 * the one thing in it that addresses another file (`metadata { op }`) has its
 * own resolution and its own findings.
 */
export async function featureLinkFindings(check: LinkCheck, featureDir: FeatureDir): Promise<Finding[]> {
  const paths = featurePaths(featureDir);
  const docs = [paths.intent, ...(await markdownFiles(paths.adrsDir))];
  for (const svc of await featureSpecServices(featureDir, check.fleet)) {
    const spec = featureSpecPaths(featureDir, svc);
    docs.push(spec.spec, spec.archSpec);
  }
  const capabilities =
    check.fleet === undefined
      ? await featureCapabilityDeltas(featureDir)
      : await check.fleet.featureCapabilityDeltas(featureDir);
  docs.push(...capabilities.docs.map((d) => d.spec));
  return documentFindings(docs, check);
}

/**
 * The documents that belong to no service and no feature: the fleet's own
 * decision records and the living capability tree.
 *
 * Fleet scope, so `validate --all` reports these once. A single-target run says
 * nothing about them — the same rule `permissions.unenforced` and
 * `capability.invalid` follow, and for the same reason: a finding about the
 * fleet repeated on every service target is the report.
 */
export async function fleetLinkFindings(check: LinkCheck): Promise<Finding[]> {
  const capabilities =
    check.fleet === undefined
      ? await readCapabilityTree(capabilityDocsDir(check.docsDir))
      : (await check.fleet.capabilities(check.docsDir)).tree;
  return documentFindings(
    [...(await markdownFiles(fleetAdrsDir(check.docsDir))), ...capabilities.docs.map((d) => d.spec)],
    check,
  );
}

/**
 * Grade a list of documents, skipping the ones that are not there.
 *
 * ABSENCE IS NOT THIS CHECK'S BUSINESS: `service.no-spec` already names a
 * missing `spec.md`, and most services have no runbook and no ADRs at all.
 *
 * AN UNREADABLE DOCUMENT IS NAMED HERE RATHER THAN THROWN, and that is what
 * `link.unreadable` is for. Every other reader of a service's documents is
 * wrapped by `report.ts`'s `guarded`, which turns an IO failure into
 * `service.unreadable` — "nothing about this service was checked". That verdict
 * is right for `spec.md` and wrong for an ADR: this check is the first to read
 * those files at all, and a runbook saved as UTF-16 must not be able to blank
 * a service's entire report when the only thing that could not be graded is one
 * document's links.
 */
async function documentFindings(paths: string[], check: LinkCheck): Promise<Finding[]> {
  const findings: Finding[] = [];
  // One directory-listing memo for this target's whole corpus. Built here
  // rather than per document because a service's ADRs all resolve through the
  // same two or three directories, and rather than at module scope because a
  // listing that outlived the command would answer for a tree that has moved.
  const scope: LinkScope = { ...check, cases: pathCaseIndex() };
  for (const path of paths) {
    if (!existsSync(path)) continue;
    let text: string;
    try {
      text =
        check.fleet === undefined ? decodeDocument(await readFile(path), path) : await check.fleet.readText(path);
    } catch (err) {
      findings.push({
        severity: "error",
        code: "link.unreadable",
        ...(check.subject === undefined ? {} : { subject: check.subject }),
        message:
          `${repoPath(check.docsDir, path)} could not be read, so its links were not checked — ` +
          `${err instanceof Error ? err.message : String(err)}`,
      });
      continue;
    }
    findings.push(...unresolvedLinkFindings({ path, text }, scope));
  }
  return findings;
}
