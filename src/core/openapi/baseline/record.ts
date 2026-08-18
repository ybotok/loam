/**
 * The `x-loam-baselines` record: what it holds, how it reads back, and which
 * of a feature document's surfaces it may speak for.
 *
 * One enumeration (`restatedSurfaces`) shared by the rebase plan, the gate and
 * the merge, so the three cannot drift into different ideas of what a feature
 * "restates" — the exact drift the operation axis's shared classifier exists
 * to prevent. Reading is deliberately permissive-with-problems: a malformed
 * record is DESCRIBED (`problems`), never diagnosed here — the gate refuses
 * it, parsers never print, which is doc.ts's own doctrine.
 */
import { isRecord } from "../../kernel/records.js";
import { HTTP_METHODS } from "../doc.js";
import { FEATURE_ONLY_KEYS, OPENAPI_BASELINES_KEY, OPERATION_DIGEST_RE } from "../digest.js";

/** The record as read: per-(path, key) digests and per-(kind/name) digests. */
export interface BaselineRecord {
  pathItems: Record<string, Record<string, string>>;
  components: Record<string, string>;
}

export const EMPTY_RECORD: BaselineRecord = { pathItems: {}, components: {} };

/** One surface a feature restates: a path-item non-method key, or a component. */
export type RestatedSurface =
  | { kind: "path-item"; path: string; key: string; value: unknown }
  | { kind: "component"; id: string; value: unknown };

/** The record a plain-parsed feature document carries, plus everything wrong with it. */
export function readBaselineRecord(plain: unknown): { record: BaselineRecord; problems: string[] } {
  const problems: string[] = [];
  const record: BaselineRecord = { pathItems: {}, components: {} };
  if (!isRecord(plain)) return { record, problems };
  const raw = plain[OPENAPI_BASELINES_KEY];
  if (raw === undefined) return { record, problems };
  if (!isRecord(raw)) {
    problems.push(`${OPENAPI_BASELINES_KEY} is not a mapping`);
    return { record, problems };
  }
  const items = raw["pathItems"];
  if (items !== undefined) {
    if (!isRecord(items)) problems.push(`${OPENAPI_BASELINES_KEY}.pathItems is not a mapping`);
    else {
      for (const [path, keys] of Object.entries(items)) {
        if (!isRecord(keys)) {
          problems.push(`${OPENAPI_BASELINES_KEY}.pathItems['${path}'] is not a mapping`);
          continue;
        }
        for (const [key, digest] of Object.entries(keys)) {
          if (typeof digest !== "string" || !OPERATION_DIGEST_RE.test(digest)) {
            problems.push(`${OPENAPI_BASELINES_KEY}.pathItems['${path}']['${key}'] is not a 16-hex digest`);
            continue;
          }
          (record.pathItems[path] ??= {})[key] = digest;
        }
      }
    }
  }
  const comps = raw["components"];
  if (comps !== undefined) {
    if (!isRecord(comps)) problems.push(`${OPENAPI_BASELINES_KEY}.components is not a mapping`);
    else {
      for (const [id, digest] of Object.entries(comps)) {
        if (typeof digest !== "string" || !OPERATION_DIGEST_RE.test(digest)) {
          problems.push(`${OPENAPI_BASELINES_KEY}.components['${id}'] is not a 16-hex digest`);
          continue;
        }
        record.components[id] = digest;
      }
    }
  }
  for (const key of Object.keys(raw)) {
    if (key !== "pathItems" && key !== "components") problems.push(`${OPENAPI_BASELINES_KEY}.${key} is not a recognised section`);
  }
  return { record, problems };
}

/**
 * Every surface this feature document RESTATES — the enumeration the plan
 * pins, the gate grades and the merge classifies. Path-item surfaces are the
 * non-HTTP-method keys (the feature-only markers are bookkeeping, not
 * surfaces; a METHOD whose value is a removal marker is the operation pin's
 * territory — but a non-method key is a surface whatever its value looks
 * like, because skipping the removal SHAPE here once let it through unpinned
 * and the merge wrote `{x-loam-remove: true}` over a living shared
 * `parameters` at exit 0). Component surfaces are every
 * `components/<kind>/<name>` the document declares.
 */
export function restatedSurfaces(plain: unknown): RestatedSurface[] {
  const out: RestatedSurface[] = [];
  if (!isRecord(plain)) return out;
  const paths = plain["paths"];
  if (isRecord(paths)) {
    for (const [path, item] of Object.entries(paths)) {
      if (!isRecord(item)) continue;
      for (const [key, value] of Object.entries(item)) {
        // Methods are the operation pin's territory and the feature-only
        // markers are bookkeeping; everything else is a surface — INCLUDING a
        // non-method key whose value happens to be removal-shaped. Skipping
        // that shape here once let it through unpinned and ungraded, and the
        // merge then wrote `{x-loam-remove: true}` over a living shared
        // `parameters` array at exit 0. The merge's own publishable filter
        // (markers.ts withoutFeatureMarkers) must keep agreeing with this
        // pair of exclusions — the surfaces test pins the agreement.
        if (HTTP_METHODS.has(key) || FEATURE_ONLY_KEYS.has(key)) continue;
        out.push({ kind: "path-item", path, key, value });
      }
    }
  }
  const comps = plain["components"];
  if (isRecord(comps)) {
    for (const [kind, names] of Object.entries(comps)) {
      if (!isRecord(names)) continue;
      for (const [name, value] of Object.entries(names)) {
        out.push({ kind: "component", id: `${kind}/${name}`, value });
      }
    }
  }
  return out;
}

/**
 * The value one plain-parsed document holds for one surface, `found`
 * distinguishing "absent" from a legal null. ONE spelling for the plan and the
 * gate, because "does the living contract have this surface" is half of every
 * verdict — two lookups could disagree about absence, and the disagreement
 * would surface as a pin graded against the wrong baseline.
 */
/**
 * The record's entry for one surface, or undefined — the mirror of
 * `surfaceIn`, and one spelling for the same reason: four open-coded lookups
 * could disagree about absence, and a disagreement surfaces as a pin graded
 * against the wrong baseline.
 */
export function entryFor(record: BaselineRecord, surface: RestatedSurface): string | undefined {
  return surface.kind === "path-item" ? record.pathItems[surface.path]?.[surface.key] : record.components[surface.id];
}

export function surfaceIn(plain: unknown, surface: RestatedSurface): { found: boolean; value: unknown } {
  const absent = { found: false, value: undefined };
  if (!isRecord(plain)) return absent;
  if (surface.kind === "path-item") {
    const paths = plain["paths"];
    if (!isRecord(paths)) return absent;
    const item = paths[surface.path];
    if (!isRecord(item) || !(surface.key in item)) return absent;
    return { found: true, value: item[surface.key] };
  }
  // The first `/` is the kind boundary, exactly as the merge's `#/components/`
  // regex reads it — OpenAPI component names cannot legally contain one.
  const cut = surface.id.indexOf("/");
  const comps = plain["components"];
  if (!isRecord(comps)) return absent;
  const names = comps[surface.id.slice(0, cut)];
  const name = surface.id.slice(cut + 1);
  if (!isRecord(names) || !(name in names)) return absent;
  return { found: true, value: names[name] };
}

/**
 * The record as rebase writes it: lexicographically sorted at every level, so
 * a second run is byte-identical and diffs stay readable.
 */
export function buildRecord(pins: { pathItems: Map<string, Map<string, string>>; components: Map<string, string> }): BaselineRecord {
  const sorted = (keys: Iterable<string>): string[] => [...keys].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const record: BaselineRecord = { pathItems: {}, components: {} };
  for (const path of sorted(pins.pathItems.keys())) {
    const keys = pins.pathItems.get(path)!;
    const entry: Record<string, string> = {};
    for (const key of sorted(keys.keys())) entry[key] = keys.get(key)!;
    record.pathItems[path] = entry;
  }
  for (const id of sorted(pins.components.keys())) record.components[id] = pins.components.get(id)!;
  return record;
}
