/**
 * `usecase.requirement-unresolved` — the `#req-` tag that names no requirement
 * of the capability the view is about.
 *
 * The join lives in `core/capabilities/usecase-join.ts` and none of it is
 * repeated here: this module owns the grade and the sentences. Six arms, six
 * fixes, and they are deliberately the same vocabulary
 * `capability.realizes-unknown` uses for the OTHER carrier of this claim — an
 * author who has learned one set of messages has learned both.
 *
 * ERROR, for `usecase.capability-unresolved`'s reason one join deeper: the tag
 * is the architect's claim that a flow satisfies a named business promise, and a
 * claim that resolves to nothing reads exactly like one that does — in the view,
 * in review, and to anyone asking which flow keeps that promise.
 *
 * AN UNRESOLVED CLAIM SUPPRESSES NOTHING. `capability.requirement-unrealized`
 * counts only RESOLVED claims, so a typo'd `#req-` tag leaves the requirement
 * reported as realized by nobody — which is the truth, and is exactly what a
 * broken claim should not be able to hide. The two findings arriving together is
 * the intended reading: one says the tag is wrong, the other says the promise is
 * still unkept.
 */
import {
  REQ_TAG_PREFIX,
  tagSlug,
  resolveRequirementTags,
  type CapabilityClaim,
  type RequirementClaim,
} from "../../../../core/capabilities/usecase-join.js";
import type { ParsedView } from "../../../../core/c4/parsed/dynamic-views.js";
import type { Finding } from "../../../../core/vocabulary/report.js";
import { viewPlace } from "./place.js";

/** A `Requirement-ID` as an author must write it in a tag: `CHK.ONCE (#req-CHK-ONCE)`. */
function idAndTag(id: string): string {
  return `${id} (#${REQ_TAG_PREFIX}${tagSlug(id)})`;
}

/**
 * The fix for one unresolved claim. The `unscoped` arm splits in two on the
 * count, because none and several are opposite mistakes: one author forgot to
 * say which capability, the other said two and left the id homeless.
 */
function advice(claim: Exclude<RequirementClaim, { kind: "resolved" }>): string {
  switch (claim.kind) {
    case "unscoped":
      return claim.capabilities.length === 0
        ? "the view carries no `#cap-` tag that resolves to a declared capability, and a `Requirement-ID` is " +
            "unique only inside its own document — so there is nothing for this id to be looked up in. " +
            "Add the `#cap-<slug>` tag naming the capability this flow is about."
        : `the view resolves ${claim.capabilities.length} capabilities (${claim.capabilities.join(", ")}), ` +
            "so nothing says which document the id belongs to. A flow realizing promises from two capabilities " +
            "needs one `#req-` tag per capability to be unambiguous, which the tag grammar cannot express — " +
            "split the flow, or drop the `#req-` tag and let `Realizes:` on the service requirements carry it.";
    case "undocumented":
      return (
        `capability '${claim.capability}' is declared but has no capabilities/${claim.capability}/spec.md, ` +
        "so it carries no requirements to satisfy. Write the document — a name alone can be claimed with " +
        "`#cap-`, but only a document has promises a flow can keep."
      );
    case "empty":
      return (
        `capabilities/${claim.capability}/spec.md exists and declares no requirements yet — ` +
        "add the `## Requirements` section, each requirement carrying its `Requirement-ID:`."
      );
    case "none":
      return claim.close.length > 0
        ? `capabilities/${claim.capability}/spec.md declares no requirement flattening to '${claim.slug}'. ` +
            `Did you mean: ${claim.close.map(idAndTag).join(", ")}?`
        : `capabilities/${claim.capability}/spec.md declares no requirement flattening to '${claim.slug}' — ` +
            "check the `Requirement-ID:` lines in that document.";
    default:
      return (
        `${claim.ids.length} requirements of '${claim.capability}' flatten to '${claim.slug}' ` +
        `(${claim.ids.join(", ")}) — nothing in the tag can say which promise this flow keeps. ` +
        "Rename one of them: a guessed requirement reports the wrong promise as kept and the right one as " +
        "unimplemented, and both answers look exactly like the truth."
      );
  }
}

/**
 * One finding per `#req-` tag that does not resolve — never one per view.
 *
 * Several `#req-` tags on one view are legal and normal: a checkout flow that
 * charges once AND honours the price keeps two promises, and there is no honest
 * way to make its author pick one. So a broken tag beside a working one must
 * neither swallow the break nor lose the promise the view genuinely does keep.
 *
 * `claims` is the view's OWN capability verdicts, already resolved by the
 * caller — passed rather than recomputed so the scope this grade uses and the
 * scope `capabilityTagFindings` graded are the same list, and an unresolved
 * `#cap-` tag cannot silently scope a requirement lookup.
 */
export function requirementTagFindings(
  view: ParsedView,
  claims: readonly CapabilityClaim[],
  requirementsOf: (capability: string) => ReadonlySet<string> | undefined,
): Finding[] {
  const scope = claims.flatMap((claim) => (claim.kind === "resolved" ? [claim.id] : []));
  const findings: Finding[] = [];
  for (const claim of resolveRequirementTags(view.tags, scope, requirementsOf)) {
    if (claim.kind === "resolved") continue;
    findings.push({
      severity: "error",
      code: "usecase.requirement-unresolved",
      // The VIEW, not the tag — a subject is what a reader goes and opens, and
      // one broken use case counts once however many of its tags are wrong.
      subject: view.id,
      message: `${viewPlace(view)} is tagged #${claim.tag}, and it does not resolve: ${advice(claim)}`,
    });
  }
  return findings;
}
