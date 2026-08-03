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
import { readFrontmatter, stringField } from "./frontmatter.js";

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
    openapi: join(dir, "openapi.yaml"),
    runbook: join(dir, "runbook.md"),
    health: join(dir, "health.yaml"),
    adrsDir: join(dir, "adrs"),
  };
}

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
  openapi: string;
}

export function featureSpecPaths(featureDir: string, service: string): FeatureSpecPaths {
  const dir = join(featureDir, "specs", service);
  return { dir, spec: join(dir, "spec.md"), openapi: join(dir, "openapi.yaml") };
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
        status: stringField(await readFrontmatter(p.spec), "status") ?? null,
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
 * Resolve a feature id to its directory: an exact directory name wins over a
 * slugged one (`FEAT-5` over `FEAT-5-slug`), and an active feature wins over an
 * archived one. Prefix matching respects the id boundary, so `FEAT-1` never
 * resolves to `FEAT-10-x`. Ties among slugged candidates go to the first by
 * name — deterministic, unlike the raw readdir order this replaces.
 */
export async function resolveFeature(
  docsDir: string,
  featureId: string,
  opts: { includeArchived?: boolean } = {},
): Promise<FeatureEntry | null> {
  const all = await listFeatures(docsDir, opts);
  const candidates = all
    .filter((f) => f.dirName === featureId || f.dirName.startsWith(featureId + "-"))
    .sort(
      (a, b) =>
        Number(b.dirName === featureId) - Number(a.dirName === featureId) ||
        Number(a.archived) - Number(b.archived) ||
        compareIds(a.dirName, b.dirName),
    );
  return candidates[0] ?? null;
}
