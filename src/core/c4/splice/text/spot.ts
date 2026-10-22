/**
 * Where a block enters a LikeC4 document, in byte offsets — the text half of
 * the splice's placement. `../placement.ts` decides which statement an addition
 * lands beside, by service and by sort key; everything here answers how that
 * decision becomes an offset in the authored bytes without cutting into a
 * comment, a body or the line another statement shares. The service-model
 * splice (`../model/merge.ts`) asks the same questions of a document it does
 * not group by service, and reads them from here for that reason.
 */
import { maskSource, pastComments, tokenEnd } from "../../source-mask.js";
import type { ScannedElement } from "../../source-scan.js";

/** A splice point the placement rules chose. */
export interface Spot {
  /** Offset into the living text: a line start, or a point inside a shared line. */
  at: number;
  /** True when `at` shares its line with other text (the closing brace, or a displaced statement) — the block must bring its own newlines. */
  bare: boolean;
}

/**
 * The line following the statement that ends at `end` — clamped to the closing
 * brace's own spot. Exported for the service-model splice (`../model/merge.ts`),
 * which asks the same two questions of a `model { }` block it does not group by
 * service: after this statement, or last thing in the block.
 *
 * Unless code follows `end` on its line: then the spot is `end` itself, bare.
 * The next line belongs to whatever is written there, and when that is a
 * declaration whose body opens on the same line — `alpha = … { … }  beta = … {`
 * — the line after is INSIDE beta: an addition anchored to alpha's service
 * landed as `beta.kiwi`, in a merge that parsed and was written (exit 0,
 * probed on main at 171555d). Right after the anchor is also what keeps two
 * archives order-free when both anchor on that line: one anchored to alpha and
 * one to beta used to share the next line's start, and whichever ran second
 * landed above the other. A comment trailing the anchor is not code — the
 * next line stays the spot, byte for byte as before — but a block comment
 * it does not close is: its next line is inside the comment.
 *
 * A line comment ends where LikeC4's NL does, at `\r` as well as `\n` — the
 * source mask agrees since the bare-CR fix — so `// note\r  beta = … {` is a
 * comment and then code on the anchor's `\n`-line, and the spot after that
 * line is inside beta: the same `beta.kiwi` merge, written at exit 0, which
 * 171555d refused because it could not locate beta at all. A CRLF ending
 * leaves nothing after the comment and keeps the next line, byte for byte.
 */
export function spotAfter(text: string, close: number, end: number): Spot {
  const nl = text.indexOf("\n", end);
  const at = nl === -1 ? text.length : nl + 1;
  let rest = pastComments(text.slice(end, Math.min(at, close)));
  while (rest.startsWith("//")) {
    const eol = rest.search(/[\r\n]/);
    rest = eol === -1 ? "" : pastComments(rest.slice(eol));
  }
  if (rest !== "") return { at: end, bare: true };
  return at > close ? closeSpot(text, close) : { at, bare: false };
}

/** The last resort: directly before the model's closing brace. */
export function closeSpot(text: string, close: number): Spot {
  const ls = lineStartAt(text, close);
  if (/^[ \t]*$/.test(text.slice(ls, close))) return { at: ls, bare: false };
  return { at: close, bare: true };
}

export function lineStartAt(text: string, at: number): number {
  return text.lastIndexOf("\n", at - 1) + 1;
}

/**
 * Where a child block enters an existing living parent: before the closing
 * brace of the parent's body, on its own line at the parent's inner indent —
 * and a parent that never had a body gains one around the child.
 */
export function nestedInsert(text: string, parent: ScannedElement, block: string): { at: number; insert: string } {
  if (parent.bodyOpen === -1) {
    return { at: bodyAt(text, parent), insert: ` {\n${block}\n${parent.indent}}` };
  }
  const lineStart = text.lastIndexOf("\n", parent.bodyClose - 1) + 1;
  if (/^[ \t]*$/.test(text.slice(lineStart, parent.bodyClose))) {
    return { at: lineStart, insert: `${block}\n` };
  }
  // `{ ... }` on one line — break the brace onto its own line to make room.
  return { at: parent.bodyClose, insert: `\n${block}\n${parent.indent}` };
}

/**
 * Where a bodyless parent's new body opens: where its span ends, unless a line
 * comment trails its last token there. The span carries that comment — it is
 * the declaration's own authored text (`statementEnd`) — so the `{` landed
 * INSIDE `// the api`, everything after it on the line was comment, and the
 * parse net refused a valid map ("Expecting end of file"). It opens before the
 * comment now, which then trails the new closing brace. A closed block comment
 * is no such trap, and keeps the bytes it always had.
 */
function bodyAt(text: string, parent: ScannedElement): number {
  const span = text.slice(parent.start, parent.end);
  const last = parent.start + tokenEnd(maskSource(span), 0, span.length);
  return pastComments(text.slice(last, parent.end)) === "" ? parent.end : last;
}
