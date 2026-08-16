/**
 * The minimal reader for `services/<svc>/health.yaml` — the moment that file
 * stops being inert. loam reads exactly one KIND of thing out of it: ids. The
 * alert and SLI ids, so the architecture spec axis can ask whether a
 * requirement covers each one (`health.uncovered`); and the dependency ids,
 * so the same axis can weigh and reconcile them against the service's own
 * model — the file an on-call engineer reaches for first was otherwise free
 * text as far as validation was concerned, and it held four false operational
 * claims with a green validator in the first adopted fleet. Queries,
 * thresholds, checks, criticality — everything else stays authored prose that
 * no check reads, the same stance `operationIds` takes on OpenAPI schemas.
 *
 * The recognized keys (documented in SCHEMA.md, and deliberately few):
 *
 *   slis:         a YAML sequence; each entry contributes its `name` (or `id`
 *   alerts:       when there is no name), and a plain string entry is its own id.
 *   dependencies: a YAML sequence; each entry contributes its `id` (or
 *                 `service`, or `name` — the key is unstandardized in the wild:
 *                 the shipped example writes `service:`, the first adopted
 *                 fleet wrote `id:`), and a plain string entry is its own id.
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
  /** Ids of the `dependencies:` entries — empty when the file is missing, empty, or unreadable. */
  dependencies: string[];
  /** True when the file exists but is not a readable YAML mapping. Missing and empty files read as empty, not broken. */
  unreadable: boolean;
  /** The parser's own message, when there is one to quote back. */
  error?: string;
}

export async function readHealth(healthPath: string): Promise<HealthFile> {
  if (!existsSync(healthPath)) return { ids: NO_HEALTH_IDS, dependencies: [], unreadable: false };
  let doc: unknown;
  try {
    doc = parse(await readFile(healthPath, "utf8"));
  } catch (e) {
    return {
      ids: NO_HEALTH_IDS,
      dependencies: [],
      unreadable: true,
      error: e instanceof Error ? e.message : String(e),
    };
  }
  // An empty file parses to null: it declares nothing, and says so honestly.
  // A scalar or sequence document declares nothing READABLE — flag it.
  if (doc === null) return { ids: NO_HEALTH_IDS, dependencies: [], unreadable: false };
  if (typeof doc !== "object" || Array.isArray(doc)) {
    return { ids: NO_HEALTH_IDS, dependencies: [], unreadable: true, error: "document is not a YAML mapping" };
  }
  const top = doc as Record<string, unknown>;
  return {
    ids: { slis: idsOf(top["slis"], NAME_KEYS), alerts: idsOf(top["alerts"], NAME_KEYS) },
    dependencies: idsOf(top["dependencies"], DEPENDENCY_KEYS),
    unreadable: false,
  };
}

/** slis/alerts entries answer to `name` first — the key SCHEMA.md teaches. */
const NAME_KEYS = ["name", "id"] as const;
/**
 * Dependency entries answer to `id` first, because it is the explicit
 * identity; `service` and `name` are the spellings found in the wild.
 * Tolerance in reading is not vocabulary — SCHEMA.md still teaches one.
 */
const DEPENDENCY_KEYS = ["id", "service", "name"] as const;

/** The ids one sequence declares — first recognized key wins, deduped, document order. */
function idsOf(section: unknown, keys: readonly string[]): string[] {
  if (!Array.isArray(section)) return [];
  const out = new Set<string>();
  for (const entry of section) {
    if (typeof entry === "string") {
      if (entry.trim().length > 0) out.add(entry.trim());
      continue;
    }
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) continue;
    const rec = entry as Record<string, unknown>;
    const id = keys.map((k) => rec[k]).find((v) => typeof v === "string" && v.trim().length > 0);
    if (typeof id === "string") out.add(id.trim());
  }
  return [...out];
}
