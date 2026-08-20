/**
 * Where a DYNAMIC VIEW's authored bytes are, and what replacing one costs.
 *
 * The sibling of `./landscape-merge.ts` at the other end of the same document,
 * and the merge rule deliberately differs. The living `model { ... }` is
 * SPLICED because a rebuild keeps only the fields loam models and every field
 * it forgets is authored detail destroyed — the block is large, shared, and
 * surrounds each addition with text nobody asked to touch. A view is the
 * opposite: a small self-contained object whose WHOLE text is the thing being
 * changed, with no neighbours inside it to preserve. So a view is replaced or
 * added, keyed on its id, and the replacement is still the delta's authored
 * bytes (minus the feature's own tag) rather than a re-render — `spliceSource`
 * is shared with the model merge for exactly that reason.
 *
 * Only the ONE declaration form the pinned likec4 accepts is recognised, read
 * out of the dependency rather than assumed: `dynamic view <id> { ... }`. An
 * inline title (`dynamic view v 'T'`), an anonymous view and the `extends` /
 * `of` forms element views allow are all parse errors there, so a scanner that
 * accepted them would be inventing syntax. Whitespace and newlines between the
 * four tokens are legal and are matched.
 *
 * The scan is best-effort, and the two callers are safe when it misses:
 * a declaration this cannot see is one the merge treats as absent, so it writes
 * a second declaration of the same id — which likec4 refuses outright
 * (`Duplicate view '<id>'`), at the merge's own parse net, before anything is
 * written.
 */
import { maskSource, matchBrace } from "../source-mask.js";
import { spliceSource } from "./authored-source.js";

/** One `dynamic view <id> { ... }` declaration, located in a source. */
export interface ScannedView {
  id: string;
  /** The `dynamic` keyword's own offset. */
  start: number;
  /** One past the declaration's closing brace. */
  end: number;
  /**
   * Leading whitespace of the declaration's line, or "" when something else
   * shares that line. Both readings of the same fact: `start - indent.length`
   * is where a REPLACEMENT begins, since the old indentation is text the new
   * block brings with it, and a shared line has none to give back.
   */
  indent: string;
  /**
   * Every `#tag` written anywhere in the declaration, without '#', in document
   * order — `scanModel`'s reading of a relationship's tags, on a view.
   *
   * The parsed model is the authority on a document loam has PARSED, and the
   * merge uses it. This exists for the one question asked of a document loam
   * has not: whether some OTHER feature's delta is changing this same view.
   * Parsing every in-flight delta to answer it would spin up a Langium
   * workspace per feature on the coherence path, and the other team's file may
   * not even parse today — which must not silence the warning about it.
   */
  tags: string[];
}

/** Every dynamic view a LikeC4 source declares, in document order. */
export function scanDynamicViews(text: string): ScannedView[] {
  // Masked, so a `dynamic view` spelled inside a comment or a description
  // string is not a declaration — the same trap `scanModel` masks for, and the
  // consequence here is worse: the merge would replace prose with a view.
  const { code } = maskSource(text);
  const found: ScannedView[] = [];
  for (const m of code.matchAll(/\bdynamic\s+view\s+([A-Za-z_]\w*)\s*\{/g)) {
    const open = m.index + m[0].length - 1;
    const close = matchBrace(code, open);
    // An unbalanced brace means the document does not parse, so no caller of
    // this may write anything anyway; skipping keeps the scan total.
    if (close === -1) continue;
    const lineStart = text.lastIndexOf("\n", m.index - 1) + 1;
    const before = text.slice(lineStart, m.index);
    found.push({
      id: m[1]!,
      start: m.index,
      end: close + 1,
      indent: /^[ \t]*$/.test(before) ? before : "",
      // Read off the MASKED slice, so a tag quoted in a step title is content.
      tags: [...code.slice(m.index, close + 1).matchAll(/#([\w-]+)/g)].map((t) => t[1]!),
    });
  }
  return found;
}

/** The delta-side declaration a merge carries over, and what it belongs to. */
export interface ViewSource {
  /** delta.likec4 as authored — the bytes the view is spliced from. */
  deltaText: string;
  /** The declaration inside `deltaText`. */
  decl: ScannedView;
  /** Dropped on the way over: the merged view is baseline now. */
  featureId: string;
}

/**
 * The living document with `at` replaced by the delta's view, byte for byte
 * except the feature tag and the indentation rebase.
 *
 * Whole-declaration replacement is the merge rule, so nothing here tries to
 * reconcile the two texts: the delta's view IS the new view, and a step the
 * living one had that the delta's does not is a step the feature deleted.
 */
export function replaceView(text: string, at: ScannedView, source: ViewSource): string {
  const block = spliceSource(source.deltaText, source.decl, source.featureId, at.indent);
  return text.slice(0, at.start - at.indent.length) + block + text.slice(at.end);
}

/**
 * A new one-journey document holding the delta's view.
 *
 * The header is prose for the next human, not a machine contract: nothing in
 * loam parses it and no staleness check compares it. It says the file is the
 * AUTHOR's from here on, because that is the ownership rule this directory
 * lives under — within `architecture/`, the generated files are loam's
 * (`flow-groups.likec4`, `subsystems.likec4`) and the flow documents are the
 * author's, and neither regenerator touches the other's. A reader who finds
 * this file first has no other way to learn which side of that line it is on.
 */
export function flowDocument(source: ViewSource): string {
  const { decl, featureId } = source;
  return (
    `// The '${decl.id}' journey. One journey per file, and the file is named for\n` +
    `// the view it declares: that is what makes "which file do I edit"\n` +
    `// answerable from the flow's own name (SCHEMA.md states the storage rule\n` +
    `// for architecture/flows/).\n` +
    `//\n` +
    `// Written by \`loam archive ${featureId}\`, and an AUTHORED document from here\n` +
    `// on — edit it freely. Only architecture/flow-groups.likec4 is loam's to\n` +
    `// regenerate, and \`loam flow sync\` is what regenerates it.\n` +
    `views {\n` +
    `${spliceSource(source.deltaText, decl, featureId, "  ")}\n` +
    `}\n`
  );
}
