/**
 * The ONE consumer index (`src/core/consumers/`) — who still calls an operation
 * or consumes a message — as its readers see it: `loam diff`'s victims, the
 * coherence gate's `openapi.remove-op-consumed` / `asyncapi.remove-message-
 * consumed`, and the archive's overwrite warnings.
 *
 * It used to be three copies kept in step by hand, and they were not in step:
 * the gate read `architecture/landscape.likec4` alone where the spine and the
 * diff read the project, the gate asked no use case, the requirement scans
 * matched a bare operationId fleet-wide, and the gate's provider and consumer
 * requirements were read off the living files even when the very feature being
 * archived rewrote them. Every case below is a reproduction from the review of
 * 2026-10-12 (or a control beside one), and each says which.
 */
import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Finding } from "../src/core/vocabulary/report.js";
import { makeProject, pinAsyncapi, pinFor, pinOpenapi, runLoam, type Project } from "./helpers/harness.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!();
});

async function project(files: Record<string, string>): Promise<Project> {
  const p = await makeProject(files);
  cleanups.push(() => p.destroy());
  return p;
}

function git(cwd: string, ...args: string[]): void {
  const res = spawnSync("git", args, { cwd, encoding: "utf8", timeout: 30_000 });
  if (res.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${res.stderr}`);
}

/** The fixture as it stands, committed as `main` — the base `loam diff --base main` reads. */
function commitBase(dir: string): void {
  git(dir, "init", "-q", "-b", "main");
  git(dir, "add", "-A");
  git(dir, "-c", "user.email=ci@test.invalid", "-c", "user.name=CI Test", "commit", "-q", "-m", "base");
}

interface DiffFinding {
  code: string;
  severity: string;
  message: string;
  details: string[];
}

/** One service's `loam diff --base main` findings. */
async function diffFindings(p: Project, id: string): Promise<DiffFinding[]> {
  const res = await runLoam(p.workDir, "diff", "--base", "main", "--json");
  const svc = (JSON.parse(res.stdout) as { services: Array<{ id: string; findings: DiffFinding[] }> }).services.find((s) => s.id === id);
  if (svc === undefined) throw new Error(`no service '${id}' in ${res.stdout}`);
  return svc.findings;
}

/** `loam validate --feature <id> --json`'s findings, flattened. */
async function featureFindings(p: Project, feature: string): Promise<Finding[]> {
  const res = await runLoam(p.workDir, "validate", "--feature", feature, "--json");
  return (JSON.parse(res.stdout) as { targets: Array<{ findings: Finding[] }> }).targets.flatMap((t) => t.findings);
}

/** `loam archive <id> --json`: the exit code and, when refused, the issues it was refused for. */
async function archive(
  p: Project,
  feature: string,
): Promise<{ code: number; issues: Array<{ code: string; message: string; details?: string[] }> }> {
  const res = await runLoam(p.workDir, "archive", feature, "--json");
  const payload = JSON.parse(res.stdout) as { issues?: Array<{ code: string; message: string; details?: string[] }> };
  return { code: res.code, issues: payload.issues ?? [] };
}

const ofCode = <T extends { code: string }>(all: readonly T[], code: string): T[] => all.filter((f) => f.code === code);

/* ------------------------------------------------------------------ */
/* The fleet: payment-service provides, checkout-web consumes          */
/* ------------------------------------------------------------------ */

/** The map file. Both services BOUND, so a box's title never decides who it is. */
const LANDSCAPE = `specification {
  element softwareSystem
  tag cap-checkout
}

model {
  checkoutWeb = softwareSystem 'checkout-web' {
    metadata { service 'checkout-web' }
  }
  paymentService = softwareSystem 'payment-service' {
    metadata { service 'payment-service' }
  }

  checkoutWeb -> paymentService 'Calls authorizePayment' {
    metadata { op 'authorizePayment' }
  }
}

views {
  view landscape {
    include *
  }
}
`;

/**
 * The map without the authorize edge, so the one relationship between the two
 * services is the capture call, and a hop between them is attributed to it
 * rather than contested between two operations.
 */
const LANDSCAPE_NO_AUTHORIZE = LANDSCAPE.replace(
  `  checkoutWeb -> paymentService 'Calls authorizePayment' {\n    metadata { op 'authorizePayment' }\n  }\n`,
  "",
);

/** A use case drawing its own capture edge — outside the map file — and one hop over it. */
const CHECKOUT_FLOW = `model {
  checkoutWeb -> paymentService 'Calls capturePayment' {
    metadata { op 'capturePayment' }
  }
}

views {
  dynamic view uc_checkout {
    #cap-checkout
    title 'Checkout'
    checkoutWeb -> paymentService 'captures the payment'
  }
}
`;

/** A second document of the `architecture/` project, drawing the capture call the map file does not. */
const CALLS = `model {
  checkoutWeb -> paymentService 'Calls capturePayment' {
    metadata { op 'capturePayment' }
  }
}
`;

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
`;

/** The provider's contract with `capturePayment` gone — what a branch removing it leaves. */
const PAYMENT_OPENAPI_NO_CAPTURE = `openapi: 3.1.0
info: { title: payment-service, version: "1.0" }
paths:
  /payments:
    post:
      operationId: authorizePayment
      responses: { "200": { description: ok } }
`;

/** checkout-web's spec: `extra` is appended under `## Requirements`. */
function checkoutSpec(extra = ""): string {
  return `---
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
${extra}`;
}

/** A checkout-web requirement whose `Operations:` line names `capturePayment`. */
const CAPTURE_AT_CHECKOUT = `
### Requirement: Capture at checkout
The UI SHALL capture the payment when the order is confirmed.

Operations: capturePayment

#### Scenario: Capture happens
- **Given** an authorized payment
- **When** the order is confirmed
- **Then** it is captured
`;

/** checkout-web's OWN contract, defining an operation it also calls `capturePayment`. */
const CHECKOUT_OPENAPI = `openapi: 3.1.0
info: { title: checkout-web, version: "1.0" }
paths:
  /checkout/card:
    post:
      operationId: capturePayment
      responses: { "200": { description: ok } }
`;

/** The arch spec of checkout-web, naming payment-service's operation from the arch axis. */
const CHECKOUT_ARCH_SPEC = `---
service: checkout-web
status: verified
---

# checkout-web — architecture spec

## Requirements

### Requirement: Capture goes through the payment gateway
The UI SHALL capture through payment-service, never a card network directly.

Operations: capturePayment

#### Scenario: Capture is delegated
- **Given** a confirmed order
- **When** the UI captures
- **Then** payment-service performs the capture
`;

function fleet(extra: Record<string, string> = {}): Record<string, string> {
  return {
    "architecture/landscape.likec4": LANDSCAPE,
    "services/payment-service/spec.md": PAYMENT_SPEC,
    "services/payment-service/openapi.yaml": PAYMENT_OPENAPI,
    "services/checkout-web/spec.md": checkoutSpec(),
    ...extra,
  };
}

/* ------------------------------------------------------------------ */
/* loam diff                                                           */
/* ------------------------------------------------------------------ */

describe("loam diff reads the one index", () => {
  /** The removal every case below makes: capturePayment leaves payment-service's contract on the branch. */
  async function removed(extra: Record<string, string>): Promise<DiffFinding[]> {
    const p = await project(fleet(extra));
    commitBase(p.docsDir);
    await p.write("services/payment-service/openapi.yaml", PAYMENT_OPENAPI_NO_CAPTURE);
    return diffFindings(p, "payment-service");
  }

  // Review finding 2's diff half: the victims' landscape was the one file, so
  // an edge in another document of the project — which the spine grades — was
  // nobody's victim and the removal read `diff.op-removed` (warn), exit 0.
  it("an edge drawn in architecture/calls.likec4 is a victim of the removal", async () => {
    const found = await removed({ "architecture/calls.likec4": CALLS });
    const [consumed, ...more] = ofCode(found, "diff.op-removed-consumed");
    expect(more).toEqual([]);
    expect(consumed!.details).toContain(`edge checkout-web → payment-service ("Calls capturePayment")`);
  });

  // Review finding 1's diff half: the requirement scan matched the bare id, so
  // checkout-web naming ITS OWN capturePayment was a victim of payment-service
  // dropping an unrelated operation that happens to share the name.
  it("another service's requirement naming the same id is no victim while its own contract defines it — and still is when it does not", async () => {
    const own = await removed({
      "services/checkout-web/spec.md": checkoutSpec(CAPTURE_AT_CHECKOUT),
      "services/checkout-web/openapi.yaml": CHECKOUT_OPENAPI,
    });
    expect(ofCode(own, "diff.op-removed-consumed")).toEqual([]);
    expect(ofCode(own, "diff.op-removed")).toEqual([expect.objectContaining({ severity: "warn" })]);

    const foreign = await removed({ "services/checkout-web/spec.md": checkoutSpec(CAPTURE_AT_CHECKOUT) });
    expect(ofCode(foreign, "diff.op-removed-consumed")[0]!.details).toContain("checkout-web's living requirement 'Capture at checkout'");
  });

  // The base/current joins (`diff.consumer-added`) read the index's rules, not
  // a restatement of them: a line naming checkout-web's OWN capturePayment is
  // no new obligation on payment-service, and a line in arch.spec.md naming
  // payment-service's is one.
  it("a new join is reported by the index's rules — ownership and both spec files", async () => {
    const p = await project(fleet({ "services/checkout-web/openapi.yaml": CHECKOUT_OPENAPI }));
    commitBase(p.docsDir);
    await p.write("services/checkout-web/spec.md", checkoutSpec(CAPTURE_AT_CHECKOUT));
    expect(ofCode(await diffFindings(p, "payment-service"), "diff.consumer-added")).toEqual([]);

    const q = await project(fleet());
    commitBase(q.docsDir);
    await q.write("services/checkout-web/arch.spec.md", CHECKOUT_ARCH_SPEC);
    expect(ofCode(await diffFindings(q, "payment-service"), "diff.consumer-added")).toEqual([
      expect.objectContaining({ message: expect.stringContaining("checkout-web's living requirements now name this service's operation 'capturePayment'") }),
    ]);
  });

  // The contract review's fourth finding: the join was suppressed whenever the
  // consumer's own openapi.yaml could not be read on the other side. But that
  // contract is read only to ask whether the line names the consumer's OWN
  // operation, and an unreadable one proves no ownership — the index counts
  // the line, so a side holding that contract cannot have hidden the join.
  it("a new join is reported though the consumer's own contract does not parse — it proves no ownership", async () => {
    const p = await project(fleet({ "services/checkout-web/openapi.yaml": "openapi: 3.1.0\npaths: [unclosed\n" }));
    commitBase(p.docsDir);
    await p.write("services/checkout-web/spec.md", checkoutSpec(CAPTURE_AT_CHECKOUT));
    expect(ofCode(await diffFindings(p, "payment-service"), "diff.consumer-added")).toEqual([
      expect.objectContaining({ message: expect.stringContaining("checkout-web's living requirements now name this service's operation 'capturePayment'") }),
    ]);
  });

  // The verification of that fix (N1): the line naming checkout-web's OWN
  // capturePayment never moved, but its openapi.yaml stopped or started
  // parsing between base and current — and on the side nobody could read,
  // ownership went unproved and the line counted as a join, while on the
  // readable side it was checkout-web's own operation. The join "appeared" or
  // "went away" off a contract's readability alone: a false
  // `diff.consumer-removed` with the contract fixed, a false
  // `diff.consumer-added` with it broken, and each counted into the summary.
  const BROKEN_OPENAPI = "openapi: 3.1.0\npaths: [unclosed\n";
  /**
   * The flicker's report: payment-service's findings and the summary — and
   * what stays true of it, asserted here: the broken contract is still
   * checkout-web's own suspended axis, and still carries the run to exit 1.
   */
  async function ownLineAcrossAFlicker(sides: { base: string; current: string }): Promise<{ found: DiffFinding[]; summary: Record<string, number> }> {
    const p = await project(fleet({
      "services/checkout-web/spec.md": checkoutSpec(CAPTURE_AT_CHECKOUT),
      "services/checkout-web/openapi.yaml": sides.base,
    }));
    commitBase(p.docsDir);
    await p.write("services/checkout-web/openapi.yaml", sides.current);
    const res = await runLoam(p.workDir, "diff", "--base", "main", "--json");
    const payload = JSON.parse(res.stdout) as {
      summary: Record<string, number>;
      services: Array<{ id: string; unreadable: Array<{ axis: string }> }>;
    };
    expect(res.code).toBe(1);
    expect(payload.services.find((s) => s.id === "checkout-web")!.unreadable).toEqual([expect.objectContaining({ axis: "openapi" })]);
    return { found: await diffFindings(p, "payment-service"), summary: payload.summary };
  }

  it("a consumer's own operation is no join that went away when its contract starts parsing", async () => {
    const { found, summary } = await ownLineAcrossAFlicker({ base: BROKEN_OPENAPI, current: CHECKOUT_OPENAPI });
    expect(ofCode(found, "diff.consumer-removed")).toEqual([]);
    expect(summary.removed).toBe(0);
  });

  it("a consumer's own operation is no join that appeared when its contract stops parsing", async () => {
    const { found, summary } = await ownLineAcrossAFlicker({ base: CHECKOUT_OPENAPI, current: BROKEN_OPENAPI });
    expect(ofCode(found, "diff.consumer-added")).toEqual([]);
    expect(summary.added).toBe(0);
  });

  // The same flicker over an id two providers define: the unreadable side
  // joined the line onto EVERY provider of it, so one contract that started
  // parsing used to read as one join gone from each — shared ids such as
  // `healthCheck` are the common case, not the exotic one.
  it("a shared id's flicker is no join on any provider of it", async () => {
    const health = (title: string): string =>
      `openapi: 3.1.0\ninfo: { title: ${title}, version: "1.0" }\npaths:\n  /health:\n    get:\n      operationId: healthCheck\n      responses: { "200": { description: ok } }\n`;
    const p = await project({
      ...fleet({
        "architecture/landscape.likec4": LANDSCAPE.replace(
          "\n}\n\nviews {",
          "\n  orderService = softwareSystem 'order-service' {\n    metadata { service 'order-service' }\n  }\n}\n\nviews {",
        ),
        "services/payment-service/openapi.yaml": PAYMENT_OPENAPI.replace("paths:\n", `paths:\n  /health:\n    get:\n      operationId: healthCheck\n      responses: { "200": { description: ok } }\n`),
        "services/order-service/spec.md": checkoutSpec().replace(/checkout-web/g, "order-service"),
        "services/order-service/openapi.yaml": health("order-service"),
        "services/checkout-web/spec.md": checkoutSpec(CAPTURE_AT_CHECKOUT.replace("capturePayment", "healthCheck")),
        "services/checkout-web/openapi.yaml": BROKEN_OPENAPI,
      }),
    });
    commitBase(p.docsDir);
    await p.write("services/checkout-web/openapi.yaml", health("checkout-web"));
    const removedOn = async (provider: string): Promise<string[]> =>
      ofCode(await diffFindings(p, provider), "diff.consumer-removed").map((f) => f.message);
    expect({ payment: await removedOn("payment-service"), order: await removedOn("order-service") }).toEqual({ payment: [], order: [] });
  });

  // The control the skip must not swallow: the contract breaks on the side
  // that holds the join, but the readable side proves no ownership either — it
  // defines no such id — so the join is the line's, and it is reported.
  it("a join beside a contract that stopped parsing is still reported when the other side proves no ownership", async () => {
    const p = await project(fleet({ "services/checkout-web/openapi.yaml": CHECKOUT_OPENAPI.replace("capturePayment", "getCart") }));
    commitBase(p.docsDir);
    await p.write("services/checkout-web/openapi.yaml", BROKEN_OPENAPI);
    await p.write("services/checkout-web/spec.md", checkoutSpec(CAPTURE_AT_CHECKOUT));
    expect(ofCode(await diffFindings(p, "payment-service"), "diff.consumer-added")).toEqual([
      expect.objectContaining({ message: expect.stringContaining("checkout-web's living requirements now name this service's operation 'capturePayment'") }),
    ]);
  });

  // An arch.spec.md `Operations:` line naming another service's operation is
  // the dependency `loam dependencies` reads off both spec files; the victim
  // scan read spec.md alone and called the removal unconsumed.
  it("an arch.spec.md Operations: line naming the operation is a victim", async () => {
    const found = await removed({ "services/checkout-web/arch.spec.md": CHECKOUT_ARCH_SPEC });
    expect(ofCode(found, "diff.op-removed-consumed")[0]!.details).toContain(
      "checkout-web's living requirement 'Capture goes through the payment gateway'",
    );
  });
});

/* ------------------------------------------------------------------ */
/* The operation gate: openapi.remove-op-consumed                      */
/* ------------------------------------------------------------------ */

const FEAT = "features/FEAT-60-settle";
const INTENT = { [`${FEAT}/intent.md`]: "# Settle\n\nCapture is renamed to settlement.\n" };

/** `settlePayment` defined where `capturePayment` lives, pinned as `loam rebase` writes it — the review's rename. */
const SETTLE_OVER_CAPTURE = {
  [`${FEAT}/specs/payment-service/openapi.yaml`]: pinOpenapi(
    `openapi: 3.1.0
paths:
  /payments/capture:
    post:
      operationId: settlePayment
      responses: { "200": { description: settled } }
`,
    PAYMENT_OPENAPI,
  ),
};

/** payment-service's capture requirement restated to name `settlePayment` — what a rename owes its own governor. */
const RESTATED_CAPTURE = {
  [`${FEAT}/specs/payment-service/spec.md`]: `# payment-service — delta for FEAT-60

## MODIFIED Requirements

### Requirement: Capture a payment
Based-On: ${pinFor(PAYMENT_SPEC, "Capture a payment")}
The service SHALL settle an authorized payment.

Operations: settlePayment

#### Scenario: Successful settlement
- **Given** an authorized payment
- **When** settlement is requested
- **Then** the funds are captured
`,
};

/** A marker retirement of `capturePayment`, justified by the REMOVED requirement it owes. */
const RETIRE_CAPTURE = {
  [`${FEAT}/specs/payment-service/openapi.yaml`]: `openapi: 3.1.0
paths:
  /payments/capture:
    post:
      operationId: capturePayment
      x-loam-remove: true
`,
  [`${FEAT}/specs/payment-service/spec.md`]: `# payment-service — delta for FEAT-60

## REMOVED Requirements

### Requirement: Capture a payment
Based-On: ${pinFor(PAYMENT_SPEC, "Capture a payment")}

Operations: capturePayment
`,
};

/** The one `openapi.remove-op-consumed` a feature draws, or undefined. */
async function consumedIssue(p: Project): Promise<Finding | undefined> {
  const found = ofCode(await featureFindings(p, "FEAT-60"), "openapi.remove-op-consumed");
  expect(found.length).toBeLessThanOrEqual(1);
  return found[0];
}

describe("openapi.remove-op-consumed reads the one index", () => {
  // Review finding 1: the rename was refused for "checkout-web's living
  // requirement 'Capture at checkout'" — checkout-web's OWN capturePayment, at
  // POST /checkout/card — and `--approve` was the only way past a fleet that
  // `validate --all` called clean before and after.
  it("another service's requirement naming the same id is no consumer while its own contract defines it — and still is when it does not", async () => {
    const own = await project({
      ...fleet({
        "services/checkout-web/spec.md": checkoutSpec(CAPTURE_AT_CHECKOUT),
        "services/checkout-web/openapi.yaml": CHECKOUT_OPENAPI,
      }),
      ...INTENT,
      ...SETTLE_OVER_CAPTURE,
      ...RESTATED_CAPTURE,
    });
    expect(await consumedIssue(own)).toBeUndefined();
    const archived = await archive(own, "FEAT-60");
    expect(archived.code, JSON.stringify(archived.issues)).toBe(0);

    const foreign = await project({
      ...fleet({ "services/checkout-web/spec.md": checkoutSpec(CAPTURE_AT_CHECKOUT) }),
      ...INTENT,
      ...SETTLE_OVER_CAPTURE,
      ...RESTATED_CAPTURE,
    });
    expect((await consumedIssue(foreign))!.message).toContain("still consumed — checkout-web's living requirement 'Capture at checkout'.");
  });

  // Review finding 2: the edge consumers came off `landscape.likec4` alone, so
  // the overwrite archived at exit 0 and the next `validate --all` reported
  // `spine.op-undefined` on the edge in calls.likec4.
  it("an edge drawn in architecture/calls.likec4 is a consumer", async () => {
    const p = await project({ ...fleet({ "architecture/calls.likec4": CALLS }), ...INTENT, ...SETTLE_OVER_CAPTURE, ...RESTATED_CAPTURE });
    expect((await consumedIssue(p))!.message).toContain(`still consumed — edge checkout-web → payment-service ("Calls capturePayment").`);
    expect((await archive(p, "FEAT-60")).code).toBe(1);
  });

  // The use-case half the gate never asked: a flow's hop onto the operation,
  // backed by an edge drawn outside the map file, so the gate that read
  // landscape.likec4 alone saw neither and archived at exit 0.
  it("a use-case hop onto the operation is named, after the edge that backs it", async () => {
    const p = await project({
      ...fleet({
        "architecture/landscape.likec4": LANDSCAPE_NO_AUTHORIZE,
        "architecture/usecases/checkout.likec4": CHECKOUT_FLOW,
      }),
      ...INTENT,
      ...SETTLE_OVER_CAPTURE,
      ...RESTATED_CAPTURE,
    });
    const message = (await consumedIssue(p))!.message;
    expect(message).toContain(
      `still consumed — edge checkout-web → payment-service ("Calls capturePayment"); use case 'uc_checkout' step 1 'captures the payment' (architecture/usecases/checkout.likec4).`,
    );
  });

  // A marker retirement used to scan OTHER services' requirements only — the
  // REMOVED requirement it owes leaves with the merge — so a SECOND requirement
  // of the provider still naming the operation archived at exit 0, and the next
  // `validate` reported `spec-api.op-undefined` against the provider itself.
  it("the provider's own requirement the merge leaves naming a retired operation is a consumer", async () => {
    const twice = PAYMENT_SPEC.replace(
      "### Requirement: Capture a payment",
      `### Requirement: Refund a capture
The service SHALL refund a captured payment on request.

Operations: capturePayment

#### Scenario: Refunded
- **Given** a captured payment
- **When** a refund is requested
- **Then** the funds are returned

### Requirement: Capture a payment`,
    );
    const p = await project({
      ...fleet({ "services/payment-service/spec.md": twice }),
      ...INTENT,
      ...RETIRE_CAPTURE,
      [`${FEAT}/specs/payment-service/spec.md`]: RETIRE_CAPTURE[`${FEAT}/specs/payment-service/spec.md`]!.replace(
        pinFor(PAYMENT_SPEC, "Capture a payment"),
        pinFor(twice, "Capture a payment"),
      ),
    });
    expect((await consumedIssue(p))!.message).toContain("after this merge — payment-service's living requirement 'Refund a capture'.");
  });

  // The contract review's second finding: `own` read both spec files, but
  // `validate` grades an `Operations:` line against its own service's contract
  // in spec.md only (`spec-api.op-undefined`), so the provider's arch.spec.md
  // line the refusal named could never break anything — and an archive that
  // passed before the one index was refused for it. Another service's
  // arch.spec.md line still counts: that one is a dependency on this contract.
  it("the provider's own arch.spec.md Operations: line is no consumer — validate never grades it", async () => {
    const p = await project({
      ...fleet({
        "services/payment-service/arch.spec.md": `---
service: payment-service
status: verified
---

# payment-service — architecture spec

## Requirements

### Requirement: Capture is idempotent
The service SHALL capture a payment at most once, whatever the retries.

Operations: capturePayment

#### Scenario: Retried capture
- **Given** a captured payment
- **When** capture is requested again
- **Then** nothing is captured twice
`,
      }),
      ...INTENT,
      ...RETIRE_CAPTURE,
    });
    expect(await consumedIssue(p)).toBeUndefined();
    const archived = await archive(p, "FEAT-60");
    expect(archived.code, JSON.stringify(archived.issues)).toBe(0);
  });

  // Review finding 5: the provider's requirements were read through the
  // archive's merge, which grades the LIVING file's Requirement-IDs too, and a
  // throw answered "no consumers" — so one malformed id elsewhere in the
  // living spec let the overwrite through at exit 0, and the next
  // `validate --all` reported `spec-api.op-undefined`.
  it("fails closed: a living spec the merge refuses to read still counts its requirements", async () => {
    const malformed = PAYMENT_SPEC.replace(
      "### Requirement: Authorize a payment\n",
      "### Requirement: Authorize a payment\nRequirement-ID: 9-bad id\n",
    );
    const p = await project({ ...fleet({ "services/payment-service/spec.md": malformed }), ...INTENT, ...SETTLE_OVER_CAPTURE });
    expect((await consumedIssue(p))!.message).toContain("still consumed — payment-service's living requirement 'Capture a payment'.");
    expect((await archive(p, "FEAT-60")).code).toBe(1);

    // And a DELTA the merge refuses — its restatement carries the malformed
    // id — reads as the living spec plus what it adds or modifies, never as
    // "no consumers": the living requirement it meant to restate still counts.
    const refused = await project({
      ...fleet(),
      ...INTENT,
      ...SETTLE_OVER_CAPTURE,
      [`${FEAT}/specs/payment-service/spec.md`]: RESTATED_CAPTURE[`${FEAT}/specs/payment-service/spec.md`]!.replace(
        "### Requirement: Capture a payment\n",
        "### Requirement: Capture a payment\nRequirement-ID: 9-bad id\n",
      ),
    });
    expect((await consumedIssue(refused))!.message).toContain("still consumed — payment-service's living requirement 'Capture a payment'.");
  });

  // Ownership is read off the contract the MERGE leaves: a feature that gives
  // checkout-web its own capturePayment makes checkout-web's line name that one,
  // and a feature that takes checkout-web's own away leaves the line naming
  // payment-service's again.
  it("ownership is the contract as the feature's merge leaves it", async () => {
    const living = checkoutSpec(CAPTURE_AT_CHECKOUT);
    const gains = await project({
      ...fleet({ "services/checkout-web/spec.md": living }),
      ...INTENT,
      ...RETIRE_CAPTURE,
      [`${FEAT}/specs/checkout-web/openapi.yaml`]: CHECKOUT_OPENAPI,
    });
    expect(await consumedIssue(gains)).toBeUndefined();

    const loses = await project({
      ...fleet({ "services/checkout-web/spec.md": living, "services/checkout-web/openapi.yaml": CHECKOUT_OPENAPI }),
      ...INTENT,
      ...RETIRE_CAPTURE,
      [`${FEAT}/specs/checkout-web/openapi.yaml`]: `openapi: 3.1.0
paths:
  /checkout/card:
    post:
      operationId: capturePayment
      x-loam-remove: true
`,
    });
    // Two findings, one per provider: checkout-web retiring its own
    // capturePayment strands its own line too. payment-service's is the one
    // this case is about.
    const onPayment = ofCode(await featureFindings(loses, "FEAT-60"), "openapi.remove-op-consumed").filter(
      (f) => f.subject === "payment-service",
    );
    expect(onPayment).toEqual([
      expect.objectContaining({ message: expect.stringContaining("checkout-web's living requirement 'Capture at checkout'") }),
    ]);
  });

  // The not_done item of the overwrite gate: a removal whose feature also
  // retires checkout-web's requirement naming the operation — the very remedy
  // the refusal gives — was still refused with that requirement listed,
  // because the scan read checkout-web's living spec.md and nothing else.
  it("a consumer requirement the same feature REMOVES, or MODIFIES to drop the id, no longer counts", async () => {
    const living = checkoutSpec(CAPTURE_AT_CHECKOUT);
    const pin = pinFor(living, "Capture at checkout");
    for (const delta of [
      `# checkout-web — delta for FEAT-60

## REMOVED Requirements

### Requirement: Capture at checkout
Based-On: ${pin}
`,
      `# checkout-web — delta for FEAT-60

## MODIFIED Requirements

### Requirement: Capture at checkout
Based-On: ${pin}
The UI SHALL hand the confirmed order to payment-service, which settles it.

#### Scenario: Settlement is delegated
- **Given** an authorized payment
- **When** the order is confirmed
- **Then** payment-service settles it
`,
    ]) {
      const p = await project({
        ...fleet({ "services/checkout-web/spec.md": living }),
        ...INTENT,
        ...RETIRE_CAPTURE,
        [`${FEAT}/specs/checkout-web/spec.md`]: delta,
      });
      expect(await consumedIssue(p)).toBeUndefined();
    }
    // The control: the same removal with checkout-web's requirement left alone.
    const kept = await project({ ...fleet({ "services/checkout-web/spec.md": living }), ...INTENT, ...RETIRE_CAPTURE });
    expect((await consumedIssue(kept))!.message).toContain("checkout-web's living requirement 'Capture at checkout'");
  });
});

/* ------------------------------------------------------------------ */
/* The message gate: asyncapi.remove-message-consumed                  */
/* ------------------------------------------------------------------ */

/** payment-service's spec with the requirement that publishes the legacy event. */
const PAYMENT_SPEC_PUBLISHING = `${PAYMENT_SPEC}
### Requirement: Legacy events
The service SHALL publish the legacy payment event.

Publishes: payment.Legacy

#### Scenario: Legacy event leaves
- **Given** a payment
- **When** it settles
- **Then** payment.Legacy is published
`;

const PAYMENT_EVENTS = `asyncapi: 3.0.0
info:
  title: payment-service events
  version: "1.0"
channels:
  legacyEvents:
    address: payment.legacy.v1
    messages:
      Legacy:
        $ref: '#/components/messages/Legacy'
operations:
  sendLegacy:
    action: send
    channel:
      $ref: '#/channels/legacyEvents'
components:
  messages:
    Legacy:
      name: payment.Legacy
      payload:
        type: object
        properties:
          paymentId:
            type: string
`;

describe("asyncapi.remove-message-consumed reads the one index", () => {
  // Review finding 3, the event twin of the overwrite's own-requirement scan:
  // the feature re-keys the message slot, so the merged contract no longer
  // sends `payment.Legacy`, and nothing else consumes it — no finding, archive
  // at exit 0, and the next `validate --all` reported
  // `spec-event.message-undefined` on payment-service's own Publishes: line.
  it("the provider's own Publishes: line the merge leaves behind a re-keyed message is named", async () => {
    const p = await project({
      ...fleet({
        "services/payment-service/spec.md": PAYMENT_SPEC_PUBLISHING,
        "services/payment-service/asyncapi.yaml": PAYMENT_EVENTS,
      }),
      ...INTENT,
      [`${FEAT}/specs/payment-service/asyncapi.yaml`]: pinAsyncapi(
        `asyncapi: 3.0.0
components:
  messages:
    Legacy:
      name: payment.LegacyV2
      payload:
        type: object
`,
        PAYMENT_EVENTS,
      ),
    });
    const [issue, ...more] = ofCode(await featureFindings(p, "FEAT-60"), "asyncapi.remove-message-consumed");
    expect(more).toEqual([]);
    expect(issue!.message).toContain("would no longer declare an action: send operation for 'payment.Legacy'");
    expect(issue!.message).toContain("still name it — payment-service's living requirement 'Legacy events'.");
    expect((await archive(p, "FEAT-60")).code).toBe(1);
  });

  // The quality review's third finding: the spine grades a `publishes` edge
  // on its SOURCE (`spine.message-undefined`), so the provider's own outbound
  // edge strands as surely as its `Publishes:` line — but `own` collected the
  // lines only, the full retirement archived at exit 0, and the next
  // `validate --all` reported `spine.message-undefined` on payment-service.
  it("the provider's own publishes edge is named, with the remedy that drops or redraws it", async () => {
    const p = await project({
      ...fleet({
        "architecture/landscape.likec4": LANDSCAPE.replace(
          "\n}\n\nviews {",
          "\n  paymentService -> checkoutWeb 'Delivers legacy events' {\n    metadata { publishes 'payment.Legacy' }\n  }\n}\n\nviews {",
        ),
        "services/payment-service/spec.md": PAYMENT_SPEC_PUBLISHING,
        "services/payment-service/asyncapi.yaml": PAYMENT_EVENTS,
      }),
      ...INTENT,
      [`${FEAT}/specs/payment-service/asyncapi.yaml`]: `asyncapi: 3.0.0
channels:
  legacyEvents:
    x-loam-remove: true
operations:
  sendLegacy:
    x-loam-remove: true
components:
  messages:
    Legacy:
      name: payment.Legacy
      x-loam-remove: true
`,
      [`${FEAT}/specs/payment-service/spec.md`]: `# payment-service — delta for FEAT-60\n\n## REMOVED Requirements\n\n### Requirement: Legacy events\nBased-On: ${pinFor(PAYMENT_SPEC_PUBLISHING, "Legacy events")}\n\nPublishes: payment.Legacy\n`,
    });
    const [issue, ...more] = ofCode(await featureFindings(p, "FEAT-60"), "asyncapi.remove-message-consumed");
    expect(more).toEqual([]);
    expect(issue!.details).toEqual([`edge payment-service → checkout-web ("Delivers legacy events")`]);
    expect(issue!.message).toContain("drop or redraw its publishes edge");
    expect((await archive(p, "FEAT-60")).code).toBe(1);
  });
});

/* ------------------------------------------------------------------ */
/* A consumer nobody could read refuses; a drawing nobody labelled not */
/* ------------------------------------------------------------------ */

describe("the removal gate fails closed on a consumer document it cannot read", () => {
  /** checkout-web's capture requirement, one prose byte outside ASCII — saved as Latin-1 it is not UTF-8. The `Operations:` line itself is plain ASCII. */
  const ACCENTED = checkoutSpec(CAPTURE_AT_CHECKOUT.replace("when the order is confirmed.", "when the order is confirmed (café)."));

  // The quality and contract reviews' first finding: the index turns a spec it
  // refuses to decode into a suspension, and the gate kept only victims and
  // `own` — so a Latin-1 spec.md still naming the operation let the removal
  // archive at exit 0, where the gate before the one index read the line and
  // refused (archive) or stopped on the unreadable file (`validate --feature`).
  it("an unreadable consumer spec.md refuses the removal, naming the file", async () => {
    const p = await project({ ...fleet(), ...INTENT, ...RETIRE_CAPTURE });
    await writeFile(join(p.docsDir, "services/checkout-web/spec.md"), Buffer.from(ACCENTED, "latin1"));
    const issue = (await consumedIssue(p))!;
    expect(issue.details).toEqual(["checkout-web — services/checkout-web/spec.md could not be read, so its requirements could not be scanned"]);
    expect(issue.message).toContain("whether the fleet would still consume it after this merge could not be checked");
    const archived = await archive(p, "FEAT-60");
    expect(archived.code).toBe(1);
    expect(ofCode(archived.issues, "openapi.remove-op-consumed")).toHaveLength(1);
  });

  // Beside a named consumer the unreadable one is still listed, after it, and
  // the refusal keeps the named consumer's sentence and remedy.
  it("an unreadable consumer beside a named one is listed after it", async () => {
    const p = await project({ ...fleet({ "architecture/calls.likec4": CALLS }), ...INTENT, ...RETIRE_CAPTURE });
    await writeFile(join(p.docsDir, "services/checkout-web/spec.md"), Buffer.from(ACCENTED, "latin1"));
    const issue = (await consumedIssue(p))!;
    expect(issue.details).toEqual([
      `edge checkout-web → payment-service ("Calls capturePayment")`,
      "checkout-web — services/checkout-web/spec.md could not be read, so its requirements could not be scanned",
    ]);
    expect(issue.message).toContain(`would still consume it after this merge — edge checkout-web → payment-service ("Calls capturePayment"). Retire each consumer`);
    expect(issue.message).toContain("Whether anything else would still consume it could not be checked either");
  });

  // The other identity a scan cannot settle: two directories claiming one
  // service id, neither of whose documents the index will pick between.
  it("a consumer id two directories claim refuses the removal, naming both", async () => {
    const p = await project({
      ...fleet({ "services/web/checkout-web/spec.md": checkoutSpec(CAPTURE_AT_CHECKOUT) }),
      ...INTENT,
      ...RETIRE_CAPTURE,
    });
    expect((await consumedIssue(p))!.details).toEqual([
      "checkout-web — claimed by services/checkout-web and services/web/checkout-web, so its documents could not be scanned",
    ]);
  });

  // The provider's own half of the same hole: an overwrite carries no marker
  // and no REMOVED requirement, so its own spec.md is the one place the old id
  // can still be governed — and before the one index the gate read it
  // (leniently on archive, or stopped on it under `validate`).
  it("the provider's own unreadable spec.md refuses an overwrite", async () => {
    const p = await project({ ...fleet(), ...INTENT, ...SETTLE_OVER_CAPTURE });
    await writeFile(
      join(p.docsDir, "services/payment-service/spec.md"),
      Buffer.from(PAYMENT_SPEC.replace("before capture.", "before capture (café)."), "latin1"),
    );
    expect((await consumedIssue(p))!.details).toEqual([
      "payment-service — services/payment-service/spec.md could not be read, so its own requirements could not be scanned",
    ]);
  });

  // The event axis asks the same index and refuses the same way.
  it("an unreadable consumer spec.md refuses a message retirement too", async () => {
    const p = await project({
      ...fleet({
        "services/payment-service/spec.md": PAYMENT_SPEC_PUBLISHING,
        "services/payment-service/asyncapi.yaml": PAYMENT_EVENTS,
      }),
      ...INTENT,
      [`${FEAT}/specs/payment-service/asyncapi.yaml`]: `asyncapi: 3.0.0\ncomponents:\n  messages:\n    Legacy:\n      name: payment.Legacy\n      x-loam-remove: true\n`,
      [`${FEAT}/specs/payment-service/spec.md`]: `# payment-service — delta for FEAT-60\n\n## REMOVED Requirements\n\n### Requirement: Legacy events\nBased-On: ${pinFor(PAYMENT_SPEC_PUBLISHING, "Legacy events")}\n\nPublishes: payment.Legacy\n`,
    });
    await writeFile(
      join(p.docsDir, "services/checkout-web/spec.md"),
      Buffer.from(checkoutSpec("\n### Requirement: Book legacy payments (café)\nThe UI SHALL show each legacy payment.\n\nConsumes: payment.Legacy\n\n#### Scenario: Shown\n- **Given** a legacy event\n- **When** it arrives\n- **Then** it is shown\n"), "latin1"),
    );
    const [issue, ...more] = ofCode(await featureFindings(p, "FEAT-60"), "asyncapi.remove-message-consumed");
    expect(more).toEqual([]);
    expect(issue!.details).toEqual(["checkout-web — services/checkout-web/spec.md could not be read, so its requirements could not be scanned"]);
  });

  // The seeded-fleet doctrine (`opConsumers`): `loam seed` draws every edge
  // without an op, so an op-less caller is a doubt about a DRAWING — `loam
  // diff` lists it as a warning's worth — and turning it into a refusal would
  // make every removal on such a fleet red. It stays out of the gate.
  it("an op-less caller does not refuse the removal", async () => {
    const opLess = LANDSCAPE.replace(
      "\n}\n\nviews {",
      "\n  checkoutWeb -> paymentService 'Calls the payment API'\n}\n\nviews {",
    );
    const p = await project({ ...fleet({ "architecture/landscape.likec4": opLess }), ...INTENT, ...RETIRE_CAPTURE });
    expect(await consumedIssue(p)).toBeUndefined();
    const archived = await archive(p, "FEAT-60");
    expect(archived.code, JSON.stringify(archived.issues)).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/* The routes the refusals name are followable                         */
/* ------------------------------------------------------------------ */

describe("the REMOVE route a refusal names can be followed", () => {
  // Review finding 4: the overwrite's message says to REMOVE the provider's
  // requirement governing the old id, and a REMOVED requirement carries the
  // Operations: line it governed — which demanded an x-loam-remove marker
  // (`openapi.remove-marker-missing`) that could not be written, because the
  // replacement already holds the slot.
  it("an overwrite whose governing requirement is REMOVED owes no removal marker, and archives", async () => {
    const p = await project({
      ...fleet(),
      ...INTENT,
      ...SETTLE_OVER_CAPTURE,
      [`${FEAT}/specs/payment-service/spec.md`]: RETIRE_CAPTURE[`${FEAT}/specs/payment-service/spec.md`]!,
    });
    const found = await featureFindings(p, "FEAT-60");
    expect(ofCode(found, "openapi.remove-marker-missing")).toEqual([]);
    expect(ofCode(found, "openapi.remove-op-consumed")).toEqual([]);
    const archived = await archive(p, "FEAT-60");
    expect(archived.code, JSON.stringify(archived.issues)).toBe(0);
  });

  // The same route one service over: retiring checkout-web's requirement that
  // names payment-service's operation, Operations: line kept as SCHEMA has a
  // REMOVED requirement carry it, demanded a marker in checkout-web's own
  // contract for an operation checkout-web never defined.
  it("a consumer's REMOVED requirement naming another service's operation owes that service no marker", async () => {
    const living = checkoutSpec(CAPTURE_AT_CHECKOUT);
    const p = await project({
      ...fleet({ "services/checkout-web/spec.md": living }),
      ...INTENT,
      ...RETIRE_CAPTURE,
      [`${FEAT}/specs/checkout-web/spec.md`]: `# checkout-web — delta for FEAT-60

## REMOVED Requirements

### Requirement: Capture at checkout
Based-On: ${pinFor(living, "Capture at checkout")}

Operations: capturePayment
`,
    });
    const found = await featureFindings(p, "FEAT-60");
    expect(ofCode(found, "openapi.remove-marker-missing")).toEqual([]);
    expect(ofCode(found, "openapi.remove-op-consumed")).toEqual([]);
  });

  // The contract review's third finding: the two exemptions above are facts
  // about a contract loam READ — an id it does not define, an address the
  // delta already holds. A living openapi.yaml that does not parse is neither:
  // it proves no exemption, so the marker stays owed, as it was before either
  // exemption existed. Skipping it let a REMOVED requirement with no marker
  // pass `validate --feature` at exit 0.
  it("a REMOVED requirement still owes its marker when the living contract does not parse", async () => {
    const p = await project({
      ...fleet({ "services/payment-service/openapi.yaml": "openapi: 3.1.0\npaths: [unclosed\n" }),
      ...INTENT,
      [`${FEAT}/specs/payment-service/spec.md`]: RETIRE_CAPTURE[`${FEAT}/specs/payment-service/spec.md`]!,
    });
    expect(ofCode(await featureFindings(p, "FEAT-60"), "openapi.remove-marker-missing")).toEqual([
      expect.objectContaining({ subject: "payment-service", message: expect.stringContaining("REMOVED requirement governs 'capturePayment'") }),
    ]);
    expect((await archive(p, "FEAT-60")).code).toBe(1);
  });

  // The event twin: re-keying the slot takes `payment.Legacy` out with no
  // marker and leaves no key a marker could stand on, so REMOVING the
  // requirement that publishes it — the route asyncapi.remove-message-consumed
  // names — drew asyncapi.remove-marker-missing instead.
  it("a re-keyed message whose publishing requirement is REMOVED owes no removal marker, and archives", async () => {
    const p = await project({
      ...fleet({
        "services/payment-service/spec.md": PAYMENT_SPEC_PUBLISHING,
        "services/payment-service/asyncapi.yaml": PAYMENT_EVENTS,
      }),
      ...INTENT,
      [`${FEAT}/specs/payment-service/asyncapi.yaml`]: pinAsyncapi(
        `asyncapi: 3.0.0
components:
  messages:
    Legacy:
      name: payment.LegacyV2
      payload:
        type: object
`,
        PAYMENT_EVENTS,
      ),
      [`${FEAT}/specs/payment-service/spec.md`]: `# payment-service — delta for FEAT-60

## REMOVED Requirements

### Requirement: Legacy events
Based-On: ${pinFor(PAYMENT_SPEC_PUBLISHING, "Legacy events")}

Publishes: payment.Legacy
`,
    });
    const found = await featureFindings(p, "FEAT-60");
    expect(ofCode(found, "asyncapi.remove-marker-missing")).toEqual([]);
    expect(ofCode(found, "asyncapi.remove-message-consumed")).toEqual([]);
    const archived = await archive(p, "FEAT-60");
    expect(archived.code, JSON.stringify(archived.issues)).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/* One answer: the gate and the diff agree                             */
/* ------------------------------------------------------------------ */

describe("the archive gate and loam diff name the same consumers", () => {
  // The point of one index. The gate's refusal and the diff's victims used to
  // come from two copies that read different documents — so a removal the gate
  // called unconsumed could be `diff.op-removed-consumed` on the very pull
  // request that archived it, and the reverse.
  it("on one tree, the refusal's consumers are the diff's victims of the same removal once it is archived", async () => {
    const p = await project({
      ...fleet({
        // The map without the authorize edge, so the flow's one hop is
        // attributed to the capture call rather than contested.
        "architecture/landscape.likec4": LANDSCAPE_NO_AUTHORIZE,
        "architecture/usecases/checkout.likec4": CHECKOUT_FLOW,
        "services/checkout-web/arch.spec.md": CHECKOUT_ARCH_SPEC,
      }),
      ...INTENT,
      ...RETIRE_CAPTURE,
    });
    commitBase(p.docsDir);

    const refused = await archive(p, "FEAT-60");
    expect(refused.code).toBe(1);
    const [gate, ...more] = ofCode(refused.issues, "openapi.remove-op-consumed");
    expect(more).toEqual([]);
    expect(gate!.details).toEqual([
      `edge checkout-web → payment-service ("Calls capturePayment")`,
      "checkout-web's living requirement 'Capture goes through the payment gateway'",
      "use case 'uc_checkout' step 1 'captures the payment' (architecture/usecases/checkout.likec4)",
    ]);

    const approved = await runLoam(p.workDir, "archive", "FEAT-60", "--approve", "--json");
    expect(approved.code, approved.out).toBe(0);
    const [victims, ...others] = ofCode(await diffFindings(p, "payment-service"), "diff.op-removed-consumed");
    expect(others).toEqual([]);
    expect(victims!.details).toEqual(gate!.details);
  });
});

describe("the message gate and loam diff name the same consumers", () => {
  /** checkout-web's own contract RECEIVING `payment.Legacy` — what validate requires of a consumer that declares it. */
  const CHECKOUT_RECEIVES = PAYMENT_EVENTS.replace("payment-service events", "checkout-web events")
    .replace("sendLegacy", "receiveLegacy")
    .replace("action: send", "action: receive");
  const CHECKOUT_CONSUMES = `
### Requirement: Book legacy payments
The UI SHALL show each legacy payment event.

Consumes: payment.Legacy

#### Scenario: Shown
- **Given** a legacy event
- **When** it arrives
- **Then** it is shown
`;

  // The quality review's second finding: `loam diff` asked which other
  // services DECLARE the message and found checkout-web's own receive
  // declaration, so it said "still declared by checkout-web" (warn) — while the
  // gate refused for the same consumers, and the next `validate --all`
  // reported `spine.message-unproduced` on checkout-web, since nobody sends it.
  it("a service that only receives the message is no producer of it: the diff names the gate's consumers", async () => {
    const p = await project({
      ...fleet({
        "architecture/landscape.likec4": LANDSCAPE.replace(
          "\n}\n\nviews {",
          "\n  paymentService -> checkoutWeb 'Delivers legacy events' {\n    metadata { consumes 'payment.Legacy' }\n  }\n}\n\nviews {",
        ),
        "services/payment-service/spec.md": PAYMENT_SPEC_PUBLISHING,
        "services/payment-service/asyncapi.yaml": PAYMENT_EVENTS,
        "services/checkout-web/spec.md": checkoutSpec(CHECKOUT_CONSUMES),
        "services/checkout-web/asyncapi.yaml": CHECKOUT_RECEIVES,
      }),
      ...INTENT,
      [`${FEAT}/specs/payment-service/asyncapi.yaml`]: `asyncapi: 3.0.0\ncomponents:\n  messages:\n    Legacy:\n      name: payment.Legacy\n      x-loam-remove: true\n`,
      [`${FEAT}/specs/payment-service/spec.md`]: `# payment-service — delta for FEAT-60\n\n## REMOVED Requirements\n\n### Requirement: Legacy events\nBased-On: ${pinFor(PAYMENT_SPEC_PUBLISHING, "Legacy events")}\n\nPublishes: payment.Legacy\n`,
    });
    commitBase(p.docsDir);

    const refused = await archive(p, "FEAT-60");
    expect(refused.code).toBe(1);
    const [gate, ...more] = ofCode(refused.issues, "asyncapi.remove-message-consumed");
    expect(more).toEqual([]);
    expect(gate!.details).toEqual([
      `edge payment-service → checkout-web ("Delivers legacy events")`,
      "checkout-web's living requirement 'Book legacy payments'",
    ]);

    const approved = await runLoam(p.workDir, "archive", "FEAT-60", "--approve", "--json");
    expect(approved.code, approved.out).toBe(0);
    const found = await diffFindings(p, "payment-service");
    expect(ofCode(found, "diff.message-removed")).toEqual([]);
    const [victims, ...others] = ofCode(found, "diff.message-removed-consumed");
    expect(others).toEqual([]);
    expect(victims!.details).toEqual(gate!.details);
  });

  // The control: a service that still SENDS the message keeps it produced, so
  // the removal orphans nobody — the rule `spine.message-unproduced` grades by.
  it("a message another service still sends is not orphaned by one producer dropping it", async () => {
    const p = await project(
      fleet({
        "services/payment-service/asyncapi.yaml": PAYMENT_EVENTS,
        "services/checkout-web/spec.md": checkoutSpec(CHECKOUT_CONSUMES),
        "services/checkout-web/asyncapi.yaml": PAYMENT_EVENTS.replace("payment-service events", "checkout-web events"),
      }),
    );
    commitBase(p.docsDir);
    await p.write("services/payment-service/asyncapi.yaml", `asyncapi: 3.0.0\ninfo:\n  title: payment-service events\n  version: "1.0"\n`);
    expect(ofCode(await diffFindings(p, "payment-service"), "diff.message-removed")).toEqual([
      expect.objectContaining({ message: "message 'payment.Legacy' was removed since base; still sent by checkout-web" }),
    ]);
  });

  /*
   * The gate's half of that control (the verification of the consumer fixes,
   * N2, older than the one index): the gate counted every consumer of the
   * message "whoever its producer is", so it refused payment-service's
   * retirement over order-service's own `consumes` edge and told the author
   * to drop it — while `loam diff` called the same removal a warning ("still
   * sent by order-service") and the next `validate --all` was clean, since
   * checkout-web still has a producer. A consumer is stranded only when NO
   * service would send the message after the merge, and the gate asks that of
   * the merge, not of the living fleet: a feature retiring the message from
   * both senders must not let each pass on the other's living contract.
   */
  const ORDER_EVENTS = PAYMENT_EVENTS.replace("payment-service events", "order-service events");
  const ORDER_SPEC = PAYMENT_SPEC_PUBLISHING.replace(PAYMENT_SPEC, checkoutSpec().replace(/checkout-web/g, "order-service"));
  /** One service's own C4 model — what `validate --all` asks of every service before it calls the fleet clean. */
  const serviceModel = (id: string, variable: string): string =>
    `specification {\n  element softwareSystem\n  element container\n}\n\nmodel {\n  ${variable} = softwareSystem '${id}' {\n    api = container 'api'\n  }\n}\n\nviews {\n  view of ${variable} {\n    include *\n  }\n}\n`;
  /** Both senders, and checkout-web consuming over order-service's edge and its own `Consumes:` line. */
  function twoSenders(extra: Record<string, string | null> = {}): Record<string, string> {
    const files: Record<string, string | null> = {
      "services/payment-service/model.likec4": serviceModel("payment-service", "paymentService"),
      "services/order-service/model.likec4": serviceModel("order-service", "orderService"),
      "services/checkout-web/model.likec4": serviceModel("checkout-web", "checkoutWeb"),
      ...fleet({
        "architecture/landscape.likec4": LANDSCAPE.replace(
          "\n}\n\nviews {",
          "\n  orderService = softwareSystem 'order-service' {\n    metadata { service 'order-service' }\n  }\n" +
            "  orderService -> checkoutWeb 'Delivers legacy events' {\n    metadata { consumes 'payment.Legacy' }\n  }\n}\n\nviews {",
        ),
        "services/payment-service/spec.md": PAYMENT_SPEC_PUBLISHING,
        "services/payment-service/asyncapi.yaml": PAYMENT_EVENTS,
        "services/order-service/spec.md": ORDER_SPEC,
        "services/order-service/asyncapi.yaml": ORDER_EVENTS,
        "services/checkout-web/spec.md": checkoutSpec(CHECKOUT_CONSUMES),
        "services/checkout-web/asyncapi.yaml": CHECKOUT_RECEIVES,
      }),
      ...INTENT,
      ...extra,
    };
    return Object.fromEntries(Object.entries(files).filter((e): e is [string, string] => e[1] !== null));
  }
  /** The whole retirement of `payment.Legacy` from one sender: every slot, and the REMOVED requirement that justifies it. */
  const retireFrom = (svc: string, living: string): Record<string, string> => ({
    [`${FEAT}/specs/${svc}/asyncapi.yaml`]: `asyncapi: 3.0.0
channels:
  legacyEvents:
    x-loam-remove: true
operations:
  sendLegacy:
    x-loam-remove: true
components:
  messages:
    Legacy:
      name: payment.Legacy
      x-loam-remove: true
`,
    [`${FEAT}/specs/${svc}/spec.md`]: `# ${svc} — delta for FEAT-60\n\n## REMOVED Requirements\n\n### Requirement: Legacy events\nBased-On: ${pinFor(living, "Legacy events")}\n\nPublishes: payment.Legacy\n`,
  });
  const CONSUMERS = [
    `edge order-service → checkout-web ("Delivers legacy events")`,
    "checkout-web's living requirement 'Book legacy payments'",
  ];

  it("a message another service still sends after the merge strands no consumer: no refusal, the archive passes, and the fleet stays green", async () => {
    const p = await project(twoSenders(retireFrom("payment-service", PAYMENT_SPEC_PUBLISHING)));
    // A realistic fleet has run `loam subsystem sync`: its GENERATED views
    // files are part of the docs repo, and their absence is its own finding.
    await runLoam(p.workDir, "subsystem", "sync");
    expect(ofCode(await featureFindings(p, "FEAT-60"), "asyncapi.remove-message-consumed")).toEqual([]);
    const archived = await archive(p, "FEAT-60");
    expect(archived.code, JSON.stringify(archived.issues)).toBe(0);
    const all = await runLoam(p.workDir, "validate", "--all", "--json");
    const errors = (JSON.parse(all.stdout) as { targets: Array<{ findings: Finding[] }> }).targets
      .flatMap((t) => t.findings)
      .filter((f) => f.severity === "error");
    expect(errors).toEqual([]);
  });

  it("a feature retiring the message from both senders is refused for each — the senders are read after its merge", async () => {
    const p = await project(twoSenders({
      ...retireFrom("payment-service", PAYMENT_SPEC_PUBLISHING),
      ...retireFrom("order-service", ORDER_SPEC),
    }));
    const refusals = ofCode(await featureFindings(p, "FEAT-60"), "asyncapi.remove-message-consumed");
    expect(refusals.map((f) => [f.subject, f.details])).toEqual([
      ["order-service", CONSUMERS],
      ["payment-service", CONSUMERS],
    ]);
    expect((await archive(p, "FEAT-60")).code).toBe(1);
  });

  it("the one sender's retirement is refused as before, naming the route through another sender", async () => {
    const p = await project(twoSenders({
      ...retireFrom("payment-service", PAYMENT_SPEC_PUBLISHING),
      "services/order-service/asyncapi.yaml": null,
      "services/order-service/spec.md": checkoutSpec().replace(/checkout-web/g, "order-service"),
    }));
    const [issue, ...more] = ofCode(await featureFindings(p, "FEAT-60"), "asyncapi.remove-message-consumed");
    expect(more).toEqual([]);
    expect(issue!.details).toEqual(CONSUMERS);
    expect(issue!.message).toContain("no readable contract would still send it after this merge");
    expect(issue!.message).toContain("keep another service sending it");
    expect((await archive(p, "FEAT-60")).code).toBe(1);
  });

  // The route that refusal names, followed: production moves to order-service
  // in the same feature, whose delta CREATES its event contract. The sender is
  // read off the merge (the create branch's document), so the consumers keep
  // a producer and the retirement passes.
  it("a sender this feature adds keeps the message produced", async () => {
    const p = await project(twoSenders({
      ...retireFrom("payment-service", PAYMENT_SPEC_PUBLISHING),
      "services/order-service/asyncapi.yaml": null,
      "services/order-service/spec.md": checkoutSpec().replace(/checkout-web/g, "order-service"),
      [`${FEAT}/specs/order-service/asyncapi.yaml`]: ORDER_EVENTS,
    }));
    expect(ofCode(await featureFindings(p, "FEAT-60"), "asyncapi.remove-message-consumed")).toEqual([]);
    const archived = await archive(p, "FEAT-60");
    expect(archived.code, JSON.stringify(archived.issues)).toBe(0);
  });

  // What a second sender does NOT excuse: the provider's own documents are
  // graded against the provider's own contract — its `Publishes:` line strands
  // as `spec-event.message-undefined` whoever else sends the message — so the
  // refusal names them, and only them.
  it("a second sender does not excuse the provider's own Publishes: line", async () => {
    const p = await project(twoSenders({
      [`${FEAT}/specs/payment-service/asyncapi.yaml`]: "asyncapi: 3.0.0\noperations:\n  sendLegacy:\n    x-loam-remove: true\n",
    }));
    const [issue, ...more] = ofCode(await featureFindings(p, "FEAT-60"), "asyncapi.remove-message-consumed");
    expect(more).toEqual([]);
    expect(issue!.details).toEqual(["payment-service's living requirement 'Legacy events'"]);
    expect(issue!.message).toContain("order-service would still send it");
    expect((await archive(p, "FEAT-60")).code).toBe(1);
  });

  /*
   * A producer OUTSIDE the fleet keeps a message produced too (the
   * verification of N1–N3, D1, older than the one index): validate accepts an
   * #external element whose edge carries `metadata { publishes }` as the
   * message's producer — `spine.message-unproduced` stays quiet over it — but
   * the gate and `loam diff` counted only senders inside the fleet. So
   * retiring the message from payment-service, its only sender in the fleet,
   * was refused over checkout-web's consumers while legacy-gateway still
   * published it; after `--approve`, `loam diff` reported
   * `diff.message-removed-consumed` (exit 1); and the next `validate --all`
   * had no errors.
   */
  const GATEWAY = "\n  legacyGateway = softwareSystem 'legacy-gateway' {\n    #external\n  }\n";
  /** The fleet with legacy-gateway's edge into checkout-web carrying `metadata`, and payment-service retiring the message. */
  const gatewayFleet = (metadata: string, gateway = GATEWAY): Record<string, string> => ({
    "services/payment-service/model.likec4": serviceModel("payment-service", "paymentService"),
    "services/checkout-web/model.likec4": serviceModel("checkout-web", "checkoutWeb"),
    ...fleet({
      "architecture/landscape.likec4": LANDSCAPE.replace("  tag cap-checkout\n", "  tag cap-checkout\n  tag external\n").replace(
        "\n}\n\nviews {",
        `${gateway}  legacyGateway -> checkoutWeb 'Delivers legacy events' {\n    metadata {\n${metadata}    }\n  }\n}\n\nviews {`,
      ),
      "services/payment-service/spec.md": PAYMENT_SPEC_PUBLISHING,
      "services/payment-service/asyncapi.yaml": PAYMENT_EVENTS,
      "services/checkout-web/spec.md": checkoutSpec(CHECKOUT_CONSUMES),
      "services/checkout-web/asyncapi.yaml": CHECKOUT_RECEIVES,
    }),
    ...INTENT,
    ...retireFrom("payment-service", PAYMENT_SPEC_PUBLISHING),
  });
  const GATEWAY_PUBLISHES = "      publishes 'payment.Legacy'\n      consumes 'payment.Legacy'\n";
  const GATEWAY_CONSUMERS = [
    `edge legacy-gateway → checkout-web ("Delivers legacy events")`,
    "checkout-web's living requirement 'Book legacy payments'",
  ];

  it("an #external element still publishing the message keeps its consumers produced: no refusal, `loam diff` names it, and the fleet stays green", async () => {
    const p = await project(gatewayFleet(GATEWAY_PUBLISHES));
    await runLoam(p.workDir, "subsystem", "sync");
    commitBase(p.docsDir);
    const gate = await runLoam(p.workDir, "validate", "--feature", "FEAT-60", "--json");
    expect(gate.code, gate.out).toBe(0);
    expect(ofCode(await featureFindings(p, "FEAT-60"), "asyncapi.remove-message-consumed")).toEqual([]);
    const archived = await archive(p, "FEAT-60");
    expect(archived.code, JSON.stringify(archived.issues)).toBe(0);

    const diff = await runLoam(p.workDir, "diff", "--base", "main", "--json");
    expect(diff.code, diff.out).toBe(0);
    const found = await diffFindings(p, "payment-service");
    expect(ofCode(found, "diff.message-removed-consumed")).toEqual([]);
    expect(ofCode(found, "diff.message-removed")).toEqual([
      expect.objectContaining({ severity: "warn", message: "message 'payment.Legacy' was removed since base; still sent by legacy-gateway (#external)" }),
    ]);

    const all = await runLoam(p.workDir, "validate", "--all", "--json");
    const errors = (JSON.parse(all.stdout) as { targets: Array<{ findings: Finding[] }> }).targets
      .flatMap((t) => t.findings)
      .filter((f) => f.severity === "error");
    expect(errors).toEqual([]);
  });

  // The controls: validate's rule exactly, so an #external edge that only
  // consumes vouches for no producer, and neither does a publishing source
  // nobody tagged #external — the refusal and the diff's error stand as before.
  it.each([
    ["an #external edge that only consumes", "      consumes 'payment.Legacy'\n", GATEWAY],
    ["a publishing source not tagged #external", GATEWAY_PUBLISHES, "\n  legacyGateway = softwareSystem 'legacy-gateway'\n"],
  ])("%s keeps nothing produced: refused as before, and `loam diff` names the joins", async (_label, metadata, gateway) => {
    const p = await project(gatewayFleet(metadata, gateway));
    commitBase(p.docsDir);
    const [issue, ...more] = ofCode(await featureFindings(p, "FEAT-60"), "asyncapi.remove-message-consumed");
    expect(more).toEqual([]);
    expect(issue!.details).toEqual(GATEWAY_CONSUMERS);
    expect(issue!.message).toContain("no readable contract would still send it after this merge");
    expect(issue!.message).toContain("nor does an #external element publish it");
    expect((await archive(p, "FEAT-60")).code).toBe(1);

    const approved = await runLoam(p.workDir, "archive", "FEAT-60", "--approve", "--json");
    expect(approved.code, approved.out).toBe(0);
    const found = await diffFindings(p, "payment-service");
    expect(ofCode(found, "diff.message-removed")).toEqual([]);
    expect(ofCode(found, "diff.message-removed-consumed").map((f) => f.details)).toEqual([GATEWAY_CONSUMERS]);
  });

  // An outside producer excuses what another fleet sender excuses, and no
  // more: the provider's own `Publishes:` line still strands.
  it("an #external sender does not excuse the provider's own Publishes: line", async () => {
    const files = gatewayFleet(GATEWAY_PUBLISHES);
    files[`${FEAT}/specs/payment-service/asyncapi.yaml`] = "asyncapi: 3.0.0\noperations:\n  sendLegacy:\n    x-loam-remove: true\n";
    delete files[`${FEAT}/specs/payment-service/spec.md`];
    const p = await project(files);
    const [issue, ...more] = ofCode(await featureFindings(p, "FEAT-60"), "asyncapi.remove-message-consumed");
    expect(more).toEqual([]);
    expect(issue!.details).toEqual(["payment-service's living requirement 'Legacy events'"]);
    expect(issue!.message).toContain("legacy-gateway (#external) would still send it");
    expect((await archive(p, "FEAT-60")).code).toBe(1);
  });

  /*
   * The same outside producer while the same feature makes it a SERVICE (the
   * verification of D1, X2): a feature carrying `specs/legacy-gateway/` — its
   * C4 delta introducing the service, so `delta.service-unknown` stays quiet —
   * creates `services/legacy-gateway/` when it is archived, and from then on
   * the #external element resolves to that directory, which outranks the tag
   * (`externalProducerOf`'s guard). The gate asked the rule over the
   * directories as they stood before the merge, so it passed the retirement at
   * exit 0; after the archive `loam diff` reported
   * `diff.message-removed-consumed` (exit 1) and `validate --all`
   * `spine.message-unproduced` on checkout-web.
   */
  const ONBOARD_GATEWAY = {
    [`${FEAT}/specs/legacy-gateway/spec.md`]: `# legacy-gateway — delta for FEAT-60\n\n## ADDED Requirements\n\n### Requirement: Gateway health\nThe service SHALL answer a health probe.\n\n#### Scenario: Probed\n- **Given** the gateway\n- **When** probed\n- **Then** it answers\n`,
    [`${FEAT}/delta.likec4`]: `specification {\n  element softwareSystem\n  tag FEAT-60\n}\n\nmodel {\n  legacyGatewaySvc = softwareSystem 'legacy-gateway' {\n    #FEAT-60\n    metadata {\n      service 'legacy-gateway'\n    }\n  }\n}\n`,
  };
  /**
   * legacy-gateway publishing out of a topic nested inside it: the topic
   * resolves to its own title while no `services/legacy-gateway/` exists, and
   * to legacy-gateway once one does — so the directories the merge leaves are
   * not enough unless the resolver is rebuilt over them as well.
   */
  const NESTED_GATEWAY = "\n  legacyGateway = softwareSystem 'legacy-gateway' {\n    #external\n    events = softwareSystem 'legacy-events'\n  }\n";
  function onboarding(gateway: string): Record<string, string> {
    const files = { ...gatewayFleet(GATEWAY_PUBLISHES, gateway), ...ONBOARD_GATEWAY };
    const map = "architecture/landscape.likec4";
    if (gateway === NESTED_GATEWAY) files[map] = files[map]!.replace("legacyGateway -> checkoutWeb", "legacyGateway.events -> checkoutWeb");
    return files;
  }
  /** `validate --all`'s `spine.message-unproduced` findings — what the next run says of the consumers. */
  async function unproduced(p: Project): Promise<Finding[]> {
    const all = await runLoam(p.workDir, "validate", "--all", "--json");
    const findings = (JSON.parse(all.stdout) as { targets: Array<{ findings: Finding[] }> }).targets.flatMap((t) => t.findings);
    return ofCode(findings, "spine.message-unproduced");
  }

  // The edge is named by the living map's resolver, so the nested topic's
  // label is the topic's own until the directory exists; which label it
  // carries is not what this pins.
  it.each([
    ["drawn as one element", GATEWAY],
    ["publishing out of a topic nested inside it", NESTED_GATEWAY],
  ])("an #external producer the same feature makes a service keeps nothing produced (%s): refused, as the next diff and validate read it", async (_label, gateway) => {
    const p = await project(onboarding(gateway));
    commitBase(p.docsDir);
    const [issue, ...more] = ofCode(await featureFindings(p, "FEAT-60"), "asyncapi.remove-message-consumed");
    expect(more).toEqual([]);
    expect(issue!.details).toEqual([expect.stringMatching(/^edge legacy-\w+ → checkout-web \("Delivers legacy events"\)$/), GATEWAY_CONSUMERS[1]]);
    expect(issue!.message).toContain("no readable contract would still send it after this merge");
    expect(issue!.message).toContain("nor does an #external element publish it");
    // …while the living map draws one, so the route says why it stops counting.
    expect(issue!.message).toContain("one whose element this feature's specs/<service>/ makes a service no longer counts");
    expect((await archive(p, "FEAT-60")).code).toBe(1);

    const approved = await runLoam(p.workDir, "archive", "FEAT-60", "--approve", "--json");
    expect(approved.code, approved.out).toBe(0);
    const found = await diffFindings(p, "payment-service");
    expect(ofCode(found, "diff.message-removed")).toEqual([]);
    expect(ofCode(found, "diff.message-removed-consumed")).toHaveLength(1);
    expect((await unproduced(p)).map((f) => f.subject)).toEqual(["checkout-web"]);
  });

  // The route that refusal names, followed: the onboarded service sends the
  // message from its own contract, created in this feature's delta, so the
  // consumers keep a producer after the merge and the retirement archives.
  it("the onboarded service sending the message from its own new contract keeps it produced", async () => {
    const p = await project({
      ...onboarding(GATEWAY),
      [`${FEAT}/specs/legacy-gateway/asyncapi.yaml`]: PAYMENT_EVENTS.replace("payment-service events", "legacy-gateway events"),
    });
    expect(ofCode(await featureFindings(p, "FEAT-60"), "asyncapi.remove-message-consumed")).toEqual([]);
    const archived = await archive(p, "FEAT-60");
    expect(archived.code, JSON.stringify(archived.issues)).toBe(0);
    expect(await unproduced(p)).toEqual([]);
  });

  // Its control: the same onboarding retiring nothing. payment-service still
  // sends the message, so the gate has nothing to refuse, the archive passes
  // and the next run leaves no consumer unproduced — the refusal above is the
  // retirement's, never the onboarding's.
  it("the same onboarding without the retirement strands nobody: it archives, and no consumer is left unproduced", async () => {
    const files = onboarding(GATEWAY);
    delete files[`${FEAT}/specs/payment-service/asyncapi.yaml`];
    delete files[`${FEAT}/specs/payment-service/spec.md`];
    const p = await project(files);
    expect(ofCode(await featureFindings(p, "FEAT-60"), "asyncapi.remove-message-consumed")).toEqual([]);
    const archived = await archive(p, "FEAT-60");
    expect(archived.code, JSON.stringify(archived.issues)).toBe(0);
    expect(await unproduced(p)).toEqual([]);
  });
});
