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
 * `statementHead` and `statementEnd` are the readings of GRAMMAR here — where a
 * statement's head ends, and where a bodyless statement ends past it: questions
 * about tokens rather than declarations — and they sit beside the mask because
 * they read nothing but the bytes, the mask and the literal and URI lists;
 * which declaration the head is stays the scanner's to say.
 */
/** A half-open `[start, end)` run of the source. */
export interface SourceSpan {
  start: number;
  end: number;
}

export interface SourceLiteral extends SourceSpan {
  value: string;
}

/**
 * A LikeC4 source with everything that is not code blanked out: string
 * interiors, URIs and comments become spaces, newlines survive, and the result
 * is exactly as long as the input — so structure (braces, arrows, `#tags`) can
 * be read with plain string operations at offsets that are valid in the original.
 *
 * A blank is not nothing, which is why the literals and the URIs are listed
 * beside it: both are TOKENS the grammar reads, and a reader that only sees the
 * spaces reads `description 'x'` as the word `description` alone. To the
 * grammar a comment is exactly the blank it becomes; the comments are listed
 * for the splice, which must never put a byte inside one, and cannot tell from
 * a blank line alone whether it is inside a block comment.
 */
export interface MaskedSource {
  code: string;
  literals: SourceLiteral[];
  /** Every URI token (`uriEnd`), in document order. */
  uris: SourceSpan[];
  /** Every comment, `//` or `/* … *\/`, in document order — an unclosed one runs to the end. */
  comments: SourceSpan[];
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
 * an apostrophe are all part of the token — so it is blanked like a literal's.
 * It is recorded in `uris`, not among the literals, because it is no string —
 * no title is read from it — but it IS a token: blanked and recorded nowhere,
 * `link https://…` read as the bare word `link`, and `statementHead` ran that
 * on into the next line and swallowed the declaration written there.
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
  const uris: SourceSpan[] = [];
  const comments: SourceSpan[] = [];
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
          uris.push({ start: i, end: uri });
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
        } else if (ch === "/" && (next === "/" || next === "*")) {
          state = next === "/" ? "lineComment" : "blockComment";
          litStart = i;
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
        // LikeC4's line comment is `//[^\n\r]*`: a bare `\r` ends it. Masked to
        // the `\n`, `a -> b // why` with a bare `\r` before the next edge hid
        // that edge — `validate --all --base` never graded its op, and archive
        // refused the map on a relationship count.
        if (ch === "\n" || ch === "\r") {
          comments.push({ start: litStart, end: i });
          state = "code";
        } else out[i] = " ";
        break;
      case "blockComment":
        if (ch === "*" && next === "/") {
          comments.push({ start: litStart, end: i + 2 });
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
  if (state === "lineComment" || state === "blockComment") comments.push({ start: litStart, end: text.length });
  return { code: out.join(""), literals, uris, comments };
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
 *    kind above the name it declares, `link` above its URI).
 *
 * A line starting `->` after a COMPLETE head is a statement of its own — the
 * sourceless edge from the enclosing element — which is why an arrow at the
 * start of a line continues only a bare name.
 *
 * "Bare" is read off the tokens, not the blanks: `link https://…` and
 * `description 'x'` are masked to one word each, and both are complete
 * properties. Read as bare names they ran on into the next line, and whatever
 * was declared there — a child, the parent's sourceless edge — was read into
 * the property and lost (2e490dd blanked the URI and recorded nothing).
 *
 * A line ends at a carriage return as well as a line feed: LikeC4's `NL` is
 * `[\r\n]+`, so a bare `\r` is a line break to it. Ended at `\n` alone, the
 * head of `link https://…`, `description 'x'` or `technology 'TS'` ran on over
 * a bare `\r` into the parent's sourceless edge, which was read as an edge
 * FROM `link` (`description`, `technology`): the counts still agreed, nothing
 * refused, and `validate --all --base` graded the branch's misspelt op nowhere
 * (probed on main at 171555d). A CRLF line ends at its `\r` now rather than
 * its `\n`, which nothing reads differently — `nextToken` steps over both.
 */
export function statementHead(masked: MaskedSource, from: number, close: number): StatementHead {
  const { code } = masked;
  let j = from;
  for (;;) {
    while (j < close && code[j] !== "\n" && code[j] !== "\r" && code[j] !== "{" && code[j] !== "}") j += 1;
    if (j >= close) return { end: close, opener: -1 };
    if (code[j] === "{") return { end: j, opener: j };
    if (code[j] === "}") return { end: j, opener: -1 };
    const next = nextToken(masked, j, close);
    if (next === -1 || !readsOn(masked, { from, end: j }, next)) return { end: j, opener: -1 };
    j = next;
  }
}

/**
 * The first token after `at`: a literal's or a URI's start, or a non-blank
 * character of code; -1 at the block's close. A URI is masked blank, so
 * without its span `link` above its URI looked past the URI to the line after
 * — and ran on into it.
 */
function nextToken(masked: MaskedSource, at: number, close: number): number {
  for (let k = at; k < close; k += 1) {
    if (spanAt(masked.literals, k) || spanAt(masked.uris, k) || !/\s/.test(masked.code[k]!)) return k;
  }
  return -1;
}

/** Whether the token at `next` belongs to the statement whose head so far spans `[from, end)`. */
function readsOn(masked: MaskedSource, head: { from: number; end: number }, next: number): boolean {
  const { code, literals, uris } = masked;
  if (spanAt(literals, next)) return true;
  if (code[next] === "{" || code[next] === "#") return true;
  if (code[next] === "}") return false;
  const sofar = code.slice(head.from, head.end).trim();
  if (/(?:=|->)$/.test(sofar)) return true;
  // Masked, `description 'x'` reads as the one word `description` and
  // `link https://…` as the one word `link`: a head holding a literal or a URI
  // is never a bare name.
  return !spanIn(literals, head) && !spanIn(uris, head) && /^[A-Za-z_][\w.-]*$/.test(sofar);
}

/**
 * Source text from a point in CODE, past its leading blanks and every block
 * comment that closes within it: what is left starts with code, with a line
 * comment, with a block comment the text does not close — or is empty. Read
 * off the raw text, because the mask blanks a comment exactly like a string's
 * interior, and the splice must tell the two apart: a comment trailing a
 * statement is room to splice past, a string is not.
 */
export function pastComments(text: string): string {
  let rest = text.trimStart();
  while (rest.startsWith("/*")) {
    const shut = rest.indexOf("*/", 2);
    if (shut === -1) break;
    rest = rest.slice(shut + 2).trimStart();
  }
  return rest;
}

/** One past the last token in `[from, to)` — a code character, a literal or a URI; `from` when it holds none. */
export function tokenEnd(masked: MaskedSource, from: number, to: number): number {
  let end = to;
  while (end > from && /\s/.test(masked.code[end - 1]!)) end -= 1;
  for (const spans of [masked.literals, masked.uris]) {
    // The last span ending by `to`: the lists are in order and never overlap.
    let k = firstSpanIndex(spans, to) - 1;
    while (k >= 0 && spans[k]!.end > to) k -= 1;
    if (k >= 0 && spans[k]!.start >= from) end = Math.max(end, spans[k]!.end);
  }
  return end;
}

/**
 * Where a bodyless statement whose head spans `head` ends: past its last token
 * and whatever trails that on its line — a `// comment`, a closed `/* … *\/` —
 * which is its own authored text and rides with it when the archive carries it.
 *
 * A block comment it OPENS there and closes on a later line is the exception,
 * and it ends before that one. Ended inside it, the statement handed its
 * readers a point inside a comment: placement spliced the next addition on
 * the following line, still in the comment, and a bodyless parent gained its
 * `{` there — the addition was commented out of a merge that parsed, written
 * at exit 0 (probed on main at 171555d).
 */
export function statementEnd(text: string, masked: MaskedSource, head: SourceSpan): number {
  const last = tokenEnd(masked, head.start, head.end);
  if (pastComments(text.slice(last, head.end)).startsWith("/*")) return last;
  let end = head.end;
  while (end > head.start && /\s/.test(text[end - 1]!)) end -= 1;
  return end;
}

/** Whether a span starts exactly at `at`. */
function spanAt(spans: readonly SourceSpan[], at: number): boolean {
  return firstSpanFrom(spans, at)?.start === at;
}

/** Whether a span starts inside `[from, end)`. */
function spanIn(spans: readonly SourceSpan[], range: { from: number; end: number }): boolean {
  const s = firstSpanFrom(spans, range.from);
  return s !== undefined && s.start < range.end;
}

/** The first span starting at or after `at`. */
function firstSpanFrom(spans: readonly SourceSpan[], at: number): SourceSpan | undefined {
  return spans[firstSpanIndex(spans, at)];
}

/** The index of the first span starting at or after `at` — `maskSource` records each list in order, so a binary search. */
function firstSpanIndex(spans: readonly SourceSpan[], at: number): number {
  let lo = 0;
  let hi = spans.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (spans[mid]!.start < at) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** An element declaration located in source, under the id the computed model gives it. */
