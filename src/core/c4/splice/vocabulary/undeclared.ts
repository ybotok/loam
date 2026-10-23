/**
 * The specification names the merge's additions would carry into a document
 * that does not declare them — the one class of `merge-failed` that was
 * nobody's to predict.
 *
 * A delta is self-contained: it parses alone, so its own `specification { }`
 * declares every kind and tag it uses, copies of the map's and new ones alike.
 * The archive carries none of that block over. It merges what carries the
 * feature tag, and a declaration in a specification can carry no tag, so a
 * delta's declarations are context exactly as its untagged stubs are (SCHEMA.md,
 * "Which way an edge points" and "Who declares kinds and tags"). An addition
 * drawing `-[publishes]->` on a map that predates the kind therefore lands as a
 * reference to nothing: the merged landscape does not parse and the archive
 * refuses at its parse net, while `validate --feature` and `loam status` had
 * called the feature ready — the delta parses, and nothing at feature scope
 * compared its vocabulary with the map's (0.2.0-alpha.13's known gap).
 *
 * WHAT IS READ IS WHAT IS WRITTEN. The question is asked of the delta ranges the
 * merge carries into each document, after routing has decided where every
 * addition goes, and never of the delta's specification: a kind the delta
 * declares and no addition draws is harmless, and the feature tag every delta
 * declares is stripped on the way over. A RANGE, not the parsed additions,
 * because a new element's block carries children and edges that hold no feature
 * tag of their own — LikeC4 does not inherit tags — and they reach the map in
 * their parent's bytes all the same.
 *
 * AGAINST WHAT EACH DOCUMENT'S PARSE NET READS. The landscape is proved alone
 * (`../landscape-merge.ts`), so only its own specification counts there: a kind
 * declared in another `architecture/` document is not borrowed, which is the
 * rule the splice's own kind reading already follows. An extending model is
 * proved beside the merged map (`commands/archive/plan/model/extending.ts`), so
 * what it declares itself counts for what is routed into it — the tags-only
 * `specification { }` SCHEMA calls legal beside an `extend`.
 *
 * Text-level on purpose. The merge is text surgery and its net is a parse of
 * the text it composed, so the names are read off the same bytes: element kinds
 * through the parsed delta by the scanned id (the scan does not record a kind),
 * relationship kinds as the scan reads them off the arrow, and tags as `#name`
 * tokens in the masked code — never from the parsed tags, which since LikeC4
 * 1.59.0 include those a kind hands down from the delta's own specification and
 * which the spliced text therefore never spells.
 */
import type { Elem, Rel } from "../../likec4.js";
import { maskSource, matchBrace } from "../../source-mask.js";
import { kindsDeclared, type ScannedModel, type ScannedRel } from "../../source-scan.js";
import type { SourceRange } from "../authored-source.js";
import { relStatementKey, scannedStatementKey } from "../identity/edges.js";

/**
 * `../contract.ts`'s `KindTags`, and below its `ModelAdditions`, spelled
 * structurally: the contract imports this module for the refusal it throws, and
 * importing them back would make the two files a cycle.
 */
type KindTagTable = Readonly<Record<string, readonly string[]>>;

/** The three tables of a `specification { }` block whose names a model statement can reference. */
export type SpecificationTable = "element" | "relationship" | "tag";

/** The names one document's `specification` blocks declare, per table. */
export type Vocabulary = Readonly<Record<SpecificationTable, ReadonlySet<string>>>;

/** One name an addition uses that the document it lands in does not declare. */
export interface UndeclaredName {
  table: SpecificationTable;
  name: string;
  /** Repo-relative, `/`-separated: the document whose parse would fail. */
  document: string;
  /** The first declaration that uses it — an element id, or `source -> target`. */
  usedBy: string;
}

/** One document the merge writes additions into, and what its parse net reads them against. */
interface Destination {
  document: string;
  declared: Vocabulary;
  /** The delta ranges carried into it whole. */
  ranges: readonly SourceRange[];
  /** Delta ranges cut out of those on the way — a split block's children, which go elsewhere. */
  omit?: readonly SourceRange[];
}

interface UndeclaredRequest {
  deltaText: string;
  /** The delta's own scan — the same one the merge locates its additions in. */
  scan: ScannedModel;
  /** Every element the delta declares — the kind of a scanned declaration is read from its parse. */
  deltaElements: readonly Elem[];
  featureId: string;
  destinations: readonly Destination[];
}

/** `tag <name>` inside a specification block. A tag starts with a letter or `_`, as a kind does. */
const TAG_DECLARATION = /\btag\s+([A-Za-z_][\w-]*)/g;
/** `#name` in model code — a tag reference. Never inside a word, never a second `#`. */
const TAG_REFERENCE = /(?<![\w#-])#([A-Za-z_][\w-]*)/g;

/**
 * Every name `text`'s `specification` blocks declare. The kinds are
 * `kindsDeclared`'s reading — the splice's own — and the tags are read the same
 * way, off the masked code, so a declaration inside a comment or a string is no
 * declaration here either.
 */
export function declaredVocabulary(text: string): Vocabulary {
  const { kinds, relKinds } = kindsDeclared(text);
  const { code } = maskSource(text);
  const tags = new Set<string>();
  for (const sm of code.matchAll(/\bspecification\s*\{/g)) {
    const close = matchBrace(code, sm.index + sm[0].length - 1);
    if (close === -1) continue;
    for (const tm of code.slice(sm.index, close).matchAll(TAG_DECLARATION)) tags.add(tm[1]!);
  }
  return { element: kinds, relationship: relKinds, tag: tags };
}

/** What two documents declare together — a model's project is the map plus the model. */
function bothDeclare(a: Vocabulary, b: Vocabulary): Vocabulary {
  return {
    element: new Set([...a.element, ...b.element]),
    relationship: new Set([...a.relationship, ...b.relationship]),
    tag: new Set([...a.tag, ...b.tag]),
  };
}

/**
 * The statement each addition is spliced from, matched the way the splice
 * matches it: one fresh pool per document, consumed in addition order, so two
 * statements of one identity hand out their bytes in the order the merge takes
 * them. An addition with no statement is the splice's to refuse, by name.
 */
function statementRanges(rels: readonly Rel[], scan: ScannedModel, kindTags: KindTagTable): ScannedRel[] {
  const pool = new Map<string, ScannedRel[]>();
  for (const s of scan.rels) {
    const k = scannedStatementKey(s, kindTags);
    pool.set(k, [...(pool.get(k) ?? []), s]);
  }
  return rels.flatMap((r) => pool.get(relStatementKey(r))?.shift() ?? []);
}

/** Every name an addition uses that the document it lands in does not declare, first use first. */
function undeclaredNames(req: UndeclaredRequest): UndeclaredName[] {
  const { scan, featureId } = req;
  const { code } = maskSource(req.deltaText);
  // A `#name` the delta does not declare as a tag is no tag — the delta parsed,
  // so every tag its model code spells is one its specification declares.
  const deltaTags = declaredVocabulary(req.deltaText).tag;
  const kindOf = new Map(req.deltaElements.map((e) => [e.id, e.kind]));
  const out: UndeclaredName[] = [];
  const seen = new Set<string>();

  for (const dest of req.destinations) {
    const omit = dest.omit ?? [];
    const kept = (at: SourceRange, range: SourceRange): boolean =>
      at.start >= range.start && at.end <= range.end && !omit.some((o) => at.start >= o.start && at.end <= o.end);
    const note = (table: SpecificationTable, name: string, usedBy: string): void => {
      if (dest.declared[table].has(name)) return;
      const key = JSON.stringify([dest.document, table, name]);
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ table, name, document: dest.document, usedBy });
    };
    for (const range of dest.ranges) {
      const els = scan.elements.filter((e) => e.extend !== true && kept(e, range));
      const rels = scan.rels.filter((r) => kept(r, range));
      for (const e of els) {
        const kind = kindOf.get(e.id);
        if (kind !== undefined) note("element", kind, e.id);
      }
      for (const r of rels) if (r.kind !== undefined) note("relationship", r.kind, `${r.source} -> ${r.target}`);
      // The innermost declaration a tag is written in, which is the one it tags.
      const owner = (at: number): string => {
        const holds = [...els, ...rels].filter((d) => at >= d.start && at < d.end);
        const inner = holds.sort((a, b) => a.end - a.start - (b.end - b.start))[0];
        if (inner === undefined) return "";
        return "id" in inner ? inner.id : `${inner.source} -> ${inner.target}`;
      };
      for (const m of code.slice(range.start, range.end).matchAll(TAG_REFERENCE)) {
        const at = range.start + m.index;
        const name = m[1]!;
        if (name === featureId || !deltaTags.has(name) || omit.some((o) => at >= o.start && at < o.end)) continue;
        note("tag", name, owner(at));
      }
    }
  }
  return out;
}

/** The routed merge, as `../landscape-merge.ts` holds it the moment routing is decided. */
export interface RoutedAdditions {
  landscapeText: string;
  deltaText: string;
  scan: ScannedModel;
  deltaElements: readonly Elem[];
  featureId: string;
  /** The delta's relationship kinds' tags — how a statement is matched to its addition. */
  kindTags: KindTagTable;
  /** What lands on the map, and the split blocks' children its bytes leave behind. */
  map: { els: readonly Elem[]; rels: readonly Rel[]; omit: readonly SourceRange[] };
  /** What each extending model takes — its path, its living text, and its share. */
  models: readonly { model: { path: string; text: string }; els: readonly Elem[]; rels: readonly Rel[] }[];
}

/** The landscape as a finding names it — the merge itself knows the file only as text. */
const MAP_DOCUMENT = "architecture/landscape.likec4";

/**
 * `undeclaredNames` over the documents one routed merge writes: the map, read
 * against its own specification, and each extending model, read against the
 * map's plus its own.
 */
export function additionsUndeclared(req: RoutedAdditions): UndeclaredName[] {
  const { scan, kindTags } = req;
  const byId = new Map(scan.elements.map((e) => [e.id, e]));
  const blocks = (els: readonly Elem[]): SourceRange[] => els.flatMap((e) => byId.get(e.id) ?? []);
  const map = declaredVocabulary(req.landscapeText);
  return undeclaredNames({
    deltaText: req.deltaText,
    scan,
    deltaElements: req.deltaElements,
    featureId: req.featureId,
    destinations: [
      {
        document: MAP_DOCUMENT,
        declared: map,
        ranges: [...blocks(req.map.els), ...statementRanges(req.map.rels, scan, kindTags)],
        omit: req.map.omit,
      },
      ...req.models.map((m) => ({
        document: m.model.path,
        declared: bothDeclare(map, declaredVocabulary(m.model.text)),
        ranges: [...blocks(m.els), ...statementRanges(m.rels, scan, kindTags)],
      })),
    ],
  });
}

/** The specification line that declares `u` — what the author writes, verbatim. */
export function declarationLine(u: Pick<UndeclaredName, "table" | "name">): string {
  return `${u.table} ${u.name}`;
}

/**
 * The sentence both sides of the archive print for the same fact: the merge,
 * as its refusal, and the feature gate, as its finding. One spelling, so the
 * prediction and the refusal cannot drift apart in what they ask an author to do.
 */
export function undeclaredMessage(missing: readonly UndeclaredName[]): string {
  const byLine = new Map<string, UndeclaredName[]>();
  for (const u of missing) byLine.set(declarationLine(u), [...(byLine.get(declarationLine(u)) ?? []), u]);
  const uses = [...byLine]
    .map(([line, us]) => `\`${line}\` (by ${us.map((u) => `${u.usedBy}, landing in ${u.document}`).join("; ")})`)
    .join(", ");
  const lines = [...byLine.keys()].map((line) => `\`${line}\``).join(", ");
  return (
    `the delta's additions use ${uses}, which architecture/landscape.likec4's specification does not declare. ` +
    `The archive never copies a specification declaration — the delta's own is the copy that lets it parse alone — ` +
    `so what it would write does not parse, and it refuses. Declare ${lines} in architecture/landscape.likec4's ` +
    `specification, in this change or before it`
  );
}
