/**
 * The requirements merge: the feature's ADDED/MODIFIED/REMOVED requirements
 * applied into each living service spec. The contract merges live beside it in
 * `./contracts/` — one file per axis, split out when the OpenAPI half made
 * this one carry two merges.
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
import { dirname } from "node:path";
import { rebaseLinks } from "../../../core/links/parse.js";
import { planWrite, readUtf8 } from "../../../core/staging/writes.js";
import { featureSpecPaths, SPEC_AXES } from "../../../core/repo/paths.js";
import { capabilityDocsDir, glossaryDir, livingCapabilityPaths } from "../../../core/repo/authored/paths.js";
import { featureGlossary, livingTermPath } from "../../../core/glossary/delta.js";
import { locateServicePaths } from "../../../core/repo/service-target.js";
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
import type { FleetContext } from "../../../core/fleet-context.js";

export async function planSpecs(
  config: { docsDir: DocsDir; fleet?: FleetContext },
  gated: Gated,
  plan: Plan,
  say: (line?: string) => void,
): Promise<void> {
  const { featureDir, deltaServices } = gated;
  const { writes } = plan;
  // Requirements merge — apply ADDED/MODIFIED/REMOVED into each living service
  // spec. ONE code path for the pair of requirement-carrying files: the business
  // spec.md and the architecture arch.spec.md ride the same delta algebra, the
  // same prose-preserving rewrite and the same guards, parameterized by filename
  // (SPEC_AXES) — a fork here would be two places the merge could disagree.
  for (const svc of deltaServices) {
    for (const axis of SPEC_AXES) {
      const deltaPath = featureSpecPaths(featureDir, svc)[axis.key];
      if (!existsSync(deltaPath)) continue;

      // The shared context: this is a deltaServices × SPEC_AXES loop, and a
      // context-less locate is a full fleet walk per iteration.
      const livingPath = (await locateServicePaths(config.docsDir, svc, config.fleet))[axis.key];
      // Resolved BEFORE the delta is parsed, because the parse now depends on
      // it: a requirement's markdown links are relative to the file they were
      // written in, and this merge moves the text two directories up the tree.
      // `core/links/parse.ts`'s `rebaseLinks` states the defect; the ordering
      // here is what lets the fix see both ends of the move, including a
      // service filed under a subsystem, whose living directory is deeper still.
      const deltaReqs = parseRequirements(
        rebaseLinks(await readUtf8(deltaPath), { from: dirname(deltaPath), to: dirname(livingPath) }),
      );
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
}

/**
 * The BUSINESS corpus's merge: a feature's `capabilities/<id>/spec.md` deltas
 * applied into the living `capabilities/<id>/spec.md`.
 *
 * Here rather than in a sixth file in this package because this module already
 * owns "requirements merged into a living document" — it owns
 * `rewriteRequirementsRun`, the two-headings refusal and the `applyRequirementDelta`
 * call, and the business corpus needs all three unchanged. What differs from
 * `planSpecs` above is only where the living document lives and what a CREATED
 * one says at the top.
 *
 * ARCHIVE CREATES THE LIVING DOCUMENT, by exact analogy with the new-service
 * branch above. The directory IS the list on this axis (`core/capabilities/tree.ts`),
 * so an archive that merged into a file it refused to create would make the
 * whole delta merge nothing — which is the `delta.no-delta-sections` failure
 * class, arriving through the merge instead of through the grammar.
 *
 * NO FRONTMATTER on a created capability document, and that is a decision
 * rather than an omission. Nothing reads a capability document's frontmatter:
 * `readCapabilityTree` classifies by the file's PRESENCE and
 * `readCapabilityVocabulary` takes `description`/`owner` from the YAML side. A
 * `status:` field invented here would be the "second list nothing keeps
 * current" this axis was designed against.
 *
 * AND IT SAYS SO OUT LOUD. Creating the first `capabilities/<id>/spec.md`
 * creates `capabilities/`, which is one of the two ways a fleet opts INTO the
 * capability axis — from the next command on, `loam validate --all` grades a
 * corpus that did not exist before. A merge that changes what the whole fleet
 * is graded on must not do it silently.
 */
export async function planCapabilities(
  config: { docsDir: DocsDir; fleet?: FleetContext },
  gated: Gated,
  plan: Plan,
  say: (line?: string) => void,
): Promise<void> {
  const { writes } = plan;
  // Whether `capabilities/` exists is asked BEFORE the loop, because the loop
  // is what would create it; `creating` records whether this run actually
  // materialises a document, so the adoption line below is not printed by a
  // run whose every capability delta merged into a document already there.
  const adopting = !existsSync(capabilityDocsDir(config.docsDir));
  let creating = false;
  for (const doc of gated.capabilityDeltas) {
    const livingPath = livingCapabilityPaths(config.docsDir, doc.id).spec;
    // Same move, same rewrite: `features/<FEAT>/capabilities/<id>/` is two
    // directories deeper than `capabilities/<id>/`, so a citation of a glossary
    // term or an ADR would land pointing above the repository.
    const deltaReqs = parseRequirements(
      rebaseLinks(await readUtf8(doc.spec), { from: dirname(doc.spec), to: dirname(livingPath) }),
    );
    if (!existsSync(livingPath)) {
      const created = applyRequirementDelta([], deltaReqs);
      if (created.length === 0) {
        say(`  capability: ${doc.id} — nothing to merge (delta leaves no requirements), no living spec.md created`);
        continue;
      }
      // The heading is the id and nothing else. loam merges requirements and
      // never prose, so it must not fabricate the narrative that is the whole
      // point of the document — the line below tells the author it is theirs.
      writes.push(planWrite(livingPath, `# ${doc.id}\n\n## Requirements\n\n${serializeRequirements(created)}`));
      creating = true;
      say(`  capability: ${doc.id} — created capabilities/${doc.id}/spec.md (${created.length} requirement(s))`);
      say(`      write the narrative above '## Requirements' — loam merges requirements, not prose`);
      continue;
    }
    const livingText = await readUtf8(livingPath);
    // The same one-section invariant as the service axis above, and the same
    // reason it cannot be guessed at.
    const reqHeadings = sectionHeadings(livingText).filter((h) => isRequirementsHeading(h.text));
    if (reqHeadings.length > 1) {
      throw new ArchiveFailure(
        "merge-failed",
        `living capabilities/${doc.id}/spec.md has ${reqHeadings.length} '## Requirements' headings (lines ${reqHeadings.map((h) => h.line).join(", ")}) — the merge rewrites ONE requirements section and cannot choose; merge them into one, then re-run`,
      );
    }
    const merged = applyRequirementDelta(parseRequirements(livingText), deltaReqs);
    writes.push(planWrite(livingPath, rewriteRequirementsRun(livingText, merged)));
    const c = summarize(deltaReqs);
    say(`  capability: ${doc.id} ← +${c.ADDED} ~${c.MODIFIED} -${c.REMOVED} (now ${merged.length} total)`);
  }
  if (adopting && creating) {
    say(`  capabilities/ did not exist — this archive opts the fleet into the business axis, and \`loam validate --all\` grades it from now on`);
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

/**
 * The vocabulary merge: each `features/<FEAT>/glossary/<term>.md` copied to
 * `glossary/<term>.md`.
 *
 * A WHOLE-FILE COPY, and there is nothing else it could be. A capability delta
 * is folded into a living document by the requirement algebra because the two
 * documents share identified parts; a term document has one part, and merging
 * two definitions of one word is not something a machine may attempt. So the
 * definition the author wrote in the feature IS the definition that lands,
 * verbatim — loam re-encodes it as UTF-8 through `readUtf8` and changes nothing
 * else, not even the trailing newline.
 *
 * CREATE-ONLY, which is why this loop has no other branch. A term the living
 * glossary already defines was refused at the gate (`glossary.term-exists`,
 * `core/glossary/delta.ts` has the reasoning), so by the time the plan runs
 * every path here is a file that does not exist. `planWrite` marks it
 * `exclusive`, so a race that created it between the gate and the commit fails
 * the write rather than overwriting somebody.
 *
 * AND IT SAYS SO OUT LOUD when it creates `glossary/`, exactly as
 * `planCapabilities` does for `capabilities/`: the directory's existence is the
 * axis's opt-in, so this merge changes what `loam validate --all` grades from
 * the next command on, and a merge that widens the fleet's own gate must not do
 * it silently.
 */
export async function planGlossary(
  config: { docsDir: DocsDir },
  gated: Gated,
  plan: Plan,
  say: (line?: string) => void,
): Promise<void> {
  const glossary = await featureGlossary(gated.featureDir);
  if (!glossary.present || glossary.terms.length === 0) return;
  // Asked BEFORE the loop, because the loop is what would create it.
  const adopting = !existsSync(glossaryDir(config.docsDir));
  for (const term of glossary.terms) {
    plan.writes.push(planWrite(livingTermPath(config.docsDir, term.id), await readUtf8(term.path)));
    say(`  glossary: ${term.id} — created glossary/${term.id}.md`);
  }
  if (adopting) {
    say(`  glossary/ did not exist — this archive opts the fleet into the domain vocabulary, and \`loam validate --all\` grades it from now on`);
  }
}
