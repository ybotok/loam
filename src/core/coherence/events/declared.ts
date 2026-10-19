/**
 * What a feature's asyncapi deltas DECLARE, per service — ../declared.ts's
 * mirror on the event axis, indexed in one walk and graded as it goes.
 *
 * The walk owns every check that reads ONE service's pair of contracts: the
 * feature document's readability (`asyncapi.invalid` suspends the rest, the
 * unreadableApis discipline), the baseline pins and removal-marker exactness
 * (./grades.ts, slot-keyed), the removal↔REMOVED-requirement justification
 * join, and the merge simulation (../retired/merged.ts) the cross-axis
 * checks grade against. What it cannot answer alone — who still consumes a message, what
 * other features are adding — lives in ./lookups.ts, and the cross-axis
 * grading of edges and requirement lines in ./events.ts.
 *
 * Slot identity is core/asyncapi/digest.ts's: three sections, and an inline
 * channel message is channel-slot interior — a marker NESTED on one makes
 * the channel an EDIT against the channel's pin, never a message removal,
 * so nothing here reads it as one. A CHANNEL-slot removal, by contrast,
 * takes its living inline interior with it (SCHEMA.md's decision), so the
 * justification join counts those inline names as marked: without that, a
 * message declared only inline was a deadlock — the sanctioned channel
 * marker graded remove-marker-missing, and the components.messages marker
 * the error suggested graded remove-target-missing.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { type PathableService } from "../../kernel/ids/service.js";
import type { Issue } from "../../vocabulary/issue.js";
import { featureSpecPaths, SPEC_AXES } from "../../repo/paths.js";
import { locateServicePaths } from "../../repo/service-target.js";
import { parseRequirements } from "../../document/parse.js";
import { readAsyncapi } from "../../asyncapi/read.js";
import type { AsyncapiDoc } from "../../asyncapi/model.js";
import type { FleetContext } from "../../fleet-context.js";
import type { DocsDir, FeatureDir } from "../../kernel/ids/dirs.js";
import { gradeBaselines, gradeMarkers } from "./grades.js";
import { messageRetirements } from "../retired/retirement.js";
import { eventArrivals, type EventArrivals } from "../retired/revival/arrivals.js";
import { readEventPair } from "../retired/event-pair.js";

/** The three facts this walk needs about the feature it is reading. */
export interface EventDeltaScope {
  docsDir: DocsDir;
  featureDir: FeatureDir;
  featureId: string;
}

/** One delta requirement's `Publishes:`/`Consumes:` claim — what ./events.ts grades against the contract. */
export interface EventLink {
  direction: "publishes" | "consumes";
  message: string;
  requirement: string;
}

/** Everything one feature's asyncapi deltas say about their own services. */
export interface DeclaredEvents {
  /** Per touched service: the feature delta's parse — present only where the file exists and reads. */
  featureDocs: Map<PathableService, AsyncapiDoc>;
  /**
   * Per touched service: the living contract as the MERGE would leave it
   * (../retired/merged.ts) — present where a feature delta sits over a
   * readable living contract and the simulation had an answer. What `declares()` and
   * the consumer gate's wire half read, so the gate grades the post-archive
   * contract rather than the union of two documents one of which is leaving.
   */
  mergedDocs: Map<PathableService, AsyncapiDoc>;
  /**
   * Per service: message names this feature genuinely retires — message-slot
   * markers plus a removed channel's living INLINE interior (SCHEMA.md:
   * retiring a whole channel retires its inline messages with it), minus
   * redeclarations.
   */
  netRemoved: Map<string, Set<string>>;
  /**
   * Per service: messages the living contract SENDS that the merged one
   * would not — a channel or operation removal, or an edit, stopping
   * production while the declaration may well survive. The wire half of the
   * consumer question (./events.ts); empty where no simulation ran.
   */
  stoppedSending: Map<string, string[]>;
  /**
   * Per service in the walk: the delta's non-REMOVED `Publishes:`/`Consumes:`
   * lines — read once HERE and graded in ./events.ts, the indexed-in-one-walk
   * rule this record exists for (the same lines used to be re-read and
   * re-parsed per question on the context-less archive-gate path).
   */
  links: Map<PathableService, EventLink[]>;
  /** Services whose FEATURE asyncapi.yaml exists but does not parse — every event check suspends for them. */
  unreadable: Set<string>;
  /**
   * Per touched service: the slots the delta declares that the living
   * contract lacks, and the message names the contract the archive would
   * write declares where the living one does not — new, or a revival of what
   * an archived feature retired or moved away, which the living contract
   * alone cannot tell apart. ./events.ts asks the retired index (../retired/)
   * only when one of these is non-empty.
   */
  revivalCandidates: Map<PathableService, EventArrivals>;
}

/**
 * The delta's `Publishes:`/`Consumes:` lines for one service, split by
 * requirement fate — read from BOTH spec files, because the outbox
 * requirement in arch.spec.md is the canonical home of an event line. A
 * REMOVED requirement's lines justify removals; everything else's are
 * claims ./events.ts grades against the contract.
 */
export async function deltaEventLines(
  scope: EventDeltaScope,
  service: PathableService,
  context?: FleetContext,
): Promise<{ removed: Set<string>; links: EventLink[] }> {
  const removed = new Set<string>();
  const links: EventLink[] = [];
  for (const axis of SPEC_AXES) {
    const p = featureSpecPaths(scope.featureDir, service)[axis.key];
    if (!existsSync(p)) continue;
    const reqs = context === undefined
      ? parseRequirements(await readFile(p, "utf8"))
      : await context.readRequirements(p);
    for (const r of reqs) {
      if (r.kind === "REMOVED") {
        for (const m of [...r.publishes, ...r.consumes]) removed.add(m);
        continue;
      }
      links.push(...r.publishes.map((m) => ({ direction: "publishes" as const, message: m, requirement: r.name })));
      links.push(...r.consumes.map((m) => ({ direction: "consumes" as const, message: m, requirement: r.name })));
    }
  }
  return { removed, links };
}

export async function declaredEvents(
  scope: EventDeltaScope,
  svcNames: PathableService[],
  issues: Issue[],
  context?: FleetContext,
): Promise<DeclaredEvents> {
  const { docsDir, featureDir, featureId } = scope;
  const featureDocs = new Map<PathableService, AsyncapiDoc>();
  const mergedDocs = new Map<PathableService, AsyncapiDoc>();
  const netRemoved = new Map<string, Set<string>>();
  const stoppedSending = new Map<string, string[]>();
  const links = new Map<PathableService, EventLink[]>();
  const unreadable = new Set<string>();
  const revivalCandidates = new Map<PathableService, EventArrivals>();
  for (const svc of svcNames) {
    const featPath = featureSpecPaths(featureDir, svc).asyncapi;
    const { removed: justifiedMsgs, links: svcLinks } = await deltaEventLines(scope, svc, context);
    links.set(svc, svcLinks);
    // The living contract is read only where a question will be asked of it:
    // no event delta and no REMOVED line means no marker debt and no slot to
    // grade. The unguarded read was an eager parse per touched service —
    // paid on every archive, whose gate runs without a FleetContext — for an
    // answer nothing consumed.
    if (!existsSync(featPath) && justifiedMsgs.size === 0) continue;
    const livingPath = (await locateServicePaths(docsDir, svc, context)).asyncapi;
    const livingDoc = await readAsyncapi(livingPath, context);
    if (!existsSync(featPath)) {
      // No event delta — but a REMOVED requirement may still be walking away
      // from a message the LIVING contract declares, and the marker that
      // retires the declaration has to ride in the same feature. Only
      // messages the living contract actually carries are owed one: an event
      // contract is optional, and a fleet retiring a requirement over a
      // message no contract declares owes no file.
      for (const m of justifiedMsgs) {
        if (livingDoc.unreadable || !livingDoc.messages.some((msg) => msg.name === m)) continue;
        issues.push({
          severity: "error",
          code: "asyncapi.remove-marker-missing",
          subject: svc,
          message: `${svc}: a REMOVED requirement's Publishes:/Consumes: line names '${m}', which the living asyncapi.yaml still declares, but this feature carries no matching x-loam-remove: true marker in specs/${svc}/asyncapi.yaml`,
        });
      }
      continue;
    }
    const featDoc = await readAsyncapi(featPath, context);
    // A feature contract that EXISTS but does not read is a broken document,
    // not an empty one — openapi.invalid's discipline (../declared.ts),
    // applied to the event axis: the rest of this service's event checks are
    // suspended, because every one of them would be an opinion about a
    // document nobody could open.
    if (featDoc.unreadable) {
      unreadable.add(svc);
      issues.push({
        severity: "error",
        code: "asyncapi.invalid",
        subject: svc,
        message: `${svc}: this feature's asyncapi.yaml does not read as AsyncAPI 3.0${featDoc.error === undefined ? "" : ` (${featDoc.error})`} — the event axis is unchecked and the merge would have nothing true to write. Fix the document first.`,
      });
      continue;
    }
    featureDocs.set(svc, featDoc);

    // Both sides' texts, trees and slots, read the one way rebase's
    // standalone revival read reads them too (../retired/event-pair.ts owns
    // the guards: absent living is an answer, unreadable living is not).
    const read = await readEventPair({ featPath, featDoc, livingPath, livingDoc, service: svc }, context);
    const { featSlots, livingText } = read;
    revivalCandidates.set(svc, eventArrivals(read));

    if (livingText !== undefined) {
      gradeBaselines({ ...read, svc, featureId }, issues);
      gradeMarkers(read, svc, issues);
      // The pair's one simulation — the revival candidates above have already
      // asked it, comparing it with the living contract.
      const merged = read.merged()?.doc;
      if (merged !== undefined) {
        mergedDocs.set(svc, merged);
        stoppedSending.set(svc, livingDoc.sent.filter((m) => !merged.sent.includes(m)));
      }
    }

    // The raw marker sets and the NET one (minus relocations) —
    // ../retired/retirement.ts owns the rule and says why each set exists;
    // the retired index reads every archived feature through the same
    // function, against that feature's snapshot pre-image instead of the
    // living contract on disk.
    const { markerNames, inlineRetired, redeclared, net } = messageRetirements(featDoc, featSlots, livingDoc);
    netRemoved.set(svc, net);

    for (const name of markerNames) {
      if (redeclared.has(name) || justifiedMsgs.has(name)) continue;
      issues.push({
        severity: "error",
        code: "asyncapi.remove-marker-unjustified",
        subject: svc,
        message: `${svc}: removal marker for message '${name}' is not justified by a REMOVED requirement's Publishes:/Consumes: line`,
      });
    }
    for (const m of justifiedMsgs) {
      // Owed only while the living contract still declares the message —
      // and satisfied by ANY marker taking it out, relocation included: a
      // message-slot marker naming it, or a channel-slot removal whose
      // living inline interior declares it (the SCHEMA-sanctioned way to
      // retire an inline declaration). And owed only while the MERGE would
      // still declare it: a slot re-keyed to another name takes the message
      // out with no marker, and none could be written there — the key holds
      // the re-keyed declaration — so the route `asyncapi.remove-message-
      // consumed` names (REMOVE the requirement whose Publishes: line names
      // it) ended in this error, `openapi.remove-marker-missing`'s deadlock
      // one axis over.
      if (markerNames.has(m) || inlineRetired.has(m)) continue;
      if (livingDoc.unreadable || !livingDoc.messages.some((msg) => msg.name === m)) continue;
      const after = mergedDocs.get(svc);
      if (after !== undefined && !after.messages.some((msg) => msg.name === m)) continue;
      issues.push({
        severity: "error",
        code: "asyncapi.remove-marker-missing",
        subject: svc,
        message: `${svc}: a REMOVED requirement's Publishes:/Consumes: line names '${m}', which the living asyncapi.yaml still declares, but this feature's asyncapi.yaml has no matching x-loam-remove: true marker`,
      });
    }
  }
  return { featureDocs, mergedDocs, netRemoved, stoppedSending, links, unreadable, revivalCandidates };
}
