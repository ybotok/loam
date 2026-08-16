/**
 * Is this document a shape loam can migrate?
 *
 * The living side and the change side are graded separately because they fail
 * differently: a living spec that will not parse is a corpus loam cannot read,
 * while a change spec carries RENAMED pairs, which are the one OpenSpec
 * construct with no loam equivalent and the reason this package has an identity
 * problem to solve at all.
 *
 * Nothing here decides anything — it appends findings to the `Ingest` it was
 * given. The decisions are in `../decide/`.
 */
import { readFile } from "node:fs/promises";
import { ownValue } from "../../kernel/records.js";
import { isRequirementsHeading, parseRequirements, sectionHeadings } from "../../document/parse.js";
import { requirementIdProblems } from "../../document/spec.js";
import { type Ingest } from "./workspace.js";
import { portable } from "./walk.js";
import {
  type OpenSpecCounts,
  type OpenSpecRenamedUsage,
  type OpenSpecUnsupportedShape,
  type OpenSpecIssueScope,
} from "../model/model.js";

export function countsFor(requirements: ReturnType<typeof parseRequirements>): Omit<OpenSpecCounts, "specFiles"> {
  return {
    requirements: requirements.length,
    scenarios: requirements.reduce((sum, requirement) => sum + requirement.scenarios.length, 0),
  };
}

export function addCounts(target: OpenSpecCounts, source: OpenSpecCounts): void {
  target.specFiles += source.specFiles;
  target.requirements += source.requirements;
  target.scenarios += source.scenarios;
}

export function cleanRenameName(value: string): string {
  return value
    .trim()
    .replace(/^`|`$/g, "")
    .replace(/^###\s+Requirement:\s*/i, "")
    .trim();
}

export function changeSpecCoordinates(
  path: string,
  scope: "active" | "archive",
): { changeId: string; capability: string } {
  const prefix = scope === "active" ? /^changes\/([^/]+)\/specs\/(.+)\/spec\.md$/ : /^changes\/archive\/([^/]+)\/specs\/(.+)\/spec\.md$/;
  const match = prefix.exec(path);
  return { changeId: match?.[1] ?? "", capability: match?.[2] ?? "" };
}

/**
 * Which lines are fenced content, marker included \u2014 the same rule
 * `parseRequirements` and `sectionHeadings` apply, which spec.ts keeps private.
 * Without it a FROM/TO line inside a fenced example of the rename syntax became
 * a phantom pair, and the only cure was editing the OpenSpec source migration
 * promises never to touch.
 */
export function fencedLines(lines: string[]): boolean[] {
  let fence: string | null = null;
  return lines.map((line) => {
    const marker = /^\s*(```|~~~)/.exec(line);
    if (marker === null) return fence !== null;
    if (fence === null) fence = marker[1]!;
    else if (fence === marker[1]!) fence = null;
    return true;
  });
}

export function renameUsages(
  path: string,
  raw: string,
  scope: "active" | "archive",
  mapped: Record<string, string>,
): OpenSpecRenamedUsage[] {
  const lines = raw.replace(/^\uFEFF/, "").split(/\r?\n/);
  const fenced = fencedLines(lines);
  const headings = sectionHeadings(raw);
  const coordinates = changeSpecCoordinates(path, scope);
  const output: OpenSpecRenamedUsage[] = [];
  for (const [headingIndex, heading] of headings.entries()) {
    if (!/^##\s+RENAMED\s+Requirements?\s*:?\s*$/i.test(heading.text)) continue;
    const end = headings[headingIndex + 1]?.line ?? lines.length + 1;
    const pairs: Array<{ from: string | null; to: string | null }> = [];
    let pendingFrom: string | null = null;
    for (let line = heading.line; line < end - 1; line += 1) {
      if (fenced[line] === true) continue;
      const text = lines[line] ?? "";
      const from = /^\s*-\s*FROM:\s*(.*?)\s*$/i.exec(text);
      if (from !== null) {
        if (pendingFrom !== null) pairs.push({ from: pendingFrom, to: null });
        pendingFrom = cleanRenameName(from[1] ?? "");
        continue;
      }
      const to = /^\s*-\s*TO:\s*(.*?)\s*$/i.exec(text);
      if (to !== null) {
        pairs.push({ from: pendingFrom, to: cleanRenameName(to[1] ?? "") });
        pendingFrom = null;
      }
    }
    if (pendingFrom !== null) pairs.push({ from: pendingFrom, to: null });
    if (pairs.length === 0) pairs.push({ from: null, to: null });
    pairs.forEach((pair, pairIndex) => {
      const key = `${path}:${heading.line}:${pairIndex + 1}`;
      const requirementId = ownValue(mapped, key) ?? null;
      output.push({
        key,
        path,
        line: heading.line,
        scope,
        changeId: coordinates.changeId,
        capability: coordinates.capability,
        from: pair.from,
        to: pair.to,
        existingRequirementId: null,
        requirementId,
        status: requirementId === null ? "needsIdentity" : "mapped",
      });
    });
  }
  return output;
}

/**
 * Record one shape loam cannot migrate.
 *
 * The finding is a record rather than three positional strings because code,
 * path and message are all strings and nothing but their order distinguished
 * them — two of the three were transposed at a call site once, and the report
 * named the message as the path.
 */
export function issue(
  target: OpenSpecUnsupportedShape[],
  scope: OpenSpecIssueScope,
  finding: { code: string; path: string; message: string },
): void {
  target.push({ ...finding, scope });
}

export function inspectLivingShape(
  path: string,
  raw: string,
  unsupported: OpenSpecUnsupportedShape[],
): void {
  const requirements = parseRequirements(raw);
  if (requirements.length === 0) {
    issue(unsupported, "living", {
      code: "openspec.living-empty",
      path: path,
      message: "Living spec has no parseable Requirement headings.",
    });
    return;
  }
  const outside = requirements.filter(
    (requirement) => requirement.section === undefined || !isRequirementsHeading(requirement.section),
  );
  if (outside.length > 0) {
    issue(unsupported, "living", {
      code: "openspec.living-requirements-outside-section",
      path: path,
      message: `${outside.length} requirement(s) are outside the canonical ## Requirements section.`,
    });
  }
  if (requirements.some((requirement) => requirement.kind !== "BASE")) {
    issue(unsupported, "living", {
      code: "openspec.living-delta-section",
      path: path,
      message: "Living spec contains delta-kind requirements.",
    });
  }
}

export function inspectChangeShape(
  unsupported: OpenSpecUnsupportedShape[],
  path: string,
  raw: string,
  found: { scope: "active" | "archive"; renames: OpenSpecRenamedUsage[] },
): void {
  const { scope, renames } = found;
  const requirements = parseRequirements(raw);
  const fileRenames = renames.filter((rename) => rename.path === path);
  for (const rename of fileRenames) {
    if (rename.from === null || rename.from === "" || rename.to === null || rename.to === "") {
      issue(unsupported, scope, {
        code: "openspec.renamed-malformed",
        path: path,
        message: `RENAMED Requirements at line ${rename.line} must contain a FROM/TO pair.`,
      });
    }
  }
  if (requirements.length === 0) {
    // A well-formed rename-only delta is meaningful even though the requirement
    // parser correctly returns no requirement blocks for it.
    if (fileRenames.length === 0) {
      issue(unsupported, scope, {
        code: "openspec.change-empty",
        path: path,
        message: "Change spec has no parseable Requirement headings.",
      });
    }
    return;
  }
  // `## Requirements` is the heading OpenSpec's own living-spec template
  // mandates, so this is the shape a team produces by copying a living spec into
  // a change directory. It parses, it is counted, and nothing routes it: only
  // delta-kind requirements reach the staged feature. Blocking is what keeps the
  // per-change counters and what actually lands the same number.
  const quoted = requirements.filter(
    (requirement) => requirement.kind === "BASE"
      && requirement.section !== undefined
      && isRequirementsHeading(requirement.section),
  );
  if (quoted.length > 0) {
    unsupported.push({
      code: "openspec.change-quoted-requirements",
      path,
      message: `${quoted.length} requirement(s) sit under ## Requirements in a change delta, which stages nothing; re-home them under ADDED, MODIFIED, or REMOVED.`,
      scope,
    });
  }
  const stranded = requirements.filter(
    (requirement) => requirement.kind === "BASE"
      && (requirement.section === undefined || !isRequirementsHeading(requirement.section)),
  );
  if (stranded.length === requirements.length) {
    issue(unsupported, scope, {
      code: "openspec.change-without-delta-sections",
      path: path,
      message: "Change requirements are not under ADDED, MODIFIED, REMOVED, or the explicitly non-merging ## Requirements section.",
    });
  } else if (stranded.length > 0) {
    issue(unsupported, scope, {
      code: "openspec.change-requirements-outside-delta-sections",
      path: path,
      message: `${stranded.length} requirement(s) would be stranded outside delta sections.`,
    });
  }
}

/**
 * The parsed requirements come back with the counts because both callers wanted
 * them and each opened the file a second time to get its own copy — two reads
 * of the same bytes per spec.md, and two readings of it: the counts came from
 * this parse while the requirement names, and the living corpus every rename is
 * resolved against, came from the other. A file edited mid-audit could be
 * counted from one of them and routed from the other.
 */
export async function inspectSpecFile(
  ingest: Ingest,
  absolute: string,
  kind: "living" | "change",
  scope: "active" | "archive" | null,
): Promise<{ path: string; counts: OpenSpecCounts; requirements: ReturnType<typeof parseRequirements> }> {
  const { root, mapping, renamed, unsupported } = ingest;
  const path = portable(root, absolute);
  const raw = await readFile(absolute, "utf8");
  const requirements = parseRequirements(raw);
  const counts = { specFiles: 1, ...countsFor(requirements) };
  const issueScope = kind === "living" ? "living" : scope ?? "active";
  for (const problem of requirementIdProblems(requirements)) {
    if (problem.kind === "invalid") {
      issue(unsupported, issueScope, {
        code: "openspec.requirement-id-invalid",
        path: path,
        message: `Requirement '${problem.requirement}' has invalid Requirement-ID '${problem.value}'; use [A-Za-z][A-Za-z0-9._-]{0,127}.`,
      });
    } else if (problem.kind === "repeated") {
      issue(unsupported, issueScope, {
        code: "openspec.requirement-id-repeated",
        path: path,
        message: `Requirement '${problem.requirement}' declares Requirement-ID ${problem.values.length} times; keep exactly one identity line.`,
      });
    } else {
      issue(unsupported, issueScope, {
        code: "openspec.requirement-id-duplicate",
        path: path,
        message: `Requirement-ID '${problem.id}' is shared by ${problem.requirements.map((name) => `'${name}'`).join(", ")}.`,
      });
    }
  }
  if (kind === "living") {
    inspectLivingShape(path, raw, unsupported);
  } else {
    const changeScope = scope ?? "active";
    const usages = renameUsages(path, raw, changeScope, mapping.renames);
    renamed.push(...usages);
    inspectChangeShape(unsupported, path, raw, { scope: changeScope, renames: usages });
  }
  return { path, counts, requirements };
}
