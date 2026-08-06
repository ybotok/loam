/**
 * The minimal reader for `services/<svc>/health.yaml` — the moment that file
 * stops being inert. loam reads exactly one thing out of it: the IDS of the
 * alerts and SLIs it declares, so the architecture spec axis can ask whether a
 * requirement covers each one (`health.uncovered`). Queries, thresholds,
 * checks, dependencies — everything else stays authored prose that no check
 * reads, the same stance `operationIds` takes on OpenAPI schemas.
 *
 * The recognized keys (documented in SCHEMA.md, and deliberately few):
 *
 *   slis:      a YAML sequence; each entry contributes its `name` (or `id`
 *   alerts:    when there is no name), and a plain string entry is its own id.
 *
 * Tolerant about absence, honest about breakage: a health.yaml that is missing
 * or declares nothing recognizable yields an empty set — and an empty set
 * produces no findings, because an absent file must not manufacture
 * obligations. A file that EXISTS but cannot be read is different evidence:
 * its ids are unknown, not empty, so the `unreadable` flag travels alongside
 * (parsers never diagnose — validate grades it as `health.invalid`). The old
 * silent empty set turned every `Covers: alert:/sli:` entry of that service
 * into a false `covers.unknown` "typo", when the truth was this file.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { parse } from "yaml";

export interface HealthIds {
  slis: string[];
  alerts: string[];
}

const NO_HEALTH_IDS: HealthIds = { slis: [], alerts: [] };

/** The read of one health.yaml: its declared ids, and whether the file could be read at all. */
export interface HealthFile {
  ids: HealthIds;
  /** True when the file exists but is not a readable YAML mapping. Missing and empty files read as empty, not broken. */
  unreadable: boolean;
  /** The parser's own message, when there is one to quote back. */
  error?: string;
}

export async function readHealth(healthPath: string): Promise<HealthFile> {
  if (!existsSync(healthPath)) return { ids: NO_HEALTH_IDS, unreadable: false };
  let doc: unknown;
  try {
    doc = parse(await readFile(healthPath, "utf8"));
  } catch (e) {
    return { ids: NO_HEALTH_IDS, unreadable: true, error: e instanceof Error ? e.message : String(e) };
  }
  // An empty file parses to null: it declares nothing, and says so honestly.
  // A scalar or sequence document declares nothing READABLE — flag it.
  if (doc === null) return { ids: NO_HEALTH_IDS, unreadable: false };
  if (typeof doc !== "object" || Array.isArray(doc)) {
    return { ids: NO_HEALTH_IDS, unreadable: true, error: "document is not a YAML mapping" };
  }
  const top = doc as Record<string, unknown>;
  return { ids: { slis: idsOf(top["slis"]), alerts: idsOf(top["alerts"]) }, unreadable: false };
}

/** The ids a `slis:` / `alerts:` sequence declares — deduped, document order. */
function idsOf(section: unknown): string[] {
  if (!Array.isArray(section)) return [];
  const out = new Set<string>();
  for (const entry of section) {
    if (typeof entry === "string") {
      if (entry.trim().length > 0) out.add(entry.trim());
      continue;
    }
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) continue;
    const rec = entry as Record<string, unknown>;
    const id = typeof rec["name"] === "string" ? rec["name"] : rec["id"];
    if (typeof id === "string" && id.trim().length > 0) out.add(id.trim());
  }
  return [...out];
}
