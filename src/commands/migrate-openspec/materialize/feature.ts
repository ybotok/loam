/**
 * The shapes a staged feature is written in: its directory slug, its
 * frontmatter, the delta spec body, and the bundle an authored OpenSpec
 * artifact is copied into.
 *
 * All four are used by `./active.js` alone, and they are here rather than
 * inside it because they are the part a reviewer compares against the migrated
 * repository by eye. What routes a requirement to a service is a decision;
 * these are the file formats that decision comes out as, and the two answer to
 * different questions when a migration reads wrong.
 */
import { stringify as stringifyYaml } from "yaml";
import { serializeRequirements } from "../../../core/document/spec.js";
import { type Requirement } from "../../../core/document/spec.js";
import { type OpenSpecArtifactDisposition } from "../../../core/openspec/model/model.js";

export function featureSlug(title: string, changeId: string): string {
  const slug = (text: string): string => text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug(title) || slug(changeId) || "openspec-change";
}

export function serializeDeltaRequirements(requirements: Requirement[]): string {
  const sections: string[] = [];
  for (const kind of ["ADDED", "MODIFIED", "REMOVED"] as const) {
    const group = requirements.filter((requirement) => requirement.kind === kind);
    if (group.length > 0) sections.push(`## ${kind} Requirements\n\n${serializeRequirements(group).trimEnd()}`);
  }
  return `${sections.join("\n\n")}\n`;
}

export function migrationFrontmatter(feature: string, title: string): string {
  return `---\n${stringifyYaml({ feature, title, status: "proposed" }, { lineWidth: 0 }).trimEnd()}\n---`;
}

export interface AuthoredArtifactCopy {
  path: string;
  disposition: OpenSpecArtifactDisposition;
  raw: string;
}

export function renderAuthoredBundle(heading: string, artifacts: AuthoredArtifactCopy[]): string {
  return `${heading}\n\n${artifacts.map((artifact) => [
    `<!-- OpenSpec source: ${artifact.path}; disposition: ${artifact.disposition}. -->`,
    artifact.raw.trimEnd(),
  ].join("\n\n")).join("\n\n---\n\n")}\n`;
}
