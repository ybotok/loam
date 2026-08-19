/**
 * One service as the explorer sees it: what it is, what it touches, and the
 * `loam new` line that would start work on it.
 *
 * Split from the walk in `./explore.ts` because it answers per SERVICE while
 * that answers per QUESTION — the walk decides which services are in the answer
 * and why, this fills each one in. `DescribeRequest` is a record rather than a
 * parameter list for the ordinary reason: nine facts about one service, and no
 * call site should be able to transpose two of them.
 */
import { existsSync } from "node:fs";
import { FleetContext } from "../fleet-context.js";
import { type Elem, type Rel } from "../c4/likec4.js";
import { maturityGaps, serviceMaturity } from "../vocabulary/maturity.js";
import { compareIds, type ServiceEntry } from "../repo/entries.js";
import { servicePathsAt } from "../repo/paths.js";
// Type-only, so it is erased and no runtime edge points back at the walk.
import { type ExploreEdge, type ExploreReason, type ExploreService } from "./explore.js";

interface DescribeRequest {
  id: string;
  reason: ExploreReason;
  entry: ServiceEntry | undefined;
  relationships: Rel[];
  svcOf: (id: string) => string;
  elements: Elem[];
  /** Whether the landscape parsed — what makes its silence evidence rather than absence. */
  parses: boolean;
  context: FleetContext;
}

export async function describe(req: DescribeRequest): Promise<ExploreService> {
  const { id, reason, entry, relationships, svcOf } = req;

  const inbound: ExploreEdge[] = [];
  const outbound: ExploreEdge[] = [];
  for (const r of relationships) {
    const edge = { op: r.op ?? null, title: r.title ?? null };
    if (svcOf(r.target) === id) inbound.push({ service: svcOf(r.source), ...edge });
    else if (svcOf(r.source) === id) outbound.push({ service: svcOf(r.target), ...edge });
  }
  const modelled = req.elements.some((e) => svcOf(e.id) === id);

  // A service that does not exist has no rung: `empty` would be a claim about a
  // directory nobody has made, and it reads as "exists, nothing in it" — the
  // one state a caller most needs to tell it apart from.
  if (entry === undefined) {
    return {
      id,
      reason,
      known: false,
      maturity: null,
      missing: [],
      modelled,
      operations: [],
      // Not `unreadable`: there is no contract here to fail to read. A service
      // with no directory owes nothing, and reporting a parse failure over an
      // absent file would send a reader looking for a document to fix.
      openapi: { unreadable: false },
      inbound,
      outbound,
    };
  }

  const archSpec = existsSync(servicePathsAt(entry.dir).archSpec);
  // Positive evidence only, and the rule is `list`'s verbatim: an inbound edge
  // carrying an operation is proof somebody calls this service, while a
  // landscape that is absent or does not parse proves nothing about who calls
  // it — so the contract is still owed. Spelling this differently here is how
  // the same service would grade `partial` in one command and `vouched` in the
  // other.
  const apiExpected = !req.parses || inbound.some((e) => e.op !== null);
  const input = { entry, archSpec, apiExpected };

  // `readOpenapi`, not `operationIds`: a contract that exists but does not
  // parse comes back from the id list as an EMPTY set, indistinguishable from a
  // service with no endpoints — and "this service offers nothing" is the worst
  // possible lie to tell somebody deciding whether to call it.
  const api = await req.context.readOpenapi(servicePathsAt(entry.dir).openapi);
  const operations = api.ops.filter((o) => !o.remove).map((o) => o.id);

  return {
    id,
    reason,
    known: true,
    maturity: serviceMaturity(input),
    missing: maturityGaps(input),
    modelled,
    operations,
    openapi: {
      unreadable: api.unreadable,
      ...(api.error === undefined ? {} : { error: api.error }),
    },
    inbound,
    outbound,
  };
}

/**
 * The service whose living contract defines an operationId, or null.
 *
 * Reads every service's `openapi.yaml`, which is the cost of asking a question
 * nothing indexes. It is YAML, not LikeC4 — the expensive parse in this
 * codebase — and it happens only when somebody passes `--op`.
 */
export async function operationOwner(
  entries: ServiceEntry[],
  op: string,
  context: FleetContext,
): Promise<ServiceEntry["id"] | null> {
  for (const entry of entries) {
    if (!entry.has.openapi) continue;
    const api = await context.readOpenapi(servicePathsAt(entry.dir).openapi);
    if (api.ops.some((o) => o.id === op && !o.remove)) return entry.id;
  }
  return null;
}

/**
 * The `loam new` line the seeds imply. A seed that names no existing service is
 * `--new-service`, not `--touches`: those are different scaffolds, and getting
 * it wrong is what leaves a feature with a requirement delta for a service that
 * has no directory to archive into.
 */
export function newCommand(featureId: string, seeds: string[], known: ReadonlySet<string>): string {
  const flags = [...seeds]
    .sort(compareIds)
    .map((id) => (known.has(id) ? `--touches ${id}` : `--new-service ${id}`));
  return `loam new ${featureId}${flags.length > 0 ? ` ${flags.join(" ")}` : ""}`;
}
