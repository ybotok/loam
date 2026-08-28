/**
 * The architectural obligation axis, graded against the fleet it is about.
 *
 * `core/obligations/obligations.ts` states what the axis IS and why it has this
 * shape. This module is the four questions asked of a fleet that has one, and
 * the order they are asked in — the same division `checks/fleet-shape.ts` keeps
 * for the authorization and capability vocabularies, which this sits beside on
 * the `landscape` target for their reason: an obligation crosses services by
 * construction, so no service target can answer for it.
 *
 * THE FOUR ARE TWO PAIRS, and each pair is one join read in both directions.
 * A tag nothing declares is an ERROR (`obligation.unknown`) and a declaration
 * nothing tags is a WARNING (`obligation.unapplied`) — exactly the asymmetry
 * `permissions.unknown`/`permissions.unenforced` already carry, and for the
 * same reason: a typo in a tag reads like a rule, while a word nobody has
 * adopted yet is an honest state. Then a tagged object no requirement covers is
 * a WARNING (`obligation.uncovered`) and an `adr:` naming no file is an ERROR
 * (`obligation.adr-missing`): the team's work being outstanding is normal, and
 * a pointer at a decision nobody can read is not.
 *
 * `obligation.uncovered` IS THE PREREQUISITE THE ROADMAP NAMED. `c4.uncovered`
 * has always been able to say "this architecture object owes a requirement",
 * but only about a NEW tagged element in a feature's `delta.likec4` — never
 * about the map the fleet actually runs on. This asks the same question of the
 * LIVING landscape, against the union of every service's living `arch.spec.md`
 * `Covers:` lines, which is the index that did not exist before.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { type Elem, type LoadedDoc, type Rel } from "../../../core/c4/likec4.js";
import { closeIds, coversEdge, coversElement, type CoversEntry } from "../../../core/c4/arch.js";
import { elementService } from "../../../core/c4/resolve/service.js";
import { OBLIGATION_TAG_PREFIX, type ObligationVocabulary } from "../../../core/obligations/obligations.js";
import { servicePathsAt } from "../../../core/repo/paths.js";
import { type ServiceEntry } from "../../../core/repo/entries.js";
import { type Finding } from "../../../core/vocabulary/report.js";
import { FleetContext } from "../../../core/fleet-context.js";
import { readRequirementsDocument, parseRequirements } from "../../../core/document/parse.js";
import { coversEntries } from "../checks/requirements.js";
import type { DocsDir } from "../../../core/kernel/ids/dirs.js";

export interface ObligationCheck {
  docsDir: DocsDir;
  vocabulary: ObligationVocabulary;
  /**
   * The living landscape, PARSED. Not nullable, and the absence is the point:
   * the landscape target returns before it reaches this call when the map is
   * missing or did not parse, so a run that could not read the map asks none of
   * the three questions below rather than answering them empty. "Loam did not
   * look" is never the same answer as "there is nothing there" — an unreadable
   * map graded as empty would report every declared obligation as applied
   * nowhere — and the suspension lives at the call site because that is where
   * the fact is known. It is also why the vocabulary half is a separate
   * function: those two verdicts must survive exactly those early returns.
   */
  land: LoadedDoc;
  services: ServiceEntry[];
  fleet?: FleetContext;
}

/**
 * The half that does not depend on the map: the file reads, and its `adr:`
 * pointers resolve.
 *
 * Separate from the map questions because the landscape target returns early
 * twice — an absent map, and one that did not parse — and a broken vocabulary
 * must still be named in exactly the runs where somebody is fixing something
 * else. The same placement `permissionFindings` and `capabilityFleetFindings`
 * already have, one level of precision finer.
 */
export function obligationVocabularyFindings(docsDir: DocsDir, vocabulary: ObligationVocabulary): Finding[] {
  if (!vocabulary.present) return [];
  if (vocabulary.invalid !== undefined) {
    // Reported ALONE, exactly as `permissions.invalid` and `capability.invalid`
    // are: every `#obl-` tag in the fleet resolves against this file, so grading
    // them on top of a broken vocabulary is a cascade, not a diagnosis.
    return [
      {
        severity: "error",
        code: "obligation.invalid",
        message:
          `landscape: architecture/obligations.yaml does not read as a vocabulary — ${vocabulary.invalid}. ` +
          "Every `#obl-` tag on the fleet map resolves against this file, so none of them can be graded until it parses. " +
          "The shape is `obligations: {<id>: {description, adr}}`, ids spelled with letters, digits, `_` and `-` only.",
      },
    ];
  }

  return adrFindings(docsDir, [...vocabulary.byId.values()]);
}

/** The three questions that need the map, suspended entirely when it could not be read. */
export async function obligationFindings(check: ObligationCheck): Promise<Finding[]> {
  const { vocabulary } = check;
  if (!vocabulary.present || vocabulary.invalid !== undefined) return [];
  const findings: Finding[] = [];

  // Which objects carry which obligation. Elements and edges are collected
  // together because every question below treats them alike: an obligation
  // applies to a thing on the map, and whether that thing is a box or an arrow
  // changes only how the message spells it and how `Covers:` matches it.
  const tagged = taggedObjects(check.land);
  const applied = new Set(tagged.map((t) => t.obligation));

  for (const id of [...applied].sort()) {
    if (vocabulary.byId.has(id)) continue;
    const close = closeIds(id, [...vocabulary.byId.keys()]);
    findings.push({
      severity: "error",
      code: "obligation.unknown",
      subject: id,
      message:
        `landscape: #${OBLIGATION_TAG_PREFIX}${id} tags ${count(tagged.filter((t) => t.obligation === id).length, "object")} on the fleet map, ` +
        `and architecture/obligations.yaml declares no obligation '${id}'` +
        (close.length > 0 ? ` — did you mean: ${close.join(", ")}?` : "") +
        ". A tag that resolves to nothing reads exactly like a rule the fleet keeps: declare it, or fix the tag.",
      details: tagged.filter((t) => t.obligation === id).map((t) => t.where),
    });
  }

  const unapplied = [...vocabulary.byId.keys()].filter((id) => !applied.has(id)).sort();
  if (unapplied.length > 0) {
    findings.push({
      severity: "warn",
      code: "obligation.unapplied",
      message:
        `landscape: ${unapplied.length} declared obligation(s) that no \`#${OBLIGATION_TAG_PREFIX}\` tag applies anywhere on the fleet map — ` +
        "either a decision that was reversed and left its word behind, or one nobody has placed yet. " +
        "Tag the elements and edges it governs, or drop the declaration; a vocabulary is worth what cites it.",
      details: unapplied,
    });
  }

  // ONLY A RESOLVED APPLICATION IS ASKED ABOUT COVERAGE. A tag naming no
  // declared obligation has already earned its error above, and "no requirement
  // covers #obl-typo" is not a second breach — it is the same one restated in
  // words that ask the reader to write a requirement for a rule that does not
  // exist. The use-case axis draws this line in the same place: only a resolved
  // `#cap-` claim keeps a promise.
  findings.push(...(await uncoveredFindings(check, tagged.filter((t) => vocabulary.byId.has(t.obligation)))));
  return findings;
}

/** One place an obligation is applied: which obligation, on what, and how a message names it. */
interface TaggedObject {
  obligation: string;
  /** The element, or the edge — exactly one is set. */
  element?: Elem;
  edge?: Rel;
  /** How the finding spells this object: an element id, or `source -> target`. */
  where: string;
  /** What the finding is filed under — the service that owns it, where one does. */
  subject: string;
}

/**
 * Every `#obl-` tag on the living map, one entry per (obligation, object) pair.
 *
 * A bare `#obl-` slugs to the empty string and is kept as an application on
 * purpose, exactly as a bare `#cap-` is kept as a claim: the prefix is the
 * author's opt-in however little follows it, and dropping it as unreserved
 * would leave an object that asked to be graded silently ungraded. It then
 * resolves to `obligation.unknown` in every fleet that did not declare an empty
 * id, which is the honest answer.
 */
function taggedObjects(land: LoadedDoc): TaggedObject[] {
  const out: TaggedObject[] = [];
  for (const element of land.elements) {
    for (const tag of element.tags.filter((t) => t.startsWith(OBLIGATION_TAG_PREFIX))) {
      out.push({
        obligation: tag.slice(OBLIGATION_TAG_PREFIX.length),
        element,
        where: element.id,
        subject: elementService(element),
      });
    }
  }
  for (const edge of land.relationships) {
    for (const tag of edge.tags.filter((t) => t.startsWith(OBLIGATION_TAG_PREFIX))) {
      out.push({
        obligation: tag.slice(OBLIGATION_TAG_PREFIX.length),
        edge,
        where: `${edge.source} -> ${edge.target}`,
        subject: edge.target,
      });
    }
  }
  return out;
}

/**
 * `obligation.uncovered` — a tagged object no living arch requirement covers.
 *
 * The index is the union of EVERY service's living `arch.spec.md` `Covers:`
 * lines, because an obligation is placed by the architect on the map and met by
 * whichever team owns the thing it sits on — and a per-service index would
 * report an edge as uncovered because the requirement that covers it lives in
 * the service at the other end. `coversEntries` already drops REMOVED
 * requirements: a retired requirement covers nothing.
 *
 * ONE FINDING PER TAGGED OBJECT, subject = the service that owns it, so a
 * fleet-wide report reads as a worklist per team rather than as one line naming
 * forty edges.
 */
async function uncoveredFindings(check: ObligationCheck, tagged: TaggedObject[]): Promise<Finding[]> {
  if (tagged.length === 0) return [];
  const covers = await livingCovers(check);
  const elements = check.land.elements;
  const known = new Set(check.services.map((s) => s.id));
  return tagged
    .filter((t) =>
      t.element !== undefined
        ? !covers.some((c) => coversElement(c, t.element!))
        : !covers.some((c) => coversEdge(c, t.edge!, elements, known)),
    )
    .map((t) => ({
      severity: "warn" as const,
      code: "obligation.uncovered",
      subject: t.subject,
      message:
        `${t.where} carries #${OBLIGATION_TAG_PREFIX}${t.obligation} and no living arch requirement covers it — ` +
        `the obligation is placed and nothing says it is met. Write the requirement in ${t.subject}'s arch.spec.md with ` +
        `\`Covers: ${t.where}\` and a scenario that proves it, or drop the tag if the decision no longer applies here.`,
    }));
}

/**
 * Every `Covers:` entry the LIVING fleet writes, across both requirement
 * documents of every service.
 *
 * Existence is checked for both files and for the same reason
 * `permissionFindings` checks it: `arch.spec.md` is optional and most of a
 * legacy fleet has none, while `spec.md` is missing on a half-adopted service —
 * and `FleetContext.readRequirements` throws ENOENT, which surfaces as
 * `repository-unavailable` and takes the whole `--all` run down. Both axes are
 * read, not only the architecture one: `Covers:` is parsed everywhere for one
 * grammar's sake, and a fleet that wrote its outbox requirement in `spec.md`
 * has said the thing loam is asking about.
 */
async function livingCovers(check: ObligationCheck): Promise<CoversEntry[]> {
  const entries: CoversEntry[] = [];
  for (const service of check.services) {
    const paths = servicePathsAt(service.dir);
    for (const path of [paths.spec, paths.archSpec]) {
      if (!existsSync(path)) continue;
      const reqs =
        check.fleet === undefined
          ? parseRequirements(await readRequirementsDocument(path))
          : await check.fleet.readRequirements(path);
      entries.push(...coversEntries(reqs));
    }
  }
  return entries;
}

/**
 * `obligation.adr-missing` — an `adr:` path that names no file.
 *
 * The path is relative to the docs repo root rather than to
 * `architecture/obligations.yaml`, because that is how a reader of a fleet
 * document thinks about a fleet path, and because the value is a YAML field
 * rather than a markdown link — `link.unresolved` grades links written in prose,
 * and this one is written in a slot loam defined.
 */
function adrFindings(docsDir: DocsDir, obligations: readonly { id: string; adr?: string }[]): Finding[] {
  return obligations
    .filter((o) => o.adr !== undefined && !existsSync(join(docsDir, o.adr)))
    .map((o) => ({
      severity: "error" as const,
      code: "obligation.adr-missing",
      subject: o.id,
      message:
        `landscape: obligation '${o.id}' names \`adr: ${o.adr!}\` and no such file exists — ` +
        "the ADR is where the decision itself is written, so a pointer at nothing leaves every tag citing a rule nobody can read. " +
        "Fix the path (it is relative to the docs repo root), write the record, or drop the field.",
    }));
}

/** `1 object` / `3 objects` — the plural spelled once, because three messages count things. */
function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}
