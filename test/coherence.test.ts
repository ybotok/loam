/**
 * Deep invariant tests for src/core/coherence/ — featureCoherence().
 *
 * featureCoherence({ docsDir, featureDir, featureId }) checks that a feature's three
 * axes agree: C4 delta (architecture) ↔ requirement deltas (behaviour) ↔ OpenAPI
 * (contract), joined by the operationId spine. Errors gate `loam archive`
 * (--approve overrides them); warnings are printed but never block.
 *
 * Tests assert DESIRED semantics per SCHEMA.md and the module's own docstring —
 * failures that survive re-derivation from source are recorded as suspected bugs.
 */
import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { featureCoherence, type Issue } from "../src/core/coherence/coherence.js";
// The sentinel is imported, never re-spelled: sentinels.ts exists so the
// templates and the gate share ONE spelling, and a third copy in a fixture is
// exactly the drift that module was written to prevent. What this file pins is
// the SCOPE the gate reads — new.test.ts already proves `loam new` writes this
// very string end to end.
import { SERVICE_DESCRIPTION_SENTINEL } from "../src/core/coherence/authoring/sentinels.js";
import { gatesArchive } from "../src/core/vocabulary/issue.js";
import {
  coherentFixture,
  makeProject,
  pinFor,
  pinOpenapi,
  runLoam,
  treeHashes,
  writeFiles,
  FEATURE_DELTA,
  LANDSCAPE,
  FEATURE_OPENAPI,
  FEATURE_SPEC,
  LIVING_OPENAPI,
  LIVING_SPEC,
} from "./helpers/harness.js";

/* ------------------------------------------------------------------ */
/* Fixture builders                                                    */
/* ------------------------------------------------------------------ */

const FEATURE_REL = "features/FEAT-1-split";

/**
 * A minimal intent.md carrying one authored sentence. `intent.empty` became a
 * gating warn, so a fixture with no stated intent now adds that finding to
 * every exact issue-set assertion in this file — the intent axis has its own
 * tests, and the fixtures here must stay silent on it to keep probing exactly
 * one axis at a time.
 */
const intentProse = (featureId = "FEAT-1") =>
  `---\nfeature: ${featureId}\nstatus: proposed\n---\n\n# Intent\n\nExercise one coherence axis in isolation.\n`;

/** Build a docs repo from `files`, run featureCoherence on FEAT-1, destroy. */
async function coherenceOf(
  files: Record<string, string>,
  featureId = "FEAT-1",
  featureRel = FEATURE_REL,
): Promise<Issue[]> {
  // The caller's own intent.md wins over the default: a test about the intent
  // axis itself must be able to supply an empty or missing one deliberately.
  const p = await makeProject({ [`${featureRel}/intent.md`]: intentProse(featureId), ...files });
  try {
    return await featureCoherence({ docsDir: p.docsDir, featureDir: join(p.docsDir, featureRel), featureId });
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
Based-On: ${pinFor(files["services/payment-service/spec.md"]!, "Authorize a payment")}
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

  it("a REMOVED requirement must explicitly remove every operation it governed", async () => {
    // the requirement being removed has to exist to be removable — otherwise the
    // delta-shape check fires first and this rule is never reached
    const livingSplit = `# payment-split-service

## Requirements

### Requirement: Legacy split behaviour
The service SHALL do the legacy thing.

Operations: legacyOp

#### Scenario: It happens
- **Given** a legacy split
- **When** it runs
- **Then** it completes
`;
    const issues = await coherenceOf({
      "services/payment-split-service/spec.md": livingSplit,
      [`${FEATURE_REL}/specs/payment-split-service/spec.md`]: `# delta for FEAT-1

## REMOVED Requirements

### Requirement: Legacy split behaviour
Based-On: ${pinFor(livingSplit, "Legacy split behaviour")}

Operations: legacyOp
`,
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      severity: "error",
      code: "openapi.remove-marker-missing",
      subject: "payment-split-service",
    });
  });
});

describe("explicit OpenAPI operation removal lifecycle", () => {
  const livingSpec = `# payment-service

## Requirements

### Requirement: Legacy authorization
The service SHALL authorize with the legacy flow.

Operations: legacyOp

#### Scenario: Legacy
- **Given** a request
- **When** it runs
- **Then** it completes
`;
  const removedSpec = `# delta

## REMOVED Requirements

### Requirement: Legacy authorization
Based-On: ${pinFor(livingSpec, "Legacy authorization")}

Operations: legacyOp
`;
  const livingApi = `openapi: 3.1.0
paths:
  /legacy:
    post:
      operationId: legacyOp
      responses: { "200": { description: ok } }
`;
  const removalApi = `openapi: 3.1.0
paths:
  /legacy:
    post:
      operationId: legacyOp
      x-loam-remove: true
`;

  const removalFiles = (): Record<string, string> => ({
    "services/payment-service/spec.md": livingSpec,
    "services/payment-service/openapi.yaml": livingApi,
    [`${FEATURE_REL}/specs/payment-service/spec.md`]: removedSpec,
    [`${FEATURE_REL}/specs/payment-service/openapi.yaml`]: removalApi,
  });

  it("accepts an exact marker justified by the REMOVED requirement", async () => {
    expect(await coherenceOf(removalFiles())).toEqual([]);
  });

  it("gates a marker whose path+method target is absent", async () => {
    const files = removalFiles();
    files[`${FEATURE_REL}/specs/payment-service/openapi.yaml`] = removalApi.replace("/legacy:", "/missing:");
    const issues = await coherenceOf(files);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ severity: "error", code: "openapi.remove-target-missing" });
    expect(gatesArchive(issues[0]!)).toBe(true);
  });

  it("gates a marker whose operationId does not match the living slot", async () => {
    const files = removalFiles();
    files["services/payment-service/openapi.yaml"] = livingApi.replace("operationId: legacyOp", "operationId: anotherOp");
    const issues = await coherenceOf(files);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ severity: "error", code: "openapi.remove-target-mismatch" });
  });

  it("gates a marker with no REMOVED requirement justification", async () => {
    const files = removalFiles();
    delete files[`${FEATURE_REL}/specs/payment-service/spec.md`];
    const issues = await coherenceOf(files);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ severity: "error", code: "openapi.remove-marker-unjustified" });
  });

  it("rejects a new tagged edge that consumes an operation removed by the same feature", async () => {
    const files = removalFiles();
    files[`${FEATURE_REL}/delta.likec4`] = delta(`  client = softwareSystem 'client'
  payment = softwareSystem 'payment-service'
  client -> payment 'Calls legacy' {
    #FEAT-1
    metadata { op 'legacyOp' }
  }`);
    const issues = await coherenceOf(files);
    expect(issues.map((i) => i.code)).toContain("c4-api.op-removing");
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
    // Two issues, and the second one is the point of the reversal: the feature's
    // spec delta governs createSplit under payment-split-service, but the edge now
    // targets payment-service. `c4.op-ungoverned` joins per service, so it fires
    // here — an operationId governed in one contract says nothing about another's.
    expect(issues).toHaveLength(2);
    expect(warns(issues).map((i) => i.code)).toEqual(["c4.op-ungoverned"]);
    const errs = errors(issues);
    expect(errs).toHaveLength(1);
    expect(errs[0]!.code).toBe("c4-api.op-undefined");
    expect(errs[0]!.message).toContain("createSplit");
    expect(errs[0]!.message).toContain("payment-service");
    expect(errs[0]!.message).toContain("contract");
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

  it("a declared target that resolves outside the docs repo is graded as absent, its files unread", async () => {
    // `metadata { service '../../outside-svc' }` parses in LikeC4 without one
    // error, and before the enumeration bridge featureCoherence joined it
    // straight into `services/<target>/`: the living-spec and openapi probes
    // landed OUTSIDE the docs repo, and whatever sat there graded the edge —
    // a governing requirement silenced c4.op-ungoverned, a defined operation
    // silenced c4-api.op-undefined. The bound element is deliberately
    // untagged, so c4.service-binding-invalid stays out of the picture and
    // the only guard in play is the target resolution itself.
    const traversal = delta(`  a = softwareSystem 'caller-svc'
  b = softwareSystem 'outside' {
    metadata { service '../../outside-svc' }
  }
  a -> b 'Calls hiddenOp' {
    #FEAT-1
    metadata { op 'hiddenOp' }
  }`);
    // Built via makeProject directly (the outside files must land above the
    // docs repo), so the intent default coherenceOf injects is restated here.
    const p = await makeProject({
      [`${FEATURE_REL}/delta.likec4`]: traversal,
      [`${FEATURE_REL}/intent.md`]: intentProse(),
    });
    try {
      // A spec governing hiddenOp and an openapi defining it, one level ABOVE
      // the docs repo — exactly where join(docsDir, "services",
      // "../../outside-svc") lands. If loam reads either file, the edge grades
      // coherent and this test fails.
      await writeFiles(join(p.docsDir, ".."), {
        "outside-svc/spec.md": specDelta("hiddenOp"),
        "outside-svc/openapi.yaml": openapiWith("hiddenOp"),
      });
      const issues = await featureCoherence({ docsDir: p.docsDir, featureDir: join(p.docsDir, FEATURE_REL), featureId: "FEAT-1" });
      expect(issues.map((i) => i.code).sort()).toEqual(["c4-api.op-undefined", "c4.op-ungoverned"]);
      // The findings still speak in the document's own words — resolution
      // failing must not rename what the author wrote.
      expect(errors(issues)[0]!.message).toContain("../../outside-svc");
    } finally {
      await p.destroy();
    }

    // The control: the same edge aimed at a service that simply does not
    // exist. A traversal name must be indistinguishable from an absent one.
    const ghost = await coherenceOf({
      [`${FEATURE_REL}/delta.likec4`]: delta(`  a = softwareSystem 'caller-svc'
  b = softwareSystem 'outside' {
    metadata { service 'ghost-svc' }
  }
  a -> b 'Calls hiddenOp' {
    #FEAT-1
    metadata { op 'hiddenOp' }
  }`),
    });
    expect(ghost.map((i) => i.code).sort()).toEqual(["c4-api.op-undefined", "c4.op-ungoverned"]);
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
/* Pending ops: defined by another feature in flight                   */
/* ------------------------------------------------------------------ */

describe("pending ops: op missing here but defined by another ACTIVE feature's openapi delta", () => {
  const OTHER_REL = "features/FEAT-2-other";

  it("E2 downgrades to c4-api.op-pending naming the in-flight feature", async () => {
    // Feature A calling an op that in-flight feature B introduces is the normal
    // shape of cross-service work — an ordering dependency, not a broken contract
    // (cf. delta.modified-pending on the requirements axis).
    const issues = await coherenceOf({
      [`${FEATURE_REL}/delta.likec4`]: delta(`  a = softwareSystem 'caller-svc'
  b = softwareSystem 'provider-svc'
  a -> b 'Calls sharedOp' {
    #FEAT-1
    metadata { op 'sharedOp' }
  }`),
      [`${OTHER_REL}/specs/provider-svc/openapi.yaml`]: openapiWith("sharedOp"),
    });
    expect(errors(issues)).toEqual([]);
    const pending = warns(issues).filter((i) => i.code === "c4-api.op-pending");
    expect(pending).toHaveLength(1);
    expect(pending[0]!.message).toContain("sharedOp");
    expect(pending[0]!.message).toContain("FEAT-2");
    expect(pending[0]!.message).toContain("archive");
  });

  it("E1 downgrades to spec-api.op-pending naming the in-flight feature", async () => {
    const issues = await coherenceOf({
      [`${FEATURE_REL}/specs/provider-svc/spec.md`]: specDelta("sharedOp"),
      [`${OTHER_REL}/specs/provider-svc/openapi.yaml`]: openapiWith("sharedOp"),
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]!.severity).toBe("warn");
    expect(issues[0]!.code).toBe("spec-api.op-pending");
    expect(issues[0]!.message).toContain("sharedOp");
    expect(issues[0]!.message).toContain("FEAT-2");
  });

  it("another feature's delta for a DIFFERENT service does not downgrade — the contract is per-provider", async () => {
    // FEAT-2 defining sharedOp on unrelated-svc will never put it into
    // provider-svc's OpenAPI, so provider-svc's contract stays broken.
    const issues = await coherenceOf({
      [`${FEATURE_REL}/specs/provider-svc/spec.md`]: specDelta("sharedOp"),
      [`${OTHER_REL}/specs/unrelated-svc/openapi.yaml`]: openapiWith("sharedOp"),
    });
    expect(errors(issues)).toHaveLength(1);
    expect(errors(issues)[0]!.code).toBe("spec-api.op-undefined");
  });

  it("an ARCHIVED feature's delta does not downgrade — its ops are living or gone, not pending", async () => {
    const issues = await coherenceOf({
      [`${FEATURE_REL}/specs/provider-svc/spec.md`]: specDelta("sharedOp"),
      [`features/archive/FEAT-2-other/specs/provider-svc/openapi.yaml`]: openapiWith("sharedOp"),
    });
    expect(errors(issues)).toHaveLength(1);
    expect(errors(issues)[0]!.code).toBe("spec-api.op-undefined");
  });

  it("this feature's OWN delta for another service never counts as 'in flight'", async () => {
    // Same fixture as the E1 cross-service pin above: the op lives in FEAT-1's
    // delta for provider-svc, but consumer-svc's requirement still hard-fails —
    // the downgrade applies only ACROSS features.
    const issues = await coherenceOf({
      [`${FEATURE_REL}/specs/consumer-svc/spec.md`]: specDelta("sharedOp"),
      [`${FEATURE_REL}/specs/provider-svc/openapi.yaml`]: openapiWith("sharedOp"),
    });
    expect(errors(issues)).toHaveLength(1);
    expect(errors(issues)[0]!.code).toBe("spec-api.op-undefined");
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
    // by a requirement" — not "by a requirement restated inside this feature". A warning
    // here would be a false positive, noise in every validate run.
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
    // every restating feature drowns validate in noise for correct authoring.
    const files = coherentFixture();
    // Pinned, as `loam rebase` would leave it: a restatement is a QUOTE, and a
    // quote is silent. Unpinned it draws `openapi.baseline-missing` instead,
    // which has its own tests.
    files[`${FEATURE_REL}/specs/payment-service/openapi.yaml`] = pinOpenapi(LIVING_OPENAPI, LIVING_OPENAPI);
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
/* c4.service-binding-invalid: an explicit binding must be a legal id  */
/* ------------------------------------------------------------------ */

describe("c4.service-binding-invalid: a tagged element's explicit binding must be a legal service id", () => {
  it("metadata { service '../outside-svc' } is an ERROR that gates archive", async () => {
    // The hole this pins: the binding parsed cleanly in LikeC4, W3 was the only
    // voice (a warn), and archive spliced '../outside-svc' into the living
    // landscape while its services/ probe collapsed out of the docs repo.
    const issues = await coherenceOf({
      [`${FEATURE_REL}/delta.likec4`]: delta(`  outside = softwareSystem 'Outside Payments' {
    #FEAT-1
    metadata { service '../outside-svc' }
  }`),
    });
    const invalid = issues.filter((i) => i.code === "c4.service-binding-invalid");
    expect(invalid).toHaveLength(1);
    expect(invalid[0]!.severity).toBe("error");
    expect(invalid[0]!.subject).toBe("../outside-svc");
    expect(invalid[0]!.message).toContain("metadata { service } binding");
    expect(invalid[0]!.message).toContain("splice");
    expect(gatesArchive(invalid[0]!)).toBe(true);
  });

  it("an untagged child riding inside a tagged element's block is held to the same grammar", async () => {
    // The bypass this pins: the landscape merge splices a tagged element's
    // authored block byte for byte, children included (landscape-merge.ts's
    // rides() exists exactly so a child travels inside its parent's text), so
    // an untagged container's binding reaches the living map as surely as its
    // tagged parent's — and the check used to read only the tagged elements
    // themselves.
    const issues = await coherenceOf({
      [`${FEATURE_REL}/delta.likec4`]: delta(`  outside = softwareSystem 'Outside Payments' {
    #FEAT-1
    worker = container 'Worker' {
      metadata { service '../outside-svc' }
    }
  }`),
    });
    const invalid = issues.filter((i) => i.code === "c4.service-binding-invalid");
    expect(invalid).toHaveLength(1);
    expect(invalid[0]!.severity).toBe("error");
    expect(invalid[0]!.subject).toBe("../outside-svc");
    expect(gatesArchive(invalid[0]!)).toBe(true);
  });

  it("a prose TITLE that is not a legal id, with no binding, stays legal C4", async () => {
    // Explicit bindings only, by design: a title becomes a path only through
    // specs/<svc>/, and delta.service-id-invalid guards that route. Parsing
    // titles here would make ordinary diagram prose an error.
    const issues = await coherenceOf({
      [`${FEATURE_REL}/delta.likec4`]: delta(`  gateway = softwareSystem 'Payment Gateway' {
    #FEAT-1
  }`),
    });
    expect(issues.filter((i) => i.code === "c4.service-binding-invalid")).toEqual([]);
    // W3 still speaks — the new service has no requirement delta — but as the
    // warn it always was, never an error.
    expect(errors(issues)).toEqual([]);
  });

  it("loam validate --feature carries the finding and exits 1", async () => {
    const p = await makeProject({
      "services/payment-service/spec.md": LIVING_SPEC,
      "services/payment-service/openapi.yaml": LIVING_OPENAPI,
      [`${FEATURE_REL}/intent.md`]: "---\nfeature: FEAT-1\nstatus: proposed\n---\n\n# Outside\n",
      [`${FEATURE_REL}/delta.likec4`]: delta(`  outside = softwareSystem 'Outside Payments' {
    #FEAT-1
    metadata { service '../outside-svc' }
  }`),
    });
    try {
      const res = await runLoam(p.workDir, "validate", "--feature", "FEAT-1", "--json");
      expect(res.code).toBe(1);
      const findings = (JSON.parse(res.stdout).targets as Array<{ findings: Array<{ code: string; severity: string; gates?: boolean }> }>)
        .flatMap((t) => t.findings)
        .filter((f) => f.code === "c4.service-binding-invalid");
      expect(findings).toHaveLength(1);
      expect(findings[0]!.severity).toBe("error");
      expect(findings[0]!.gates).toBe(true);
    } finally {
      await p.destroy();
    }
  });
});

/* ------------------------------------------------------------------ */
/* scaffold.placeholder: the same splice scope, on the other check     */
/* ------------------------------------------------------------------ */

describe("scaffold.placeholder: a scaffolded description on an untagged child rides in with its tagged parent", () => {
  /**
   * FEATURE_DELTA with one extra container nested inside the tagged
   * payment-split-service block, carrying `description`. Built from the
   * canonical delta rather than from `delta()` so the rest of the coherent
   * fixture still joins on it — the edge, the requirement and the contract all
   * stay in agreement, and the description is the only thing under test.
   */
  const withNestedChild = (description: string): string =>
    FEATURE_DELTA.replace("  element softwareSystem\n", "  element softwareSystem\n  element container\n").replace(
      "    description 'Splits a payment across payees'\n",
      `    description 'Splits a payment across payees'\n    ledger = container 'Ledger writer' {\n      description '${description}'\n    }\n`,
    );

  /**
   * The coherent fixture, its delta carrying that nested child — and its LIVING
   * landscape taught the `container` kind.
   *
   * That second edit is not cosmetic: without it the merged landscape does not
   * parse and `archive` refuses with `merge-failed` instead. Which is itself the
   * proof that the splice really does carry the untagged child over — a child
   * the merge left behind could not have broken the living specification block.
   */
  const nestedFixture = (description: string): Record<string, string> => ({
    ...coherentFixture(),
    "architecture/landscape.likec4": LANDSCAPE.replace(
      "  element softwareSystem\n",
      "  element softwareSystem\n  element container\n",
    ),
    [`${FEATURE_REL}/delta.likec4`]: withNestedChild(description),
  });

  it("the untagged child's TODO description is a gating scaffold.placeholder", async () => {
    // The bypass this pins: the gate read the TAGGED elements only, so a
    // scaffolded description one level down was invisible to it while the
    // landscape merge spliced the parent's block over byte for byte, children
    // included — `TODO — what this service owns` reached the living fleet map
    // verbatim at exit 0. c4.service-binding-invalid learned the same lesson on
    // the same nesting (see the describe above); this is the other check that
    // reads elements and had the narrower scope.
    const issues = await coherenceOf(nestedFixture(SERVICE_DESCRIPTION_SENTINEL));
    const placeholders = issues.filter((i) => i.code === "scaffold.placeholder");
    expect(placeholders).toHaveLength(1);
    expect(placeholders[0]!.severity).toBe("warn");
    expect(gatesArchive(placeholders[0]!)).toBe(true);
    // The finding names the child, not the tagged parent: the reader has to be
    // sent to the block they actually have to edit.
    expect(placeholders[0]!.message).toContain("Ledger writer");
    expect(placeholders[0]!.message).toContain(SERVICE_DESCRIPTION_SENTINEL);
  });

  it("control: a real description on the same child is silent, and the fixture stays coherent", async () => {
    // Same delta, same nesting, one authored sentence — so the finding above is
    // the scaffolded STRING being refused and not the nested container itself
    // upsetting some other axis.
    const issues = await coherenceOf(nestedFixture("Writes the per-payee shares to the ledger"));
    expect(issues).toEqual([]);
  });

  it("loam archive refuses it, and not one byte of the docs repo moves", async () => {
    const p = await makeProject(nestedFixture(SERVICE_DESCRIPTION_SENTINEL));
    try {
      const before = await treeHashes(p.docsDir);
      const blocked = await runLoam(p.workDir, "archive", "FEAT-1", "--json");
      expect(blocked.code).toBe(1);
      const refusal = JSON.parse(blocked.stdout + blocked.stderr) as {
        error: { code: string };
        issues: Array<{ code: string; gates: boolean }>;
      };
      expect(refusal.error.code).toBe("not-coherent");
      expect(refusal.issues).toContainEqual(
        expect.objectContaining({ code: "scaffold.placeholder", gates: true }),
      );
      // The defect class this repo cares most about: a refusal that already
      // half-merged. The living landscape must not have grown the element, the
      // feature must still be in flight, and the tree hash says both at once.
      expect(await treeHashes(p.docsDir)).toEqual(before);
      expect(p.exists("features/archive/FEAT-1-split")).toBe(false);
      expect(await p.read("architecture/landscape.likec4")).not.toContain(
        SERVICE_DESCRIPTION_SENTINEL,
      );
    } finally {
      await p.destroy();
    }
  });

  it("control: the same archive goes through once the child says something", async () => {
    const p = await makeProject(nestedFixture("Writes the per-payee shares to the ledger"));
    try {
      const shipped = await runLoam(p.workDir, "archive", "FEAT-1", "--json");
      expect(shipped.code).toBe(0);
      expect(p.exists("features/archive/FEAT-1-split/delta.likec4")).toBe(true);
      // And the authored sentence is what reached the fleet map — the same
      // route the sentinel would have taken had the gate stayed tag-scoped.
      expect(await p.read("architecture/landscape.likec4")).toContain(
        "Writes the per-payee shares to the ledger",
      );
    } finally {
      await p.destroy();
    }
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
    // The intent carries a prose sentence: a heading-only intent.md now draws
    // the gating `intent.empty` warn, which would hide what this test pins —
    // that the three coherence axes themselves have nothing to say here.
    const issues = await coherenceOf({
      [`${FEATURE_REL}/intent.md`]: intentProse(),
    });
    expect(issues).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* Tag scoping                                                         */
/* ------------------------------------------------------------------ */

describe("tag scoping: only #<featureId>-tagged model parts are checked", () => {
  it("delta with content but ZERO feature tags errors: untagged changes are invisible to loam", async () => {
    // Formerly pinned as [] per SCHEMA.md ("untagged parts are context, not delta") —
    // but a delta whose author forgot EVERY tag passes each per-part rule and archives
    // while merging nothing, the single most likely LLM authoring slip. The per-part
    // rules still skip untagged content; the whole-file check names the trap instead.
    const issues = await coherenceOf({
      [`${FEATURE_REL}/delta.likec4`]: delta(`  a = softwareSystem 'svc-a'
  b = softwareSystem 'svc-b'
  a -> b 'Calls ghostOp' {
    metadata { op 'ghostOp' }
  }`),
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]!.severity).toBe("error");
    expect(issues[0]!.code).toBe("delta.nothing-tagged");
    expect(issues[0]!.message).toContain("#FEAT-1");
  });

  it("delta tagged ONLY with a different feature id has nothing for THIS feature — same error", async () => {
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
    // The FEAT-2 parts stay invisible to every per-part rule (no op errors) —
    // the only finding is the whole-file one.
    expect(issues).toHaveLength(1);
    expect(issues[0]!.code).toBe("delta.nothing-tagged");
    expect(issues[0]!.message).not.toContain("ghostOp");
  });

  it("once at least one part is tagged, untagged parts stay invisible and nothing-tagged stays silent", async () => {
    // Partial tagging is out of scope by decision: flagging "this untagged edge
    // looks intended" would be guessing. The tagged container keeps W3 out
    // (not a softwareSystem); the untagged bogus edge is invisible to E2.
    const issues = await coherenceOf({
      [`${FEATURE_REL}/delta.likec4`]: delta(`  sys = softwareSystem 'host-svc' {
    comp = container 'new-comp' {
      #FEAT-1
    }
  }
  a = softwareSystem 'svc-a'
  sys -> a 'Calls ghostOp' {
    metadata { op 'ghostOp' }
  }`),
    });
    expect(issues).toEqual([]);
  });

  it("a delta declaring no elements and no relationships does not fire nothing-tagged", async () => {
    const issues = await coherenceOf({
      [`${FEATURE_REL}/delta.likec4`]: delta(""),
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

/* ------------------------------------------------------------------ */
/* Lifecycle: new consumption of a deprecated living operation         */
/* ------------------------------------------------------------------ */

describe("c4-api.op-deprecated: a NEW tagged edge on an op the living provider marks deprecated", () => {
  /** The living contract, its one operation marked `deprecated: true`. */
  const DEPRECATED_LIVING = LIVING_OPENAPI.replace(
    "      operationId: authorizePayment\n",
    "      operationId: authorizePayment\n      deprecated: true\n",
  );

  /** A delta whose one tagged edge consumes authorizePayment. */
  const CONSUMING_DELTA = delta(`  checkoutWeb = softwareSystem 'checkout-web'
  paymentService = softwareSystem 'payment-service'

  checkoutWeb -> paymentService 'Calls authorizePayment' {
    #FEAT-1
    metadata { op 'authorizePayment' }
  }`);

  function consumingFixture(livingOpenapi: string): Record<string, string> {
    return {
      "services/payment-service/spec.md": LIVING_SPEC,
      "services/payment-service/openapi.yaml": livingOpenapi,
      [`${FEATURE_REL}/delta.likec4`]: CONSUMING_DELTA,
      // Real intent prose, because the archive test below feeds this fixture to
      // `loam archive` directly: with `intent.empty` gating, a bare fixture
      // would block the merge for a reason unrelated to the deprecation warn
      // whose advisory nature that test exists to demonstrate.
      [`${FEATURE_REL}/intent.md`]: intentProse(),
    };
  }

  it("warns, advisory: severity warn, gates false — building new consumption on a dying op deserves an eye", async () => {
    const issues = await coherenceOf(consumingFixture(DEPRECATED_LIVING));
    expect(issues).toHaveLength(1);
    const dep = issues[0]!;
    expect(dep.code).toBe("c4-api.op-deprecated");
    expect(dep.severity).toBe("warn");
    expect(gatesArchive(dep)).toBe(false);
    expect(dep.message).toContain("authorizePayment");
    expect(dep.message).toContain("deprecated");
  });

  it("control: the same edge on a live op raises nothing", async () => {
    expect(await coherenceOf(consumingFixture(LIVING_OPENAPI))).toEqual([]);
  });

  it("stays quiet when the feature's own openapi delta restates the op WITHOUT the flag — that feature IS the un-deprecation", async () => {
    // After archive, the wholesale path-item overwrite drops `deprecated: true`
    // and the whole warning family stops; telling this author to "prefer the
    // replacement operation" would point them away from the exact change they
    // are shipping.
    const files = consumingFixture(DEPRECATED_LIVING);
    // Pinned against the DEPRECATED living contract, which is what this delta
    // was written from — so dropping the flag reads as the edit it is, not as a
    // quote the merge would skip.
    files[`${FEATURE_REL}/specs/payment-service/openapi.yaml`] = pinOpenapi(LIVING_OPENAPI, DEPRECATED_LIVING);
    expect(await coherenceOf(files)).toEqual([]);
  });

  it("still warns when the feature's openapi delta restates the op deprecated — restating the flag is not retiring it", async () => {
    const files = consumingFixture(DEPRECATED_LIVING);
    files[`${FEATURE_REL}/specs/payment-service/openapi.yaml`] = DEPRECATED_LIVING;
    const issues = await coherenceOf(files);
    expect(issues.map((i) => i.code)).toContain("c4-api.op-deprecated");
  });

  it("never gates archive: the merge proceeds with the warning printed as non-blocking", async () => {
    const p = await makeProject(consumingFixture(DEPRECATED_LIVING));
    try {
      const res = await runLoam(p.workDir, "archive", "FEAT-1");
      expect(res.code).toBe(0);
      expect(res.out).toContain("warning(s) (non-blocking)");
      expect(res.out).toContain("deprecated");
      expect(res.out).not.toContain("BLOCKED");
      expect(p.exists("features/archive/FEAT-1-split/delta.likec4")).toBe(true);
    } finally {
      await p.destroy();
    }
  });
});
