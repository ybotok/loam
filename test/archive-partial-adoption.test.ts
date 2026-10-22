/**
 * Archive into a service that exists and was never adopted writes the
 * feature's slice — and now says it is only that.
 *
 * The create branch of the requirement merge is "no living spec.md, so make
 * one", and it used to ask nothing else. Into `services/<svc>/` holding only a
 * model, it wrote a spec.md of the one requirement the feature added, and from
 * that command on the service read as adopted everywhere: `loam list` and the
 * scorecard moved it from `partial` to `documented`, and `loam status` stopped
 * asking for `loam adopt` — though nothing about what the service already did
 * had been written down.
 *
 * The decision: the created spec.md carries `adoption: partial` in its
 * frontmatter (SCHEMA.md), the plan says why, and the maturity ladder and
 * `next.adopt` read the marker as "not adopted yet" until a person deletes the
 * line. A service the feature INTRODUCES is never marked — there was nothing
 * before it to adopt — and neither is one that already had a spec.md.
 */
import { afterEach, describe, expect, it } from "vitest";
import { parseFrontmatter, stringField } from "../src/core/document/frontmatter.js";
import { SERVICE_MODEL, coherentFixture, makeProject, runLoam, type Project } from "./helpers/harness.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!();
});

/** checkout-web exists — its model is on disk — and has never been adopted: no spec.md. */
const CHECKOUT_MODEL = SERVICE_MODEL.replaceAll("paymentService", "checkoutWeb").replace("'payment-service'", "'checkout-web'");

const PROMO_DELTA = `# checkout-web — requirement delta for FEAT-1

## ADDED Requirements

### Requirement: Promo code entry
Requirement-ID: CHK-PROMO
The checkout page SHALL accept a promo code and show the discounted total.

#### Scenario: A valid code
- **Given** a basket worth 100
- **When** a valid 10% code is entered
- **Then** the total shown is 90
`;

async function project(): Promise<Project> {
  const p = await makeProject({
    ...coherentFixture(),
    "services/checkout-web/model.likec4": CHECKOUT_MODEL,
    "features/FEAT-1-split/specs/checkout-web/spec.md": PROMO_DELTA,
  });
  cleanups.push(() => p.destroy());
  return p;
}

interface ListedService {
  id: string;
  maturity: string;
  missing: string[];
}

describe("a first spec.md archived into a never-adopted service", () => {
  it("is written adoption: partial, and the plan says why", async () => {
    const p = await project();
    const plan = await runLoam(p.workDir, "archive", "FEAT-1", "--dry-run");
    expect(plan.code, plan.out).toBe(0);
    expect(plan.stdout).toContain("checkout-web existed before FEAT-1 and was never adopted");

    const archived = await runLoam(p.workDir, "archive", "FEAT-1");
    expect(archived.code, archived.out).toBe(0);
    const fm = parseFrontmatter(await p.read("services/checkout-web/spec.md"));
    expect(stringField(fm, "adoption")).toBe("partial");
    expect(stringField(fm, "status")).toBe("draft");
  });

  it("keeps the service partial in loam list and owed next.adopt in loam status", async () => {
    const p = await project();
    expect((await runLoam(p.workDir, "archive", "FEAT-1")).code).toBe(0);

    const list = JSON.parse((await runLoam(p.workDir, "list", "--json")).stdout) as { services: ListedService[] };
    const checkout = list.services.find((s) => s.id === "checkout-web")!;
    expect(checkout.maturity).toBe("partial");
    expect(checkout.missing.join(" ")).toContain("loam adopt --service checkout-web");

    const status = JSON.parse((await runLoam(p.workDir, "status", "--json")).stdout) as {
      next: Array<{ code: string; service?: string; statement: string }>;
    };
    const adopt = status.next.find((s) => s.code === "next.adopt" && s.service === "checkout-web");
    expect(adopt, JSON.stringify(status.next)).toBeDefined();
    expect(adopt!.statement).toContain("adoption: partial");

    // Deleting the line is what adoption-complete looks like: the rung moves.
    const spec = await p.read("services/checkout-web/spec.md");
    await p.write("services/checkout-web/spec.md", spec.replace("adoption: partial\n", ""));
    const after = JSON.parse((await runLoam(p.workDir, "list", "--json")).stdout) as { services: ListedService[] };
    expect(after.services.find((s) => s.id === "checkout-web")!.maturity).not.toBe("partial");
  });

  it("keeps loam gate refusing the deploy until the service is adopted", async () => {
    const p = await project();
    expect((await runLoam(p.workDir, "archive", "FEAT-1")).code).toBe(0);
    const gate = await runLoam(p.workDir, "gate", "--service", "checkout-web", "--json");
    expect(gate.code, gate.out).toBe(1);
    const payload = JSON.parse(gate.stdout) as { verdict: string; checks: Array<{ findings: Array<{ code: string; message: string }> }> };
    expect(payload.verdict).toBe("fail");
    const findings = payload.checks.flatMap((c) => c.findings);
    const undocumented = findings.find((f) => f.code === "gate.service-undocumented");
    expect(undocumented, gate.stdout).toBeDefined();
    expect(undocumented!.message).toContain("adoption: partial");
  });

  it("is owed in the loam adopt brief that next.adopt sends the reader to", async () => {
    const p = await project();
    expect((await runLoam(p.workDir, "archive", "FEAT-1")).code).toBe(0);
    const brief = await runLoam(p.workDir, "adopt", "--service", "checkout-web", "--json");
    expect(brief.code, brief.out).toBe(0);
    const targets = (JSON.parse(brief.stdout) as { targets: Array<{ artifact: string; action: string; partial?: boolean }> }).targets;
    expect(targets.find((t) => t.artifact === "spec.md")).toMatchObject({ action: "diff", partial: true });
    const human = await runLoam(p.workDir, "adopt", "--service", "checkout-web");
    expect(human.stdout).not.toContain("every required one is already there");
    expect(human.stdout).toMatch(/spec\.md\s+diff\s+PARTIAL/);
  });

  it("does not mark a service the feature introduces", async () => {
    const p = await project();
    expect((await runLoam(p.workDir, "archive", "FEAT-1")).code).toBe(0);
    // payment-split-service is the coherent fixture's NEW service: its slice is all of it.
    const fm = parseFrontmatter(await p.read("services/payment-split-service/spec.md"));
    expect(stringField(fm, "adoption")).toBeUndefined();
  });
});
