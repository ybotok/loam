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
 *
 * BOTH DELTA CORPORA ARE READ, because `loam new` scaffolds into both. A
 * `--capability` run writes `features/<FEAT>/capabilities/<id>/spec.md` from a
 * template whose example sits inside an HTML comment exactly like the two spec
 * templates', and an author who copies that block out and archives without
 * editing it would publish `TODO — name the promise` into a LIVING capability
 * document — which is strictly worse than the service case this gate was built
 * for: a capability document outlives every service that realizes it, and a
 * `Realizes:` line pointed at the placeholder's id would then be a join to a
 * promise nobody wrote. The capability deltas are read HERE rather than handed
 * in through `AuthoringScope`, because this is a walk over the feature's own
 * documents and the scope already names the feature; the read is one
 * `existsSync` for the fleets that have not adopted the axis, and the memo when
 * a context was threaded.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import type { Elem } from "../../c4/likec4.js";
import type { PathableService } from "../../kernel/ids/service.js";
import type { Issue } from "../../vocabulary/issue.js";
import type { FleetContext } from "../../fleet-context.js";
import type { Requirement } from "../../document/spec.js";
import { parseRequirements } from "../../document/parse.js";
import { featureCapabilityDeltas } from "../../capabilities/delta/tree.js";
import { featurePaths, featureSpecPaths, SPEC_AXES } from "../../repo/paths.js";
import type { FeatureDir } from "../../kernel/ids/dirs.js";
import {
  BODY_SENTINELS,
  HEADING_SENTINELS,
  SERVICE_DESCRIPTION_SENTINEL,
} from "./sentinels.js";

/** What the placeholder gate reads: the feature's own documents, nothing else. */
export interface AuthoringScope {
  featureDir: FeatureDir;
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
      const found = unauthored(await requirementsOf(scope, path));
      if (found.size === 0) continue;
      issues.push({
        severity: "warn",
        gates: true,
        code: "scaffold.placeholder",
        subject: svc,
        message: `${svc}: ${axis.file} still carries scaffold placeholder(s) nobody authored — ${quote(found)}. The merge would write them into the living spec as requirements somebody meant. Replace them, or archive with --approve.`,
      });
    }
  }

  // The business corpus. `subject` is the capability id — a THIRD provenance
  // for this code's subject, after a service id and none at all — and the
  // artifact table resolves it by MEMBERSHIP against the capability documents
  // the feature carries (`status/feature/artifacts.ts`), the same resolution
  // every `delta.*` issue on this axis already relies on. So the capability's
  // own row turns draft, and a service row does too only where a fleet holds a
  // service and a capability of one name, which is that module's deliberately
  // pessimistic answer rather than a mis-attribution here.
  const capabilities =
    scope.context === undefined
      ? await featureCapabilityDeltas(scope.featureDir)
      : await scope.context.featureCapabilityDeltas(scope.featureDir);
  for (const doc of capabilities.docs) {
    const found = unauthored(await requirementsOf(scope, doc.spec));
    if (found.size === 0) continue;
    issues.push({
      severity: "warn",
      gates: true,
      code: "scaffold.placeholder",
      subject: doc.id,
      message: `capability ${doc.id}: spec.md still carries scaffold placeholder(s) nobody authored — ${quote(found)}. The merge would write them into the living capabilities/${doc.id}/spec.md as promises somebody meant — and a capability document outlives every service that realizes it. Replace them, or archive with --approve.`,
    });
  }
  return issues;
}

/** One delta document's requirements, through the invocation's read index when there is one. */
async function requirementsOf(scope: AuthoringScope, path: string): Promise<Requirement[]> {
  if (scope.context === undefined) return parseRequirements(await readFile(path, "utf8"));
  return scope.context.readRequirements(path);
}

/**
 * The scaffold strings a delta's MERGING requirements still carry.
 *
 * ADDED/MODIFIED only: those are the texts this MERGE would write. A BASE
 * requirement is a quote of the living state — if a sentinel sits there, some
 * earlier archive published it and this feature is not the author to gate on it
 * — and a REMOVED one is leaving the document anyway.
 */
function unauthored(reqs: Requirement[]): Set<string> {
  const found = new Set<string>();
  for (const r of reqs) {
    if (r.kind === "ADDED" || r.kind === "MODIFIED") sentinelsIn(r, found);
  }
  return found;
}

/** The found sentinels as a message fragment — one spelling, so the two corpora read alike. */
function quote(found: ReadonlySet<string>): string {
  return [...found].map((s) => `'${s}'`).join(", ");
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
