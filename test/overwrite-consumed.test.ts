/**
 * An overwrite that takes a consumed operation out of the contract —
 * `openapi.remove-op-consumed` in its overwrite shape. A feature delta that
 * defines ANOTHER operationId at the method and path where a living operation
 * lives replaces it there (the merge writes per slot), and once the contract
 * the merge would write defines the living one nowhere, it has left the
 * contract exactly as a retirement does — with no removal marker for the
 * removal gate to read.
 *
 * Reproduced on a copy of the shipped example: a delta defining `fetchOrder`
 * at GET /orders/{id}, where `getOrder` lives — called by a landscape edge and
 * governed by order-service's own requirement — drew only `api.op-unconsumed`
 * (advisory), archived without `--approve`, and the next `validate` reported
 * `spine.op-undefined` and `spec-api.op-undefined` against documents nobody in
 * the feature touched.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cp, rm } from "node:fs/promises";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parse } from "yaml";
import type { Finding } from "../src/core/vocabulary/report.js";
import { makeProject, makeTmpDir, pinFor, pinOpenapi, runLoam, type Project } from "./helpers/harness.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!();
});

function findings(stdout: string): Finding[] {
  return (JSON.parse(stdout) as { targets: Array<{ findings: Finding[] }> }).targets.flatMap((t) => t.findings);
}

const ofCode = <T extends { code: string }>(all: readonly T[], code: string): T[] => all.filter((f) => f.code === code);

/* ------------------------------------------------------------------ */
/* The shipped example — the reproduction                              */
/* ------------------------------------------------------------------ */

const SHIPPED_EXAMPLE = fileURLToPath(new URL("../examples/docs", import.meta.url));
const LIVING_ORDER_API = "services/order-service/openapi.yaml";

/** A byte copy of the shipped example docs repo — its loam.json names itself as the docs root. */
async function exampleFleet(): Promise<{ fleet: string; read(rel: string): string; write(rel: string, text: string): void }> {
  const root = await makeTmpDir("loam-overwrite-");
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const fleet = join(root, "fleet");
  await cp(SHIPPED_EXAMPLE, fleet, { recursive: true });
  return {
    fleet,
    read: (rel) => readFileSync(join(fleet, rel), "utf8"),
    write: (rel, text) => {
      mkdirSync(dirname(join(fleet, rel)), { recursive: true });
      writeFileSync(join(fleet, rel), text, "utf8");
    },
  };
}

/** Another operationId at the slot `getOrder` holds in the example. */
const FETCH_OVER_GET = `openapi: 3.1.0
paths:
  /orders/{id}:
    get:
      operationId: fetchOrder
      responses:
        "200":
          description: ok
`;

describe("the shipped example: fetchOrder defined where getOrder lives", () => {
  it("is refused at the gate, naming the edge and the requirement the merge would strand; --approve still breaks it deliberately", async () => {
    const f = await exampleFleet();
    f.write(
      "features/FEAT-210-swap/intent.md",
      "---\nfeature: FEAT-210\ntitle: swap\nstatus: in_progress\nowner: orders-team\nservices: [order-service]\n---\n\n# FEAT-210\n\n## Why\nThe read is renamed.\n",
    );
    // Pinned, exactly as `loam rebase` writes it — so the overwrite is an edit
    // the merge lands, and no baseline finding stands beside the one graded here.
    f.write("features/FEAT-210-swap/specs/order-service/openapi.yaml", pinOpenapi(FETCH_OVER_GET, f.read(LIVING_ORDER_API)));

    const validated = findings((await runLoam(f.fleet, "validate", "--feature", "FEAT-210", "--json")).stdout);
    const [consumed, ...more] = ofCode(validated, "openapi.remove-op-consumed");
    expect(more).toEqual([]);
    expect(consumed).toMatchObject({ severity: "error", subject: "order-service" });
    expect(consumed!.message).toContain("defines 'fetchOrder' at GET /orders/{id}, where 'getOrder' lives now");
    expect(consumed!.message).toContain("would leave 'getOrder' defined nowhere");
    expect(consumed!.message).toContain(`edge checkout-web → order-service ("Calls getOrder")`);
    expect(consumed!.message).toContain("order-service's living requirement 'Read an order'");
    expect(consumed!.message).toContain("Define 'getOrder' at another address in this delta if it is to stay");
    expect(consumed!.message).toContain("--approve");
    // The advisory it used to be alone with stays what it was.
    expect(ofCode(validated, "api.op-unconsumed").map((w) => w.severity)).toEqual(["warn"]);

    const refused = await runLoam(f.fleet, "archive", "FEAT-210", "--json");
    expect(refused.code, refused.out).toBe(1);
    const refusal = JSON.parse(refused.stdout) as { error: { code: string }; issues: Array<{ code: string; overridable: boolean }> };
    expect(refusal.error.code).toBe("not-coherent");
    // The removal's own overridability: a judgement about consumers who may
    // already be gone in code, not a mechanical loss of authored text.
    expect(ofCode(refusal.issues, "openapi.remove-op-consumed")).toEqual([expect.objectContaining({ overridable: true })]);
    expect(f.read(LIVING_ORDER_API)).toContain("operationId: getOrder");

    const approved = await runLoam(f.fleet, "archive", "FEAT-210", "--approve", "--json");
    expect(approved.code, approved.out).toBe(0);
    const merged = JSON.parse(approved.stdout) as { overridden: Array<{ code: string }> };
    expect(ofCode(merged.overridden, "openapi.remove-op-consumed")).toHaveLength(1);
    expect(f.read(LIVING_ORDER_API)).toContain("operationId: fetchOrder");
    expect(f.read(LIVING_ORDER_API)).not.toContain("operationId: getOrder");
  });
});

/* ------------------------------------------------------------------ */
/* A two-service fleet — the rename, the advisory, the new edge        */
/* ------------------------------------------------------------------ */

const LANDSCAPE = `specification {
  element softwareSystem
}

model {
  checkoutWeb = softwareSystem 'checkout-web' {
    description 'Customer-facing checkout UI'
  }
  paymentService = softwareSystem 'payment-service' {
    description 'Owns payment authorization and capture'
  }

  checkoutWeb -> paymentService 'Calls authorizePayment' {
    metadata { op 'authorizePayment' }
  }
  checkoutWeb -> paymentService 'Calls capturePayment' {
    metadata { op 'capturePayment' }
  }
}

views {
  view landscape {
    include *
  }
}
`;

/** The same landscape with the capturePayment edge taken out in the same change. */
const LANDSCAPE_NO_CAPTURE = LANDSCAPE.replace(
  `  checkoutWeb -> paymentService 'Calls capturePayment' {
    metadata { op 'capturePayment' }
  }
`,
  "",
);

function serviceModel(id: string, variable: string): string {
  return `specification {
  element softwareSystem
  element container
}

model {
  ${variable} = softwareSystem '${id}' {
    api = container 'api'
  }
}

views {
  view of ${variable} {
    include *
  }
}
`;
}

const PAYMENT_SPEC = `---
service: payment-service
status: verified
---

# payment-service

## Requirements

### Requirement: Authorize a payment
The service SHALL authorize a payment before capture.

Operations: authorizePayment

#### Scenario: Successful authorization
- **Given** a valid card
- **When** authorization is requested
- **Then** the payment is authorized

### Requirement: Capture a payment
The service SHALL capture an authorized payment.

Operations: capturePayment

#### Scenario: Successful capture
- **Given** an authorized payment
- **When** capture is requested
- **Then** the funds are captured
`;

/** `pingPayments` is the operation nothing consumes: no edge calls it, no requirement names it. */
const PAYMENT_OPENAPI = `openapi: 3.1.0
info: { title: payment-service, version: "1.0" }
paths:
  /payments:
    post:
      operationId: authorizePayment
      responses: { "200": { description: ok } }
  /payments/capture:
    post:
      operationId: capturePayment
      responses: { "200": { description: ok } }
  /payments/ping:
    get:
      operationId: pingPayments
      responses: { "200": { description: ok } }
`;

const CHECKOUT_SPEC = `---
service: checkout-web
status: verified
---

# checkout-web

## Requirements

### Requirement: Take a payment at checkout
The UI SHALL take a payment when the customer confirms the order.

#### Scenario: Customer confirms
- **Given** a basket
- **When** the customer confirms
- **Then** a payment is taken
`;

const FEAT = "features/FEAT-60-settle";

function fleet(landscape: string): Record<string, string> {
  return {
    "architecture/landscape.likec4": landscape,
    "services/payment-service/model.likec4": serviceModel("payment-service", "paymentService"),
    "services/payment-service/spec.md": PAYMENT_SPEC,
    "services/payment-service/openapi.yaml": PAYMENT_OPENAPI,
    "services/checkout-web/model.likec4": serviceModel("checkout-web", "checkoutWeb"),
    "services/checkout-web/spec.md": CHECKOUT_SPEC,
    [`${FEAT}/intent.md`]: "# Settle\n\nCapture is renamed to settlement.\n",
  };
}

/** `settlePayment` defined where `capturePayment` lives, pinned as `loam rebase` writes it. */
const SETTLE_OVER_CAPTURE = pinOpenapi(
  `openapi: 3.1.0
paths:
  /payments/capture:
    post:
      operationId: settlePayment
      responses: { "200": { description: settled } }
`,
  PAYMENT_OPENAPI,
);

/** The provider's governing requirement, restated by the feature to name `ops`. */
function restatedCapture(ops: string): string {
  return `# payment-service — delta for FEAT-60

## MODIFIED Requirements

### Requirement: Capture a payment
Based-On: ${pinFor(PAYMENT_SPEC, "Capture a payment")}
The service SHALL settle an authorized payment.

Operations: ${ops}

#### Scenario: Successful settlement
- **Given** an authorized payment
- **When** settlement is requested
- **Then** the funds are captured
`;
}

/** A delta.likec4 whose one tagged edge calls `op` on payment-service. */
function deltaCalling(op: string): string {
  return `specification {
  element softwareSystem
  tag FEAT-60
}

model {
  checkoutWeb = softwareSystem 'checkout-web'
  paymentService = softwareSystem 'payment-service'

  checkoutWeb -> paymentService 'Calls ${op}' {
    #FEAT-60
    metadata { op '${op}' }
  }
}
`;
}

/** The living operationIds a service's contract defines right now. */
async function livingOps(p: Project, service: string): Promise<string[]> {
  const doc = parse(await p.read(`services/${service}/openapi.yaml`)) as {
    paths?: Record<string, Record<string, { operationId?: string }>>;
  };
  return Object.values(doc.paths ?? {})
    .flatMap((item) => Object.values(item).map((op) => op?.operationId))
    .filter((id): id is string => typeof id === "string")
    .sort();
}

async function project(files: Record<string, string>): Promise<Project> {
  const p = await makeProject(files);
  cleanups.push(() => p.destroy());
  return p;
}

describe("an overwrite is graded against the consumers a removal is", () => {
  it("a rename that updates its consumers in the same change archives, and the fleet stays green", async () => {
    // The edge is redrawn the only way an edge can be — the landscape merge
    // ADDS, so the old one is dropped from the living map and the new one
    // rides in the delta — and the governing requirement is restated in the
    // feature to name the new operation. Nothing is left calling the old id.
    const p = await project({
      ...fleet(LANDSCAPE_NO_CAPTURE),
      [`${FEAT}/specs/payment-service/openapi.yaml`]: SETTLE_OVER_CAPTURE,
      [`${FEAT}/specs/payment-service/spec.md`]: restatedCapture("settlePayment"),
      [`${FEAT}/delta.likec4`]: deltaCalling("settlePayment"),
    });
    // A realistic fleet has run `loam subsystem sync`: its two GENERATED views
    // files are part of the docs repo, and their absence is its own finding.
    await runLoam(p.workDir, "subsystem", "sync");
    const validated = findings((await runLoam(p.workDir, "validate", "--feature", "FEAT-60", "--json")).stdout);
    expect(ofCode(validated, "openapi.remove-op-consumed")).toEqual([]);

    const archived = await runLoam(p.workDir, "archive", "FEAT-60", "--json");
    expect(archived.code, archived.out).toBe(0);
    expect(await livingOps(p, "payment-service")).toEqual(["authorizePayment", "pingPayments", "settlePayment"]);
    const errors = findings((await runLoam(p.workDir, "validate", "--all", "--json")).stdout).filter((f) => f.severity === "error");
    expect(errors).toEqual([]);
  });

  it("the same rename leaving the living edge behind is refused, naming it — and archive writes nothing", async () => {
    const p = await project({
      ...fleet(LANDSCAPE),
      [`${FEAT}/specs/payment-service/openapi.yaml`]: SETTLE_OVER_CAPTURE,
      [`${FEAT}/specs/payment-service/spec.md`]: restatedCapture("settlePayment"),
      [`${FEAT}/delta.likec4`]: deltaCalling("settlePayment"),
    });
    const refused = await runLoam(p.workDir, "archive", "FEAT-60", "--json");
    expect(refused.code, refused.out).toBe(1);
    const [issue, ...more] = ofCode(
      (JSON.parse(refused.stdout) as { issues: Array<{ code: string; message: string }> }).issues,
      "openapi.remove-op-consumed",
    );
    expect(more).toEqual([]);
    expect(issue!.message).toContain("defines 'settlePayment' at POST /payments/capture, where 'capturePayment' lives now");
    // The edge alone: restated by the feature, the provider's own requirement
    // is not left behind.
    expect(issue!.message).toContain(`still consumed — edge checkout-web → payment-service ("Calls capturePayment").`);
    expect(await livingOps(p, "payment-service")).toEqual(["authorizePayment", "capturePayment", "pingPayments"]);
  });

  it("the provider's requirement still naming the old id is a consumer the merge would strand — living or restated", async () => {
    // Unrestated, the living requirement stays; restated with the old id, the
    // feature writes the stranded line itself. Either way `validate` would
    // report `spec-api.op-undefined` against payment-service after the archive.
    for (const [spec, who] of [
      [undefined, "payment-service's living requirement 'Capture a payment'"],
      [restatedCapture("capturePayment"), "this feature's payment-service delta requirement 'Capture a payment'"],
    ] as const) {
      const p = await project({
        ...fleet(LANDSCAPE_NO_CAPTURE),
        [`${FEAT}/specs/payment-service/openapi.yaml`]: SETTLE_OVER_CAPTURE,
        ...(spec === undefined ? {} : { [`${FEAT}/specs/payment-service/spec.md`]: spec }),
      });
      const [issue, ...more] = ofCode(
        findings((await runLoam(p.workDir, "validate", "--feature", "FEAT-60", "--json")).stdout),
        "openapi.remove-op-consumed",
      );
      expect(more).toEqual([]);
      expect(issue!.message).toContain(`still consumed — ${who}.`);
    }
  });

  it("an overwrite of an operation nothing consumes stays advisory", async () => {
    const p = await project({
      ...fleet(LANDSCAPE),
      [`${FEAT}/specs/payment-service/openapi.yaml`]: pinOpenapi(
        `openapi: 3.1.0
paths:
  /payments/ping:
    get:
      operationId: checkHealth
      responses: { "200": { description: ok } }
`,
        PAYMENT_OPENAPI,
      ),
    });
    const validated = findings((await runLoam(p.workDir, "validate", "--feature", "FEAT-60", "--json")).stdout);
    expect(ofCode(validated, "openapi.remove-op-consumed")).toEqual([]);
    expect(ofCode(validated, "api.op-unconsumed")).toEqual([expect.objectContaining({ severity: "warn" })]);
    const archived = await runLoam(p.workDir, "archive", "FEAT-60");
    expect(archived.code, archived.out).toBe(0);
    expect(await livingOps(p, "payment-service")).toEqual(["authorizePayment", "capturePayment", "checkHealth"]);
  });

  it("an operation with NO operationId defined where a consumed one lives takes it out all the same — and owes a pin like any other", async () => {
    // The reader dropped an operation with no operationId outright, so the
    // merge simulation never ran for a delta holding only that, and the
    // slot-keyed baseline gate never graded it: unpinned, it upserted over
    // `capturePayment` at exit 0 with no finding of any kind.
    const p = await project({
      ...fleet(LANDSCAPE),
      [`${FEAT}/specs/payment-service/openapi.yaml`]: `openapi: 3.1.0
paths:
  /payments/capture:
    post:
      summary: Capture, by the legacy gateway
      responses: { "200": { description: captured } }
`,
    });
    const before = findings((await runLoam(p.workDir, "validate", "--feature", "FEAT-60", "--json")).stdout);
    const [consumed, ...more] = ofCode(before, "openapi.remove-op-consumed");
    expect(more).toEqual([]);
    expect(consumed!.message).toContain("defines an operation with no operationId at POST /payments/capture, where 'capturePayment' lives now");
    expect(consumed!.message).toContain(`edge checkout-web → payment-service ("Calls capturePayment")`);
    expect(ofCode(before, "openapi.baseline-missing")).toEqual([
      expect.objectContaining({ message: expect.stringContaining("1 operation(s)") }),
    ]);

    const rebased = await runLoam(p.workDir, "rebase", "FEAT-60", "--json");
    expect(rebased.code, rebased.out).toBe(0);
    expect((JSON.parse(rebased.stdout) as { written: string[] }).written).toHaveLength(1);
    const after = findings((await runLoam(p.workDir, "validate", "--feature", "FEAT-60", "--json")).stdout);
    expect(ofCode(after, "openapi.baseline-missing")).toEqual([]);
    expect(ofCode(after, "openapi.baseline-invalid")).toEqual([]);
    expect(ofCode(after, "openapi.remove-op-consumed")).toHaveLength(1);
  });

  it("a new tagged edge onto the operation the overwrite takes out is c4-api.op-removing, as onto a retired one", async () => {
    // The contract-existence check reads living upserts minus MARKERS, so it
    // still listed the replaced id and the edge passed — to be spliced into
    // the living map calling an operation the same archive deletes.
    const p = await project({
      ...fleet(LANDSCAPE_NO_CAPTURE),
      [`${FEAT}/specs/payment-service/openapi.yaml`]: SETTLE_OVER_CAPTURE,
      [`${FEAT}/specs/payment-service/spec.md`]: restatedCapture("settlePayment"),
      [`${FEAT}/delta.likec4`]: deltaCalling("capturePayment"),
    });
    const validated = findings((await runLoam(p.workDir, "validate", "--feature", "FEAT-60", "--json")).stdout);
    const [removing, ...more] = ofCode(validated, "c4-api.op-removing");
    expect(more).toEqual([]);
    expect(removing).toMatchObject({ severity: "error" });
    expect(removing!.message).toContain("'capturePayment'");
  });
});
