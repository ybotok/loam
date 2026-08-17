/**
 * The authorization axis: `architecture/permissions.yaml` as the fleet's
 * vocabulary, and the `Requires:` line that joins a requirement to it.
 *
 * The axis exists because the two joins loam already had cannot carry a
 * permission. `Operations:` is the wrong cardinality (one operation is gated by
 * several permissions and one permission gates several operations) and OpenAPI
 * cannot carry the name at all outside oauth2/openIdConnect — the spec requires
 * an EMPTY scope array for `http bearer` and `apiKey`, which is what most of a
 * legacy fleet authenticates with. And `security` answers only for the caller,
 * while a permission is as often checked on an entity inside the request.
 *
 * So the properties under test are: the join resolves or refuses (never
 * silently passes), a missing vocabulary is a refusal rather than silence
 * because the line is the opt-in, an unreadable one refuses ONCE instead of
 * cascading, and a declared permission nobody cites is visible.
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

const VOCABULARY = `subjects:
  user:
    description: an authenticated human principal
  profile:
    description: a sending identity a user acts through

permissions:
  user:
    payments:refund:
      description: refund a captured payment
      owned_by: idp
      enforced_by: [payment-service]
  profile:
    channel:send:sms:
      description: send an SMS from this profile
      owned_by: profile-service
      enforced_by: [payment-service]
`;

/** The living spec, with whatever `Requires:` line the case is about. */
function specWith(requires: string | null): string {
  return `---
service: payment-service
status: verified
---

# payment-service

## Requirements

### Requirement: Authorize a payment
IF the caller lacks the refund permission THEN THE SYSTEM SHALL refuse.

Operations: authorizePayment
${requires === null ? "" : `Requires: ${requires}\n`}
#### Scenario: Successful authorization
- **Given** a valid card
- **When** authorization is requested
- **Then** the payment is authorized
`;
}

/** Findings of one code from a `--json` validate run. */
async function findings(p: Project, code: string, ...args: string[]): Promise<Array<{ message: string }>> {
  const res = await runLoam(p.workDir, "validate", ...args, "--json");
  const doc = JSON.parse(res.stdout);
  const targets: Array<{ findings: Array<{ code: string; message: string }> }> = doc.targets ?? [];
  return targets.flatMap((t) => t.findings.filter((f) => f.code === code));
}

describe("Requires: resolves against the fleet vocabulary", () => {
  it("a declared permission passes, and the service stays valid", async () => {
    const p = await project({
      ...coherentFixture(),
      "architecture/permissions.yaml": VOCABULARY,
      "services/payment-service/spec.md": specWith("user/payments:refund, profile/channel:send:sms"),
    });
    expect(await findings(p, "permissions.unknown", "--service", "payment-service")).toEqual([]);
    const res = await runLoam(p.workDir, "validate", "--service", "payment-service", "--json");
    expect(res.code, res.out).toBe(0);
  });

  it("an undeclared permission is an ERROR, and the run fails", async () => {
    // Error, not warn: an invented permission reads exactly like a real one in
    // the requirement, in the generated scenario, and in whatever test somebody
    // writes from it. Nothing downstream can tell them apart.
    const p = await project({
      ...coherentFixture(),
      "architecture/permissions.yaml": VOCABULARY,
      "services/payment-service/spec.md": specWith("user/payments:void"),
    });
    const found = await findings(p, "permissions.unknown", "--service", "payment-service");
    expect(found).toHaveLength(1);
    expect(found[0]!.message).toContain("user/payments:void");
    const res = await runLoam(p.workDir, "validate", "--service", "payment-service", "--json");
    expect(res.code).not.toBe(0);
  });

  it("a near miss offers the real name", async () => {
    const p = await project({
      ...coherentFixture(),
      "architecture/permissions.yaml": VOCABULARY,
      "services/payment-service/spec.md": specWith("user/payments:refnud"),
    });
    const found = await findings(p, "permissions.unknown", "--service", "payment-service");
    expect(found[0]!.message).toContain("user/payments:refund");
  });

  it("the wrong SUBJECT is a miss even when the permission name is right", async () => {
    // The pair is the unit. `channel:send:sms` is a profile's permission, and a
    // requirement that checks it on the caller is describing different
    // behaviour — which is the whole reason the subject is part of the token.
    const p = await project({
      ...coherentFixture(),
      "architecture/permissions.yaml": VOCABULARY,
      "services/payment-service/spec.md": specWith("user/channel:send:sms"),
    });
    expect(await findings(p, "permissions.unknown", "--service", "payment-service")).toHaveLength(1);
  });

  it("no vocabulary at all still refuses — the line is the opt-in", async () => {
    // The alternative was silence, and silence is how a line that looks like a
    // join comes to join nothing at all.
    const p = await project({
      ...coherentFixture(),
      "services/payment-service/spec.md": specWith("user/payments:refund"),
    });
    const found = await findings(p, "permissions.unknown", "--service", "payment-service");
    expect(found).toHaveLength(1);
    expect(found[0]!.message).toContain("does not exist");
  });

  it("a spec with no Requires: line never mentions the axis", async () => {
    const p = await project({ ...coherentFixture(), "services/payment-service/spec.md": specWith(null) });
    expect(await findings(p, "permissions.unknown", "--service", "payment-service")).toEqual([]);
  });
});

describe("the vocabulary itself is graded once, under --all", () => {
  it("an unreadable vocabulary refuses ONCE and suppresses the unknown cascade", async () => {
    // A hundred findings about one broken file is a cascade, not a diagnosis.
    const p = await project({
      ...coherentFixture(),
      "architecture/permissions.yaml": "permissions: [not, a, mapping]\n",
      "services/payment-service/spec.md": specWith("user/payments:refund"),
    });
    expect(await findings(p, "permissions.invalid", "--all")).toHaveLength(1);
    expect(await findings(p, "permissions.unknown", "--all")).toEqual([]);
  });

  it("a permission under an undeclared subject kind is refused", async () => {
    const p = await project({
      ...coherentFixture(),
      "architecture/permissions.yaml": `subjects:\n  user:\n    description: a human\n\npermissions:\n  profiles:\n    channel:send: {}\n`,
    });
    const found = await findings(p, "permissions.invalid", "--all");
    expect(found).toHaveLength(1);
    expect(found[0]!.message).toContain("profiles");
  });

  it("a declared permission nobody requires is reported — a vocabulary is worth what cites it", async () => {
    const p = await project({
      ...coherentFixture(),
      "architecture/permissions.yaml": VOCABULARY,
      "services/payment-service/spec.md": specWith("user/payments:refund"),
    });
    const found = await findings(p, "permissions.unenforced", "--all");
    expect(found).toHaveLength(1);
    expect(found[0]!.message).toContain("1 declared permission");
  });

  it("a service with no arch.spec.md does not take the whole --all run down", async () => {
    // The sweep reads both requirement documents of every service, and
    // arch.spec.md is optional — most of a legacy fleet has none. Reading it
    // unconditionally threw ENOENT out through the fleet context as
    // `repository-unavailable`: no targets, nothing validated, one absent
    // OPTIONAL artifact refusing the entire fleet run.
    const p = await project({
      ...coherentFixture(),
      "architecture/permissions.yaml": VOCABULARY,
      "services/payment-service/spec.md": specWith("user/payments:refund"),
    });
    const res = await runLoam(p.workDir, "validate", "--all", "--json");
    const doc = JSON.parse(res.stdout);
    expect(doc.error, JSON.stringify(doc.error)).toBeUndefined();
    expect(doc.targets.length).toBeGreaterThan(0);
  });

  it("nothing is said about a fleet with no vocabulary file", async () => {
    const p = await project(coherentFixture());
    expect(await findings(p, "permissions.unenforced", "--all")).toEqual([]);
    expect(await findings(p, "permissions.invalid", "--all")).toEqual([]);
  });
});
