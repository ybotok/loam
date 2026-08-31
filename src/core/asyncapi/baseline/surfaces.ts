/**
 * The values a feature event contract restates that the SLOT pin cannot reach:
 * every `components/<kind>/<name>` outside `messages`.
 *
 * A package of its own rather than a sixth file in `core/asyncapi/` — that
 * directory is exactly at the five-file limit — and a separate ENUMERATION
 * from the OpenAPI axis's `restatedSurfaces` rather than an import of it,
 * although the two are the same shape. `restatedSurfaces` walks `paths` (a key
 * an AsyncAPI document does not have) and includes `components/messages`,
 * which on this axis is a SLOT: a message pinned both in-value by
 * `x-loam-based-on` and by a root record entry would have two identities, and
 * the merge would classify it twice — once as a slot, once as a surface — with
 * verdicts that need not agree. What IS shared is everything downstream of the
 * enumeration: `readBaselineRecord`, `entryFor`, `surfaceIn` and the record's
 * `components` half are axis-neutral, so the record means the same thing on
 * both axes and only the walk that fills it differs.
 *
 * Import direction is asyncapi → openapi, as core/asyncapi/digest.ts's header
 * states; nothing under core/openapi/ imports this package.
 */
import { isRecord } from "../../kernel/records.js";
import { FEATURE_ONLY_KEYS } from "../../openapi/digest.js";
import type { RestatedSurface } from "../../openapi/baseline/record.js";

/**
 * One surface of an event contract. Structurally the OpenAPI record's
 * component branch, on purpose: `entryFor` and `surfaceIn` take that union, so
 * a separate shape here would mean a second spelling of "the record's entry
 * for this value" — the drift both axes' digest modules exist to prevent.
 */
export type AsyncapiSurface = Extract<RestatedSurface, { kind: "component" }>;

/**
 * Every component surface a plain-parsed feature document declares, in
 * document order.
 *
 * `messages` is skipped because it is the third slot section (core/asyncapi/
 * digest.ts): a message carries its own in-value pin, and giving it a root
 * record entry as well would be two pins on one value. The feature-only keys
 * are skipped in the KIND position because `components: {x-loam-remove: true,
 * schemas: {…}}` is bookkeeping sitting where a component kind goes — the
 * strip already treats it that way, and a surface named after a marker would
 * be pinned by `loam rebase` and then graded as an orphan the moment the strip
 * took it out.
 */
export function asyncapiSurfaces(plain: unknown): AsyncapiSurface[] {
  const out: AsyncapiSurface[] = [];
  if (!isRecord(plain)) return out;
  const comps = plain["components"];
  if (!isRecord(comps)) return out;
  for (const [kind, names] of Object.entries(comps)) {
    if (kind === "messages" || FEATURE_ONLY_KEYS.has(kind)) continue;
    if (!isRecord(names)) continue;
    for (const [name, value] of Object.entries(names)) {
      out.push({ kind: "component", id: `${kind}/${name}`, value });
    }
  }
  return out;
}
