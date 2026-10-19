/**
 * What the parsed model declares and the splice map cannot locate — named the
 * way an author can act on it.
 *
 * The archive splices the landscape by its text scan (`../source-scan.ts`) and
 * refuses rather than splice around a declaration the scan cannot see. That
 * refusal used to guess its cause: "most often two declarations sharing one
 * line", whatever the map held. A fleet on 0.2.0-alpha.7 read it over a
 * standalone declaration on a line of its own — the scan was blind to a second
 * `model { }` block — and was asked to rewrite a valid map to satisfy a message
 * that described something else. So the cause is no longer guessed where it can
 * be read: LikeC4's own locator says on which line the declaration is, the
 * line itself says whether anything but the declaration's own lead (`Lead`)
 * precedes it there, and the scan says what it read in that place instead.
 *
 * A second parse of the landscape, and it is paid only on the refusal path —
 * the merge decides THAT something is unlocated from the parse it already has,
 * and asks this module only for the words.
 */
import { LikeC4 } from "likec4";
import { maskSource } from "../source-mask.js";
import type { ScannedModel } from "../source-scan.js";

/** One declaration the parser has and the scan cannot place. */
export interface Unlocated {
  kind: "element" | "relationship";
  /** The element's id, or the relationship as `source -> target`, as the parser resolved them. */
  name: string;
  /** 1-based line LikeC4's locator puts the declaration on; absent when it has no answer. */
  line?: number;
  /**
   * Code other than the declaration's own lead precedes it on its own line —
   * the shared line is then a FACT, not a guess.
   */
  sharesLine?: true;
  /** The scanned statement that covers where the declaration sits, and the line that statement starts on. */
  readAs?: { name: string; line: number };
}

/**
 * The first declaration of `text` that `scan` does not locate — elements in
 * the parser's order, then relationships in document order; null when every
 * one is located.
 *
 * An element is located when the scan holds its id. A relationship has no id
 * the text can carry, so it is located by POSITION: LikeC4 places each edge at
 * its arrow, and each scanned statement may stand for one edge — the second
 * arrow inside one scanned span is the edge the scan swallowed.
 */
export async function firstUnlocated(text: string, scan: ScannedModel): Promise<Unlocated | null> {
  const likec4 = await LikeC4.fromSource(text, { logger: false });
  try {
    const model = await likec4.parsedModel();
    const where = placer(text, scan);
    const scanned = new Set(scan.elements.map((e) => e.id));
    for (const e of model.elements()) {
      if (scanned.has(e.id)) continue;
      return { kind: "element", name: e.id, ...where.place(likec4.languageServices.locate({ element: e.id })?.range.start, { kind: e.kind }) };
    }
    const edges = [...model.relationships()].map((r) => {
      const start = likec4.languageServices.locate({ relation: r.id })?.range.start;
      return { name: `${r.source.id} -> ${r.target.id}`, start, offset: start === undefined ? -1 : where.offset(start) };
    });
    const claimed = new Set<number>();
    for (const edge of edges.sort((a, b) => a.offset - b.offset)) {
      if (edge.offset === -1) continue;
      const span = scan.rels.findIndex((s) => edge.offset >= s.start && edge.offset < s.end);
      if (span !== -1 && !claimed.has(span)) {
        claimed.add(span);
        continue;
      }
      return { kind: "relationship", name: edge.name, ...where.place(edge.start, "edge") };
    }
    // Every located edge has a statement of its own: an unlocated one, if the
    // count says there is one, is among those the locator could not place.
    const lost = edges.find((edge) => edge.offset === -1);
    return lost === undefined ? null : { kind: "relationship", name: lost.name };
  } finally {
    await likec4.dispose();
  }
}

/** An LSP position: a 0-based line and a character within it. */
interface Position {
  line: number;
  character: number;
}

/**
 * The part of a declaration LikeC4's locator leaves BEFORE its anchor. It
 * points an element at its NAME and a relationship at its ARROW — inside
 * `-[…]->`, at the kind — so `container api 'API'` has its kind keyword in
 * front of the anchor and `zulu -> apple` its source. Read as "code before
 * it", every unlocated edge and every `kind name` element shared its line with
 * itself, and the line-break explanation `unlocatedReason` holds below the
 * shared-line one was never reached. An element's lead is a token equal to
 * its parsed kind; an edge's is its source reference (`it`, a dotted path or
 * none) and the `-[` opening a bracketed kind.
 */
type Lead = { kind: string } | "edge";

/** A whole token — not the tail of a longer id — directly before the anchor, the kind written there. */
const ELEMENT_LEAD = /(?<![\w.-])([A-Za-z_][\w-]*)\s*$/;
/** An optional source reference and an optional `-[`, directly before the anchor; always matches, possibly empty. */
const EDGE_LEAD = /(?<![\w.-])(?:[A-Za-z_][\w.-]*\s*)?(?:-\[\s*)?$/;

/**
 * Where the declaration anchored at `at` starts, in the masked `code` of the
 * line starting at `from`: before its lead when the code there ends in one,
 * else `at`. Masked, a literal or a URI is blank, so the word before one reads
 * as an edge's source here exactly as `relationHead` reads it in the scan
 * (`link https://… -> zulu` is `link -> zulu` to both). Such a line is a
 * scanned edge of its own, so its edge is unlocated only when an earlier
 * statement's span ran on over it — and then the line-break explanation is
 * the one to give, which is what dropping that word leads to.
 */
function leadStart(code: string, span: { from: number; at: number }, lead: Lead): number {
  const before = code.slice(span.from, span.at);
  const m = lead === "edge" ? EDGE_LEAD.exec(before) : ELEMENT_LEAD.exec(before);
  return m === null || (lead !== "edge" && m[1] !== lead.kind) ? span.at : span.from + m.index;
}

/** Everything a position tells about a declaration, and the offset arithmetic that is built on. */
interface Placer {
  place: (start: Position | undefined, lead: Lead) => Pick<Unlocated, "line" | "sharesLine" | "readAs">;
  offset: (start: Position) => number;
}

/**
 * Reads a position against the text and the scan. Lines are split the way LSP
 * counts them — `\r\n`, `\r` or `\n` — which is not how the scan splits them,
 * and that difference is itself a cause this can name: a bare carriage return
 * is a line break to LikeC4 and none to the splice map.
 */
function placer(text: string, scan: ScannedModel): Placer {
  const starts = [0];
  for (const m of text.matchAll(/\r\n|\r|\n/g)) starts.push(m.index + m[0].length);
  const lineOf = (offset: number): number => starts.findLastIndex((s) => s <= offset) + 1;
  const { code } = maskSource(text);
  const offset = (start: Position): number => (starts[start.line] ?? text.length) + start.character;
  const heads = [
    ...scan.elements
      .filter((e) => e.extend !== true)
      .map((e) => ({ name: `'${e.id}'`, start: e.start, end: e.bodyOpen === -1 ? e.end : e.bodyOpen })),
    ...scan.rels.map((r) => ({ name: `the edge '${r.source} -> ${r.target}'`, start: r.start, end: r.end })),
  ];
  const place = (start: Position | undefined, lead: Lead): Pick<Unlocated, "line" | "sharesLine" | "readAs"> => {
    if (start === undefined) return {};
    const at = offset(start);
    const from = starts[start.line] ?? at;
    // Measured from where the declaration starts, not from the anchor: its own
    // kind keyword or source is no other statement (`Lead`).
    const before = code.slice(from, leadStart(code, { from, at }, lead));
    // Innermost first: a nested declaration's span lies inside its parent's.
    const cover = heads.filter((h) => at >= h.start && at < h.end).sort((a, b) => b.start - a.start)[0];
    return {
      line: start.line + 1,
      ...(/\S/.test(before) ? { sharesLine: true as const } : {}),
      ...(cover === undefined ? {} : { readAs: { name: cover.name, line: lineOf(cover.start) } }),
    };
  };
  return { place, offset };
}

/**
 * The refusal's words for one unlocated declaration of `file`. A shared line
 * is named only when the line shows one, and the statement the scan read
 * instead only when it read one: a guess at the cause is the message this
 * replaced.
 */
export function unlocatedReason(file: string, gap: Unlocated | null): string {
  const remedy =
    "nothing was written; rewrite it on a line of its own as `name = kind 'title' {` (an edge as `a -> b 'title'`) and re-run — " +
    "and report the original shape: LikeC4 parses it, so it is a form the splice map should read";
  if (gap === null) return `${file} declares more than placement can locate, and LikeC4's locator could not say where — ${remedy}`;
  const what = `${file} declares ${gap.kind === "element" ? `'${gap.name}'` : `the relationship '${gap.name}'`}`;
  const where = gap.line === undefined ? "" : ` at line ${gap.line}`;
  const read = gap.readAs;
  if (gap.sharesLine === true) {
    const other = read === undefined ? "the statement before it" : read.name;
    return (
      `${what}${where} in a form placement cannot locate: it shares that line with ${other}, and the splice map reads ` +
      `one statement per line where LikeC4 accepts two — give each its own line, then re-run`
    );
  }
  if (read !== undefined) {
    return (
      `${what}${where} in a form placement cannot locate: the splice map read it as part of ${read.name}, which starts at ` +
      `line ${read.line} — it ran that statement on past a line break LikeC4 makes (a bare carriage return is one) — ${remedy}`
    );
  }
  return `${what}${where} in a form placement cannot locate, and the splice map read no statement there — ${remedy}`;
}
