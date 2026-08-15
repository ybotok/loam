/**
 * Deep invariant tests for `loam validate` (src/commands/validate/validate.ts).
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

/**
 * The files that make `services/<svc>/` a living service, for a feature delta
 * to legally address. Without one, `delta.service-unknown` fires: a `specs/<svc>/`
 * that names nothing archive would materialise as a phantom service directory.
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
    // A requirement the deltas below never re-ADD, so seeding the service does
    // not manufacture a delta.requirement-exists collision of its own.
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

  it("rejects x-loam-remove markers in a living OpenAPI contract", async () => {
    const files = coherentFixture();
    files["services/payment-service/openapi.yaml"] = LIVING_OPENAPI.replace(
      "      operationId: authorizePayment\n",
      "      operationId: authorizePayment\n      x-loam-remove: true\n",
    );
    await withProject(files, { service: SVC }, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--json");
      expect(res.code).toBe(1);
      const payload = JSON.parse(res.stdout);
      expect(payload.targets[0].findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ severity: "error", code: "openapi.remove-marker-living" }),
        ]),
      );
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
      expect(res.stdout).toMatch(new RegExp(`✗ ${SVC}: C4 model has \\d+ error`));
      // at least one indented detail line follows the header — on stdout with
      // the rest of the report. loam's report never writes to stderr; what may
      // land there on a broken model is LikeC4's own library logger, not us.
      expect(res.stdout).toMatch(/\n\s+\S+/);
      expect(res.stderr).not.toContain("✗");
      expect(res.stderr).not.toContain("C4 model has");
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

  it("a missing openapi.yaml errors when the landscape shows an inbound op call", async () => {
    const files = coherentFixture();
    delete files[`services/${SVC}/openapi.yaml`];
    await withProject(files, { service: SVC }, async (p) => {
      const res = await runLoam(p.workDir, "validate");
      expect(res.code).toBe(1);
      expect(res.out).toContain("No OpenAPI contract at");
      expect(res.out).toContain("operation link(s) already point into it");
      expect(res.out).toContain("authorizePayment");
      // One missing file is ONE finding: a contract that is not there proves
      // nothing about an edge, so the per-edge cascade is suspended.
      expect(res.out).not.toContain(`not defined in ${SVC}'s OpenAPI`);
    });
  });

  it("a missing openapi.yaml still errors with no landscape, because a living requirement governs an op", async () => {
    const files = coherentFixture();
    delete files[`services/${SVC}/openapi.yaml`];
    delete files["architecture/landscape.likec4"];
    await withProject(files, { service: SVC }, async (p) => {
      const res = await runLoam(p.workDir, "validate");
      expect(res.code).toBe(1);
      expect(res.out).toContain("No OpenAPI contract at");
      expect(res.out).toContain("operation link(s) already point into it");
    });
  });

  it("a missing openapi.yaml only warns when nothing joins into it at all", async () => {
    const files = coherentFixture();
    delete files[`services/${SVC}/openapi.yaml`];
    delete files["architecture/landscape.likec4"];
    // No landscape to prove nobody calls it, and no living Operations: line to
    // strand — the documented grace, and the surviving warn path.
    files[`services/${SVC}/spec.md`] = LIVING_SPEC.replace("Operations: authorizePayment\n\n", "");
    await withProject(files, { service: SVC }, async (p) => {
      const res = await runLoam(p.workDir, "validate");
      expect(res.code).toBe(0);
      expect(res.out).toContain("No OpenAPI contract at");
      expect(res.out).toContain("API coverage and the landscape spine are unchecked");
    });
  });

  it("service.no-model does NOT silence the rest of the gate stack — archive creates exactly that state", async () => {
    // A new service that arrived through `loam archive` has spec.md / openapi /
    // health but no model.likec4. The early return on service.no-model used to
    // suspend every later check for it: an edited vouched spec, an uncovered
    // alert and a stale generated suite all went quiet behind the one error.
    const files: Record<string, string> = {
      [`services/${SVC}/spec.md`]: LIVING_SPEC.replace(
        "status: verified",
        'status: verified\ncontent_digest: "0000000000000000"',
      ),
      [`services/${SVC}/openapi.yaml`]: LIVING_OPENAPI,
      [`services/${SVC}/health.yaml`]: "alerts:\n  - name: auth_error_rate\n",
    };
    await withProject(files, { service: SVC }, async (p) => {
      // opt into the gherkin chain, then grow the spec so the suite lags it
      expect((await runLoam(p.workDir, "gherkin")).code).toBe(0);
      await p.write(
        `services/${SVC}/spec.md`,
        files[`services/${SVC}/spec.md`]! +
          "\n#### Scenario: Declined authorization\n- **Given** an invalid card\n- **When** authorization is requested\n- **Then** the payment is declined\n",
      );
      const res = await runLoam(p.workDir, "validate", "--json");
      expect(res.code).toBe(1); // service.no-model is still an error
      const payload = JSON.parse(res.stdout) as {
        targets: Array<{ findings: Array<{ code: string }> }>;
      };
      const codes = payload.targets.flatMap((t) => t.findings.map((f) => f.code));
      expect(codes).toContain("service.no-model");
      // and every model-free signal still fires alongside it
      expect(codes, "the vouched-then-edited spec must still report").toContain("content.stale");
      expect(codes, "the uncovered alert must still report").toContain("health.uncovered");
      expect(codes, "the lagging generated suite must still report").toContain("gherkin.missing");
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

describe("positional target", () => {
  it("validates a feature by positional id, exactly as --feature does", async () => {
    await withProject(coherentFixture(), { service: SVC }, async (p) => {
      const positional = await runLoam(p.workDir, "validate", "FEAT-1", "--json");
      const flagged = await runLoam(p.workDir, "validate", "--feature", "FEAT-1", "--json");
      expect(positional.code).toBe(0);
      // `resolvedKind` is the one difference, and only the positional form can
      // carry it: it reports which of the two readings the argument took.
      const { resolvedKind, ...rest } = JSON.parse(positional.stdout);
      expect(resolvedKind).toBe("feature");
      expect(rest).toEqual(JSON.parse(flagged.stdout));
    });
  });

  it("validates a service by positional id, exactly as --service does", async () => {
    await withProject(coherentFixture(), {}, async (p) => {
      const positional = await runLoam(p.workDir, "validate", SVC, "--json");
      const flagged = await runLoam(p.workDir, "validate", "--service", SVC, "--json");
      expect(positional.code).toBe(0);
      const { resolvedKind, ...rest } = JSON.parse(positional.stdout);
      expect(resolvedKind).toBe("service");
      expect(rest).toEqual(JSON.parse(flagged.stdout));
    });
  });

  it("a slugged directory name resolves and reports under the canonical feature id", async () => {
    await withProject(coherentFixture(), {}, async (p) => {
      const res = await runLoam(p.workDir, "validate", "FEAT-1-split", "--json");
      expect(res.code).toBe(0);
      expect(JSON.parse(res.stdout).targets[0].id).toBe("FEAT-1");
    });
  });

  it("the feature reading wins when a name is both a feature and a service; --service forces the other", async () => {
    const files = coherentFixture();
    // a service directory that happens to be named like a feature id
    files["services/FEAT-7/model.likec4"] = SERVICE_MODEL;
    files["features/FEAT-7-both/specs/svc-b/spec.md"] = goodDeltaSpec("svc-b");
    await withProject(files, {}, async (p) => {
      const positional = JSON.parse((await runLoam(p.workDir, "validate", "FEAT-7", "--json")).stdout);
      expect(positional.targets[0].kind).toBe("feature");
      expect(positional.targets[0].id).toBe("FEAT-7");
      const forced = JSON.parse(
        (await runLoam(p.workDir, "validate", "--service", "FEAT-7", "--json")).stdout,
      );
      expect(forced.targets[0].kind).toBe("service");
    });
  });

  it("an archived feature id refuses with 'already archived', never the service typo treatment", async () => {
    const files = coherentFixture();
    files["features/archive/FEAT-9-shipped/intent.md"] = "# shipped\n";
    await withProject(files, {}, async (p) => {
      const res = await runLoam(p.workDir, "validate", "FEAT-9", "--json");
      expect(res.code).toBe(1);
      const json = JSON.parse(res.stdout);
      expect(json).toMatchObject({ ok: false, error: { code: "unknown-target" } });
      expect(json.error.message).toContain("already archived");
    });
  });

  it("an unknown positional falls to the service reading: service.unknown with did-you-mean", async () => {
    await withProject(coherentFixture(), {}, async (p) => {
      const res = await runLoam(p.workDir, "validate", "paymnt-service");
      expect(res.code).toBe(1);
      expect(res.out).toContain("No service directory");
      expect(res.out).toContain("Did you mean: payment-service");
    });
  });

  it("the positional with --all, --service or --feature is refused as invalid-option", async () => {
    await withProject(coherentFixture(), {}, async (p) => {
      for (const extra of [["--all"], ["--service", SVC], ["--feature", "FEAT-1"]]) {
        const res = await runLoam(p.workDir, "validate", "FEAT-1", ...extra, "--json");
        expect(res.code).toBe(1);
        const json = JSON.parse(res.stdout);
        expect(json.ok).toBe(false);
        expect(json.error.code).toBe("invalid-option");
      }
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

describe("service mode: the deprecation bridge (spine.op-deprecated / api.requirement-deprecated)", () => {
  /*
   * Real fleets migrate: legacy ops coexist with their replacements, and the
   * standard OpenAPI per-operation `deprecated: true` is how a contract says
   * so. loam turns the flag into lifecycle warnings — visibility only, never
   * removal, never a gate; `--strict` is the escalation.
   */

  /** LIVING_OPENAPI with its one operation marked deprecated. */
  const DEPRECATED_OPENAPI = LIVING_OPENAPI.replace(
    "      operationId: authorizePayment\n",
    "      operationId: authorizePayment\n      deprecated: true\n",
  );

  /** findings[].code of the single validated target, via --json. */
  async function serviceCodes(files: Record<string, string>): Promise<{ code: number; codes: string[] }> {
    const p = await makeProject(files, { service: SVC });
    try {
      const res = await runLoam(p.workDir, "validate", "--json");
      const payload = JSON.parse(res.stdout);
      return { code: res.code, codes: payload.targets[0].findings.map((f: { code: string }) => f.code) };
    } finally {
      await p.destroy();
    }
  }

  it("an inbound landscape edge calling a deprecated op warns the consumer off it, and does not gate (exit 0)", async () => {
    const files = coherentFixture();
    files["services/payment-service/openapi.yaml"] = DEPRECATED_OPENAPI;
    await withProject(files, { service: SVC }, async (p) => {
      const res = await runLoam(p.workDir, "validate");
      expect(res.code).toBe(0);
      expect(res.out).toContain(`calls 'authorizePayment', which ${SVC}'s OpenAPI marks deprecated`);
      expect(res.out).toContain("migrate");
      // --strict is the escalation: same report, exit 1.
      expect((await runLoam(p.workDir, "validate", "--strict")).code).toBe(1);
    });
  });

  it("the clean fixture raises neither deprecation warning — a live op is just a live op", async () => {
    const { code, codes } = await serviceCodes(coherentFixture());
    expect(code).toBe(0);
    expect(codes).not.toContain("spine.op-deprecated");
    expect(codes).not.toContain("api.requirement-deprecated");
  });

  it("a deprecated op with no consumers raises no spine warning — only the requirement-level one", async () => {
    // The landscape still parses and the spine still runs; there is simply no
    // inbound edge calling the op. The living requirement pinned to it is the
    // one thing left to say.
    const files = coherentFixture();
    files["services/payment-service/openapi.yaml"] = DEPRECATED_OPENAPI;
    files["architecture/landscape.likec4"] = LANDSCAPE.replace(
      `checkoutWeb -> paymentService 'Calls authorizePayment' {
    metadata { op 'authorizePayment' }
  }`,
      `checkoutWeb -> paymentService 'Sends telemetry to'`,
    );
    const { code, codes } = await serviceCodes(files);
    expect(code).toBe(0);
    expect(codes).not.toContain("spine.op-deprecated");
    expect(codes).toContain("api.requirement-deprecated");
  });

  it("a requirement whose every resolved op is deprecated is flagged as migrating out, by name", async () => {
    const files = coherentFixture();
    files["services/payment-service/openapi.yaml"] = DEPRECATED_OPENAPI;
    await withProject(files, { service: SVC }, async (p) => {
      const res = await runLoam(p.workDir, "validate");
      expect(res.code).toBe(0);
      expect(res.out).toContain(
        `${SVC}: requirement 'Authorize a payment' governs only deprecated operation(s) (authorizePayment)`,
      );
    });
  });

  it("a requirement whose Operations resolve to NOTHING raises no deprecation warning — zero resolved ops prove nothing", async () => {
    // Pins the `resolved.length === 0` half of the guard: without it,
    // `[].every(...)` is vacuously true and every requirement naming only
    // undefined ops would read "governs only deprecated operation(s) ()" —
    // empty list included — while staying invisible to every exit-code assert.
    const files = coherentFixture();
    files["services/payment-service/openapi.yaml"] = DEPRECATED_OPENAPI;
    files["services/payment-service/spec.md"] = LIVING_SPEC.replace(
      "Operations: authorizePayment\n",
      "Operations: ghostOp\n",
    );
    const { code, codes } = await serviceCodes(files);
    // The op resolves to nothing, so no deprecation claim is made about it —
    // but "governs an operation this contract does not define" IS now a finding
    // in its own right (spec-api.op-undefined), and it gates.
    expect(code).toBe(1);
    expect(codes).not.toContain("api.requirement-deprecated");
    expect(codes).toContain("spec-api.op-undefined");
  });

  it("a requirement with no Operations line raises no deprecation warning either — the unlinked-API finding speaks instead", async () => {
    const files = coherentFixture();
    files["services/payment-service/openapi.yaml"] = DEPRECATED_OPENAPI;
    files["services/payment-service/spec.md"] = LIVING_SPEC.replace("Operations: authorizePayment\n\n", "");
    const { code, codes } = await serviceCodes(files);
    expect(code).toBe(0);
    expect(codes).not.toContain("api.requirement-deprecated");
    expect(codes).toContain("api.ops-unlinked");
  });

  it("one live op keeps the requirement quiet — it still governs living behaviour", async () => {
    const twoOps = `openapi: 3.1.0
info:
  title: payment-service
  version: "1.0"
paths:
  /payments/authorize:
    post:
      operationId: authorizePayment
      deprecated: true
      responses:
        "200":
          description: Authorized
  /payments/v2/authorize:
    post:
      operationId: authorizePaymentV2
      responses:
        "200":
          description: Authorized
`;
    const files = coherentFixture();
    files["services/payment-service/openapi.yaml"] = twoOps;
    files["services/payment-service/spec.md"] = LIVING_SPEC.replace(
      "Operations: authorizePayment\n",
      "Operations: authorizePayment, authorizePaymentV2\n",
    );
    const { code, codes } = await serviceCodes(files);
    expect(code).toBe(0);
    expect(codes).not.toContain("api.requirement-deprecated");
    // The edge into the deprecated op still warns — that is the consumer's problem, not the requirement's.
    expect(codes).toContain("spine.op-deprecated");
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

  it("an archived feature still refuses (unknown-target), but says 'already archived', not 'no feature'", async () => {
    const files = coherentFixture();
    files["features/archive/FEAT-9-shipped/intent.md"] = "# shipped\n";
    await withProject(files, { service: SVC }, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--feature", "FEAT-9", "--json");
      expect(res.code).toBe(1);
      const json = JSON.parse(res.stdout);
      expect(json).toMatchObject({ ok: false, error: { code: "unknown-target" } });
      expect(json.error.message).toContain("already archived");
      expect(json.error.message).toContain("loam show FEAT-9");
      expect(json.error.message).not.toContain("No feature");
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
      // core-service must live: the delta's `core` element is untagged, so
      // nothing here introduces it and `delta.service-unknown` would fire.
      ...livingService("core-service"),
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
      {
        ...livingService("core-service"),
        "features/FEAT-2/specs/core-service/spec.md": goodDeltaSpec("core-service"),
      },
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
      ...livingService("svc-exact"),
      ...livingService("svc-slug"),
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

describe("--strict", () => {
  /** The living spec with complete frontmatter — owner and sources present — so
   * single-service validation from the docs repo reports zero warnings. */
  const COMPLETE_SPEC = LIVING_SPEC.replace(
    "status: verified\n",
    "status: verified\nowner: payments-team\nsources:\n  - src/\n",
  );

  it("exits 0 when there are no findings at all", async () => {
    const files = coherentFixture();
    files[`services/${SVC}/spec.md`] = COMPLETE_SPEC;
    await withProject(files, {}, async (p) => {
      const res = await runLoam(p.workDir, "validate", SVC, "--strict");
      expect(res.code).toBe(0);
    });
  });

  it("warnings flip the exit code to 1 — and only under --strict", async () => {
    // the stock fixture's spec names no owner and no sources: two warnings
    await withProject(coherentFixture(), {}, async (p) => {
      const plain = await runLoam(p.workDir, "validate", "--service", SVC);
      expect(plain.code).toBe(0);
      const strict = await runLoam(p.workDir, "validate", "--service", SVC, "--strict");
      expect(strict.code).toBe(1);
    });
  });

  it("changes the exit code and nothing else: the --json payload is byte-for-byte identical", async () => {
    await withProject(coherentFixture(), {}, async (p) => {
      const plain = await runLoam(p.workDir, "validate", "--service", SVC, "--json");
      const strict = await runLoam(p.workDir, "validate", "--service", SVC, "--strict", "--json");
      expect(plain.code).toBe(0);
      expect(strict.code).toBe(1);
      expect(strict.stdout).toBe(plain.stdout);
      expect(JSON.parse(strict.stdout).valid).toBe(true); // valid still means "no errors"
    });
  });

  it("works with --all", async () => {
    await withProject(coherentFixture(), {}, async (p) => {
      const plain = await runLoam(p.workDir, "validate", "--all");
      expect(plain.code).toBe(0);
      const strict = await runLoam(p.workDir, "validate", "--all", "--strict");
      expect(strict.code).toBe(1);
    });
  });

  it("works with --feature", async () => {
    await withProject(coherentFixture(), {}, async (p) => {
      // the intent's frontmatter names no owner: one warning
      const strict = await runLoam(p.workDir, "validate", "--feature", "FEAT-1", "--strict");
      expect(strict.code).toBe(1);
    });
  });
});

describe("the report is one stream", () => {
  it("errors land on stdout with the ok lines, in document order; stderr stays empty", async () => {
    const files = coherentFixture();
    // an error early in the report (spec) with ok findings after it (api, spine)
    files[`services/${SVC}/spec.md`] = LIVING_SPEC.slice(0, LIVING_SPEC.indexOf("#### Scenario:"));
    await withProject(files, { service: SVC }, async (p) => {
      const res = await runLoam(p.workDir, "validate");
      expect(res.code).toBe(1);
      expect(res.stderr).toBe("");
      const lines = res.stdout.split("\n");
      const error = lines.findIndex((l) => l.includes("without a scenario"));
      const spine = lines.findIndex((l) => l.includes("landscape spine"));
      expect(error).toBeGreaterThanOrEqual(0);
      expect(spine).toBeGreaterThan(error);
    });
  });

  it("a text-mode refusal still goes to stderr, with nothing on stdout", async () => {
    await withProject(coherentFixture(), {}, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--service", SVC, "--feature", "FEAT-1");
      expect(res.code).toBe(1);
      expect(res.stdout).toBe("");
      expect(res.stderr).toContain("--service");
      expect(res.stderr).toContain("--feature");
    });
  });
});

/* ------------------------------------------------------------------ */
/* Broken input is its own diagnosis — never somebody else's           */
/* ------------------------------------------------------------------ */

interface JsonFinding {
  severity: string;
  code: string;
  subject?: string;
  message: string;
  details: string[];
}

/** Every finding across every target of a --json run. */
function jsonFindings(stdout: string): JsonFinding[] {
  const payload = JSON.parse(stdout) as { targets: Array<{ findings: JsonFinding[] }> };
  return payload.targets.flatMap((t) => t.findings);
}

function byCode(all: JsonFinding[], code: string): JsonFinding[] {
  return all.filter((f) => f.code === code);
}

describe("service mode: openapi.invalid — a broken contract is the error, not the spine", () => {
  it("broken YAML reports openapi.invalid and NO false spine.op-undefined on inbound edges", async () => {
    const files = coherentFixture();
    // The landscape's checkoutWeb → paymentService edge calls authorizePayment;
    // the old empty-parse graded it spine.op-undefined against a zero opset.
    files[`services/${SVC}/openapi.yaml`] = "paths: [unclosed\n  bar: ::::\n";
    await withProject(files, { service: SVC }, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--json");
      expect(res.code).toBe(1); // an unreadable source of truth is an error
      const all = jsonFindings(res.stdout);
      const [invalid] = byCode(all, "openapi.invalid");
      expect(invalid).toBeDefined();
      expect(invalid!.severity).toBe("error");
      expect(invalid!.details.length).toBeGreaterThan(0); // the parser's own message rides along
      expect(byCode(all, "spine.op-undefined")).toEqual([]);
      expect(byCode(all, "spine.resolved")).toEqual([]); // no false all-clear either
      // Nothing api.* may be graded against a contract nobody can read.
      for (const code of ["api.covered", "api.ungoverned", "api.ops-unlinked", "service.no-openapi"]) {
        expect(byCode(all, code)).toEqual([]);
      }
    });
  });

  it("spine.op-link-missing stays live — it never reads the contract", async () => {
    const files = coherentFixture();
    files[`services/${SVC}/openapi.yaml`] = "paths: [unclosed\n";
    // Same fleet, but the inbound edge has a "Calls" title and no metadata op:
    // that defect is the landscape's, not the contract's, so it must survive.
    files["architecture/landscape.likec4"] = `specification {
  element softwareSystem
}

model {
  checkoutWeb = softwareSystem 'checkout-web'
  paymentService = softwareSystem 'payment-service'

  checkoutWeb -> paymentService 'Calls authorizePayment'
}

views {
  view landscape {
    include *
  }
}
`;
    await withProject(files, { service: SVC }, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--json");
      const all = jsonFindings(res.stdout);
      expect(byCode(all, "openapi.invalid")).toHaveLength(1);
      expect(byCode(all, "spine.op-link-missing")).toHaveLength(1);
    });
  });

  it("a valid contract is unchanged: no openapi.invalid, api and spine still graded", async () => {
    await withProject(coherentFixture(), { service: SVC }, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--json");
      expect(res.code).toBe(0);
      const all = jsonFindings(res.stdout);
      expect(byCode(all, "openapi.invalid")).toEqual([]);
      expect(byCode(all, "api.covered")).toHaveLength(1);
      expect(byCode(all, "spine.resolved")).toHaveLength(1);
    });
  });
});

describe("service mode: health.invalid — an unreadable health.yaml is the finding, not a typo hunt", () => {
  /** A living arch spec whose one requirement covers `entries`. */
  const archSpec = (covers: string): string => `---
service: payment-service
status: draft
owner: x
---

# arch

## Requirements

### Requirement: Outbox discipline
The service SHALL publish through the outbox.

Covers: ${covers}

#### Scenario: Broker down
- **Given** an event in the outbox
- **When** kafka is down
- **Then** the event is published later
`;

  it("broken health.yaml warns health.invalid and mutes covers.unknown for alert:/sli: entries", async () => {
    const files = coherentFixture();
    files[`services/${SVC}/health.yaml`] = "alerts: [unclosed\n  bar: ::::\n";
    files[`services/${SVC}/arch.spec.md`] = archSpec("alert:err_rate, sli:availability");
    await withProject(files, { service: SVC }, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--json");
      expect(res.code).toBe(0); // warn, like the whole advisory axis
      const all = jsonFindings(res.stdout);
      const [invalid] = byCode(all, "health.invalid");
      expect(invalid).toBeDefined();
      expect(invalid!.severity).toBe("warn");
      // Neither direction may be graded against ids nobody could read.
      expect(byCode(all, "covers.unknown")).toEqual([]);
      expect(byCode(all, "health.uncovered")).toEqual([]);
    });
  });

  it("the muting is surgical: a non-health Covers entry still gets its covers.unknown", async () => {
    const files = coherentFixture();
    files[`services/${SVC}/health.yaml`] = "alerts: [unclosed\n";
    files[`services/${SVC}/arch.spec.md`] = archSpec("alert:err_rate, no.such.element");
    await withProject(files, { service: SVC }, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--json");
      const unknown = byCode(jsonFindings(res.stdout), "covers.unknown");
      expect(unknown).toHaveLength(1);
      expect(unknown[0]!.message).toContain("no.such.element");
    });
  });

  it("a broken health.yaml is reported even with no arch.spec.md — the file itself is the finding", async () => {
    const files = coherentFixture();
    files[`services/${SVC}/health.yaml`] = "alerts: [unclosed\n";
    await withProject(files, { service: SVC }, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--json");
      expect(byCode(jsonFindings(res.stdout), "health.invalid")).toHaveLength(1);
    });
  });

  it("a valid health.yaml is unchanged: no health.invalid, health.uncovered still fires", async () => {
    const files = coherentFixture();
    files[`services/${SVC}/health.yaml`] = "alerts:\n  - name: err_rate\n";
    await withProject(files, { service: SVC }, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--json");
      const all = jsonFindings(res.stdout);
      expect(byCode(all, "health.invalid")).toEqual([]);
      expect(byCode(all, "health.uncovered")).toHaveLength(1);
    });
  });
});

describe("frontmatter.malformed — one honest error instead of the field cascade", () => {
  const GOOD_HEADER = "---\nservice: payment-service\nstatus: verified\n---";

  it("a spec.md whose header does not parse gets frontmatter.malformed, not 'fields missing'", async () => {
    const files = coherentFixture();
    files[`services/${SVC}/spec.md`] = LIVING_SPEC.replace(GOOD_HEADER, "---\nservice: [unclosed\n---");
    await withProject(files, { service: SVC }, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--json");
      expect(res.code).toBe(1);
      const all = jsonFindings(res.stdout);
      const [malformed] = byCode(all, "frontmatter.malformed");
      expect(malformed).toBeDefined();
      expect(malformed!.severity).toBe("error");
      expect(malformed!.message).toContain("spec.md");
      // The false cascade the silent {} used to produce:
      for (const code of ["frontmatter.field-missing", "frontmatter.missing", "sources.absent"]) {
        expect(byCode(all, code)).toEqual([]);
      }
      // The BODY is still read — a bad header must not unread the requirements.
      expect(byCode(all, "requirements.covered")).toHaveLength(1);
    });
  });

  it("a malformed intent.md reports the same way on the feature target", async () => {
    const files = coherentFixture();
    files["features/FEAT-1-split/intent.md"] = "---\nfeature: [unclosed\n---\n\n# Split payments\n";
    await withProject(files, {}, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--feature", "FEAT-1", "--json");
      expect(res.code).toBe(1);
      const all = jsonFindings(res.stdout);
      expect(byCode(all, "frontmatter.malformed")).toHaveLength(1);
      expect(byCode(all, "frontmatter.field-missing")).toEqual([]);
    });
  });

  it("a valid header is unchanged — no frontmatter.malformed on the clean fixture", async () => {
    await withProject(coherentFixture(), { service: SVC }, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--json");
      expect(byCode(jsonFindings(res.stdout), "frontmatter.malformed")).toEqual([]);
    });
  });
});

describe("spec.duplicate-requirement — one name, one living block", () => {
  const DUP_SPEC = `---
service: payment-service
status: verified
---

# payment-service

## Requirements

### Requirement: Authorize a payment
The service SHALL authorize a payment before capture.

Operations: authorizePayment

#### Scenario: Successful authorization
- **Given** a valid card
- **When** authorization is requested
- **Then** the payment is authorized

### Requirement: Authorize a payment
An older copy of the same requirement, left behind by hand-merging.

#### Scenario: Stale copy
- **Given** a card
- **When** anything
- **Then** something
`;

  it("two blocks with one name in the living spec error, naming the requirement and the count", async () => {
    const files = coherentFixture();
    files[`services/${SVC}/spec.md`] = DUP_SPEC;
    await withProject(files, { service: SVC }, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--json");
      expect(res.code).toBe(1);
      const dup = byCode(jsonFindings(res.stdout), "spec.duplicate-requirement");
      expect(dup).toHaveLength(1);
      expect(dup[0]!.severity).toBe("error");
      expect(dup[0]!.message).toContain("'Authorize a payment'");
      expect(dup[0]!.message).toContain("2 times");
    });
  });

  it("spec.md and arch.spec.md are separate namespaces — one name in both is legal", async () => {
    const files = coherentFixture();
    files[`services/${SVC}/arch.spec.md`] = `---
service: payment-service
status: draft
owner: x
---

# arch

## Requirements

### Requirement: Authorize a payment
The ARCH duty behind the same name — a different namespace, not a duplicate.

#### Scenario: Outbox holds
- **Given** an event
- **When** kafka is down
- **Then** it is delivered later
`;
    await withProject(files, { service: SVC }, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--json");
      expect(byCode(jsonFindings(res.stdout), "spec.duplicate-requirement")).toEqual([]);
    });
  });
});

describe("spec.repeated-operations / spec.repeated-covers — the keep-last quirk stops being silent", () => {
  it("a second Operations: line warns, and the keep-last semantics stand untouched", async () => {
    const files = coherentFixture();
    files[`services/${SVC}/spec.md`] = LIVING_SPEC.replace(
      "Operations: authorizePayment",
      "Operations: legacyOp\nOperations: authorizePayment",
    );
    await withProject(files, { service: SVC }, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--json");
      expect(res.code).toBe(0); // warn-only
      const all = jsonFindings(res.stdout);
      const [rep] = byCode(all, "spec.repeated-operations");
      expect(rep).toBeDefined();
      expect(rep!.severity).toBe("warn");
      expect(rep!.message).toContain("2 'Operations:' lines");
      // Keep-last intact: only the LAST line governs, and it names the one
      // defined op — so the API still grades covered, not ungoverned.
      expect(byCode(all, "api.covered")).toHaveLength(1);
      expect(byCode(all, "spec.repeated-covers")).toEqual([]);
    });
  });

  it("a second Covers: line in arch.spec.md warns spec.repeated-covers", async () => {
    const files = coherentFixture();
    files[`services/${SVC}/arch.spec.md`] = `---
service: payment-service
status: draft
owner: x
---

# arch

## Requirements

### Requirement: Outbox discipline
The service SHALL publish through the outbox.

Covers: checkoutWeb -> paymentService
Covers: paymentService.api

#### Scenario: Broker down
- **Given** an event in the outbox
- **When** kafka is down
- **Then** the event is published later
`;
    await withProject(files, { service: SVC }, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--json");
      expect(res.code).toBe(0);
      const all = jsonFindings(res.stdout);
      expect(byCode(all, "spec.repeated-covers")).toHaveLength(1);
      // Keep-last intact here too: only paymentService.api was parsed, and it
      // resolves — no covers.unknown for the lost first line either.
      expect(byCode(all, "covers.unknown")).toEqual([]);
    });
  });

  it("fires on a feature's spec delta too — a lost line there merges into the living spec", async () => {
    const files = coherentFixture();
    files["features/FEAT-1-split/specs/payment-split-service/spec.md"] = FEATURE_SPEC.replace(
      "Operations: createSplit",
      "Operations: legacyOp\nOperations: createSplit",
    );
    await withProject(files, {}, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--feature", "FEAT-1", "--json");
      expect(res.code).toBe(0);
      const rep = byCode(jsonFindings(res.stdout), "spec.repeated-operations");
      expect(rep).toHaveLength(1);
      expect(rep[0]!.subject).toBe("payment-split-service");
    });
  });

  it("one line raises nothing, and an Operations: inside a scenario body never counts", async () => {
    const files = coherentFixture();
    files[`services/${SVC}/spec.md`] = LIVING_SPEC.replace(
      "- **Then** the payment is authorized",
      '- **Then** the payment is authorized\n- **And** the doc says "Operations: bogusOp"\nOperations: bogusOp',
    );
    await withProject(files, { service: SVC }, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--json");
      const all = jsonFindings(res.stdout);
      expect(byCode(all, "spec.repeated-operations")).toEqual([]);
      expect(byCode(all, "spec.repeated-covers")).toEqual([]);
    });
  });
});
