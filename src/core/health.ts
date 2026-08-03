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
 * Tolerant end to end: a health.yaml that is missing, does not parse, or has
 * no recognizable ids yields an empty set — and an empty set produces no
 * findings, because a file loam cannot read must not manufacture obligations.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { parse } from "yaml";

export interface HealthIds {
  slis: string[];
  alerts: string[];
}

export const NO_HEALTH_IDS: HealthIds = { slis: [], alerts: [] };

export async function readHealthIds(healthPath: string): Promise<HealthIds> {
  if (!existsSync(healthPath)) return NO_HEALTH_IDS;
  let doc: unknown;
  try {
    doc = parse(await readFile(healthPath, "utf8"));
  } catch {
    return NO_HEALTH_IDS;
  }
  if (doc === null || typeof doc !== "object" || Array.isArray(doc)) return NO_HEALTH_IDS;
  const top = doc as Record<string, unknown>;
  return { slis: idsOf(top["slis"]), alerts: idsOf(top["alerts"]) };
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
