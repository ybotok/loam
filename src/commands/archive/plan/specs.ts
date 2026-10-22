/**
 * The requirements merge: the feature's ADDED/MODIFIED/REMOVED requirements
 * applied into each living service spec. The contract merges live beside it in
 * `./contracts/` — one file per axis, split out when the OpenAPI half made
 * this one carry two merges. What happens to the TEXT of one document lives in
 * `./document/`: the in-place rewrite of an existing requirements run, the
 * head of a document this merge creates, and where a merged link points once
 * the feature has moved.
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
import { enumeratedServiceIds, locateServicePaths } from "../../../core/repo/service-target.js";
import { introducedServices } from "../../../core/projection/arch-slice.js";
import { isRequirementsHeading, parseRequirements, sectionHeadings } from "../../../core/document/parse.js";
import { applyRequirementDelta, droppedBy, droppedSentence, type DroppedRow } from "../../../core/document/apply.js";
import { type Requirement } from "../../../core/document/spec.js";
import { movedUnderVouch, parseFrontmatter, stringField } from "../../../core/document/frontmatter.js";
import { CodedFailure } from "../../../core/envelope/json.js";
import { type Gated, type Plan } from "./state.js";
import { featureRetarget } from "./document/links.js";
import { createdDocument, hasPurpose } from "./document/head.js";
import { rewriteRequirementsRun } from "./document/run.js";
import type { DocsDir } from "../../../core/kernel/ids/dirs.js";
import type { FleetContext } from "../../../core/fleet-context.js";

export async function planSpecs(
  config: { docsDir: DocsDir; fleet: FleetContext },
  gated: Gated,
  plan: Plan,
  say: (line?: string) => void,
): Promise<void> {
  const { featureDir, deltaServices } = gated;
  const { writes } = plan;
  // Where every file of the feature will be once this archive lands — the
  // glossary terms it copies out, everything else under features/archive/.
  const retarget = await featureRetarget(config.docsDir, gated);
  // Who the fleet already has, asked BEFORE any of this archive's writes, and
  // which of them this feature's own C4 delta introduces: a first spec.md for a
  // service that existed and was never adopted is the feature's slice, not the
  // service, and the create branch below says so in its frontmatter.
  const existing = new Set<string>(await enumeratedServiceIds(config.docsDir, config.fleet));
  const introduced = new Set(introducedServices(gated.deltaDoc ?? null, gated.id));
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
      // `retarget` is the other half: a link INTO the feature points at a file
      // this same archive moves (`./document/links.ts`).
      const delta = rebaseLinks(await readUtf8(deltaPath), { from: dirname(deltaPath), to: dirname(livingPath), retarget });
      const deltaReqs = parseRequirements(delta);
      if (!existsSync(livingPath)) {
        // New service (or first arch spec) — create the living file from the
        // ADDED/MODIFIED requirements, under the head `./document/head.ts` writes:
        // what the delta marked as the document's own, and a link to the rest.
        const created = applyRequirementDelta([], deltaReqs);
        if (created.length === 0) {
          say(`  ${axis.label}: ${svc} — nothing to merge (delta leaves no requirements), no living ${axis.file} created`);
          continue;
        }
        // The business spec only: it is the document the maturity ladder and
        // `next.adopt` read as "this service is written down" (SCHEMA.md,
        // `adoption`). A service the feature introduces IS its slice — there was
        // nothing before it to adopt — so it is never marked.
        const unadopted = axis.key === "spec" && existing.has(svc) && !introduced.has(svc);
        const doc = createdDocument({
          docsDir: config.docsDir,
          featureId: gated.id,
          deltaPath,
          delta,
          livingPath,
          retarget,
          fallbackTitle: axis.key === "spec" ? svc : `${svc} — architecture`,
          service: svc,
          ...(unadopted ? { adoption: "partial" as const } : {}),
          requirements: created,
        });
        writes.push(planWrite(livingPath, doc.text));
        say(`  ${axis.label}: ${svc} — created living ${axis.file} (${created.length} requirement(s))`);
        say(`      ${doc.note}`);
        if (unadopted) {
          say(
            `      ${svc} existed before ${gated.id} and was never adopted — this spec.md holds only the feature's slice, so it is ` +
              `written \`adoption: partial\` and ${svc} stays owed its adoption: \`loam adopt --service ${svc}\`, then delete the line`,
          );
        }
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
        throw new CodedFailure(
          "merge-failed",
          `living ${axis.file} for ${svc} has ${reqHeadings.length} '## Requirements' headings (lines ${reqHeadings.map((h) => h.line).join(", ")}) — the merge rewrites ONE requirements section and cannot choose; merge them into one, then re-run`,
        );
      }
      const livingReqs = parseRequirements(livingText);
      const merged = applyRequirementDelta(livingReqs, deltaReqs);
      const next = rewriteRequirementsRun(livingText, livingReqs, merged);
      writes.push(planWrite(livingPath, next));
      // A merge is an edit to the document's body like any other, so a vouched
      // spec it moves goes `content.stale` — and honestly: the merged text is
      // words no person has yet read against the code. Archive does not soften
      // that. It names the document and its owner, so the re-vouch is known to
      // be owed while the merge is still a PR rather than discovered later as a
      // red `--strict` gate. Asked of the bytes about to be written, through the
      // one definition validate grades with.
      const fm = parseFrontmatter(next);
      if (movedUnderVouch(fm, next)) {
        plan.revouchOwed.push({ service: svc, path: livingPath, owner: stringField(fm, "owner") ?? null });
      }

      const c = summarize(deltaReqs);
      say(`  ${axis.label}: ${svc} ← +${c.ADDED} ~${c.MODIFIED} -${c.REMOVED} (now ${merged.length} total)`);
      sayDropped(plan, say, livingPath, droppedBy(livingReqs, deltaReqs));
      if (hasPurpose(delta)) say(`      ${PURPOSE_NOT_MERGED}`);
    }
  }
}

/**
 * A `## Purpose` in a delta against a document that already exists merges as
 * nothing — the living narrative is edited in place, never replaced by a merge
 * — and the author who wrote one expected it to land. Said, not refused: the
 * requirements are still exactly what they meant.
 */
const PURPOSE_NOT_MERGED =
  "the delta's ## Purpose was not merged — the living document keeps its own narrative; edit it there in this change";

/**
 * The BUSINESS corpus's merge: a feature's `capabilities/<id>/spec.md` deltas
 * applied into the living `capabilities/<id>/spec.md`.
 *
 * Here rather than in a sixth file in this package because this module already
 * owns "requirements merged into a living document" — it owns the two-headings
 * refusal and the `applyRequirementDelta` call, and calls the same
 * `./document/` rewrite and head, and the business corpus needs all of them
 * unchanged. What differs from
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
  config: { docsDir: DocsDir; fleet: FleetContext },
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
  const retarget = await featureRetarget(config.docsDir, gated);
  for (const doc of gated.capabilityDeltas) {
    const livingPath = livingCapabilityPaths(config.docsDir, doc.id).spec;
    // Same move, same rewrite: `features/<FEAT>/capabilities/<id>/` is two
    // directories deeper than `capabilities/<id>/`, so a citation of a glossary
    // term or an ADR would land pointing above the repository — or, aimed into
    // the feature itself, at a file this archive moves.
    const delta = rebaseLinks(await readUtf8(doc.spec), { from: dirname(doc.spec), to: dirname(livingPath), retarget });
    const deltaReqs = parseRequirements(delta);
    if (!existsSync(livingPath)) {
      const created = applyRequirementDelta([], deltaReqs);
      if (created.length === 0) {
        say(`  capability: ${doc.id} — nothing to merge (delta leaves no requirements), no living spec.md created`);
        continue;
      }
      // The heading is the id unless the delta titled the capability, and the
      // narrative is the delta's `## Purpose` or nothing: loam merges
      // requirements and never prose, so it must not fabricate the narrative
      // that is the whole point of the document — it carries only what the
      // author marked as the document's own (`./document/head.ts`), and the note
      // below tells them where the rest is.
      const living = createdDocument({
        docsDir: config.docsDir,
        featureId: gated.id,
        deltaPath: doc.spec,
        delta,
        livingPath,
        retarget,
        fallbackTitle: doc.id,
        service: null,
        requirements: created,
      });
      writes.push(planWrite(livingPath, living.text));
      creating = true;
      say(`  capability: ${doc.id} — created capabilities/${doc.id}/spec.md (${created.length} requirement(s))`);
      say(`      ${living.note}`);
      continue;
    }
    const livingText = await readUtf8(livingPath);
    // The same one-section invariant as the service axis above, and the same
    // reason it cannot be guessed at.
    const reqHeadings = sectionHeadings(livingText).filter((h) => isRequirementsHeading(h.text));
    if (reqHeadings.length > 1) {
      throw new CodedFailure(
        "merge-failed",
        `living capabilities/${doc.id}/spec.md has ${reqHeadings.length} '## Requirements' headings (lines ${reqHeadings.map((h) => h.line).join(", ")}) — the merge rewrites ONE requirements section and cannot choose; merge them into one, then re-run`,
      );
    }
    const livingReqs = parseRequirements(livingText);
    const merged = applyRequirementDelta(livingReqs, deltaReqs);
    writes.push(planWrite(livingPath, rewriteRequirementsRun(livingText, livingReqs, merged)));
    const c = summarize(deltaReqs);
    say(`  capability: ${doc.id} ← +${c.ADDED} ~${c.MODIFIED} -${c.REMOVED} (now ${merged.length} total)`);
    sayDropped(plan, say, livingPath, droppedBy(livingReqs, deltaReqs));
    if (hasPurpose(delta)) say(`      ${PURPOSE_NOT_MERGED}`);
  }
  if (adopting && creating) {
    say(`  capabilities/ did not exist — this archive opts the fleet into the business axis, and \`loam validate --all\` grades it from now on`);
  }
}

/**
 * What each replacement takes out of the living document, named under the
 * count line and carried as `--json` `dropped`. The counts alone were the whole
 * report — `~1` — while a MODIFIED that restated one of two scenarios, or wrote
 * `Covers:` without the `sli:` entries the living text had, merged at exit 0
 * and the rest was gone (`core/document/apply.ts` says why it is read verbatim
 * and by name). Said, never gated: rewriting a requirement smaller is a
 * legitimate change, and what was missing was only that nobody was told.
 */
function sayDropped(plan: Plan, say: (line?: string) => void, path: string, rows: DroppedRow[]): void {
  for (const row of rows) {
    plan.dropped.push({ path, ...row });
    say(`      ${row.kind === "REMOVED" ? "-" : "~"} ${droppedSentence(row)}`);
  }
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
 * definition the author wrote in the feature IS the definition that lands —
 * loam re-encodes it as UTF-8 through `readUtf8` and changes nothing else, not
 * even the trailing newline, but the ROUTE of each relative link. That one
 * exception is the requirement merge's, for the requirement merge's reason: the
 * term moves from `features/<FEAT>/glossary/` to `glossary/`, two directories
 * up, so a definition citing a service spec or the feature's own ADR landed
 * pointing at nothing (`link.unresolved` on the very next `validate --all`,
 * against a document graded at fleet scope). Same `rebaseLinks`, same
 * `retarget`: the target is unchanged, only the way there.
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
  const retarget = await featureRetarget(config.docsDir, gated);
  for (const term of glossary.terms) {
    const livingPath = livingTermPath(config.docsDir, term.id);
    const text = rebaseLinks(await readUtf8(term.path), { from: dirname(term.path), to: dirname(livingPath), retarget });
    plan.writes.push(planWrite(livingPath, text));
    say(`  glossary: ${term.id} — created glossary/${term.id}.md`);
  }
  if (adopting) {
    say(`  glossary/ did not exist — this archive opts the fleet into the domain vocabulary, and \`loam validate --all\` grades it from now on`);
  }
}
