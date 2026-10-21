/**
 * The event axis's fleet question, read lazily — ../lookups.ts's pattern on
 * the message join.
 *
 * It reaches outside the delta: the in-flight scan reads every active
 * feature's asyncapi delta. A closure over a cache rather than an argument
 * computed up front, so it is paid only when its question is first asked —
 * and it is paid by ANY feature that declares a message at all, because
 * `asyncapi.message-conflict`'s question ("does an in-flight feature define
 * this elsewhere?") is asked of every healthy declaration — unlike the
 * OpenAPI mirror, whose `definedElsewhere` is reached only inside a breach
 * branch. That standing cost matters most on `archive`'s gate, which runs
 * without a FleetContext, so each read here is a real parse.
 *
 * The consumer scan that used to sit beside it — who still consumes a message
 * a service retires — is the consumer index's now (`core/consumers/`), paid
 * only by a feature that actually retires production: `loam diff` asks the
 * same question, and the two copies had drifted apart in which documents they
 * read.
 */
import { featureSpecPaths } from "../../repo/paths.js";
import { listFeatures } from "../../repo/repo.js";
import { readAsyncapi } from "../../asyncapi/read.js";
import type { FleetContext } from "../../fleet-context.js";
import type { DocsDir } from "../../kernel/ids/dirs.js";

/** What the event checks may ask about the world outside this feature's own files. */
export interface EventLookups {
  /** The in-flight feature (if any) whose asyncapi delta adds or edits (service, message). */
  messageDefinedElsewhere(service: string, message: string): Promise<string | undefined>;
  /**
   * The in-flight feature (if any) whose asyncapi delta declares an `action:
   * send` for `message`, on any service — the producer a consumer this feature
   * adds would be waiting for (`./produced.ts`). Senders only, for
   * `ConsumerIndex.producers`' reason: every consumer declares the message too,
   * with `action: receive`, and counting that named the consumer its own
   * producer.
   */
  messageSentElsewhere(message: string): Promise<string | undefined>;
}

/** The identity of the feature being graded — what the lazy scans exclude. */
export interface EventScope {
  docsDir: DocsDir;
  featureId: string;
}

export function eventLookups(scope: EventScope, context?: FleetContext): EventLookups {
  const { docsDir, featureId } = scope;

  // What OTHER features in flight declare, per (service, message) — the
  // asyncapi mirror of pending.ts's activeOpAdditions, living HERE because
  // it shares this module's laziness and its consumers. Removal markers do
  // not count: a feature retiring a message is not adding it. First feature
  // wins a clash — one name to archive first is enough to make progress.
  // The senders ride the same walk: both questions read the same deltas, and
  // a second walk is a second parse of every one of them on the archive gate.
  let inFlight: { declared: Map<string, string>; sent: Map<string, string> } | null = null;
  const scan = async (): Promise<{ declared: Map<string, string>; sent: Map<string, string> }> => {
    if (inFlight === null) {
      const declared = new Map<string, string>();
      const sent = new Map<string, string>();
      for (const feature of await listFeatures(docsDir, {}, context)) {
        if (feature.id === featureId) continue;
        for (const svc of feature.services) {
          const doc = await readAsyncapi(featureSpecPaths(feature.dir, svc).asyncapi, context);
          for (const m of doc.messages) {
            if (m.remove === true) continue;
            const k = `${svc} ${m.name}`;
            if (!declared.has(k)) declared.set(k, feature.id);
          }
          for (const name of doc.sent) if (!sent.has(name)) sent.set(name, feature.id);
        }
      }
      inFlight = { declared, sent };
    }
    return inFlight;
  };
  const messageDefinedElsewhere = async (service: string, message: string): Promise<string | undefined> =>
    (await scan()).declared.get(`${service} ${message}`);
  const messageSentElsewhere = async (message: string): Promise<string | undefined> => (await scan()).sent.get(message);

  return { messageDefinedElsewhere, messageSentElsewhere };
}
