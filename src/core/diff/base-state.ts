/**
 * The base side of `loam diff`: the fleet as the base commit held it, read
 * entirely out of git's object store (`./base-git.ts`) and parsed with the
 * SAME parsers the living files go through — `parseRequirements`,
 * `openapiFromText`, `asyncapiFromText` — so a base document can never read
 * differently from the identical bytes sitting on disk.
 *
 * CLASSIFICATION is a second, simplified spelling of `repo/tree/walk.ts`'s
 * rule, and that is a recorded risk, not an accident: the walk classifies a
 * LIVE filesystem (readdir, symlinks, marker files) and cannot walk a git
 * ref. What keeps the two honest is sharing the artifact-name table
 * (`ARTIFACT_FILES`/`isServiceArtifactName` from `repo/paths.ts`), the
 * marker name (`SUBSYSTEM_MARKER`) and the reserved-interior set
 * (`RESERVED_INTERIOR` from `repo/tree/walk.ts`) instead of respelling them, and restating
 * — exactly — the walk's SERVICE branches: (0) a directory named for a
 * service's own interior (`adrs/`, `usecases/`, `ui/`) is classified nowhere,
 * counts as nothing beneath its parent, and hides everything under it, because
 * the walk never descends into one; (1) a directory holding a service
 * artifact is a service, marker present or not (artifacts win); (2) the leaf
 * rule — neither marker nor artifact and nothing beneath (an empty or
 * not-yet-adopted directory, a lone README.md, a lone `.gitkeep` — which is
 * the whole content of a directory `loam seed` creates) is a service too; (3) nothing
 * inside a PLAIN service is classified again (`examples/openapi.yaml` two
 * levels down is interior, the walk stops there), but a service carrying the
 * marker BESIDE its artifacts is still descended — minus artifact-named
 * children like `adrs/` — so the services stranded beneath it stay
 * enumerated, the walk's marker-misplaced branch. Subsystem and unmarked
 * group directories need no restating: a flat file listing descends through
 * them by construction. What is deliberately NOT restated: the walk's
 * findings (`subsystem.marker-misplaced`, `subsystem.unmarked`,
 * `subsystem.name-collision`) — those are validate's live diagnostics; here
 * a name claimed twice suspends the subject (`ambiguous`) instead. If
 * walk.ts's rule ever changes, this module owes the same change;
 * test/diff.test.ts pins the visible agreement (subsystem move, not-adopted
 * leaf, stranded-under-marker).
 *
 * Deliberate consequence of joining by leaf directory name: a service MOVED
 * between subsystems keeps its id and diffs as UNCHANGED. Subsystem placement
 * is navigation, not identity — SCHEMA's own position, and the reason
 * `subsystem move` never touches a join key.
 */
import { isUtf8 } from "node:buffer";
import { inOrder } from "../kernel/concurrency.js";
import { parseRequirements } from "../document/parse.js";
import type { Requirement } from "../document/spec.js";
import { openapiFromText, type Operation } from "../openapi/doc.js";
import { asyncapiFromText } from "../asyncapi/read.js";
import type { EventMessage } from "../asyncapi/model.js";
import { ARTIFACT_FILES, isServiceArtifactName } from "../repo/paths.js";
import { SUBSYSTEM_MARKER } from "../repo/tree/marker.js";
import { RESERVED_INTERIOR } from "../repo/tree/walk.js";
import { listBaseTree, showBaseFile, type ResolvedBase } from "./base-git.js";

/**
 * One artifact's state on one side of the diff. `unreadable` is the
 * containment arm: the file exists but could not be read as its kind, so
 * every finding on this axis for this subject is SUSPENDED — "nobody could
 * look" must never grade as "nothing is there", in either direction.
 */
export type AxisState<T> =
  | { kind: "absent" }
  | { kind: "read"; value: T }
  | { kind: "unreadable"; path: string; error: string };

/** The keys of a service state that hold requirement-bearing documents. */
export type SpecAxisKey = "spec" | "archSpec";

/**
 * One service on one side of the diff — the same shape for the base ref and
 * the working tree (`./current-state.ts` builds the other), which is what
 * lets `./semantic.ts` join the two without caring which side came from git.
 */
export interface ServiceState {
  id: string;
  /** Docs-relative directory with forward slashes, e.g. `services/billing/payment-service`. */
  dir: string;
  spec: AxisState<Requirement[]>;
  /** Read on both sides for the `Consumes:` join — the outbox requirement lives here as often as in spec.md (core/coherence/events/lookups.ts's lesson). */
  archSpec: AxisState<Requirement[]>;
  /** Operations with `x-loam-remove` markers filtered out: a marker is bookkeeping, never a callable operation. */
  openapi: AxisState<Operation[]>;
  /** Messages with removal markers filtered out, for the same reason. */
  asyncapi: AxisState<EventMessage[]>;
}

export interface BaseFleet {
  /** By service id, insertion-sorted by id — deterministic output depends on it. */
  services: Map<string, ServiceState>;
  /**
   * Ids claimed by MORE than one base directory. The live walk grades this
   * `subsystem.name-collision`; here the id's base state is unanswerable, so
   * the subject is carried with every axis suspended rather than one claimant
   * silently winning the join.
   */
  ambiguous: Map<string, string[]>;
}

export type BaseFleetRead =
  | { kind: "ok"; fleet: BaseFleet }
  | { kind: "failed"; detail: string };

/** A classified base service directory and which artifact files the base tree listed in it. */
interface BaseDir {
  id: string;
  dir: string;
  files: Set<string>;
}

/**
 * Classify the base tree's file listing into service directories — the module
 * banner's three restated walk branches, in depth order so every ancestor is
 * decided before anything beneath it.
 */
function classifyBaseDirs(paths: string[]): { dirs: BaseDir[]; ambiguous: Map<string, string[]> } {
  const fileChildren = new Map<string, Set<string>>();
  const dirChildren = new Map<string, Set<string>>();
  // Directories nothing VISIBLE lives in, so neither map above names them.
  const bare = new Set<string>();
  for (const path of paths) {
    const all = path.split("/");
    // Dot-named entries are invisible to the live walk — but the walk still
    // SEES the directory holding them, because readdir discovered the
    // directory itself and only its CONTENTS are filtered (walk.ts's
    // `subdirNames` and `visitDir`). So cut the path at its first dot-named
    // segment rather than discarding the whole path: everything above the cut
    // stays a visible directory, the cut segment and everything beneath it
    // stay invisible. Discarding it outright hid every directory whose only
    // file is dot-named — which is exactly what `loam seed` writes into a
    // service directory it creates (`.gitkeep`, and nothing else), so a seeded
    // service was absent from the base and diffed as `diff.service-added`
    // against the unchanged tree that had just been committed.
    const cut = all.findIndex((s) => s.startsWith(".") || s === "");
    const segments = cut === -1 ? all : all.slice(0, cut);
    // Only a whole path ends in a file; a cut one is a pure directory chain.
    const fileAt = cut === -1 ? segments.length - 1 : -1;
    for (let i = 1; i < segments.length; i += 1) {
      const dir = segments.slice(0, i).join("/");
      const child = segments[i]!;
      const into = i === fileAt ? fileChildren : dirChildren;
      let set = into.get(dir);
      if (set === undefined) into.set(dir, (set = new Set()));
      set.add(child);
    }
    if (fileAt === -1 && segments.length > 1) bare.add(segments.join("/"));
  }
  const hasMarker = (dir: string): boolean => fileChildren.get(dir)?.has(SUBSYSTEM_MARKER) === true;
  const hasArtifact = (dir: string): boolean =>
    [...(fileChildren.get(dir) ?? [])].some((f) => isServiceArtifactName(f, "file")) ||
    [...(dirChildren.get(dir) ?? [])].some((d) => isServiceArtifactName(d, "dir"));
  // The walk's `RESERVED_INTERIOR` rule, restated for a flat listing: a
  // directory named for a service's own interior is never classified, and
  // neither is anything beneath it, because the walk never descends into one.
  // Segment 2 onward, matching where the walk applies it — to a directory's
  // CHILDREN, so a directory literally at `services/usecases/` is still
  // classified there.
  const reserved = (dir: string): boolean => dir.split("/").slice(2).some((s) => RESERVED_INTERIOR.has(s));
  // …and, for the same reason, one of them is not the subdirectory that keeps
  // its parent off the leaf rule: the walk filters them out of `dirs` before
  // asking whether anything is beneath.
  const classifiableChildren = (dir: string): boolean =>
    [...(dirChildren.get(dir) ?? [])].some((d) => !RESERVED_INTERIOR.has(d));
  // The walk's leaf rule: neither marker nor artifact and nothing beneath is a
  // service. (A truly EMPTY directory is unrepresentable in a git tree, so at
  // the base this arm means "no visible entry of ours" — files none of which
  // are artifacts, or nothing but dot-named entries, the `loam seed` shape.)
  const isLeafService = (dir: string): boolean =>
    !hasMarker(dir) && !hasArtifact(dir) && !classifiableChildren(dir);
  const candidates = [...new Set([...fileChildren.keys(), ...dirChildren.keys(), ...bare])]
    .filter((dir) => dir !== "services" && dir.startsWith("services/") && !reserved(dir))
    .filter((dir) => hasArtifact(dir) || isLeafService(dir))
    .sort((a, b) => {
      const depth = a.split("/").length - b.split("/").length;
      return depth !== 0 ? depth : a < b ? -1 : 1;
    });
  const accepted: BaseDir[] = [];
  const acceptedDirs = new Set<string>();
  // Is this candidate INTERIOR to the nearest service already accepted above
  // it? A plain service swallows everything beneath (the walk stops there); a
  // marker-beside-artifacts service is descended except through its
  // artifact-named children (`adrs/`), so a service stranded under it stays.
  const interior = (segments: string[]): boolean => {
    for (let i = segments.length - 1; i >= 2; i -= 1) {
      const ancestor = segments.slice(0, i).join("/");
      if (!acceptedDirs.has(ancestor)) continue;
      return hasMarker(ancestor) ? isServiceArtifactName(segments[i]!, "dir") : true;
    }
    return false;
  };
  for (const dir of candidates) {
    const segments = dir.split("/");
    if (interior(segments)) continue;
    acceptedDirs.add(dir);
    accepted.push({ id: segments[segments.length - 1]!, dir, files: fileChildren.get(dir) ?? new Set() });
  }
  return { dirs: accepted, ambiguous: collisions(accepted) };
}

function collisions(dirs: BaseDir[]): Map<string, string[]> {
  const byId = new Map<string, string[]>();
  for (const d of dirs) byId.set(d.id, [...(byId.get(d.id) ?? []), d.dir]);
  return new Map([...byId].filter(([, claimants]) => claimants.length > 1));
}

/** One shown base file, or `null` for a file the base tree never listed. */
type Fetched = { rel: string; read: Awaited<ReturnType<typeof showBaseFile>> } | null;

/**
 * Lift one fetched file into an axis state through its parser. Absence is the
 * listing's answer, a `show` failure is per-subject containment, and only
 * then do the bytes reach a parser.
 */
function axisFrom<T>(raw: Fetched, parse: (path: string, bytes: Buffer) => AxisState<T>): AxisState<T> {
  if (raw === null) return { kind: "absent" };
  if (raw.read.kind === "failed") return { kind: "unreadable", path: raw.rel, error: raw.read.detail };
  return parse(raw.rel, raw.read.bytes);
}

/**
 * The same refusal `readOpenapi`/`readAsyncapi`/`decodeDocument` make on the
 * living side: non-UTF-8 bytes would be silently rewritten as U+FFFD by
 * `toString`, and a document nobody wrote must not be graded.
 */
function decodeBase(path: string, bytes: Buffer): { text: string } | { unreadable: AxisState<never> } {
  if (!isUtf8(bytes)) return { unreadable: { kind: "unreadable", path, error: "file is not valid UTF-8" } };
  return { text: bytes.toString("utf8") };
}

function specState(path: string, bytes: Buffer): AxisState<Requirement[]> {
  const decoded = decodeBase(path, bytes);
  if ("unreadable" in decoded) return decoded.unreadable;
  try {
    return { kind: "read", value: parseRequirements(decoded.text) };
  } catch (e) {
    return { kind: "unreadable", path, error: e instanceof Error ? e.message : String(e) };
  }
}

function openapiState(path: string, bytes: Buffer): AxisState<Operation[]> {
  const decoded = decodeBase(path, bytes);
  if ("unreadable" in decoded) return decoded.unreadable;
  const doc = openapiFromText(decoded.text);
  return doc.unreadable
    ? { kind: "unreadable", path, error: doc.error ?? "not a readable OpenAPI document" }
    : { kind: "read", value: doc.ops.filter((op) => !op.remove) };
}

function asyncapiState(path: string, bytes: Buffer): AxisState<EventMessage[]> {
  const decoded = decodeBase(path, bytes);
  if ("unreadable" in decoded) return decoded.unreadable;
  const doc = asyncapiFromText(decoded.text);
  return doc.unreadable
    ? { kind: "unreadable", path, error: doc.error ?? "not a readable AsyncAPI document" }
    : { kind: "read", value: doc.messages.filter((m) => m.remove !== true) };
}

/** One base service's four axes. Sequential INSIDE the service on purpose: the pool below rations children at the service grain, and four spawns per in-flight worker would multiply past the cap it exists to hold. */
async function readBaseService(base: ResolvedBase, d: BaseDir): Promise<ServiceState> {
  const fetch = async (file: string): Promise<Fetched> =>
    d.files.has(file) ? { rel: `${d.dir}/${file}`, read: await showBaseFile(base, `${d.dir}/${file}`) } : null;
  return {
    id: d.id,
    dir: d.dir,
    spec: axisFrom(await fetch(ARTIFACT_FILES.spec), specState),
    archSpec: axisFrom(await fetch(ARTIFACT_FILES.archSpec), specState),
    openapi: axisFrom(await fetch(ARTIFACT_FILES.openapi), openapiState),
    asyncapi: axisFrom(await fetch(ARTIFACT_FILES.asyncapi), asyncapiState),
  };
}

/**
 * The whole base fleet. `failed` only when git cannot LIST the tree — the
 * whole-diff refusal; a single file that cannot be shown or parsed degrades
 * its own subject's axis to `unreadable` and nothing else.
 */
export async function readBaseFleet(base: ResolvedBase): Promise<BaseFleetRead> {
  const listing = await listBaseTree(base);
  if (listing.kind === "failed") return listing;
  const { dirs, ambiguous } = classifyBaseDirs(listing.paths);
  const sorted = [...dirs].sort((a, b) => (a.id < b.id ? -1 : 1)).filter((d) => !ambiguous.has(d.id));
  // Pooled, ordered reads: bounded children in flight, results by input index,
  // so the same base state always assembles the same fleet.
  const states = await inOrder(sorted, (d) => readBaseService(base, d));
  return { kind: "ok", fleet: { services: new Map(states.map((s) => [s.id, s])), ambiguous } };
}
