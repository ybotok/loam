/**
 * The architecture spec axis — arch.spec.md, the `Covers:` line, and the
 * coverage obligations derived from it.
 *
 * The motivating case pins the design: a business spec will never mention the
 * transactional outbox, and agent-generated code cuts corners exactly where no
 * scenario was ever going to look — so the obligations are DERIVED (c4.uncovered,
 * health.uncovered) instead of trusted, and the `Covers:` line is checked against
 * the model the way `Operations:` is checked against OpenAPI (covers.unknown).
 * Everything here is warnings: the axis never gates archive, `--strict` escalates.
 */
import { describe, expect, it } from "vitest";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseCoversEntry, closeIds } from "../src/core/c4/arch.js";
import { readHealth, type HealthFile } from "../src/core/vocabulary/health.js";
import { parseRequirements } from "../src/core/document/parse.js";
import {
  coherentFixture,
  LANDSCAPE,
  makeProject,
  makeTmpDir,
  pinFor,
  runLoam,
  type Project,
} from "./helpers/harness.js";

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

interface Finding {
  severity: string;
  code: string;
  subject?: string;
  message: string;
}

function findings(stdout: string): Finding[] {
  const payload = JSON.parse(stdout) as { targets: Array<{ findings: Finding[] }> };
  return payload.targets.flatMap((t) => t.findings);
}

function ofCode(all: Finding[], code: string): Finding[] {
  return all.filter((f) => f.code === code);
}

/* ------------------------------------------------------------------ */
/* Covers: parsing                                                     */
/* ------------------------------------------------------------------ */

const ARCH_REQ = (covers: string): string => `---
service: payment-service
status: draft
owner: x
---

# arch

## Requirements

### Requirement: Outbox discipline
The service SHALL publish through the outbox.

${covers}

#### Scenario: Broker down
- **Given** an event in the outbox
- **When** kafka is down
- **Then** the event is published later
`;

describe("Covers: parsing (spec.ts)", () => {
  it("parses a comma-separated Covers: line off the requirement body", () => {
    const [r] = parseRequirements(ARCH_REQ("Covers: paymentService.api, paymentService -> kafka, alert:err_rate"));
    expect(r!.covers).toEqual(["paymentService.api", "paymentService -> kafka", "alert:err_rate"]);
    // The line stays body text too, exactly like Operations: — serialization keeps it.
    expect(r!.text.join("\n")).toContain("Covers:");
  });

  it("mirrors the Operations quirk exactly: a second Covers line REPLACES the first", () => {
    const [r] = parseRequirements(ARCH_REQ("Covers: a, b\nCovers: c"));
    expect(r!.covers).toEqual(["c"]);
    // And the same doc's Operations behave identically — the two lists cannot
    // drift apart in how they read a repeated line.
    const [o] = parseRequirements(ARCH_REQ("Operations: a, b\nOperations: c"));
    expect(o!.operations).toEqual(["c"]);
  });

  it("accepts the singular spelling, as Operations: does", () => {
    const [r] = parseRequirements(ARCH_REQ("Cover: paymentService"));
    expect(r!.covers).toEqual(["paymentService"]);
  });

  it("classifies the four entry forms", () => {
    expect(parseCoversEntry("paymentService.db")).toEqual({
      form: "element",
      id: "paymentService.db",
      raw: "paymentService.db",
    });
    expect(parseCoversEntry("a -> b")).toEqual({ form: "edge", source: "a", target: "b", raw: "a -> b" });
    expect(parseCoversEntry("alert:err_rate")).toEqual({ form: "alert", id: "err_rate", raw: "alert:err_rate" });
    expect(parseCoversEntry("sli: availability")).toEqual({
      form: "sli",
      id: "availability",
      raw: "sli: availability",
    });
    expect(parseCoversEntry("node:eu.dcA")).toEqual({ form: "node", id: "eu.dcA", raw: "node:eu.dcA" });
    expect(parseCoversEntry("node: eu.a.db -> node:eu.b.db")).toEqual({
      form: "node-edge",
      source: "eu.a.db",
      target: "eu.b.db",
      raw: "node: eu.a.db -> node:eu.b.db",
    });
  });

  it("takes both sides of a deployment edge or neither, and never reads `->` as part of an id", () => {
    // A mixed entry stays an ordinary edge, whose prefixed side then resolves to
    // nothing. There is no edge in any model with one endpoint in the logical
    // map and one in the deployment map, so the alternative is inventing a join.
    expect(parseCoversEntry("node:eu.dcA -> paymentService")).toEqual({
      form: "edge",
      source: "node:eu.dcA",
      target: "paymentService",
      raw: "node:eu.dcA -> paymentService",
    });
    expect(parseCoversEntry("paymentService -> node:eu.dcA").form).toBe("edge");
    // And the `->` split runs before the prefix test, or the whole line would
    // be read as one id that can never resolve.
    expect(parseCoversEntry("node:a -> node:b").form).toBe("node-edge");
  });

  it("a bare deployment id is an element entry — one object, one spelling", () => {
    // The grammar has to be learnable: a silent second spelling for the same
    // object would resolve for some ids and not others with nothing to say why.
    expect(parseCoversEntry("eu.dcA.k8sA")).toEqual({
      form: "element",
      id: "eu.dcA.k8sA",
      raw: "eu.dcA.k8sA",
    });
  });

  it("closeIds offers only real ids, never the typo itself", () => {
    expect(closeIds("paymentServce", ["paymentService", "kafka"])).toEqual(["paymentService"]);
    expect(closeIds("zzz", ["paymentService"])).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* The health.yaml reader                                              */
/* ------------------------------------------------------------------ */

describe("readHealth (core/vocabulary/health.ts)", () => {
  async function readOf(content: string | null): Promise<HealthFile> {
    const dir = await makeTmpDir();
    const path = join(dir, "health.yaml");
    if (content !== null) await writeFile(path, content, "utf8");
    return readHealth(path);
  }

  it("reads sli and alert names from the recognized keys", async () => {
    const health = await readOf(
      "slis:\n  - name: availability\n    slo: 0.999\n  - name: latency\nalerts:\n  - name: err_rate\n    expr: x > 1\n",
    );
    expect(health.ids).toEqual({ slis: ["availability", "latency"], alerts: ["err_rate"] });
    expect(health.unreadable).toBe(false);
  });

  it("takes a plain string entry as its own id, and `id` when there is no name", async () => {
    const health = await readOf("alerts:\n  - err_rate\n  - id: burn_rate\n");
    expect(health.ids.alerts).toEqual(["err_rate", "burn_rate"]);
  });

  it("a missing or unrecognizable health.yaml yields no ids — and so no findings", async () => {
    // Absence and "declares nothing loam reads" are the same answer on purpose:
    // neither may manufacture an obligation, and neither is a breach.
    for (const content of [null, "checks:\n  liveness: GET /health\n", "slis: not-a-list\nalerts: 3\n"]) {
      expect(await readOf(content)).toEqual({
        ids: { slis: [], alerts: [] },
        dependencies: [],
        unreadable: false,
      });
    }
  });

  it("reads dependency ids under every accepted spelling — id, service, name, plain string", async () => {
    // The reader tolerates all documented forms so reconciliation does not
    // depend on which convention a fixture or existing document uses.
    const health = await readOf(
      "dependencies:\n" +
        "  - id: kafka\n    critical: startup\n" +
        "  - service: external-config\n" +
        "  - name: zookeeper\n" +
        "  - redis\n" +
        "  - id: kafka\n",
    );
    expect(health.dependencies).toEqual(["kafka", "external-config", "zookeeper", "redis"]);
    expect(health.ids).toEqual({ slis: [], alerts: [] });
  });

  it("a file that exists but cannot be read reports unknown ids, not empty ones", async () => {
    // The distinction the ids alone cannot carry, and the reason validate can
    // say `health.invalid` instead of turning every `Covers: alert:` into a
    // false typo report.
    const broken = await readOf("foo: [unclosed\n  bar: ::::\n");
    expect(broken.ids).toEqual({ slis: [], alerts: [] });
    expect(broken.unreadable).toBe(true);
    expect(broken.error).toBeTruthy();

    const sequence = await readOf("- not\n- a\n- mapping\n");
    expect(sequence.unreadable).toBe(true);
    expect(sequence.error).toBe("document is not a YAML mapping");
  });
});

/* ------------------------------------------------------------------ */
/* c4.no-relationships — the model that reaches nothing                */
/* ------------------------------------------------------------------ */

describe("c4.no-relationships", () => {
  /** A parsed model with two nested containers and not a single edge. */
  const TWO_SILOS = `specification {
  element softwareSystem
  element container
}

model {
  paymentService = softwareSystem 'payment-service' {
    api = container 'API'
    worker = container 'Worker'
  }
}
`;

  it("warns when two nested elements share a model with zero relationships", async () => {
    const files = coherentFixture();
    files["services/payment-service/model.likec4"] = TWO_SILOS;
    await withProject(files, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--service", "payment-service", "--json");
      expect(res.code).toBe(0); // warn, not a gate — partial adoption stays legal
      const [f] = ofCode(findings(res.stdout), "c4.no-relationships");
      expect(f).toBeDefined();
      expect(f!.severity).toBe("warn");
      expect(f!.message).toContain("0 relationships");
      expect(f!.message).toContain("nested elements");

      const strict = await runLoam(p.workDir, "validate", "--service", "payment-service", "--strict");
      expect(strict.code).toBe(1);
    });
  });

  it("warns when health.yaml declares dependencies the model never reaches for, and names them", async () => {
    const files = coherentFixture();
    files["services/payment-service/health.yaml"] = "dependencies:\n  - id: kafka\n  - id: redis\n";
    await withProject(files, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--service", "payment-service", "--json");
      const [f] = ofCode(findings(res.stdout), "c4.no-relationships");
      expect(f).toBeDefined();
      expect(f!.message).toContain("kafka, redis");
    });
  });

  it("stays silent on the bare baseline — thin, but nothing proves it", async () => {
    // The findings doc's own correction, pinned: 2 elements / 0 relationships
    // with no health.yaml is the standard mid-adoption shape, and warning on
    // it would teach agents to draw invented edges to get green.
    const files = coherentFixture();
    await withProject(files, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--service", "payment-service", "--json");
      expect(ofCode(findings(res.stdout), "c4.no-relationships")).toEqual([]);
    });
  });

  it("stays silent the moment one relationship exists", async () => {
    const files = coherentFixture();
    files["services/payment-service/model.likec4"] = TWO_SILOS.replace(
      "  }\n}",
      "  }\n  paymentService.api -> paymentService.worker 'queues work for'\n}",
    );
    files["services/payment-service/health.yaml"] = "dependencies:\n  - id: kafka\n";
    await withProject(files, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--service", "payment-service", "--json");
      expect(ofCode(findings(res.stdout), "c4.no-relationships")).toEqual([]);
    });
  });

  it("does not lean on an unreadable health.yaml — no claims on bad data", async () => {
    const files = coherentFixture();
    files["services/payment-service/health.yaml"] = "foo: [unclosed\n  bar: ::::\n";
    await withProject(files, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--service", "payment-service", "--json");
      expect(ofCode(findings(res.stdout), "c4.no-relationships")).toEqual([]);
      expect(ofCode(findings(res.stdout), "health.invalid")).toHaveLength(1);
    });
  });
});

/* ------------------------------------------------------------------ */
/* covers.unknown — service scope                                      */
/* ------------------------------------------------------------------ */

describe("covers.unknown on the living arch.spec.md", () => {
  it("stays quiet when every entry resolves: model element, landscape edge, health signal", async () => {
    const files = coherentFixture();
    files["services/payment-service/health.yaml"] = "alerts:\n  - name: err_rate\n";
    files["services/payment-service/arch.spec.md"] = ARCH_REQ(
      // paymentService.api lives in the service model; the checkout edge in the
      // landscape; the alert in health.yaml — resolution spans all three.
      "Covers: paymentService.api, checkoutWeb -> paymentService, alert:err_rate",
    );
    await withProject(files, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--service", "payment-service", "--json");
      expect(res.code).toBe(0);
      expect(ofCode(findings(res.stdout), "covers.unknown")).toEqual([]);
    });
  });

  it("warns on an entry that resolves to nothing, offering close ids", async () => {
    const files = coherentFixture();
    files["services/payment-service/arch.spec.md"] = ARCH_REQ("Covers: paymentService.outbox");
    await withProject(files, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--service", "payment-service", "--json");
      expect(res.code).toBe(0); // warn-only: the axis never fails validate by itself
      const [f] = ofCode(findings(res.stdout), "covers.unknown");
      expect(f).toBeDefined();
      expect(f!.severity).toBe("warn");
      expect(f!.message).toContain("'paymentService.outbox'");
      expect(f!.message).toContain("Did you mean");
      expect(f!.message).toContain("paymentService.api");
    });
  });

  it("warns on an alert entry health.yaml does not declare, and says where it looked when nothing is close", async () => {
    const files = coherentFixture();
    files["services/payment-service/arch.spec.md"] = ARCH_REQ("Covers: alert:zzz_nothing_like_it");
    await withProject(files, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--service", "payment-service", "--json");
      const [f] = ofCode(findings(res.stdout), "covers.unknown");
      expect(f!.message).toContain("resolves to nothing in the model, the landscape or health.yaml");
    });
  });

  it("--strict escalates the warning to exit 1 — the CI lever, not a new severity", async () => {
    const files = coherentFixture();
    files["services/payment-service/arch.spec.md"] = ARCH_REQ("Covers: no.such.thing");
    await withProject(files, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--service", "payment-service", "--strict", "--json");
      expect(res.code).toBe(1);
      expect(JSON.parse(res.stdout).valid).toBe(true);
    });
  });
});

/* ------------------------------------------------------------------ */
/* health.uncovered — service scope                                    */
/* ------------------------------------------------------------------ */

describe("Covers: node: — the deployment forms", () => {
  /**
   * The landscape's own specification has to declare the kinds, because
   * `architecture/` is ONE LikeC4 project and a second `specification` block in
   * the deployment document would be a duplicate error blamed on both files.
   */
  const LANDSCAPE_WITH_KINDS = LANDSCAPE.replace(
    "  element person\n}",
    "  element person\n  deploymentNode region\n  deploymentNode cluster\n}",
  );

  /**
   * A file of its OWN, beside the landscape — which is the point of the fixture
   * rather than an arbitrary layout. `validate --service` loads only
   * `landscape.likec4`; `validate --all` loads the whole project. A topology
   * written here is invisible to the first unless the lazy load in
   * `validate/service/specs.ts` is wired, so this file is what makes the
   * agreement test below able to fail.
   */
  const DEPLOYMENT = `deployment {
  eu = region 'EU' {
    a = cluster 'cluster-a' {
      instanceOf paymentService
    }
    b = cluster 'cluster-b' {
      instanceOf paymentService
    }
    a.paymentService -> b.paymentService 'Replicates authorization state'
  }
}
`;

  const geoFixture = (covers: string): Record<string, string> => {
    const files = coherentFixture();
    files["architecture/landscape.likec4"] = LANDSCAPE_WITH_KINDS;
    files["architecture/deployment.likec4"] = DEPLOYMENT;
    files["services/payment-service/arch.spec.md"] = ARCH_REQ(covers);
    return files;
  };

  it("resolves a node and a deployment edge, and BOTH validate forms agree", async () => {
    await withProject(
      geoFixture("Covers: node:eu.a, node:eu.a.paymentService -> node:eu.b.paymentService"),
      async (p) => {
        // Asserted as a relation over the two commands, not as one golden
        // payload: they answer from different loads — a single-file landscape
        // read and a whole-project one — and `loam status`'s two forms have
        // twice been caught disagreeing about a question exactly this shape.
        for (const args of [
          ["validate", "--service", "payment-service", "--json"],
          ["validate", "--all", "--json"],
        ]) {
          const res = await runLoam(p.workDir, ...args);
          expect(res.code, args.join(" ")).toBe(0);
          expect(ofCode(findings(res.stdout), "covers.unknown"), args.join(" ")).toEqual([]);
        }
      },
    );
  });

  it("names the real deployment ids WITH the prefix when one is mistyped", async () => {
    await withProject(geoFixture("Covers: node:eu.dcZ"), async (p) => {
      for (const args of [
        ["validate", "--service", "payment-service", "--json"],
        ["validate", "--all", "--json"],
      ]) {
        const res = await runLoam(p.workDir, ...args);
        const [f] = ofCode(findings(res.stdout), "covers.unknown");
        expect(f, args.join(" ")).toBeDefined();
        expect(f!.severity).toBe("warn");
        // Spelled the way the author has to type it. A hint offering a bare id
        // would send the reader round the loop a second time, because the
        // grammar then reads that id as an element entry.
        expect(f!.message).toContain("node:eu.a");
        expect(f!.message).not.toContain("Did you mean: eu.a");
      }
    });
  });

  it("does not resolve a bare id, nor an entry with only one side prefixed", async () => {
    // Both are `covers.unknown` on purpose, and neither is an error: the axis
    // is a typo guard end to end, and the cost of a wrong line is exactly the
    // coverage it was written for.
    await withProject(geoFixture("Covers: eu.a, node:eu.a -> paymentService"), async (p) => {
      const res = await runLoam(p.workDir, "validate", "--all", "--json");
      expect(res.code).toBe(0);
      expect(ofCode(findings(res.stdout), "covers.unknown")).toHaveLength(2);
    });
  });

  it("a fleet with no deployment model reports the entry rather than crashing on an absent scope", async () => {
    const files = coherentFixture();
    files["services/payment-service/arch.spec.md"] = ARCH_REQ("Covers: node:eu.a");
    await withProject(files, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--all", "--json");
      expect(res.code).toBe(0);
      const [f] = ofCode(findings(res.stdout), "covers.unknown");
      expect(f).toBeDefined();
      // No hints, because there are no real ids to offer — and the message must
      // not invent one.
      expect(f!.message).not.toContain("Did you mean");
    });
  });
});

describe("health.uncovered", () => {
  it("fires per declared alert and SLI no arch requirement covers — arch.spec.md absent included", async () => {
    const files = coherentFixture();
    files["services/payment-service/health.yaml"] =
      "slis:\n  - name: availability\nalerts:\n  - name: err_rate\n";
    await withProject(files, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--service", "payment-service", "--json");
      expect(res.code).toBe(0);
      const fs = ofCode(findings(res.stdout), "health.uncovered");
      expect(fs).toHaveLength(2);
      expect(fs.map((f) => f.severity)).toEqual(["warn", "warn"]);
      expect(fs[0]!.message).toContain("alert 'err_rate'");
      expect(fs[0]!.message).toContain("Covers: alert:err_rate");
      expect(fs[1]!.message).toContain("SLI 'availability'");
    });
  });

  it("is silenced by a covering requirement in the living arch.spec.md", async () => {
    const files = coherentFixture();
    files["services/payment-service/health.yaml"] = "alerts:\n  - name: err_rate\n";
    files["services/payment-service/arch.spec.md"] = ARCH_REQ("Covers: alert:err_rate");
    await withProject(files, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--service", "payment-service", "--json");
      expect(ofCode(findings(res.stdout), "health.uncovered")).toEqual([]);
    });
  });

  it("a REMOVED requirement covers nothing — retiring it re-opens the obligation", async () => {
    const files = coherentFixture();
    files["services/payment-service/health.yaml"] = "alerts:\n  - name: err_rate\n";
    files["services/payment-service/arch.spec.md"] = `---
service: payment-service
status: draft
owner: x
---

## Requirements

## REMOVED Requirements

### Requirement: Old alert duty
Covers: alert:err_rate
`;
    await withProject(files, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--service", "payment-service", "--json");
      expect(ofCode(findings(res.stdout), "health.uncovered")).toHaveLength(1);
    });
  });

  it("stays quiet on a health.yaml that does not parse or declares nothing recognizable", async () => {
    const files = coherentFixture();
    files["services/payment-service/health.yaml"] = "foo: [unclosed\n  bar: ::::\n";
    await withProject(files, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--service", "payment-service", "--json");
      expect(ofCode(findings(res.stdout), "health.uncovered")).toEqual([]);
    });
  });
});

/* ------------------------------------------------------------------ */
/* health.dependency-unmodelled — service scope                        */
/* ------------------------------------------------------------------ */

describe("health.dependency-unmodelled", () => {
  /**
   * A model exercising all three names an element answers to: `kafka` by its
   * likec4 id (and title), `category-store` by a nested container's title,
   * `external-config` by an explicit metadata binding on a box titled otherwise.
   */
  const MODELLED = `specification {
  element softwareSystem
  element container
  element database
}

model {
  paymentService = softwareSystem 'payment-service' {
    api = container 'api'
    store = database 'category-store'
    api -> store 'reads'
  }
  kafka = softwareSystem 'kafka'
  cfg = softwareSystem 'Config Service' {
    metadata { service 'external-config' }
  }
  paymentService.api -> kafka 'publishes'
}
`;

  it("stays quiet when every dependency resolves — element id, nested title, or binding", async () => {
    const files = coherentFixture();
    files["services/payment-service/model.likec4"] = MODELLED;
    files["services/payment-service/health.yaml"] =
      "dependencies:\n  - id: kafka\n  - id: category-store\n  - id: external-config\n";
    await withProject(files, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--service", "payment-service", "--json");
      expect(res.code).toBe(0);
      expect(ofCode(findings(res.stdout), "health.dependency-unmodelled")).toEqual([]);
    });
  });

  it("warns per unresolvable id, offering close ones", async () => {
    const files = coherentFixture();
    files["services/payment-service/model.likec4"] = MODELLED;
    files["services/payment-service/health.yaml"] =
      "dependencies:\n  - id: service-registry\n  - id: kafk\n";
    await withProject(files, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--service", "payment-service", "--json");
      expect(res.code).toBe(0); // warn-only — the axis is advisory end to end
      const fs = ofCode(findings(res.stdout), "health.dependency-unmodelled");
      expect(fs).toHaveLength(2);
      expect(fs[0]!.severity).toBe("warn");
      expect(fs[0]!.message).toContain("'service-registry'");
      expect(fs[0]!.message).toContain("answers to that name");
      expect(fs[1]!.message).toContain("Did you mean: kafka");
    });
  });

  it("a landscape-only element does NOT satisfy the join — the model is the set to reconcile", async () => {
    // The design decision this suite exists to pin (rule E-1): once a private
    // datastore moves inside its service, the landscape carries only what
    // crosses the boundary — so reconciling against it would go quiet exactly
    // where the on-call file lies. The service model carries everything the
    // service touches, and zookeeper modelled ONLY in the landscape is a
    // dependency this service's own model still owes.
    const files = coherentFixture();
    files["services/payment-service/model.likec4"] = MODELLED;
    files["architecture/landscape.likec4"] = `specification {
  element softwareSystem
  tag external
}

model {
  paymentService = softwareSystem 'payment-service'
  zookeeper = softwareSystem 'zookeeper' {
    #external
  }
  paymentService -> zookeeper 'locks'
}
`;
    files["services/payment-service/health.yaml"] = "dependencies:\n  - id: zookeeper\n";
    await withProject(files, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--service", "payment-service", "--json");
      const fs = ofCode(findings(res.stdout), "health.dependency-unmodelled");
      expect(fs).toHaveLength(1);
      expect(fs[0]!.message).toContain("'zookeeper'");
    });
  });

  it("is muted when health.yaml is unreadable — no claims on bad data", async () => {
    const files = coherentFixture();
    files["services/payment-service/model.likec4"] = MODELLED;
    files["services/payment-service/health.yaml"] = "dependencies: [unclosed\n  x: ::::\n";
    await withProject(files, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--service", "payment-service", "--json");
      expect(ofCode(findings(res.stdout), "health.dependency-unmodelled")).toEqual([]);
      expect(ofCode(findings(res.stdout), "health.invalid")).toHaveLength(1);
    });
  });

  it("is muted when the model is absent — the wrong file's breakage must not manufacture warns", async () => {
    const files = coherentFixture();
    delete files["services/payment-service/model.likec4"];
    files["services/payment-service/health.yaml"] = "dependencies:\n  - id: kafka\n";
    await withProject(files, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--service", "payment-service", "--json");
      expect(ofCode(findings(res.stdout), "health.dependency-unmodelled")).toEqual([]);
      expect(ofCode(findings(res.stdout), "service.no-model")).toHaveLength(1);
    });
  });
});

/* ------------------------------------------------------------------ */
/* c4.uncovered — feature scope                                        */
/* ------------------------------------------------------------------ */

describe("c4.uncovered", () => {
  it("fires on every NEW tagged element and edge no arch requirement covers", async () => {
    // coherentFixture's FEAT-1 tags one element and one edge, and carries no
    // arch.spec.md at all — the exact corner-cutting case the axis exists for.
    await withProject(coherentFixture(), async (p) => {
      const res = await runLoam(p.workDir, "validate", "--feature", "FEAT-1", "--json");
      expect(res.code).toBe(0); // warnings — the feature still validates
      const fs = ofCode(findings(res.stdout), "c4.uncovered");
      expect(fs).toHaveLength(2);
      expect(fs[0]!.message).toContain("'payment-split-service' (paymentSplitService)");
      expect(fs[0]!.message).toContain("Covers: paymentSplitService");
      expect(fs[1]!.message).toContain("payment-service → payment-split-service");
      expect(fs[1]!.message).toContain("Covers: paymentService -> paymentSplitService");
      // The subject names the service whose architecture is uncovered.
      expect(fs.map((f) => f.subject)).toEqual(["payment-split-service", "payment-split-service"]);
    });
  });

  it("is silenced by a covering requirement in any of the feature's arch.spec.md deltas", async () => {
    const files = coherentFixture();
    files["features/FEAT-1-split/specs/payment-split-service/arch.spec.md"] = `# arch delta

## ADDED Requirements

### Requirement: Split arrives exactly once
The service SHALL treat createSplit as idempotent.

Covers: paymentSplitService, paymentService -> paymentSplitService

#### Scenario: Retry is a no-op
- **Given** a recorded split
- **When** the call is retried
- **Then** nothing is recorded twice
`;
    await withProject(files, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--feature", "FEAT-1", "--json");
      expect(ofCode(findings(res.stdout), "c4.uncovered")).toEqual([]);
      expect(ofCode(findings(res.stdout), "covers.unknown")).toEqual([]);
    });
  });

  it("a BASE requirement quoted in the delta grants NO coverage — only what the archive will merge counts", async () => {
    // In a delta, plain `## Requirements` is the living state quoted: legal
    // shape, merges nothing, emits no .feature, yields no scenario.tested
    // claim. A Covers: line under it used to silence c4.uncovered anyway —
    // an agent could green the check with an obligation that ships nowhere.
    const quoted = `# arch delta

## Requirements

### Requirement: Split arrives exactly once
The service SHALL treat createSplit as idempotent.

Covers: paymentSplitService, paymentService -> paymentSplitService

#### Scenario: Retry is a no-op
- **Given** a recorded split
- **When** the call is retried
- **Then** nothing is recorded twice
`;
    const files = coherentFixture();
    files["features/FEAT-1-split/specs/payment-split-service/arch.spec.md"] = quoted;
    await withProject(files, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--feature", "FEAT-1", "--json");
      const fs = ofCode(findings(res.stdout), "c4.uncovered");
      expect(fs, "a quoted BASE requirement must not cover the new element and edge").toHaveLength(2);
    });

    // The SAME requirement under `## ADDED Requirements` — text unchanged —
    // is work the archive merges, and it silences the warning.
    const added = quoted.replace("## Requirements", "## ADDED Requirements");
    const filesAdded = coherentFixture();
    filesAdded["features/FEAT-1-split/specs/payment-split-service/arch.spec.md"] = added;
    await withProject(filesAdded, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--feature", "FEAT-1", "--json");
      expect(ofCode(findings(res.stdout), "c4.uncovered")).toEqual([]);
    });
  });

  it("an edge may be covered by service names instead of element ids — the same join every check uses", async () => {
    const files = coherentFixture();
    files["features/FEAT-1-split/specs/payment-split-service/arch.spec.md"] = `# arch delta

## ADDED Requirements

### Requirement: Split arrives exactly once
Covers: payment-split-service, payment-service -> payment-split-service

#### Scenario: Retry is a no-op
- **Given** a recorded split
- **When** the call is retried
- **Then** nothing is recorded twice
`;
    await withProject(files, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--feature", "FEAT-1", "--json");
      expect(ofCode(findings(res.stdout), "c4.uncovered")).toEqual([]);
    });
  });

  it("exempts what the landscape checks exempt: person kinds and #external elements", async () => {
    const files = coherentFixture();
    files["features/FEAT-1-split/delta.likec4"] = `specification {
  element softwareSystem
  element person
  tag FEAT-1
  tag external
}

model {
  paymentService = softwareSystem 'payment-service'
  shopper = person 'Shopper' {
    #FEAT-1
  }
  stripe = softwareSystem 'stripe' {
    #FEAT-1 #external
  }
  paymentSplitService = softwareSystem 'payment-split-service' {
    #FEAT-1
  }

  paymentService -> paymentSplitService 'Calls createSplit' {
    #FEAT-1
    metadata { op 'createSplit' }
  }
}

views {
  view feat_1 {
    include *
  }
}
`;
    await withProject(files, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--feature", "FEAT-1", "--json");
      const fs = ofCode(findings(res.stdout), "c4.uncovered");
      // The person and the #external system need no coverage; the real service
      // and the tagged edge still do.
      expect(fs).toHaveLength(2);
      expect(fs.some((f) => f.message.includes("Shopper"))).toBe(false);
      expect(fs.some((f) => f.message.includes("stripe"))).toBe(false);
    });
  });

  it("covers.unknown fires on a feature arch delta too, resolving against delta + landscape + model + health", async () => {
    const files = coherentFixture();
    files["services/payment-split-service/health.yaml"] = "alerts:\n  - name: split_err\n";
    files["features/FEAT-1-split/specs/payment-split-service/arch.spec.md"] = `# arch delta

## ADDED Requirements

### Requirement: Split arrives exactly once
Covers: paymentSplitService, paymentService -> paymentSplitService, alert:split_err, alert:split_error

#### Scenario: Retry is a no-op
- **Given** a recorded split
- **When** the call is retried
- **Then** nothing is recorded twice
`;
    await withProject(files, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--feature", "FEAT-1", "--json");
      const fs = ofCode(findings(res.stdout), "covers.unknown");
      expect(fs).toHaveLength(1);
      expect(fs[0]!.subject).toBe("payment-split-service");
      expect(fs[0]!.message).toContain("'alert:split_error'");
      expect(fs[0]!.message).toContain("Did you mean: alert:split_err");
    });
  });

  it("a feature arch requirement may cover an element that lives only in the service's own model", async () => {
    const files = coherentFixture();
    files["features/FEAT-1-split/specs/payment-service/arch.spec.md"] = `# arch delta

## ADDED Requirements

### Requirement: The api container fronts the split call
Covers: paymentService.api

#### Scenario: Split goes through the api
- **Given** a split order
- **When** authorization runs
- **Then** the api container calls createSplit
`;
    await withProject(files, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--feature", "FEAT-1", "--json");
      // paymentService.api is in services/payment-service/model.likec4 only —
      // the lazy widening finds it there instead of warning.
      expect(ofCode(findings(res.stdout), "covers.unknown")).toEqual([]);
    });
  });
});

/* ------------------------------------------------------------------ */
/* Grammar + provenance parity with spec.md                            */
/* ------------------------------------------------------------------ */

describe("arch.spec.md holds to spec.md's own rules", () => {
  it("a living arch requirement without a scenario is an error, same as spec.md", async () => {
    const files = coherentFixture();
    files["services/payment-service/arch.spec.md"] = `---
service: payment-service
status: draft
owner: x
---

## Requirements

### Requirement: Outbox discipline
The service SHALL publish through the outbox.

Covers: paymentService.api
`;
    await withProject(files, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--service", "payment-service", "--json");
      expect(res.code).toBe(1);
      const fs = ofCode(findings(res.stdout), "requirements.missing-scenarios");
      expect(fs.some((f) => f.message.includes("arch requirements"))).toBe(true);
    });
  });

  it("frontmatter is read with the same checks — a mismatched service: is an error naming arch.spec.md", async () => {
    const files = coherentFixture();
    files["services/payment-service/arch.spec.md"] = ARCH_REQ("Covers: paymentService.api").replace(
      "service: payment-service",
      "service: some-other-service",
    );
    await withProject(files, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--service", "payment-service", "--json");
      expect(res.code).toBe(1);
      const fs = ofCode(findings(res.stdout), "frontmatter.field-mismatch");
      expect(fs).toHaveLength(1);
      expect(fs[0]!.message).toContain("arch.spec.md");
    });
  });

  it("absence of arch.spec.md is NOT a finding — partial adoption is a supported state", async () => {
    await withProject(coherentFixture(), async (p) => {
      const res = await runLoam(p.workDir, "validate", "--service", "payment-service", "--json");
      expect(res.code).toBe(0);
      const all = findings(res.stdout);
      expect(all.some((f) => f.message.toLowerCase().includes("arch.spec"))).toBe(false);
    });
  });
});

/* ------------------------------------------------------------------ */
/* Archive merges the axis — one code path, parameterized by filename  */
/* ------------------------------------------------------------------ */

/** coherentFixture plus a living arch spec and arch deltas on both services. */
function archMergeFixture(): Record<string, string> {
  const files = coherentFixture();
  const livingArch = `---
service: payment-service
status: draft
owner: payments-team
---

# payment-service — architecture

Kept prose above the requirements — the rewrite must preserve it.

## Requirements

### Requirement: Outbox discipline
The service SHALL publish through the outbox.

Covers: paymentService.api

#### Scenario: Broker down
- **Given** an event in the outbox
- **When** kafka is down
- **Then** the event is published later
`;
  files["services/payment-service/arch.spec.md"] = livingArch;
  // delta.baseline-missing gates archive now, so the MODIFIED requirement pins
  // its baseline; pinFor computes the digest instead of hard-coding it so the
  // fixture cannot drift from the canonical requirementDigest serialization.
  files["features/FEAT-1-split/specs/payment-service/arch.spec.md"] = `# arch delta

## MODIFIED Requirements

### Requirement: Outbox discipline
Based-On: ${pinFor(livingArch, "Outbox discipline")}
The service SHALL publish through the outbox, including the new PaymentSplit event.

Covers: paymentService.api

#### Scenario: Broker down
- **Given** an event in the outbox
- **When** kafka is down
- **Then** the event is published later, PaymentSplit included
`;
  files["features/FEAT-1-split/specs/payment-split-service/arch.spec.md"] = `# arch delta

## ADDED Requirements

### Requirement: Split arrives exactly once
The service SHALL treat createSplit as idempotent.

Covers: paymentSplitService, paymentService -> paymentSplitService

#### Scenario: Retry is a no-op
- **Given** a recorded split
- **When** the call is retried
- **Then** nothing is recorded twice
`;
  return files;
}

describe("archive merges arch.spec.md exactly as spec.md", () => {
  it("the dry-run plan lists the arch axis writes next to the business ones", async () => {
    await withProject(archMergeFixture(), async (p) => {
      const res = await runLoam(p.workDir, "archive", "FEAT-1", "--dry-run", "--json");
      expect(res.code).toBe(0);
      const paths = (JSON.parse(res.stdout).plan as Array<{ path: string }>).map((w) => w.path);
      expect(paths).toContain("services/payment-service/arch.spec.md");
      expect(paths).toContain("services/payment-split-service/arch.spec.md");
      expect(paths).toContain("services/payment-split-service/spec.md");
    });
  });

  it("MODIFIED replaces in the living arch spec, prose above the run preserved", async () => {
    await withProject(archMergeFixture(), async (p) => {
      const res = await runLoam(p.workDir, "archive", "FEAT-1");
      expect(res.code).toBe(0);
      const living = await p.read("services/payment-service/arch.spec.md");
      expect(living).toContain("PaymentSplit included");
      expect(living).not.toContain("## MODIFIED Requirements");
      expect(living).toContain("Kept prose above the requirements");
      expect(living).toContain("Covers: paymentService.api");
    });
  });

  it("a new service's living arch.spec.md is created with frontmatter and the axis heading", async () => {
    await withProject(archMergeFixture(), async (p) => {
      await runLoam(p.workDir, "archive", "FEAT-1");
      const created = await p.read("services/payment-split-service/arch.spec.md");
      expect(created).toContain("service: payment-split-service");
      expect(created).toContain("status: draft");
      expect(created).toContain("# payment-split-service — architecture");
      expect(created).toContain("## Requirements");
      expect(created).toContain("### Requirement: Split arrives exactly once");
      expect(created).toContain("Covers: paymentSplitService, paymentService -> paymentSplitService");
    });
  });

  it("archive then unarchive is a byte round-trip — the snapshot covers the arch axis too", async () => {
    const { treeHashes } = await import("./helpers/harness.js");
    await withProject(archMergeFixture(), async (p) => {
      const before = await treeHashes(p.docsDir);
      expect((await runLoam(p.workDir, "archive", "FEAT-1")).code).toBe(0);
      expect((await runLoam(p.workDir, "unarchive", "FEAT-1")).code).toBe(0);
      expect(await treeHashes(p.docsDir)).toEqual(before);
    });
  });

  it("post-archive, validate --service is quiet on the merged arch axis (no covers.unknown leftovers)", async () => {
    await withProject(archMergeFixture(), async (p) => {
      await runLoam(p.workDir, "archive", "FEAT-1");
      const res = await runLoam(p.workDir, "validate", "--service", "payment-service", "--json");
      expect(res.code).toBe(0);
      expect(ofCode(findings(res.stdout), "covers.unknown")).toEqual([]);
      expect(ofCode(findings(res.stdout), "requirements.missing-scenarios")).toEqual([]);
    });
  });

  it("a LIVING arch requirement outside '## Requirements' blocks the archive like a business one", async () => {
    const files = archMergeFixture();
    files["services/payment-service/arch.spec.md"] += `
## Operational notes

### Requirement: Strayed arch duty
The service SHALL do something nobody re-homed.

#### Scenario: S
- **Given** g
- **When** w
- **Then** t
`;
    await withProject(files, async (p) => {
      const res = await runLoam(p.workDir, "archive", "FEAT-1", "--json");
      expect(res.code).toBe(1);
      const payload = JSON.parse(res.stdout);
      expect(payload.error.code).toBe("living-outside-requirements");
      const messages = (payload.issues as Array<{ message: string }>).map((i) => i.message);
      expect(messages.some((m) => m.includes("Strayed arch duty") && m.includes("arch.spec.md"))).toBe(true);
    });
  });
});

/* ------------------------------------------------------------------ */
/* Delta-shape checks run on arch deltas the same way                  */
/* ------------------------------------------------------------------ */

describe("delta-shape checks on arch deltas", () => {
  it("MODIFIED of an arch requirement with no living arch spec is an error — the axes are separate namespaces", async () => {
    const files = coherentFixture();
    // The BUSINESS living spec has 'Authorize a payment'; the arch axis does not.
    // A same-named arch MODIFIED must not resolve against the business file.
    files["features/FEAT-1-split/specs/payment-service/arch.spec.md"] = `# arch delta

## MODIFIED Requirements

### Requirement: Authorize a payment
The service SHALL authorize through the new path.

#### Scenario: S
- **Given** g
- **When** w
- **Then** t
`;
    await withProject(files, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--feature", "FEAT-1", "--json");
      expect(res.code).toBe(1);
      const fs = ofCode(findings(res.stdout), "delta.modified-unknown");
      expect(fs).toHaveLength(1);
      expect(fs[0]!.message).toContain("(arch.spec.md)");
      expect(fs[0]!.message).toContain("living arch.spec.md");
    });
  });

  it("a near-miss heading in an arch delta is delta.unknown-section, named to the arch file", async () => {
    const files = coherentFixture();
    files["features/FEAT-1-split/specs/payment-service/arch.spec.md"] = `# arch delta

## ADDED Requirement

### Requirement: Outbox discipline
The service SHALL publish through the outbox.

#### Scenario: S
- **Given** g
- **When** w
- **Then** t
`;
    await withProject(files, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--feature", "FEAT-1", "--json");
      expect(res.code).toBe(1);
      const fs = ofCode(findings(res.stdout), "delta.unknown-section");
      expect(fs).toHaveLength(1);
      expect(fs[0]!.message).toContain("(arch.spec.md)");
    });
  });

  it("an arch requirement stranded under a prose heading warns AND gates archive, like a business one", async () => {
    const files = archMergeFixture();
    files["features/FEAT-1-split/specs/payment-service/arch.spec.md"] = `# arch delta

## MODIFIED Requirements

### Requirement: Outbox discipline
The service SHALL publish through the outbox, updated.

#### Scenario: S
- **Given** g
- **When** w
- **Then** t

## Resilience

### Requirement: Stranded arch duty
The service SHALL retry with backoff.

#### Scenario: S2
- **Given** g
- **When** w
- **Then** t
`;
    await withProject(files, async (p) => {
      const check = await runLoam(p.workDir, "validate", "--feature", "FEAT-1", "--json");
      expect(check.code).toBe(0); // a warning — validate stays green
      const fs = ofCode(findings(check.stdout), "delta.requirement-not-merged");
      expect(fs).toHaveLength(1);
      expect(fs[0]!.message).toContain("Stranded arch duty");

      const res = await runLoam(p.workDir, "archive", "FEAT-1", "--json");
      expect(res.code).toBe(1);
      expect(JSON.parse(res.stdout).error.code).toBe("not-coherent");
    });
  });

  it("ADDED an arch requirement the living arch spec already has is delta.added-duplicate against the right file", async () => {
    const files = archMergeFixture();
    files["features/FEAT-1-split/specs/payment-service/arch.spec.md"] = `# arch delta

## ADDED Requirements

### Requirement: Outbox discipline
The service SHALL publish through the outbox, again.

#### Scenario: S
- **Given** g
- **When** w
- **Then** t
`;
    await withProject(files, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--feature", "FEAT-1", "--json");
      expect(res.code).toBe(1);
      const fs = ofCode(findings(res.stdout), "delta.added-duplicate");
      expect(fs).toHaveLength(1);
      expect(fs[0]!.message).toContain("living arch.spec.md");
    });
  });
});

/* ------------------------------------------------------------------ */
/* verify derives claims from arch scenarios                           */
/* ------------------------------------------------------------------ */

interface Claim {
  id: string;
  kind: string;
  subject: string;
  claim: string;
}

function claimsOf(stdout: string): Claim[] {
  return (JSON.parse(stdout) as { claims: Claim[] }).claims;
}

describe("verify claims from arch scenarios", () => {
  it("an arch scenario becomes a scenario.tested claim whose text names the arch origin", async () => {
    await withProject(archMergeFixture(), async (p) => {
      const res = await runLoam(p.workDir, "verify", "FEAT-1", "--json");
      expect(res.code).toBe(0);
      const arch = claimsOf(res.stdout).filter((c) => c.claim.includes("arch.spec.md"));
      expect(arch).toHaveLength(2); // the MODIFIED outbox scenario + the ADDED idempotency one
      expect(arch.every((c) => c.kind === "scenario.tested")).toBe(true);
      expect(arch.some((c) => c.claim.includes("arch requirement 'Outbox discipline'"))).toBe(true);
      expect(arch.some((c) => c.subject === "payment-split-service")).toBe(true);
    });
  });

  it("ids are stable across runs, and the checklist digest moves when an arch scenario body moves", async () => {
    await withProject(archMergeFixture(), async (p) => {
      const first = await runLoam(p.workDir, "verify", "FEAT-1", "--json");
      const second = await runLoam(p.workDir, "verify", "FEAT-1", "--json");
      expect(claimsOf(second.stdout).map((c) => c.id)).toEqual(claimsOf(first.stdout).map((c) => c.id));

      const firstDigest = (JSON.parse(first.stdout) as { digest: string }).digest;
      await p.write(
        "features/FEAT-1-split/specs/payment-split-service/arch.spec.md",
        (await p.read("features/FEAT-1-split/specs/payment-split-service/arch.spec.md")).replace(
          "nothing is recorded twice",
          "exactly one split exists afterwards",
        ),
      );
      const third = await runLoam(p.workDir, "verify", "FEAT-1", "--json");
      expect((JSON.parse(third.stdout) as { digest: string }).digest).not.toBe(firstDigest);
      // Only the reworded arch claim changed identity — a Given/When/Then
      // rewrite under an unchanged title renames the claim, arch axis included.
      const before = new Set(claimsOf(first.stdout).map((c) => c.id));
      const changed = claimsOf(third.stdout).filter((c) => !before.has(c.id));
      expect(changed).toHaveLength(1);
      expect(changed[0]!.claim).toContain("arch.spec.md");
    });
  });

  it("an identically-worded scenario in spec.md and arch.spec.md stays two distinct claims", async () => {
    const files = coherentFixture();
    const body = `## ADDED Requirements

### Requirement: Same words
The service SHALL do the thing.

#### Scenario: Same scenario
- **Given** g
- **When** w
- **Then** t
`;
    files["features/FEAT-1-split/specs/payment-split-service/spec.md"] = `# delta\n\n${body}`;
    files["features/FEAT-1-split/specs/payment-split-service/arch.spec.md"] = `# arch delta\n\n${body}`;
    await withProject(files, async (p) => {
      const res = await runLoam(p.workDir, "verify", "FEAT-1", "--json");
      const same = claimsOf(res.stdout).filter((c) => c.claim.includes("'Same scenario'"));
      expect(same).toHaveLength(2);
      expect(new Set(same.map((c) => c.id)).size).toBe(2);
    });
  });
});

/* ------------------------------------------------------------------ */
/* loam delta projects the arch axis                                   */
/* ------------------------------------------------------------------ */

describe("loam delta carries arch requirement deltas", () => {
  it("--json carries archRequirements in the same shape as the business ones, plus covers", async () => {
    await withProject(archMergeFixture(), async (p) => {
      const res = await runLoam(p.workDir, "delta", "FEAT-1", "--service", "payment-split-service", "--json");
      expect(res.code).toBe(0);
      const json = JSON.parse(res.stdout);
      expect(json.archRequirements).toHaveLength(1);
      const r = json.archRequirements[0];
      expect(r.kind).toBe("ADDED");
      expect(r.name).toBe("Split arrives exactly once");
      expect(r.covers).toEqual(["paymentSplitService", "paymentService -> paymentSplitService"]);
      expect(r.scenarios[0].name).toBe("Retry is a no-op");
      expect(r.scenarios[0].lines.join("\n")).toContain("**Then** nothing is recorded twice");
      // The business requirement rides beside it, in the same item shape.
      expect(json.requirements[0].covers).toEqual([]);
    });
  });

  it("a service with no arch delta reports an empty archRequirements, not an absent field", async () => {
    await withProject(coherentFixture(), async (p) => {
      const res = await runLoam(p.workDir, "delta", "FEAT-1", "--service", "payment-split-service", "--json");
      expect(JSON.parse(res.stdout).archRequirements).toEqual([]);
    });
  });

  it("the text briefing prints the arch requirements as their own section", async () => {
    await withProject(archMergeFixture(), async (p) => {
      const res = await runLoam(p.workDir, "delta", "FEAT-1", "--service", "payment-split-service");
      expect(res.code).toBe(0);
      expect(res.out).toContain("Arch requirements:");
      expect(res.out).toContain("[ADDED] Split arrives exactly once");
    });
  });

  /**
   * A directive line is a BODY line — `core/document/parse.ts` keeps it in
   * `text` on purpose, so a requirement round-trips and its digest is stable.
   * The briefing prints that body verbatim, so printing `Covers:` again from the
   * parsed field showed it twice while the five directives with no such
   * re-print showed it once. Nothing caught it, because the human view is
   * asserted almost nowhere and the duplication is invisible on a requirement
   * that carries neither line.
   *
   * Counting is the assertion rather than a `toContain`: the defect was two
   * occurrences of a string that must appear once, which `toContain` cannot see.
   */
  it("prints each directive line exactly once — the body already carries it", async () => {
    await withProject(archMergeFixture(), async (p) => {
      const res = await runLoam(p.workDir, "delta", "FEAT-1", "--service", "payment-split-service");
      expect(res.code).toBe(0);
      const covers = res.out.split("\n").filter((l) => l.trim().startsWith("Covers:"));
      expect(covers.length, `Covers: printed ${covers.length} time(s):\n${res.out}`).toBe(1);
      const ops = res.out.split("\n").filter((l) => l.trim().startsWith("Operations:"));
      expect(ops.length, "Operations: has the same shape and the same hazard").toBeLessThanOrEqual(1);
    });
  });
});
