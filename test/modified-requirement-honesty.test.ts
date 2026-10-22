/**
 * A MODIFIED requirement replaces the living one WHOLE — and the archive now
 * says what that takes away.
 *
 * Two silences, each pinned here by the shape that reached them:
 *
 * WHAT THE REPLACEMENT DROPS. A MODIFIED carries its full new text, so every
 * living scenario and every join-line entry (`Covers:`, `Operations:`,
 * `Publishes:` …) it does not restate is gone after the merge. The plan said
 * `~1` and nothing else, the archive exited 0, and the second scenario vanished
 * without its title being printed anywhere. The plan, `archive --json` and
 * `loam delta` now name each one (`dropped`), from the merge's own walk.
 *
 * WHAT STILL CLAIMS THE OLD WORDING. A living flow tagged `#req-<id>` keeps
 * resolving after the MODIFIED lands, so every grade of it stays green while it
 * may draw exactly what the new text forbids. `usecase.requirement-modified`
 * names the flow while the feature is open — for an `architecture/` flow scoped
 * by `#cap-` to a capability requirement, and for a flow beside a service's
 * model scoped by its directory to that service's own requirements.
 */
import { afterEach, describe, expect, it } from "vitest";
import { droppedBy } from "../src/core/document/apply.js";
import { parseRequirements } from "../src/core/document/parse.js";
import { makeProject, pinFor, runLoam, type Project } from "./helpers/harness.js";

const FEAT = "FEAT-1";
const FEAT_DIR = "features/FEAT-1-change";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!();
});

const LANDSCAPE = `specification {
  element softwareSystem
  tag cap-checkout
  tag req-CHK-ONCE
  tag req-CHK-PRICE
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

/** The living capability document: two promises, the first with two scenarios. */
const LIVING_CAPABILITY = `# Checkout

What a customer expects at checkout.

## Requirements

### Requirement: Charge once
Requirement-ID: CHK-ONCE
A customer SHALL be charged exactly once per order.

#### Scenario: One charge
- **Given** an order
- **When** it is paid
- **Then** one charge is made

#### Scenario: A retried payment
- **Given** a payment already charged
- **When** the same request arrives again
- **Then** nothing further is charged

### Requirement: Honour the price
Requirement-ID: CHK-PRICE
A customer SHALL pay the price they were shown.

#### Scenario: The shown price
- **Given** a basket priced at 10
- **When** it is paid
- **Then** 10 is charged
`;

/** A capability delta MODIFYING one promise down to its first scenario, pinned as `loam rebase` would pin it. */
function capabilityDelta(id: "CHK-ONCE" | "CHK-PRICE"): string {
  const name = id === "CHK-ONCE" ? "Charge once" : "Honour the price";
  return `# checkout — delta for ${FEAT}

## MODIFIED Requirements

### Requirement: ${name}
Requirement-ID: ${id}
Based-On: ${pinFor(LIVING_CAPABILITY, name)}
A customer SHALL be charged by the wallet directly.

#### Scenario: ${id === "CHK-ONCE" ? "One charge" : "The shown price"}
- **Given** an order
- **When** it is paid
- **Then** the wallet is charged
`;
}

/** An `architecture/` flow keeping CHK-ONCE. */
const FLEET_FLOW = `views {
  dynamic view uc_charge {
    #cap-checkout
    #req-CHK-ONCE
    checkoutWeb -> paymentService 'authorizes the payment'
  }
}
`;

function spec(service: string): string {
  return `---\nservice: ${service}\n---\n\n# ${service}\n`;
}

function fleet(files: Record<string, string>): Record<string, string> {
  return {
    "architecture/landscape.likec4": LANDSCAPE,
    "architecture/capabilities.yaml": "capabilities:\n  checkout: {}\n",
    "capabilities/checkout/spec.md": LIVING_CAPABILITY,
    "services/checkout-web/spec.md": spec("checkout-web"),
    "services/payment-service/spec.md": spec("payment-service"),
    [`${FEAT_DIR}/intent.md`]: `---\nfeature: ${FEAT}\nstatus: proposed\n---\n\n# Wallet charges\n\nCharge the wallet directly.\n`,
    ...files,
  };
}

async function project(files: Record<string, string>): Promise<Project> {
  const p = await makeProject(fleet(files));
  cleanups.push(() => p.destroy());
  return p;
}

interface Finding {
  code: string;
  severity: string;
  message: string;
}

function findings(stdout: string, code: string): Finding[] {
  const payload = JSON.parse(stdout) as { targets: Array<{ findings: Finding[] }> };
  return payload.targets.flatMap((t) => t.findings).filter((f) => f.code === code);
}

interface DroppedRow {
  path: string;
  kind: string;
  requirement: string;
  id?: string;
  scenarios: string[];
  directives: Record<string, string[]>;
}

function dropped(stdout: string): DroppedRow[] {
  return (JSON.parse(stdout) as { dropped: DroppedRow[] }).dropped;
}

describe("the archive names what a replacement drops", () => {
  it("a MODIFIED capability requirement that restates one of two scenarios names the other", async () => {
    const p = await project({ [`${FEAT_DIR}/capabilities/checkout/spec.md`]: capabilityDelta("CHK-ONCE") });

    const plan = await runLoam(p.workDir, "archive", FEAT, "--dry-run", "--json");
    expect(plan.code, plan.out).toBe(0);
    expect(dropped(plan.stdout)).toEqual([
      {
        path: "capabilities/checkout/spec.md",
        kind: "MODIFIED",
        requirement: "Charge once",
        id: "CHK-ONCE",
        scenarios: ["A retried payment"],
        directives: {},
      },
    ]);

    const human = await runLoam(p.workDir, "archive", FEAT, "--dry-run");
    expect(human.stdout).toContain("capability: checkout ← +0 ~1 -0");
    expect(human.stdout).toContain("CHK-ONCE 'Charge once' is replaced whole, and its new text does not carry scenario 'A retried payment'");
  });

  it("an arch MODIFIED that rewrites Covers: names every entry it does not restate — and loam delta says so first", async () => {
    const livingArch = `---\nservice: payment-service\n---\n\n# payment-service — architecture\n\n## Requirements\n\n### Requirement: Health is measured\nRequirement-ID: PAY-HEALTH\nThe service SHALL export its SLIs and page on errors.\n\nCovers: sli:availability, alert:pay_5xx\n\n#### Scenario: The alert fires\n- **Given** errors over 1%\n- **When** rules evaluate\n- **Then** on-call is paged\n\n#### Scenario: SLIs are exported\n- **Given** traffic\n- **When** metrics are scraped\n- **Then** availability reports\n`;
    const archDelta = `# payment-service — delta for ${FEAT}\n\n## MODIFIED Requirements\n\n### Requirement: Health is measured\nRequirement-ID: PAY-HEALTH\nThe service SHALL page on errors.\n\nCovers: payment-service, alert:pay_5xx\n\n#### Scenario: The alert fires\n- **Given** errors over 1%\n- **When** rules evaluate\n- **Then** on-call is paged\n`;
    const p = await project({
      "services/payment-service/arch.spec.md": livingArch,
      [`${FEAT_DIR}/specs/payment-service/arch.spec.md`]: archDelta,
    });
    const want: DroppedRow = {
      path: "services/payment-service/arch.spec.md",
      kind: "MODIFIED",
      requirement: "Health is measured",
      id: "PAY-HEALTH",
      scenarios: ["SLIs are exported"],
      // `alert:pay_5xx` is restated, so it is NOT listed; `payment-service` is
      // new and is not a drop either.
      directives: { covers: ["sli:availability"] },
    };

    const plan = await runLoam(p.workDir, "archive", FEAT, "--dry-run", "--json", "--approve");
    expect(dropped(plan.stdout)).toEqual([want]);

    const brief = await runLoam(p.workDir, "delta", FEAT, "--service", "payment-service", "--json");
    expect(brief.code, brief.out).toBe(0);
    expect(dropped(brief.stdout)).toEqual([want]);
    const read = await runLoam(p.workDir, "delta", FEAT, "--service", "payment-service");
    expect(read.stdout).toContain("Taken out of the living docs by the merge:");
    expect(read.stdout).toContain("services/payment-service/arch.spec.md: ~ PAY-HEALTH 'Health is measured'");
    expect(read.stdout).toContain("Covers: sli:availability");
  });

  it("a REMOVED requirement is named with what leaves with it, and an additive feature reports nothing", async () => {
    const removed = `# checkout — delta for ${FEAT}\n\n## REMOVED Requirements\n\n### Requirement: Honour the price\nRequirement-ID: CHK-PRICE\n`;
    const p = await project({ [`${FEAT_DIR}/capabilities/checkout/spec.md`]: removed });
    const plan = await runLoam(p.workDir, "archive", FEAT, "--dry-run", "--json", "--approve");
    expect(dropped(plan.stdout)).toEqual([
      {
        path: "capabilities/checkout/spec.md",
        kind: "REMOVED",
        requirement: "Honour the price",
        id: "CHK-PRICE",
        scenarios: ["The shown price"],
        directives: {},
      },
    ]);

    const added = `# checkout — delta for ${FEAT}\n\n## ADDED Requirements\n\n### Requirement: Refund on request\nRequirement-ID: CHK-REFUND\nA customer SHALL be refunded on request.\n\n#### Scenario: A refund\n- **Given** a paid order\n- **When** a refund is asked for\n- **Then** it is refunded\n`;
    await p.write(`${FEAT_DIR}/capabilities/checkout/spec.md`, added);
    const additive = await runLoam(p.workDir, "archive", FEAT, "--dry-run", "--json", "--approve");
    expect(dropped(additive.stdout)).toEqual([]);
    const human = await runLoam(p.workDir, "archive", FEAT, "--dry-run", "--approve");
    expect(human.stdout).not.toContain("is replaced whole");
  });
});

describe("usecase.requirement-modified", () => {
  it("names the architecture/ flow whose #req- tag claims the capability requirement the feature MODIFIES", async () => {
    const p = await project({
      "architecture/usecases/charge.likec4": FLEET_FLOW,
      [`${FEAT_DIR}/capabilities/checkout/spec.md`]: capabilityDelta("CHK-ONCE"),
    });
    const res = await runLoam(p.workDir, "validate", "--feature", FEAT, "--json");
    expect(res.code, res.out).toBe(0);
    const found = findings(res.stdout, "usecase.requirement-modified");
    expect(found, res.stdout).toHaveLength(1);
    expect(found[0]!.severity).toBe("warn");
    expect(found[0]!.message).toContain("architecture/usecases/charge.likec4: flow 'uc_charge' is tagged #req-CHK-ONCE");
    expect(found[0]!.message).toContain("checkout#CHK-ONCE, which this feature MODIFIES");

    // A warning: the archive still lands, and carries it.
    const archived = await runLoam(p.workDir, "archive", FEAT, "--json");
    expect(archived.code, archived.out).toBe(0);
    const warnings = (JSON.parse(archived.stdout) as { warnings: Array<{ code: string }> }).warnings;
    expect(warnings.map((w) => w.code)).toContain("usecase.requirement-modified");
  });

  it("is silent for a flow claiming a promise the feature leaves alone", async () => {
    const p = await project({
      "architecture/usecases/charge.likec4": FLEET_FLOW,
      [`${FEAT_DIR}/capabilities/checkout/spec.md`]: capabilityDelta("CHK-PRICE"),
    });
    const res = await runLoam(p.workDir, "validate", "--feature", FEAT, "--json");
    expect(findings(res.stdout, "usecase.requirement-modified"), res.stdout).toEqual([]);
  });

  it("names a service-local flow whose #req- tag claims that service's own requirement the feature MODIFIES", async () => {
    // A standalone model — its own `specification` declares the tag, because
    // the service directory is its own project.
    const model = `specification {\n  element softwareSystem\n  element container\n  tag req-PAY-AUTH\n}\n\nmodel {\n  paymentService = softwareSystem 'payment-service' {\n    metadata { service 'payment-service' }\n    api = container 'api'\n    domain = container 'domain'\n    api -> domain 'authorizes'\n  }\n}\n`;
    const flowDoc = `views {\n  dynamic view uc_authorize {\n    #req-PAY-AUTH\n    paymentService.api -> paymentService.domain 'authorizes'\n  }\n}\n`;
    const living = `---\nservice: payment-service\n---\n\n# payment-service\n\n## Requirements\n\n### Requirement: Authorize\nRequirement-ID: PAY-AUTH\nThe service SHALL authorize through its domain.\n\n#### Scenario: Authorized\n- **Given** a card\n- **When** it is authorized\n- **Then** the domain records it\n`;
    const delta = `# payment-service — delta for ${FEAT}\n\n## MODIFIED Requirements\n\n### Requirement: Authorize\nRequirement-ID: PAY-AUTH\nThe service SHALL authorize through the wallet.\n\n#### Scenario: Authorized\n- **Given** a card\n- **When** it is authorized\n- **Then** the wallet records it\n`;
    const p = await project({
      "services/payment-service/spec.md": living,
      "services/payment-service/model.likec4": model,
      "services/payment-service/usecases/authorize.likec4": flowDoc,
      [`${FEAT_DIR}/specs/payment-service/spec.md`]: delta,
    });
    const res = await runLoam(p.workDir, "validate", "--feature", FEAT, "--json");
    const found = findings(res.stdout, "usecase.requirement-modified");
    expect(found, res.stdout).toHaveLength(1);
    expect(found[0]!.message).toContain("services/payment-service/usecases/authorize.likec4: flow 'uc_authorize' is tagged #req-PAY-AUTH");
    expect(found[0]!.message).toContain("payment-service's requirement PAY-AUTH");
  });
});

describe("droppedBy", () => {
  it("a pin the living entry carries is bookkeeping, a target the replacement leaves out is a drop", () => {
    const living = parseRequirements(
      "## Requirements\n\n### Requirement: Split\nRequirement-ID: SPLIT\nThe service SHALL split.\n\nRealizes: checkout#CHK-ONCE@0123456789abcdef, checkout#CHK-PRICE\n\n#### Scenario: Split\n- **Given** a payment\n- **When** it is split\n- **Then** two shares exist\n",
    );
    const delta = parseRequirements(
      "## MODIFIED Requirements\n\n### Requirement: Split\nRequirement-ID: SPLIT\nThe service SHALL split evenly.\n\nRealizes: checkout#CHK-ONCE\n\n#### Scenario: Split\n- **Given** a payment\n- **When** it is split\n- **Then** two equal shares exist\n",
    );
    expect(droppedBy(living, delta)).toEqual([
      { kind: "MODIFIED", requirement: "Split", id: "SPLIT", scenarios: [], directives: { realizes: ["checkout#CHK-PRICE"] } },
    ]);
  });

  it("reports the NET drop when one delta selects a requirement twice", () => {
    const scenario = (name: string): string => `#### Scenario: ${name}\n- **Given** an order\n- **When** it is paid\n- **Then** ${name}\n`;
    const living = parseRequirements(`## Requirements\n\n### Requirement: Charge once\nThe fleet SHALL charge once.\n\n${scenario("One charge")}\n${scenario("Retry")}`);
    const delta = parseRequirements(
      `## MODIFIED Requirements\n\n### Requirement: Charge once\nThe fleet SHALL charge once.\n\n${scenario("One charge")}\n` +
        `### Requirement: Charge once\nThe fleet SHALL charge exactly once.\n\n${scenario("One charge")}\n${scenario("Retry")}`,
    );
    // The merge keeps both scenarios, so nothing is dropped — the first step's
    // text is not "living", and reading it as such reported 'Retry' gone.
    expect(droppedBy(living, delta)).toEqual([]);
  });
});
