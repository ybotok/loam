/**
 * `loam tasks` — the work packet.
 *
 * The properties under test are the ones an orchestrating agent would be
 * damaged by getting wrong: that a unit id IS the verify claim id (so a packet
 * and a checklist can be compared), that the only dependency edge is the exact
 * operation join and never a same-spelling coincidence across namespaces, that
 * a scenario unit carries the words it was minted from rather than a
 * neighbour's, that a stale or unreadable record closes nothing, and that a
 * feeder loam could not read never reads as work that is finished.
 */
import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { LANDSCAPE, LIVING_OPENAPI, LIVING_SPEC, makeProject, runLoam, writeFiles, type Project } from "./helpers/harness.js";
import { featureChecklist, type Checklist } from "../src/core/verify/checklist.js";
import { featureDirOf } from "../src/core/kernel/ids/dirs.js";
import { parseRequirements } from "../src/core/document/parse.js";
import { scenarioDigest } from "../src/core/gherkin/stamp.js";
import { LOAM_VERSION } from "../src/core/envelope/version.js";

const FEAT = "FEAT-2";
const FEATURE_DIR = "features/FEAT-2-split";

/**
 * One tagged op-edge from the consumer to the provider. No tagged ELEMENT, so
 * the fixture mints no `service.exists` claim and the unit set stays small
 * enough to assert in full.
 */
const DELTA = `specification {
  element softwareSystem
  tag FEAT-2
}

model {
  checkoutWeb = softwareSystem 'checkout-web'
  paymentService = softwareSystem 'payment-service'

  checkoutWeb -> paymentService 'Calls createSplit' {
    #FEAT-2
    metadata { op 'createSplit' }
  }
}

views {
  view feat_2 {
    include *
  }
}
`;

const PROVIDER_SPEC = `# payment-service — delta for FEAT-2

## ADDED Requirements

### Requirement: Split a payment
The service SHALL split a payment across payees.

Operations: createSplit

#### Scenario: Split across two payees
- **Given** a payment of 100.00
- **When** it is split 60/40
- **Then** two shares are recorded
`;

const CONSUMER_SPEC = `# checkout-web — delta for FEAT-2

## ADDED Requirements

### Requirement: Request a split
The UI SHALL request a split at checkout.

#### Scenario: Shopper splits the bill
- **Given** a basket
- **When** the shopper splits the bill
- **Then** a split is requested
`;

const PROVIDER_OPENAPI = `openapi: 3.1.0
info:
  title: payment-service
  version: "1.0"
paths:
  /splits:
    post:
      operationId: createSplit
      summary: Create a split
      responses:
        "201":
          description: Created
          content:
            application/json:
              schema:
                type: object
                properties:
                  splitId:
                    type: string
`;

/**
 * An event whose MESSAGE NAME is spelled exactly like the operationId above.
 * It is the discriminator for the dependency join: `event.declares` carries a
 * `token` too, so a join on token equality would wire the call edge to this
 * message declaration. The correct join is the call's `token` against a
 * provider's `operation`, which only `api.exposes` ever carries.
 */
const PROVIDER_ASYNCAPI = `asyncapi: 3.0.0
info:
  title: payment-service events
  version: "1.0"
channels:
  splitEvents:
    address: payment.splits.v1
    messages:
      CreateSplit:
        $ref: '#/components/messages/CreateSplit'
operations:
  sendCreateSplit:
    action: send
    channel:
      $ref: '#/channels/splitEvents'
components:
  messages:
    CreateSplit:
      name: createSplit
      payload:
        type: object
        properties:
          splitId:
            type: string
`;

const CONSUMER_LIVING = `---
service: checkout-web
status: documented
---

# checkout-web

## Requirements

### Requirement: Show a basket
The UI SHALL show a basket.

#### Scenario: Basket renders
- **Given** items
- **When** the page loads
- **Then** the basket renders
`;

function fixture(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    "architecture/landscape.likec4": LANDSCAPE,
    "services/payment-service/spec.md": LIVING_SPEC,
    "services/payment-service/openapi.yaml": LIVING_OPENAPI,
    "services/checkout-web/spec.md": CONSUMER_LIVING,
    [`${FEATURE_DIR}/delta.likec4`]: DELTA,
    [`${FEATURE_DIR}/intent.md`]: `---\nfeature: FEAT-2\nstatus: proposed\n---\n\n# Split payments\n\nLet a shopper split a bill.\n`,
    [`${FEATURE_DIR}/specs/payment-service/spec.md`]: PROVIDER_SPEC,
    [`${FEATURE_DIR}/specs/payment-service/openapi.yaml`]: PROVIDER_OPENAPI,
    [`${FEATURE_DIR}/specs/payment-service/asyncapi.yaml`]: PROVIDER_ASYNCAPI,
    [`${FEATURE_DIR}/specs/checkout-web/spec.md`]: CONSUMER_SPEC,
    ...overrides,
  };
}

/** The checklist as `loam verify` derives it — the thing every unit id is compared against. */
async function derive(p: Project): Promise<Checklist> {
  return featureChecklist(p.docsDir, featureDirOf(join(p.docsDir, FEATURE_DIR)), FEAT);
}

interface Packet {
  ok: boolean;
  command: string;
  feature: string;
  service: string | null;
  services: string[];
  checklist: string;
  record: string;
  stamps: string;
  intent: string | null;
  size: { requirements: number; scenarios: number; operations: number; messages: number; calls: number };
  units: Array<{
    id: string;
    kind: string;
    subject: string;
    at: string;
    claim: string;
    digest?: string;
    operation?: string;
    token?: string;
    dependsOn: string[];
    source?: { path: string; line?: number; requirement: string; scenario?: string; lines?: string[] };
    done: { check: string };
  }>;
  counts: { open: number; done: number; attested: number };
  frontier: string[];
  frontierElided: number;
  waitingOn?: Array<{ id: string; subject: string; kind: string; claim: string }>;
  contracts: { expose: string[]; call: string[] };
  review: string[];
  unreadable: { architecture?: string; contracts?: string[] };
}

async function packetOf(p: Project, ...args: string[]): Promise<{ code: number; payload: Packet; out: string }> {
  const res = await runLoam(p.workDir, "tasks", FEAT, ...args, "--json");
  return { code: res.code, payload: JSON.parse(res.stdout) as Packet, out: res.out };
}

/** One recorded answer, in a record whose summary adds up — `readVerificationState` refuses one that does not. */
function record(checklist: Checklist, answer: { id: string; kind: string; claim: string; by: string }): string {
  return [
    `feature: ${FEAT}`,
    'recorded: "2026-01-01"',
    `checklist: ${checklist.digest}`,
    "summary:",
    `  claims: ${checklist.claims.length}`,
    "  confirmed: 1",
    "  unconfirmed: 0",
    `  unanswered: ${checklist.claims.length - 1}`,
    "claims:",
    `  - id: ${answer.id}`,
    `    kind: ${answer.kind}`,
    `    claim: ${JSON.stringify(answer.claim)}`,
    "    verdict: confirmed",
    `    answered_by: ${answer.by}`,
    "    evidence:",
    '      - "report.json#1"',
    "",
  ].join("\n");
}

describe("loam tasks — the packet", () => {
  it("derives one unit per open claim, with the verify claim ids verbatim", async () => {
    const p = await makeProject(fixture());
    try {
      const checklist = await derive(p);
      const { code, payload } = await packetOf(p);
      expect(code, payload.unreadable.architecture ?? "").toBe(0);
      expect(payload.command).toBe("tasks");
      expect(payload.checklist).toBe(checklist.digest);
      expect(payload.record).toBe("absent");
      expect(payload.service).toBeNull();
      expect(payload.services).toEqual(["checkout-web", "payment-service"]);

      // The claim ids, verbatim and complete: the task id IS the claim id, which
      // is what lets a unit be handed straight to `loam verify`.
      expect(payload.units.map((u) => u.id).sort()).toEqual(checklist.claims.map((c) => c.id).sort());
      expect(payload.units.every((u) => u.at === "generate" || u.at === "implement")).toBe(true);
      expect(payload.counts).toEqual({ open: checklist.claims.length, done: 0, attested: 0 });

      // The order: kinds in CLAIM_KINDS order, so the provider's promise leads
      // the consumer's call.
      expect(payload.units.map((u) => `${u.kind}/${u.subject}`)).toEqual([
        "api.exposes/payment-service",
        "event.declares/payment-service",
        "c4.calls/checkout-web",
        "scenario.tested/checkout-web",
        "scenario.tested/payment-service",
      ]);

      // The ONE edge, and exactly one: the call's token against the provider's
      // `operation`. The event declaration beside it carries a token spelled
      // identically and must never be joined.
      const exposes = payload.units.find((u) => u.kind === "api.exposes")!;
      const calls = payload.units.find((u) => u.kind === "c4.calls")!;
      const declares = payload.units.find((u) => u.kind === "event.declares")!;
      expect(declares.token).toBe("createSplit");
      expect(calls.token).toBe("createSplit");
      expect(calls.dependsOn).toEqual([exposes.id]);
      expect(exposes.dependsOn).toEqual([]);
      expect(declares.dependsOn).toEqual([]);

      expect(payload.contracts).toEqual({ expose: ["createSplit"], call: ["createSplit"] });
      expect(payload.size).toEqual({ requirements: 2, scenarios: 2, operations: 1, messages: 1, calls: 1 });
      expect(payload.intent).toContain("Let a shopper split a bill.");
      expect(payload.frontier).toEqual(payload.units.map((u) => u.id));
      expect(payload.frontierElided).toBe(0);
      expect(payload.review).toHaveLength(4);
      expect(payload.review[0]).toBe(
        `re-derive, do not trust checkmarks: loam tasks ${FEAT} --json and compare open units against the implementer's claim`,
      );
      expect(payload.unreadable).toEqual({});
    } finally {
      await p.destroy();
    }
  });

  it("carries each scenario's own Given/When/Then, and pairs duplicates by occurrence", async () => {
    // Two identically-worded scenarios under one requirement share a digest and
    // are still two questions. They can only be told apart by WHERE they are, so
    // a join that lost the occurrence counter would hand both units one source
    // (or one of them none at all).
    const twins = `# checkout-web — delta for FEAT-2

## ADDED Requirements

### Requirement: Request a split
The UI SHALL request a split at checkout.

#### Scenario: Shopper splits the bill
- **Given** a basket
- **When** the shopper splits the bill
- **Then** a split is requested

#### Scenario: Shopper splits the bill
- **Given** a basket
- **When** the shopper splits the bill
- **Then** a split is requested
`;
    const p = await makeProject(fixture({ [`${FEATURE_DIR}/specs/checkout-web/spec.md`]: twins }));
    try {
      const { payload } = await packetOf(p, "--service", "checkout-web");
      const scenarios = payload.units.filter((u) => u.kind === "scenario.tested");
      expect(scenarios).toHaveLength(2);
      for (const unit of scenarios) {
        expect(unit.source, unit.id).toBeDefined();
        // Verbatim: the capture is the parser's own, blank separator lines and
        // all — these are the bytes the digest was taken over, so the packet
        // must not tidy them.
        expect(unit.source!.lines!.filter((l) => l.trim() !== "")).toEqual([
          "- **Given** a basket",
          "- **When** the shopper splits the bill",
          "- **Then** a split is requested",
        ]);
        expect(unit.source!.path).toBe(`${FEATURE_DIR}/specs/checkout-web/spec.md`);
      }
      // Distinct positions, in document order: the discrimination that a
      // collapsed occurrence counter destroys.
      const lines = scenarios.map((u) => u.source!.line);
      expect(lines[0]).toBeLessThan(lines[1]!);
      expect(new Set(lines).size).toBe(2);
      // The two share a digest — which is exactly why position is the only thing
      // telling them apart.
      expect(scenarios[0]!.digest).toBe(scenarios[1]!.digest);
    } finally {
      await p.destroy();
    }
  });

  it("mints a requirement.described unit for a bare requirement, and retires it when a scenario lands", async () => {
    const bare = `# checkout-web — delta for FEAT-2

## ADDED Requirements

### Requirement: Request a split
The UI SHALL request a split at checkout.
`;
    const p = await makeProject(fixture({ [`${FEATURE_DIR}/specs/checkout-web/spec.md`]: bare }));
    try {
      const before = (await packetOf(p)).payload;
      const described = before.units.filter((u) => u.kind === "requirement.described");
      expect(described).toHaveLength(1);
      const unit = described[0]!;
      expect(unit.at).toBe("describe");
      expect(unit.subject).toBe("checkout-web");
      expect(unit.id.startsWith("requirement.described-")).toBe(true);
      expect(unit.claim).toBe(
        "requirement 'Request a split' (checkout-web, spec.md) has no scenarios — write the Given/When/Then first",
      );
      expect(unit.done.check).toBe("the requirement carries at least one #### Scenario:");
      expect(unit.source!.path).toBe(`${FEATURE_DIR}/specs/checkout-web/spec.md`);
      // Describe leads the packet: nothing under a requirement with no scenario
      // can be generated or tested.
      expect(before.units[0]!.id).toBe(unit.id);
      expect(before.frontier[0]).toBe(unit.id);
      // It is NOT a claim: the checklist never asked about it.
      const checklist = await derive(p);
      expect(checklist.claims.map((c) => c.id)).not.toContain(unit.id);

      await p.write(`${FEATURE_DIR}/specs/checkout-web/spec.md`, CONSUMER_SPEC);
      const after = (await packetOf(p)).payload;
      expect(after.units.filter((u) => u.kind === "requirement.described")).toEqual([]);
    } finally {
      await p.destroy();
    }
  });
});

describe("loam tasks — what the record closes", () => {
  it("a runner-confirmed claim vanishes and is counted done", async () => {
    const p = await makeProject(fixture());
    try {
      const checklist = await derive(p);
      const scenario = checklist.claims.find((c) => c.kind === "scenario.tested" && c.subject === "payment-service")!;
      await p.write(
        `${FEATURE_DIR}/verification.yaml`,
        record(checklist, { id: scenario.id, kind: scenario.kind, claim: scenario.claim, by: "runner" }),
      );
      const { payload } = await packetOf(p);
      expect(payload.record).toBe("recorded");
      expect(payload.units.map((u) => u.id)).not.toContain(scenario.id);
      expect(payload.counts).toEqual({ open: checklist.claims.length - 1, done: 1, attested: 0 });
      expect(payload.frontier).not.toContain(scenario.id);
    } finally {
      await p.destroy();
    }
  });

  it("an agent-confirmed scenario claim stays, at:attested — a word is not a run", async () => {
    const p = await makeProject(fixture());
    try {
      const checklist = await derive(p);
      const scenario = checklist.claims.find((c) => c.kind === "scenario.tested" && c.subject === "payment-service")!;
      await p.write(
        `${FEATURE_DIR}/verification.yaml`,
        record(checklist, { id: scenario.id, kind: scenario.kind, claim: scenario.claim, by: "agent" }),
      );
      const { payload } = await packetOf(p);
      expect(payload.record).toBe("recorded");
      const unit = payload.units.find((u) => u.id === scenario.id);
      expect(unit, "an attested unit must never vanish").toBeDefined();
      expect(unit!.at).toBe("attested");
      expect(payload.counts).toEqual({ open: checklist.claims.length - 1, done: 0, attested: 1 });
      // Attested is complete work, so it never leads the frontier.
      expect(payload.frontier).not.toContain(scenario.id);
    } finally {
      await p.destroy();
    }
  });

  it("a stale record closes nothing, and says so", async () => {
    const p = await makeProject(fixture());
    try {
      const checklist = await derive(p);
      const scenario = checklist.claims.find((c) => c.kind === "scenario.tested" && c.subject === "payment-service")!;
      const tampered = record(checklist, {
        id: scenario.id,
        kind: scenario.kind,
        claim: scenario.claim,
        by: "runner",
      }).replace(`checklist: ${checklist.digest}`, "checklist: 0123456789abcdef");
      await p.write(`${FEATURE_DIR}/verification.yaml`, tampered);
      const { payload } = await packetOf(p);
      expect(payload.record).toBe("stale");
      expect(payload.counts).toEqual({ open: checklist.claims.length, done: 0, attested: 0 });
      expect(payload.units.map((u) => u.id)).toContain(scenario.id);
    } finally {
      await p.destroy();
    }
  });

  it("a record nobody can read closes nothing either", async () => {
    const p = await makeProject(fixture());
    try {
      const checklist = await derive(p);
      await p.write(`${FEATURE_DIR}/verification.yaml`, "claims: [\n  - broken\n");
      const { payload } = await packetOf(p);
      expect(payload.record).toBe("unreadable");
      expect(payload.counts.done).toBe(0);
      expect(payload.counts.open).toBe(checklist.claims.length);
    } finally {
      await p.destroy();
    }
  });
});

describe("loam tasks — the lens and the leaf", () => {
  it("--service narrows to that service's units and names what it waits on", async () => {
    const p = await makeProject(fixture());
    try {
      const { payload } = await packetOf(p, "--service", "checkout-web");
      expect(payload.service).toBe("checkout-web");
      expect(new Set(payload.units.map((u) => u.subject))).toEqual(new Set(["checkout-web"]));
      expect(payload.units.map((u) => u.kind)).toEqual(["c4.calls", "scenario.tested"]);
      expect(payload.contracts).toEqual({ expose: [], call: ["createSplit"] });

      const waiting = payload.waitingOn!;
      expect(waiting).toHaveLength(1);
      expect(waiting[0]!.subject).toBe("payment-service");
      expect(waiting[0]!.kind).toBe("api.exposes");
      expect(waiting[0]!.claim).toContain("createSplit");
      // The edge still points at it, and waitingOn is what stops that id reading
      // as dangling under the lens.
      expect(payload.units.find((u) => u.kind === "c4.calls")!.dependsOn).toEqual([waiting[0]!.id]);
    } finally {
      await p.destroy();
    }
  });

  it("the whole-feature packet carries no waitingOn at all", async () => {
    const p = await makeProject(fixture());
    try {
      const { payload } = await packetOf(p);
      expect(payload.waitingOn).toBeUndefined();
    } finally {
      await p.destroy();
    }
  });

  it("--next is exactly the frontier head, with the counts left whole", async () => {
    const p = await makeProject(fixture());
    try {
      const whole = (await packetOf(p)).payload;
      const { payload } = await packetOf(p, "--next");
      expect(payload.units).toHaveLength(1);
      expect(payload.units[0]!.id).toBe(whole.frontier[0]);
      expect(payload.frontier).toEqual(whole.frontier);
      expect(payload.counts).toEqual(whole.counts);

      const human = await runLoam(p.workDir, "tasks", FEAT, "--next");
      expect(human.code).toBe(0);
      expect(human.stdout).toContain(`${FEAT} — next: ${whole.frontier[0]}`);
      expect(human.stdout).toContain("done: operationId 'createSplit' reported passed via loam verify");
      expect(human.stdout).toContain(`loam verify ${FEAT} --record answers.json --service payment-service`);
    } finally {
      await p.destroy();
    }
  });

  it("caps the frontier at ten and says how many were elided", async () => {
    const many = [
      "# checkout-web — delta for FEAT-2",
      "",
      "## ADDED Requirements",
      "",
      "### Requirement: Request a split",
      "The UI SHALL request a split at checkout.",
      "",
      ...Array.from({ length: 14 }, (_, i) => [
        `#### Scenario: Split case ${i + 1}`,
        "- **Given** a basket",
        `- **When** case ${i + 1} happens`,
        "- **Then** a split is requested",
        "",
      ]).flat(),
    ].join("\n");
    const p = await makeProject(fixture({ [`${FEATURE_DIR}/specs/checkout-web/spec.md`]: many }));
    try {
      const { payload } = await packetOf(p, "--service", "checkout-web");
      expect(payload.counts.open).toBe(15);
      expect(payload.frontier).toHaveLength(10);
      expect(payload.frontierElided).toBe(5);
      expect(payload.frontier).toEqual(payload.units.slice(0, 10).map((u) => u.id));

      // The human view caps per service and points at the lens for the rest.
      const human = await runLoam(p.workDir, "tasks", FEAT);
      expect(human.stdout).toContain(`+3 more — loam tasks ${FEAT} --service checkout-web --json`);
    } finally {
      await p.destroy();
    }
  });
});

describe("loam tasks — stamps, blind spots and refusals", () => {
  it("a generated stamp moves a scenario unit from generate to implement", async () => {
    const twoScenarios = `${PROVIDER_SPEC}
#### Scenario: Split across three payees
- **Given** a payment of 90.00
- **When** it is split three ways
- **Then** three shares are recorded
`;
    const p = await makeProject(fixture({ [`${FEATURE_DIR}/specs/payment-service/spec.md`]: twoScenarios }), {
      service: "payment-service",
    });
    try {
      // The bound repo's generated suite, written by hand with the REAL digest —
      // the same recipe `loam gherkin` stamps and `loam verify --results` matches.
      const first = parseRequirements(twoScenarios)[0]!.scenarios[0]!;
      const digest = scenarioDigest("payment-service", first.lines);
      await writeFiles(p.workDir, {
        "features/loam/split-a-payment.feature": [
          `# generated by loam v${LOAM_VERSION} — \`loam gherkin\`; do not hand-edit, regenerate instead`,
          "@FEAT-2",
          "Feature: Split a payment",
          "",
          `  @loam-digest-${digest}`,
          "  Scenario: Split across two payees",
          "    Given a payment of 100.00",
          "",
        ].join("\n"),
      });

      const bound = (await packetOf(p, "--service", "payment-service")).payload;
      expect(bound.stamps).toBe("read");
      const steps = bound.units
        .filter((u) => u.kind === "scenario.tested")
        .map((u) => [u.source!.scenario, u.at]);
      expect(steps).toEqual([
        ["Split across two payees", "implement"],
        ["Split across three payees", "generate"],
      ]);
    } finally {
      await p.destroy();
    }
  });

  it("without a binding the stamps are unknown, and no unit is graded on a suite nobody read", async () => {
    const twoScenarios = `${PROVIDER_SPEC}
#### Scenario: Split across three payees
- **Given** a payment of 90.00
- **When** it is split three ways
- **Then** three shares are recorded
`;
    const p = await makeProject(fixture({ [`${FEATURE_DIR}/specs/payment-service/spec.md`]: twoScenarios }));
    try {
      const { payload } = await packetOf(p, "--service", "payment-service");
      expect(payload.stamps).toBe("unknown");
      expect(payload.units.filter((u) => u.kind === "scenario.tested").map((u) => u.at)).toEqual([
        "implement",
        "implement",
      ]);
    } finally {
      await p.destroy();
    }
  });

  it("an unparseable delta.likec4 exits 1 with ok:true and names the blind spot", async () => {
    const p = await makeProject(fixture({ [`${FEATURE_DIR}/delta.likec4`]: "model { this is not likec4 (" }));
    try {
      const { code, payload } = await packetOf(p);
      expect(code, "a thin packet over a document nobody could read must not exit 0").toBe(1);
      expect(payload.ok).toBe(true);
      expect(payload.unreadable.architecture).toBeDefined();
      // The c4.calls claim is gone because nothing could be read, which is
      // exactly the state the exit code exists to distinguish from "done".
      expect(payload.units.map((u) => u.kind)).not.toContain("c4.calls");

      const human = await runLoam(p.workDir, "tasks", FEAT);
      expect(human.code).toBe(1);
      expect(human.stdout).toContain("delta.likec4 does not parse");
    } finally {
      await p.destroy();
    }
  });

  it("an unreadable contract delta names the service it could not read", async () => {
    const p = await makeProject(fixture({ [`${FEATURE_DIR}/specs/payment-service/openapi.yaml`]: "paths: [\n  - :\n" }));
    try {
      const { code, payload } = await packetOf(p);
      expect(code).toBe(1);
      expect(payload.ok).toBe(true);
      expect(payload.unreadable.contracts).toEqual(["payment-service"]);
    } finally {
      await p.destroy();
    }
  });

  it("refuses an unknown feature, an archived one, an illegal --service and a service nobody has", async () => {
    const p = await makeProject(fixture());
    try {
      const missing = JSON.parse((await runLoam(p.workDir, "tasks", "FEAT-99", "--json")).stdout);
      expect(missing.ok).toBe(false);
      expect(missing.error.code).toBe("unknown-target");

      const illegal = JSON.parse(
        (await runLoam(p.workDir, "tasks", FEAT, "--service", "../../etc", "--json")).stdout,
      );
      expect(illegal.error.code).toBe("invalid-option");

      const stranger = JSON.parse(
        (await runLoam(p.workDir, "tasks", FEAT, "--service", "checkout-wep", "--json")).stdout,
      );
      expect(stranger.error.code).toBe("unknown-target");
      expect(stranger.error.message).toContain("did you mean 'checkout-web'");
    } finally {
      await p.destroy();
    }
  });

  it("an archived feature is refused rather than given an invented packet", async () => {
    const p = await makeProject(fixture());
    try {
      const archived = await runLoam(p.workDir, "archive", FEAT, "--approve");
      expect(archived.code, archived.out).toBe(0);
      const res = await runLoam(p.workDir, "tasks", FEAT, "--json");
      const payload = JSON.parse(res.stdout);
      expect(payload.ok).toBe(false);
      expect(payload.error.code).toBe("unknown-target");
      expect(payload.error.message).toContain("already archived");
    } finally {
      await p.destroy();
    }
  });

  it("writes nothing: the docs tree is byte-identical after a run", async () => {
    const p = await makeProject(fixture());
    try {
      const { treeHashes } = await import("./helpers/harness.js");
      const before = await treeHashes(p.docsDir);
      await runLoam(p.workDir, "tasks", FEAT, "--json");
      await runLoam(p.workDir, "tasks", FEAT, "--next");
      expect(await treeHashes(p.docsDir)).toEqual(before);
    } finally {
      await p.destroy();
    }
  });
});

