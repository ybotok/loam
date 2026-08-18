/**
 * The two document merges: requirements into each living spec, then the
 * feature's OpenAPI into each living contract.
 *
 * ONE code path for the pair of requirement-carrying files — the business
 * spec.md and the architecture arch.spec.md ride the same delta algebra, the
 * same prose-preserving rewrite and the same guards, parameterized by filename.
 * A fork here would be two places the merge could disagree.
 *
 * Nothing is written. Everything lands in the `Plan`, so a failure on any axis
 * leaves the living docs exactly as they were.
 */
import { existsSync } from "node:fs";
import { repoPath } from "../../../core/envelope/json.js";
import { planWrite, readUtf8 } from "../../../core/staging/writes.js";
import { featureSpecPaths, servicePaths, SPEC_AXES } from "../../../core/repo/paths.js";
import { readOpenapi } from "../../../core/openapi/doc.js";
import { OpenapiMergeError } from "../../../core/openapi/merge/error.js";
import { stripOpenapiRemovalMarkers } from "../../../core/openapi/merge/markers.js";
import { mergeOpenapiPaths, type OpenapiMergeResult } from "../../../core/openapi/merge/merge.js";
import {
  isRequirementsHeading,
  parseRequirements,
  sectionHeadings,
  splitRequirementsSection,
} from "../../../core/document/parse.js";
import { applyRequirementDelta } from "../../../core/document/apply.js";
import { serializeRequirements } from "../../../core/document/spec.js";
import { type Requirement } from "../../../core/document/spec.js";
import { ArchiveFailure } from "./refusal.js";
import { type Gated, type Plan } from "./state.js";
import type { DocsDir } from "../../../core/kernel/ids/dirs.js";

export async function planSpecs(
  config: { docsDir: DocsDir },
  gated: Gated,
  plan: Plan,
  say: (line?: string) => void,
): Promise<void> {
  const { featureDir, deltaServices } = gated;
  const { writes, planWarns, planGates, openapiRemovals } = plan;
  // 1. Requirements merge — apply ADDED/MODIFIED/REMOVED into each living service
  // spec. ONE code path for the pair of requirement-carrying files: the business
  // spec.md and the architecture arch.spec.md ride the same delta algebra, the
  // same prose-preserving rewrite and the same guards, parameterized by filename
  // (SPEC_AXES) — a fork here would be two places the merge could disagree.
  for (const svc of deltaServices) {
    for (const axis of SPEC_AXES) {
      const deltaPath = featureSpecPaths(featureDir, svc)[axis.key];
      if (!existsSync(deltaPath)) continue;
      const deltaReqs = parseRequirements(await readUtf8(deltaPath));

      const livingPath = servicePaths(config.docsDir, svc)[axis.key];
      if (!existsSync(livingPath)) {
        // New service (or first arch spec) — create the living file from the
        // ADDED/MODIFIED requirements.
        const created = applyRequirementDelta([], deltaReqs);
        if (created.length === 0) {
          say(`  ${axis.label}: ${svc} — nothing to merge (delta leaves no requirements), no living ${axis.file} created`);
          continue;
        }
        const heading = axis.key === "spec" ? svc : `${svc} — architecture`;
        const frontmatter = `---\nservice: ${svc}\nstatus: draft\n---\n\n# ${heading}\n\n`;
        writes.push(planWrite(livingPath, `${frontmatter}## Requirements\n\n${serializeRequirements(created)}`));
        say(`  ${axis.label}: ${svc} — created living ${axis.file} (${created.length} requirement(s))`);
        continue;
      }
      const livingText = await readUtf8(livingPath);
      // TWO `## Requirements` headings would put the rewrite's one-section
      // invariant to a choice it must not make: the run of the first would be
      // rewritten while the second survived verbatim in the tail — and its
      // requirements, collected by parseRequirements, would land in the run TOO.
      // Mechanical, like a model-less landscape, so merge-failed, not --approve.
      const reqHeadings = sectionHeadings(livingText).filter((h) => isRequirementsHeading(h.text));
      if (reqHeadings.length > 1) {
        throw new ArchiveFailure(
          "merge-failed",
          `living ${axis.file} for ${svc} has ${reqHeadings.length} '## Requirements' headings (lines ${reqHeadings.map((h) => h.line).join(", ")}) — the merge rewrites ONE requirements section and cannot choose; merge them into one, then re-run`,
        );
      }
      const merged = applyRequirementDelta(parseRequirements(livingText), deltaReqs);
      writes.push(planWrite(livingPath, rewriteRequirementsRun(livingText, merged)));

      const c = summarize(deltaReqs);
      say(`  ${axis.label}: ${svc} ← +${c.ADDED} ~${c.MODIFIED} -${c.REMOVED} (now ${merged.length} total)`);
    }
  }

  // 1b. OpenAPI merge — fold the feature's openapi deltas into the living service APIs.
  for (const svc of deltaServices) {
    const featOpenapi = featureSpecPaths(featureDir, svc).openapi;
    if (!existsSync(featOpenapi)) continue;
    const featText = await readUtf8(featOpenapi);
    const livingOpenapi = servicePaths(config.docsDir, svc).openapi;
    const featDoc = await readOpenapi(featOpenapi);
    // Every other reader of this flag suspends its own judgement when it is set
    // — validate grades `openapi.invalid`, show and status print that the file
    // does not parse. Archive was the only one that never looked, and it is the
    // command that WRITES: a feature openapi.yaml holding a sequence instead of
    // a mapping was planned verbatim into services/<svc>/openapi.yaml, `ok:
    // true`, printing `created ()` because the reader saw no operations in it.
    // A document loam cannot read is one it cannot merge, and that is the same
    // answer as any other merge it could not compute: nothing is written.
    if (featDoc.unreadable) {
      throw new ArchiveFailure(
        "merge-failed",
        `feature openapi ${repoPath(config.docsDir, featOpenapi)} for ${svc} does not read as an OpenAPI document (${featDoc.error ?? "not a YAML mapping"}) — the API axis cannot be merged; fix the file, or delete it if this feature has no contract delta`,
      );
    }
    const ops = featDoc.ops.filter((op) => !op.remove).map((op) => op.id);
    // An `x-loam-remove: true` written at PATH level retires nothing: the marker
    // addresses one operation, and beside the methods there is no operation for
    // it to address. The merge now strips it on every branch, so the living
    // contract is safe either way — but the author asked for a removal that will
    // not happen, and silence there is how a retired endpoint stayed live.
    // Gated like the other plan-visible breaches, --approve and all.
    for (const path of featDoc.pathLevelRemovals) {
      planGates.push({
        severity: "error",
        code: "openapi.remove-marker-path-level",
        subject: svc,
        message: `${svc}: '${path}' carries x-loam-remove at PATH level, beside the methods — a removal marker names ONE operation, so this retires nothing and is not a contract key either. Move it inside the operation you are retiring (with its operationId), or delete it.`,
      });
    }
    if (!existsSync(livingOpenapi)) {
      // A removal against a non-existent contract is gated by coherence. Keep
      // the feature-only marker out of living docs even under --approve — and
      // ask the DOCUMENT, not the operation reader: a marker with no
      // operationId is invisible to `operations()`, so gating the strip on
      // "does the reader see a removal" let exactly that marker through into a
      // living contract, published to every consumer of the fleet.
      const content = stripOpenapiRemovalMarkers(featText, svc);
      writes.push(planWrite(livingOpenapi, content));
      say(`  openapi: ${svc} — created (${ops.join(", ")})`);
    } else {
      let merge: OpenapiMergeResult;
      try {
        merge = mergeOpenapiPaths(await readUtf8(livingOpenapi), featText, svc);
      } catch (err) {
        if (err instanceof OpenapiMergeError) throw new ArchiveFailure("merge-failed", err.message);
        throw err;
      }
      const { text, modified, pathItemModified, removed, quoted, componentsModified, unresolved } = merge;
      if (text !== null) {
        writes.push(planWrite(livingOpenapi, text));
        say(`  openapi: ${svc} — merged (${ops.join(", ")})`);
      }
      if (removed.length > 0) {
        openapiRemovals.push({ service: svc, operations: removed });
        for (const label of removed) say(`      - removes ${label}`);
      }
      // Said out loud, because "the plan wrote less than my delta spells" is
      // the one thing a reader cannot infer from a merged file. Not a warning:
      // quoting the contract around your change is correct authoring, and
      // leaving the quote alone is the correct merge.
      for (const label of quoted) say(`      · quotes ${label} — unchanged since it was pinned, left as living has it`);
      for (const label of modified) {
        planWarns.push({
          severity: "warn",
          code: "openapi.op-modified",
          subject: svc,
          message: `${svc}: the delta redefines ${label}, which the living OpenAPI already has — the merge overwrites the living operation wholesale`,
        });
        say(`      ⚠ overwrites ${label} — the living definition differs`);
      }
      for (const label of pathItemModified) {
        planWarns.push({
          severity: "warn",
          code: "openapi.path-item-modified",
          subject: svc,
          message: `${svc}: the delta redefines the path-level key ${label}, which the living OpenAPI already has — the merge overwrites it wholesale, and it applies to EVERY operation on that path, including ones this feature never mentions`,
        });
        say(`      ⚠ overwrites path-level ${label} — the living definition differs`);
      }
      for (const comp of componentsModified) {
        planWarns.push({
          severity: "warn",
          code: "openapi.component-modified",
          subject: svc,
          message: `${svc}: the merged operations carry component '${comp}', which the living OpenAPI already defines differently — the merge overwrites the living component wholesale`,
        });
        say(`      ⚠ overwrites component ${comp} — the living definition differs`);
      }
      for (const u of unresolved) {
        planGates.push({
          severity: "error",
          code: "openapi.ref-unresolved",
          subject: svc,
          message: `${svc}: $ref '${u.ref}' (referenced from ${u.from}) resolves in neither the feature's openapi.yaml nor the living one — the merged document would carry a dangling reference`,
        });
      }
    }
  }

}

/**
 * Rewrite ONLY the requirements run of a living spec. Byte-for-byte preserved:
 * everything before the first requirement inside `## Requirements` (the intro,
 * the heading line, prose under the heading) and everything from the section's
 * end onward (the next `## ` heading to EOF) — the old cut was a substring
 * `indexOf("\n## Requirements")`, a prefix match that also hit
 * `## Requirements Extra` and silently destroyed every section after the
 * requirements. Prose BETWEEN requirements is body text of whatever is open
 * above it (parseRequirements attributes it to the previous requirement's last
 * scenario, or its text) and survives inside the re-serialized run, framing
 * normalized. `merged` must contain every living requirement — runArchive's
 * stray guard refuses any document whose requirements sit outside the section,
 * using the same heading definition, before this output is ever written.
 */
function rewriteRequirementsRun(text: string, merged: Requirement[]): string {
  const s = splitRequirementsSection(text);
  // No `## Requirements` at all: the stray guard has already refused any doc
  // whose requirements live elsewhere, so this one has none — open the section.
  if (s === null) return `${text.trimEnd()}\n\n## Requirements\n\n${serializeRequirements(merged)}`;
  const body = serializeRequirements(merged);
  // head/tail are raw slices; only the run's own framing is normalized. When
  // the section held no requirements yet, the glue supplies the blank line the
  // author never had reason to write.
  const headGlue = s.run !== "" || s.head.endsWith("\n\n") ? "" : s.head.endsWith("\n") ? "\n" : "\n\n";
  const tailGlue = s.tail === "" ? "" : "\n";
  return s.head + headGlue + body + tailGlue + s.tail;
}

function summarize(reqs: Requirement[]): { ADDED: number; MODIFIED: number; REMOVED: number } {
  const c = { ADDED: 0, MODIFIED: 0, REMOVED: 0 };
  for (const r of reqs) {
    if (r.kind === "ADDED") c.ADDED += 1;
    else if (r.kind === "MODIFIED") c.MODIFIED += 1;
    else if (r.kind === "REMOVED") c.REMOVED += 1;
  }
  return c;
}
