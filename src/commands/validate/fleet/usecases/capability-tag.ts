/**
 * `usecase.capability-unresolved` — the `#cap-` tag that names no declared
 * capability, or more than one.
 *
 * The join itself lives in `core/capabilities/usecase-join.ts` and none of it is
 * repeated here: this module owns the grade and the sentence, nothing else. That
 * split is why the tag can answer "many" at all — the slug is not injective, so
 * `payments/refunds` and `payments-refunds` both flatten to
 * `payments-refunds` — and why the close candidates a message offers are real
 * declared ids rather than loam's flattened spelling of them.
 *
 * ERROR, the same grade `capability.unknown` carries on a `Capability:` line and
 * for its reason: an invented capability reads exactly like a real one. Here it
 * reads that way at flow altitude — the tag is what files a whole business
 * sequence under an owner, so a claim that resolves to nothing produces a use
 * case nobody can find and a capability nobody can see is realized.
 *
 * SUPPRESSED ENTIRELY when the vocabulary is absent or unreadable: the caller
 * resolves no claims at all in that case, so this answers with nothing. The
 * claims are RESOLVED BY THE CALLER rather than here because the `#req-` grade
 * beside this one is scoped by the very same verdicts, and two resolutions of
 * one view's tags are two chances to disagree about which capability a flow is
 * about. The ladder that produces the suppressing `null` is
 * `gradableCapabilityIds` in `core/capabilities/findings.ts` — one function, called by every site that needs the graded id list, this module's
 * caller in `../landscape.ts` included. The FILE is this axis's opt-in, so a
 * fleet with no `architecture/capabilities.yaml` produces no capability finding
 * at all, and an unreadable one is `capability.invalid` alone rather than one
 * unresolved tag per use case in the fleet, which is a cascade and not a
 * diagnosis. That rule is not re-decided here: a second reading of
 * `CapabilityVocabulary` anywhere in this package is the copy that goes stale
 * the day a fourth un-gradable state is added, so call the function.
 */
import {
  CAP_TAG_PREFIX,
  tagSlug,
  type CapabilityClaim,
} from "../../../../core/capabilities/usecase-join.js";
import type { ParsedView } from "../../../../core/c4/parsed/dynamic-views.js";
import type { Finding } from "../../../../core/vocabulary/report.js";
import { viewPlace } from "./place.js";

/** A capability id as an author must write it in a tag: `identity/tokens (#cap-identity-tokens)`. */
function idAndTag(id: string): string {
  return `${id} (#${CAP_TAG_PREFIX}${tagSlug(id)})`;
}

/**
 * A tag nothing declares, with the close names spelled as TAGS as well as ids.
 *
 * Both spellings, because either alone sends the author somewhere wrong: the id
 * is what `capabilities.yaml` holds and the tag is what the view must carry, and
 * an author handed only `identity/tokens` writes `#cap-identity/tokens`, which
 * LikeC4 refuses to parse. The flattening rule is stated in the same breath so
 * the reader can derive the next one without being told again.
 */
function noneMessage(view: ParsedView, claim: Extract<CapabilityClaim, { kind: "none" }>): string {
  const hint =
    claim.close.length > 0
      ? `Did you mean: ${claim.close.map(idAndTag).join(", ")}?`
      : "Declare it there (`capabilities: {<id>: {description, owner}}`), or fix the tag.";
  return (
    `${viewPlace(view)} is tagged #${claim.tag}, and no capability declared in ` +
    `architecture/capabilities.yaml flattens to '${claim.slug}'. ${hint} ` +
    "A tag spells the id with every character outside `[A-Za-z0-9_-]` flattened to `-`, because that is all a LikeC4 tag name accepts."
  );
}

/**
 * A tag two or more declared ids answer to. Every colliding id is named — a
 * message that stopped at the first would be reporting the ambiguity while
 * hiding half of what makes it one.
 */
function manyMessage(view: ParsedView, claim: Extract<CapabilityClaim, { kind: "many" }>): string {
  return (
    `${viewPlace(view)} is tagged #${claim.tag}, and ${claim.ids.length} declared capabilities flatten to ` +
    `'${claim.slug}' (${claim.ids.join(", ")}) — nothing in the tag can say which one this use case realizes. ` +
    "Rename one of them in architecture/capabilities.yaml: a guessed capability files every hop of the flow, " +
    "and every rollup built over it, under an owner who never claimed it — and the wrong answer looks exactly " +
    "like the right one."
  );
}

/**
 * One finding per `#cap-` tag that does not resolve — never one per view.
 *
 * A view may legitimately carry two capability tags (a checkout flow that also
 * issues the identity token realizes both), and `resolveCapabilityTags` answers
 * each on its own terms for that reason. Collapsing them here would either
 * swallow a broken tag beside a working one or lose the capability the view
 * genuinely does realize; one tag, one verdict, one finding keeps both facts.
 */
export function capabilityTagFindings(view: ParsedView, claims: readonly CapabilityClaim[]): Finding[] {
  const findings: Finding[] = [];
  for (const claim of claims) {
    if (claim.kind === "resolved") continue;
    findings.push({
      severity: "error",
      code: "usecase.capability-unresolved",
      // The VIEW, not the tag: a subject is what a reader goes and opens, and
      // `subjectsWith` counts one broken use case once however many of its tags
      // are wrong.
      subject: view.id,
      message: claim.kind === "none" ? noneMessage(view, claim) : manyMessage(view, claim),
    });
  }
  return findings;
}
