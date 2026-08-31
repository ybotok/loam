/**
 * The per-slot grades of one service's pair of event contracts: baseline
 * pins and removal-marker exactness. Split from ./declared.ts along the
 * subject seam — that module owns the WALK (which files, which services,
 * which sets), these functions own the verdict each slot gets once both
 * sides are in hand — when the walk grew past the line limit; the split
 * moved them verbatim.
 */
import type { Issue } from "../../vocabulary/issue.js";
import { ASYNCAPI_BASELINES_KEY, type AsyncapiSlot } from "../../asyncapi/digest.js";
import { type AsyncapiDoc } from "../../asyncapi/model.js";
import { asyncapiSurfaces } from "../../asyncapi/baseline/surfaces.js";
import { entryFor, readBaselineRecord, surfaceIn } from "../../openapi/baseline/record.js";
import {
  classifyBaselineDigests,
  OPERATION_DIGEST_LENGTH,
  OPERATION_DIGEST_RE,
  valueDigest,
} from "../../openapi/digest.js";

/** Everything the two baseline graders need about one service's pair of contracts. */
export interface AsyncapiBaselineInput {
  featSlots: AsyncapiSlot[];
  livingSlots: Map<string, AsyncapiSlot>;
  /** The FEATURE document's resolved parse — where the record and the surfaces are read from. */
  featPlain: unknown;
  /** The LIVING document's resolved parse; `{}` where no living contract exists. */
  livingPlain: unknown;
  svc: string;
  featureId: string;
}

/**
 * One service's baselines against the living contract — openapi/baseline/gate.ts's
 * verdicts, over BOTH halves of this axis: the slot pins in-value, and the
 * component surfaces the root `x-loam-baselines` record pins. One function
 * because the unpinned count is shared (see below), and because a delta is
 * graded once or the two halves drift into different ideas of what it restates.
 */
export function gradeBaselines(input: AsyncapiBaselineInput, issues: Issue[]): void {
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
  // The surface half's unpinned count folds into the SAME counter, not a
  // second warning: "counted, not listed" is the doctrine above, and one
  // warning per axis-half would have a delta over a schema-heavy contract
  // print two findings naming the same one command.
  unpinned += gradeSurfaces(input, issues);
  if (unpinned > 0) {
    issues.push({
      severity: "warn",
      gates: true,
      code: "asyncapi.baseline-missing",
      subject: svc,
      message: `${svc}: ${unpinned} slot(s) and component surface(s) in this feature's asyncapi.yaml carry no baseline pin (x-loam-based-on / ${ASYNCAPI_BASELINES_KEY}), so the merge cannot tell which ones this delta EDITS from the ones it merely restates — it will upsert all of them, reverting anything that landed on the restated ones. Run \`loam rebase ${featureId} --service ${svc}\`, or archive with --approve to merge unpinned deliberately.`,
    });
  }
}

/**
 * The surface half: every `components/<kind>/<name>` outside `messages`,
 * graded from the root `x-loam-baselines` record by the same classifier the
 * slots go through. Returns the unpinned count so the caller can fold it into
 * the one per-service warning rather than emitting a second.
 *
 * The codes are REUSED rather than multiplied — `asyncapi.baseline-invalid`
 * and `asyncapi.baseline-stale` say exactly the same thing about a surface as
 * about a slot, and a caller that branches on them wants one branch.
 */
function gradeSurfaces(input: AsyncapiBaselineInput, issues: Issue[]): number {
  const { featPlain, livingPlain, svc, featureId } = input;
  const invalid = (message: string): void => {
    issues.push({ severity: "error", code: "asyncapi.baseline-invalid", subject: svc, message: `${svc}: ${message}` });
  };
  const { record, problems } = readBaselineRecord(featPlain);
  for (const problem of problems) {
    invalid(`${problem} — the record is \`loam rebase\`'s bookkeeping and cannot be graded as it stands; re-run \`loam rebase ${featureId}\` to rebuild it`);
  }
  const surfaces = asyncapiSurfaces(featPlain);
  // An entry pinning a surface the delta does not declare is a claim about
  // nothing — usually one the author deleted after rebasing. Distinct from
  // `unfounded` below, where the surface IS declared and the LIVING side is
  // what vanished. A `pathItems` section is the same fault at the axis level:
  // an AsyncAPI document has no path items, so the whole section pins nothing,
  // and rebase's wholesale rebuild would drop it without a word.
  const declared = new Set(surfaces.map((s) => s.id));
  for (const id of Object.keys(record.components)) {
    if (declared.has(id)) continue;
    invalid(`${ASYNCAPI_BASELINES_KEY} pins component '${id}', but this feature's asyncapi.yaml does not declare it — re-run \`loam rebase ${featureId}\` to rebuild the record`);
  }
  for (const path of Object.keys(record.pathItems)) {
    invalid(`${ASYNCAPI_BASELINES_KEY} pins path item '${path}', but an AsyncAPI document has no path items — the section pins nothing; re-run \`loam rebase ${featureId}\` to rebuild the record`);
  }

  let unpinned = 0;
  for (const s of surfaces) {
    const entry = entryFor(record, s);
    const living = surfaceIn(livingPlain, s);
    const verdict = classifyBaselineDigests(
      entry,
      valueDigest(s.value),
      living.found ? valueDigest(living.value) : undefined,
    );
    if (verdict === "unpinned") {
      // Only a surface the living contract ALREADY has can be reverted by an
      // unpinned merge; a genuinely new schema never trips the counter.
      if (living.found) unpinned += 1;
    } else if (verdict === "stale") {
      issues.push({
        severity: "error",
        code: "asyncapi.baseline-stale",
        subject: svc,
        message: `${svc}: component '${s.id}' was pinned to living version ${entry}, but the living contract now holds ${valueDigest(living.value)} — somebody landed a change to it in between, and merging this would replace theirs outright. Re-read the living value, fold in what you still mean, then run \`loam rebase ${featureId}\`.`,
      });
    } else if (verdict === "unfounded") {
      invalid(`component '${s.id}' is pinned to ${entry}, but the living contract no longer has that surface — the pin is structurally unresolvable; re-read the living contract, then run \`loam rebase ${featureId}\``);
    }
  }
  return unpinned;
}

/** Marker exactness: the slot must exist, and a message marker must name the living declaration. */
export function gradeMarkers(
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
