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
 */
import { describe, expect, it } from "vitest";
import { loadSource } from "../src/core/c4/likec4.js";
import { planLandscapeMerge } from "../src/core/c4/splice/landscape-merge.js";
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
    ["a closed block comment follows: the next line", "  a { } /* c */\n  b\n}", { at: 16, bare: false }],
    ["a block comment the line does not close: right after the anchor, bare", "  a { } /* c\n  */\n}", { at: 7, bare: true }],
    ["only the block's closing brace follows: before that brace, as before", "  a { } }", { at: 8, bare: true }],
  ])("spotAfter: %s", (_form, text, spot) => {
    expect(spotAfter(text, text.lastIndexOf("}"), "  a { }".length)).toEqual(spot);
  });
});
