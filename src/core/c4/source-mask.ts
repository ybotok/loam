/**
 * Masking LikeC4 source, so a brace count can be trusted.
 *
 * Split from `likec4.ts` because it is the one half of the text-level view that
 * knows nothing about the model: it reads bytes and reports spans, and the
 * scanner above it turns those spans into declarations. `archive`'s splice
 * needs both, and needs them to agree — a mask that misses a literal makes
 * `matchBrace` close a block inside a string, and the merge writes into the
 * middle of somebody's description.
 *
 * `statementHead` is the one reading of GRAMMAR here — where a statement's
 * head ends, a question about tokens rather than declarations — and it sits
 * beside the mask because it reads nothing but the masked bytes and the
 * literal list; which declaration the head is stays the scanner's to say.
 */
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

/**
 * LikeC4's MARKDOWN string: `'''…'''` or `"""…"""`, closed by the first
 * matching triple and read with no escapes (the grammar's `MarkdownString` is
 * an until-token, not a quoted run). It is what a long `description` is
 * written in, and the reason it is its own state rather than three ordinary
 * quotes: read as `''` + `'…'` + `''`, the first apostrophe or odd quote in the
 * prose — "it's" — ended the literal, every brace after it was CODE, and the
 * rest of the document was read inside out. A map with one such description
 * above its model had no model block at all as far as the splice map could
 * tell, and archive refused a landscape LikeC4 parses cleanly.
 */
const MARKDOWN_QUOTES = ["'''", '"""'] as const;

/**
 * Where a URI token starting at `at` ends, or -1 when none starts there.
 *
 * LikeC4 lexes `scheme://…` and a relative `./…`, `../…` or `/…` path as ONE
 * token running to the next whitespace — tried before the comment tokens can
 * see the `//` inside it, because the token starts at the scheme, not at the
 * slash. Read as code, `link https://…` opened a line comment at the `//`, and
 * that blanked whatever followed on the line: `x = kind 'X' { link
 * https://… }` lost its closing brace, and the scan found no model block in a
 * map LikeC4 parses. A URI's interior is never structure — a `{id}`, a `#anchor`,
 * an apostrophe are all part of the token — so it is blanked like a literal's,
 * and recorded as none: it is no string.
 */
function uriEnd(text: string, at: number): number {
  if (at > 0 && /[\w.-]/.test(text[at - 1]!)) return -1;
  let j = at;
  if (/\w/.test(text[at]!)) {
    while (j < text.length && /\w/.test(text[j]!)) j += 1;
    if (!text.startsWith("://", j)) return -1;
    j += 3;
  } else {
    while (j < at + 2 && text[j] === ".") j += 1;
    const after = text[j + 1];
    // `//` and `/*` with no dot before them are the comment tokens, which win there.
    if (text[j] !== "/" || after === undefined || after === "/" || /\s/.test(after) || (j === at && after === "*")) return -1;
  }
  while (j < text.length && !/\s/.test(text[j]!)) j += 1;
  return j;
}

export function maskSource(text: string): MaskedSource {
  const out = text.split("");
  const literals: SourceLiteral[] = [];
  type State = "code" | "squote" | "dquote" | "markdown" | "lineComment" | "blockComment";
  let state: State = "code";
  let litStart = -1;
  let lit = "";
  let fence = "";
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    const next = text[i + 1];
    switch (state) {
      case "code": {
        const uri = uriEnd(text, i);
        if (uri !== -1) {
          for (; i < uri; i += 1) out[i] = " ";
          i -= 1;
          break;
        }
        fence = MARKDOWN_QUOTES.find((q) => text.startsWith(q, i)) ?? "";
        if (fence !== "") {
          state = "markdown";
          litStart = i;
          lit = "";
          out[i] = out[i + 1] = out[i + 2] = " ";
          i += 2;
        } else if (ch === "'" || ch === '"') {
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
      }
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
      case "markdown":
        if (text.startsWith(fence, i)) {
          literals.push({ start: litStart, end: i + 3, value: lit });
          state = "code";
          out[i] = out[i + 1] = out[i + 2] = " ";
          i += 2;
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

/**
 * Every TOP-LEVEL block in MASKED code whose opening `re` matches — `re` is
 * global and its match ends at the block's `{` — with the block's body, read
 * to end of file when the brace never closes. Only depth zero counts: a block
 * nested inside another is not a declaration LikeC4 would honour. Depth is a
 * plain count, because the mask has already blanked every brace inside a
 * string or a comment — the one thing that would make counting lie — and it
 * is tracked in one forward pass rather than recounted per match.
 */
export function* topLevelBlocks(code: string, re: RegExp): Generator<{ match: RegExpExecArray; body: string }> {
  let depth = 0;
  let cursor = 0;
  for (const match of code.matchAll(re)) {
    for (; cursor < match.index; cursor += 1) {
      if (code[cursor] === "{") depth += 1;
      else if (code[cursor] === "}") depth -= 1;
    }
    if (depth !== 0) continue;
    const open = match.index + match[0].length - 1;
    const close = matchBrace(code, open);
    yield { match, body: code.slice(open + 1, close === -1 ? code.length : close) };
  }
}

/** A statement's head in MASKED code: where it ends, and the `{` opening its body (-1 when it has none). */
export interface StatementHead {
  end: number;
  opener: number;
}

/**
 * The head of the statement starting at `from`, inside a block that closes at
 * `close`: up to its own `{`, the enclosing block's `}`, or the end of its
 * line — unless LikeC4 reads on.
 *
 * It does read on, because its newlines are HIDDEN tokens (`NL` in the
 * grammar): a declaration may be split across lines anywhere a space could
 * go. A line-bounded head made each split form either invisible — so archive
 * refused a valid map — or, worse, MISREAD: `name = kind 'title'` with its `{`
 * on the next line read as a bodyless element, and a neighbour spliced in after
 * that line took the body for its own, a re-parse that passes over a merge
 * that moved another element's description and children (probed 2026-10-20).
 * The next line continues the statement when its first token can only belong
 * to it:
 *
 *  - a `{` — a body opens nothing else;
 *  - a string — no LikeC4 statement starts with one, so it is this one's
 *    title, description or technology;
 *  - a `#tag` — a relationship's tags may follow it on the next line, and an
 *    element's tags live inside its body, never after its head;
 *  - anything at all, when the head so far cannot end a statement: it ends in
 *    `=` or `->`, or it is one bare name (`entityService` above `= kind`, a
 *    kind above the name it declares).
 *
 * A line starting `->` after a COMPLETE head is a statement of its own — the
 * sourceless edge from the enclosing element — which is why an arrow at the
 * start of a line continues only a bare name.
 */
export function statementHead(masked: MaskedSource, from: number, close: number): StatementHead {
  const { code } = masked;
  let j = from;
  for (;;) {
    while (j < close && code[j] !== "\n" && code[j] !== "{" && code[j] !== "}") j += 1;
    if (j >= close) return { end: close, opener: -1 };
    if (code[j] === "{") return { end: j, opener: j };
    if (code[j] === "}") return { end: j, opener: -1 };
    const next = nextToken(masked, j, close);
    if (next === -1 || !readsOn(masked, { from, end: j }, next)) return { end: j, opener: -1 };
    j = next;
  }
}

/** The first token after `at`: a literal's start, or a non-blank character of code; -1 at the block's close. */
function nextToken(masked: MaskedSource, at: number, close: number): number {
  for (let k = at; k < close; k += 1) {
    if (literalAt(masked.literals, k) !== undefined || !/\s/.test(masked.code[k]!)) return k;
  }
  return -1;
}

/** Whether the token at `next` belongs to the statement whose head so far spans `[from, end)`. */
function readsOn(masked: MaskedSource, head: { from: number; end: number }, next: number): boolean {
  const { code, literals } = masked;
  if (literalAt(literals, next) !== undefined) return true;
  if (code[next] === "{" || code[next] === "#") return true;
  if (code[next] === "}") return false;
  const sofar = code.slice(head.from, head.end).trim();
  if (/(?:=|->)$/.test(sofar)) return true;
  // Masked, `description 'x'` reads as the one word `description`: a head
  // holding a literal is never a bare name.
  const literal = firstLiteralFrom(literals, head.from);
  return (literal === undefined || literal.start >= head.end) && /^[A-Za-z_][\w.-]*$/.test(sofar);
}

/** The literal starting exactly at `at`, if one does. */
function literalAt(literals: readonly SourceLiteral[], at: number): SourceLiteral | undefined {
  const l = firstLiteralFrom(literals, at);
  return l?.start === at ? l : undefined;
}

/** The first literal starting at or after `at` — `maskSource` records them in order, so a binary search. */
function firstLiteralFrom(literals: readonly SourceLiteral[], at: number): SourceLiteral | undefined {
  let lo = 0;
  let hi = literals.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (literals[mid]!.start < at) lo = mid + 1;
    else hi = mid;
  }
  return literals[lo];
}

/** An element declaration located in source, under the id the computed model gives it. */
