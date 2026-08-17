/**
 * `api.response-ungoverned` — the declared refusals of an operation, joined to
 * the scenarios that reach them.
 *
 * This closes the gap the whole decision-layer wave is about. `api.ungoverned`
 * grades OPERATIONS against requirements, so an endpoint with one happy-path
 * requirement and a dozen declared failure codes was governed by every check
 * loam had — while the refusals are exactly where a service's guards surface: a
 * permission denied, a field combination rejected, a state that forbids the
 * transition. openapi.yaml is the only artifact in the corpus that already
 * enumerates them, so it is the only place the join could come from.
 *
 * The match is textual on purpose, and the tests below pin both halves of that
 * choice: generous enough that a status in an `Examples` row counts (which is
 * where a matrix puts its codes), strict enough that `4030` is not a 403.
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

/** authorizePayment, declaring whatever failure responses the case is about. */
function openapiWith(codes: string[]): string {
  const responses = codes
    .map((c) => `        "${c}":\n          description: Refused\n`)
    .join("");
  return `openapi: 3.1.0
info:
  title: payment-service
  version: "1.0"
paths:
  /payments/authorize:
    post:
      operationId: authorizePayment
      responses:
        "200":
          description: Authorized
          content:
            application/json:
              schema:
                type: object
${responses}`;
}

function specWith(scenarioBody: string): string {
  return `---
service: payment-service
status: verified
---

# payment-service

## Requirements

### Requirement: Authorize a payment
WHEN authorization is requested THE SYSTEM SHALL authorize or refuse it.

Operations: authorizePayment

#### Scenario: Authorization
${scenarioBody}
`;
}

const HAPPY = `- **Given** a valid card
- **When** authorization is requested
- **Then** the payment is authorized`;

async function findings(p: Project): Promise<Array<{ details?: string[] }>> {
  const res = await runLoam(p.workDir, "validate", "--service", "payment-service", "--json");
  const doc = JSON.parse(res.stdout);
  const targets: Array<{ findings: Array<{ code: string; details?: string[] }> }> = doc.targets ?? [];
  return targets.flatMap((t) => t.findings.filter((f) => f.code === "api.response-ungoverned"));
}

describe("a declared failure response owes a scenario", () => {
  it("is reported when the operation is documented by its happy path alone", async () => {
    const p = await project({
      ...coherentFixture(),
      "services/payment-service/openapi.yaml": openapiWith(["403", "422"]),
      "services/payment-service/spec.md": specWith(HAPPY),
    });
    const found = await findings(p);
    expect(found).toHaveLength(1);
    expect(found[0]!.details).toEqual(["authorizePayment: 403, 422"]);
  });

  it("a scenario naming the code satisfies it", async () => {
    const p = await project({
      ...coherentFixture(),
      "services/payment-service/openapi.yaml": openapiWith(["403"]),
      "services/payment-service/spec.md": specWith(
        `${HAPPY}\n- **Then** a caller without the permission gets 403`,
      ),
    });
    expect(await findings(p)).toEqual([]);
  });

  it("an Examples row counts — a matrix is where the codes actually live", async () => {
    // The reason this check arrived with outline support and not before: a
    // status column is exactly where a permission matrix puts its codes, and
    // before `Examples` those rows were prose in a feature description.
    const p = await project({
      ...coherentFixture(),
      "services/payment-service/openapi.yaml": openapiWith(["403", "422"]),
      "services/payment-service/spec.md": specWith(
        `- **Given** a card
- **When** a caller holding <permission> requests authorization
- **Then** the response is <status>

| permission        | status |
|-------------------|--------|
| payments:authorize | 200   |
| payments:read     | 403    |
| (none)            | 422    |`,
      ),
    });
    expect(await findings(p)).toEqual([]);
  });

  it("only whole numbers match — 4030 is not a 403", async () => {
    const p = await project({
      ...coherentFixture(),
      "services/payment-service/openapi.yaml": openapiWith(["403"]),
      "services/payment-service/spec.md": specWith(`${HAPPY}\n- **Then** the limit is 4030 minor units`),
    });
    expect(await findings(p)).toHaveLength(1);
  });

  it("2xx, `default` and the 4XX wildcard are never demanded", async () => {
    // None of them names a case a scenario could be written for, and asking for
    // one would teach an author to write a scenario about nothing.
    const p = await project({
      ...coherentFixture(),
      "services/payment-service/openapi.yaml": `${openapiWith([])}        default:
          description: Anything else
        "4XX":
          description: A client error
        "201":
          description: Created
`,
      "services/payment-service/spec.md": specWith(HAPPY),
    });
    expect(await findings(p)).toEqual([]);
  });

  it("an operation no requirement governs is left to api.ungoverned", async () => {
    // One defect counted twice is one defect reported wrong.
    const p = await project({
      ...coherentFixture(),
      "services/payment-service/openapi.yaml": openapiWith(["403"]),
      "services/payment-service/spec.md": `---
service: payment-service
status: verified
---

# payment-service

## Requirements

### Requirement: Authorize a payment
THE SYSTEM SHALL authorize payments.

#### Scenario: Authorization
${HAPPY}
`,
    });
    expect(await findings(p)).toEqual([]);
  });

  it("is a warning — the service stays valid", async () => {
    // A service may legitimately declare a code its scenarios describe in
    // words; an error would teach authors to paste numbers into prose.
    const p = await project({
      ...coherentFixture(),
      "services/payment-service/openapi.yaml": openapiWith(["403"]),
      "services/payment-service/spec.md": specWith(HAPPY),
    });
    const res = await runLoam(p.workDir, "validate", "--service", "payment-service", "--json");
    expect(res.code, res.out).toBe(0);
  });
});
