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
import { parseCoversEntry, closeIds } from "../src/core/arch.js";
import { readHealthIds } from "../src/core/health.js";
import { parseRequirements } from "../src/core/spec.js";
import { coherentFixture, makeProject, makeTmpDir, runLoam, type Project } from "./helpers/harness.js";

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

  it("classifies the three entry forms", () => {
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
  });

  it("closeIds offers only real ids, never the typo itself", () => {
    expect(closeIds("paymentServce", ["paymentService", "kafka"])).toEqual(["paymentService"]);
    expect(closeIds("zzz", ["paymentService"])).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* The health.yaml reader                                              */
/* ------------------------------------------------------------------ */

describe("readHealthIds (core/health.ts)", () => {
  async function readOf(content: string | null): Promise<{ slis: string[]; alerts: string[] }> {
    const dir = await makeTmpDir();
    const path = join(dir, "health.yaml");
    if (content !== null) await writeFile(path, content, "utf8");
    return readHealthIds(path);
  }

  it("reads sli and alert names from the recognized keys", async () => {
    const ids = await readOf(
      "slis:\n  - name: availability\n    slo: 0.999\n  - name: latency\nalerts:\n  - name: err_rate\n    expr: x > 1\n",
    );
    expect(ids).toEqual({ slis: ["availability", "latency"], alerts: ["err_rate"] });
  });

  it("takes a plain string entry as its own id, and `id` when there is no name", async () => {
    const ids = await readOf("alerts:\n  - err_rate\n  - id: burn_rate\n");
    expect(ids.alerts).toEqual(["err_rate", "burn_rate"]);
  });

  it("a missing, unparseable or unrecognizable health.yaml yields no ids — and so no findings", async () => {
    expect(await readOf(null)).toEqual({ slis: [], alerts: [] });
    expect(await readOf("foo: [unclosed\n  bar: ::::\n")).toEqual({ slis: [], alerts: [] });
    expect(await readOf("checks:\n  liveness: GET /health\n")).toEqual({ slis: [], alerts: [] });
    expect(await readOf("slis: not-a-list\nalerts: 3\n")).toEqual({ slis: [], alerts: [] });
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
