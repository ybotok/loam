/**
 * The text-level view of a LikeC4 document: which bytes each declaration owns.
 *
 * loam's archive merges the landscape by SPLICING authored text, not by
 * re-rendering a parsed model — a re-render would reformat every line somebody
 * wrote. So the merge needs both views of the same file: the parsed one
 * (`likec4.ts`) for what the model MEANS, and this one for where each
 * declaration physically is. A key only one of them reads is a key the merge
 * silently drops, which is why `metadata` handling is spelled out in both.
 */
import { maskSource, matchBrace, type SourceLiteral } from "./source-mask.js";

export interface ScannedElement {
  /** Full dotted id — `parent.child` for a nested declaration. */
  id: string;
  /** Span of the whole declaration: first head character to one past its end. */
  start: number;
  end: number;
  /** Its own body braces; -1 when the declaration has no body. */
  bodyOpen: number;
  bodyClose: number;
  /** Leading whitespace of the declaration's first line. */
  indent: string;
}

/** A relationship statement located in source, endpoints resolved to full ids (best effort). */
export interface ScannedRel {
  source: string;
  target: string;
  title?: string;
  op?: string;
  /** `metadata { publishes '...' }` — see `Rel.publishes`. */
  publishes?: string;
  /** `metadata { consumes '...' }` — see `Rel.consumes`. */
  consumes?: string;
  tags: string[];
  start: number;
  end: number;
  indent: string;
}

export interface ScannedModel {
  /** The `model` block's own braces. */
  open: number;
  close: number;
  /** In document order. A nested declaration's span lies inside its parent's. */
  elements: ScannedElement[];
  rels: ScannedRel[];
}

/**
 * Locate every element and relationship declaration inside the top-level
 * `model { ... }` block of a LikeC4 source, with the byte range each one
 * occupies. This is the splice map `loam archive` merges the landscape with:
 * the parsed model says WHAT exists, this says WHERE its authored text is —
 * verbatim, so nothing the parser does not model (technology, style, links)
 * can be lost by rebuilding it.
 *
 * Both declaration forms are recognised — `name = kind ...` always, and
 * `kind name ...` for any kind the document's own `specification` block
 * declares. Relationship endpoints are resolved the way LikeC4 reads them:
 * innermost enclosing scope outward, then the top level, then a unique leaf
 * name anywhere; `it`/`this` (and an omitted source) mean the enclosing
 * element. A name that resolves nowhere is left as written — the caller's
 * match against the parsed model then fails loudly instead of guessing.
 *
 * Returns null when there is no model block. Callers only hand in documents
 * LikeC4 has already parsed, so the scan can trust balanced braces.
 */
export function scanModel(text: string): ScannedModel | null {
  const { code, literals } = maskSource(text);
  const m = /\bmodel\s*\{/.exec(code);
  if (!m) return null;
  const open = m.index + m[0].length - 1;
  const close = matchBrace(code, open);
  if (close === -1) return null;

  // Element kinds from the specification block(s): the `<kind> <name>`
  // declaration form is recognisable only by its first token being a kind.
  const kinds = new Set<string>();
  for (const sm of code.matchAll(/\bspecification\s*\{/g)) {
    const sClose = matchBrace(code, sm.index + sm[0].length - 1);
    if (sClose === -1) continue;
    for (const em of code.slice(sm.index, sClose).matchAll(/\belement\s+([A-Za-z_][\w-]*)/g)) {
      kinds.add(em[1]!);
    }
  }

  const indentOf = (at: number): string => {
    const nl = text.lastIndexOf("\n", at - 1);
    const ws = text.slice(nl + 1, at);
    return /^[ \t]*$/.test(ws) ? ws : "";
  };
  const literalIn = (from: number, to: number): SourceLiteral | undefined =>
    literals.find((l) => l.start >= from && l.end <= to);
  const keyedLiteral = (key: string, from: number, to: number): string | undefined => {
    if (from === -1) return undefined;
    const re = new RegExp(`\\b${key}\\b`, "g");
    re.lastIndex = from;
    const km = re.exec(code);
    if (km === null || km.index >= to) return undefined;
    return literalIn(km.index, to)?.value;
  };
  const trimmedEnd = (from: number, to: number): number => {
    let e = to;
    while (e > from && /\s/.test(text[e - 1]!)) e -= 1;
    return e;
  };

  const elements: ScannedElement[] = [];
  interface RawRel {
    srcLit?: string;
    tgtLit: string;
    parent: string;
    start: number;
    end: number;
    indent: string;
    title?: string;
    op?: string;
    publishes?: string;
    consumes?: string;
    tags: string[];
  }
  const raw: RawRel[] = [];
  const stack: Array<{ id: string; el: ScannedElement }> = [];

  let i = open + 1;
  while (i < close) {
    const ch = code[i]!;
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if (ch === "}") {
      const frame = stack.pop();
      if (frame !== undefined) {
        frame.el.bodyClose = i;
        frame.el.end = i + 1;
        elements.push(frame.el);
      }
      i += 1;
      continue;
    }

    // A statement's head: up to its own `{`, the end of the line, or the
    // enclosing block's `}` on the same line — whichever comes first.
    const stmtStart = i;
    let headEnd = close;
    let opener = -1;
    for (let j = i; j < close; j += 1) {
      const c = code[j]!;
      if (c === "\n" || c === "}") {
        headEnd = j;
        break;
      }
      if (c === "{") {
        opener = j;
        headEnd = j;
        break;
      }
    }
    const head = code.slice(stmtStart, headEnd);
    const parentId = stack.length > 0 ? stack[stack.length - 1]!.id : "";

    // Classify: `name = kind` first, then a relationship (the arrow cannot hide
    // in a string — the head is masked), then the `kind name` form, else a
    // property/tag line that is consumed whole, nested block included.
    let localName: string | null = null;
    const assign = /^([A-Za-z_]\w*)\s*=\s*[A-Za-z_]/.exec(head);
    if (assign !== null) {
      localName = assign[1]!;
    } else if (!head.includes("->")) {
      const toks = head.trim().split(/\s+/);
      if (toks.length >= 2 && kinds.has(toks[0]!) && /^[A-Za-z_]\w*$/.test(toks[1]!)) {
        localName = toks[1]!;
      }
    }

    if (localName !== null) {
      const id = parentId === "" ? localName : `${parentId}.${localName}`;
      const el: ScannedElement = {
        id,
        start: stmtStart,
        end: headEnd,
        bodyOpen: opener,
        bodyClose: -1,
        indent: indentOf(stmtStart),
      };
      if (opener !== -1) {
        stack.push({ id, el });
        i = opener + 1;
      } else {
        el.end = trimmedEnd(stmtStart, headEnd);
        elements.push(el);
        i = headEnd;
      }
      continue;
    }

    if (head.includes("->")) {
      const bClose = opener === -1 ? -1 : matchBrace(code, opener);
      const stmtEnd = opener === -1 ? trimmedEnd(stmtStart, headEnd) : bClose === -1 ? close : bClose + 1;
      const am = /^([A-Za-z_][\w.]*)?\s*(?:-\[[^\]]*\])?->\s*([A-Za-z_][\w.]*)/.exec(head);
      if (am !== null) {
        const arrowEnd = stmtStart + am[0].length;
        const bodyFrom = opener === -1 ? -1 : opener + 1;
        const bodyTo = opener === -1 ? -1 : stmtEnd - 1;
        const title = literalIn(arrowEnd, headEnd)?.value ?? keyedLiteral("title", bodyFrom, bodyTo);
        const tags: string[] = [];
        for (const tm of code.slice(stmtStart, stmtEnd).matchAll(/#([\w-]+)/g)) tags.push(tm[1]!);
        raw.push({
          srcLit: am[1],
          tgtLit: am[2]!,
          parent: parentId,
          start: stmtStart,
          end: stmtEnd,
          indent: indentOf(stmtStart),
          title,
          op: keyedLiteral("op", bodyFrom, bodyTo),
          publishes: keyedLiteral("publishes", bodyFrom, bodyTo),
          consumes: keyedLiteral("consumes", bodyFrom, bodyTo),
          tags,
        });
      }
      i = Math.max(stmtEnd, headEnd);
      continue;
    }

    if (opener !== -1) {
      const bClose = matchBrace(code, opener);
      i = bClose === -1 ? close : bClose + 1;
    } else {
      i = headEnd;
    }
  }

  // Resolve relationship endpoints against everything declared anywhere in the
  // model — LikeC4 resolution is not order-dependent, so neither is this.
  const ids = new Set(elements.map((e) => e.id));
  const byLeaf = new Map<string, string[]>();
  for (const e of elements) {
    const leaf = e.id.slice(e.id.lastIndexOf(".") + 1);
    byLeaf.set(leaf, [...(byLeaf.get(leaf) ?? []), e.id]);
  }
  const resolve = (lit: string | undefined, enclosing: string): string => {
    if (lit === undefined || lit === "it" || lit === "this") return enclosing;
    const segs = lit.split(".");
    let base: string | undefined;
    for (let scope = enclosing; scope !== "" && base === undefined; ) {
      if (ids.has(`${scope}.${segs[0]!}`)) base = `${scope}.${segs[0]!}`;
      const dot = scope.lastIndexOf(".");
      scope = dot === -1 ? "" : scope.slice(0, dot);
    }
    if (base === undefined && ids.has(segs[0]!)) base = segs[0]!;
    if (base === undefined) {
      const leafed = byLeaf.get(segs[0]!);
      if (leafed !== undefined && leafed.length === 1) base = leafed[0]!;
    }
    return [base ?? segs[0]!, ...segs.slice(1)].join(".");
  };

  const rels: ScannedRel[] = raw.map((r) => ({
    source: resolve(r.srcLit, r.parent),
    target: resolve(r.tgtLit, r.parent),
    title: r.title,
    op: r.op,
    publishes: r.publishes,
    consumes: r.consumes,
    tags: r.tags,
    start: r.start,
    end: r.end,
    indent: r.indent,
  }));

  elements.sort((a, b) => a.start - b.start);
  return { open, close, elements, rels };
}
