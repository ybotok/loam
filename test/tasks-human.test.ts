/**
 * `loam tasks` — the view a person reads, and the lens a service repository
 * defaults to.
 *
 * The JSON packet is pinned in ./tasks.test.ts. What is pinned here is what the
 * human view promises on top of it: each row is an ACTION (the step and the
 * kind pick the verb) rather than the claim it answers; rows are filed under
 * their service and then their requirement, whose file is printed once rather
 * than on every row; every row keeps the unit id an agent hands `loam verify`;
 * a lens lists every unit, and the whole-feature cap points at the lens rather
 * than at `--json`; and a run from a service repository is about THAT service
 * when the feature touches it, because the stamps that tell `generate` from
 * `implement` are read from that repository alone.
 */
import { describe, expect, it } from "vitest";
import { join } from "node:path";
import {
  coherentFixture,
  FEATURE_ASYNCAPI,
  LIVING_ASYNCAPI,
  makeProject,
  runLoam,
  type Project,
} from "./helpers/harness.js";
import { featureChecklist } from "../src/core/verify/checklist.js";
import { featureDirOf } from "../src/core/kernel/ids/dirs.js";

const FEAT = "FEAT-1";
const FEATURE_DIR = "features/FEAT-1-split";
const SPLIT_SPEC = `${FEATURE_DIR}/specs/payment-split-service/spec.md`;

/** Two scenarios under one requirement, so "the file once per requirement" is a claim a run can falsify. */
const TWO_SCENARIOS = `# payment-split-service — delta for FEAT-1

## ADDED Requirements

### Requirement: Split a payment
The service SHALL split a payment across payees summing to the total.

Operations: createSplit

#### Scenario: Split across two payees
- **Given** a payment of 100.00
- **When** it is split 60/40
- **Then** two shares are recorded

#### Scenario: Split across three payees
- **Given** a payment of 90.00
- **When** it is split three ways
- **Then** three shares are recorded
`;

/**
 * The coherent fixture, plus an event delta for payment-service whose one NEW
 * message is payment.Refunded (payment.Authorized is quoted from the living
 * contract and promises nothing) — so every kind but describe has a row.
 */
function fixture(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    ...coherentFixture(),
    "services/payment-service/asyncapi.yaml": LIVING_ASYNCAPI,
    [`${FEATURE_DIR}/specs/payment-service/asyncapi.yaml`]: FEATURE_ASYNCAPI,
    [SPLIT_SPEC]: TWO_SCENARIOS,
    ...overrides,
  };
}

interface Unit {
  id: string;
  kind: string;
  subject: string;
  at: string;
  source?: { path: string; line?: number; scenario?: string };
}

interface Packet {
  service: string | null;
  units: Unit[];
  waitingOn?: Array<{ id: string; subject: string; kind: string }>;
}

async function packetOf(p: Project, ...args: string[]): Promise<Packet> {
  const res = await runLoam(p.workDir, "tasks", FEAT, ...args, "--json");
  expect(res.code, res.out).toBe(0);
  return JSON.parse(res.stdout) as Packet;
}

async function human(p: Project, ...args: string[]): Promise<string[]> {
  const res = await runLoam(p.workDir, "tasks", FEAT, ...args);
  expect(res.code, res.out).toBe(0);
  return res.stdout.split("\n");
}

/** The one printed row carrying this unit id. Exactly one: a unit is never listed twice. */
function rowOf(lines: readonly string[], id: string): string {
  const rows = lines.filter((line) => line.includes(id) && line.trimStart().startsWith("["));
  expect(rows, `rows for ${id}`).toHaveLength(1);
  return rows[0]!.trim();
}

function unit(packet: Packet, kind: string, scenario?: string): Unit {
  const found = packet.units.find((u) => u.kind === kind && (scenario === undefined || u.source?.scenario === scenario));
  expect(found, `${kind} ${scenario ?? ""}`).toBeDefined();
  return found!;
}

/** A one-answer verification record whose summary adds up — `readVerificationState` refuses one that does not. */
async function attest(p: Project, scenario: string): Promise<void> {
  const checklist = await featureChecklist(p.docsDir, featureDirOf(join(p.docsDir, FEATURE_DIR)), FEAT);
  const claim = checklist.claims.find((c) => c.kind === "scenario.tested" && c.claim.includes(`'${scenario}'`))!;
  await p.write(
    `${FEATURE_DIR}/verification.yaml`,
    [
      `feature: ${FEAT}`,
      'recorded: "2026-01-01"',
      `checklist: ${checklist.digest}`,
      "summary:",
      `  claims: ${checklist.claims.length}`,
      "  confirmed: 1",
      "  unconfirmed: 0",
      `  unanswered: ${checklist.claims.length - 1}`,
      "claims:",
      `  - id: ${claim.id}`,
      `    kind: ${claim.kind}`,
      `    claim: ${JSON.stringify(claim.claim)}`,
      "    verdict: confirmed",
      "    answered_by: agent",
      "    evidence:",
      '      - "test/split.test.ts:1"',
      "",
    ].join("\n"),
  );
}

describe("loam tasks — the human view is a to-do list", () => {
  it("files every unit under its service and requirement, as an action, with its id", async () => {
    const p = await makeProject(fixture());
    try {
      const packet = await packetOf(p);
      const lines = await human(p);

      // Every unit has exactly one row, tagged with its step and carrying its
      // id — the id is what an agent hands `loam verify`, and the old view
      // printed it nowhere but the frontier.
      for (const u of packet.units) expect(rowOf(lines, u.id).startsWith(`[${u.at}]`), u.id).toBe(true);

      const twoPayees = unit(packet, "scenario.tested", "Split across two payees");
      const threePayees = unit(packet, "scenario.tested", "Split across three payees");
      expect(rowOf(lines, twoPayees.id)).toBe(
        `[implement] make scenario 'Split across two payees' pass, then record the run · line ${twoPayees.source!.line} · ${twoPayees.id}`,
      );
      expect(rowOf(lines, threePayees.id)).toContain("make scenario 'Split across three payees' pass, then record the run");
      expect(rowOf(lines, unit(packet, "api.exposes").id)).toBe(
        `[implement] expose operation 'createSplit' (contract-test evidence closes it) · ${unit(packet, "api.exposes").id}`,
      );
      expect(rowOf(lines, unit(packet, "service.exists").id)).toContain("create service 'payment-split-service'");
      expect(rowOf(lines, unit(packet, "c4.calls").id)).toContain("call 'createSplit' on payment-split-service");
      expect(rowOf(lines, unit(packet, "event.declares").id)).toContain("send message 'payment.Refunded'");

      // The claim prose is the payload's and --next's; no row reads as a ledger entry.
      expect(lines.join("\n")).not.toContain("is covered by a test");

      // Service, then the heading, then its rows — and the requirement's file
      // printed ONCE over both of its scenarios, not on each row.
      const at = (text: string): number => lines.findIndex((line) => line.trim() === text);
      const split = at("payment-split-service — 4 open");
      const heading = at(`requirement 'Split a payment' — ${SPLIT_SPEC}`);
      expect(split).toBeGreaterThanOrEqual(0);
      expect(heading).toBeGreaterThan(split);
      expect(lines.indexOf(lines.find((l) => l.includes(twoPayees.id))!)).toBe(heading + 1);
      expect(lines.indexOf(lines.find((l) => l.includes(threePayees.id))!)).toBe(heading + 2);
      expect(lines.filter((line) => line.includes(SPLIT_SPEC))).toHaveLength(1);
      expect(at("contract — operations and messages")).toBeGreaterThan(split);
      expect(at("payment-service — 2 open")).toBeGreaterThan(heading);
      expect(at("architecture — delta.likec4")).toBeGreaterThan(split);
    } finally {
      await p.destroy();
    }
  });

  it("says in words what the record and the stamps mean, and what is next up", async () => {
    const p = await makeProject(fixture());
    try {
      const packet = await packetOf(p);
      const text = (await human(p)).join("\n");
      expect(text).toContain("record: absent — no verification record yet");
      expect(text).toContain(
        "stamps: unknown — this is not a service repository bound with loam.json, so loam cannot see which tests were generated",
      );
      expect(text).toContain("view: the whole feature (payment-service, payment-split-service)");

      // The frontier leads with the head's action, then the ids — never a bare
      // list of hashes nobody can act on.
      const head = packet.units[0]!;
      expect(text).toContain(`next up (payment-split-service): create service 'payment-split-service' · ${head.id}`);
      expect(text).toContain(`loam tasks ${FEAT} --next prints it in full`);
      expect(text).toContain("`loam explain <word>`");
      expect(text).not.toContain("  frontier: ");
    } finally {
      await p.destroy();
    }
  });

  it("phrases describe, generate and attested as the act each one asks for", async () => {
    const bare = `${TWO_SCENARIOS}
### Requirement: Refund a split
The service SHALL refund a recorded split.
`;
    // Bound to payment-split-service with no generated suite: the stamps are
    // READ and empty, so every scenario honestly waits at generate.
    const p = await makeProject(fixture({ [SPLIT_SPEC]: bare }), { service: "payment-split-service" });
    try {
      const packet = await packetOf(p);
      const lines = await human(p);
      const described = unit(packet, "requirement.described");
      expect(rowOf(lines, described.id)).toBe(
        `[describe]  write the scenarios for requirement 'Refund a split' — at least one Given/When/Then, in the docs repo · ${described.id}`,
      );
      // A describe unit's line IS the requirement heading's, so it rides there.
      expect(lines.map((l) => l.trim())).toContain(`requirement 'Refund a split' — ${SPLIT_SPEC}:${described.source!.line}`);
      expect(rowOf(lines, unit(packet, "scenario.tested", "Split across two payees").id)).toContain(
        `[generate]  generate the test for scenario 'Split across two payees' (loam gherkin ${FEAT})`,
      );

      await attest(p, "Split across three payees");
      const attested = unit(await packetOf(p), "scenario.tested", "Split across three payees");
      expect(attested.at).toBe("attested");
      const after = await human(p);
      expect(rowOf(after, attested.id)).toContain(
        "[attested]  re-answer scenario 'Split across three payees' from a test run — it rests on an agent's word",
      );
      expect(after[0]).toContain("1 attested (confirmed on an agent's word, not a run — still listed)");
    } finally {
      await p.destroy();
    }
  });

  it("--next leads with the action and still prints the Given/When/Then verbatim", async () => {
    // No delta and no contract: the only units are scenarios, so the head is one.
    const files = fixture();
    delete files[`${FEATURE_DIR}/delta.likec4`];
    delete files[`${FEATURE_DIR}/specs/payment-split-service/openapi.yaml`];
    delete files[`${FEATURE_DIR}/specs/payment-service/asyncapi.yaml`];
    const p = await makeProject(files);
    try {
      const head = (await packetOf(p)).units[0]!;
      const lines = await human(p, "--next");
      expect(lines[0]).toBe(`${FEAT} — next: ${head.id}`);
      expect(lines[1]).toBe(`  make scenario '${head.source!.scenario}' pass, then record the run`);
      // Not bound, so nobody looked for the generated test: `implement` must not
      // read as "the test exists".
      expect(lines.join("\n")).toContain("whether this scenario's test was generated is unknown here");
      expect(lines).toEqual(
        expect.arrayContaining([
          "    - **Given** a payment of 100.00",
          "    - **When** it is split 60/40",
          "    - **Then** two shares are recorded",
        ]),
      );
    } finally {
      await p.destroy();
    }
  });
});

describe("loam tasks — the per-service cap", () => {
  const many = [
    "# payment-split-service — delta for FEAT-1",
    "",
    "## ADDED Requirements",
    "",
    "### Requirement: Split a payment",
    "The service SHALL split a payment across payees summing to the total.",
    "",
    "Operations: createSplit",
    "",
    ...Array.from({ length: 14 }, (_, i) => [
      `#### Scenario: Split case ${i + 1}`,
      "- **Given** a payment of 100.00",
      `- **When** case ${i + 1} happens`,
      "- **Then** the shares are recorded",
      "",
    ]).flat(),
  ].join("\n");

  it("a lens lists every unit, and nothing points at --json", async () => {
    const p = await makeProject(fixture({ [SPLIT_SPEC]: many }));
    try {
      const packet = await packetOf(p, "--service", "payment-split-service");
      expect(packet.units.length).toBeGreaterThan(12);
      const lines = await human(p, "--service", "payment-split-service");
      // The lens used to elide past twelve too, and send the reader to --json.
      expect(lines.filter((line) => line.includes(" more — "))).toEqual([]);
      for (const u of packet.units) rowOf(lines, u.id);
      expect(lines.join("\n")).toContain("lens: payment-split-service — its units only, every one listed");
    } finally {
      await p.destroy();
    }
  });

  it("the whole view caps a service and points at its lens — the full human listing", async () => {
    const p = await makeProject(fixture({ [SPLIT_SPEC]: many }));
    try {
      const packet = await packetOf(p);
      const split = packet.units.filter((u) => u.subject === "payment-split-service");
      const lines = await human(p);
      const pointer = lines.filter((line) => line.includes(" more — "));
      expect(pointer.map((line) => line.trim())).toEqual([
        `+${split.length - 12} more — \`loam tasks ${FEAT} --service payment-split-service\` lists every one`,
      ]);
      expect(pointer[0]).not.toContain("--json");
      // The first twelve, in packet order, and not one more.
      for (const u of split.slice(0, 12)) rowOf(lines, u.id);
      for (const u of split.slice(12)) expect(lines.some((line) => line.includes(u.id) && line.trimStart().startsWith("["))).toBe(false);
    } finally {
      await p.destroy();
    }
  });
});

describe("loam tasks — a service repository's own lens", () => {
  it("defaults the lens to the bound service when the feature touches it", async () => {
    const p = await makeProject(fixture(), { service: "payment-service" });
    try {
      const packet = await packetOf(p);
      expect(packet.service).toBe("payment-service");
      expect(new Set(packet.units.map((u) => u.subject))).toEqual(new Set(["payment-service"]));
      // A lens adds what it waits on elsewhere: the call needs the provider's operation.
      expect(packet.waitingOn?.map((w) => `${w.kind}/${w.subject}`)).toEqual(["api.exposes/payment-split-service"]);

      const text = (await human(p)).join("\n");
      expect(text).toContain("lens: payment-service — this repository's service (loam.json); pass --service <id> for another");
      expect(text).toContain("stamps: read — from this repository's generated suite (payment-service)");
      expect(text).toContain("waiting on payment-split-service:");
      expect(text).not.toMatch(/^  payment-split-service — /m);

      // --next is the bound service's head, and says why it is this service's.
      const next = (await human(p, "--next")).join("\n");
      expect(next).toContain(`${FEAT} — next: ${packet.units[0]!.id}`);
      expect(next).toContain("lens: payment-service — this repository's service (loam.json)");
    } finally {
      await p.destroy();
    }
  });

  it("an explicit --service still wins, and says whose suite the stamps came from", async () => {
    const p = await makeProject(fixture(), { service: "payment-service" });
    try {
      const packet = await packetOf(p, "--service", "payment-split-service");
      expect(packet.service).toBe("payment-split-service");
      // Another repository's scenarios are never graded on this one's suite.
      expect(packet.units.filter((u) => u.kind === "scenario.tested").map((u) => u.at)).toEqual(["implement", "implement"]);
      const text = (await human(p, "--service", "payment-split-service")).join("\n");
      expect(text).toContain("lens: payment-split-service — its units only");
      expect(text).toContain(
        "payment-split-service keeps its tests in its own repository, so its scenarios read 'implement' whatever is generated there",
      );

      // A typo is still refused rather than answered with an empty packet.
      const typo = JSON.parse((await runLoam(p.workDir, "tasks", FEAT, "--service", "paymnt-service", "--json")).stdout);
      expect(typo.ok).toBe(false);
      expect(typo.error.code).toBe("unknown-target");
    } finally {
      await p.destroy();
    }
  });

  it("keeps the whole feature when the feature does not touch the bound service", async () => {
    const p = await makeProject(fixture(), { service: "checkout-web" });
    try {
      const packet = await packetOf(p);
      expect(packet.service).toBeNull();
      expect(packet.waitingOn).toBeUndefined();
      expect(new Set(packet.units.map((u) => u.subject))).toEqual(new Set(["payment-service", "payment-split-service"]));
      const text = (await human(p)).join("\n");
      expect(text).toContain(
        `view: the whole feature (payment-service, payment-split-service) — this repository's service, checkout-web, is not one ${FEAT} touches`,
      );
    } finally {
      await p.destroy();
    }
  });
});
