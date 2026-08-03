/**
 * Deep invariant tests for src/core/coherence.ts — featureCoherence().
 *
 * featureCoherence(docsDir, featureDir, featureId) checks that a feature's three
 * axes agree: C4 delta (architecture) ↔ requirement deltas (behaviour) ↔ OpenAPI
 * (contract), joined by the operationId spine. Errors gate `loam archive`
 * (archive.ts blocks on ANY issue, warns included, without --approve).
 *
 * Tests assert DESIRED semantics per SCHEMA.md and the module's own docstring —
 * failures that survive re-derivation from source are recorded as suspected bugs.
 */
import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { featureCoherence, type Issue } from "../src/core/coherence.js";
import {
  coherentFixture,
  makeProject,
  FEATURE_OPENAPI,
  FEATURE_SPEC,
  LIVING_OPENAPI,
  LIVING_SPEC,
} from "./helpers/harness.js";

/* ------------------------------------------------------------------ */
/* Fixture builders                                                    */
/* ------------------------------------------------------------------ */

const FEATURE_REL = "features/FEAT-1-split";

/** Build a docs repo from `files`, run featureCoherence on FEAT-1, destroy. */
async function coherenceOf(
  files: Record<string, string>,
  featureId = "FEAT-1",
  featureRel = FEATURE_REL,
): Promise<Issue[]> {
  const p = await makeProject(files);
  try {
    return await featureCoherence(p.docsDir, join(p.docsDir, featureRel), featureId);
  } finally {
    await p.destroy();
  }
}

const errors = (issues: Issue[]) => issues.filter((i) => i.severity === "error");
const warns = (issues: Issue[]) => issues.filter((i) => i.severity === "warn");

/** A self-contained delta.likec4 with the given model body, FEAT-1/FEAT-2 tags declared. */
const delta = (modelBody: string) => `specification {
  element softwareSystem
  element container
  tag FEAT-1
  tag FEAT-2
}

model {
${modelBody}
}

views {
  view v {
    include *
  }
}
`;

/** An ADDED-requirement feature spec delta governing the given Operations line. */
const specDelta = (ops: string, name = "Do the thing") => `# delta for FEAT-1

## ADDED Requirements

### Requirement: ${name}
The service SHALL do the thing.

Operations: ${ops}

#### Scenario: Happy path
- **Given** a precondition
- **When** the thing happens
- **Then** it worked
`;

/** A feature spec delta whose requirement has NO Operations line. */
const SPEC_NO_OPS = `# delta for FEAT-1

## ADDED Requirements

### Requirement: Do the thing
The service SHALL do the thing.

#### Scenario: Happy path
- **Given** a precondition
- **When** the thing happens
- **Then** it worked
`;

/** Minimal OpenAPI defining the given operationIds. */
const openapiWith = (...ops: string[]) => `openapi: 3.1.0
info:
  title: svc
  version: "1.0"
paths:
${ops
  .map(
    (op, i) => `  /p${i}:
    post:
      operationId: ${op}
      responses:
        "200":
          description: ok
`,
  )
  .join("")}`;

/* ------------------------------------------------------------------ */
/* Baseline                                                            */
/* ------------------------------------------------------------------ */

describe("fully coherent fixture", () => {
  it("the canonical coherent fixture yields exactly no issues", async () => {
    const issues = await coherenceOf(coherentFixture());
    expect(issues).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* E1: spec → API                                                      */
/* ------------------------------------------------------------------ */

describe("E1 spec→API: every governed operation must exist in that service's OpenAPI", () => {
  it("requirement governing an op absent from its service's OpenAPI is exactly one error", async () => {
    const issues = await coherenceOf({
      [`${FEATURE_REL}/specs/payment-split-service/spec.md`]: specDelta("ghostOp"),
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]!.severity).toBe("error");
    expect(issues[0]!.message).toContain("ghostOp");
    expect(issues[0]!.message).toContain("payment-split-service");
  });

  it("op defined only in ANOTHER service's living OpenAPI still errors for the governing service", async () => {
    // authorizePayment exists — but in payment-service's contract, not payment-split-service's.
    const issues = await coherenceOf({
      "services/payment-service/openapi.yaml": LIVING_OPENAPI,
      [`${FEATURE_REL}/specs/payment-split-service/spec.md`]: specDelta("authorizePayment"),
    });
    expect(errors(issues)).toHaveLength(1);
    expect(errors(issues)[0]!.message).toContain("authorizePayment");
    expect(errors(issues)[0]!.message).toContain("payment-split-service");
  });

  it("op defined only in ANOTHER service's feature OpenAPI delta still errors for the governing service", async () => {
    const issues = await coherenceOf({
      [`${FEATURE_REL}/specs/consumer-svc/spec.md`]: specDelta("sharedOp"),
      [`${FEATURE_REL}/specs/provider-svc/openapi.yaml`]: openapiWith("sharedOp"),
    });
    const errs = errors(issues);
    expect(errs).toHaveLength(1);
    expect(errs[0]!.message).toContain("sharedOp");
    expect(errs[0]!.message).toContain("consumer-svc");
  });

  it("op satisfied by the service's own LIVING OpenAPI (no feature openapi delta) is not an error", async () => {
    // A feature can modify a requirement over a pre-existing endpoint without restating the API.
    const files = coherentFixture();
    files[`${FEATURE_REL}/specs/payment-service/spec.md`] = `# payment-service — delta for FEAT-1

## MODIFIED Requirements

### Requirement: Authorize a payment
The service SHALL authorize a payment before capture and record the split reference.

Operations: authorizePayment

#### Scenario: Successful authorization
- **Given** a valid card
- **When** authorization is requested
- **Then** the payment is authorized
`;
    const issues = await coherenceOf(files);
    expect(issues).toEqual([]);
  });

  it("multi-op Operations line: only the missing op errors, the defined one stays silent", async () => {
    const files = coherentFixture();
    files[`${FEATURE_REL}/specs/payment-split-service/spec.md`] = FEATURE_SPEC.replace(
      "Operations: createSplit",
      "Operations: createSplit, refundSplit",
    );
    const issues = await coherenceOf(files);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.severity).toBe("error");
    expect(issues[0]!.message).toContain("refundSplit");
    expect(issues[0]!.message).not.toContain("'createSplit'");
  });

  it("ops of a REMOVED requirement are not held to the contract (the requirement is being deleted)", async () => {
    // A feature removing a requirement (and its endpoint) must not be forced to keep
    // the op defined — E1's rationale is "would corrupt the living docs on archive",
    // and archiving a REMOVED requirement deletes it. Cf. spec.ts which exempts
    // REMOVED from the scenario rule for the same reason.
    const issues = await coherenceOf({
      [`${FEATURE_REL}/specs/payment-split-service/spec.md`]: `# delta for FEAT-1

## REMOVED Requirements

### Requirement: Legacy split behaviour

Operations: legacyOp
`,
    });
    expect(issues).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* E2: C4 → API                                                        */
/* ------------------------------------------------------------------ */

describe("E2 C4→API: every tagged edge's op must be defined by the TARGET service", () => {
  it("tagged edge whose metadata op is missing from the target's OpenAPI is a contract error", async () => {
    const files = coherentFixture();
    // Reverse the call direction: payment-split-service calls createSplit ON payment-service,
    // whose OpenAPI only defines authorizePayment.
    files[`${FEATURE_REL}/delta.likec4`] = delta(`  paymentService = softwareSystem 'payment-service'
  paymentSplitService = softwareSystem 'payment-split-service' {
    #FEAT-1
  }
  paymentSplitService -> paymentService 'Calls createSplit' {
    #FEAT-1
    metadata { op 'createSplit' }
  }`);
    const issues = await coherenceOf(files);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.severity).toBe("error");
    expect(issues[0]!.message).toContain("createSplit");
    expect(issues[0]!.message).toContain("payment-service");
    expect(issues[0]!.message).toContain("contract");
  });

  it("target lookup is keyed by element TITLE: specs under the element id do not satisfy the contract", async () => {
    // Service directories are named by service name == element title (SCHEMA.md layout);
    // an openapi under the element's model id must not count.
    const issues = await coherenceOf({
      [`${FEATURE_REL}/delta.likec4`]: delta(`  a = softwareSystem 'caller-svc'
  b = softwareSystem 'weird-title-svc'
  a -> b 'Calls createSplit' {
    #FEAT-1
    metadata { op 'createSplit' }
  }`),
      [`${FEATURE_REL}/specs/b/spec.md`]: specDelta("createSplit"),
      [`${FEATURE_REL}/specs/b/openapi.yaml`]: openapiWith("createSplit"),
    });
    expect(errors(issues)).toHaveLength(1);
    expect(errors(issues)[0]!.message).toContain("weird-title-svc");
  });

  it("edge resolves when the feature OpenAPI delta under the target's TITLE defines the op", async () => {
    const issues = await coherenceOf({
      [`${FEATURE_REL}/delta.likec4`]: delta(`  a = softwareSystem 'caller-svc'
  b = softwareSystem 'weird-title-svc'
  a -> b 'Calls createSplit' {
    #FEAT-1
    metadata { op 'createSplit' }
  }`),
      [`${FEATURE_REL}/specs/weird-title-svc/spec.md`]: specDelta("createSplit"),
      [`${FEATURE_REL}/specs/weird-title-svc/openapi.yaml`]: openapiWith("createSplit"),
    });
    expect(issues).toEqual([]);
  });

  it("edge op defined in the target's LIVING OpenAPI produces no error", async () => {
    const issues = await coherenceOf({
      "services/payment-service/openapi.yaml": LIVING_OPENAPI,
      [`${FEATURE_REL}/delta.likec4`]: delta(`  checkoutWeb = softwareSystem 'checkout-web'
  paymentService = softwareSystem 'payment-service'
  checkoutWeb -> paymentService 'Calls authorizePayment' {
    #FEAT-1
    metadata { op 'authorizePayment' }
  }`),
    });
    expect(errors(issues)).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* W1: call-shaped edges without an op link                            */
/* ------------------------------------------------------------------ */

describe("W1: tagged 'Calls …' edge without metadata op", () => {
  it("tagged edge titled 'Calls …' with no metadata op warns about the missing operation link", async () => {
    const issues = await coherenceOf({
      [`${FEATURE_REL}/delta.likec4`]: delta(`  a = softwareSystem 'svc-a'
  b = softwareSystem 'svc-b'
  a -> b 'Calls doMystery' {
    #FEAT-1
  }`),
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]!.severity).toBe("warn");
    expect(issues[0]!.message).toContain("no operation link");
  });

  it("tagged edge with a non-call title and no op is silent", async () => {
    const issues = await coherenceOf({
      [`${FEATURE_REL}/delta.likec4`]: delta(`  a = softwareSystem 'svc-a'
  b = softwareSystem 'svc-b'
  a -> b 'Publishes SplitCreated' {
    #FEAT-1
  }`),
    });
    expect(issues).toEqual([]);
  });

  it("tagged untitled edge with no op is silent", async () => {
    const issues = await coherenceOf({
      [`${FEATURE_REL}/delta.likec4`]: delta(`  a = softwareSystem 'svc-a'
  b = softwareSystem 'svc-b'
  a -> b {
    #FEAT-1
  }`),
    });
    expect(issues).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* W-ungoverned: edge op with no governing requirement                 */
/* ------------------------------------------------------------------ */

describe("W-ungoverned: edge op defined in the API but governed by no requirement", () => {
  it("edge op defined in the feature OpenAPI but mentioned by no requirement's Operations line warns", async () => {
    const issues = await coherenceOf({
      [`${FEATURE_REL}/delta.likec4`]: delta(`  a = softwareSystem 'caller-svc'
  b = softwareSystem 'payment-split-service'
  a -> b 'Calls createSplit' {
    #FEAT-1
    metadata { op 'createSplit' }
  }`),
      // requirement exists but its Operations line does not mention createSplit
      [`${FEATURE_REL}/specs/payment-split-service/spec.md`]: SPEC_NO_OPS,
      [`${FEATURE_REL}/specs/payment-split-service/openapi.yaml`]: FEATURE_OPENAPI,
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]!.severity).toBe("warn");
    expect(issues[0]!.message).toContain("createSplit");
    expect(issues[0]!.message).toContain("no requirement governs");
  });

  it("edge op governed by the target's LIVING spec is not ungoverned", async () => {
    // A feature edge calling a pre-existing endpoint whose living requirement already
    // governs it is coherent: SCHEMA.md's coverage rule is "every operation is governed
    // by a requirement" — not "by a requirement restated inside this feature". Warning
    // here (and thereby blocking archive, which gates on ANY issue) is a false positive.
    const issues = await coherenceOf({
      "services/payment-service/spec.md": LIVING_SPEC,
      "services/payment-service/openapi.yaml": LIVING_OPENAPI,
      [`${FEATURE_REL}/delta.likec4`]: delta(`  checkoutWeb = softwareSystem 'checkout-web'
  paymentService = softwareSystem 'payment-service'
  checkoutWeb -> paymentService 'Calls authorizePayment' {
    #FEAT-1
    metadata { op 'authorizePayment' }
  }`),
    });
    expect(issues).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* W2: API → C4                                                        */
/* ------------------------------------------------------------------ */

describe("W2 API→C4: feature-added operations should be consumed by a tagged edge", () => {
  it("operation added by the feature's OpenAPI delta but consumed by no tagged edge warns", async () => {
    const files = coherentFixture();
    files[`${FEATURE_REL}/specs/payment-split-service/openapi.yaml`] =
      FEATURE_OPENAPI +
      `  /splits/refund:
    post:
      operationId: refundSplit
      responses:
        "200":
          description: ok
`;
    const issues = await coherenceOf(files);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.severity).toBe("warn");
    expect(issues[0]!.message).toContain("refundSplit");
    expect(issues[0]!.message).toContain("no architecture edge consumes");
  });

  it("operations restated from the living OpenAPI are not 'added' — no W2 warn for pre-existing ops", async () => {
    // Real authors restate the service's FULL API in the feature delta (the file is a
    // complete OpenAPI doc, not a patch). Ops that already exist in the living
    // openapi.yaml were not added by this feature, so they must not warn — otherwise
    // every restating feature is blocked at archive (which gates on ANY issue).
    const files = coherentFixture();
    files[`${FEATURE_REL}/specs/payment-service/openapi.yaml`] = LIVING_OPENAPI; // restates authorizePayment
    const issues = await coherenceOf(files);
    expect(issues).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* W3: new service without a requirement delta                         */
/* ------------------------------------------------------------------ */

describe("W3: tagged new softwareSystem needs a specs/<title>/ dir", () => {
  it("tagged new softwareSystem without a specs/<title>/ dir warns", async () => {
    const issues = await coherenceOf({
      [`${FEATURE_REL}/delta.likec4`]: delta(`  brandNew = softwareSystem 'brand-new-svc' {
    #FEAT-1
  }`),
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]!.severity).toBe("warn");
    expect(issues[0]!.message).toContain("brand-new-svc");
    expect(issues[0]!.message).toContain("no requirement delta");
  });

  it("tagged new softwareSystem WITH a specs/<title>/ dir is silent", async () => {
    const issues = await coherenceOf({
      [`${FEATURE_REL}/delta.likec4`]: delta(`  brandNew = softwareSystem 'brand-new-svc' {
    #FEAT-1
  }`),
      [`${FEATURE_REL}/specs/brand-new-svc/spec.md`]: SPEC_NO_OPS,
    });
    expect(issues).toEqual([]);
  });

  it("W3 is keyed by element TITLE: a specs dir named after the element id does not satisfy it", async () => {
    const issues = await coherenceOf({
      [`${FEATURE_REL}/delta.likec4`]: delta(`  brandNew = softwareSystem 'brand-new-svc' {
    #FEAT-1
  }`),
      [`${FEATURE_REL}/specs/brandNew/spec.md`]: SPEC_NO_OPS,
    });
    expect(warns(issues)).toHaveLength(1);
    expect(warns(issues)[0]!.message).toContain("brand-new-svc");
  });

  it("tagged non-softwareSystem elements (containers) do not trigger W3", async () => {
    const issues = await coherenceOf({
      [`${FEATURE_REL}/delta.likec4`]: delta(`  sys = softwareSystem 'host-svc' {
    comp = container 'new-comp' {
      #FEAT-1
    }
  }`),
    });
    expect(issues).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* Broken or missing inputs                                            */
/* ------------------------------------------------------------------ */

describe("broken or missing inputs", () => {
  it("an unparseable delta.likec4 surfaces as an error issue, not silent coherence", async () => {
    // The module's contract: errors are "hard (would corrupt the living docs on archive)".
    // An architecture delta that does not even parse cannot be certified coherent —
    // returning [] lets `loam archive` merge a feature whose C4 axis is unreadable.
    const issues = await coherenceOf({
      [`${FEATURE_REL}/delta.likec4`]: "model { this is not valid likec4 !!!\n",
    });
    expect(issues.some((i) => i.severity === "error")).toBe(true);
  });

  it("feature with no delta.likec4 and no specs dir has nothing to check — exactly no issues", async () => {
    const issues = await coherenceOf({
      [`${FEATURE_REL}/intent.md`]: "---\nfeature: FEAT-1\nstatus: proposed\n---\n\n# Intent\n",
    });
    expect(issues).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* Tag scoping                                                         */
/* ------------------------------------------------------------------ */

describe("tag scoping: only #<featureId>-tagged model parts are checked", () => {
  it("untagged edge with a bogus op is invisible to every rule (pinned usability trap)", async () => {
    // Pinned per SCHEMA.md ("loam can project the delta by tag"): untagged parts are
    // context, not delta. NOTE the trap: forget the tag and every check silently passes.
    const issues = await coherenceOf({
      [`${FEATURE_REL}/delta.likec4`]: delta(`  a = softwareSystem 'svc-a'
  b = softwareSystem 'svc-b'
  a -> b 'Calls ghostOp' {
    metadata { op 'ghostOp' }
  }`),
    });
    expect(issues).toEqual([]);
  });

  it("elements and edges tagged with a DIFFERENT feature id are invisible to this feature", async () => {
    const issues = await coherenceOf({
      [`${FEATURE_REL}/delta.likec4`]: delta(`  a = softwareSystem 'svc-a'
  other = softwareSystem 'other-new-svc' {
    #FEAT-2
  }
  a -> other 'Calls ghostOp' {
    #FEAT-2
    metadata { op 'ghostOp' }
  }`),
    });
    expect(issues).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* Severity domain                                                     */
/* ------------------------------------------------------------------ */

describe("severity domain", () => {
  it("every issue's severity is exactly 'error' or 'warn' (mixed fixture: 1 error + 3 warns)", async () => {
    const issues = await coherenceOf({
      // E1: ghostOp governed but undefined; W2: createSplit defined but unconsumed
      [`${FEATURE_REL}/specs/payment-split-service/spec.md`]: specDelta("ghostOp"),
      [`${FEATURE_REL}/specs/payment-split-service/openapi.yaml`]: openapiWith("createSplit"),
      // W3: lonely-svc has no specs dir; W1: call edge without op
      [`${FEATURE_REL}/delta.likec4`]: delta(`  lonely = softwareSystem 'lonely-svc' {
    #FEAT-1
  }
  b = softwareSystem 'svc-b'
  lonely -> b 'Calls doMystery' {
    #FEAT-1
  }`),
    });
    expect(issues).toHaveLength(4);
    for (const i of issues) expect(["error", "warn"]).toContain(i.severity);
    expect(errors(issues)).toHaveLength(1);
    expect(warns(issues)).toHaveLength(3);
  });
});
