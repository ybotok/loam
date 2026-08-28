/**
 * What `loam new --capability <id>` says about the capability it just scaffolded
 * a delta for.
 *
 * NOTES, NEVER REFUSALS, and the whole judgement is in that word. A capability
 * the fleet has never named is exactly what an analyst opening a new business
 * area types, and it is the case the flag exists for: `--touches <services>`
 * asks for the services before the business change is written, and inverting
 * that only works if naming a new promise is the ordinary path rather than the
 * refused one. The archive that lands this feature is what creates
 * `capabilities/<id>/spec.md` (`commands/archive/plan/specs.ts`), so there is
 * nothing to declare first.
 *
 * THE OTHER READING STAYS AVAILABLE IN THE MESSAGE. The failure a refusal would
 * have caught is the typo — `payments/refund` against a living
 * `payments/refunds` is a second capability created out of nothing, with the
 * promise filed where nobody looks — so the close names are spelled out
 * alongside, exactly as `--touches`' own near-miss note spells them, together
 * with the way back out. That is the same trade `unknownServiceNotes` makes in
 * `commands/new/new.ts`, and it is deliberate that the two flags behave alike:
 * "names something that does not exist yet" is legitimate on both.
 *
 * THE NEAR-MISS RULE IS `nearestIds`, NOT `closeIds`, and on this axis the two
 * disagree loudly. `closeIds` matches on substring either way, so
 * `payments/refunds` reports its own PARENT `payments` as a candidate — nesting
 * spelled by the tree is the axis's headline shape, and a note telling an author
 * their new sub-capability is a misspelling of the group it sits in is worse
 * than no note. `nearestIds` is the edit-distance "did you misspell a directory"
 * rule, which is the question actually being asked here, and
 * `core/repo/entries.ts` states that division at its own definition.
 *
 * THE WAY OUT NAMES THIS FEATURE'S DIRECTORY, never `features/`. loam ships
 * instructions people and agents type back; `features/` holds every in-flight
 * feature in a SHARED docs repo, so an instruction to delete it is an
 * instruction to destroy other authors' work. `dirName` is threaded in for that
 * one sentence — the same care `validate/feature.ts` takes to spell
 * `features/FEAT-1-split/` rather than `features/FEAT-1/`.
 *
 * WHAT IT DOES NOT SAY, and why not: which services realize this capability
 * today. `capabilityRollup` knows, and the line would be useful, but it walks
 * every service's `spec.md` AND `arch.spec.md` across the whole fleet — a cost
 * proportional to the service tree, paid by a command whose job is to create
 * four files, and `loam new` sits in the authoring hot path. `loam list
 * capabilities` already computes exactly that answer and the note points at it.
 * The half that IS read here is the one an author cannot write the delta
 * without — the living document's own requirement ids, which is what a MODIFIED
 * section addresses and what an ADDED section must not repeat — and that is one
 * file, the very file this delta diffs against.
 *
 * IN CORE, not beside the command, for the rule the command layer is held to:
 * `commands/` parses arguments, calls core and prints. Which of a fleet's two
 * vocabularies declared an id, and which of a capability's requirements are
 * addressable, are questions about the DOCUMENTS — the same questions
 * `../findings.ts` answers as findings — and the only thing this module does
 * differently is answer them for a person who has not written anything yet.
 */
import { readFile } from "node:fs/promises";
import { compareIds, nearestIds } from "../../repo/entries.js";
import { parseRequirements } from "../../document/parse.js";
import { readCapabilityVocabulary } from "../capabilities.js";
import type { DocsDir } from "../../kernel/ids/dirs.js";

/** Which feature was just scaffolded, and which promises it named. */
export interface CapabilityNoteScope {
  /** The feature's directory NAME (`FEAT-1-split`) — what the way-out sentence spells. */
  dirName: string;
  /** The `--capability` ids, in the order they were given. */
  ids: readonly string[];
}

/**
 * One note per `--capability` id: is this promise already declared, and if so
 * what does it already say?
 *
 * The vocabulary read is the UNION of `architecture/capabilities.yaml` and the
 * `capabilities/` tree, never one side, for the reason `capabilities.ts` states:
 * a second spelling of "the vocabulary" is a second answer to whether an id is
 * known, and this note and `capability.unknown` must not be able to disagree.
 */
export async function capabilityNotes(docsDir: DocsDir, scope: CapabilityNoteScope): Promise<string[]> {
  if (scope.ids.length === 0) return [];
  const vocab = await readCapabilityVocabulary(docsDir);
  const declared = [...vocab.byId.keys()].sort(compareIds);
  const notes: string[] = [];
  for (const id of scope.ids) {
    const known = vocab.byId.get(id);
    if (known === undefined) {
      const near = nearestIds(id, declared);
      notes.push(
        `--capability '${id}' is a capability this fleet has not named yet — nothing declares it in ` +
          `architecture/capabilities.yaml or capabilities/${id}/spec.md. That is legal and often the point: ` +
          `archiving this feature CREATES capabilities/${id}/spec.md from the delta just scaffolded` +
          (near.length === 0
            ? "."
            : `. If you meant an existing one — ${near.map((n) => `'${n}'`).join(" or ")} — rename ` +
              `features/${scope.dirName}/capabilities/${id}/ to that spelling, or delete features/${scope.dirName}/ and re-run \`loam new\`.`),
      );
      continue;
    }
    if (known.spec === undefined) {
      // Declared in the YAML with no document behind it: the ordinary
      // mid-adoption state, and the one case where this feature is writing the
      // fleet's first prose for a word it already had.
      notes.push(
        `--capability '${id}' is declared in architecture/capabilities.yaml but has no capabilities/${id}/spec.md yet — ` +
          "this feature's delta is the first prose behind that word, and archiving it writes the document.",
      );
      continue;
    }
    notes.push(livingNote(id, await requirementIds(known.spec)));
  }
  return notes;
}

/**
 * The living document's requirement ids, in document order.
 *
 * A requirement WITHOUT a `Requirement-ID:` is skipped rather than named by its
 * heading, matching every other reader on this axis: nothing can address it, so
 * offering the heading as an address would teach exactly the identity-by-heading
 * `capability.requirement-unidentified` refuses.
 *
 * An unreadable document is NOT fatal here. This is a note printed after the
 * scaffold has already committed, and the alternative — throwing out of a
 * successful `loam new` — would report the write as a failure. `loam validate`
 * owns the diagnosis of a living document nobody can read.
 */
async function requirementIds(spec: string): Promise<string[] | null> {
  try {
    return parseRequirements(await readFile(spec, "utf8")).flatMap((r) =>
      r.kind === "REMOVED" || r.id === undefined ? [] : [r.id],
    );
  } catch {
    return null;
  }
}

/** The note for a capability that already has a document — what the delta is a diff against. */
function livingNote(id: string, ids: string[] | null): string {
  const head = `--capability '${id}' already has capabilities/${id}/spec.md`;
  if (ids === null) return `${head}, which could not be read — run \`loam validate --all\` before authoring against it.`;
  if (ids.length === 0) {
    return (
      `${head}, and it declares no identified requirements yet — everything in this delta is an ADDED promise. ` +
      "`loam list capabilities` shows what the fleet already realizes."
    );
  }
  // The ids, not a count: a MODIFIED section addresses one of these and an
  // ADDED one must not repeat it, so the list IS the thing the author needs in
  // front of them. Capped, because a long-lived capability can carry dozens and
  // a note that scrolls is a note nobody reads.
  const shown = ids.slice(0, 8);
  return (
    `${head}, declaring ${ids.length} identified requirement(s): ${shown.join(", ")}` +
    (ids.length > shown.length ? `, … (\`loam show\` for the rest)` : "") +
    ". A MODIFIED section addresses one of those ids; an ADDED one must not repeat it. " +
    "`loam list capabilities` shows which services realize them today."
  );
}
