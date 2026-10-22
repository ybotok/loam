/**
 * Where an edge with no anchor lands on a map whose relationships somebody
 * wrote by hand — sections, comments, an order nobody sorted.
 *
 * Measured on a real fleet (2026-10) and rebuilt here on neutral shapes: an
 * edge from a service the same archive adds has no neighborhood, so it falls to
 * the trailing walk, which insertion-sorts it among the cluster heads. Two
 * things went wrong on a hand-written region:
 *
 *  - the walk stopped BEFORE a statement and spliced at that statement's own
 *    line, below the comment written over it — the new edge sat between a
 *    section's explanation and the edge it explains;
 *  - the region is sorted by nobody, so where the walk stopped was a function
 *    of unrelated edges: turning one of them round (`zulu -> beta` to
 *    `beta -> zulu`) moved the addition to another section.
 *
 * The fix keeps a comment written directly over a statement — or over the
 * closing brace — with what follows it, and sorts only within the region's
 * ascending tail. Both must leave placement order-independent, which the last
 * block proves on the same hand-written map.
 */
import { describe, expect, it } from "vitest";
import { loadSource } from "../src/core/c4/likec4.js";
import { scanModel } from "../src/core/c4/source-scan.js";
import { assertSpliceVisible, LandscapeSpliceError } from "../src/core/c4/splice/contract.js";
import { planLandscapeMerge } from "../src/core/c4/splice/landscape-merge.js";

const SPEC = `specification {
  element softwareSystem
  tag FEAT-7
  tag FEAT-8
  tag FEAT-9
}
`;

/** The hand-written map. `r2` is the edge one copy draws the other way round. */
const map = (r2: string, tail = ""): string => `${SPEC}
model {
  alpha = softwareSystem 'alpha-service'
  beta = softwareSystem 'beta-service'
  omega = softwareSystem 'omega-service'
  zulu = softwareSystem 'zulu-service'

  // ---- alpha: its one call
  alpha -> beta 'r1'
  // ---- zulu: drawn by hand, and out of any order
  // a second line about zulu
  ${r2}
  // ---- omega
  omega -> beta 'r3'
${tail}}
`;
const D0 = map("zulu -> beta 'r2'");
const D1 = map("beta -> zulu 'r2'");

/** A feature adding a new service `id` and one edge from it to beta. */
const delta = (feat: string, id: string): string => `${SPEC}
model {
  beta = softwareSystem 'beta-service'
  ${id} = softwareSystem '${id}-service' {
    #${feat}
  }
  ${id} -> beta 'Pulls settled payments' {
    #${feat}
  }
}
`;

/** One archive's landscape merge, as `loam archive` plans it. */
async function merge(land: string, deltaText: string, featureId: string): Promise<string> {
  expect((await loadSource(land)).errors, "the map must be valid, or the case proves nothing").toEqual([]);
  const d = await loadSource(deltaText);
  expect(d.errors).toEqual([]);
  const plan = await planLandscapeMerge({
    landscapeText: land,
    deltaText,
    deltaElements: d.elements,
    newEls: d.elements.filter((e) => e.tags.includes(featureId)),
    newRels: d.relationships.filter((r) => r.tags.includes(featureId)),
    featureId,
  });
  const merged = plan.content ?? land;
  expect((await loadSource(merged)).errors).toEqual([]);
  return merged;
}

describe("an edge with no anchor, on a map written by hand", () => {
  it("never lands between a comment and the statement it is written over", async () => {
    const merged = await merge(D0, delta("FEAT-7", "kilo"), "FEAT-7");
    expect(merged).not.toContain("// a second line about zulu\n  kilo ->");
    expect(merged).toContain("  zulu -> beta 'r2'\n  kilo -> beta 'Pulls settled payments'\n  // ---- omega\n  omega -> beta 'r3'\n");
  });

  it("lands in the same place whichever way an unrelated edge is drawn", async () => {
    const d0 = await merge(D0, delta("FEAT-7", "kilo"), "FEAT-7");
    const d1 = await merge(D1, delta("FEAT-7", "kilo"), "FEAT-7");
    expect(d0).toContain("  zulu -> beta 'r2'\n  kilo -> beta 'Pulls settled payments'\n  // ---- omega\n");
    expect(d1).toContain("  beta -> zulu 'r2'\n  kilo -> beta 'Pulls settled payments'\n  // ---- omega\n");
  });

  it("does not step into the tail of a block comment opened on the line above", async () => {
    // Splicing at the start of "runs on */" would put the edge inside the comment.
    const land = map("zulu -> beta 'r2'").replace("  // ---- omega\n", "  /* a note that\n     runs on */\n");
    const merged = await merge(land, delta("FEAT-7", "kilo"), "FEAT-7");
    expect(merged).toContain("     runs on */\n  kilo -> beta 'Pulls settled payments'\n  omega -> beta 'r3'\n");
  });

  it("does not step into a block comment whose last line reads like a line comment", async () => {
    // Judged line by line, "// legacy -> omega */" is a line comment; it is the
    // tail of the block above, and the edge spliced at its start was inside
    // the comment — a map that parsed clean with the edge gone (review, 2026-10-22).
    const land = map("zulu -> beta 'r2'").replace("  // ---- omega\n", "  /*\n  retired:\n  legacy -> beta\n\n  // legacy -> omega */\n");
    const merged = await merge(land, delta("FEAT-7", "kilo"), "FEAT-7");
    expect(merged).toContain("  // legacy -> omega */\n  kilo -> beta 'Pulls settled payments'\n  omega -> beta 'r3'\n");
    expect((await loadSource(merged)).relationships.map((r) => r.title)).toContain("Pulls settled payments");
  });
});

describe("a splice the splice map cannot see afterwards", () => {
  it("is refused as a merge failure, never reported merged", () => {
    // The backstop under every placement rule: an insert that adds no statement
    // the next scan sees went inside a comment or a string.
    const before = scanModel("model {\n  a -> b\n}\n");
    const after = scanModel("model {\n  a -> b\n  // c -> d\n}\n");
    expect(() => assertSpliceVisible(before, after, "c -> d")).toThrow(LandscapeSpliceError);
    expect(() => assertSpliceVisible(before, scanModel("model {\n  a -> b\n  c -> d\n}\n"), "c -> d")).not.toThrow();
  });
});

describe("placement stays order-independent on the same map", () => {
  // kilo and lima land in the gap above omega's comment; xray sorts past every
  // head and lands at the end of the block, above the comment written over the
  // closing brace. Every permutation, and one archive carrying all three.
  const LAND = map("zulu -> beta 'r2'", "  // the end of the edges\n");
  const FEATS: Array<[string, string]> = [
    ["FEAT-7", "kilo"],
    ["FEAT-8", "lima"],
    ["FEAT-9", "xray"],
  ];

  it("every archive order writes the same bytes", async () => {
    const orders: Array<Array<[string, string]>> = [];
    for (const a of FEATS) for (const b of FEATS) for (const c of FEATS) {
      if (new Set([a, b, c]).size === 3) orders.push([a, b, c]);
    }
    const results: string[] = [];
    for (const order of orders) {
      let land = LAND;
      for (const [feat, id] of order) land = await merge(land, delta(feat, id), feat);
      results.push(land);
    }
    for (let i = 1; i < results.length; i += 1) {
      expect(results[i], `order ${orders[i]!.map(([f]) => f).join(",")}`).toBe(results[0]);
    }
    expect(results[0]).toContain(
      "  zulu -> beta 'r2'\n  kilo -> beta 'Pulls settled payments'\n  lima -> beta 'Pulls settled payments'\n  // ---- omega\n" +
        "  omega -> beta 'r3'\n  xray -> beta 'Pulls settled payments'\n  // the end of the edges\n}",
    );
  });
});
