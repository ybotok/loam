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
 * The living artifact filenames, as one table, because three questions read
 * them: `servicePathsAt` below spells the paths, the tree walk classifies
 * a directory as a service by whether any of these names sit in it, and
 * `core/diff/base-state.ts` classifies the SAME way over a base git ref's
 * tree listing (exported for that reader — a filename respelled there would
 * be the drift this table exists to prevent). The walk cannot import this
 * module — `repo → repo/tree` is the package direction, and an edge back
 * would be the cycle `scripts/package-graph.mjs` refuses — so `repo.ts`
 * injects `isServiceArtifactName` into the walk request instead.
 */
export const ARTIFACT_FILES = {
  model: "model.likec4",
  spec: "spec.md",
  archSpec: "arch.spec.md",
  openapi: "openapi.yaml",
  asyncapi: "asyncapi.yaml",
  runbook: "runbook.md",
  health: "health.yaml",
  steps: "steps.yaml",
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
  /**
   * The step catalogue — which phrases this service's suite has DECIDED to
   * define. Authored and opt-in; its CONTENTS are read by `loam steps` alone and
   * nothing in `validate` consults them
   * (`core/gherkin/steps/catalogue.ts` records why).
   *
   * Its EXISTENCE is read more widely, and that is not the same statement: the
   * filename is in `ARTIFACT_FILES`, so `isServiceArtifactName` classifies it
   * and the tree walk treats a directory holding one as a service. That is
   * correct — it is a service artifact — and it is worth writing down, because
   * it means a `steps.yaml` written at the wrong path mints a service.
   */
  steps: string;
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
    steps: join(dir, ARTIFACT_FILES.steps),
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
  return join(docsDir, "architecture", LANDSCAPE_FILE);
}

/** The fleet's authorization vocabulary — beside the fleet map, for the same reason. */
export function permissionsPath(docsDir: DocsDir): string {
  return join(docsDir, "architecture", "permissions.yaml");
}

/** The fleet's capability vocabulary — beside the other two fleet documents, for the same reason. */
export function capabilitiesPath(docsDir: DocsDir): string {
  return join(docsDir, "architecture", "capabilities.yaml");
}

/**
 * The fleet's ARCHITECTURAL OBLIGATION vocabulary — beside the landscape it tags
 * and the two vocabularies it sits with, for their reason: it is a fact about
 * the fleet that no single service owns.
 */
export function obligationsPath(docsDir: DocsDir): string {
  return join(docsDir, "architecture", "obligations.yaml");
}

/**
 * The FLEET's decision records — `architecture/adrs/`, beside the landscape and
 * the two vocabularies.
 *
 * ADRs used to exist at two altitudes only, `services/<id>/adrs/` and
 * `features/<FEAT>/adrs/`, so a decision about the fleet itself — "event
 * publishers use a transactional outbox", "cross-service calls carry a circuit
 * breaker" — had no home but one arbitrary service's directory, where the next
 * reader of the other fifty services never finds it. This is not a new axis: it
 * is the same `ADRS_DIR` name one level up, spelled through the same constant so
 * the two altitudes cannot drift into `adrs/` and `decisions/`.
 *
 * PRESENCE-TRACKED AND NOTHING MORE, exactly like the service directory it
 * mirrors: `loam list` counts the files (`repo.ts`'s `fleetAdrCount`) and no
 * check anywhere reads one. A fleet with no fleet-level ADRs owes nothing and
 * must produce no finding — which is also why `loam init` does NOT scaffold the
 * directory. git does not carry an empty one, so it would vanish on the first
 * clone and come back as a diff on the next `init`; and an empty `adrs/` in a
 * fresh repo reads as an obligation nobody has met, when there is no obligation
 * at all.
 */
export function fleetAdrsDir(docsDir: DocsDir): string {
  return join(docsDir, "architecture", ADRS_DIR);
}

/**
 * The GENERATED subsystem views — beside the fleet map because the LikeC4
 * renderer merges the whole `architecture/` project, and a view can only
 * `include` elements the landscape beside it defines. `loam subsystem sync`
 * owns the bytes (`core/repo/tree/render/views.ts` renders them); nothing in loam
 * ever parses the file, and staleness against the tree is a byte compare.
 */
export function subsystemViewsPath(docsDir: DocsDir): string {
  return join(docsDir, "architecture", SUBSYSTEM_VIEWS_FILE);
}

/** The generated views' file name, spelled once because the reservation below reads it too. */
const SUBSYSTEM_VIEWS_FILE = "subsystems.likec4";

/**
 * Names inside `architecture/` that LOAM owns, and what goes wrong if a
 * feature's own document claims one.
 *
 * `features/<FEAT>/deployment/<name>.likec4` merges as a whole-file copy
 * straight into `architecture/` — unlike a flow, which lands under
 * `usecases/` — so its `<name>` is free to be any of these, and two of them
 * fail in ways nothing downstream would report:
 *
 *  - `subsystems.likec4` is GENERATED and is EXCLUDED from every project load
 *    (docs/DESIGN.md rule 26 keeps it a byte compare), so topology landing
 *    there is invisible to loam from the moment it archives — and the next
 *    `loam subsystem sync` overwrites the file wholesale. Silent both ways,
 *    which is the worst shape a failure can have;
 *  - `landscape.likec4` is the living map the archive SPLICES; a whole-file
 *    copy over it would discard the fleet;
 *  - `usecases/` is the flow tree, walked by the use-case scan. A deployment
 *    document filed there parses (one project) and is then looked for by a
 *    reader asking a different question.
 *
 * Returns the reason, or null when the name is the author's to choose. Takes
 * the `/`-separated rel a directory walk produced, never a string from argv.
 */
export function reservedArchitectureName(rel: string): string | null {
  const parts = rel.split("/");
  if (parts[0] === USECASE_DIR) {
    return `\`${USECASE_DIR}/\` is the use-case tree — a flow belongs in \`features/<FEAT>/usecases/\`, which merges there`;
  }
  if (rel === SUBSYSTEM_VIEWS_FILE) {
    return "`subsystems.likec4` is generated by `loam subsystem sync`, which overwrites it wholesale — and nothing in loam ever parses it, so anything landing there is invisible from the moment it archives";
  }
  if (rel === LANDSCAPE_FILE) {
    return "`landscape.likec4` is the living fleet map, which the archive SPLICES into rather than replaces";
  }
  return null;
}

/** The living map's file name, and the flow tree's directory — spelled once, read by the reservation. */
const LANDSCAPE_FILE = "landscape.likec4";
const USECASE_DIR = "usecases";

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

/**
 * The LikeC4 project file — the one thing in a docs repo loam writes for a
 * tool other than itself — and it lives at two altitudes.
 *
 * At the ROOT, `loam init --create` writes the project `fleet`, scoped to
 * `architecture/` (`core/docs.ts` composes those bytes). Beside each
 * `services/<…>/<id>/model.likec4`, `loam subsystem sync` writes a project of
 * the service's own: loam parses every `.likec4` file ALONE, so each model
 * declares its own `specification` block and the root project must exclude
 * `services/**` — which left every adopted service a box on the fleet map with
 * nothing renderable inside it, in the renderer opened at the docs root.
 * `core/repo/tree/render/projects.ts` composes the per-service bytes and
 * records what was measured.
 *
 * Spelled here and NOT in `ARTIFACT_FILES`, and the distinction is
 * load-bearing: a filename in that table classifies a directory as a service,
 * and this file is the renderer's — a stray one must mint nothing. The root's
 * NAME sits beside the filename because the per-service rule needs it too (a
 * service id equal to the root project's name would be silently renamed by
 * the renderer), and two spellings of the word are how the scaffold and the
 * rule drift apart.
 */
export const LIKEC4_PROJECT_FILENAME = "likec4.config.json";

/** The root project's name, exactly as `loam init --create` scaffolds it. */
export const LIKEC4_ROOT_PROJECT = "fleet";

export function rootProjectPath(docsDir: DocsDir): string {
  return join(docsDir, LIKEC4_PROJECT_FILENAME);
}

/**
 * The two files the per-service project question is asked of — the model that
 * needs rendering and the project file that renders it — in one spelling for
 * the writer (`subsystem sync`) and the grader (`validate --all`) alike. Handed
 * INTO `render/projects.ts` rather than imported there, because that package
 * cannot import this module: `render/stale.ts` records the cycle.
 */
export function serviceRenderPaths(dir: ServiceDir): { model: string; project: string } {
  return { model: join(dir, ARTIFACT_FILES.model), project: join(dir, LIKEC4_PROJECT_FILENAME) };
}
