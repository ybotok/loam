/**
 * Who produces what across the fleet, read one contract at a time.
 *
 * Separate from `./read.ts` because it asks a question no single document can
 * answer: a message's producer is a claim about some OTHER service's contract,
 * so this walk is the only part of the axis whose answer depends on how much of
 * the fleet was readable. That incompleteness is a value it returns, not a
 * failure it hides — a consumer check that treated an unreadable producer as
 * "nobody sends this" would report a phantom orphan.
 */
import { readAsyncapi } from "./read.js";
import type { FleetContext } from "../fleet-context.js";
import type { PathableService } from "../kernel/ids/service.js";
import { locateServicePaths } from "../repo/service-target.js";
import type { DocsDir } from "../kernel/ids/dirs.js";

/** Who produces what across the fleet, and whether that view is complete. */
export interface FleetProducers {
  /** Message name → the services declaring an `action: send` for it. */
  byMessage: Map<string, string[]>;
  /**
   * Services whose `asyncapi.yaml` exists and could not be read. Non-empty means
   * the ABSENCE of a producer proves nothing: one of these files may well
   * declare the message, and nobody can tell without fixing it first.
   */
  unreadable: string[];
}

/**
 * Which services in the fleet declare an `action: send` for each message name.
 *
 * The one question on this axis that no single repository can answer, and the
 * reason `validate --service` reads more than its own service here: a consumer
 * joins to a message the PRODUCER owns, so "does anybody publish this" is a
 * fleet fact. Zero producers is `spine.message-unproduced`; two are
 * `asyncapi.message-contested`, where every consumer's join picks one
 * arbitrarily.
 *
 * The two answers rest on different evidence, and only one of them survives an
 * unreadable contract. Finding two producers is POSITIVE evidence and stays
 * true whatever else in the fleet fails to parse. Finding none is an argument
 * from absence, and one broken file makes it worthless — skipping that service
 * silently would turn its outage into one `spine.message-unproduced` per
 * consuming edge across the whole fleet, every one of them pointing at the
 * wrong repository. So the unreadable services are reported rather than
 * skipped, and the caller suspends the negative answer while any exist.
 *
 * The cost is N small YAML parses, not N LikeC4 workspace spins — the latter is
 * what makes `validate --all` expensive (SCHEMA.md, "Operating at fleet scale"),
 * and a context memoizes these reads across the run.
 */
export async function producersByMessage(
  docsDir: DocsDir,
  services: readonly PathableService[],
  context?: FleetContext,
): Promise<FleetProducers> {
  const byMessage = new Map<string, string[]>();
  const unreadable: string[] = [];
  for (const service of services) {
    const doc = await readAsyncapi((await locateServicePaths(docsDir, service, context)).asyncapi, context);
    if (doc.unreadable) {
      unreadable.push(service);
      continue;
    }
    for (const name of doc.sent) byMessage.set(name, [...(byMessage.get(name) ?? []), service]);
  }
  return { byMessage, unreadable };
}

