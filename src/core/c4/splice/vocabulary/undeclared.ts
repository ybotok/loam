/**
 * The specification names the merge's additions would carry into a document
 * whose parse cannot see them declared.
 *
 * A delta is self-contained: it parses alone, so its own `specification { }`
 * declares every kind, tag and custom color it uses, copies of the map's and
 * new ones alike. The archive carries none of that block over. It merges what
 * carries the feature tag, and a declaration in a specification can carry no
 * tag, so a delta's declarations are context exactly as its untagged stubs are
 * (SCHEMA.md, "Which way an edge points" and "Who declares kinds and tags"). An
 * addition drawing `-[publishes]->` on a map that predates the kind therefore
 * lands as a reference to nothing: the merged document does not parse and the
 * archive refuses at its parse net, while `validate --feature` and `loam status`
 * had called the feature ready — the delta parses, and nothing at feature scope
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
 * AGAINST WHAT EACH DOCUMENT'S PARSE NET READS. The landscape is proved ALONE
 * (`../landscape-merge.ts`), so only its own specification counts there — which
 * is why a name another `architecture/` document declares is reported for it
 * too, as a declaration to MOVE rather than one to add: declared twice, it is a
 * duplicate in the project the renderer reads. An extending model is proved
 * inside the `architecture/` project with the merged map in it
 * (`commands/archive/plan/model/extending.ts`, `modelMergeErrors`), so what that
 * project declares serves what is routed into the model, and so does the model's
 * own tags-only `specification { }`, which SCHEMA calls legal beside an `extend`.
 *
 * Text-level on purpose. The merge is text surgery and its net is a parse of
 * the text it composed, so the names are read off the same bytes: element kinds
 * through the parsed delta by the scanned id (the scan does not record a kind),
 * relationship kinds as the scan reads them off the arrow, tags as `#name` and
 * custom colors as `color <name>` tokens in the masked code — never from the
 * parsed tags, which since LikeC4 1.59.0 include those a kind hands down from
 * the delta's own specification and which the spliced text therefore never
 * spells. Each token is kept only when the delta declares it, which is what
 * keeps a built-in color (`color amber`) and a stray `#` out.
 */
import type { Elem, Rel } from "../../likec4.js";
import { maskSource, matchBrace } from "../../source-mask.js";
import { kindsDeclared, type ScannedModel, type ScannedRel } from "../../source-scan.js";
import type { SourceRange } from "../authored-source.js";
import type { KindTags, ModelAdditions } from "../contract.js";
import { relStatementKey, statementPool } from "../identity/edges.js";

/**
 * The four tables of a `specification { }` block a model statement can
 * reference. Deployment node kinds are the fifth, and no merge carries one: a
 * delta's `deployment { }` block is refused before anything is planned
 * (`../delta-blocks.ts`).
 */
export type SpecificationTable = "element" | "relationship" | "tag" | "color";

/** The names one document's `specification` blocks declare, per table. */
export type Vocabulary = Readonly<Record<SpecificationTable, ReadonlySet<string>>>;

/** One name an addition uses that the document it lands in cannot see declared. */
export interface UndeclaredName {
  table: SpecificationTable;
  name: string;
  /** Repo-relative, `/`-separated: the document whose parse would fail. */
  document: string;
  /** The first declaration that uses it — an element id, or `source -> target`. */
  usedBy: string;
  /** The delta's own declaration, verbatim, where the name alone is not one: a custom color carries its value. */
  declaration?: string;
  /** Another `architecture/` document that declares it, out of sight of a document proved alone. */
  declaredIn?: string;
}

/** Another document of the `architecture/` project, beside the landscape. */
export interface ProjectDocument {
  /** Repo-relative, `/`-separated. */
  path: string;
  text: string;
}

/** One document the merge writes additions into, and what its parse net reads them against. */
interface Destination {
  document: string;
  declared: Vocabulary;
  /**
   * Where else a name is declared, for a document proved alone — undefined
   * where nothing else is read — with that document's own line for a color,
   * whose value is part of what moves.
   */
  elsewhere?: (table: SpecificationTable, name: string) => { path: string; declaration?: string } | undefined;
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

/** `tag <name>` at a specification block's own level. A tag starts with a letter or `_`, as a kind does. */
const TAG_DECLARATION = /\btag\s+([A-Za-z_][\w-]*)/g;
/** `color <name> <value>` at a specification block's own level — a custom color, value and all. */
const COLOR_DECLARATION = /\bcolor[ \t]+([A-Za-z_][\w-]*)[ \t]+([^\s(]+(?:\([^)\n]*\))?)/g;
/** `#name` in model code — a tag reference. Never inside a word, never a second `#`. */
const TAG_REFERENCE = /(?<![\w#-])#([A-Za-z_][\w-]*)/g;
/** `color <name>` in model code — inside a `style { }`, or on an edge. */
const COLOR_REFERENCE = /(?<![\w-])color[ \t]+([A-Za-z_][\w-]*)/g;

/**
 * Each `specification` block's body as its OWN level reads: nested blocks
 * blanked. `color amber` inside a kind's `style { }` is a use of a color, not
 * the declaration of one, and only the block's own statements declare.
 */
function specificationLevels(masked: string): string[] {
  const out: string[] = [];
  for (const sm of masked.matchAll(/\bspecification\s*\{/g)) {
    const open = sm.index + sm[0].length - 1;
    const close = matchBrace(masked, open);
    if (close === -1) continue;
    const body = masked.slice(open + 1, close);
    let level = "";
    for (let i = 0; i < body.length; ) {
      const inner = body.indexOf("{", i);
      if (inner === -1) {
        level += body.slice(i);
        break;
      }
      const shut = matchBrace(body, inner);
      const end = shut === -1 ? body.length : shut + 1;
      level += body.slice(i, inner) + " ".repeat(end - inner);
      i = end;
    }
    out.push(level);
  }
  return out;
}

/** What `text` declares, and each custom color's declaration as written. */
function readDeclarations(text: string): { vocabulary: Vocabulary; colorLines: ReadonlyMap<string, string> } {
  const { kinds, relKinds } = kindsDeclared(text);
  const tags = new Set<string>();
  const colorLines = new Map<string, string>();
  for (const level of specificationLevels(maskSource(text).code)) {
    for (const m of level.matchAll(TAG_DECLARATION)) tags.add(m[1]!);
    for (const m of level.matchAll(COLOR_DECLARATION)) colorLines.set(m[1]!, `color ${m[1]!} ${m[2]!}`);
  }
  return { vocabulary: { element: kinds, relationship: relKinds, tag: tags, color: new Set(colorLines.keys()) }, colorLines };
}

/**
 * Every name `text`'s `specification` blocks declare. The kinds are
 * `kindsDeclared`'s reading — the splice's own — and tags and colors are read
 * the same way, off the masked code, so a declaration inside a comment or a
 * string is no declaration here either.
 */
export function declaredVocabulary(text: string): Vocabulary {
  return readDeclarations(text).vocabulary;
}

/** What several documents declare together — a project is the union of its documents' blocks. */
function together(...all: readonly Vocabulary[]): Vocabulary {
  const union = (table: SpecificationTable): Set<string> => new Set(all.flatMap((v) => [...v[table]]));
  return { element: union("element"), relationship: union("relationship"), tag: union("tag"), color: union("color") };
}

/**
 * The statement each addition is spliced from, matched the way the splice
 * matches it: one pool of its own per document (`statementPool`), taken in
 * addition order. An addition with no statement is the splice's to refuse, by
 * name.
 */
function statementRanges(rels: readonly Rel[], scan: ScannedModel, kindTags: KindTags): ScannedRel[] {
  const pool = statementPool(scan, kindTags);
  return rels.flatMap((r) => pool.get(relStatementKey(r))?.shift() ?? []);
}

/** Every name an addition uses that the document it lands in cannot see declared, first use first. */
function undeclaredNames(req: UndeclaredRequest): UndeclaredName[] {
  const { scan, featureId } = req;
  const { code } = maskSource(req.deltaText);
  // A token the delta does not declare is no reference — the delta parsed, so
  // every tag and custom color its model code uses is one its specification
  // declares, and a built-in color is one it does not.
  const delta = readDeclarations(req.deltaText);
  const kindOf = new Map(req.deltaElements.map((e) => [e.id, e.kind]));
  const out: UndeclaredName[] = [];
  const seen = new Set<string>();

  for (const dest of req.destinations) {
    const omit = dest.omit ?? [];
    const cut = (at: number): boolean => omit.some((o) => at >= o.start && at < o.end);
    const kept = (at: SourceRange, range: SourceRange): boolean =>
      at.start >= range.start && at.end <= range.end && !omit.some((o) => at.start >= o.start && at.end <= o.end);
    const note = (table: SpecificationTable, name: string, usedBy: string): void => {
      if (dest.declared[table].has(name)) return;
      const key = JSON.stringify([dest.document, table, name]);
      if (seen.has(key)) return;
      seen.add(key);
      // Quoted from the document that holds it when the fix is to move it: a
      // delta's copy of a color may carry another value than the living one.
      const other = dest.elsewhere?.(table, name);
      const declaredIn = other?.path;
      const declaration = other !== undefined ? other.declaration : table === "color" ? delta.colorLines.get(name) : undefined;
      out.push({
        table,
        name,
        document: dest.document,
        usedBy,
        ...(declaration === undefined ? {} : { declaration }),
        ...(declaredIn === undefined ? {} : { declaredIn }),
      });
    };
    for (const range of dest.ranges) {
      const els = scan.elements.filter((e) => e.extend !== true && kept(e, range));
      const rels = scan.rels.filter((r) => kept(r, range));
      for (const e of els) {
        const kind = kindOf.get(e.id);
        if (kind !== undefined) note("element", kind, e.id);
      }
      for (const r of rels) if (r.kind !== undefined) note("relationship", r.kind, `${r.source} -> ${r.target}`);
      // The innermost declaration a token is written in, which is the one it belongs to.
      const owner = (at: number): string => {
        const holds = [...els, ...rels].filter((d) => at >= d.start && at < d.end);
        const inner = holds.sort((a, b) => a.end - a.start - (b.end - b.start))[0];
        if (inner === undefined) return "";
        return "id" in inner ? inner.id : `${inner.source} -> ${inner.target}`;
      };
      const text = code.slice(range.start, range.end);
      for (const m of text.matchAll(TAG_REFERENCE)) {
        const at = range.start + m.index;
        const name = m[1]!;
        if (name !== featureId && delta.vocabulary.tag.has(name) && !cut(at)) note("tag", name, owner(at));
      }
      for (const m of text.matchAll(COLOR_REFERENCE)) {
        const at = range.start + m.index;
        const name = m[1]!;
        if (delta.vocabulary.color.has(name) && !cut(at)) note("color", name, owner(at));
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
  kindTags: KindTags;
  /** What lands on the map, and the split blocks' children its bytes leave behind. */
  map: { els: readonly Elem[]; rels: readonly Rel[]; omit: readonly SourceRange[] };
  /** What each extending model takes. */
  models: readonly Pick<ModelAdditions, "model" | "els" | "rels">[];
  /** The `architecture/` project's other documents — what a model is proved beside. */
  project: readonly ProjectDocument[];
}

/** The landscape as a finding names it — the merge itself knows the file only as text. */
export const MAP_DOCUMENT = "architecture/landscape.likec4";

/**
 * `undeclaredNames` over the documents one routed merge writes: the map, read
 * against its own specification alone, and each extending model, read against
 * the whole `architecture/` project's plus its own.
 */
export function additionsUndeclared(req: RoutedAdditions): UndeclaredName[] {
  const { scan, kindTags } = req;
  const byId = new Map(scan.elements.map((e) => [e.id, e]));
  const blocks = (els: readonly Elem[]): SourceRange[] => els.flatMap((e) => byId.get(e.id) ?? []);
  const map = declaredVocabulary(req.landscapeText);
  const others = req.project.map((doc) => ({ path: doc.path, ...readDeclarations(doc.text) }));
  const project = together(map, ...others.map((doc) => doc.vocabulary));
  return undeclaredNames({
    deltaText: req.deltaText,
    scan,
    deltaElements: req.deltaElements,
    featureId: req.featureId,
    destinations: [
      {
        document: MAP_DOCUMENT,
        declared: map,
        elsewhere: (table, name) => {
          const doc = others.find((d) => d.vocabulary[table].has(name));
          if (doc === undefined) return undefined;
          const declaration = table === "color" ? doc.colorLines.get(name) : undefined;
          return { path: doc.path, ...(declaration === undefined ? {} : { declaration }) };
        },
        ranges: [...blocks(req.map.els), ...statementRanges(req.map.rels, scan, kindTags)],
        omit: req.map.omit,
      },
      ...req.models.map((m) => ({
        document: m.model.path,
        declared: together(project, declaredVocabulary(m.model.text)),
        ranges: [...blocks(m.els), ...statementRanges(m.rels, scan, kindTags)],
      })),
    ],
  });
}

/**
 * `additionsUndeclared` as the merge asks it: the rest of the `architecture/`
 * project is read only when the landscape and the models alone leave a name
 * unseen, so a merge that only quotes the map's vocabulary reads nothing more.
 */
export async function undeclaredInMerge(
  req: Omit<RoutedAdditions, "project">,
  project?: () => Promise<readonly ProjectDocument[]>,
): Promise<UndeclaredName[]> {
  const alone = additionsUndeclared({ ...req, project: [] });
  if (alone.length === 0 || project === undefined) return alone;
  return additionsUndeclared({ ...req, project: await project() });
}

/** The specification line that declares `u` — what the author writes, verbatim. */
export function declarationLine(u: Pick<UndeclaredName, "table" | "name" | "declaration">): string {
  return u.declaration ?? `${u.table} ${u.name}`;
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
  const groups = [...byLine.values()];
  const add = groups.filter((us) => us[0]!.declaredIn === undefined).map((us) => `\`${declarationLine(us[0]!)}\``);
  const move = groups.flatMap((us) => {
    const from = us[0]!.declaredIn;
    return from === undefined ? [] : [`\`${declarationLine(us[0]!)}\` from ${from}`];
  });
  const fixes = [
    ...(add.length === 0 ? [] : [`Declare ${add.join(", ")} in architecture/landscape.likec4's specification, in this change or before it`]),
    ...(move.length === 0
      ? []
      : [
          `Move ${move.join(", ")} into architecture/landscape.likec4's specification: the merge proves the landscape ` +
            `alone, where another document's declaration does not reach, and declaring it in both is a duplicate`,
        ]),
  ];
  return (
    `the delta's additions use ${uses}, which architecture/landscape.likec4's specification does not declare. ` +
    `The archive never copies a specification declaration — the delta's own is the copy that lets it parse alone — ` +
    `so what it would write does not parse, and it refuses. ${fixes.join(". ")}`
  );
}
