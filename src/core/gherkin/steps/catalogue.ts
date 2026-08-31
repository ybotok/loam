/**
 * The step catalogue: which phrases somebody has DECIDED the suite defines.
 *
 * ## The decision this file records, because it was the open question
 *
 * `./inventory.ts` answers how many definitions a suite needs. It stops there on
 * purpose — no file, no finding, no stable code — and the gap it leaves is the
 * next ARTIFACT, not the next warning: a team reads the report, writes the glue
 * by hand, and nothing anywhere records which phrases now have definitions, so
 * the report is recomputed from scratch every time instead of diffed against a
 * decision somebody made.
 *
 * The catalogue is **AUTHORED**, not emitted, and it lives in the DOCS repo at
 * `services/<svc>/steps.yaml`. Four things decided it:
 *
 *  - It is a DECISION, not an observation. loam does not read code and must
 *    never present a derived thing as truth (the non-goal is written down); what
 *    a team can say is "these are the phrases we have agreed to define", and
 *    that sentence is an authored document by construction. An emitted
 *    catalogue would have to be derived from a step registry loam cannot read.
 *  - `loam steps` NEEDS NO SERVICE REPO to stand in — that is its own stated
 *    design, and it reads the living specs rather than the emitted `.feature`
 *    files precisely so it answers the same way in a repo that has never run
 *    `loam gherkin`. A catalogue in the service repo would make the comparison
 *    require one, which is a different command.
 *  - The shape rule the glossary and capability trees already settled: an entry
 *    with prose gets a file, an entry WITHOUT prose stays a line in YAML. A
 *    catalogue entry is a phrase and nothing else, so it is a line in YAML — the
 *    same side of that rule `architecture/capabilities.yaml` and
 *    `permissions.yaml` sit on.
 *  - Nothing generated may land inside `<gherkinDir>/loam/`, which `loam
 *    gherkin` owns and overwrites wholesale. Living in the docs repo satisfies
 *    that by construction rather than by a rule somebody has to remember.
 *
 * SERVICE-SCOPED, beside `health.yaml`, because a step registry belongs to one
 * suite and a suite belongs to one service. A fleet-level catalogue would claim
 * one registry across services that do not share a test runner.
 *
 * ## What it does NOT do, and this is the other half of the decision
 *
 * **It gains no stable code, and `loam validate` never reads it.** A phrase
 * written but not catalogued is a work-list row, not a breach: writing a spec
 * ahead of the glue is the normal order, and a check that fires on it is the
 * kind a fleet turns off — at which point the real findings beside it are turned
 * off too. The near-duplicate groups stay a report for the same reason. So this
 * axis costs one document kind and zero codes, and everything it produces is
 * columns in `loam steps`.
 *
 * **It claims nothing about whether the glue exists.** A catalogued phrase is a
 * phrase somebody said they would define; loam cannot see a step registry and
 * does not pretend to. The two columns are named for what they actually mean —
 * written-not-catalogued and catalogued-not-written — and neither says "missing
 * definition".
 *
 * ## The grammar
 *
 * ```yaml
 * steps:
 *   - a payment of 100.00
 *   - Given it is split 60/40
 * ```
 *
 * A list of step TEXTS, not of keys. The key is loam's own spelling — `{n}`,
 * `{s}`, `{p}` collapse, keyword stripped (`./phrase.ts`) — and asking an author
 * to write it would make an internal normalisation a hand-typed contract, where
 * one wrong brace silently catalogues nothing. So an entry is written the way a
 * step is written, with or without its keyword, and loam keys it the same way it
 * keys the written steps it is being compared against. Two entries that collapse
 * onto one key are reported as such rather than merged: that is the author
 * cataloguing one definition twice, which is exactly what the near-duplicate
 * report exists to surface.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import { isRecord } from "../../kernel/records.js";
import { compareIds } from "../../repo/entries.js";
import { phraseOf } from "./phrase.js";
import { type StepInventory } from "./inventory.js";

/** One catalogued phrase: what the author wrote, and the key loam derived from it. */
export interface CatalogueEntry {
  /** The entry exactly as `steps.yaml` spells it. */
  text: string;
  /** The normalized phrase — the same key `./inventory.ts` gives a written step. */
  key: string;
}

/** What `services/<svc>/steps.yaml` says, or the honest refusal to say. */
export interface StepCatalogue {
  /** False when the service has no `steps.yaml` — which is every service until one opts in. */
  present: boolean;
  /**
   * Why the file could not be read, when it exists and does not parse as the
   * grammar above. A REASON rather than a boolean, because the report prints it:
   * "could not look" is only useful if it says what stopped it.
   */
  unreadable?: string;
  /** The catalogued entries, in the order the file lists them. */
  entries: CatalogueEntry[];
}

const ABSENT: StepCatalogue = { present: false, entries: [] };

/**
 * Read one service's catalogue.
 *
 * A missing file is silence, not an error: the axis's opt-in is the file's
 * existence, exactly as `capabilities/`'s is a directory's. Anything present and
 * unparseable is `unreadable` with the reason — never an empty catalogue, which
 * would report every written phrase as uncatalogued and read as a work-list
 * somebody has to do.
 */
export async function readStepCatalogue(path: string): Promise<StepCatalogue> {
  if (!existsSync(path)) return ABSENT;
  let doc: unknown;
  try {
    doc = parseYaml(await readFile(path, "utf8"));
  } catch (e) {
    return { present: true, entries: [], unreadable: e instanceof Error ? e.message : String(e) };
  }
  if (doc === null || doc === undefined) return { present: true, entries: [] };
  if (!isRecord(doc)) return { present: true, entries: [], unreadable: "the document is not a mapping" };
  const block = doc["steps"];
  if (block === undefined) return { present: true, entries: [] };
  if (!Array.isArray(block)) {
    return { present: true, entries: [], unreadable: "`steps` is not a list of step texts" };
  }
  const entries: CatalogueEntry[] = [];
  for (const item of block) {
    // A non-string entry refuses the whole file rather than being skipped. A
    // skipped entry is a phrase silently absent from the catalogue, which prints
    // as "written but not catalogued" — a work-list row invented by a shape
    // error, which is the wrong answer this fails closed to avoid.
    if (typeof item !== "string") {
      return { present: true, entries: [], unreadable: "every `steps` entry must be a step text (a string)" };
    }
    entries.push({ text: item, key: phraseOf(item).key });
  }
  return { present: true, entries };
}

/** The two lists a report needs, plus the entries an author catalogued twice. */
export interface CatalogueComparison {
  /** Written phrase keys the catalogue does not list, most-used first — the work-list. */
  uncatalogued: string[];
  /** Catalogued keys nothing in the living specs writes — a definition with nothing to match. */
  unwritten: string[];
  /** Keys two or more catalogue entries collapse onto, with every spelling. */
  duplicated: Array<{ key: string; texts: string[] }>;
}

/**
 * Written phrases against catalogued ones.
 *
 * ORDER IS THE INVENTORY'S for `uncatalogued` — `inv.phrases` is already sorted
 * count-descending then key-ascending, so the work-list comes out with the
 * phrase that pays back most first, and stays diffable. `unwritten` and
 * `duplicated` have no count to sort on and are sorted by key.
 *
 * The catalogue's own `present`/`unreadable` state is NOT consulted here: this
 * is the comparison, and whether it was worth making is the caller's question.
 * Handing it an unreadable catalogue would produce a full `uncatalogued` list
 * that reads exactly like a real work-list, which is why the caller checks first.
 */
export function compareToCatalogue(inv: StepInventory, catalogue: StepCatalogue): CatalogueComparison {
  const catalogued = new Set(catalogue.entries.map((e) => e.key));
  const written = new Set(inv.phrases.map((p) => p.key));
  const bySpelling = new Map<string, string[]>();
  for (const entry of catalogue.entries) {
    const texts = bySpelling.get(entry.key) ?? [];
    texts.push(entry.text);
    bySpelling.set(entry.key, texts);
  }
  return {
    uncatalogued: inv.phrases.filter((p) => !catalogued.has(p.key)).map((p) => p.key),
    unwritten: [...catalogued].filter((key) => !written.has(key)).sort(compareIds),
    duplicated: [...bySpelling]
      .filter(([, texts]) => texts.length > 1)
      .map(([key, texts]) => ({ key, texts }))
      .sort((a, b) => compareIds(a.key, b.key)),
  };
}
