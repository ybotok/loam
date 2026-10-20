/**
 * What else a line holds, besides the statement placement splices beside or
 * into — another declaration, a comment — and where the splice lands for it.
 *
 * Placement reads LINES: an addition anchored after a statement goes on the
 * line after it, a body a bodyless parent gains opens where the parent ends.
 * Each case here is a line on which that reading put the bytes somewhere the
 * parser reads differently from the author — inside another declaration's
 * body, or inside a comment — in a merge that parsed and was written at exit 0
 * (probed on main at 171555d), or one the parse net refused over a valid map.
 * The last block is the same question one level down: what shares a tag list
 * with the feature tag the splice strips.
 */
import { describe, expect, it } from "vitest";
import { loadSource } from "../src/core/c4/likec4.js";
import { planLandscapeMerge } from "../src/core/c4/splice/landscape-merge.js";
import { scanModel } from "../src/core/c4/source-scan.js";
import { spotAfter } from "../src/core/c4/splice/placement.js";

const SPEC = `specification {
  element softwareSystem
  element container
  tag FEAT-7
  tag FEAT-8
}
`;

/** One archive's landscape merge of `deltaText`'s `featureId` additions, as `loam archive` plans it. */
async function merge(land: string, deltaText: string, featureId: string): Promise<string> {
  expect((await loadSource(land)).errors, "the map must be valid, or the case proves nothing").toEqual([]);
  const delta = await loadSource(deltaText);
  expect(delta.errors).toEqual([]);
  const plan = await planLandscapeMerge({
    landscapeText: land,
    deltaText,
    deltaElements: delta.elements,
    newEls: delta.elements.filter((e) => e.tags.includes(featureId)),
    newRels: delta.relationships.filter((r) => r.tags.includes(featureId)),
    featureId,
  });
  return plan.content ?? land;
}

/** A new service bound to `service`, added by `featureId`. */
const bound = (id: string, service: string, featureId: string): string =>
  `${SPEC}model {\n  ${id} = softwareSystem '${id}-service' {\n    #${featureId}\n    metadata { service '${service}' }\n  }\n}\n`;

/** Every element id the merged map declares, sorted. */
async function ids(text: string): Promise<string[]> {
  const doc = await loadSource(text);
  expect(doc.errors).toEqual([]);
  return doc.elements.map((e) => e.id).sort();
}

describe("an addition anchored to a statement that shares its line with the next lands right after its anchor", () => {
  it("not inside the body the next declaration opens on that line (the reported landscape)", async () => {
    // The line after alpha's `}` is inside beta: kiwi, bound to alpha's
    // service, was written there and the map declared `beta.kiwi`.
    const land = `${SPEC}model {\n  alpha = softwareSystem 'alpha-service' { metadata { service 'alpha' } }  beta = softwareSystem 'beta-service' {\n    api = container 'API'\n  }\n}\n`;
    const merged = await merge(land, bound("kiwi", "alpha", "FEAT-7"), "FEAT-7");
    expect(await ids(merged)).toEqual(["alpha", "beta", "beta.api", "kiwi"]);
    expect(merged).toBe(
      `${SPEC}model {\n  alpha = softwareSystem 'alpha-service' { metadata { service 'alpha' } }\n` +
        `  kiwi = softwareSystem 'kiwi-service' {\n    metadata { service 'alpha' }\n  }\n` +
        `  beta = softwareSystem 'beta-service' {\n    api = container 'API'\n  }\n}\n`,
    );
  });

  it("archive order does not change the bytes when both anchors share that line", async () => {
    // Both anchors used to splice at the next line's start, so whichever
    // archive ran second landed above the other.
    const land = `${SPEC}model {\n  alpha = softwareSystem 'alpha-service' { metadata { service 'alpha' } }  beta = softwareSystem 'beta-service' { metadata { service 'beta' } }\n  gamma = softwareSystem 'gamma-service'\n}\n`;
    const a = bound("kiwi", "alpha", "FEAT-7");
    const b = bound("zeta", "beta", "FEAT-8");
    const ab = await merge(await merge(land, a, "FEAT-7"), b, "FEAT-8");
    const ba = await merge(await merge(land, b, "FEAT-8"), a, "FEAT-7");
    expect(ab).toBe(ba);
    expect(await ids(ab)).toEqual(["alpha", "beta", "gamma", "kiwi", "zeta"]);
  });

  it("a comment trailing the anchor is no code: the next line stays the spot, byte for byte as before", async () => {
    for (const comment of ["// the alpha", "/* the alpha */"]) {
      const land = `${SPEC}model {\n  alpha = softwareSystem 'alpha-service' { metadata { service 'alpha' } } ${comment}\n  beta = softwareSystem 'beta-service'\n}\n`;
      const merged = await merge(land, bound("kiwi", "alpha", "FEAT-7"), "FEAT-7");
      expect(merged).toBe(
        `${SPEC}model {\n  alpha = softwareSystem 'alpha-service' { metadata { service 'alpha' } } ${comment}\n` +
          `  kiwi = softwareSystem 'kiwi-service' {\n    metadata { service 'alpha' }\n  }\n` +
          `  beta = softwareSystem 'beta-service'\n}\n`,
      );
    }
  });

  it("a trailing line comment, a bare carriage return, then a declaration whose body opens: kiwi, not beta.kiwi", async () => {
    // The mask ends `// note` at the bare `\r`, so beta is located — and the
    // next `\n`-line was inside beta's body: the merge parsed, declared
    // `beta.kiwi` and was written at exit 0, where 171555d refused.
    for (const lead of ["// note", "/* a */ // note"]) {
      const land = `${SPEC}model {\n  alpha = softwareSystem 'alpha-service' { metadata { service 'alpha' } } ${lead}\r  beta = softwareSystem 'beta-service' {\n    api = container 'API'\n  }\n}\n`;
      const merged = await merge(land, bound("kiwi", "alpha", "FEAT-7"), "FEAT-7");
      expect(await ids(merged)).toEqual(["alpha", "beta", "beta.api", "kiwi"]);
    }
  });

  it("a block comment the anchor's line opens and a later line closes: the addition lands before it, not in it", async () => {
    // The next line is inside the comment, and an addition written there was
    // commented out of a merge that parsed.
    const land = `${SPEC}model {\n  alpha = softwareSystem 'alpha-service' { metadata { service 'alpha' } } /* the\n  alpha box */\n  beta = softwareSystem 'beta-service'\n}\n`;
    const merged = await merge(land, bound("kiwi", "alpha", "FEAT-7"), "FEAT-7");
    expect(await ids(merged)).toEqual(["alpha", "beta", "kiwi"]);
  });

  // The anchor is `a { }`, ending at offset 7; the block closes at the last `}`.
  it.each([
    ["code follows on the line: right after the anchor, bare", "  a { }  b {\n  }\n}", { at: 7, bare: true }],
    ["a line comment follows: the next line", "  a { } // c\n  b\n}", { at: 13, bare: false }],
    // LikeC4 ends a line comment at a bare carriage return, as the source mask
    // does since the bare-CR fix: `b {` after `// c\r` is code on the anchor's
    // `\n`-line, and the next `\n`-line is inside b's body.
    ["a line comment then a bare CR then code: right after the anchor, bare", "  a { } // c\r  b {\n  }\n}", { at: 7, bare: true }],
    ["a line comment ending in CRLF: the next line, as before", "  a { } // c\r\n  b\n}", { at: 14, bare: false }],
    ["a closed block comment follows: the next line", "  a { } /* c */\n  b\n}", { at: 16, bare: false }],
    ["a block comment the line does not close: right after the anchor, bare", "  a { } /* c\n  */\n}", { at: 7, bare: true }],
    ["only the block's closing brace follows: before that brace, as before", "  a { } }", { at: 8, bare: true }],
  ])("spotAfter: %s", (_form, text, spot) => {
    expect(spotAfter(text, text.lastIndexOf("}"), "  a { }".length)).toEqual(spot);
  });
});

describe("a comment trailing a bodyless declaration, and what is spliced after or into it", () => {
  const NESTED = `${SPEC}model {\n  alpha = softwareSystem 'alpha-service' {\n    api = container 'API' {\n      db = container 'DB' {\n        #FEAT-7\n      }\n    }\n  }\n}\n`;
  const living = (api: string): string => `${SPEC}model {\n  alpha = softwareSystem 'alpha-service' {\n    ${api}\n  }\n}\n`;

  it("a parent with a trailing `// comment` gains its body before the comment, which then trails the closing brace", async () => {
    // The `{` landed inside `// the api`, the rest of the line was comment,
    // and the parse net refused a valid map ("Expecting end of file").
    const expected = living("api = container 'API' {\n      db = container 'DB'\n    } // the api");
    expect(await merge(living("api = container 'API' // the api"), NESTED, "FEAT-7")).toBe(expected);
    const crlf = living("api = container 'API' // the api").replace(/\n/g, "\r\n");
    expect(await merge(crlf, NESTED, "FEAT-7")).toBe(expected.replace(/\n/g, "\r\n"));
  });

  it("a parent with a closed `/* … */` trailing it keeps the bytes it always had", async () => {
    expect(await merge(living("api = container 'API' /* the api */"), NESTED, "FEAT-7")).toBe(
      living("api = container 'API' /* the api */ {\n      db = container 'DB'\n    }"),
    );
  });

  it("a parent whose trailing block comment closes on a later line gains its body before the comment, not in it", async () => {
    // The scan ended the parent inside the comment it opened, so its new body
    // was commented out of a merge that parsed — `alpha.api.db` missing at exit 0.
    const merged = await merge(living("api = container 'API' /* the\n    api */"), NESTED, "FEAT-7");
    expect(await ids(merged)).toEqual(["alpha", "alpha.api", "alpha.api.db"]);
  });

  it("an element anchored after a statement whose trailing block comment runs on lands before the comment, not in it", async () => {
    const land = `${SPEC}model {\n  alpha = softwareSystem 'alpha' /*\n    the alpha box\n  */\n  beta = softwareSystem 'beta-service'\n}\n`;
    expect(await ids(await merge(land, bound("kiwi", "alpha", "FEAT-7"), "FEAT-7"))).toEqual(["alpha", "beta", "kiwi"]);
  });

  it("an edge anchored after an edge whose trailing block comment runs on lands before the comment, not in it", async () => {
    const land = `${SPEC}model {\n  alpha = softwareSystem 'alpha-service'\n  beta = softwareSystem 'beta-service'\n  alpha -> beta 'calls' /*\n    why\n  */\n}\n`;
    const delta = `${SPEC}model {\n  alpha = softwareSystem 'alpha-service'\n  beta = softwareSystem 'beta-service'\n  alpha -> beta 'second' {\n    #FEAT-7\n  }\n}\n`;
    const doc = await loadSource(await merge(land, delta, "FEAT-7"));
    expect(doc.errors).toEqual([]);
    expect(doc.relationships.map((r) => r.title).sort()).toEqual(["calls", "second"]);
  });

  it("the scan's span of a bodyless statement keeps a comment that ends on its line, and stops before one that does not", () => {
    const src = `${SPEC}model {\n  a = softwareSystem 'A' // why a\n  b = softwareSystem 'B' /* why b */\n  c = softwareSystem 'C' /* why\n  c */\n  a -> b 'x' // why the edge\n  b -> c 'y' /* why\n  the edge */\n}\n`;
    const scan = scanModel(src)!;
    expect(scan.elements.map((e) => src.slice(e.start, e.end))).toEqual([
      "a = softwareSystem 'A' // why a",
      "b = softwareSystem 'B' /* why b */",
      "c = softwareSystem 'C'",
    ]);
    expect(scan.rels.map((r) => src.slice(r.start, r.end))).toEqual(["a -> b 'x' // why the edge", "b -> c 'y'"]);
  });

  it("a delta edge's own trailing comment still rides with it onto the map", async () => {
    const land = `${SPEC}model {\n  alpha = softwareSystem 'alpha-service'\n  beta = softwareSystem 'beta-service'\n}\n`;
    const delta = `${SPEC}model {\n  alpha = softwareSystem 'alpha-service'\n  beta = softwareSystem 'beta-service'\n  beta -> alpha 'cb' #FEAT-7 // why\n}\n`;
    expect(await merge(land, delta, "FEAT-7")).toContain("  beta -> alpha 'cb' // why\n");
  });
});

describe("the feature tag stripped from a tag list takes its separator with it", () => {
  // LikeC4 reads a tag list as `#a #b, #c;` — one or more tags, then `,`
  // groups, then an optional `;`. Stripped alone, `#FEAT-7, #x` left `, #x`
  // and `#FEAT-7;` a bare `;`, and the parse net refused a delta LikeC4
  // accepts; a tag after a comma left the comma behind (`#x,`), legal but stray.
  const spec = SPEC.replace("  tag FEAT-8\n", "  tag FEAT-8\n  tag x\n  tag y\n");
  const land = `${spec}model {\n  alpha = softwareSystem 'alpha-service'\n  beta = softwareSystem 'beta-service'\n}\n`;

  it.each([
    ["first, before a comma", "#FEAT-7, #x", "    #x\n", ["x"]],
    ["alone, before a semicolon", "#FEAT-7;", "", []],
    ["after a comma", "#x, #FEAT-7", "    #x\n", ["x"]],
    ["after a comma, before the semicolon", "#x, #FEAT-7;", "    #x;\n", ["x"]],
    ["between two commas", "#x, #FEAT-7, #y", "    #x, #y\n", ["x", "y"]],
    ["after a tag, before the semicolon (bytes as before)", "#x #FEAT-7;", "    #x;\n", ["x"]],
  ])("%s", async (_form, tags, kept, expected) => {
    const delta = `${spec}model {\n  kiwi = softwareSystem 'kiwi-service' {\n    ${tags}\n    description 'k'\n  }\n}\n`;
    const merged = await merge(land, delta, "FEAT-7");
    expect(merged).toContain(`  kiwi = softwareSystem 'kiwi-service' {\n${kept}    description 'k'\n  }\n`);
    const doc = await loadSource(merged);
    expect(doc.errors).toEqual([]);
    // Sorted: LikeC4 lists a comma group's tags ahead of the ones before it.
    expect([...doc.elements.find((e) => e.id === "kiwi")!.tags].sort()).toEqual(expected);
  });

  it.each([
    ["inline, first before a comma", "beta -> alpha 'cb' #FEAT-7, #x\n", "  beta -> alpha 'cb' #x\n"],
    ["alone in a body, before a semicolon", "beta -> alpha 'cb' {\n    #FEAT-7;\n  }\n", "  beta -> alpha 'cb'\n"],
  ])("on an edge: %s", async (_form, edge, kept) => {
    const delta = `${spec}model {\n  alpha = softwareSystem 'alpha-service'\n  beta = softwareSystem 'beta-service'\n  ${edge}}\n`;
    const merged = await merge(land, delta, "FEAT-7");
    expect(merged).toContain(kept);
    expect((await loadSource(merged)).errors).toEqual([]);
  });
});
