/**
 * The capability-tag join: `#cap-<slug>` on a `dynamic view`, back to a
 * declared id in `architecture/capabilities.yaml`.
 *
 * Every case here exists to fail against a specific wrong implementation rather
 * than to restate the code, because the wrong implementations are all quiet
 * ones. A slug that is an identity function silently un-grades every nested
 * capability the example fleet already ships. A resolver without its "many" arm
 * attributes a whole business flow to whichever of two colliding ids came first
 * out of the YAML. A suggestion offered as a slug sends the author looking for a
 * capability name that appears nowhere in the file they are being told to fix.
 * A view's second `#cap-` tag dropped on the floor loses either a real
 * capability or a real typo. None of those announce themselves.
 */
import { describe, expect, it } from "vitest";
import {
  CAP_TAG_PREFIX,
  tagSlug,
  resolveCapabilityTags,
  type CapabilityClaim,
} from "../src/core/capabilities/usecase-join.js";

/** The one claim a single-tag view makes — the shape nearly every case asserts on. */
function only(tags: string[], declared: string[]): CapabilityClaim {
  const claims = resolveCapabilityTags(tags, declared);
  expect(claims).toHaveLength(1);
  // Non-null is proved by the assertion above; `noUncheckedIndexedAccess` cannot
  // see it, and a `!` here is the form CODE-STYLE calls locally provable.
  return claims[0]!;
}

describe("tagSlug", () => {
  it("leaves a flat id alone — the tag and the id are the same string", () => {
    expect(tagSlug("checkout")).toBe("checkout");
    expect(tagSlug("order-notifications")).toBe("order-notifications");
  });

  it("flattens the slash a LikeC4 tag name cannot carry", () => {
    // Both of these ship in examples/docs/architecture/capabilities.yaml, so the
    // nesting is not hypothetical: loam's own published example is untaggable
    // without this line.
    expect(tagSlug("identity/tokens")).toBe("identity-tokens");
    expect(tagSlug("payments/settlement")).toBe("payments-settlement");
  });

  it("flattens EVERY slash, not the first — `replace` would leave a tag that will not parse", () => {
    expect(tagSlug("a/b/c")).toBe("a-b-c");
    expect(tagSlug("payments/refunds/partial")).toBe("payments-refunds-partial");
  });
});

describe("the reserved prefix", () => {
  it("is `cap-`", () => {
    expect(CAP_TAG_PREFIX).toBe("cap-");
  });

  it("makes an unreserved tag invisible — a brownfield fleet's own tags are not claims", () => {
    // The opt-in is the whole reason the step codes can ship at error severity.
    // A join that graded every tag would turn every hand-drawn dynamic view in
    // a 120-service fleet red on upgrade.
    expect(resolveCapabilityTags(["FEAT-101", "platform", "deprecated", ""], ["checkout"])).toEqual([]);
  });

  it("is matched case-sensitively, so a slug's case survives to the YAML key", () => {
    expect(resolveCapabilityTags(["Cap-checkout", "CAP-checkout"], ["checkout"])).toEqual([]);
  });

  it("reads a bare `cap-` as a claim that resolves to nothing, never as an unreserved tag", () => {
    // The prefix is the author's opt-in however little follows it. Dropping the
    // tag as unreserved would leave a view that asked to be graded ungraded.
    const claim = only(["cap-"], ["checkout"]);
    expect(claim.kind).toBe("none");
    expect(claim.slug).toBe("");
  });
});

describe("resolved", () => {
  it("carries the declared id when exactly one flattens to the tag", () => {
    expect(only(["cap-checkout"], ["checkout", "order-notifications"])).toEqual({
      tag: "cap-checkout",
      slug: "checkout",
      kind: "resolved",
      id: "checkout",
    });
  });

  it("resolves a NESTED id through its slug, and carries the id with its slash back", () => {
    // The identity-slug mutant dies here: `#cap-identity-tokens` matches no
    // declared id at all if the slug does not flatten, so the fleet's nested
    // capabilities become permanently unresolvable.
    expect(only(["cap-identity-tokens"], ["identity/tokens", "checkout"])).toEqual({
      tag: "cap-identity-tokens",
      slug: "identity-tokens",
      kind: "resolved",
      id: "identity/tokens",
    });
  });
});

describe("none", () => {
  it("suggests REAL ids — slashes restored — never the slugs the comparison ran on", () => {
    // `identity-tokens` is loam's spelling; `identity/tokens` is the author's.
    // A hint naming the former sends them to grep capabilities.yaml for a key
    // that is not in it.
    const claim = only(["cap-identiy-tokns"], ["identity/tokens", "checkout"]);
    expect(claim).toEqual({
      tag: "cap-identiy-tokns",
      slug: "identiy-tokns",
      kind: "none",
      close: ["identity/tokens"],
    });
  });

  it("expands a suggested slug back to EVERY id that produced it, sorted", () => {
    // Two slugs come back from closeIds; three ids go out, because one of those
    // slugs is itself a collision. Re-capping the expansion would hide it.
    const claim = only(["cap-paymnts-refunds"], ["payments/refunds", "payments-refunds", "payments/settlement"]);
    expect(claim.kind).toBe("none");
    expect(claim.kind === "none" && claim.close).toEqual([
      "payments-refunds",
      "payments/refunds",
      "payments/settlement",
    ]);
  });

  it("offers nothing when nothing is close, rather than the nearest thing it has", () => {
    const claim = only(["cap-zzz"], ["checkout", "identity/tokens"]);
    expect(claim).toEqual({ tag: "cap-zzz", slug: "zzz", kind: "none", close: [] });
  });

  it("answers every tag `none` when the fleet declares no capabilities at all", () => {
    // An empty vocabulary is a real answer here, not an absent one — the
    // file-as-opt-in ladder is the CALLER's, and this asserts the boundary is
    // where the module comment says it is.
    expect(only(["cap-checkout"], [])).toEqual({
      tag: "cap-checkout",
      slug: "checkout",
      kind: "none",
      close: [],
    });
  });
});

describe("many", () => {
  it("refuses a colliding slug and names every id, sorted", () => {
    // `payments/refunds` and `payments-refunds` are two distinct legal ids and
    // one tag. Picking either would attribute the flow to the wrong owner and
    // look exactly like the right answer while doing it.
    expect(only(["cap-payments-refunds"], ["payments/refunds", "payments-refunds"])).toEqual({
      tag: "cap-payments-refunds",
      slug: "payments-refunds",
      kind: "many",
      ids: ["payments-refunds", "payments/refunds"],
    });
  });

  it("names the same set whichever order the ids were declared in", () => {
    const forward = only(["cap-payments-refunds"], ["payments/refunds", "payments-refunds"]);
    const reverse = only(["cap-payments-refunds"], ["payments-refunds", "payments/refunds"]);
    expect(forward).toEqual(reverse);
  });

  it("holds for a three-way collision — the arm is a set, not a pair", () => {
    const claim = only(["cap-a-b-c"], ["a/b/c", "a-b/c", "a/b-c"]);
    expect(claim.kind).toBe("many");
    expect(claim.kind === "many" && claim.ids).toEqual(["a-b/c", "a/b-c", "a/b/c"]);
  });
});

describe("a view carrying more than one `#cap-` tag", () => {
  it("answers both, because a use case realizing two capabilities is a real thing", () => {
    expect(resolveCapabilityTags(["cap-checkout", "cap-identity-tokens"], ["checkout", "identity/tokens"])).toEqual([
      { tag: "cap-checkout", slug: "checkout", kind: "resolved", id: "checkout" },
      { tag: "cap-identity-tokens", slug: "identity-tokens", kind: "resolved", id: "identity/tokens" },
    ]);
  });

  it("keeps the broken tag AND the good one when they disagree", () => {
    // Collapsing to the first success swallows the typo; collapsing to the
    // first failure loses the capability the view really does realize.
    const claims = resolveCapabilityTags(["cap-checkout", "cap-nosuch"], ["checkout"]);
    expect(claims.map((c) => c.kind)).toEqual(["resolved", "none"]);
    expect(claims.map((c) => c.tag)).toEqual(["cap-checkout", "cap-nosuch"]);
  });

  it("does not let a second tag turn a resolvable one ambiguous", () => {
    // Two tags are not a collision: there the author wrote one name loam cannot
    // place, here two names it can.
    const claims = resolveCapabilityTags(["cap-checkout", "cap-order-notifications"], [
      "checkout",
      "order-notifications",
    ]);
    expect(claims.every((c) => c.kind === "resolved")).toBe(true);
  });

  it("collapses a repeated tag to one claim — one breach earns one finding", () => {
    expect(resolveCapabilityTags(["cap-nosuch", "cap-nosuch"], ["checkout"])).toHaveLength(1);
  });

  it("comes back in tag order whatever order LikeC4 handed the tags over", () => {
    // Nothing in loam has measured that LikeC4 preserves the author's tag
    // order, so ordering the output by it would reorder a fleet's findings on a
    // version bump.
    const declared = ["alpha", "beta", "gamma"];
    const sorted = ["cap-alpha", "cap-beta", "cap-gamma"];
    expect(resolveCapabilityTags(["cap-gamma", "cap-alpha", "cap-beta"], declared).map((c) => c.tag)).toEqual(sorted);
    expect(resolveCapabilityTags(["cap-beta", "cap-gamma", "cap-alpha"], declared).map((c) => c.tag)).toEqual(sorted);
  });

  it("ignores unreserved tags sitting between the reserved ones", () => {
    const claims = resolveCapabilityTags(["FEAT-101", "cap-checkout", "platform"], ["checkout"]);
    expect(claims.map((c) => c.tag)).toEqual(["cap-checkout"]);
  });
});

describe("it never throws inside a validate run", () => {
  it("answers an untagged view with no claims", () => {
    expect(resolveCapabilityTags([], ["checkout"])).toEqual([]);
    expect(resolveCapabilityTags([], [])).toEqual([]);
  });

  it("survives a declared id that is itself empty or all slashes", () => {
    expect(() => resolveCapabilityTags(["cap-", "cap-checkout"], ["", "/", "//", "checkout"])).not.toThrow();
    // An empty id slugs to the empty string, so `#cap-` genuinely names it and
    // the honest answer is `resolved`. This is also the guard on the lookup
    // testing PRESENCE rather than truthiness: `if (!first)` would report `none`
    // here, and would go on to report `none` for any falsy id a fleet declares.
    const claims = resolveCapabilityTags(["cap-"], ["", "checkout"]);
    expect(claims.map((c) => c.kind)).toEqual(["resolved"]);
  });
});
