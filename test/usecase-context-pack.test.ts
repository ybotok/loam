/**
 * The use-case axis where an AGENT meets it: `loam context`'s pack and
 * `loam explore --capability`'s seed set.
 *
 * Both surfaces already answered "which capability does this service realize?"
 * off the `Capability:` lines in living requirements. That answer is a label,
 * and on a brownfield fleet it is also the answer most likely to be missing: the
 * capability vocabulary is usually written long after the services are. A
 * `dynamic view` tagged `#cap-<slug>` says the same thing off a different
 * document and does not need anybody's spec.md to have caught up, which is why
 * the two are UNIONED rather than ranked.
 *
 * The pack's other obligation here is the one loam repeats everywhere: an
 * `architecture/` that does not parse must make the pack say it could not look.
 * Every flow section empties identically whether the fleet draws no use cases or
 * whether nobody could open the directory, and `useCaseScan.unreadable` is the
 * only thing that tells those apart — so it is also a HOLE, and `loam context`
 * exits 1 on it exactly as it does for an unreadable contract.
 */
import { describe, expect, it } from "vitest";
import { LIVING_OPENAPI, makeProject, runLoam, type Project } from "./helpers/harness.js";

interface Flow {
  id: string;
  title?: string;
  file: string;
  steps: Array<{ ordinal: number; title?: string; source: string; target: string; services: string[] }>;
}

interface Pack {
  capabilities?: Array<{ id: string; requirements: string[]; useCases: Array<{ id: string; file: string }> }>;
  useCaseSteps?: Flow[];
  useCaseScan?: { unreadable: boolean; error?: string };
}

/**
 * Two services, one of which — `notification-service` — realizes nothing in its
 * spec.md at all. It is in the flow and nowhere else, which is the whole point
 * of the seed union: the capability rollup cannot see it.
 */
const CHECKOUT_SPEC = `---
service: checkout-web
status: draft
---

# checkout-web

## Requirements

### Requirement: Start checkout
The UI SHALL carry the customer from cart to paid order.

Capability: checkout

#### Scenario: Pay
- **Given** a cart
- **When** the customer pays
- **Then** the order is confirmed
`;

const NOTIFIER_SPEC = `---
service: notification-service
status: draft
---

# notification-service

## Requirements

### Requirement: Confirm the order
The service SHALL send exactly one confirmation per order.

#### Scenario: One confirmation
- **Given** a confirmed order
- **When** the event arrives
- **Then** one confirmation is sent
`;

const CAPABILITIES = `capabilities:
  checkout:
    description: carry a customer from a filled cart to a confirmed, paid order
    owner: checkout-team
`;

const UC_LANDSCAPE = `specification {
  element softwareSystem
  element person
  tag cap-checkout
}

model {
  customer = person 'Customer'
  checkoutWeb = softwareSystem 'checkout-web'
  notifier = softwareSystem 'notification-service'

  customer -> checkoutWeb 'Uses'
  checkoutWeb -> notifier 'Asks for the confirmation'
}

views {
  view landscape {
    include *
  }
}
`;

const UC_FLOW = `views {
  dynamic view uc_checkout {
    #cap-checkout
    title 'Checkout'

    customer -> checkoutWeb 'opens the basket'
    checkoutWeb -> notifier 'confirms the order'
  }
}
`;

/** Unparseable — `ghost` is declared nowhere — while declaring the tag, so the gate opens. */
const BROKEN_FLOW = `views {
  dynamic view uc_checkout {
    #cap-checkout
    checkoutWeb -> ghost 'talks to a system that does not exist'
  }
}
`;

function fixture(flow: string): Record<string, string> {
  return {
    "architecture/landscape.likec4": UC_LANDSCAPE,
    "architecture/capabilities.yaml": CAPABILITIES,
    "architecture/usecases/checkout.likec4": flow,
    "services/checkout-web/spec.md": CHECKOUT_SPEC,
    "services/checkout-web/openapi.yaml": LIVING_OPENAPI,
    "services/notification-service/spec.md": NOTIFIER_SPEC,
  };
}

async function pack(p: Project, service: string): Promise<{ code: number; payload: Pack }> {
  const res = await runLoam(p.workDir, "context", service, "--json");
  return { code: res.code, payload: JSON.parse(res.stdout) as Pack };
}

describe("loam context — the flows a service is a hop of", () => {
  it("names the hops that mention the service, and the flows that claim each capability", async () => {
    const p = await makeProject(fixture(UC_FLOW));
    try {
      const { code, payload } = await pack(p, "checkout-web");
      expect(code).toBe(0);
      expect(payload.useCaseScan).toEqual({ unreadable: false });
      expect(payload.useCaseSteps).toHaveLength(1);
      const flow = payload.useCaseSteps![0]!;
      expect(flow.id).toBe("uc_checkout");
      expect(flow.file).toBe("architecture/usecases/checkout.likec4");
      // Both hops mention checkout-web — one as the callee of the actor, one as
      // the caller — so both travel. The ordinals are the author's own.
      expect(flow.steps.map((s) => s.ordinal)).toEqual([1, 2]);
      // The capability join is fleet-wide rather than narrowed to this
      // service's own hops: a reader asking what a requirement is FOR needs the
      // whole flow, not the part of it they already own.
      const capability = payload.capabilities?.find((c) => c.id === "checkout");
      expect(capability, JSON.stringify(payload.capabilities)).toBeDefined();
      expect(capability!.useCases).toEqual([
        { id: "uc_checkout", title: "Checkout", file: "architecture/usecases/checkout.likec4" },
      ]);
    } finally {
      await p.destroy();
    }
  });

  it("an architecture/ that does not parse is a HOLE: the pack says so and exits 1", async () => {
    const p = await makeProject(fixture(BROKEN_FLOW));
    try {
      const { code, payload } = await pack(p, "checkout-web");
      // `architecture/landscape.likec4` parses perfectly on its own — only the
      // PROJECT does not — so this is a hole the pack's older `landscape.parses`
      // flag cannot see, and an empty flow list beside a clean landscape is
      // exactly the silent hole `packHoles` exists to refuse.
      expect(payload.useCaseScan?.unreadable).toBe(true);
      expect(payload.useCaseScan?.error).toBeDefined();
      expect(payload.useCaseSteps).toEqual([]);
      expect(payload.capabilities?.find((c) => c.id === "checkout")?.useCases).toEqual([]);
      expect(code).toBe(1);
    } finally {
      await p.destroy();
    }
  });
});

describe("loam explore --capability — the flow's services seed too", () => {
  it("seeds a service the flow runs through even though no living requirement names the capability", async () => {
    const p = await makeProject(fixture(UC_FLOW));
    try {
      const res = await runLoam(p.workDir, "explore", "--capability", "checkout", "--json");
      const payload = JSON.parse(res.stdout) as {
        seeds?: string[];
        unknown?: Array<{ id: string }>;
        services?: Array<{ id: string; reason: string }>;
      };
      // The EXACT set, not a containment check. checkout-web comes from the
      // rollup, notification-service comes only from the flow — its spec.md
      // carries no `Capability:` line at all — and the actor `customer` comes
      // from neither, which is what an exact assertion pins and a `toContain`
      // pair would not.
      expect([...(payload.seeds ?? [])].sort()).toEqual(["checkout-web", "notification-service"]);
      expect(payload.unknown).toEqual([]);
      expect(payload.services?.find((s) => s.id === "notification-service")?.reason).toBe("seed");
    } finally {
      await p.destroy();
    }
  });
});
