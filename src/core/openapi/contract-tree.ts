/**
 * The one way both contract axes read and write a contract document: parse it,
 * refuse its first parse error, resolve it, and hand it back as text.
 *
 * The helpers are axis-neutral and take the refusal to raise as a `fail`
 * callback, because the event axis's six entry points spelled the same parse,
 * first-error, resolve and serialize sequence the OpenAPI axis's did, against
 * its own error class (../asyncapi/merge/error.ts, beside ./merge/error.ts). A
 * leaf of its own, named for what it holds, at the lowest package both merge
 * packages already import — not inside either axis's refusal module, where the
 * event axis would read its contracts through a file named for an error.
 * Import direction is asyncapi → openapi, as everywhere else on the contract
 * axes. `writeTreeOver` is the write an EDIT takes — a merge into a living
 * contract, a strip of a feature's markers — so that only what changed is
 * re-printed.
 */
import { isDeepStrictEqual } from "node:util";
import { Document, Pair, Scalar, YAMLMap, isMap, isScalar, parseDocument, type Node } from "yaml";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** A contract's AST, for the writes, and its resolved plain tree, for every shape question. */
export interface ContractTree {
  doc: Document.Parsed;
  plain: unknown;
}

/**
 * Parse a contract, refuse its first parse error, and resolve it. `check` runs
 * between the two, on the AST: the event axis refuses an ambiguous slot key
 * there, BEFORE resolution, so a document that is both ambiguous and carries
 * an unresolvable alias is refused for the ambiguity, exactly as it was when
 * each entry point spelled the sequence out.
 */
export function readTree(text: string, fail: (detail: string) => Error, check?: (doc: Document) => void): ContractTree {
  const doc = parseDocument(text);
  if (doc.errors.length > 0) throw fail(doc.errors[0]!.message);
  check?.(doc);
  return { doc, plain: resolveTree(doc, fail) };
}

/**
 * Resolve aliases once with the document's own anchor context. Calling an
 * individual AST node's toJSON() loses that context and can silently turn an
 * aliased operation, slot or component into the wrong value. An alias that
 * cannot be resolved at all is a document loam cannot read, and says so.
 */
export function resolveTree(doc: Document, fail: (detail: string) => Error): unknown {
  try {
    return doc.toJS() ?? {};
  } catch (error) {
    throw fail(errorMessage(error));
  }
}

/** One spelling of "hand the document back", so every writer fails the same way. */
export function writeTree(doc: Document, fail: (detail: string) => Error): string {
  try {
    return doc.toString();
  } catch (error) {
    throw fail(errorMessage(error));
  }
}

/**
 * Hand an EDITED document back over the text it was parsed from: every map
 * entry the edit did not change keeps its original bytes, and only the entries
 * it added, replaced or removed are written fresh.
 *
 * WHY THE WHOLE-DOCUMENT WRITE WAS NOT ENOUGH. `writeTree` re-serializes every
 * node, and the `yaml` library's printer has opinions the author never asked
 * for: it re-folds every plain or quoted scalar at 80 columns, re-pads every
 * flow sequence (`[a, b]` becomes `[ a, b ]`), and turns CRLF into LF. So an
 * archive that added one channel to a living contract rewrote a long
 * `description` three sections away, and the merge's diff — the thing a
 * reviewer reads to learn what the feature changed — carried lines nobody
 * touched. `lineWidth: 0` is not the fix, and was measured not to be: it stops
 * the folding by JOINING every scalar the author folded by hand onto one line,
 * which on loam's own `examples/docs` rewrote 38 lines of a contract the
 * default printer had left alone. No printer setting reproduces an author's
 * layout; only the author's bytes do.
 *
 * HOW. Both trees are walked in step, block map by block map, keyed on the
 * entry key: an entry whose resolved value is unchanged is left exactly where it
 * is, an entry that changed is either descended into (both sides are block
 * maps) or replaced by the printer's spelling of its new value, a new entry is
 * printed after the entry the edit placed it behind, and a removed one is cut
 * out with the comment lines directly above it — which is where the `yaml`
 * library attaches such a comment, and so what the whole-document write would
 * have removed with it.
 *
 * VERIFIED, OR NOT USED. The spliced text is parsed back and compared, resolved
 * value against resolved value, with the edited tree. Anything the walk does
 * not understand — a key that is not a scalar, a key spelled twice, an entry
 * not on a line of its own, a reorder, an alias it cannot print alone — makes
 * it answer nothing, and so does a splice that would read back as a different
 * document: the fallback is `writeTree`, the old behaviour exactly, so this can
 * only ever narrow a diff and never change what a contract says. The
 * whole-document write also runs first, every time, so a document it cannot
 * print fails the way it always failed.
 */
export function writeTreeOver(doc: Document, source: string, fail: (detail: string) => Error): string {
  const whole = writeTree(doc, fail);
  const spliced = splicedText(doc, source);
  return spliced !== null && readsAs(spliced, doc) ? spliced : whole;
}

/** One replacement of `source[from, to)`. An insertion is `from === to`. */
interface Edit {
  from: number;
  to: number;
  text: string;
}

/** What one walk shares: the original text, its line break, and the edits collected so far. */
interface SpliceRun {
  source: string;
  eol: string;
  edits: Edit[];
}

/** One original entry, located: where its key line starts, where its comments start, where it ends. */
interface Located {
  pair: Pair;
  /** Start of the line the key is on. */
  line: number;
  /** Start of the contiguous comment lines directly above that line, or `line` when there are none. */
  lead: number;
  /** End of the entry, past its line break. */
  end: number;
}


/** One side of the walk: a node, and the value it resolves to through its own document. */
interface Side {
  node: unknown;
  plain: unknown;
}

function splicedText(doc: Document, source: string): string | null {
  const original = parseDocument(source);
  if (original.errors.length > 0) return null;
  const run: SpliceRun = { source, eol: source.includes("\r\n") ? "\r\n" : "\n", edits: [] };
  try {
    // Resolved through each document's own anchors, once — what "unchanged"
    // means is decided on these, never on the nodes.
    const before: Side = { node: original.contents, plain: original.toJS() };
    const after: Side = { node: doc.contents, plain: doc.toJS() };
    if (!spliceMap(run, before, after)) return null;
  } catch {
    // A node the printer cannot print alone — an alias whose anchor sits
    // outside the entry being written — is a document this walk does not
    // understand, and the answer for those is the whole-document write.
    return null;
  }
  // Stable by position, so two insertions at one point keep the order the
  // walk emitted them in — which is the edited tree's order.
  const edits = [...run.edits].sort((a, b) => a.from - b.from);
  let out = "";
  let cursor = 0;
  for (const edit of edits) {
    if (edit.from < cursor) return null;
    out += source.slice(cursor, edit.from) + edit.text;
    cursor = edit.to;
  }
  return out + source.slice(cursor);
}

/** Does the spliced text read back as exactly the edited document? */
function readsAs(text: string, doc: Document): boolean {
  try {
    const back = parseDocument(text);
    return back.errors.length === 0 && isDeepStrictEqual(back.toJS(), doc.toJS());
  } catch {
    return false;
  }
}

function blockMap(node: unknown): node is YAMLMap {
  return isMap(node) && node.flow !== true;
}

/**
 * An entry's key as the resolved tree spells it, or null for a key this walk
 * will not match on. A key the edit SET arrives as the raw value rather than a
 * node — `setIn` builds the pair from what it was handed — and is the same key.
 */
function keyOf(pair: Pair): string | null {
  const value: unknown = isScalar(pair.key) ? pair.key.value : pair.key;
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? String(value) : null;
}

function child(plain: unknown, key: string): unknown {
  return plain !== null && typeof plain === "object" ? (plain as Record<string, unknown>)[key] : undefined;
}

/**
 * Splice one block map. Answers false — and the whole splice is abandoned — on
 * any shape it does not understand; see `writeTreeOver`.
 */
function spliceMap(run: SpliceRun, before: Side, after: Side): boolean {
  if (!blockMap(before.node) || !blockMap(after.node) || before.node.items.length === 0) return false;
  const located = locateEntries(run.source, before.node.items);
  if (located === null) return false;
  const { entries, column: indent } = located;
  const byKey = new Map<string, { at: number; entry: Located }>();
  for (const [at, entry] of entries.entries()) {
    const key = keyOf(entry.pair);
    if (key === null || byKey.has(key)) return false;
    byKey.set(key, { at, entry });
  }
  const kept = new Set<string>();
  let insertAt = entries[0]!.lead;
  let lastAt = -1;
  for (const pair of after.node.items) {
    const key = keyOf(pair);
    if (key === null || kept.has(key)) return false;
    kept.add(key);
    const was = byKey.get(key);
    if (was === undefined) {
      run.edits.push({ from: insertAt, to: insertAt, text: printed(run, pair, indent, insertAt) });
      continue;
    }
    // A reorder is a change this walk cannot express by keeping bytes where
    // they are, and the whole-document write expresses it exactly.
    if (was.at < lastAt) return false;
    lastAt = was.at;
    insertAt = was.entry.end;
    const old: Side = { node: was.entry.pair.value, plain: child(before.plain, key) };
    const now: Side = { node: pair.value, plain: child(after.plain, key) };
    if (isDeepStrictEqual(old.plain, now.plain)) continue;
    const mark = run.edits.length;
    if (blockMap(old.node) && blockMap(now.node) && spliceMap(run, old, now)) continue;
    // Not descended into, or the descent failed: drop whatever it collected
    // and write the entry whole, from its key line to its end. The comment
    // lines above it stay — they are outside the range, and the key printed
    // here carries none of its own.
    run.edits.length = mark;
    run.edits.push({ from: was.entry.line, to: was.entry.end, text: printed(run, pair, indent, was.entry.line) });
  }
  for (const [key, { entry }] of byKey) {
    if (!kept.has(key)) run.edits.push({ from: entry.lead, to: entry.end, text: "" });
  }
  return true;
}

/** A block map's entries, located, and the one column every key in it starts at. */
interface LocatedMap {
  entries: Located[];
  column: number;
}

/** Each entry's line, comment lead and end — or null when one is not on a line of its own at one indentation. */
function locateEntries(source: string, items: readonly Pair[]): LocatedMap | null {
  const entries: Located[] = [];
  let column: number | null = null;
  let bound = 0;
  for (const pair of items) {
    const key = pair.key as Node | null;
    const value = pair.value as Node | null;
    if (!key?.range || !value?.range) return null;
    const start = key.range[0];
    const line = source.lastIndexOf("\n", start - 1) + 1;
    if (line < bound || !/^ *$/.test(source.slice(line, start))) return null;
    if (column !== null && start - line !== column) return null;
    column = start - line;
    const lead = commentLead(source, { line, bound, attached: isScalar(key) && key.commentBefore !== undefined });
    // An EMPTY value — `a:`, `a: !tag`, `a: &x` — ends AT its line break rather
    // than past it, measured on both line endings; without the step a cut
    // leaves a stray blank line, and an insert after it joins the next line.
    let end = value.range[2];
    if (end > 0 && source[end - 1] !== "\n") {
      if (source.startsWith("\r\n", end)) end += 2;
      else if (source[end] === "\n") end += 1;
    }
    entries.push({ pair, line, lead, end });
    bound = end;
  }
  return column === null ? null : { entries, column };
}

/**
 * Where the comment block above an entry's key line starts — the lines the
 * `yaml` library attaches to the key, which a removed entry takes with it, as
 * the whole-document write would. Contiguous comment lines always; across blank
 * lines too when the key carries an attached comment, because the library
 * attaches one separated by a blank line as well. Never above `bound`, the end
 * of the entry before, and never onto a blank line ABOVE the block: those
 * separate this entry from the previous one and stay.
 */
function commentLead(source: string, at: { line: number; bound: number; attached: boolean }): number {
  let lead = at.line;
  for (let cursor = at.line; cursor > at.bound; ) {
    const previous = source.lastIndexOf("\n", cursor - 2) + 1;
    if (previous < at.bound) break;
    const text = source.slice(previous, cursor).trim();
    if (text.startsWith("#")) lead = previous;
    else if (text !== "" || !at.attached) break;
    cursor = previous;
  }
  return lead;
}

/**
 * One entry as the printer spells it, indented to its map's column, in the
 * original's line break. The key is printed BARE — a fresh scalar with the
 * original's quoting style and none of its comments — because the comment
 * lines above an entry stay in place outside the range being replaced, and the
 * printer would otherwise write them a second time.
 */
function printed(run: SpliceRun, pair: Pair, indent: number, at: number): string {
  const key = new Scalar(isScalar(pair.key) ? pair.key.value : pair.key);
  if (isScalar(pair.key) && pair.key.type !== undefined) key.type = pair.key.type;
  const map = new YAMLMap();
  map.items.push(new Pair(key, pair.value));
  const single = new Document();
  single.contents = map;
  const text = single
    .toString()
    .split("\n")
    .map((line) => (line === "" ? line : " ".repeat(indent) + line))
    .join(run.eol);
  // Written where the original stopped without a final line break, the entry
  // needs one in front of it, or it would join the line it follows.
  return at === run.source.length && at > 0 && !run.source.endsWith("\n") ? run.eol + text : text;
}
