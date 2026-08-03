/**
 * Read model of the docs repo — the single place that knows its layout.
 *
 * Enumeration goes by the filesystem, and only by the filesystem: files are the
 * source of truth, so `services/` IS the list of services and there is no
 * manifest that can disagree with it. Every command that needs "which services
 * exist", "which features are in flight" or "where does artifact X live" asks
 * here, so the layout is spelled exactly once.
 */
import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { listField, readFrontmatter, stringField } from "./frontmatter.js";

/** Directory under features/ holding shipped features. Never a feature itself. */
const ARCHIVE_DIR = "archive";

export interface ServiceArtifacts {
  model: boolean;
  spec: boolean;
  openapi: boolean;
  runbook: boolean;
  health: boolean;
}

export interface ServiceEntry {
  /** Canonical service id — the directory name under services/. */
  id: string;
  /** Absolute path to services/<id>/. */
  dir: string;
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
}

export interface FeatureEntry {
  /** Feature id, derived from the directory name (FEAT-1-split -> FEAT-1). */
  id: string;
  /** The directory name as it is on disk, slug and all. */
  dirName: string;
  /** Absolute path to the feature directory. */
  dir: string;
  archived: boolean;
  /** Services this feature carries a delta for, from specs/<svc>/. */
  services: string[];
  has: { intent: boolean; delta: boolean };
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
 * Feature id from a directory name: everything up to and including the first
 * number run (`FEAT-101-payment-splitting` -> `FEAT-101`). A name with no
 * `<word>-<number>` head is its own id. Quirk: a dated slug keeps only its first
 * segment (`release-2024-01-x` -> `release-2024`) — ids are not meant to be dates.
 */
export function featureIdFromDirName(dirName: string): string {
  const m = /^(.*?-\d+)(?:-|$)/.exec(dirName);
  return m ? m[1]! : dirName;
}

/* ------------------------------------------------------------------ */
/* Paths — artifact filenames are spelled here and nowhere else        */
/* ------------------------------------------------------------------ */

export interface ServicePaths {
  dir: string;
  model: string;
  spec: string;
  archSpec: string;
  openapi: string;
  runbook: string;
  health: string;
  adrsDir: string;
}

export function servicePaths(docsDir: string, service: string): ServicePaths {
  const dir = join(docsDir, "services", service);
  return {
    dir,
    model: join(dir, "model.likec4"),
    spec: join(dir, "spec.md"),
    archSpec: join(dir, "arch.spec.md"),
    openapi: join(dir, "openapi.yaml"),
    runbook: join(dir, "runbook.md"),
    health: join(dir, "health.yaml"),
    adrsDir: join(dir, "adrs"),
  };
}

/**
 * The pair of requirement-carrying spec files, living and delta alike: the
 * business spec and the architecture spec. Same grammar, same delta algebra,
 * same merge — everything that walks "the spec files" of a service walks this
 * list, so the two axes cannot drift apart in what handles them. `key` indexes
 * ServicePaths/FeatureSpecPaths; `label` is how the axis names itself in prose.
 */
export const SPEC_AXES = [
  { key: "spec", file: "spec.md", label: "requirements" },
  { key: "archSpec", file: "arch.spec.md", label: "arch requirements" },
] as const;
export type SpecAxis = (typeof SPEC_AXES)[number];

export interface FeaturePaths {
  dir: string;
  intent: string;
  delta: string;
  specsDir: string;
  adrsDir: string;
}

export function featurePaths(featureDir: string): FeaturePaths {
  return {
    dir: featureDir,
    intent: join(featureDir, "intent.md"),
    delta: join(featureDir, "delta.likec4"),
    specsDir: join(featureDir, "specs"),
    adrsDir: join(featureDir, "adrs"),
  };
}

export interface FeatureSpecPaths {
  dir: string;
  spec: string;
  archSpec: string;
  openapi: string;
}

export function featureSpecPaths(featureDir: string, service: string): FeatureSpecPaths {
  const dir = join(featureDir, "specs", service);
  return {
    dir,
    spec: join(dir, "spec.md"),
    archSpec: join(dir, "arch.spec.md"),
    openapi: join(dir, "openapi.yaml"),
  };
}

export function landscapePath(docsDir: string): string {
  return join(docsDir, "architecture", "landscape.likec4");
}

export function featuresDir(docsDir: string): string {
  return join(docsDir, "features");
}

/* ------------------------------------------------------------------ */
/* Enumeration                                                         */
/* ------------------------------------------------------------------ */

/** Sorted names of the real subdirectories of `dir` (dot-dirs and files skipped). */
async function subdirs(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory() && !e.name.startsWith("."))
    .map((e) => e.name)
    .sort(compareIds);
}

async function countMarkdown(dir: string): Promise<number> {
  if (!existsSync(dir)) return 0;
  const entries = await readdir(dir, { withFileTypes: true });
  return entries.filter((e) => e.isFile() && e.name.endsWith(".md")).length;
}

/** Services a feature carries a delta for, ordered — the subdirs of its specs/. */
export async function featureSpecServices(featureDir: string): Promise<string[]> {
  return subdirs(featurePaths(featureDir).specsDir);
}

/** Every service in the docs repo, ordered by id. */
export async function listServices(docsDir: string): Promise<ServiceEntry[]> {
  const names = await subdirs(join(docsDir, "services"));
  return Promise.all(
    names.map(async (id): Promise<ServiceEntry> => {
      const p = servicePaths(docsDir, id);
      const fm = await readFrontmatter(p.spec);
      return {
        id,
        dir: p.dir,
        has: {
          model: existsSync(p.model),
          spec: existsSync(p.spec),
          openapi: existsSync(p.openapi),
          runbook: existsSync(p.runbook),
          health: existsSync(p.health),
        },
        adrs: await countMarkdown(p.adrsDir),
        status: stringField(fm, "status") ?? null,
        sources: {
          declared: listField(fm, "sources").length > 0,
          stamped: stringField(fm, "sources_digest") !== undefined,
        },
      };
    }),
  );
}

async function readFeature(dir: string, dirName: string, archived: boolean): Promise<FeatureEntry> {
  const p = featurePaths(dir);
  return {
    id: featureIdFromDirName(dirName),
    dirName,
    dir,
    archived,
    services: await subdirs(p.specsDir),
    has: { intent: existsSync(p.intent), delta: existsSync(p.delta) },
  };
}

/**
 * Features in the docs repo, ordered by id (active and archived interleaved when
 * both are asked for). `features/archive/` is the archive, never a feature.
 */
export async function listFeatures(
  docsDir: string,
  opts: { includeArchived?: boolean } = {},
): Promise<FeatureEntry[]> {
  const root = featuresDir(docsDir);
  const active = (await subdirs(root)).filter((n) => n !== ARCHIVE_DIR);
  const out = await Promise.all(active.map((n) => readFeature(join(root, n), n, false)));

  if (opts.includeArchived) {
    const archiveRoot = join(root, ARCHIVE_DIR);
    const archived = await subdirs(archiveRoot);
    out.push(...(await Promise.all(archived.map((n) => readFeature(join(archiveRoot, n), n, true)))));
  }

  return out.sort((a, b) => compareIds(a.id, b.id) || compareIds(a.dirName, b.dirName));
}

/**
 * Which side of `features/archive/` a lookup may land on. The policy is an
 * argument, not a default, so every command's stance on shipped features is
 * visible at its call site: delta/validate/archive work on in-flight features
 * ("exclude"), show/verify/new read shipped ones too ("include"), unarchive
 * takes back nothing else ("only").
 */
export type ArchivedPolicy = "exclude" | "include" | "only";

/**
 * Resolve a feature argument — a canonical id (`FEAT-5`) or an exact directory
 * name (`FEAT-5-slug`) — to its entry. The entry's `id` is the canonical
 * spelling, and it is the only name a caller may use from here on: tag filters,
 * coherence, and the cross-feature self-exclusion scans all compare against
 * `feature.id`, never against the raw argument.
 *
 * An exact directory name wins over a slugged one (`FEAT-5` over `FEAT-5-slug`),
 * and under "include" an active feature wins over an archived one. Prefix
 * matching respects the id boundary, so `FEAT-1` never resolves to `FEAT-10-x`.
 * Ties among slugged candidates go to the first by name — deterministic, unlike
 * the raw readdir order this replaces.
 */
export async function resolveFeature(
  docsDir: string,
  arg: string,
  archived: ArchivedPolicy,
): Promise<FeatureEntry | null> {
  const all = await listFeatures(docsDir, { includeArchived: archived !== "exclude" });
  const candidates = all
    .filter((f) => archived === "include" || f.archived === (archived === "only"))
    .filter((f) => f.dirName === arg || f.dirName.startsWith(arg + "-"))
    .sort(
      (a, b) =>
        Number(b.dirName === arg) - Number(a.dirName === arg) ||
        Number(a.archived) - Number(b.archived) ||
        compareIds(a.dirName, b.dirName),
    );
  return candidates[0] ?? null;
}

/**
 * The message for an exclude-mode miss. When the feature exists under
 * `features/archive/`, "no feature" is a lie the caller would have to debug —
 * the honest answer is "already archived", plus how to look at it. The `--json`
 * code stays `unknown-target` either way: the target is unknown to the command
 * that asked, and the prose carries the diagnosis.
 */
export async function missingFeatureMessage(docsDir: string, arg: string): Promise<string> {
  const shipped = await resolveFeature(docsDir, arg, "only");
  if (shipped !== null) {
    return (
      `Feature '${shipped.id}' is already archived (features/archive/${shipped.dirName}) — ` +
      `\`loam show ${shipped.id}\` reads it, \`loam unarchive ${shipped.id}\` re-opens it.`
    );
  }
  return `No feature '${arg}' under ${featuresDir(docsDir)}.`;
}
