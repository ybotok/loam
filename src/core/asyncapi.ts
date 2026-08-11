import { isUtf8 } from "node:buffer";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import type { FleetContext } from "./fleet-context.js";
import { servicePaths } from "./repo/paths.js";

/**
 * The async contract axis: AsyncAPI 3.0, read the way `core/openapi.ts` reads
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
 * WHAT THIS READER MUST NEVER DO: look inside a message's `payload`. The payload
 * is JSON Schema today and may be Avro later, and that switch is meant to be a
 * line in the document (`schemaFormat`) rather than a branch in loam. Every
 * check on this axis joins on a message NAME; nothing joins on a field. The day
 * something here reads a `required` array or a `fields` list, the Avro migration
 * stops being free.
 */

/** How deep a `$ref` chain is followed before the reader gives up. */
const MAX_REF_DEPTH = 8;

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
}

/**
 * Resolve an internal JSON Pointer (`#/a/b/c`) against the document root.
 *
 * Internal only, matching the OpenAPI axis's documented stance: external
 * references — URLs, file paths, anything not starting `#/` — are out of scope,
 * left untouched and never graded. That is also why authors are told to keep
 * payloads inside the document rather than `$ref`-ing an external `.avsc`: the
 * merge cannot carry what this reader cannot see.
 */
function resolvePointer(root: unknown, ref: unknown): unknown {
  if (typeof ref !== "string" || !ref.startsWith("#/")) return undefined;
  let node = root;
  for (const raw of ref.slice(2).split("/")) {
    // JSON Pointer escaping, `~1` before `~0` so an encoded `~1` survives.
    const seg = raw.replace(/~1/g, "/").replace(/~0/g, "~");
    if (node === null || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[seg];
  }
  return node;
}

/**
 * Follow `$ref` hops until a node that is not a reference, or the depth budget
 * runs out. The budget is the cycle guard: a document whose `$ref` points at
 * itself is legal YAML, and an unbounded walk would hang the whole validate run
 * rather than reporting a contract nobody can read.
 *
 * Returns the resolved node and the last pointer segment that reached it — the
 * segment is the declaration key, which is the message-name fallback, and it is
 * lost by the time a caller holds only the node.
 */
function deref(root: unknown, node: unknown, key: string): { node: unknown; key: string } {
  let current = node;
  let currentKey = key;
  for (let hop = 0; hop < MAX_REF_DEPTH; hop += 1) {
    if (current === null || typeof current !== "object" || Array.isArray(current)) break;
    const ref = (current as Record<string, unknown>)["$ref"];
    if (typeof ref !== "string") break;
    const resolved = resolvePointer(root, ref);
    if (resolved === undefined) return { node: undefined, key: currentKey };
    const seg = ref.slice(ref.lastIndexOf("/") + 1);
    current = resolved;
    // An alias keeps the TARGET's key, not the local one it was filed under: a
    // channel may list `#/components/messages/PaymentAuthorized` under any alias
    // it likes, and the fallback name has to be the declaration's own identity
    // or two services aliasing one message differently would stop joining.
    currentKey = seg.length > 0 ? seg : currentKey;
  }
  return { node: current, key: currentKey };
}

/** A message's join token: its `name`, or the key it is declared under. */
function messageName(node: unknown, key: string): string {
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
  const declare = (name: string, slot: string): void => {
    messages.push({ name, slot });
    seen.set(name, [...(seen.get(name) ?? []), slot]);
  };

  // `components.messages` — the ordinary place a message is declared.
  for (const [key, node] of entriesOf((root["components"] as Record<string, unknown> | undefined)?.["messages"])) {
    declare(messageName(node, key), `components.messages.${key}`);
  }

  // `channels.<ck>.messages.<mk>` — an entry here is either an ALIAS of a
  // components declaration (a `$ref`) or an inline declaration of its own. Only
  // the second is a new slot: counting an alias would report every properly
  // factored document as declaring each message twice, which is the shape the
  // spec's own examples use.
  const channelMessages = new Map<string, string[]>();
  for (const [ck, channel] of entriesOf(root["channels"])) {
    const names: string[] = [];
    for (const [mk, entry] of entriesOf((channel as Record<string, unknown> | null)?.["messages"])) {
      const isAlias =
        entry !== null && typeof entry === "object" && !Array.isArray(entry) && "$ref" in (entry as object);
      const { node, key } = deref(root, entry, mk);
      const name = messageName(node, key);
      names.push(name);
      if (!isAlias) declare(name, `channels.${ck}.messages.${mk}`);
    }
    channelMessages.set(ck, names);
  }

  const sent = new Set<string>();
  const received = new Set<string>();
  for (const [, operation] of entriesOf(root["operations"])) {
    const op = operation as Record<string, unknown> | null;
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
  return { messages, sent: [...sent], received: [...received], duplicateNames, unreadable: false };
}

function empty(): AsyncapiDoc {
  return { messages: [], sent: [], received: [], duplicateNames: [], unreadable: false };
}

/** The slots one message name is declared in — what `asyncapi.duplicate-message` names. */
export function slotsOf(doc: AsyncapiDoc, name: string): string[] {
  return doc.messages.filter((m) => m.name === name).map((m) => m.slot);
}

/** Who produces what across the fleet, and whether that view is complete. */
export interface FleetProducers {
  /** Message name → the services declaring an `action: send` for it. */
  byMessage: Map<string, string[]>;
  /**
   * Services whose `asyncapi.yaml` exists and could not be read. Non-empty means
   * the ABSENCE of a producer proves nothing: one of these files may well
   * declare the message, and nobody can tell without fixing it first.
   */
  unreadable: string[];
}

/**
 * Which services in the fleet declare an `action: send` for each message name.
 *
 * The one question on this axis that no single repository can answer, and the
 * reason `validate --service` reads more than its own service here: a consumer
 * joins to a message the PRODUCER owns, so "does anybody publish this" is a
 * fleet fact. Zero producers is `spine.message-unproduced`; two are
 * `asyncapi.message-contested`, where every consumer's join picks one
 * arbitrarily.
 *
 * The two answers rest on different evidence, and only one of them survives an
 * unreadable contract. Finding two producers is POSITIVE evidence and stays
 * true whatever else in the fleet fails to parse. Finding none is an argument
 * from absence, and one broken file makes it worthless — skipping that service
 * silently would turn its outage into one `spine.message-unproduced` per
 * consuming edge across the whole fleet, every one of them pointing at the
 * wrong repository. So the unreadable services are reported rather than
 * skipped, and the caller suspends the negative answer while any exist.
 *
 * The cost is N small YAML parses, not N LikeC4 workspace spins — the latter is
 * what makes `validate --all` expensive (SCHEMA.md, "Operating at fleet scale"),
 * and a context memoizes these reads across the run.
 */
export async function producersByMessage(
  docsDir: string,
  services: readonly string[],
  context?: FleetContext,
): Promise<FleetProducers> {
  const byMessage = new Map<string, string[]>();
  const unreadable: string[] = [];
  for (const service of services) {
    const doc = await readAsyncapi(servicePaths(docsDir, service).asyncapi, context);
    if (doc.unreadable) {
      unreadable.push(service);
      continue;
    }
    for (const name of doc.sent) byMessage.set(name, [...(byMessage.get(name) ?? []), service]);
  }
  return { byMessage, unreadable };
}
