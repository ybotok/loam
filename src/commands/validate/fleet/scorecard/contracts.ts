/**
 * One service's contract-axis contributions to the fleet scorecard: the HTTP
 * and event counts off its living documents, its arch `Covers:` entries for
 * the C4 census, and the per-axis adoption booleans (`participates`).
 * `./scorecard.js` sums these across the fleet; this module owns the
 * per-service reads and their containment, and never prints.
 */
import { existsSync } from "node:fs";
import { readAsyncapi } from "../../../../core/asyncapi/read.js";
import { type CoversEntry } from "../../../../core/c4/arch.js";
import { type FleetContext } from "../../../../core/fleet-context.js";
import { readOpenapi } from "../../../../core/openapi/doc.js";
import { type ServiceEntry } from "../../../../core/repo/entries.js";
import { servicePathsAt } from "../../../../core/repo/paths.js";
import { coversEntries } from "../../checks/requirements.js";
import { type AdoptionAxis } from "./adoption.js";

/**
 * One service's contributions. Structurally identical to the `operations` and
 * `messages` sections of the Scorecard payload — spelled here rather than
 * imported from `./scorecard.js`, because that import would close a file
 * cycle with the module that sums these.
 */
export interface ContractCounts {
  operations: { defined: number; governed: number; deprecated: number; deprecatedStillConsumed: number };
  messages: { defined: number; linked: number };
  covers: CoversEntry[];
  /**
   * Whether THIS service has started each adoption axis — the per-service
   * booleans `adoptionOf` (./adoption.js) sums into the fleet's participation
   * counts. The six rules are spelled on `Scorecard.adoption` (./scorecard.js),
   * where the payload key freezes them; every input is a read this function
   * already pays for.
   */
  participates: Record<AdoptionAxis, boolean>;
}

export async function contractCounts(
  svc: ServiceEntry,
  fleet: FleetContext,
  inbound: ReadonlySet<string>,
): Promise<ContractCounts> {
  try {
    return await readContracts(svc, fleet, inbound);
  } catch {
    // `guarded`'s doctrine, one rollup down: these are the same memoized reads
    // this service's own target already failed on, and a memoized REJECTION
    // rejects again on every await — so a spec.md that is not UTF-8, or an
    // openapi.yaml that is a directory, deleted the whole fleet's card from
    // inside Promise.all. The service's `service.unreadable` finding names the
    // cause; here the one unreadable service contributes zeros and the
    // fleet's rollup survives. Participation is all-false the way the counts
    // are zero — NOT because the service started nothing (an unreadable
    // service proves nothing, least of all that), but because no claim can be
    // made; the text renderer therefore refuses to group warnings on any run
    // with an unreadable service (report.ts), since a false `false` here
    // could manufacture the fleet-wide N=0 that licenses suppression.
    return {
      operations: { defined: 0, governed: 0, deprecated: 0, deprecatedStillConsumed: 0 },
      messages: { defined: 0, linked: 0 },
      covers: [],
      participates: { requirements: false, arch: false, openapi: false, asyncapi: false, permissions: false, capabilities: false },
    };
  }
}

async function readContracts(
  svc: ServiceEntry,
  fleet: FleetContext,
  inbound: ReadonlySet<string>,
): Promise<ContractCounts> {
  const paths = servicePathsAt(svc.dir);
  const reqs = existsSync(paths.spec) ? await fleet.readRequirements(paths.spec) : [];
  const archReqs = existsSync(paths.archSpec) ? await fleet.readRequirements(paths.archSpec) : [];
  // The living rule the service target applies (service/specs.ts): a REMOVED
  // requirement is on its way out and governs nothing. Hoisted for BOTH
  // documents because the `linked` join and the participation booleans below
  // read the same non-REMOVED sets.
  const living = reqs.filter((r) => r.kind !== "REMOVED");
  const archLiving = archReqs.filter((r) => r.kind !== "REMOVED");

  const api = await readOpenapi(paths.openapi, fleet);
  // Removal markers are never callable operations (service/api.ts's liveOps
  // rule), and an unreadable contract defines nothing this census may count —
  // swallowing it into its parsed subset would grade a broken file as a thin one.
  const ops = api.unreadable ? [] : api.ops.filter((o) => !o.remove);
  const governed = new Set(living.flatMap((r) => r.operations));
  const deprecated = new Set(ops.filter((o) => o.deprecated).map((o) => o.id));

  const events = await readAsyncapi(paths.asyncapi, fleet);
  // Distinct names — every join on the event spine is by NAME, so a duplicate
  // slot is one message — and the governance join is requirement lines from
  // BOTH documents, never landscape edges: an edge is a claim about traffic,
  // a requirement is governance (service/events/events.ts).
  const declared = events.unreadable
    ? []
    : [...new Set(events.messages.filter((m) => m.remove !== true).map((m) => m.name))];
  const linked = new Set(
    [...living, ...archLiving].flatMap((r) => [...r.publishes, ...r.consumes]),
  );

  // The per-axis participation booleans, each the one-line rule the Scorecard
  // doc comment pins. Requirements/arch count ANY parsed block (REMOVED
  // included — a spec retiring its last requirement still started the axis),
  // while permissions/capabilities apply the non-REMOVED rule their fleet
  // checks apply (fleet-shape.ts's used sets), so "participates" and "cites"
  // cannot disagree about the same line.
  const participates: Record<AdoptionAxis, boolean> = {
    requirements: reqs.length > 0,
    arch: archReqs.length > 0,
    openapi: existsSync(paths.openapi),
    asyncapi: existsSync(paths.asyncapi),
    permissions: [...living, ...archLiving].some((r) => r.requires.length > 0),
    capabilities: [...living, ...archLiving].some((r) => r.capabilities.length > 0),
  };

  return {
    operations: {
      defined: ops.length,
      governed: ops.filter((o) => governed.has(o.id)).length,
      deprecated: deprecated.size,
      deprecatedStillConsumed: [...deprecated].filter((id) => governed.has(id) || inbound.has(id)).length,
    },
    messages: {
      defined: declared.length,
      linked: declared.filter((name) => linked.has(name)).length,
    },
    // coversEntries already drops REMOVED requirements.
    covers: coversEntries(archReqs),
    participates,
  };
}
