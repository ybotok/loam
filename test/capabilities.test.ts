/**
 * The capability axis: `architecture/capabilities.yaml` as the fleet's declared
 * vocabulary, the `Capability:` line that joins requirements to it, and the
 * rollup the fleet reads the total through.
 *
 * The property under test that differs from every sibling axis is the OPT-IN:
 * the FILE is the opt-in, not the line. A fleet with no capabilities.yaml must
 * produce no capability findings at all, however many `Capability:` lines its
 * requirements carry — that test passes trivially today, and its job is to
 * fail against the wrong implementation, the one that copies permissions'
 * line-is-the-opt-in rule. The rest are the family's own promises: unknown is
 * an error with close names (and the one new archive gate), invalid is exactly
 * one finding per run with the family suspended behind it, unrealized is one
 * warning per capability, and the rollup is deterministic enough to diff.
 */
import { describe, expect, it, afterEach } from "vitest";
import { coherentFixture, makeProject, runLoam, type Project } from "./helpers/harness.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!();
});

async function project(files: Record<string, string>): Promise<Project> {
  const p = await makeProject(files, { service: "payment-service" });
  cleanups.push(() => p.destroy());
  return p;
}

const CAPABILITIES = `capabilities:
  registration:
    description: create an account and let its owner in
    owner: identity-team
  payments/refunds: {}
`;

/** The living spec, with whatever `Capability:` line the case is about. */
function specWith(capability: string | null, status = "verified"): string {
  return `---
service: payment-service
status: ${status}
---

# payment-service

## Requirements

### Requirement: Authorize a payment
The service SHALL authorize a payment before capture.

Operations: authorizePayment
${capability === null ? "" : `Capability: ${capability}\n`}
#### Scenario: Successful authorization
- **Given** a valid card
- **When** authorization is requested
- **Then** the payment is authorized
`;
}

/** A second service's spec (no contract, no model — list reads only the spec). */
function otherSpec(service: string, capability: string, status: string): string {
  return `---
service: ${service}
status: ${status}
---

# ${service}

## Requirements

### Requirement: Keep the account book
The service SHALL record every authorization.

Capability: ${capability}

#### Scenario: A booking lands
- **Given** an authorization
- **When** it is recorded
- **Then** the book balances
`;
}

/** Findings of one code from a `--json` validate run. */
async function findings(p: Project, code: string, ...args: string[]): Promise<Array<{ subject?: string; message: string }>> {
  const res = await runLoam(p.workDir, "validate", ...args, "--json");
  const doc = JSON.parse(res.stdout);
  const targets: Array<{ findings: Array<{ code: string; subject?: string; message: string }> }> = doc.targets ?? [];
  return targets.flatMap((t) => t.findings.filter((f) => f.code === code));
}

describe("Capability: resolves against the fleet vocabulary", () => {
  it("a declared name passes, and the rollup shows the requirement under its row", async () => {
    const p = await project({
      ...coherentFixture(),
      "architecture/capabilities.yaml": CAPABILITIES,
      "services/payment-service/spec.md": specWith("registration"),
    });
    for (const code of ["capability.unknown", "capability.invalid", "capability.unrealized"]) {
      expect(await findings(p, code, "--service", "payment-service")).toEqual([]);
    }
    const run = await runLoam(p.workDir, "validate", "--service", "payment-service", "--json");
    expect(run.code, run.out).toBe(0);

    const list = await runLoam(p.workDir, "list", "capabilities", "--json");
    expect(list.code, list.out).toBe(0);
    const rows = JSON.parse(list.stdout).capabilities as Array<Record<string, unknown>>;
    expect(rows).toEqual([
      {
        id: "payments/refunds",
        realizedBy: [],
        services: [],
        statuses: {},
      },
      {
        id: "registration",
        description: "create an account and let its owner in",
        owner: "identity-team",
        realizedBy: [{ service: "payment-service", file: "spec.md", requirement: "Authorize a payment" }],
        services: ["payment-service"],
        statuses: { verified: 1 },
      },
    ]);
  });

  it("an undeclared name is an ERROR at the service target, with a close-name suggestion", async () => {
    const p = await project({
      ...coherentFixture(),
      "architecture/capabilities.yaml": CAPABILITIES,
      "services/payment-service/spec.md": specWith("registartion"),
    });
    const found = await findings(p, "capability.unknown", "--service", "payment-service");
    expect(found).toHaveLength(1);
    expect(found[0]!.message).toContain("registartion");
    expect(found[0]!.message).toContain("Did you mean: registration");
    const res = await runLoam(p.workDir, "validate", "--service", "payment-service", "--json");
    expect(res.code).not.toBe(0);
  });

  it("an unparseable vocabulary is exactly ONE capability.invalid, and the family is suspended", async () => {
    // The spec names a capability nobody could ever resolve, and two more are
    // declared-but-unreadable: with a broken file the run must say ONE thing.
    const p = await project({
      ...coherentFixture(),
      "architecture/capabilities.yaml": "capabilities: [not, a, mapping]\n",
      "services/payment-service/spec.md": specWith("registration"),
    });
    expect(await findings(p, "capability.invalid", "--all")).toHaveLength(1);
    expect(await findings(p, "capability.unknown", "--all")).toEqual([]);
    expect(await findings(p, "capability.unrealized", "--all")).toEqual([]);
  });

  it("no capabilities.yaml at all is TOTAL silence, Capability: lines notwithstanding", async () => {
    // The exit-criterion pin for the divergence from Requires:. The line reads
    // like a join, the file is absent, and the correct grade is nothing — a
    // fleet that never opted in must not gain findings because an author wrote
    // the line early.
    const p = await project({
      ...coherentFixture(),
      "services/payment-service/spec.md": specWith("registration"),
    });
    for (const args of [["--service", "payment-service"], ["--all"]] as const) {
      for (const code of ["capability.unknown", "capability.invalid", "capability.unrealized"]) {
        expect(await findings(p, code, ...args)).toEqual([]);
      }
      const res = await runLoam(p.workDir, "validate", ...args, "--json");
      expect(res.code, res.out).toBe(0);
    }
  });

  it("a declared capability nothing realizes warns once PER capability, and REMOVED does not realize", async () => {
    // `reporting` is named only by a REMOVED requirement — content on its way
    // out realizes nothing — and `audit` is named by nothing at all. Two
    // declarations, two warnings, each subject = the id.
    const spec = `${specWith(null)}
## REMOVED Requirements

### Requirement: Ship the daily report
The service SHALL ship a report.

Capability: reporting

#### Scenario: Report ships
- **Given** a day ended
- **When** the report job runs
- **Then** the report is shipped
`;
    const p = await project({
      ...coherentFixture(),
      "architecture/capabilities.yaml": "capabilities:\n  audit: {}\n  reporting: {}\n",
      "services/payment-service/spec.md": spec,
    });
    const found = await findings(p, "capability.unrealized", "--all");
    expect(found.map((f) => f.subject)).toEqual(["audit", "reporting"]);
  });
});

describe("the rollup is deterministic and additive", () => {
  const twoServices = () => ({
    ...coherentFixture(),
    "architecture/capabilities.yaml": CAPABILITIES,
    "services/payment-service/spec.md": specWith("registration", "verified"),
    "services/ledger-service/spec.md": otherSpec("ledger-service", "registration", "draft"),
  });

  it("two consecutive list runs are byte-identical, rows and realizedBy in pinned order", async () => {
    const p = await project(twoServices());
    const first = await runLoam(p.workDir, "list", "capabilities", "--json");
    const second = await runLoam(p.workDir, "list", "capabilities", "--json");
    expect(first.code, first.out).toBe(0);
    expect(second.stdout).toBe(first.stdout);
    const rows = JSON.parse(first.stdout).capabilities as Array<{ id: string; realizedBy: Array<{ service: string }> }>;
    expect(rows.map((r) => r.id)).toEqual(["payments/refunds", "registration"]);
    expect(rows[1]!.realizedBy.map((r) => r.service)).toEqual(["ledger-service", "payment-service"]);
  });

  it("the draft/verified split reports both realizing services' statuses", async () => {
    const p = await project(twoServices());
    const res = await runLoam(p.workDir, "list", "capabilities", "--json");
    const rows = JSON.parse(res.stdout).capabilities as Array<{ id: string; statuses: Record<string, number> }>;
    expect(rows.find((r) => r.id === "registration")!.statuses).toEqual({ draft: 1, verified: 1 });
  });

  it("plain `loam list --json` carries NO capabilities key — the frozen default payload is unchanged", async () => {
    const p = await project(twoServices());
    const res = await runLoam(p.workDir, "list", "--json");
    expect(res.code).toBe(0);
    expect("capabilities" in JSON.parse(res.stdout)).toBe(false);
  });

  it("explore --capability seeds the realizing services, and every miss is a field", async () => {
    const p = await project(twoServices());
    const res = await runLoam(
      p.workDir,
      "explore", "--capability", "registration", "--capability", "payments/refunds", "--capability", "nope", "--json",
    );
    expect(res.code, res.out).toBe(0);
    const doc = JSON.parse(res.stdout);
    expect(doc.seeds.sort()).toEqual(["ledger-service", "payment-service"]);
    const reasons = Object.fromEntries(doc.services.map((s: { id: string; reason: string }) => [s.id, s.reason]));
    expect(reasons["payment-service"]).toBe("seed");
    // `payments/refunds` is declared and realized by nothing; `nope` is not
    // declared at all. One additive field carries both kinds of miss.
    expect(doc.unresolvedCapabilities).toEqual(["payments/refunds", "nope"]);
  });
});

describe("the archive gate", () => {
  /** The coherent feature, its delta requirement naming capability `shipping`. */
  const featureWithCapability = () => {
    const files = coherentFixture();
    files["features/FEAT-1-split/specs/payment-split-service/spec.md"] = files[
      "features/FEAT-1-split/specs/payment-split-service/spec.md"
    ]!.replace("Operations: createSplit", "Operations: createSplit\nCapability: shipping");
    return files;
  };

  it("an undeclared capability in a delta gates validate --feature and refuses archive; --approve overrides", async () => {
    const p = await project({
      ...featureWithCapability(),
      "architecture/capabilities.yaml": CAPABILITIES,
    });
    const found = await findings(p, "capability.unknown", "--feature", "FEAT-1");
    expect(found).toHaveLength(1);
    expect(found[0]!.message).toContain("shipping");
    const graded = await runLoam(p.workDir, "validate", "--feature", "FEAT-1", "--json");
    expect(graded.code).not.toBe(0);

    const refused = await runLoam(p.workDir, "archive", "FEAT-1", "--json");
    expect(refused.code).toBe(1);
    expect(JSON.parse(refused.stdout).error.code).toBe("not-coherent");
    expect(refused.stdout).toContain("capability.unknown");
    expect(p.exists("features/FEAT-1-split/intent.md")).toBe(true);

    const approved = await runLoam(p.workDir, "archive", "FEAT-1", "--approve", "--json");
    expect(approved.code, approved.out).toBe(0);
  });

  it("with no vocabulary the same feature archives clean, and the line lands in living verbatim", async () => {
    const p = await project(featureWithCapability());
    const res = await runLoam(p.workDir, "archive", "FEAT-1", "--json");
    expect(res.code, res.out).toBe(0);
    const living = await p.read("services/payment-split-service/spec.md");
    expect(living).toContain("Capability: shipping");
  });
});
