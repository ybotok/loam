/**
 * Deep invariant tests for `loam archive` (src/commands/archive.ts).
 *
 * archive MUTATES the living docs (spec.md / openapi.yaml / landscape.likec4),
 * so these tests are adversarial: they assert the DESIRED merge invariants
 * (SCHEMA.md + command docstrings), not whatever the implementation happens to
 * do. Every deliberately-failing test corresponds to a suspected frame bug
 * documented in the workflow report.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { join } from "node:path";
import { parse } from "yaml";
import { loadFile, type LoadedDoc } from "../src/core/likec4.js";
import { parseRequirements } from "../src/core/spec.js";
import {
  coherentFixture,
  makeProject,
  runLoam,
  LANDSCAPE,
  LIVING_SPEC,
  LIVING_OPENAPI,
  FEATURE_DELTA,
  FEATURE_SPEC,
  type Project,
  type RunResult,
} from "./helpers/harness.js";

const LANDSCAPE_REL = "architecture/landscape.likec4";

/** runLoam, but a command that throws mid-merge is reported instead of failing the harness. */
async function runLoamSafe(
  cwd: string,
  ...args: string[]
): Promise<{ res: RunResult | null; crashed: boolean; error?: unknown }> {
  try {
    return { res: await runLoam(cwd, ...args), crashed: false };
  } catch (error) {
    return { res: null, crashed: true, error };
  }
}

function landscapePath(p: Project): string {
  return join(p.docsDir, LANDSCAPE_REL);
}

function titleOf(doc: LoadedDoc, id: string): string {
  return doc.elements.find((e) => e.id === id)?.title ?? id;
}

function elementsTitled(doc: LoadedDoc, title: string) {
  return doc.elements.filter((e) => e.title === title);
}

function edgesBetween(doc: LoadedDoc, srcTitle: string, tgtTitle: string, op?: string) {
  return doc.relationships.filter(
    (r) =>
      titleOf(doc, r.source) === srcTitle &&
      titleOf(doc, r.target) === tgtTitle &&
      (op === undefined || r.op === op),
  );
}

/* ------------------------------------------------------------------ */
/* Fixture building blocks (derived from the canonical harness shapes) */
/* ------------------------------------------------------------------ */

/** Living spec with TWO requirements so ADDED/MODIFIED/REMOVED can all be exercised. */
const LIVING_SPEC_TWO_REQS = `---
service: payment-service
status: verified
---

# payment-service

Handles all payment flows for the shop.

## Requirements

### Requirement: Authorize a payment
The service SHALL authorize a payment before capture.

Operations: authorizePayment

#### Scenario: Successful authorization
- **Given** a valid card
- **When** authorization is requested
- **Then** the payment is authorized

### Requirement: Legacy settlement quirk
The service SHALL settle captured payments at T+2.

#### Scenario: Settles two days later
- **Given** a captured payment
- **When** two business days pass
- **Then** the payment settles
`;

/** One delta exercising all three kinds against LIVING_SPEC_TWO_REQS. */
const REQ_DELTA_ALL_KINDS = `# payment-service — requirement delta

## ADDED Requirements

### Requirement: Refund a payment
The service SHALL refund an authorized payment on request.

#### Scenario: Refund succeeds
- **Given** a captured payment
- **When** a refund is requested
- **Then** the amount is returned to the customer

## MODIFIED Requirements

### Requirement: Authorize a payment
The service SHALL authorize a payment within 2 seconds.

Operations: authorizePayment

#### Scenario: Fast authorization
- **Given** a valid card
- **When** authorization is requested
- **Then** it completes within 2 seconds

## REMOVED Requirements

### Requirement: Legacy settlement quirk
`;

/** FEAT-3: adds refundPayment to the EXISTING payment-service (edge + requirement + openapi). */
const REFUND_DELTA = `specification {
  element softwareSystem
  tag FEAT-3
}

model {
  checkoutWeb = softwareSystem 'checkout-web'
  paymentService = softwareSystem 'payment-service'

  checkoutWeb -> paymentService 'Calls refundPayment' {
    #FEAT-3
    metadata { op 'refundPayment' }
  }
}

views {
  view feat_3 {
    include *
  }
}
`;

const REFUND_SPEC = `# payment-service — delta for FEAT-3

## ADDED Requirements

### Requirement: Refund a payment
The service SHALL refund a captured payment.

Operations: refundPayment

#### Scenario: Refund succeeds
- **Given** a captured payment
- **When** a refund is requested
- **Then** the amount is returned
`;

const REFUND_OPENAPI_2SPACE = `openapi: 3.1.0
info:
  title: payment-service
  version: "1.0"
paths:
  /payments/refund:
    post:
      operationId: refundPayment
      summary: Refund a payment
      responses:
        "200":
          description: Refunded
`;

/** Same contract, but the author's editor used 4-space YAML indentation. Valid YAML on its own. */
const REFUND_OPENAPI_4SPACE = `openapi: 3.1.0
info:
    title: payment-service
    version: "1.0"
paths:
    /payments/refund:
        post:
            operationId: refundPayment
            summary: Refund a payment
            responses:
                "200":
                    description: Refunded
`;

/** FEAT-4: re-declares a path that ALREADY exists in the living openapi. */
const REDECLARE_DELTA = `specification {
  element softwareSystem
  tag FEAT-4
}

model {
  checkoutWeb = softwareSystem 'checkout-web'
  paymentService = softwareSystem 'payment-service'

  checkoutWeb -> paymentService 'Calls authorizePayment' {
    #FEAT-4
    metadata { op 'authorizePayment' }
  }
}

views {
  view feat_4 {
    include *
  }
}
`;

const REDECLARE_SPEC = `# payment-service — delta for FEAT-4

## ADDED Requirements

### Requirement: Authorize with idempotency key
The service SHALL accept an idempotency key on authorization.

Operations: authorizePayment

#### Scenario: Same key twice
- **Given** an authorization with key K
- **When** it is retried with key K
- **Then** only one authorization exists
`;

const REDECLARE_OPENAPI = `openapi: 3.1.0
info:
  title: payment-service
  version: "1.0"
paths:
  /payments/authorize:
    post:
      operationId: authorizePayment
      summary: Authorize a payment (with idempotency key)
      responses:
        "200":
          description: Authorized
`;

/** FEAT-5a: a new element whose TITLE contains an apostrophe (legal LikeC4 via double quotes). */
const APOSTROPHE_TITLE_DELTA = `specification {
  element softwareSystem
  tag FEAT-5
}

model {
  payeesLedger = softwareSystem "payee's-ledger" {
    #FEAT-5
  }
}

views {
  view feat_5 {
    include *
  }
}
`;

/** FEAT-5b: a new element whose DESCRIPTION contains an apostrophe. */
const APOSTROPHE_DESC_DELTA = `specification {
  element softwareSystem
  tag FEAT-5
}

model {
  ledgerSvc = softwareSystem 'ledger-svc' {
    #FEAT-5
    description "tracks each payee's balance"
  }
}

views {
  view feat_5 {
    include *
  }
}
`;

/** FEAT-6: a new element whose title equals an operationId already quoted in the landscape. */
const OP_COLLISION_DELTA = `specification {
  element softwareSystem
  tag FEAT-6
}

model {
  authSvc = softwareSystem 'authorizePayment' {
    #FEAT-6
  }
}

views {
  view feat_6 {
    include *
  }
}
`;

/** FEAT-9: warning-only coherence — adds an operation no architecture edge consumes. */
const WARN_ONLY_DELTA = `specification {
  element softwareSystem
  tag FEAT-9
}

model {
  paymentSplitService = softwareSystem 'payment-split-service' {
    #FEAT-9
    description 'Splits a payment across payees'
  }
}

views {
  view feat_9 {
    include *
  }
}
`;

/* ================================================================== */

describe("happy path on coherentFixture", () => {
  let p: Project;
  let res: RunResult;
  let land: LoadedDoc;
  let landText: string;

  beforeAll(async () => {
    p = await makeProject(coherentFixture(), { service: "payment-service" });
    res = await runLoam(p.workDir, "archive", "FEAT-1");
    landText = await p.read(LANDSCAPE_REL);
    land = await loadFile(landscapePath(p));
  });
  afterAll(async () => {
    await p.destroy();
  });

  it("exits 0 and reports all three merge axes plus the archive move", () => {
    expect(res.code).toBe(0);
    expect(res.out).toContain("archive FEAT-1");
    expect(res.out).toContain("created living spec");
    expect(res.out).toContain("openapi: payment-split-service — created");
    expect(res.out).toContain("merged into landscape.likec4");
    expect(res.out).toContain("archived: features/FEAT-1-split");
  });

  it("moves the feature dir to features/archive/FEAT-1-split and removes the original", () => {
    expect(p.exists("features/FEAT-1-split")).toBe(false);
    expect(p.exists("features/archive/FEAT-1-split/delta.likec4")).toBe(true);
    expect(p.exists("features/archive/FEAT-1-split/intent.md")).toBe(true);
    expect(p.exists("features/archive/FEAT-1-split/specs/payment-split-service/spec.md")).toBe(true);
  });

  it("creates the new service's living spec with the requirement as BASE (scenario + operations intact)", async () => {
    const text = await p.read("services/payment-split-service/spec.md");
    expect(text).toContain("service: payment-split-service");
    const reqs = parseRequirements(text);
    expect(reqs).toHaveLength(1);
    const r = reqs[0]!;
    expect(r.kind).toBe("BASE");
    expect(r.name).toBe("Split a payment");
    expect(r.operations).toEqual(["createSplit"]);
    expect(r.scenarios).toHaveLength(1);
    expect(r.scenarios[0]!.name).toBe("Split across two payees");
  });

  it("creates the new service's living openapi, yaml-parseable, defining createSplit", async () => {
    const text = await p.read("services/payment-split-service/openapi.yaml");
    let doc: Record<string, any> | undefined;
    expect(() => {
      doc = parse(text);
    }).not.toThrow();
    expect(doc!.paths["/splits"].post.operationId).toBe("createSplit");
  });

  it("merged landscape parses with 0 errors and contains the new element with its description", () => {
    expect(land.errors).toEqual([]);
    const els = elementsTitled(land, "payment-split-service");
    expect(els).toHaveLength(1);
    expect(els[0]!.description).toBe("Splits a payment across payees");
  });

  it("merged landscape edge preserves the operationId spine (metadata op survives the merge)", () => {
    const edges = edgesBetween(land, "payment-service", "payment-split-service", "createSplit");
    expect(edges).toHaveLength(1);
    expect(edges[0]!.title).toBe("Calls createSplit");
  });

  it("pre-existing landscape content (customer, checkout-web, views block, old edge) is byte-preserved around the insertion", () => {
    // insertIntoModelBlock inserts just before the model block's closing brace —
    // everything before and after that point must be untouched.
    const close = LANDSCAPE.indexOf("\n}\n\nviews") + 1;
    expect(close).toBeGreaterThan(0);
    expect(landText.startsWith(LANDSCAPE.slice(0, close))).toBe(true);
    expect(landText.endsWith(LANDSCAPE.slice(close))).toBe(true);
    expect(edgesBetween(land, "Customer", "checkout-web")).toHaveLength(1);
    expect(edgesBetween(land, "checkout-web", "payment-service", "authorizePayment")).toHaveLength(1);
  });

  it("feature tags are dropped from the merged landscape (additions become baseline)", () => {
    expect(landText).not.toContain("#FEAT-1");
    const el = elementsTitled(land, "payment-split-service")[0]!;
    expect(el.tags).not.toContain("FEAT-1");
  });

  it("loam validate --service payment-service still passes after the archive (post-archive coherence)", async () => {
    const v = await runLoam(p.workDir, "validate", "--service", "payment-service");
    expect(v.out).toContain("payment-service");
    expect(v.code).toBe(0);
  });
});

describe("second feature re-declaring the same element and edge", () => {
  let p: Project;
  let run1: RunResult;
  let run2: RunResult;
  let land: LoadedDoc;

  beforeAll(async () => {
    p = await makeProject(coherentFixture());
    run1 = await runLoam(p.workDir, "archive", "FEAT-1");
    // FEAT-2 re-declares the same element + edge (no openapi delta: the living
    // openapi created by FEAT-1 already provides createSplit, so it is coherent).
    await p.write("features/FEAT-2-redo/delta.likec4", FEATURE_DELTA.replaceAll("FEAT-1", "FEAT-2"));
    await p.write("features/FEAT-2-redo/specs/payment-split-service/spec.md", FEATURE_SPEC);
    run2 = await runLoam(p.workDir, "archive", "FEAT-2");
    land = await loadFile(landscapePath(p));
  });
  afterAll(async () => {
    await p.destroy();
  });

  it("both archives succeed", () => {
    expect(run1.code).toBe(0);
    expect(run2.code).toBe(0);
  });

  it("re-declared element is not duplicated in the landscape, which still parses", () => {
    expect(land.errors).toEqual([]);
    expect(elementsTitled(land, "payment-split-service")).toHaveLength(1);
  });

  it("re-declared relationship is not duplicated in the landscape (edge merge is idempotent like elements)", () => {
    expect(land.errors).toEqual([]);
    expect(
      edgesBetween(land, "payment-service", "payment-split-service", "createSplit"),
      "archiving a second feature that re-declares an existing op edge must not produce a duplicate edge",
    ).toHaveLength(1);
  });
});

describe("requirements merge into an existing living spec", () => {
  let p: Project;
  let res: RunResult;
  let mergedText: string;

  beforeAll(async () => {
    p = await makeProject({
      "services/payment-service/spec.md": LIVING_SPEC_TWO_REQS,
      "services/payment-service/openapi.yaml": LIVING_OPENAPI,
      "features/FEAT-7-rework/specs/payment-service/spec.md": REQ_DELTA_ALL_KINDS,
    });
    res = await runLoam(p.workDir, "archive", "FEAT-7");
    mergedText = await p.read("services/payment-service/spec.md");
  });
  afterAll(async () => {
    await p.destroy();
  });

  it("ADDED appends, MODIFIED replaces same-named content, REMOVED deletes", () => {
    expect(res.code).toBe(0);
    const reqs = parseRequirements(mergedText);
    expect(reqs.map((r) => r.name)).toEqual(["Authorize a payment", "Refund a payment"]);
    const auth = reqs[0]!;
    expect(auth.text.join("\n")).toContain("within 2 seconds");
    expect(auth.text.join("\n")).not.toContain("before capture");
    expect(auth.scenarios.map((s) => s.name)).toEqual(["Fast authorization"]);
    const refund = reqs[1]!;
    expect(refund.scenarios).toHaveLength(1);
    expect(mergedText).not.toContain("Legacy settlement quirk");
  });

  it("intro + frontmatter of the living spec are preserved byte-for-byte above '## Requirements'", () => {
    const introPrefix = LIVING_SPEC_TWO_REQS.slice(0, LIVING_SPEC_TWO_REQS.indexOf("### Requirement:"));
    expect(introPrefix).toContain("status: verified");
    expect(mergedText.startsWith(introPrefix)).toBe(true);
  });

  it("delta headings are gone: every merged requirement is BASE and no ADDED/MODIFIED/REMOVED heading remains", () => {
    const reqs = parseRequirements(mergedText);
    for (const r of reqs) expect(r.kind).toBe("BASE");
    expect(mergedText).not.toMatch(/^## (ADDED|MODIFIED|REMOVED) Requirements/m);
  });

  it("archiving an identical delta again leaves the living spec byte-identical (content idempotence)", async () => {
    await p.write("features/FEAT-8-rework/specs/payment-service/spec.md", REQ_DELTA_ALL_KINDS);
    const again = await runLoam(p.workDir, "archive", "FEAT-8");
    expect(again.code).toBe(0);
    expect(await p.read("services/payment-service/spec.md")).toBe(mergedText);
  });
});

describe("new-service living spec creation semantics", () => {
  it("a MODIFIED-only delta against a missing living spec creates it (pinned: MODIFIED-against-nothing behaves as ADDED)", async () => {
    const p = await makeProject({
      "features/FEAT-10-ghost/specs/ghost-service/spec.md": `# ghost-service delta

## MODIFIED Requirements

### Requirement: Phantom behaviour
The service SHALL do the phantom thing.

#### Scenario: Phantom happens
- **Given** a trigger
- **When** it fires
- **Then** the phantom thing happens
`,
    });
    try {
      const res = await runLoam(p.workDir, "archive", "FEAT-10");
      expect(res.code).toBe(0);
      expect(p.exists("services/ghost-service/spec.md")).toBe(true);
      const reqs = parseRequirements(await p.read("services/ghost-service/spec.md"));
      expect(reqs).toHaveLength(1);
      expect(reqs[0]!.name).toBe("Phantom behaviour");
      expect(reqs[0]!.kind).toBe("BASE");
    } finally {
      await p.destroy();
    }
  });

  it("a REMOVED-only delta for a service with no living spec does not create an empty living spec", async () => {
    const p = await makeProject({
      "features/FEAT-11-void/specs/void-service/spec.md": `# void-service delta

## REMOVED Requirements

### Requirement: Old thing
`,
    });
    try {
      const res = await runLoam(p.workDir, "archive", "FEAT-11");
      expect(res.code).toBe(0);
      expect(
        p.exists("services/void-service/spec.md"),
        "removing requirements from a service that has no living spec must not fabricate an empty spec file",
      ).toBe(false);
    } finally {
      await p.destroy();
    }
  });
});

describe("openapi merge", () => {
  function refundProject(featureOpenapi: string, livingOpenapi: string = LIVING_OPENAPI) {
    return makeProject({
      "architecture/landscape.likec4": LANDSCAPE,
      "services/payment-service/spec.md": LIVING_SPEC,
      "services/payment-service/openapi.yaml": livingOpenapi,
      "features/FEAT-3-refunds/delta.likec4": REFUND_DELTA,
      "features/FEAT-3-refunds/specs/payment-service/spec.md": REFUND_SPEC,
      "features/FEAT-3-refunds/specs/payment-service/openapi.yaml": featureOpenapi,
    });
  }

  it("a new path merges into the existing living openapi under a single paths key, old and new both reachable", async () => {
    const p = await refundProject(REFUND_OPENAPI_2SPACE);
    try {
      const res = await runLoam(p.workDir, "archive", "FEAT-3");
      expect(res.code).toBe(0);
      const text = await p.read("services/payment-service/openapi.yaml");
      expect(text.split("\n").filter((l) => /^paths:\s*$/.test(l))).toHaveLength(1);
      let doc: Record<string, any> | undefined;
      expect(() => {
        doc = parse(text);
      }).not.toThrow();
      expect(doc!.paths["/payments/authorize"].post.operationId).toBe("authorizePayment");
      expect(doc!.paths["/payments/refund"].post.operationId).toBe("refundPayment");
    } finally {
      await p.destroy();
    }
  });

  it("a living openapi with no paths key gets a paths block appended and still parses", async () => {
    const noPaths = `openapi: 3.1.0\ninfo:\n  title: payment-service\n  version: "1.0"\n`;
    const p = await refundProject(REFUND_OPENAPI_2SPACE, noPaths);
    try {
      const res = await runLoam(p.workDir, "archive", "FEAT-3");
      expect(res.code).toBe(0);
      const text = await p.read("services/payment-service/openapi.yaml");
      let doc: Record<string, any> | undefined;
      expect(() => {
        doc = parse(text);
      }).not.toThrow();
      expect(doc!.paths["/payments/refund"].post.operationId).toBe("refundPayment");
      expect(doc!.info.title).toBe("payment-service");
    } finally {
      await p.destroy();
    }
  });

  it("merging a 4-space-indented feature openapi into a 2-space living openapi still yields parseable yaml with all paths", async () => {
    const p = await refundProject(REFUND_OPENAPI_4SPACE);
    try {
      const res = await runLoam(p.workDir, "archive", "FEAT-3");
      expect(res.code).toBe(0);
      const text = await p.read("services/payment-service/openapi.yaml");
      let doc: Record<string, any> | undefined;
      expect(() => {
        doc = parse(text);
      }, "mixed sibling indentation under paths: must not corrupt the living openapi").not.toThrow();
      expect(doc!.paths["/payments/authorize"].post.operationId).toBe("authorizePayment");
      expect(doc!.paths["/payments/refund"].post.operationId).toBe("refundPayment");
    } finally {
      await p.destroy();
    }
  });

  it("a feature re-declaring a path that already exists in the living openapi never corrupts it (no duplicate yaml keys)", async () => {
    const p = await makeProject({
      "architecture/landscape.likec4": LANDSCAPE,
      "services/payment-service/spec.md": LIVING_SPEC,
      "services/payment-service/openapi.yaml": LIVING_OPENAPI,
      "features/FEAT-4-idem/delta.likec4": REDECLARE_DELTA,
      "features/FEAT-4-idem/specs/payment-service/spec.md": REDECLARE_SPEC,
      "features/FEAT-4-idem/specs/payment-service/openapi.yaml": REDECLARE_OPENAPI,
    });
    try {
      const res = await runLoam(p.workDir, "archive", "FEAT-4");
      expect(res.code).toBe(0);
      const text = await p.read("services/payment-service/openapi.yaml");
      let doc: Record<string, any> | undefined;
      expect(() => {
        doc = parse(text);
      }, "re-declaring an existing path must skip or merge — never emit duplicate top-level path keys").not.toThrow();
      expect(doc!.paths["/payments/authorize"].post.operationId).toBe("authorizePayment");
    } finally {
      await p.destroy();
    }
  });
});

describe("landscape merge adversarial", () => {
  it("merged landscape still parses after archiving an element whose title contains an apostrophe", async () => {
    const p = await makeProject({
      "architecture/landscape.likec4": LANDSCAPE,
      "features/FEAT-5-ledger/delta.likec4": APOSTROPHE_TITLE_DELTA,
    });
    try {
      // --approve: the only coherence issue is the warn that the new service has no spec delta.
      const res = await runLoam(p.workDir, "archive", "FEAT-5", "--approve");
      expect(res.code).toBe(0);
      const land = await loadFile(landscapePath(p));
      expect(land.errors, "apostrophe in a title must be escaped/quoted so the merged landscape stays valid").toEqual([]);
      expect(elementsTitled(land, "payee's-ledger")).toHaveLength(1);
    } finally {
      await p.destroy();
    }
  });

  it("merged landscape still parses after archiving an element whose description contains an apostrophe", async () => {
    const p = await makeProject({
      "architecture/landscape.likec4": LANDSCAPE,
      "features/FEAT-5-ledger/delta.likec4": APOSTROPHE_DESC_DELTA,
    });
    try {
      const res = await runLoam(p.workDir, "archive", "FEAT-5", "--approve");
      expect(res.code).toBe(0);
      const land = await loadFile(landscapePath(p));
      expect(land.errors, "apostrophe in a description must be escaped/quoted so the merged landscape stays valid").toEqual([]);
      const els = elementsTitled(land, "ledger-svc");
      expect(els).toHaveLength(1);
      expect(els[0]!.description).toBe("tracks each payee's balance");
    } finally {
      await p.destroy();
    }
  });

  it("an unbalanced '{' inside a living description string does not derail the model-block scan", async () => {
    const files = coherentFixture();
    files["architecture/landscape.likec4"] = LANDSCAPE.replace(
      "Customer-facing checkout UI",
      "renders {checkout UI",
    );
    const p = await makeProject(files);
    try {
      // Sanity: the adversarial living landscape is valid LikeC4 before the merge.
      expect((await loadFile(landscapePath(p))).errors).toEqual([]);
      const { res, crashed } = await runLoamSafe(p.workDir, "archive", "FEAT-1");
      expect(crashed, "brace counting must ignore braces inside quoted strings — archive must not crash").toBe(false);
      expect(res!.code).toBe(0);
      const land = await loadFile(landscapePath(p));
      expect(land.errors).toEqual([]);
      expect(elementsTitled(land, "payment-split-service")).toHaveLength(1);
    } finally {
      await p.destroy();
    }
  });

  it("balanced braces inside a living description string do not break the merge", async () => {
    const files = coherentFixture();
    files["architecture/landscape.likec4"] = LANDSCAPE.replace(
      "Customer-facing checkout UI",
      "renders {json} payloads",
    );
    const p = await makeProject(files);
    try {
      const res = await runLoam(p.workDir, "archive", "FEAT-1");
      expect(res.code).toBe(0);
      const land = await loadFile(landscapePath(p));
      expect(land.errors).toEqual([]);
      expect(elementsTitled(land, "payment-split-service")).toHaveLength(1);
    } finally {
      await p.destroy();
    }
  });

  it("a new element is still added when its title string already appears as an op string in the landscape", async () => {
    const p = await makeProject({
      "architecture/landscape.likec4": LANDSCAPE,
      "features/FEAT-6-auth/delta.likec4": OP_COLLISION_DELTA,
    });
    try {
      const res = await runLoam(p.workDir, "archive", "FEAT-6", "--approve");
      expect(res.code).toBe(0);
      const land = await loadFile(landscapePath(p));
      expect(land.errors).toEqual([]);
      expect(
        elementsTitled(land, "authorizePayment"),
        "element-existence check must not be fooled by the substring 'authorizePayment' inside metadata op strings",
      ).toHaveLength(1);
    } finally {
      await p.destroy();
    }
  });
});

describe("coherence gate", () => {
  let p: Project;
  let blocked: RunResult;

  beforeAll(async () => {
    const files = coherentFixture();
    // Break the contract: the feature edge + requirement reference createSplit,
    // but no OpenAPI anywhere defines it.
    delete files["features/FEAT-1-split/specs/payment-split-service/openapi.yaml"];
    p = await makeProject(files);
    blocked = await runLoam(p.workDir, "archive", "FEAT-1");
  });
  afterAll(async () => {
    await p.destroy();
  });

  it("refuses an incoherent feature with exit 1 and names the broken contract", () => {
    expect(blocked.code).toBe(1);
    expect(blocked.out).toContain("BLOCKED: not coherent");
    expect(blocked.out).toContain("createSplit");
  });

  it("a blocked archive is side-effect free: living docs byte-identical, feature dir untouched", async () => {
    expect(await p.read("services/payment-service/spec.md")).toBe(LIVING_SPEC);
    expect(await p.read("services/payment-service/openapi.yaml")).toBe(LIVING_OPENAPI);
    expect(await p.read(LANDSCAPE_REL)).toBe(LANDSCAPE);
    expect(p.exists("services/payment-split-service")).toBe(false);
    expect(p.exists("features/FEAT-1-split/delta.likec4")).toBe(true);
    expect(await p.read("features/FEAT-1-split/specs/payment-split-service/spec.md")).toBe(FEATURE_SPEC);
    expect(p.exists("features/archive")).toBe(false);
  });

  it("--approve overrides the gate and archives the incoherent feature", async () => {
    const res = await runLoam(p.workDir, "archive", "FEAT-1", "--approve");
    expect(res.code).toBe(0);
    expect(res.out).toContain("archiving despite");
    expect(p.exists("features/FEAT-1-split")).toBe(false);
    expect(p.exists("features/archive/FEAT-1-split/delta.likec4")).toBe(true);
    expect(p.exists("services/payment-split-service/spec.md")).toBe(true);
  });

  it("warn-only coherence issues block archive while validate --feature passes them (pinned current behavior)", async () => {
    const wp = await makeProject({
      "architecture/landscape.likec4": LANDSCAPE,
      "features/FEAT-9-split/delta.likec4": WARN_ONLY_DELTA,
      "features/FEAT-9-split/specs/payment-split-service/spec.md": FEATURE_SPEC,
      "features/FEAT-9-split/specs/payment-split-service/openapi.yaml": coherentFixture()[
        "features/FEAT-1-split/specs/payment-split-service/openapi.yaml"
      ]!,
    });
    try {
      const v = await runLoam(wp.workDir, "validate", "--feature", "FEAT-9");
      expect(v.code).toBe(0);
      const a = await runLoam(wp.workDir, "archive", "FEAT-9");
      expect(a.code).toBe(1);
      expect(a.out).toContain("BLOCKED");
      expect(a.out).toContain("0 error(s)");
      expect(wp.exists("features/FEAT-9-split/delta.likec4")).toBe(true);
    } finally {
      await wp.destroy();
    }
  });
});

describe("atomicity / crash safety (landscape without a model block)", () => {
  let p: Project;
  let firstRun: { res: RunResult | null; crashed: boolean };

  beforeAll(async () => {
    const files = coherentFixture();
    files["architecture/landscape.likec4"] = "specification {\n  element softwareSystem\n}\n";
    p = await makeProject(files);
    firstRun = await runLoamSafe(p.workDir, "archive", "FEAT-1");
  });
  afterAll(async () => {
    await p.destroy();
  });

  it("archive on a model-less landscape fails gracefully instead of throwing an unhandled exception", () => {
    expect(firstRun.crashed, "a malformed landscape must produce a clean error, not an uncaught throw mid-merge").toBe(false);
  });

  it("a failed archive leaves the living docs untouched (no half-merged state)", () => {
    const failed = firstRun.crashed || (firstRun.res !== null && firstRun.res.code !== 0);
    expect(failed).toBe(true);
    // The feature was not archived...
    expect(p.exists("features/FEAT-1-split/delta.likec4")).toBe(true);
    expect(p.exists("features/archive/FEAT-1-split")).toBe(false);
    // ...so the living docs must not have absorbed half the merge either.
    expect(
      p.exists("services/payment-split-service/spec.md"),
      "requirements were merged although the archive failed — half-merged living state",
    ).toBe(false);
    expect(
      p.exists("services/payment-split-service/openapi.yaml"),
      "openapi was merged although the archive failed — half-merged living state",
    ).toBe(false);
  });

  it("re-running archive after a mid-merge crash does not corrupt the living openapi", async () => {
    await runLoamSafe(p.workDir, "archive", "FEAT-1");
    if (p.exists("services/payment-split-service/openapi.yaml")) {
      const text = await p.read("services/payment-split-service/openapi.yaml");
      expect(() => {
        parse(text);
      }, "a re-run must be idempotent — it must not stack duplicate path keys into the living openapi").not.toThrow();
    }
  });
});

describe("missing pieces", () => {
  it("without a landscape.likec4 the requirements + openapi still merge and the feature is archived (arch delta dropped with a notice)", async () => {
    const files = coherentFixture();
    delete files["architecture/landscape.likec4"];
    const p = await makeProject(files);
    try {
      const res = await runLoam(p.workDir, "archive", "FEAT-1");
      expect(res.code).toBe(0);
      expect(res.out).toContain("no landscape.likec4");
      expect(p.exists("services/payment-split-service/spec.md")).toBe(true);
      expect(p.exists("services/payment-split-service/openapi.yaml")).toBe(true);
      expect(p.exists("features/FEAT-1-split")).toBe(false);
      expect(p.exists("features/archive/FEAT-1-split/delta.likec4")).toBe(true);
    } finally {
      await p.destroy();
    }
  });

  it("a pre-existing features/archive/<dir> from an earlier run does not crash the archive move", async () => {
    const files = coherentFixture();
    files["features/archive/FEAT-1-split/stale.md"] = "# leftover from a previous run\n";
    const p = await makeProject(files);
    try {
      const { res, crashed } = await runLoamSafe(p.workDir, "archive", "FEAT-1");
      expect(crashed, "an existing archive destination must be handled (suffix or clean error), not an uncaught ENOTEMPTY").toBe(false);
      if (res!.code === 0) {
        // If it claims success the feature must actually have been moved out.
        expect(p.exists("features/FEAT-1-split")).toBe(false);
      } else {
        expect(p.exists("features/FEAT-1-split/delta.likec4")).toBe(true);
      }
    } finally {
      await p.destroy();
    }
  });

  it("a broken delta.likec4 with --approve skips the arch merge with a notice, merges the rest, and archives", async () => {
    const files = coherentFixture();
    files["features/FEAT-1-split/delta.likec4"] = "model { this is not likec4\n";
    const p = await makeProject(files);
    try {
      const res = await runLoam(p.workDir, "archive", "FEAT-1", "--approve");
      expect(res.code).toBe(0);
      expect(res.out).toContain("delta.likec4 has errors — skipped");
      expect(await p.read(LANDSCAPE_REL)).toBe(LANDSCAPE);
      expect(p.exists("services/payment-split-service/spec.md")).toBe(true);
      expect(p.exists("services/payment-split-service/openapi.yaml")).toBe(true);
      expect(p.exists("features/archive/FEAT-1-split")).toBe(true);
    } finally {
      await p.destroy();
    }
  });
});
