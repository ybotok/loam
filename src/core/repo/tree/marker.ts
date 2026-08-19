/**
 * The subsystem marker: `subsystem.yaml`, the one file that makes a directory
 * under `services/` a GROUP rather than a service.
 *
 * Presence classifies; content is metadata. The walk decides what a directory
 * IS from the marker's existence alone, so a marker that cannot be read still
 * classifies its directory as a subsystem — anything else would let a corrupt
 * byte reinterpret a whole subtree as a service and swallow the fleet beneath
 * it, the exact silent-shrink the three-way classification exists to refuse.
 * An unreadable marker is reported as exactly one `subsystem.invalid` finding
 * instead (`walk.ts` emits it from the `invalid` field here).
 *
 * The defensive-read shape is `core/permissions/permissions.ts`'s: every wrong
 * shape is an `invalid` sentence naming what is wrong, never a throw — this is
 * a read model, and a marker somebody hand-edited badly must not take down the
 * enumeration that would report it.
 */
import { readFile } from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import { isRecord } from "../../kernel/records.js";

/** The marker's filename — spelled here and nowhere else. */
export const SUBSYSTEM_MARKER = "subsystem.yaml";

export interface SubsystemMeta {
  title?: string;
  description?: string;
  owner?: string;
  /** Why the file could not be read as subsystem metadata, when it could not. */
  invalid?: string;
}

/**
 * Read one marker. An EMPTY file is a valid marker with no metadata — the
 * marker's job is done by existing, and `title`/`description`/`owner` are all
 * optional. A `members` key is invalid on purpose: placement is recorded
 * exactly once, in the directory itself, and a membership list would be a
 * second copy that merges, drifts and lies (SCHEMA.md's marker-not-manifest
 * rule).
 */
export async function readSubsystemMarker(path: string): Promise<SubsystemMeta> {
  let doc: unknown;
  try {
    doc = parseYaml(await readFile(path, "utf8"));
  } catch (e) {
    return { invalid: e instanceof Error ? e.message : String(e) };
  }
  if (doc === null || doc === undefined) return {};
  if (!isRecord(doc)) return { invalid: "the document is not a mapping" };
  if (doc["members"] !== undefined) {
    return {
      invalid:
        "it declares `members` — a subsystem's members are the service directories inside it, " +
        "recorded exactly once, in the directory itself; a list here would be a second copy that drifts",
    };
  }
  for (const field of ["title", "description", "owner"] as const) {
    const value = doc[field];
    if (value !== undefined && typeof value !== "string") {
      return { invalid: `\`${field}\` is not a string` };
    }
  }
  return {
    ...(typeof doc["title"] === "string" ? { title: doc["title"] } : {}),
    ...(typeof doc["description"] === "string" ? { description: doc["description"] } : {}),
    ...(typeof doc["owner"] === "string" ? { owner: doc["owner"] } : {}),
  };
}
