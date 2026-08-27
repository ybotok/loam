/**
 * The join from a use case's tags back to a declared capability id.
 *
 * A LikeC4 `dynamic view` opts in to being graded as a business use case by
 * carrying a tag `#cap-<slug>`, and this module is the whole of what that tag
 * means. It is deliberately the narrowest layer that can mean it: no file is
 * read, no finding is emitted, and nothing is thrown — a pure function over ids
 * somebody else supplies. That last property is not tidiness. Its caller runs
 * inside `loam validate --all` over every document a fleet has, and the one
 * behaviour a check added to that run may never have is failing the run it was
 * added to.
 *
 * WHY A SLUG AT ALL. A capability id spells its nesting inside the id —
 * `identity/tokens` and `payments/settlement` both ship in loam's own
 * `examples/docs/architecture/capabilities.yaml`, and `./capabilities.ts` keeps
 * the key exactly as the requirement writes it, slashes preserved. A LikeC4 tag
 * name cannot carry a `/` (a hard parse error at the 1.59.2 pin, measured in
 * `test/likec4-view-shape.test.ts`), so the tag carries the id with its slashes
 * flattened and the join runs over the flattened form.
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
 * A declared capability id as its tag spells it: slashes flattened to hyphens.
 *
 * `replaceAll`, not `replace` — `a/b/c` is a legal three-level id and a
 * single-replacement slug would leave the second slash in a tag name LikeC4
 * refuses to parse, which reads to the author as "loam told me to write
 * something illegal".
 *
 * Deliberately lossy, and `resolveCapabilityTags` below carries the whole cost
 * of that: two ids can produce one slug and nothing here notices.
 */
export function capabilitySlug(id: string): string {
  return id.replaceAll("/", "-");
}

/** The tag a claim is about, and the slug left after the prefix. */
interface ClaimTag {
  /** The tag verbatim, as the view declares it — no `#`, prefix still on. */
  tag: string;
  /** The tag with `CAP_TAG_PREFIX` removed: the name the join actually ran on. */
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
    const slug = capabilitySlug(id);
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
