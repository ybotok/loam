/**
 * What `loam rebase` writes on the surface axis: the `x-loam-baselines` record,
 * rebuilt wholesale from what is on disk right now.
 *
 * The record is rebuilt rather than patched for the same reason the operation
 * pin is always the LIVING digest: a pin is a claim about what its author read,
 * and an entry left behind for a surface the delta no longer restates — or one
 * whose living counterpart is gone — is a claim nobody is making any more.
 * Wholesale rebuild prunes both without a second code path, and the sorted
 * serialization (`buildRecord`) is what makes a second run byte-identical.
 *
 * This module must not import from `../merge/` — the merge reads
 * `./record.ts`, so a value edge back into `merge/` would be a package cycle.
 * That is also why an unreadable document is answered with "nothing to pin"
 * instead of `OpenapiMergeError`: every caller chains this AFTER
 * `pinOpenapiOperations`, which has already thrown that error for any document
 * either side cannot parse, so the silent answer here is unreachable in
 * practice and merely keeps the failure ownership where it already lives.
 */
import { isDeepStrictEqual } from "node:util";
import { parseDocument } from "yaml";
import { isRecord } from "../../kernel/records.js";
import { OPENAPI_BASELINES_KEY, valueDigest } from "../digest.js";
import { buildRecord, entryFor, readBaselineRecord, restatedSurfaces, surfaceIn } from "./record.js";

/** What happened to one restated surface's baseline entry. */
export interface SurfacePin {
  /** Which surface family the entry pins. */
  kind: "path-item" | "component";
  /** `/orders '<key>'` for a path-item key; `<kind>/<name>` for a component. */
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

export interface OpenapiBaselinePlan {
  /** The rewritten contract, or null when the record already says what this run would write. */
  text: string | null;
  pins: SurfacePin[];
}

/**
 * Pin every restated path-item key and component of a feature contract against
 * the living one. The entry is always `valueDigest` of the LIVING value, never
 * of the delta's own — the one rule that yields both merge verdicts: a surface
 * the author only QUOTED equals its own entry, one they EDITED differs from it.
 * A surface with no living counterpart is `unresolved` and deliberately absent
 * from the record: there is no baseline to claim, and inventing one would make
 * `classifyBaselineDigests` call a genuinely new value `unfounded`.
 */
export function planOpenapiBaselines(
  featureText: string,
  livingText: string,
  _service: string,
): OpenapiBaselinePlan {
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
  const pathItems = new Map<string, Map<string, string>>();
  const components = new Map<string, string>();
  const pins: SurfacePin[] = [];
  for (const surface of restatedSurfaces(featPlain)) {
    // A malformed current entry reads back as absent (readBaselineRecord drops
    // it into `problems`), so this run reports `pinned` and overwrites it —
    // rebase is the command the gate's `openapi.baseline-invalid` sends people
    // to, and it must repair what it names.
    const from = entryFor(current, surface);
    const base = {
      kind: surface.kind,
      target: surface.kind === "path-item" ? `${surface.path} '${surface.key}'` : surface.id,
    } as const;
    const livingValue = surfaceIn(livingPlain, surface);
    if (!livingValue.found) {
      pins.push({ ...base, status: "unresolved", from: from ?? null, to: null });
      continue;
    }
    const digest = valueDigest(livingValue.value);
    if (surface.kind === "path-item") {
      let keys = pathItems.get(surface.path);
      if (keys === undefined) pathItems.set(surface.path, (keys = new Map()));
      keys.set(surface.key, digest);
    } else {
      components.set(surface.id, digest);
    }
    pins.push({
      ...base,
      status: from === digest ? "unchanged" : from === undefined ? "pinned" : "repinned",
      from: from ?? null,
      to: digest,
    });
  }

  // The written form drops empty sections, and the whole key when both are —
  // a bare `x-loam-baselines: {}` would be bookkeeping about nothing, in every
  // delta whose surfaces are all new.
  const rebuilt = buildRecord({ pathItems, components });
  const written: Record<string, unknown> = {};
  if (Object.keys(rebuilt.pathItems).length > 0) written["pathItems"] = rebuilt.pathItems;
  if (Object.keys(rebuilt.components).length > 0) written["components"] = rebuilt.components;
  const raw = isRecord(featPlain) ? featPlain[OPENAPI_BASELINES_KEY] : undefined;
  if (Object.keys(written).length === 0) {
    if (raw === undefined) return { text: null, pins };
    doc.deleteIn([OPENAPI_BASELINES_KEY]);
    return { text: doc.toString(), pins };
  }
  // Deep-equal, not byte-equal: the comparison must ignore key order exactly as
  // the digests do, so a record an author reordered by hand is left in their
  // order — and a second run over this function's own sorted output finds the
  // parse equal and writes nothing, which is the byte-for-byte idempotence
  // `loam rebase` promises.
  if (isDeepStrictEqual(raw, written)) return { text: null, pins };
  doc.setIn([OPENAPI_BASELINES_KEY], written);
  return { text: doc.toString(), pins };
}
