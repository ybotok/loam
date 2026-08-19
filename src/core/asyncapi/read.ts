import { isUtf8 } from "node:buffer";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { danglingRefs, deref, payloadUndeclared } from "./depth.js";
import { isSlotRemoval, removalMarkerPaths } from "./digest.js";
import type { FleetContext } from "../fleet-context.js";

/**
 * The async contract axis: AsyncAPI 3.0, read the way `core/openapi/doc.ts` reads
 * OpenAPI — a shallow structural walk over the `yaml` parse, never a real
 * AsyncAPI parser. `@asyncapi/parser` would be a fourth runtime dependency
 * (AGENTS.md: adding one is a product decision), and loam needs a slice of the
 * document so thin that the parser's whole model would be dead weight.
 *
 * 3.0 only, deliberately. Its operations are named top-level objects carrying
 * `action: send|receive`, which is the exact analog of an `operationId`; 2.x
 * spells the same thing as `publish`/`subscribe` nested under a channel, where
 * the two words are notoriously ambiguous about whose perspective they take.
 * Supporting one dialect is cheaper than supporting two, and a 2.x document
 * declares no `operations` at all — so it reads as a contract with no messages
 * rather than as a silently mis-parsed one.
 *
 * WHAT THIS READER MUST NEVER DO: join on anything inside a message's `payload`.
 * The payload is JSON Schema today and may be Avro later, and that switch is
 * meant to be a line in the document (`schemaFormat`) rather than a branch in
 * loam. Every check on this axis joins on a message NAME; nothing joins on a
 * field, and nothing under `payload` may ever contribute one. The day
 * something here reads a `required` array or a `fields` list INTO A JOIN, the
 * Avro migration stops being free. The one look the reader takes inside is
 * `payloadUndeclared` (depth.ts) — a presence probe that checks whether any
 * shape was declared at all, reads key existence and never a value, and skips
 * any payload declaring a non-JSON `schemaFormat`, so the stance holds. The
 * slot digests (./digest.ts) are COMPATIBLE with it, not an exception: they
 * hash payload bytes as content equality — a changed payload moves the slot's
 * identity — and content equality is not a join; nothing a digest reads ever
 * contributes a name to the spine.
 */

/** One message declaration, as the reader sees it. */
export interface EventMessage {
  /**
   * The join token — what a landscape edge's `metadata { publishes }` and a
   * requirement's `Publishes:` line name.
   *
   * The Message Object's own `name` when it has one, otherwise the key it is
   * declared under. Both are legal AsyncAPI, and the key is what an author who
   * never wrote a `name` would reasonably expect to reference; falling back to
   * it means a minimal hand-written contract still joins to the spine.
   */
  name: string;
  /**
   * Where it was declared — `components.messages.<key>` or
   * `channels.<key>.messages.<key>`. Carried so `asyncapi.duplicate-message` can
   * name both slots instead of only saying that a name repeats, the way
   * `openapi.duplicate-operationid` names both `METHOD /path` slots.
   */
  slot: string;
  /**
   * Present when the declaration's payload defines no shape a consumer could
   * code against (`payloadUndeclared`, depth.ts). Set only when true, and
   * never set for a payload declaring a non-JSON `schemaFormat`.
   */
  payloadEmpty?: true;
  /**
   * Present when the declaration carries `x-loam-remove: true` — a FEATURE
   * delta retiring it. A marker asserts a slot rather than declaring a
   * message, so it joins nothing: excluded from sent/received and from
   * duplicate counting, the discipline `core/openapi/doc.ts` set for
   * operation markers. Set only when true, like `payloadEmpty`.
   */
  remove?: true;
}

/** The parse of one AsyncAPI document: what it declares, and whether it could be read at all. */
export interface AsyncapiDoc {
  /** Every message declaration in the document, in document order. */
  messages: EventMessage[];
  /** Message names reachable from an `action: send` operation — what this service PRODUCES. */
  sent: string[];
  /** Message names reachable from an `action: receive` operation — what this service CONSUMES. */
  received: string[];
  /**
   * Names declared in more than one slot. Every join on this axis is by name, so
   * two slots claiming one name is the same ambiguity `openapi.duplicate-operationid`
   * grades: the join picks one arbitrarily and the other declaration is invisible.
   */
  duplicateNames: string[];
  /**
   * True when the file EXISTS but cannot be read as an AsyncAPI document —
   * broken YAML, non-UTF-8 bytes, or a document that is not a mapping. A missing
   * file is not unreadable (absence is `service.no-asyncapi`'s question), and an
   * empty one parses to null and honestly declares nothing.
   */
  unreadable: boolean;
  /** The parser's own message, when there is one to quote back. */
  error?: string;
  /** Internal `#/` refs that resolve to nothing in this document (depth.ts). */
  danglingRefs: string[];
  /**
   * Where `x-loam-remove: true` appears — at ANY depth (digest.ts's
   * `removalMarkerPaths`): the three slot depths the format spec gives the
   * key meaning at, inline channel messages (channel-slot interior the merge
   * strips at that nested depth), and every place the key means nothing —
   * the document root, `info`, a `components` sibling. Feature-only
   * bookkeeping wherever it sits: `validate` grades any of these in a LIVING
   * contract as `asyncapi.remove-marker-living`, and the sweep is as deep as
   * the strip so a leaked marker can never be invisible to it.
   */
  markers: string[];
}

/**
 * A message's join token: its `name`, or the key it is declared under.
 * Exported for the merge (./merge/merge.ts), whose removal exactness compares
 * this same spelling — a second definition of the fallback rule is how a
 * marker would delete a message the reader joins under a different name.
 */
export function messageName(node: unknown, key: string): string {
  if (node !== null && typeof node === "object" && !Array.isArray(node)) {
    const name = (node as Record<string, unknown>)["name"];
    if (typeof name === "string" && name.trim().length > 0) return name.trim();
  }
  return key;
}

/** Entries of a mapping node, or nothing — every structural read here goes through it. */
function entriesOf(node: unknown): [string, unknown][] {
  if (node === null || typeof node !== "object" || Array.isArray(node)) return [];
  return Object.entries(node as Record<string, unknown>);
}

/**
 * Read an AsyncAPI 3.0 document into the slice loam joins on: the messages it
 * declares, and which of them it sends and receives.
 *
 * The send/receive sets are what make the spine directional, and the direction
 * is not decoration: on the HTTP axis the PROVIDER owns the contract and a
 * consumer's edge is checked against it, while here the PRODUCER owns the
 * message and a consumer joins to it from another repository entirely. That
 * inversion is why `spine.message-unproduced` has no OpenAPI analog.
 *
 * An unreadable document yields empty sets PLUS the `unreadable` flag, the
 * policy every reader here follows: parsers never diagnose. Swallowing the
 * failure into empty sets would make a broken contract indistinguishable from
 * one that declares nothing, and every inbound edge would be graded
 * `spine.message-undefined` — a false diagnosis pointing at the landscape when
 * the truth is this file.
 */
export async function readAsyncapi(asyncapiPath: string, context?: FleetContext): Promise<AsyncapiDoc> {
  if (context !== undefined) return context.readAsyncapi(asyncapiPath);
  if (!existsSync(asyncapiPath)) return empty();
  const bytes = await readFile(asyncapiPath);
  // Bytes that are not UTF-8 are as unreadable as broken YAML and for a worse
  // reason: `toString("utf8")` substitutes U+FFFD and hands the parser a
  // document nobody wrote. The openapi axis learned this the same way.
  if (!isUtf8(bytes)) return { ...empty(), unreadable: true, error: "file is not valid UTF-8" };
  let doc: unknown;
  try {
    doc = parse(bytes.toString("utf8"));
  } catch (e) {
    return { ...empty(), unreadable: true, error: e instanceof Error ? e.message : String(e) };
  }
  return asyncapiDocOf(doc);
}

/**
 * The same read over an already-parsed root — what the coherence gate's
 * merge simulation grades (core/coherence/events/), where the "file" is a
 * document the merge computed and never wrote. One spelling of the walk for
 * both entries, so a simulated contract can never read differently from the
 * living file the archive would produce from it.
 */
export function asyncapiDocOf(doc: unknown): AsyncapiDoc {
  // A scalar or sequence document has no mapping to look `channels` up in, so
  // nothing can be concluded from it. null (an empty file) stays readable — it
  // declares nothing, and says so honestly.
  if (doc !== null && (typeof doc !== "object" || Array.isArray(doc))) {
    return { ...empty(), unreadable: true, error: "document is not a YAML mapping" };
  }
  if (doc === null) return empty();

  const root = doc as Record<string, unknown>;
  const messages: EventMessage[] = [];
  const seen = new Map<string, string[]>();
  const declare = (name: string, slot: string, node: unknown): void => {
    // A declaration carrying the removal marker asserts a slot rather than
    // declaring a message: it is listed (with `remove`) so the gate can see
    // it, but it joins nothing — not sent/received, not the duplicate count.
    if (isSlotRemoval(node)) {
      messages.push({ name, slot, remove: true as const });
      return;
    }
    messages.push({ name, slot, ...(payloadUndeclared(root, node) ? { payloadEmpty: true as const } : {}) });
    seen.set(name, [...(seen.get(name) ?? []), slot]);
  };

  // `components.messages` — the ordinary place a message is declared.
  for (const [key, node] of entriesOf((root["components"] as Record<string, unknown> | undefined)?.["messages"])) {
    declare(messageName(node, key), `components.messages.${key}`, node);
  }

  // `channels.<ck>.messages.<mk>` — an entry here is either an ALIAS of a
  // components declaration (a `$ref`) or an inline declaration of its own. Only
  // the second is a new slot: counting an alias would report every properly
  // factored document as declaring each message twice, which is the shape the
  // spec's own examples use.
  const channelMessages = new Map<string, string[]>();
  for (const [ck, channel] of entriesOf(root["channels"])) {
    // A channel-slot removal retires the whole channel, inline interior
    // included: nothing under it declares or joins anything any more.
    if (isSlotRemoval(channel)) {
      channelMessages.set(ck, []);
      continue;
    }
    const names: string[] = [];
    for (const [mk, entry] of entriesOf((channel as Record<string, unknown> | null)?.["messages"])) {
      const isAlias =
        entry !== null && typeof entry === "object" && !Array.isArray(entry) && "$ref" in (entry as object);
      const { node, key } = deref(root, entry, mk);
      const name = messageName(node, key);
      // A name whose declaration is being retired stays off the channel's
      // list, whether the marker sits on the aliased components entry or on
      // the inline declaration itself — the operation fallback below must
      // not join through a message the feature is removing.
      if (!isSlotRemoval(node)) names.push(name);
      if (!isAlias) declare(name, `channels.${ck}.messages.${mk}`, node);
    }
    channelMessages.set(ck, names);
  }

  const sent = new Set<string>();
  const received = new Set<string>();
  for (const [, operation] of entriesOf(root["operations"])) {
    const op = operation as Record<string, unknown> | null;
    // An operation-slot removal retires the operation: it contributes no
    // send/receive whatever its `action` says.
    if (isSlotRemoval(op)) continue;
    const action = op?.["action"];
    if (action !== "send" && action !== "receive") continue;
    const into = action === "send" ? sent : received;
    // The channel this operation acts on, by pointer — its key is what the
    // fallback below indexes.
    const channelRef = (op?.["channel"] as Record<string, unknown> | undefined)?.["$ref"];
    const channelKey = typeof channelRef === "string" ? channelRef.slice(channelRef.lastIndexOf("/") + 1) : undefined;
    const listed = op?.["messages"];
    if (Array.isArray(listed) && listed.length > 0) {
      for (const entry of listed) {
        const { node, key } = deref(root, entry, "");
        // A pointer that resolves nowhere contributes no name rather than an
        // empty one: a phantom "" would join to nothing and read as a message
        // the service produces.
        if (node === undefined && key === "") continue;
        // A pointer into a declaration being retired joins nothing either —
        // the marker means the message is leaving the contract.
        if (isSlotRemoval(node)) continue;
        const name = messageName(node, key);
        if (name.length > 0) into.add(name);
      }
      continue;
    }
    // AsyncAPI 3: an operation that lists no messages applies to every message
    // of its channel. Omitting the list is the normal shape of a minimal
    // hand-written contract — exactly what a fleet with no registry writes — so
    // reading it as "produces nothing" would report the common case broken.
    if (channelKey !== undefined) for (const name of channelMessages.get(channelKey) ?? []) into.add(name);
  }

  const duplicateNames = [...seen].filter(([, slots]) => slots.length > 1).map(([name]) => name);
  return {
    messages,
    sent: [...sent],
    received: [...received],
    duplicateNames,
    unreadable: false,
    danglingRefs: danglingRefs(root),
    // One deep scan rather than pushes scattered through the walk above: the
    // walk only visits the depths that JOIN, and a marker leaked anywhere
    // else (the root, `info`) was invisible to the living sweep while the
    // strip still owed its removal.
    markers: removalMarkerPaths(root, ""),
  };
}

function empty(): AsyncapiDoc {
  return { messages: [], sent: [], received: [], duplicateNames: [], unreadable: false, danglingRefs: [], markers: [] };
}

/** The slots one message name is declared in — what `asyncapi.duplicate-message` names. */
export function slotsOf(doc: AsyncapiDoc, name: string): string[] {
  return doc.messages.filter((m) => m.name === name).map((m) => m.slot);
}

