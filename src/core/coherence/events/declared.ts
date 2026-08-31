/**
 * What a feature's asyncapi deltas DECLARE, per service — ../declared.ts's
 * mirror on the event axis, indexed in one walk and graded as it goes.
 *
 * The walk owns every check that reads ONE service's pair of contracts: the
 * feature document's readability (`asyncapi.invalid` suspends the rest, the
 * unreadableApis discipline), the baseline pins and removal-marker exactness
 * (./grades.ts, slot-keyed), the removal↔REMOVED-requirement justification
 * join, and the merge simulation (./merged.ts) the cross-axis checks grade
 * against. What it cannot answer alone — who still consumes a message, what
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
import { parse } from "yaml";
import { NotUtf8DocumentError } from "../../kernel/document-bytes.js";
import { type PathableService } from "../../kernel/ids/service.js";
import type { Issue } from "../../vocabulary/issue.js";
import { featureSpecPaths, SPEC_AXES } from "../../repo/paths.js";
import { locateServicePaths } from "../../repo/service-target.js";
import { parseRequirements } from "../../document/parse.js";
import { asyncapiSlots, type AsyncapiSlot } from "../../asyncapi/digest.js";
import { readAsyncapi } from "../../asyncapi/read.js";
import type { AsyncapiDoc } from "../../asyncapi/model.js";
import type { FleetContext } from "../../fleet-context.js";
import type { DocsDir, FeatureDir } from "../../kernel/ids/dirs.js";
import { gradeBaselines, gradeMarkers } from "./grades.js";
import { mergedAsyncapiDoc } from "./merged.js";

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
   * (./merged.ts) — present where a feature delta sits over a readable
   * living contract and the simulation had an answer. What `declares()` and
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

/** Read a document's text, answering undefined for bytes that do not decode — ../declared.ts's guard. */
async function readOr(p: string, context?: FleetContext): Promise<string | undefined> {
  try {
    return context === undefined ? await readFile(p, "utf8") : await context.readText(p);
  } catch (err) {
    if (err instanceof NotUtf8DocumentError) return undefined;
    throw err;
  }
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
        message: `${svc}: this feature's asyncapi.yaml does not parse${featDoc.error === undefined ? "" : ` (${featDoc.error})`} — the event axis is unchecked and the merge would have nothing true to write. Fix the YAML first.`,
      });
      continue;
    }
    featureDocs.set(svc, featDoc);

    const featText = await readOr(featPath, context);
    // Parsed ONCE and kept: the slot walk and the surface half of the baseline
    // grade read the same resolved tree, and a second `parse` of the same
    // bytes is a second chance for the two halves to disagree about what the
    // delta declares.
    const featPlain: unknown = featText === undefined ? {} : parse(featText);
    const featSlots = asyncapiSlots(featPlain);
    // The living side of every slot judgement. Absent is a real answer —
    // everything the delta spells is new, and a baseline only means
    // something for a slot that already exists. Unreadable is NOT an
    // answer: grading pins or markers against an empty parse would call
    // every restatement new and every marker stale, so both checks stand
    // down and the (later) merge refuses the unreadable side by name.
    const livingText = !existsSync(livingPath) || livingDoc.unreadable ? undefined : await readOr(livingPath, context);
    const livingPlain: unknown = livingText === undefined ? {} : parse(livingText);
    const livingSlots = new Map<string, AsyncapiSlot>(
      asyncapiSlots(livingPlain).map((s) => [`${s.section}\0${s.key}`, s]),
    );

    if (livingText !== undefined) {
      gradeBaselines({ featSlots, livingSlots, featPlain, livingPlain, svc, featureId }, issues);
      gradeMarkers({ featDoc, livingDoc, featSlots, livingSlots }, svc, issues);
      if (featText !== undefined) {
        const merged = mergedAsyncapiDoc({ livingText, livingDoc, featureText: featText, service: svc });
        if (merged !== undefined) {
          mergedDocs.set(svc, merged);
          stoppedSending.set(svc, livingDoc.sent.filter((m) => !merged.sent.includes(m)));
        }
      }
    }

    // A relocation — same message name, marker on the old key, declaration
    // at a new one — retires nothing. "Is this message going away" asks the
    // NET set; "did the author write a marker" asks the raw one,
    // ../declared.ts's distinction verbatim. Two raw sets, because the two
    // marker shapes carry different debts: a message-slot marker must be
    // justified by a REMOVED requirement, while a channel-slot removal needs
    // exactness only (requirements join on message names, never channel
    // keys — SCHEMA.md) and its living inline interior leaves with it.
    const markerNames = new Set(
      featDoc.messages.filter((m) => m.remove === true && m.slot.startsWith("components.messages.")).map((m) => m.name),
    );
    const channelRemovals = featSlots.filter((s) => s.section === "channels" && s.remove).map((s) => s.key);
    const inlineRetired = new Set(
      livingDoc.messages
        .filter((m) => channelRemovals.some((ck) => m.slot.startsWith(`channels.${ck}.messages.`)))
        .map((m) => m.name),
    );
    const redeclared = new Set(featDoc.messages.filter((m) => m.remove !== true).map((m) => m.name));
    const net = new Set([...markerNames, ...inlineRetired].filter((name) => !redeclared.has(name)));
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
      // retire an inline declaration).
      if (markerNames.has(m) || inlineRetired.has(m)) continue;
      if (livingDoc.unreadable || !livingDoc.messages.some((msg) => msg.name === m)) continue;
      issues.push({
        severity: "error",
        code: "asyncapi.remove-marker-missing",
        subject: svc,
        message: `${svc}: a REMOVED requirement's Publishes:/Consumes: line names '${m}', which the living asyncapi.yaml still declares, but this feature's asyncapi.yaml has no matching x-loam-remove: true marker`,
      });
    }
  }
  return { featureDocs, mergedDocs, netRemoved, stoppedSending, links, unreadable };
}
