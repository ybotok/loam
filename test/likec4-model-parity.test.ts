/**
 * Parity between LikeC4's two model stages, over exactly the fields
 * src/core/c4/likec4.ts reads.
 *
 * `loadSource` used to call `computedModel()`, which computes every VIEW in the
 * document — work loam throws away, because it renders nothing (brief/unchecked.ts's
 * UNCHECKED says so in as many words). The cost is superlinear in the number of RELATIONSHIPS,
 * so a landscape at fleet shape (120 services, a few hundred calls) turned
 * `loam list` into minutes. It now calls `parsedModel()`.
 *
 * That swap is only safe if the two stages agree about the model itself, and
 * one disagreement would be worse than the bug it fixes: if `computedModel()`
 * synthesised ancestor-to-ancestor relationships that `parsedModel()` does not,
 * every check that joins edges to services — the operationId spine, the
 * no-openapi grace, `serviceOf`'s ancestor walk — would silently see a smaller
 * graph. So this file pins the two stages against each other on one source that
 * exercises everything the adapter reads, and pins the derived-edge question
 * explicitly rather than trusting that it never comes up.
 *
 * The last block is the scale regression, and it varies EDGE count at a FIXED
 * element count — the axis the bug actually lived on, and the one test/scale.ts
 * does not vary.
 */
import { describe, it, expect } from "vitest";
import { LikeC4 } from "likec4";
import { flattenModel, loadSource, type LoadedDoc } from "../src/core/c4/likec4.js";
import { serviceOf } from "../src/core/c4/model/model.js";

/**
 * Everything loam's adapter reads, in one document: nested/dotted container
 * ids, `metadata { service }` on both a system and one of its containers,
 * `metadata { op }` on relationships, element tags (declared, and inherited
 * from the specification kind), relationship tags, edges drawn INTO a container
 * from a system and from another container, an element with no explicit title,
 * an `extend` block, a relationship declared inside an element body via `it`,
 * and an untitled edge.
 */
const RICH = `specification {
  element person
  element softwareSystem {
    #owned
  }
  element container
  element database
  tag owned
  tag external
  tag critical
}

model {
  customer = person 'Customer'

  checkoutWeb = softwareSystem 'checkout-web' {
    description 'Customer-facing checkout UI'
    metadata { service 'checkout-web' }
    ui = container 'checkout-ui' {
      description 'The browser app'
    }
  }

  paymentService = softwareSystem 'payment-service' {
    #critical
    description 'Owns payment authorization/capture'
    metadata { service 'payment-service' }
    api = container 'payment-api' {
      metadata { service 'payment-service' }
    }
    worker = container 'payment-worker' {
      // Nested, it-sourced, AND carrying the event spine's metadata — the two
      // model stages have to agree about publishes exactly as they do about op,
      // or the async axis reads one thing in validate and another in the splice
      // map archive merges with.
      it -> kafka 'Publishes PaymentAuthorized' {
        metadata { publishes 'payment.PaymentAuthorized' }
      }
    }
    db = database 'payment-db' {
      #critical
    }
    api -> db 'Reads and writes'
  }

  // No explicit title: LikeC4 falls back to the name.
  ledger = softwareSystem {
    metadata { service 'ledger-service' }
  }

  kafka = softwareSystem 'kafka' {
    #external
    description 'Event backbone'
  }

  extend ledger {
    api = container 'ledger-api'
  }

  customer -> checkoutWeb.ui 'Uses'
  checkoutWeb.ui -> paymentService.api 'Authorizes' {
    #critical
    metadata { op 'authorizePayment' }
  }
  checkoutWeb -> paymentService.api 'Captures' {
    metadata { op 'capturePayment' }
  }
  paymentService.api -> ledger.api 'Posts entries' {
    metadata { op 'postEntry' }
  }
  ledger -> kafka
  kafka -> ledger.api 'PaymentAuthorized' {
    metadata { consumes 'payment.PaymentAuthorized' }
  }
}
`;

/** The flattened Elem/Rel shapes loam builds, from each stage of the same document. */
async function bothStages(src: string): Promise<{ parsed: LoadedDoc; computed: LoadedDoc }> {
  const likec4 = await LikeC4.fromSource(src, { logger: false });
  try {
    expect(likec4.getErrors() ?? []).toEqual([]);
    // `flows: []` is the shape's, not this suite's subject: RICH declares no
    // views, and the two stages are compared here on the model alone —
    // test/flows.test.ts owns what a dynamic view flattens to.
    return {
      parsed: { errors: [], flows: [], ...flattenModel(await likec4.parsedModel()) },
      computed: { errors: [], flows: [], ...flattenModel(await likec4.computedModel()) },
    };
  } finally {
    await likec4.dispose();
  }
}

/**
 * RICH through both stages, computed once for the whole block.
 *
 * Every assertion below reads the same two models, and `computedModel()` — the
 * expensive stage, which is this file's whole subject — was being recomputed
 * from scratch in each of the six, along with a fresh `LikeC4.fromSource` and a
 * full `getErrors()` validation. One shared computation says the same thing.
 */
let richStages: Promise<{ parsed: LoadedDoc; computed: LoadedDoc }> | undefined;
const rich = () => (richStages ??= bothStages(RICH));

/* ------------------------------------------------------------------ */
/* Parity                                                              */
/* ------------------------------------------------------------------ */

describe("parsedModel and computedModel agree on everything loam reads", () => {
  it("produces byte-identical Elem[] and Rel[]", async () => {
    const { parsed, computed } = await rich();
    expect(JSON.stringify(parsed, null, 2)).toEqual(JSON.stringify(computed, null, 2));
  });

  it("agrees element by element: id, kind, title, description, service binding, tags", async () => {
    const { parsed, computed } = await rich();
    const sort = (d: LoadedDoc) => [...d.elements].sort((a, b) => a.id.localeCompare(b.id));
    expect(sort(parsed)).toEqual(sort(computed));
    // Spot-check the values themselves, so parity on two identically WRONG
    // readings would still fail here.
    const el = (id: string) => parsed.elements.find((e) => e.id === id);
    expect(el("paymentService.api")).toEqual({
      id: "paymentService.api",
      kind: "container",
      title: "payment-api",
      description: undefined,
      service: "payment-service",
      tags: [],
    });
    // Title falls back to the name, and the specification kind's tag is
    // inherited — both are stage-independent.
    expect(el("ledger")?.title).toBe("ledger");
    expect(el("ledger")?.tags).toEqual(["owned"]);
    expect(el("paymentService")?.tags).toEqual(["owned", "critical"]);
    expect(el("kafka")?.tags).toEqual(["owned", "external"]);
    expect(el("ledger.api")?.id).toBe("ledger.api");
  });

  it("agrees relationship by relationship: endpoints, title, op, publishes, consumes, tags", async () => {
    const { parsed, computed } = await rich();
    const key = (d: LoadedDoc) =>
      [...d.relationships]
        .map(
          (r) =>
            `${r.source}->${r.target}|${r.title ?? ""}|${r.op ?? ""}|${r.publishes ?? ""}|${r.consumes ?? ""}|${r.tags.join(",")}`,
        )
        .sort();
    expect(key(parsed)).toEqual(key(computed));
    expect(key(parsed)).toEqual([
      "checkoutWeb->paymentService.api|Captures|capturePayment|||",
      "checkoutWeb.ui->paymentService.api|Authorizes|authorizePayment|||critical",
      "customer->checkoutWeb.ui|Uses||||",
      "kafka->ledger.api|PaymentAuthorized|||payment.PaymentAuthorized|",
      "ledger->kafka|||||",
      "paymentService.api->ledger.api|Posts entries|postEntry|||",
      "paymentService.api->paymentService.db|Reads and writes||||",
      "paymentService.worker->kafka|Publishes PaymentAuthorized||payment.PaymentAuthorized||",
    ]);
  });

  /**
   * The pin that makes the swap safe. LikeC4 derives ancestor-to-ancestor edges
   * only while computing a VIEW; neither model stage adds them. If a future
   * version starts synthesising them into `computedModel()`, this fails — and
   * the failure is the signal that loam's edge-joined checks would have started
   * seeing a different graph.
   */
  it("neither stage synthesises derived ancestor-to-ancestor relationships", async () => {
    const { parsed, computed } = await rich();
    for (const doc of [parsed, computed]) {
      const pairs = doc.relationships.map((r) => `${r.source}->${r.target}`);
      // Drawn: checkoutWeb.ui -> paymentService.api, and checkoutWeb ->
      // paymentService.api. NOT drawn, and never invented:
      expect(pairs).not.toContain("checkoutWeb->paymentService");
      expect(pairs).not.toContain("checkoutWeb.ui->paymentService");
      expect(pairs).not.toContain("customer->checkoutWeb");
      expect(pairs).not.toContain("paymentService->ledger");
      expect(doc.relationships).toHaveLength(8);
    }
  });

  it("the container-target spine resolves identically over either stage's edges", async () => {
    const { parsed, computed } = await rich();
    const known = new Set(["checkout-web", "payment-service", "ledger-service"]);
    for (const doc of [parsed, computed]) {
      const to = (id: string) => serviceOf(doc.elements, id, known);
      expect(to("paymentService.api")).toBe("payment-service");
      expect(to("paymentService.worker")).toBe("payment-service");
      expect(to("checkoutWeb.ui")).toBe("checkout-web");
      // Resolved through the ancestor's title against the known set — the
      // container itself carries no binding.
      expect(to("ledger.api")).toBe("ledger-service");
      // Every edge into payment-service, counted through the containers.
      const inbound = doc.relationships.filter((r) => to(r.target) === "payment-service");
      expect(inbound.map((r) => r.op ?? "-").sort()).toEqual(["-", "authorizePayment", "capturePayment"]);
    }
  });

  it("loadSource — the adapter every command goes through — returns exactly that", async () => {
    const { parsed } = await rich();
    const doc = await loadSource(RICH);
    expect(doc.errors).toEqual([]);
    expect(doc).toEqual(parsed);
  });

  /**
   * A view that names nothing is a Langium validation error, so `getErrors()`
   * still rejects it before either model is built. Dropping view computation
   * does not widen what loam accepts.
   */
  it("still rejects a document whose views are broken", async () => {
    const broken = `specification {
  element softwareSystem
}
model {
  a = softwareSystem 'alpha'
}
views {
  view index of nosuchelement {
    include *
  }
}
`;
    const doc = await loadSource(broken);
    expect(doc.errors.length).toBeGreaterThan(0);
    expect(doc.elements).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* Scale, on the edge axis                                             */
/* ------------------------------------------------------------------ */

/** A landscape of `services` systems and `edges` op-linked calls between them. */
function fleetLandscape(services: number, edges: number): string {
  const name = (i: number) => `s${String(i).padStart(3, "0")}`;
  const lines = ["specification {", "  element softwareSystem", "}", "", "model {"];
  for (let i = 0; i < services; i += 1) {
    lines.push(`  ${name(i)} = softwareSystem 'svc-${String(i).padStart(3, "0")}' {`);
    lines.push(`    metadata { service 'svc-${String(i).padStart(3, "0")}' }`);
    lines.push(`  }`);
  }
  let made = 0;
  for (let stride = 1; stride < services && made < edges; stride += 1) {
    for (let a = 0; a < services && made < edges; a += 1) {
      made += 1;
      lines.push(`  ${name(a)} -> ${name((a + stride) % services)} 'Calls ${made}' {`);
      lines.push(`    metadata { op 'op${made}' }`);
      lines.push(`  }`);
    }
  }
  if (made < edges) throw new Error(`cannot draw ${edges} distinct edges over ${services} services`);
  lines.push("}", "");
  return lines.join("\n");
}

/**
 * The regression that would have caught the bug. Element count is held FIXED
 * and only the edge count moves, because that is the axis that exploded.
 * Measured on a dev laptop over these exact documents:
 *
 *   120 elements, 200 edges:  parsed  12ms | computed        89ms
 *   120 elements, 300 edges:  parsed  11ms | computed  >200 000ms (killed)
 *   120 elements, 400 edges:  parsed   8ms | computed  >200 000ms (killed)
 *
 * The cliff sits just above 200 edges, which is why the 400 and 800 cases are
 * here: either one costs minutes the moment anything computes views again.
 *
 * The ceiling is wall-clock and therefore generous (observed ~1s for the whole
 * block, so ~30x headroom for a loaded CI box) — it exists to catch a return to
 * per-view work, which costs minutes, not milliseconds.
 */
describe("loading a landscape is not superlinear in edge count", () => {
  const SERVICES = 120;

  it.each([200, 400, 800])("reads 120 services / %i edges and gets every edge", async (edges) => {
    const started = performance.now();
    const doc = await loadSource(fleetLandscape(SERVICES, edges));
    const elapsed = performance.now() - started;
    expect(doc.errors).toEqual([]);
    expect(doc.elements).toHaveLength(SERVICES);
    expect(doc.relationships).toHaveLength(edges);
    expect(doc.relationships.filter((r) => r.op !== undefined)).toHaveLength(edges);
    expect(
      elapsed,
      `loading ${SERVICES} services / ${edges} edges took ${Math.round(elapsed)}ms`,
    ).toBeLessThan(30_000);
  });
});
