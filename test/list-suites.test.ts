/**
 * `loam list suites` — which use cases run together, and which services must be
 * up for them.
 *
 * Every case here is a wrong answer that was reachable. A suite whose
 * environment silently drops a participant comes up short and fails against
 * something nobody was told to start; a journey in no suite is absent from
 * every per-suite line, the one absence a per-suite output cannot show; a typo
 * in a suite name that answered with an empty environment would read as a suite
 * that needs nothing. And a view tagged ONLY `#suite-` is a use case — the
 * owner's call — so the byte gate in front of every reader has to open on a
 * `#suite-` reference as well, or the listing would answer "no suites" about a
 * fleet nobody read.
 *
 * Through the real CLI over a real LikeC4 project, as the rest of the use-case
 * axis is, because what is unpinned without this file is the path from a parsed
 * view to a payload: the gate, the resolver, the grouping and the refusals.
 */
import { describe, expect, it } from "vitest";
import { makeProject, runLoam, type Project } from "./helpers/harness.js";

interface ViewRef {
  id: string;
  file: string;
}

interface SuiteRow {
  name: string;
  views: ViewRef[];
  services: string[];
  unresolved: Array<{ element: string; external: boolean }>;
}

interface SuitesPayload {
  ok: boolean;
  command: string;
  suites?: SuiteRow[];
  ungrouped?: ViewRef[];
  useCases?: { state: string; unreadable: boolean; error?: string };
  error?: { code: string; message: string };
}

/**
 * One map with every participant shape the union has to place: a service
 * bound by metadata, a service drawn as containers (the step names
 * `orders.api`), a person, an `#external` system whose CONTAINER is the
 * endpoint, and a topic that is `#external` through its KIND rather than its
 * own tags.
 *
 * Deliberately free of the bytes `cap-` and `req-`: the first case below
 * measures that a `#suite-` reference alone opens the gate, and a `#cap-` or
 * `#req-` one anywhere in `architecture/` would open it for the wrong reason.
 * (The gate reads `#` references, so the bare substrings would no longer open
 * it; the fixture predates that and stays free of them anyway.)
 */
const LANDSCAPE = `specification {
  element service
  element container
  element person
  element topic {
    #external
  }
  tag external
  tag suite-smoke
  tag suite-payments
}

model {
  customer = person 'Customer'
  web = service 'checkout-web' {
    metadata { service 'checkout-web' }
  }
  payments = service 'payment-service' {
    metadata { service 'payment-service' }
  }
  orders = service 'order-service' {
    metadata { service 'order-service' }
    api = container 'api'
  }
  stripe = service 'Stripe' {
    #external
    api = container 'api'
  }
  events = topic 'order-events'

  customer -> web 'Uses'
  web -> payments 'Calls authorizePayment' {
    metadata { op 'authorizePayment' }
  }
  web -> orders.api 'Places the order' {
    metadata { op 'createOrder' }
  }
  payments -> stripe.api 'Charges the card'
  orders -> events 'Announces the order'
}
`;

function spec(service: string): string {
  return `---\nservice: ${service}\n---\n\n# ${service}\n`;
}

/** A `views { }` file holding one dynamic view with these tags. */
function usecase(id: string, tags: string[], steps: string): string {
  return `views {\n  dynamic view ${id} {\n${tags.map((t) => `    #${t}\n`).join("")}${steps}  }\n}\n`;
}

const CHECKOUT = usecase(
  "uc_checkout",
  ["suite-smoke", "suite-payments"],
  "    customer -> web 'places the order'\n    web -> payments 'authorizes'\n    payments -> stripe.api 'charges'\n",
);
const ORDER = usecase("uc_order", ["suite-smoke"], "    web -> orders.api 'creates'\n    orders -> events 'announces'\n");

function fleet(usecases: Record<string, string>, landscape = LANDSCAPE): Record<string, string> {
  return {
    "architecture/landscape.likec4": landscape,
    "services/checkout-web/spec.md": spec("checkout-web"),
    "services/payment-service/spec.md": spec("payment-service"),
    "services/order-service/spec.md": spec("order-service"),
    ...usecases,
  };
}

async function listed(p: Project, ...args: string[]): Promise<{ code: number; payload: SuitesPayload; out: string }> {
  const res = await runLoam(p.workDir, "list", "suites", ...args, "--json");
  return { code: res.code, payload: JSON.parse(res.stdout) as SuitesPayload, out: res.out };
}

describe("a #suite- tag alone makes a use case every reader sees", () => {
  it("lists a fleet whose only reserved tags are suites — the gate opens on `suite-`", async () => {
    // No `cap-` and no `req-` anywhere in architecture/. Before the gate took
    // the third prefix, every reader short-circuited to "no use cases" here and
    // never started LikeC4 — so the listing would have been empty, and so would
    // `loam diff`'s victims, `delta`'s blast radius and every pack.
    const p = await makeProject(fleet({ "architecture/usecases/checkout.likec4": CHECKOUT }));
    try {
      const { code, payload, out } = await listed(p);
      expect(code, out).toBe(0);
      expect(payload.useCases).toEqual({ state: "ok", unreadable: false });
      expect(payload.suites?.map((s) => s.name)).toEqual(["payments", "smoke"]);
    } finally {
      await p.destroy();
    }
  }, 60_000);

  it("an unparseable document whose only reserved mention is `suite-` reads as UNREADABLE, never as absent", async () => {
    // The use-case document does not parse on purpose: `unreadable` is
    // reachable only if the byte gate opened on `suite-` alone, so this measures
    // the scan rather than asserting it. Suites and journeys are then ABSENT
    // keys, not `[]` — the three-state rule `keptBy` follows: `[]` would be
    // "loam looked and found none", said about a project nobody could read.
    const p = await makeProject(
      fleet({ "architecture/usecases/junk.likec4": "views {\n  dynamic view uc_junk {\n    #suite-smoke\n    this is not likec4\n" }),
    );
    try {
      const { code, payload, out } = await listed(p);
      expect(code, out).toBe(0);
      expect(payload.useCases?.state).toBe("unreadable");
      expect(payload.useCases?.unreadable).toBe(true);
      expect(payload.useCases?.error).toBeTruthy();
      expect("suites" in payload).toBe(false);
      expect("ungrouped" in payload).toBe(false);

      const text = await runLoam(p.workDir, "list", "suites");
      expect(text.code, text.out).toBe(0);
      expect(text.stdout).toContain("UNKNOWN here, not none");
      // A named suite cannot be refused as unknown over a project nobody read:
      // that refusal would be a claim about suites loam never saw.
      const named = await listed(p, "smoke");
      expect(named.code, named.out).toBe(0);
      expect(named.payload.useCases?.unreadable).toBe(true);
    } finally {
      await p.destroy();
    }
  }, 60_000);
});

describe("the participant union is the test environment", () => {
  it("many-to-many membership, enumerated services, unresolved participants with #external, and journeys in no suite", async () => {
    const p = await makeProject(
      fleet(
        {
          "architecture/usecases/checkout.likec4": CHECKOUT,
          "architecture/usecases/order.likec4": ORDER,
          // A journey in NO suite: a use case through its capability tag alone.
          "architecture/usecases/refund.likec4": usecase("uc_refund", ["cap-checkout"], "    web -> payments 'refunds'\n"),
        },
        LANDSCAPE.replace("tag suite-payments", "tag suite-payments\n  tag cap-checkout"),
      ),
    );
    try {
      const { code, payload, out } = await listed(p);
      expect(code, out).toBe(0);
      expect(payload.command).toBe("list");
      expect(payload.useCases).toEqual({ state: "ok", unreadable: false });
      expect(payload.suites).toEqual([
        {
          // ONE view in two suites — the reason the group is a tag, not a directory.
          name: "payments",
          views: [{ id: "uc_checkout", file: "architecture/usecases/checkout.likec4" }],
          services: ["checkout-web", "payment-service"],
          unresolved: [
            // A person starts the flow: not a service, not external — named so a
            // stand knows it needs a driver, never dropped.
            { element: "customer", external: false },
            // The container is the endpoint and carries no tag of its own; the
            // system it is drawn inside is #external, so the stand needs a double.
            { element: "stripe.api", external: true },
          ],
        },
        {
          name: "smoke",
          views: [
            { id: "uc_checkout", file: "architecture/usecases/checkout.likec4" },
            { id: "uc_order", file: "architecture/usecases/order.likec4" },
          ],
          // `orders.api` resolves to order-service through the same resolver
          // the step grader uses — a container is not a second service.
          services: ["checkout-web", "order-service", "payment-service"],
          unresolved: [
            { element: "customer", external: false },
            // #external through the topic KIND, not through its own tags.
            { element: "events", external: true },
            { element: "stripe.api", external: true },
          ],
        },
      ]);
      expect(payload.ungrouped).toEqual([{ id: "uc_refund", file: "architecture/usecases/refund.likec4" }]);

      // The text view is the same answer in a person's words: one block per
      // suite, its services, the participants a stand cannot start, then the
      // journeys in no suite.
      const text = await runLoam(p.workDir, "list", "suites");
      expect(text.code, text.out).toBe(0);
      const lines = text.stdout.split("\n");
      const smoke = lines.findIndex((l) => l.startsWith("suite smoke"));
      expect(lines[smoke]).toBe("suite smoke — 2 use case(s), 3 service(s) must be up");
      expect(lines.slice(smoke + 1, smoke + 7)).toEqual([
        "  checkout-web",
        "  order-service",
        "  payment-service",
        "  ! customer — resolves to no service in services/",
        "  ! events — resolves to no service in services/ (#external: bring a double)",
        "  ! stripe.api — resolves to no service in services/ (#external: bring a double)",
      ]);
      expect(text.stdout).toContain("  use cases: uc_checkout, uc_order");
      expect(text.stdout).toContain("use cases in no suite (1)\n  uc_refund  architecture/usecases/refund.likec4");

      // A name narrows the SUITES and nothing else: which journeys reached no
      // suite is a fact about the fleet, and filtering it by the argument would
      // make `list suites payments` claim every journey is suited.
      const named = await listed(p, "payments");
      expect(named.code, named.out).toBe(0);
      expect(named.payload.suites?.map((s) => s.name)).toEqual(["payments"]);
      expect(named.payload.ungrouped?.map((v) => v.id)).toEqual(["uc_refund"]);

      // A typo refuses with the close name rather than answering an empty
      // environment — a suite that "needs nothing" is the wrong answer a stand
      // would be provisioned from.
      const typo = await listed(p, "smok");
      expect(typo.code).toBe(1);
      expect(typo.payload.ok).toBe(false);
      expect(typo.payload.error?.code).toBe("unknown-target");
      expect(typo.payload.error?.message).toContain("No suite 'smok'");
      expect(typo.payload.error?.message).toContain("smoke");
    } finally {
      await p.destroy();
    }
  }, 90_000);
});

describe("#external on an ancestor stops at the first element that stands for a service", () => {
  it("a service bound inside an #external zone is ours with no directory — the gate's reading, not a double", async () => {
    // `core/gate/partners.ts` walks the same ancestors and STOPS at the first
    // element bound to (or titled for) a service: what sits above it is a
    // grouping, and a grouping's `#external` is the grouping's claim, not the
    // service's. Walking past it, `list suites` told a stand to bring a double
    // for `billing` while the gate graded billing as one of ours. The tag on
    // the bound element ITSELF still counts, in both readings.
    const landscape = LANDSCAPE.replace("tag suite-payments", "tag suite-payments\n  tag suite-billing").replace(
      "  events = topic 'order-events'\n",
      "  events = topic 'order-events'\n" +
        "  zone = service 'Partner zone' {\n    #external\n    billing = service 'billing' {\n      metadata { service 'billing' }\n    }\n  }\n" +
        "  ledger = service 'ledger' {\n    #external\n    metadata { service 'ledger' }\n  }\n" +
        "  payments -> zone.billing 'Bills'\n  payments -> ledger 'Posts'\n",
    );
    const p = await makeProject(
      fleet(
        { "architecture/usecases/bill.likec4": usecase("uc_bill", ["suite-billing"], "    payments -> zone.billing 'bills'\n    payments -> ledger 'posts'\n") },
        landscape,
      ),
    );
    try {
      const { code, payload, out } = await listed(p, "billing");
      expect(code, out).toBe(0);
      expect(payload.suites?.[0]?.services).toEqual(["payment-service"]);
      expect(payload.suites?.[0]?.unresolved).toEqual([
        { element: "ledger", external: true },
        { element: "zone.billing", external: false },
      ]);
    } finally {
      await p.destroy();
    }
  }, 60_000);
});

describe("a fleet with no use cases", () => {
  it("reports the state as absent, empty lists, and refuses any named suite", async () => {
    const p = await makeProject(fleet({}));
    try {
      const { code, payload, out } = await listed(p);
      expect(code, out).toBe(0);
      expect(payload.useCases).toEqual({ state: "absent", unreadable: false });
      expect(payload.suites).toEqual([]);
      expect(payload.ungrouped).toEqual([]);

      const text = await runLoam(p.workDir, "list", "suites");
      expect(text.stdout).toContain("no use cases");

      const named = await listed(p, "smoke");
      expect(named.code).toBe(1);
      expect(named.payload.error?.code).toBe("unknown-target");
      expect(named.payload.error?.message).toContain("No suite 'smoke'");
      // Scoped to the map, because only the map's use cases are listed: a
      // `#suite-` flow drawn beside a service's model is a use case `validate`
      // grades, and "no use case carries the tag" was false about it.
      expect(named.payload.error?.message).toContain("No use case under architecture/ carries a `#suite-` tag.");
    } finally {
      await p.destroy();
    }
  }, 60_000);
});

describe("the name argument belongs to the suites section", () => {
  it("refuses a name after any other section, and the service-worklist flags with suites", async () => {
    const p = await makeProject(fleet({}));
    try {
      const res = await runLoam(p.workDir, "list", "services", "smoke", "--json");
      expect(res.code).toBe(1);
      const payload = JSON.parse(res.stdout) as SuitesPayload;
      expect(payload.error?.code).toBe("invalid-option");
      expect(payload.error?.message).toContain("suites");

      const worklist = await runLoam(p.workDir, "list", "suites", "--needs-work", "--json");
      expect(worklist.code).toBe(1);
      expect((JSON.parse(worklist.stdout) as SuitesPayload).error?.code).toBe("invalid-option");
    } finally {
      await p.destroy();
    }
  }, 60_000);
});
