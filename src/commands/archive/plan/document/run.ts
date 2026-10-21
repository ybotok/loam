/**
 * The in-place half of a requirement merge: a living document that already
 * exists has its requirements RUN rewritten, and nothing else.
 *
 * Moved out of `../specs.ts` when that module took on what a CREATED document
 * says (`./head.ts`) and where a merged link points (`./links.ts`): the three
 * are the document-level questions a requirement merge answers, and the merge
 * loop itself is what is left beside the contract and landscape planners.
 */
import { parseRequirements, splitRequirementsSection } from "../../../../core/document/parse.js";
import { serializeRequirements, type Requirement } from "../../../../core/document/spec.js";

/**
 * Rewrite ONLY what the delta touched inside a living spec's requirements run.
 * Byte-for-byte preserved: everything before the first requirement inside
 * `## Requirements` (the intro, the heading line, prose under the heading) and
 * everything from the section's end onward (the next `## ` heading to EOF) —
 * the old cut was a substring `indexOf("\n## Requirements")`, a prefix match
 * that also hit `## Requirements Extra` and silently destroyed every section
 * after the requirements. `living` must be every living requirement — the gate's
 * stray guard refuses any document whose requirements sit outside the section,
 * using the same heading definition, before this output is ever written.
 *
 * Inside the run the unit is one requirement, and an untouched one is written
 * back as its raw slice (`spliceRun`). The whole run used to be re-serialized,
 * and `serializeRequirements` writes a blank line under every
 * `### Requirement:` heading — so a living spec written without one, the shape
 * the adopt brief's own examples taught, had that line inserted under every
 * requirement the feature never mentioned. The diff, the vouch pack and the
 * re-vouch all widened from the delta to the whole section.
 *
 * Exported for `../specs.ts`, which calls it for both corpora, and for
 * test/archive.test.ts: the slice-to-requirement join (`verbatimSlices`) can
 * only be handed a disagreeing pair directly, because the gate refuses every
 * document that would produce one through the CLI.
 */
export function rewriteRequirementsRun(text: string, living: Requirement[], merged: Requirement[]): string {
  const s = splitRequirementsSection(text);
  // No `## Requirements` at all: the stray guard has already refused any doc
  // whose requirements live elsewhere, so this one has none — open the section.
  if (s === null) return `${text.trimEnd()}\n\n## Requirements\n\n${serializeRequirements(merged)}`;
  if (s.run !== "") return s.head + spliceRun(s, living, merged) + s.tail;
  // The section held no requirements yet: head and tail are raw slices, and the
  // glue supplies the blank lines the author never had reason to write.
  const headGlue = s.head.endsWith("\n\n") ? "" : s.head.endsWith("\n") ? "\n" : "\n\n";
  const tailGlue = s.tail === "" ? "" : "\n";
  return s.head + headGlue + serializeRequirements(merged) + tailGlue + s.tail;
}

/** The line breaks (and blank lines) a slice ends with — what separates it from whatever follows. */
const TRAILING_BREAKS = /(?:\r?\n[ \t]*)*$/;

/**
 * The merged run: every living requirement the delta left alone as its raw
 * slice, every one it added or replaced serialized, in `merged`'s order.
 *
 * Keyed on object identity, which `applyRequirementDelta` keeps for exactly the
 * requirements it did not touch — so there is no second reading here of what
 * the delta changed, and no way for the splice and the algebra to disagree.
 * Which slice belongs to which living requirement is `verbatimSlices`' join.
 *
 * Prose BETWEEN requirements rides in the slice of the requirement above it,
 * which is where parseRequirements attributes it too: it survives verbatim
 * beside an untouched requirement and goes with a replaced one, as it always
 * did — a MODIFIED carries its full new text.
 */
function spliceRun(
  section: { run: string; requirements: string[] },
  living: Requirement[],
  merged: Requirement[],
): string {
  const verbatim = verbatimSlices(section.requirements, living);
  let out = "";
  let previousVerbatim = true;
  for (const requirement of merged) {
    const raw = verbatim.get(requirement);
    // Two untouched neighbours keep whatever the author put between them. Next
    // to a serialized requirement the canonical blank line is ADDED after the
    // untouched text, never by rewriting it.
    if (out !== "" && (raw === undefined || !previousVerbatim)) out = withBlankLine(out);
    out += raw ?? serializeRequirements([requirement]);
    previousVerbatim = raw !== undefined;
  }
  if (out === "") return "";
  // The run ends as it ended: whatever separated the old last requirement from
  // the next heading (or EOF) now follows the new last one — and at least a
  // newline when a merged requirement lands where the file used to stop without one.
  const ending = section.run.slice(section.run.search(TRAILING_BREAKS));
  const body = out.slice(0, out.search(TRAILING_BREAKS));
  return body + (ending === "" && merged.at(-1) !== living.at(-1) ? "\n" : ending);
}

/** A requirement's identity as the merge selects it: `Requirement-ID:` when authored, the exact heading otherwise. */
const identity = (r: Pick<Requirement, "id" | "name">): string => (r.id === undefined ? `name:${r.name}` : `id:${r.id}`);

/**
 * Each living requirement's raw slice, joined on its IDENTITY — the slice read
 * back through the same parser that produced `living`, so a slice can only
 * land in place of the requirement it actually is.
 *
 * The join used to be by position, guarded by a count. The two walks agree in
 * order today (one heading-and-fence definition, core/document/parse.ts, and
 * the gate's stray guard refusing any requirement outside the section), but
 * nothing declared that, and equal counts paired differently would have written
 * one requirement's bytes where another belongs — under its vouch stamp, with
 * nothing to say so.
 *
 * Fails closed to the empty map, which serializes every requirement — the old
 * whole-run rewrite, still a correct merge and only a wider diff: when the
 * counts differ, when a slice does not read as exactly one requirement, when
 * two slices claim one identity, or when a living requirement finds no slice
 * of its own.
 */
function verbatimSlices(slices: string[], living: Requirement[]): Map<Requirement, string> {
  const none = new Map<Requirement, string>();
  if (slices.length !== living.length) return none;
  const byIdentity = new Map<string, string>();
  for (const slice of slices) {
    const [only, ...more] = parseRequirements(slice);
    if (only === undefined || more.length > 0 || byIdentity.has(identity(only))) return none;
    byIdentity.set(identity(only), slice);
  }
  const verbatim = new Map<Requirement, string>();
  for (const requirement of living) {
    const slice = byIdentity.get(identity(requirement));
    if (slice === undefined) return none;
    // Taken once: a second living requirement of the same identity finds nothing.
    byIdentity.delete(identity(requirement));
    verbatim.set(requirement, slice);
  }
  return verbatim;
}

/** `text` ending in a blank line: line breaks appended to make one, nothing rewritten. */
function withBlankLine(text: string): string {
  const breaks = text.slice(text.search(TRAILING_BREAKS)).split("\n").length - 1;
  return breaks >= 2 ? text : text + "\n".repeat(2 - breaks);
}
