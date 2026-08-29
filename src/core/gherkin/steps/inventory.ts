/**
 * The step-phrase inventory: how many DEFINITIONS a service's suite actually
 * needs, and which written steps collapse onto each one.
 *
 * ## What this is for
 *
 * Generated `.feature` files are only a suite if somebody writes the glue, and
 * the glue is where a generated suite dies: the step text is free prose from a
 * spec bullet, so the same precondition gets three spellings across three
 * requirements and the registry grows without bound until people quietly go
 * back to hand-written tests. Nothing in loam could previously say how bad that
 * was, which meant nobody could tell a suite that needs forty definitions from
 * one that needs four hundred.
 *
 * Measured on a real twelve-scenario component-test file, 324 written steps
 * collapse to 97 phrases, and 34 of those cover 82% of every step — so the
 * report is not an audit, it is the work-list a team writes glue from, and the
 * draft of any step catalogue that comes later.
 *
 * ## What it deliberately is NOT
 *
 * It emits no finding and no stable code. A near-duplicate is a judgement about
 * writing, and a phrase-similarity WARNING is the kind of check a fleet turns
 * off — at which point the real findings beside it are turned off too. It reads
 * the LIVING specs rather than the emitted files, so it answers the same way in
 * a repo that has never run `loam gherkin` and needs no service repo to stand
 * in.
 */
import { scenarioGherkin } from "../../vocabulary/steps.js";
import { type Requirement } from "../../document/spec.js";
import { keywordOf, phraseOf } from "./phrase.js";

/** Where one written step lives, for the reader who wants to go and look. */
export interface PhraseUse {
  requirement: string;
  scenario: string;
  /** "business" or "arch" — the two spec files are two namespaces everywhere else too. */
  axis: string;
  /** The step exactly as the spec writes it, keyword included. */
  text: string;
}

export interface PhraseRow {
  /** The normalized phrase — one step definition serves every use under it. */
  key: string;
  /** How many written steps collapse onto this key. */
  count: number;
  /** The Gherkin keywords this phrase appears under, sorted — a runner resolves them as one. */
  keywords: string[];
  uses: PhraseUse[];
}

/** Phrases that share a family and not a key: two definitions where one was probably meant. */
export interface NearDuplicates {
  family: string;
  keys: string[];
}

export interface StepInventory {
  /** Total written steps across every scenario of both axes. */
  steps: number;
  /** Distinct phrases, most-used first, then alphabetically so the report is stable. */
  phrases: PhraseRow[];
  nearDuplicates: NearDuplicates[];
}

/** One spec file's requirements, with the axis label the whole product speaks. */
export interface InventoryAxis {
  axis: string;
  reqs: Requirement[];
}

/**
 * Count the phrases across both axes of one service.
 *
 * REMOVED requirements are skipped, exactly as every other scenario check skips
 * them: a step nobody will run is not glue anybody owes.
 *
 * Ordering is count-descending then key-ascending, and that second key is what
 * makes the report diffable — two phrases used once each must not swap places
 * between runs because a Map happened to iterate differently.
 */
export function stepInventory(axes: readonly InventoryAxis[]): StepInventory {
  const byKey = new Map<string, PhraseRow>();
  const families = new Map<string, Set<string>>();
  let steps = 0;
  for (const { axis, reqs } of axes) {
    for (const r of reqs) {
      if (r.kind === "REMOVED") continue;
      for (const s of r.scenarios) {
        for (const st of scenarioGherkin(s.lines).steps) {
          steps += 1;
          const { key, family } = phraseOf(st.text);
          const row = byKey.get(key) ?? { key, count: 0, keywords: [], uses: [] };
          row.count += 1;
          const kw = keywordOf(st.text);
          if (kw.length > 0 && !row.keywords.includes(kw)) row.keywords.push(kw);
          row.uses.push({ requirement: r.name, scenario: s.name, axis, text: st.text });
          byKey.set(key, row);
          const seen = families.get(family) ?? new Set<string>();
          seen.add(key);
          families.set(family, seen);
        }
      }
    }
  }
  const phrases = [...byKey.values()]
    .map((row) => ({ ...row, keywords: [...row.keywords].sort() }))
    .sort((a, b) => b.count - a.count || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const nearDuplicates = [...families.entries()]
    .filter(([, keys]) => keys.size > 1)
    .map(([family, keys]) => ({ family, keys: [...keys].sort() }))
    .sort((a, b) => (a.family < b.family ? -1 : a.family > b.family ? 1 : 0));
  return { steps, phrases, nearDuplicates };
}

/**
 * How many phrases cover `share` of every written step — the one number that
 * says whether the glue is a morning's work or a quarter's.
 *
 * Returns zero for an empty suite rather than dividing by it, because "0 of 0
 * steps" is the honest reading of a service that has written no scenarios yet.
 */
export function coveringPhrases(inv: StepInventory, share = 0.8): number {
  if (inv.steps === 0) return 0;
  const target = inv.steps * share;
  let running = 0;
  let n = 0;
  for (const row of inv.phrases) {
    if (running >= target) break;
    running += row.count;
    n += 1;
  }
  return n;
}
