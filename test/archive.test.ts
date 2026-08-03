/**
 * Deep invariant tests for `loam archive` (src/commands/archive.ts).
 *
 * archive MUTATES the living docs (spec.md / openapi.yaml / landscape.likec4),
 * so these tests are adversarial: they assert the DESIRED merge invariants
 * (SCHEMA.md + command docstrings), not whatever the implementation happens to
 * do. Every deliberately-failing test corresponds to a suspected frame bug
 * documented in the workflow report.
 *
 * Three families were added after the merge grew teeth:
 *
 *  - SPINE PRESERVATION. The merge rewrites a delta's elements and edges as
 *    living-landscape source, and every field it forgets to write is a link
 *    silently cut: `metadata { op }` joins an edge to the OpenAPI contract, and
 *    `metadata { service }` joins an element to its `services/<svc>/` directory.
 *    Dropping the latter makes a bound element unmodelled the moment it lands.
 *
 *  - EDGE IDENTITY. Merging is idempotent because it skips edges the landscape
 *    already has, so what counts as "already has" decides what gets lost. An
 *    op-less edge titled `authorizePayment` is not the edge whose op IS
 *    authorizePayment, and two edges are two edges.
 *
 *  - THE COMMIT PHASE. The plan is atomic; the filesystem is not. A failure
 *    after the first file is written must not leave the living docs half-merged,
 *    and `--dry-run` must leave them untouched down to the byte.
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
  treeHashes,
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

/**
 * FEAT-12: a new element whose TITLE is not its directory name, bound to the
 * directory with `metadata { service }`. The binding is the only thing tying the
 * box to `services/payment-split-service/`, which the same archive creates.
 */
const BOUND_ELEMENT_DELTA = `specification {
  element softwareSystem
  tag FEAT-12
}

model {
  paymentService = softwareSystem 'payment-service'
  splitter = softwareSystem 'Payment Splitter' {
    #FEAT-12
    description 'Splits a payment across payees'
    metadata { service 'payment-split-service' }
  }

  paymentService -> splitter 'Calls createSplit' {
    #FEAT-12
    metadata { op 'createSplit' }
  }
}

views {
  view feat_12 {
    include *
  }
}
`;

/**
 * FEAT-13: edges between the same pair that an `op ?? title` key confuses. The
 * living LANDSCAPE already carries `checkout-web -> payment-service` with
 * `op 'authorizePayment'`, so the op-less edge merely TITLED `authorizePayment`
 * keys to the same string and is skipped as already-merged. The two `Retries`
 * edges are the other half: distinct edges the model cannot tell apart.
 */
const EDGE_IDENTITY_DELTA = `specification {
  element softwareSystem
  tag FEAT-13
}

model {
  checkoutWeb = softwareSystem 'checkout-web'
  paymentService = softwareSystem 'payment-service'

  checkoutWeb -> paymentService 'Retries' { #FEAT-13 }
  checkoutWeb -> paymentService 'Retries' { #FEAT-13 }
  checkoutWeb -> paymentService 'authorizePayment' { #FEAT-13 }
  checkoutWeb -> paymentService 'Calls it' {
    #FEAT-13
    metadata { op 'refundPayment' }
  }
}

views {
  view feat_13 {
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
    // Its requirement is MODIFIED, not ADDED: FEAT-1 already merged that name into
    // the living spec, and re-ADDING it would replace it rather than add.
    await p.write("features/FEAT-2-redo/delta.likec4", FEATURE_DELTA.replaceAll("FEAT-1", "FEAT-2"));
    await p.write(
      "features/FEAT-2-redo/specs/payment-split-service/spec.md",
      FEATURE_SPEC.replace("## ADDED Requirements", "## MODIFIED Requirements"),
    );
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

  it("re-applying an already-merged delta is refused: its ADDED now exists and its REMOVED is gone", async () => {
    await p.write("features/FEAT-8-rework/specs/payment-service/spec.md", REQ_DELTA_ALL_KINDS);
    const again = await runLoam(p.workDir, "archive", "FEAT-8");
    expect(again.code).toBe(1);
    expect(again.out).toContain("BLOCKED");
    expect(again.out).toContain("already exists in the living spec");
    expect(await p.read("services/payment-service/spec.md")).toBe(mergedText);
  });

  it("forced through, an identical delta leaves the living spec byte-identical (content idempotence)", async () => {
    const again = await runLoam(p.workDir, "archive", "FEAT-8", "--approve");
    expect(again.code).toBe(0);
    expect(await p.read("services/payment-service/spec.md")).toBe(mergedText);
  });
});

describe("new-service living spec creation semantics", () => {
  it("a MODIFIED-only delta against a missing living spec is REFUSED — it would create what it claims to change", async () => {
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
      expect(res.code).toBe(1);
      expect(res.out).toContain("Did you mean ADDED?");
      expect(p.exists("services/ghost-service/spec.md")).toBe(false);
    } finally {
      await p.destroy();
    }
  });

  it("forced through with --approve, MODIFIED-against-nothing still behaves as ADDED (merge semantics pinned)", async () => {
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
      const res = await runLoam(p.workDir, "archive", "FEAT-10", "--approve");
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

  it("a REMOVED-only delta for a service with no living spec is REFUSED — there is nothing to remove", async () => {
    const p = await makeProject({
      "features/FEAT-11-void/specs/void-service/spec.md": `# void-service delta

## REMOVED Requirements

### Requirement: Old thing
`,
    });
    try {
      const res = await runLoam(p.workDir, "archive", "FEAT-11");
      expect(res.code).toBe(1);
      expect(res.out).toContain("nothing to remove");
      expect(p.exists("services/void-service/spec.md")).toBe(false);
    } finally {
      await p.destroy();
    }
  });

  it("forced through with --approve, it still does not fabricate an empty living spec", async () => {
    const p = await makeProject({
      "features/FEAT-11-void/specs/void-service/spec.md": `# void-service delta

## REMOVED Requirements

### Requirement: Old thing
`,
    });
    try {
      const res = await runLoam(p.workDir, "archive", "FEAT-11", "--approve");
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

describe("spine preservation through the merge", () => {
  it("both spines survive the rewrite: `op` on the edge and `service` on the element", async () => {
    // The merge re-emits a delta element as living-landscape source. Anything it
    // forgets to write is not "lost formatting" — it is a link cut: `op` joins the
    // edge to the OpenAPI contract, `service` joins the element to its directory.
    const files = coherentFixture();
    delete files["features/FEAT-1-split/delta.likec4"];
    delete files["features/FEAT-1-split/specs/payment-split-service/spec.md"];
    delete files["features/FEAT-1-split/specs/payment-split-service/openapi.yaml"];
    delete files["features/FEAT-1-split/intent.md"];
    files["features/FEAT-12-split/delta.likec4"] = BOUND_ELEMENT_DELTA;
    files["features/FEAT-12-split/specs/payment-split-service/spec.md"] = FEATURE_SPEC;
    files["features/FEAT-12-split/specs/payment-split-service/openapi.yaml"] =
      coherentFixture()["features/FEAT-1-split/specs/payment-split-service/openapi.yaml"]!;
    const p = await makeProject(files);
    try {
      const res = await runLoam(p.workDir, "archive", "FEAT-12");
      expect(res.code).toBe(0);
      const land = await loadFile(landscapePath(p));
      expect(land.errors).toEqual([]);

      const el = land.elements.find((e) => e.title === "Payment Splitter");
      expect(el, "the merged element must be in the living landscape").toBeDefined();
      expect(
        el!.service,
        "dropping metadata { service } unbinds the element from services/<svc>/ at the moment it lands",
      ).toBe("payment-split-service");

      const edges = edgesBetween(land, "payment-service", "Payment Splitter", "createSplit");
      expect(edges, "dropping metadata { op } de-links the merged edge from the OpenAPI contract").toHaveLength(1);
    } finally {
      await p.destroy();
    }
  });

  it("a bound element stays modelled after the archive — validate --all reports no unmodelled service", async () => {
    // The directory this element stands for is created by the same archive, so a
    // lost binding is not a latent risk: the next validate fails immediately.
    const files = coherentFixture();
    delete files["features/FEAT-1-split/delta.likec4"];
    delete files["features/FEAT-1-split/specs/payment-split-service/spec.md"];
    delete files["features/FEAT-1-split/specs/payment-split-service/openapi.yaml"];
    delete files["features/FEAT-1-split/intent.md"];
    files["features/FEAT-12-split/delta.likec4"] = BOUND_ELEMENT_DELTA;
    files["features/FEAT-12-split/specs/payment-split-service/spec.md"] = FEATURE_SPEC;
    files["features/FEAT-12-split/specs/payment-split-service/openapi.yaml"] =
      coherentFixture()["features/FEAT-1-split/specs/payment-split-service/openapi.yaml"]!;
    const p = await makeProject(files);
    try {
      expect((await runLoam(p.workDir, "archive", "FEAT-12")).code).toBe(0);
      const v = await runLoam(p.workDir, "validate", "--all", "--json");
      const codes = JSON.parse(v.stdout).targets.flatMap((t: { findings: { code: string }[] }) =>
        t.findings.map((f) => f.code),
      );
      expect(codes).not.toContain("landscape.service-unmodelled");
    } finally {
      await p.destroy();
    }
  });
});

describe("edge identity", () => {
  /** Every checkout-web → payment-service edge, as (title, op) pairs. */
  function pairs(land: LoadedDoc): string[] {
    return edgesBetween(land, "checkout-web", "payment-service")
      .map((r) => `${r.title ?? ""}|${r.op ?? ""}`)
      .sort();
  }

  it("an op-less edge titled like an operationId is not the edge that calls it", async () => {
    const p = await makeProject({
      "architecture/landscape.likec4": LANDSCAPE,
      "features/FEAT-13-edges/delta.likec4": EDGE_IDENTITY_DELTA,
    });
    try {
      // --approve: createSplit is deliberately undefined here — this is about edge
      // identity, not about the contract.
      const res = await runLoam(p.workDir, "archive", "FEAT-13", "--approve");
      expect(res.code).toBe(0);
      const land = await loadFile(landscapePath(p));
      expect(land.errors).toEqual([]);
      expect(
        pairs(land),
        "a title and an operationId are different namespaces — one key over both collapses them",
      ).toEqual([
        "Calls authorizePayment|authorizePayment",
        "Calls it|refundPayment",
        "Retries|",
        "Retries|",
        "authorizePayment|",
      ]);
    } finally {
      await p.destroy();
    }
  });

  it("two edges that differ in nothing loam models are still two edges", async () => {
    const p = await makeProject({
      "architecture/landscape.likec4": LANDSCAPE,
      "features/FEAT-13-edges/delta.likec4": EDGE_IDENTITY_DELTA,
    });
    try {
      await runLoam(p.workDir, "archive", "FEAT-13", "--approve");
      const land = await loadFile(landscapePath(p));
      expect(land.relationships.filter((r) => r.title === "Retries")).toHaveLength(2);
    } finally {
      await p.destroy();
    }
  });

  it("re-archiving the same edges adds none of them back", async () => {
    const p = await makeProject({
      "architecture/landscape.likec4": LANDSCAPE,
      "features/FEAT-13-edges/delta.likec4": EDGE_IDENTITY_DELTA,
    });
    try {
      await runLoam(p.workDir, "archive", "FEAT-13", "--approve");
      const once = pairs(await loadFile(landscapePath(p)));
      await p.write(
        "features/FEAT-14-edges/delta.likec4",
        EDGE_IDENTITY_DELTA.replaceAll("FEAT-13", "FEAT-14"),
      );
      expect((await runLoam(p.workDir, "archive", "FEAT-14", "--approve")).code).toBe(0);
      expect(
        pairs(await loadFile(landscapePath(p))),
        "counting duplicates must not cost idempotence — the landscape already has both",
      ).toEqual(once);
    } finally {
      await p.destroy();
    }
  });
});

describe("the commit phase", () => {
  /** coherentFixture, but `features/archive` is a FILE — the feature move fails at the very end. */
  async function archiveBlockedByFile(): Promise<Project> {
    const p = await makeProject(coherentFixture());
    await p.write("features/archive", "not a directory\n");
    return p;
  }

  it("a failure after the first file is written rolls the living docs back, not half-merged", async () => {
    const p = await archiveBlockedByFile();
    try {
      const before = await treeHashes(p.docsDir);
      const { res, crashed } = await runLoamSafe(p.workDir, "archive", "FEAT-1");
      expect(crashed).toBe(false);
      expect(res!.code).toBe(1);
      expect(await treeHashes(p.docsDir), "every merged file must be back to its pre-archive bytes").toEqual(before);
    } finally {
      await p.destroy();
    }
  });

  it("says the docs were rolled back rather than claiming the merge just failed", async () => {
    const p = await archiveBlockedByFile();
    try {
      const { res } = await runLoamSafe(p.workDir, "archive", "FEAT-1");
      expect(res!.out.toLowerCase()).toContain("rolled back");
    } finally {
      await p.destroy();
    }
  });

  it("leaves no temp files behind, on success or on failure", async () => {
    const failed = await archiveBlockedByFile();
    try {
      await runLoamSafe(failed.workDir, "archive", "FEAT-1");
      expect(Object.keys(await treeHashes(failed.docsDir)).filter((f) => f.includes(".tmp"))).toEqual([]);
    } finally {
      await failed.destroy();
    }
    const ok = await makeProject(coherentFixture());
    try {
      expect((await runLoam(ok.workDir, "archive", "FEAT-1")).code).toBe(0);
      expect(Object.keys(await treeHashes(ok.docsDir)).filter((f) => f.includes(".tmp"))).toEqual([]);
    } finally {
      await ok.destroy();
    }
  });

  it("the feature stays active after a rollback, so the archive can simply be re-run", async () => {
    const p = await archiveBlockedByFile();
    try {
      await runLoamSafe(p.workDir, "archive", "FEAT-1");
      expect(p.exists("features/FEAT-1-split/delta.likec4")).toBe(true);
      expect(p.exists("features/FEAT-1-split/.loam-before")).toBe(false);
    } finally {
      await p.destroy();
    }
  });
});

describe("--dry-run", () => {
  it("prints every file the merge would write, and the move it would make", async () => {
    const p = await makeProject(coherentFixture());
    try {
      const res = await runLoam(p.workDir, "archive", "FEAT-1", "--dry-run");
      expect(res.code).toBe(0);
      expect(res.out).toContain("services/payment-split-service/spec.md");
      expect(res.out).toContain("services/payment-split-service/openapi.yaml");
      expect(res.out).toContain(LANDSCAPE_REL);
      expect(res.out).toContain("features/archive/FEAT-1-split");
      expect(res.out.toLowerCase()).toContain("dry run");
    } finally {
      await p.destroy();
    }
  });

  it("touches nothing: every file in the docs repo is byte-identical afterwards", async () => {
    const p = await makeProject(coherentFixture());
    try {
      const before = await treeHashes(p.docsDir);
      expect((await runLoam(p.workDir, "archive", "FEAT-1", "--dry-run")).code).toBe(0);
      expect(await treeHashes(p.docsDir)).toEqual(before);
    } finally {
      await p.destroy();
    }
  });

  it("still refuses an incoherent feature — a dry run of a merge that may not happen says nothing useful", async () => {
    const files = coherentFixture();
    delete files["features/FEAT-1-split/specs/payment-split-service/openapi.yaml"];
    const p = await makeProject(files);
    try {
      const res = await runLoam(p.workDir, "archive", "FEAT-1", "--dry-run");
      expect(res.code).toBe(1);
      expect(res.out).toContain("BLOCKED");
    } finally {
      await p.destroy();
    }
  });

  it("a real archive after a dry run produces exactly what the dry run listed", async () => {
    const p = await makeProject(coherentFixture());
    try {
      const dry = await runLoam(p.workDir, "archive", "FEAT-1", "--dry-run");
      const before = await treeHashes(p.docsDir);
      expect((await runLoam(p.workDir, "archive", "FEAT-1")).code).toBe(0);
      const after = await treeHashes(p.docsDir);
      const changed = Object.keys(after).filter((f) => after[f] !== before[f] && !f.startsWith("features/"));
      for (const f of changed) expect(dry.out, `${f} was written but not listed`).toContain(f);
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
