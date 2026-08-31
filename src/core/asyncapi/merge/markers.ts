/**
 * The keys loam adds to a feature's event contract that must never reach the
 * living one: `x-loam-based-on`, `x-loam-remove`, and the root
 * `x-loam-baselines` record — the same three spellings the OpenAPI axis
 * strips, gathered here for the same reason its markers
 * module exists: `stripAsyncapiMarkers` takes them out for the create branch
 * that publishes a feature document verbatim, and the merge takes them out
 * again on the way into a living document. Two spellings of "which keys are
 * feature-only" is how one of the two starts leaking a marker.
 *
 * The strip is DEEP, and it covers the WHOLE document. Deep by the format
 * spec's own decision: an inline channel message (`channels.<ck>.messages.<mk>`)
 * is channel-slot interior, so a pin or marker nested on it is part of the
 * channel's VALUE — the slot walker never visits it, and a slot-level strip
 * would publish it into the fleet's living contract exactly the way
 * `--approve` once published `x-loam-remove: true` inside a living OpenAPI
 * component. Whole-document because the create branch publishes this text
 * VERBATIM: a marker at the document root or a pin under `info` sits outside
 * every section, and a strip that walked only the three sections shipped
 * both into a living contract, unseen even by validate's marker sweep.
 */
import { isMap, isScalar, parseDocument, type Document, type Pair } from "yaml";
// Every `isRecord` below asks one question of a resolved plain tree: is this a
// node that can hold AsyncAPI keys — an object, not an array?
import { isRecord } from "../../kernel/records.js";
// One spelling of the deep strip for both axes: the feature-only keys are the
// SAME two strings on either (core/asyncapi/digest.ts aliases the constants
// outright), so a drift between the strips would be two definitions of one
// rule (the openapi digest module's own failure mode).
import { FEATURE_ONLY_KEYS, withoutFeatureKeysDeep } from "../../openapi/digest.js";
import { ASYNCAPI_BASELINES_KEY, isSlotRemoval, type AsyncapiSection } from "../digest.js";
import { errorMessage, AsyncapiMergeError, type AsyncapiMergeSource } from "./error.js";

/** The three slot sections, in document order — every whole-document walk here goes over them. */
const SECTIONS: AsyncapiSection[] = ["channels", "operations", "components.messages"];

/**
 * A slot's PUBLISHABLE value: every feature-only key removed, at any depth —
 * the top-level pin, a nested pin or marker on an inline channel message, and
 * anything an author buried deeper. What the merge writes and what the create
 * branch keeps; a removal-marker slot is never published at all (the merge
 * deletes its target, the strip drops it), so this is only ever asked of a
 * slot that survives.
 */
export function withoutFeatureMarkers(node: unknown): unknown {
  return withoutFeatureKeysDeep(node);
}

/**
 * The AST path of a section's own mapping — `slotPath` (../digest.ts) minus
 * the slot key, spelled beside the writers so the strip and the merge cannot
 * disagree about which node a section name addresses.
 */
export function sectionAstPath(section: AsyncapiSection): string[] {
  return section === "components.messages" ? ["components", "messages"] : [section];
}

/** One mapping node's pair for a key, matched AS A STRING — `slotPair`'s find, reusable at any depth. */
function pairAt(node: unknown, key: string): Pair | undefined {
  return isMap(node) ? node.items.find((it) => isScalar(it.key) && String(it.key.value) === key) : undefined;
}

/** Delete one pair from a mapping node, string-key-matched. Returns whether a pair actually went. */
function deleteKeyIn(node: unknown, key: string): boolean {
  if (!isMap(node)) return false;
  const at = node.items.findIndex((it) => isScalar(it.key) && String(it.key.value) === key);
  if (at < 0) return false;
  node.items.splice(at, 1);
  return true;
}

/**
 * Find one slot's key/value pair, matching the existing key AS A STRING: a
 * channel named `404:` is the YAML number 404, and a plain `getIn`/`setIn`
 * with the string "404" misses it and APPENDS a second pair — the living
 * contract then declares the slot twice, forever, with the pre-merge copy
 * first in reading order. The openapi component write's lesson, applied to
 * every slot access on this axis: the merge's writers below go through it,
 * and so does the pin (./pin.ts), whose raw `getIn` used to grade every
 * non-string-keyed slot `unwritable` with an alias diagnosis nothing in the
 * document backed.
 */
export function slotPair(doc: Document, section: AsyncapiSection, key: string): Pair | undefined {
  return pairAt(doc.getIn(sectionAstPath(section)), key);
}

/** Write one slot's value, string-key-matched — the merge's one upsert door. */
export function setSlotValue(doc: Document, section: AsyncapiSection, key: string, value: unknown): void {
  const existing = slotPair(doc, section, key);
  if (existing !== undefined) existing.value = doc.createNode(value);
  else doc.setIn([...sectionAstPath(section), key], value);
}

/**
 * Delete one slot's pair, string-key-matched for the numeric-key reason above
 * (`deleteIn` with "404" reports nothing deleted and the slot survives in
 * silence). Returns whether a pair actually went.
 */
export function deleteSlot(doc: Document, section: AsyncapiSection, key: string): boolean {
  return deleteKeyIn(doc.getIn(sectionAstPath(section)), key);
}

/**
 * Refuse a living container the merge cannot write into: a container spelled
 * as something other than a mapping is a document loam cannot merge, and one
 * spelled as a YAML alias would take the write into every node that shares
 * the anchor. Asked at the WRITE, because reading is safe and writing is not
 * — an absent container is fine, the writers above create it.
 *
 * Takes a raw path rather than an `AsyncapiSection`, because the merge writes
 * outside the three slot sections too: a component surface lands at
 * `["components", <kind>]`, and a section-typed guard simply could not be
 * asked about it. Skipping the question there would let a living
 * `components: *alias` take a surface write into every node sharing the
 * anchor — the exact corruption this function exists to refuse, at the one
 * depth it could not see. Lives beside the writers rather than in the merge
 * so the guard and the write cannot disagree about which node a path names.
 */
export function writableSection(
  living: Document,
  livingPlain: unknown,
  path: string[],
  service: string,
): void {
  for (let depth = 1; depth <= path.length; depth += 1) {
    const prefix = path.slice(0, depth);
    const plain = prefix.reduce<unknown>((node, step) => (isRecord(node) ? node[step] : undefined), livingPlain);
    if (plain === undefined || plain === null) return;
    const label = prefix.join(".");
    if (!isRecord(plain)) {
      throw new AsyncapiMergeError("living", service, `'${label}' is not a mapping`);
    }
    if (!isMap(living.getIn(prefix))) {
      throw new AsyncapiMergeError(
        "living",
        service,
        `'${label}' is written as a YAML alias — one shared value backs every use, so merging into it would rewrite every other node that aliases it. Expand it before archiving.`,
      );
    }
  }
}

/** One slot's human label: `channels.<key>` — with the message's join name where it has one. */
export function slotLabel(section: AsyncapiSection, key: string, name?: string): string {
  const at = `${section}.${key}`;
  return name !== undefined && name !== key ? `'${name}' (${at})` : at;
}

/**
 * Refuse a document whose section spells one slot key twice — `channels:
 * {404: …, "404": …}` is legal YAML (a number and a string are distinct
 * keys), but the resolved walk (`asyncapiSlots` reads `Object.entries` of
 * `toJS()`) keeps the LAST pair while every string-matched AST access above
 * finds the FIRST: the walker would grade one pair and the writer replace
 * the other, and no single read discipline can make the two agree about
 * which node the (section, key) names. Every entry point that walks slots —
 * the pin, the strip, the merge — refuses it by name instead of writing
 * through the wrong pair.
 */
export function refuseAmbiguousSlotKeys(doc: Document, source: AsyncapiMergeSource, service: string): void {
  for (const section of SECTIONS) {
    const node = doc.getIn(sectionAstPath(section));
    if (!isMap(node)) continue;
    const seen = new Set<string>();
    for (const it of node.items) {
      if (!isScalar(it.key)) continue;
      const key = String(it.key.value);
      if (seen.has(key)) {
        throw new AsyncapiMergeError(
          source,
          service,
          `'${section}' spells the key '${key}' in two pairs (two YAML scalars that stringify identically, e.g. 404 and "404") — loam cannot tell which pair a slot access should read or write; merge them into one entry`,
          "is ambiguous",
        );
      }
      seen.add(key);
    }
  }
}

/**
 * Remove feature-only markers — removal-marker slots, the pins on the slots
 * that survive, and both loam keys at every nested depth of the whole
 * document — before a feature contract is used to create a brand-new living
 * document. Normally coherence refuses the removal shape because there cannot
 * be a removal target; this guard also keeps `--approve` from ever persisting
 * a marker into living docs.
 *
 * Edit the AST in place when every node the strip touches IS a node — the
 * author's comments, key order and formatting are theirs to keep. An alias
 * cannot be edited in place (there is one shared value behind it, and editing
 * a slot through it would change every use), and a slot whose KEY is not a
 * scalar is not findable by name at all — so a section holding either gets
 * rewritten from the resolved tree instead: losing formatting is a cost,
 * shipping the marker is a corruption. The openapi strip's two-branch
 * discipline, per section.
 */
export function stripAsyncapiMarkers(featureText: string, service: string): string {
  const feature = parseDocument(featureText);
  if (feature.errors.length > 0) {
    throw new AsyncapiMergeError("feature", service, feature.errors[0]!.message);
  }
  refuseAmbiguousSlotKeys(feature, "feature", service);
  let plain: unknown;
  try {
    // Resolve aliases once with the document's own anchor context — an
    // individual node's toJSON() loses it (the openapi merge's lesson).
    plain = feature.toJS() ?? {};
  } catch (error) {
    throw new AsyncapiMergeError("feature", service, errorMessage(error));
  }

  let stripped = false;
  for (const section of SECTIONS) {
    // Shape from the RESOLVED tree, for the same reason the merge reads it
    // there: an aliased section is not a map node, and treating it as
    // "nothing to strip" is how a feature-only marker reached a living
    // contract on the OpenAPI axis.
    const sectionPlain = sectionAstPath(section).reduce<unknown>(
      (node, step) => (isRecord(node) ? node[step] : undefined),
      plain,
    );
    if (!isRecord(sectionPlain)) continue;

    const cleaned: Record<string, unknown> = {};
    // `kept: undefined` means the slot goes — a resolved YAML value is never
    // undefined itself (`~` reads as null), so the sentinel is unambiguous.
    const edits: Array<{ key: string; kept: unknown }> = [];
    for (const [key, value] of Object.entries(sectionPlain)) {
      // A removal marker asserts a slot rather than declaring content; the
      // create branch has no target to delete, so the slot itself goes.
      const kept = isSlotRemoval(value) ? undefined : withoutFeatureKeysDeep(value);
      if (kept !== value) edits.push({ key, kept });
      if (kept !== undefined) cleaned[key] = kept;
    }
    if (edits.length === 0) continue;
    stripped = true;

    // In place only when every touched node is reachable: the section is a
    // real map and each edited slot's pair is findable by string key.
    const editable =
      isMap(feature.getIn(sectionAstPath(section))) &&
      edits.every(({ key }) => slotPair(feature, section, key) !== undefined);
    if (!editable) {
      feature.setIn(sectionAstPath(section), cleaned);
      continue;
    }
    for (const { key, kept } of edits) {
      if (kept === undefined) deleteSlot(feature, section, key);
      // The surviving slot's value is replaced wholesale with the deep-strip:
      // a pin at slot depth could be deleted key-by-key, but a marker nested
      // on an inline channel message sits where no fixed path reaches — the
      // resolved copy is the one branch both depths share.
      else setSlotValue(feature, section, key, kept);
    }
  }

  if (isRecord(plain)) stripped = stripBeyondSections(feature, plain) || stripped;

  // The root `x-loam-baselines` record, on EVERY branch — including the
  // verbatim early return below. `stripBeyondSections` cannot do it: it
  // filters on FEATURE_ONLY_KEYS, which holds the two IN-VALUE keys and not
  // this one, so the record's own subtree (16-hex digests) carries no loam key
  // for the deep strip to find and the whole entry rides out untouched. That
  // is the create branch publishing loam's bookkeeping into a living
  // asyncapi.yaml, where nothing catches it: `removalMarkerPaths` — validate's
  // marker sweep on this axis — only ever looks for `x-loam-remove`.
  if (isRecord(plain) && ASYNCAPI_BASELINES_KEY in plain) {
    feature.deleteIn([ASYNCAPI_BASELINES_KEY]);
    stripped = true;
  }

  if (!stripped) return featureText;
  try {
    return feature.toString();
  } catch (error) {
    throw new AsyncapiMergeError("feature", service, errorMessage(error));
  }
}

/**
 * The strip's reach OUTSIDE the three sections: the document root's own
 * keys, `info`, `servers`, and the `components` siblings of `messages` —
 * everything the section loop above deliberately does not touch. A loam key
 * here is feature-only exactly as it is inside a slot, and the create branch
 * used to publish it (an `x-loam-remove: true` at the root reached a living
 * contract with zero diagnosis). A loam key at this depth is deleted; any
 * other entry whose subtree carries one is replaced with its deep-strip,
 * through the same string-matched pair access the slot writers use.
 */
function stripBeyondSections(feature: Document, plain: Record<string, unknown>): boolean {
  let stripped = false;
  const strip = (path: string[], key: string, value: unknown): void => {
    const parent = path.length === 0 ? feature.contents : feature.getIn(path);
    if (FEATURE_ONLY_KEYS.has(key)) {
      stripped = deleteKeyIn(parent, key) || stripped;
      return;
    }
    const kept = withoutFeatureKeysDeep(value);
    if (kept === value) return;
    stripped = true;
    const pair = pairAt(parent, key);
    // The section loop's fallback, one entry wide: a pair no string can find
    // is rewritten from the resolved tree rather than left carrying markers.
    if (pair !== undefined) pair.value = feature.createNode(kept);
    else feature.setIn([...path, key], kept);
  };
  for (const [key, value] of Object.entries(plain)) {
    if (key === "channels" || key === "operations") continue;
    if (key === "components") {
      // `components.messages` is the section loop's; the siblings are ours.
      if (!isRecord(value)) continue;
      for (const [ck, cv] of Object.entries(value)) {
        if (ck !== "messages") strip(["components"], ck, cv);
      }
      continue;
    }
    strip([], key, value);
  }
  return stripped;
}
