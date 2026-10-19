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
import { makeProject, runLoam, type Project } from "./helpers/harness.js";

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
