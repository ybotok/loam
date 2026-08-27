/**
 * The per-slot grades of one service's pair of event contracts: baseline
 * pins and removal-marker exactness. Split from ./declared.ts along the
 * subject seam — that module owns the WALK (which files, which services,
 * which sets), these functions own the verdict each slot gets once both
 * sides are in hand — when the walk grew past the line limit; the split
 * moved them verbatim.
 */
import type { Issue } from "../../vocabulary/issue.js";
import { type AsyncapiSlot } from "../../asyncapi/digest.js";
import { type AsyncapiDoc } from "../../asyncapi/model.js";
import { classifyBaselineDigests, OPERATION_DIGEST_LENGTH, OPERATION_DIGEST_RE } from "../../openapi/digest.js";

/** One service's slot pins against the living contract — openapi/baseline/gate.ts's verdicts, slot-keyed. */
export function gradeBaselines(
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
