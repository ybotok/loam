/**
 * The gate between `loam new` and `loam archive`: a scaffold nobody edited must
 * not become the living truth.
 *
 * `loam new` writes documents whose whole point is to be replaced — a TODO
 * requirement heading, angle-bracket step fill-ins, a TODO service description,
 * an intent whose Why/Scope are comments. Every one of them parsed as real
 * content, validated clean, and archived at exit 0, which put literal `TODO —
 * name the behaviour` into a living spec the rest of the fleet then reads as a
 * requirement somebody meant. These checks refuse that merge.
 *
 * Both are warnings that GATE (issue.ts: severity says the DOCUMENT is legal —
 * it is, it parses — gating says the MERGE is unsafe). `--approve` overrides,
 * as with every judgment about the feature.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import type { Elem } from "../../c4/likec4.js";
import type { PathableService } from "../../kernel/ids.js";
import type { Issue } from "../../vocabulary/issue.js";
import type { FleetContext } from "../../fleet-context.js";
import type { Requirement } from "../../document/spec.js";
import { parseRequirements } from "../../document/parse.js";
import { featurePaths, featureSpecPaths, SPEC_AXES } from "../../repo/paths.js";
import {
  BODY_SENTINELS,
  HEADING_SENTINELS,
  SERVICE_DESCRIPTION_SENTINEL,
} from "./sentinels.js";

/** What the placeholder gate reads: the feature's own documents, nothing else. */
export interface AuthoringScope {
  featureDir: string;
  featureId: string;
  /**
   * Every element whose authored block the landscape merge would SPLICE — the
   * tagged elements and everything nested inside their blocks. The scope is
   * the splice's, not the tag's, for `c4.service-binding-invalid`'s reason
   * (coherence.ts): the merge carries a tagged element's block over byte for
   * byte, untagged children included, so a TODO description on a nested child
   * reaches the fleet map exactly as its tagged parent's would.
   */
  splicedEls: Elem[];
  svcNames: PathableService[];
  context?: FleetContext;
}

export async function authoringIssues(scope: AuthoringScope): Promise<Issue[]> {
  const issues: Issue[] = [];
  await intentIssue(scope, issues);

  for (const e of scope.splicedEls) {
    if (e.description !== SERVICE_DESCRIPTION_SENTINEL) continue;
    issues.push({
      severity: "warn",
      gates: true,
      code: "scaffold.placeholder",
      message: `delta.likec4: '${e.title}' (${e.id}) still carries the scaffolded description '${SERVICE_DESCRIPTION_SENTINEL}' — the merge would publish it to the fleet map. Say what the service owns, or archive with --approve.`,
    });
  }

  for (const svc of scope.svcNames) {
    const paths = featureSpecPaths(scope.featureDir, svc);
    for (const axis of SPEC_AXES) {
      const path = paths[axis.key];
      if (!existsSync(path)) continue;
      const reqs =
        scope.context === undefined
          ? parseRequirements(await readFile(path, "utf8"))
          : await scope.context.readRequirements(path);
      const found = new Set<string>();
      // ADDED/MODIFIED only: those are the texts this MERGE would write. A
      // BASE requirement is a quote of the living state — if a sentinel sits
      // there, some earlier archive published it and this feature is not the
      // author to gate on it — and a REMOVED one is leaving the spec anyway.
      for (const r of reqs) {
        if (r.kind === "ADDED" || r.kind === "MODIFIED") sentinelsIn(r, found);
      }
      if (found.size === 0) continue;
      issues.push({
        severity: "warn",
        gates: true,
        code: "scaffold.placeholder",
        subject: svc,
        message: `${svc}: ${axis.file} still carries scaffold placeholder(s) nobody authored — ${[...found].map((s) => `'${s}'`).join(", ")}. The merge would write them into the living spec as requirements somebody meant. Replace them, or archive with --approve.`,
      });
    }
  }
  return issues;
}

/** The exact template strings this requirement still carries, if any. */
function sentinelsIn(r: Requirement, found: Set<string>): void {
  for (const heading of HEADING_SENTINELS) {
    if (r.name === heading) found.add(heading);
    for (const s of r.scenarios) {
      if (s.name === heading) found.add(heading);
    }
  }
  const body = [r.text.join("\n"), ...r.scenarios.map((s) => s.lines.join("\n"))].join("\n");
  for (const marker of BODY_SENTINELS) {
    if (body.includes(marker)) found.add(marker);
  }
}

/**
 * Does intent.md SAY anything? The scaffold's Why/Scope bodies are HTML
 * comments, so "strip frontmatter, comments and headings, look for prose" is
 * exactly the question "did a person write the sentence the reviewer reads
 * first". A missing file gates the same way: a feature with no stated intent
 * is not less anonymous for not having the file.
 */
async function intentIssue(scope: AuthoringScope, issues: Issue[]): Promise<void> {
  const path = featurePaths(scope.featureDir).intent;
  const empty = { severity: "warn", gates: true, code: "intent.empty" } as const;
  if (!existsSync(path)) {
    issues.push({
      ...empty,
      message: `intent.md is missing — nothing says why ${scope.featureId} exists. Write the Why before archiving it into the living docs, or archive with --approve.`,
    });
    return;
  }
  if (hasProse(await readFile(path, "utf8"))) return;
  issues.push({
    ...empty,
    message: `intent.md says nothing yet — its Why and Scope are still the scaffold's comments. Write why ${scope.featureId} exists before archiving it into the living docs, or archive with --approve.`,
  });
}

/** Is there any authored text outside frontmatter, HTML comments and headings? */
function hasProse(text: string): boolean {
  // Normalized BEFORE the fence regex, the discipline document/parse.ts
  // applies to every other markdown read: `---\r` is not `---`, so a CRLF
  // rewrite (or a BOM some Windows editor prefixed) kept the frontmatter,
  // which then counted as prose — and the untouched scaffold archived at
  // exit 0 through the exact gate built to refuse it.
  // The BOM is spelled as an escape, never as the raw character — a raw one is
  // invisible in review and to grep, which is how it would survive a rewrite.
  let body = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  // Frontmatter: the leading `---` block only, exactly where the scaffold puts it.
  const fm = /^---\n[\s\S]*?\n---\n/.exec(body);
  if (fm !== null) body = body.slice(fm[0].length);
  body = body.replace(/<!--[\s\S]*?-->/g, "");
  return body
    .split("\n")
    .some((line) => line.trim().length > 0 && !line.trimStart().startsWith("#"));
}
