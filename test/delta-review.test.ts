/**
 * `loam delta --diff` — the design review's question: what does each
 * requirement, operation and message in this slice do to the living documents?
 *
 * On the authoring pull request nothing answered it. `delta` printed the new
 * text whole, `show` counted, and `loam diff` on a branch whose only change is a
 * delta said "no fleet-meaningful changes" — so a reviewer opened both files, or
 * approved a clause they never saw go.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cp, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { lineDiff, reviewRequirements } from "../src/core/projection/review.js";
import { parseRequirements } from "../src/core/document/parse.js";
import { coherentFixture, makeProject, makeTmpDir, runLoam } from "./helpers/harness.js";

const SHIPPED_EXAMPLE = fileURLToPath(new URL("../examples/docs", import.meta.url));

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!();
});

const LIVING = `## Requirements

### Requirement: Authorize a payment
Requirement-ID: PAY-1
The service SHALL reserve funds.

#### Scenario: Reserved
- **Given** an order
- **When** authorization is requested
- **Then** funds are reserved

### Requirement: Refund a payment
Requirement-ID: PAY-2
The service SHALL refund.

#### Scenario: Refunded
- **Given** a capture
- **When** a refund is requested
- **Then** the money goes back
`;

describe("lineDiff", () => {
  it("keeps what both carry, and marks what goes and what comes in order", () => {
    expect(lineDiff(["a", "b", "c"], ["a", "x", "c"])).toEqual([
      { op: "=", line: "a" },
      { op: "-", line: "b" },
      { op: "+", line: "x" },
      { op: "=", line: "c" },
    ]);
    expect(lineDiff([], ["x"])).toEqual([{ op: "+", line: "x" }]);
  });

  it("past its table bound says the whole before went and the whole after came — still true", () => {
    const before = Array.from({ length: 2001 }, (_, i) => `b${i}`);
    const after = Array.from({ length: 2001 }, (_, i) => `a${i}`);
    const diff = lineDiff(before, after);
    expect(diff).toHaveLength(4002);
    expect(diff[0]).toEqual({ op: "-", line: "b0" });
    expect(diff[2001]).toEqual({ op: "+", line: "a0" });
  });
});

describe("reviewRequirements — paired the way the merge pairs them", () => {
  const living = parseRequirements(LIVING);

  it("a MODIFIED restating the living text is a quote — its Based-On pin aside", () => {
    const delta = parseRequirements(
      LIVING.replace("## Requirements", "## MODIFIED Requirements").replace(
        "Requirement-ID: PAY-1",
        "Requirement-ID: PAY-1\nBased-On: 0123456789abcdef",
      ).split("### Requirement: Refund")[0]!,
    );
    expect(reviewRequirements(delta, living)).toEqual([{ change: "quote" }]);
  });

  it("an edit carries the line diff from the living text to the merged one", () => {
    const delta = parseRequirements(
      "## MODIFIED Requirements\n\n### Requirement: Authorize a payment\nRequirement-ID: PAY-1\n" +
        "The service SHALL reserve funds, once per order.\n\n#### Scenario: Reserved\n" +
        "- **Given** an order\n- **When** authorization is requested\n- **Then** funds are reserved\n",
    );
    const [review] = reviewRequirements(delta, living);
    expect(review!.change).toBe("edit");
    expect(review!.diff).toContainEqual({ op: "-", line: "The service SHALL reserve funds." });
    expect(review!.diff).toContainEqual({ op: "+", line: "The service SHALL reserve funds, once per order." });
    expect(review!.diff).toContainEqual({ op: "=", line: "Requirement-ID: PAY-1" });
  });

  it("a removal shows the living text going; an addition, and a MODIFIED that lands on nothing, are new", () => {
    const delta = parseRequirements(
      "## REMOVED Requirements\n\n### Requirement: Refund a payment\nRequirement-ID: PAY-2\n\n" +
        "## ADDED Requirements\n\n### Requirement: Split a payment\nThe service SHALL split.\n\n" +
        "## MODIFIED Requirements\n\n### Requirement: Something nobody wrote\nIt does not exist.\n",
    );
    const reviews = reviewRequirements(delta, living);
    expect(reviews.map((r) => r.change)).toEqual(["remove", "new", "new"]);
    expect(reviews[0]!.diff!.every((d) => d.op === "-")).toBe(true);
    expect(reviews[0]!.diff).toContainEqual({ op: "-", line: "The service SHALL refund." });
  });

  it("a pair the merge would refuse is not compared — validate names it", () => {
    const delta = parseRequirements(
      "## MODIFIED Requirements\n\n### Requirement: Refund a payment\nRequirement-ID: PAY-1\nIt selects two.\n",
    );
    expect(reviewRequirements(delta, living)).toEqual([{ change: null }]);
  });
});

describe("loam delta --diff", () => {
  async function example(): Promise<string> {
    const root = await makeTmpDir("loam-delta-review-");
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    const dir = join(root, "fleet");
    await cp(SHIPPED_EXAMPLE, dir, { recursive: true });
    return dir;
  }
  const deltaJson = async (dir: string, ...args: string[]): Promise<Record<string, unknown>> =>
    JSON.parse((await runLoam(dir, "delta", ...args, "--json")).stdout) as Record<string, unknown>;

  it("on the example fleet: an edited requirement as a diff, quoted and new messages, a removal", async () => {
    const dir = await example();

    const payment = await deltaJson(dir, "FEAT-101", "--service", "payment-service", "--diff");
    const [authorize] = payment["requirements"] as Array<{ change: string; diff: Array<{ op: string; line: string }> }>;
    expect(authorize!.change).toBe("edit");
    expect(authorize!.diff).toContainEqual({ op: "-", line: "### Requirement: Authorize a payment" });
    const messages = (payment["events"] as { changes: Array<{ message: string; change: string }> }).changes;
    expect(messages.find((m) => m.message === "payment.PaymentAuthorized")?.change).toBe("quote");
    expect(messages.find((m) => m.message === "payment.PaymentSplitAuthorized")?.change).toBe("new");

    const split = await deltaJson(dir, "FEAT-101", "--service", "payment-split-service", "--diff");
    expect((split["api"] as Array<{ change: string }>).map((op) => op.change)).toEqual(["new", "new"]);

    const retire = await deltaJson(dir, "FEAT-112", "--service", "order-service", "--diff");
    expect((retire["requirements"] as Array<{ change: string }>).map((r) => r.change)).toContain("remove");
    expect((retire["api"] as Array<{ change: string; diff?: unknown[] }>)[0]).toMatchObject({ change: "remove" });

    // The text view tags each item and shows the edit as the change itself.
    const text = await runLoam(dir, "delta", "FEAT-101", "--service", "payment-service", "--diff");
    expect(text.out).toContain("[MODIFIED · edit] Authorize a payment, splitting it when the order is flagged");
    expect(text.out).toContain("    - ### Requirement: Authorize a payment\n");
  });

  it("an operation the feature restates with a change is an edit, with the YAML lines that moved", async () => {
    const files = coherentFixture();
    files["features/FEAT-1-split/specs/payment-service/openapi.yaml"] = (files["services/payment-service/openapi.yaml"] ?? "")
      .replace("summary: Authorize a payment", "summary: Authorize a payment, once per order");
    const p = await makeProject(files);
    cleanups.push(() => p.destroy());

    const json = await deltaJson(p.workDir, "FEAT-1", "--service", "payment-service", "--diff");
    const [op] = json["api"] as Array<{ operationId: string; change: string; diff: Array<{ op: string; line: string }> }>;
    expect(op).toMatchObject({ operationId: "authorizePayment", change: "edit" });
    expect(op!.diff).toContainEqual({ op: "-", line: "summary: Authorize a payment" });
    expect(op!.diff).toContainEqual({ op: "+", line: "summary: Authorize a payment, once per order" });
  });

  it("without --diff the brief is the one it always was — no review key anywhere", async () => {
    const dir = await example();
    const plain = await runLoam(dir, "delta", "FEAT-101", "--service", "payment-service", "--json");
    expect(plain.stdout).not.toContain('"change"');
    expect(plain.stdout).not.toContain('"diff"');
  });
});
