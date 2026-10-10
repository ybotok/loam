/**
 * The working-tree side of `loam diff`: the fleet as it stands on disk, read
 * through the invocation's `FleetContext` into the SAME `ServiceState` shape
 * `./base-state.ts` builds from git — one shape, so `./semantic.ts` joins the
 * two sides without caring which one came from the object store.
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
import type { Requirement } from "../document/spec.js";
import type { Operation } from "../openapi/doc.js";
import type { EventMessage } from "../asyncapi/model.js";
import { repoPath } from "../envelope/json.js";
import { servicePathsAt } from "../repo/paths.js";
import { inOrder } from "../kernel/concurrency.js";
import type { DocsDir } from "../kernel/ids/dirs.js";
import type { FleetContext } from "../fleet-context.js";
import { bytesDigest, type AxisState, type ServiceState } from "./base-state.js";

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
export async function readCurrentFleet(docsDir: DocsDir, context: FleetContext): Promise<CurrentFleet> {
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
  const ambiguous = currentCollisions(states);
  return {
    services: new Map(states.filter((s) => !ambiguous.has(s.id)).map((s) => [s.id, s])),
    ambiguous,
  };
}

/** Ids claimed by more than one enumerated directory, with every claimant named. */
function currentCollisions(states: readonly ServiceState[]): Map<string, string[]> {
  const byId = new Map<string, string[]>();
  for (const s of states) byId.set(s.id, [...(byId.get(s.id) ?? []), s.dir]);
  return new Map([...byId].filter(([, dirs]) => dirs.length > 1));
}
