/**
 * Flows as GRADED objects: the findings a drawn journey earns, the ones its
 * ABSENCE earns, and the `Covers: view:<id>` line that joins a journey to the
 * scenarios answering it.
 *
 * test/flows.test.ts pins the reader — that a dynamic view flattens with its
 * branch tree intact and its steps joined to the relationships they exercise.
 * This file pins what `loam validate` then DOES with that. Two grades are fleet
 * scope: a step joined to nothing is named (`flow.step-unresolved`), and a
 * journey with more branch outcomes than covering scenarios is named
 * (`flow.uncovered`). The third is FEATURE scope and asks the mirror question —
 * a delta that adds a cross-service operation and draws no journey over it is
 * named (`flow.unrepresented`). None of the three gates: `--strict` is the CI
 * escalation, exactly as `c4.uncovered` has it.
 *
 * The outcome arithmetic gets a fixture of its own, because the counting rule
 * is a decision rather than a derivation: outcomes are SUMMED across sub-flows
 * and never multiplied. Three nested `alt`s of three branches are nine, not
 * twenty-seven — a product demands a scenario count nobody will write, and a
 * rule people route around (by deleting branches from the diagram) is worse
 * than no rule. Every keyword's contribution is asserted here so that rule
 * cannot drift into a product by accident.
 */
import { describe, expect, it } from "vitest";
import { coherentFixture, LANDSCAPE, makeProject, runLoam, type Project } from "./helpers/harness.js";

interface Finding {
  severity: "ok" | "warn" | "error";
  code: string;
  subject?: string;
  message: string;
}
interface Target {
  kind: string;
  id: string;
  valid: boolean;
  findings: Finding[];
}

/**
 * The fleet every fixture below draws over: three services, two declared
 * edges. `checkoutWeb` holds a container so a step drawn one level down still
 * resolves — the granularity mismatch is the ordinary shape of a real fleet,
 * and a check that fired on it would be useless.
 *
 * The edges carry no `metadata { op }`, and that is fixture hygiene rather than
 * a claim: a step resolves by finding a DECLARED RELATIONSHIP between its
 * endpoints, whatever that relationship carries, while an operation link with
 * no OpenAPI behind it would make every service target report
 * `service.no-openapi` (error) and drown the exit-code assertions below.
 */
const FLEET_MODEL = `specification {
  element softwareSystem
  element container
}

model {
  checkoutWeb = softwareSystem 'checkout-web' {
    ui = container 'checkout-ui'
  }
  paymentService = softwareSystem 'payment-service'
  ledger = softwareSystem 'ledger-service'

  checkoutWeb -> paymentService 'Authorizes a payment'
  paymentService -> ledger 'Posts an entry'
}`;

const SERVICES = ["checkout-web", "payment-service", "ledger-service"] as const;

/** The landscape, with whatever dynamic views a test needs appended to its views block. */
function landscape(views: string): string {
  return `${FLEET_MODEL}

views {
  view landscape {
    include *
  }
${views}
}
`;
}

/** The smallest valid per-service C4 model — enough for the service target to pass. */
function serviceModel(svc: string): string {
  return `specification { element softwareSystem }

model {
  s = softwareSystem '${svc}'
}

views {
  view index {
    include *
  }
}
`;
}

/** One arch.spec.md holding one requirement that covers `viewId` with `scenarios` scenarios. */
function archSpec(svc: string, covers: string, scenarios: number): string {
  const bodies = Array.from(
    { length: scenarios },
    (_unused, i) => `#### Scenario: Outcome ${i + 1}
- **Given** the journey starts
- **When** case ${i + 1} happens
- **Then** the fleet behaves
`,
  ).join("\n");
  return `---
service: ${svc}
status: draft
---

# ${svc} — architecture spec

## Requirements

### Requirement: The checkout journey holds together

The fleet SHALL complete the drawn journey.

Covers: ${covers}

${bodies}`;
}

/** Landscape + one service directory per drawn service, plus whatever else a test adds. */
function fleetFiles(views: string, extra: Record<string, string> = {}): Record<string, string> {
  return {
    "architecture/landscape.likec4": landscape(views),
    ...Object.fromEntries(SERVICES.map((svc) => [`services/${svc}/model.likec4`, serviceModel(svc)])),
    ...extra,
  };
}

async function withProject(
  files: Record<string, string>,
  fn: (p: Project) => Promise<void>,
): Promise<void> {
  const p = await makeProject(files);
  try {
    await fn(p);
  } finally {
    await p.destroy();
  }
}

async function validateAll(p: Project, ...flags: string[]): Promise<{ code: number; findings: Finding[] }> {
  const res = await runLoam(p.workDir, "validate", "--all", "--json", ...flags);
  const json = JSON.parse(res.stdout) as { targets: Target[] };
  return { code: res.code, findings: json.targets.flatMap((t) => t.findings) };
}

function byCode(findings: Finding[], code: string): Finding[] {
  return findings.filter((f) => f.code === code);
}

/* ------------------------------------------------------------------ */
/* flow.step-unresolved                                                */
/* ------------------------------------------------------------------ */

describe("a flow step that no declared relationship joins", () => {
  it("warns once per step, naming the flow, the step and both endpoints, without gating", async () => {
    const files = fleetFiles(`  dynamic view checkout {
    title 'Checkout journey'
    checkoutWeb -> paymentService 'authorize'
    ledger -> checkoutWeb 'receipt'
    ledger -> checkoutWeb
  }`);
    await withProject(files, async (p) => {
      const { code, findings } = await validateAll(p);
      const unresolved = byCode(findings, "flow.step-unresolved");
      // One per step, not one per flow: each arrow has its own endpoints and
      // its own fix, so rolling them together would make the author count
      // detail lines to find the pair that is wrong.
      expect(unresolved).toHaveLength(2);
      // An untitled step still names its endpoints and its position — the only
      // two things an author can find it by.
      expect(unresolved[1]!.message).toContain("step 3 (ledger → checkoutWeb)");
      const f = unresolved[0]!;
      expect(f.severity).toBe("warn");
      // The flow's id, not its title: a `Covers: view:<id>` line names the id,
      // so the finding has to quote the same string the fix is written with.
      expect(f.subject).toBe("checkout");
      expect(f.message).toContain("'checkout'");
      expect(f.message).toContain("ledger → checkoutWeb");
      // Position counted over EVERY step, resolved ones included — it is the
      // arrow the author counts down the diagram.
      expect(f.message).toContain("step 2");
      expect(f.message).toContain("'receipt'");
      // Never a gate. The picture is legible either way and which edge was
      // meant is the author's judgement, so this is `c4.op-link-missing`'s
      // grade. (`--strict` escalating every warning is the flag's own property,
      // pinned in test/validate.test.ts; what belongs here is that this finding
      // is a warning and that the plain run stays green over it.)
      expect(code).toBe(0);
    });
  });

  it("says nothing when every step resolves — including across granularity", async () => {
    // The step is drawn container-to-service while the edge is declared
    // service-to-service. A check that only matched the exact pair would report
    // this entirely correct fleet as a journey joined to nothing.
    const files = fleetFiles(`  dynamic view checkout {
    checkoutWeb.ui -> paymentService 'authorize'
    paymentService -> ledger 'post'
  }`);
    await withProject(files, async (p) => {
      const { code, findings } = await validateAll(p);
      expect(byCode(findings, "flow.step-unresolved")).toEqual([]);
      // Positive control in the same run, so the silence above is the check
      // answering rather than the check never seeing this flow at all.
      expect(byCode(findings, "flow.uncovered").map((f) => f.subject)).toEqual(["checkout"]);
      expect(code).toBe(0);
    });
  });
});

/* ------------------------------------------------------------------ */
/* Covers: view:<id>                                                   */
/* ------------------------------------------------------------------ */

describe("`Covers: view:<id>` is an entry form of its own", () => {
  it("resolves against the landscape's dynamic views", async () => {
    const files = fleetFiles(
      `  dynamic view checkout {
    checkoutWeb -> paymentService 'authorize'
  }`,
      { "services/payment-service/arch.spec.md": archSpec("payment-service", "view:checkout", 1) },
    );
    await withProject(files, async (p) => {
      const { code, findings } = await validateAll(p);
      // Before the form existed this line parsed as an ELEMENT id
      // ("view:checkout"), resolved to nothing, and cost its author the
      // coverage they wrote it for.
      expect(byCode(findings, "covers.unknown")).toEqual([]);
      expect(code).toBe(0);
    });
  });

  it("is the existing covers.unknown on a miss, with a did-you-mean that keeps the prefix", async () => {
    const files = fleetFiles(
      `  dynamic view checkout {
    checkoutWeb -> paymentService 'authorize'
  }`,
      { "services/payment-service/arch.spec.md": archSpec("payment-service", "view:chekout", 1) },
    );
    await withProject(files, async (p) => {
      const unknown = byCode((await validateAll(p)).findings, "covers.unknown");
      expect(unknown).toHaveLength(1);
      expect(unknown[0]!.severity).toBe("warn");
      expect(unknown[0]!.message).toContain("'view:chekout'");
      // Prefixed, because an unprefixed hint would resolve as an element and
      // quietly cost the coverage the hint was offered to restore.
      expect(unknown[0]!.message).toContain("Did you mean: view:checkout?");
    });
  });

  it("resolves against the service's OWN model.likec4 views too", async () => {
    // The service-scope half of the plumbing, pinned separately: an
    // intra-service sequence is coverable by that service's arch requirements
    // exactly as a fleet journey is, and nothing else in this file would fail
    // if `ArchAxis.flows` were dropped on the way through.
    const files = fleetFiles(
      `  dynamic view checkout {
    checkoutWeb -> paymentService 'authorize'
  }`,
      {
        "services/payment-service/model.likec4": `specification {
  element softwareSystem
  element container
}

model {
  s = softwareSystem 'payment-service' {
    api = container 'api'
    db = container 'db'
  }
  s.api -> s.db 'Writes'
}

views {
  view index {
    include *
  }
  dynamic view paymentWrite {
    s.api -> s.db 'write'
  }
}
`,
        "services/payment-service/arch.spec.md": archSpec("payment-service", "view:paymentWrite", 1),
      },
    );
    await withProject(files, async (p) => {
      expect(byCode((await validateAll(p)).findings, "covers.unknown")).toEqual([]);
    });
  });

  it("resolves against a feature delta's own views — the journey the feature draws", async () => {
    // The feature-scope half. A delta may add the flow AND the requirement
    // covering it in one change; without the delta's views in scope, the
    // requirement covering the feature's own journey reads as a typo.
    const files = fleetFiles(
      `  dynamic view checkout {
    checkoutWeb -> paymentService 'authorize'
  }`,
      {
        "features/FEAT-9-refunds/intent.md":
          "---\nfeature: FEAT-9\nstatus: proposed\n---\n\n# Refunds\n\nLet a captured payment be refunded.\n",
        "features/FEAT-9-refunds/delta.likec4": `specification {
  element softwareSystem
  tag FEAT-9
}

model {
  checkoutWeb = softwareSystem 'checkout-web'
  paymentService = softwareSystem 'payment-service'
  ledger = softwareSystem 'ledger-service'

  paymentService -> ledger 'Reverses an entry' {
    #FEAT-9
  }
}

views {
  dynamic view refundJourney {
    checkoutWeb -> paymentService 'refund'
    paymentService -> ledger 'reverse'
  }
}
`,
        "features/FEAT-9-refunds/specs/payment-service/arch.spec.md": `# payment-service — arch delta for FEAT-9

## ADDED Requirements

### Requirement: The refund journey holds together

The fleet SHALL reverse the ledger entry when a payment is refunded.

Covers: view:refundJourney

#### Scenario: A captured payment is refunded
- **Given** a captured payment
- **When** a refund is requested
- **Then** the ledger entry is reversed
`,
      },
    );
    await withProject(files, async (p) => {
      expect(byCode((await validateAll(p)).findings, "covers.unknown")).toEqual([]);
    });
  });
});

/* ------------------------------------------------------------------ */
/* Journeys authored under architecture/flows/                         */
/* ------------------------------------------------------------------ */

describe("a journey authored under architecture/flows/", () => {
  /**
   * The SAME journey text, stored where the storage rule puts it — one file per
   * journey under `architecture/flows/` — instead of inside the fleet map's own
   * `views { }` block. Storage and grading landed as two separate slices and
   * meet here: the grader used to be handed the landscape document's views
   * alone, so a journey written in the place SCHEMA.md tells authors to write it
   * was graded by nothing, and an arch requirement correctly naming it was
   * reported as `covers.unknown` — loam calling a correct line a typo while
   * `flow.uncovered` would have demanded that very line.
   */
  const authored = (views: string): Record<string, string> => ({
    "architecture/flows/checkout.likec4": `views {\n${views}\n}\n`,
  });

  const TWO_BRANCHES = `  dynamic view checkout {
    title 'Checkout journey'
    checkoutWeb -> paymentService 'authorize'
    alt {
      when 'authorized' {
        paymentService -> ledger 'post'
      }
      else {
        paymentService -> checkoutWeb 'decline'
      }
    }
  }`;

  it("earns flow.step-unresolved and flow.uncovered exactly as one declared in the landscape does", async () => {
    const files = fleetFiles(
      "",
      authored(`  dynamic view checkout {
    title 'Checkout journey'
    checkoutWeb -> paymentService 'authorize'
    ledger -> checkoutWeb 'receipt'
  }`),
    );
    await withProject(files, async (p) => {
      const { code, findings } = await validateAll(p);
      const unresolved = byCode(findings, "flow.step-unresolved");
      expect(unresolved).toHaveLength(1);
      expect(unresolved[0]!.subject).toBe("checkout");
      expect(unresolved[0]!.message).toContain("step 2 'receipt' (ledger → checkoutWeb)");
      // Graded, not merely parsed: a journey nobody covers owes a scenario
      // wherever it is stored.
      expect(byCode(findings, "flow.uncovered").map((f) => f.subject)).toEqual(["checkout"]);
      expect(code).toBe(0);
    });
  });

  it("is what a `Covers: view:<id>` resolves against, and its scenarios count toward its coverage", async () => {
    const files = fleetFiles("", {
      ...authored(TWO_BRANCHES),
      "services/payment-service/arch.spec.md": archSpec("payment-service", "view:checkout", 1),
    });
    await withProject(files, async (p) => {
      const { code, findings } = await validateAll(p);
      // The half that made this one change rather than two: `flow.uncovered`
      // demands a `Covers:` line that `covers.unknown` would then reject.
      expect(byCode(findings, "covers.unknown")).toEqual([]);
      const uncovered = byCode(findings, "flow.uncovered");
      expect(uncovered).toHaveLength(1);
      // The scenario reached the count — the shortfall is 2 − 1 and not 2 − 0,
      // which is what proves the covering requirement was joined to this flow.
      expect(uncovered[0]!.message).toContain("2 branch outcome(s) and 1 architecture scenario(s)");
      expect(code).toBe(0);
    });
  });

  it("goes quiet once its outcomes are covered — the pair of findings agrees on one document", async () => {
    const files = fleetFiles("", {
      ...authored(TWO_BRANCHES),
      "services/payment-service/arch.spec.md": archSpec("payment-service", "view:checkout", 2),
    });
    await withProject(files, async (p) => {
      const { findings } = await validateAll(p);
      expect(byCode(findings, "flow.uncovered")).toEqual([]);
      expect(byCode(findings, "covers.unknown")).toEqual([]);
    });
  });

  it("resolves from a FEATURE delta's arch requirement too — the delta path sees the same fleet set", async () => {
    const files = fleetFiles("", {
      ...authored(TWO_BRANCHES),
      "features/FEAT-9-refunds/intent.md":
        "---\nfeature: FEAT-9\nstatus: proposed\n---\n\n# Refunds\n\nLet a captured payment be refunded.\n",
      "features/FEAT-9-refunds/specs/payment-service/arch.spec.md": `# payment-service — arch delta for FEAT-9

## ADDED Requirements

### Requirement: The checkout journey's decline branch is answered

The fleet SHALL surface a declined authorization to the shopper.

Covers: view:checkout

#### Scenario: The authorization is declined
- **Given** a checkout
- **When** the authorization is declined
- **Then** the shopper is told
`,
    });
    await withProject(files, async (p) => {
      const { findings } = await validateAll(p);
      expect(byCode(findings, "covers.unknown")).toEqual([]);
    });
  });
});

/* ------------------------------------------------------------------ */
/* flow.uncovered                                                      */
/* ------------------------------------------------------------------ */

describe("a flow with more outcomes than covering scenarios", () => {
  const TWO_BRANCHES = `  dynamic view checkout {
    checkoutWeb -> paymentService 'authorize'
    alt {
      when 'authorized' {
        paymentService -> ledger 'post'
      }
      else {
        paymentService -> checkoutWeb 'decline'
      }
    }
  }`;

  it("warns with the shortfall, claims only what loam can know, and never gates", async () => {
    const files = fleetFiles(TWO_BRANCHES, {
      "services/payment-service/arch.spec.md": archSpec("payment-service", "view:checkout", 1),
    });
    await withProject(files, async (p) => {
      const { code, findings } = await validateAll(p);
      const uncovered = byCode(findings, "flow.uncovered");
      expect(uncovered).toHaveLength(1);
      expect(uncovered[0]!.severity).toBe("warn");
      expect(uncovered[0]!.subject).toBe("checkout");
      expect(uncovered[0]!.message).toContain("2 branch outcome(s)");
      expect(uncovered[0]!.message).toContain("1 architecture scenario(s)");
      // The epistemic line the whole codebase draws between attested and tested
      // evidence: loam reads no test, so it can say a shortfall exists and
      // never which outcome the shortfall is.
      expect(uncovered[0]!.message).toContain("at least 1 outcome(s) have none");
      expect(uncovered[0]!.message).toContain("cannot say WHICH");
      // Never gates, exactly as `c4.uncovered` never gates; `--strict` is the
      // CI escalation, and that it escalates warnings at all is pinned once in
      // test/validate.test.ts rather than per finding.
      expect(code).toBe(0);
    });
  });

  it("stays silent once the scenarios reach the outcomes — silence is no shortfall, not proof", async () => {
    const files = fleetFiles(TWO_BRANCHES, {
      "services/payment-service/arch.spec.md": archSpec("payment-service", "view:checkout", 2),
    });
    await withProject(files, async (p) => {
      const { findings } = await validateAll(p);
      expect(byCode(findings, "flow.uncovered")).toEqual([]);
      // The scenarios are only counted because the `Covers:` line RESOLVED —
      // an unresolved one would be silent here for the wrong reason entirely.
      expect(byCode(findings, "covers.unknown")).toEqual([]);
    });
  });

  it("counts scenarios across the whole fleet's arch specs, and never a business spec's", async () => {
    // Two services each covering the journey with one scenario answer its two
    // outcomes together: a cross-service journey belongs to no single service,
    // so its coverage cannot be required to live in one arch.spec.md.
    const files = fleetFiles(TWO_BRANCHES, {
      "services/payment-service/arch.spec.md": archSpec("payment-service", "view:checkout", 1),
      "services/ledger-service/arch.spec.md": archSpec("ledger-service", "view:checkout", 1),
    });
    await withProject(files, async (p) => {
      const { findings } = await validateAll(p);
      expect(byCode(findings, "flow.uncovered")).toEqual([]);
      expect(byCode(findings, "covers.unknown")).toEqual([]);
    });
  });
});

/* ------------------------------------------------------------------ */
/* The counting rule                                                   */
/* ------------------------------------------------------------------ */

describe("branch outcomes are summed across sub-flows, never multiplied", () => {
  /** Every keyword's contribution, in one document so one run answers all of them. */
  const SHAPES = `  dynamic view plain {
    checkoutWeb -> paymentService 'authorize'
    paymentService -> ledger 'post'
  }
  dynamic view alt3 {
    alt {
      when 'a' {
        paymentService -> ledger 'post'
      }
      when 'b' {
        paymentService -> ledger 'post'
      }
      else {
        checkoutWeb -> paymentService 'retry'
      }
    }
  }
  dynamic view nested {
    alt {
      when 'a' {
        alt {
          when 'a1' {
            alt {
              when 'a11' {
                paymentService -> ledger 'post'
              }
              when 'a12' {
                paymentService -> ledger 'post'
              }
              else {
                paymentService -> ledger 'post'
              }
            }
          }
          when 'a2' {
            paymentService -> ledger 'post'
          }
          else {
            paymentService -> ledger 'post'
          }
        }
      }
      when 'b' {
        paymentService -> ledger 'post'
      }
      else {
        paymentService -> ledger 'post'
      }
    }
  }
  dynamic view tryOnly {
    try {
      checkoutWeb -> paymentService 'authorize'
    }
  }
  dynamic view tryCatchFinally {
    try {
      checkoutWeb -> paymentService 'authorize'
    }
    catch {
      paymentService -> ledger 'compensate'
    }
    finally {
      paymentService -> ledger 'post'
    }
  }
  dynamic view optional {
    opt 'if configured' {
      paymentService -> ledger 'post'
    }
  }
  dynamic view loops {
    loop 'until settled' {
      checkoutWeb -> paymentService 'authorize'
      break 'gave up' {
        paymentService -> ledger 'post'
      }
    }
    par {
      paymentService -> ledger 'post'
    }
  }`;

  it("gives each keyword the contribution the rule states", async () => {
    await withProject(fleetFiles(SHAPES), async (p) => {
      const { findings } = await validateAll(p);
      const counted = new Map<string, number>();
      for (const f of byCode(findings, "flow.uncovered")) {
        const n = /draws (\d+) branch outcome/.exec(f.message);
        expect(n, `flow.uncovered message must state the outcome count: ${f.message}`).not.toBeNull();
        counted.set(f.subject!, Number(n![1]));
      }
      expect(Object.fromEntries([...counted].sort())).toEqual({
        // No sub-flow at all: one outcome, satisfied by one covering scenario.
        plain: 1,
        // `alt` contributes its branch count.
        alt3: 3,
        // THE RULE: three nested alts of three branches. Summed it is 9;
        // multiplied it would be 27 — a scenario count nobody will ever write,
        // which is why the product was rejected.
        nested: 9,
        // `try` contributes its try section...
        tryOnly: 1,
        // ...plus its catch when one is written. `finally` is not an outcome:
        // it runs either way, so it adds no case to tell apart.
        tryCatchFinally: 2,
        // `opt` is taken or skipped, and the skip is the outcome authors forget.
        optional: 2,
        // `loop`, `par` and `break` change the ORDER of what happens, not the
        // set of ways the journey can end — so the flow falls back to its one.
        loops: 1,
      });
    });
  });
});

/* ------------------------------------------------------------------ */
/* flow.unrepresented — feature scope                                  */
/* ------------------------------------------------------------------ */

/**
 * The third flow grade, and the only one graded on a FEATURE rather than on the
 * fleet: a delta that adds a cross-service call and draws no journey over it
 * leaves the fleet's use-case map behind, and nothing but this says so.
 *
 * The delta is built here rather than taken from harness.ts's FEATURE_DELTA
 * because these tests turn exactly two knobs — which cross-service edges the
 * feature adds, and which journey it draws over them — and the shipped fixture
 * fixes both.
 */
function splitDelta(rels: string, views: string): string {
  return `specification {
  element softwareSystem
  element container
  tag FEAT-1
}

model {
  paymentService = softwareSystem 'payment-service' {
    api = container 'api'
  }
  paymentSplitService = softwareSystem 'payment-split-service' {
    #FEAT-1
    description 'Splits a payment across payees'
    api = container 'api'
    worker = container 'worker'
  }
${rels}
}

views {
  view feat_1 {
    include *
  }
${views}
}
`;
}

/**
 * One journey, stored the way a fleet stores journeys — a document under
 * `architecture/flows/`. Its CONTENT is not what the tests below turn on:
 * `validate --feature <id>` parses no fleet journey, so the adoption gate reads
 * this directory by existence alone. It is written to parse anyway, because a
 * fixture that could not is a fixture making a claim it has not earned.
 */
const FLEET_JOURNEY = `views {
  dynamic view fleetCheckout {
    checkoutWeb -> paymentService 'authorizes the payment'
  }
}
`;

/** The fixture's own fleet map with a journey drawn in its OWN `views { }` block. */
const LANDSCAPE_DRAWING_ONE = LANDSCAPE.replace(
  "  view landscape {\n    include *\n  }\n",
  "  view landscape {\n    include *\n  }\n  dynamic view mapCheckout {\n    checkoutWeb -> paymentService 'authorizes'\n  }\n",
);

/**
 * The coherent fixture with FEAT-1's delta replaced by one these tests wrote,
 * on a fleet that HAS adopted journeys — `flow.unrepresented` is silent
 * otherwise, and the gate test below is what pins that.
 */
function featureFiles(rels: string, views = ""): Record<string, string> {
  return {
    ...coherentFixture(),
    "features/FEAT-1-split/delta.likec4": splitDelta(rels, views),
    "architecture/flows/checkout.likec4": FLEET_JOURNEY,
  };
}

async function validateFeature(p: Project): Promise<{ code: number; findings: Finding[] }> {
  const res = await runLoam(p.workDir, "validate", "--feature", "FEAT-1", "--json");
  const json = JSON.parse(res.stdout) as { targets: Target[] };
  return { code: res.code, findings: json.targets.flatMap((t) => t.findings) };
}

/** One tagged cross-service edge carrying an operation the feature's OpenAPI defines. */
const CREATE_SPLIT = `  paymentService -> paymentSplitService 'Calls createSplit' {
    #FEAT-1
    metadata { op 'createSplit' }
  }`;

/** A journey drawn service to service — the granularity a fleet map is read at. */
const SPLIT_JOURNEY = `  dynamic view splitJourney {
    #FEAT-1
    paymentService -> paymentSplitService 'records the split'
  }`;

describe("a new cross-service operation no journey draws", () => {
  it("says nothing at all until the FLEET has adopted journeys", async () => {
    // THE ADOPTION GATE, and it is the whole shape of this finding. An axis
    // nobody has adopted is quiet everywhere else in loam — gherkin staleness
    // needs `<gherkinDir>/loam/` to exist before a service can be stale, and
    // `health.uncovered` manufactures no obligation without a health.yaml. A
    // fleet that draws no journey cannot discharge this warning except by
    // adopting the whole axis, and a per-feature tax people cannot pay is how a
    // team learns to ignore a warning — the same argument that made
    // `flow.uncovered` sum its outcomes rather than multiply them.
    const unadopted = featureFiles(CREATE_SPLIT);
    delete unadopted["architecture/flows/checkout.likec4"];
    await withProject(unadopted, async (p) => {
      const { code, findings } = await validateFeature(p);
      expect(byCode(findings, "flow.unrepresented")).toEqual([]);
      expect(code).toBe(0);
    });

    // The SAME feature on a fleet that HAS drawn one — here in the fleet map's
    // own `views { }` block rather than under `architecture/flows/`, because
    // the gate asks both halves and each has to be able to open it alone. The
    // map now exists to rot, so the warning does its work.
    await withProject({ ...unadopted, "architecture/landscape.likec4": LANDSCAPE_DRAWING_ONE }, async (p) => {
      expect(byCode((await validateFeature(p)).findings, "flow.unrepresented")).toHaveLength(1);
    });
  });

  it("names the operation and both services, and never gates", async () => {
    await withProject(featureFiles(CREATE_SPLIT), async (p) => {
      const { code, findings } = await validateFeature(p);
      const fs = byCode(findings, "flow.unrepresented");
      expect(fs).toHaveLength(1);
      expect(fs[0]!.severity).toBe("warn");
      // The subject is the service being called, as `c4.uncovered`'s is: the
      // fleet map's gap is on that side of the arrow.
      expect(fs[0]!.subject).toBe("payment-split-service");
      expect(fs[0]!.message).toContain("payment-service → payment-split-service");
      expect(fs[0]!.message).toContain("'createSplit'");
      // The trade is stated where an AUTHOR reads it, not only in the code:
      // this warning cannot see an operation added between a pair some step
      // already draws, and the message is where it admits that.
      expect(fs[0]!.message).toContain("carries every relationship declared between them");
      // Graded exactly as `c4.uncovered` is — a warning that never gates.
      expect(code).toBe(0);
    });
  });

  it("goes quiet once the delta's own dynamic view draws the step", async () => {
    await withProject(featureFiles(CREATE_SPLIT, SPLIT_JOURNEY), async (p) => {
      const { findings } = await validateFeature(p);
      expect(byCode(findings, "flow.unrepresented")).toEqual([]);
    });
  });

  it("counts ONE service-to-service step as drawing every operation declared between the pair", async () => {
    // THE DECISION, and it is a trade rather than a derivation. The
    // step→relationship join is granularity-blind (src/core/c4/flows/resolve.ts)
    // and hands a step EVERY match, so this one arrow carries both
    // container-level calls and both count as drawn. Demanding a step per
    // declared edge would force every journey to be redrawn at container
    // granularity the moment anybody modelled a container — which defeats the
    // point of a FLEET-level map.
    //
    // The cost is on the same line and is deliberate: `getSplit` is a genuinely
    // new operation nobody drew, covered because the PAIR is drawn. That is the
    // under-report, and the message in the first test above is where an author
    // is told about it.
    const rels = `  paymentService.api -> paymentSplitService.api 'Calls createSplit' {
    #FEAT-1
    metadata { op 'createSplit' }
  }
  paymentService.api -> paymentSplitService.api 'Calls createSplit again' {
    #FEAT-1
    metadata { op 'createSplit' }
  }`;
    await withProject(featureFiles(rels, SPLIT_JOURNEY), async (p) => {
      const { findings } = await validateFeature(p);
      expect(byCode(findings, "flow.unrepresented")).toEqual([]);
    });
  });

  it("asks nothing of an edge naming no operation, or of one inside a single service", async () => {
    // No `metadata { op }` means no operation to be represented, and
    // `c4.op-link-missing` already grades that state. An intra-service call is
    // not something a fleet journey can draw at all: likec4.config.json scopes
    // the flows project to `architecture/`, which excludes `services/**`.
    const rels = `  paymentService -> paymentSplitService 'Calls the splitter' {
    #FEAT-1
  }
  paymentSplitService.api -> paymentSplitService.worker 'Calls createSplit' {
    #FEAT-1
    metadata { op 'createSplit' }
  }`;
    await withProject(featureFiles(rels), async (p) => {
      const { findings } = await validateFeature(p);
      expect(byCode(findings, "flow.unrepresented")).toEqual([]);
      expect(byCode(findings, "c4.op-link-missing")).toHaveLength(1);
    });
  });
});
