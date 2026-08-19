/**
 * What the docs repo's two enumerations hand back, and how their ids compare.
 *
 * Split from the read model because these are the shapes every OTHER module
 * names — `ServiceEntry` is the type a dozen call sites annotate against — and
 * a shape should not drag the `readdir` that produces it into every importer.
 * `compareIds` lives here for the same reason: sorting ids is what a renderer
 * does, and no renderer wants the enumeration.
 */
import type { FeatureDir, ServiceDir } from "../kernel/ids/dirs.js";
import { rawFeatureId, type RawFeatureId } from "../kernel/ids/feature.js";
import type { RawServiceId } from "../kernel/ids/service.js";
import type { Finding } from "../vocabulary/report.js";


export interface ServiceArtifacts {
  model: boolean;
  spec: boolean;
  openapi: boolean;
  /**
   * The async contract (AsyncAPI 3). Presence-tracked only, like `runbook` and
   * `health` — deliberately NOT part of the maturity ladder (core/vocabulary/maturity.ts),
   * whose `documented` rung is the model/spec/openapi triple. Adding a fourth
   * required artifact would demote every already-`documented` service in the
   * fleet on upgrade, without one byte of their files changing.
   */
  asyncapi: boolean;
  runbook: boolean;
  health: boolean;
}

export interface ServiceEntry {
  /** Canonical service id — the LEAF directory name, at whatever depth the tree walk found it. */
  id: RawServiceId;
  /** Absolute path to the service's directory, as enumerated — the value every artifact path is resolved from. */
  dir: ServiceDir;
  /**
   * Names of the subsystem directories between `services/` and the service,
   * outermost first. Empty = unfiled — directly under `services/`, which is
   * permanent, normal and never a finding. Placement only: no identity, no
   * check and no join may branch on it.
   */
  subsystem: string[];
  has: ServiceArtifacts;
  /** Number of ADR files under adrs/. */
  adrs: number;
  /** `status` from the living spec's frontmatter; null when nobody has said. */
  status: string | null;
  /**
   * Provenance signals from the living spec's frontmatter: whether it declares
   * any `sources`, and whether a `sources_digest` stamp exists. Presence only —
   * whether the digest still matches the code is `validate`'s question, and it
   * can only be answered from inside the service's own repo.
   */
  sources: { declared: boolean; stamped: boolean };
  /**
   * Why no loam command can author this directory, or absent when the name is a
   * legal service id — `serviceIdProblem`'s own sentence, so the read model and
   * the refusal say the same thing.
   *
   * The enumeration still LISTS it: the directory is there, it holds somebody's
   * documents, and hiding it would repeat the symlink mistake one field up. But
   * every authoring command (`adopt`, `delta`, `rebase`, `new --touches`,
   * `init`) refuses this id with `invalid-option`, so grading it as an ordinary
   * service left the fleet gate demanding fixes no loam command can make. The
   * NAME is the finding — see `serviceIdFindings`.
   */
  idProblem?: string;
}

export interface FeatureEntry {
  /** Feature id, derived from the directory name (FEAT-1-split -> FEAT-1). */
  id: RawFeatureId;
  /** The directory name as it is on disk, slug and all. */
  dirName: string;
  /** Absolute path to the feature directory. */
  dir: FeatureDir;
  archived: boolean;
  /** Services this feature carries a delta for, from specs/<svc>/. */
  services: RawServiceId[];
  has: { intent: boolean; delta: boolean };
}

/**
 * The directories in the `services/` tree that no loam command can address.
 *
 * A finding rather than a silent skip, and an ERROR rather than a warning,
 * because the state is not survivable in either direction: `loam adopt`,
 * `loam delta`, `loam rebase` and `loam new --touches` all refuse the id with
 * `invalid-option`, so the documents in there can never be updated by loam
 * again, while `validate --all` used to grade the directory as an ordinary
 * service and demand `model.likec4`, a spec and a landscape binding for it. The
 * fix is a rename, and it is a rename loam cannot do for you — the id is
 * spelled in the landscape binding, in the frontmatter and in every feature
 * that touched the service — so the message names all three.
 *
 * Emitted from the fleet target (`validate --all`), where the SET of service
 * directories is the thing being checked; a per-service run is already refused
 * by its own `--service` guard before it gets here. Lives beside the entry
 * shape rather than the enumeration because it is a projection of `idProblem`,
 * not a read — the entry docblock already points here.
 */
export function serviceIdFindings(services: ServiceEntry[]): Finding[] {
  return services
    .filter((s) => s.idProblem !== undefined)
    .map((s) => ({
      severity: "error" as const,
      code: "service.id-invalid",
      subject: s.id,
      message:
        `services/${s.id}/ — ${s.idProblem} ` +
        `Every authoring command refuses this id (\`loam adopt\`, \`loam delta\`, \`loam new --touches\`), so nothing in that directory can be changed through loam. ` +
        `Rename the directory to a legal id, then update its \`service:\` frontmatter, its \`metadata { service '${s.id}' }\` binding in architecture/landscape.likec4, and any features/<FEAT>/specs/${s.id}/ that names it.`,
    }));
}

/**
 * Compare ids so digit runs sort numerically: FEAT-2 before FEAT-10.
 * Deterministic and locale-independent — ordering is part of the output
 * contract for `list`, and `--json` consumers diff it.
 */
export function compareIds(a: string, b: string): number {
  const ta = tokenize(a);
  const tb = tokenize(b);
  for (let i = 0; i < Math.max(ta.length, tb.length); i += 1) {
    const x = ta[i];
    const y = tb[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (typeof x === "number" && typeof y === "number") {
      if (x !== y) return x - y;
    } else if (String(x) !== String(y)) {
      return String(x) < String(y) ? -1 : 1;
    }
  }
  return 0;
}

function tokenize(s: string): (string | number)[] {
  return (s.match(/\d+|\D+/g) ?? []).map((t) => (/^\d/.test(t) ? Number(t) : t));
}

/**
 * Known ids within a small edit distance of `id`, closest first, at most three.
 *
 * The did-you-mean hint for a name somebody typed: `loam new --touches` and
 * `loam delta <svc>` answer the same mistake, and each carried its own copy of
 * these twenty-four lines. It belongs here because the ids being scored are
 * this module's ids — service directory names, feature ids — and because
 * `compareIds` right above is the tiebreak that keeps the list deterministic
 * when two candidates score equally. Not in `core/kernel/ids/`: `compareIds` lives
 * here and repo.ts imports ids.js, so putting it there would close a cycle.
 *
 * `arch.ts`'s `closeIds` looks similar and is not: substring and prefix, capped
 * at five, answering "which element could this be" rather than "did you
 * misspell a directory". Two rules, two homes.
 */
export function nearestIds(id: string, known: string[]): string[] {
  const budget = Math.max(1, Math.floor(id.length / 4));
  return known
    .map((candidate) => ({ candidate, distance: editDistance(id.toLowerCase(), candidate.toLowerCase()) }))
    .filter((scored) => scored.distance <= budget)
    .sort((a, b) => a.distance - b.distance || compareIds(a.candidate, b.candidate))
    .slice(0, 3)
    .map((scored) => scored.candidate);
}

/** Plain Levenshtein — ids are short, and the row-at-a-time form keeps it obvious. */
function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const substitution = previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1);
      current.push(Math.min(previous[j]! + 1, current[j - 1]! + 1, substitution));
    }
    previous = current;
  }
  return previous[b.length]!;
}

/**
 * Feature id from a directory name: everything up to and including the first
 * number run (`FEAT-101-payment-splitting` -> `FEAT-101`). A name with no
 * `<word>-<number>` head is its own id. Quirk: a dated slug keeps only its first
 * segment (`release-2024-01-x` -> `release-2024`) — ids are not meant to be dates.
 */
export function featureIdFromDirName(dirName: string): RawFeatureId {
  const m = /^(.*?-\d+)(?:-|$)/.exec(dirName);
  // Constructed through the kernel helper, so this module holds no cast: the
  // derived id's provenance is the repository — a directory the enumeration
  // listed — which is exactly what `RawFeatureId` records.
  return rawFeatureId(m ? m[1]! : dirName);
}
