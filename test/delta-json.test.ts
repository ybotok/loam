/**
 * Tests for `loam delta --json` (src/commands/delta.ts).
 *
 * `delta` is the command whose output is meant to BE a coding agent's task:
 * why the feature exists, what this service must do, and how the architecture
 * changes around it. In text form that is a briefing for a human; --json is the
 * same briefing an agent can consume without parsing prose. Scenarios carry
 * their Given/When/Then lines verbatim — they are the source for the tests the
 * agent is expected to write.
 */
import { describe, expect, it } from "vitest";
import { coherentFixture, makeProject, makeTmpDir, runLoam, type Project } from "./helpers/harness.js";
import { parseRequirements } from "../src/core/document/parse.js";
import { scenarioDigest } from "../src/core/gherkin/stamp.js";

const NEW_SVC = "payment-split-service";

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

describe("--json contract", () => {
  it("carries the feature, the service and the repo-relative feature path", async () => {
    await withProject(coherentFixture(), async (p) => {
      const res = await runLoam(p.workDir, "delta", "FEAT-1", "--service", NEW_SVC, "--json");
      expect(res.code).toBe(0);
      const json = JSON.parse(res.stdout);
      expect(json.ok).toBe(true);
      expect(json.feature).toBe("FEAT-1");
      expect(json.service).toBe(NEW_SVC);
      expect(json.path).toBe("features/FEAT-1-split");
    });
  });

  it("carries the intent body with its frontmatter stripped", async () => {
    await withProject(coherentFixture(), async (p) => {
      const json = JSON.parse(
        (await runLoam(p.workDir, "delta", "FEAT-1", "--service", NEW_SVC, "--json")).stdout,
      );
      expect(json.intent).toContain("Split payments");
      expect(json.intent).not.toContain("status: proposed");
    });
  });

  it("carries the requirement delta with scenarios verbatim — the agent writes tests from these", async () => {
    await withProject(coherentFixture(), async (p) => {
      const json = JSON.parse(
        (await runLoam(p.workDir, "delta", "FEAT-1", "--service", NEW_SVC, "--json")).stdout,
      );
      expect(json.requirements).toHaveLength(1);
      const r = json.requirements[0];
      expect(r.kind).toBe("ADDED");
      expect(r.name).toBe("Split a payment");
      expect(r.operations).toEqual(["createSplit"]);
      expect(r.scenarios).toHaveLength(1);
      expect(r.scenarios[0].name).toBe("Split across two payees");
      expect(r.scenarios[0].lines.join("\n")).toContain("**Given** a payment of 100.00");
      expect(r.scenarios[0].lines.join("\n")).toContain("**Then** two shares are recorded");
    });
  });

  it("carries the OpenAPI delta as slots, not just names", async () => {
    await withProject(coherentFixture(), async (p) => {
      const json = JSON.parse(
        (await runLoam(p.workDir, "delta", "FEAT-1", "--service", NEW_SVC, "--json")).stdout,
      );
      // "implement createSplit" is not a task without the slot it lives in.
      expect(json.api).toEqual([
        {
          path: "/splits",
          method: "POST",
          operationId: "createSplit",
          summary: "Create a split",
          remove: false,
        },
      ]);
    });
  });

  it("lists every service the feature touches, whichever one is projected", async () => {
    await withProject(coherentFixture(), async (p) => {
      const json = JSON.parse(
        (await runLoam(p.workDir, "delta", "FEAT-1", "--service", NEW_SVC, "--json")).stdout,
      );
      expect(json.services).toEqual([NEW_SVC]);
    });
  });

  it("says whether the service is new and lists the edges around it", async () => {
    await withProject(coherentFixture(), async (p) => {
      const json = JSON.parse(
        (await runLoam(p.workDir, "delta", "FEAT-1", "--service", NEW_SVC, "--json")).stdout,
      );
      expect(json.architecture.isNew).toBe(true);
      expect(json.architecture.inbound).toEqual([
        { service: "payment-service", op: "createSplit", title: "Calls createSplit" },
      ]);
      expect(json.architecture.outbound).toEqual([]);
    });
  });

  it("reports an untouched LIVING service honestly rather than inventing work", async () => {
    // `kafka` has to exist for this to be the honest-empty case. A service id
    // that names nothing at all is now a refusal (`unknown-target`, below): the
    // two used to be the same output, which made a typo indistinguishable from
    // a service this feature genuinely leaves alone.
    const files = coherentFixture();
    files["services/kafka/spec.md"] = "---\nservice: kafka\n---\n\n# kafka\n\n## Requirements\n";
    await withProject(files, async (p) => {
      const json = JSON.parse(
        (await runLoam(p.workDir, "delta", "FEAT-1", "--service", "kafka", "--json")).stdout,
      );
      expect(json.requirements).toEqual([]);
      expect(json.api).toEqual([]);
      expect(json.architecture).toEqual({ isNew: false, inbound: [], outbound: [], errors: [] });
    });
  });

  it("reports an unknown feature inside the envelope", async () => {
    await withProject(coherentFixture(), async (p) => {
      const res = await runLoam(p.workDir, "delta", "FEAT-999", "--service", NEW_SVC, "--json");
      expect(res.code).toBe(1);
      const json = JSON.parse(res.stdout);
      expect(json.ok).toBe(false);
      expect(json.error.code).toBe("unknown-target");
    });
  });

  it("an archived feature keeps the unknown-target code, but the message says it is already archived", async () => {
    const files = coherentFixture();
    files["features/archive/FEAT-9-shipped/intent.md"] = "# shipped\n";
    await withProject(files, async (p) => {
      const res = await runLoam(p.workDir, "delta", "FEAT-9", "--service", NEW_SVC, "--json");
      expect(res.code).toBe(1);
      const json = JSON.parse(res.stdout);
      expect(json.ok).toBe(false);
      expect(json.error.code).toBe("unknown-target");
      expect(json.error.message).toContain("already archived");
      expect(json.error.message).toContain("loam show FEAT-9");
    });
  });

  it("reports a missing service selection inside the envelope", async () => {
    await withProject(coherentFixture(), async (p) => {
      const res = await runLoam(p.workDir, "delta", "FEAT-1", "--json");
      expect(res.code).toBe(1);
      const json = JSON.parse(res.stdout);
      expect(json.ok).toBe(false);
      expect(json.error.code).toBe("invalid-option");
    });
  });

  it("reports a missing config inside the envelope", async () => {
    const bare = await makeTmpDir();
    const res = await runLoam(bare, "delta", "FEAT-1", "--service", NEW_SVC, "--json");
    expect(res.code).toBe(1);
    expect(JSON.parse(res.stdout).error.code).toBe("no-config");
  });

  it("surfaces a broken delta as data but exits 1 — the projection must not read as vacuously green", async () => {
    const files = coherentFixture();
    files["features/FEAT-1-split/delta.likec4"] = "model {\n  a = bogusKind 'a'\n}\n";
    await withProject(files, async (p) => {
      const res = await runLoam(p.workDir, "delta", "FEAT-1", "--service", NEW_SVC, "--json");
      // exit 1: an agent consuming the empty C4 slice as a task brief would
      // silently lose the architecture axis. ok stays true — the command ran —
      // and the payload stays exactly as informative as before.
      expect(res.code).toBe(1);
      const json = JSON.parse(res.stdout);
      expect(json.ok).toBe(true);
      expect(json.architecture.errors.length).toBeGreaterThan(0);
      expect(json.architecture.inbound).toEqual([]);
      expect(json.requirements).toHaveLength(1); // the requirement half stays usable
    });
  });

  it("carries the AsyncAPI delta as message slots under the additive events key, and the text view prints it", async () => {
    const files = coherentFixture();
    // A small but complete event delta: one wired message, one declared but
    // unwired, one removal marker — the three `direction` shapes at once.
    files[`features/FEAT-1-split/specs/${NEW_SVC}/asyncapi.yaml`] = `asyncapi: 3.0.0
info:
  title: ${NEW_SVC} events
  version: "1.0"
channels:
  splitEvents:
    address: payment.splits.v1
    messages:
      SplitRecorded:
        $ref: '#/components/messages/SplitRecorded'
operations:
  sendSplitRecorded:
    action: send
    channel:
      $ref: '#/channels/splitEvents'
components:
  messages:
    SplitRecorded:
      name: payment.SplitRecorded
      payload:
        type: object
        properties:
          splitId:
            type: string
    SplitAudited:
      name: payment.SplitAudited
      payload:
        type: object
    Legacy:
      x-loam-remove: true
      name: payment.Legacy
`;
    await withProject(files, async (p) => {
      const res = await runLoam(p.workDir, "delta", "FEAT-1", "--service", NEW_SVC, "--json");
      expect(res.code).toBe(0);
      const json = JSON.parse(res.stdout);
      expect(json.events).toEqual({
        changes: [
          { slot: "components.messages.SplitRecorded", message: "payment.SplitRecorded", direction: "send", remove: false },
          { slot: "components.messages.SplitAudited", message: "payment.SplitAudited", direction: null, remove: false },
          { slot: "components.messages.Legacy", message: "payment.Legacy", direction: null, remove: true },
        ],
        unreadable: false,
      });

      const text = await runLoam(p.workDir, "delta", "FEAT-1", "--service", NEW_SVC);
      expect(text.code).toBe(0);
      expect(text.out).toContain("Events (this feature's asyncapi.yaml for the service):");
      expect(text.out).toContain("SEND payment.SplitRecorded  (components.messages.SplitRecorded)");
      expect(text.out).toContain("REMOVE payment.Legacy  (components.messages.Legacy)");
    });
  });

  it("an asyncapi.yaml that does not parse exits 1 exactly as the openapi path does", async () => {
    const files = coherentFixture();
    files[`features/FEAT-1-split/specs/${NEW_SVC}/asyncapi.yaml`] = "asyncapi: 3.0.0\nchannels: {\n";
    await withProject(files, async (p) => {
      // The delta exit-code parity the openapi guard below argues for: this
      // payload IS the implementation task, so "no event work here" over a
      // YAML error must not read as exit 0.
      const res = await runLoam(p.workDir, "delta", "FEAT-1", "--service", NEW_SVC, "--json");
      expect(res.code).toBe(1);
      const json = JSON.parse(res.stdout);
      expect(json.ok).toBe(true); // the command ran; the exit code carries the failure
      expect(json.events.changes).toEqual([]);
      expect(json.events.unreadable).toBe(true);
      expect(typeof json.events.error).toBe("string");
    });
  });

  it("an openapi.yaml that does not parse exits 1 and reports the failure under its own key", async () => {
    const files = coherentFixture();
    files["features/FEAT-1-split/specs/payment-split-service/openapi.yaml"] =
      'openapi: 3.1.0\ninfo:\n  title: payment-split-service\n  version: "1.0"\npaths:\n  /splits: {\n';
    await withProject(files, async (p) => {
      const res = await runLoam(p.workDir, "delta", "FEAT-1", "--service", NEW_SVC, "--json");
      // The contract axis falls into the same vacuously-green trap the
      // architecture axis is already guarded against: an unreadable document
      // projects as zero operations, which is exactly what a delta that changes
      // no endpoints projects as — and this payload IS the implementation task,
      // so "no contract work here" over a YAML error is work silently dropped.
      // Upstream now catches it too — `loam validate --feature` grades
      // `openapi.invalid` on a feature's own contract, and archive refuses on
      // it — but this guard stays its own: `loam delta` is consumed by agents
      // that never ran validate, so the exit code must carry the failure itself.
      expect(res.code).toBe(1);
      const json = JSON.parse(res.stdout);
      expect(json.ok).toBe(true); // the command ran; the exit code carries the failure
      // `api` keeps the shape a consumer already indexes — the readability of
      // the document rides alongside it rather than inside it.
      expect(json.api).toEqual([]);
      expect(json.openapi.unreadable).toBe(true);
      expect(typeof json.openapi.error).toBe("string");
    });
  });

  it("carries the business promises the feature changes, with the `Realizes:` id", async () => {
    // The section is a fact about the FEATURE, not about this service's files,
    // and it is here for the sharper version of the use-case section's reason: a
    // capability delta NAMES NO SERVICE, so projecting the feature onto one
    // dropped it entirely — and the implementer handed "add the endpoint" was
    // never told which business promise the requirement they are writing keeps.
    const files = capabilityFixture();
    await withProject(files, async (p) => {
      const json = JSON.parse(
        (await runLoam(p.workDir, "delta", "FEAT-1", "--service", NEW_SVC, "--json")).stdout,
      );
      expect(json.capabilities).toEqual([
        {
          id: "payments/refunds",
          path: "features/FEAT-1-split/capabilities/payments/refunds/spec.md",
          added: 1,
          modified: 0,
          removed: 0,
          promises: [{ kind: "ADDED", id: "REF-1", name: "Refund within five days" }],
        },
      ]);
      // NOT narrowed by --service: the promise is what the whole feature is
      // for, so it reads the same from every service the feature touches.
      const other = JSON.parse(
        (await runLoam(p.workDir, "delta", "FEAT-1", "--service", "payment-service", "--json")).stdout,
      );
      expect(other.capabilities).toEqual(json.capabilities);
    });
  });

  it("carries an empty capabilities array for a fleet that has not adopted the axis", async () => {
    // Empty, never absent: a consumer must not have to tell "no capability
    // delta" from "this loam does not report them".
    await withProject(coherentFixture(), async (p) => {
      const json = JSON.parse(
        (await runLoam(p.workDir, "delta", "FEAT-1", "--service", NEW_SVC, "--json")).stdout,
      );
      expect(json.capabilities).toEqual([]);
    });
  });
});

/**
 * FEAT-1's delta for the new service, carrying every join a requirement can
 * write. A pin nobody minted: `loam delta` PROJECTS the baseline, it does not
 * grade it (`delta.baseline-*` is validate's job), so a well-formed sixteen hex
 * digits is all this fixture owes the payload under test.
 */
const JOINED_SPEC = `# payment-split-service — delta for FEAT-1

## MODIFIED Requirements

### Requirement: Split a payment
Requirement-ID: SPLIT-1
Based-On: 0123456789abcdef
The service SHALL split a payment across payees summing to the total.

Operations: createSplit
Covers: paymentSplitService
Requires: payment/split
Capability: payments
Realizes: payments#PAY-1
Publishes: payment.SplitRecorded
Consumes: payment.PaymentAuthorized

#### Scenario: Split across two payees
- **Given** a payment of 100.00
- **When** it is split 60/40
- **Then** two shares are recorded
`;

/** The same feature's ARCH delta — the second axis, which salts its digests differently. */
const JOINED_ARCH_SPEC = `# payment-split-service — arch delta for FEAT-1

## ADDED Requirements

### Requirement: Retries stay idempotent
The service SHALL apply createSplit idempotently under retry.

Covers: paymentSplitService

#### Scenario: Split across two payees
- **Given** a payment of 100.00
- **When** it is split 60/40
- **Then** two shares are recorded
`;

/** `coherentFixture` with both axes of FEAT-1 rewritten to carry every join. */
function joinedFixture(): Record<string, string> {
  const files = coherentFixture();
  files[`features/FEAT-1-split/specs/${NEW_SVC}/spec.md`] = JOINED_SPEC;
  files[`features/FEAT-1-split/specs/${NEW_SVC}/arch.spec.md`] = JOINED_ARCH_SPEC;
  return files;
}

describe("--json requirement joins", () => {
  it("carries the five joins the projection used to drop on the floor", async () => {
    // Every one of these is already written on the requirement and every one
    // names work — which permission gates it, which capability it belongs to,
    // which named promise it realizes, which messages it produces and consumes.
    // An implementer handed "add the endpoint" and none of this had to go read
    // the markdown the payload claims to have projected.
    await withProject(joinedFixture(), async (p) => {
      const res = await runLoam(p.workDir, "delta", "FEAT-1", "--service", NEW_SVC, "--json");
      expect(res.code).toBe(0);
      const r = JSON.parse(res.stdout).requirements[0];
      expect(r.kind).toBe("MODIFIED");
      expect(r.id).toBe("SPLIT-1");
      expect(r.basedOn).toBe("0123456789abcdef");
      expect(r.requires).toEqual(["payment/split"]);
      expect(r.capabilities).toEqual(["payments"]);
      expect(r.realizes).toEqual(["payments#PAY-1"]);
      expect(r.publishes).toEqual(["payment.SplitRecorded"]);
      expect(r.consumes).toEqual(["payment.PaymentAuthorized"]);
      // The two that were already there keep their meaning beside the new ones.
      expect(r.operations).toEqual(["createSplit"]);
      expect(r.covers).toEqual(["paymentSplitService"]);
    });
  });

  it("carries the 1-based line of the requirement and of each scenario", async () => {
    await withProject(joinedFixture(), async (p) => {
      const json = JSON.parse(
        (await runLoam(p.workDir, "delta", "FEAT-1", "--service", NEW_SVC, "--json")).stdout,
      );
      const r = json.requirements[0];
      // Checked against the document, not only against a constant: a line
      // number whose expectation moved with it would still point at the wrong
      // text here, and the wrong text is what an author would be sent to.
      const lines = JOINED_SPEC.split("\n");
      expect(r.line).toBe(5);
      expect(lines[r.line - 1]).toBe("### Requirement: Split a payment");
      expect(r.scenarios[0].line).toBe(18);
      expect(lines[r.scenarios[0].line - 1]).toBe("#### Scenario: Split across two payees");
    });
  });

  it("carries the scenario digest `loam gherkin` stamps and `loam verify` matches on, salted per axis", async () => {
    // The join key, not a new one: the recipe lives in core/gherkin/digest.ts,
    // `loam gherkin` writes it into each generated .feature as
    // `@loam-digest-<16hex>`, and `--results` matches a cucumber report's
    // scenarios on it. Publishing it here is what lets a consumer of this brief
    // go from "the requirement says X" to "the test answering X is that one"
    // without regenerating the suite to find out.
    await withProject(joinedFixture(), async (p) => {
      const json = JSON.parse(
        (await runLoam(p.workDir, "delta", "FEAT-1", "--service", NEW_SVC, "--json")).stdout,
      );
      const business = parseRequirements(JOINED_SPEC)[0]!.scenarios[0]!.lines;
      const arch = parseRequirements(JOINED_ARCH_SPEC)[0]!.scenarios[0]!.lines;
      expect(json.requirements[0].scenarios[0].digest).toBe(
        scenarioDigest(NEW_SVC, business, "business"),
      );
      expect(json.archRequirements[0].scenarios[0].digest).toBe(
        scenarioDigest(NEW_SVC, arch, "arch"),
      );
      // The fixture words the two scenarios IDENTICALLY, so the only thing
      // telling these digests apart is the axis salt. Without it a green
      // business run would answer the arch claim too — an integration test
      // nobody wrote, reading as run.
      expect(business.join("\n").trim()).toBe(arch.join("\n").trim());
      expect(json.archRequirements[0].scenarios[0].digest).not.toBe(
        json.requirements[0].scenarios[0].digest,
      );
      // And the service salt, for the same reason one axis over.
      expect(json.requirements[0].scenarios[0].digest).not.toBe(
        scenarioDigest("ledger-service", business, "business"),
      );
    });
  });
});

/** `coherentFixture` plus one nested capability delta on the feature already in flight. */
function capabilityFixture(): Record<string, string> {
  return {
    ...coherentFixture(),
    "features/FEAT-1-split/capabilities/payments/refunds/spec.md":
      "# payments/refunds — capability delta for FEAT-1\n\n## ADDED Requirements\n\n### Requirement: Refund within five days\nRequirement-ID: REF-1\n\nThe fleet SHALL refund within five days.\n\n#### Scenario: It is refunded\n- **Given** a customer\n- **When** they ask\n- **Then** it is refunded\n",
  };
}

describe("text output", () => {
  it("still prints the human briefing", async () => {
    await withProject(coherentFixture(), async (p) => {
      const res = await runLoam(p.workDir, "delta", "FEAT-1", "--service", NEW_SVC);
      expect(res.code).toBe(0);
      expect(res.out).toContain(`FEAT-1 · ${NEW_SVC}`);
      expect(res.out).toContain("Requirements:");
      expect(res.out).toContain("[ADDED] Split a payment");
      expect(res.out).toContain("Architecture:");
      expect(res.out).toContain(`NEW service — create ${NEW_SVC}`);
      // Silent when the feature carries no capability delta, unlike the
      // use-case section: "no flow draws this service" is an answer about the
      // FLEET, while "this feature changes no capability" is the normal state
      // of every feature in a fleet that has not adopted the axis.
      expect(res.out).not.toContain("Capabilities");
    });
  });

  it("prints the promises and the exact line to paste, when there are any", async () => {
    await withProject(capabilityFixture(), async (p) => {
      const res = await runLoam(p.workDir, "delta", "FEAT-1", "--service", NEW_SVC);
      expect(res.code).toBe(0);
      expect(res.out).toContain("Capabilities (business promises this feature changes):");
      // The entry WHOLE, not a capability and an id to assemble: it is text
      // somebody is about to paste into a requirement.
      expect(res.out).toContain("Realizes: payments/refunds#REF-1");
    });
  });

  it("text mode exits 1 on a broken delta too — the guard is about the delta, not the format", async () => {
    const files = coherentFixture();
    files["features/FEAT-1-split/delta.likec4"] = "model {\n  a = bogusKind 'a'\n}\n";
    await withProject(files, async (p) => {
      const res = await runLoam(p.workDir, "delta", "FEAT-1", "--service", NEW_SVC);
      // Same vacuously-green trap as --json: a pipeline shelling out to the
      // text view would otherwise read "delta ran fine" off exit 0 while the
      // architecture axis was silently empty.
      expect(res.code).toBe(1);
      expect(res.out).toContain("delta.likec4 has errors");
      expect(res.out).toContain("loam validate");
    });
  });
});
