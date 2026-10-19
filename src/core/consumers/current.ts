/**
 * The living fleet as it stands on disk, read through the invocation's
 * `FleetContext` into the SAME `ServiceState` shape `core/diff/base-state.ts`
 * builds from git — one shape, so `core/diff/semantic.ts` joins the two sides
 * without caring which one came from the object store.
 *
 * It was `loam diff`'s working-tree side (`core/diff/current-state.ts`) and
 * still is; it moved here because the consumer index (`./consumers.ts`) reads
 * the same fleet for every caller — the diff, the coherence gate and the
 * archive planner — and a reader that only the diff could import was why the
 * gate kept a copy of its own.
 *
 * Containment discipline, per subject and per axis: an artifact that EXISTS
 * but cannot be read (non-UTF-8 spec bytes, a directory sitting where a file
 * belongs, broken contract YAML) degrades that one axis to `unreadable` with
 * its path, and the hash of its bytes when there are bytes to hash — never a
 * thrown enumeration, never an empty list a diff would read as "everything
 * was removed". Absence stays absence: a file deleted
 * between the existence probe and the read is classified by its errno
 * (ENOENT), the same TOCTOU discipline `loadConfig` documents.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Rel } from "../c4/likec4.js";
import { serviceResolver } from "../c4/resolve/service.js";
import { readUseCases, useCasesIn, type UseCaseScan } from "../usecases/fleet.js";
import type { Requirement } from "../document/spec.js";
import type { Operation } from "../openapi/doc.js";
import type { EventMessage } from "../asyncapi/model.js";
import { repoPath } from "../envelope/json.js";
import { landscapePath, servicePathsAt } from "../repo/paths.js";
import { inOrder } from "../kernel/concurrency.js";
import type { DocsDir } from "../kernel/ids/dirs.js";
import type { FleetContext } from "../fleet-context.js";
import { bytesDigest, collisions, type AxisState, type ServiceState } from "./state.js";

export interface CurrentFleet {
  /** By service id, in the enumeration's (sorted-walk) order. Ids the `ambiguous` map claims are excluded. */
  services: Map<string, ServiceState>;
  /**
   * Ids more than one working-tree directory claims — `subsystem.name-collision`'s
   * live shape, which validate diagnoses. Diffing either claimant would pick a
   * winner nobody chose (a `new Map` collapse here used to keep the LAST one and
   * fabricate a whole change story about a service that never moved), so the
   * subject is suspended exactly as the base side's `ambiguous` map suspends it.
   */
  ambiguous: Map<string, string[]>;
}

/**
 * The unreadable arm, carrying the hash of the bytes that would not read
 * (`AxisState`'s `bytes`, which the base side's `axisFrom` fills the same
 * way). The readers this module goes through hand back a parsed document and
 * not its bytes, so this is a second read — paid only on this path, which a
 * healthy fleet never takes.
 */
async function unreadableAt(abs: string, rel: string, error: string): Promise<AxisState<never>> {
  try {
    return { kind: "unreadable", path: rel, error, bytes: bytesDigest(await readFile(abs)) };
  } catch {
    // No bytes to hash (a directory where the file belongs, a file deleted
    // since the first read): an unhashed side proves no identity, so the axis
    // suspends exactly as it always did.
    return { kind: "unreadable", path: rel, error };
  }
}

async function readFailure(e: unknown, file: { abs: string; rel: string }): Promise<AxisState<never>> {
  const errno = e as NodeJS.ErrnoException;
  if (errno.code === "ENOENT") return { kind: "absent" };
  return unreadableAt(file.abs, file.rel, e instanceof Error ? e.message : String(e));
}

/** One spec-axis file (`spec.md` / `arch.spec.md`) as parsed requirements. */
async function requirementsAxis(context: FleetContext, abs: string, rel: string): Promise<AxisState<Requirement[]>> {
  if (!existsSync(abs)) return { kind: "absent" };
  try {
    return { kind: "read", value: await context.readRequirements(abs) };
  } catch (e) {
    // decodeDocument's non-UTF-8 refusal lands here too: bytes that would
    // parse as zero requirements must suspend the axis, not empty it.
    return readFailure(e, { abs, rel });
  }
}

async function openapiAxis(context: FleetContext, abs: string, rel: string): Promise<AxisState<Operation[]>> {
  if (!existsSync(abs)) return { kind: "absent" };
  try {
    const doc = await context.readOpenapi(abs);
    return doc.unreadable
      ? await unreadableAt(abs, rel, doc.error ?? "not a readable OpenAPI document")
      : { kind: "read", value: doc.ops.filter((op) => !op.remove) };
  } catch (e) {
    return readFailure(e, { abs, rel });
  }
}

async function asyncapiAxis(context: FleetContext, abs: string, rel: string): Promise<AxisState<EventMessage[]>> {
  if (!existsSync(abs)) return { kind: "absent" };
  try {
    const doc = await context.readAsyncapi(abs);
    return doc.unreadable
      ? await unreadableAt(abs, rel, doc.error ?? "not a readable AsyncAPI document")
      : { kind: "read", value: doc.messages.filter((m) => m.remove !== true) };
  } catch (e) {
    return readFailure(e, { abs, rel });
  }
}

/**
 * The current fleet, one `ServiceState` per enumerated service. The
 * enumeration itself (the tree walk) may throw `DocsRepoUnavailableError` —
 * that is the whole-repo refusal `docsRepoReady` fronts, not a per-subject
 * degradation, and it stays a throw for the command layer to map.
 */
async function readCurrentFleet(docsDir: DocsDir, context: FleetContext): Promise<CurrentFleet> {
  const entries = await context.listServices(docsDir);
  const states = await inOrder(entries, async (entry): Promise<ServiceState> => {
    const paths = servicePathsAt(entry.dir);
    return {
      id: entry.id,
      dir: repoPath(docsDir, entry.dir),
      spec: await requirementsAxis(context, paths.spec, repoPath(docsDir, paths.spec)),
      archSpec: await requirementsAxis(context, paths.archSpec, repoPath(docsDir, paths.archSpec)),
      openapi: await openapiAxis(context, paths.openapi, repoPath(docsDir, paths.openapi)),
      asyncapi: await asyncapiAxis(context, paths.asyncapi, repoPath(docsDir, paths.asyncapi)),
    };
  });
  const ambiguous = collisions(states);
  return {
    services: new Map(states.filter((s) => !ambiguous.has(s.id)).map((s) => [s.id, s])),
    ambiguous,
  };
}

/**
 * The fleet map half of the living read: the `architecture/` PROJECT's edges,
 * the one resolver every join over them uses, and the use cases drawn on it.
 */
export interface LivingMap {
  /** Every relationship the project declares, or `null` when the map proves nothing — absent, or it does not parse. */
  relationships: readonly Rel[] | null;
  /**
   * Element → service, with the enumerated fleet riding in — the resolver the
   * spine and the step graders use. Without the fleet, an edge into a modelled
   * container `payment.api` resolves to a service called "api" that has never
   * existed, the join on the provider finds nothing, and the one check
   * standing between a removal and its last consumer answers "nobody calls it"
   * (DESIGN's serviceResolver-known row).
   */
  resolve: (id: string) => string;
  useCases: UseCaseScan;
}

/** What one invocation has read, per docs root: each half paid for at its first question. */
interface Memo {
  fleet?: Promise<CurrentFleet>;
  map?: Promise<LivingMap>;
}

/**
 * One read per invocation, keyed by the invocation's own FleetContext — the
 * `core/coherence/retired/archived.ts` exception to the no-module-cache rule,
 * for its reason: the key IS the per-invocation object, so two runs can never
 * see each other's answer and the entry dies with the context. `validate --all`
 * grades every active feature with one context, and every one of them asks the
 * same fleet who consumes what; without this each feature re-read it.
 */
const PER_INVOCATION = new WeakMap<FleetContext, Map<string, Memo>>();

function memoFor(docsDir: DocsDir, context: FleetContext): Memo {
  let store = PER_INVOCATION.get(context);
  if (store === undefined) PER_INVOCATION.set(context, (store = new Map()));
  const key = resolve(docsDir);
  let memo = store.get(key);
  if (memo === undefined) store.set(key, (memo = {}));
  return memo;
}

/** `readCurrentFleet`, read at most once per invocation. */
export function livingFleet(docsDir: DocsDir, context: FleetContext): Promise<CurrentFleet> {
  const memo = memoFor(docsDir, context);
  return (memo.fleet ??= readCurrentFleet(docsDir, context));
}

/**
 * The map, read at most once per invocation — and read as the PROJECT, never
 * `architecture/landscape.likec4` alone.
 *
 * The spine grades every edge the `architecture/` project declares
 * (`commands/validate/service/spine.ts` reads `fleet.architecture`), and a
 * use-case hop is attributed against that same project. A consumer scan that
 * read one file of it answered "nobody calls it" about an edge drawn in
 * `architecture/calls.likec4`, the gate passed, and the next `validate --all`
 * reported `spine.op-undefined` on that very edge (review 2026-10-12, finding
 * 2) — `core/pack/living.ts` states the same rule for the same reason. One load
 * serves the edges and the hops: two readers of one project are two chances to
 * disagree about which documents it holds.
 *
 * An unreadable project proves nothing either way: `landscape.invalid` is
 * validate's finding to make, and neither a victim nor a doubt invented out of
 * a parse error may point the reader at a file their change never touched. ONE
 * fallback, and it adds only positive evidence: when the project does not parse
 * but `landscape.likec4` does on its own — a broken use-case file beside a good
 * map — the map's own edges still count. They are true of the map either way,
 * and losing them would have let a removal through the gate (and a `loam diff`
 * call it unconsumed) because of a document that has nothing to do with the
 * edge. The use cases stay unreadable: a flow is graded against the whole
 * project or not at all. Whether there is a map at all stays a fact about the
 * FILE, as the pack's `present` does: a repo with no `landscape.likec4` has no
 * map, not an empty project.
 */
export function livingMap(docsDir: DocsDir, context: FleetContext): Promise<LivingMap> {
  const memo = memoFor(docsDir, context);
  return (memo.map ??= (async (): Promise<LivingMap> => {
    const fleet = await livingFleet(docsDir, context);
    const known = new Set<string>([...fleet.services.keys(), ...fleet.ambiguous.keys()]);
    const mapPath = landscapePath(docsDir);
    if (!existsSync(mapPath)) {
      return { relationships: null, resolve: (id) => id, useCases: await readUseCases({ docsDir, known }) };
    }
    const doc = await context.architecture(docsDir);
    const useCases = useCasesIn(doc, known);
    if (doc.errors.length === 0) {
      return { relationships: doc.relationships, resolve: serviceResolver(doc.elements, known), useCases };
    }
    const alone = await context.loadLikeC4(mapPath);
    return alone.errors.length > 0
      ? { relationships: null, resolve: (id) => id, useCases }
      : { relationships: alone.relationships, resolve: serviceResolver(alone.elements, known), useCases };
  })());
}
