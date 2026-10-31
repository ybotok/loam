/**
 * fleet.yaml states the joins — a `calls:` entry naming the operation the
 * caller uses, and the `publishes:` / `consumes:` sections naming a message —
 * and `loam seed` draws one titled edge per stated id.
 *
 * The invariant guarded hardest here is I2 of the spine-lite design: every
 * fleet.yaml an older loam accepted keeps its meaning, which for the map means
 * the SAME model block, edge for edge, in the same order. That pin compares the
 * `model { … }` slice against a string captured from 0.2.0-alpha.18 before the
 * templater learned joins, and deliberately not the header: the header comment
 * was rewritten on purpose (decision D7), and a pin over the whole file would
 * have to be loosened to land that — which is the moment a real drift in the
 * edges slips through with it.
 *
 * Every refusal carries the treeHashes no-write proof, as seed.test.ts's do:
 * a refusal that cost a byte is not a refusal.
 */
import { describe, expect, it } from "vitest";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadSource } from "../src/core/c4/likec4.js";
import { readFleetFile } from "../src/core/c4/seed/fleet-file.js";
import { landscapeProvenance, sealLandscape } from "../src/core/c4/seed/stamp.js";
import { makeProject, runLoam, treeHashes, type Project } from "./helpers/harness.js";

/** The two dirs docsRepoFiles keeps in git; seed's gate refuses a repo without services/. */
const EMPTY_REPO = { "services/.gitkeep": "", "features/.gitkeep": "" };

async function writeFleet(p: Project, yaml: string): Promise<void> {
  await writeFile(join(p.workDir, "fleet.yaml"), yaml, "utf8");
}

interface SeedPayload {
  ok: boolean;
  landscape: string;
  calls: number;
  joins: { operations: number; publishes: number; consumes: number };
  next: string[];
}

/** One seed run in a fresh repo: the landscape it wrote, its payload and its human text. */
interface Seeded {
  landscape: string;
  payload: SeedPayload;
}

async function seed(fleet: string): Promise<Seeded> {
  const p = await makeProject({ ...EMPTY_REPO });
  try {
    await writeFleet(p, fleet);
    const run = await runLoam(p.workDir, "seed", "--json");
    expect(run.code, run.stdout).toBe(0);
    return { landscape: await p.read("architecture/landscape.likec4"), payload: JSON.parse(run.stdout) as SeedPayload };
  } finally {
    await p.destroy();
  }
}

/** The `model { … }` block of a landscape, line endings normalised, header excluded. */
function modelBlock(landscape: string): string {
  const text = landscape.replace(/\r\n/g, "\n");
  const start = text.indexOf("model {");
  const end = text.indexOf("\n}\n", start);
  expect(start, "no model block to compare — the pin must not pass vacuously").toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return text.slice(start, end + "\n}\n".length);
}

/** The drawn edges alone: every model line from the first edge on, closing brace excluded. */
function edgeLines(landscape: string): string {
  const model = modelBlock(landscape);
  const lines = model.split("\n");
  const first = lines.findIndex((l) => /^ {2}\S+ -\[\w+\]-> /.test(l));
  expect(first, "no edges drawn — the comparison must not pass vacuously").toBeGreaterThanOrEqual(0);
  return lines.slice(first, -2).join("\n") + "\n";
}

describe("I2 — a join-free fleet.yaml draws the model block 0.2.0-alpha.18 drew", () => {
  // Shaped to exercise every ordering rule the old templater had: a repeated
  // pair (dropped), statements out of order, an external as a caller (so the
  // sort is by declared NAME — `customer` between `checkout` and
  // `payment-service` — and not by element id), and a fold collision
  // (`payment-service` / `payment.service`) whose suffix is decided by the sort.
  const FLEET = `subsystems:
  - payments
services:
  - id: checkout
    subsystem: payments
  - id: payment-service
    subsystem: payments
  - billing
  - payment.service
externals:
  - stripe
  - customer
calls:
  - payment-service -> stripe
  - checkout -> payment-service
  - customer -> checkout
  - billing -> payment-service
  - checkout -> payment-service
  - billing -> payment.service
  - checkout -> billing
`;

  // Captured from `renderLandscape` at 6b28d65 (0.2.0-alpha.18), before the
  // templater drew joins. NEVER regenerate this string from the current code:
  // a pin re-derived from the thing it pins proves nothing.
  const ALPHA_18_MODEL =
    "model {\n" +
    "  svc_billing = softwareSystem 'billing' {\n    metadata { service 'billing' }\n  }\n" +
    "  svc_checkout = softwareSystem 'checkout' {\n    metadata { service 'checkout' }\n  }\n" +
    "  svc_payment_service = softwareSystem 'payment-service' {\n    metadata { service 'payment-service' }\n  }\n" +
    "  svc_payment_service_2 = softwareSystem 'payment.service' {\n    metadata { service 'payment.service' }\n  }\n" +
    "  ext_customer = softwareSystem 'customer' {\n    #external\n  }\n" +
    "  ext_stripe = softwareSystem 'stripe' {\n    #external\n  }\n" +
    "\n" +
    "  svc_billing -[calls]-> svc_payment_service\n" +
    "  svc_billing -[calls]-> svc_payment_service_2\n" +
    "  svc_checkout -[calls]-> svc_billing\n" +
    "  svc_checkout -[calls]-> svc_payment_service\n" +
    "  ext_customer -[calls]-> svc_checkout\n" +
    "  svc_payment_service -[calls]-> ext_stripe\n" +
    "}\n";

  it("edge for edge, in the same order", async () => {
    const { landscape, payload } = await seed(FLEET);
    expect(modelBlock(landscape)).toBe(ALPHA_18_MODEL);
    // And the same counts and next steps: a join-free file says what it said.
    expect(payload.calls).toBe(6);
    expect(payload.joins).toEqual({ operations: 0, publishes: 0, consumes: 0 });
    expect(payload.next).toEqual(["loam validate --all", "loam list --needs-work", "loam adopt --service billing"]);
  });
});

/** The fleet the design's first run is measured on — every section, lists in both spellings. */
const EXAMPLE = `services:
  - checkout-web
  - order-service
  - payment-service
  - id: identity-service
    subsystem: platform
  - id: notification-service
    subsystem: platform
subsystems:
  - platform
externals:
  - customer
  - stripe
  - kafka
calls:
  - customer -> checkout-web
  - checkout-web -> order-service: [createOrder, getOrder]
  - checkout-web -> payment-service: authorizePayment
  - order-service -> payment-service:
      - capturePayment
      - refundPayment
  - order-service -> identity-service: introspectToken
  - payment-service -> identity-service: introspectToken
  - payment-service -> stripe
publishes:
  - order-service -> kafka: order.OrderPlaced
  - payment-service -> kafka: [payment.PaymentAuthorized, payment.PaymentCaptured]
consumes:
  - kafka -> order-service: payment.PaymentAuthorized
  - kafka -> notification-service: [order.OrderPlaced, payment.PaymentCaptured]
`;

/** The model block's edges for EXAMPLE, exactly as the spine-lite design spells them. */
const EXAMPLE_EDGES = `  svc_checkout_web -[calls]-> svc_order_service 'createOrder' {
    metadata { op 'createOrder' }
  }
  svc_checkout_web -[calls]-> svc_order_service 'getOrder' {
    metadata { op 'getOrder' }
  }
  svc_checkout_web -[calls]-> svc_payment_service 'authorizePayment' {
    metadata { op 'authorizePayment' }
  }
  ext_customer -[calls]-> svc_checkout_web
  svc_order_service -[calls]-> svc_identity_service 'introspectToken' {
    metadata { op 'introspectToken' }
  }
  svc_order_service -[calls]-> svc_payment_service 'capturePayment' {
    metadata { op 'capturePayment' }
  }
  svc_order_service -[calls]-> svc_payment_service 'refundPayment' {
    metadata { op 'refundPayment' }
  }
  svc_payment_service -[calls]-> svc_identity_service 'introspectToken' {
    metadata { op 'introspectToken' }
  }
  svc_payment_service -[calls]-> ext_stripe
  svc_order_service -[publishes]-> ext_kafka 'order.OrderPlaced' {
    metadata { publishes 'order.OrderPlaced' }
  }
  svc_payment_service -[publishes]-> ext_kafka 'payment.PaymentAuthorized' {
    metadata { publishes 'payment.PaymentAuthorized' }
  }
  svc_payment_service -[publishes]-> ext_kafka 'payment.PaymentCaptured' {
    metadata { publishes 'payment.PaymentCaptured' }
  }
  ext_kafka -[delivers]-> svc_notification_service 'order.OrderPlaced' {
    metadata { consumes 'order.OrderPlaced' }
  }
  ext_kafka -[delivers]-> svc_notification_service 'payment.PaymentCaptured' {
    metadata { consumes 'payment.PaymentCaptured' }
  }
  ext_kafka -[delivers]-> svc_order_service 'payment.PaymentAuthorized' {
    metadata { consumes 'payment.PaymentAuthorized' }
  }
`;

/** The services and externals every small fixture below joins. */
const DECLARED = `services:
  - checkout
  - order-service
  - payment-service
externals:
  - kafka
  - stripe
`;

describe("emission — one titled edge per stated id, the kind the section names", () => {
  it("draws the design's example exactly, and validate reads it as the map it is", async () => {
    const p = await makeProject({ ...EMPTY_REPO });
    try {
      await writeFleet(p, EXAMPLE);
      const run = await runLoam(p.workDir, "seed", "--json");
      expect(run.code, run.stdout).toBe(0);
      const landscape = await p.read("architecture/landscape.likec4");
      expect(edgeLines(landscape)).toBe(EXAMPLE_EDGES);

      // Through the real validator: the emitted DSL parses, every binding
      // resolves, and the generated views — which now draw message edges —
      // are current, so seed's own first `next` step finds nothing stale.
      const validate = await runLoam(p.workDir, "validate", "--all", "--json");
      const report = JSON.parse(validate.stdout) as { targets: { kind: string; findings: { code: string }[] }[] };
      const target = report.targets.find((t) => t.kind === "landscape");
      expect(target?.findings.map((f) => f.code)).toEqual(["landscape.matched"]);
      const codes = report.targets.flatMap((t) => t.findings.map((f) => f.code));
      expect(codes).not.toContain("subsystem.views-stale");
      expect(codes).not.toContain("landscape.invalid");
    } finally {
      await p.destroy();
    }
  }, 60_000);

  it("a scalar op gives exactly the titled -[calls]-> block", async () => {
    const { landscape } = await seed(`${DECLARED}calls:\n  - checkout -> order-service: createOrder\n`);
    expect(edgeLines(landscape)).toBe(
      "  svc_checkout -[calls]-> svc_order_service 'createOrder' {\n    metadata { op 'createOrder' }\n  }\n",
    );
  });

  it("a flow list and a block list each give one edge per id, sorted by id", async () => {
    const flow = await seed(`${DECLARED}calls:\n  - checkout -> order-service: [getOrder, createOrder]\n`);
    const block = await seed(`${DECLARED}calls:\n  - checkout -> order-service:\n      - getOrder\n      - createOrder\n`);
    const expected =
      "  svc_checkout -[calls]-> svc_order_service 'createOrder' {\n    metadata { op 'createOrder' }\n  }\n" +
      "  svc_checkout -[calls]-> svc_order_service 'getOrder' {\n    metadata { op 'getOrder' }\n  }\n";
    expect(edgeLines(flow.landscape)).toBe(expected);
    expect(edgeLines(block.landscape)).toBe(expected);
  });

  it("publishes: draws -[publishes]->, consumes: draws -[delivers]->", async () => {
    const { landscape, payload } = await seed(
      `${DECLARED}publishes:\n  - payment-service -> kafka: payment.PaymentCaptured\n` +
        `consumes:\n  - kafka -> order-service: payment.PaymentCaptured\n`,
    );
    expect(edgeLines(landscape)).toBe(
      "  svc_payment_service -[publishes]-> ext_kafka 'payment.PaymentCaptured' {\n" +
        "    metadata { publishes 'payment.PaymentCaptured' }\n  }\n" +
        "  ext_kafka -[delivers]-> svc_order_service 'payment.PaymentCaptured' {\n" +
        "    metadata { consumes 'payment.PaymentCaptured' }\n  }\n",
    );
    // Neither is a call: `calls` counts the pairs under `calls:` and nothing else.
    expect(payload.calls).toBe(0);
    expect(payload.joins).toEqual({ operations: 0, publishes: 1, consumes: 1 });
  });

  it("a bare call beside an operation on the same pair, or beside a message through an external, is not drawn", async () => {
    // A bare twin of a checked edge makes every removal from the provider read
    // as possibly still consumed through the edge that names nothing; the bare
    // `order-service -> kafka` is the broker hop the publishes line now says.
    const { landscape, payload } = await seed(
      `${DECLARED}calls:\n  - checkout -> order-service\n  - checkout -> order-service: createOrder\n` +
        `  - order-service -> kafka\npublishes:\n  - order-service -> kafka: order.OrderPlaced\n`,
    );
    const edges = edgeLines(landscape);
    expect(edges).not.toMatch(/^ {2}svc_checkout -\[calls\]-> svc_order_service$/m);
    expect(edges).not.toMatch(/^ {2}svc_order_service -\[calls\]-> ext_kafka$/m);
    expect(edges).toContain("  svc_checkout -[calls]-> svc_order_service 'createOrder' {\n");
    expect(edges).toContain("  svc_order_service -[publishes]-> ext_kafka 'order.OrderPlaced' {\n");
    // Still two distinct call pairs under `calls:` — the count keeps its meaning.
    expect(payload.calls).toBe(2);
  });

  it("a bare call between two services stays drawn beside a message they exchange directly", async () => {
    // A message edge is never a caller (the consumer census reads it as the
    // message half's), so dropping the stated call turned a removal's honest
    // "could NOT be fully answered" into a false "no current edge names it".
    const { landscape, payload } = await seed(
      `${DECLARED}calls:\n  - order-service -> payment-service\n` +
        `publishes:\n  - order-service -> payment-service: order.OrderPlaced\n`,
    );
    expect(edgeLines(landscape)).toBe(
      "  svc_order_service -[calls]-> svc_payment_service\n" +
        "  svc_order_service -[publishes]-> svc_payment_service 'order.OrderPlaced' {\n" +
        "    metadata { publishes 'order.OrderPlaced' }\n  }\n",
    );
    expect(payload.calls).toBe(1);
  });

  it("a message whose name starts with 'call' is a message edge, never a call missing its operation", async () => {
    // Seed titles a message edge with its id, and `spine.op-link-missing`
    // reads a "call…" title with no op as an unlinked call: a correct fleet
    // failed `--spine --strict`, and the advised fix took the map from seed.
    const p = await makeProject({ ...EMPTY_REPO });
    const contract = (action: "send" | "receive"): string =>
      "asyncapi: 3.0.0\ninfo: { title: calls, version: '1.0' }\n" +
      "channels:\n  callEvents:\n    address: calls.v1\n    messages:\n      CallEnded:\n" +
      "        $ref: '#/components/messages/CallEnded'\n" +
      `operations:\n  callEnded:\n    action: ${action}\n    channel: { $ref: '#/channels/callEvents' }\n` +
      "    messages:\n      - $ref: '#/channels/callEvents/messages/CallEnded'\n" +
      "components:\n  messages:\n    CallEnded:\n      name: calls.CallEnded\n      payload: { type: object }\n";
    try {
      await writeFleet(
        p,
        `${DECLARED}publishes:\n  - order-service -> kafka: calls.CallEnded\n` +
          `consumes:\n  - kafka -> payment-service: calls.CallEnded\n`,
      );
      expect((await runLoam(p.workDir, "seed")).code).toBe(0);
      await p.write("services/order-service/asyncapi.yaml", contract("send"));
      await p.write("services/payment-service/asyncapi.yaml", contract("receive"));
      expect(await p.read("architecture/landscape.likec4")).toContain(
        "  ext_kafka -[delivers]-> svc_payment_service 'calls.CallEnded' {",
      );
      const strict = await runLoam(p.workDir, "validate", "--all", "--spine", "--strict", "--json");
      const report = JSON.parse(strict.stdout) as { targets: { findings: { code: string }[] }[] };
      const codes = report.targets.flatMap((t) => t.findings.map((f) => f.code));
      expect(codes).not.toContain("spine.op-link-missing");
      expect(codes).not.toContain("spine.message-undefined");
      expect(strict.code, strict.stdout).toBe(0);
    } finally {
      await p.destroy();
    }
  }, 60_000);

  it("an identical statement twice is one edge", async () => {
    const { landscape, payload } = await seed(
      `${DECLARED}calls:\n  - checkout -> order-service: createOrder\n  - checkout -> order-service: [createOrder]\n` +
        `consumes:\n  - kafka -> order-service: m.A\n  - kafka -> order-service: m.A\n`,
    );
    const edges = edgeLines(landscape);
    expect(edges.match(/'createOrder' \{/g)).toHaveLength(1);
    expect(edges.match(/'m\.A' \{/g)).toHaveLength(1);
    expect(payload.joins).toEqual({ operations: 1, publishes: 0, consumes: 1 });
  });

  it("an op on a call into an external is drawn (and is never graded — stripe's contract is not here)", async () => {
    const { landscape } = await seed(`${DECLARED}calls:\n  - payment-service -> stripe: createCharge\n`);
    expect(edgeLines(landscape)).toBe(
      "  svc_payment_service -[calls]-> ext_stripe 'createCharge' {\n    metadata { op 'createCharge' }\n  }\n",
    );
  });

  it("an external may state an outside producer under publishes:", async () => {
    const { landscape } = await seed(`${DECLARED}publishes:\n  - stripe -> kafka: stripe.ChargeSucceeded\n`);
    expect(edgeLines(landscape)).toContain("  ext_stripe -[publishes]-> ext_kafka 'stripe.ChargeSucceeded' {\n");
  });

  it("ids holding '.', ':' and '/' land in a landscape LikeC4 parses with zero errors", async () => {
    const { landscape } = await seed(
      `${DECLARED}calls:\n  - checkout -> order-service: [v1.orders:create, orders/get]\n` +
        `publishes:\n  - order-service -> kafka: "order/v2:OrderPlaced"\n`,
    );
    expect(landscape).toContain("metadata { op 'v1.orders:create' }");
    expect(landscape).toContain("metadata { op 'orders/get' }");
    expect(landscape).toContain("metadata { publishes 'order/v2:OrderPlaced' }");
    expect((await loadSource(landscape)).errors).toEqual([]);
  });
});

describe("determinism — the stamp's precondition", () => {
  it("shuffled statements, sections and list order give a byte-identical landscape, and so the same stamp", async () => {
    const shuffled = `externals:
  - kafka
  - stripe
  - customer
consumes:
  - kafka -> notification-service: [payment.PaymentCaptured, order.OrderPlaced]
  - kafka -> order-service: payment.PaymentAuthorized
calls:
  - payment-service -> stripe
  - order-service -> payment-service: [refundPayment, capturePayment]
  - payment-service -> identity-service: introspectToken
  - checkout-web -> order-service: [getOrder, createOrder]
  - order-service -> identity-service: introspectToken
  - checkout-web -> payment-service: authorizePayment
  - customer -> checkout-web
publishes:
  - payment-service -> kafka: [payment.PaymentCaptured, payment.PaymentAuthorized]
  - order-service -> kafka: order.OrderPlaced
subsystems:
  - platform
services:
  - id: notification-service
    subsystem: platform
  - payment-service
  - id: identity-service
    subsystem: platform
  - order-service
  - checkout-web
`;
    const a = await seed(EXAMPLE);
    const b = await seed(shuffled);
    expect(b.landscape).toBe(a.landscape);
  }, 60_000);

  it("a CRLF fleet.yaml gives the bytes an LF one does", async () => {
    const lf = await seed(EXAMPLE);
    const crlf = await seed(EXAMPLE.replace(/\n/g, "\r\n"));
    expect(crlf.landscape).toBe(lf.landscape);
  }, 60_000);

  it("records the line each id was stated on — a block list puts each on its own", () => {
    const read = readFleetFile(
      "services:\n  - a\n  - b\ncalls:\n  - a -> b:\n      - x\n      - y\n  - b -> a\n",
      "fleet.yaml",
    );
    if (!read.ok) throw new Error(read.problem.message);
    expect(read.seed.edges).toEqual([
      { from: "a", to: "b", join: { key: "op", id: "x" }, line: 6 },
      { from: "a", to: "b", join: { key: "op", id: "y" }, line: 7 },
      { from: "b", to: "a", join: null, line: 8 },
    ]);
  });
});

describe("re-running — the map stays a pure function of fleet.yaml", () => {
  it("adding an op to fleet.yaml and re-seeding regenerates the map with the op on it", async () => {
    const p = await makeProject({ ...EMPTY_REPO });
    try {
      await writeFleet(p, `${DECLARED}calls:\n  - checkout -> order-service\n`);
      expect((await runLoam(p.workDir, "seed", "--json")).code).toBe(0);
      expect(await p.read("architecture/landscape.likec4")).toContain("  svc_checkout -[calls]-> svc_order_service\n");

      await writeFleet(p, `${DECLARED}calls:\n  - checkout -> order-service: createOrder\n`);
      const rerun = await runLoam(p.workDir, "seed", "--json");
      expect(rerun.code, rerun.stdout).toBe(0);
      expect((JSON.parse(rerun.stdout) as SeedPayload).landscape).toBe("regenerated");
      const map = (await p.read("architecture/landscape.likec4")).replace(/\r\n/g, "\n");
      expect(map).toContain("  svc_checkout -[calls]-> svc_order_service 'createOrder' {\n    metadata { op 'createOrder' }\n  }\n");
      expect(map).not.toContain("  svc_checkout -[calls]-> svc_order_service\n");
    } finally {
      await p.destroy();
    }
  });

  it("a map an older loam sealed under the old header is still recognised, and its re-seed rewrites the header once", async () => {
    // The stamp digests each file's own body, so a header this release no
    // longer writes is still a header that file's stamp vouches for. Without
    // that, every repository seeded before D7 would refuse its first re-seed
    // as hand-edited — over a comment loam itself wrote.
    const OLD_HEADER =
      "// As contracts arrive, give each call the operationId it uses, so\n" +
      "// requirements, C4 and OpenAPI can be cross-checked:\n" +
      "//\n" +
      "//   svc_checkout -[calls]-> svc_payment_service 'Calls authorizePayment' {\n" +
      "//     metadata { op 'authorizePayment' }\n" +
      "//   }\n";
    const NEW_HEADER =
      "// Name the operation a call uses in fleet.yaml, not here, and seed draws it as\n" +
      "// a join `loam validate --all --spine` checks against the provider's\n" +
      "// openapi.yaml; messages go under fleet.yaml's publishes: and consumes:.\n" +
      "//\n" +
      "//   calls:\n" +
      "//     - checkout-web -> payment-service: authorizePayment\n";
    const p = await makeProject({ ...EMPTY_REPO });
    try {
      const fleet = `${DECLARED}calls:\n  - checkout -> order-service\n`;
      await writeFleet(p, fleet);
      expect((await runLoam(p.workDir, "seed", "--json")).code).toBe(0);
      const current = (await p.read("architecture/landscape.likec4")).replace(/\r\n/g, "\n");
      const body = current.slice(current.indexOf("\n") + 1);
      expect(body).toContain(NEW_HEADER);
      const old = sealLandscape(body.replace(NEW_HEADER, OLD_HEADER));
      expect(landscapeProvenance(old)).toBe("seed-stamped");
      await p.write("architecture/landscape.likec4", old);

      const rerun = await runLoam(p.workDir, "seed", "--json");
      expect(rerun.code, rerun.stdout).toBe(0);
      expect((JSON.parse(rerun.stdout) as SeedPayload).landscape).toBe("regenerated");
      expect(await p.read("architecture/landscape.likec4")).toBe(current);
    } finally {
      await p.destroy();
    }
  });

  it("the header tells the reader to state joins in fleet.yaml, never to hand-edit them here", async () => {
    // The old header taught `metadata { op }` written onto this file — advice
    // that, followed, locks seed out of its own map. One header for every
    // seeded file (decision D7), join-free ones included.
    for (const fleet of [`${DECLARED}calls:\n  - checkout -> order-service\n`, EXAMPLE]) {
      const lines = (await seed(fleet)).landscape.replace(/\r\n/g, "\n").split("\n");
      expect(lines.slice(1, 11)).toEqual([
        "// Generated from fleet.yaml by `loam seed` — edit fleet.yaml and re-run to",
        "// regenerate. Hand edits make this file yours: the stamp on line 1 is how",
        "// seed tells, and it will then refuse to touch the file again.",
        "//",
        "// Name the operation a call uses in fleet.yaml, not here, and seed draws it as",
        "// a join `loam validate --all --spine` checks against the provider's",
        "// openapi.yaml; messages go under fleet.yaml's publishes: and consumes:.",
        "//",
        "//   calls:",
        "//     - checkout-web -> payment-service: authorizePayment",
      ]);
      expect(lines.join("\n")).not.toContain("As contracts arrive");
    }
  });
});

describe("--json and the human text", () => {
  it("joins counts drawn edges; calls stays the distinct pairs under calls:; next leads with the spine run", async () => {
    const { payload } = await seed(EXAMPLE);
    expect(payload.calls).toBe(7);
    expect(payload.joins).toEqual({ operations: 7, publishes: 3, consumes: 3 });
    expect(payload.next).toEqual([
      "loam validate --all --spine",
      "loam validate --all",
      "loam list --needs-work",
      "loam adopt --service checkout-web",
    ]);
  });

  it("the human sentence names the joins only when there are some", async () => {
    const withJoins = await makeProject({ ...EMPTY_REPO });
    try {
      await writeFleet(withJoins, EXAMPLE);
      const run = await runLoam(withJoins.workDir, "seed");
      expect(run.code, run.stdout).toBe(0);
      expect(run.stdout).toContain(
        "architecture/landscape.likec4 created — 5 service(s), 7 call(s), 7 operation join(s), 6 message join(s), from fleet.yaml",
      );
      expect(run.stdout).toContain("  loam validate --all --spine\n");
    } finally {
      await withJoins.destroy();
    }
    const joinFree = await makeProject({ ...EMPTY_REPO });
    try {
      await writeFleet(joinFree, `${DECLARED}calls:\n  - checkout -> order-service\n`);
      const run = await runLoam(joinFree.workDir, "seed");
      expect(run.code, run.stdout).toBe(0);
      expect(run.stdout).toContain("architecture/landscape.likec4 created — 3 service(s), 1 call(s), from fleet.yaml");
      expect(run.stdout).not.toContain("--spine");
    } finally {
      await joinFree.destroy();
    }
  }, 60_000);
});

/** The fixture refusals append to — it declares a subsystem, so a subsystem endpoint can be tried. Its last line is 9. */
const REFUSAL_BASE = `subsystems:
  - platform
services:
  - checkout
  - order-service
  - id: payment-service
    subsystem: platform
externals:
  - kafka
`;

describe("every join refusal names fleet.yaml:<line>, reuses an existing code, and writes nothing", () => {
  // `section` is appended to REFUSAL_BASE, so its heading is line 10 and its
  // first item line 11.
  const cases: Array<{ name: string; section: string; code: string; expects: string[] }> = [
    {
      name: "two pairs in one item",
      section: "calls:\n  - {checkout -> order-service: a, order-service -> payment-service: b}\n",
      code: "seed-file-invalid",
      expects: ["fleet.yaml:11", "one statement per entry", "holds 2", "'checkout -> order-service'", "'order-service -> payment-service'"],
    },
    {
      name: "a call key with no value names no operation",
      section: "calls:\n  - checkout -> order-service:\n",
      code: "seed-file-invalid",
      expects: ["fleet.yaml:11", "'checkout -> order-service:' names no operation", "Write 'checkout -> order-service'"],
    },
    {
      name: "an empty list names no operation either",
      section: "calls:\n  - checkout -> order-service: []\n",
      code: "seed-file-invalid",
      expects: ["fleet.yaml:11", "names no operation"],
    },
    {
      name: "a number YAML read as one is not an operationId",
      section: "calls:\n  - checkout -> order-service: 404\n",
      code: "seed-file-invalid",
      expects: ["fleet.yaml:11", "an operationId must be a string", "quote it"],
    },
    {
      name: "a boolean is not an operationId",
      section: "calls:\n  - checkout -> order-service: true\n",
      code: "seed-file-invalid",
      expects: ["fleet.yaml:11", "an operationId must be a string"],
    },
    {
      name: "a mapping is not an operationId",
      section: "calls:\n  - checkout -> order-service: {op: createOrder}\n",
      code: "seed-file-invalid",
      expects: ["fleet.yaml:11", "an operationId must be a string"],
    },
    {
      name: "a non-string inside a block list names its own line",
      section: "calls:\n  - checkout -> order-service:\n      - createOrder\n      - 7\n",
      code: "seed-file-invalid",
      expects: ["fleet.yaml:13", "an operationId must be a string"],
    },
    {
      name: "an id with a space",
      section: "calls:\n  - checkout -> order-service: create order\n",
      code: "seed-file-invalid",
      expects: ["fleet.yaml:11", "'create order' cannot be an id here", "byte for byte"],
    },
    {
      name: "an id with a quote — it would end the LikeC4 string",
      section: "calls:\n  - checkout -> order-service: it's\n",
      code: "seed-file-invalid",
      expects: ["fleet.yaml:11", "'it's' cannot be an id here"],
    },
    {
      name: "an id with a comma",
      section: "calls:\n  - checkout -> order-service: a,b\n",
      code: "seed-file-invalid",
      expects: ["fleet.yaml:11", "'a,b' cannot be an id here"],
    },
    {
      name: "an id with a backslash",
      section: "calls:\n  - checkout -> order-service: 'create\\order'\n",
      code: "seed-file-invalid",
      expects: ["fleet.yaml:11", "cannot be an id here", "backslashes"],
    },
    {
      name: "an empty id",
      section: "calls:\n  - checkout -> order-service: ''\n",
      code: "seed-file-invalid",
      expects: ["fleet.yaml:11", "an empty id names nothing"],
    },
    {
      name: "an id longer than 200 characters",
      section: `calls:\n  - checkout -> order-service: ${"x".repeat(201)}\n`,
      code: "seed-file-invalid",
      expects: ["fleet.yaml:11", "201 characters long", "at most 200"],
    },
    {
      name: "a bare publishes entry names no message",
      section: "publishes:\n  - order-service -> kafka\n",
      code: "seed-file-invalid",
      expects: ["fleet.yaml:11", "a publishes entry names its message", "'order-service -> kafka: <message>'"],
    },
    {
      name: "a publishes key with no value names no message",
      section: "publishes:\n  - order-service -> kafka:\n",
      code: "seed-file-invalid",
      expects: ["fleet.yaml:11", "'order-service -> kafka:' names no message"],
    },
    {
      name: "a message name YAML reads as a number is refused with the list spelling",
      section: "publishes:\n  - order-service -> kafka: [order.OrderPlaced, 12]\n",
      code: "seed-file-invalid",
      expects: ["fleet.yaml:11", "a message name must be a string", "a publishes entry takes one name or a list"],
    },
    {
      name: "a non-string, non-mapping publishes entry says it is a mapping",
      section: "publishes:\n  - [order-service, kafka]\n",
      code: "seed-file-invalid",
      expects: ["fleet.yaml:11", "a publishes entry is a mapping 'producer -> broker: message'"],
    },
    {
      name: "a bare consumes entry names no message",
      section: "consumes:\n  - kafka -> order-service\n",
      code: "seed-file-invalid",
      expects: ["fleet.yaml:11", "a consumes entry names its message"],
    },
    {
      name: "a consumes line pointed at an external is refused with the corrected arrow",
      section: "consumes:\n  - order-service -> kafka: payment.PaymentAuthorized\n",
      code: "seed-file-invalid",
      expects: [
        "fleet.yaml:11",
        "under consumes:, the arrow follows the message to its consumer",
        "points at kafka, a system outside the fleet",
        "Write it 'kafka -> order-service: payment.PaymentAuthorized'",
      ],
    },
    {
      name: "the corrected arrow keeps a list a list",
      section: "consumes:\n  - order-service -> kafka: [m.A, m.B]\n",
      code: "seed-file-invalid",
      expects: ["fleet.yaml:11", "Write it 'kafka -> order-service: [m.A, m.B]'"],
    },
    {
      name: "a key that is not 'caller -> callee' says the shape",
      section: "calls:\n  - checkout: createOrder\n",
      code: "seed-file-invalid",
      expects: ["fleet.yaml:11", "'caller -> callee'", "(got 'checkout')"],
    },
    {
      name: "a non-string, non-mapping calls entry says what an entry may be",
      section: "calls:\n  - 7\n",
      code: "seed-file-invalid",
      expects: ["fleet.yaml:11", "a calls entry is a string 'caller -> callee', or a mapping"],
    },
    {
      name: "an undeclared endpoint under publishes: reuses unknown-service, with the hint",
      section: "publishes:\n  - order-servce -> kafka: order.OrderPlaced\n",
      code: "unknown-service",
      expects: ["fleet.yaml:11", "publishes entry 'order-servce -> kafka'", "'order-service'"],
    },
    {
      name: "a subsystem as a consumes endpoint is refused as one",
      section: "consumes:\n  - kafka -> platform: order.OrderPlaced\n",
      code: "unknown-service",
      expects: ["fleet.yaml:11", "names the subsystem 'platform'"],
    },
    {
      name: "a self-edge under publishes: is the self-edge refusal",
      section: "publishes:\n  - order-service -> order-service: order.OrderPlaced\n",
      code: "seed-file-invalid",
      expects: ["fleet.yaml:11", "both ends", "self-edge"],
    },
    {
      name: "a top-level typo is caught against the extended key list",
      section: "consume:\n  - kafka -> order-service: order.OrderPlaced\n",
      code: "seed-file-invalid",
      expects: ["fleet.yaml:10", "unknown key 'consume'", "calls, publishes and consumes", "Did you mean 'consumes'?"],
    },
  ];
  for (const c of cases) {
    it(c.name, async () => {
      const p = await makeProject({ ...EMPTY_REPO });
      try {
        await writeFleet(p, REFUSAL_BASE + c.section);
        const before = await treeHashes(p.docsDir);
        const run = await runLoam(p.workDir, "seed", "--json");
        expect(run.code, run.stdout).toBe(1);
        const payload = JSON.parse(run.stdout) as { ok: boolean; error: { code: string; message: string } };
        expect(payload.ok).toBe(false);
        expect(payload.error.code).toBe(c.code);
        for (const fragment of c.expects) expect(payload.error.message).toContain(fragment);
        expect(await treeHashes(p.docsDir)).toEqual(before);
      } finally {
        await p.destroy();
      }
    });
  }

  it("a consumes line between two externals says the consumer must be a service — no reversed arrow to offer", async () => {
    const p = await makeProject({ ...EMPTY_REPO });
    try {
      await writeFleet(p, `${REFUSAL_BASE}  - stripe\nconsumes:\n  - stripe -> kafka: m.A\n`);
      const before = await treeHashes(p.docsDir);
      const run = await runLoam(p.workDir, "seed", "--json");
      expect(run.code, run.stdout).toBe(1);
      const message = (JSON.parse(run.stdout) as { error: { message: string } }).error.message;
      expect(message).toContain("fleet.yaml:12");
      expect(message).toContain("consumer must be a service the fleet declares");
      expect(message).not.toContain("Write it");
      expect(await treeHashes(p.docsDir)).toEqual(before);
    } finally {
      await p.destroy();
    }
  });
});
