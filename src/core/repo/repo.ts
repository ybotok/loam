/**
 * Read model of the docs repo — enumeration, and only by the filesystem.
 *
 * Files are the source of truth, so `services/` IS the list of services and
 * there is no manifest that can disagree with it. The shapes this hands back
 * live in `entries.ts`, the layout it walks in `paths.ts`, and whether there is
 * a repo to walk at all in `state.ts`.
 */
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  contentStamp,
  listField,
  movedUnderVouch,
  readFrontmatter,
  stringField,
  type Frontmatter,
} from "../document/frontmatter.js";
import type { FleetContext } from "../fleet-context.js";
import { featureDirOf, type DocsDir, type FeatureDir } from "../kernel/ids/dirs.js";
import { rawServiceId, serviceIdProblem, type RawServiceId } from "../kernel/ids/service.js";
import { readVouchScope } from "../provenance/sample/scope.js";
import { compareIds, featureIdFromDirName, type FeatureEntry, type ServiceEntry } from "./entries.js";
import {
  ARCHIVE_DIR,
  featurePaths,
  featuresDir,
  fleetAdrsDir,
  isServiceArtifactName,
  servicePathsAt,
  SPEC_AXES,
} from "./paths.js";
import { requireDocsRepo } from "./state.js";
import { countMarkdown, entryIs } from "./tree/fs.js";
import { walkServicesTree, type FleetTree } from "./tree/walk.js";

/* ------------------------------------------------------------------ */
/* Enumeration                                                         */
/* ------------------------------------------------------------------ */

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

/** Services a feature carries a delta for, ordered — the subdirs of its specs/. */
export async function featureSpecServices(
  featureDir: FeatureDir,
  context?: FleetContext,
): Promise<RawServiceId[]> {
  if (context !== undefined) return context.featureSpecServices(featureDir);
  return (await subdirs(featurePaths(featureDir).specsDir)).map(rawServiceId);
}

/**
 * The classified `services/` tree — services at any depth, the subsystems
 * grouping them, and the walk's own findings (`subsystem.*`). The walk itself
 * lives in `./tree/walk.ts` and never imports back into this package; this
 * function is where its two injected dependencies are built — the docs-repo
 * precondition and the artifact-name table `paths.ts` owns.
 */
export async function listFleetTree(docsDir: DocsDir, context?: FleetContext): Promise<FleetTree> {
  if (context !== undefined) return context.fleetTree(docsDir);
  requireDocsRepo(docsDir, ["ok"]);
  return walkServicesTree({ docsDir, isServiceArtifact: isServiceArtifactName });
}

/** Every service in the docs repo, at any depth of the tree, ordered by id. */
export async function listServices(docsDir: DocsDir, context?: FleetContext): Promise<ServiceEntry[]> {
  if (context !== undefined) return context.listServices(docsDir);
  return serviceEntries(await listFleetTree(docsDir));
}

/**
 * The full entries for a walked tree — frontmatter, artifact presence, ADR
 * count. Split from `listServices` so `FleetContext` can derive its services
 * memo from its tree memo: one walk per invocation answers both questions.
 * Ordering is `compareIds` over the id wherever the service sits — placement
 * is never part of any identity, and `--json` consumers diff this order — with
 * the directory as the tiebreak so a duplicated id (its own error finding)
 * still lists deterministically.
 */
/**
 * The second spec axis's header, or an empty one when nobody could read it.
 *
 * `readFrontmatter` folds a decode failure into a flag but still THROWS when
 * the path exists and cannot be read as a file at all — a directory named
 * `arch.spec.md`, which test/gate-command.test.ts builds on purpose. This is
 * the fleet ENUMERATION, where one service's bad byte must cost one subject
 * and not the listing of the other 119, so the throw stops here.
 *
 * The distinction between "no scope" and "nobody could look" is not lost by
 * swallowing it: a path that exists and cannot be read is `service.unreadable`
 * — an ERROR that fails `loam validate` and `loam gate` — which is a louder
 * signal than any row of a listing, and it names the file this cannot.
 */
async function archHeader(path: string): Promise<Frontmatter> {
  try {
    return await readFrontmatter(path);
  } catch {
    return { present: false, malformed: false, data: {}, body: "" };
  }
}

/**
 * The spec files whose body moved under their vouch — `content.stale`'s
 * question, asked through the one predicate `loam validate` grades with
 * (`movedUnderVouch`) so the fleet listing and the finding cannot disagree
 * about one file. Only a header that carries a stamp (`contentStamp`) costs the
 * second read: the frontmatter read already answered whether there is anything
 * to compare, and on a fleet mid-adoption most headers do not. The body is
 * read exactly as the finding reads it, as UTF-8 text, because the stamp is
 * exact over everything but line endings.
 */
async function filesMovedUnderVouch(
  axes: readonly { file: string; path: string; header: Frontmatter }[],
): Promise<string[]> {
  const moved = await Promise.all(
    axes.map(async ({ file, path, header }) =>
      contentStamp(header) !== undefined && movedUnderVouch(header, await readFile(path, "utf8")) ? [file] : [],
    ),
  );
  return moved.flat();
}

/**
 * `ServiceEntry.adoption`, read off one living spec.md's frontmatter — the one
 * spelling of the marker's test, for the enumeration below and for the adopt
 * brief, which must not call a partial adoption finished. Any value but
 * `partial` reads as absent (SCHEMA.md).
 */
export function adoptionOf(fm: Frontmatter): "partial" | null {
  return stringField(fm, "adoption") === "partial" ? "partial" : null;
}

/** `adoptionOf` for a spec.md by path; an absent file is no marker. */
export async function specAdoption(specPath: string): Promise<"partial" | null> {
  return adoptionOf(await readFrontmatter(specPath));
}

export async function serviceEntries(tree: FleetTree): Promise<ServiceEntry[]> {
  const entries = await Promise.all(
    tree.services.map(async (svc): Promise<ServiceEntry> => {
      const p = servicePathsAt(svc.dir);
      // Both spec axes, because a sample is per FILE: one `--sample 3` run can
      // read a short spec.md in full and stamp a scope on a long arch.spec.md
      // beside it, and a fleet row that reported only spec.md's header would
      // print that service as fully vouched while `loam validate` reported it
      // sampled. `readFrontmatter` answers "absent" for a file that is not
      // there, so a service without the second axis pays one existsSync.
      const [fm, archFm] = await Promise.all([readFrontmatter(p.spec), archHeader(p.archSpec)]);
      const headers = { spec: fm, archSpec: archFm };
      const idProblem = serviceIdProblem(svc.id, "directory name");
      return {
        id: svc.id,
        dir: svc.dir,
        subsystem: svc.subsystem,
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
        adoption: adoptionOf(fm),
        sources: {
          declared: listField(fm, "sources").length > 0,
          stamped: stringField(fm, "sources_digest") !== undefined,
        },
        // Either axis makes the SERVICE sampled, and presence is the test, not
        // decodability: an unreadable scope is still a stamped partial read
        // (core/provenance/sample/scope.ts's `readVouchScope`), and the fleet
        // listing is the last place a mangled field should be able to buy
        // itself a full-trust row.
        vouchScope: [fm, archFm].some((header) => readVouchScope(header).kind !== "none") ? "sampled" : null,
        // Both axes again, for the scope's reason: a stamp is per FILE, and an
        // arch.spec.md edited under its vouch is a service part of whose
        // documentation nobody has re-read.
        contentStale: await filesMovedUnderVouch(
          SPEC_AXES.map((axis) => ({ file: axis.file, path: p[axis.key], header: headers[axis.key] })),
        ),
      };
    }),
  );
  return entries.sort((a, b) => compareIds(a.id, b.id) || compareIds(a.dir, b.dir));
}

/**
 * How many fleet-level ADRs `architecture/adrs/` holds — the same number, by the
 * same rule (`countMarkdown`), that `ServiceEntry.adrs` carries one altitude
 * down. One shape for one question: a second spelling of "count the decisions"
 * is how `list` and `show` once reported different ADR counts for one service.
 *
 * A count and never a finding. The directory is optional, an absent one is 0,
 * and nothing in loam grades either — see `fleetAdrsDir` for why that is the
 * whole design rather than an unfinished half of it. No `FleetContext` overload:
 * one caller asks this once per invocation, and a memo whose key is the docsDir
 * would be a cache nobody reads twice.
 */
export async function fleetAdrCount(docsDir: DocsDir): Promise<number> {
  return countMarkdown(fleetAdrsDir(docsDir));
}

/**
 * What a feature is CALLED, for a person: intent.md's `title:`, else its first
 * `# ` heading with the feature id peeled off the front, else null.
 *
 * Every row that names a feature used to print the id alone, and an id is a
 * key, not a name — a newcomer looking at `ready  FEAT-101` could not tell
 * which change it was without opening the directory. Read on demand rather
 * than carried on `FeatureEntry`, because the enumeration runs under every
 * command and only the views a person reads need the words. A missing or
 * unreadable intent.md is simply no title: the row still prints its id, and
 * whether intent.md is owed is `status`'s question, not this one's.
 */
export async function featureTitle(feature: FeatureEntry): Promise<string | null> {
  let fm: Frontmatter;
  try {
    fm = await readFrontmatter(featurePaths(feature.dir).intent);
  } catch {
    // A directory in intent.md's place, a permission: unreadable is no title.
    // `readFrontmatter` folds only the encoding failure into a flag, and before
    // this read the views that print a title never opened intent.md at all —
    // so letting the error escape would hand `loam status` and `loam list`
    // whole to `repository-unavailable` over a label. Whether intent.md is
    // fine is the intent row's and `validate`'s question.
    return null;
  }
  const declared = stringField(fm, "title")?.trim();
  if (declared !== undefined && declared !== "") return declared;
  const heading = fm.body.split(/\r?\n/).find((l) => l.startsWith("# "));
  if (heading === undefined) return null;
  const words = heading.slice(2).trim();
  const bare = words.startsWith(feature.id) ? words.slice(feature.id.length).replace(/^[\s:—–-]+/, "") : words;
  return bare === "" ? null : bare;
}

async function readFeature(dir: FeatureDir, dirName: string, archived: boolean): Promise<FeatureEntry> {
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
  docsDir: DocsDir,
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
  // Branded at the join: the name came off this readdir, onto the features
  // root it was listed under — the provenance `FeatureDir` records.
  const out = await Promise.all(active.map((n) => readFeature(featureDirOf(join(root, n)), n, false)));

  if (opts.includeArchived) {
    const archiveRoot = join(root, ARCHIVE_DIR);
    const archived = await subdirs(archiveRoot);
    out.push(...(await Promise.all(archived.map((n) => readFeature(featureDirOf(join(archiveRoot, n)), n, true)))));
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
 * order this replaces; `featureCandidates` returns every one of them, for a
 * caller that must see the tie (`loam status` names the colliding directories).
 */
export async function resolveFeature(
  docsDir: DocsDir,
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
  docsDir: DocsDir,
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
 * The message for an exclude-mode miss. When the feature exists under
 * `features/archive/`, "no feature" is a lie the caller would have to debug —
 * the honest answer is "already archived", plus how to look at it. The `--json`
 * code stays `unknown-target` either way: the target is unknown to the command
 * that asked, and the prose carries the diagnosis.
 */
export async function missingFeatureMessage(
  docsDir: DocsDir,
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
