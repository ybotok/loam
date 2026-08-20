import { maskSource, matchBrace } from "../source-mask.js";

/**
 * A declaration's authored source, ready to land in the living landscape:
 * byte-verbatim except that the feature's own tag is stripped and the
 * indentation is rebased from where the block sat in the delta to where it
 * lands. A construct the strip leaves empty goes too — a line that held only
 * the tag disappears whole, and `x = kind 'y' { #FEAT-1 }` lands as
 * `x = kind 'y'`, not as a pair of empty braces.
 */
export function spliceSource(
  deltaText: string,
  decl: { start: number; end: number; indent: string },
  featureId: string,
  targetIndent: string,
): string {
  const block = deltaText.slice(decl.start, decl.end);
  return reindent(stripFeatureTag(block, featureId), decl.indent, targetIndent);
}

function stripFeatureTag(block: string, featureId: string): string {
  const { code } = maskSource(block);
  const esc = featureId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const removals: Array<[number, number]> = [];
  for (const m of block.matchAll(new RegExp(`#${esc}(?![\\w-])`, "g"))) {
    // Only tags in CODE count — a description quoting "#FEAT-1" is content.
    if (code.slice(m.index, m.index + m[0].length) !== m[0]) continue;
    let s = m.index;
    let e = s + m[0].length;
    // A tag list may be COMMA-SEPARATED — `#FEAT-1, #smoke` and `#smoke,
    // #FEAT-1` are both legal wherever tags are, elements and relationships
    // included — so the separator has to leave with the token. Stripping the
    // tag alone leaves `{ , #smoke }`, which does not parse: the merge then
    // died at its own parse net blaming the living document's specification
    // for a comma the strip had just made. Trailing separator first, so
    // `#FEAT-1, #smoke` leaves `#smoke` where it stood; one separator only,
    // because two commas around one tag were two tags' worth of syntax.
    let sep = e;
    while (block[sep] === " " || block[sep] === "\t") sep += 1;
    const trailingSep = block[sep] === ",";
    let leadingSep = false;
    if (trailingSep) {
      e = sep + 1;
    } else {
      let back = s;
      while (back > 0 && (block[back - 1] === " " || block[back - 1] === "\t")) back -= 1;
      leadingSep = block[back - 1] === ",";
      if (leadingSep) s = back - 1;
    }
    // Take the whitespace on ONE side with the token — trailing first, so
    // `#FEAT-1 #critical` leaves `#critical` at its own indent, and a token at
    // the end of a line does not leave a trailing space behind.
    //
    // A separator already taken settles the question, and taking whitespace as
    // well would move what is left: with a TRAILING one, walking backwards
    // would swallow the line's own indentation and re-home the surviving tag
    // (`#FEAT-1,#smoke` two columns to the left); with a LEADING one, the
    // token's own place in the list is already gone, so `{ #smoke, #FEAT-1 }`
    // keeps the space before its closing brace.
    if (block[e] === " " || block[e] === "\t") {
      if (!leadingSep) while (block[e] === " " || block[e] === "\t") e += 1;
    } else if (!trailingSep) {
      while (s > 0 && (block[s - 1] === " " || block[s - 1] === "\t")) s -= 1;
    }
    removals.push([s, e]);
  }
  if (removals.length === 0) return block;

  // A line the strip emptied disappears whole, newline included.
  for (let lineStart = 0; lineStart < block.length; ) {
    const nl = block.indexOf("\n", lineStart);
    const lineEnd = nl === -1 ? block.length : nl + 1;
    if (
      removals.some(([s, e]) => s >= lineStart && e <= lineEnd) &&
      /^\s*$/.test(residual(block, lineStart, nl === -1 ? block.length : nl, removals))
    ) {
      removals.push([lineStart, lineEnd]);
    }
    lineStart = lineEnd;
  }

  // A body the strip emptied goes too, braces and all — but only one the strip
  // emptied: braces that were authored empty are authored bytes and survive.
  for (let at = code.indexOf("{"); at !== -1; at = code.indexOf("{", at + 1)) {
    const closeAt = matchBrace(code, at);
    if (closeAt === -1) continue;
    if (!removals.some(([s, e]) => s > at && e <= closeAt)) continue;
    if (!/^\s*$/.test(residual(block, at + 1, closeAt, removals))) continue;
    let s = at;
    while (s > 0 && /\s/.test(block[s - 1]!)) s -= 1;
    removals.push([s, closeAt + 1]);
  }
  return applyRemovals(block, removals);
}

/** The text of [from, to) with the removal ranges cut out. */
function residual(text: string, from: number, to: number, removals: Array<[number, number]>): string {
  let out = "";
  for (let i = from; i < to; i += 1) {
    if (!removals.some(([s, e]) => i >= s && i < e)) out += text[i];
  }
  return out;
}

function applyRemovals(text: string, removals: Array<[number, number]>): string {
  const sorted = [...removals].sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  let out = "";
  let i = 0;
  for (const [s, e] of sorted) {
    if (s > i) out += text.slice(i, s);
    if (e > i) i = e;
  }
  return out + text.slice(i);
}

/**
 * Rebase a block's indentation: the `base` its lines carried in the delta
 * becomes `target`. The first line arrives with no leading whitespace (the
 * scanner's span starts at the declaration itself), so it only gains `target`.
 */
function reindent(block: string, base: string, target: string): string {
  return block
    .split("\n")
    .map((line, k) => {
      const body = k === 0 ? line : line.startsWith(base) ? line.slice(base.length) : line;
      return body.length === 0 ? "" : target + body;
    })
    .join("\n");
}
