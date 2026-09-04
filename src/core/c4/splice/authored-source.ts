import { maskSource, matchBrace } from "../source-mask.js";

/** A half-open byte range of `deltaText`, as the source scan reports one. */
export interface SourceRange {
  start: number;
  end: number;
}

/**
 * A declaration's authored source, ready to land in the living landscape:
 * byte-verbatim except that the feature's own tag is stripped and the
 * indentation is rebased from where the block sat in the delta to where it
 * lands. A construct the strip leaves empty goes too — a line that held only
 * the tag disappears whole, and `x = kind 'y' { #FEAT-1 }` lands as
 * `x = kind 'y'`, not as a pair of empty braces.
 *
 * `omit` cuts named ranges of the delta out on the way over, and it exists for
 * one caller: a NEW service element whose interior belongs to that service's
 * extending model. The children come along in the parent's bytes — they carry no
 * feature tag of their own, because LikeC4 does not inherit tags, so nothing in
 * the addition set can see them — and the map must take the box without them or
 * the model can never declare them (verification 2026-09-04, refutation of E1).
 * The ranges join the tag's removals, so a body they empty collapses the same
 * way `#FEAT-1`-only braces do.
 */
/** How a declaration is carried over: whose tag to drop, where it lands, and what to leave behind. */
export interface Carry {
  featureId: string;
  /** The indent of the position the block lands at. */
  indent: string;
  /** Delta ranges cut out on the way over — see the banner; `[]` when nothing rides separately. */
  omit?: readonly SourceRange[];
}

export function spliceSource(
  deltaText: string,
  decl: { start: number; end: number; indent: string },
  carry: Carry,
): string {
  const { featureId, indent: targetIndent, omit = [] } = carry;
  const block = deltaText.slice(decl.start, decl.end);
  const cuts = omit
    .filter((r) => r.start >= decl.start && r.end <= decl.end)
    .map((r) => wholeLines(block, r.start - decl.start, r.end - decl.start));
  return reindent(stripFeatureTag(block, featureId, cuts), decl.indent, targetIndent);
}

/**
 * Widen a cut to the whole lines it sits on, when it has them to itself.
 *
 * A scanned declaration's span starts at its first character and ends one past
 * its last brace, so cutting it verbatim would leave the leading indent and the
 * trailing newline behind as a blank line — and the emptied-line rule below only
 * fires on a removal a line contains. A cut sharing its line with other code is
 * left exactly as asked.
 */
function wholeLines(block: string, start: number, end: number): [number, number] {
  const lineStart = block.lastIndexOf("\n", start - 1) + 1;
  if (!/^[ \t]*$/.test(block.slice(lineStart, start))) return [start, end];
  const nl = block.indexOf("\n", end);
  const to = nl === -1 ? block.length : nl;
  if (!/^[ \t\r]*$/.test(block.slice(end, to))) return [start, end];
  return [lineStart, nl === -1 ? block.length : nl + 1];
}

/**
 * Rewrite the line endings a merge INSERTED to the ones the document already
 * uses.
 *
 * Splicing composes bytes from two files, and the delta's newlines are not
 * necessarily the living document's: on a repository without `core.autocrlf`
 * normalisation a CRLF landscape or model came back with a handful of bare-LF
 * lines in the spliced region — two conventions in one file, noisy in an editor
 * and in every diff (verification 2026-09-04, W-CRLF). One helper for both
 * merges, because both had it.
 *
 * Only a document with ONE convention is corrected, and then in whichever
 * direction it uses: a file that is already mixed has no convention to match, and
 * guessing one would rewrite lines nobody touched.
 */
export function matchLineEndings(document: string, merged: string): string {
  const crlf = (document.match(/\r\n/g) ?? []).length;
  const bare = (document.match(/(?<!\r)\n/g) ?? []).length;
  if (crlf > 0 && bare === 0) return merged.replace(/(?<!\r)\n/g, "\r\n");
  if (bare > 0 && crlf === 0) return merged.replace(/\r\n/g, "\n");
  return merged;
}

function stripFeatureTag(block: string, featureId: string, cuts: ReadonlyArray<[number, number]>): string {
  const { code } = maskSource(block);
  const esc = featureId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const removals: Array<[number, number]> = cuts.map(([s, e]) => [s, e]);
  for (const m of block.matchAll(new RegExp(`#${esc}(?![\\w-])`, "g"))) {
    // Only tags in CODE count — a description quoting "#FEAT-1" is content.
    if (code.slice(m.index, m.index + m[0].length) !== m[0]) continue;
    let s = m.index;
    let e = s + m[0].length;
    // Take the whitespace on ONE side with the token — trailing first, so
    // `#FEAT-1 #critical` leaves `#critical` at its own indent, and a token at
    // the end of a line does not leave a trailing space behind.
    if (block[e] === " " || block[e] === "\t") {
      while (block[e] === " " || block[e] === "\t") e += 1;
    } else {
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
 *
 * A CRLF delta's blank line is `"\r"`, not `""`, so splitting on `\n` alone used
 * to hand a non-empty body to the rule below and every blank line inside a
 * spliced block came out carrying the target indent as trailing whitespace. The
 * carriage return is set aside and put back, which leaves the line's own ending
 * exactly as authored for `matchLineEndings` to reconcile.
 */
function reindent(block: string, base: string, target: string): string {
  return block
    .split("\n")
    .map((line, k) => {
      const cr = line.endsWith("\r");
      const raw = cr ? line.slice(0, -1) : line;
      const body = k === 0 ? raw : raw.startsWith(base) ? raw.slice(base.length) : raw;
      return (body.length === 0 ? "" : target + body) + (cr ? "\r" : "");
    })
    .join("\n");
}
