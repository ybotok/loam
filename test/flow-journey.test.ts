/**
 * ONE journey, end to end — the first exit criterion of ROADMAP's
 * "Cross-service use cases: flows as fleet-level dynamic views":
 *
 *   "A journey across at least three services is authored once, generates one
 *    suite, and its scenarios are answered by a green run through the existing
 *    digest-tagged report path — with no scenario text duplicated across the
 *    participants' living specs, and no contested digest."
 *
 * Every other flow suite pins one organ of that sentence: test/flows.test.ts
 * the reader, test/flow-coverage.test.ts the grades, test/flow-groups.test.ts
 * the storage and the generated group views, test/flow-archive.test.ts the
 * views merge. None of them walks the whole animal, and the criterion is
 * precisely the claim that the organs join up — that a fleet-level dynamic view
 * really does end in a cucumber report answering a `scenario.tested` claim, and
 * not merely in a picture and some findings. So this file is one chain, run in
 * the order a fleet runs it: draw the journey, cover it once, emit the suite,
 * run it green, record the run, land the feature.
 *
 * The chain is deliberately walked with a feature IN FLIGHT and then archived,
 * because that is the only arrangement in which the criterion's two halves are
 * both true without the journey's scenarios being written twice:
 * `verify` derives `scenario.tested` claims from a feature's spec deltas alone,
 * while `flow.uncovered` counts only the LIVING `arch.spec.md` files
 * (src/commands/validate/fleet/flows.ts's `coveringScenarios`). Writing the
 * scenarios in both places would satisfy each check separately and violate the
 * clause the whole item exists for.
 */
import { describe, expect, it } from "vitest";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "yaml";
import { parseRequirements } from "../src/core/document/parse.js";
import { scenarioDigest } from "../src/core/gherkin/stamp.js";
import { makeProject, runLoam, type Project } from "./helpers/harness.js";
import { serviceRepo } from "./helpers/federated.js";

const FEAT = "FEAT-101";
const VIEW = "checkoutJourney";
const COVERING = "payment-service";
const FLOW_FILE = "architecture/flows/checkout.likec4";
const GROUP = "checkout";
const ARCH_DELTA = `features/${FEAT}-checkout/specs/${COVERING}/arch.spec.md`;
const LIVING_ARCH = `services/${COVERING}/arch.spec.md`;

/** The three participants, in the order the journey visits them. */
const PARTICIPANTS = ["checkout-web", "payment-service", "ledger-service"] as const;

/**
 * The fleet map. Three declared edges, one per drawn step — a step matching no
 * declared relationship would earn `flow.step-unresolved`, and this chain's
 * silences have to be the checks answering rather than the fixture being wrong.
 *
 * No `metadata { op }` anywhere: an operation link with no OpenAPI behind it
 * makes every service target report `service.no-openapi` (error) and would
 * drown the exit codes below. flow-coverage.test.ts's FLEET_MODEL makes the
 * same trade for the same reason.
 */
const FLEET = `specification {
  element softwareSystem
  tag ${GROUP}
}

model {
  checkoutWeb = softwareSystem 'checkout-web'
  paymentService = softwareSystem 'payment-service'
  ledger = softwareSystem 'ledger-service'

  checkoutWeb -> paymentService 'Authorizes a payment'
  paymentService -> ledger 'Posts an entry'
  paymentService -> checkoutWeb 'Declines the authorization'
}

views {
  view landscape {
    include *
  }
}
`;

/**
 * The journey itself: ONE document, three participants, and an `alt` — so it
 * has two outcomes rather than one, which is what makes the branch structure a
 * test matrix and what `flow.uncovered` counts against the covering scenarios.
 *
 * It carries a group tag so `loam flow env` will answer WHICH services a run of
 * it needs. That answer is how this file states "across at least three
 * services" in the product's own voice rather than by counting its own fixture.
 */
const JOURNEY = `views {
  dynamic view ${VIEW} {
    #${GROUP}
    title 'Checkout across the fleet'
    checkoutWeb -> paymentService 'authorize'
    alt {
      when 'authorized' {
        paymentService -> ledger 'post the entry'
      }
      else {
        paymentService -> checkoutWeb 'decline'
      }
    }
  }
}
`;

/**
 * The one requirement that covers the journey, in the feature that delivers it.
 * Two scenarios for two outcomes, so `flow.uncovered` is satisfied the moment
 * this lands in the living arch spec.
 *
 * It is the ONLY place in the fleet these words are written. Its two `Then`
 * lines are what `journeyScenarioText` looks for, and the point of the whole
 * item is that no other participant repeats them.
 */
const ARCH_REQUIREMENT = `# ${COVERING} — arch delta for ${FEAT}

## ADDED Requirements

### Requirement: The checkout journey holds together

The fleet SHALL carry a checkout through authorization to a posted ledger entry,
and SHALL tell the shopper when it cannot.

Covers: view:${VIEW}

#### Scenario: The authorization is accepted and the entry is posted
- **Given** checkout-web has a basket ready to pay
- **When** payment-service authorizes the payment
- **Then** ledger-service holds exactly one posted entry for it

#### Scenario: The authorization is declined and the shopper is told
- **Given** checkout-web has a basket ready to pay
- **When** payment-service declines the authorization
- **Then** checkout-web shows the decline and ledger-service holds no entry
`;

/** The smallest per-service C4 model — enough for the service target to pass. */
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

/**
 * A participant's own living documents: a business spec and an architecture
 * spec of its own, both saying something ONLY that service could say.
 *
 * They exist so the no-duplication assertion is not vacuous. "The other
 * participants' specs do not repeat the journey's scenarios" means nothing if
 * the other participants have no specs; these give the scan real documents to
 * come back empty-handed from.
 */
function ownDocuments(svc: string): Record<string, string> {
  return {
    [`services/${svc}/model.likec4`]: serviceModel(svc),
    [`services/${svc}/spec.md`]: `---
service: ${svc}
status: draft
---

# ${svc}

## Requirements

### Requirement: ${svc} answers for itself
The service SHALL answer its own callers.

#### Scenario: ${svc} answers a request of its own
- **Given** ${svc} is up
- **When** a caller asks it for something only it owns
- **Then** ${svc} answers
`,
    [`services/${svc}/arch.spec.md`]: `---
service: ${svc}
status: draft
---

# ${svc} — architecture spec

## Requirements

### Requirement: ${svc} survives a restart
The service SHALL come back after a restart with its own state intact.

#### Scenario: ${svc} restarts
- **Given** ${svc} is up
- **When** ${svc} is restarted
- **Then** ${svc} serves again with its own state intact
`,
  };
}

/**
 * The whole fleet, with FEAT-101 in flight: the journey drawn once, the
 * covering requirement in the feature's arch delta, and three participants each
 * carrying their own living specs.
 *
 * The feature has an intent and a spec delta and NOTHING else — no
 * `delta.likec4`, no contract — so every claim on its checklist is a
 * `scenario.tested` one. That is deliberate: `--results` answers only scenario
 * claims, and a checklist with an agent's claim left on it refuses
 * `answers-mismatch` rather than recording. This chain must rest on the runner
 * alone, which is what "a green run, not somebody's word" means.
 */
function journeyFleet(): Record<string, string> {
  return {
    "architecture/landscape.likec4": FLEET,
    [FLOW_FILE]: JOURNEY,
    ...Object.assign({}, ...PARTICIPANTS.map(ownDocuments)),
    [`features/${FEAT}-checkout/intent.md`]:
      `---\nfeature: ${FEAT}\nstatus: proposed\n---\n\n# Checkout across the fleet\n\nCarry a checkout through authorization to a posted ledger entry.\n`,
    [ARCH_DELTA]: ARCH_REQUIREMENT,
  };
}

/**
 * The fixture, with `workDir` turned into payment-service's own git repository:
 * `gherkin` writes into the repo loam stands in, and `verify --service` binds
 * its answers to that repo's HEAD, so both halves of the chain have to run from
 * there. `serviceRepo`'s "primary" is exactly that shape.
 */
async function journeyProject(): Promise<Project> {
  const p = await makeProject(journeyFleet());
  await serviceRepo(p, COVERING, "primary");
  // The generated group views file, brought current once: a fleet whose flows
  // declare a group and whose `architecture/flow-groups.likec4` is absent is
  // `flow.views-stale` (error), and every `expect(code).toBe(0)` below would be
  // failing about the fixture instead of answering about the journey.
  const sync = await runLoam(p.workDir, "flow", "sync");
  expect(sync.code, sync.out).toBe(0);
  return p;
}

async function withProject(fn: (p: Project) => Promise<void>): Promise<void> {
  const p = await journeyProject();
  try {
    await fn(p);
  } finally {
    await p.destroy();
  }
}

interface Finding {
  severity: string;
  code: string;
  subject?: string;
  message: string;
}

async function validateAll(p: Project): Promise<{ code: number; findings: Finding[] }> {
  const res = await runLoam(p.workDir, "validate", "--all", "--json");
  const json = JSON.parse(res.stdout) as { targets: Array<{ findings: Finding[] }> };
  return { code: res.code, findings: json.targets.flatMap((t) => t.findings) };
}

const byCode = (findings: Finding[], code: string): Finding[] => findings.filter((f) => f.code === code);

/**
 * The journey's scenario bodies, as the lines a reader would grep for. Taken
 * from the requirement text itself rather than restated, so the assertions
 * below cannot drift away from the words they are about.
 */
function journeyScenarioText(): string[] {
  return ARCH_REQUIREMENT.split("\n")
    .filter((line) => line.startsWith("- **Then**"))
    .map((line) => line.trim());
}

/**
 * The journey's scenario bodies as the digest recipe sees them — the input
 * `scenarioDigest` hashes. Parsed from the requirement rather than restated,
 * for `pinFor`'s reason in the harness: a literal digest in a fixture is a
 * second definition of the recipe, free to agree with it until the day it
 * quietly does not.
 */
function journeyScenarioBodies(): string[][] {
  return parseRequirements(ARCH_REQUIREMENT).flatMap((r) => r.scenarios.map((s) => s.lines));
}

/** Every LIVING spec document in the fleet, keyed by its docs-relative path. */
async function livingSpecs(p: Project): Promise<Map<string, string>> {
  const specs = new Map<string, string>();
  for (const svc of PARTICIPANTS) {
    for (const axis of ["spec.md", "arch.spec.md"]) {
      const rel = `services/${svc}/${axis}`;
      if (p.exists(rel)) specs.set(rel, await p.read(rel));
    }
  }
  return specs;
}

/** The living specs holding `text` — the duplication the criterion forbids. */
async function livingSpecsHolding(p: Project, text: string): Promise<string[]> {
  return [...(await livingSpecs(p))].filter(([, body]) => body.includes(text)).map(([path]) => path);
}

/** The `@loam-digest-…` tags an emitted suite file carries, in scenario order. */
function digestsIn(feature: string): string[] {
  return [...feature.matchAll(/@loam-digest-([0-9a-f]{16})/g)].map((m) => m[1]!);
}

/**
 * A cucumber JSON report in which every named digest ran green — the shape
 * `cucumber-js --format json` emits, reduced to the fields
 * `readCucumberReport` treats as contract.
 */
async function greenReport(p: Project, digests: string[]): Promise<string> {
  const report = [
    {
      uri: "features/loam/arch--the-checkout-journey-holds-together.feature",
      name: "The checkout journey holds together",
      elements: digests.map((digest, i) => ({
        name: `outcome ${i + 1}`,
        type: "scenario",
        tags: [{ name: "@architecture" }, { name: `@loam-digest-${digest}` }],
        steps: [{ result: { status: "passed" } }, { result: { status: "passed" } }],
      })),
    },
  ];
  await writeFile(join(p.workDir, "report.json"), JSON.stringify(report, null, 2), "utf8");
  return "report.json";
}

/** `loam gherkin FEAT-101` from the covering service's repo, as the machine contract. */
async function emitSuite(p: Project): Promise<Array<Record<string, any>>> {
  const res = await runLoam(p.workDir, "gherkin", FEAT, "--json");
  expect(res.code, res.out).toBe(0);
  return JSON.parse(res.stdout).files;
}

describe("a journey across three services, authored once", () => {
  it("is one document over three participants with two outcomes, and every step is joined", async () => {
    await withProject(async (p) => {
      const { code, findings } = await validateAll(p);
      // Drawn and readable: no step is an arrow with no edge behind it, and the
      // `Covers: view:checkoutJourney` line in the delta resolves to this very
      // view rather than reading as a mistyped element id.
      expect(byCode(findings, "flow.step-unresolved")).toEqual([]);
      expect(byCode(findings, "covers.unknown")).toEqual([]);
      expect(byCode(findings, "flow.invalid")).toEqual([]);
      // Across THREE services, said by loam rather than counted by this test:
      // `flow env` answers the participant union of the group this journey is
      // in, which is the definition of the environment a run of it needs. One
      // document, one journey, three services that have to be up.
      const env = await runLoam(p.workDir, "flow", "env", GROUP, "--json");
      expect(env.code, env.out).toBe(0);
      expect(JSON.parse(env.stdout).groups).toEqual([
        { group: GROUP, flows: [VIEW], services: [...PARTICIPANTS].sort(), unresolved: [] },
      ]);
      expect(await p.read(FLOW_FILE)).toContain(`dynamic view ${VIEW}`);
      // Two outcomes, counted by the grader itself rather than by this test:
      // while the covering requirement is still in the feature's delta, no
      // LIVING arch spec covers the journey, so the shortfall is the full 2.
      const uncovered = byCode(findings, "flow.uncovered");
      expect(uncovered.map((f) => f.subject)).toEqual([VIEW]);
      expect(uncovered[0]!.message).toContain("2 branch outcome(s) and 0 architecture scenario(s)");
      expect(code).toBe(0);
    });
  });

  it("writes the journey's scenarios once: no participant's living spec repeats another's", async () => {
    await withProject(async (p) => {
      // The clause the whole item exists for. Before a journey could be
      // authored at fleet level, the only way to state a cross-service
      // expectation was to write it into every participant's spec — three
      // copies of one sentence, three digests, and a change to any one of them
      // silently disagreeing with the other two.
      const delta = await p.read(ARCH_DELTA);
      for (const text of journeyScenarioText()) {
        expect(await livingSpecsHolding(p, text)).toEqual([]);
        // Written ONCE, in the feature that delivers it — `split` yields n+1
        // pieces for n occurrences, so two pieces is one occurrence.
        expect(delta.split(text)).toHaveLength(2);
      }
      // And the participants really do carry living specs of their own, so the
      // emptiness above is the journey being written once rather than the fleet
      // holding no documents to duplicate it into.
      const specs = await livingSpecs(p);
      expect([...specs.keys()]).toHaveLength(PARTICIPANTS.length * 2);
      for (const [path, body] of specs) expect(body, path).toContain("#### Scenario:");
    });
  });
});

describe("the suite the journey generates", () => {
  it("is one digest-tagged .feature file in the covering service's repo, on the arch axis", async () => {
    await withProject(async (p) => {
      const files = await emitSuite(p);
      // ONE suite for one journey: the feature's only requirement is the one
      // covering it, so exactly one file is written — into payment-service's
      // repo, because that is the repo loam is standing in.
      expect(files).toHaveLength(1);
      expect(files[0]!.axis).toBe("arch");
      expect(files[0]!.requirement).toBe("The checkout journey holds together");
      expect(files[0]!.path).toBe("features/loam/arch--the-checkout-journey-holds-together.feature");
      expect(files[0]!.digests).toHaveLength(2);

      const emitted = await readFile(join(p.workDir, files[0]!.path), "utf8");
      // The tags are what a cucumber report carries per scenario, so they are
      // the join between the emission and `--results`: 16 hex, one per
      // scenario, in scenario order, and the same strings the command reported.
      expect(digestsIn(emitted)).toEqual(files[0]!.digests);
      expect(emitted).toContain("@architecture");
      // Stamped ON THE ARCH AXIS, computed through the recipe rather than
      // pinned as a literal. The second assertion is the one with teeth: the
      // same words on `spec.md` hash to something else, so a green run of this
      // service's BUSINESS suite can never answer a fleet-level integration
      // claim. Without the axis salt the two would be one string, and one
      // journey's outcome would count as tested because a unit test passed.
      const bodies = journeyScenarioBodies();
      expect(files[0]!.digests).toEqual(bodies.map((lines) => scenarioDigest(COVERING, lines, "arch")));
      for (const lines of bodies) {
        expect(files[0]!.digests).not.toContain(scenarioDigest(COVERING, lines));
      }
    });
  });
});

describe("a green run answers the journey's scenarios", () => {
  it("confirms every scenario claim from the report, by the runner and with nothing contested", async () => {
    await withProject(async (p) => {
      const files = await emitSuite(p);
      const emitted = await readFile(join(p.workDir, files[0]!.path), "utf8");
      // The report names the digests the EMITTED suite carries — not digests
      // this test computed — so the chain is the real one: spec → emission →
      // runner → claim.
      const report = await greenReport(p, digestsIn(emitted));

      const res = await runLoam(p.workDir, "verify", FEAT, "--service", COVERING, "--results", report, "--json");
      expect(res.code, res.out).toBe(0);
      const payload = JSON.parse(res.stdout);
      expect(payload.ok).toBe(true);
      expect(payload.verified).toBe(true);
      // `unanswered: 0` is part of the claim: the runner answered the WHOLE
      // checklist, so nothing here rests on an agent's word at all.
      expect(payload.summary).toEqual({ claims: 2, confirmed: 2, unconfirmed: 0, unanswered: 0 });
      // "No contested digest", in the form that can actually fail. A second
      // service holding a claim on this journey's scenarios shows up as extra
      // claims on this checklist that this repository's run cannot answer:
      // duplicating the requirement into ledger-service's delta turns the line
      // above into `{ claims: 4, confirmed: 2, unanswered: 2 }` and `verified`
      // into false. THAT is what the criterion's clause costs when it is
      // broken, so that is what is asserted.
      //
      // `verify.digest-contested` is asserted absent too, and honestly: it is a
      // GUARD, not a discriminator. `scenarioBodyHash` salts by the owning
      // service and `--service` narrows the checklist to one repository before
      // matching, so no fixture can make it fire — a duplicate earns a
      // different digest and an unanswerable claim instead. It stays here
      // because the criterion names it; the invariant behind it is asserted
      // directly in test/verify-agent-fallback.test.ts.
      const notices = (payload.notices ?? []) as Array<{ code: string }>;
      expect(notices.map((n) => n.code)).not.toContain("verify.digest-contested");

      const doc = parse(await p.read(`features/${FEAT}-checkout/verification.yaml`)) as Record<string, any>;
      expect(doc.claims).toHaveLength(2);
      for (const claim of doc.claims) {
        expect(claim.kind).toBe("scenario.tested");
        expect(claim.verdict).toBe("confirmed");
        // The whole point of the report path: a run said so, not an agent.
        expect(claim.answered_by).toBe("runner");
        expect(claim.evidence[0]).toContain("report.json: ");
        expect(claim.note).toBeUndefined();
      }
      // And the record says which file was read, so a reviewer can re-check it.
      expect(payload.attestations[0].service).toBe(COVERING);
      expect(payload.attestations[0].report.path).toBe("report.json");
    });
  });

  it("matches on the digest and never the name: a reworded scenario is answered by nothing", async () => {
    await withProject(async (p) => {
      const files = await emitSuite(p);
      const emitted = await readFile(join(p.workDir, files[0]!.path), "utf8");
      const report = await greenReport(p, digestsIn(emitted));
      // The spec moves, the suite does not — the ordinary drift of a team that
      // edits a requirement and forgets to regenerate. The scenario NAMES are
      // untouched, so only the digest can tell.
      await p.write(ARCH_DELTA, ARCH_REQUIREMENT.replace("exactly one posted entry", "a posted entry"));

      const res = await runLoam(p.workDir, "verify", FEAT, "--service", COVERING, "--results", report, "--json");
      expect(res.code, res.out).toBe(0);
      const payload = JSON.parse(res.stdout);
      expect(payload.summary).toEqual({ claims: 2, confirmed: 1, unconfirmed: 1, unanswered: 0 });
      const doc = parse(await p.read(`features/${FEAT}-checkout/verification.yaml`)) as Record<string, any>;
      const drifted = doc.claims.find((c: { verdict: string }) => c.verdict === "unconfirmed");
      expect(drifted.claim).toContain("The authorization is accepted and the entry is posted");
      expect(drifted.note).toContain("not found in report");
    });
  });
});

describe("the journey's coverage closes when the feature lands", () => {
  it("archives into exactly one living spec, and flow.uncovered goes quiet", async () => {
    await withProject(async (p) => {
      expect((await runLoam(p.workDir, "archive", FEAT)).code).toBe(0);

      // Exactly one living spec across the whole fleet holds the journey's
      // scenarios — the criterion's own clause, now that a living document
      // holds them at all.
      for (const text of journeyScenarioText()) {
        expect(await livingSpecsHolding(p, text)).toEqual([LIVING_ARCH]);
      }
      const living = await p.read(LIVING_ARCH);
      expect(living).toContain(`Covers: view:${VIEW}`);

      const { code, findings } = await validateAll(p);
      // Two outcomes, two scenarios, one requirement: the shortfall is gone,
      // and it is gone because the `Covers:` line RESOLVED — an unresolved one
      // would silence this check for entirely the wrong reason.
      expect(byCode(findings, "flow.uncovered")).toEqual([]);
      expect(byCode(findings, "covers.unknown")).toEqual([]);
      expect(byCode(findings, "flow.step-unresolved")).toEqual([]);
      expect(code).toBe(0);
    });
  });
});
