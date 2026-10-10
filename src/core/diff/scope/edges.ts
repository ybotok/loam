/**
 * Which fleet-map call edges a branch introduced — the one half of the `--base`
 * narrowing that reads a document.
 *
 * The defect this exists for: `spine.op-undefined` is graded on the PROVIDER's
 * service target, and an `architecture/` change only ever put the landscape in
 * scope. So the hand edit the spine-first path is built on — naming the
 * operation on a call edge — was graded by no gate a PR runs: README's own
 * one-letter example (`authorisePayment` against a contract spelling it
 * `authorizePayment`) merged green through `loam diff --base` and through
 * `validate --all --base --strict`, on the adopted example fleet and on a
 * freshly seeded one alike. This module answers the question that grade needs
 * — which edges are this branch's — and `commands/validate/scope.ts` grades
 * exactly those against their providers' contracts.
 *
 * AN EDGE IS ITS (source, target, op) TUPLE. A tuple present now and absent at
 * the base is new or changed — a new edge, a re-pointed one, a renamed
 * endpoint, an op named or re-spelled — and every one of those is a join the
 * branch wrote. A tuple present at both ends is not, wherever in the file it
 * moved and however it was re-indented: the key is what the edge MEANS, so a
 * reformat grades nothing.
 *
 * TEXT, NOT A PARSE, at both ends. The base side would otherwise need a second
 * LikeC4 workspace over bytes read out of git — the most expensive thing loam
 * does, paid on every map PR to answer a question about a handful of lines.
 * `scanModel` is the archive's splice map and resolves endpoints the way LikeC4
 * does; `test/likec4-scan-parity.test.ts` pins the two readings together, and
 * the key below is built from the same three fields the parsed `Rel` carries, so
 * a scanned key names the edge the parsed map holds.
 *
 * ONLY THE DOCUMENTS THAT CHANGED are read, at both ends: an edge in an
 * untouched document is by construction not this branch's, and an edge moved
 * between two documents changes both, so its base key is still read.
 *
 * Which way a failure falls, and why: a base document git will not show — new
 * on this branch, or a git that declines — contributes no base keys, so every
 * edge in it reads as new and is graded. Grading an edge the branch did not
 * write costs a reader one finding; skipping one it did write is the green this
 * module exists to remove.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { scanModel } from "../../c4/source-scan.js";
import { inOrder } from "../../kernel/concurrency.js";
import { showBaseFile, type ResolvedBase } from "../base-git.js";

/** The fields of an edge that make it the same join — shared by a parsed `Rel` and a scanned one. */
interface EdgeTuple {
  source: string;
  target: string;
  op?: string;
}

/**
 * One edge's identity as a string a `Set` can hold. JSON rather than a joined
 * string because an element id may legally carry any separator a join would
 * pick, and two different tuples must never spell one key.
 */
export function edgeKey(edge: EdgeTuple): string {
  return JSON.stringify([edge.source, edge.target, edge.op ?? null]);
}

function keysOf(text: string | null): string[] {
  return text === null ? [] : (scanModel(text)?.rels ?? []).map(edgeKey);
}

/** The document as the base commit held it, or null when git will not show it (see the banner for why that is safe). */
async function baseText(base: ResolvedBase, rel: string): Promise<string | null> {
  const read = await showBaseFile(base, rel);
  return read.kind === "ok" ? read.bytes.toString("utf8") : null;
}

/** The document as the working tree holds it, or null when the branch deleted it. */
async function currentText(base: ResolvedBase, rel: string): Promise<string | null> {
  const abs = join(base.docsDir, rel);
  return existsSync(abs) ? readFile(abs, "utf8") : null;
}

/**
 * The `edgeKey`s of every edge `documents` hold now and did not hold at the
 * base. `documents` are docs-relative `.likec4` paths the branch changed —
 * the caller's filter, so this module never has to know which directory the
 * fleet map lives in.
 */
export async function edgesSince(base: ResolvedBase, documents: readonly string[]): Promise<ReadonlySet<string>> {
  const sides = await inOrder(documents, async (rel) => {
    const [before, after] = await Promise.all([baseText(base, rel), currentText(base, rel)]);
    return { before: keysOf(before), after: keysOf(after) };
  });
  const before = new Set(sides.flatMap((side) => side.before));
  return new Set(sides.flatMap((side) => side.after).filter((key) => !before.has(key)));
}
