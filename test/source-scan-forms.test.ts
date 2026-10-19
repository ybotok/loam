/**
 * Declaration forms LikeC4 accepts, read by the splice map exactly as the
 * parser reads them — one case per form, each proven legal first.
 *
 * `test/likec4-scan-parity.test.ts` pins the two readers together on one rich
 * source; this file is the other half of that claim, the forms a real fleet map
 * wrote and the scan did not follow. Every one of them reached a user the same
 * way: `validate --all` green, then `loam archive` refusing `merge-failed` with
 * a message about something else (a fleet on 0.2.0-alpha.7, 2026-10). The
 * parse is asserted clean in every case, because a form LikeC4 rejects is not
 * one the scan owes anything to, and a case built on one would pass while
 * proving nothing.
 */
import { describe, expect, it } from "vitest";
import { loadSource } from "../src/core/c4/likec4.js";
import { maskSource } from "../src/core/c4/source-mask.js";
import { scanModel } from "../src/core/c4/source-scan.js";

const SPEC = `specification {
  element softwareSystem
  element container
  relationship async
  tag t
}
`;

/** Order-free identity of an edge: everything both readers claim to extract. */
function relTuple(r: { source: string; target: string; title?: string; tags: string[] }): string {
  return JSON.stringify([r.source, r.target, r.title ?? null, [...r.tags].sort()]);
}

/** What each reader says the document declares, after proving LikeC4 accepts it. */
async function readings(src: string): Promise<{ parsed: string[][]; scanned: string[][] }> {
  const doc = await loadSource(src);
  expect(doc.errors.map((e) => e.message), "the form must be legal LikeC4, or the case proves nothing").toEqual([]);
  expect(doc.elements.length, "a fixture that declares nothing would pass vacuously").toBeGreaterThan(0);
  const scan = scanModel(src);
  return {
    parsed: [doc.elements.map((e) => `${e.id}:${e.title}`).sort(), doc.relationships.map(relTuple).sort()],
    scanned: [
      (scan?.elements ?? [])
        .filter((e) => e.extend !== true)
        .map((e) => `${e.id}:${e.title ?? e.id.slice(e.id.lastIndexOf(".") + 1)}`)
        .sort(),
      (scan?.rels ?? []).map(relTuple).sort(),
    ],
  };
}

describe("markdown strings ('''…''' and \"\"\"…\"\"\") are one literal each, whatever prose they hold", () => {
  // Read as three ordinary quotes, the first apostrophe in the prose closed the
  // literal and the rest of the document was read inside out: a map with one
  // such description above its model had, to the splice map, no model at all.
  it("an apostrophe and braces inside ''' leave the model where LikeC4 sees it", async () => {
    const src = `${SPEC}
model {
  alpha = softwareSystem 'alpha-service' {
    description '''
      Alpha's job: { settle } the "split" -> nowhere #t
    '''
  }
  zulu = softwareSystem 'zulu-service'
  alpha -> zulu 'calls'
}
`;
    const { parsed, scanned } = await readings(src);
    expect(scanned).toEqual(parsed);
    // The prose is content: no brace, arrow or tag of it reaches the masked code.
    const { code, literals } = maskSource(src);
    expect(code).not.toContain("settle");
    expect(code).not.toContain("#t");
    expect(literals.some((l) => l.value.includes("Alpha's job"))).toBe(true);
  });

  it("an odd number of double quotes inside \"\"\" is prose too", async () => {
    const src = `${SPEC}
model {
  alpha = softwareSystem 'alpha-service' {
    description """
      say "hi it's } there
    """
  }
  zulu = softwareSystem 'zulu-service'
}
`;
    const { parsed, scanned } = await readings(src);
    expect(scanned).toEqual(parsed);
  });

  it("the literal ends at the FIRST closing triple, as the grammar's until-token does", () => {
    const { literals } = maskSource(`x '''one''' y '''two'''`);
    expect(literals.map((l) => l.value)).toEqual(["one", "two"]);
  });
});

describe("every top-level model block is read, and only those", () => {
  it("a second (and third) model block below the views is part of the model", async () => {
    const src = `${SPEC}
model {
  alpha = softwareSystem 'alpha-service'
}

views {
  view index { include * }
}

model {
  zulu = softwareSystem 'zulu-service' {
    api = container 'api'
  }
  alpha -> zulu.api 'calls'
}

model {
  beta = softwareSystem 'beta-service'
  beta -> api 'by its unique leaf, across blocks'
}
`;
    const { parsed, scanned } = await readings(src);
    expect(scanned).toEqual(parsed);
    expect(scanModel(src)!.blocks).toHaveLength(3);
    expect(scanModel(src)!.elements.map((e) => [e.id, e.block])).toEqual([
      ["alpha", 0],
      ["zulu", 1],
      ["zulu.api", 1],
      ["beta", 2],
    ]);
  });

  it("a specification kind NAMED model, above the real block, is not the model", async () => {
    // The bare first match took `element model {` for the model block and saw
    // no declaration at all.
    const src = `specification {
  element softwareSystem
  element model {
    style {
      color red
    }
  }
}

model {
  alpha = softwareSystem 'alpha-service'
  model beta 'beta-service'
}
`;
    const { parsed, scanned } = await readings(src);
    expect(scanned).toEqual(parsed);
  });
});
