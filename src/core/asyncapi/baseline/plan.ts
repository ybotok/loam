/**
 * What `loam rebase` writes on the event axis's SURFACE half: the
 * `x-loam-baselines` record, rebuilt wholesale from what is on disk right now
 * — `core/openapi/baseline/plan.ts`'s mirror, over component surfaces instead
 * of path items and components.
 *
 * A ROOT record rather than an in-value pin, and that is not symmetry for its
 * own sake: a slot value is always a mapping, so `x-loam-based-on` has
 * somewhere to live inside it, but a `components/schemas/<name>` value is a
 * JSON Schema — where an in-value loam key would be a schema keyword, and
 * where JSON Schema's own `true` is a legal component that no in-value key
 * survives at all.
 *
 * Rebuilt rather than patched for the reason the OpenAPI plan states: a pin is
 * a claim about what its author read, and an entry left behind for a surface
 * the delta no longer declares — or one whose living counterpart is gone — is
 * a claim nobody is making any more. The sorted serialization (`buildRecord`)
 * is what makes a second run byte-identical.
 *
 * This module must not import from `../merge/`: the merge reads this package,
 * so a value edge back would be a package cycle. That is also why an
 * unreadable document is answered with "nothing to pin" rather than an
 * `AsyncapiMergeError` — every caller chains this AFTER `pinAsyncapiSlots`,
 * which has already thrown that error for a document either side cannot parse.
 */
import { isDeepStrictEqual } from "node:util";
import { parseDocument } from "yaml";
import { isRecord } from "../../kernel/records.js";
import { buildRecord, entryFor, readBaselineRecord, surfaceIn } from "../../openapi/baseline/record.js";
import { valueDigest } from "../../openapi/digest.js";
import { ASYNCAPI_BASELINES_KEY } from "../digest.js";
import { asyncapiSurfaces } from "./surfaces.js";

/** What happened to one declared surface's baseline entry. */
export interface AsyncapiSurfacePin {
  /** `<kind>/<name>` — the component surface the entry pins. */
  target: string;
  status:
    /** It had no entry and now has one. */
    | "pinned"
    /** It named an older living version; it now names the current one. */
    | "repinned"
    /** It already named the current living version — no write. */
    | "unchanged"
    /** The living contract has no such surface: this feature is adding it, and it gets NO entry. */
    | "unresolved";
  from: string | null;
  to: string | null;
}

export interface AsyncapiBaselinePlan {
  /** The rewritten contract, or null when the record already says what this run would write. */
  text: string | null;
  pins: AsyncapiSurfacePin[];
}

/**
 * Pin every component surface of a feature event contract against the living
 * one. The entry is always `valueDigest` of the LIVING value, never of the
 * delta's own — the one rule that yields both merge verdicts: a surface the
 * author only QUOTED equals its own entry, one they EDITED differs from it.
 *
 * A surface with no living counterpart is `unresolved` and deliberately absent
 * from the record. Stamping a pin against nothing is not a harmless extra key:
 * `classifyBaselineDigests` calls a pin with no living side `unfounded`, and
 * the gate then refuses the delta as `asyncapi.baseline-invalid` — rebase
 * would be writing the file the gate sends its author back to rebase.
 */
export function planAsyncapiBaselines(
  featureText: string,
  livingText: string,
  _service: string,
): AsyncapiBaselinePlan {
  const doc = parseDocument(featureText);
  if (doc.errors.length > 0) return { text: null, pins: [] };
  let featPlain: unknown;
  let livingPlain: unknown;
  try {
    featPlain = doc.toJS() ?? {};
    const living = parseDocument(livingText);
    if (living.errors.length > 0) return { text: null, pins: [] };
    livingPlain = living.toJS() ?? {};
  } catch {
    return { text: null, pins: [] };
  }

  const current = readBaselineRecord(featPlain).record;
  const components = new Map<string, string>();
  const pins: AsyncapiSurfacePin[] = [];
  for (const surface of asyncapiSurfaces(featPlain)) {
    // A malformed current entry reads back as absent (readBaselineRecord drops
    // it into `problems`), so this run reports `pinned` and overwrites it —
    // rebase is the command `asyncapi.baseline-invalid` sends people to, and
    // it must repair what it names.
    const from = entryFor(current, surface);
    const livingValue = surfaceIn(livingPlain, surface);
    if (!livingValue.found) {
      pins.push({ target: surface.id, status: "unresolved", from: from ?? null, to: null });
      continue;
    }
    const digest = valueDigest(livingValue.value);
    components.set(surface.id, digest);
    pins.push({
      target: surface.id,
      status: from === digest ? "unchanged" : from === undefined ? "pinned" : "repinned",
      from: from ?? null,
      to: digest,
    });
  }

  // The whole key goes when no section survives — a bare `x-loam-baselines:
  // {}` would be bookkeeping about nothing, in every delta whose surfaces are
  // all new. `buildRecord` is the OpenAPI axis's sorted writer, given an empty
  // `pathItems`: an AsyncAPI document has no path items, and the section it
  // would write is dropped below with every other empty one.
  const rebuilt = buildRecord({ pathItems: new Map(), components });
  const written: Record<string, unknown> = {};
  if (Object.keys(rebuilt.components).length > 0) written["components"] = rebuilt.components;
  const raw = isRecord(featPlain) ? featPlain[ASYNCAPI_BASELINES_KEY] : undefined;
  if (Object.keys(written).length === 0) {
    if (raw === undefined) return { text: null, pins };
    doc.deleteIn([ASYNCAPI_BASELINES_KEY]);
    return { text: doc.toString(), pins };
  }
  // Deep-equal, not byte-equal: the comparison must ignore key order exactly
  // as the digests do, so a record an author reordered by hand is left in
  // their order — and a second run over this function's own sorted output
  // finds the parse equal and writes nothing, which is the byte-for-byte
  // idempotence `loam rebase` promises.
  if (isDeepStrictEqual(raw, written)) return { text: null, pins };
  doc.setIn([ASYNCAPI_BASELINES_KEY], written);
  return { text: doc.toString(), pins };
}
