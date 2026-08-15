/**
 * Read model of the docs repo — enumeration, and only by the filesystem.
 *
 * Files are the source of truth, so `services/` IS the list of services and
 * there is no manifest that can disagree with it. The shapes this hands back
 * live in `entries.ts`, the layout it walks in `paths.ts`, and whether there is
 * a repo to walk at all in `state.ts`.
 */
import { existsSync, statSync, type Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { listField, readFrontmatter, stringField } from "../document/frontmatter.js";
import type { FleetContext } from "../fleet-context.js";
import { rawServiceId, serviceIdProblem, type RawServiceId } from "../kernel/ids.js";
import type { Finding } from "../vocabulary/report.js";
import { compareIds, featureIdFromDirName, type FeatureEntry, type ServiceEntry } from "./entries.js";
import { ARCHIVE_DIR, featurePaths, featuresDir, servicePaths } from "./paths.js";
import { requireDocsRepo } from "./state.js";

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
): Promise<RawServiceId[]> {
  if (context !== undefined) return context.featureSpecServices(featureDir);
  return (await subdirs(featurePaths(featureDir).specsDir)).map(rawServiceId);
}

/** Every service in the docs repo, ordered by id. */
export async function listServices(docsDir: string, context?: FleetContext): Promise<ServiceEntry[]> {
  if (context !== undefined) return context.listServices(docsDir);
  requireDocsRepo(docsDir, ["ok"]);
  // Branded at the readdir, not at the entry: everything below this line —
  // servicePaths first — deals in names the enumeration produced.
  const names = (await subdirs(join(docsDir, "services"))).map(rawServiceId);
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
          asyncapi: existsSync(p.asyncapi),
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
    services: (await subdirs(p.specsDir)).map(rawServiceId),
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
