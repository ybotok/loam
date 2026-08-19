/**
 * What a feature's asyncapi deltas DECLARE, per service — ../declared.ts's
 * mirror on the event axis, indexed in one walk and graded as it goes.
 *
 * The walk owns every check that reads ONE service's pair of contracts: the
 * feature document's readability (`asyncapi.invalid` suspends the rest, the
 * unreadableApis discipline), the baseline pins (slot-keyed, classified by
 * the one verdict function both axes share), removal-marker exactness, and
 * the removal↔REMOVED-requirement justification join. What it cannot answer
 * alone — who still consumes a message, what other features are adding —
 * lives in ./lookups.ts, and the cross-axis grading of edges and
 * requirement lines in ./events.ts.
 *
 * Slot identity is core/asyncapi/digest.ts's: three sections, and an inline
 * channel message is channel-slot interior — its nested marker makes the
 * channel an EDIT against the channel's pin, never a message removal, so
 * nothing here (and nothing in the justification join) reads it as one.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { NotUtf8DocumentError } from "../../kernel/document-bytes.js";
import { type PathableService } from "../../kernel/ids/service.js";
import type { Issue } from "../../vocabulary/issue.js";
import { featureSpecPaths, servicePaths, SPEC_AXES } from "../../repo/paths.js";
import { parseRequirements } from "../../document/parse.js";
import { asyncapiSlots, type AsyncapiSlot } from "../../asyncapi/digest.js";
import { readAsyncapi, type AsyncapiDoc } from "../../asyncapi/read.js";
import { classifyBaselineDigests, OPERATION_DIGEST_LENGTH, OPERATION_DIGEST_RE } from "../../openapi/digest.js";
import type { FleetContext } from "../../fleet-context.js";
import type { DocsDir, FeatureDir } from "../../kernel/ids/dirs.js";

/** The three facts this walk needs about the feature it is reading. */
export interface EventDeltaScope {
  docsDir: DocsDir;
  featureDir: FeatureDir;
  featureId: string;
}

/** Everything one feature's asyncapi deltas say about their own services. */
export interface DeclaredEvents {
  /** Per touched service: the feature delta's parse — present only where the file exists and reads. */
  featureDocs: Map<PathableService, AsyncapiDoc>;
  /** Per service: message names this feature genuinely retires (message-slot markers minus redeclarations). */
  netRemoved: Map<string, Set<string>>;
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
): Promise<{ removed: Set<string>; links: { direction: "publishes" | "consumes"; message: string; requirement: string }[] }> {
  const removed = new Set<string>();
  const links: { direction: "publishes" | "consumes"; message: string; requirement: string }[] = [];
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
  const netRemoved = new Map<string, Set<string>>();
  const unreadable = new Set<string>();
  for (const svc of svcNames) {
    const featPath = featureSpecPaths(featureDir, svc).asyncapi;
    const { removed: justifiedMsgs } = await deltaEventLines(scope, svc, context);
    const livingPath = servicePaths(docsDir, svc).asyncapi;
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
    const featSlots = featText === undefined ? [] : asyncapiSlots(parse(featText));
    // The living side of every slot judgement. Absent is a real answer —
    // everything the delta spells is new, and a baseline only means
    // something for a slot that already exists. Unreadable is NOT an
    // answer: grading pins or markers against an empty parse would call
    // every restatement new and every marker stale, so both checks stand
    // down and the (later) merge refuses the unreadable side by name.
    const livingText = !existsSync(livingPath) || livingDoc.unreadable ? undefined : await readOr(livingPath, context);
    const livingSlots = new Map<string, AsyncapiSlot>(
      (livingText === undefined ? [] : asyncapiSlots(parse(livingText))).map((s) => [`${s.section}\0${s.key}`, s]),
    );

    if (livingText !== undefined) {
      gradeBaselines({ featSlots, livingSlots, svc, featureId }, issues);
      gradeMarkers({ featDoc, livingDoc, featSlots, livingSlots }, svc, issues);
    }

    // A relocation — same message name, marker on the old key, declaration
    // at a new one — retires nothing. "Is this message going away" asks the
    // NET set; "did the author write a marker" asks the raw one,
    // ../declared.ts's distinction verbatim.
    const markerNames = new Set(
      featDoc.messages.filter((m) => m.remove === true && m.slot.startsWith("components.messages.")).map((m) => m.name),
    );
    const redeclared = new Set(featDoc.messages.filter((m) => m.remove !== true).map((m) => m.name));
    const net = new Set([...markerNames].filter((name) => !redeclared.has(name)));
    netRemoved.set(svc, net);

    for (const name of net) {
      if (justifiedMsgs.has(name)) continue;
      issues.push({
        severity: "error",
        code: "asyncapi.remove-marker-unjustified",
        subject: svc,
        message: `${svc}: removal marker for message '${name}' is not justified by a REMOVED requirement's Publishes:/Consumes: line`,
      });
    }
    for (const m of justifiedMsgs) {
      // Owed only while the living contract still declares the message —
      // and satisfied by ANY marker naming it, relocation included: a
      // relocated message keeps its requirement, so the requirement being
      // REMOVED alongside is the author's business, not a marker debt.
      if (markerNames.has(m)) continue;
      if (livingDoc.unreadable || !livingDoc.messages.some((msg) => msg.name === m)) continue;
      issues.push({
        severity: "error",
        code: "asyncapi.remove-marker-missing",
        subject: svc,
        message: `${svc}: a REMOVED requirement's Publishes:/Consumes: line names '${m}', which the living asyncapi.yaml still declares, but this feature's asyncapi.yaml has no matching x-loam-remove: true marker`,
      });
    }
  }
  return { featureDocs, netRemoved, unreadable };
}

/** One service's slot pins against the living contract — openapi/baseline/gate.ts's verdicts, slot-keyed. */
function gradeBaselines(
  input: { featSlots: AsyncapiSlot[]; livingSlots: Map<string, AsyncapiSlot>; svc: string; featureId: string },
  issues: Issue[],
): void {
  const { featSlots, livingSlots, svc, featureId } = input;
  let unpinned = 0;
  for (const slot of featSlots) {
    // A removal marker is not a restatement of anything; its own exactness
    // checks guard the slot.
    if (slot.remove) continue;
    const label = `${slot.section}.${slot.key}`;
    const living = livingSlots.get(`${slot.section}\0${slot.key}`);
    if (slot.basedOn !== undefined && !OPERATION_DIGEST_RE.test(slot.basedOn)) {
      issues.push({
        severity: "error",
        code: "asyncapi.baseline-invalid",
        subject: svc,
        message: `${svc}: ${label} has invalid x-loam-based-on '${slot.basedOn}' — expected ${OPERATION_DIGEST_LENGTH} lowercase hex characters, as \`loam rebase\` writes them`,
      });
      continue;
    }
    const verdict = classifyBaselineDigests(slot.basedOn, slot.digest, living?.digest);
    if (verdict === "unfounded") {
      issues.push({
        severity: "error",
        code: "asyncapi.baseline-invalid",
        subject: svc,
        message: `${svc}: ${label} carries x-loam-based-on, but the living contract has no slot there — a new channel, operation or message has no living version to be based on; drop the marker`,
      });
    } else if (verdict === "stale") {
      issues.push({
        severity: "error",
        code: "asyncapi.baseline-stale",
        subject: svc,
        message: `${svc}: ${label} was written against living version ${slot.basedOn}, but the living contract now holds ${living!.digest} — somebody landed a change to it in between, and merging this would replace theirs outright. Re-read the living slot, fold in what you still mean, then run \`loam rebase ${featureId}\`.`,
      });
    } else if (verdict === "unpinned" && living !== undefined) {
      // Counted, not listed — a delta quotes most of the contract it
      // restates, and one warning per quote teaches people to filter the
      // code out (openapi.baseline-missing's doctrine, verbatim).
      unpinned += 1;
    }
  }
  if (unpinned > 0) {
    issues.push({
      severity: "warn",
      gates: true,
      code: "asyncapi.baseline-missing",
      subject: svc,
      message: `${svc}: ${unpinned} slot(s) in this feature's asyncapi.yaml carry no baseline pin (x-loam-based-on), so the merge cannot tell which ones this delta EDITS from the ones it merely restates — it will upsert all of them, reverting anything that landed on the restated ones. Run \`loam rebase ${featureId} --service ${svc}\`, or archive with --approve to merge unpinned deliberately.`,
    });
  }
}

/** Marker exactness: the slot must exist, and a message marker must name the living declaration. */
function gradeMarkers(
  input: { featDoc: AsyncapiDoc; livingDoc: AsyncapiDoc; featSlots: AsyncapiSlot[]; livingSlots: Map<string, AsyncapiSlot> },
  svc: string,
  issues: Issue[],
): void {
  const { featDoc, livingDoc, featSlots, livingSlots } = input;
  for (const slot of featSlots) {
    if (!slot.remove) continue;
    const label = `${slot.section}.${slot.key}`;
    const living = livingSlots.get(`${slot.section}\0${slot.key}`);
    if (living === undefined) {
      issues.push({
        severity: "error",
        code: "asyncapi.remove-target-missing",
        subject: svc,
        message: `${svc}: removal marker at ${label} addresses no living slot — the contract has nothing there to retire; update the stale marker to the current key, or drop it if the slot is already gone`,
      });
      continue;
    }
    if (slot.section !== "components.messages") continue;
    // Removal is exact for messages the way it is for operations: the
    // marker names both the key and the message identity it expects to
    // delete, so a slot whose NAME moved under the delta is caught here
    // rather than deleting somebody else's message.
    const markerName = featDoc.messages.find((m) => m.remove === true && m.slot === label)?.name ?? slot.key;
    const livingName = livingDoc.messages.find((m) => m.slot === label)?.name ?? slot.key;
    if (markerName !== livingName) {
      issues.push({
        severity: "error",
        code: "asyncapi.remove-target-mismatch",
        subject: svc,
        message: `${svc}: removal marker at ${label} names message '${markerName}', but the living declaration there is '${livingName}' — loam never deletes a different message occupying the slot`,
      });
    }
  }
}
