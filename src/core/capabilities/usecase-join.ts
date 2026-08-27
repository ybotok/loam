/**
 * The joins from a use case's tags: back to a declared capability, and to one
 * of that capability's requirements.
 *
 * TWO TAGS, ONE CLAIM. `#cap-<slug>` says which capability a flow is about;
 * `#req-<slug>` says which of its named promises the flow satisfies. The second
 * is the architect's ANSWER to the analyst's requirement, and it is the only
 * carrier a cross-service criterion has: "I enter a login and a password and I
 * am in" cannot be promised by any single service's spec, because each promises
 * only its own part — but a flow can, because it IS the hop sequence. That is
 * why `Realizes:` on a service requirement is not enough on its own, and why
 * this join exists at all.
 *
 * THE SECOND TAG IS SCOPED BY THE FIRST. A `Requirement-ID` is unique only
 * inside its own document, so `#req-CHK-ONCE` means nothing until the view has
 * said which capability it is about. A view carrying `#req-` with no resolved
 * `#cap-`, or with two, is refused rather than guessed at — the same stance the
 * `many` arm takes one join down.
 *
 * A LikeC4 `dynamic view` opts in to being graded as a business use case by
 * carrying a tag `#cap-<slug>`, and this module is the whole of what both tags
 * mean. It is deliberately the narrowest layer that can mean it: no file is
 * read, no finding is emitted, and nothing is thrown — a pure function over ids
 * somebody else supplies. That last property is not tidiness. Its caller runs
 * inside `loam validate --all` over every document a fleet has, and the one
 * behaviour a check added to that run may never have is failing the run it was
 * added to.
 *
 * WHY A SLUG AT ALL. Neither id is spelled in characters a tag name accepts. A
 * capability id spells its nesting inside the id — `identity/tokens` and
 * `payments/settlement` both ship in loam's own
 * `examples/docs/architecture/capabilities.yaml`, and `./capabilities.ts` keeps
 * the key exactly as the requirement writes it, slashes preserved — while a
 * `Requirement-ID` may legally contain a `.`. A LikeC4 tag name accepts exactly
 * `[A-Za-z0-9_-]` (measured at the 1.59.2 pin, pinned in
 * `test/likec4-view-shape.test.ts`), so both tags carry their id with the rest
 * flattened and both joins run over the flattened form.
 *
 * WHY THE JOIN CAN ANSWER "MANY". The slug is NOT injective. `payments/refunds`
 * and `payments-refunds` are two distinct, legal, declarable ids that flatten to
 * one slug, so `#cap-payments-refunds` names both and nothing in the tag can say
 * which. loam refuses and names ambiguity rather than guessing, and here the
 * cost of guessing is unusually high: a silently-picked capability attributes a
 * whole business flow — every hop, every service, every rollup built over it —
 * to the wrong owner, and goes on doing so invisibly because the wrong answer
 * looks exactly like the right one. The "many" arm is why this returns a union
 * at all instead of `string | undefined`.
 *
 * WHAT THE CALLER STILL OWES. The vocabulary ladder in `./findings.ts` — an
 * absent or unreadable `architecture/capabilities.yaml` means total silence, not
 * a fleet full of unresolved tags — is applied BEFORE calling here. An empty
 * `declared` list at this boundary therefore means "the fleet declares no
 * capabilities", which is a real answer this module will happily grade; it does
 * not mean "there is no vocabulary", and this module cannot tell the two apart.
 */
import { closeIds } from "../c4/arch.js";
import { compareIds } from "../repo/entries.js";

/**
 * The reserved tag prefix, matched EXACTLY — case included.
 *
 * A view tag that does not start with it is not a capability claim and is
 * invisible here: `#FEAT-101`, `#platform` and `#deprecated` are the author's
 * own vocabulary and grading them would turn every existing hand-drawn view in
 * a brownfield fleet red on upgrade. The match is case-sensitive because what
 * survives it is a slug that must round-trip to a `capabilities.yaml` key, and
 * those keys are case-sensitive YAML; accepting `#Cap-checkout` here would hand
 * the lookup a slug whose case loam had already stopped believing in.
 */
export const CAP_TAG_PREFIX = "cap-";

/**
 * Every character a LikeC4 tag name accepts, at the 1.59.2 pin. A WHITELIST,
 * and that is the load-bearing choice: the complement is infinite, so a rule
 * written as "flatten a slash" is a rule that is right about one character and
 * silent about the rest.
 *
 * Measured, not assumed (`test/likec4-view-shape.test.ts` pins it): `.`, `/`,
 * `:`, a space, `+`, `@` and a non-ASCII letter each make the DECLARATION a
 * parse error — and the failure is worse than a refusal, because the parser
 * TRUNCATES the name at the offending character. `#x-a.b` comes back as
 * `["x-a"]`. Nothing in loam reads a model with errors, so the truncation
 * cannot reach a join today; it is recorded because the day something does read
 * one, a truncated tag resolves to a different, possibly real, capability.
 */
const TAG_NAME_SAFE = /[^A-Za-z0-9_-]/g;

/**
 * An id as its tag spells it: every character a tag name cannot carry flattened
 * to a hyphen.
 *
 * Used by BOTH tags this module resolves, which is why it is no longer called
 * `capabilitySlug`. A capability id spells its nesting with `/`
 * (`identity/tokens`) and a `Requirement-ID` may legally contain `.`
 * (`REQUIREMENT_ID_RE` allows it) — two different characters, one rule, because
 * an author who learns that a tag flattens the awkward character in one id
 * should not have to learn it again for the other.
 *
 * Deliberately lossy, and the `many` arms below carry the whole cost of that:
 * two ids can produce one slug and nothing here notices.
 */
export function tagSlug(id: string): string {
  return id.replace(TAG_NAME_SAFE, "-");
}

/** The tag a claim is about, and the slug left after the prefix. */
interface ClaimTag {
  /** The tag verbatim, as the view declares it — no `#`, prefix still on. */
  tag: string;
  /** The tag with its reserved prefix removed: the name the join actually ran on. */
  slug: string;
}

/**
 * What one `#cap-` tag joins to. Branch on `kind`; every arm carries the tag it
 * is about, so a message can name the tag, the slug and the answer without
 * re-deriving any of them from the view.
 */
export type CapabilityClaim =
  /** Exactly one declared id flattens to this tag. `id` is the real id, slashes intact. */
  | (ClaimTag & { kind: "resolved"; id: string })
  /**
   * No declared id flattens to it. `close` holds real capability ids — names the
   * author can paste into `capabilities.yaml` or into the tag — never the slugs
   * the comparison was actually made against, because a slug is loam's spelling
   * of a name and offering it as a suggestion would be loam inventing a
   * capability id that nobody declared.
   */
  | (ClaimTag & { kind: "none"; close: string[] })
  /** Two or more declared ids flatten to it. Every colliding id, sorted, so a message can name them all. */
  | (ClaimTag & { kind: "many"; ids: string[] });

/**
 * Every declared id that produces each slug.
 *
 * A map rather than a scan per tag because the "many" arm needs the WHOLE
 * colliding set: a lookup that stopped at the first hit could still report
 * "resolved" for a slug two ids answer to, which is precisely the silent wrong
 * answer this module exists to refuse.
 */
function idsBySlug(declared: readonly string[]): Map<string, string[]> {
  const bySlug = new Map<string, string[]>();
  for (const id of declared) {
    const slug = tagSlug(id);
    const ids = bySlug.get(slug);
    if (ids === undefined) bySlug.set(slug, [id]);
    else ids.push(id);
  }
  return bySlug;
}

/**
 * Close names for a slug nothing declares — suggested against the SLUGS, then
 * mapped back to the ids that produced them.
 *
 * Both halves are load-bearing. Comparing against slugs is what lets
 * `#cap-identiy-tokns` reach `identity/tokens` at all: `closeIds` matches on
 * substring and shared prefix, and the slash sits where the author's typo does
 * not. Mapping back is what keeps the suggestion writable — a hint naming
 * `identity-tokens` would send the author to look for a capability declared
 * under a name that appears nowhere in `capabilities.yaml`.
 *
 * A winning slug may map back to more than one id, and the expansion is not
 * re-capped: `closeIds` caps the SLUGS it offers at five, and dropping a real
 * declared id afterwards to keep an arithmetic promise nobody made would hide
 * the very collision the "many" arm is here to name.
 */
function closeCapabilityIds(slug: string, bySlug: ReadonlyMap<string, string[]>): string[] {
  const near = closeIds(slug, [...bySlug.keys()]);
  // `?? []` rather than `!`: `closeIds` promises every name it offers is one it
  // was given, so a miss here would mean that promise broke — and the honest
  // answer to a broken invariant inside a hint is one fewer suggestion, not a
  // `TypeError` thrown out of a `validate --all` run over somebody's fleet.
  return [...new Set(near.flatMap((s) => bySlug.get(s) ?? []))].sort(compareIds);
}

/**
 * The capability claims a view's tags make: one claim per `#cap-` tag, each
 * answered on its own terms.
 *
 * A VIEW MAY CARRY MORE THAN ONE `#cap-` TAG, and the tags are never collapsed
 * into a single verdict for the view. Both halves of that are deliberate.
 *
 * A use case realizing two capabilities is a real thing — a checkout flow that
 * also issues the identity token realizes both, and there is no honest way to
 * make its author pick one — so a second tag must NOT be read the way the "many"
 * arm reads a second colliding id. Those two look alike and are opposites: in
 * "many" the author wrote one name and loam cannot tell which id it means, here
 * the author wrote two names and meant both.
 *
 * And a view whose tags disagree — one resolving, one naming nothing — is not a
 * view that resolved. Collapsing to the first success would swallow the broken
 * tag and grade the view as if the typo were not there; collapsing to the first
 * failure would lose the capability the view genuinely does realize. One tag,
 * one verdict, is the only shape that keeps both facts, and it leaves the caller
 * free to emit one finding per failing tag while still collecting every id the
 * view resolved.
 *
 * Claims come back SORTED BY TAG rather than in the order LikeC4 handed the tags
 * over. Nothing in loam has measured that LikeC4 preserves the author's tag
 * order, and an output ordered by an unmeasured upstream detail is one that
 * reorders under a version bump — the diff-stability rule `./rollup.ts` states
 * for its rows, applied to a smaller list. A repeated tag collapses to one
 * claim, for the reason one breach earns one finding.
 *
 * An empty result means the view makes no capability claim at all — either it
 * carries no tags or none of them are reserved — which is the opt-in, not a
 * failure to resolve.
 */
export function resolveCapabilityTags(
  tags: readonly string[],
  declared: readonly string[],
): CapabilityClaim[] {
  const bySlug = idsBySlug(declared);
  const claimed = [...new Set(tags.filter((tag) => tag.startsWith(CAP_TAG_PREFIX)))].sort(compareIds);

  return claimed.map((tag) => {
    // A bare `#cap-` slugs to the empty string, and it stays a claim on purpose:
    // the prefix is the author's opt-in however little follows it, so dropping
    // the tag as unreserved would leave a view that asked to be graded silently
    // ungraded. What that empty slug then resolves to is the lookup's business
    // like any other — `none` in every real fleet, `resolved` in the one that
    // declared an empty id, and neither is decided here.
    const slug = tag.slice(CAP_TAG_PREFIX.length);
    // Destructured rather than indexed so the three arms are told apart by the
    // shape of the match itself — no bounds assertion, and no `undefined` check
    // separate from the "nothing declared this" answer it already is.
    const [first, ...rest] = bySlug.get(slug) ?? [];
    if (first === undefined) return { tag, slug, kind: "none" as const, close: closeCapabilityIds(slug, bySlug) };
    if (rest.length === 0) return { tag, slug, kind: "resolved" as const, id: first };
    return { tag, slug, kind: "many" as const, ids: [first, ...rest].sort(compareIds) };
  });
}

/**
 * The reserved tag prefix for the requirement claim, matched EXACTLY as
 * `CAP_TAG_PREFIX` is and for the same two reasons: a tag that does not start
 * with it is the author's own vocabulary and is invisible here, and the slug
 * that survives the match must round-trip to a case-sensitive `Requirement-ID:`.
 */
export const REQ_TAG_PREFIX = "req-";

/**
 * What one `#req-` tag joins to, given the capabilities the same view resolved.
 *
 * Five arms because there are five different fixes, and they are deliberately
 * the same five `RealizesClaim` draws in `./realizes/join.ts`: the two carriers
 * of one claim must fail in the same vocabulary, or an author who learns the
 * `Realizes:` messages learns nothing about the tag.
 */
export type RequirementClaim =
  /** Exactly one requirement of the scoping capability flattens to this tag. */
  | (ClaimTag & { kind: "resolved"; capability: string; id: string })
  /**
   * The view resolved no capability, or more than one, so a `Requirement-ID`
   * has no document to be unique inside. `capabilities` is what it DID resolve
   * — empty, or the two-or-more that make the scope ambiguous.
   */
  | (ClaimTag & { kind: "unscoped"; capabilities: string[] })
  /** The scoping capability is declared but has no `capabilities/<id>/spec.md`, so it carries no requirements. */
  | (ClaimTag & { kind: "undocumented"; capability: string })
  /** Its document exists and declares no requirements yet. */
  | (ClaimTag & { kind: "empty"; capability: string })
  /**
   * Its document declares requirements, none flattening to this slug. `close`
   * holds real `Requirement-ID`s — never the slugs the comparison ran against,
   * because a slug is loam's spelling and offering it would send the author
   * looking for an id that appears nowhere in the document.
   */
  | (ClaimTag & { kind: "none"; capability: string; close: string[] })
  /** Two or more of its requirement ids flatten to this slug. Every colliding id, sorted. */
  | (ClaimTag & { kind: "many"; capability: string; ids: string[] });

/**
 * Resolve every `#req-` tag a view carries against the capability it is about.
 *
 * `scope` is the capability ids the view's OWN `#cap-` tags resolved to —
 * `resolveCapabilityTags`' `resolved` arms, and nothing else. An unresolved
 * `#cap-` tag is already `usecase.capability-unresolved`, and letting it also
 * scope a requirement lookup would build a second finding on top of a name loam
 * has just said it cannot place.
 *
 * Claims come back SORTED BY TAG for `resolveCapabilityTags`' reason: nothing in
 * loam has measured that LikeC4 preserves the author's tag order, and an output
 * ordered by an unmeasured upstream detail reorders under a version bump. A
 * repeated tag collapses to one claim, for the reason one breach earns one
 * finding.
 *
 * SEVERAL `#req-` TAGS ARE LEGAL AND NORMAL. One flow commonly satisfies two of
 * a capability's promises — a checkout flow that charges once AND honours the
 * price — and there is no honest way to make its author pick one. That is the
 * same shape `resolveCapabilityTags` allows for `#cap-`, and it is the opposite
 * of the `many` arm: there the author wrote one name loam cannot place, here
 * they wrote two and meant both.
 */
export function resolveRequirementTags(
  tags: readonly string[],
  scope: readonly string[],
  requirementsOf: (capability: string) => ReadonlySet<string> | undefined,
): RequirementClaim[] {
  const claimed = [...new Set(tags.filter((tag) => tag.startsWith(REQ_TAG_PREFIX)))].sort(compareIds);
  if (claimed.length === 0) return [];
  const capability = scope.length === 1 ? scope[0]! : null;

  return claimed.map((tag): RequirementClaim => {
    // A bare `#req-` slugs to the empty string and stays a claim, exactly as a
    // bare `#cap-` does: the prefix is the opt-in however little follows it, and
    // dropping it would leave a view that asked to be graded silently ungraded.
    const slug = tag.slice(REQ_TAG_PREFIX.length);
    if (capability === null) return { tag, slug, kind: "unscoped", capabilities: [...scope].sort(compareIds) };
    const ids = requirementsOf(capability);
    if (ids === undefined) return { tag, slug, kind: "undocumented", capability };
    if (ids.size === 0) return { tag, slug, kind: "empty", capability };
    const matching = [...ids].filter((id) => tagSlug(id) === slug).sort(compareIds);
    const [first, ...rest] = matching;
    if (first === undefined) {
      return { tag, slug, kind: "none", capability, close: closeRequirementIds(slug, ids) };
    }
    if (rest.length === 0) return { tag, slug, kind: "resolved", capability, id: first };
    return { tag, slug, kind: "many", capability, ids: matching };
  });
}

/**
 * Close ids for a slug nothing in the document matches — suggested against the
 * SLUGS, then mapped back to the real ids, exactly as `closeCapabilityIds`
 * does and for its two reasons: comparing on slugs is what lets a typo reach an
 * id whose awkward character sits where the typo does not, and mapping back is
 * what keeps the suggestion writable.
 */
function closeRequirementIds(slug: string, ids: ReadonlySet<string>): string[] {
  const bySlug = new Map<string, string[]>();
  for (const id of ids) {
    const key = tagSlug(id);
    const found = bySlug.get(key);
    if (found === undefined) bySlug.set(key, [id]);
    else found.push(id);
  }
  const near = closeIds(slug, [...bySlug.keys()]);
  return [...new Set(near.flatMap((s) => bySlug.get(s) ?? []))].sort(compareIds);
}
