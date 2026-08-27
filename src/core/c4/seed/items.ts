/**
 * One fleet.yaml item, read off the AST: the section-item and scalar readers,
 * the `file:line` addressing every refusal opens with, and the one composite
 * entry shape (`services:`'s string-or-mapping item). Split from
 * `./fleet-file.ts` on the phase seam — this module answers "what does this
 * NODE say, and where is it", while fleet-file owns what the answers must
 * amount to (grammar, the flat namespace, reference resolution).
 *
 * `serviceEntry` reports its refusals as a plain `invalid` sentence rather
 * than the reader's discriminated problem union, deliberately: every shape
 * failure at item level maps to `seed-file-invalid`, and returning the
 * sentence keeps this module free of the domain union — the import points
 * fleet-file → items only, never back.
 */
import { isMap, isScalar, isSeq, type LineCounter, type Pair } from "yaml";
import { closeIds } from "../arch.js";

/** What the readers walk with: the display path and the offset→line map. */
export interface SeedCtx {
  readonly file: string;
  readonly lines: LineCounter;
}

/** `file:line` for a node, or just the file when the node carries no range. */
export function at(ctx: SeedCtx, node: unknown): string {
  const range = (node as { range?: readonly [number, number, number] | null }).range;
  if (range === undefined || range === null) return ctx.file;
  return `${ctx.file}:${ctx.lines.linePos(range[0]).line}`;
}

/** A did-you-mean clause over real names, or the empty string. */
export function hint(name: string, pool: readonly string[]): string {
  const close = closeIds(name, [...pool]);
  return close.length === 0 ? "" : ` Did you mean ${close.map((c) => `'${c}'`).join(" or ")}?`;
}

/**
 * A section's items. An absent key and a key with nothing under it are both
 * the empty list — clearing out the last entry must not require deleting the
 * heading too. A non-sequence value comes back as ONE item, which reads
 * `services: checkout` as the one-entry list it plainly means and hands
 * everything else — a number, a mapping under `calls:` — to the caller's
 * per-item type check, which refuses it with the node's own line.
 */
export function listOf(node: unknown): unknown[] {
  if (node === undefined || node === null) return [];
  // `parseDocument` gives a heading with nothing under it a Scalar HOLDING
  // null, never a bare null, so the emptied-out section only looks like the
  // absent one above. Without this arm, deleting the last entry under
  // `externals:` refuses with "an externals entry must be a string (quote it
  // if YAML reads it as something else)" — advice about a value that is not
  // there — and an emptied `services:` shadows the friendly "declares no
  // services" sentence that exists for exactly that case.
  if (isScalar(node) && node.value === null) return [];
  if (isSeq(node)) return node.items;
  return [node];
}

/** A scalar's string value, or null when the entry is not a string. */
export function stringOf(item: unknown): string | null {
  if (!isScalar(item) || typeof item.value !== "string") return null;
  return item.value;
}

export type ServiceEntryRead =
  | { id: string; subsystem: string | null; where: string }
  | { invalid: string };

/** One services entry: a bare string id, or `{ id, subsystem? }` — nothing else. */
export function serviceEntry(ctx: SeedCtx, item: unknown): ServiceEntryRead {
  const where = at(ctx, item);
  const bare = stringOf(item);
  if (bare !== null) return { id: bare, subsystem: null, where };
  if (!isMap(item)) {
    return { invalid: `${where} — a services entry is a string id, or a mapping with \`id\` and optional \`subsystem\`.` };
  }
  let id: string | null = null;
  let subsystem: string | null = null;
  for (const pair of item.items as Pair[]) {
    const key = isScalar(pair.key) && typeof pair.key.value === "string" ? pair.key.value : null;
    const value = stringOf(pair.value);
    if (key === "id" && value !== null) id = value;
    else if (key === "subsystem" && value !== null) subsystem = value;
    else {
      const spelled = key ?? String(pair.key);
      return {
        invalid:
          `${at(ctx, pair.key)} — a services entry takes \`id\` and optional \`subsystem\` ` +
          `(both strings); '${spelled}' is ${key === "id" || key === "subsystem" ? "not a string here" : "not one of them"}.` +
          `${hint(spelled, ["id", "subsystem"])}`,
      };
    }
  }
  if (id === null) {
    return { invalid: `${where} — a services mapping entry must carry \`id\`.` };
  }
  return { id, subsystem, where };
}
