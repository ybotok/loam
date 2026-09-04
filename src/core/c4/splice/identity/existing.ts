/**
 * Which of a delta's tagged declarations the living fleet does NOT already have
 * — the third identity question of the archive's C4 merge, beside `./edges.ts`'s
 * "which statement is this" and `./owner.ts`'s "which document owns it".
 *
 * It moved out of `../landscape-merge.ts` when that file crossed the 400-line
 * limit, and this is the seam it wanted: everything here runs BEFORE a single
 * byte is placed, over parsed views and scans alone, and answers one question
 * that has nothing to do with where anything lands. What is left behind is the
 * splice itself.
 *
 * TWO JOINS, and the asymmetry between them is the whole subject. Ids are exact
 * and are checked against the map AND against every extending model, so
 * re-archiving is idempotent whichever document an addition landed in. Titles
 * are the id-less fallback every repository written before
 * `metadata { service }` relies on: global on the map (with the cross-service
 * collision refused rather than silently skipped) and scoped to one service in
 * the models, for the reason `./declared.ts` states.
 *
 * Relationships are matched by COUNT, not by membership: two edges the model
 * cannot tell apart are still two edges, and dropping the second one silently
 * loses a call the author drew.
 */
import type { Elem, Rel } from "../../likec4.js";
import { scanModel } from "../../source-scan.js";
import type { ExtendingModel } from "../contract.js";
import { modelDeclarations } from "./declared.js";
import { relKey } from "./edges.js";

export interface ExistingRequest {
  /** The living map's parsed elements. */
  livingEls: Elem[];
  /** The living map's parsed relationships. */
  livingRels: Rel[];
  /**
   * The corpus a service binding resolves against — the living map's elements
   * plus the delta's, so a declaration the delta introduces resolves the moment
   * its bytes would land.
   */
  bindEls: Elem[];
  /** EVERY element the delta declares — edge identity reads past the tagged ones. */
  deltaElements: Elem[];
  /** The delta's tagged elements and relationships: the candidate additions. */
  candidates: { els: Elem[]; rels: Rel[] };
  /** The fleet's extending models, whose declarations count as existence too. */
  models: readonly ExtendingModel[];
}

export interface Additions {
  /** The tagged elements no living document already declares. */
  els: Elem[];
  /** The tagged relationships no living document already draws. */
  rels: Rel[];
  /**
   * Every id the extending models declare. Routing needs it as well: an
   * `extend` block's children are map fqns, so a container a model already draws
   * anchors an addition's id chain in the map's namespace exactly as a living
   * element does (`./owner.ts`).
   */
  declaredIds: Set<string>;
  /**
   * A title join the merge must refuse rather than take, present only when one
   * was found — the caller stops there and nothing is written.
   *
   * REPORTED, not thrown, and that is a package rule rather than a style
   * preference: `LandscapeSpliceError` lives in `../contract.ts`, and importing
   * it as a VALUE from here would make `splice/` and `splice/identity/` import
   * each other (`scripts/package-graph.mjs` refuses the cycle). The refusal text
   * belongs to the merge anyway — it is the one that decides to write.
   */
  collision?: { addition: Elem; living: Elem };
}

/**
 * Report (never guess) when a title join would cross two bound services: with
 * both sides carrying an explicit `metadata { service }` binding and every
 * binding disagreeing, they are provably DIFFERENT services' boxes sharing a
 * title ('API', 'Database'). Skipping would silently drop the addition, and any
 * delta edge into it would then refuse the whole archive at the merge's parse
 * net with a message about nothing.
 */
export function newAdditions(req: ExistingRequest): Additions {
  const { livingEls, livingRels, bindEls, deltaElements, candidates, models } = req;
  const modelScans = models.map((model) => ({ scan: scanModel(model.text) }));
  const declared = modelDeclarations(modelScans, bindEls);
  const haveIds = new Set([...livingEls.map((e) => e.id), ...declared.ids]);
  // The title join needs the matched element back, not just membership: the
  // cross-service guard below compares service BINDINGS across the join.
  const byTitle = new Map<string, Elem[]>();
  const seeTitle = (el: Elem): void => {
    byTitle.set(el.title, [...(byTitle.get(el.title) ?? []), el]);
  };
  for (const el of livingEls) seeTitle(el);
  const els: Elem[] = [];
  for (const e of candidates.els) {
    if (haveIds.has(e.id)) continue;
    // The addition's OWN service first, and before the map's global title
    // index: a box this service's model already draws is existence, whoever
    // else on the map happens to share the title.
    if (declared.declaresTitle(e.id, e.title)) continue;
    const sameTitle = byTitle.get(e.title);
    if (sameTitle !== undefined) {
      // A title match is the id-less fallback join, and skipping on it is only
      // safe when the two sides could be the same box.
      if (e.service !== undefined && sameTitle.every((m) => m.service !== undefined && m.service !== e.service)) {
        return { els, rels: [], declaredIds: new Set(declared.ids), collision: { addition: e, living: sameTitle[0]! } };
      }
      // KNOWN (narrowed by the guard above): with EITHER side unbound the title
      // join stays trusting — the unbound title-fallback is the legal legacy
      // pattern — so a cross-service collision hiding behind an unbound element
      // is still silently skipped here. Scoping titles per service is backlog.
      continue;
    }
    haveIds.add(e.id);
    seeTitle(e);
    els.push(e);
  }

  // An edge already in the landscape consumes one delta edge of the same
  // identity, which is what keeps re-archiving idempotent.
  const have = new Map<string, number>();
  for (const r of livingRels) {
    const k = relKey(livingEls, r);
    have.set(k, (have.get(k) ?? 0) + 1);
  }
  // An edge an extending model already draws consumes a delta edge exactly as a
  // living map edge does — keyed through the DELTA's elements, because the
  // model spells its endpoints in the map's fqn namespace and the delta must
  // too for the nesting to resolve at all.
  for (const { scan } of modelScans) {
    for (const r of scan?.rels ?? []) {
      const k = relKey(deltaElements, r);
      have.set(k, (have.get(k) ?? 0) + 1);
    }
  }
  const rels: Rel[] = [];
  for (const r of candidates.rels) {
    const k = relKey(deltaElements, r);
    const n = have.get(k) ?? 0;
    if (n > 0) {
      have.set(k, n - 1);
      continue;
    }
    rels.push(r);
  }
  return { els, rels, declaredIds: new Set(declared.ids) };
}
