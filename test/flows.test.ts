/**
 * Deep unit invariants for src/core/c4/flows/: the dynamic views loam reads out
 * of a parsed document, and the join from a step to the relationship that
 * carries the operation it exercises.
 *
 * Two properties are load-bearing here and neither is visible in a rendered
 * diagram. The BRANCH TREE has to survive the flatten — a later slice asks
 * "which branch does no scenario cover?", and an `alt` flattened into its steps
 * has lost the question, not just the shape. The STEP→RELATIONSHIP join has to
 * happen at the PARSED stage — a parsed step carries no `metadata`, so its
 * operationId can only come from the relationship it matches, and LikeC4's own
 * answer (`ComputedEdge.relations`) lives one stage up, behind the view
 * computation that `validate --all` exists to never pay for.
 *
 * The fixtures deliberately declare relationships between SERVICES and draw
 * steps between CONTAINERS, because that mismatch is the case the join is for:
 * matching only the exact pair reports a fleet's real landscapes as journeys
 * between elements nothing connects.
 */
import { describe, it, expect, afterAll } from "vitest";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { loadFile, loadSource, type LoadedDoc } from "../src/core/c4/likec4.js";
import { loadBatch } from "../src/core/c4/workspace.js";
import { flattenFlows } from "../src/core/c4/flows/flatten.js";
import type { ReadableViews } from "../src/core/c4/flows/parsed-view.js";
import type { Rel } from "../src/core/c4/model/model.js";
import type { Flow, FlowAlt, FlowBlock, FlowNode, FlowStep, FlowTry, FlowUnknown } from "../src/core/c4/flows/flow.js";
import { makeTmpDir, writeFiles } from "./helpers/harness.js";

const tmpDirs: string[] = [];
afterAll(async () => {
  await Promise.all(tmpDirs.map((d) => rm(d, { recursive: true, force: true })));
});

/**
 * A model with containers under both systems and one pair joined TWICE, so
 * every resolution case below is reachable from the same fixture: an exact
 * match, a step drawn one level below its relationship, a pair carrying two
 * operations, and a pair carrying none.
 */
const MODEL = `specification {
  element system
  element container
  tag suite-smoke
  tag FEAT-1
}

model {
  checkoutWeb = system 'checkout-web' {
    ui = container 'checkout-ui'
  }
  paymentService = system 'payment-service' {
    api = container 'payment-api'
  }
  ledger = system 'ledger-service'

  checkoutWeb -> paymentService 'Calls authorizePayment' {
    metadata { op 'authorizePayment' }
  }
  checkoutWeb -> paymentService 'Calls capturePayment' {
    metadata { op 'capturePayment' }
  }
  paymentService -> ledger 'Posts entry' {
    metadata { op 'postEntry' }
  }
}
`;

/** `MODEL` with a `views { ... }` block appended. */
const withViews = (views: string): string => `${MODEL}\nviews {\n${views}\n}\n`;

/** Write `src` as a standalone doc.likec4 in a fresh tmp dir and loadFile it. */
async function load(src: string): Promise<LoadedDoc> {
  const dir = await makeTmpDir("flows-unit-");
  tmpDirs.push(dir);
  await writeFiles(dir, { "doc.likec4": src });
  return loadFile(join(dir, "doc.likec4"));
}

/** The document's one flow, refusing rather than returning `undefined`. */
async function oneFlow(views: string): Promise<Flow> {
  const doc = await load(withViews(views));
  expect(doc.errors).toEqual([]);
  expect(doc.flows).toHaveLength(1);
  const flow = doc.flows[0];
  if (flow === undefined) throw new Error("unreachable: length was asserted above");
  return flow;
}

/* The narrowing helpers: a wrong node kind must fail as itself, not as a
 * `undefined is not an object` three assertions later. */
function stepAt(nodes: FlowNode[], index: number): FlowStep {
  const node = nodes[index];
  if (node?.kind !== "step") throw new Error(`expected a step at ${index}, found ${node?.kind ?? "nothing"}`);
  return node;
}

function altAt(nodes: FlowNode[], index: number): FlowAlt {
  const node = nodes[index];
  if (node?.kind !== "alt") throw new Error(`expected an alt at ${index}, found ${node?.kind ?? "nothing"}`);
  return node;
}

function tryAt(nodes: FlowNode[], index: number): FlowTry {
  const node = nodes[index];
  if (node?.kind !== "try") throw new Error(`expected a try at ${index}, found ${node?.kind ?? "nothing"}`);
  return node;
}

function blockAt(nodes: FlowNode[], index: number): FlowBlock {
  const node = nodes[index];
  // Subtracting the three named kinds, rather than listing the four block ones:
  // a fifth block kind must arrive here as a block, not as a cast that lied.
  if (
    node === undefined ||
    node.kind === "step" ||
    node.kind === "alt" ||
    node.kind === "try" ||
    node.kind === "unknown"
  ) {
    throw new Error(`expected a block at ${index}, found ${node?.kind ?? "nothing"}`);
  }
  return node;
}

function unknownAt(nodes: FlowNode[], index: number): FlowUnknown {
  const node = nodes[index];
  if (node?.kind !== "unknown") {
    throw new Error(`expected an unknown block at ${index}, found ${node?.kind ?? "nothing"}`);
  }
  return node;
}

/* ------------------------------------------------------------------ */
/* The journey itself                                                  */
/* ------------------------------------------------------------------ */

describe("a plain step sequence", () => {
  it("carries the view id, title, tags and ordered steps", async () => {
    const flow = await oneFlow(`  dynamic view checkout {
    #suite-smoke, #FEAT-1
    title 'Checkout journey'
    checkoutWeb -> paymentService 'authorize'
    paymentService -> ledger 'post'
  }`);
    expect(flow.id).toBe("checkout");
    expect(flow.title).toBe("Checkout journey");
    // Without '#', exactly as an element's tags are — the feature-delta
    // projection filters on 'FEAT-1' and a group filters on 'suite-smoke'.
    expect(flow.tags).toEqual(["FEAT-1", "suite-smoke"]);
    expect(flow.steps.map((s) => s.kind)).toEqual(["step", "step"]);
    expect(stepAt(flow.steps, 0)).toMatchObject({
      source: "checkoutWeb",
      target: "paymentService",
      title: "authorize",
    });
    expect(stepAt(flow.steps, 1).title).toBe("post");
  });

  it("lists participants de-duplicated, in first-appearance order, as the ids the steps DRAW", async () => {
    const flow = await oneFlow(`  dynamic view checkout {
    checkoutWeb.ui -> paymentService.api 'authorize'
    paymentService -> ledger 'post'
    ledger -> paymentService 'ack'
    checkoutWeb.ui -> paymentService.api 'capture'
  }`);
    // Not the resolved services: an id is what a step names, and turning one
    // into a `services/<id>` directory needs elements this package never reads.
    expect(flow.participants).toEqual([
      "checkoutWeb.ui",
      "paymentService.api",
      "paymentService",
      "ledger",
    ]);
  });

  it("leaves an untitled view and untitled steps undefined rather than null", async () => {
    // LikeC4 reports both as null; a caller printing `title ?? '(untitled)'`
    // would print "null" for one of the two spellings if they diverged.
    const flow = await oneFlow(`  dynamic view checkout {
    checkoutWeb -> paymentService
  }`);
    expect(flow.title).toBeUndefined();
    expect(stepAt(flow.steps, 0).title).toBeUndefined();
  });

  it("orders flows by id, not by the record LikeC4 hands back", async () => {
    // `$data.views` is a record, and its iteration order is the dependency's
    // insertion order — an auto-generated landscape view is inserted ahead of
    // everything authored. Declaring these two backwards pins that the answer
    // is a property of the document.
    const doc = await load(
      withViews(`  dynamic view zebra {
    checkoutWeb -> paymentService 'z'
  }
  dynamic view alpha {
    checkoutWeb -> paymentService 'a'
  }`),
    );
    expect(doc.flows.map((f) => f.id)).toEqual(["alpha", "zebra"]);
  });
});

/* ------------------------------------------------------------------ */
/* The branch tree                                                     */
/* ------------------------------------------------------------------ */

describe("branch structure survives the flatten", () => {
  it("keeps an alt's two branches, each with its keyword, condition and own body", async () => {
    const flow = await oneFlow(`  dynamic view checkout {
    checkoutWeb -> paymentService 'authorize'
    alt {
      when 'authorized' {
        paymentService -> ledger 'post'
      }
      else {
        paymentService -> checkoutWeb 'decline'
      }
    }
  }`);
    expect(flow.steps.map((s) => s.kind)).toEqual(["step", "alt"]);
    const alt = altAt(flow.steps, 1);
    expect(alt.branches.map((b) => ({ kind: b.kind, title: b.title }))).toEqual([
      { kind: "when", title: "authorized" },
      { kind: "else", title: undefined },
    ]);
    // The steps are INSIDE their branches; a flat list of three steps would
    // pass every id assertion above and answer "which case is uncovered?" wrong.
    expect(stepAt(alt.branches[0]?.steps ?? [], 0).target).toBe("ledger");
    expect(stepAt(alt.branches[1]?.steps ?? [], 0).target).toBe("checkoutWeb");
    expect(flow.participants).toEqual(["checkoutWeb", "paymentService", "ledger"]);
  });

  it("keeps try, catch and finally as three sections", async () => {
    const flow = await oneFlow(`  dynamic view checkout {
    try {
      checkoutWeb -> paymentService 'authorize'
    }
    catch {
      paymentService -> checkoutWeb 'decline'
    }
    finally {
      paymentService -> ledger 'post'
    }
  }`);
    const attempt = tryAt(flow.steps, 0);
    expect(stepAt(attempt.try.steps, 0).title).toBe("authorize");
    expect(stepAt(attempt.catch?.steps ?? [], 0).title).toBe("decline");
    expect(stepAt(attempt.finally?.steps ?? [], 0).title).toBe("post");
  });

  it("leaves catch and finally absent when the view declares neither", async () => {
    const attempt = tryAt(
      (
        await oneFlow(`  dynamic view checkout {
    try {
      checkoutWeb -> paymentService 'authorize'
    }
  }`)
      ).steps,
      0,
    );
    expect(attempt.catch).toBeUndefined();
    expect(attempt.finally).toBeUndefined();
  });

  it("keeps loop, opt, par and break as blocks around their bodies", async () => {
    const flow = await oneFlow(`  dynamic view checkout {
    loop 'until settled' {
      checkoutWeb -> paymentService 'authorize'
      break 'gave up' {
        paymentService -> checkoutWeb 'decline'
      }
    }
    opt 'if configured' {
      paymentService -> ledger 'post'
    }
    par {
      checkoutWeb -> paymentService 'capture'
    }
  }`);
    expect(flow.steps.map((s) => s.kind)).toEqual(["loop", "opt", "par"]);
    const loop = blockAt(flow.steps, 0);
    expect(loop.title).toBe("until settled");
    expect(loop.steps.map((s) => s.kind)).toEqual(["step", "break"]);
    expect(blockAt(loop.steps, 1).title).toBe("gave up");
    expect(blockAt(flow.steps, 1).title).toBe("if configured");
    expect(blockAt(flow.steps, 2).title).toBeUndefined();
  });

  it("inlines a chained step into the steps it stands for", async () => {
    // `a -> b -> c` parses as LikeC4's `series`, which states no condition and
    // no title: its steps ARE the body's steps, and a wrapper node here would
    // be one every branch walk had to see through.
    const flow = await oneFlow(`  dynamic view checkout {
    checkoutWeb -> paymentService -> ledger 'settle'
  }`);
    expect(flow.steps.map((s) => s.kind)).toEqual(["step", "step"]);
    expect(stepAt(flow.steps, 0)).toMatchObject({ source: "checkoutWeb", target: "paymentService" });
    expect(stepAt(flow.steps, 1)).toMatchObject({ source: "paymentService", target: "ledger" });
    expect(flow.participants).toEqual(["checkoutWeb", "paymentService", "ledger"]);
  });
});

/* ------------------------------------------------------------------ */
/* The step → relationship join                                        */
/* ------------------------------------------------------------------ */

describe("a step resolves to the relationships declared between its endpoints", () => {
  it("reaches the operation through the relationship, since the step itself has no metadata", async () => {
    const flow = await oneFlow(`  dynamic view checkout {
    paymentService -> ledger 'post'
  }`);
    expect(stepAt(flow.steps, 0).rels.map((r) => r.op)).toEqual(["postEntry"]);
  });

  it("carries EVERY relationship declared between one pair rather than choosing", async () => {
    // Two edges, two operations, one arrow: a parsed step cannot say which it
    // exercises, and picking the first would answer the operation question with
    // a coin flip nobody downstream could see.
    const flow = await oneFlow(`  dynamic view checkout {
    checkoutWeb -> paymentService 'pay'
  }`);
    expect(stepAt(flow.steps, 0).rels.map((r) => r.op)).toEqual(["authorizePayment", "capturePayment"]);
  });

  it("answers with an empty list for a step no declared relationship joins", async () => {
    // The drawn-but-declared-nowhere state a later slice grades as
    // `flow.step-unresolved`. It must be REPRESENTABLE: a step dropped from the
    // tree would take its branch's coverage question with it.
    const flow = await oneFlow(`  dynamic view checkout {
    ledger -> checkoutWeb 'receipt'
  }`);
    expect(stepAt(flow.steps, 0)).toMatchObject({ source: "ledger", target: "checkoutWeb", rels: [] });
  });

  it("climbs to the relationship when the step is drawn between containers", async () => {
    // The case the join exists for: the arrow is `checkout-ui -> payment-api`,
    // the operation is declared service to service. An exact-pair match would
    // report this real landscape shape as joined to nothing.
    const flow = await oneFlow(`  dynamic view checkout {
    checkoutWeb.ui -> paymentService.api 'authorize'
  }`);
    expect(stepAt(flow.steps, 0).rels.map((r) => r.op)).toEqual(["authorizePayment", "capturePayment"]);
  });

  it("prefers the nearest declaration, so a container-level edge is not merged with its parent's", async () => {
    const doc = await load(`${MODEL.replace(
      "  ledger = system 'ledger-service'",
      `  ledger = system 'ledger-service'
  checkoutWeb.ui -> paymentService.api 'Calls refundPayment' {
    metadata { op 'refundPayment' }
  }`,
    )}
views {
  dynamic view checkout {
    checkoutWeb.ui -> paymentService.api 'refund'
    checkoutWeb -> paymentService.api 'authorize'
  }
}
`);
    expect(doc.errors).toEqual([]);
    const steps = doc.flows[0]?.steps ?? [];
    // Exact pair first: the container edge answers alone.
    expect(stepAt(steps, 0).rels.map((r) => r.op)).toEqual(["refundPayment"]);
    // One hop up on the target only — the service-level pair, not the union.
    expect(stepAt(steps, 1).rels.map((r) => r.op)).toEqual(["authorizePayment", "capturePayment"]);
  });

  it("gives each step its own list, so trimming one leaves the other alone", async () => {
    const flow = await oneFlow(`  dynamic view checkout {
    paymentService -> ledger 'post'
    paymentService -> ledger 'post again'
  }`);
    const first = stepAt(flow.steps, 0);
    first.rels.length = 0;
    expect(stepAt(flow.steps, 1).rels.map((r) => r.op)).toEqual(["postEntry"]);
  });
});

/* ------------------------------------------------------------------ */
/* The join across granularity                                         */
/* ------------------------------------------------------------------ */

/**
 * The mismatch the descent exists for: every relationship declared between
 * CONTAINERS, which is how this repository's own corpus declares them
 * (examples/docs/architecture/landscape.likec4, and the RICH model in
 * test/likec4-model-parity.test.ts) — while a cross-service journey is
 * naturally drawn between the services.
 *
 * `paymentServiceV2` is not decoration: its id starts with `paymentService`, so
 * it fails any prefix test that forgets the dot boundary.
 */
const CONTAINER_MODEL = `specification {
  element system
  element container
}

model {
  checkoutWeb = system 'checkout-web' {
    ui = container 'checkout-ui'
  }
  paymentService = system 'payment-service' {
    api = container 'payment-api'
    worker = container 'payment-worker'
  }
  paymentServiceV2 = system 'payment-service-v2' {
    api = container 'v2-api'
  }

  checkoutWeb.ui -> paymentService.api 'Authorizes' {
    metadata { op 'authorizePayment' }
  }
  checkoutWeb.ui -> paymentService.worker 'Enqueues' {
    metadata { op 'enqueueCapture' }
  }
  checkoutWeb.ui -> paymentServiceV2.api 'Authorizes v2' {
    metadata { op 'authorizePaymentV2' }
  }
}
`;

/** The one flow of `CONTAINER_MODEL` plus a `views { ... }` block. */
async function containerFlow(views: string): Promise<Flow> {
  const doc = await load(`${CONTAINER_MODEL}\nviews {\n${views}\n}\n`);
  expect(doc.errors).toEqual([]);
  const flow = doc.flows[0];
  if (flow === undefined) throw new Error("expected one flow");
  return flow;
}

describe("a step also resolves DOWN to declarations made below its endpoints", () => {
  it("finds the container-level relationships under a journey drawn service to service", async () => {
    // The shape a fleet actually has. Climbing alone answered this with
    // nothing, which would fire `flow.step-unresolved` and `flow.unrepresented`
    // at an author whose document is entirely correct — on EVERY step.
    // LikeC4's own computed edge carries these two relations for this step.
    const flow = await containerFlow(`  dynamic view checkout {
    checkoutWeb -> paymentService 'authorize'
  }`);
    expect(stepAt(flow.steps, 0).rels.map((r) => r.op)).toEqual(["authorizePayment", "enqueueCapture"]);
  });

  it("stops at the element boundary rather than at the name prefix", async () => {
    // `paymentServiceV2.api` is inside a DIFFERENT system whose id merely starts
    // with `paymentService`; a bare startsWith would hand this journey the
    // operations of whatever service happened to share a prefix.
    const flow = await containerFlow(`  dynamic view checkout {
    checkoutWeb -> paymentService 'authorize'
  }`);
    expect(flow.steps.flatMap((s) => (s.kind === "step" ? s.rels : [])).map((r) => r.op)).not.toContain(
      "authorizePaymentV2",
    );
  });

  it("descends on one endpoint while the other is already exact", async () => {
    const flow = await containerFlow(`  dynamic view checkout {
    checkoutWeb.ui -> paymentService 'authorize'
  }`);
    expect(stepAt(flow.steps, 0).rels.map((r) => r.op)).toEqual(["authorizePayment", "enqueueCapture"]);
  });

  it("lets the climb answer alone when it finds anything, so the two never merge", async () => {
    // Order is the decision: a declaration at or above the step's endpoints
    // names those endpoints, so it is the closer statement of what the step is.
    // The container-level edge below it is the fallback, not an addition.
    const doc = await load(`specification {
  element system
  element container
}

model {
  checkoutWeb = system 'checkout-web' {
    ui = container 'checkout-ui'
  }
  paymentService = system 'payment-service' {
    api = container 'payment-api'
  }

  checkoutWeb -> paymentService 'Settles' {
    metadata { op 'settle' }
  }
  checkoutWeb.ui -> paymentService.api 'Authorizes' {
    metadata { op 'authorizePayment' }
  }
}

views {
  dynamic view checkout {
    checkoutWeb -> paymentService 'settle'
  }
}
`);
    expect(doc.errors).toEqual([]);
    expect(stepAt(doc.flows[0]?.steps ?? [], 0).rels.map((r) => r.op)).toEqual(["settle"]);
  });
});

/* ------------------------------------------------------------------ */
/* Documents with nothing to flatten                                   */
/* ------------------------------------------------------------------ */

describe("documents without dynamic views", () => {
  it("answers with no flows when the document declares no views at all", async () => {
    // LikeC4 still synthesises a landscape view for such a document; it is an
    // ELEMENT view, and reading it as a flow would give every landscape in the
    // fleet a journey nobody wrote.
    const doc = await load(MODEL);
    expect(doc.errors).toEqual([]);
    expect(doc.relationships.length).toBeGreaterThan(0);
    expect(doc.flows).toEqual([]);
  });

  it("answers with no flows for an element view", async () => {
    const doc = await load(withViews(`  view landscape {
    include *
  }`));
    expect(doc.errors).toEqual([]);
    expect(doc.flows).toEqual([]);
  });

  it("answers with no flows for a document that did not parse, exactly as it answers no elements", async () => {
    const doc = await loadSource(`model {
  broken = notAKind 'x'
}
views {
  dynamic view checkout {
    broken -> broken 'step'
  }
}
`);
    expect(doc.errors.length).toBeGreaterThan(0);
    expect(doc.elements).toEqual([]);
    expect(doc.relationships).toEqual([]);
    expect(doc.flows).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* Both loaders                                                        */
/* ------------------------------------------------------------------ */

describe("the batch loader reads flows too", () => {
  it("gives loadBatch and loadFile the same flows for the same document", async () => {
    // `validate --all` prefetches through loadBatch and every other command
    // reads through loadFile. A field populated on one path only is a finding
    // that appears or vanishes with the target somebody happened to name.
    const dir = await makeTmpDir("flows-batch-");
    tmpDirs.push(dir);
    const path = join(dir, "doc.likec4");
    await writeFiles(dir, {
      "doc.likec4": withViews(`  dynamic view checkout {
    checkoutWeb.ui -> paymentService.api 'authorize'
    alt {
      when 'authorized' {
        paymentService -> ledger 'post'
      }
      else {
        ledger -> checkoutWeb 'receipt'
      }
    }
  }`),
      "broken.likec4": `model {
  broken = notAKind 'x'
}
`,
    });
    const broken = join(dir, "broken.likec4");
    const batch = await loadBatch([path, broken]);
    const single = await loadFile(path);
    expect(single.flows).toHaveLength(1);
    expect(batch.get(path)?.flows).toEqual(single.flows);
    // And a document with errors keeps the same all-or-nothing rule.
    expect(batch.get(broken)?.errors.length).toBeGreaterThan(0);
    expect(batch.get(broken)?.flows).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* What the reader claims about the dependency                         */
/* ------------------------------------------------------------------ */

/**
 * A parsed model built by hand.
 *
 * The cast is the subject, not a shortcut: both tests below hand the reader
 * data its own declarations say cannot exist — a `$data` whose views the reader
 * cannot find, and a block kind from a likec4 newer than the pin — which is
 * exactly what those declarations have to survive. No `.likec4` document can
 * produce either at the pinned version, and that is the point of pinning it.
 */
function parsedModel(data: unknown): ReadableViews {
  return data as ReadableViews;
}

describe("a model whose views the reader cannot find", () => {
  it("fails loudly rather than answering 'no flows'", () => {
    // The compile-time half is the real guard — `ReadableViews` declares `views`
    // REQUIRED, so a renamed field breaks `npm run typecheck` (a type assertion
    // silently accepts a source that merely LACKS an optional property, which is
    // why the optional spelling compiled straight through the rename it existed
    // to catch). This pins the runtime half: with the `?? {}` that spelling
    // needed, every document in a fleet would have answered "no dynamic views"
    // and no test anywhere would have noticed.
    expect(() => flattenFlows(parsedModel({ $data: {} }), [])).toThrow();
  });
});

describe("a block kind the reader does not know", () => {
  /** One relationship, so a salvaged step can still be shown to resolve. */
  const rels: Rel[] = [
    { source: "paymentService", target: "ledger", title: "Posts entry", op: "postEntry", tags: [] },
  ];

  const foreign = (): Flow => {
    const flows = flattenFlows(
      parsedModel({
        $data: {
          views: {
            checkout: {
              _type: "dynamic",
              title: "Checkout journey",
              steps: [
                { source: "checkoutWeb", target: "paymentService", title: "authorize" },
                {
                  _type: "wibble",
                  title: "a block from a newer likec4",
                  steps: [
                    { source: "paymentService", target: "ledger", title: "post" },
                    { _type: "wobble", steps: [{ source: "ledger", target: "checkoutWeb" }] },
                  ],
                },
                { _type: "zonk", branches: [{ _type: "when", steps: [] }] },
              ],
            },
          },
        },
      }),
      rels,
    );
    const flow = flows[0];
    if (flow === undefined) throw new Error("expected one flow");
    return flow;
  };

  it("represents it instead of refusing the document", () => {
    // The document read and parsed; only the reader is a version behind. A throw
    // here reaches the author as `landscape.invalid` / `service.unreadable` /
    // `repository-unavailable` — "could not read", which is false — and the
    // first of those skips every remaining fleet check.
    const flow = foreign();
    expect(flow.steps.map((s) => s.kind)).toEqual(["step", "unknown", "unknown"]);
    expect(unknownAt(flow.steps, 1)).toMatchObject({ block: "wibble", title: "a block from a newer likec4" });
  });

  it("keeps the steps inside it, resolved, so its coverage stays askable", () => {
    const inner = unknownAt(foreign().steps, 1).steps;
    expect(stepAt(inner, 0)).toMatchObject({ source: "paymentService", target: "ledger", title: "post" });
    expect(stepAt(inner, 0).rels.map((r) => r.op)).toEqual(["postEntry"]);
    // Nested unknowns keep their own, and an untitled salvaged step stays undefined.
    expect(unknownAt(inner, 1).block).toBe("wobble");
    expect(stepAt(unknownAt(inner, 1).steps, 0)).toMatchObject({ target: "checkoutWeb", title: undefined });
  });

  it("counts the salvaged steps' endpoints among the flow's participants", () => {
    expect(foreign().participants).toEqual(["checkoutWeb", "paymentService", "ledger"]);
  });

  it("represents a block that nests its body some other way with no steps, never with guessed ones", () => {
    // `zonk` carries `branches`, a shape this reader cannot know the meaning of.
    // An invented step would be a coverage question nobody asked.
    expect(unknownAt(foreign().steps, 2)).toMatchObject({ block: "zonk", steps: [] });
  });
});
