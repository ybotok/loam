/**
 * `loam steps` — the step-phrase inventory, and the recipe it counts by.
 *
 * The recipe is the contract here. A team writes its step definitions against
 * the groups this reports, so a key that drifts re-partitions their registry
 * silently: every case below is a pin, not an illustration. The inventory's own
 * properties — keyword independence, deterministic ordering, REMOVED exemption
 * — are pinned for the same reason.
 */
import { describe, expect, it, afterEach } from "vitest";
import { makeProject, runLoam, type Project } from "./helpers/harness.js";
import { phraseOf, keywordOf } from "../src/core/gherkin/steps/phrase.js";
import { coveringPhrases, stepInventory } from "../src/core/gherkin/steps/inventory.js";
import { parseRequirements } from "../src/core/document/parse.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!();
});

const key = (s: string): string => phraseOf(s).key;
const family = (s: string): string => phraseOf(s).family;

describe("the phrase key: what makes two written steps one step definition", () => {
  it("drops the keyword, because a runner resolves them all against one registry", () => {
    expect(key("Given the ledger is open")).toBe("the ledger is open");
    expect(key("And the ledger is open")).toBe("the ledger is open");
    expect(key("Then the ledger is open")).toBe("the ledger is open");
    // …and the keyword is still recoverable for the report.
    expect(keywordOf("And the ledger is open")).toBe("And");
    expect(keywordOf("no keyword here")).toBe("");
  });

  it("collapses exactly what a step definition captures as an argument", () => {
    expect(key('When the caller posts "order-1" twice')).toBe("the caller posts {s} twice");
    expect(key("When a caller holding <permission> asks")).toBe("a caller holding {p} asks");
    expect(key("Then the response is 404")).toBe("the response is {n}");
    expect(key("Then the fee is 1.20")).toBe("the fee is {n}");
    expect(key("Given a payment in 'EUR' worth `100`")).toBe("a payment in {s} worth {s}");
  });

  it("reads a quoted placeholder as a placeholder, not as a string", () => {
    // `"<tier>"` is a parameter, and collapsing the quotes first would swallow
    // the angle brackets and hide it inside {s}.
    expect(key('Given a payment on tier "<tier>"')).toBe("a payment on tier {p}");
  });

  it("leaves a number that is part of a word alone", () => {
    expect(key("Given an oauth2 grant for v1 of the api")).toBe("an oauth2 grant for v1 of the api");
  });

  it("gathers a leading article and a trailing rationale into one family", () => {
    expect(family("Then the fan-in barrier outcome is 'passed'")).toBe("fan-in barrier outcome is {s}");
    expect(family("Then fan-in barrier outcome is 'passed'")).toBe("fan-in barrier outcome is {s}");
    expect(family("Then deduplication does not start while a branch is running")).toBe(
      "deduplication does not start",
    );
    expect(family('Then branch "b" passes because the window is open')).toBe("branch {s} passes");
  });
});

/** One requirement holding exactly the steps a case needs. */
function spec(steps: string[], kind = "Requirements"): ReturnType<typeof parseRequirements> {
  return parseRequirements(
    [`## ${kind}`, "", "### Requirement: R", "Body.", "", "#### Scenario: S", ...steps].join("\n"),
  );
}

describe("the inventory", () => {
  it("counts one row for a phrase written under two keywords, and names both", () => {
    const inv = stepInventory([
      { axis: "business", reqs: spec(["- **Given** the ledger is open", "- **And** the ledger is open"]) },
    ]);
    expect(inv.steps).toBe(2);
    expect(inv.phrases).toHaveLength(1);
    expect(inv.phrases[0]!.count).toBe(2);
    expect(inv.phrases[0]!.keywords).toEqual(["And", "Given"]);
  });

  it("orders by count then key, so two runs are diffable", () => {
    const inv = stepInventory([
      {
        axis: "business",
        reqs: spec([
          "- **Given** zebra",
          "- **And** alpha",
          "- **Then** common",
          "- **And** common",
          "- **And** common",
        ]),
      },
    ]);
    // Count descending; the two singletons break their tie alphabetically, not
    // by whichever the Map happened to yield first.
    expect(inv.phrases.map((p) => p.key)).toEqual(["common", "alpha", "zebra"]);
  });

  it("reports a near-duplicate group and does not merge it", () => {
    const inv = stepInventory([
      {
        axis: "business",
        reqs: spec([
          "- **Then** the fan-in barrier outcome is 'passed'",
          "- **And** fan-in barrier outcome is 'passed'",
        ]),
      },
    ]);
    // Two definitions where one was meant — reported, because the fix is the
    // author's wording and a merge here would hide it.
    expect(inv.phrases).toHaveLength(2);
    expect(inv.nearDuplicates).toEqual([
      {
        family: "fan-in barrier outcome is {s}",
        keys: ["fan-in barrier outcome is {s}", "the fan-in barrier outcome is {s}"],
      },
    ]);
  });

  it("skips a REMOVED requirement, as every other scenario check does", () => {
    const inv = stepInventory([{ axis: "business", reqs: spec(["- **Given** gone"], "REMOVED Requirements") }]);
    expect(inv.steps).toBe(0);
    expect(inv.phrases).toEqual([]);
  });

  it("answers zero for an empty suite instead of dividing by it", () => {
    expect(coveringPhrases({ steps: 0, phrases: [], nearDuplicates: [] })).toBe(0);
  });

  it("counts the phrases that cover the share, never one fewer", () => {
    const inv = stepInventory([
      {
        axis: "business",
        reqs: spec([
          ...Array.from({ length: 8 }, () => "- **Given** common"),
          "- **Then** rare one",
          "- **Then** rare two",
        ]),
      },
    ]);
    // 8 of 10 is exactly 80%, and one phrase reaches it.
    expect(coveringPhrases(inv)).toBe(1);
  });
});

async function project(files: Record<string, string>, service: string): Promise<Project> {
  const p = await makeProject(files, { service });
  cleanups.push(() => p.destroy());
  return p;
}

const SPEC = `---
service: payment-service
status: draft
---

# payment-service

## Requirements

### Requirement: Refunds are permission-gated
The service SHALL gate refunds.

#### Scenario: By permission
- **Given** a captured payment
- **When** a caller holding "payments:refund" asks
- **Then** the response is 200
- **And** metric "refund_total" increments by 1

#### Scenario: Without permission
- **Given** a captured payment
- **When** a caller holding "payments:read" asks
- **Then** the response is 403
- **And** metric "refund_total" increments by 0
`;

describe("the command", () => {
  it("reports the two numbers a team plans from, over both axes", async () => {
    const p = await project(
      {
        "services/payment-service/spec.md": SPEC,
        "services/payment-service/arch.spec.md": SPEC.replace(
          "### Requirement: Refunds are permission-gated",
          "### Requirement: Refunds leave through the outbox",
        ),
      },
      "payment-service",
    );
    const res = await runLoam(p.workDir, "steps", "--json");
    expect(res.code).toBe(0);
    const payload = JSON.parse(res.stdout) as {
      service: string;
      steps: number;
      phrases: number;
      covering80: number;
      rows: Array<{ key: string; count: number; keywords: string[]; uses: Array<{ axis: string }> }>;
    };
    expect(payload.service).toBe("payment-service");
    // Eight steps per axis, and both axes are read: the arch spec is not a
    // second opinion, it is more of this service's suite.
    expect(payload.steps).toBe(16);
    const captured = payload.rows.find((r) => r.key === "a captured payment")!;
    expect(captured.count).toBe(4);
    expect([...new Set(captured.uses.map((u) => u.axis))].sort()).toEqual(["arch", "business"]);
    // Four phrases, four uses each: the literals collapse the two scenarios of
    // each axis onto one another, which is the whole point of the key. A
    // perfectly uniform corpus needs every phrase to reach 80% — the headline
    // number is honest about a suite with no dominant step, not flattering.
    expect(payload.phrases).toBe(4);
    expect(payload.covering80).toBe(4);
    expect(payload.rows.reduce((a, r) => a + r.count, 0)).toBe(payload.steps);
  });

  it("refuses a service with no living spec rather than reporting an empty suite", async () => {
    const p = await project({ "services/payment-service/spec.md": SPEC }, "payment-service");
    const res = await runLoam(p.workDir, "steps", "--service", "ghost-service", "--json");
    expect(res.code).toBe(1);
    const payload = JSON.parse(res.stdout) as { ok: boolean; error: { code: string } };
    expect(payload.ok).toBe(false);
    expect(payload.error.code).toBe("unknown-target");
  });
});
