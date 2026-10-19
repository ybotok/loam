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
import { planLandscapeMerge } from "../src/core/c4/splice/landscape-merge.js";

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

describe("a URI is one token, whatever comment marker, brace or quote it holds", () => {
  // LikeC4 lexes `scheme://…` and a relative path as one token to the next
  // whitespace; read as code, the `//` opened a comment that ate the rest of
  // the line — the closing brace of a one-line body included.
  it.each([
    ["a link closing a one-line body", "  alpha = softwareSystem 'alpha-service' { link https://example.com/alpha }\n"],
    ["a relative link holding `/*` and `//`", "  alpha = softwareSystem 'alpha-service' { link ./docs/*/a//b }\n"],
    ["a link holding braces, an anchor and an apostrophe", "  alpha = softwareSystem 'alpha-service' { link https://x.test/{id}/it's#t }\n"],
  ])("%s", async (_form, body) => {
    const { parsed, scanned } = await readings(`${SPEC}\nmodel {\n${body}  zulu = softwareSystem 'zulu-service'\n  alpha -> zulu 'calls'\n}\n`);
    expect(scanned).toEqual(parsed);
  });

  // Blanked and recorded nowhere, the URI left `link https://…` reading as the
  // one bare word `link` — a head that cannot end a statement — so the head ran
  // on into the next line and swallowed whatever was declared there: the child
  // vanished (archive refused a map main merged), or the parent's sourceless
  // edge was read as `link -> zulu` and `validate --all --base` matched no edge
  // to grade (probed at 23f1578). A URI is a token, though its mask is blank.
  const NEXT = [
    ["a `name = kind` child", "    api = container 'API'\n"],
    ["a kind-form child", "    container api 'API'\n"],
    ["the parent's sourceless edge", "    -> zulu 'calls'\n"],
  ] as const;
  it.each([
    ...NEXT.map(([what, line]) => [`a link alone on its line, then ${what}`, `    link https://wiki.example.com/alpha\n${line}`]),
    ...NEXT.map(([what, line]) => [`an icon alone on its line, then ${what}`, `    icon ./icons/alpha.svg\n${line}`]),
    ["a link whose URI is on the next line, then a child", "    link\n      https://wiki.example.com/alpha\n    api = container 'API'\n"],
  ])("%s", async (_form, inner) => {
    const { parsed, scanned } = await readings(
      `${SPEC}\nmodel {\n  alpha = softwareSystem 'alpha-service' {\n${inner}  }\n  zulu = softwareSystem 'zulu-service'\n}\n`,
    );
    expect(scanned).toEqual(parsed);
  });

  it("the mask records each URI's span, so a reader can tell a blanked URI from blank space", () => {
    const src = "link https://x.test/a icon ../b.svg // c\n";
    expect(maskSource(src).uris.map((u) => src.slice(u.start, u.end))).toEqual(["https://x.test/a", "../b.svg"]);
    // A comment is not a URI: `//` with nothing before it stays the comment token.
    expect(maskSource("// https://x.test\n").uris).toEqual([]);
  });
});

describe("a statement split across lines is read as LikeC4 reads it — its newlines are hidden tokens", () => {
  const ZULU = "  zulu = softwareSystem 'zulu-service'\n";
  it.each([
    ["the body's `{` on the next line", "  alpha = softwareSystem 'alpha-service'\n  {\n    api = container 'api'\n  }\n"],
    ["a newline after `=`", "  alpha =\n    softwareSystem 'alpha-service'\n"],
    ["a bare name above its `= kind`", "  alpha\n    = softwareSystem 'alpha-service'\n"],
    ["a kind above the name it declares", "  softwareSystem\n    alpha 'alpha-service'\n"],
    ["the title on the next line", "  alpha = softwareSystem\n    'alpha-service'\n"],
    ["a block comment spanning the line break", "  alpha = /* the\n  payments box */ softwareSystem 'alpha-service'\n"],
    ["an edge broken after its arrow", "  alpha = softwareSystem 'alpha-service'\n  alpha ->\n    zulu 'calls'\n"],
    ["an edge whose arrow starts the next line", "  alpha = softwareSystem 'alpha-service'\n  alpha\n    -> zulu 'calls'\n"],
    ["an edge's tag on the next line", "  alpha = softwareSystem 'alpha-service'\n  alpha -> zulu 'calls'\n    #t\n"],
  ])("%s", async (_form, body) => {
    const { parsed, scanned } = await readings(`${SPEC}\nmodel {\n${body}${ZULU}}\n`);
    expect(scanned).toEqual(parsed);
  });

  it("an arrow starting the line after a COMPLETE head is its own sourceless edge, not a continuation", async () => {
    // `-> zulu` here is the parent's edge, exactly as LikeC4 reads it: reading
    // it into `c`'s head would invent an edge from `alpha.c` that nobody drew.
    const { parsed, scanned } = await readings(`${SPEC}
model {
  alpha = softwareSystem 'alpha-service' {
    c = container 'c'
    -> zulu 'calls'
  }
${ZULU}}
`);
    expect(scanned).toEqual(parsed);
    expect(scanned[1]).toEqual([JSON.stringify(["alpha", "zulu", "calls", []])]);
  });

  it("a neighbour spliced after a head whose `{` is on the next line does not take that body", async () => {
    // The line-bounded head read `entityService` as bodyless, so the new
    // element anchored to its service landed between the head and its `{` —
    // and took the description and the binding for its own. Legal LikeC4, so
    // the merge's parse net passed it (probed on main at 171555d).
    const spec = "specification {\n  element softwareSystem\n  tag FEAT-9\n}\n";
    const land = `${spec}
model {
  entityService = softwareSystem 'Entity Service'
  {
    description 'Holds entities'
    metadata { service 'entity-service' }
  }
}
`;
    const deltaText = `${spec}
model {
  entityApi = softwareSystem 'entity-service' {
    #FEAT-9
  }
}
`;
    const delta = await loadSource(deltaText);
    const plan = await planLandscapeMerge({
      landscapeText: land,
      deltaText,
      deltaElements: delta.elements,
      newEls: delta.elements,
      newRels: [],
      featureId: "FEAT-9",
    });
    const merged = await loadSource(plan.content!);
    expect(merged.errors).toEqual([]);
    expect(merged.elements.find((e) => e.id === "entityService")).toMatchObject({
      description: "Holds entities",
      service: "entity-service",
    });
    expect(merged.elements.find((e) => e.id === "entityApi")?.description).toBeUndefined();
  });
});

describe("identifiers and edge forms the grammar allows", () => {
  it("a hyphenated id, declared in both forms and named by edges, is the element LikeC4 sees", async () => {
    const { parsed, scanned } = await readings(`${SPEC}
model {
  entity-service = softwareSystem 'entity-service' {
    read-api = container 'Read API'
  }
  softwareSystem audit-log 'audit-log'
  entity-service.read-api -> audit-log 'writes'
  audit-log -[async]-> entity-service 'replays'
}
`);
    expect(scanned).toEqual(parsed);
  });

  it("a dot-kind edge (`source .kind target`), sourced or not, is a relationship", async () => {
    const { parsed, scanned } = await readings(`${SPEC}
model {
  alpha = softwareSystem 'alpha-service' {
    .async zulu 'from inside'
  }
  zulu = softwareSystem 'zulu-service'
  alpha .async zulu 'emits' {
    #t
  }
}
`);
    expect(scanned).toEqual(parsed);
    expect(scanned[1]).toHaveLength(2);
  });
});

describe("a delta edge whose body holds a word containing a spine key archives", () => {
  // The archive matches each parsed addition back to its authored statement by
  // a key that includes the op (`relStatementKey`). The scan read `op` out of
  // `op-version`, `#op-critical` or a `#op` tag, so the two keys disagreed and
  // archive refused a valid delta: "cannot locate the 'beta -> alpha'
  // relationship in delta.likec4" (probed on main at 171555d).
  const spec = "specification {\n  element softwareSystem\n  tag FEAT-9\n  tag op-critical\n  tag op\n}\n";
  const ctx = "  alpha = softwareSystem 'alpha-service'\n  beta = softwareSystem 'beta-service'\n";
  it.each([
    ["a hyphenated metadata key above the op", "    metadata {\n      op-version 'v2'\n      op 'cancelOrder'\n    }\n"],
    ["a hyphenated tag holding `op`, above a description", "    #op-critical\n    description 'calls it'\n    metadata { op 'cancelOrder' }\n"],
    ["a tag named op, above a description", "    #op\n    description 'calls it'\n"],
  ])("%s", async (_form, body) => {
    const land = `${spec}\nmodel {\n${ctx}}\n`;
    const deltaText = `${spec}\nmodel {\n${ctx}  beta -> alpha 'callback' {\n    #FEAT-9\n${body}  }\n}\n`;
    const delta = await loadSource(deltaText);
    expect(delta.errors).toEqual([]);
    const plan = await planLandscapeMerge({
      landscapeText: land,
      deltaText,
      deltaElements: delta.elements,
      newEls: [],
      newRels: delta.relationships,
      featureId: "FEAT-9",
    });
    const merged = await loadSource(plan.content!);
    expect(merged.errors).toEqual([]);
    expect(merged.relationships.map((r) => [r.source, r.target, r.op ?? null])).toEqual([
      ["beta", "alpha", delta.relationships[0]!.op ?? null],
    ]);
  });
});

describe("an `extend` frame written in the landscape itself", () => {
  const spec = "specification {\n  element softwareSystem\n  element container\n  tag FEAT-9\n}\n";
  const land = `${spec}
model {
  alpha = softwareSystem 'alpha-service'
  beta = softwareSystem 'beta-service'
  zulu = softwareSystem 'zulu-service'
  extend alpha {
    beta = container 'Beta adapter'
    beta -> zulu 'feeds'
  }
}
`;

  it("its children and edges are read under the frame's scope, as LikeC4 reads them", async () => {
    const { parsed, scanned } = await readings(land);
    expect(scanned).toEqual(parsed);
  });

  it("an edge anchored to the frame's edges lands OUTSIDE it, so its names keep their meaning", async () => {
    // Inside `extend alpha { }` the delta's `beta` would resolve to `alpha.beta`.
    const deltaText = `${spec}
model {
  beta = softwareSystem 'beta-service'
  zulu = softwareSystem 'zulu-service'
  zulu -> beta 'calls beta' {
    #FEAT-9
  }
}
`;
    const delta = await loadSource(deltaText);
    const plan = await planLandscapeMerge({
      landscapeText: land,
      deltaText,
      deltaElements: delta.elements,
      newEls: [],
      newRels: delta.relationships,
      featureId: "FEAT-9",
    });
    const merged = await loadSource(plan.content!);
    expect(merged.errors).toEqual([]);
    expect(merged.relationships.map((r) => `${r.source}->${r.target}`).sort()).toEqual(["alpha.beta->zulu", "zulu->beta"]);
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

describe("a landscape written in every one of those forms at once archives, and loses nothing", () => {
  it("additions anchored to each form land, and every living element keeps what it had", async () => {
    const spec = `specification {
  element softwareSystem
  element container
  relationship async
  tag FEAT-9
}
`;
    const land = `${spec}
model {
  alpha = softwareSystem 'alpha-service' {
    description '''
      Alpha's job: { settle } the "split"
    '''
  }
  entity-service = softwareSystem 'entity-service'
  {
    description 'Holds entities'
  }
  zulu =
    softwareSystem 'zulu-service'
  alpha .async zulu 'emits'
}

views {
  view index { include * }
}

model {
  ledger = softwareSystem 'ledger-service' {
    description 'Posts entries'
  }
  zulu -> ledger 'settles'
}
`;
    const deltaText = `${spec}
model {
  entity-service = softwareSystem 'entity-service' {
    cache = container 'Cache' {
      #FEAT-9
    }
  }
  entity-worker = softwareSystem 'Entity Worker' {
    #FEAT-9
    metadata { service 'entity-service' }
  }
  ledger = softwareSystem 'ledger-service' {
    store = container 'Store' {
      #FEAT-9
    }
  }
  zulu = softwareSystem 'zulu-service'
  zulu -> entity-service 'reads' {
    #FEAT-9
  }
}
`;
    const living = await loadSource(land);
    expect(living.errors).toEqual([]);
    const delta = await loadSource(deltaText);
    const plan = await planLandscapeMerge({
      landscapeText: land,
      deltaText,
      deltaElements: delta.elements,
      newEls: delta.elements.filter((e) => e.tags.includes("FEAT-9")),
      newRels: delta.relationships.filter((r) => r.tags.includes("FEAT-9")),
      featureId: "FEAT-9",
    });
    const merged = await loadSource(plan.content!);
    expect(merged.errors).toEqual([]);
    for (const e of living.elements) {
      expect(merged.elements.find((m) => m.id === e.id), e.id).toMatchObject({ title: e.title, description: e.description });
    }
    expect(merged.elements.map((e) => e.id)).toEqual(
      expect.arrayContaining(["entity-service.cache", "entity-worker", "ledger.store"]),
    );
    expect(merged.relationships).toHaveLength(living.relationships.length + 1);
    // Each where its anchor lives: the worker beside entity-service in the
    // first block, the store inside ledger in the second.
    const scan = scanModel(plan.content!)!;
    expect(scan.elements.find((e) => e.id === "entity-worker")?.block).toBe(0);
    expect(scan.elements.find((e) => e.id === "ledger.store")?.block).toBe(1);
  });
});
