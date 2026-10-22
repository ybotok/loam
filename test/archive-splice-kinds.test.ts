/**
 * What the archive's splice reads off a relationship's KIND, and off a model's
 * borrowed kinds — the two places the parse and the scan of one statement used
 * to disagree, measured on a real fleet (2026-10) and rebuilt here on neutral
 * shapes.
 *
 *  - A relationship kind can carry tags (`relationship publishes { #async }`,
 *    LikeC4 1.59.0+). The parse hands every edge of the kind those tags; the
 *    scan of the statement sees only what is written in it. The splice keyed
 *    the parsed addition on its tags, found no statement, and refused a delta
 *    `validate --feature` and `status` had called ready — `merge-failed`, or
 *    `usecase.flow-invalid` when the feature had flows.
 *  - An EXTENDING model declares no kinds and borrows the map's. Scanned on its
 *    own text, its `a .kind b` edges and its `kind name` declarations read as
 *    property lines: an edge the archive routed into the model landed above a
 *    dotted edge, a delta restating a dotted edge added a second copy, and a
 *    child of a kind-first container nested under "nothing".
 */
import { describe, expect, it } from "vitest";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadSource } from "../src/core/c4/likec4.js";
import type { ExtendingModel } from "../src/core/c4/splice/contract.js";
import { planLandscapeMerge } from "../src/core/c4/splice/landscape-merge.js";
import { spliceModel } from "../src/core/c4/splice/model/merge.js";
import { makeTmpDir, runLoam } from "./helpers/harness.js";

const EXAMPLES = fileURLToPath(new URL("../examples/docs", import.meta.url));

const SPEC = `specification {
  element group
  element softwareSystem
  element container
  element topic
  tag async
  relationship publishes {
    #async
  }
  relationship delivers
}
`;

/** The fleet map: two bound services in a group, and a broker that is nobody's. */
const MAP = `${SPEC}
model {
  shop = group 'Shop' {
    orders = softwareSystem 'order-service' {
      metadata { service 'order-service' }
    }
    payments = softwareSystem 'payment-service' {
      metadata { service 'payment-service' }
    }
  }
  broker = softwareSystem 'broker' {
    events = topic 'payment.events'
  }

  shop.orders -> shop.payments 'Calls authorize'
}
`;

/** A delta: the map's spec plus the feature tag, and `body` as its model. */
const delta = (body: string): string => `${SPEC.replace("specification {\n", "specification {\n  tag FEAT-7\n")}\nmodel {\n${body}}\n`;

/** order-service's EXTENDING model, at the path the fleet walk would hand the merge. */
const orderModel = (text: string): ExtendingModel => ({ service: "order-service", path: "services/order-service/model.likec4", text });

/** One archive's C4 merge of the delta whose model is `body`, as `loam archive` plans it — the delta's kind tags included. */
async function plan(body: string, models: ExtendingModel[] = []): ReturnType<typeof planLandscapeMerge> {
  expect((await loadSource(MAP)).errors, "the map must be valid, or the case proves nothing").toEqual([]);
  const deltaText = delta(body);
  const d = await loadSource(deltaText);
  expect(d.errors).toEqual([]);
  return planLandscapeMerge({
    landscapeText: MAP,
    deltaText,
    deltaElements: d.elements,
    newEls: d.elements.filter((e) => e.tags.includes("FEAT-7")),
    newRels: d.relationships.filter((r) => r.tags.includes("FEAT-7")),
    featureId: "FEAT-7",
    deltaKindTags: d.specification?.relationshipKindTags ?? {},
    models,
  });
}

/** The routed model's merged text — the one `loam archive` would write. */
async function mergedModel(body: string, model: ExtendingModel): Promise<string> {
  const p = await plan(body, [model]);
  expect(p.models.map((m) => m.model.path)).toEqual([model.path]);
  const deltaText = delta(body);
  const d = await loadSource(deltaText);
  return spliceModel({ additions: p.models[0]!, deltaText, featureId: "FEAT-7", deltaKindTags: d.specification?.relationshipKindTags ?? {} });
}

describe("an edge whose relationship kind carries a tag is spliced, not refused", () => {
  it("lands on the map as written, kind and all, the feature tag stripped", async () => {
    const p = await plan(`  shop = group 'Shop' {
    payments = softwareSystem 'payment-service'
  }
  broker = softwareSystem 'broker' {
    events = topic 'payment.events'
  }
  shop.payments -[publishes]-> broker.events 'Publishes PaymentSplit' {
    #FEAT-7
  }
`);
    expect(p.addedRels.map((r) => r.title)).toEqual(["Publishes PaymentSplit"]);
    expect(p.content).toContain("shop.payments -[publishes]-> broker.events 'Publishes PaymentSplit'\n");
    expect(p.content).not.toContain("FEAT-7");
    const merged = await loadSource(p.content!);
    expect(merged.errors).toEqual([]);
    // The kind's tag is the kind's, and the parse still hands it over.
    expect(merged.relationships.find((r) => r.title === "Publishes PaymentSplit")?.tags).toEqual(["async"]);
  });

  it("matches a statement that writes the kind's tag itself, and the dotted form", async () => {
    const p = await plan(`  shop = group 'Shop' {
    payments = softwareSystem 'payment-service'
    orders = softwareSystem 'order-service'
  }
  broker = softwareSystem 'broker' {
    events = topic 'payment.events'
  }
  shop.payments -[publishes]-> broker.events 'Publishes PaymentCaptured' {
    #async #FEAT-7
  }
  shop.orders .publishes broker.events 'Publishes OrderPlaced' {
    #FEAT-7
  }
`);
    expect(p.addedRels.map((r) => r.title).sort()).toEqual(["Publishes OrderPlaced", "Publishes PaymentCaptured"]);
    expect(p.content).toContain("shop.payments -[publishes]-> broker.events 'Publishes PaymentCaptured' {\n    #async\n  }");
    expect(p.content).toContain("shop.orders .publishes broker.events 'Publishes OrderPlaced'\n");
    expect((await loadSource(p.content!)).errors).toEqual([]);
  });

  it("is located in the delta when the edge is routed into the service's own model", async () => {
    // The model splice keeps its own statement pool, keyed the same way.
    const text = await mergedModel(
      `  shop = group 'Shop' {
    orders = softwareSystem 'order-service' {
      relay = container 'outbox-relay'
    }
  }
  broker = softwareSystem 'broker' {
    events = topic 'payment.events'
  }
  shop.orders.relay -[publishes]-> broker.events 'Publishes OrderPlaced' {
    #FEAT-7
  }
`,
      orderModel("model {\n  extend shop.orders {\n    relay = container 'outbox-relay'\n  }\n}\n"),
    );
    expect(text).toContain("  shop.orders.relay -[publishes]-> broker.events 'Publishes OrderPlaced'\n");
  });
});

describe("an extending model is scanned with the kinds it borrows from the map", () => {
  const CONTAINERS = `  extend shop.orders {
    api = container 'api'
    relay = container 'outbox-relay'
    consumer = container 'consumer'
  }
`;
  /** order-service's model, its last top-level edge written in the dotted form. */
  const DOTTED = `model {
${CONTAINERS}
  shop.orders.relay -> broker.events 'Publishes OrderPlaced'
  // The consumer side, drawn with a kind the map declares.
  broker.events .delivers shop.orders.consumer 'PaymentAuthorized advances the order'
}
`;
  const CONTEXT = `  shop = group 'Shop' {
    orders = softwareSystem 'order-service' {
      api = container 'api'
      consumer = container 'consumer'
    }
    payments = softwareSystem 'payment-service'
  }
  broker = softwareSystem 'broker' {
    events = topic 'payment.events'
  }
`;

  it("an edge routed into the model lands after a dotted edge, not above it and its comment", async () => {
    const text = await mergedModel(
      `${CONTEXT}  shop.orders.api -> shop.payments 'Asks for the refund state' {\n    #FEAT-7\n  }\n`,
      orderModel(DOTTED),
    );
    const added = text.indexOf("shop.orders.api -> shop.payments 'Asks for the refund state'");
    expect(added).toBeGreaterThan(text.indexOf("broker.events .delivers shop.orders.consumer"));
    // The authored lines above it are untouched, comment and all.
    expect(text).toContain("  shop.orders.relay -> broker.events 'Publishes OrderPlaced'\n  // The consumer side");
  });

  it("a delta restating the model's dotted edge adds nothing", async () => {
    const p = await plan(
      `${CONTEXT}  broker.events -[delivers]-> shop.orders.consumer 'PaymentAuthorized advances the order' {\n    #FEAT-7\n  }\n`,
      [orderModel(DOTTED)],
    );
    expect(p.addedRels, "the model already draws the edge; a second copy is the defect").toEqual([]);
    expect(p.models).toEqual([]);
    expect(p.content).toBeNull();
  });

  it("a child of a container the model declares kind-first nests inside it", async () => {
    const model = orderModel(`model {
  extend shop.orders {
    container relay 'outbox-relay' {
      technology 'Go'
    }
  }
}
`);
    const text = await mergedModel(
      `  shop = group 'Shop' {
    orders = softwareSystem 'order-service' {
      relay = container 'outbox-relay' {
        sweeper = container 'sweeper' {
          #FEAT-7
        }
      }
    }
  }
`,
      model,
    );
    // Read as LikeC4 reads it — the model beside the map it extends.
    const both = await loadSource(`${MAP}\n${text}`);
    expect(both.errors).toEqual([]);
    expect(both.elements.map((e) => e.id)).toContain("shop.orders.relay.sweeper");
  });
});

describe("the reported shape: a tagged relationship kind on the shipped example fleet", () => {
  /** A copy of the example fleet with `relationship publishes { #async }` declared in the map and FEAT-101's delta. */
  async function kindTagged(flow: boolean): Promise<{ dir: string; done: () => Promise<void> }> {
    const root = await makeTmpDir("loam-kind-tags-");
    const dir = join(root, "fleet");
    await cp(EXAMPLES, dir, { recursive: true });
    const edit = async (rel: string, from: string, to: string): Promise<void> => {
      const text = (await readFile(join(dir, rel), "utf8")).replace(/\r\n/g, "\n");
      expect(text, `${rel} must hold the anchor`).toContain(from);
      await writeFile(join(dir, rel), text.replace(from, to), "utf8");
    };
    const kind = "  tag async\n  relationship publishes {\n    #async\n  }\n";
    await edit("architecture/landscape.likec4", "  tag external\n", `  tag external\n${kind}`);
    const feat = "features/FEAT-101-payment-splitting";
    await edit(`${feat}/delta.likec4`, "  tag FEAT-101\n", `  tag FEAT-101\n${kind}`);
    await edit(
      `${feat}/delta.likec4`,
      "marketplace.paymentSplitService -> kafka.paymentEvents 'Publishes PaymentSplit' {",
      "marketplace.paymentSplitService -[publishes]-> kafka.paymentEvents 'Publishes PaymentSplit' {",
    );
    if (flow) {
      await mkdir(join(dir, feat, "usecases"), { recursive: true });
      await writeFile(
        join(dir, feat, "usecases", "split-payment.likec4"),
        "views {\n  dynamic view split_payment {\n    #cap-order-notifications\n    customer -> marketplace.checkoutWeb 'Checks out'\n    marketplace.checkoutWeb -> marketplace.paymentSplitService 'Splits the payment'\n  }\n}\n",
        "utf8",
      );
    }
    return { dir, done: () => rm(root, { recursive: true, force: true }) };
  }

  it("archives at exit 0 and lands the kinded edge", async () => {
    const f = await kindTagged(false);
    try {
      const dry = await runLoam(f.dir, "archive", "FEAT-101", "--dry-run", "--json");
      expect(JSON.parse(dry.stdout).ok, dry.stdout).toBe(true);
      expect((await runLoam(f.dir, "archive", "FEAT-101")).code).toBe(0);
      const map =await readFile(join(f.dir, "architecture/landscape.likec4"), "utf8");
      expect(map).toContain("marketplace.paymentSplitService -[publishes]-> kafka.paymentEvents 'Publishes PaymentSplit'");
      expect((await loadSource(map)).errors).toEqual([]);
    } finally {
      await f.done();
    }
  });

  it("with a flow, validate --feature grades it instead of filing the merge as usecase.flow-invalid", async () => {
    const f = await kindTagged(true);
    try {
      const run = await runLoam(f.dir, "validate", "--feature", "FEAT-101", "--json");
      const findings = (JSON.parse(run.stdout) as { targets: Array<{ findings: Array<{ code: string; message: string }> }> }).targets.flatMap(
        (t) => t.findings,
      );
      expect(findings.filter((x) => x.code === "usecase.flow-invalid"), JSON.stringify(findings)).toEqual([]);
      expect(run.code).toBe(0);
    } finally {
      await f.done();
    }
  });
});
