/**
 * The retired index: what every ARCHIVED feature took out of the fleet's living
 * contracts, and who took it.
 *
 * The question it answers is one the living contract cannot: is an operation
 * the living contract does not have NEW, or was it RETIRED? Both read as
 * absent. Before this index existed the feature gate could only treat absent
 * as new — so a delta quoting an operation that a parallel feature retired and
 * archived first was graded as an addition (`api.op-unconsumed`, advisory) and
 * archived at exit 0, putting the retired operation straight back into the
 * living contract. The baseline gate's unpinned count (openapi/baseline/gate.ts)
 * could not see it either: it counts only quotes of operations the living
 * contract still has, so that a genuinely new operation never trips it.
 *
 * The record of a retirement is files, not history. An archived feature keeps
 * its delta under `features/archive/<FEAT>/specs/<svc>/`, and the removal
 * markers in it say what that merge was ASKED to delete — read through the
 * same rule the gate grades an in-flight delta by (./retirement.ts), so
 * relocations are not retirements here either. No git: the docs semantics stay
 * a property of the tree.
 *
 * Asked is not done. The OpenAPI merge deletes only when the living operation
 * AT the marker's method and path carries the marker's operationId
 * (openapi/merge/merge.ts); the event merge deletes a channel or operation slot
 * only when the living contract has that key, and a `components.messages` slot
 * only when the message declared there carries the marker's name
 * (asyncapi/merge/merge.ts). A marker that missed — `remove-target-missing` or
 * `remove-target-mismatch`, archived past under `--approve` — deleted nothing,
 * and counting it called a genuinely new operation a revival and refused it.
 * So every marker is checked against the contract the merge ran against: the
 * feature's snapshot pre-image (`.loam-before/`, staging/snapshot/manifest.ts).
 * A contract the archive CREATED, or never wrote at all, lost nothing to that
 * merge, and reads as an empty pre-image. "Never wrote" is the event merge's
 * case alone: it returns no text when it changes nothing (an asyncapi delta
 * whose every marker missed), and archive snapshots only what it writes. The
 * OpenAPI merge returns text whenever the delta has a path entry, so a
 * contract it left unchanged has an ordinary pre-image equal to what it
 * wrote — read like any other, and every missed marker misses it again. A
 * feature with no intact snapshot (archived before the snapshot existed, or
 * the snapshot edited or removed since) cannot be checked, and its markers
 * count as written — what the index did before it read pre-images at all.
 *
 * The pre-image answers one more thing the delta does not spell: a
 * CHANNEL-slot removal retires the messages its living channel declared
 * inline, and those names exist only in the contract the merge ran against. A
 * feature archived without a pre-image contributes its channel slot and not
 * the inline names.
 *
 * A relocation retires nothing, but it does VACATE an address: the id lives
 * on at its new slot, and a later delta quoting the old one would put it back
 * there too — one operationId at two addresses, which the merge cannot tell
 * from an addition any more than it can a retired operation, and which the
 * slot-keyed baseline gate and the id-keyed revival check both missed (the id
 * is living, the slot is empty). So the index records moves as well: the
 * marker ids the relocation rule removes from the net set are exactly the
 * moved ids, their old slots are on the markers, and where each went is the
 * delta's own definition of it — kept, because where the id lives NOW may be
 * somewhere a later feature put it (`ArchivedMove`). The event axis has the
 * same shape in one place only — a `components.messages` marker whose message
 * name the delta declares again elsewhere; a channel or operation slot's
 * identity IS its key, so a "moved" channel is a retired key plus a new one,
 * and the slot index already catches a quote of the old key.
 *
 * What it cannot see, and SCHEMA.md says so: a removal made by hand-editing a
 * living contract leaves no marker anywhere, and an archived feature deleted
 * from disk takes its markers with it. Both read as "never retired" — the gate
 * falls back to calling the entry new, which is what it did before.
 *
 * OpenAPI markers count only when they name an operationId. A marker with
 * none (`openapi.remove-marker-anonymous`) or one written at PATH level
 * (`openapi.remove-marker-path-level`) retires nothing at archive — the merge
 * matches a marker to the living operation by the operationId it names, at
 * its own method and path, and these name none — so an archived feature that
 * carried one under `--approve` left the operation living, and indexing its
 * slot would attribute a retirement that never happened.
 */
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";
import { inOrder, memo } from "../../kernel/concurrency.js";
import type { DocsDir } from "../../kernel/ids/dirs.js";
import type { RawServiceId } from "../../kernel/ids/service.js";
import type { FeatureEntry } from "../../repo/entries.js";
import { archiveDir, ARTIFACT_FILES, featureSpecPaths } from "../../repo/paths.js";
import { listFeatures } from "../../repo/repo.js";
import { openapiFromText, readOpenapi } from "../../openapi/doc.js";
import { readOr } from "../../openapi/contract-text.js";
import { asyncapiSlots, slotKey, slotsByKey, type AsyncapiSlot } from "../../asyncapi/digest.js";
import { asyncapiFromText, readAsyncapi } from "../../asyncapi/read.js";
import type { AsyncapiDoc } from "../../asyncapi/model.js";
import { readSnapshotPreImage } from "../../staging/snapshot/manifest.js";
import type { FleetContext } from "../../fleet-context.js";
import { messageRetirements, operationRetirements } from "./retirement.js";

/**
 * The archived features that retired one entry (or moved it away from one
 * address), in id order and distinct — never empty, because an entry is
 * recorded only together with its first retirer. The tuple says so to the compiler, so the one sentence that names
 * them (./revived.ts) cannot be handed nobody.
 */
export type ArchivedBy = readonly [string, ...string[]];

/**
 * One archived feature's relocation of one entry away from one address: the
 * feature, and every address its delta put the entry at. Recorded apart from
 * where the entry lives NOW, because the two part ways as soon as anything
 * lands after the move — A moves an operation from /x to /y, B retires it at
 * /y, D re-adds it at /z — and a finding that named the living address as
 * the mover's destination said "A moved it to /z", an address A never wrote.
 */
export interface ArchivedMove {
  by: string;
  to: readonly string[];
}

/** The archived features that moved one entry away from one address — `ArchivedBy`'s order, distinctness and non-emptiness. */
export type ArchivedMoves = readonly [ArchivedMove, ...ArchivedMove[]];

/** `METHOD /path` — how the index records, and every finding names, an operation's address. */
export function operationAddress(op: { method: string; path: string }): string {
  return `${op.method.toUpperCase()} ${op.path}`;
}

/** Everything the archived features retired or moved away, each entry naming the features that did it. */
export interface RetiredIndex {
  /** `retiredKey(service, operationId)` → the archived features whose openapi delta retired it. */
  operations: ReadonlyMap<string, ArchivedBy>;
  /** `retiredKey(service, section, key)` for a `channels` or `operations` slot. */
  slots: ReadonlyMap<string, ArchivedBy>;
  /** `retiredKey(service, messageName)` — by the join token, wherever the message was declared. */
  messages: ReadonlyMap<string, ArchivedBy>;
  /** `retiredKey(service, operationId, method, path)` — the address a relocation moved that operation away from. */
  movedOperations: ReadonlyMap<string, ArchivedMoves>;
  /** `retiredKey(service, messageName, slot)` — the `components.messages.<key>` a relocation moved that message away from. */
  movedMessages: ReadonlyMap<string, ArchivedMoves>;
}

/** The index's one key spelling. NUL-joined: no id, section, key or message name can contain it. */
export function retiredKey(...parts: string[]): string {
  return parts.join("\0");
}

/** The index, built at most once per caller — what the gate hands both contract axes. */
export type RetiredLookup = () => Promise<RetiredIndex>;

/**
 * One index per invocation, keyed by the invocation's own FleetContext.
 *
 * A module-level cache is normally the wrong shape (AGENTS.md: a value cached
 * at import time leaks across tests and, in a long-running host, across
 * invocations). This one is the `c4/resolve/service.ts` exception for the same
 * reason: the key is the per-invocation context object, so two runs can never
 * see each other's answer and the entry dies with the context. It is here
 * rather than a memo on FleetContext because that class sits at L6 and this
 * package at L8 — the import that memo would need points the wrong way up the
 * DAG (docs/DESIGN.md's level table) — while the reads underneath (the feature
 * list, every contract parse) already go through the context's own memos.
 */
const PER_INVOCATION = new WeakMap<FleetContext, Map<string, Promise<RetiredIndex>>>();

/**
 * A lazy handle on the index: nothing is read until a grader has a candidate
 * to ask about — an entry absent from its living contract, which is exactly
 * the shape the living contract alone cannot call new or retired. A feature
 * that only edits what the living contract already holds never walks
 * `features/archive/`; one that adds anything genuinely new does, since an
 * addition and a revival read the same until the walk answers. Without a
 * context (archive's gate) the handle memoises for its own lifetime, which is
 * one `featureCoherence` call, so the two contract axes still share one walk.
 */
export function retiredLookup(docsDir: DocsDir, context?: FleetContext): RetiredLookup {
  let own: Promise<RetiredIndex> | undefined;
  return () => {
    if (context === undefined) return (own ??= readRetiredIndex(docsDir));
    let store = PER_INVOCATION.get(context);
    if (store === undefined) PER_INVOCATION.set(context, (store = new Map()));
    return memo(store, resolve(docsDir), () => readRetiredIndex(docsDir, context));
  };
}

/** One move, as one archived feature's walk finds it: the index key of the vacated address, and where the delta put the entry. */
interface MoveFound {
  key: string;
  to: string[];
}

/** What one archived feature's deltas for one service retired or moved away, as index keys. */
interface ServiceRetirements {
  featureId: string;
  operations: string[];
  slots: string[];
  messages: string[];
  movedOperations: MoveFound[];
  movedMessages: MoveFound[];
}

/** The index's parts, in the one order `readRetiredIndex` records them — retirements, then moves. */
const RETIRED_PARTS = ["operations", "slots", "messages"] as const;
const MOVED_PARTS = ["movedOperations", "movedMessages"] as const;

/** Walk every archived feature's contract deltas and record what each one retired or moved away. */
async function readRetiredIndex(docsDir: DocsDir, context?: FleetContext): Promise<RetiredIndex> {
  const index = {
    operations: new Map<string, ArchivedBy>(),
    slots: new Map<string, ArchivedBy>(),
    messages: new Map<string, ArchivedBy>(),
    movedOperations: new Map<string, ArchivedMoves>(),
    movedMessages: new Map<string, ArchivedMoves>(),
  };
  // A `features/archive` that is not a directory holds no archived feature,
  // and listing it would throw ENOTDIR out of the feature gate — refusing an
  // archive over a question about OTHER features' history, before the plan
  // that names the real problem (the final move into that path) is reached.
  if (!isDirectory(archiveDir(docsDir))) return index;
  const archived = (await listFeatures(docsDir, { includeArchived: true }, context)).filter((f) => f.archived);
  const units = archived.flatMap((feature) => feature.services.map((service) => ({ feature, service })));
  // Every (feature, service) pair is independent of every other, so they are
  // read concurrently; the only order that matters is the order retirers are
  // RECORDED in, and `inOrder` hands the answers back in input order — the
  // features sorted by `compareIds`, as `listFeatures` returns them.
  for (const found of await inOrder(units, ({ feature, service }) => serviceRetirements(feature, service, context))) {
    for (const part of RETIRED_PARTS) for (const key of found[part]) record(index[part], key, found.featureId);
    for (const part of MOVED_PARTS) {
      for (const { key, to } of found[part]) recordMove(index[part], key, { by: found.featureId, to });
    }
  }
  return index;
}

/** One archived feature's retirements and moves on one service — only the markers its merge carried out. */
async function serviceRetirements(
  feature: FeatureEntry,
  service: RawServiceId,
  context: FleetContext | undefined,
): Promise<ServiceRetirements> {
  const found: ServiceRetirements = {
    featureId: feature.id, operations: [], slots: [], messages: [], movedOperations: [], movedMessages: [],
  };
  const paths = featureSpecPaths(feature.dir, service);
  // An absent delta reads as an empty document; an unreadable one retired
  // nothing loam could have merged (archive refuses `merge-failed`).
  const api = await readOpenapi(paths.openapi, context);
  if (!api.unreadable && api.ops.some((op) => op.remove)) {
    const before = await preImage(feature.dir, service, ARTIFACT_FILES.openapi);
    const held = before === undefined ? undefined : openapiFromText(before);
    // The merge's own match: the operation the pre-image held AT the marker's
    // slot carries the marker's id. Markers that missed are dropped before the
    // rule runs, so a relocation whose old-slot marker missed is no
    // relocation either — it moved nothing out.
    const carried = api.ops.filter(
      (op) =>
        !op.remove ||
        held === undefined ||
        held.unreadable ||
        held.ops.some((h) => !h.remove && h.id === op.id && h.method === op.method && h.path === op.path),
    );
    const { markerIds, net } = operationRetirements(carried);
    for (const id of net) found.operations.push(retiredKey(service, id));
    // The marker ids the relocation rule took out of `net` are the moved ones,
    // and each marker carrying one stands on an address it vacated; the
    // delta's definitions of the same id are where it went.
    for (const op of carried) {
      if (op.remove && markerIds.has(op.id) && !net.has(op.id)) {
        const to = carried.filter((d) => !d.remove && d.id === op.id).map(operationAddress);
        found.movedOperations.push({ key: retiredKey(service, op.id, op.method, op.path), to });
      }
    }
  }
  if (!existsSync(paths.asyncapi)) return found;
  const events = await readAsyncapi(paths.asyncapi, context);
  const text = events.unreadable ? undefined : await readOr(paths.asyncapi, context);
  if (text === undefined) return found;
  const eventSlots = asyncapiSlots(parse(text));
  if (!eventSlots.some((s) => s.remove)) return found;
  const before = await preImageEvents(feature.dir, service);
  // Presence is the whole match for a channel or operation slot — its
  // identity IS the key. A message marker must also name the message the
  // pre-image declared at that key, the merge's exactness on the message axis.
  const carriedSlots = eventSlots.filter((s) => !s.remove || before === undefined || before.slots.has(slotKey(s)));
  const carriedEvents: AsyncapiDoc = {
    ...events,
    messages: events.messages.filter(
      (m) =>
        m.remove !== true ||
        before === undefined ||
        before.doc.messages.some((b) => b.remove !== true && b.slot === m.slot && b.name === m.name),
    ),
  };
  for (const slot of carriedSlots) {
    if (slot.remove && slot.section !== "components.messages") found.slots.push(retiredKey(service, slot.section, slot.key));
  }
  const retired = messageRetirements(carriedEvents, carriedSlots, before?.doc ?? NOTHING_DECLARED);
  for (const name of retired.net) found.messages.push(retiredKey(service, name));
  // A message marker whose name the delta declares again is a relocation: the
  // key it stands on is the address the message moved away from, and the
  // declarations are where it went — another key, or inline under a channel.
  for (const m of carriedEvents.messages) {
    if (m.remove === true && m.slot.startsWith("components.messages.") && retired.redeclared.has(m.name)) {
      const to = carriedEvents.messages.filter((d) => d.remove !== true && d.name === m.name).map((d) => d.slot);
      found.movedMessages.push({ key: retiredKey(service, m.name, m.slot), to });
    }
  }
  return found;
}

const NOTHING_DECLARED: AsyncapiDoc = asyncapiFromText("");

/**
 * The contract one artifact held as this feature's merge found it, or
 * undefined when the snapshot holds nothing to trust. An artifact the merge
 * created, or never wrote, lost nothing to it — which is exactly what an empty
 * pre-image says: every marker in the delta missed, and no channel took inline
 * names with it.
 */
async function preImage(featureDir: string, service: string, artifact: string): Promise<string | undefined> {
  const found = await readSnapshotPreImage(featureDir, { service, artifact });
  if (found === null) return undefined;
  return found.kind === "held" ? found.text : "";
}

/** The event pre-image as the reader and the slot walk see it — undefined when absent or unreadable. */
async function preImageEvents(
  featureDir: string,
  service: string,
): Promise<{ doc: AsyncapiDoc; slots: ReadonlyMap<string, AsyncapiSlot> } | undefined> {
  const text = await preImage(featureDir, service, ARTIFACT_FILES.asyncapi);
  if (text === undefined) return undefined;
  const doc = asyncapiFromText(text);
  return doc.unreadable ? undefined : { doc, slots: slotsByKey(asyncapiSlots(parse(text))) };
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Add one retirer. Already in id order without a sort: the walk records the
 * features in `listFeatures`' `compareIds` order. Distinct because two
 * archived directories can carry one feature id (the id is read off the
 * directory name), and "archived FEAT-7 and FEAT-7" names one feature twice.
 */
function record(into: Map<string, ArchivedBy>, key: string, featureId: string): void {
  const by = into.get(key);
  if (by === undefined) into.set(key, [featureId]);
  else if (!by.includes(featureId)) into.set(key, [...by, featureId]);
}

/**
 * Add one move, in `record`'s order and distinct by feature for its reason:
 * a second directory carrying the same id adds its destinations to that
 * feature's move rather than naming the feature twice.
 */
function recordMove(into: Map<string, ArchivedMoves>, key: string, move: ArchivedMove): void {
  const moves = into.get(key);
  if (moves === undefined) {
    into.set(key, [move]);
    return;
  }
  if (!moves.some((m) => m.by === move.by)) {
    into.set(key, [...moves, move]);
    return;
  }
  const widen = (m: ArchivedMove): ArchivedMove => (m.by === move.by ? { by: m.by, to: [...new Set([...m.to, ...move.to])] } : m);
  const [first, ...rest] = moves;
  into.set(key, [widen(first), ...rest.map(widen)]);
}
