/**
 * `loam diff --base` naming the BUSINESS FLOW a removal breaks.
 *
 * The two codes here are old (`diff.op-removed-consumed`,
 * `diff.message-removed-consumed`) and so is their severity; what is new is a
 * third source feeding their `details[]` — the hops of the fleet's
 * capability-tagged `dynamic view`s (`core/usecases/operations.ts`). An edge
 * victim tells a reviewer which line of a diagram to open and a requirement
 * victim tells them whose spec to open; only "step 1 of Checkout stops working"
 * tells them what actually breaks.
 *
 * Every case below is a WRONG ANSWER that was reachable rather than a shape
 * assertion, and the two that matter most are the ones about restraint:
 *
 *  - a CONTESTED hop must never be reported as a victim. loam does not know
 *    which operation such a hop exercises, so claiming the flow breaks would put
 *    a guess inside an error-severity finding on somebody's pull request — and a
 *    guessed victim reads exactly like a real one. It rides as a SUSPENSION
 *    instead, which is the shape `ConsumerScan` already has for "nobody could
 *    answer".
 *  - an UNTAGGED `dynamic view` must contribute nothing. The `#cap-` opt-in is
 *    what lets the axis ship into a fleet that already has diagrams, and a
 *    victim scan that ignored it would grade somebody's hand-drawn sequence as a
 *    contract consumer.
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import {
  LIVING_ASYNCAPI,
  LIVING_OPENAPI,
  LIVING_SPEC,
  makeProject,
  runLoam,
  type Project,
} from "./helpers/harness.js";

function git(cwd: string, ...args: string[]): void {
  const res = spawnSync("git", args, { cwd, encoding: "utf8", timeout: 30_000 });
  if (res.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${res.stderr}`);
}

function commitBase(dir: string): void {
  git(dir, "init", "-q", "-b", "main");
  git(dir, "add", "-A");
  git(dir, "-c", "user.email=uc@test.invalid", "-c", "user.name=UC Test", "commit", "-q", "-m", "base");
}

interface JsonFinding {
  code: string;
  severity: string;
  message: string;
  details: string[];
}

interface JsonDiff {
  services?: Array<{ id: string; findings: JsonFinding[] }>;
  breaking?: boolean;
}

async function findingsFor(p: Project, id: string): Promise<JsonFinding[]> {
  const res = await runLoam(p.workDir, "diff", "--base", "main", "--json");
  const payload = JSON.parse(res.stdout) as JsonDiff;
  const svc = payload.services?.find((s) => s.id === id);
  if (svc === undefined) throw new Error(`no service '${id}' in ${res.stdout}`);
  return svc.findings;
}

/**
 * The landscape every fixture here shares: the provider drawn as a CONTAINER, so
 * a hop into `paymentService.api` has to resolve through the enumerated fleet to
 * `payment-service` before it can be filed against the removal. `tag
 * cap-checkout` is declared here because LikeC4 refuses an undeclared tag and one
 * `specification` block serves the whole project.
 *
 * `EXTRA` is spliced into `model { }` so one case can add the second edge that
 * makes a hop contested.
 */
function landscape(extra = ""): string {
  return `specification {
  element softwareSystem
  element container
  element topic
  tag cap-checkout
}

model {
  checkoutWeb = softwareSystem 'checkout-web' {
    metadata { service 'checkout-web' }
  }
  notifier = softwareSystem 'notification-service' {
    metadata { service 'notification-service' }
  }
  paymentService = softwareSystem 'payment-service' {
    metadata { service 'payment-service' }
    api = container 'api'
    events = topic 'payment events'
  }

  checkoutWeb -> paymentService.api 'Calls authorizePayment' {
    metadata { op 'authorizePayment' }
  }
  paymentService.events -> notifier 'Delivers the confirmation' {
    metadata { consumes 'payment.Authorized' }
  }
  // A SECOND service defining an operation of the same name. operationIds are
  // per-service, so a hop exercising notification-service's authorizePayment is
  // no victim of payment-service dropping its own — the join has to be by
  // provider as well as by name, and without this edge nothing would notice.
  checkoutWeb -> notifier 'Calls authorizePayment' {
    metadata { op 'authorizePayment' }
  }
${extra}}

views {
  view landscape {
    include *
  }
}
`;
}

/** One use case over the landscape above. `TAG` is the whole opt-in, so one case drops it. */
function useCase(tag = "    #cap-checkout\n"): string {
  return `views {
  dynamic view uc_checkout {
${tag}    title 'Checkout'

    checkoutWeb -> paymentService.api 'authorizes the payment'
    paymentService.events -> notifier 'confirms the order'
    checkoutWeb -> notifier 'authorizes the reminder'
  }
}
`;
}

/** A consumer with a spec of its own that names nobody else's operations. */
const NOTIFIER_SPEC = `---
service: notification-service
status: draft
---

# notification-service

## Requirements

### Requirement: Send a confirmation
The service SHALL send exactly one confirmation per placed order.

#### Scenario: One confirmation
- **Given** a placed order
- **When** the event arrives
- **Then** one confirmation is sent
`;

/** The provider's contract with `authorizePayment` gone — the removal every case makes. */
const OP_REMOVED = `openapi: 3.1.0
info:
  title: payment-service
  version: "1.0"
paths: {}
`;

/**
 * The provider's contract with a SECOND operation nothing in the fleet names —
 * the base state for the case that removes an operation no hop is a candidate
 * for.
 */
const TWO_OPS = `${LIVING_OPENAPI}  /payments/capture:
    post:
      operationId: capturePayment
      summary: Capture a payment
      responses:
        "200":
          description: Captured
          content:
            application/json:
              schema:
                type: object
                properties:
                  status:
                    type: string
`;

/** The provider's event contract with `payment.Authorized` gone. */
const MESSAGE_REMOVED = `asyncapi: 3.0.0
info:
  title: payment-service events
  version: "1.0"
`;

function fixture(extra = "", tag?: string): Record<string, string> {
  return {
    "architecture/landscape.likec4": landscape(extra),
    "architecture/usecases/checkout.likec4": tag === undefined ? useCase() : useCase(tag),
    "services/payment-service/spec.md": LIVING_SPEC,
    "services/payment-service/openapi.yaml": LIVING_OPENAPI,
    "services/payment-service/asyncapi.yaml": LIVING_ASYNCAPI,
    "services/notification-service/spec.md": NOTIFIER_SPEC,
  };
}

/** Every detail line that is about hop `n` of the one use case, whatever it says about it. */
function aboutHop(finding: JsonFinding, n: number): string[] {
  return finding.details.filter((d) => d.startsWith(`use case 'uc_checkout' step ${n} `));
}

function byCode(findings: JsonFinding[], code: string): JsonFinding {
  const found = findings.find((f) => f.code === code);
  if (found === undefined) throw new Error(`no ${code} among ${findings.map((f) => f.code).join(",")}`);
  return found;
}

describe("loam diff — the use case a removal breaks", () => {
  it("an ATTRIBUTED hop into the provider is a victim, named with its view, ordinal, title and file", async () => {
    const p = await makeProject(fixture());
    try {
      commitBase(p.docsDir);
      await p.write("services/payment-service/openapi.yaml", OP_REMOVED);
      const removal = byCode(await findingsFor(p, "payment-service"), "diff.op-removed-consumed");
      expect(removal.severity).toBe("error");
      // Exactly the hop the model attributes to authorizePayment — step 1 — and
      // not step 2, which is an event hop into another service entirely.
      expect(removal.details).toContain(
        "use case 'uc_checkout' step 1 'authorizes the payment' (architecture/usecases/checkout.likec4)",
      );
      expect(aboutHop(removal, 2)).toEqual([]);
      // Nor step 3, which exercises an operation of the SAME NAME belonging to
      // another service. operationIds are per-service; a join by name alone
      // would break a flow that has nothing to do with this change.
      expect(aboutHop(removal, 3)).toEqual([]);
      // The two older victim kinds are untouched beside it: this is a third
      // source on an existing code, never a replacement for the first two.
      expect(removal.details.some((d) => d.startsWith("edge checkout-web → payment-service"))).toBe(true);
    } finally {
      await p.destroy();
    }
  });

  it("a CONTESTED hop is SUSPENDED, never a victim — loam cannot say which operation it exercises", async () => {
    // A second edge between the same pair naming a different operation is what
    // makes the hop contested. The removed op is still among the candidates, so
    // the hop is exactly the doubtful case; an op no candidate names would not
    // be doubtful at all and must stay silent (the case below).
    const contested = `  checkoutWeb -> paymentService.api 'Calls getPayment' {
    metadata { op 'getPayment' }
  }
`;
    const p = await makeProject(fixture(contested));
    try {
      commitBase(p.docsDir);
      await p.write("services/payment-service/openapi.yaml", OP_REMOVED);
      const removal = byCode(await findingsFor(p, "payment-service"), "diff.op-removed-consumed");
      const lines = aboutHop(removal, 1);
      expect(lines).toHaveLength(1);
      // One line, and it is the refusal — not the bare victim spelling. A
      // grader that treated contested as attributed would emit
      // `…checkout.likec4)` with nothing after it.
      expect(lines[0]).toContain("could not be answered");
      expect(lines[0]).toContain("authorizePayment");
      expect(lines[0]).not.toBe(
        "use case 'uc_checkout' step 1 'authorizes the payment' (architecture/usecases/checkout.likec4)",
      );
    } finally {
      await p.destroy();
    }
  });

  it("a contested hop whose candidates never name the removed operation says nothing at all", async () => {
    // The hop is contested — two edges, two operations — but neither candidate
    // names `capturePayment`, which is the operation leaving the contract. The
    // candidates ARE the relationships behind the hop, so under no reading of
    // the disagreement can it be exercising an operation none of them names:
    // suspending it would report doubt loam does not have, on every removal in
    // the fleet.
    const contested = `  checkoutWeb -> paymentService.api 'Calls getPayment' {
    metadata { op 'getPayment' }
  }
`;
    const p = await makeProject(fixture(contested));
    try {
      await p.write("services/payment-service/openapi.yaml", TWO_OPS);
      commitBase(p.docsDir);
      await p.write("services/payment-service/openapi.yaml", LIVING_OPENAPI);
      const findings = await findingsFor(p, "payment-service");
      const removal = byCode(findings, "diff.op-removed");
      expect(removal.message).toContain("capturePayment");
      expect(findings.some((f) => f.code === "diff.op-removed-consumed")).toBe(false);
      expect(findings.flatMap((f) => f.details).some((d) => d.includes("uc_checkout"))).toBe(false);
    } finally {
      await p.destroy();
    }
  });

  it("an UNTAGGED dynamic view contributes nothing — the #cap- opt-in holds on this axis too", async () => {
    // The tag is still DECLARED in the landscape's specification block, so the
    // fleet's documents do mention the prefix and the project is loaded. What
    // changed is that the view does not carry it: a hand-drawn sequence is not
    // a use case, and no victim may be derived from one.
    const p = await makeProject(fixture("", ""));
    try {
      commitBase(p.docsDir);
      await p.write("services/payment-service/openapi.yaml", OP_REMOVED);
      const removal = byCode(await findingsFor(p, "payment-service"), "diff.op-removed-consumed");
      expect(removal.details.some((d) => d.includes("use case"))).toBe(false);
      // The edge victim still fires, which is what proves the scan ran at all
      // rather than the fixture being broken.
      expect(removal.details.some((d) => d.startsWith("edge checkout-web → payment-service"))).toBe(true);
    } finally {
      await p.destroy();
    }
  });

  it("an architecture/ that does not parse invents neither a victim nor a doubt", async () => {
    // `core/diff/victims.ts`'s standing doctrine for the landscape, applied to
    // the use-case axis: an unreadable fleet map proves nothing either way.
    // Inventing victims out of a parse error would point the reviewer at a file
    // their change never touched, and inventing SUSPENSIONS out of it would
    // downgrade every clean removal in the fleet to "could not be answered"
    // over a defect `validate` already reports as `landscape.invalid`.
    const p = await makeProject({ ...fixture(), "architecture/usecases/checkout.likec4": `views {
  dynamic view uc_checkout {
    #cap-checkout
    checkoutWeb -> ghost 'talks to a system that does not exist'
  }
}
` });
    try {
      commitBase(p.docsDir);
      await p.write("services/payment-service/openapi.yaml", OP_REMOVED);
      const findings = await findingsFor(p, "payment-service");
      const removal = byCode(findings, "diff.op-removed-consumed");
      // The edge and requirement victims still stand — they come off
      // `landscape.likec4`, which parses on its own — and no line anywhere in
      // the report mentions a use case at all.
      expect(removal.details.some((d) => d.startsWith("edge checkout-web → payment-service"))).toBe(true);
      expect(findings.flatMap((f) => f.details).some((d) => d.includes("use case"))).toBe(false);
    } finally {
      await p.destroy();
    }
  });

  it("a removed MESSAGE names the hop backed by the consumes-edge", async () => {
    const p = await makeProject(fixture());
    try {
      commitBase(p.docsDir);
      await p.write("services/payment-service/asyncapi.yaml", MESSAGE_REMOVED);
      const removal = byCode(await findingsFor(p, "payment-service"), "diff.message-removed-consumed");
      expect(removal.details).toContain(
        "use case 'uc_checkout' step 2 'confirms the order' (architecture/usecases/checkout.likec4)",
      );
      expect(aboutHop(removal, 1)).toEqual([]);
    } finally {
      await p.destroy();
    }
  });
});
