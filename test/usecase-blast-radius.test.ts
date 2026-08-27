/**
 * `loam delta` and `loam status` naming the business flows a feature's services
 * are already hops of.
 *
 * Three properties are pinned here, and each of them was a wrong answer that was
 * reachable rather than a shape somebody wanted asserted.
 *
 * **The join is on endpoints, not on relationships.** A use case drawn for work
 * that has not happened yet has hops nothing in the model backs — that is what
 * `usecase.step-unbacked` is about, and it is an error precisely because the
 * fleet map has not caught up. A blast radius computed from relationships
 * reports such a flow as touching nobody, which is silence at exactly the moment
 * an implementer most needs the flow named: when their change is what is
 * supposed to end that state.
 *
 * **The load is LAZY, and the gate is measured rather than asserted.** `loam
 * delta` sits in `/loam-implement`'s inner loop, so a LikeC4 workspace spin-up
 * there is felt on every iteration. The measurement is a document that WOULD
 * fail the project load: a fleet whose `architecture/` never mentions the
 * reserved tag prefix answers "no use cases" over a broken document, which is
 * only possible if the document was never parsed. Remove the gate and the same
 * fixture answers `unreadable`.
 *
 * **Empty is never ambiguous.** An `architecture/` that does not parse produces
 * the same empty flow list as a fleet that draws nothing, and `unreadable` is
 * the only thing that tells them apart. A consumer that cannot is one field away
 * from reading "no business flow depends on this" off a directory nobody opened.
 */
import { describe, expect, it } from "vitest";
import { symlink } from "node:fs/promises";
import { join } from "node:path";
import { coherentFixture, makeProject, runLoam, type Project } from "./helpers/harness.js";

interface Flow {
  id: string;
  title?: string;
  file: string;
  tags: string[];
  steps: Array<{ ordinal: number; title?: string; source: string; target: string; services: string[] }>;
}

interface UseCasePayload {
  unreadable: boolean;
  error?: string;
  flows: Flow[];
}

/**
 * A landscape that models `payment-split-service` as an ELEMENT while no
 * `services/payment-split-service/` exists — the state a feature that
 * introduces a service is authored in, and the one the endpoint join has to
 * answer for. The element carries no `metadata { service }`, so it resolves
 * through the TITLE tier against the fleet set the caller hands in; that set is
 * `living ∪ featureServices`, which is why an introduced service resolves at
 * all.
 */
const UC_LANDSCAPE = `specification {
  element softwareSystem
  element person
  tag cap-checkout
}

model {
  customer = person 'Customer'
  checkoutWeb = softwareSystem 'checkout-web'
  paymentService = softwareSystem 'payment-service'
  paymentSplitService = softwareSystem 'payment-split-service'

  customer -> checkoutWeb 'Uses'
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
 * Three hops, and the third is the one that matters: NOTHING in the model backs
 * `checkoutWeb -> paymentSplitService`. It is the flow as it will be, drawn
 * before the feature builds it.
 */
const UC_FLOW = `views {
  dynamic view uc_checkout {
    #cap-checkout
    title 'Checkout'

    customer -> checkoutWeb 'opens the basket'
    checkoutWeb -> paymentService 'authorizes the payment'
    checkoutWeb -> paymentSplitService 'splits the payment'
  }
}
`;

/**
 * A document that CANNOT parse — `ghost` is declared nowhere — and that never
 * mentions the reserved prefix. `TAG` is spliced in by the one case that needs
 * the gate to open over the same broken file.
 */
function brokenArchitecture(tag = ""): string {
  return `specification {
  element softwareSystem
${tag}}

model {
  web = softwareSystem 'checkout-web'
  web -> ghost 'Calls a system that does not exist'
}
`;
}

function fixture(architecture: Record<string, string>): Record<string, string> {
  return { ...coherentFixture(), ...architecture };
}

async function deltaUseCases(p: Project, service: string): Promise<UseCasePayload> {
  const res = await runLoam(p.workDir, "delta", "FEAT-1", "--service", service, "--json");
  const payload = JSON.parse(res.stdout) as { useCases?: UseCasePayload };
  if (payload.useCases === undefined) throw new Error(`no useCases key in ${res.stdout}`);
  return payload.useCases;
}

async function statusUseCases(p: Project): Promise<UseCasePayload> {
  const res = await runLoam(p.workDir, "status", "FEAT-1", "--json");
  const payload = JSON.parse(res.stdout) as { useCases?: UseCasePayload };
  if (payload.useCases === undefined) throw new Error(`no useCases key in ${res.stdout}`);
  return payload.useCases;
}

describe("loam delta — the flows a service is a hop of", () => {
  it("names the flow, the file and only the hops that touch the projected service", async () => {
    const p = await makeProject(
      fixture({
        "architecture/landscape.likec4": UC_LANDSCAPE,
        "architecture/usecases/checkout.likec4": UC_FLOW,
      }),
    );
    try {
      const useCases = await deltaUseCases(p, "payment-service");
      expect(useCases.unreadable).toBe(false);
      expect(useCases.flows).toHaveLength(1);
      const flow = useCases.flows[0]!;
      expect(flow.id).toBe("uc_checkout");
      expect(flow.title).toBe("Checkout");
      expect(flow.file).toBe("architecture/usecases/checkout.likec4");
      expect(flow.tags).toContain("cap-checkout");
      // Step 2 only. Step 1 is the actor hop and step 3 is the other service:
      // a per-VIEW answer ("Checkout touches you") is not actionable, and a
      // join that reported every hop of a matching view would be exactly that.
      expect(flow.steps.map((s) => s.ordinal)).toEqual([2]);
      expect(flow.steps[0]!.title).toBe("authorizes the payment");
      expect(flow.steps[0]!.services).toEqual(["payment-service"]);
    } finally {
      await p.destroy();
    }
  });

  it("answers for a service the feature INTRODUCES, over a hop no relationship backs", async () => {
    const p = await makeProject(
      fixture({
        "architecture/landscape.likec4": UC_LANDSCAPE,
        "architecture/usecases/checkout.likec4": UC_FLOW,
      }),
    );
    try {
      // payment-split-service has no services/ directory at all — FEAT-1 is
      // what creates it — and `checkoutWeb -> paymentSplitService` is backed by
      // no relationship in the model. Both facts would silence a join built on
      // `attributeStep`, and this is the hop an implementer most needs named.
      expect(p.exists("services/payment-split-service")).toBe(false);
      const useCases = await deltaUseCases(p, "payment-split-service");
      expect(useCases.flows).toHaveLength(1);
      const steps = useCases.flows[0]!.steps;
      expect(steps.map((s) => s.ordinal)).toEqual([3]);
      expect(steps[0]!.title).toBe("splits the payment");
      expect(steps[0]!.services).toEqual(["payment-split-service"]);
    } finally {
      await p.destroy();
    }
  });

  it("prints the section for a person, and says so when no flow draws the service", async () => {
    const p = await makeProject(
      fixture({
        "architecture/landscape.likec4": UC_LANDSCAPE,
        "architecture/usecases/checkout.likec4": UC_FLOW,
      }),
    );
    try {
      const drawn = await runLoam(p.workDir, "delta", "FEAT-1", "--service", "payment-service");
      expect(drawn.stdout).toContain("Use cases (business flows this service is already a hop of):");
      expect(drawn.stdout).toContain("step 2 'authorizes the payment': checkoutWeb -> paymentService");
      // A fleet whose flows do not mention the service says so in words rather
      // than by omitting the heading: the reader must be able to tell "loam
      // looked and found nothing" from "loam did not print this section".
      await p.write("architecture/usecases/checkout.likec4", UC_FLOW.replace("checkoutWeb -> paymentService 'authorizes the payment'\n    ", ""));
      const quiet = await runLoam(p.workDir, "delta", "FEAT-1", "--service", "payment-service");
      expect(quiet.stdout).toContain("Use cases: (no declared flow draws payment-service)");
    } finally {
      await p.destroy();
    }
  });
});

describe("loam status — the flows a feature's services are hops of", () => {
  it("reports the feature's own services, joined the same way", async () => {
    const p = await makeProject(
      fixture({
        "architecture/landscape.likec4": UC_LANDSCAPE,
        "architecture/usecases/checkout.likec4": UC_FLOW,
      }),
    );
    try {
      const useCases = await statusUseCases(p);
      expect(useCases.unreadable).toBe(false);
      expect(useCases.flows).toHaveLength(1);
      // FEAT-1 touches payment-split-service alone, so step 3 is the whole
      // answer — the report narrows to what the feature is about.
      expect(useCases.flows[0]!.steps.map((s) => s.ordinal)).toEqual([3]);
    } finally {
      await p.destroy();
    }
  });
});

describe("the landscape load is lazy, and its emptiness is never ambiguous", () => {
  it("a fleet whose architecture never mentions the tag prefix is NOT parsed", async () => {
    // The document cannot parse. If `loam delta` loaded `architecture/` as a
    // project, this would come back `unreadable: true` — so `unreadable: false`
    // over this fixture is a measurement that the load did not happen, not an
    // assertion that it should not.
    const p = await makeProject(fixture({ "architecture/landscape.likec4": brokenArchitecture() }));
    try {
      const useCases = await deltaUseCases(p, "payment-split-service");
      expect(useCases.unreadable).toBe(false);
      expect(useCases.flows).toEqual([]);
      // status shares the load and therefore the gate.
      expect((await statusUseCases(p)).unreadable).toBe(false);
    } finally {
      await p.destroy();
    }
  });

  it("a document the gate cannot READ opens the gate — unreadable is never 'no tag here'", async () => {
    // The gate is a byte scan, so a document it cannot open has to count as one
    // that might mention the prefix. Answering `false` on a failed read would
    // let an unopenable file grade the fleet as having no use cases — a
    // fail-open validator wearing an optimisation's clothes.
    //
    // The dangling symlink is how that state is reached portably: `readdir`
    // reports it as a non-directory entry ending in `.likec4`, so it is IN the
    // document set, and `readFile` on it is ENOENT. The landscape beside it is
    // broken and mentions no prefix, so a gate that swallowed the read failure
    // would answer `unreadable: false` here.
    const p = await makeProject(fixture({ "architecture/landscape.likec4": brokenArchitecture() }));
    try {
      await symlink(join(p.docsDir, "architecture", "nowhere"), join(p.docsDir, "architecture", "ghost.likec4"));
      expect(await deltaUseCases(p, "payment-split-service")).toMatchObject({ unreadable: true });
    } finally {
      await p.destroy();
    }
  });

  it("the same broken document IS parsed once a use-case tag is declared, and reports a hole", async () => {
    const p = await makeProject(
      fixture({ "architecture/landscape.likec4": brokenArchitecture("  tag cap-checkout\n") }),
    );
    try {
      const useCases = await deltaUseCases(p, "payment-split-service");
      // Not "no use cases" — loam could not look, and says so. An empty `flows`
      // beside `unreadable: false` here would be a positive claim about a
      // directory nobody read.
      expect(useCases.unreadable).toBe(true);
      expect(useCases.flows).toEqual([]);
      expect(useCases.error).toBeDefined();
      expect(await statusUseCases(p)).toMatchObject({ unreadable: true, flows: [] });
    } finally {
      await p.destroy();
    }
  });
});
