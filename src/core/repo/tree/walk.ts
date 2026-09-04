/**
 * The tree read model: three-way classification of everything under
 * `services/`, in one walk.
 *
 * A directory holding `subsystem.yaml` is a SUBSYSTEM and is walked; one
 * holding any service artifact is a SERVICE and is not walked deeper — unless
 * a marker sits BESIDE the artifacts, where the walk descends anyway (the
 * marker says a group was here, and its members must not vanish); one holding
 * neither while containing subdirectories is an ERROR that still names every
 * service found beneath it. The third branch is the whole point:
 * two-way classification loses a service silently on an ordinary clean merge —
 * one branch deletes an emptied subsystem's marker while another moves a
 * service into it, and the group directory is then read as a service whose
 * real services vanish from the fleet with no finding. No directory under
 * `services/` may ever be reinterpreted as a different kind without saying so,
 * and the fleet is never reported smaller: the walk descends into the broken
 * group precisely so the stranded services stay enumerated and named.
 *
 * The package direction is `repo → repo/tree`, never back. That is why the
 * artifact-name question arrives INJECTED (`TreeWalkRequest.isServiceArtifact`
 * — `repo/paths.ts` owns the spellings and `repo/repo.ts` builds the request):
 * importing `paths.ts` from here while `repo.ts` delegates its enumeration to
 * this walk would close the exact package cycle `scripts/package-graph.mjs`
 * exists to refuse.
 *
 * A SERVICE'S OWN SUBDIRECTORIES ARE NEVER CLASSIFIED (`RESERVED_INTERIOR`).
 * That is a different question from `isServiceArtifact`, which asks whether a
 * name makes the directory holding it a service; this asks whether a child
 * directory may be READ as one at all, and the two answers diverged the moment
 * SCHEMA's service layout grew a slot the artifact table does not carry. A
 * `services/<svc>/` holding only the documented `usecases/` flow directory was
 * classified as a group: the walk descended, filed `usecases` as a service, and
 * one `loam validate --all` reported `subsystem.unmarked`,
 * `landscape.service-unmodelled` for `services/<svc>/usecases/` and
 * `landscape.binding-unknown` for the real service — three errors whose text
 * says the fleet is losing services, earned by following the instruction `loam
 * init` had just scaffolded (verification 2026-09-04). The names are SCHEMA's
 * service layout, and a directory named for one is service interior wherever it
 * sits, so no branch of the classification descends into one.
 *
 * Cost: exactly one readdir per directory walked, service directories included
 * (their own listing is what classifies them), plus one realpath per directory
 * for the symlink-cycle guard — `entryIs` follows symlinks on purpose, and a
 * followed cycle without the visited-set is an unbounded recursion.
 */
import { realpathSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { serviceDirOf, serviceTreePath, type DocsDir, type ServiceDir } from "../../kernel/ids/dirs.js";
import { rawServiceId, type RawServiceId } from "../../kernel/ids/service.js";
import { subsystemNameProblem } from "../../kernel/ids/subsystem.js";
import type { Finding } from "../../vocabulary/report.js";
import { entryIs } from "./fs.js";
import { readSubsystemMarker, SUBSYSTEM_MARKER, type SubsystemMeta } from "./marker.js";

/**
 * The subdirectory names SCHEMA's service layout reserves for a service's own
 * interior (`SCHEMA.md`, "services/<svc>/"): `adrs/` the decisions, `usecases/`
 * the flows drawn over its containers, `ui/` the page-specs. A directory with
 * one of these names is never a service and never a subsystem — it is inside
 * one — so the walk neither classifies it nor counts it as a subdirectory that
 * makes its parent a group.
 *
 * Kept here rather than folded into `isServiceArtifact` because the two
 * questions are not the same one: `adrs/` answers both (it is an artifact AND
 * interior) and `usecases/` answers only this one today. Widening the injected
 * artifact table instead would also make a lone `usecases/` classify its parent
 * as a service by ARTIFACT, which hides a real service filed beside it — the
 * silent shrink this module refuses.
 *
 * Exported for the one other reader of this rule: `core/diff/base-state.ts`
 * classifies a base git ref's tree listing, which no walk can readdir, and its
 * banner already commits it to restating this module's branches rather than
 * inventing its own. It shares the SET for the reason it shares the artifact
 * table — a name respelled there is the drift both modules are written to
 * avoid.
 */
export const RESERVED_INTERIOR: ReadonlySet<string> = new Set(["adrs", "usecases", "ui"]);

export interface WalkedService {
  id: RawServiceId;
  dir: ServiceDir;
  /**
   * Names of the directories between `services/` and the service, outermost
   * first. Empty = unfiled — directly under `services/`, which is permanent,
   * normal and SILENT. For a service stranded under an unmarked group the
   * chain still records the physical placement: the path is a fact even while
   * `subsystem.unmarked` says the grouping is broken.
   */
  subsystem: string[];
}

export interface SubsystemEntry {
  /** The directory name — the subsystem's name in the flat namespace. */
  name: string;
  /** Names from `services/` down to and including this one. */
  path: string[];
  /** Absolute path of the subsystem directory. */
  dir: string;
  meta: SubsystemMeta;
}

export interface FleetTree {
  services: WalkedService[];
  subsystems: SubsystemEntry[];
  findings: Finding[];
}

export interface TreeWalkRequest {
  docsDir: DocsDir;
  /** Does this entry name a service artifact? `repo/paths.ts`'s table, injected — the module doc says why. */
  isServiceArtifact: (name: string, kind: "file" | "dir") => boolean;
}

interface WalkContext {
  request: TreeWalkRequest;
  tree: FleetTree;
  /** Realpaths already DESCENDED into — the symlink-cycle guard. */
  visited: Set<string>;
  /** Every name in the flat namespace → the directories that claim it. */
  names: Map<string, string[]>;
}

/** One directory the walk is looking at: where it is, and how it is reached. */
interface Spot {
  dir: string;
  name: string;
  /** Directory names between `services/` and this one, outermost first. */
  chain: string[];
}

export async function walkServicesTree(request: TreeWalkRequest): Promise<FleetTree> {
  const ctx: WalkContext = {
    request,
    tree: { services: [], subsystems: [], findings: [] },
    visited: new Set(),
    names: new Map(),
  };
  const root = join(request.docsDir, "services");
  guardDescent(root, ctx);
  for (const name of await subdirNames(root)) {
    await visitDir({ dir: join(root, name), name, chain: [] }, ctx);
  }
  namespaceFindings(ctx);
  return ctx.tree;
}

/**
 * Mark a directory as descended-into; false when it (or another name for it)
 * already was. Guards SUBTREES, not entries: a directory reachable under two
 * names is classified twice — both names exist and hiding the second would be
 * the silent shrink this module refuses — but its children are enumerated
 * once, so a symlink cycle terminates instead of recursing forever. A path
 * realpath cannot resolve is one whose children cannot be read either.
 */
function guardDescent(dir: string, ctx: WalkContext): boolean {
  let real: string;
  try {
    real = realpathSync(dir);
  } catch {
    return false;
  }
  if (ctx.visited.has(real)) return false;
  ctx.visited.add(real);
  return true;
}

/** Sorted non-dot subdirectory names — the walk's deterministic child order. */
async function subdirNames(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  return entries.filter((e) => !e.name.startsWith(".") && entryIs(dir, e, "dir")).map((e) => e.name).sort();
}

/** Classify one directory and, for the group kinds, walk what is inside it. */
async function visitDir(spot: Spot, ctx: WalkContext): Promise<void> {
  const rel = ["services", ...spot.chain, spot.name].join("/");
  const entries = (await readdir(spot.dir, { withFileTypes: true })).filter((e) => !e.name.startsWith("."));
  const files = entries.filter((e) => entryIs(spot.dir, e, "file")).map((e) => e.name);
  const all = entries.filter((e) => entryIs(spot.dir, e, "dir")).map((e) => e.name).sort();
  // The classifiable children — a service's own interior removed once, here, so
  // every branch below agrees about it (see `RESERVED_INTERIOR`). `all` is still
  // what the artifact probe reads: `adrs/` makes its parent a service, and
  // `usecases/` is interior the parent may hold without becoming a group.
  const dirs = all.filter((d) => !RESERVED_INTERIOR.has(d));
  const marker = files.includes(SUBSYSTEM_MARKER);
  const artifact =
    files.some((f) => ctx.request.isServiceArtifact(f, "file")) ||
    all.some((d) => ctx.request.isServiceArtifact(d, "dir"));

  if (marker && artifact) {
    // Artifacts win the classification: the documents are somebody's work and
    // the marker is one stray file, so the directory stays an addressable
    // service and the finding names the contradiction instead of the walk
    // quietly picking a reading. But the walk STILL descends (the module
    // invariant: no reinterpretation may shrink the fleet) — the marker says
    // a GROUP was here, and returning without walking made every service
    // beneath it vanish with only this finding to hint why. Child directories
    // that are themselves artifacts (`adrs/`) are service interior, not walked.
    recordService(spot, ctx);
    const stranded = await descendInto(spot, dirs.filter((d) => !ctx.request.isServiceArtifact(d, "dir")), ctx);
    ctx.tree.findings.push({
      severity: "error",
      code: "subsystem.marker-misplaced",
      subject: spot.name,
      message:
        `${rel}/ holds ${SUBSYSTEM_MARKER} BESIDE service artifacts — a directory is a subsystem or a service, never both. ` +
        `It stays classified as a service; delete ${rel}/${SUBSYSTEM_MARKER}, ` +
        `or move the artifacts into a service directory of their own inside the group.` +
        (stranded.length > 0 ? ` ${stranded.length} service(s) beneath it stay enumerated meanwhile: ${stranded.map((s) => s.id).join(", ")}.` : ""),
      ...(stranded.length > 0 ? { details: stranded.map(serviceTreePath) } : {}),
    });
    return;
  }
  if (marker) {
    await visitSubsystem(spot, { rel, dirs }, ctx);
    return;
  }
  if (artifact) {
    recordService(spot, ctx);
    return;
  }
  if (dirs.length > 0) {
    await visitUnmarked(spot, { rel, dirs }, ctx);
    return;
  }
  // Neither marker nor artifact, and nothing beneath: today's flat behaviour —
  // an empty (or not-yet-adopted) directory under services/ is a service.
  recordService(spot, ctx);
}

function recordService(spot: Spot, ctx: WalkContext): void {
  ctx.tree.services.push({
    id: rawServiceId(spot.name),
    dir: serviceDirOf(spot.dir),
    subsystem: spot.chain,
  });
  claimName(spot, ctx);
}

/** A subsystem: record it, report a broken marker or an illegal name, walk in. */
async function visitSubsystem(spot: Spot, at: { rel: string; dirs: string[] }, ctx: WalkContext): Promise<void> {
  const meta = await readSubsystemMarker(join(spot.dir, SUBSYSTEM_MARKER));
  if (meta.invalid !== undefined) {
    // Exactly one finding per marker file: presence already classified the
    // directory, so the content failure is metadata, not identity.
    ctx.tree.findings.push({
      severity: "error",
      code: "subsystem.invalid",
      subject: at.rel,
      message:
        `${at.rel}/${SUBSYSTEM_MARKER} cannot be read as subsystem metadata — ${meta.invalid}. ` +
        `The directory still counts as a subsystem (presence classifies; content is metadata). ` +
        `Fix the file: a YAML mapping with optional title, description and owner — an empty file is also a valid marker.`,
    });
  }
  const problem = subsystemNameProblem(spot.name, "subsystem directory name");
  if (problem !== null) {
    // Walked anyway, mirroring how an illegal service id stays enumerated
    // (`idProblem`): the directory exists and hiding its subtree would shrink
    // the fleet over a naming mistake.
    ctx.tree.findings.push({
      severity: "error",
      code: "subsystem.name-invalid",
      subject: spot.name,
      message: `${at.rel}/ — ${problem} Rename the directory; its services stay enumerated meanwhile.`,
    });
  }
  ctx.tree.subsystems.push({
    name: spot.name,
    path: [...spot.chain, spot.name],
    dir: spot.dir,
    meta,
  });
  claimName(spot, ctx);
  await descendInto(spot, at.dirs, ctx);
}

/**
 * Walk the children of a group directory (symlink-cycle guarded), returning
 * the services newly recorded beneath it — the ONE spelling of descent, so
 * the three descending branches agree about the guard and the chain.
 */
async function descendInto(spot: Spot, dirs: string[], ctx: WalkContext): Promise<WalkedService[]> {
  const before = ctx.tree.services.length;
  if (guardDescent(spot.dir, ctx)) {
    for (const child of dirs) {
      await visitDir({ dir: join(spot.dir, child), name: child, chain: [...spot.chain, spot.name] }, ctx);
    }
  }
  return ctx.tree.services.slice(before);
}

/**
 * The refusal branch — a group directory nothing marks. The walk STILL
 * descends, so the services beneath stay in the enumeration and the finding
 * can name them: the fleet must never be reported smaller than it is.
 */
async function visitUnmarked(spot: Spot, at: { rel: string; dirs: string[] }, ctx: WalkContext): Promise<void> {
  const stranded = await descendInto(spot, at.dirs, ctx);
  ctx.tree.findings.push({
    severity: "error",
    code: "subsystem.unmarked",
    subject: at.rel,
    message:
      `${at.rel}/ is neither a subsystem (no ${SUBSYSTEM_MARKER}) nor a service (no service artifact), ` +
      `but ${stranded.length} service(s) sit beneath it` +
      (stranded.length > 0 ? `: ${stranded.map((s) => s.id).join(", ")}. ` : `. `) +
      `Without the marker this directory would be read as a service and everything under it would vanish from the fleet — ` +
      `the shape an ordinary merge produces when one branch deletes an emptied subsystem's marker while another moves a service in. ` +
      `Restore ${at.rel}/${SUBSYSTEM_MARKER} (an empty file is a valid marker), or move the directories out.`,
    ...(stranded.length > 0 ? { details: stranded.map(serviceTreePath) } : {}),
  });
}

function claimName(spot: Spot, ctx: WalkContext): void {
  const rel = ["services", ...spot.chain, spot.name].join("/");
  ctx.names.set(spot.name, [...(ctx.names.get(spot.name) ?? []), rel]);
}

/**
 * One flat namespace: every subsystem name and service id, unique across the
 * whole tree at any depth, never colliding with each other. The identity
 * decision demands it — a service id is its leaf directory name ALONE, so two
 * leaves spelling one name are one identity claimed twice, wherever they sit.
 * One finding per name, naming every claimant, so the fix is a choice rather
 * than a scavenger hunt.
 */
function namespaceFindings(ctx: WalkContext): void {
  for (const [name, dirs] of [...ctx.names].sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (dirs.length < 2) continue;
    ctx.tree.findings.push({
      severity: "error",
      code: "subsystem.name-collision",
      subject: name,
      message:
        `'${name}' is claimed by ${dirs.length} directories in the services/ tree: ${dirs.join(", ")} — ` +
        `service ids and subsystem names share one flat namespace, unique at any depth, ` +
        `because a service's identity is its leaf directory name alone and placement never disambiguates it. ` +
        `Rename all but one.`,
      details: dirs,
    });
  }
}
