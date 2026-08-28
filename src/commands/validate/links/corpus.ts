/**
 * Where each target's link findings are filed — the ORDER, not the rule.
 *
 * The rule lives in `core/links/`: extract the links, resolve them, name the
 * ones that point at nothing. WHICH documents belong to a service, a feature or
 * the fleet lives there too (`core/links/corpus.ts`), because the glossary's
 * backlink index reads the same list and a second enumeration would be free to
 * disagree with this one. What is left here is the part that belongs to
 * `validate`: reading each document, deciding which target carries the finding,
 * and refusing to let one unreadable file take a whole target down with it.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { pathCaseIndex } from "../../../core/links/case.js";
import { featureDocuments, fleetDocuments, serviceDocuments } from "../../../core/links/corpus.js";
import { unresolvedLinkFindings, type LinkScope } from "../../../core/links/findings.js";
import { decodeDocument } from "../../../core/kernel/document-bytes.js";
import { type ServicePaths } from "../../../core/repo/paths.js";
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

/** One service's documents, graded on the service target. */
export async function serviceLinkFindings(check: LinkCheck, paths: ServicePaths): Promise<Finding[]> {
  return documentFindings(await serviceDocuments(paths), check);
}

/** One feature's documents, graded on the feature target. */
export async function featureLinkFindings(check: LinkCheck, featureDir: FeatureDir): Promise<Finding[]> {
  return documentFindings(await featureDocuments(featureDir, check.fleet), check);
}

/**
 * The fleet's own documents — its ADRs, the living capability tree and the
 * glossary — graded once on the landscape target. A single-target run says
 * nothing about them, the rule `permissions.unenforced` already follows: a
 * finding about the fleet repeated on every service target is the report.
 */
export async function fleetLinkFindings(check: LinkCheck): Promise<Finding[]> {
  return documentFindings(await fleetDocuments(check.docsDir, check.fleet), check);
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
