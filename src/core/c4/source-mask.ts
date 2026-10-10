/**
 * Masking LikeC4 source, so a brace count can be trusted.
 *
 * Split from `likec4.ts` because it is the one half of the text-level view that
 * knows nothing about the model: it reads bytes and reports spans, and the
 * scanner above it turns those spans into declarations. `archive`'s splice
 * needs both, and needs them to agree — a mask that misses a literal makes
 * `matchBrace` close a block inside a string, and the merge writes into the
 * middle of somebody's description.
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

/** An element declaration located in source, under the id the computed model gives it. */
