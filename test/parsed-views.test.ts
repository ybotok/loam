/**
 * The two readers docs/DESIGN.md rule 26 permits, and what each normalizes away.
 *
 * `readDynamicViews` answers "what are the declared use cases" and filters on
 * `_type === "dynamic"`. `readViewIds` answers "which ids does this document
 * claim" and filters on `sourcePath !== undefined` instead, because a census must
 * see authored ELEMENT views too. They are tested in one file precisely so the
 * two filters stay comparable: each drops LikeC4's synthesized `index` entry, and
 * a reader who learned only one of them would write the other check wrong.
 *
 * Its sibling `test/likec4-view-shape.test.ts` pins what LikeC4 EMITS at the
 * 1.59.2 pin; this suite pins what loam MAKES of that. The split is deliberate:
 * an upstream shape change should fail the first suite (a dependency moved),
 * and a normalization regression should fail this one (loam decided wrong), and
 * a reader looking at a red build should be able to tell those apart without
 * opening either file.
 *
 * The defensive half is not padding. This reader runs inside `validate --all`
 * over every C4 document a fleet has, so the one behaviour it may never have is
 * throwing: a malformed record must come back as zero views — could-not-look —
 * and never as a partial view a check would then grade as nothing-wrong.
 */
import { describe, it, expect } from "vitest";
import { LikeC4 } from "likec4";
import { readDynamicViews } from "../src/core/c4/parsed/dynamic-views.js";
import { readViewIds } from "../src/core/c4/parsed/view-ids.js";
import { loadSource } from "../src/core/c4/likec4.js";
import { loadBatch } from "../src/core/c4/workspace.js";
import { makeTmpDir, writeFiles } from "./helpers/harness.js";

/** The census read over a real parse, matching `parsedViews` above. */
async function readIds(source: string): Promise<string[]> {
  const likec4 = await LikeC4.fromSource(source, { logger: false });
  try {
    return readViewIds(await likec4.parsedModel());
  } finally {
    await likec4.dispose();
  }
}

const SPEC = `specification {
  element service
  tag cap-checkout
}
model {
  web = service 'checkout-web'
  orders = service 'order-service'
  pay = service 'payment-service'
  web -> orders 'Calls createOrder'
  orders -> pay 'Calls authorizePayment'
  orders -> web 'the created order'
}
`;

/** The reader over a real parse — the only way it is ever called in production. */
async function read(source: string): Promise<ReturnType<typeof readDynamicViews>> {
  const likec4 = await LikeC4.fromSource(source, { logger: false });
  try {
    return readDynamicViews(await likec4.parsedModel());
  } finally {
    await likec4.dispose();
  }
}

describe("readDynamicViews reads what the author declared", () => {
  it("carries a tagged view's id, tags, title, description and ordered steps", async () => {
    const views = await read(`${SPEC}views {
  dynamic view uc_checkout {
    #cap-checkout
    title 'Checkout'
    description 'from a filled cart to a paid order'
    web -> orders 'places the order'
    orders -> pay 'authorizes the card'
  }
}
`);
    expect(views).toHaveLength(1);
    expect(views[0]!.id).toBe("uc_checkout");
    expect(views[0]!.tags).toEqual(["cap-checkout"]);
    expect(views[0]!.title).toBe("Checkout");
    expect(views[0]!.description).toBe("from a filled cart to a paid order");
    expect(views[0]!.steps.map((s) => [s.ordinal, s.source, s.target, s.title])).toEqual([
      [1, "web", "orders", "places the order"],
      [2, "orders", "pay", "authorizes the card"],
    ]);
  });

  it("ignores the `index` view LikeC4 synthesizes, so a document with no views reads as none", async () => {
    // The synthesized entry is present even here — measured in the shape suite —
    // so "no views" is a claim about what the AUTHOR wrote, not about the record.
    expect(await read(SPEC)).toEqual([]);
  });

  it("ignores an authored ELEMENT view: rule 26 permits the dynamic ones only", async () => {
    const views = await read(`${SPEC}views {
  view fleet {
    include *
  }
}
`);
    expect(views).toEqual([]);
  });

  it("reads an untagged view's tags as [], never as null", async () => {
    // LikeC4 emits null. A caller reaching for `.length` on that throws inside a
    // validate run, which is the one thing this reader may not cause.
    const views = await read(`${SPEC}views {
  dynamic view uc_plain {
    web -> orders 'places'
  }
}
`);
    expect(views[0]!.tags).toEqual([]);
  });

  it("omits title, description and notes rather than inventing empty strings", async () => {
    const views = await read(`${SPEC}views {
  dynamic view uc_bare {
    web -> orders
  }
}
`);
    expect(views[0]!.title).toBeUndefined();
    expect(views[0]!.description).toBeUndefined();
    expect(views[0]!.steps[0]!.title).toBeUndefined();
    expect(views[0]!.steps[0]!.notes).toBeUndefined();
  });

  it("decodes a step's `notes` out of LikeC4's rich-text shape", async () => {
    const views = await read(`${SPEC}views {
  dynamic view uc_noted {
    web -> orders 'places' {
      notes 'idempotent on the cart id'
    }
  }
}
`);
    expect(views[0]!.steps[0]!.notes).toBe("idempotent on the cart id");
  });
});

describe("readDynamicViews orients and flattens the walk", () => {
  it("carries isBackward on a `<-` reply, and its already-reversed endpoints", async () => {
    const views = await read(`${SPEC}views {
  dynamic view uc_reply {
    web -> orders 'places the order'
    web <- orders 'the created order'
  }
}
`);
    const [call, reply] = views[0]!.steps;
    expect([call!.source, call!.target, call!.isBackward]).toEqual(["web", "orders", false]);
    // Reversed by LikeC4 AND flagged. A reader that re-reversed these would
    // convict every return hop in the fleet of having no backing relationship.
    expect([reply!.source, reply!.target, reply!.isBackward]).toEqual(["orders", "web", true]);
  });

  it("flattens a nested group and numbers only the hops the author drew", async () => {
    const views = await read(`${SPEC}views {
  dynamic view uc_looped {
    web -> orders 'places the order'
    loop 'until the card clears' {
      orders -> pay 'authorizes'
      orders <- pay 'declined, retry'
    }
    web <- orders 'the created order'
  }
}
`);
    const steps = views[0]!.steps;
    // Four hops, not five: the `loop` bracket is not a step, and counting it
    // would shift every ordinal after it away from what the diagram shows.
    expect(steps.map((s) => s.ordinal)).toEqual([1, 2, 3, 4]);
    expect(steps.map((s) => `${s.source}->${s.target}`)).toEqual([
      "web->orders",
      "orders->pay",
      "pay->orders",
      "orders->web",
    ]);
    // The nesting survives in astPath, which is the only handle on a step
    // inside a group.
    expect(steps[1]!.astPath).toBe("/steps@1/steps@0");
    expect(steps[3]!.astPath).toBe("/steps@2");
  });

  it("reads a step whose endpoints are dotted container ids as written", async () => {
    // Endpoints are element FqnRefs, never relationship ids. Resolving a
    // container to its service is a later join's business, not this reader's.
    const views = await read(`specification {
  element service
  element container
}
model {
  web = service 'checkout-web'
  orders = service 'order-service' {
    api = container 'api'
  }
  web -> orders.api 'calls'
}
views {
  dynamic view uc_dotted {
    web -> orders.api 'calls'
  }
}
`);
    expect(views[0]!.steps[0]!.target).toBe("orders.api");
  });
});

describe("readDynamicViews degrades to zero views rather than to a wrong one", () => {
  it("answers [] for every shape that is not a parsed model", () => {
    for (const bad of [undefined, null, "", 0, [], {}, { $data: null }, { $data: {} }, { $data: { views: [] } }]) {
      expect(readDynamicViews(bad), `input ${JSON.stringify(bad) ?? "undefined"}`).toEqual([]);
    }
  });

  it("answers [] for the UNRESOLVED promise — the mistake every draft of this made", async () => {
    const likec4 = await LikeC4.fromSource(`${SPEC}views {
  dynamic view uc_checkout {
    web -> orders 'places'
  }
}
`, { logger: false });
    try {
      // No await: `$data` is undefined on the promise, so a reader handed the
      // promise reports a document with views as having none. Pinned so the
      // silent zero cannot come back as a plausible-looking refactor.
      expect(readDynamicViews(likec4.parsedModel())).toEqual([]);
      expect(readDynamicViews(await likec4.parsedModel())).toHaveLength(1);
    } finally {
      await likec4.dispose();
    }
  });

  it("drops a view with no id and an entry that is not a step, and keeps a hop that lost its astPath", () => {
    const record = {
      $data: {
        views: {
          nameless: { _type: "dynamic", steps: [] },
          uc_ok: {
            _type: "dynamic",
            id: "uc_ok",
            tags: ["cap-checkout", 7, null],
            steps: [
              { source: "a", target: "b", astPath: "/steps@0", title: "first" },
              { source: "a", target: "b", title: "no path" },
              { source: "a", astPath: "/steps@2" },
              "not a step",
              { source: "b", target: "c", astPath: "/steps@4", title: "second" },
            ],
          },
        },
      },
    };
    const views = readDynamicViews(record);
    expect(views).toHaveLength(1);
    // Non-string tags are dropped rather than carried into a finding message.
    expect(views[0]!.tags).toEqual(["cap-checkout"]);
    // Three hops: the half-written entry (no target) and the string are not
    // steps at all, but the one that merely lost its astPath IS a hop and is
    // graded — losing it would turn an upstream field rename into every use
    // case in the fleet quietly having no steps.
    expect(views[0]!.steps.map((s) => [s.ordinal, s.title, s.astPath])).toEqual([
      [1, "first", "/steps@0"],
      [2, "no path", undefined],
      [3, "second", "/steps@4"],
    ]);
  });

  it("descends into a group rather than stopping at it — the nested hops are the use case", () => {
    // Without the recursion the bracket contributes nothing AND hides what it
    // brackets, so a looped flow reads as a two-step use case with the
    // retry invisible. Structural, not keyword-based: a group is any entry
    // carrying a nested `steps` array, whatever LikeC4 decides to call it.
    const views = readDynamicViews({
      $data: {
        views: {
          uc: {
            _type: "dynamic",
            id: "uc",
            steps: [
              { source: "a", target: "b", astPath: "/steps@0" },
              {
                _type: "someFutureGroupKind",
                title: "a kind this reader has never heard of",
                steps: [{ source: "b", target: "c", astPath: "/steps@1/steps@0" }],
              },
            ],
          },
        },
      },
    });
    expect(views[0]!.steps.map((s) => `${s.ordinal}:${s.source}->${s.target}`)).toEqual(["1:a->b", "2:b->c"]);
  });

  it("treats a group with no readable children as contributing nothing", () => {
    const views = readDynamicViews({
      $data: {
        views: {
          uc: {
            _type: "dynamic",
            id: "uc",
            steps: [{ _type: "loop", title: "empty", steps: [] }, { source: "a", target: "b", astPath: "/steps@1" }],
          },
        },
      },
    });
    expect(views[0]!.steps.map((s) => s.ordinal)).toEqual([1]);
  });
});

describe("both loaders carry the views, because the fleet gate runs the batched one", () => {
  const DOC = `${SPEC}views {
  dynamic view uc_checkout {
    #cap-checkout
    title 'Checkout'
    web -> orders 'places the order'
  }
}
`;

  it("loadSource carries them", async () => {
    const doc = await loadSource(DOC);
    expect(doc.errors).toEqual([]);
    expect(doc.views?.map((v) => v.id)).toEqual(["uc_checkout"]);
    expect(doc.views?.[0]!.steps).toHaveLength(1);
  });

  it("loadBatch carries them identically — a read wired into one loader only is a read `validate --all` never performs", async () => {
    const dir = await makeTmpDir();
    await writeFiles(dir, { "landscape.likec4": DOC });
    const batch = await loadBatch([`${dir}/landscape.likec4`]);
    const doc = [...batch.values()][0]!;
    expect(doc.errors).toEqual([]);
    expect(doc.views).toEqual((await loadSource(DOC)).views);
  });

  it("a document that did not parse carries no views at all", async () => {
    const doc = await loadSource(`${SPEC}views {
  dynamic view uc_typo {
    web -> nosuch 'typo'
  }
}
`);
    expect(doc.errors.length).toBeGreaterThan(0);
    // The errors-mean-no-model rule returns before the parse is ever read, so
    // `views` is absent rather than empty — and every reader treats the two the
    // same, which is why the field is optional.
    expect(doc.views).toBeUndefined();
  });
});

describe("readViewIds counts what the document claims, not what LikeC4 adds", () => {
  it("returns every AUTHORED view id — element views included, which the dynamic reader drops", async () => {
    const ids = await readIds(`${SPEC}views {
  view fleet {
    include *
  }
  dynamic view uc_checkout {
    web -> orders 'places'
  }
}
`);
    expect(ids.sort()).toEqual(["fleet", "uc_checkout"]);
  });

  it("drops the synthesized `index` — reporting it would be a collision against a view nobody wrote", async () => {
    // The load-bearing difference from the dynamic reader: `index` is
    // `_type: "element"`, so a census filtering on `_type` would keep it and
    // report a claimed id on every fleet in existence.
    expect(await readIds(SPEC)).toEqual([]);
  });

  it("keeps a document's ids in its own order, and de-duplicates nothing", () => {
    // Order and duplicates are the caller's business: two views with one id is
    // already a LikeC4 error, and a census that quietly collapsed them would
    // hide how many claimants there are.
    const ids = readViewIds({
      $data: {
        views: {
          b: { id: "b", sourcePath: "x.c4" },
          a: { id: "a", sourcePath: "x.c4" },
          synthesized: { id: "index" },
          nameless: { sourcePath: "x.c4" },
          blank: { id: "", sourcePath: "x.c4" },
          notAnObject: "nope",
        },
      },
    });
    expect(ids).toEqual(["b", "a"]);
  });

  it("omits the id LikeC4 MINTS for an unnamed view — it is nobody's claim, and not loader-stable", async () => {
    const ids = await readIds(`${SPEC}views {
  view named {
    include *
  }
  view of web {
    include *
  }
}
`);
    expect(ids).toEqual(["named"]);
  });

  it("answers [] for every shape that is not a parsed model, and for the unresolved promise", async () => {
    for (const bad of [undefined, null, 0, [], {}, { $data: null }, { $data: { views: 7 } }]) {
      expect(readViewIds(bad), `input ${JSON.stringify(bad) ?? "undefined"}`).toEqual([]);
    }
    const likec4 = await LikeC4.fromSource(`${SPEC}views {
  view fleet {
    include *
  }
}
`, { logger: false });
    try {
      expect(readViewIds(likec4.parsedModel())).toEqual([]);
      expect(readViewIds(await likec4.parsedModel())).toEqual(["fleet"]);
    } finally {
      await likec4.dispose();
    }
  });
});
