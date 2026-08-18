/**
 * The two surfaces beside the operations: a path item's non-method keys
 * (`parameters`, `servers`, `summary`, `x-*`) and `components/<kind>/<name>`.
 *
 * The operation pin (`x-loam-based-on`, test/openapi-baseline.test.ts) cannot
 * reach either — a component's value can be a bare `true`, and a path-level key
 * applies to operations this feature never mentions — so both ride a single
 * feature-only ROOT record, `x-loam-baselines`, written by `loam rebase`,
 * graded by validate/archive/status, consumed by the merge, and stripped from
 * every living document exactly like the pins.
 *
 * The families here follow the record through its four consumers:
 *  - the identity: `valueDigest`, key-order blind and array-order sensitive
 *  - the record: what it holds, what it says is wrong with it, and why a
 *    second rebase writes the same bytes
 *  - the gate: unpinned counted into the ONE per-service warn, stale refused,
 *    an entry about nothing or about a vanished surface refused
 *  - the merge: the closure is VERDICT-driven, not reachability-driven, so a
 *    quoted component no longer drags an authoring-time copy over somebody
 *    else's landed change — and a genuinely new component rides in only when
 *    the content this merge actually WROTE reaches it
 *  - the strip: neither key may reach a living contract, on any branch
 *
 * The end-to-end tests are the point of all of it: two features editing
 * DIFFERENT components of one service used to make whichever archived second
 * revert the other's landed change, at exit 0, with no overlap between the
 * features at all.
 */
import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { OPENAPI_BASELINES_KEY, valueDigest } from "../src/core/openapi/digest.js";
import { buildRecord, readBaselineRecord, restatedSurfaces } from "../src/core/openapi/baseline/record.js";
import { mergeOpenapiPaths } from "../src/core/openapi/merge/merge.js";
import { stripOpenapiRemovalMarkers } from "../src/core/openapi/merge/markers.js";
import { featureCoherence } from "../src/core/coherence/coherence.js";
import { gatesArchive, type Issue } from "../src/core/vocabulary/issue.js";
import {
  coherentFixture,
  makeProject,
  pinOpenapi,
  runLoam,
  treeHashes,
  FEATURE_OPENAPI,
  type Project,
} from "./helpers/harness.js";

const SVC = "payment-service";
const FEAT_DIR = "features/FEAT-2-x";
const LIVING_PATH = `services/${SVC}/openapi.yaml`;
const DELTA_PATH = `${FEAT_DIR}/specs/${SVC}/openapi.yaml`;

/**
 * The living contract: one path carrying a path-LEVEL `parameters` key beside
 * its operation, and two components, one referencing the other. Every knob is
 * a title or an enum value, so a fixture can move exactly one surface and
 * leave every other digest where it was.
 */
function contract(parts: { tenant?: string; order?: string; money?: string } = {}): string {
  const { tenant = "header", order = "an order", money = "an amount" } = parts;
  return `openapi: 3.1.0
info: { title: orders, version: "1.0" }
paths:
  /orders:
    parameters: [{ name: tenant, in: ${tenant} }]
    post:
      operationId: createOrder
      requestBody:
        content:
          application/json:
            schema: { $ref: "#/components/schemas/Order" }
      responses:
        "201": { description: created }
components:
  schemas:
    Order: { type: object, title: "${order}", properties: { total: { $ref: "#/components/schemas/Money" } } }
    Money: { type: object, title: "${money}" }
`;
}

const LIVING = contract();

/** One more component on the end of a contract's `components/schemas` mapping. */
function withSchema(yaml: string, line: string): string {
  return `${yaml}    ${line}\n`;
}

type Plain = Record<string, any>;
const plain = (yaml: string): Plain => parseYaml(yaml) as Plain;
const componentOf = (yaml: string, name: string): unknown => plain(yaml).components.schemas[name];
const pathKeyOf = (yaml: string, key: string): unknown => plain(yaml).paths["/orders"][key];
const recordOf = (yaml: string): Plain | undefined => plain(yaml)[OPENAPI_BASELINES_KEY];

/** The two component titles, in a shape a failure message can read. */
const titles = (yaml: string): Record<string, unknown> => ({
  order: (componentOf(yaml, "Order") as Plain).title,
  money: (componentOf(yaml, "Money") as Plain).title,
});

/**
 * `loam rebase`'s output with the surface record taken back out — a delta whose
 * OPERATIONS are all pinned and whose surfaces are not. It is what every
 * in-flight feature authored before the record existed looks like, and it is
 * the fixture that isolates the new counts: any finding it earns is about the
 * surfaces, because there is no unpinned operation left to earn one.
 */
function opsPinnedOnly(featureYaml: string, livingYaml: string): string {
  const doc = plain(pinOpenapi(featureYaml, livingYaml));
  delete doc[OPENAPI_BASELINES_KEY];
  return stringifyYaml(doc);
}

/** The coherent fleet with payment-service's contract replaced, plus one feature per delta. */
function fleet(deltas: Record<string, string>, living: string = LIVING): Record<string, string> {
  const files = coherentFixture();
  files[LIVING_PATH] = living;
  for (const [id, api] of Object.entries(deltas)) {
    files[`features/${id}-x/intent.md`] = `---\nfeature: ${id}\nstatus: proposed\n---\n\n# ${id}\n\nWhy.\n`;
    files[`features/${id}-x/specs/${SVC}/openapi.yaml`] = api;
  }
  return files;
}

/** Everything `loam archive` would refuse on, from the function it calls. */
async function coherenceOf(files: Record<string, string>): Promise<Issue[]> {
  const p: Project = await makeProject(files);
  try {
    return await featureCoherence({
      docsDir: p.docsDir,
      featureDir: join(p.docsDir, "features", "FEAT-2-x"),
      featureId: "FEAT-2",
    });
  } finally {
    await p.destroy();
  }
}

const only = (issues: Issue[], code: string): Issue[] => issues.filter((i) => i.code === code);

interface Pin {
  file: string;
  kind: string;
  target: string;
  status: string;
  from: string | null;
  to: string | null;
}

/** The pins `loam rebase --json` reports for the two surface families. */
async function rebaseSurfaces(p: Project, feature = "FEAT-2"): Promise<Pin[]> {
  const run = await runLoam(p.workDir, "rebase", feature, "--json");
  expect(run.code).toBe(0);
  const payload = JSON.parse(run.stdout) as { pins: Pin[] };
  return payload.pins.filter((pin) => pin.kind === "COMPONENT" || pin.kind === "PATH-ITEM");
}

/* ------------------------------------------------------------------ */
/* The identity                                                        */
/* ------------------------------------------------------------------ */

describe("valueDigest — one identity for any value a surface can hold", () => {
  it("ignores key order, because the merge's own comparison does", () => {
    // Same rule as operationDigest, and for the same reason: the merge decides
    // "this component differs" with isDeepStrictEqual, which is order-blind. A
    // digest that were not would call a reordered mapping a collision.
    const a = { type: "object", title: "t", properties: { id: { type: "string" } } };
    const b = { properties: { id: { type: "string" } }, title: "t", type: "object" };
    expect(valueDigest(a)).toBe(valueDigest(b));
  });

  it("does not ignore array order, because that is content", () => {
    // A path-level `parameters` list is an array, and its order is the
    // contract's own — two parameters swapped is a real edit.
    const one = [{ name: "tenant", in: "header" }, { name: "trace", in: "header" }];
    const other = [{ name: "trace", in: "header" }, { name: "tenant", in: "header" }];
    expect(valueDigest(one)).not.toBe(valueDigest(other));
  });

  it("is legal over a scalar and a boolean — a JSON-Schema component can be `true`", () => {
    // The reason the pin lives in a ROOT record rather than inside the value:
    // no in-value `x-loam-based-on` survives a component spelled `true`.
    expect(valueDigest(true)).toMatch(/^[0-9a-f]{16}$/);
    expect(valueDigest(false)).toMatch(/^[0-9a-f]{16}$/);
    expect(valueDigest(true)).not.toBe(valueDigest(false));
    expect(valueDigest("a summary")).toMatch(/^[0-9a-f]{16}$/);
    expect(valueDigest(null)).not.toBe(valueDigest(false));
  });
});

/* ------------------------------------------------------------------ */
/* The record                                                          */
/* ------------------------------------------------------------------ */

describe("the x-loam-baselines record", () => {
  it("reads back exactly what rebase wrote, with nothing to report about it", () => {
    const { record, problems } = readBaselineRecord(plain(pinOpenapi(LIVING, LIVING)));
    expect(problems).toEqual([]);
    expect(record).toEqual({
      pathItems: { "/orders": { parameters: valueDigest(pathKeyOf(LIVING, "parameters")) } },
      components: {
        "schemas/Money": valueDigest(componentOf(LIVING, "Money")),
        "schemas/Order": valueDigest(componentOf(LIVING, "Order")),
      },
    });
  });

  it("DESCRIBES a malformed record instead of diagnosing it — the gate refuses, parsers never print", () => {
    const notAMapping = readBaselineRecord(plain(`${OPENAPI_BASELINES_KEY}: nonsense\n`));
    expect(notAMapping.problems).toHaveLength(1);
    expect(notAMapping.record).toEqual({ pathItems: {}, components: {} });

    const badDigest = readBaselineRecord(
      plain(`${OPENAPI_BASELINES_KEY}:
  pathItems:
    /orders:
      parameters: yesterday
  components:
    "schemas/Order": 0123456789abcdef
    "schemas/Money": TOO-SHORT
  wat: {}
`),
    );
    // Three faults, three problems, and the ONE legal entry still readable:
    // a record nobody can grade whole is not a record with nothing in it.
    expect(badDigest.problems).toHaveLength(3);
    expect(badDigest.record).toEqual({ pathItems: {}, components: { "schemas/Order": "0123456789abcdef" } });
  });

  it("builds sorted at every level, which is what makes a second rebase byte-identical", () => {
    const forward = buildRecord({
      pathItems: new Map([
        ["/b", new Map([["servers", "1".repeat(16)], ["parameters", "2".repeat(16)]])],
        ["/a", new Map([["summary", "3".repeat(16)]])],
      ]),
      components: new Map([["schemas/Z", "4".repeat(16)], ["schemas/A", "5".repeat(16)]]),
    });
    const backward = buildRecord({
      pathItems: new Map([
        ["/a", new Map([["summary", "3".repeat(16)]])],
        ["/b", new Map([["parameters", "2".repeat(16)], ["servers", "1".repeat(16)]])],
      ]),
      components: new Map([["schemas/A", "5".repeat(16)], ["schemas/Z", "4".repeat(16)]]),
    });
    expect(Object.keys(forward.pathItems)).toEqual(["/a", "/b"]);
    expect(Object.keys(forward.pathItems["/b"]!)).toEqual(["parameters", "servers"]);
    expect(Object.keys(forward.components)).toEqual(["schemas/A", "schemas/Z"]);
    // Insertion order cannot survive into the bytes, or every run would repin.
    expect(JSON.stringify(backward)).toBe(JSON.stringify(forward));
  });

  it("replaces a numeric-named living component in place, never duplicating the key", async () => {
    // A living `404:` response is the YAML number 404; the plain setIn with
    // the string "404" missed it and APPENDED a second pair — the contract
    // then declared the component twice, forever, with the pre-merge copy
    // first in reading order and every later merge feeding the ghost.
    const p = await makeProject(coherentFixture(), { service: SVC });
    try {
      await p.write(
        `services/${SVC}/openapi.yaml`,
        [
          "openapi: 3.0.0",
          "info: { title: t, version: '1' }",
          "paths:",
          "  /orders:",
          "    get: { operationId: listOrders, responses: { '200': { description: ok } } }",
          "components:",
          "  responses:",
          "    404:",
          "      description: The order does not exist.",
          "",
        ].join("\n"),
      );
      await p.write(
        `features/FEAT-1-split/specs/${SVC}/openapi.yaml`,
        [
          "openapi: 3.0.0",
          "info: { title: t, version: '1' }",
          "paths:",
          "  /orders:",
          "    get: { operationId: listOrders, responses: { '200': { description: ok } } }",
          "components:",
          "  responses:",
          "    '404':",
          "      description: Clarified for v2 clients.",
          "",
        ].join("\n"),
      );
      expect((await runLoam(p.workDir, "rebase", "FEAT-1")).code).toBe(0);
      expect((await runLoam(p.workDir, "archive", "FEAT-1", "--approve")).code).toBe(0);
      const living = await p.read(`services/${SVC}/openapi.yaml`);
      expect(living).toContain("Clarified for v2 clients.");
      expect(living).not.toContain("The order does not exist.");
      // ONE 404 pair, whatever its scalar type.
      expect(living.match(/404/g)!.length).toBeLessThanOrEqual(2); // key + possibly a ref; never two keyed entries with both descriptions
    } finally {
      await p.destroy();
    }
  });

  it("strips feature-only keys nested inside a component before it reaches the living contract", async () => {
    // A pathItems component holds an operation shape, and the operation-level
    // strip never walks components: --approve once published
    // `x-loam-remove: true` inside a living component, invisible even to
    // validate, whose marker sweep reads paths alone.
    const p = await makeProject(coherentFixture(), { service: SVC });
    try {
      // The living contract already declares the component (marker-free), so
      // the feature's restatement is a pinned EDIT — the copied path, where
      // the leak lived. An unreachable NEW component would stay behind by
      // design and never exercise the strip.
      await p.write(
        `services/${SVC}/openapi.yaml`,
        [
          "openapi: 3.0.0",
          "info: { title: t, version: '1' }",
          "paths:",
          "  /orders:",
          "    get: { operationId: listOrders, responses: { '200': { description: ok } } }",
          "components:",
          "  pathItems:",
          "    LegacyOrders:",
          "      get:",
          "        operationId: legacyList",
          "",
        ].join("\n"),
      );
      await p.write(
        `features/FEAT-1-split/specs/${SVC}/openapi.yaml`,
        [
          "openapi: 3.0.0",
          "info: { title: t, version: '1' }",
          "paths:",
          "  /orders:",
          "    get: { operationId: listOrders, responses: { '200': { description: ok } } }",
          "components:",
          "  pathItems:",
          "    LegacyOrders:",
          "      get:",
          "        x-loam-remove: true",
          "        operationId: legacyList",
          "        summary: retired",
          "",
        ].join("\n"),
      );
      expect((await runLoam(p.workDir, "rebase", "FEAT-1")).code).toBe(0);
      expect((await runLoam(p.workDir, "archive", "FEAT-1", "--approve")).code).toBe(0);
      const living = await p.read(`services/${SVC}/openapi.yaml`);
      expect(living).toContain("LegacyOrders");
      expect(living).not.toContain("x-loam-remove");
      expect(living).not.toContain("x-loam-based-on");
    } finally {
      await p.destroy();
    }
  });

  it("retires the whole path with its last operation, surviving path-level keys included", async () => {
    // `{}` was only the easy shape of a dead path: a surviving `parameters`
    // block kept the path advertised with zero operations answering it.
    const p = await makeProject(coherentFixture(), { service: SVC });
    try {
      await p.write(
        `services/${SVC}/openapi.yaml`,
        [
          "openapi: 3.0.0",
          "info: { title: t, version: '1' }",
          "paths:",
          "  /v1/orders:",
          "    parameters:",
          "      - { name: X-Partner-Id, in: header, required: true, schema: { type: string } }",
          "    post: { operationId: createOrderV1, responses: { '200': { description: ok } } }",
          "",
        ].join("\n"),
      );
      await p.write(
        `features/FEAT-1-split/specs/${SVC}/openapi.yaml`,
        [
          "openapi: 3.0.0",
          "info: { title: t, version: '1' }",
          "paths:",
          "  /v1/orders:",
          "    parameters:",
          "      - { name: X-Partner-Id, in: header, required: true, schema: { type: string } }",
          "    post:",
          "      x-loam-remove: true",
          "      operationId: createOrderV1",
          "",
        ].join("\n"),
      );
      expect((await runLoam(p.workDir, "rebase", "FEAT-1")).code).toBe(0);
      expect((await runLoam(p.workDir, "archive", "FEAT-1", "--approve")).code).toBe(0);
      const living = await p.read(`services/${SVC}/openapi.yaml`);
      expect(living).not.toContain("/v1/orders");
      expect(living).not.toContain("X-Partner-Id");
    } finally {
      await p.destroy();
    }
  });

  it("treats a non-method key with a removal-shaped VALUE as a surface — pinned, graded, never smuggled", () => {
    // The enumeration once skipped any value that looked like a removal
    // marker, methods and non-methods alike. For a non-method key that skip
    // was a hole with teeth: rebase wrote no pin, the gate said nothing, and
    // the merge wrote `{x-loam-remove: true}` over a living shared
    // `parameters` array at exit 0. A method's removal marker stays the
    // operation pin's territory; a non-method key is a surface whatever its
    // value looks like.
    const doc = {
      paths: { "/orders": { parameters: { "x-loam-remove": true }, get: { operationId: "a" } } },
    };
    const surfaces = restatedSurfaces(doc);
    expect(surfaces).toEqual([
      { kind: "path-item", path: "/orders", key: "parameters", value: { "x-loam-remove": true } },
    ]);
  });

  it("enumerates the surfaces ONE way for the plan, the gate and the merge", () => {
    const surfaces = restatedSurfaces(
      plain(`paths:
  /orders:
    parameters: [{ name: tenant, in: header }]
    summary: the orders collection
    x-loam-remove: true
    post: { operationId: createOrder }
    delete: { operationId: dropOrder, x-loam-remove: true }
components:
  schemas:
    Order: { type: object }
  parameters:
    Tenant: { name: tenant, in: header }
`),
    );
    // Methods are the operation pin's business; a removal marker stays an
    // operation matter; the feature-only keys are bookkeeping, not surfaces.
    expect(surfaces.map((s) => (s.kind === "path-item" ? `${s.path} ${s.key}` : s.id))).toEqual([
      "/orders parameters",
      "/orders summary",
      "schemas/Order",
      "parameters/Tenant",
    ]);
  });
});

/* ------------------------------------------------------------------ */
/* loam rebase writes the record                                       */
/* ------------------------------------------------------------------ */

describe("loam rebase records the surface baselines", () => {
  /** The living contract restated verbatim, plus one component that is genuinely new. */
  const RESTATING = withSchema(LIVING, 'Split: { type: object, title: "a split" }');

  it("pins a restated component and a restated path-level key, and invents nothing for a new one", async () => {
    const p = await makeProject(fleet({ "FEAT-2": RESTATING }));
    try {
      const surfaces = await rebaseSurfaces(p);
      expect(surfaces.map((pin) => [pin.kind, pin.target, pin.status])).toEqual([
        ["PATH-ITEM", "/orders 'parameters'", "pinned"],
        ["COMPONENT", "schemas/Order", "pinned"],
        ["COMPONENT", "schemas/Money", "pinned"],
        // Nothing living to be based on: `loam rebase` states a baseline, it
        // never invents one.
        ["COMPONENT", "schemas/Split", "unresolved"],
      ]);
      expect(surfaces.at(-1)!.to).toBeNull();
      // The record is exactly the three resolvable surfaces — Split has NO
      // entry, which is what keeps the merge from calling it `unfounded`.
      expect(recordOf(await p.read(DELTA_PATH))).toEqual({
        pathItems: { "/orders": { parameters: valueDigest(pathKeyOf(LIVING, "parameters")) } },
        components: {
          "schemas/Money": valueDigest(componentOf(LIVING, "Money")),
          "schemas/Order": valueDigest(componentOf(LIVING, "Order")),
        },
      });
    } finally {
      await p.destroy();
    }
  });

  it("is idempotent: a second run calls every resolved pin unchanged and writes nothing at all", async () => {
    const p = await makeProject(fleet({ "FEAT-2": RESTATING }));
    try {
      await rebaseSurfaces(p);
      const before = await treeHashes(p.docsDir);
      const second = await rebaseSurfaces(p);
      expect(second.map((pin) => pin.status)).toEqual(["unchanged", "unchanged", "unchanged", "unresolved"]);
      // Byte-identical, and no other file touched either: a wholesale record
      // written in unsorted key order would repin on every run and poison diffs.
      expect(await treeHashes(p.docsDir)).toEqual(before);
    } finally {
      await p.destroy();
    }
  });

  it("repins when the living value moved under the entry", async () => {
    const p = await makeProject(fleet({ "FEAT-2": RESTATING }));
    try {
      await rebaseSurfaces(p);
      const moved = contract({ money: "an amount, someone else's change" });
      await p.write(LIVING_PATH, moved);
      const surfaces = await rebaseSurfaces(p);
      expect(surfaces.map((pin) => [pin.target, pin.status])).toEqual([
        ["/orders 'parameters'", "unchanged"],
        ["schemas/Order", "unchanged"],
        ["schemas/Money", "repinned"],
        ["schemas/Split", "unresolved"],
      ]);
      const money = surfaces.find((pin) => pin.target === "schemas/Money")!;
      expect(money.from).toBe(valueDigest(componentOf(LIVING, "Money")));
      expect(money.to).toBe(valueDigest(componentOf(moved, "Money")));
    } finally {
      await p.destroy();
    }
  });

  it("prunes an entry the delta has stopped restating", async () => {
    const p = await makeProject(fleet({ "FEAT-2": RESTATING }));
    try {
      await rebaseSurfaces(p);
      // The author drops the components block after rebasing. The entries are
      // claims about what they read; a claim nobody is making any more must go.
      const pinned = plain(await p.read(DELTA_PATH));
      delete pinned.components;
      await p.write(DELTA_PATH, stringifyYaml(pinned));

      const surfaces = await rebaseSurfaces(p);
      expect(surfaces.map((pin) => [pin.target, pin.status])).toEqual([["/orders 'parameters'", "unchanged"]]);
      expect(recordOf(await p.read(DELTA_PATH))).toEqual({
        pathItems: { "/orders": { parameters: valueDigest(pathKeyOf(LIVING, "parameters")) } },
      });
    } finally {
      await p.destroy();
    }
  });
});

/* ------------------------------------------------------------------ */
/* The gate                                                            */
/* ------------------------------------------------------------------ */

describe("the gate grades the surfaces beside the operations", () => {
  it("counts unpinned surfaces into the ONE per-service warn, and that warn gates", async () => {
    const [issue, ...rest] = only(await coherenceOf(fleet({ "FEAT-2": LIVING })), "openapi.baseline-missing");
    expect(rest).toEqual([]);
    expect(issue!.severity).toBe("warn");
    expect(gatesArchive(issue!)).toBe(true);
    // ONE finding for four unpinned surfaces, and the counts are appended to
    // the operation fragment rather than replacing it: an agent that greps for
    // the operation count keeps working, and the two new families are legible.
    expect(issue!.message).toContain("1 operation(s), 1 path-level key(s) and 2 component(s)");
    expect(issue!.message).toContain(`loam rebase FEAT-2 --service ${SVC}`);
  });

  it("fires for the surfaces ALONE, with every operation already pinned", async () => {
    // The state every in-flight feature authored before the record existed is
    // in: operations pinned, surfaces not. Zero unpinned operations, and the
    // archive still gates — which is the whole of what step 4 added.
    const [issue, ...rest] = only(
      await coherenceOf(fleet({ "FEAT-2": opsPinnedOnly(LIVING, LIVING) })),
      "openapi.baseline-missing",
    );
    expect(rest).toEqual([]);
    expect(gatesArchive(issue!)).toBe(true);
    expect(issue!.message).toContain("0 operation(s), 1 path-level key(s) and 2 component(s)");
  });

  it("refuses a stale component, naming both digests and the command that repins", async () => {
    const delta = pinOpenapi(contract({ order: "an order, as this feature means it" }), LIVING);
    const moved = contract({ order: "an order, someone else's change" });
    const [issue, ...rest] = only(await coherenceOf(fleet({ "FEAT-2": delta }, moved)), "openapi.baseline-stale");
    expect(rest).toEqual([]);
    expect(issue!.severity).toBe("error");
    expect(gatesArchive(issue!)).toBe(true);
    expect(issue!.message).toContain("schemas/Order");
    expect(issue!.message).toContain(valueDigest(componentOf(LIVING, "Order")));
    expect(issue!.message).toContain(valueDigest(componentOf(moved, "Order")));
    expect(issue!.message).toContain("loam rebase FEAT-2");
  });

  it("says nothing about a quoted surface, however far the living value has moved", async () => {
    const delta = pinOpenapi(LIVING, LIVING);
    const moved = contract({ order: "an order, someone else's change", tenant: "query" });
    const issues = await coherenceOf(fleet({ "FEAT-2": delta }, moved));
    expect(only(issues, "openapi.baseline-stale")).toEqual([]);
    expect(only(issues, "openapi.baseline-missing")).toEqual([]);
    expect(only(issues, "openapi.baseline-invalid")).toEqual([]);
  });

  it("refuses an entry about nothing and one about a vanished surface, and does not confuse them", async () => {
    // (a) The delta stopped declaring the component but kept the entry.
    const orphaned = plain(pinOpenapi(LIVING, LIVING));
    delete orphaned.components.schemas.Money;
    const [aboutNothing, ...restA] = only(
      await coherenceOf(fleet({ "FEAT-2": stringifyYaml(orphaned) })),
      "openapi.baseline-invalid",
    );
    expect(restA).toEqual([]);

    // (b) The delta still declares it; the LIVING side is what vanished, so
    // the pin cannot be resolved against anything at all.
    const livingGone = plain(LIVING);
    delete livingGone.components.schemas.Money;
    const [vanished, ...restB] = only(
      await coherenceOf(fleet({ "FEAT-2": pinOpenapi(LIVING, LIVING) }, stringifyYaml(livingGone))),
      "openapi.baseline-invalid",
    );
    expect(restB).toEqual([]);

    expect(aboutNothing!.severity).toBe("error");
    expect(vanished!.severity).toBe("error");
    expect(aboutNothing!.message).toContain("schemas/Money");
    expect(vanished!.message).toContain("schemas/Money");
    // Two structurally different faults with one remedy still get two
    // sentences: "you deleted the surface" and "somebody deleted the living
    // one" are not the same thing to fix.
    expect(aboutNothing!.message).not.toBe(vanished!.message);
  });

  it("refuses a malformed record rather than grading against it", async () => {
    const [issue] = only(
      await coherenceOf(fleet({ "FEAT-2": `${LIVING}${OPENAPI_BASELINES_KEY}: nonsense\n` })),
      "openapi.baseline-invalid",
    );
    expect(issue!.severity).toBe("error");
    expect(gatesArchive(issue!)).toBe(true);
    expect(issue!.message).toContain(OPENAPI_BASELINES_KEY);
  });
});

/* ------------------------------------------------------------------ */
/* The merge: a verdict-driven closure                                 */
/* ------------------------------------------------------------------ */

describe("the component closure follows the verdicts, not reachability", () => {
  it("writes an edited component even when every operation is a quote", () => {
    // The delta touches no operation at all — the change is entirely inside a
    // schema. Under a reachability closure this rode in on the quoted
    // operation's refs; under the verdicts it rides in on its own.
    const delta = pinOpenapi(LIVING, LIVING).replace('title: "an amount"', 'title: "an amount, per this feature"');
    const merged = mergeOpenapiPaths(LIVING, delta, SVC);
    expect(merged.modified).toEqual([]);
    expect(merged.quoted).toHaveLength(1);
    expect(merged.componentsModified).toEqual(["schemas/Money"]);
    expect(merged.componentsQuoted).toEqual(["schemas/Order"]);
    expect(titles(merged.text!)).toEqual({ order: "an order", money: "an amount, per this feature" });
  });

  it("copies A alone from a cycle A↔B when only A was edited, and terminates", () => {
    const cyclic = `openapi: 3.1.0
info: { title: orders, version: "1.0" }
paths:
  /orders:
    post:
      operationId: createOrder
      requestBody:
        content:
          application/json:
            schema: { $ref: "#/components/schemas/A" }
      responses:
        "201": { description: created }
components:
  schemas:
    A: { type: object, title: "a", properties: { b: { $ref: "#/components/schemas/B" } } }
    B: { type: object, title: "b", properties: { a: { $ref: "#/components/schemas/A" } } }
`;
    const delta = pinOpenapi(cyclic, cyclic).replace('title: "a"', 'title: "a, edited"');
    const merged = mergeOpenapiPaths(cyclic, delta, SVC);
    // The test completing at all is half the assertion: a closure without a
    // visited set never returns from this document.
    expect(merged.componentsModified).toEqual(["schemas/A"]);
    expect(merged.componentsQuoted).toEqual(["schemas/B"]);
    expect(merged.unresolved).toEqual([]);
    const out = plain(merged.text!);
    expect(out.components.schemas.A.title).toBe("a, edited");
    expect(out.components.schemas.B.title, "B was quoted: living's copy stands").toBe("b");
  });

  it("carries a NEW component's whole cycle in when written content reaches it", () => {
    // The fixpoint: NewA is reachable from the edited operation, NewB only
    // from NewA. A closure that walked written content alone would copy NewA
    // and leave the merged document referencing a component nobody wrote.
    const authored = withSchema(
      withSchema(
        LIVING.replace('"#/components/schemas/Order"', '"#/components/schemas/NewA"'),
        'NewA: { type: object, properties: { b: { $ref: "#/components/schemas/NewB" } } }',
      ),
      'NewB: { type: object, properties: { a: { $ref: "#/components/schemas/NewA" } } }',
    );
    const merged = mergeOpenapiPaths(LIVING, pinOpenapi(authored, LIVING), SVC);
    const out = plain(merged.text!);
    expect(out.components.schemas.NewA, "the written operation reaches NewA").toBeDefined();
    expect(out.components.schemas.NewB, "and NewA's own refs reach NewB").toBeDefined();
    expect(merged.unresolved).toEqual([]);
    // New components are copies, not overwrites: nothing was there to modify.
    expect(merged.componentsModified).toEqual([]);
  });

  it("leaves a NEW component behind when only a QUOTED operation reaches it", () => {
    // The living contract references a schema it does not define — not loam's
    // to fix — and the delta supplies it. But the only thing reaching it is an
    // operation this delta QUOTED, and a quote is not a merge input: the
    // closure starts from what this merge WROTE, which is nothing.
    const livingDangling = LIVING.replace('#/components/schemas/Order', '#/components/schemas/Fresh');
    const delta = pinOpenapi(withSchema(livingDangling, 'Fresh: { type: object, title: "fresh" }'), livingDangling);
    const merged = mergeOpenapiPaths(livingDangling, delta, SVC);
    expect(merged.quoted).toHaveLength(1);
    expect(merged.componentsModified).toEqual([]);
    expect(plain(merged.text!).components.schemas.Fresh).toBeUndefined();
    // Nothing was written, so the ref sweep has nothing to sweep — living's
    // own dangling ref is living's business, not this merge's.
    expect(merged.unresolved).toEqual([]);
  });

  it("still reports a $ref that resolves in neither document, from a pinned delta", () => {
    const edited = LIVING.replace(
      "      operationId: createOrder",
      '      operationId: createOrder\n      parameters: [{ $ref: "#/components/parameters/Missing" }]',
    );
    const merged = mergeOpenapiPaths(LIVING, pinOpenapi(edited, LIVING), SVC);
    expect(merged.unresolved).toEqual([{ ref: "#/components/parameters/Missing", from: "paths /orders" }]);
  });
});

describe("the closure copies what the feature DECLARES — the behavior change", () => {
  it("writes a differing declared component nothing references, and still drops an unreachable new one", () => {
    // THE CHANGE, both halves in one document. Before the verdict-driven
    // closure a component was copied only when some feature path item reached
    // it, so a feature that redefined `Ledger` — which no operation in the
    // document references — had its change silently dropped and the living
    // value stood. It is now copied and named in componentsModified, which is
    // wider than the CHANGELOG's 'Changed' entry (that one describes the new
    // refusals). The other half is deliberately unchanged: `Unused` is
    // genuinely NEW and nothing written reaches it, so it stays behind exactly
    // as test/openapi-merge.test.ts's "Unused is dropped" pins it.
    const living = withSchema(LIVING, 'Ledger: { type: object, title: "as living has it" }');
    const delta = withSchema(
      withSchema(
        LIVING.replace("description: created", "description: created and confirmed"),
        'Ledger: { type: object, title: "as the feature has it" }',
      ),
      'Unused: { type: object, title: "new, and referenced by nothing" }',
    );
    const merged = mergeOpenapiPaths(living, delta, SVC);
    const out = plain(merged.text!);
    expect(merged.componentsModified).toEqual(["schemas/Ledger"]);
    expect(out.components.schemas.Ledger.title).toBe("as the feature has it");
    expect(out.components.schemas.Unused, "an unreachable NEW component stays behind").toBeUndefined();
  });
});

/* ------------------------------------------------------------------ */
/* Two features over one service, end to end                           */
/* ------------------------------------------------------------------ */

describe("two features over one service's components", () => {
  /** FEAT-2 edits Order, FEAT-3 edits Money; each RESTATES the other's component. */
  const bothEdits = (): Record<string, string> =>
    fleet({
      "FEAT-2": pinOpenapi(contract({ order: "an order, per FEAT-2" }), LIVING),
      "FEAT-3": pinOpenapi(contract({ money: "an amount, per FEAT-3" }), LIVING),
    });

  it("archives cleanly in either order, and both edits survive", async () => {
    // The headline loss: no overlap between the features at all, and whichever
    // archived second reverted the other's landed change at exit 0.
    for (const order of [["FEAT-2", "FEAT-3"], ["FEAT-3", "FEAT-2"]] as const) {
      const p = await makeProject(bothEdits());
      try {
        for (const id of order) {
          expect((await runLoam(p.workDir, "archive", id)).code, `${id} after ${order.join(" then ")}`).toBe(0);
        }
        expect(titles(await p.read(LIVING_PATH)), order.join(" then ")).toEqual({
          order: "an order, per FEAT-2",
          money: "an amount, per FEAT-3",
        });
      } finally {
        await p.destroy();
      }
    }
  });

  it("refuses the same-component collision after the first lands, and writes nothing", async () => {
    const p = await makeProject(
      fleet({
        "FEAT-2": pinOpenapi(contract({ order: "an order, per FEAT-2" }), LIVING),
        "FEAT-3": pinOpenapi(contract({ order: "an order, per FEAT-3" }), LIVING),
      }),
    );
    try {
      expect((await runLoam(p.workDir, "archive", "FEAT-2")).code).toBe(0);
      const before = await treeHashes(p.docsDir);
      const blocked = await runLoam(p.workDir, "archive", "FEAT-3", "--json");
      expect(blocked.code).toBe(1);
      const refusal = JSON.parse(blocked.stdout + blocked.stderr) as {
        error: { code: string };
        issues: Array<{ code: string; gates: boolean }>;
      };
      expect(refusal.error.code).toBe("not-coherent");
      expect(refusal.issues).toContainEqual(
        expect.objectContaining({ code: "openapi.baseline-stale", gates: true, subject: SVC }),
      );
      // A refusal that left a partial write would be worse than the loss it
      // refuses: the whole tree is byte-identical, and FEAT-2's change stands.
      expect(await treeHashes(p.docsDir)).toEqual(before);
      expect(titles(await p.read(LIVING_PATH)).order).toBe("an order, per FEAT-2");
    } finally {
      await p.destroy();
    }
  });

  it("--approve pushes past the collision, and the plan says what the overwrite cost", async () => {
    const p = await makeProject(
      fleet({
        "FEAT-2": pinOpenapi(contract({ order: "an order, per FEAT-2" }), LIVING),
        "FEAT-3": pinOpenapi(contract({ order: "an order, per FEAT-3" }), LIVING),
      }),
    );
    try {
      expect((await runLoam(p.workDir, "archive", "FEAT-2")).code).toBe(0);
      const approved = await runLoam(p.workDir, "archive", "FEAT-3", "--approve");
      expect(approved.code).toBe(0);
      expect(approved.out).toContain("stale baseline on component schemas/Order");
      expect(titles(await p.read(LIVING_PATH)).order).toBe("an order, per FEAT-3");
    } finally {
      await p.destroy();
    }
  });
});

/* ------------------------------------------------------------------ */
/* The record never reaches a living contract                          */
/* ------------------------------------------------------------------ */

describe("the strip: feature bookkeeping stays in the feature", () => {
  it("the MERGED living contract carries neither the record nor an operation pin", async () => {
    const p = await makeProject(fleet({ "FEAT-2": pinOpenapi(contract({ order: "an order, per FEAT-2" }), LIVING) }));
    try {
      expect((await runLoam(p.workDir, "archive", "FEAT-2")).code).toBe(0);
      const living = await p.read(LIVING_PATH);
      expect(living).not.toContain(OPENAPI_BASELINES_KEY);
      expect(living).not.toContain("x-loam-based-on");
      expect(titles(living).order).toBe("an order, per FEAT-2");
    } finally {
      await p.destroy();
    }
  });

  it("the CREATE branch strips the record even when the paths hold nothing to strip", async () => {
    // FEAT-1 brings payment-split-service into existence, so archive publishes
    // the delta verbatim through stripOpenapiRemovalMarkers. This document has
    // no removal marker and no pin — nothing inside `paths` to strip at all —
    // and the record must not ride out on that early return.
    const files = coherentFixture();
    files["features/FEAT-1-split/specs/payment-split-service/openapi.yaml"] =
      `${FEATURE_OPENAPI}${OPENAPI_BASELINES_KEY}:\n  components:\n    "schemas/Ghost": 0123456789abcdef\n`;
    const p = await makeProject(files);
    try {
      expect((await runLoam(p.workDir, "archive", "FEAT-1")).code).toBe(0);
      const created = await p.read("services/payment-split-service/openapi.yaml");
      expect(created).not.toContain(OPENAPI_BASELINES_KEY);
      expect(created).not.toContain("schemas/Ghost");
      expect(plain(created).paths["/splits"].post.operationId).toBe("createSplit");
    } finally {
      await p.destroy();
    }
  });

  it("a components-only delta has no paths to strip, and still loses the record", () => {
    // The other early return, over the function archive's create branch
    // publishes verbatim (commands/archive/plan/specs.ts): a delta whose whole
    // change is a component has no `paths` mapping at all.
    const componentsOnly = `openapi: 3.1.0
info: { title: payment-split-service, version: "1.0" }
components:
  schemas:
    Split: { type: object }
${OPENAPI_BASELINES_KEY}:
  components:
    "schemas/Split": 0123456789abcdef
`;
    const text = stripOpenapiRemovalMarkers(componentsOnly, "payment-split-service");
    expect(text).not.toContain(OPENAPI_BASELINES_KEY);
    expect(plain(text).components.schemas.Split).toEqual({ type: "object" });
  });

  it("archive then unarchive restores the living contract byte-for-byte", async () => {
    const p = await makeProject(fleet({ "FEAT-2": pinOpenapi(contract({ money: "an amount, per FEAT-2" }), LIVING) }));
    try {
      const before = await treeHashes(p.docsDir);
      expect((await runLoam(p.workDir, "archive", "FEAT-2")).code).toBe(0);
      expect(titles(await p.read(LIVING_PATH)).money, "the archive really did move the surface").toBe(
        "an amount, per FEAT-2",
      );
      expect((await runLoam(p.workDir, "unarchive", "FEAT-2")).code).toBe(0);
      expect(await treeHashes(p.docsDir)).toEqual(before);
    } finally {
      await p.destroy();
    }
  });
});

/* ------------------------------------------------------------------ */
/* The third consumer                                                  */
/* ------------------------------------------------------------------ */

describe("loam status", () => {
  it("shows the gating surface warn — status grades features from the same function", async () => {
    // featureCoherence has three consumers: validate, archive, and status.
    // Every operation here is pinned, so this finding exists only because the
    // surfaces are graded — and a feature that archive will refuse must not
    // read as ready in the projection an agent polls.
    const p = await makeProject(fleet({ "FEAT-2": opsPinnedOnly(LIVING, LIVING) }));
    try {
      const run = await runLoam(p.workDir, "status", "FEAT-2", "--json");
      expect(run.code).toBe(0);
      const payload = JSON.parse(run.stdout) as {
        checks: { gating: number; issues: Array<{ code: string; gates: boolean; subject?: string }> };
      };
      expect(payload.checks.issues).toContainEqual(
        expect.objectContaining({ code: "openapi.baseline-missing", gates: true, subject: SVC }),
      );
      expect(payload.checks.gating).toBeGreaterThan(0);
    } finally {
      await p.destroy();
    }
  });
});
