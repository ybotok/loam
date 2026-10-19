/**
 * Who in the CURRENT fleet consumes what an archive is about to overwrite — the
 * consumers an `openapi.op-modified` / `asyncapi.message-modified` warning
 * names, so "the merge overwrites the living operation wholesale" says whom
 * that lands on instead of leaving the reader to go and find out.
 *
 * NOT A NEW JOIN. This is `loam diff`'s victim index (core/consumers/consumers.ts)
 * asked over the living fleet as it stands before the merge — the same
 * landscape edges, the same living requirements, the same use-case hops, the
 * same suspensions for a consumer nobody could read or a caller drawn with no
 * op — and the same sentence for the answer (`consumerStance`). A second
 * caller of one index, which Rule 13 (docs/DESIGN.md) permits; a third copy of
 * the join is what it forbids.
 *
 * LAZY, AND PAID ONLY WHEN A WARNING FIRES. Building the index reads every
 * service's four documents (`readCurrentFleet`) and, at the first question,
 * parses the landscape — the archive's own gate loads it without the run's
 * read index, so that parse is not shared. Measured 2026-10-10 on the
 * 120-service benchmark fleet (scripts/bench-validate.ts's shape), with one
 * feature overwriting one operation: `archive --dry-run --json` went from a
 * 1216 ms to a 1346 ms median over five runs through tsx (~0.5 s of which is
 * startup); taken apart, about 50 ms of document reads and about 120 ms of
 * LikeC4. An archive that overwrites nothing never builds it.
 *
 * What it does NOT answer: `openapi.component-modified` and
 * `asyncapi.component-modified`. A component's consumers are the operations or
 * messages whose `$ref` closure reaches it, and then THEIR consumers; nothing
 * indexes a contract by component today (an operation carries its closure's
 * digest, not its members), and building that reverse index for a warning is
 * the heavy new structure this reuse was allowed only without.
 */
import { readCurrentFleet } from "../../../../core/consumers/current.js";
import { victimIndex, type VictimIndex } from "../../../../core/consumers/consumers.js";
import { consumerStance, type ConsumerScan } from "../../../../core/consumers/scan.js";
import { FleetContext } from "../../../../core/fleet-context.js";
import type { DocsDir } from "../../../../core/kernel/ids/dirs.js";

/** The two questions the contract planners ask, each answered at most once per run's index. */
export interface ContractConsumers {
  /** Current consumers of `provider`'s operation `operationId`. */
  op(provider: string, operationId: string): Promise<ConsumerScan>;
  /** Current consumers of message `name` that `provider` declares. */
  message(provider: string, name: string): Promise<ConsumerScan>;
}

export function contractConsumers(config: { docsDir: DocsDir; fleet: FleetContext }): ContractConsumers {
  let index: Promise<VictimIndex> | undefined;
  const victims = (): Promise<VictimIndex> =>
    (index ??= (async (): Promise<VictimIndex> => {
      // The run's own read index: the planners have already read the delta
      // services' living contracts through it.
      const { docsDir, fleet: context } = config;
      const current = await readCurrentFleet(docsDir, context);
      return victimIndex({ docsDir, context, current: current.services, ambiguous: current.ambiguous });
    })());
  return {
    op: async (provider, operationId) => (await victims()).opConsumers(provider, operationId),
    message: async (provider, name) => (await victims()).messageConsumers(provider, name),
  };
}

/**
 * The clause an overwrite warning's message ends with, and the lines its
 * `details` carry: positive evidence first, then what could not be checked —
 * the order `loam diff` lists them in.
 */
export function consumerClause(scan: ConsumerScan): { clause: string; details: string[] } {
  return { clause: consumerStance(scan), details: [...scan.victims, ...scan.suspended] };
}
