/**
 * Deep invariant tests for `loam validate` (src/commands/validate.ts).
 *
 * Families:
 *  - service mode: C4 model, requirement coverage, API coverage (warn-only)
 *  - service mode: graded absences (unknown dir errors; missing spec/openapi warn)
 *  - service mode: api.ops-unlinked (migration debt — API and requirements never linked)
 *  - service mode: landscape spine (C4 edge op ↔ OpenAPI contract)
 *  - feature mode: delta parse, per-service coverage, cross-axis coherence
 *  - feature mode: arch-edge coverage heuristic (warn-only)
 *  - feature dir resolution (exact / prefix / non-prefix / ambiguity)
 *  - option conflicts (--service with --feature)
 *  - exit-code discipline (warnings never gate, any error gates)
 */
import { describe, expect, it } from "vitest";
import {
  coherentFixture,
  makeProject,
  makeTmpDir,
  runLoam,
  LANDSCAPE,
  LIVING_OPENAPI,
  LIVING_SPEC,
  SERVICE_MODEL,
  FEATURE_DELTA,
  FEATURE_OPENAPI,
  FEATURE_SPEC,
  type Project,
} from "./helpers/harness.js";
import { rm } from "node:fs/promises";

const SVC = "payment-service";

async function withProject(
  files: Record<string, string>,
  opts: { service?: string },
  fn: (p: Project) => Promise<void>,
): Promise<void> {
  const p = await makeProject(files, opts);
  try {
    await fn(p);
  } finally {
    await p.destroy();
  }
}

/** A definitely-invalid LikeC4 doc: `bogusKind` is not declared in the specification. */
const BROKEN_LIKEC4 = `specification {
  element softwareSystem
}

model {
  api = bogusKind 'api'
}
`;

/** Minimal living spec for one service (requirement + scenario, no Operations link). */
function goodLivingSpec(svc: string): string {
  return `# ${svc}

## Requirements

### Requirement: Do the thing
The service SHALL do the thing.

#### Scenario: Thing done
- **Given** a thing
- **When** it runs
- **Then** it is done
`;
}

/** Minimal valid delta spec for one service (requirement + scenario, no Operations). */
function goodDeltaSpec(svc: string): string {
  return `# ${svc} — delta

## ADDED Requirements

### Requirement: Do the thing
The service SHALL do the thing.

#### Scenario: Thing done
- **Given** a thing
- **When** it runs
- **Then** it is done
`;
}

describe("service mode: model + requirement + API coverage", () => {
  it("coherent fixture validates clean: model valid, requirements covered, API covered, exit 0", async () => {
    await withProject(coherentFixture(), { service: SVC }, async (p) => {
      const res = await runLoam(p.workDir, "validate");
      expect(res.code).toBe(0);
      expect(res.out).toContain(`✓ ${SVC}: C4 model valid`);
      expect(res.out).toContain(`✓ ${SVC}: requirements covered`);
      expect(res.out).toContain(`✓ ${SVC}: API covered`);
    });
  });

  it("no loam.json in cwd fails with a pointer to `loam init`", async () => {
    const dir = await makeTmpDir();
    try {
      const res = await runLoam(dir, "validate");
      expect(res.code).toBe(1);
      expect(res.out).toContain("No loam.json found");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("no service from flag or config fails and says how to provide one", async () => {
    await withProject(coherentFixture(), {}, async (p) => {
      const res = await runLoam(p.workDir, "validate");
      expect(res.code).toBe(1);
      expect(res.out).toContain("No service");
      expect(res.out).toContain("--service");
    });
  });

  it("--service overrides the configured service", async () => {
    // config points at a service that has no docs at all; the flag must win.
    await withProject(coherentFixture(), { service: "no-such-service" }, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--service", SVC);
      expect(res.code).toBe(0);
      expect(res.out).toContain(`✓ ${SVC}: C4 model valid`);
    });
  });

  it("missing services/<svc>/model.likec4 fails and names the path", async () => {
    const files = coherentFixture();
    delete files[`services/${SVC}/model.likec4`];
    await withProject(files, { service: SVC }, async (p) => {
      const res = await runLoam(p.workDir, "validate");
      expect(res.code).toBe(1);
      expect(res.out).toContain("No C4 model at");
      expect(res.out).toContain("model.likec4");
      // the directory is real, so adopt is the right hint here — the contrast
      // with service.unknown, where that hint would document a typo
      expect(res.out).toContain("loam adopt");
    });
  });

  it("a model with LikeC4 errors fails and shows the error lines", async () => {
    const files = coherentFixture();
    files[`services/${SVC}/model.likec4`] = BROKEN_LIKEC4;
    await withProject(files, { service: SVC }, async (p) => {
      const res = await runLoam(p.workDir, "validate");
      expect(res.code).toBe(1);
      expect(res.out).toMatch(new RegExp(`✗ ${SVC}: C4 model has \\d+ error`));
      // at least one indented detail line follows the header
      expect(res.stderr).toMatch(/\n\s+\S+/);
    });
  });

  it("a requirement without any scenario fails and is named in the output", async () => {
    const files = coherentFixture();
    files[`services/${SVC}/spec.md`] = LIVING_SPEC.slice(0, LIVING_SPEC.indexOf("#### Scenario:"));
    await withProject(files, { service: SVC }, async (p) => {
      const res = await runLoam(p.workDir, "validate");
      expect(res.code).toBe(1);
      expect(res.out).toContain("without a scenario");
      expect(res.out).toContain("Authorize a payment");
    });
  });

  it("REMOVED requirements are never counted as missing scenarios", async () => {
    const files = coherentFixture();
    files[`services/${SVC}/spec.md`] =
      LIVING_SPEC +
      `
## REMOVED Requirements

### Requirement: Legacy direct capture
The service SHALL no longer capture without authorization.
`;
    await withProject(files, { service: SVC }, async (p) => {
      const res = await runLoam(p.workDir, "validate");
      expect(res.code).toBe(0);
      expect(res.out).toContain(`✓ ${SVC}: requirements covered`);
      expect(res.out).not.toContain("without a scenario");
    });
  });

  it("an OpenAPI operation governed by no requirement warns but does not gate (exit 0)", async () => {
    const files = coherentFixture();
    files[`services/${SVC}/openapi.yaml`] =
      LIVING_OPENAPI +
      `  /payments/refund:
    post:
      operationId: refundPayment
      summary: Refund a payment
      responses:
        "200":
          description: Refunded
`;
    await withProject(files, { service: SVC }, async (p) => {
      const res = await runLoam(p.workDir, "validate");
      expect(res.code).toBe(0);
      expect(res.out).toContain("not governed by any requirement");
      expect(res.out).toContain("refundPayment");
      // the covered line must NOT also print — coverage is either clean or warned
      expect(res.out).not.toContain(`✓ ${SVC}: API covered`);
    });
  });

  it("a service with an API but no spec.md warns about ungoverned ops, exit 0", async () => {
    const files = coherentFixture();
    delete files[`services/${SVC}/spec.md`];
    await withProject(files, { service: SVC }, async (p) => {
      const res = await runLoam(p.workDir, "validate");
      expect(res.code).toBe(0);
      expect(res.out).toContain("not governed by any requirement");
      expect(res.out).toContain("authorizePayment");
    });
  });
});

describe("service mode: graded absences", () => {
  it("a typo'd --service is service.unknown offering real ids, never an adopt hint", async () => {
    await withProject(coherentFixture(), {}, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--service", "paymnt-service");
      expect(res.code).toBe(1);
      expect(res.out).toContain("No service directory");
      // shares the 'pay' prefix with the real id, so it is offered
      expect(res.out).toContain("Did you mean: payment-service");
      // adopting the misspelling would faithfully document it
      expect(res.out).not.toContain("adopt");
    });
  });

  it("an unknown service with nothing close points at `loam list services`", async () => {
    await withProject(coherentFixture(), {}, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--service", "zzz");
      expect(res.code).toBe(1);
      expect(res.out).toContain("loam list services");
      expect(res.out).not.toContain("Did you mean");
      expect(res.out).not.toContain("adopt");
    });
  });

  it("a missing spec.md warns (service.no-spec) without gating", async () => {
    const files = coherentFixture();
    delete files[`services/${SVC}/spec.md`];
    await withProject(files, { service: SVC }, async (p) => {
      const res = await runLoam(p.workDir, "validate");
      expect(res.code).toBe(0);
      const line = res.out.split("\n").find((l) => l.includes("No living spec at"));
      expect(line).toBeDefined();
      expect(line).toContain("⚠");
    });
  });

  it("a missing openapi.yaml warns when the landscape shows an inbound op call", async () => {
    const files = coherentFixture();
    delete files[`services/${SVC}/openapi.yaml`];
    await withProject(files, { service: SVC }, async (p) => {
      const res = await runLoam(p.workDir, "validate");
      // the spine error for the now-dangling edge co-fires; the warn names the cause
      expect(res.code).toBe(1);
      expect(res.out).toContain("No OpenAPI contract at");
      expect(res.out).toContain(`not defined in ${SVC}'s OpenAPI`);
    });
  });

  it("a missing openapi.yaml warns when there is no landscape to say nobody calls it", async () => {
    const files = coherentFixture();
    delete files[`services/${SVC}/openapi.yaml`];
    delete files["architecture/landscape.likec4"];
    await withProject(files, { service: SVC }, async (p) => {
      const res = await runLoam(p.workDir, "validate");
      expect(res.code).toBe(0);
      expect(res.out).toContain("No OpenAPI contract at");
    });
  });

  it("stays silent about a missing openapi.yaml when the landscape proves nobody calls an op on it", async () => {
    // checkout-web is drawn, but no edge targets it with an op — a worker/UI
    // with no API is not missing one.
    const files = coherentFixture();
    files["services/checkout-web/model.likec4"] = SERVICE_MODEL;
    files["services/checkout-web/spec.md"] = goodLivingSpec("checkout-web");
    await withProject(files, {}, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--service", "checkout-web");
      expect(res.code).toBe(0);
      expect(res.out).not.toContain("No OpenAPI contract");
    });
  });
});

describe("service mode: api.ops-unlinked (migration debt)", () => {
  /** The living spec with its `Operations:` line dropped — requirements and API never meet. */
  const UNLINKED_SPEC = LIVING_SPEC.replace("Operations: authorizePayment\n\n", "");

  it("warns once when the API and the requirements never name each other", async () => {
    const files = coherentFixture();
    files[`services/${SVC}/spec.md`] = UNLINKED_SPEC;
    await withProject(files, { service: SVC }, async (p) => {
      const res = await runLoam(p.workDir, "validate");
      expect(res.code).toBe(0);
      expect(res.out).toContain("defines 1 operation(s) but no requirement links any");
      expect(res.out).toContain("the API axis is unchecked");
      // the per-op orphan warn still fires alongside — it lists WHICH ops
      expect(res.out).toContain("not governed by any requirement");
    });
  });

  it("does not fire when at least one requirement links an operation", async () => {
    const files = coherentFixture();
    files[`services/${SVC}/openapi.yaml`] =
      LIVING_OPENAPI +
      `  /payments/refund:
    post:
      operationId: refundPayment
      summary: Refund a payment
      responses:
        "200":
          description: Refunded
`;
    await withProject(files, { service: SVC }, async (p) => {
      const res = await runLoam(p.workDir, "validate");
      expect(res.code).toBe(0);
      // the orphan op is still named individually, but the axis IS linked
      expect(res.out).toContain("refundPayment");
      expect(res.out).not.toContain("the API axis is unchecked");
    });
  });

  it("does not fire when the OpenAPI defines no operations", async () => {
    const files = coherentFixture();
    files[`services/${SVC}/spec.md`] = UNLINKED_SPEC;
    files[`services/${SVC}/openapi.yaml`] =
      `openapi: 3.1.0\ninfo:\n  title: ${SVC}\n  version: "1.0"\npaths: {}\n`;
    // no landscape, or its op edge would (correctly) break the spine
    delete files["architecture/landscape.likec4"];
    await withProject(files, { service: SVC }, async (p) => {
      const res = await runLoam(p.workDir, "validate");
      expect(res.code).toBe(0);
      expect(res.out).not.toContain("the API axis is unchecked");
    });
  });

  it("does not fire with zero requirements — the absent spec is its own finding", async () => {
    const files = coherentFixture();
    delete files[`services/${SVC}/spec.md`];
    await withProject(files, { service: SVC }, async (p) => {
      const res = await runLoam(p.workDir, "validate");
      expect(res.code).toBe(0);
      expect(res.out).toContain("No living spec at");
      expect(res.out).not.toContain("the API axis is unchecked");
    });
  });
});

describe("option conflicts", () => {
  it("--service with --feature is refused, not silently resolved to the feature", async () => {
    await withProject(coherentFixture(), {}, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--service", SVC, "--feature", "FEAT-1");
      expect(res.code).toBe(1);
      expect(res.out).toContain("--service");
      expect(res.out).toContain("--feature");
      // neither target was validated
      expect(res.out).not.toContain("C4 model valid");
      expect(res.out).not.toContain("delta.likec4");
    });
  });
});

describe("service mode: landscape spine", () => {
  it("an inbound landscape edge whose op exists in the service's OpenAPI resolves (spine ✓, exit 0)", async () => {
    await withProject(coherentFixture(), { service: SVC }, async (p) => {
      const res = await runLoam(p.workDir, "validate");
      expect(res.code).toBe(0);
      expect(res.out).toContain(`✓ ${SVC}: landscape spine (1 inbound call(s) resolve to OpenAPI)`);
    });
  });

  it("an inbound landscape edge calling an op missing from the OpenAPI fails with the broken-edge message", async () => {
    const files = coherentFixture();
    files["architecture/landscape.likec4"] = LANDSCAPE.replace("op 'authorizePayment'", "op 'chargeCard'");
    await withProject(files, { service: SVC }, async (p) => {
      const res = await runLoam(p.workDir, "validate");
      expect(res.code).toBe(1);
      expect(res.out).toContain(`calls 'chargeCard', not defined in ${SVC}'s OpenAPI`);
      expect(res.out).toContain("checkout-web");
    });
  });

  it("an inbound edge titled 'Calls …' with no metadata op warns but does not gate (exit 0)", async () => {
    const files = coherentFixture();
    files["architecture/landscape.likec4"] = LANDSCAPE.replace(
      `checkoutWeb -> paymentService 'Calls authorizePayment' {
    metadata { op 'authorizePayment' }
  }`,
      `checkoutWeb -> paymentService 'Calls authorizePayment'`,
    );
    await withProject(files, { service: SVC }, async (p) => {
      const res = await runLoam(p.workDir, "validate");
      expect(res.code).toBe(0);
      expect(res.out).toContain("has no operation link");
    });
  });

  it("an inbound edge with a non-call title and no op is not flagged (heuristic only fires on 'Calls')", async () => {
    const files = coherentFixture();
    files["architecture/landscape.likec4"] = LANDSCAPE.replace(
      `checkoutWeb -> paymentService 'Calls authorizePayment' {
    metadata { op 'authorizePayment' }
  }`,
      `checkoutWeb -> paymentService 'Sends telemetry to'`,
    );
    await withProject(files, { service: SVC }, async (p) => {
      const res = await runLoam(p.workDir, "validate");
      expect(res.code).toBe(0);
      expect(res.out).not.toContain("has no operation link");
      expect(res.out).not.toContain("landscape spine");
    });
  });

  it("a landscape with LikeC4 errors is surfaced, not silently skipped", async () => {
    // DESIRED: a broken living landscape means the spine gate cannot run — validate
    // must at least tell the user (SCHEMA.md: the landscape is a living axis; a parse
    // failure silently disables the C4↔API contract check).
    const files = coherentFixture();
    files["architecture/landscape.likec4"] = BROKEN_LIKEC4;
    await withProject(files, { service: SVC }, async (p) => {
      const res = await runLoam(p.workDir, "validate");
      const mention = res.out
        .split("\n")
        .find((l) => l.toLowerCase().includes("landscape"));
      expect(
        mention,
        "broken landscape.likec4 produced no output line mentioning the landscape — the spine gate was silently skipped",
      ).toBeDefined();
      expect(mention).toMatch(/[⚠✗]|error/i);
    });
  });

  it("no landscape file: spine check is skipped and exit stays 0", async () => {
    const files = coherentFixture();
    delete files["architecture/landscape.likec4"];
    await withProject(files, { service: SVC }, async (p) => {
      const res = await runLoam(p.workDir, "validate");
      expect(res.code).toBe(0);
      expect(res.out.toLowerCase()).not.toContain("landscape");
    });
  });
});

describe("feature mode: delta + coverage + coherence", () => {
  it("coherent fixture validates: delta valid, requirements covered, coherence agrees, exit 0", async () => {
    await withProject(coherentFixture(), { service: SVC }, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--feature", "FEAT-1");
      expect(res.code).toBe(0);
      expect(res.out).toContain("FEAT-1");
      expect(res.out).toContain("✓ delta.likec4 valid");
      expect(res.out).toContain("✓ payment-split-service: requirements covered");
      expect(res.out).toContain("coherence: ✓");
    });
  });

  it("an unknown feature id fails and names the missing feature", async () => {
    await withProject(coherentFixture(), { service: SVC }, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--feature", "FEAT-9");
      expect(res.code).toBe(1);
      expect(res.out).toContain("No feature 'FEAT-9'");
    });
  });

  it("a broken delta.likec4 fails and shows the error lines", async () => {
    const files = coherentFixture();
    files["features/FEAT-1-split/delta.likec4"] = BROKEN_LIKEC4;
    await withProject(files, { service: SVC }, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--feature", "FEAT-1");
      expect(res.code).toBe(1);
      expect(res.out).toMatch(/✗ delta\.likec4 has \d+ error/);
    });
  });

  it("a per-service delta requirement without a scenario fails and is named", async () => {
    const files = coherentFixture();
    files["features/FEAT-1-split/specs/payment-split-service/spec.md"] = FEATURE_SPEC.slice(
      0,
      FEATURE_SPEC.indexOf("#### Scenario:"),
    );
    await withProject(files, { service: SVC }, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--feature", "FEAT-1");
      expect(res.code).toBe(1);
      expect(res.out).toContain("without a scenario");
      expect(res.out).toContain("Split a payment");
    });
  });

  it("REMOVED requirements in a delta spec are never counted as missing scenarios", async () => {
    const files = coherentFixture();
    // the requirement being removed has to exist in the living spec to be removable
    files["services/payment-split-service/spec.md"] = `# payment-split-service

## Requirements

### Requirement: Manual reconciliation
Splits are reconciled by hand.

#### Scenario: Someone reconciles
- **Given** a split
- **When** an operator reconciles it
- **Then** it is marked settled
`;
    files["features/FEAT-1-split/specs/payment-split-service/spec.md"] =
      FEATURE_SPEC +
      `
## REMOVED Requirements

### Requirement: Manual reconciliation
Splits are reconciled automatically now.
`;
    await withProject(files, { service: SVC }, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--feature", "FEAT-1");
      expect(res.code).toBe(0);
      expect(res.out).not.toContain("without a scenario");
    });
  });

  it("coherence ERROR: a tagged edge op undefined in the target's OpenAPI gates (contract broken, exit 1)", async () => {
    const files = coherentFixture();
    files["features/FEAT-1-split/delta.likec4"] = FEATURE_DELTA.replace("op 'createSplit'", "op 'chargeSplit'");
    await withProject(files, { service: SVC }, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--feature", "FEAT-1");
      expect(res.code).toBe(1);
      expect(res.out).toContain("chargeSplit");
      expect(res.out).toContain("contract broken");
    });
  });

  it("coherence ERROR: a requirement governing an op no OpenAPI defines gates (exit 1)", async () => {
    const files = coherentFixture();
    files["features/FEAT-1-split/specs/payment-split-service/spec.md"] = FEATURE_SPEC.replace(
      "Operations: createSplit",
      "Operations: createSplit, deleteSplit",
    );
    await withProject(files, { service: SVC }, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--feature", "FEAT-1");
      expect(res.code).toBe(1);
      expect(res.out).toContain("deleteSplit");
      expect(res.out).toMatch(/governs 'deleteSplit', not defined/);
    });
  });

  it("coherence WARN-only (an added op no edge consumes) does not gate validate (exit 0)", async () => {
    // Pins validate's warn semantics. NOTE the asymmetry: `loam archive` BLOCKS on the
    // very same warn-only issue list (archive.ts gates on issues.length > 0) — flagged
    // as a design question, not asserted here.
    const files = coherentFixture();
    files["features/FEAT-1-split/specs/payment-split-service/openapi.yaml"] =
      FEATURE_OPENAPI +
      `  /splits/{id}/refund:
    post:
      operationId: refundSplit
      summary: Refund a split
      responses:
        "200":
          description: Refunded
`;
    await withProject(files, { service: SVC }, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--feature", "FEAT-1");
      expect(res.code).toBe(0);
      expect(res.out).toContain("⚠");
      expect(res.out).toContain("refundSplit");
      expect(res.out).toContain("coherence:");
    });
  });
});

describe("feature mode: arch-edge coverage heuristic", () => {
  it("prints ✓ for a tagged edge whose target service is named by the delta's scenario text", async () => {
    await withProject(coherentFixture(), { service: SVC }, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--feature", "FEAT-1");
      expect(res.code).toBe(0);
      expect(res.out).toContain("arch-edge coverage (heuristic):");
      const line = res.out.split("\n").find((l) => l.includes("payment-service → payment-split-service"));
      expect(line).toBeDefined();
      expect(line).toContain("✓");
    });
  });

  it("prints ⚠ for a tagged edge nothing in the specs names, and stays exit 0 (warn-only)", async () => {
    const files: Record<string, string> = {
      "features/FEAT-2/delta.likec4": `specification {
  element softwareSystem
  tag FEAT-2
}

model {
  core = softwareSystem 'core-service'
  ledger = softwareSystem 'ledger-service' {
    #FEAT-2
  }

  core -> ledger 'Sync' {
    #FEAT-2
  }
}

views {
  view feat_2 {
    include *
  }
}
`,
      "features/FEAT-2/specs/core-service/spec.md": `# core-service — delta for FEAT-2

## ADDED Requirements

### Requirement: Keep records
The service SHALL keep records.

#### Scenario: Records kept
- **Given** a record
- **When** it is stored
- **Then** it persists
`,
    };
    await withProject(files, {}, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--feature", "FEAT-2");
      expect(res.code).toBe(0);
      const line = res.out.split("\n").find((l) => l.includes("no scenario names it"));
      expect(line).toBeDefined();
      expect(line).toContain("⚠");
      expect(line).toContain("ledger-service");
    });
  });
});

describe("feature dir resolution", () => {
  it("feature id matches its exact directory name", async () => {
    await withProject(
      { "features/FEAT-2/specs/core-service/spec.md": goodDeltaSpec("core-service") },
      {},
      async (p) => {
        const res = await runLoam(p.workDir, "validate", "--feature", "FEAT-2");
        expect(res.code).toBe(0);
        expect(res.out).toContain("FEAT-2");
        expect(res.out).toContain("core-service: requirements covered");
      },
    );
  });

  it("FEAT-1 does not match FEAT-10-other (prefix must break on the hyphen)", async () => {
    await withProject({ "features/FEAT-10-other/intent.md": "# other\n" }, {}, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--feature", "FEAT-1");
      expect(res.code).toBe(1);
      expect(res.out).toContain("No feature 'FEAT-1'");
    });
  });

  it("with FEAT-1-split and FEAT-10-other side by side, each id resolves to its own dir", async () => {
    const files = coherentFixture();
    files["features/FEAT-10-other/intent.md"] = "# other\n";
    await withProject(files, { service: SVC }, async (p) => {
      const res1 = await runLoam(p.workDir, "validate", "--feature", "FEAT-1");
      expect(res1.code).toBe(0);
      expect(res1.out).toContain("✓ delta.likec4 valid"); // only FEAT-1-split has a delta
      const res10 = await runLoam(p.workDir, "validate", "--feature", "FEAT-10");
      expect(res10.code).toBe(0);
      expect(res10.out).toContain("FEAT-10");
      expect(res10.out).not.toContain("delta.likec4 valid");
    });
  });

  it("when both FEAT-3 and FEAT-3-slug exist, exactly one is picked (pinned; ambiguity unflagged — minor)", async () => {
    const files: Record<string, string> = {
      "features/FEAT-3/specs/svc-exact/spec.md": goodDeltaSpec("svc-exact"),
      "features/FEAT-3-slug/specs/svc-slug/spec.md": goodDeltaSpec("svc-slug"),
    };
    await withProject(files, {}, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--feature", "FEAT-3");
      expect(res.code).toBe(0);
      const pickedExact = res.out.includes("svc-exact");
      const pickedSlug = res.out.includes("svc-slug");
      // pick-first: exactly one dir is validated, never both, never an ambiguity error
      expect(pickedExact !== pickedSlug).toBe(true);
    });
  });
});

describe("exit-code discipline", () => {
  it("warnings alone never flip the exit code to 1 (ungoverned op + op-less call edge)", async () => {
    const files = coherentFixture();
    // warn 1: an ungoverned operation
    files[`services/${SVC}/openapi.yaml`] =
      LIVING_OPENAPI +
      `  /payments/refund:
    post:
      operationId: refundPayment
      summary: Refund a payment
      responses:
        "200":
          description: Refunded
`;
    // warn 2: an inbound 'Calls …' edge with no metadata op
    files["architecture/landscape.likec4"] = LANDSCAPE.replace(
      `checkoutWeb -> paymentService 'Calls authorizePayment' {
    metadata { op 'authorizePayment' }
  }`,
      `checkoutWeb -> paymentService 'Calls authorizePayment'`,
    );
    await withProject(files, { service: SVC }, async (p) => {
      const res = await runLoam(p.workDir, "validate");
      expect(res.out).toContain("not governed by any requirement");
      expect(res.out).toContain("has no operation link");
      expect(res.code).toBe(0);
    });
  });

  it("a single error gates even when warnings are also present", async () => {
    const files = coherentFixture();
    // warning: ungoverned op
    files[`services/${SVC}/openapi.yaml`] =
      LIVING_OPENAPI +
      `  /payments/refund:
    post:
      operationId: refundPayment
      summary: Refund a payment
      responses:
        "200":
          description: Refunded
`;
    // error: requirement without a scenario
    files[`services/${SVC}/spec.md`] = LIVING_SPEC.slice(0, LIVING_SPEC.indexOf("#### Scenario:"));
    await withProject(files, { service: SVC }, async (p) => {
      const res = await runLoam(p.workDir, "validate");
      expect(res.code).toBe(1);
      expect(res.out).toContain("without a scenario");
      expect(res.out).toContain("not governed by any requirement");
    });
  });
});
