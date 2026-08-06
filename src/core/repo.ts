/**
 * Read model of the docs repo — the single place that knows its layout.
 *
 * Enumeration goes by the filesystem, and only by the filesystem: files are the
 * source of truth, so `services/` IS the list of services and there is no
 * manifest that can disagree with it. Every command that needs "which services
 * exist", "which features are in flight" or "where does artifact X live" asks
 * here, so the layout is spelled exactly once.
 */
import { existsSync, statSync, type Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { listField, readFrontmatter, stringField } from "./frontmatter.js";
import type { FleetContext } from "./fleet-context.js";
import { serviceIdProblem } from "./ids.js";
import type { Finding } from "./report.js";

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
 * Known ids within a small edit distance of `id`, closest first, at most three.
 *
 * The did-you-mean hint for a name somebody typed: `loam new --touches` and
 * `loam delta <svc>` answer the same mistake, and each carried its own copy of
 * these twenty-four lines. It belongs here because the ids being scored are
 * this module's ids — service directory names, feature ids — and because
 * `compareIds` right above is the tiebreak that keeps the list deterministic
 * when two candidates score equally. Not in `core/ids.ts`: `compareIds` lives
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

export function agentsPath(docsDir: string): string {
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
export function archiveDir(docsDir: string): string {
  return join(featuresDir(docsDir), ARCHIVE_DIR);
}

/* ------------------------------------------------------------------ */
/* Is there a docs repo there at all?                                  */
/* ------------------------------------------------------------------ */

/**
 * What is actually at `docsDir`. Three answers, because they point at three
 * different fixes and the enumeration below used to give all of them the same
 * one — an empty list:
 *
 *  - `missing`     — nothing there (or not a directory): `docsDir` in loam.json
 *                    is wrong, or the docs repo was never cloned;
 *  - `no-services` — a directory, but with no `services/`: it is some other
 *                    directory, most often the service repo itself after a typo;
 *  - `ok`          — a docs repo. `services/` may still be EMPTY, and that is a
 *                    legitimate state: a docs repo before the first `loam adopt`.
 *
 * "Empty fleet" and "wrong path" are the same output only if nobody asks this
 * question, and a green `loam list` over a docsDir that does not exist is worse
 * than a red one: it says the fleet is fine.
 */
export type DocsRepoKind = "missing" | "no-services" | "ok";

export interface DocsRepoState {
  kind: DocsRepoKind;
  /** The path examined, so a caller can quote it without re-deriving it. */
  path: string;
}

export function docsRepoState(docsDir: string): DocsRepoState {
  const path = docsDir;
  let isDir = false;
  try {
    isDir = statSync(path).isDirectory();
  } catch {
    isDir = false;
  }
  if (!isDir) return { kind: "missing", path };
  return { kind: existsSync(join(path, "services")) ? "ok" : "no-services", path };
}

/**
 * The docs repo is not there. Thrown rather than returned because every caller
 * of the enumeration wants the same thing — to stop — and a `[]` return is the
 * bug this closes. `message` is written for a human at a terminal: the CLI's
 * top-level handler prints it verbatim, and commands that catch it report
 * `repository-unavailable`.
 */
export class DocsRepoUnavailableError extends Error {
  constructor(
    readonly state: DocsRepoState,
    message: string,
  ) {
    super(message);
    this.name = "DocsRepoUnavailableError";
  }
}

/**
 * Refuse to enumerate a docs repo that is not one. `allow` names the states the
 * caller can honestly survive: features/ may be absent from a real docs repo
 * (nothing is in flight yet), so feature enumeration only insists the docs repo
 * EXISTS, while service enumeration insists it is shaped like a docs repo — a
 * `services/` directory is what makes it one.
 */
function requireDocsRepo(docsDir: string, allow: DocsRepoKind[]): void {
  const state = docsRepoState(docsDir);
  if (allow.includes(state.kind)) return;
  if (state.kind === "missing") {
    throw new DocsRepoUnavailableError(
      state,
      `The configured docs repo does not exist: ${state.path}. ` +
        "Fix `docsDir` in loam.json, clone the docs repo there, " +
        "or run `loam init --docs <dir> --create` to make a new one.",
    );
  }
  throw new DocsRepoUnavailableError(
    state,
    `${state.path} is not a docs repo — it has no services/ directory. ` +
      "Point `docsDir` in loam.json at the shared docs repo, " +
      "or run `loam init --docs <dir> --create` to make one.",
  );
}

/* ------------------------------------------------------------------ */
/* Enumeration                                                         */
/* ------------------------------------------------------------------ */

/**
 * What a directory entry IS, following a symlink to find out.
 *
 * `readdir(withFileTypes)` does not follow symlinks: for a symlink `Dirent`
 * every `isDirectory()`/`isFile()` is false, whatever it points at. That made a
 * symlinked `services/<id>/` or `features/<id>/` vanish from every enumeration
 * at once — `list`, `validate --all`, the fleet gate — with no diagnostic
 * anywhere, which is the one outcome a shared docs repo cannot survive: the
 * fleet gate reported a service that is not there as fine because it never saw
 * it. Composing a docs repo out of symlinks (a worktree, a submodule, one
 * service's directory shared between two checkouts) is legitimate, so they are
 * FOLLOWED rather than refused. A dangling link stats as nothing and is skipped
 * exactly as an absent directory is — it is not a service, and saying so would
 * mean inventing an entry to hang the complaint on.
 */
function entryIs(dir: string, e: Dirent, want: "dir" | "file"): boolean {
  if (!e.isSymbolicLink()) return want === "dir" ? e.isDirectory() : e.isFile();
  try {
    const s = statSync(join(dir, e.name));
    return want === "dir" ? s.isDirectory() : s.isFile();
  } catch {
    return false;
  }
}

/**
 * Sorted names of the real subdirectories of `dir` (dot-dirs and files skipped).
 * A missing `dir` is an empty list — the swallow is deliberate but narrow: it
 * only ever runs INSIDE a docs repo that `requireDocsRepo` has already
 * confirmed, where an absent `features/` or `specs/` means "none yet" and
 * nothing else.
 */
async function subdirs(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((e) => !e.name.startsWith(".") && entryIs(dir, e, "dir"))
    .map((e) => e.name)
    .sort(compareIds);
}

/**
 * Markdown files sitting directly in `dir` — the ADR count, and the only place
 * that rule is spelled. Exported because `show` kept a second copy that tested
 * `Dirent.isFile()` itself: always false for a symlink, whatever it points at,
 * so a docs repo composed of symlinks (the layout `entryIs` above exists to
 * support) had `loam list` and `loam show` reporting different ADR counts for
 * the same service. One rule, one answer.
 */
export async function countMarkdown(dir: string): Promise<number> {
  if (!existsSync(dir)) return 0;
  const entries = await readdir(dir, { withFileTypes: true });
  return entries.filter((e) => e.name.endsWith(".md") && entryIs(dir, e, "file")).length;
}

/** Services a feature carries a delta for, ordered — the subdirs of its specs/. */
export async function featureSpecServices(
  featureDir: string,
  context?: FleetContext,
): Promise<string[]> {
  if (context !== undefined) return context.featureSpecServices(featureDir);
  return subdirs(featurePaths(featureDir).specsDir);
}

/** Every service in the docs repo, ordered by id. */
export async function listServices(docsDir: string, context?: FleetContext): Promise<ServiceEntry[]> {
  if (context !== undefined) return context.listServices(docsDir);
  requireDocsRepo(docsDir, ["ok"]);
  const names = await subdirs(join(docsDir, "services"));
  return Promise.all(
    names.map(async (id): Promise<ServiceEntry> => {
      const p = servicePaths(docsDir, id);
      const fm = await readFrontmatter(p.spec);
      const idProblem = serviceIdProblem(id, "directory name");
      return {
        id,
        dir: p.dir,
        ...(idProblem === null ? {} : { idProblem }),
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

/**
 * The directories under `services/` that no loam command can address.
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
 * by its own `--service` guard before it gets here.
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
  context?: FleetContext,
): Promise<FeatureEntry[]> {
  if (context !== undefined) return context.listFeatures(docsDir, opts);
  // "no-services" is tolerated here on purpose: a docs repo whose services/ is
  // gone is broken, but it is `listServices` (and `loam doctor`) that says so.
  // Refusing here too would turn one diagnosis into two contradictory ones.
  requireDocsRepo(docsDir, ["ok", "no-services"]);
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
 * Matching is EXACT, on one of two spellings: the directory name as it is on
 * disk, or the canonical id derived from it. It used to also match any dirName
 * starting with `arg + "-"`, which made the argument a prefix query in
 * disguise: with FEAT-401 and FEAT-402 in flight, `loam archive FEAT` archived
 * whichever sorted first, and `loam delta billing` reached into
 * `billing-7-rewrite`. A destructive command must never pick a target the
 * caller did not name, so a prefix now resolves to nothing at all.
 *
 * An exact directory name still wins over the id spelling (`FEAT-5` the
 * directory over `FEAT-5-slug`, whose id is also `FEAT-5`), and under "include"
 * an active feature wins over an archived one. Ties among equally-exact
 * candidates go to the first by name — deterministic, unlike the raw readdir
 * order this replaces; `ambiguousFeatureMessage` lists them for the caller.
 */
export async function resolveFeature(
  docsDir: string,
  arg: string,
  archived: ArchivedPolicy,
  context?: FleetContext,
): Promise<FeatureEntry | null> {
  return (await featureCandidates(docsDir, arg, archived, context))[0] ?? null;
}

/**
 * Every feature the argument names exactly, best first. Split out of
 * `resolveFeature` so a caller that wants to REFUSE an ambiguous argument can
 * see the tie instead of inheriting the winner.
 */
export async function featureCandidates(
  docsDir: string,
  arg: string,
  archived: ArchivedPolicy,
  context?: FleetContext,
): Promise<FeatureEntry[]> {
  const all = await listFeatures(docsDir, { includeArchived: archived !== "exclude" }, context);
  return all
    .filter((f) => archived === "include" || f.archived === (archived === "only"))
    .filter((f) => f.dirName === arg || f.id === arg)
    .sort(
      (a, b) =>
        Number(b.dirName === arg) - Number(a.dirName === arg) ||
        Number(a.archived) - Number(b.archived) ||
        compareIds(a.dirName, b.dirName),
    );
}

/**
 * The message for an argument that names more than one feature — two directories
 * carrying the same id (`FEAT-6-aaa` and `FEAT-6-zzz`). `resolveFeature` still
 * picks one deterministically, but a command that is about to WRITE should say
 * which directories collided and make the caller spell one out.
 */
export function ambiguousFeatureMessage(arg: string, candidates: FeatureEntry[]): string {
  return (
    `'${arg}' names ${candidates.length} features: ${candidates.map((c) => c.dirName).join(", ")}. ` +
    "Pass the directory name you mean."
  );
}

/**
 * The message for an exclude-mode miss. When the feature exists under
 * `features/archive/`, "no feature" is a lie the caller would have to debug —
 * the honest answer is "already archived", plus how to look at it. The `--json`
 * code stays `unknown-target` either way: the target is unknown to the command
 * that asked, and the prose carries the diagnosis.
 */
export async function missingFeatureMessage(
  docsDir: string,
  arg: string,
  context?: FleetContext,
): Promise<string> {
  const shipped = await resolveFeature(docsDir, arg, "only", context);
  if (shipped !== null) {
    return (
      `Feature '${shipped.id}' is already archived (features/archive/${shipped.dirName}) — ` +
      `\`loam show ${shipped.id}\` reads it, \`loam unarchive ${shipped.id}\` re-opens it.`
    );
  }
  return `No feature '${arg}' under ${featuresDir(docsDir)}.`;
}
