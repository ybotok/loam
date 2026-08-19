/**
 * Where every artifact lives. Artifact filenames are spelled here and nowhere
 * else, so a rename is one edit rather than a grep.
 *
 * This is also the module that carries loam's one path guarantee.
 * `unfiledServicePaths(docsDir, service)` spells `<docsDir>/services/<service>/`,
 * so both parts are caller-controlled path input, and `node:path` cannot help:
 * `join(...paths: string[])` accepts every string there is. The guarantee IS
 * the parameter brands and nothing else — `PathableService` for the id (a name
 * whose provenance is the repository, unconstructible from document text),
 * `DocsDir`/`FeatureDir` for the roots (a resolved config or validated
 * `--docs`; a directory an enumeration read), and `ServiceDir` for
 * `servicePathsAt` (the enumeration's own resolved directory, narrower still)
 * — the `kernel/ids/` package holds the only casts, so an unchecked value at
 * these call sites does not compile.
 * Code that spells `services/<id>/` or a feature layout with a bare join is
 * outside the guarantee — `commands/new.ts` and the openspec migrator both do,
 * held instead by `resolveInside` at the write.
 */
import { join } from "node:path";
import { serviceDirOf, type DocsDir, type FeatureDir, type ServiceDir } from "../kernel/ids/dirs.js";
import type { PathableService } from "../kernel/ids/service.js";
import type { SubsystemName } from "../kernel/ids/subsystem.js";

/** Directory under features/ holding shipped features. Never a feature itself. */
export const ARCHIVE_DIR = "archive";

/* ------------------------------------------------------------------ */
/* Paths — artifact filenames are spelled here and nowhere else        */
/* ------------------------------------------------------------------ */

/**
 * The living artifact filenames, as one table, because two questions read
 * them: `servicePathsAt` below spells the paths, and the tree walk classifies
 * a directory as a service by whether any of these names sit in it. The walk
 * cannot import this module — `repo → repo/tree` is the package direction, and
 * an edge back would be the cycle `scripts/package-graph.mjs` refuses — so
 * `repo.ts` injects `isServiceArtifactName` into the walk request instead.
 */
const ARTIFACT_FILES = {
  model: "model.likec4",
  spec: "spec.md",
  archSpec: "arch.spec.md",
  openapi: "openapi.yaml",
  asyncapi: "asyncapi.yaml",
  runbook: "runbook.md",
  health: "health.yaml",
} as const;
const ADRS_DIR = "adrs";

/** Does a directory entry name a living service artifact? The classification half of the table above. */
export function isServiceArtifactName(name: string, kind: "file" | "dir"): boolean {
  if (kind === "dir") return name === ADRS_DIR;
  return Object.values(ARTIFACT_FILES).some((file) => file === name);
}

export interface ServicePaths {
  dir: ServiceDir;
  model: string;
  spec: string;
  archSpec: string;
  openapi: string;
  /** The async contract — the event axis's sibling of `openapi`. */
  asyncapi: string;
  runbook: string;
  health: string;
  adrsDir: string;
}

/**
 * The artifact paths of a service whose directory is already KNOWN — the
 * enumeration's `dir`, at whatever depth the tree walk found it. This is the
 * spelling every reader of an existing service must use: joining
 * `services/<id>/` at the root is only true for a fleet nobody has filed, and
 * a moved service would silently grade as absent through it.
 */
export function servicePathsAt(dir: ServiceDir): ServicePaths {
  return {
    dir,
    model: join(dir, ARTIFACT_FILES.model),
    spec: join(dir, ARTIFACT_FILES.spec),
    archSpec: join(dir, ARTIFACT_FILES.archSpec),
    openapi: join(dir, ARTIFACT_FILES.openapi),
    asyncapi: join(dir, ARTIFACT_FILES.asyncapi),
    runbook: join(dir, ARTIFACT_FILES.runbook),
    health: join(dir, ARTIFACT_FILES.health),
    adrsDir: join(dir, ADRS_DIR),
  };
}

/**
 * The UNFILED spelling — `<docsDir>/services/<id>/`, the tree's root level.
 * This is where creation lands (`adopt`'s brief, a new service materialised by
 * `archive`, the OpenSpec migration) and the honest fallback for a service the
 * enumeration does not answer; for a service that EXISTS, resolve through the
 * enumeration instead (`servicePathsAt(entry.dir)`, or
 * `locateServicePaths` in `service-target.ts`, which chooses between the two).
 * Renamed from `servicePaths` when the tree landed, precisely so the compiler
 * would put every remaining caller in front of a reviewer: a root join that
 * survives unreviewed is a moved service silently grading as absent.
 */
export function unfiledServicePaths(docsDir: DocsDir, service: PathableService): ServicePaths {
  return servicePathsAt(serviceDirOf(join(docsDir, "services", service)));
}

/**
 * The creation spelling INSIDE a subsystem — `<subsystemDir>/<id>/`, the
 * target `adopt --subsystem` briefs so an adoption need not land unfiled and
 * cost a second command. The same two provenances the unfiled spelling
 * combines, one level down: the subsystem directory came off the tree walk's
 * readdir, and the id passed the service grammar before it reached here.
 */
export function servicePathsUnder(subsystemDir: string, service: PathableService): ServicePaths {
  return servicePathsAt(serviceDirOf(join(subsystemDir, service)));
}

/**
 * The directory a SUBSYSTEM occupies (or will occupy) under a parent — the
 * spelling `subsystem new` creates and `subsystem rename` renames into. The
 * same guarantee-by-brand as the service spellings above: the parent came off
 * the tree walk's readdir (or is `servicesDir` itself), and demanding
 * `SubsystemName` here is what makes the validator unskippable — a raw argv
 * string at this call site does not compile, so no future verb can hoist the
 * join above the check that earns it.
 */
export function subsystemPathUnder(parentDir: string, name: SubsystemName): string {
  return join(parentDir, name);
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

export function featurePaths(featureDir: FeatureDir): FeaturePaths {
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
  /** The async contract delta — the event axis's sibling of `openapi`. */
  asyncapi: string;
}

export function featureSpecPaths(featureDir: FeatureDir, service: PathableService): FeatureSpecPaths {
  const dir = join(featureDir, "specs", service);
  return {
    dir,
    spec: join(dir, "spec.md"),
    archSpec: join(dir, "arch.spec.md"),
    openapi: join(dir, "openapi.yaml"),
    asyncapi: join(dir, "asyncapi.yaml"),
  };
}

export function landscapePath(docsDir: DocsDir): string {
  return join(docsDir, "architecture", "landscape.likec4");
}

/** The fleet's authorization vocabulary — beside the fleet map, for the same reason. */
export function permissionsPath(docsDir: DocsDir): string {
  return join(docsDir, "architecture", "permissions.yaml");
}

/**
 * The GENERATED subsystem views — beside the fleet map because the LikeC4
 * renderer merges the whole `architecture/` project, and a view can only
 * `include` elements the landscape beside it defines. `loam subsystem sync`
 * owns the bytes (`core/repo/tree/views.ts` renders them); nothing in loam
 * ever parses the file, and staleness against the tree is a byte compare.
 */
export function subsystemViewsPath(docsDir: DocsDir): string {
  return join(docsDir, "architecture", "subsystems.likec4");
}

export function featuresDir(docsDir: DocsDir): string {
  return join(docsDir, "features");
}

/**
 * The root of the tree that IS the fleet — where an unfiled service and a
 * root-level subsystem both sit. The `subsystem` verbs join validated names
 * under it; the enumerating walk spells the same join for itself
 * (`repo/tree/walk.ts`), because it cannot import this module.
 */
export function servicesDir(docsDir: DocsDir): string {
  return join(docsDir, "services");
}

/**
 * The agent contract's filename, and where it sits in a docs repo.
 *
 * Both spellings are exported because the two questions are different: `init`,
 * `doctor` and `validate` want a path under a docsDir they already hold, while
 * `docs.ts` builds the scaffold as `[relative path, bytes]` pairs and needs the
 * bare name. Four modules spelled the literal out for themselves, and one of
 * them — `init` — uses it to decide whether a directory IS a docs repo at all,
 * so a rename that reached three of the four would leave `init` recognising a
 * file nothing else writes any more.
 *
 * `openspec-inventory.ts`'s "AGENTS.md" is deliberately NOT this constant: it
 * names a file in a foreign OpenSpec tree that happens to share the name.
 */
export const AGENTS_FILENAME = "AGENTS.md";

export function agentsPath(docsDir: DocsDir): string {
  return join(docsDir, AGENTS_FILENAME);
}

/**
 * Where shipped features live. `features/archive/` is spelled here and nowhere
 * else for the same reason every other artifact path is: `archive` and
 * `unarchive` move directories in and out of it, and a layout string that two
 * commands re-derive is a layout two commands can disagree about. The
 * `features/archive/…` strings in refusal PROSE are not this path — they are
 * what a reader types into `ls`, and they stay spelled out.
 */
export function archiveDir(docsDir: DocsDir): string {
  return join(featuresDir(docsDir), ARCHIVE_DIR);
}
