import { readFile } from "node:fs/promises";
import { LikeC4 } from "likec4";

/** A parse/validation issue reported by LikeC4. */
export interface LikeC4Error {
  message: string;
  line?: number;
  sourceFsPath?: string;
}

/** loam-neutral element view (flattened from the LikeC4 parsed model). */
export interface Elem {
  id: string;
  kind: string;
  title: string;
  description?: string;
  /**
   * The `services/<id>` directory this element stands for, from the element's
   * `metadata { service '...' }`. Absent on the elements nobody has bound —
   * see `elementService` for the fallback.
   */
  service?: string;
  tags: string[];
}

/**
 * The service directory an element stands for: an explicit
 * `metadata { service '<id>' }` binding wins, the title is the fallback.
 *
 * The fallback is what every docs repo written before the binding existed relies
 * on, and it is also the trap the binding exists to close: matching on the title
 * means renaming a box in a diagram silently unlinks it from its service, and
 * every check that joined the two just stops finding anything.
 */
export function elementService(e: Elem): string {
  return e.service ?? e.title;
}

/**
 * Every id an endpoint may be filed under, nearest first: `a.b.c`, `a.b`, `a`.
 *
 * A landscape does not have to draw a service as one opaque box. The moment
 * somebody models its containers — `paymentService.api`, `paymentService.worker`
 * — an edge drawn INTO a container is still an edge into the service, and every
 * join that groups by service has to know that. Resolving only the exact id is
 * what made those edges invisible: the spine check silently skipped them, and
 * the no-openapi grace treated a service with a dozen inbound container calls as
 * one nobody calls at all.
 */
function ancestorIds(id: string): string[] {
  const out = [id];
  for (let dot = id.lastIndexOf("."); dot !== -1; dot = id.lastIndexOf(".", dot - 1)) {
    out.push(id.slice(0, dot));
  }
  return out;
}

/**
 * A memoized `id -> service` resolver over one document.
 *
 * Resolution order, and why it is this order:
 *
 *  1. the nearest ancestor (the id itself first) carrying an explicit
 *     `metadata { service '<id>' }` — a binding is a claim somebody wrote down,
 *     so it outranks every guess;
 *  2. the nearest ancestor whose title names a REAL `services/<id>/` directory —
 *     positive evidence from the filesystem, available only to callers that
 *     hand in `known`;
 *  3. the element's own title, and finally the raw id — today's fallback, kept
 *     LAST because it is the one that lies: it happily resolves
 *     `paymentService.api` to "api", a service that has never existed.
 *
 * Built once per document and shared, because it is called inside loops over
 * every relationship and the walk up the ancestor chain is not free.
 */
export function serviceResolver(
  elements: Elem[],
  known?: ReadonlySet<string>,
): (id: string) => string {
  const byId = new Map(elements.map((e) => [e.id, e]));
  const memo = new Map<string, string>();
  return (id: string): string => {
    const hit = memo.get(id);
    if (hit !== undefined) return hit;
    let answer: string | undefined;
    for (const candidate of ancestorIds(id)) {
      const e = byId.get(candidate);
      if (e?.service !== undefined) {
        answer = e.service;
        break;
      }
    }
    if (answer === undefined && known !== undefined) {
      for (const candidate of ancestorIds(id)) {
        const e = byId.get(candidate);
        if (e !== undefined && known.has(e.title)) {
          answer = e.title;
          break;
        }
      }
    }
    if (answer === undefined) {
      const self = byId.get(id);
      answer = self ? elementService(self) : id;
    }
    memo.set(id, answer);
    return answer;
  };
}

/**
 * The service a relationship endpoint belongs to. An id that names no element
 * resolves to itself, so a partial document degrades to the id rather than
 * throwing.
 *
 * `known` is the set of service directories that actually exist; pass it
 * wherever the caller has enumerated `services/`, so an edge into a modelled
 * container resolves to the service that owns it instead of to the container's
 * own title. Callers with a single document and no repository in hand omit it
 * and keep the pre-existing behaviour.
 */
export function serviceOf(elements: Elem[], id: string, known?: ReadonlySet<string>): string {
  return serviceResolver(elements, known)(id);
}

/** loam-neutral relationship view. */
export interface Rel {
  source: string;
  target: string;
  title?: string;
  /** OpenAPI operationId this call uses, from the relationship's `metadata { op '...' }`. */
  op?: string;
  tags: string[];
}

export interface LoadedDoc {
  errors: LikeC4Error[];
  elements: Elem[];
  relationships: Rel[];
}

/**
 * The slice of a LikeC4 model loam reads: elements and relationships, and on
 * each of those only id/kind/title/description/tags/metadata.
 *
 * It is a type of its own, rather than an inline cast at the one call site,
 * because BOTH of LikeC4's model stages expose exactly this slice — which is
 * what makes the cheap stage a safe substitute for the expensive one. The
 * substitution is pinned in test/likec4-model-parity.test.ts, which flattens
 * both stages through `flattenModel` below and compares the results.
 */
export interface ReadableModel {
  elements: () => Iterable<{
    id: string;
    kind: string;
    title: string;
    description?: unknown;
    tags?: readonly string[];
    metadata?: unknown;
  }>;
  relationships: () => Iterable<{
    source: { id: string };
    target: { id: string };
    title?: string | null;
    tags?: readonly string[];
    metadata?: unknown;
  }>;
}

/** Flatten a LikeC4 model into loam's neutral `Elem`/`Rel` view. */
export function flattenModel(model: ReadableModel): { elements: Elem[]; relationships: Rel[] } {
  const elements: Elem[] = [...model.elements()].map((e) => ({
    id: e.id,
    kind: e.kind,
    title: e.title,
    description: descText(e.description),
    service: metaKey(e.metadata, "service"),
    tags: [...(e.tags ?? [])],
  }));
  const relationships: Rel[] = [...model.relationships()].map((r) => ({
    source: r.source.id,
    target: r.target.id,
    // LikeC4 reports an untitled edge as title: null — normalize to the declared `title?: string`.
    title: r.title ?? undefined,
    op: metaKey(r.metadata, "op"),
    tags: [...(r.tags ?? [])],
  }));
  return { elements, relationships };
}

/**
 * Load and validate a single self-contained `.likec4` document, in-process
 * (no external tool, no JVM). Returns validation errors and, if clean, the
 * flattened elements + relationships.
 */
export async function loadFile(path: string): Promise<LoadedDoc> {
  return loadSource(await readFile(path, "utf8"));
}

/**
 * `loadFile` for text that is not (yet) on disk — what the archive merge uses
 * to prove a computed landscape parses BEFORE anything is written.
 */
export async function loadSource(src: string): Promise<LoadedDoc> {
  // LikeC4 owns a Langium workspace and registers a process-exit listener for
  // it. Validation creates many short-lived instances, so every acquired
  // instance must be disposed even on an invalid document or a failed model
  // computation. Its logger is disabled because diagnostics are returned in
  // LoadedDoc instead of being written out-of-band to stderr.
  const likec4 = await LikeC4.fromSource(src, { logger: false });
  try {
    const errors = (likec4.getErrors() as LikeC4Error[]) ?? [];
    if (errors.length > 0) {
      return { errors, elements: [], relationships: [] };
    }

    // `parsedModel`, not `computedModel`: the computed stage additionally
    // computes every VIEW the document declares (and a default one when it
    // declares none), which loam never reads — it renders nothing. That work is
    // superlinear in the number of RELATIONSHIPS, so a landscape at fleet shape
    // turned `loam list` from under a second into minutes. The elements and
    // relationships below are identical either way.
    const model = (await likec4.parsedModel()) as ReadableModel;
    return { errors, ...flattenModel(model) };
  } finally {
    await likec4.dispose();
  }
}

/**
 * Read one string key out of a LikeC4 `metadata { ... }` block. Two keys carry
 * loam's spines: `op` on a relationship (the OpenAPI operationId it calls) and
 * `service` on an element (the services/<id> directory it stands for). Elements
 * with no metadata come back as `{}`, so a missing key is indistinguishable from
 * a missing block — both mean "not bound".
 */
function metaKey(m: unknown, key: string): string | undefined {
  if (m && typeof m === "object") {
    const v = (m as Record<string, unknown>)[key];
    if (typeof v === "string") return v;
  }
  return undefined;
}

/** LikeC4 descriptions can be a string or a rich-text object ({ txt } / { text } / { md }). */
function descText(d: unknown): string | undefined {
  if (typeof d === "string") return d;
  if (d && typeof d === "object") {
    const o = d as Record<string, unknown>;
    for (const key of ["txt", "text", "md", "value"]) {
      const v = o[key];
      if (typeof v === "string") return v;
    }
  }
  return undefined;
}

/* ------------------------------------------------------------------ */
/* Source scanning — the text-level view the archive merge splices from */
/* ------------------------------------------------------------------ */

/** A string literal in LikeC4 source: its span in the text, and its unescaped value. */
export interface SourceLiteral {
  start: number;
  end: number;
  value: string;
}

/**
 * A LikeC4 source with everything that is not code blanked out: string
 * interiors and comments become spaces, newlines survive, and the result is
 * exactly as long as the input — so structure (braces, arrows, `#tags`) can be
 * read with plain string operations at offsets that are valid in the original.
 */
export interface MaskedSource {
  code: string;
  literals: SourceLiteral[];
}

export function maskSource(text: string): MaskedSource {
  const out = text.split("");
  const literals: SourceLiteral[] = [];
  type State = "code" | "squote" | "dquote" | "lineComment" | "blockComment";
  let state: State = "code";
  let litStart = -1;
  let lit = "";
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    const next = text[i + 1];
    switch (state) {
      case "code":
        if (ch === "'" || ch === '"') {
          state = ch === "'" ? "squote" : "dquote";
          litStart = i;
          lit = "";
          out[i] = " ";
        } else if (ch === "/" && next === "/") {
          state = "lineComment";
          out[i] = " ";
        } else if (ch === "/" && next === "*") {
          state = "blockComment";
          out[i] = " ";
        }
        break;
      case "squote":
      case "dquote":
        if (ch === "\\" && i + 1 < text.length) {
          lit += text[i + 1]!;
          out[i] = " ";
          out[i + 1] = " ";
          i += 1;
        } else if (ch === (state === "squote" ? "'" : '"')) {
          literals.push({ start: litStart, end: i + 1, value: lit });
          state = "code";
          out[i] = " ";
        } else {
          lit += ch;
          if (ch !== "\n") out[i] = " ";
        }
        break;
      case "lineComment":
        if (ch === "\n") state = "code";
        else out[i] = " ";
        break;
      case "blockComment":
        if (ch === "*" && next === "/") {
          state = "code";
          out[i] = " ";
          out[i + 1] = " ";
          i += 1;
        } else if (ch !== "\n") {
          out[i] = " ";
        }
        break;
    }
  }
  return { code: out.join(""), literals };
}

/** Index of the `}` matching the `{` at `open`, over MASKED code; -1 when unbalanced. */
export function matchBrace(code: string, open: number): number {
  let depth = 0;
  for (let i = open; i < code.length; i += 1) {
    if (code[i] === "{") depth += 1;
    else if (code[i] === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** An element declaration located in source, under the id the computed model gives it. */
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
    tags: r.tags,
    start: r.start,
    end: r.end,
    indent: r.indent,
  }));

  elements.sort((a, b) => a.start - b.start);
  return { open, close, elements, rels };
}
