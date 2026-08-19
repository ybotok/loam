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
});

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
