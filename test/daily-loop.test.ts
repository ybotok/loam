/**
 * The daily loop: `loam new` -> `loam delta` -> `loam dependencies`.
 *
 * These three are what someone touches every day once the fleet is onboarded,
 * and each of them had a way of being confidently wrong:
 *
 *  - `new` interpolated a free-text `--title` into YAML and scaffolded a
 *    `delta.likec4` that failed `loam validate` on its very first run;
 *  - `delta` printed a table of contents where `--json` carried the whole
 *    briefing, never mentioned the OpenAPI delta at all, and answered a typo'd
 *    `--service` with a perfectly plausible empty report;
 *  - `dependencies` counted a restated LIVING operation as introduced, which
 *    invented prerequisites, conflicts and cycles between features that share
 *    nothing but an existing endpoint — and, in the other direction, could not
 *    see a C4 edge's `metadata { op }` or two features rewriting one requirement.
 *
 * Every test here is about one of those: the command being trustworthy enough
 * to act on without opening the files yourself.
 */
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { analyzeDependencies } from "../src/core/dependencies/dependencies.js";
import {
  LIVING_OPENAPI,
  LIVING_SPEC,
  coherentFixture,
  makeProject,
  runLoam,
  type Project,
} from "./helpers/harness.js";

/**
 * The floor of a docs repo: `services/` exists, even when it is empty. That is
 * what `loam init --create` scaffolds, and enumeration refuses a directory
 * without it rather than reporting an empty fleet — so a fixture that omits it
 * is testing the wrong refusal.
 */
const DOCS_REPO = { "services/.gitkeep": "" };

/**
 * The files that make `services/<svc>/` a living service. `--touches` names a
 * service that already exists (`--new-service` is the flag that introduces
 * one), so a fixture that touches nothing real trips `delta.service-unknown`.
 */
function livingService(svc: string): Record<string, string> {
  return {
    [`services/${svc}/model.likec4`]: `specification {
  element softwareSystem
}

model {
  svc = softwareSystem '${svc}' {
    metadata {
      service '${svc}'
    }
  }
}
`,
    [`services/${svc}/spec.md`]: `# ${svc}

## Requirements

### Requirement: Exist
The service SHALL exist.

#### Scenario: It exists
- **Given** the fleet
- **When** it is listed
- **Then** ${svc} is in it
`,
  };
}

async function withProject(
  files: Record<string, string>,
  fn: (p: Project) => Promise<void>,
): Promise<void> {
  const p = await makeProject({ ...DOCS_REPO, ...files });
  try {
    await fn(p);
  } finally {
    await p.destroy();
  }
}

/** The frontmatter block of a markdown file, parsed. */
function frontmatter(md: string): Record<string, unknown> {
  const close = md.indexOf("\n---", 3);
  return parseYaml(md.slice(3, close)) as Record<string, unknown>;
}

/** Every findings code of one `validate --json` target. */
function codesOf(stdout: string): string[] {
  return JSON.parse(stdout).targets[0].findings.map((f: { code: string }) => f.code);
}

function errorsOf(stdout: string): Array<{ code: string; message: string }> {
  return JSON.parse(stdout).targets[0].findings.filter(
    (f: { severity: string }) => f.severity === "error",
  );
}

/* ------------------------------------------------------------------ */
/* new: the title is data, not source code                             */
/* ------------------------------------------------------------------ */

describe("`new --title` is serialized, never interpolated", () => {
  it("a colon in the title does not reopen the YAML mapping", async () => {
    await withProject({}, async (p) => {
      const res = await runLoam(p.workDir, "new", "FEAT-2", "--title", "Checkout: split payments");
      expect(res.code).toBe(0);

      const intent = await p.read("features/FEAT-2-checkout-split-payments/intent.md");
      // The whole title, not the fragment before the colon — and the document
      // still parses, which is the half that used to fail outright.
      expect(frontmatter(intent).title).toBe("Checkout: split payments");
      expect(frontmatter(intent).feature).toBe("FEAT-2");

      const validated = await runLoam(p.workDir, "validate", "--feature", "FEAT-2", "--json");
      expect(validated.code).toBe(0);
    });
  });

  it("a '#' in the title is not eaten as a YAML comment", async () => {
    await withProject({}, async (p) => {
      const res = await runLoam(p.workDir, "new", "FEAT-3", "--title", "Orders #42 rework");
      expect(res.code).toBe(0);
      const intent = await p.read("features/FEAT-3-orders-42-rework/intent.md");
      expect(frontmatter(intent).title).toBe("Orders #42 rework");
    });
  });

  it("quotes, braces and leading whitespace survive the round trip", async () => {
    await withProject({}, async (p) => {
      const title = `  "Wire" {transfers} — 100% [v2] & more  `;
      expect((await runLoam(p.workDir, "new", "FEAT-4", "--title", title)).code).toBe(0);
      const intent = await p.read("features/FEAT-4-wire-transfers-100-v2-more/intent.md");
      expect(frontmatter(intent).title).toBe(title);
    });
  });

  it("scaffolds no `owner` key at all rather than an explicit null", async () => {
    await withProject({}, async (p) => {
      await runLoam(p.workDir, "new", "FEAT-1", "--title", "T");
      const fm = frontmatter(await p.read("features/FEAT-1-t/intent.md"));
      // `owner:` with nothing after it parses to null — a claim that the feature
      // HAS no owner, where the truth is that nobody has said yet.
      expect(Object.keys(fm)).not.toContain("owner");
      expect(await p.read("features/FEAT-1-t/intent.md")).toContain("# owner:");
    });
  });
});

/* ------------------------------------------------------------------ */
/* new: the scaffold passes its own gate                               */
/* ------------------------------------------------------------------ */

describe("a `--touches` scaffold validates clean on the first run", () => {
  it("emits zero errors — the context elements are commented out", async () => {
    await withProject(livingService("svc-a"), async (p) => {
      expect(
        (await runLoam(p.workDir, "new", "FEAT-1", "--title", "T", "--touches", "svc-a")).code,
      ).toBe(0);

      const res = await runLoam(p.workDir, "validate", "--feature", "FEAT-1", "--json");
      expect(res.code).toBe(0);
      expect(errorsOf(res.stdout)).toEqual([]);
      // `delta.nothing-tagged` is the gate the scaffold used to trip: an
      // untagged context element makes `model {}` non-empty without making it a
      // change. The gate is NOT relaxed — the scaffold stopped breaking it.
      expect(codesOf(res.stdout)).toContain("delta.valid");
      expect(codesOf(res.stdout)).not.toContain("delta.nothing-tagged");
    });
  });

  it("but `--touches` a service that does not exist is the typo, and the gate says so", async () => {
    await withProject({}, async (p) => {
      await runLoam(p.workDir, "new", "FEAT-1", "--title", "T", "--touches", "svc-a");
      const res = await runLoam(p.workDir, "validate", "--feature", "FEAT-1", "--json");
      expect(res.code).toBe(1);
      // Nothing introduces svc-a: the scaffold comments its context element
      // out, and no services/svc-a/ exists — archive would create the
      // directory out of the typo.
      expect(errorsOf(res.stdout).map((f) => f.code)).toEqual(["delta.service-unknown"]);
    });
  });

  it("the touched service is still written down, as a commented identifier", async () => {
    await withProject({}, async (p) => {
      await runLoam(p.workDir, "new", "FEAT-1", "--touches", "payment-service");
      const delta = await p.read("features/FEAT-1/delta.likec4");
      const line = delta.split("\n").find((l) => l.includes("'payment-service'"))!;
      expect(line.trimStart().startsWith("//")).toBe(true);
      expect(line).toContain("paymentService = softwareSystem");
    });
  });

  it("the closing hint says a requirements-only feature should delete delta.likec4", async () => {
    await withProject({}, async (p) => {
      const res = await runLoam(p.workDir, "new", "FEAT-1", "--touches", "svc-a");
      expect(res.out).toContain("delete delta.likec4");
      expect(await p.read("features/FEAT-1/delta.likec4")).toContain("DELETE this file");
    });
  });

  it("a new service keeps its tagged element, so its delta is still a change", async () => {
    // svc-b is introduced by the delta's own tagged element and needs no
    // seeding; svc-a is merely touched, so it has to already exist.
    await withProject(livingService("svc-a"), async (p) => {
      await runLoam(p.workDir, "new", "FEAT-1", "--touches", "svc-a", "--new-service", "svc-b");
      const delta = await p.read("features/FEAT-1/delta.likec4");
      const tagged = delta.split("\n").find((l) => l.includes("'svc-b'"))!;
      expect(tagged.trimStart().startsWith("//")).toBe(false);
      expect(delta).toContain("#FEAT-1");

      const res = await runLoam(p.workDir, "validate", "--feature", "FEAT-1", "--json");
      expect(errorsOf(res.stdout)).toEqual([]);
    });
  });
});

/* ------------------------------------------------------------------ */
/* new / delta: service ids are validated, not interpolated            */
/* ------------------------------------------------------------------ */

describe("service ids go through the one grammar", () => {
  it("`--touches ../../ESCAPED` is refused and nothing is written", async () => {
    await withProject({}, async (p) => {
      const res = await runLoam(p.workDir, "new", "FEAT-1", "--touches", "../../ESCAPED", "--json");
      expect(res.code).toBe(1);
      expect(JSON.parse(res.stdout).error.code).toBe("invalid-option");
      expect(JSON.parse(res.stdout).error.message).toContain("..");
      // Not merely "outside the feature" — nothing at all was created, so the
      // refusal cannot have written half a scaffold before noticing.
      expect(p.exists("features")).toBe(false);
      expect(p.exists("../ESCAPED")).toBe(false);
    });
  });

  it("`--new-service` with a slash is refused the same way", async () => {
    await withProject({}, async (p) => {
      const res = await runLoam(p.workDir, "new", "FEAT-1", "--new-service", "a/b", "--json");
      expect(res.code).toBe(1);
      expect(JSON.parse(res.stdout).error.code).toBe("invalid-option");
      expect(p.exists("features")).toBe(false);
    });
  });

  it("`delta --service ../../etc` is refused before any path is built", async () => {
    await withProject(coherentFixture(), async (p) => {
      const res = await runLoam(p.workDir, "delta", "FEAT-1", "--service", "../../etc", "--json");
      expect(res.code).toBe(1);
      expect(JSON.parse(res.stdout).error.code).toBe("invalid-option");
    });
  });

  it("`delta --service bogus` refuses instead of printing a plausible empty report", async () => {
    await withProject(coherentFixture(), async (p) => {
      const res = await runLoam(p.workDir, "delta", "FEAT-1", "--service", "bogus", "--json");
      expect(res.code).toBe(1);
      const json = JSON.parse(res.stdout);
      expect(json.error.code).toBe("unknown-target");
      // The refusal has to be actionable: it names what the feature does touch.
      expect(json.error.message).toContain("payment-split-service");
    });
  });

  it("a near-miss on a living service is named in the refusal", async () => {
    await withProject(coherentFixture(), async (p) => {
      const res = await runLoam(p.workDir, "delta", "FEAT-1", "--service", "payment-servic");
      expect(res.code).toBe(1);
      expect(res.out).toContain("'payment-service'");
    });
  });

  it("a living service the feature does not touch still projects (honestly empty)", async () => {
    const files = coherentFixture();
    files["services/kafka/spec.md"] = "---\nservice: kafka\n---\n\n# kafka\n\n## Requirements\n";
    await withProject(files, async (p) => {
      const res = await runLoam(p.workDir, "delta", "FEAT-1", "--service", "kafka", "--json");
      expect(res.code).toBe(0);
      const json = JSON.parse(res.stdout);
      expect(json.requirements).toEqual([]);
      expect(json.api).toEqual([]);
      expect(json.architecture).toEqual({ isNew: false, inbound: [], outbound: [], errors: [] });
    });
  });
});

/* ------------------------------------------------------------------ */
/* delta: the output is the task                                       */
/* ------------------------------------------------------------------ */

describe("`delta` text output is a task, not a table of contents", () => {
  it("prints the requirement body and the Given/When/Then lines verbatim", async () => {
    await withProject(coherentFixture(), async (p) => {
      const res = await runLoam(p.workDir, "delta", "FEAT-1", "--service", "payment-split-service");
      expect(res.code).toBe(0);
      expect(res.out).toContain("[ADDED] Split a payment");
      expect(res.out).toContain("The service SHALL split a payment across payees summing to the total.");
      expect(res.out).toContain("Scenario: Split across two payees");
      expect(res.out).toContain("- **Given** a payment of 100.00");
      expect(res.out).toContain("- **When** it is split 60/40");
      expect(res.out).toContain("- **Then** two shares are recorded");
    });
  });

  it("names the path and the method of every operation the delta defines", async () => {
    await withProject(coherentFixture(), async (p) => {
      const res = await runLoam(p.workDir, "delta", "FEAT-1", "--service", "payment-split-service");
      expect(res.out).toContain("POST /splits");
      expect(res.out).toContain("createSplit");
      expect(res.out).toContain("Create a split");
    });
  });

  it("--json carries the same api section, slot by slot", async () => {
    await withProject(coherentFixture(), async (p) => {
      const json = JSON.parse(
        (await runLoam(p.workDir, "delta", "FEAT-1", "--service", "payment-split-service", "--json"))
          .stdout,
      );
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

  it("a removal marker reads as a removal, in both views", async () => {
    const files = coherentFixture();
    files["features/FEAT-1-split/specs/payment-service/openapi.yaml"] = `openapi: 3.1.0
info: { title: payment-service, version: "1.0" }
paths:
  /payments/authorize:
    post:
      operationId: authorizePayment
      x-loam-remove: true
      responses:
        "200": { description: gone }
`;
    await withProject(files, async (p) => {
      const res = await runLoam(p.workDir, "delta", "FEAT-1", "--service", "payment-service");
      expect(res.out).toContain("REMOVE POST /payments/authorize");
      const json = JSON.parse(
        (await runLoam(p.workDir, "delta", "FEAT-1", "--service", "payment-service", "--json"))
          .stdout,
      );
      expect(json.api[0]).toMatchObject({ operationId: "authorizePayment", remove: true });
    });
  });

  it("refusing for want of a --service names the feature's services", async () => {
    await withProject(coherentFixture(), async (p) => {
      const text = await runLoam(p.workDir, "delta", "FEAT-1");
      expect(text.code).toBe(1);
      expect(text.out).toContain("payment-split-service");

      const res = await runLoam(p.workDir, "delta", "FEAT-1", "--json");
      expect(res.code).toBe(1);
      const json = JSON.parse(res.stdout);
      expect(json.error.code).toBe("invalid-option");
      expect(json.error.message).toContain("payment-split-service");
      // In the envelope too — an agent cannot recover from prose.
      expect(json.services).toEqual(["payment-split-service"]);
    });
  });
});

/* ------------------------------------------------------------------ */
/* dependencies: no invented prerequisites                             */
/* ------------------------------------------------------------------ */

/** An openapi delta document defining one operation at POST /x. */
function api(operationId: string): string {
  return `openapi: 3.1.0
info: { title: svc, version: "1" }
paths:
  /x:
    post:
      operationId: ${operationId}
      responses:
        "200": { description: ok }
`;
}

function requirement(kind: "ADDED" | "MODIFIED", name: string, operation?: string): string {
  return `## ${kind} Requirements

### Requirement: ${name}

The service SHALL do the thing.
${operation === undefined ? "" : `\nOperations: ${operation}\n`}
#### Scenario: Works
- **When** exercised
- **Then** it works
`;
}

const LIVING = {
  "services/payment-service/spec.md": LIVING_SPEC,
  "services/payment-service/openapi.yaml": LIVING_OPENAPI,
};

describe("`dependencies` does not invent prerequisites out of the living contract", () => {
  it("two features restating the same LIVING operation are independent", async () => {
    await withProject(
      {
        ...LIVING,
        // A feature's openapi.yaml is a complete document, not a patch: both of
        // these carry the living `authorizePayment` because that is how the file
        // is authored, and neither of them introduces it.
        "features/FEAT-1-a/specs/payment-service/openapi.yaml": LIVING_OPENAPI,
        "features/FEAT-2-b/specs/payment-service/openapi.yaml": LIVING_OPENAPI,
      },
      async (p) => {
        const graph = await analyzeDependencies(p.docsDir);
        expect(graph.edges).toEqual([]);
        expect(graph.cycles).toEqual([]);
        expect(graph.conflicts).toEqual([]);
        expect(graph.nodes.map((n) => n.dependsOn)).toEqual([[], []]);

        const res = await runLoam(p.workDir, "dependencies");
        expect(res.out).toContain("FEAT-1  (independent)");
        expect(res.out).toContain("FEAT-2  (independent)");
        expect(res.out).not.toContain("cycles");
      },
    );
  });

  it("a requirement governing a LIVING operation is not a dependency either", async () => {
    await withProject(
      {
        ...LIVING,
        "features/FEAT-1-a/specs/payment-service/openapi.yaml": LIVING_OPENAPI,
        "features/FEAT-2-b/specs/payment-service/spec.md": requirement(
          "MODIFIED",
          "Authorize a payment",
          "authorizePayment",
        ),
      },
      async (p) => {
        const graph = await analyzeDependencies(p.docsDir);
        expect(graph.edges).toEqual([]);
      },
    );
  });

  it("a genuinely NEW operation is still a prerequisite for its consumer", async () => {
    await withProject(
      {
        ...LIVING,
        "features/FEAT-1-a/specs/payment-service/openapi.yaml": api("refundSplit"),
        "features/FEAT-2-b/specs/payment-service/spec.md": requirement(
          "ADDED",
          "Refund a split",
          "refundSplit",
        ),
      },
      async (p) => {
        const graph = await analyzeDependencies(p.docsDir);
        expect(graph.edges).toEqual([
          expect.objectContaining({
            from: "FEAT-2",
            to: "FEAT-1",
            reasons: [{ kind: "operation", service: "payment-service", operationId: "refundSplit" }],
          }),
        ]);
        expect(graph.order.indexOf("FEAT-1")).toBeLessThan(graph.order.indexOf("FEAT-2"));
      },
    );
  });
});

/* ------------------------------------------------------------------ */
/* dependencies: the C4 delta is a source of dependencies              */
/* ------------------------------------------------------------------ */

const C4_EDGE_DELTA = `specification {
  element softwareSystem
  tag FEAT-2
}

model {
  checkoutWeb = softwareSystem 'checkout-web'
  paymentService = softwareSystem 'payment-service'

  checkoutWeb -> paymentService 'Calls refundSplit' {
    #FEAT-2
    metadata { op 'refundSplit' }
  }
}

views {
  view feat_2 {
    include *
  }
}
`;

describe("`dependencies` reads delta.likec4", () => {
  it("a C4 edge's `metadata { op }` makes its definer a prerequisite", async () => {
    await withProject(
      {
        ...LIVING,
        "features/FEAT-1-a/specs/payment-service/openapi.yaml": api("refundSplit"),
        "features/FEAT-2-b/delta.likec4": C4_EDGE_DELTA,
      },
      async (p) => {
        const graph = await analyzeDependencies(p.docsDir);
        expect(graph.edges).toEqual([
          expect.objectContaining({
            from: "FEAT-2",
            to: "FEAT-1",
            reasons: [{ kind: "operation", service: "payment-service", operationId: "refundSplit" }],
          }),
        ]);

        // The same pair of features `loam validate` already calls out — the two
        // commands agreeing is the point, a graph that contradicts the validator
        // is worse than no graph.
        const validated = await runLoam(p.workDir, "validate", "--feature", "FEAT-2", "--json");
        expect(codesOf(validated.stdout)).toContain("c4-api.op-pending");
      },
    );
  });

  it("an edge onto an operation the service already provides is nobody's prerequisite", async () => {
    const delta = C4_EDGE_DELTA.replace(/refundSplit/g, "authorizePayment");
    await withProject(
      {
        ...LIVING,
        "features/FEAT-1-a/specs/payment-service/openapi.yaml": LIVING_OPENAPI,
        "features/FEAT-2-b/delta.likec4": delta,
      },
      async (p) => {
        expect((await analyzeDependencies(p.docsDir)).edges).toEqual([]);
      },
    );
  });

  it("an unparseable delta contributes nothing rather than guesses", async () => {
    await withProject(
      {
        ...LIVING,
        "features/FEAT-1-a/specs/payment-service/openapi.yaml": api("refundSplit"),
        "features/FEAT-2-b/delta.likec4": "model {\n  a = bogusKind 'a'\n}\n",
      },
      async (p) => {
        expect((await analyzeDependencies(p.docsDir)).edges).toEqual([]);
      },
    );
  });
});

/* ------------------------------------------------------------------ */
/* dependencies: MODIFIED vs MODIFIED                                  */
/* ------------------------------------------------------------------ */

const LIVING_ORDERS = `---
service: orders
status: verified
---

# orders

## Requirements

### Requirement: Cancel an order
The service SHALL cancel an order before dispatch.

#### Scenario: Cancelled
- **When** cancellation is requested
- **Then** the order is cancelled
`;

describe("two features rewriting one requirement is a conflict", () => {
  it("MODIFIED vs MODIFIED reaches the conflicts section", async () => {
    await withProject(
      {
        "services/orders/spec.md": LIVING_ORDERS,
        "features/FEAT-1-a/specs/orders/spec.md": requirement("MODIFIED", "Cancel an order"),
        "features/FEAT-2-b/specs/orders/spec.md": requirement("MODIFIED", "Cancel an order"),
      },
      async (p) => {
        const graph = await analyzeDependencies(p.docsDir);
        expect(graph.conflicts).toEqual([
          {
            kind: "requirement",
            change: "changed",
            service: "orders",
            axis: "spec.md",
            identity: "name:Cancel an order",
            features: ["FEAT-1", "FEAT-2"],
          },
        ]);

        const res = await runLoam(p.workDir, "dependencies");
        expect(res.out).toContain("conflicts");
        expect(res.out).toContain("changed by FEAT-1, FEAT-2");
      },
    );
  });

  it("a REMOVED racing a MODIFIED collides too", async () => {
    await withProject(
      {
        "services/orders/spec.md": LIVING_ORDERS,
        "features/FEAT-1-a/specs/orders/spec.md": requirement("MODIFIED", "Cancel an order"),
        "features/FEAT-2-b/specs/orders/spec.md":
          "## REMOVED Requirements\n\n### Requirement: Cancel an order\n\nGone.\n",
      },
      async (p) => {
        const graph = await analyzeDependencies(p.docsDir);
        expect(graph.conflicts).toEqual([
          expect.objectContaining({ change: "changed", features: ["FEAT-1", "FEAT-2"] }),
        ]);
      },
    );
  });

  it("one feature modifying it alone is not a conflict", async () => {
    await withProject(
      {
        "services/orders/spec.md": LIVING_ORDERS,
        "features/FEAT-1-a/specs/orders/spec.md": requirement("MODIFIED", "Cancel an order"),
      },
      async (p) => {
        expect((await analyzeDependencies(p.docsDir)).conflicts).toEqual([]);
      },
    );
  });

  it("an ADDED collision still reads as `added`, so the two fixes stay apart", async () => {
    await withProject(
      {
        "services/orders/spec.md": LIVING_ORDERS,
        "features/FEAT-1-a/specs/orders/spec.md": requirement("ADDED", "Batch cancel"),
        "features/FEAT-2-b/specs/orders/spec.md": requirement("ADDED", "Batch cancel"),
      },
      async (p) => {
        const graph = await analyzeDependencies(p.docsDir);
        expect(graph.conflicts).toEqual([
          expect.objectContaining({ change: "added", features: ["FEAT-1", "FEAT-2"] }),
        ]);
        expect((await runLoam(p.workDir, "dependencies")).out).toContain("added by FEAT-1, FEAT-2");
      },
    );
  });
});

/* ------------------------------------------------------------------ */
/* new: scaffold hints                                                 */
/* ------------------------------------------------------------------ */

describe("`new` says when --touches names nothing", () => {
  it("prints the near-miss for a mistyped living service", async () => {
    await withProject(
      { "services/orders-api/spec.md": "---\nservice: orders-api\n---\n\n# orders-api\n" },
      async (p) => {
        const res = await runLoam(p.workDir, "new", "FEAT-1", "--touches", "order-api");
        expect(res.code).toBe(0);
        expect(res.out).toContain("note:");
        expect(res.out).toContain("'orders-api'");
        expect(res.out).toContain("--new-service order-api");
      },
    );
  });

  it("says nothing about a service that exists", async () => {
    await withProject(
      { "services/orders-api/spec.md": "---\nservice: orders-api\n---\n\n# orders-api\n" },
      async (p) => {
        const res = await runLoam(p.workDir, "new", "FEAT-1", "--touches", "orders-api", "--json");
        expect(JSON.parse(res.stdout).notes).toEqual([]);
      },
    );
  });

  it("says nothing about a service this feature introduces", async () => {
    await withProject(
      { "services/orders-api/spec.md": "---\nservice: orders-api\n---\n\n# orders-api\n" },
      async (p) => {
        const res = await runLoam(
          p.workDir,
          "new",
          "FEAT-1",
          "--touches",
          "order-api",
          "--new-service",
          "order-api",
          "--json",
        );
        expect(JSON.parse(res.stdout).notes).toEqual([]);
      },
    );
  });
});

describe("`new --new-service` scaffolds the architecture axis", () => {
  it("writes an arch.spec.md template that parses to no requirements yet", async () => {
    await withProject({}, async (p) => {
      const res = await runLoam(p.workDir, "new", "FEAT-1", "--new-service", "svc-a", "--json");
      expect(res.code).toBe(0);
      expect(JSON.parse(res.stdout).created).toContain(
        "features/FEAT-1/specs/svc-a/arch.spec.md",
      );

      const arch = await p.read("features/FEAT-1/specs/svc-a/arch.spec.md");
      expect(arch).toContain("Covers:");
      expect(arch).toContain("alert:");
      // The template body must not parse as a requirement, or the scaffold
      // would ship a requirement nobody wrote — and archive would merge it.
      const validated = await runLoam(p.workDir, "validate", "--feature", "FEAT-1", "--json");
      expect(errorsOf(validated.stdout)).toEqual([]);
    });
  });

  it("only a NEW service gets one — a touched service's arch spec is not loam's to guess", async () => {
    await withProject({}, async (p) => {
      await runLoam(p.workDir, "new", "FEAT-1", "--touches", "svc-a", "--new-service", "svc-b");
      expect(p.exists("features/FEAT-1/specs/svc-b/arch.spec.md")).toBe(true);
      expect(p.exists("features/FEAT-1/specs/svc-a/arch.spec.md")).toBe(false);
    });
  });

  it("filling it in silences c4.uncovered for the new element", async () => {
    await withProject({}, async (p) => {
      await runLoam(p.workDir, "new", "FEAT-1", "--new-service", "svc-a");
      const before = await runLoam(p.workDir, "validate", "--feature", "FEAT-1", "--json");
      expect(codesOf(before.stdout)).toContain("c4.uncovered");

      // Exactly the block the template carries, unindented out of its comment.
      await p.write(
        "features/FEAT-1/specs/svc-a/arch.spec.md",
        `# svc-a — architecture requirement delta for FEAT-1

## ADDED Requirements

### Requirement: Retries are bounded
Requirement-ID: FEAT-1.svc-a.arch

The service SHALL stop retrying after five attempts.

Covers: svc-a

#### Scenario: Sixth attempt is not made
- **Given** five failed attempts
- **When** the sixth is due
- **Then** the message is parked
`,
      );
      const after = await runLoam(p.workDir, "validate", "--feature", "FEAT-1", "--json");
      expect(codesOf(after.stdout)).not.toContain("c4.uncovered");
      expect(errorsOf(after.stdout)).toEqual([]);
    });
  });
});
