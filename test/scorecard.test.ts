/**
 * The fleet scorecard: `validate --all --json`'s additive `scorecard` payload
 * key and the table the `--all` text report appends.
 *
 * The anchor assertion — `payload.scorecard.operations.defined` on the
 * coherent fixture — fails on the pre-scorecard tree (the key was undefined)
 * and pins the ceiling-vs-actual reading: every axis is a pair of counts a
 * pipeline can diff week over week, derived per invocation and never stored.
 */
import { describe, expect, it } from "vitest";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  coherentFixture,
  FEATURE_SPEC,
  LIVING_SPEC,
  makeProject,
  runLoam,
  type Project,
} from "./helpers/harness.js";
import { parseRequirements } from "../src/core/document/parse.js";
import { scenarioDigest } from "../src/core/gherkin/stamp.js";
import { ANSWERED_BY } from "../src/core/verify/answers.js";

/**
 * A green cucumber report for coherentFixture's one FEAT-1 scenario. The
 * digest is recomputed from the published recipe rather than read back out of
 * a `loam gherkin` run — gate-command.test.ts's spelling — because what
 * `--results` matches on is the tag, and a test that asked loam for the answer
 * would pass over any digest loam happened to invent.
 */
async function writeReport(p: Project): Promise<void> {
  const digest = scenarioDigest(
    "payment-split-service",
    parseRequirements(FEATURE_SPEC)[0]!.scenarios[0]!.lines,
    "business",
  );
  const report = [
    {
      name: "Split a payment",
      elements: [
        {
          name: "Split across two payees",
          tags: [{ name: `@loam-digest-${digest}` }],
          steps: [{ result: { status: "passed" } }],
        },
      ],
    },
  ];
  await writeFile(join(p.workDir, "report.json"), JSON.stringify(report), "utf8");
}

/**
 * Confirm from an answers file every FEAT-1 claim whose kind a mechanical flag
 * does NOT own — the composition rule `checkAnswers` enforces: a report owns
 * its claims outright, and an answers entry naming one refuses.
 */
async function writeAnswers(p: Project, ownedKinds: string[]): Promise<void> {
  const derived = await runLoam(p.workDir, "verify", "FEAT-1", "--json");
  expect(derived.code, derived.out).toBe(0);
  const claims: { id: string; kind: string }[] = JSON.parse(derived.stdout).claims;
  const answers = claims
    .filter((c) => !ownedKinds.includes(c.kind))
    .map((c) => ({ id: c.id, verdict: "confirmed", evidence: ["src/split/Service.ts:12"] }));
  await writeFile(join(p.workDir, "answers.json"), JSON.stringify(answers), "utf8");
}

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

/** A fleet whose ceilings all exceed their actuals: an ungoverned op, a consumed deprecated op, an unlinked message. */
function gapFleet(): Record<string, string> {
  return {
    // Deliberately nested: a grouping box around both systems and a container
    // inside provider. The census must count the two SYSTEMS only — the
    // grouping and the container are the fleet map's own exemptions, and a
    // count that included them read "4 elements → 0 covered" forever.
    "architecture/landscape.likec4": `specification {
  element softwareSystem
  element container
}

model {
  payments = softwareSystem 'Payments' {
    consumer = softwareSystem 'consumer' {
      metadata { service 'consumer' }
    }
    provider = softwareSystem 'provider' {
      metadata { service 'provider' }
      api = container 'api'
    }
    consumer -> provider 'Calls legacyOp' {
      metadata { op 'legacyOp' }
    }
  }
}

views {
  view landscape {
    include *
  }
}
`,
    "services/provider/model.likec4": `specification {
  element softwareSystem
}

model {
  provider = softwareSystem 'provider' {
    description 'Provider'
  }
}

views {
  view of provider {
    include *
  }
}
`,
    "services/provider/spec.md": `---
service: provider
---

# provider

## Requirements

### Requirement: Serve the new path
The service SHALL serve the new operation.

Operations: newOp
Publishes: provider.Done

#### Scenario: New path works
- **Given** a request
- **When** it is served
- **Then** it succeeds
`,
    "services/provider/openapi.yaml": `openapi: 3.1.0
info:
  title: provider
  version: "1.0"
paths:
  /legacy:
    get:
      operationId: legacyOp
      deprecated: true
      responses:
        "200":
          description: OK
          content:
            application/json:
              schema:
                type: object
                properties:
                  ok:
                    type: string
  /new:
    get:
      operationId: newOp
      responses:
        "200":
          description: OK
          content:
            application/json:
              schema:
                type: object
                properties:
                  ok:
                    type: string
`,
    "services/provider/asyncapi.yaml": `asyncapi: 3.0.0
info:
  title: provider events
  version: "1.0"
channels:
  events:
    address: provider.events.v1
    messages:
      Done:
        $ref: '#/components/messages/Done'
      Ignored:
        $ref: '#/components/messages/Ignored'
operations:
  sendAll:
    action: send
    channel:
      $ref: '#/channels/events'
components:
  messages:
    Done:
      name: provider.Done
      payload:
        type: object
        properties:
          id:
            type: string
    Ignored:
      name: provider.Ignored
      payload:
        type: object
        properties:
          id:
            type: string
`,
  };
}

describe("validate --all --json: the scorecard payload key", () => {
  it("derives the whole card, exactly, on the coherent fixture", async () => {
    await withProject(coherentFixture(), async (p) => {
      const res = await runLoam(p.workDir, "validate", "--all", "--json");
      const payload = JSON.parse(res.stdout);
      expect(payload.ok).toBe(true);
      // The anchor: this key did not exist before the scorecard shipped.
      expect(payload.scorecard.operations.defined).toBe(1);
      expect(payload.scorecard).toEqual({
        // payment-service is the one service; FEAT-1 the one active feature.
        services: 1,
        maturity: { empty: 0, partial: 0, documented: 1, sourced: 0, vouched: 0 },
        // `sampledVouched` is additive beside `vouched`: nothing in this
        // fixture is vouched at all, let alone sampled, and the key is present
        // rather than omitted so a dashboard can tell a fleet with no sampled
        // vouches from a loam that never counted them.
        provenance: { vouched: 0, staleDigests: 0, unverifiableFromHere: 0, sampledVouched: 0 },
        verification: {
          recorded: 0,
          verdicts: { verified: 0, attested: 0, unverified: 0 },
          // All three `answered_by` keys present over a fleet with no record
          // at all, the same stable-shape rule as `verdicts` above.
          claims: { total: 0, confirmed: 0, answered: { runner: 0, "external-runner": 0, agent: 0 } },
        },
        operations: { defined: 1, governed: 1, deprecated: 0, deprecatedStillConsumed: 0 },
        messages: { defined: 0, linked: 0 },
        // customer is a person and joins no census; checkout-web and
        // payment-service are systems, and no arch.spec.md covers either.
        c4: { elements: 2, covered: 0 },
        // payment-service has requirement blocks and an openapi.yaml; it has
        // no arch.spec.md, no asyncapi.yaml, and no Requires:/Capability:
        // line — so four of the six axes read "not started" over this fleet.
        adoption: { requirements: 1, arch: 0, openapi: 1, asyncapi: 0, permissions: 0, capabilities: 0 },
        features: { active: 1, stages: { missing: 0, blocked: 0, draft: 0, ready: 1, done: 0 } },
      });
      // The stages shape is stable — all five keys, in the vocabulary's order —
      // even though the fleet form never grades `draft`.
      expect(Object.keys(payload.scorecard.features.stages)).toEqual([
        "missing",
        "blocked",
        "draft",
        "ready",
        "done",
      ]);
      // Rollup invariants a dashboard leans on.
      const sc = payload.scorecard;
      const counts = (rec: Record<string, number>): number =>
        Object.values(rec).reduce((a, b) => a + b, 0);
      expect(counts(sc.maturity)).toBe(sc.services);
      expect(counts(sc.verification.verdicts)).toBe(sc.verification.recorded);
      // The provenance split is a PARTITION of the confirmed claims: every
      // confirmed claim is filed under exactly one `answered_by`, so the three
      // buckets sum to `confirmed` and none of them can absorb another's.
      expect(counts(sc.verification.claims.answered)).toBe(sc.verification.claims.confirmed);
      expect(Object.keys(sc.verification.claims.answered)).toEqual([...ANSWERED_BY]);
    });
  });

  it("is absent outside --all: a single service or feature run carries no fleet rollup", async () => {
    await withProject(coherentFixture(), async (p) => {
      const service = JSON.parse(
        (await runLoam(p.workDir, "validate", "payment-service", "--json")).stdout,
      );
      expect(service.scorecard).toBeUndefined();
      const feature = JSON.parse(
        (await runLoam(p.workDir, "validate", "--feature", "FEAT-1", "--json")).stdout,
      );
      expect(feature.scorecard).toBeUndefined();
    });
  });

  it("keeps every ceiling honest: ungoverned, deprecated-but-consumed and unlinked all show", async () => {
    await withProject(gapFleet(), async (p) => {
      const payload = JSON.parse((await runLoam(p.workDir, "validate", "--all", "--json")).stdout);
      // legacyOp is defined and governed by nothing; newOp is governed.
      expect(payload.scorecard.operations).toEqual({
        defined: 2,
        governed: 1,
        deprecated: 1,
        // The op-linked consumer -> provider edge still joins to legacyOp.
        deprecatedStillConsumed: 1,
      });
      // provider.Ignored is declared and no requirement line names it.
      expect(payload.scorecard.messages).toEqual({ defined: 2, linked: 1 });
      // Both drawn systems count; no arch.spec.md covers either.
      expect(payload.scorecard.c4).toEqual({ elements: 2, covered: 0 });
    });
  });

  it("files a wholly agent-answered record under agent — no runner ran, so no claim is a runner's", async () => {
    await withProject(coherentFixture(), async (p) => {
      // Record FEAT-1 the way list.test.ts does: derive the checklist, confirm
      // every claim with --record and NO mechanical flag, so every answer —
      // the scenario claim and the three others alike — is somebody's word.
      await writeAnswers(p, []);
      const rec = await runLoam(p.workDir, "verify", "FEAT-1", "--record", "answers.json");
      expect(rec.code, rec.out).toBe(0);

      const payload = JSON.parse((await runLoam(p.workDir, "validate", "--all", "--json")).stdout);
      expect(payload.scorecard.verification).toEqual({
        // The denominator is deliberately NOT here: features.active carries it
        // once for both axes.
        recorded: 1,
        verdicts: { verified: 0, attested: 1, unverified: 0 },
        // coherentFixture's FEAT-1 derives 4 claims and this run answered all
        // four by hand. The card used to print three of them as the "runner
        // share" — `confirmed - attested`, where `attested` counts
        // `scenario.tested` alone — over a fixture that never runs a test, so
        // the one dial a lead reads for mechanical evidence reported three
        // machine answers that did not exist.
        claims: { total: 4, confirmed: 4, answered: { runner: 0, "external-runner": 0, agent: 4 } },
      });
      // And the text line says the same, so the two renderings cannot drift.
      const text = await runLoam(p.workDir, "validate", "--all");
      expect(text.out).toContain("claims 4/4 confirmed (0 runner · 0 external-runner · 4 agent)");
      // An attested record does NOT move the fleet stage to done: attested is
      // complete work resting on an assertion, which is what `ready` means
      // (core/status/verification.ts's fullyVerified).
      expect(payload.scorecard.features.stages).toEqual({
        missing: 0,
        blocked: 0,
        draft: 0,
        ready: 1,
        done: 0,
      });
    });
  });

  it("credits the runner only for a claim a digest-matched green run actually answered", async () => {
    await withProject(coherentFixture(), async (p) => {
      // The other side of the same defect: with a REAL runner answer in the
      // record, `confirmed - attested` counted 4 — `attested` drops to 0 the
      // moment a run answers the scenario claim — so a record with one
      // mechanical answer and three assertions read as four machine answers.
      await writeReport(p);
      await writeAnswers(p, ["scenario.tested"]);
      const rec = await runLoam(
        p.workDir, "verify", "FEAT-1", "--record", "answers.json", "--results", "report.json",
      );
      expect(rec.code, rec.out).toBe(0);
      const card = JSON.parse((await runLoam(p.workDir, "validate", "--all", "--json")).stdout).scorecard;
      expect(card.verification.claims).toEqual({
        total: 4,
        confirmed: 4,
        answered: { runner: 1, "external-runner": 0, agent: 3 },
      });
      // One green run over every scenario claim is what `verified` means.
      expect(card.verification.verdicts).toEqual({ verified: 1, attested: 0, unverified: 0 });
    });
  });

  it("keeps the external runner its own bucket — a contract report is neither the runner nor the agent", async () => {
    await withProject(coherentFixture(), async (p) => {
      // `--contract-results` answers the api.exposes claim by operationId, and
      // its provenance is `external-runner`: loam did not generate the suite,
      // so it is not the runner, and no person asserted it, so it is not the
      // agent. Two buckets had nowhere honest to put it.
      await writeFile(
        join(p.workDir, "contract.json"),
        JSON.stringify({ loamContractReport: 1, results: [{ operationId: "createSplit", status: "passed" }] }),
        "utf8",
      );
      await writeAnswers(p, ["api.exposes"]);
      const rec = await runLoam(
        p.workDir, "verify", "FEAT-1", "--record", "answers.json", "--contract-results", "contract.json",
      );
      expect(rec.code, rec.out).toBe(0);
      const card = JSON.parse((await runLoam(p.workDir, "validate", "--all", "--json")).stdout).scorecard;
      expect(card.verification.claims).toEqual({
        total: 4,
        confirmed: 4,
        answered: { runner: 0, "external-runner": 1, agent: 3 },
      });
      const text = await runLoam(p.workDir, "validate", "--all");
      expect(text.out).toContain("(0 runner · 1 external-runner · 3 agent)");
    });
  });

  it("zeroes one unreadable service instead of deleting the fleet's card", async () => {
    await withProject(coherentFixture(), async (p) => {
      // The exact bytes test/core-gate-gaps.test.ts grades: a UTF-16 spec.md
      // is `service.unreadable` on its own target, and the memoized rejection
      // rejects again on every await — inside the scorecard's fan-out that
      // deleted the whole additive key from an otherwise-graded report.
      await writeFile(
        join(p.docsDir, "services/payment-service/spec.md"),
        Buffer.from("﻿" + LIVING_SPEC, "utf16le"),
      );
      const res = await runLoam(p.workDir, "validate", "--all", "--json");
      expect(res.code).toBe(1);
      const payload = JSON.parse(res.stdout);
      expect(payload.valid).toBe(false);
      // The card survives; the one unreadable service contributes zeros.
      expect(payload.scorecard.services).toBe(1);
      expect(payload.scorecard.operations).toEqual({
        defined: 0,
        governed: 0,
        deprecated: 0,
        deprecatedStillConsumed: 0,
      });
      expect(payload.scorecard.messages).toEqual({ defined: 0, linked: 0 });
      // The map-derived axes are untouched by one service's encoding.
      expect(payload.scorecard.c4.elements).toBe(2);
    });
  });

  it("counts sources-unverifiable-from-here off the findings, so it IS the footer's number", async () => {
    const files = coherentFixture();
    // Sources declared ONLY in arch.spec.md's frontmatter: the enumeration's
    // spec.md-derived flag misses it while the sources check grades it — a
    // views-derived count and the findings-derived footer disagreed about the
    // same fleet in the same payload.
    files["services/payment-service/arch.spec.md"] = `---
service: payment-service
sources:
  - src/payments/
---

# payment-service — architecture
`;
    await withProject(files, async (p) => {
      const payload = JSON.parse((await runLoam(p.workDir, "validate", "--all", "--json")).stdout);
      expect(payload.sourcesUnverifiableFromHere).toBe(1);
      expect(payload.scorecard.provenance.unverifiableFromHere).toBe(
        payload.sourcesUnverifiableFromHere,
      );
    });
  });

  it("fails closed on the map-derived axes when the fleet map cannot be read, keeping the report whole", async () => {
    const files = coherentFixture();
    delete files["architecture/landscape.likec4"];
    // A landscape that IS a directory: existsSync passes, every read throws —
    // the containment shape fleet/load.ts documents. The landscape target
    // carries the diagnosis as an error; the scorecard survives, its
    // map-derived axes answering zero rather than guessing, while every
    // contract-derived count still stands.
    files["architecture/landscape.likec4/placeholder"] = "";
    await withProject(files, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--all", "--json");
      expect(res.code).toBe(1);
      const payload = JSON.parse(res.stdout);
      expect(payload.valid).toBe(false);
      expect(payload.targets.length).toBeGreaterThan(0);
      expect(payload.scorecard.c4).toEqual({ elements: 0, covered: 0 });
      expect(payload.scorecard.services).toBe(1);
      expect(payload.scorecard.operations).toEqual({
        defined: 1,
        governed: 1,
        deprecated: 0,
        deprecatedStillConsumed: 0,
      });
    });
  });
});

describe("validate --all text mode: the scorecard table", () => {
  it("appends the table after the footer under --all, and only under --all", async () => {
    await withProject(coherentFixture(), async (p) => {
      const all = await runLoam(p.workDir, "validate", "--all");
      expect(all.out).toContain("fleet scorecard (ceiling → actual)");
      expect(all.out).toContain("operations    1 defined → 1 governed · 0 deprecated (0 still consumed)");
      expect(all.out).toContain("features      1 active — 0 missing · 0 blocked · 0 draft · 1 ready · 0 done");
      // After the footer: the summary line precedes the table.
      expect(all.out.indexOf("1 service, 1 feature")).toBeLessThan(all.out.indexOf("fleet scorecard"));

      const single = await runLoam(p.workDir, "validate", "payment-service");
      expect(single.out).not.toContain("fleet scorecard");
    });
  });
});
