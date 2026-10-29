/**
 * `architecture/platform.likec4` — the two altitudes above a subsystem
 * (ROADMAP's "The platform picture"), and `loam views`, the verb that writes it.
 *
 * Two halves. The render is pinned on its own, because what it derives is the
 * one model content loam writes and every rule of that derivation is a
 * sentence in `src/core/repo/tree/render/platform/coupling.ts`. The command is
 * pinned through the CLI on a grouped fleet: what it writes, that LikeC4
 * draws the derived edge where it was derived for, that no check of loam's
 * reads that edge back, and the refusals the other generated files already
 * have.
 */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { LikeC4 } from "likec4";
import { describe, expect, it } from "vitest";
import type { Elem, Rel } from "../src/core/c4/likec4.js";
import { architectureProjectDocuments } from "../src/core/c4/project/architecture.js";
import type { DocsDir } from "../src/core/kernel/ids/dirs.js";
import { coupling } from "../src/core/repo/tree/render/platform/coupling.js";
import { platformScopes } from "../src/core/repo/tree/render/platform/scope.js";
import { platformContextViewId, platformViewId, renderPlatformViews } from "../src/core/repo/tree/render/platform/views.js";
import { makeProject, runLoam, treeHashes } from "./helpers/harness.js";

const PLATFORM_VIEWS = "architecture/platform.likec4";

const el = (id: string, kind: string, title = id.split(".").pop()!): Elem => ({ id, kind, title, tags: [] });
const rel = (source: string, target: string, keys: { publishes?: string; consumes?: string } = {}): Rel => ({
  source,
  target,
  tags: [],
  ...keys,
});

/** A root with two groups, a broker outside it holding one topic, and a person. */
const ELEMENTS: Elem[] = [
  el("customer", "person"),
  el("shop", "group", "Shop"),
  el("shop.commerce", "group", "Commerce"),
  el("shop.commerce.orders", "softwareSystem"),
  el("shop.care", "group", "Care"),
  el("shop.care.notify", "softwareSystem"),
  el("shop.cache", "cache"),
  el("broker", "softwareSystem"),
  el("broker.orderEvents", "topic", "order.events"),
  el("ordersDb", "database"),
];
const SERVICES = new Set(["shop.commerce.orders", "shop.care.notify"]);
/** No subsystem view is drawn `of` any element — the tree has none, or none the map draws as one box. */
const NO_SUBSYSTEMS: ReadonlySet<string> = new Set();
const quote = (text: string): string => text.replace(/'/g, "\\'");

describe("the platform render", () => {
  it("finds the root, its boxes without infrastructure, the ring around it and the people in it", () => {
    const [scope, ...rest] = platformScopes(
      ELEMENTS,
      [rel("customer", "shop.commerce.orders"), rel("shop.commerce.orders", "ordersDb"), rel("shop.commerce.orders", "broker.orderEvents")],
      SERVICES,
      NO_SUBSYSTEMS,
    );
    expect(rest).toEqual([]);
    expect(scope!.root.id).toBe("shop");
    // The cache nested in the root is infrastructure, so it is no box.
    expect(scope!.boxes).toEqual(["shop.care", "shop.commerce"]);
    expect(scope!.groups).toEqual(["shop.care", "shop.commerce"]);
    // The broker is a peer — the platform reaches it — and the top-level
    // database is not, because it is infrastructure.
    expect(scope!.peers).toEqual(["broker", "customer"]);
    expect(scope!.actors).toEqual(["customer"]);
  });

  it("a map whose services hold no common boundary has no root, and the file must be absent", () => {
    const flat = [el("orders", "softwareSystem"), el("notify", "softwareSystem")];
    const services = new Set(["orders", "notify"]);
    expect(renderPlatformViews({ elements: flat, relationships: [], services, subsystems: NO_SUBSYSTEMS, quote, segment: quote })).toEqual({
      content: null,
      roots: [],
    });
  });

  it("a top-level group that is a subsystem's own box is no root, so no second `view … of` takes its click", () => {
    // Measured on the subsystem suite's collapsible fleet: taken for a root, the
    // group gained `view platform_ops of ops` in a file that sorts before
    // subsystems.likec4, and its box stopped opening the subsystem's view.
    const elements = [el("ops", "group"), el("ops.ledger", "softwareSystem"), el("mp", "group"), el("mp.orders", "softwareSystem")];
    const services = new Set(["ops.ledger", "mp.orders"]);
    expect(platformScopes(elements, [], services, new Set(["ops"])).map((s) => s.root.id)).toEqual(["mp"]);
    expect(platformScopes(elements, [], services, new Set(["ops", "mp"]))).toEqual([]);
  });

  it("derives one edge through a topic outside every box, named by the message when both keys agree", () => {
    const boxes = { boxes: ["shop.care", "shop.commerce"], groups: ["shop.care", "shop.commerce"] };
    const keyed = coupling(boxes, ELEMENTS, [
      rel("shop.commerce.orders", "broker.orderEvents", { publishes: "order.OrderPlaced" }),
      rel("broker.orderEvents", "shop.care.notify", { consumes: "order.OrderPlaced" }),
    ]);
    expect(keyed).toEqual({ pairs: [{ source: "shop.commerce", target: "shop.care", names: ["order.OrderPlaced"] }], outsideGroups: 0 });
    // Keys that disagree name two different messages: the channel is shared,
    // the message is not, and no edge says otherwise.
    const disagreeing = coupling(boxes, ELEMENTS, [
      rel("shop.commerce.orders", "broker.orderEvents", { publishes: "order.OrderPlaced" }),
      rel("broker.orderEvents", "shop.care.notify", { consumes: "order.OrderCancelled" }),
    ]);
    expect(disagreeing.pairs).toEqual([]);
    // Without keys the drawing says only that the two share the channel.
    const keyless = coupling(boxes, ELEMENTS, [rel("shop.commerce.orders", "broker.orderEvents"), rel("broker.orderEvents", "shop.care.notify")]);
    expect(keyless.pairs).toEqual([{ source: "shop.commerce", target: "shop.care", names: ["order.events"] }]);
  });

  it("pairs keyed edges through a broker drawn as one system, and never keyless edges to it", () => {
    const boxes = { boxes: ["shop.care", "shop.commerce"], groups: ["shop.care", "shop.commerce"] };
    expect(
      coupling(boxes, ELEMENTS, [
        rel("shop.commerce.orders", "broker", { publishes: "order.OrderPlaced" }),
        rel("broker", "shop.care.notify", { consumes: "order.OrderPlaced" }),
      ]).pairs,
    ).toEqual([{ source: "shop.commerce", target: "shop.care", names: ["order.OrderPlaced"] }]);
    // A broker in the middle with no key says shared infrastructure, not dependence.
    expect(coupling(boxes, ELEMENTS, [rel("shop.commerce.orders", "broker"), rel("broker", "shop.care.notify")]).pairs).toEqual([]);
    // Keys agree across two carriers of different kinds — a topic on the way
    // in, the broker on the way out — and the spine is green, so the edge holds.
    expect(
      coupling(boxes, ELEMENTS, [
        rel("shop.commerce.orders", "broker.orderEvents", { publishes: "order.OrderPlaced" }),
        rel("broker", "shop.care.notify", { consumes: "order.OrderPlaced" }),
      ]).pairs,
    ).toEqual([{ source: "shop.commerce", target: "shop.care", names: ["order.OrderPlaced"] }]);
  });

  it("reads the key, not the arrow: a consume edge drawn into the topic makes nobody a producer", () => {
    const elements = [...ELEMENTS, el("shop.billing", "group", "Billing"), el("shop.billing.ledger", "softwareSystem")];
    const boxes = { boxes: ["shop.billing", "shop.care", "shop.commerce"], groups: ["shop.billing", "shop.care", "shop.commerce"] };
    const pairs = coupling(boxes, elements, [
      rel("shop.commerce.orders", "broker.orderEvents", { publishes: "order.OrderPlaced" }),
      // Drawn backwards — `spine.message-unbound` warns about this one.
      rel("shop.care.notify", "broker.orderEvents", { consumes: "order.OrderPlaced" }),
      rel("broker.orderEvents", "shop.billing.ledger", { consumes: "order.OrderPlaced" }),
    ]).pairs;
    expect(pairs).toEqual([{ source: "shop.commerce", target: "shop.billing", names: ["order.OrderPlaced"] }]);
  });

  it("derives no edge at a box that is not a subsystem group — an external system nested in the root", () => {
    const elements = [...ELEMENTS, el("shop.psp", "softwareSystem")];
    const [scope] = platformScopes(elements, [], SERVICES, NO_SUBSYSTEMS);
    expect(scope!.boxes).toContain("shop.psp");
    expect(scope!.groups).toEqual(["shop.care", "shop.commerce"]);
    const derived = coupling(scope!, elements, [rel("shop.psp", "broker.orderEvents"), rel("broker.orderEvents", "shop.care.notify")]);
    expect(derived).toEqual({ pairs: [], outsideGroups: 1 });
  });

  it("a service of an infrastructure kind is still a service, and still a box", () => {
    // A database bound to `services/ledger/` stands for a service, and that wins
    // over its kind — as every census rules.
    const elements = [...ELEMENTS, el("shop.ledger", "database")];
    const [scope] = platformScopes(elements, [], new Set([...SERVICES, "shop.ledger"]), NO_SUBSYSTEMS);
    expect(scope!.boxes).toEqual(["shop.care", "shop.commerce", "shop.ledger"]);
  });

  it("derives nothing a view already lifts: a topic inside a box, or two ends in one box", () => {
    const elements = [...ELEMENTS, el("shop.commerce.outbox", "topic", "outbox")];
    const boxes = { boxes: ["shop.care", "shop.commerce"], groups: ["shop.care", "shop.commerce"] };
    expect(
      coupling(boxes, elements, [rel("shop.commerce.orders", "shop.commerce.outbox"), rel("shop.commerce.outbox", "shop.care.notify")]).pairs,
    ).toEqual([]);
    expect(
      coupling(boxes, [...elements, el("shop.commerce.billing", "softwareSystem")], [
        rel("shop.commerce.orders", "broker.orderEvents"),
        rel("broker.orderEvents", "shop.commerce.billing"),
      ]).pairs,
    ).toEqual([]);
  });

  it("derives no edge at a service box, and the file says how many pairs it left out", () => {
    // The services sit directly in the root: every box is a service.
    const elements = [el("shop", "group", "Shop"), el("shop.orders", "softwareSystem"), el("shop.notify", "softwareSystem"), el("broker.t", "topic"), el("broker", "softwareSystem")];
    const relationships = [rel("shop.orders", "broker.t"), rel("broker.t", "shop.notify")];
    const services = new Set(["shop.orders", "shop.notify"]);
    const render = renderPlatformViews({ elements, relationships, services, subsystems: NO_SUBSYSTEMS, quote, segment: quote });
    expect(render.roots).toEqual(["shop"]);
    expect(render.content).not.toContain("model {");
    expect(render.content).toContain("// 1 event pair(s) end at a box of this root that is not a subsystem group, and no edge is derived");
  });

  it("mints two ids per root that no other root's ids can equal", () => {
    // `_` is hex-escaped, so a root named like another root's context view
    // cannot produce that view's id.
    expect(platformViewId("shop")).toBe("platform_shop");
    expect(platformContextViewId("shop")).toBe("platform_shop_context");
    expect(platformViewId("shop_context")).toBe("platform_shop_5fcontext");
  });
});

const LANDSCAPE = `specification {
  element person
  element group
  element softwareSystem
  element topic
  element database
  tag external
}

model {
  customer = person 'Customer'
  shop = group 'Shop' {
    commerce = group 'Commerce' {
      orders = softwareSystem 'orders' {
        metadata {
          service 'orders'
        }
      }
      payments = softwareSystem 'payments' {
        metadata {
          service 'payments'
        }
      }
    }
    care = group 'Care' {
      notify = softwareSystem 'notify' {
        metadata {
          service 'notify'
        }
      }
    }
  }
  broker = softwareSystem 'broker' {
    #external
    orderEvents = topic 'order.events'
  }
  ordersDb = database 'orders-db'

  customer -> shop.commerce.orders 'Places orders'
  shop.commerce.orders -> shop.commerce.payments 'Charges'
  shop.commerce.orders -> ordersDb 'Stores orders'
  shop.commerce.orders -> broker.orderEvents 'Publishes order events'
  broker.orderEvents -> shop.care.notify 'Delivers order events'
}
`;

const spec = (id: string): string => `---\nservice: ${id}\nstatus: draft\n---\n\n# ${id}\n`;

function groupedFleet(): Record<string, string> {
  return {
    "architecture/landscape.likec4": LANDSCAPE,
    "services/orders/spec.md": spec("orders"),
    "services/payments/spec.md": spec("payments"),
    "services/notify/spec.md": spec("notify"),
  };
}

interface Finding {
  code: string;
  subject?: string;
  message: string;
}

function findings(stdout: string): Finding[] {
  const payload = JSON.parse(stdout) as { targets: Array<{ findings: Finding[] }> };
  return payload.targets.flatMap((t) => t.findings);
}

describe("loam views", () => {
  it("writes the platform's two views and the derived event edge, and a second run writes nothing", async () => {
    const p = await makeProject(groupedFleet());
    try {
      const first = await runLoam(p.workDir, "views", "--json");
      const payload = JSON.parse(first.stdout);
      expect(payload.command).toBe("views");
      expect(payload.platformViews).toEqual({ path: PLATFORM_VIEWS, action: "created", roots: ["shop"] });
      const text = await readFile(join(p.docsDir, PLATFORM_VIEWS), "utf8");
      expect(text).toContain("  shop.commerce -> shop.care 'async: order.events'\n");
      expect(text).toContain("  view platform_shop_context {\n");
      expect(text).toContain("  view platform_shop of shop {\n");
      expect(text).toContain("    include broker\n");
      expect(text).not.toContain("include ordersDb");

      const before = await treeHashes(p.docsDir);
      const second = JSON.parse((await runLoam(p.workDir, "views", "--json")).stdout);
      expect(second.platformViews.action).toBe("current");
      expect(await treeHashes(p.docsDir)).toEqual(before);
      // One writer under two names: sync agrees there is nothing to write.
      const sync = JSON.parse((await runLoam(p.workDir, "subsystem", "sync", "--json")).stdout);
      expect(sync.command).toBe("subsystem");
      expect(sync.platformViews).toEqual({ path: PLATFORM_VIEWS, action: "current", roots: ["shop"] });
    } finally {
      await p.destroy();
    }
  }, 60_000);

  it("the real renderer draws the derived edge on the inside view and in no other generated view", async () => {
    const p = await makeProject(groupedFleet());
    try {
      await runLoam(p.workDir, "views");
      // The whole `architecture/` project, as the renderer loads it: the map and
      // all three generated files.
      const workspace = await LikeC4.fromWorkspace(join(p.docsDir, "architecture"), { logger: false });
      try {
        expect(workspace.getErrors()).toEqual([]);
        const model = await workspace.computedModel();
        const edges = (view: { edges(): Iterable<{ source: { id: string }; target: { id: string }; label: unknown }> }): string[] =>
          [...view.edges()].map((e) => `${e.source.id} -> ${e.target.id}: ${String(e.label)}`);
        const views = new Map([...model.views()].map((v) => [v.id as string, edges(v)]));
        expect(views.get("platform_shop")).toContain("shop.commerce -> shop.care: async: order.events");
        expect(views.get("platform_shop_context")).toContain("customer -> shop: Places orders");
        // Every per-service and per-subsystem view the other two files hold is
        // there, and not one of them draws the derived relationship.
        expect([...views.keys()].filter((id) => id.startsWith("service_")).length).toBe(3);
        const drawing = [...views].filter(([, list]) => list.some((edge) => edge.includes("async:"))).map(([id]) => id);
        expect(drawing).toEqual(["platform_shop"]);
      } finally {
        await workspace.dispose();
      }
    } finally {
      await p.destroy();
    }
  }, 60_000);

  it("a subsystem verb regenerates it in its own commit: a group a directory comes to own is no root", async () => {
    // `ops` is drawn as a top-level group, and `services/ops/` starts empty, so
    // no subsystem view is drawn `of` it yet and it is a root beside `shop`.
    const fleet = groupedFleet();
    fleet["architecture/landscape.likec4"] = LANDSCAPE.replace(
      "  ordersDb = database 'orders-db'",
      "  ops = group 'Ops' {\n    ledger = softwareSystem 'ledger' {\n      metadata {\n        service 'ledger'\n      }\n    }\n  }\n  ordersDb = database 'orders-db'",
    );
    fleet["services/ledger/spec.md"] = spec("ledger");
    fleet["services/ops/subsystem.yaml"] = "title: Ops\n";
    const p = await makeProject(fleet);
    try {
      expect(JSON.parse((await runLoam(p.workDir, "views", "--json")).stdout).platformViews.roots).toEqual(["ops", "shop"]);
      const moved = await runLoam(p.workDir, "subsystem", "move", "ledger", "--into", "ops", "--json");
      expect(moved.code).toBe(0);
      expect(JSON.parse(moved.stdout).platformViews).toBe("updated");
      const text = await readFile(join(p.docsDir, PLATFORM_VIEWS), "utf8");
      expect(text).toContain("view platform_shop of shop {");
      expect(text).not.toContain("platform_ops");
      const stale = findings((await runLoam(p.workDir, "validate", "--all", "--json")).stdout).filter(
        (f) => f.code === "subsystem.views-stale",
      );
      expect(stale).toEqual([]);
    } finally {
      await p.destroy();
    }
  }, 60_000);

  it("validate names the absent file with `loam views` as its repair, and no other finding moves when it lands", async () => {
    const p = await makeProject(groupedFleet());
    try {
      const before = findings((await runLoam(p.workDir, "validate", "--all", "--json")).stdout);
      const stale = before.find((f) => f.code === "subsystem.views-stale" && f.subject === PLATFORM_VIEWS);
      expect(stale?.message).toContain("Run `loam views` to regenerate it");
      await runLoam(p.workDir, "views");
      const after = findings((await runLoam(p.workDir, "validate", "--all", "--json")).stdout);
      // The generated edges are read by nothing: what the run finds is what it
      // found before, less the staleness the run repaired. The `ok` summaries
      // are left out of both sides — `landscape.matched` is said only of a map
      // target with no error, which the stale files were.
      const graded = (list: Finding[]): Finding[] => list.filter((f) => (f as { severity?: string }).severity !== "ok");
      expect(graded(after)).toEqual(graded(before).filter((f) => f.code !== "subsystem.views-stale"));
      // And the reason, asked directly: the document is not in the project every
      // check of the map loads.
      const documents = await architectureProjectDocuments(p.docsDir as DocsDir);
      expect(documents.some((path) => path.endsWith("platform.likec4"))).toBe(false);
      expect(documents.some((path) => path.endsWith("landscape.likec4"))).toBe(true);
    } finally {
      await p.destroy();
    }
  }, 60_000);

  it("over a map with no root it writes nothing and says why", async () => {
    const flat = groupedFleet();
    flat["architecture/landscape.likec4"] = LANDSCAPE.replace("  shop = group 'Shop' {", "  shop = softwareSystem 'shop' {\n    metadata {\n      service 'shop'\n    }");
    flat["services/shop/spec.md"] = spec("shop");
    const p = await makeProject(flat);
    try {
      const res = await runLoam(p.workDir, "views");
      expect(res.stdout).toContain(`so ${PLATFORM_VIEWS} is not generated`);
      expect(p.exists(PLATFORM_VIEWS)).toBe(false);
      expect(JSON.parse((await runLoam(p.workDir, "views", "--json")).stdout).platformViews.roots).toEqual([]);
    } finally {
      await p.destroy();
    }
  }, 60_000);

  it("refuses to write over an authored file at the reserved path, and exits 1", async () => {
    const p = await makeProject({ ...groupedFleet(), [PLATFORM_VIEWS]: "// my own platform picture\nviews {\n}\n" });
    try {
      const res = await runLoam(p.workDir, "views", "--json");
      expect(JSON.parse(res.stdout).platformViews.action).toBe("refused");
      expect(res.code).toBe(1);
      expect(await readFile(join(p.docsDir, PLATFORM_VIEWS), "utf8")).toBe("// my own platform picture\nviews {\n}\n");
    } finally {
      await p.destroy();
    }
  }, 60_000);

  it("an authored view claiming a platform id is a collision the fleet gate names", async () => {
    const p = await makeProject(groupedFleet());
    try {
      await writeFile(join(p.docsDir, "architecture/mine.likec4"), "views {\n  view platform_shop {\n    include *\n  }\n}\n");
      const res = await runLoam(p.workDir, "validate", "--all", "--json");
      const collision = findings(res.stdout).find((f) => f.code === "subsystem.view-id-collision");
      expect(collision?.subject).toBe("platform_shop");
      expect(collision?.message).toContain(`into ${PLATFORM_VIEWS} for the map's root element \`shop\``);
    } finally {
      await p.destroy();
    }
  }, 60_000);
});
