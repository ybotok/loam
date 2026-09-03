/**
 * The shape of a `dynamic view` in LikeC4's PARSED record, pinned before loam
 * reads one.
 *
 * docs/DESIGN.md rule 26 permits exactly one view read: `(await
 * parsedModel()).$data.views`, dynamic entries only, and only the fields listed
 * there. `$data` is public and typed (`@likec4/core`'s `LikeC4Model.d.mts`) but
 * thinly documented for this use, so the dependency is exact-pinned at 1.59.2
 * and THIS suite is the tripwire. It is deliberately written BEFORE the adapter
 * exists: a shape assertion added after the reader would only ever re-state
 * whatever the reader already assumed.
 *
 * Every assertion below is a MEASURED fact, not a hoped-for one, and each is
 * load-bearing for a check that does not exist yet:
 *
 *  - The `index` entry is SYNTHESIZED into the record for a document that never
 *    declares it. Reporting it would be reporting a fiction. It is
 *    `_type: "element"` AND has no `sourcePath`, which is why rule 26 states two
 *    filters: a dynamic-view reader filters on `_type`, a census that must also
 *    see authored element views filters on `sourcePath`.
 *  - A reply step written `a <- b` is recorded as
 *    `{source: b, target: a, isBackward: true}` — reversed AND flagged — while a
 *    forward step carries no `isBackward` key at all. A reader that drops the
 *    flag mis-orients every return hop in a sequence diagram, which is most of
 *    them.
 *  - Steps NEST: a `loop` is an entry with `_type: "loop"`, a title, its own
 *    `steps[]`, and NO source/target and NO `astPath` of its own. A walk that
 *    treats every entry as a hop reads a group as a step.
 *  - A step between two real elements with NO backing relationship parses with
 *    ZERO errors. That is the whole reason loam grades this: if loam does not
 *    convict such a step, nothing does.
 *  - A step naming an element that does not exist DOES fail the reference
 *    checker, and the view's `steps[]` comes back empty — so loam's standing
 *    "errors mean no model" rule already covers it, twice over.
 */
import { describe, it, expect } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LikeC4 } from "likec4";

/** The raw parsed record, exactly as rule 26 permits it to be reached. */
async function parsedViews(source: string): Promise<{
  errors: number;
  views: Record<string, Record<string, unknown>>;
}> {
  const likec4 = await LikeC4.fromSource(source);
  try {
    const errors = likec4.getErrors().length;
    const model = (await likec4.parsedModel()) as unknown as {
      $data?: { views?: Record<string, Record<string, unknown>> };
    };
    return { errors, views: model.$data?.views ?? {} };
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
  web -> orders 'Calls createOrder' {
    metadata { op 'createOrder' }
  }
  orders -> web 'the created order'
}
`;

const TAGGED_VIEW = `${SPEC}views {
  dynamic view uc_checkout {
    #cap-checkout
    title 'Checkout'
    web -> orders 'places the order'
    loop 'until accepted' {
      web <- orders 'the created order'
    }
  }
}
`;

describe("the parsed record's dynamic-view shape at likec4@1.59.2", () => {
  it("carries the view's id, tags, title and ordered steps — and nothing loam must guess", async () => {
    const { errors, views } = await parsedViews(TAGGED_VIEW);
    expect(errors).toBe(0);

    const view = views["uc_checkout"];
    expect(view).toBeDefined();
    expect(view!["_type"]).toBe("dynamic");
    expect(view!["_stage"]).toBe("parsed");
    expect(view!["id"]).toBe("uc_checkout");
    expect(view!["title"]).toBe("Checkout");
    expect(view!["tags"]).toEqual(["cap-checkout"]);
    // Authored, so it has a source. The synthesized entry below does not.
    expect(view!["sourcePath"]).toBe("source.c4");
  });

  it("synthesizes an `index` view into a document that declares none", async () => {
    const { views } = await parsedViews(TAGGED_VIEW);
    expect(Object.keys(views).sort()).toEqual(["index", "uc_checkout"]);

    const index = views["index"]!;
    // BOTH filters must keep working, because rule 26 hands out both.
    expect(index["_type"]).toBe("element");
    expect(index["sourcePath"]).toBeUndefined();
  });

  it("flags a `<-` reply as isBackward and reverses it, while a forward step carries no flag", async () => {
    const { views } = await parsedViews(TAGGED_VIEW);
    const steps = views["uc_checkout"]!["steps"] as Record<string, unknown>[];

    const forward = steps[0]!;
    expect(forward["source"]).toBe("web");
    expect(forward["target"]).toBe("orders");
    expect(forward["title"]).toBe("places the order");
    expect(forward["astPath"]).toBe("/steps@0");
    // ABSENT, not false — a reader testing `=== false` would be reading nothing.
    expect("isBackward" in forward).toBe(false);

    const group = steps[1]!;
    const reply = (group["steps"] as Record<string, unknown>[])[0]!;
    expect(reply["source"]).toBe("orders");
    expect(reply["target"]).toBe("web");
    expect(reply["isBackward"]).toBe(true);
  });

  it("nests a `loop` as an entry with no endpoints and no astPath of its own", async () => {
    const { views } = await parsedViews(TAGGED_VIEW);
    const steps = views["uc_checkout"]!["steps"] as Record<string, unknown>[];

    const group = steps[1]!;
    expect(group["_type"]).toBe("loop");
    expect(group["title"]).toBe("until accepted");
    expect(group["source"]).toBeUndefined();
    expect(group["target"]).toBeUndefined();
    expect(group["astPath"]).toBeUndefined();
    // The nested step's astPath is what records the nesting.
    expect((group["steps"] as Record<string, unknown>[])[0]!["astPath"]).toBe("/steps@1/steps@0");
  });

  it("reads an untagged view's `tags` as null, and a step's `notes` as {txt}", async () => {
    const { errors, views } = await parsedViews(`${SPEC}views {
  dynamic view uc_plain {
    web -> orders 'places' {
      notes 'the note'
    }
  }
}
`);
    expect(errors).toBe(0);
    // null, NOT an empty array — the adapter owes this normalization.
    expect(views["uc_plain"]!["tags"]).toBeNull();
    const step = (views["uc_plain"]!["steps"] as Record<string, unknown>[])[0]!;
    expect(step["notes"]).toEqual({ txt: "the note" });
  });

  it("accepts a step with NO backing relationship — zero errors, which is why loam must grade it", async () => {
    const { errors, views } = await parsedViews(`${SPEC}views {
  dynamic view uc_unbacked {
    orders -> web 'nothing in the model backs this'
  }
}
`);
    expect(errors).toBe(0);
    const steps = views["uc_unbacked"]!["steps"] as Record<string, unknown>[];
    expect(steps).toHaveLength(1);
    expect(steps[0]!["source"]).toBe("orders");
    expect(steps[0]!["target"]).toBe("web");
  });

  it("rejects a step naming an element that does not exist, and yields that view no steps", async () => {
    const { errors, views } = await parsedViews(`${SPEC}views {
  dynamic view uc_typo {
    web -> nosuch 'typo'
  }
}
`);
    expect(errors).toBeGreaterThan(0);
    expect(views["uc_typo"]!["steps"]).toEqual([]);
  });

  it("refuses `metadata` on a step — there is no in-band slot on a hop", async () => {
    // Load-bearing for the lifecycle decision: a capability-tagged use case has
    // no baseline digest to carry, because a view has nowhere to put one.
    const { errors } = await parsedViews(`${SPEC}views {
  dynamic view uc_meta {
    web -> orders 'x' { metadata { op 'createOrder' } }
  }
}
`);
    expect(errors).toBeGreaterThan(0);
  });

  it("accepts exactly [A-Za-z0-9_-] in a tag NAME, and TRUNCATES at anything else", async () => {
    // The measurement `tagSlug` is built on. It is a whitelist rather than a
    // list of rejections because the complement is infinite: a rule that
    // flattens a slash is right about one character and silent about the rest,
    // and both ids this axis carries in a tag — a capability id spelling its
    // nesting with `/`, a `Requirement-ID` allowed a `.` — break it differently.
    //
    // The TRUNCATION is the half worth pinning. A rejected character does not
    // make the tag absent; it makes the tag SHORTER. `#x-a.b` comes back as
    // `["x-a"]`, which is a name that could be a real, different tag. Nothing in
    // loam reads a model with errors, so it cannot reach a join today — this
    // assertion is what makes that "cannot" a measured fact rather than a hope.
    const tagged = async (name: string): Promise<{ errors: number; tags: unknown }> => {
      const parsed = await parsedViews(`specification {
  element service
  tag ${name}
}
model {
  web = service 'web'
  api = service 'api'
  web -> api 'calls'
}
views {
  dynamic view uc {
    #${name}
    title 'flow'
    web -> api 'calls'
  }
}
`);
      return { errors: parsed.errors, tags: parsed.views["uc"]?.["tags"] ?? null };
    };

    // Every accepted class in one name, including a digit and mixed case: the
    // slug must round-trip to a case-sensitive `Requirement-ID:`.
    expect(await tagged("x-AZaz09_-")).toEqual({ errors: 0, tags: ["x-AZaz09_-"] });

    for (const [name, cut] of [
      ["x-a.b", "x-a"],
      ["x-a/b", "x-a"],
      ["x-a:b", "x-a"],
      ["x-a+b", "x-a"],
      ["x-a@b", "x-a"],
      ["x-über", "x-"],
    ] as const) {
      const got = await tagged(name);
      expect(got.errors, name).toBeGreaterThan(0);
      expect(got.tags, name).toEqual([cut]);
    }
  }, 30_000);

  it("carries two tags on one view, in declaration order", async () => {
    // What makes the `#cap-` + `#req-` pair expressible at all: the second tag
    // must not replace the first, and the record must hand both back.
    const parsed = await parsedViews(`specification {
  element service
  tag cap-checkout
  tag req-CHK-ONCE
}
model {
  web = service 'web'
  api = service 'api'
  web -> api 'calls'
}
views {
  dynamic view uc {
    #cap-checkout
    #req-CHK-ONCE
    title 'flow'
    web -> api 'calls'
  }
}
`);
    expect(parsed.errors).toBe(0);
    expect(parsed.views["uc"]!["tags"]).toEqual(["cap-checkout", "req-CHK-ONCE"]);
  });

  it("requires the `#cap-` tag BEFORE `title` — after it is a parse failure, not a warning", async () => {
    // The mistake every author makes once, and the reason SCHEMA.md must spell
    // the ordering out: the diagnostics never mention tags at all.
    const after = await parsedViews(`${SPEC}views {
  dynamic view uc_late {
    title 'Checkout'
    #cap-checkout
    web -> orders 'x'
  }
}
`);
    expect(after.errors).toBeGreaterThan(0);

    const before = await parsedViews(`${SPEC}views {
  dynamic view uc_early {
    #cap-checkout
    title 'Checkout'
    web -> orders 'x'
  }
}
`);
    expect(before.errors).toBe(0);
  });

  it("mints `view_<hash>` for an unnamed view, and the hash differs between the two loaders", async () => {
    // Load-bearing for the census reader, which must NOT report a minted id:
    // it is not a claim anybody wrote, and the same document yields a
    // different one through `loadFile` than through `loadBatch`, because the
    // mint hashes the document URI and the batch stages into a temp workspace.
    const source = `${SPEC}views {
  view named {
    include *
  }
  view of web {
    include *
  }
}
`;
    const fromSource = await parsedViews(source);
    const minted = Object.keys(fromSource.views).filter((id) => /^view_[0-9a-z]+$/.test(id));
    expect(minted).toHaveLength(1);
    expect(fromSource.views["named"]).toBeDefined();

    const dir = await mkdtemp(join(tmpdir(), "loam-view-shape-"));
    await writeFile(join(dir, "m.likec4"), source, "utf8");
    const workspace = await LikeC4.fromWorkspace(dir, { logger: false });
    try {
      const model = (await workspace.parsedModel()) as unknown as {
        $data?: { views?: Record<string, Record<string, unknown>> };
      };
      const ids = Object.keys(model.$data?.views ?? {});
      // The AUTHORED name survives the crossing; the minted one does not.
      expect(ids).toContain("named");
      expect(ids).not.toContain(minted[0]!);
      expect(ids.filter((id) => /^view_[0-9a-z]+$/.test(id))).toHaveLength(1);
    } finally {
      await workspace.dispose();
      await rm(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it("returns ZERO from the ergonomic `views()` accessor — the raw record is the only path", async () => {
    const likec4 = await LikeC4.fromSource(TAGGED_VIEW);
    try {
      const model = await likec4.parsedModel();
      expect([...model.views()]).toHaveLength(0);
    } finally {
      await likec4.dispose();
    }
  });
});

/**
 * The parsed record's GLOBAL STYLE shape — the second corner of `$data` loam
 * reads, and like the first it is pinned here BEFORE the reader exists.
 *
 * Why loam reads it at all: the generated `architecture/subsystems.likec4`
 * can carry a repository's palette only by referencing a global style by id
 * (`global style <id>` inside a view), and referencing an id nothing declares
 * is a parse error that blanks the whole `architecture/` project in the
 * renderer. So the one question loam asks of this corner is "which ids are
 * DECLARED" — a census of keys, never a read of what a style says (docs/
 * DESIGN.md rule 26: a style is a rendering instruction). Every assertion
 * below is a measured fact the reader and the writer rest on, and a likec4
 * bump that moves one fails here before it reaches a generated file.
 */
async function parsedGlobals(source: string): Promise<{
  errors: string[];
  styles: Record<string, unknown>;
  views: Record<string, Record<string, unknown>>;
}> {
  const likec4 = await LikeC4.fromSource(source, { logger: false });
  try {
    const errors = likec4.getErrors().map((e) => e.message);
    const model = (await likec4.parsedModel()) as unknown as {
      $data?: {
        globals?: { styles?: Record<string, unknown> };
        views?: Record<string, Record<string, unknown>>;
      };
    };
    return { errors, styles: model.$data?.globals?.styles ?? {}, views: model.$data?.views ?? {} };
  } finally {
    await likec4.dispose();
  }
}

/** A specification declaring the tag the palette below targets, and two services to view. */
const STYLED_SPEC = `specification {
  element service
  tag provisional
  tag external
}
model {
  web = service 'checkout-web'
  orders = service 'order-service' {
    #provisional
  }
  web -> orders 'calls'
}
`;

const PALETTE = `global {
  styleGroup fleetPalette {
    style element.tag = #provisional { color muted }
  }
}
`;

describe("the parsed record's global style shape at likec4@1.59.2", () => {
  it("files a `styleGroup` under $data.globals.styles keyed by its id, with its rules inside", async () => {
    const { errors, styles } = await parsedGlobals(`${STYLED_SPEC}${PALETTE}`);
    expect(errors).toEqual([]);
    expect(Object.keys(styles)).toEqual(["fleetPalette"]);
    // What a group SAYS is recorded here too — and loam never reads it. The
    // two fields are asserted once so the next reader knows the contents ARE
    // reachable and that leaving them unread is a decision, not an oversight.
    const rules = styles["fleetPalette"] as Array<{ targets: Array<Record<string, unknown>>; style: Record<string, unknown> }>;
    expect(Array.isArray(rules)).toBe(true);
    expect(rules[0]!.targets[0]).toMatchObject({ elementTag: "provisional" });
    expect(rules[0]!.style["color"]).toBe("muted");
  });

  it("files the single-rule `global { style <id> … }` form under the SAME table, by the same key", async () => {
    // Both declaration forms land in one id table, which is why the reader
    // reports `globalStyles` rather than `styleGroups`: an author who wrote
    // the short form declared an id a view can reference exactly as a group is.
    const { errors, styles } = await parsedGlobals(
      `${STYLED_SPEC}global {\n  style fleetWide element.tag = #external { color gray }\n}\n`,
    );
    expect(errors).toEqual([]);
    expect(Object.keys(styles)).toEqual(["fleetWide"]);
  });

  it("records a view's `global style <id>` rule as `{ styleId }` — a reference, which loam writes and never reads", async () => {
    const { errors, views } = await parsedGlobals(`${STYLED_SPEC}${PALETTE}views {
  view fleet {
    title 'Fleet'
    global style fleetPalette
    include *
  }
}
`);
    expect(errors).toEqual([]);
    const rules = views["fleet"]!["rules"] as Array<Record<string, unknown>>;
    expect(rules.some((rule) => rule["styleId"] === "fleetPalette")).toBe(true);
  });

  it("refuses a reference to an id nothing declares — the parse error the emission gate exists to prevent", async () => {
    // The whole reason the generated file writes the line only when the id is
    // declared: one such error in one document blanks the model for every
    // document in the project, and the generated file is IN the renderer's
    // project. The message names the grammar rule, so the assertion can be
    // specific without pinning prose.
    const { errors } = await parsedGlobals(`${STYLED_SPEC}views {
  view fleet {
    title 'Fleet'
    global style nosuch
    include *
  }
}
`);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((message) => message.includes("GlobalStyleId"))).toBe(true);
  });

  it("takes `global style` AFTER `title` and refuses it BEFORE — the position rule the renderer writes to", async () => {
    const before = await parsedGlobals(`${STYLED_SPEC}${PALETTE}views {
  view fleet {
    global style fleetPalette
    title 'Fleet'
    include *
  }
}
`);
    expect(before.errors.length).toBeGreaterThan(0);

    const after = await parsedGlobals(`${STYLED_SPEC}${PALETTE}views {
  view fleet {
    title 'Fleet'
    description 'the whole map'
    global style fleetPalette
    include *
  }
}
`);
    expect(after.errors).toEqual([]);
  });

  it("reads NO styles from a document that declares no `global` block — absent and empty are one answer", async () => {
    const { errors, styles } = await parsedGlobals(STYLED_SPEC);
    expect(errors).toEqual([]);
    expect(styles).toEqual({});
  });

  it("in one project, a group declared in a SIBLING document reaches the project's table; a duplicate id errors", async () => {
    // Parity with the renderer: `loadArchitecture` merges the landscape with
    // every `architecture/usecases/*.likec4` exactly as `likec4.config.json`
    // does, so a palette an author keeps in a file of its own must be visible
    // to the census — or the generated views would reference nothing while
    // the renderer could resolve the id. And the converse: the same id in two
    // documents is an error, so a fleet cannot declare `subsystems` twice and
    // leave loam guessing which one a view would get.
    const project = async (files: Record<string, string>): Promise<{ errors: string[]; styles: Record<string, unknown> }> => {
      const dir = await mkdtemp(join(tmpdir(), "loam-global-shape-"));
      try {
        await writeFile(join(dir, "likec4.config.json"), JSON.stringify({ name: "fleet" }), "utf8");
        for (const [rel, body] of Object.entries(files)) {
          await mkdir(join(dir, rel, ".."), { recursive: true });
          await writeFile(join(dir, rel), body, "utf8");
        }
        const workspace = await LikeC4.fromWorkspace(dir, { logger: false });
        try {
          const errors = workspace.getErrors().map((e) => e.message);
          const model = (await workspace.parsedModel()) as unknown as {
            $data?: { globals?: { styles?: Record<string, unknown> } };
          };
          return { errors, styles: model.$data?.globals?.styles ?? {} };
        } finally {
          await workspace.dispose();
        }
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    };

    const sibling = await project({
      "landscape.likec4": `${STYLED_SPEC}${PALETTE}`,
      "usecases/style.likec4": "global {\n  styleGroup subsystems {\n    style element.tag = #external { color gray }\n  }\n}\n",
    });
    expect(sibling.errors).toEqual([]);
    expect(Object.keys(sibling.styles).sort()).toEqual(["fleetPalette", "subsystems"]);

    const duplicate = await project({
      "landscape.likec4": `${STYLED_SPEC}${PALETTE}`,
      "usecases/style.likec4": PALETTE,
    });
    expect(duplicate.errors.length).toBeGreaterThan(0);
  }, 30_000);
});
