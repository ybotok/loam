/**
 * The keys loam adds to a feature's event contract that must never reach the
 * living one: `x-loam-based-on` and `x-loam-remove` — the same two spellings
 * the OpenAPI axis strips, gathered here for the same reason its markers
 * module exists: `stripAsyncapiMarkers` takes them out for the create branch
 * that publishes a feature document verbatim, and the merge takes them out
 * again on the way into a living document. Two spellings of "which keys are
 * feature-only" is how one of the two starts leaking a marker.
 *
 * The strip is DEEP on this axis by the format spec's own decision: an inline
 * channel message (`channels.<ck>.messages.<mk>`) is channel-slot interior,
 * so a pin or marker nested on it is part of the channel's VALUE — the slot
 * walker never visits it, and a slot-level strip would publish it into the
 * fleet's living contract exactly the way `--approve` once published
 * `x-loam-remove: true` inside a living OpenAPI component.
 */
import { isMap, isScalar, parseDocument, type Document, type Pair } from "yaml";
// Every `isRecord` below asks one question of a resolved plain tree: is this a
// node that can hold AsyncAPI keys — an object, not an array?
import { isRecord } from "../../kernel/records.js";
// One spelling of the deep strip for both axes: the feature-only keys are the
// SAME two strings on either, so a drift between the strips would be two
// definitions of one rule (the openapi digest module's own failure mode).
import { withoutFeatureKeysDeep } from "../../openapi/digest.js";
import { isSlotRemoval, type AsyncapiSection } from "../digest.js";
import { errorMessage, AsyncapiMergeError } from "./error.js";

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

/**
 * Find one slot's key/value pair, matching the existing key AS A STRING: a
 * channel named `404:` is the YAML number 404, and a plain `getIn`/`setIn`
 * with the string "404" misses it and APPENDS a second pair — the living
 * contract then declares the slot twice, forever, with the pre-merge copy
 * first in reading order. The openapi component write's lesson, applied to
 * every slot access here.
 */
function slotPair(doc: Document, section: AsyncapiSection, key: string): Pair | undefined {
  const node = doc.getIn(sectionAstPath(section));
  return isMap(node) ? node.items.find((it) => isScalar(it.key) && String(it.key.value) === key) : undefined;
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
  const node = doc.getIn(sectionAstPath(section));
  if (!isMap(node)) return false;
  const at = node.items.findIndex((it) => isScalar(it.key) && String(it.key.value) === key);
  if (at < 0) return false;
  node.items.splice(at, 1);
  return true;
}

/** One slot's human label: `channels.<key>` — with the message's join name where it has one. */
export function slotLabel(section: AsyncapiSection, key: string, name?: string): string {
  const at = `${section}.${key}`;
  return name !== undefined && name !== key ? `'${name}' (${at})` : at;
}

/**
 * Remove feature-only markers — removal-marker slots, the pins on the slots
 * that survive, and both loam keys at every nested depth — before a feature
 * contract is used to create a brand-new living document. Normally coherence
 * refuses the removal shape because there cannot be a removal target; this
 * guard also keeps `--approve` from ever persisting a marker into living docs.
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
  let plain: unknown;
  try {
    // Resolve aliases once with the document's own anchor context — an
    // individual node's toJSON() loses it (the openapi merge's lesson).
    plain = feature.toJS() ?? {};
  } catch (error) {
    throw new AsyncapiMergeError("feature", service, errorMessage(error));
  }

  let stripped = false;
  const sections: AsyncapiSection[] = ["channels", "operations", "components.messages"];
  for (const section of sections) {
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

  if (!stripped) return featureText;
  try {
    return feature.toString();
  } catch (error) {
    throw new AsyncapiMergeError("feature", service, errorMessage(error));
  }
}
