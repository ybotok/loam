/**
 * The read model of one AsyncAPI document — what `./read.ts`'s walk produces
 * and every consumer of the axis branches on. Split from `read.ts` when the
 * `asyncapiFromText` extraction pushed that module past the 300-line ceiling:
 * the walk and its result are two subjects (`read.ts` says HOW a document is
 * read, this file says WHAT a read answers), and the type block is the seam
 * that already existed. The doctrine comments travel with the fields they
 * explain — they are the documentation of the model, not of the walk.
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
