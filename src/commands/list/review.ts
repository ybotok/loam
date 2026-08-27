/**
 * The review-order gathering and sort behind `loam list --needs-work
 * --review-order`: per-service contract reads (contained per read), the one
 * landscape load, and the deterministic ordering. The derivation itself is
 * pure and lives in core/dependencies/fanin.ts.
 *
 * Fifth and LAST file of the list package — the next module added here forces
 * a split along a named seam (docs/CODE-STYLE.md, the five-file limit).
 */
import { existsSync } from "node:fs";
import { readAsyncapi } from "../../core/asyncapi/read.js";
import { type LoadedDoc } from "../../core/c4/likec4.js";
import { serviceResolver } from "../../core/c4/resolve/service.js";
import { fleetFanIn, type FanInContracts } from "../../core/dependencies/fanin.js";
import { type FleetContext } from "../../core/fleet-context.js";
import { inOrder } from "../../core/kernel/concurrency.js";
import { compareIds, type ServiceEntry } from "../../core/repo/entries.js";
import { landscapePath, servicePathsAt } from "../../core/repo/paths.js";
import { type ServiceView } from "./views.js";
import type { DocsDir } from "../../core/kernel/ids/dirs.js";

/**
 * The landscape for the review path, loaded ONCE through the run's memo and
 * handed both to serviceViews (as `preloaded`) and to the fan-in joins — a
 * second parse of a document the run already holds is the cost the shared
 * load exists to retire.
 *
 * Deliberately NOT `readLandscape` from commands/validate/fleet/load.ts: that
 * import would add a list→validate/fleet package edge while
 * validate/fleet/scorecard→list already exists, and the containment is four
 * lines.
 */
export async function reviewLandscape(docsDir: DocsDir, fleet: FleetContext): Promise<LoadedDoc | null> {
  const lp = landscapePath(docsDir);
  // Absent is `null` — the same "there is none" serviceViews' own load
  // spells. An UNREADABLE file is deliberately not contained here: bare
  // `loam list` refuses `repository-unavailable` when serviceViews' load
  // throws on it, and a rendering flag must never change what the run
  // refuses — a swallowed throw here answered ok over the exact file the
  // flagless run refuses on, with rows CHANGED by the silent null
  // (`proven: false` flips apiExpected and the missing lists). The throw
  // reaches list.ts's existing handler, so both paths refuse identically.
  if (!existsSync(lp)) return null;
  return fleet.loadLikeC4(lp);
}

/**
 * One service's contract slice for the message join, contained PER READ, not
 * per slice. The distinction is somebody else's rank: a slice is a caller's
 * evidence about OTHER services' fan-in, not only its own row, so a slice
 * that discarded its readable spec.md because its arch.spec.md is broken
 * would silently under-report every producer that spec subscribes to.
 */
async function contractSlice(entry: ServiceEntry, fleet: FleetContext): Promise<FanInContracts> {
  const paths = servicePathsAt(entry.dir);
  const [sent, specConsumes, archConsumes] = await Promise.all([
    readOr([], async () => {
      const events = await readAsyncapi(paths.asyncapi, fleet);
      // An unreadable contract declares nothing this join may count —
      // swallowing it into its parsed subset would grade a broken file as a
      // thin one (the scorecard's contracts.ts spells the same rule).
      return events.unreadable === true ? ([] as readonly string[]) : events.sent;
    }),
    readOr([], () => livingConsumes(paths.spec, fleet)),
    readOr([], () => livingConsumes(paths.archSpec, fleet)),
  ]);
  return { sent, consumed: [...specConsumes, ...archConsumes] };
}

/** `Consumes:` names of a spec file's living requirements; absent file, nothing. */
async function livingConsumes(path: string, fleet: FleetContext): Promise<readonly string[]> {
  if (!existsSync(path)) return [];
  // A REMOVED requirement is on its way out and subscribes to nothing, from
  // either spec namespace.
  return (await fleet.readRequirements(path)).filter((r) => r.kind !== "REMOVED").flatMap((r) => r.consumes);
}

/**
 * The containment: an unreadable artifact contributes nothing — and ONLY that
 * artifact's evidence, per the doctrine above. The catch also exists for a
 * mechanical reason (commands/validate/fleet/scorecard/contracts.ts): these
 * are memoized reads whose REJECTION rejects again on every await, so an
 * uncontained one would delete the whole queue from inside the pool.
 */
async function readOr<T>(fallback: T, read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch {
    // Unreadable reads as "declares nothing" — never as a refusal, and never
    // as its neighbours' silence.
    return fallback;
  }
}

/**
 * Fan-in per service id, FLEET-WIDE — the joins need every service's slice
 * anyway; the caller ranks only the worklist, so vouched services carry a
 * count without occupying a rank.
 */
export async function fanInByService(
  services: ServiceEntry[],
  fleet: FleetContext,
  land: LoadedDoc | null,
): Promise<Map<string, number>> {
  const known = new Set<string>(services.map((s) => s.id));
  const slices = await inOrder(services, async (s) => [s.id, await contractSlice(s, fleet)] as const);
  const request = {
    services: services.map((s) => s.id),
    contracts: new Map<string, FanInContracts>(slices),
  };
  if (land !== null && land.errors.length === 0) {
    return fleetFanIn({
      ...request,
      landscape: { parses: true, relationships: land.relationships, svcOf: serviceResolver(land.elements, known) },
    });
  }
  return fleetFanIn({ ...request, landscape: { parses: false } });
}

/**
 * The queue: fan-in descending, ties broken by id — fully deterministic, no
 * clocks, no readdir order, so two runs over one repository are byte-identical
 * (fan-in is a set size and both joins are order-insensitive).
 */
export function reviewOrder(views: ServiceView[], fanIn: ReadonlyMap<string, number>): ServiceView[] {
  return [...views].sort(
    (a, b) =>
      (fanIn.get(b.entry.id) ?? 0) - (fanIn.get(a.entry.id) ?? 0) || compareIds(a.entry.id, b.entry.id),
  );
}
