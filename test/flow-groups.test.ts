/**
 * Flows as fleet-level dynamic views, end to end: where a journey is STORED,
 * how a suite is declared, what `loam flow sync` generates from that, and what
 * `loam flow env` answers a machine.
 *
 * Four properties are the roadmap item's own exit criteria, and each has a test
 * that fails without it:
 *
 *  - a flow document under `architecture/flows/` resolves the fleet map's
 *    elements and tags — the LikeC4 project scope reaches a SUBDIRECTORY of
 *    `architecture/`, which is what makes one-file-per-journey storage possible
 *    at all (every test here would fail on unresolved references otherwise);
 *  - the participant union of a group reproduces byte-identically from the same
 *    documents written in a different order, and the generated views file
 *    compares byte-equal after a regeneration that changed nothing;
 *  - suites are many-to-many: one journey belongs to a smoke suite and a
 *    payments suite at once, and a mistyped group is a PARSE error rather than
 *    a second, silently empty group;
 *  - a participant that models no service directory is visible in the
 *    environment output rather than absent from it.
 */
import { describe, expect, it } from "vitest";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { makeProject, runLoam, treeHashes } from "./helpers/harness.js";

const VIEWS = "architecture/flow-groups.likec4";
const FLOW = "architecture/flows/checkout.likec4";

/**
 * A fleet map with the two group tags and one #external system declared —
 * LikeC4 refuses an undeclared tag, which IS the group typo check, so the
 * `specification` block is where a suite is brought into existence.
 */
const FLEET = `specification {
  element softwareSystem
  tag smoke
  tag payments
  tag async
  tag external
}

model {
  checkoutWeb = softwareSystem 'checkout-web'
  paymentService = softwareSystem 'payment-service'
  stripe = softwareSystem 'Stripe' {
    #external
  }

  checkoutWeb -> paymentService 'Calls authorizePayment' {
    metadata { op 'authorizePayment' }
  }
  paymentService -> stripe 'Authorizes'
}
`;

/** One journey, in two groups at once. */
const CHECKOUT = `views {
  dynamic view checkoutJourney {
    #smoke, #payments
    title 'Checkout'
    checkoutWeb -> paymentService 'authorize'
    paymentService -> stripe 'charge'
  }
}
`;

/**
 * A third journey whose document order is the REVERSE of its participants'
 * sorted order, in a group whose name sorts ahead of both others while its
 * file sorts behind them. It is the fixture the ordering claims rest on: with
 * insertion order instead of a sort, both the group list and this view's
 * members come out backwards.
 */
const WEBHOOK = `views {
  dynamic view settlementWebhook {
    #async
    title 'Settlement webhook'
    stripe -> paymentService 'settled'
    paymentService -> checkoutWeb 'order updated'
  }
}
`;

/** A second journey, in one of the same groups — so a group's union spans flows. */
const REFUND = `views {
  dynamic view refundJourney {
    #payments
    title 'Refund'
    paymentService -> stripe 'refund'
  }
}
`;

function fleetFiles(flows: Record<string, string> = { [FLOW]: CHECKOUT }): Record<string, string> {
  return {
    "architecture/landscape.likec4": FLEET,
    "services/checkout-web/spec.md": "---\nservice: checkout-web\nstatus: draft\n---\n\n# checkout-web\n",
    "services/payment-service/spec.md": "---\nservice: payment-service\nstatus: draft\n---\n\n# payment-service\n",
    ...archCovering(flows),
    ...flows,
  };
}

/**
 * The arch requirement COVERING every journey the fixture stores — one scenario,
 * and none of these journeys branches, so one outcome each is answered.
 *
 * Not decoration, and not this file's subject. A journey stored under
 * `architecture/flows/` is graded by `flow.uncovered` exactly as one drawn in
 * the fleet map is — that join is what test/flow-coverage.test.ts pins — so
 * without this every `flow.*` assertion below would also carry a coverage
 * warning about the fixture, and these tests are about STORAGE: where a journey
 * lives, what its tags declare, and which bytes that generates. Deleting this
 * makes three of them fail for a reason none of them is asking about.
 */
function archCovering(flows: Record<string, string>): Record<string, string> {
  const ids = [...Object.values(flows).join("\n").matchAll(/dynamic view (\w+)/g)].map((m) => m[1]!);
  if (ids.length === 0) return {};
  return {
    "services/payment-service/arch.spec.md": `---
service: payment-service
status: draft
---

# payment-service — architecture spec

## Requirements

### Requirement: The fleet's journeys hold together

The fleet SHALL complete every journey it draws.

Covers: ${ids.map((id) => `view:${id}`).join(", ")}

#### Scenario: A drawn journey completes
- **Given** the fleet is up
- **When** a journey runs
- **Then** it completes
`,
  };
}

interface JsonFinding {
  severity: string;
  code: string;
  subject?: string;
  details?: string[];
}

/** Every `flow.*` finding a `validate --all` run produced, in report order. */
function flowFindings(stdout: string): JsonFinding[] {
  const payload = JSON.parse(stdout) as { targets: Array<{ findings: JsonFinding[] }> };
  return payload.targets.flatMap((t) => t.findings).filter((f) => f.code.startsWith("flow."));
}

describe("loam flow sync — the renderer", () => {
  it("writes one view per group, sorted, one include per line, the union of the group's flows' participants", async () => {
    const p = await makeProject(
      fleetFiles({
        [FLOW]: CHECKOUT,
        "architecture/flows/refund.likec4": REFUND,
        "architecture/flows/webhook.likec4": WEBHOOK,
      }),
    );
    try {
      const res = await runLoam(p.workDir, "flow", "sync", "--json");
      expect(res.code).toBe(0);
      const payload = JSON.parse(res.stdout);
      expect(payload.ok).toBe(true);
      expect(payload.path).toBe(VIEWS);
      expect(payload.action).toBe("created");
      expect(payload.groups).toBe(3);
      // The exact bytes are the contract: deterministic, line-oriented, no
      // timestamps, no absolute paths. Pinning them whole is what makes any
      // accidental format drift loud. `payments` holds two journeys and their
      // three participants; `smoke` holds one journey — the many-to-many that
      // a directory could not have expressed. Both sorts are load-bearing too:
      // `async` comes first though its file is read last, and its members are
      // sorted though the journey draws them in the opposite order.
      expect(await p.read(VIEWS)).toBe(
        "// generated by loam — the flow groups under architecture/flows/, one view per group.\n" +
          "// Do not edit: `loam flow sync` regenerates this file from the flow documents,\n" +
          "// and `loam validate --all` reports `flow.views-stale` when it drifts.\n" +
          "\n" +
          "views {\n" +
          "  // group async — settlementWebhook\n" +
          "  view flow_group_async {\n" +
          "    include checkoutWeb\n" +
          "    include paymentService\n" +
          "    include stripe\n" +
          "  }\n" +
          "\n" +
          "  // group payments — checkoutJourney, refundJourney\n" +
          "  view flow_group_payments {\n" +
          "    include checkoutWeb\n" +
          "    include paymentService\n" +
          "    include stripe\n" +
          "  }\n" +
          "\n" +
          "  // group smoke — checkoutJourney\n" +
          "  view flow_group_smoke {\n" +
          "    include checkoutWeb\n" +
          "    include paymentService\n" +
          "    include stripe\n" +
          "  }\n" +
          "}\n",
      );
    } finally {
      await p.destroy();
    }
  });

  it("is byte-reproducible: the same journeys in a different document order render identical bytes", async () => {
    const forward = fleetFiles({ [FLOW]: CHECKOUT, "architecture/flows/refund.likec4": REFUND });
    const backward: Record<string, string> = {};
    for (const key of Object.keys(forward).reverse()) backward[key] = forward[key]!;
    const a = await makeProject(forward);
    const b = await makeProject(backward);
    try {
      expect((await runLoam(a.workDir, "flow", "sync")).code).toBe(0);
      expect((await runLoam(b.workDir, "flow", "sync")).code).toBe(0);
      const bytes = await a.read(VIEWS);
      expect(await b.read(VIEWS)).toBe(bytes);
      // No timestamps, no absolute paths: the file must be committable and
      // identical from any machine and any moment.
      expect(bytes).not.toMatch(/\d{4}-\d{2}-\d{2}/);
      expect(bytes).not.toContain(a.docsDir);
      expect(bytes).not.toContain(b.docsDir);
    } finally {
      await a.destroy();
      await b.destroy();
    }
  });

  it("a second run reports `current` and writes nothing at all", async () => {
    const p = await makeProject(fleetFiles());
    try {
      expect((await runLoam(p.workDir, "flow", "sync")).code).toBe(0);
      const before = await treeHashes(p.docsDir);
      const again = await runLoam(p.workDir, "flow", "sync", "--json");
      expect(JSON.parse(again.stdout).action).toBe("current");
      expect(await treeHashes(p.docsDir)).toEqual(before);
    } finally {
      await p.destroy();
    }
  });

  it("REMOVES the file when no flow declares a group — a suite deleted must not keep its view", async () => {
    const p = await makeProject(fleetFiles());
    try {
      expect((await runLoam(p.workDir, "flow", "sync")).code).toBe(0);
      expect(p.exists(VIEWS)).toBe(true);
      // The journey stays; only its group tag goes. A flow in no group is
      // legal and normal — the fleet simply has no suite any more.
      await p.write(FLOW, CHECKOUT.replace("    #smoke, #payments\n", ""));
      const res = await runLoam(p.workDir, "flow", "sync", "--json");
      expect(res.code).toBe(0);
      expect(JSON.parse(res.stdout).action).toBe("removed");
      expect(p.exists(VIEWS)).toBe(false);
    } finally {
      await p.destroy();
    }
  });
});

describe("what counts as a flow document", () => {
  it("reads a `.c4` journey too — the renderer does, so ignoring one would be a silent divergence", async () => {
    // The whole `architecture/` project is what the LikeC4 renderer merges, and
    // it reads both extensions. Reading only loam's own `.likec4` spelling
    // would not be a stricter rule: the group would exist for the renderer and
    // not for loam, which then reports the generated file stale against a suite
    // it had decided not to see.
    const p = await makeProject(fleetFiles({ "architecture/flows/checkout.c4": CHECKOUT }));
    try {
      const res = await runLoam(p.workDir, "flow", "sync", "--json");
      expect(res.code).toBe(0);
      expect(JSON.parse(res.stdout).groups).toBe(2);
      expect(await p.read(VIEWS)).toContain("view flow_group_smoke {");
    } finally {
      await p.destroy();
    }
  });
});

describe("validate --all — flow.views-stale", () => {
  it("is silent when the generated file matches the flows", async () => {
    const p = await makeProject(fleetFiles());
    try {
      expect((await runLoam(p.workDir, "flow", "sync")).code).toBe(0);
      const res = await runLoam(p.workDir, "validate", "--all", "--json");
      expect(flowFindings(res.stdout)).toEqual([]);
    } finally {
      await p.destroy();
    }
  });

  it("reports exactly one error on exactly one file when it is absent, drifted, or left over", async () => {
    const p = await makeProject(fleetFiles());
    try {
      // Absent while the flows declare groups.
      const missing = await runLoam(p.workDir, "validate", "--all", "--json");
      expect(flowFindings(missing.stdout)).toEqual([
        { severity: "error", code: "flow.views-stale", subject: VIEWS, message: expect.any(String), details: [] },
      ]);

      // Drifted: one byte appended to the generated file.
      expect((await runLoam(p.workDir, "flow", "sync")).code).toBe(0);
      await p.write(VIEWS, (await p.read(VIEWS)) + "// hand-edited\n");
      const drifted = await runLoam(p.workDir, "validate", "--all", "--json");
      expect(flowFindings(drifted.stdout).map((f) => f.code)).toEqual(["flow.views-stale"]);
      expect(drifted.code).toBe(1);

      // Left over: the groups are gone, the file is not.
      expect((await runLoam(p.workDir, "flow", "sync")).code).toBe(0);
      await p.write(FLOW, CHECKOUT.replace("    #smoke, #payments\n", ""));
      const leftover = await runLoam(p.workDir, "validate", "--all", "--json");
      expect(flowFindings(leftover.stdout).map((f) => f.code)).toEqual(["flow.views-stale"]);
    } finally {
      await p.destroy();
    }
  });
});

describe("groups are tags, and the feature axis owns one shape of name", () => {
  it("a tag taking the feature-id grammar is reported and joins no group", async () => {
    const files = fleetFiles({
      [FLOW]: CHECKOUT.replace("#smoke, #payments", "#smoke, #payments, #FEAT-101"),
    });
    files["architecture/landscape.likec4"] = FLEET.replace("  tag external", "  tag external\n  tag FEAT-101");
    const p = await makeProject(files);
    try {
      expect((await runLoam(p.workDir, "flow", "sync")).code).toBe(0);
      // Enforced where it counts: no view was generated for the reserved name,
      // so the suite really is empty rather than merely reported.
      const views = await p.read(VIEWS);
      expect(views).toContain("view flow_group_smoke {");
      expect(views).not.toContain("FEAT");
      const res = await runLoam(p.workDir, "validate", "--all", "--json");
      const findings = flowFindings(res.stdout);
      expect(findings.map((f) => f.code)).toEqual(["flow.group-invalid"]);
      expect(findings[0]!.subject).toBe("checkoutJourney");
      // A warning: the document is legal and the fix is the author's judgement.
      expect(findings[0]!.severity).toBe("warn");
    } finally {
      await p.destroy();
    }
  });

  it("a mistyped group is a parse error, not a second empty group", async () => {
    // The whole reason grouping is by tag: `#smoek` is undeclared, so LikeC4
    // refuses the document instead of opening a suite nobody meant.
    const p = await makeProject(fleetFiles({ [FLOW]: CHECKOUT.replace("#smoke", "#smoek") }));
    try {
      const res = await runLoam(p.workDir, "validate", "--all", "--json");
      const findings = flowFindings(res.stdout);
      expect(findings.map((f) => f.code)).toEqual(["flow.invalid"]);
      expect(findings[0]!.details!.join("\n")).toContain("smoek");
    } finally {
      await p.destroy();
    }
  });
});

describe("a journey drawn in the fleet map is a journey", () => {
  /** The map, with a tagged dynamic view of its own appended. */
  const MAP_WITH_JOURNEY =
    FLEET +
    `
views {
  dynamic view legacyJourney {
    #smoke
    title 'Drawn in the map'
    checkoutWeb -> paymentService 'authorize'
  }
}
`;

  it("counts for its group whether or not anything sits under architecture/flows/", async () => {
    // The flow set is every dynamic view the architecture/ project declares.
    // Reading only the flows directory made this journey visible exactly when
    // some UNRELATED file happened to sit beside it — and invisible again when
    // that file was deleted, which is an answer that depends on nothing to do
    // with the journey.
    const alone = await makeProject({ ...fleetFiles({}), "architecture/landscape.likec4": MAP_WITH_JOURNEY });
    try {
      const env = await runLoam(alone.workDir, "flow", "env", "smoke", "--json");
      expect(env.code).toBe(0);
      expect(JSON.parse(env.stdout).groups[0].flows).toEqual(["legacyJourney"]);
      expect((await runLoam(alone.workDir, "flow", "sync")).code).toBe(0);
      expect(await alone.read(VIEWS)).toContain("view flow_group_smoke {");
    } finally {
      await alone.destroy();
    }
  });

  it("keeps its group view when the last file under flows/ is deleted", async () => {
    const p = await makeProject({
      ...fleetFiles({ "architecture/flows/refund.likec4": REFUND }),
      "architecture/landscape.likec4": MAP_WITH_JOURNEY,
    });
    try {
      expect((await runLoam(p.workDir, "flow", "sync")).code).toBe(0);
      expect(await p.read(VIEWS)).toContain("view flow_group_payments {");
      // Retiring the payments journey must not take the smoke suite with it —
      // the smoke journey is still declared, and still tagged.
      await rm(join(p.docsDir, "architecture", "flows", "refund.likec4"));
      const res = await runLoam(p.workDir, "flow", "sync", "--json");
      expect(res.code).toBe(0);
      expect(JSON.parse(res.stdout).action).toBe("updated");
      const views = await p.read(VIEWS);
      expect(views).toContain("view flow_group_smoke {");
      expect(views).not.toContain("flow_group_payments");
    } finally {
      await p.destroy();
    }
  });
});

describe("an unreadable flow document suspends the axis rather than emptying it", () => {
  it("validate reports flow.invalid alone — never flow.views-stale behind it", async () => {
    const p = await makeProject(fleetFiles());
    try {
      expect((await runLoam(p.workDir, "flow", "sync")).code).toBe(0);
      await p.write(FLOW, CHECKOUT.replace("paymentService -> stripe", "paymentService -> nosuchThing"));
      const res = await runLoam(p.workDir, "validate", "--all", "--json");
      // Without the suspension the unreadable document would contribute no
      // group, and the perfectly correct views file beside it would be graded
      // "must be absent" — a finding whose repair deletes real content.
      expect(flowFindings(res.stdout).map((f) => f.code)).toEqual(["flow.invalid"]);
    } finally {
      await p.destroy();
    }
  });

  it("a flows/ that cannot be enumerated is one finding, not a run that graded nothing", async () => {
    // `architecture/flows` as a FILE: readdir answers ENOTDIR. This target runs
    // outside validate's per-target `guarded`, so before the read was contained
    // the whole run answered `repository-unavailable` — "nothing was validated"
    // over a fleet whose services are all fine.
    const files = fleetFiles({});
    files["architecture/flows"] = "not a directory\n";
    const p = await makeProject(files);
    try {
      const res = await runLoam(p.workDir, "validate", "--all", "--json");
      const payload = JSON.parse(res.stdout);
      expect(payload.ok).toBe(true);
      expect(flowFindings(res.stdout).map((f) => f.code)).toEqual(["flow.invalid"]);
      // The rest of the fleet was still graded: both services have targets.
      expect(payload.targets.filter((t: { kind: string }) => t.kind === "service")).toHaveLength(2);
    } finally {
      await p.destroy();
    }
  });

  it("sync refuses `flow-invalid` and leaves the generated file exactly as it was", async () => {
    const p = await makeProject(fleetFiles());
    try {
      expect((await runLoam(p.workDir, "flow", "sync")).code).toBe(0);
      const before = await treeHashes(p.docsDir);
      await p.write(FLOW, CHECKOUT.replace("paymentService -> stripe", "paymentService -> nosuchThing"));
      const after = await treeHashes(p.docsDir);
      const res = await runLoam(p.workDir, "flow", "sync", "--json");
      expect(res.code).toBe(1);
      const payload = JSON.parse(res.stdout);
      expect(payload.ok).toBe(false);
      expect(payload.error.code).toBe("flow-invalid");
      // The refusal names the document, and the views file is untouched.
      expect(payload.error.message).toContain(FLOW);
      expect(await treeHashes(p.docsDir)).toEqual(after);
      expect(before[VIEWS]).toBe(after[VIEWS]);
    } finally {
      await p.destroy();
    }
  });
});

describe("loam flow env — the participant union as machine output", () => {
  it("answers which services must be up, and NAMES what it could not resolve", async () => {
    const p = await makeProject(fleetFiles({ [FLOW]: CHECKOUT, "architecture/flows/refund.likec4": REFUND }));
    try {
      const res = await runLoam(p.workDir, "flow", "env", "--json");
      expect(res.code).toBe(0);
      const payload = JSON.parse(res.stdout);
      expect(payload.groups).toEqual([
        {
          group: "payments",
          flows: ["checkoutJourney", "refundJourney"],
          services: ["checkout-web", "payment-service"],
          // Stripe models no services/ directory. Absent from `services` and
          // PRESENT here: an environment silently one service short is the one
          // wrong answer this command cannot be allowed to give.
          unresolved: [{ participant: "stripe", service: "Stripe", external: true }],
        },
        {
          group: "smoke",
          flows: ["checkoutJourney"],
          services: ["checkout-web", "payment-service"],
          unresolved: [{ participant: "stripe", service: "Stripe", external: true }],
        },
      ]);
    } finally {
      await p.destroy();
    }
  });

  it("naming a group filters the same shape; an unknown group is unknown-target", async () => {
    const p = await makeProject(fleetFiles());
    try {
      const one = await runLoam(p.workDir, "flow", "env", "smoke", "--json");
      expect(one.code).toBe(0);
      const payload = JSON.parse(one.stdout);
      expect(payload.groups.map((g: { group: string }) => g.group)).toEqual(["smoke"]);

      const missing = await runLoam(p.workDir, "flow", "env", "smoek", "--json");
      expect(missing.code).toBe(1);
      const error = JSON.parse(missing.stdout).error;
      expect(error.code).toBe("unknown-target");
      expect(error.message).toContain("payments, smoke");
    } finally {
      await p.destroy();
    }
  });

  it("the text view names the unresolved participant on a line of its own", async () => {
    const p = await makeProject(fleetFiles());
    try {
      const res = await runLoam(p.workDir, "flow", "env", "smoke");
      expect(res.code).toBe(0);
      expect(res.stdout).toContain("group smoke — 1 flow(s), 2 service(s) must be up");
      expect(res.stdout).toContain("! stripe — no services/Stripe/");
    } finally {
      await p.destroy();
    }
  });

  it("says so plainly when no flow carries a group tag", async () => {
    const p = await makeProject(fleetFiles({ [FLOW]: CHECKOUT.replace("    #smoke, #payments\n", "") }));
    try {
      const res = await runLoam(p.workDir, "flow", "env");
      expect(res.code).toBe(0);
      expect(res.stdout).toContain("no flow groups");
      const json = await runLoam(p.workDir, "flow", "env", "--json");
      expect(JSON.parse(json.stdout).groups).toEqual([]);
    } finally {
      await p.destroy();
    }
  });

  it("refuses an unknown verb and an argument the verb does not take", async () => {
    const p = await makeProject(fleetFiles());
    try {
      const verb = await runLoam(p.workDir, "flow", "resync", "--json");
      expect(verb.code).toBe(1);
      expect(JSON.parse(verb.stdout).error.code).toBe("invalid-option");
      // A silently ignored argument is a command that did something other than
      // what was asked — `subsystem`'s rule, kept.
      const arity = await runLoam(p.workDir, "flow", "sync", "smoke", "--json");
      expect(arity.code).toBe(1);
      expect(JSON.parse(arity.stdout).error.code).toBe("invalid-option");
    } finally {
      await p.destroy();
    }
  });
});
