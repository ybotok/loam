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
import { memo } from "../../kernel/concurrency.js";
import type { DocsDir } from "../../kernel/ids/dirs.js";
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

/** Everything the archived features retired, each entry naming the features that did it (sorted, distinct). */
export interface RetiredIndex {
  /** `retiredKey(service, operationId)` → the archived features whose openapi delta retired it. */
  operations: ReadonlyMap<string, readonly string[]>;
  /** `retiredKey(service, section, key)` for a `channels` or `operations` slot. */
  slots: ReadonlyMap<string, readonly string[]>;
  /** `retiredKey(service, messageName)` — by the join token, wherever the message was declared. */
  messages: ReadonlyMap<string, readonly string[]>;
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
 * to ask about, so a feature whose every entry the living contract already
 * holds — the common case — never walks `features/archive/` at all. Without a
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

/** Walk every archived feature's contract deltas and record what each one retired. */
export async function readRetiredIndex(docsDir: DocsDir, context?: FleetContext): Promise<RetiredIndex> {
  const operations = new Map<string, string[]>();
  const slots = new Map<string, string[]>();
  const messages = new Map<string, string[]>();
  // A `features/archive` that is not a directory holds no archived feature,
  // and listing it would throw ENOTDIR out of the feature gate — refusing an
  // archive over a question about OTHER features' history, before the plan
  // that names the real problem (the final move into that path) is reached.
  if (!isDirectory(archiveDir(docsDir))) return { operations, slots, messages };
  for (const feature of await listFeatures(docsDir, { includeArchived: true }, context)) {
    if (!feature.archived) continue;
    for (const service of feature.services) {
      const paths = featureSpecPaths(feature.dir, service);
      // An absent delta reads as an empty document; an unreadable one retired
      // nothing loam could have merged (archive refuses `merge-failed`).
      const api = await readOpenapi(paths.openapi, context);
      if (!api.unreadable) {
        for (const id of operationRetirements(api.ops).net) record(operations, retiredKey(service, id), feature.id);
      }
      if (!existsSync(paths.asyncapi)) continue;
      const events = await readAsyncapi(paths.asyncapi, context);
      const text = events.unreadable ? undefined : await readOr(paths.asyncapi, context);
      if (text === undefined) continue;
      const eventSlots = asyncapiSlots(parse(text));
      const removed = eventSlots.filter((s) => s.remove && s.section !== "components.messages");
      for (const slot of removed) record(slots, retiredKey(service, slot.section, slot.key), feature.id);
      // The pre-image is asked only when a channel went: that is the one
      // retirement whose names the delta does not spell.
      const before = removed.some((s) => s.section === "channels")
        ? await preImageEvents(feature.dir, service)
        : NOTHING_DECLARED;
      for (const name of messageRetirements(events, eventSlots, before).net) {
        record(messages, retiredKey(service, name), feature.id);
      }
    }
  }
  return { operations, slots, messages };
}

/** The archived features that retired this entry, minus the feature asking — empty when none did. */
export function retiredBy(found: readonly string[] | undefined, asking: string): string[] {
  return (found ?? []).filter((id) => id !== asking);
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
 * Add one retirer. Already in id order without a sort: `listFeatures` returns
 * the features sorted by `compareIds`, and the walk visits them in that order.
 */
function record(into: Map<string, string[]>, key: string, featureId: string): void {
  const by = into.get(key) ?? [];
  if (!by.includes(featureId)) by.push(featureId);
  into.set(key, by);
}
