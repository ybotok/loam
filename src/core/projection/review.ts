/**
 * The review half of `loam delta --diff`: what each requirement, operation and
 * message in one service's slice of a feature does to the living documents —
 * `new`, a `quote` of what is there, an `edit`, or a `remove` — and, for an
 * edit or a removal, the line diff a reviewer reads instead of two documents
 * side by side.
 *
 * The question it answers is the design review's. On the authoring pull
 * request nothing said how a MODIFIED requirement or a restated operation
 * differed from what lives: `delta` printed the new text whole, `show` gave
 * counts, and `loam diff` on a branch whose only change is a delta said "no
 * fleet-meaningful changes" — so a reviewer either opened both files or
 * approved a clause they never saw go.
 *
 * WHAT COUNTS AS THE SAME, axis by axis, and each is a reading the merge
 * already makes rather than a second opinion beside it:
 *
 *  - a requirement is compared through `serializeRequirements` with its
 *    baseline and `Realizes:` pins set aside — the input `requirementDigest`
 *    hashes — and paired with its living requirement by `replacementsOf`, the
 *    walk the merge itself takes;
 *  - an operation is compared by `digest` (the node, pin excluded), not by
 *    `closureDigest`: a delta that restates an operation and leans on a
 *    living schema it does not repeat would read as an edit of everything it
 *    references;
 *  - a message is compared by its node at the same slot, for that reason.
 *
 * A projection, never a gate: nothing here is graded, and a pair the merge
 * would refuse (malformed `Requirement-ID`s) is answered `null` — `validate
 * --feature` names that under its own code.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { replacementsOf, type Replacement } from "../document/apply.js";
import {
  requirementDigest,
  serializeRequirements,
  withoutBaseline,
  withoutRealizesPins,
  type Requirement,
} from "../document/spec.js";
import { readOpenapi } from "../openapi/doc.js";
import { valueDigest, withoutFeatureKeysDeep } from "../openapi/digest.js";
import { entriesOf, isSlotRemoval } from "../asyncapi/digest.js";
import { isRecord } from "../kernel/records.js";

/** What one item of the delta does to the living document. */
export type Change = "new" | "quote" | "edit" | "remove";

/** One line of a diff: kept (`=`), added (`+`) or removed (`-`). */
export interface DiffLine {
  op: "=" | "+" | "-";
  line: string;
}

/** A requirement's review: `null` where the merge itself could not pair it. */
export interface Review {
  change: Change | null;
  /** Present for an `edit`, and for a `remove` of something living. */
  diff?: DiffLine[];
}

/**
 * Past this many cells the table is not built, and the diff is the whole
 * before removed and the whole after added — still true, only less helpful.
 * A requirement or an operation is tens of lines; this bounds a pathological
 * document, not an ordinary one.
 */
const MAX_CELLS = 4_000_000;

/**
 * The longest-common-subsequence line diff: every line of `before` and
 * `after`, in order, each marked kept, removed or added.
 */
export function lineDiff(before: readonly string[], after: readonly string[]): DiffLine[] {
  const n = before.length;
  const m = after.length;
  if (n * m > MAX_CELLS) {
    return [...before.map((line) => ({ op: "-" as const, line })), ...after.map((line) => ({ op: "+" as const, line }))];
  }
  // lcs[i][j]: the common length of before[i..] and after[j..], flattened.
  const width = m + 1;
  const lcs = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * width + j] = before[i] === after[j]
        ? lcs[(i + 1) * width + j + 1]! + 1
        : Math.max(lcs[(i + 1) * width + j]!, lcs[i * width + j + 1]!);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (before[i] === after[j]) {
      out.push({ op: "=", line: before[i]! });
      i++;
      j++;
    } else if (lcs[(i + 1) * width + j]! >= lcs[i * width + j + 1]!) {
      out.push({ op: "-", line: before[i++]! });
    } else {
      out.push({ op: "+", line: after[j++]! });
    }
  }
  while (i < n) out.push({ op: "-", line: before[i++]! });
  while (j < m) out.push({ op: "+", line: after[j++]! });
  return out;
}

/** A requirement as the merge writes it, bookkeeping aside, as lines. */
function canonicalLines(requirement: Requirement): string[] {
  return serializeRequirements([withoutRealizesPins(withoutBaseline(requirement))]).trimEnd().split("\n");
}

/**
 * Each delta requirement's review, in delta order, against the living ones.
 *
 * A delta requirement is paired with the replacement record the merge makes for
 * the requirement it selects — by `Requirement-ID` where it carries one, by
 * heading otherwise, as the fold does — so a MODIFIED that lands on nothing
 * reads `new`, which is what the archive does with it.
 */
export function reviewRequirements(delta: readonly Requirement[], living: readonly Requirement[]): Review[] {
  let replaced: Replacement[];
  try {
    replaced = replacementsOf([...living], [...delta]);
  } catch {
    return delta.map(() => ({ change: null }));
  }
  return delta.map((d): Review => {
    if (d.kind === "BASE") return { change: null };
    const same = (r: Requirement): boolean => (d.id !== undefined ? r.id === d.id : r.name === d.name);
    const record = replaced.find((r) => same(r.living));
    if (record === undefined) return { change: d.kind === "REMOVED" ? "remove" : "new" };
    if (record.merged === null) {
      return { change: "remove", diff: canonicalLines(record.living).map((line) => ({ op: "-", line })) };
    }
    if (requirementDigest(record.living) === requirementDigest(record.merged)) return { change: "quote" };
    return { change: "edit", diff: lineDiff(canonicalLines(record.living), canonicalLines(record.merged)) };
  });
}

/** A document parsed for the node walk, or null — a review is decoration and never the reason a brief fails. */
async function parsed(path: string): Promise<unknown> {
  if (!existsSync(path)) return null;
  try {
    return parseYaml(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

/** The node at `paths[path][method]`, or undefined. */
function operationNode(doc: unknown, path: string, method: string): unknown {
  if (!isRecord(doc) || !isRecord(doc["paths"])) return undefined;
  const item = doc["paths"][path];
  return isRecord(item) ? item[method] : undefined;
}

/** A node as a reviewer reads it: YAML, the feature's own keys stripped. */
function yamlLines(node: unknown): string[] {
  return stringifyYaml(withoutFeatureKeysDeep(node)).trimEnd().split("\n");
}

/**
 * Each feature operation's review against the living contract, keyed
 * `<METHOD> <path>` — the slot the merge addresses, spelled as `ApiChange`
 * spells it (`./api.ts` upper-cases the method; the document's keys do not). An unreadable document on
 * either side answers nothing, so every key is absent and the brief says so by
 * omission, beside the `openapi.unreadable` it already carries.
 */
export async function reviewOperations(featurePath: string, livingPath: string): Promise<Map<string, Review>> {
  const out = new Map<string, Review>();
  if (!existsSync(featurePath)) return out;
  const feature = await readOpenapi(featurePath);
  if (feature.unreadable) return out;
  const living = existsSync(livingPath) ? await readOpenapi(livingPath) : null;
  if (living?.unreadable === true) return out;
  const slotOf = (op: { method: string; path: string }): string => `${op.method.toUpperCase()} ${op.path}`;
  const livingBySlot = new Map((living?.ops ?? []).map((op) => [slotOf(op), op]));
  const [featureDoc, livingDoc] = [await parsed(featurePath), await parsed(livingPath)];
  for (const op of feature.ops) {
    const slot = slotOf(op);
    const before = livingBySlot.get(slot);
    if (op.remove) {
      const node = operationNode(livingDoc, op.path, op.method);
      out.set(slot, before === undefined || node === undefined
        ? { change: "remove" }
        : { change: "remove", diff: yamlLines(node).map((line) => ({ op: "-", line })) });
    } else if (before === undefined) out.set(slot, { change: "new" });
    else if (before.digest === op.digest) out.set(slot, { change: "quote" });
    else {
      const was = operationNode(livingDoc, op.path, op.method);
      const now = operationNode(featureDoc, op.path, op.method);
      out.set(slot, was === undefined || now === undefined
        ? { change: "edit" }
        : { change: "edit", diff: lineDiff(yamlLines(was), yamlLines(now)) });
    }
  }
  return out;
}

/** Every message declaration in a parsed AsyncAPI document, by the slot `read.ts` names it with. */
function messageSlots(doc: unknown): Map<string, unknown> {
  const out = new Map<string, unknown>();
  if (!isRecord(doc)) return out;
  const components = doc["components"];
  for (const [key, node] of entriesOf(isRecord(components) ? components["messages"] : undefined)) {
    out.set(`components.messages.${key}`, node);
  }
  for (const [ck, channel] of entriesOf(doc["channels"])) {
    for (const [mk, node] of entriesOf(isRecord(channel) ? channel["messages"] : undefined)) {
      out.set(`channels.${ck}.messages.${mk}`, node);
    }
  }
  return out;
}

/**
 * Each feature message declaration's change, keyed by its slot: the node at
 * the same slot in the living contract, compared with the feature's own keys
 * stripped. A slot living does not have is `new`.
 */
export async function reviewMessages(featurePath: string, livingPath: string): Promise<Map<string, Change>> {
  const feature = messageSlots(await parsed(featurePath));
  const living = messageSlots(await parsed(livingPath));
  const out = new Map<string, Change>();
  for (const [slot, node] of feature) {
    const before = living.get(slot);
    if (isSlotRemoval(node)) out.set(slot, "remove");
    else if (before === undefined) out.set(slot, "new");
    else {
      out.set(slot, valueDigest(withoutFeatureKeysDeep(before)) === valueDigest(withoutFeatureKeysDeep(node)) ? "quote" : "edit");
    }
  }
  return out;
}
