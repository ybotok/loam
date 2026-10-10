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
 * markers in it say what that merge deleted — read through the same rule the
 * gate grades an in-flight delta by (./retirement.ts), so relocations are not
 * retirements here either. No git: the docs semantics stay a property of the
 * tree. One thing the delta does not spell: a CHANNEL-slot removal retires the
 * messages its living channel declared inline, and those names exist only in
 * the contract the merge ran against — so they are read from the feature's
 * snapshot pre-image (`.loam-before/`, staging/snapshot/manifest.ts), and a
 * feature archived without one contributes its channel slot and not the
 * inline names.
 *
 * What it cannot see, and SCHEMA.md says so: a removal made by hand-editing a
 * living contract leaves no marker anywhere, and an archived feature deleted
 * from disk takes its markers with it. Both read as "never retired" — the gate
 * falls back to calling the entry new, which is what it did before.
 *
 * OpenAPI markers count only when they name an operationId. A marker with
 * none (`openapi.remove-marker-anonymous`) or one written at PATH level
 * (`openapi.remove-marker-path-level`) retires nothing at archive — the merge
 * deletes only a living operation whose id the marker names, and has since the
 * marker existed — so an archived feature that carried one under `--approve`
 * left the operation living, and indexing its slot would attribute a
 * retirement that never happened.
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
import { readOpenapi } from "../../openapi/doc.js";
import { readOr } from "../../openapi/contract-text.js";
import { asyncapiSlots } from "../../asyncapi/digest.js";
import { asyncapiFromText, readAsyncapi } from "../../asyncapi/read.js";
import type { AsyncapiDoc } from "../../asyncapi/model.js";
import { readSnapshotPreImage } from "../../staging/snapshot/manifest.js";
import type { FleetContext } from "../../fleet-context.js";
import { messageRetirements, operationRetirements } from "./retirement.js";

/**
 * The archived features that retired one entry, in id order and distinct —
 * never empty, because an entry is recorded only together with its first
 * retirer. The tuple says so to the compiler, so the one sentence that names
 * them (./revived.ts) cannot be handed nobody.
 */
export type ArchivedBy = readonly [string, ...string[]];

/** Everything the archived features retired, each entry naming the features that did it. */
export interface RetiredIndex {
  /** `retiredKey(service, operationId)` → the archived features whose openapi delta retired it. */
  operations: ReadonlyMap<string, ArchivedBy>;
  /** `retiredKey(service, section, key)` for a `channels` or `operations` slot. */
  slots: ReadonlyMap<string, ArchivedBy>;
  /** `retiredKey(service, messageName)` — by the join token, wherever the message was declared. */
  messages: ReadonlyMap<string, ArchivedBy>;
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

/** What one archived feature's deltas for one service retired, as index keys. */
interface ServiceRetirements {
  featureId: string;
  operations: string[];
  slots: string[];
  messages: string[];
}

/** The index's parts, in the one order `readRetiredIndex` records them. */
const PARTS = ["operations", "slots", "messages"] as const;

/** Walk every archived feature's contract deltas and record what each one retired. */
async function readRetiredIndex(docsDir: DocsDir, context?: FleetContext): Promise<RetiredIndex> {
  const index = { operations: new Map<string, ArchivedBy>(), slots: new Map<string, ArchivedBy>(), messages: new Map<string, ArchivedBy>() };
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
    for (const part of PARTS) for (const key of found[part]) record(index[part], key, found.featureId);
  }
  return index;
}

/** One archived feature's retirements on one service. */
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
  if (!api.unreadable) {
    for (const id of operationRetirements(api.ops).net) found.operations.push(retiredKey(service, id));
  }
  if (!existsSync(paths.asyncapi)) return found;
  const events = await readAsyncapi(paths.asyncapi, context);
  const text = events.unreadable ? undefined : await readOr(paths.asyncapi, context);
  if (text === undefined) return found;
  const eventSlots = asyncapiSlots(parse(text));
  const removed = eventSlots.filter((s) => s.remove && s.section !== "components.messages");
  for (const slot of removed) found.slots.push(retiredKey(service, slot.section, slot.key));
  // The pre-image is asked only when a channel went: that is the one
  // retirement whose names the delta does not spell.
  const before = removed.some((s) => s.section === "channels")
    ? await preImageEvents(feature.dir, service)
    : NOTHING_DECLARED;
  for (const name of messageRetirements(events, eventSlots, before).net) found.messages.push(retiredKey(service, name));
  return found;
}

const NOTHING_DECLARED: AsyncapiDoc = asyncapiFromText("");

async function preImageEvents(featureDir: string, service: string): Promise<AsyncapiDoc> {
  const text = await readSnapshotPreImage(featureDir, { service, artifact: ARTIFACT_FILES.asyncapi });
  if (text === null) return NOTHING_DECLARED;
  const doc = asyncapiFromText(text);
  return doc.unreadable ? NOTHING_DECLARED : doc;
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
