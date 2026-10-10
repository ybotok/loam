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
 * What the index records is every ADDRESS an archived feature vacated, per
 * operationId or message name: where each executed marker stood, whether the
 * relocation rule calls it a retirement or a move. A relocation retires
 * nothing, but it does vacate an address: the id lives on at its new slot,
 * and a later delta quoting the old one would put it back there too — one
 * operationId at two addresses, which the merge cannot tell from an addition
 * any more than it can a retired operation, and which the slot-keyed
 * baseline gate and an id-keyed check both miss (the id is living, the slot
 * is empty). A retirement vacates its address the same way once a later
 * feature re-adds the id somewhere else: indexed by id alone, as this once
 * was, a quote of the retired address read as harmless because the id was
 * living, and archived the id at both. So a vacation carries its address,
 * and for a move where the delta put the entry — kept, because where it
 * lives NOW may be somewhere a later feature put it (`Vacated`). The event
 * axis vacates message addresses the same two ways: a `components.messages`
 * marker, and a channel removal taking its inline declarations. A channel or
 * operation slot's identity IS its key, so a "moved" channel is a retired key
 * plus a new one, and the slot index catches a quote of the old key.
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
 * One archived feature taking one entry out of one address: a retirement
 * (`to` empty) or a move (`to`, every address its delta put the entry at).
 * A move's destination is recorded apart from where the entry lives NOW,
 * because the two part ways as soon as anything lands after the move — A
 * moves an operation from /x to /y, B retires it at /y, D re-adds it at /z —
 * and a finding that named the living address as the mover's destination
 * said "A moved it to /z", an address A never wrote.
 */
export interface Vacated {
  by: string;
  /** `METHOD /path` for an operation, the slot for a message, `<section>.<key>` for a channel or operation slot. */
  at: string;
  to: readonly string[];
}

/**
 * Every vacation of one entry, in feature id order and distinct per feature,
 * address and kind — never empty, because an entry is recorded only together
 * with its first vacation. The tuple says so to the compiler, so the one
 * sentence that names the features (./revived.ts) cannot be handed nobody.
 */
export type Vacations = readonly [Vacated, ...Vacated[]];

/** `METHOD /path` — how the index records, and every finding names, an operation's address. */
export function operationAddress(op: { method: string; path: string }): string {
  return `${op.method.toUpperCase()} ${op.path}`;
}

/** Everything the archived features retired or moved away, each entry naming the features that did it and where. */
export interface RetiredIndex {
  /** `retiredKey(service, operationId)` → every address an archived openapi delta took it out of. */
  operations: ReadonlyMap<string, Vacations>;
  /** `retiredKey(service, section, key)` for a `channels` or `operations` slot — always a retirement. */
  slots: ReadonlyMap<string, Vacations>;
  /** `retiredKey(service, messageName)` — by the join token, every slot it was taken out of. */
  messages: ReadonlyMap<string, Vacations>;
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
 * to ask about — an entry the merged contract answers at an address its
 * living contract does not, which is exactly the shape the living contract
 * alone cannot call new or revived. A feature that only edits what the living
 * contract already holds never walks `features/archive/`; one that adds
 * anything genuinely new does, since an addition and a revival read the same
 * until the walk answers. Without a context (archive's gate) the handle
 * memoises for its own lifetime, which is one `featureCoherence` call, so the
 * two contract axes still share one walk.
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

/** One vacation, as one archived feature's walk finds it: the index key of the entry, the address, and any destinations. */
interface Found {
  key: string;
  at: string;
  to: string[];
}

/** What one archived feature's deltas for one service took out, per index part. */
interface ServiceRetirements {
  featureId: string;
  operations: Found[];
  slots: Found[];
  messages: Found[];
}

/** The index's parts, in the one order `readRetiredIndex` records them. */
const PARTS = ["operations", "slots", "messages"] as const;

/** Walk every archived feature's contract deltas and record every address each one vacated. */
async function readRetiredIndex(docsDir: DocsDir, context?: FleetContext): Promise<RetiredIndex> {
  const index = {
    operations: new Map<string, Vacations>(),
    slots: new Map<string, Vacations>(),
    messages: new Map<string, Vacations>(),
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
    for (const part of PARTS) {
      for (const { key, at, to } of found[part]) record(index[part], key, { by: found.featureId, at, to });
    }
  }
  return index;
}

/** One archived feature's vacations on one service — only the markers its merge carried out. */
async function serviceRetirements(
  feature: FeatureEntry,
  service: RawServiceId,
  context: FleetContext | undefined,
): Promise<ServiceRetirements> {
  const found: ServiceRetirements = { featureId: feature.id, operations: [], slots: [], messages: [] };
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
    // Every carried marker stands on an address it vacated. The relocation
    // rule says which kind: an id in `net` is retired, and one the rule took
    // out of `net` moved — the delta's definitions of it are where it went.
    const { net } = operationRetirements(carried);
    for (const op of carried) {
      if (!op.remove) continue;
      const to = net.has(op.id) ? [] : carried.filter((d) => !d.remove && d.id === op.id).map(operationAddress);
      found.operations.push({ key: retiredKey(service, op.id), at: operationAddress(op), to });
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
    if (!slot.remove || slot.section === "components.messages") continue;
    found.slots.push({ key: retiredKey(service, slot.section, slot.key), at: `${slot.section}.${slot.key}`, to: [] });
  }
  // The operation axis's rule on the message name: a vacated declaration
  // whose name the delta declares again was relocated — to another key, or
  // inline under a channel — and those declarations are where it went.
  const retired = messageRetirements(carriedEvents, carriedSlots, before?.doc ?? NOTHING_DECLARED);
  for (const m of retired.vacated) {
    const to = retired.net.has(m.name)
      ? []
      : carriedEvents.messages.filter((d) => d.remove !== true && d.name === m.name).map((d) => d.slot);
    found.messages.push({ key: retiredKey(service, m.name), at: m.slot, to });
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
 * Add one vacation. Already in id order without a sort: the walk records the
 * features in `listFeatures`' `compareIds` order. Distinct per feature,
 * address and kind, because two archived directories can carry one feature
 * id (the id is read off the directory name), and "archived FEAT-7 and
 * FEAT-7" names one feature twice — a second directory's move away from the
 * same address widens that feature's destinations instead.
 */
function record(into: Map<string, Vacations>, key: string, vacated: Vacated): void {
  const all = into.get(key);
  if (all === undefined) {
    into.set(key, [vacated]);
    return;
  }
  const same = (v: Vacated): boolean =>
    v.by === vacated.by && v.at === vacated.at && (v.to.length === 0) === (vacated.to.length === 0);
  if (!all.some(same)) {
    into.set(key, [...all, vacated]);
    return;
  }
  const widen = (v: Vacated): Vacated => (same(v) ? { ...v, to: [...new Set([...v.to, ...vacated.to])] } : v);
  const [first, ...rest] = all;
  into.set(key, [widen(first), ...rest.map(widen)]);
}
