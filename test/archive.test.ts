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
 *  - SPINE PRESERVATION. The merge carries a delta's elements and edges into
 *    the living landscape (by splicing their authored source), and every field
 *    lost on the way is a link silently cut: `metadata { op }` joins an edge to
 *    the OpenAPI contract, and `metadata { service }` joins an element to its
 *    `services/<svc>/` directory. Dropping the latter makes a bound element
 *    unmodelled the moment it lands.
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
import { rm } from "node:fs/promises";
import { parse } from "yaml";
import { loadFile, type LoadedDoc } from "../src/core/c4/likec4.js";
import { parseRequirements } from "../src/core/document/parse.js";
import {
  coherentFixture,
  makeProject,
  pinFor,
  pinOpenapi,
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

/**
 * featureCoherence now gates archive on `intent.empty` (a feature whose
 * intent.md is missing or holds no prose must not become living truth without
 * --approve). The fixtures in this file exercise MERGE invariants, not the
 * intent gate, so each one that expects to get past the gate states a one-line
 * authored Why with this file.
 */
const AUTHORED_INTENT = `# Why

This feature exists to exercise the merge invariant its test pins.
`;

/**
 * REQ_DELTA_ALL_KINDS with its MODIFIED and REMOVED requirements pinned against
 * the living text they address, exactly as `loam rebase` would stamp them.
 * `delta.baseline-missing` now GATES archive, so a fixture that means to merge
 * cleanly must carry the pins; they are computed with pinFor, never hard-coded,
 * because a literal digest would be a second definition of requirementDigest.
 * The digest covers only the requirement's own serialized content — not its
 * surroundings — so the fixtures that wrap LIVING_SPEC_TWO_REQS in extra prose,
 * a BOM, or CRLF line endings still pin the same two requirements correctly by
 * passing their own living text here.
 */
function pinAllKinds(living: string): string {
  return REQ_DELTA_ALL_KINDS.replace(
    "### Requirement: Authorize a payment\n",
    `### Requirement: Authorize a payment\nBased-On: ${pinFor(living, "Authorize a payment")}\n`,
  ).replace(
    "### Requirement: Legacy settlement quirk\n",
    `### Requirement: Legacy settlement quirk\nBased-On: ${pinFor(living, "Legacy settlement quirk")}\n`,
  );
}

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

/**
 * A living landscape whose specification also declares the kinds and tags the
 * rich deltas below carry. The merge splices authored source VERBATIM, so a
 * kind or tag the living document does not declare makes the merged landscape
 * unparseable — which the safety-net test pins as a plan-time refusal.
 */
const RICH_LANDSCAPE = `specification {
  element softwareSystem
  element container
  element person
  tag critical
}

model {
  customer = person 'Customer'
  checkoutWeb = softwareSystem 'checkout-web' {
    description 'Customer-facing checkout UI'
  }
  paymentService = softwareSystem 'payment-service' {
    description 'Owns payment authorization/capture'
  }

  customer -> checkoutWeb 'Uses'
  checkoutWeb -> paymentService 'Calls authorizePayment' {
    metadata { op 'authorizePayment' }
  }
}

views {
  view landscape {
    include *
  }
}
`;

/**
 * FEAT-20: an element carrying everything the old re-serializer destroyed —
 * technology, style (color + icon), a link, a second tag — plus a titled
 * op-linked edge and an edge whose body holds ONLY the feature tag.
 */
const RICH_ELEMENT_DELTA = `specification {
  element softwareSystem
  tag FEAT-20
  tag critical
}

model {
  checkoutWeb = softwareSystem 'checkout-web'
  paymentService = softwareSystem 'payment-service'

  ledgerService = softwareSystem 'ledger-service' {
    #FEAT-20 #critical
    description 'Tracks every balance'
    technology 'Kotlin + Spring'
    metadata { service 'ledger-service' }
    style {
      color green
      icon tech:kubernetes
    }
    link https://example.com/runbook 'runbook'
  }

  paymentService -> ledgerService 'Posts entries' {
    #FEAT-20
    metadata { op 'postEntry' }
  }
  checkoutWeb -> paymentService 'Retries once' { #FEAT-20 }
}

views {
  view feat_20 {
    include *
  }
}
`;

/** FEAT-21: a tagged child whose parent already lives in the landscape. */
const NESTED_CHILD_DELTA = `specification {
  element softwareSystem
  element container
  tag FEAT-21
}

model {
  paymentService = softwareSystem 'payment-service' {
    splitEngine = container 'Split engine' {
      #FEAT-21
      technology 'Rust'
    }
  }
}

views {
  view feat_21 {
    include *
  }
}
`;

/** FEAT-22: a NEW tagged parent whose children (one tagged, one not) ride inside it. */
const NEW_PARENT_DELTA = `specification {
  element softwareSystem
  element container
  tag FEAT-22
}

model {
  ledgerService = softwareSystem 'ledger-service' {
    #FEAT-22
    api = container 'Ledger API' {
      #FEAT-22
    }
    store = container 'Ledger store'
  }
}

views {
  view feat_22 {
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

  it("pre-existing landscape content (customer, checkout-web, views block, old edge) is byte-preserved around the insertions", () => {
    // Service-grouped placement: the new element opens a new service, so it
    // lands in the trailing element region (after the last element, before the
    // relationships); the new edge's source is payment-service, so it lands
    // right after the last edge touching payment-service — here the model's
    // final statement. Every authored byte survives around the two splices.
    const elAt = LANDSCAPE.indexOf("  customer -> checkoutWeb");
    const closeAt = LANDSCAPE.indexOf("\n}\n\nviews") + 1;
    expect(elAt).toBeGreaterThan(0);
    expect(closeAt).toBeGreaterThan(0);
    const elementBlock =
      "  paymentSplitService = softwareSystem 'payment-split-service' {\n" +
      "    description 'Splits a payment across payees'\n" +
      "  }\n";
    const edgeBlock =
      "  paymentService -> paymentSplitService 'Calls createSplit' {\n" +
      "    metadata { op 'createSplit' }\n" +
      "  }\n";
    expect(landText).toBe(
      LANDSCAPE.slice(0, elAt) +
        elementBlock +
        LANDSCAPE.slice(elAt, closeAt) +
        edgeBlock +
        LANDSCAPE.slice(closeAt),
    );
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
    // the living spec, and re-ADDING it would replace it rather than add. The
    // MODIFIED requirement carries a Based-On pin computed from the living spec
    // FEAT-1's archive just created, because an unpinned MODIFIED now gates
    // archive (delta.baseline-missing) rather than merely warning.
    await p.write("features/FEAT-2-redo/delta.likec4", FEATURE_DELTA.replaceAll("FEAT-1", "FEAT-2"));
    await p.write("features/FEAT-2-redo/intent.md", AUTHORED_INTENT);
    const livingSplit = await p.read("services/payment-split-service/spec.md");
    await p.write(
      "features/FEAT-2-redo/specs/payment-split-service/spec.md",
      FEATURE_SPEC.replace("## ADDED Requirements", "## MODIFIED Requirements").replace(
        "### Requirement: Split a payment\n",
        `### Requirement: Split a payment\nBased-On: ${pinFor(livingSplit, "Split a payment")}\n`,
      ),
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
      "features/FEAT-7-rework/specs/payment-service/spec.md": pinAllKinds(LIVING_SPEC_TWO_REQS),
      "features/FEAT-7-rework/intent.md": AUTHORED_INTENT,
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
    // No pins needed on the openapi axis: /payments/refund is a genuinely new
    // slot in every variant, and only a restated LIVING operation trips
    // openapi.baseline-missing.
    return makeProject({
      "architecture/landscape.likec4": LANDSCAPE,
      "services/payment-service/spec.md": LIVING_SPEC,
      "services/payment-service/openapi.yaml": livingOpenapi,
      "features/FEAT-3-refunds/delta.likec4": REFUND_DELTA,
      "features/FEAT-3-refunds/specs/payment-service/spec.md": REFUND_SPEC,
      "features/FEAT-3-refunds/specs/payment-service/openapi.yaml": featureOpenapi,
      "features/FEAT-3-refunds/intent.md": AUTHORED_INTENT,
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
    // The feature restates the living /payments/authorize slot, so it carries
    // the x-loam-based-on pin `loam rebase` would write — an unpinned restated
    // operation now gates archive (openapi.baseline-missing).
    const p = await makeProject({
      "architecture/landscape.likec4": LANDSCAPE,
      "services/payment-service/spec.md": LIVING_SPEC,
      "services/payment-service/openapi.yaml": LIVING_OPENAPI,
      "features/FEAT-4-idem/delta.likec4": REDECLARE_DELTA,
      "features/FEAT-4-idem/specs/payment-service/spec.md": REDECLARE_SPEC,
      "features/FEAT-4-idem/specs/payment-service/openapi.yaml": pinOpenapi(REDECLARE_OPENAPI, LIVING_OPENAPI),
      "features/FEAT-4-idem/intent.md": AUTHORED_INTENT,
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

  it("a feature openapi that does not read as an OpenAPI document is refused (merge-failed) and no living contract is created", async () => {
    // The create branch never asked whether the document it was about to
    // INSTALL could be read. A sequence where a mapping belongs yields zero
    // operations, which is the same answer as a contract that defines nothing —
    // so the plan printed `created ()` and these three lines landed verbatim in
    // services/payment-split-service/openapi.yaml, published as that service's
    // contract, at exit 0. Every other reader of this flag suspends its own
    // judgement; the one command that WRITES must too.
    //
    // `--approve` because the coherence gate refuses this feature for a
    // different reason (its requirement governs createSplit, which no readable
    // contract now defines), and that gate is not what is under test: the write
    // PAST it is, and --approve is exactly how a person gets there.
    const files = coherentFixture();
    files["features/FEAT-1-split/specs/payment-split-service/openapi.yaml"] =
      "- not\n- a\n- mapping\n";
    const p = await makeProject(files);
    try {
      const before = await treeHashes(p.docsDir);
      const { res, crashed } = await runLoamSafe(p.workDir, "archive", "FEAT-1", "--approve", "--json");
      expect(crashed).toBe(false);
      expect(res!.code).toBe(1);
      const json = JSON.parse(res!.stdout);
      expect(json.ok).toBe(false);
      expect(json.error.code).toBe("merge-failed");
      expect(json.error.message).toContain(
        "features/FEAT-1-split/specs/payment-split-service/openapi.yaml",
      );
      expect(
        p.exists("services/payment-split-service/openapi.yaml"),
        "a document loam cannot read was installed as the living contract",
      ).toBe(false);
      expect(await treeHashes(p.docsDir), "a plan-time refusal must write nothing").toEqual(before);
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

  it("a 'model {' inside a block comment above the real block cannot entomb the additions — the PARSED model contains them", async () => {
    // The killer variant: a header comment spelling `model { ... }` used to
    // capture the raw-text regex, the brace scan closed inside the comment, and
    // every top-level addition was spliced INTO the comment — the result still
    // parsed, archive exited 0, and the architecture was silently lost.
    const files = coherentFixture();
    files["architecture/landscape.likec4"] =
      "/* Landscape overview: the model { payments, billing } drawn as C4. */\n" + LANDSCAPE;
    const p = await makeProject(files);
    try {
      const res = await runLoam(p.workDir, "archive", "FEAT-1");
      expect(res.code).toBe(0);
      const land = await loadFile(landscapePath(p));
      expect(land.errors).toEqual([]);
      // Not just "parses": the additions must exist in the PARSED model, not as
      // bytes inside the comment.
      expect(elementsTitled(land, "payment-split-service")).toHaveLength(1);
      expect(edgesBetween(land, "payment-service", "payment-split-service", "createSplit")).toHaveLength(1);
      // and the comment itself survives verbatim
      expect(await p.read(LANDSCAPE_REL)).toContain(
        "/* Landscape overview: the model { payments, billing } drawn as C4. */",
      );
    } finally {
      await p.destroy();
    }
  });

  it("a 'model {' inside a line comment above the real block does not refuse a valid archive", async () => {
    // Sibling symptom, same root cause: the raw-text scan hit the comment's
    // sequence and produced a bogus merge the parse net rejected — refusing a
    // perfectly legal archive.
    const files = coherentFixture();
    files["architecture/landscape.likec4"] = "// the model { of the fleet, drawn as C4\n" + LANDSCAPE;
    const p = await makeProject(files);
    try {
      const res = await runLoam(p.workDir, "archive", "FEAT-1", "--json");
      expect(res.code, res.out).toBe(0);
      const land = await loadFile(landscapePath(p));
      expect(land.errors).toEqual([]);
      expect(elementsTitled(land, "payment-split-service")).toHaveLength(1);
    } finally {
      await p.destroy();
    }
  });

  it("a 'model {' inside a string literal does not derail the merge either way", async () => {
    const files = coherentFixture();
    files["architecture/landscape.likec4"] = LANDSCAPE.replace(
      "Customer-facing checkout UI",
      "renders the model { view",
    );
    const p = await makeProject(files);
    try {
      // Sanity: the adversarial living landscape is valid LikeC4 before the merge.
      expect((await loadFile(landscapePath(p))).errors).toEqual([]);
      const res = await runLoam(p.workDir, "archive", "FEAT-1", "--json");
      expect(res.code, res.out).toBe(0);
      const land = await loadFile(landscapePath(p));
      expect(land.errors).toEqual([]);
      expect(elementsTitled(land, "payment-split-service")).toHaveLength(1);
      expect(edgesBetween(land, "payment-service", "payment-split-service", "createSplit")).toHaveLength(1);
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

describe("cross-service title collision in the landscape join", () => {
  /*
   * The existence check joins delta elements to living ones by id, then by
   * TITLE. The title join is the id-less fallback, and it is only safe when
   * the two sides could be the same box: when BOTH carry an explicit
   * `metadata { service }` binding and the bindings differ, they are provably
   * different services' boxes sharing a title ('API', 'Database') — the old
   * silent skip dropped the addition, and the delta's edges into it then
   * refused the whole archive at the parse net with a message about nothing.
   * Now that case refuses loudly at plan time; every join with an unbound
   * side (the legal legacy pattern) behaves exactly as before.
   */

  /** A landscape whose 'API' box is BOUND to payment-service. */
  const BOUND_API_LANDSCAPE = `specification {
  element softwareSystem
  element person
}

model {
  customer = person 'Customer'
  paymentApi = softwareSystem 'API' {
    description 'payment facade'
    metadata { service 'payment-service' }
  }

  customer -> paymentApi 'Uses'
}

views {
  view landscape {
    include *
  }
}
`;

  /** A one-element delta claiming the title 'API', bound (or not) to a service. */
  const apiTitleDelta = (feat: string, id: string, boundTo?: string): string => `specification {
  element softwareSystem
  tag ${feat}
}

model {
  ${id} = softwareSystem 'API' {
    #${feat}${boundTo === undefined ? "" : `\n    metadata { service '${boundTo}' }`}
  }
}

views {
  view v_${feat.toLowerCase().replace(/-/g, "_")} {
    include *
  }
}
`;

  it("both sides bound to DIFFERENT services: refused at plan time (merge-failed), nothing written, --approve does not force it", async () => {
    const p = await makeProject({
      "architecture/landscape.likec4": BOUND_API_LANDSCAPE,
      "features/FEAT-40-ledger/delta.likec4": apiTitleDelta("FEAT-40", "ledgerApi", "ledger-service"),
    });
    try {
      const before = await treeHashes(p.docsDir);
      // --approve on purpose: the refusal is mechanical (the merge cannot be
      // done correctly), not a judgment call, so --approve must not override it.
      const { res, crashed } = await runLoamSafe(p.workDir, "archive", "FEAT-40", "--approve", "--json");
      expect(crashed).toBe(false);
      expect(res!.code).toBe(1);
      const json = JSON.parse(res!.stdout);
      expect(json.ok).toBe(false);
      expect(json.error.code).toBe("merge-failed");
      // The message names both elements and both services — the reader must not
      // have to re-derive which two boxes collided.
      expect(json.error.message).toContain("ledgerApi");
      expect(json.error.message).toContain("ledger-service");
      expect(json.error.message).toContain("paymentApi");
      expect(json.error.message).toContain("payment-service");
      expect(json.error.message).toContain("'API'");
      expect(await treeHashes(p.docsDir), "a plan-time refusal must write nothing").toEqual(before);
      expect(p.exists("features/FEAT-40-ledger/delta.likec4")).toBe(true);
    } finally {
      await p.destroy();
    }
  });

  it("both sides bound to the SAME service: a legitimate title match still merges as before (skip, no duplicate)", async () => {
    const p = await makeProject({
      "architecture/landscape.likec4": BOUND_API_LANDSCAPE,
      "features/FEAT-41-redo/delta.likec4": apiTitleDelta("FEAT-41", "paymentFacade", "payment-service"),
    });
    try {
      const res = await runLoam(p.workDir, "archive", "FEAT-41", "--approve");
      expect(res.code, res.out).toBe(0);
      expect(p.exists("features/archive/FEAT-41-redo/delta.likec4")).toBe(true);
      const land = await loadFile(landscapePath(p));
      expect(land.errors).toEqual([]);
      const els = elementsTitled(land, "API");
      expect(els, "the same service's re-declared box must be skipped, not duplicated").toHaveLength(1);
      expect(els[0]!.id).toBe("paymentApi");
    } finally {
      await p.destroy();
    }
  });

  it("either side unbound: the legacy title-fallback join still silently skips, in both directions", async () => {
    // Direction 1: the DELTA's element is unbound — it may well be the living
    // 'API' box re-declared without its binding.
    const p1 = await makeProject({
      "architecture/landscape.likec4": BOUND_API_LANDSCAPE,
      "features/FEAT-42-legacy/delta.likec4": apiTitleDelta("FEAT-42", "someApi"),
    });
    try {
      const res = await runLoam(p1.workDir, "archive", "FEAT-42", "--approve");
      expect(res.code, res.out).toBe(0);
      const land = await loadFile(landscapePath(p1));
      expect(land.errors).toEqual([]);
      expect(elementsTitled(land, "API")).toHaveLength(1);
    } finally {
      await p1.destroy();
    }
    // Direction 2: the LIVING element is unbound (the pre-binding legacy
    // landscape) while the delta's is bound — still the trusting skip.
    const p2 = await makeProject({
      "architecture/landscape.likec4": BOUND_API_LANDSCAPE.replace("    metadata { service 'payment-service' }\n", ""),
      "features/FEAT-43-legacy/delta.likec4": apiTitleDelta("FEAT-43", "ledgerApi", "ledger-service"),
    });
    try {
      const res = await runLoam(p2.workDir, "archive", "FEAT-43", "--approve");
      expect(res.code, res.out).toBe(0);
      const land = await loadFile(landscapePath(p2));
      expect(land.errors).toEqual([]);
      expect(elementsTitled(land, "API")).toHaveLength(1);
    } finally {
      await p2.destroy();
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
    files["features/FEAT-12-split/intent.md"] = AUTHORED_INTENT;
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
    files["features/FEAT-12-split/intent.md"] = AUTHORED_INTENT;
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

/**
 * The event spine's half of edge identity. `relKey` keyed on `op` alone, so an
 * edge differing from a living one only by `metadata { publishes '...' }` hashed
 * the same, was counted as already present, and never reached the landscape —
 * archive printing `+0 relationship(s)` and exit 0 over a binding the author had
 * just written. The landscape is the fleet's only record of event flow, so the
 * loss disarmed every check that reads it, and the delta stating the intent was
 * moved into features/archive/ by the same command.
 */
describe("edge identity — the event spine keys", () => {
  const LIVING = `specification {
  element softwareSystem
  tag FEAT-15
}

model {
  checkoutWeb = softwareSystem 'checkout-web'
  paymentService = softwareSystem 'payment-service'

  checkoutWeb -> paymentService 'Emits'
}

views {
  view landscape {
    include *
  }
}
`;

  /** A delta whose edge differs from LIVING's in metadata and in nothing else. */
  const delta = (body: string): string => `specification {
  element softwareSystem
  tag FEAT-15
}

model {
  checkoutWeb = softwareSystem 'checkout-web'
  paymentService = softwareSystem 'payment-service'

${body}
}

views {
  view feat_15 {
    include *
  }
}
`;

  /** Every checkout-web → payment-service edge's publishes/consumes, sorted. */
  function bindings(land: LoadedDoc): string[] {
    return edgesBetween(land, "checkout-web", "payment-service")
      .map((r) => `${r.publishes ?? "-"}|${r.consumes ?? "-"}`)
      .sort();
  }

  async function archived(living: string, deltaSrc: string): Promise<LoadedDoc> {
    const p = await makeProject({
      "architecture/landscape.likec4": living,
      "features/FEAT-15-events/delta.likec4": deltaSrc,
    });
    try {
      const res = await runLoam(p.workDir, "archive", "FEAT-15", "--approve");
      expect(res.code, res.stdout + res.stderr).toBe(0);
      const land = await loadFile(landscapePath(p));
      expect(land.errors).toEqual([]);
      return land;
    } finally {
      await p.destroy();
    }
  }

  it("a feature that binds a message to an existing edge does not merge as a no-op", async () => {
    const land = await archived(
      LIVING,
      delta(`  checkoutWeb -> paymentService 'Emits' {
    #FEAT-15
    metadata { publishes 'payment.Authorized' }
  }`),
    );
    expect(
      bindings(land),
      "the binding must reach the landscape; the add-only splicer cannot amend the living edge, so it lands beside it",
    ).toEqual(["-|-", "payment.Authorized|-"]);
  });

  it("an edge whose message differs from the living one's is not the living edge", async () => {
    const living = LIVING.replace(
      "checkoutWeb -> paymentService 'Emits'",
      `checkoutWeb -> paymentService 'Emits' {
    metadata { publishes 'payment.Captured' }
  }`,
    );
    const land = await archived(
      living,
      delta(`  checkoutWeb -> paymentService 'Emits' {
    #FEAT-15
    metadata { publishes 'payment.Authorized' }
  }`),
    );
    expect(
      bindings(land),
      "two different event flows keyed the same, so the second was taken for the first",
    ).toEqual(["payment.Authorized|-", "payment.Captured|-"]);
  });

  it("two delta edges differing only in the message both land, with their own bytes", async () => {
    const land = await archived(
      LIVING,
      delta(`  checkoutWeb -> paymentService 'Emits' {
    #FEAT-15
    metadata { publishes 'payment.AAA' }
  }
  checkoutWeb -> paymentService 'Emits' {
    #FEAT-15
    metadata { publishes 'payment.BBB' }
  }`),
    );
    expect(
      bindings(land),
      "the pool that matches an addition back to its authored statement keyed on op alone too — one addition drew the other's bytes",
    ).toEqual(["-|-", "payment.AAA|-", "payment.BBB|-"]);
  });

  it("`consumes` is in the key exactly as `publishes` is", async () => {
    const land = await archived(
      LIVING,
      delta(`  checkoutWeb -> paymentService 'Emits' {
    #FEAT-15
    metadata { consumes 'payment.Authorized' }
  }`),
    );
    expect(bindings(land)).toEqual(["-|-", "-|payment.Authorized"]);
  });

  it("re-archiving the same message binding adds nothing back", async () => {
    const body = `  checkoutWeb -> paymentService 'Emits' {
    #FEAT-15
    metadata { publishes 'payment.Authorized' }
  }`;
    const p = await makeProject({
      "architecture/landscape.likec4": LIVING,
      "features/FEAT-15-events/delta.likec4": delta(body),
    });
    try {
      expect((await runLoam(p.workDir, "archive", "FEAT-15", "--approve")).code).toBe(0);
      const once = bindings(await loadFile(landscapePath(p)));
      await p.write(
        "features/FEAT-16-events/delta.likec4",
        delta(body).replaceAll("FEAT-15", "FEAT-16").replace("feat_15", "feat_16"),
      );
      expect((await runLoam(p.workDir, "archive", "FEAT-16", "--approve")).code).toBe(0);
      expect(
        bindings(await loadFile(landscapePath(p))),
        "widening the key must not cost idempotence — the landscape already carries this binding",
      ).toEqual(once);
    } finally {
      await p.destroy();
    }
  });
});

describe("landscape splice fidelity (the merge copies authored source, it does not re-serialize)", () => {
  it("an element with technology, style, icon, link and a second tag survives byte-verbatim minus the feature tag", async () => {
    const p = await makeProject({
      "architecture/landscape.likec4": RICH_LANDSCAPE,
      "features/FEAT-20-ledger/delta.likec4": RICH_ELEMENT_DELTA,
    });
    try {
      // --approve: the op-linked edge targets a service with no OpenAPI — this
      // test is about fidelity, not the contract.
      const res = await runLoam(p.workDir, "archive", "FEAT-20", "--approve");
      expect(res.code).toBe(0);
      const landText = await p.read(LANDSCAPE_REL);
      expect(landText).toContain(
        "  ledgerService = softwareSystem 'ledger-service' {\n" +
          "    #critical\n" +
          "    description 'Tracks every balance'\n" +
          "    technology 'Kotlin + Spring'\n" +
          "    metadata { service 'ledger-service' }\n" +
          "    style {\n" +
          "      color green\n" +
          "      icon tech:kubernetes\n" +
          "    }\n" +
          "    link https://example.com/runbook 'runbook'\n" +
          "  }",
      );
      expect(landText, "the feature's own tag — and only that tag — is stripped").not.toContain("#FEAT-20");
      const land = await loadFile(landscapePath(p));
      expect(land.errors).toEqual([]);
      expect(elementsTitled(land, "ledger-service")[0]!.tags).toEqual(["critical"]);
    } finally {
      await p.destroy();
    }
  });

  it("a relationship keeps its title and metadata { op } verbatim; one whose body held only the tag collapses to a bodyless statement", async () => {
    const p = await makeProject({
      "architecture/landscape.likec4": RICH_LANDSCAPE,
      "features/FEAT-20-ledger/delta.likec4": RICH_ELEMENT_DELTA,
    });
    try {
      expect((await runLoam(p.workDir, "archive", "FEAT-20", "--approve")).code).toBe(0);
      const landText = await p.read(LANDSCAPE_REL);
      expect(landText).toContain(
        "  paymentService -> ledgerService 'Posts entries' {\n    metadata { op 'postEntry' }\n  }",
      );
      // `{ #FEAT-20 }` emptied by the strip: the cleanest legal form is no body at all.
      expect(landText).toContain("\n  checkoutWeb -> paymentService 'Retries once'\n");
      const land = await loadFile(landscapePath(p));
      expect(land.errors).toEqual([]);
      expect(edgesBetween(land, "payment-service", "ledger-service", "postEntry")).toHaveLength(1);
    } finally {
      await p.destroy();
    }
  });

  it("a child whose parent lives in the landscape lands INSIDE the parent's block — never as a flat dotted id", async () => {
    const p = await makeProject({
      "architecture/landscape.likec4": RICH_LANDSCAPE,
      "features/FEAT-21-engine/delta.likec4": NESTED_CHILD_DELTA,
    });
    try {
      const res = await runLoam(p.workDir, "archive", "FEAT-21", "--approve");
      expect(res.code).toBe(0);
      const landText = await p.read(LANDSCAPE_REL);
      expect(landText).toContain(
        "  paymentService = softwareSystem 'payment-service' {\n" +
          "    description 'Owns payment authorization/capture'\n" +
          "    splitEngine = container 'Split engine' {\n" +
          "      technology 'Rust'\n" +
          "    }\n" +
          "  }",
      );
      // A dotted id at model top level is not LikeC4 — the child must not be spelled flat.
      expect(landText).not.toContain("paymentService.splitEngine");
      const land = await loadFile(landscapePath(p));
      expect(land.errors).toEqual([]);
      expect(land.elements.some((e) => e.id === "paymentService.splitEngine")).toBe(true);
    } finally {
      await p.destroy();
    }
  });

  it("a new parent arrives nested, children riding verbatim inside it — none of them inserted twice", async () => {
    const p = await makeProject({
      "architecture/landscape.likec4": RICH_LANDSCAPE,
      "features/FEAT-22-ledger/delta.likec4": NEW_PARENT_DELTA,
    });
    try {
      expect((await runLoam(p.workDir, "archive", "FEAT-22", "--approve")).code).toBe(0);
      const landText = await p.read(LANDSCAPE_REL);
      expect(landText).toContain(
        "  ledgerService = softwareSystem 'ledger-service' {\n" +
          "    api = container 'Ledger API'\n" +
          "    store = container 'Ledger store'\n" +
          "  }",
      );
      expect(landText).not.toContain("#FEAT-22");
      expect(landText.split("ledgerService = ").length, "the tagged child must not be inserted a second time").toBe(2);
      const land = await loadFile(landscapePath(p));
      expect(land.errors).toEqual([]);
      for (const id of ["ledgerService", "ledgerService.api", "ledgerService.store"]) {
        expect(land.elements.some((e) => e.id === id), `${id} missing from the merged landscape`).toBe(true);
      }
    } finally {
      await p.destroy();
    }
  });

  it("safety net: a merge whose result would not parse is refused at plan time and writes nothing (merge-failed)", async () => {
    // Legal inputs, unparseable merge: the delta's child is a `container`, a
    // kind the LIVING landscape's specification never declares. The spliced
    // text is valid in the delta and invalid in the landscape — exactly the
    // class of corruption the in-memory parse exists to refuse.
    const p = await makeProject({
      "architecture/landscape.likec4": LANDSCAPE,
      "features/FEAT-21-engine/delta.likec4": NESTED_CHILD_DELTA,
    });
    try {
      const before = await treeHashes(p.docsDir);
      const { res, crashed } = await runLoamSafe(p.workDir, "archive", "FEAT-21", "--approve", "--json");
      expect(crashed).toBe(false);
      expect(res!.code).toBe(1);
      const json = JSON.parse(res!.stdout);
      expect(json.ok).toBe(false);
      expect(json.error.code).toBe("merge-failed");
      expect(json.error.message).toContain("would not parse");
      expect(await treeHashes(p.docsDir), "a plan-time refusal must write nothing").toEqual(before);
      expect(p.exists("features/FEAT-21-engine/delta.likec4")).toBe(true);
    } finally {
      await p.destroy();
    }
  });
});

describe("service-grouped landscape placement (deterministic, order-independent)", () => {
  /*
   * The conflict factory this closes: every archive used to append at the one
   * point before the model's closing brace, so two concurrent archive PRs
   * conflicted in git BY CONSTRUCTION — and hand-resolving invalidated the
   * .loam-before snapshot, forcing a later unarchive through --force. Now
   * placement is service-grouped and insertion-sorted, so the KEY PROPERTY
   * holds: archiving A then B (touching different services) yields the
   * byte-identical landscape to B then A. Same-service archives still land
   * adjacently and still conflict — expected, documented, and pinned here too.
   */

  /** FEAT-30: new service split-alpha, called by payment-service. */
  const ALPHA_DELTA = `specification {
  element softwareSystem
  tag FEAT-30
}

model {
  paymentService = softwareSystem 'payment-service'
  splitAlpha = softwareSystem 'split-alpha' {
    #FEAT-30
  }

  paymentService -> splitAlpha 'Calls createAlpha' {
    #FEAT-30
    metadata { op 'createAlpha' }
  }
}

views {
  view feat_30 {
    include *
  }
}
`;

  /** FEAT-31: new service split-beta, called by checkout-web. */
  const BETA_DELTA = `specification {
  element softwareSystem
  tag FEAT-31
}

model {
  checkoutWeb = softwareSystem 'checkout-web'
  splitBeta = softwareSystem 'split-beta' {
    #FEAT-31
  }

  checkoutWeb -> splitBeta 'Calls createBeta' {
    #FEAT-31
    metadata { op 'createBeta' }
  }
}

views {
  view feat_31 {
    include *
  }
}
`;

  /** Archive both features in the given order on a fresh fixture; return the final landscape. */
  async function archiveBoth(first: string, second: string): Promise<string> {
    const p = await makeProject({
      "architecture/landscape.likec4": LANDSCAPE,
      "features/FEAT-30-alpha/delta.likec4": ALPHA_DELTA,
      "features/FEAT-31-beta/delta.likec4": BETA_DELTA,
    });
    try {
      // --approve: the ops are deliberately undefined — this is about placement.
      expect((await runLoam(p.workDir, "archive", first, "--approve")).code).toBe(0);
      expect((await runLoam(p.workDir, "archive", second, "--approve")).code).toBe(0);
      const land = await loadFile(landscapePath(p));
      expect(land.errors, "the merged landscape must parse whatever the archive order").toEqual([]);
      return await p.read(LANDSCAPE_REL);
    } finally {
      await p.destroy();
    }
  }

  it("THE KEY PROPERTY: A then B is byte-identical to B then A when the features touch different services", async () => {
    const ab = await archiveBoth("FEAT-30", "FEAT-31");
    const ba = await archiveBoth("FEAT-31", "FEAT-30");
    expect(ba, "concurrent archives touching different services must compose to the same bytes").toBe(ab);
    // The no-neighborhood elements sit in id order, whichever feature shipped first.
    expect(ab.indexOf("splitAlpha = ")).toBeGreaterThan(0);
    expect(ab.indexOf("splitAlpha = ")).toBeLessThan(ab.indexOf("splitBeta = "));
  });

  it("both edges join their source service's edge neighborhood, ordered by key past the shared anchor", async () => {
    // The living checkoutWeb -> paymentService edge touches BOTH new edges'
    // source services, so the two anchor to the SAME statement — the sort key,
    // never archive order, decides who stands closer (or the property above
    // could not hold).
    const text = await archiveBoth("FEAT-30", "FEAT-31");
    const anchor = text.indexOf("checkoutWeb -> paymentService 'Calls authorizePayment'");
    const beta = text.indexOf("checkoutWeb -> splitBeta 'Calls createBeta'");
    const alpha = text.indexOf("paymentService -> splitAlpha 'Calls createAlpha'");
    expect(anchor).toBeGreaterThan(0);
    expect(beta).toBeGreaterThan(anchor);
    expect(alpha).toBeGreaterThan(beta);
  });

  /**
   * Archive the features of `files` in `order` on a fresh fixture; assert every
   * step exits 0 and the final landscape parses; return its bytes.
   */
  async function archiveSeq(files: Record<string, string>, order: string[]): Promise<string> {
    const p = await makeProject(files);
    try {
      for (const id of order) {
        expect((await runLoam(p.workDir, "archive", id, "--approve")).code, `archive ${id} in order ${order.join(",")}`).toBe(0);
      }
      const land = await loadFile(landscapePath(p));
      expect(land.errors, `the merged landscape must parse after ${order.join(",")}`).toEqual([]);
      return await p.read(LANDSCAPE_REL);
    } finally {
      await p.destroy();
    }
  }

  /** A one-element delta bound (or not) to a service. */
  const oneElementDelta = (feat: string, id: string, title: string, boundTo?: string): string => `specification {
  element softwareSystem
  tag ${feat}
}

model {
  ${id} = softwareSystem '${title}' {
    #${feat}${boundTo === undefined ? "" : `\n    metadata { service '${boundTo}' }`}
  }
}

views {
  view v_${feat.toLowerCase().replace(/-/g, "_")} {
    include *
  }
}
`;

  it("an anchored join whose id sorts BELOW its anchor cannot reshuffle a later trailing insert (element flavor)", async () => {
    // The regression regime: `apple` joins zulu-service's neighborhood (anchored
    // AFTER zulu, though apple < zulu), and disjoint FEAT-51 adds `mango` with
    // apple < mango < zulu. A per-statement trailing walk stopped at `apple` in
    // one order and walked past `zulu` in the other — order-DEPENDENT bytes for
    // features touching DISJOINT services. Runs are the placement unit now:
    // [zulu, apple] moves as one block keyed by `zulu`.
    const files = {
      "architecture/landscape.likec4": `specification {
  element softwareSystem
  element person
}

model {
  customer = person 'Customer'
  zulu = softwareSystem 'zulu-service' {
    description 'z'
  }

  customer -> zulu 'Uses'
}

views {
  view landscape {
    include *
  }
}
`,
      "features/FEAT-50-a/delta.likec4": oneElementDelta("FEAT-50", "apple", "apple-worker", "zulu-service"),
      "features/FEAT-51-b/delta.likec4": oneElementDelta("FEAT-51", "mango", "mango-service"),
    };
    const ab = await archiveSeq(files, ["FEAT-50", "FEAT-51"]);
    const ba = await archiveSeq(files, ["FEAT-51", "FEAT-50"]);
    expect(ba, "disjoint features must compose to the same bytes whichever archived first").toBe(ab);
    // The service run stayed intact: apple directly follows zulu, mango outside.
    expect(ab.indexOf("mango = ")).toBeGreaterThan(0);
    expect(ab.indexOf("mango = ")).toBeLessThan(ab.indexOf("zulu = "));
    expect(ab.indexOf("apple = ")).toBeGreaterThan(ab.indexOf("zulu = "));
  });

  it("a trailing insert whose id falls INSIDE an anchored neighborhood lands outside it, both orders (element flavor)", async () => {
    // The mirror regime: authZ joins auth-service (anchored, authZ > authService),
    // and disjoint authX sorts BETWEEN authService and authZ. Per-statement
    // insertion-sort spliced 'x-service' into the middle of auth-service's run in
    // one order — breaking the grouping promise itself, not just byte equality.
    const files = {
      "architecture/landscape.likec4": `specification {
  element softwareSystem
}

model {
  authService = softwareSystem 'auth-service' {
    description 'auth'
  }
  webApp = softwareSystem 'web-app'

  webApp -> authService 'Calls login'
}

views {
  view landscape {
    include *
  }
}
`,
      "features/FEAT-60-a/delta.likec4": oneElementDelta("FEAT-60", "authZ", "authz-worker", "auth-service"),
      "features/FEAT-61-b/delta.likec4": oneElementDelta("FEAT-61", "authX", "x-service"),
    };
    const ab = await archiveSeq(files, ["FEAT-60", "FEAT-61"]);
    const ba = await archiveSeq(files, ["FEAT-61", "FEAT-60"]);
    expect(ba, "disjoint features must compose to the same bytes whichever archived first").toBe(ab);
    const at = (needle: string): number => ab.indexOf(needle);
    expect(at("authZ = ")).toBeGreaterThan(at("authService = "));
    expect(at("authX = "), "a foreign service must never land inside another service's run").toBeGreaterThan(at("authZ = "));
    expect(at("webApp = ")).toBeGreaterThan(at("authX = "));
  });

  it("an anchored edge whose key sorts BELOW its anchor cannot reshuffle a later trailing edge (relationship flavor)", async () => {
    // call-a (source bound to c-service) anchors after r1 though its key sorts
    // first; disjoint call-d's key falls between call-a's and r1's. The trailing
    // key-walk assumed a sorted suffix and stopped at the polluted key in one
    // order only. Clusters are the unit now — [r1, call-a] carries r1's key —
    // and both orders converge on [call-d, r1, call-a, r9].
    const files = {
      "architecture/landscape.likec4": `specification {
  element softwareSystem
}

model {
  aService = softwareSystem 'a-service'
  cService = softwareSystem 'c-service'
  dService = softwareSystem 'd-service'
  pService = softwareSystem 'p-service'

  cService -> dService 'r1'
  pService -> dService 'r9'
}

views {
  view landscape {
    include *
  }
}
`,
      "features/FEAT-70-a/delta.likec4": `specification {
  element softwareSystem
  tag FEAT-70
}

model {
  aService = softwareSystem 'a-service'
  bWorker = softwareSystem 'b-worker' {
    #FEAT-70
    metadata { service 'c-service' }
  }

  bWorker -> aService 'call-a' {
    #FEAT-70
  }
}

views {
  view f70 {
    include *
  }
}
`,
      "features/FEAT-71-b/delta.likec4": `specification {
  element softwareSystem
  tag FEAT-71
}

model {
  dService = softwareSystem 'd-service'
  bzNew = softwareSystem 'bz-new-service' {
    #FEAT-71
  }

  bzNew -> dService 'call-d' {
    #FEAT-71
  }
}

views {
  view f71 {
    include *
  }
}
`,
    };
    const ab = await archiveSeq(files, ["FEAT-70", "FEAT-71"]);
    const ba = await archiveSeq(files, ["FEAT-71", "FEAT-70"]);
    expect(ba, "disjoint features must compose to the same bytes whichever archived first").toBe(ab);
    const at = (needle: string): number => ab.indexOf(needle);
    expect(at("bzNew -> dService 'call-d'")).toBeGreaterThan(0);
    expect(at("bzNew -> dService 'call-d'")).toBeLessThan(at("cService -> dService 'r1'"));
    expect(at("bWorker -> aService 'call-a'")).toBeGreaterThan(at("cService -> dService 'r1'"));
    expect(at("pService -> dService 'r9'")).toBeGreaterThan(at("bWorker -> aService 'call-a'"));
  });

  it("three disjoint features — anchored joins below their anchors included — converge across all six archive orders", async () => {
    // The stress control: FEAT-32 anchors an element AND an edge below their
    // anchors' sort keys (the exact shape that broke the per-statement walks),
    // FEAT-30/31 add trailing elements plus edges anchoring to the same living
    // statement. Every permutation must produce one byte sequence.
    const helperDelta = `specification {
  element softwareSystem
  element person
  tag FEAT-32
}

model {
  customer = person 'Customer'
  aaHelper = softwareSystem 'aa-helper' {
    #FEAT-32
    metadata { service 'Customer' }
  }

  aaHelper -> customer 'call-c' {
    #FEAT-32
  }
}

views {
  view f32 {
    include *
  }
}
`;
    const files = {
      "architecture/landscape.likec4": LANDSCAPE,
      "features/FEAT-30-alpha/delta.likec4": ALPHA_DELTA,
      "features/FEAT-31-beta/delta.likec4": BETA_DELTA,
      "features/FEAT-32-helper/delta.likec4": helperDelta,
    };
    const ids = ["FEAT-30", "FEAT-31", "FEAT-32"];
    const orders: string[][] = [];
    for (const a of ids) for (const b of ids) for (const c of ids) {
      if (new Set([a, b, c]).size === 3) orders.push([a, b, c]);
    }
    // Serial on purpose: runLoam chdirs and intercepts the console in-process.
    const results: string[] = [];
    for (const o of orders) results.push(await archiveSeq(files, o));
    for (let i = 1; i < results.length; i += 1) {
      expect(results[i], `order ${orders[i]!.join(",")} must match order ${orders[0]!.join(",")}`).toBe(results[0]);
    }
    const text = results[0]!;
    // The anchored element joined its run; the anchored edge sits right after
    // its anchor, ahead of the higher-keyed statement that follows.
    expect(text.indexOf("aaHelper = ")).toBeGreaterThan(text.indexOf("customer = "));
    expect(text.indexOf("aaHelper = ")).toBeLessThan(text.indexOf("checkoutWeb = "));
    expect(text.indexOf("aaHelper -> customer 'call-c'")).toBeGreaterThan(text.indexOf("customer -> checkoutWeb 'Uses'"));
    expect(text.indexOf("aaHelper -> customer 'call-c'")).toBeLessThan(text.indexOf("checkoutWeb -> paymentService"));
  });

  it("a statement written on the `model {` line is displaced onto its own line — not refused, not spliced before the keyword", async () => {
    // Legal LikeC4 that validated clean but refused to archive: the trailing
    // walk chose 'insert before zulu' and the unclamped line start pointed at
    // the `model {` line itself, splicing the block before the keyword. The
    // insert now lands bare at the statement's start, pushing it to a fresh line.
    const files = {
      "architecture/landscape.likec4": `specification {
  element softwareSystem
}

model { zulu = softwareSystem 'zulu-service'
}

views {
  view landscape {
    include *
  }
}
`,
      "features/FEAT-51-b/delta.likec4": oneElementDelta("FEAT-51", "mango", "mango-service"),
    };
    const text = await archiveSeq(files, ["FEAT-51"]);
    expect(text.indexOf("mango = ")).toBeGreaterThan(text.indexOf("model {"));
    expect(text.indexOf("mango = ")).toBeLessThan(text.indexOf("zulu = "));
  });

  it("a landscape starting as one-line `model {}` composes byte-identically in either archive order", async () => {
    // The first archive's insert is bare (the braces share a line) and brings
    // its own newlines; every later insert is line-start based. Sequential
    // application keeps the wrapping uniform, so the spacing cannot diverge by
    // which feature archived first.
    const edgeDelta = `specification {
  element softwareSystem
  tag FEAT-80
}

model {
  alphaSvc = softwareSystem 'alpha-service' {
    #FEAT-80
  }
  gammaSvc = softwareSystem 'gamma-service' {
    #FEAT-80
  }

  alphaSvc -> gammaSvc 'call-g' {
    #FEAT-80
  }
}

views {
  view f80 {
    include *
  }
}
`;
    const files = {
      "architecture/landscape.likec4": `specification {
  element softwareSystem
}

model {}

views {
  view landscape {
    include *
  }
}
`,
      "features/FEAT-80-a/delta.likec4": edgeDelta,
      "features/FEAT-81-b/delta.likec4": oneElementDelta("FEAT-81", "betaSvc", "beta-service"),
    };
    const ab = await archiveSeq(files, ["FEAT-80", "FEAT-81"]);
    const ba = await archiveSeq(files, ["FEAT-81", "FEAT-80"]);
    expect(ba, "an initially empty one-line model must not make spacing archive-order-dependent").toBe(ab);
    expect(ab).toContain("model {\n");
  });

  it("two declarations sharing one line refuse the merge loudly — placement cannot see the second, so it must not splice blind", async () => {
    // LikeC4 accepts `a = kind 'x'  b = kind 'y'` on one line, but the splice
    // map's statement head runs to the newline, so `zulu` rides invisibly
    // inside `apple`'s span: an element bound to zulu-service would miss its
    // neighborhood and a bodyless `zulu` gaining a body could wrap the wrong
    // bytes. Mechanical refusal, nothing written.
    const files = {
      "architecture/landscape.likec4": `specification {
  element softwareSystem
}

model {
  apple = softwareSystem 'apple-service'  zulu = softwareSystem 'zulu-service'
}

views {
  view landscape {
    include *
  }
}
`,
      "features/FEAT-51-b/delta.likec4": oneElementDelta("FEAT-51", "mango", "mango-service"),
    };
    const p = await makeProject(files);
    try {
      const before = await treeHashes(p.docsDir);
      const res = await runLoam(p.workDir, "archive", "FEAT-51", "--approve", "--json");
      expect(res.code).toBe(1);
      const json = JSON.parse(res.stdout);
      expect(json.ok).toBe(false);
      expect(json.error.code).toBe("merge-failed");
      expect(json.error.message).toContain("own line");
      expect(await treeHashes(p.docsDir), "a plan-time refusal must write nothing").toEqual(before);
    } finally {
      await p.destroy();
    }
  });

  it("two features touching the SAME service land adjacently after its last element — that concurrency still conflicts, by design", async () => {
    const retryDelta = `specification {
  element softwareSystem
  tag FEAT-40
}

model {
  payRetry = softwareSystem 'Payment Retry Worker' {
    #FEAT-40
    metadata { service 'payment-service' }
  }
}

views {
  view feat_40 {
    include *
  }
}
`;
    const auditDelta = retryDelta
      .replaceAll("FEAT-40", "FEAT-41")
      .replaceAll("payRetry", "payAudit")
      .replaceAll("Payment Retry Worker", "Payment Audit");
    const p = await makeProject({
      "architecture/landscape.likec4": LANDSCAPE,
      "features/FEAT-40-retry/delta.likec4": retryDelta,
      "features/FEAT-41-audit/delta.likec4": auditDelta,
    });
    try {
      expect((await runLoam(p.workDir, "archive", "FEAT-40", "--approve")).code).toBe(0);
      expect((await runLoam(p.workDir, "archive", "FEAT-41", "--approve")).code).toBe(0);
      const text = await p.read(LANDSCAPE_REL);
      // Each element binds to payment-service, so each anchors after that
      // service's last element — the first archive's addition included.
      expect(text).toContain(
        "  paymentService = softwareSystem 'payment-service' {\n" +
          "    description 'Owns payment authorization/capture'\n" +
          "  }\n" +
          "  payRetry = softwareSystem 'Payment Retry Worker' {\n" +
          "    metadata { service 'payment-service' }\n" +
          "  }\n" +
          "  payAudit = softwareSystem 'Payment Audit' {\n" +
          "    metadata { service 'payment-service' }\n" +
          "  }\n",
      );
      const land = await loadFile(landscapePath(p));
      expect(land.errors).toEqual([]);
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

describe("addressing a feature by its directory name", () => {
  // The regression this pins: the raw argument used to flow into the tag filter
  // and featureCoherence, so `archive FEAT-1-split` matched `#FEAT-1-split`
  // against tags spelled `#FEAT-1` — a spurious delta.nothing-tagged gate — and
  // the self-exclusion scans reported the feature conflicting with itself.
  it("produces the identical dry-run plan as the canonical id", async () => {
    const p = await makeProject(coherentFixture());
    try {
      const byId = await runLoam(p.workDir, "archive", "FEAT-1", "--dry-run", "--json");
      const byDir = await runLoam(p.workDir, "archive", "FEAT-1-split", "--dry-run", "--json");
      expect(byId.code).toBe(0);
      expect(byDir.code).toBe(0);
      expect(JSON.parse(byDir.stdout)).toEqual(JSON.parse(byId.stdout));
      expect(JSON.parse(byDir.stdout).feature).toBe("FEAT-1");
    } finally {
      await p.destroy();
    }
  });

  it("does not report the feature's own additions as a cross-feature conflict", async () => {
    // No delta.likec4, so nothing-tagged cannot mask the activeAdditions path:
    // an ADDED requirement absent from the living spec consults the in-flight
    // scan, and a raw dirName used to fail the `feature.id !== arg` exclusion.
    const p = await makeProject({
      // The service has to exist: a delta addressing a service the fleet does
      // not have is now `delta.service-unknown`, which gates archive so a
      // typo'd `--touches` cannot create a service out of the misspelling.
      // Its living requirement is a different one — the ADDED requirement below
      // must still be absent, or activeAdditions is never consulted.
      "services/core-service/spec.md": `---
service: core-service
owner: core
---
# core-service

## Requirements

### Requirement: Serve the thing
The service SHALL serve the thing.

#### Scenario: It serves
- **Given** a thing
- **When** asked
- **Then** it is served
`,
      "features/FEAT-2-solo/specs/core-service/spec.md": `# core-service — delta for FEAT-2

## ADDED Requirements

### Requirement: Do the thing
The service SHALL do the thing.

#### Scenario: It does
- **Given** a thing
- **When** asked
- **Then** it is done
`,
      "features/FEAT-2-solo/intent.md": AUTHORED_INTENT,
    });
    try {
      const res = await runLoam(p.workDir, "archive", "FEAT-2-solo", "--dry-run", "--json");
      expect(res.code).toBe(0);
      const json = JSON.parse(res.stdout);
      expect(json.feature).toBe("FEAT-2");
      expect(JSON.stringify(json.warnings)).not.toContain("also added by");
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

  it("--approve overrides the gate, names each gating issue it is overriding, and archives", async () => {
    const res = await runLoam(p.workDir, "archive", "FEAT-1", "--approve");
    expect(res.code).toBe(0);
    // Gating issues only, and by name: overriding is a decision, and the output
    // must say exactly what was decided against.
    expect(res.out).toContain("archiving despite 2 gating issue(s) (--approve)");
    expect(res.out).toContain("createSplit");
    expect(p.exists("features/FEAT-1-split")).toBe(false);
    expect(p.exists("features/archive/FEAT-1-split/delta.likec4")).toBe(true);
    expect(p.exists("services/payment-split-service/spec.md")).toBe(true);
  });

  it("advisory warnings never block: archive prints them and proceeds", async () => {
    // Severity and gating are two axes (issue.ts): the gate refuses on gating
    // issues — errors, plus the rare warning marked `gates` — and advisory
    // warnings only inform. This fixture's warns are all advisory: the
    // demonstration rides the unconsumed-operation warn (createSplit is defined
    // and governed but no architecture edge calls it), which stayed advisory
    // when the baseline codes became gating — so the fixture carries an
    // authored intent.md to keep the now-gating intent.empty out of the picture.
    const wp = await makeProject({
      "architecture/landscape.likec4": LANDSCAPE,
      "features/FEAT-9-split/delta.likec4": WARN_ONLY_DELTA,
      "features/FEAT-9-split/specs/payment-split-service/spec.md": FEATURE_SPEC,
      "features/FEAT-9-split/specs/payment-split-service/openapi.yaml": coherentFixture()[
        "features/FEAT-1-split/specs/payment-split-service/openapi.yaml"
      ]!,
      "features/FEAT-9-split/intent.md": AUTHORED_INTENT,
    });
    try {
      const v = await runLoam(wp.workDir, "validate", "--feature", "FEAT-9");
      expect(v.code).toBe(0);
      const a = await runLoam(wp.workDir, "archive", "FEAT-9");
      expect(a.code).toBe(0);
      expect(a.out).toContain("warning(s) (non-blocking)");
      expect(a.out).toContain("createSplit");
      expect(a.out).not.toContain("BLOCKED");
      expect(wp.exists("features/FEAT-9-split")).toBe(false);
      expect(wp.exists("features/archive/FEAT-9-split/delta.likec4")).toBe(true);
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

  it("a broken delta.likec4 is refused even with --approve — an unreadable axis cannot be merged", async () => {
    // --approve overrides loam's judgment about coherence, never its ability to
    // read an axis. The old behaviour ("skipped, merged the rest") silently
    // dropped one merge axis in the one command engineered against quiet
    // partial merges.
    const files = coherentFixture();
    files["features/FEAT-1-split/delta.likec4"] = "model { this is not likec4\n";
    const p = await makeProject(files);
    try {
      const before = await treeHashes(p.docsDir);
      const { res, crashed } = await runLoamSafe(p.workDir, "archive", "FEAT-1", "--approve");
      expect(crashed).toBe(false);
      expect(res!.code).toBe(1);
      expect(res!.out).toContain("architecture axis cannot be merged");
      // The refusal is plan-phase: nothing was written, nothing was moved.
      expect(await treeHashes(p.docsDir)).toEqual(before);
      expect(p.exists("features/archive/FEAT-1-split")).toBe(false);
    } finally {
      await p.destroy();
    }
  });
});

describe("living requirements outside '## Requirements' (the duplication guard)", () => {
  /*
   * The reproduced corruption: splitSpec cuts the intro at the first
   * `\n## Requirements` — or keeps the WHOLE text as intro when absent — while
   * parseRequirements collects requirements from every section. The merged file
   * is intro + `## Requirements` + every requirement, so a living requirement
   * under a prose heading lands in the file TWICE, and the next archive's
   * MODIFIED replaces only the first copy. The fix is a plan-time refusal, not
   * a programmatic excision of intro blocks.
   */

  /** A living spec whose second requirement strayed under a prose heading. */
  const LIVING_SPEC_STRAYED = `---
service: payment-service
status: verified
---

# payment-service

## Requirements

### Requirement: Authorize a payment
The service SHALL authorize a payment before capture.

#### Scenario: Successful authorization
- **Given** a valid card
- **When** authorization is requested
- **Then** the payment is authorized

## Behavior

### Requirement: Capture a payment
The service SHALL capture an authorized payment.

#### Scenario: Capture happens
- **Given** an authorized payment
- **When** capture is requested
- **Then** the payment is captured
`;

  /** A perfectly well-formed delta — the breach is in the LIVING file, not the feature. */
  const CLEAN_DELTA = `# payment-service — delta for FEAT-15

## MODIFIED Requirements

### Requirement: Authorize a payment
The service SHALL authorize a payment within 2 seconds.

#### Scenario: Fast authorization
- **Given** a valid card
- **When** authorization is requested
- **Then** it completes within 2 seconds
`;

  function strayedFixture(): Record<string, string> {
    // The delta pins its MODIFIED requirement and the feature states its Why:
    // the coherence gate (delta.baseline-missing, intent.empty) runs BEFORE the
    // merge plan, and what this describe pins is the plan-time duplication
    // refusal — the fixture must get that far. The strayed requirement's digest
    // is unaffected by which heading it sits under, so one pin serves both the
    // strayed and the heading-less living variants.
    return {
      "services/payment-service/spec.md": LIVING_SPEC_STRAYED,
      "features/FEAT-15-faster/specs/payment-service/spec.md": CLEAN_DELTA.replace(
        "### Requirement: Authorize a payment\n",
        `### Requirement: Authorize a payment\nBased-On: ${pinFor(LIVING_SPEC_STRAYED, "Authorize a payment")}\n`,
      ),
      "features/FEAT-15-faster/intent.md": AUTHORED_INTENT,
    };
  }

  it("refuses the merge that would duplicate the strayed requirement, and touches nothing", async () => {
    const p = await makeProject(strayedFixture());
    try {
      const before = await treeHashes(p.docsDir);
      const res = await runLoam(p.workDir, "archive", "FEAT-15");
      expect(res.code).toBe(1);
      expect(res.out).toContain("outside '## Requirements'");
      expect(res.out).toContain("Capture a payment");
      expect(res.out).toContain("twice");
      expect(await treeHashes(p.docsDir)).toEqual(before);
    } finally {
      await p.destroy();
    }
  });

  it("--approve does not override it — the duplication is mechanical, not a judgment call", async () => {
    const p = await makeProject(strayedFixture());
    try {
      const res = await runLoam(p.workDir, "archive", "FEAT-15", "--approve");
      expect(res.code).toBe(1);
      expect(res.out).toContain("outside '## Requirements'");
      expect(p.exists("features/archive/FEAT-15-faster")).toBe(false);
    } finally {
      await p.destroy();
    }
  });

  it("a living spec with NO '## Requirements' heading at all is the same refusal", async () => {
    // splitSpec keeps the whole text as intro here, so EVERY requirement would double.
    const files = strayedFixture();
    files["services/payment-service/spec.md"] = LIVING_SPEC_STRAYED.replace("## Requirements\n\n", "");
    const p = await makeProject(files);
    try {
      const res = await runLoam(p.workDir, "archive", "FEAT-15");
      expect(res.code).toBe(1);
      expect(res.out).toContain("outside '## Requirements'");
    } finally {
      await p.destroy();
    }
  });

  it("--json names the refusal: living-outside-requirements, with the issue attached", async () => {
    const p = await makeProject(strayedFixture());
    try {
      const res = await runLoam(p.workDir, "archive", "FEAT-15", "--json");
      expect(res.code).toBe(1);
      const json = JSON.parse(res.out);
      expect(json.ok).toBe(false);
      expect(json.error.code).toBe("living-outside-requirements");
      expect(json.issues).toHaveLength(1);
      expect(json.issues[0]).toMatchObject({
        severity: "error",
        code: "living.requirement-outside-requirements",
        subject: "payment-service",
      });
      expect(json.issues[0].message).toContain("Capture a payment");
    } finally {
      await p.destroy();
    }
  });
});

describe("the living-spec rewrite touches only the requirements run", () => {
  /*
   * The reproduced loss: the old cut kept intro + re-serialized requirements
   * and nothing else, so any prose the guard had no requirement to hang a
   * refusal on — a trailing `## Notes` section, prose under the
   * `## Requirements` heading itself — was silently destroyed by a green
   * archive. And the cut was a substring `indexOf("\n## Requirements")`: a
   * PREFIX match that also hit `## Requirements Extra`. The fix rewrites only
   * the requirements run, with head and tail preserved byte-for-byte, and one
   * exported heading definition (spec.ts isRequirementsHeading) shared by the
   * cut, the stray guard, and delta-shape's quoting exemption.
   */

  const NOTES_SECTION = `## Notes

Settlement timing was agreed with finance in 2019.

- reconciliation depends on T+2
- see ADR-7 before touching it
`;

  const PROSE_UNDER_HEADING = "Ordered by risk, highest first.\n\n";

  /** LIVING_SPEC_TWO_REQS with prose under the heading and a trailing prose section. */
  const LIVING_SPEC_WITH_PROSE =
    LIVING_SPEC_TWO_REQS.replace("## Requirements\n\n", `## Requirements\n\n${PROSE_UNDER_HEADING}`) +
    "\n" +
    NOTES_SECTION;

  function proseFixture(living: string): Record<string, string> {
    // The delta is pinned against THIS test's living text (see pinAllKinds):
    // the pins keep the now-gating baseline codes quiet, and because the digest
    // is content-only they stay valid across the prose, BOM and CRLF variants.
    return {
      "services/payment-service/spec.md": living,
      "services/payment-service/openapi.yaml": LIVING_OPENAPI,
      "features/FEAT-7-rework/specs/payment-service/spec.md": pinAllKinds(living),
      "features/FEAT-7-rework/intent.md": AUTHORED_INTENT,
    };
  }

  it("a trailing '## Notes' section survives a real archive byte-identically", async () => {
    const p = await makeProject(proseFixture(LIVING_SPEC_WITH_PROSE));
    try {
      expect((await runLoam(p.workDir, "archive", "FEAT-7")).code).toBe(0);
      const merged = await p.read("services/payment-service/spec.md");
      expect(
        merged.endsWith(NOTES_SECTION),
        "everything from the section's end to EOF must be a byte-for-byte slice of the input",
      ).toBe(true);
      expect(merged.split("## Notes")).toHaveLength(2);
      // The merge itself still happened inside the section.
      const reqs = parseRequirements(merged);
      expect(reqs.map((r) => r.name)).toEqual(["Authorize a payment", "Refund a payment"]);
      expect(merged).not.toContain("Legacy settlement quirk");
    } finally {
      await p.destroy();
    }
  });

  it("prose between the '## Requirements' heading and the first requirement survives byte-identically", async () => {
    const p = await makeProject(proseFixture(LIVING_SPEC_WITH_PROSE));
    try {
      expect((await runLoam(p.workDir, "archive", "FEAT-7")).code).toBe(0);
      const merged = await p.read("services/payment-service/spec.md");
      const head = LIVING_SPEC_WITH_PROSE.slice(0, LIVING_SPEC_WITH_PROSE.indexOf("### Requirement:"));
      expect(head).toContain(PROSE_UNDER_HEADING);
      expect(
        merged.startsWith(head),
        "everything before the first requirement — intro, heading, prose under it — must be a byte-for-byte slice of the input",
      ).toBe(true);
    } finally {
      await p.destroy();
    }
  });

  it("'## Requirements Extra' is NOT the requirements section: as prose before the real one, it survives", async () => {
    // The old prefix match cut the intro at `\n## Requirements Extra`,
    // destroying that whole section AND the real heading below it.
    const extra = `## Requirements Extra

Free-form guidance that is not the requirements section.

`;
    const living = LIVING_SPEC_TWO_REQS.replace("## Requirements\n", `${extra}## Requirements\n`);
    const p = await makeProject(proseFixture(living));
    try {
      expect((await runLoam(p.workDir, "archive", "FEAT-7")).code).toBe(0);
      const merged = await p.read("services/payment-service/spec.md");
      expect(merged).toContain(extra);
      const head = living.slice(0, living.indexOf("### Requirement:"));
      expect(merged.startsWith(head)).toBe(true);
      expect(parseRequirements(merged).map((r) => r.name)).toEqual(["Authorize a payment", "Refund a payment"]);
    } finally {
      await p.destroy();
    }
  });

  it("'## Requirements Extra' is NOT the requirements section: requirements under it are strayed, and refused", async () => {
    const living = LIVING_SPEC_TWO_REQS.replace("## Requirements\n", "## Requirements Extra\n");
    const p = await makeProject(proseFixture(living));
    try {
      const res = await runLoam(p.workDir, "archive", "FEAT-7");
      expect(res.code).toBe(1);
      expect(res.out).toContain("outside '## Requirements'");
      expect(res.out).toContain("## Requirements Extra");
    } finally {
      await p.destroy();
    }
  });

  it("a case-variant '## requirements' heading IS the requirements section, preserved in its own casing", async () => {
    // One definition means one tolerance: delta-shape has always exempted the
    // heading case-insensitively (a delta quoting the living state), so the
    // guard and the rewrite now read it the same way instead of refusing.
    const living = LIVING_SPEC_TWO_REQS.replace("## Requirements\n", "## requirements\n");
    const p = await makeProject(proseFixture(living));
    try {
      expect((await runLoam(p.workDir, "archive", "FEAT-7")).code).toBe(0);
      const merged = await p.read("services/payment-service/spec.md");
      expect(merged).toContain("\n## requirements\n");
      expect(merged).not.toContain("\n## Requirements\n");
      expect(parseRequirements(merged).map((r) => r.name)).toEqual(["Authorize a payment", "Refund a payment"]);
    } finally {
      await p.destroy();
    }
  });

  it("prose between requirements rides the previous requirement's last scenario and survives the rewrite", async () => {
    // Pinned attribution, not aspiration: parseRequirements pushes body lines
    // onto whatever is open, so prose between requirement A and requirement B
    // is A's last scenario's body and survives re-serialization there. A
    // MODIFIED of A would replace it along with the rest of A — that is the
    // documented wholesale-replace semantics, not a new loss.
    const note = "Interleaved operator note: settlement and authorization share a ledger row.";
    const living = LIVING_SPEC_TWO_REQS.replace(
      "\n### Requirement: Legacy settlement quirk",
      `\n${note}\n\n### Requirement: Legacy settlement quirk`,
    );
    const addOnly = `# payment-service — delta for FEAT-7

## ADDED Requirements

### Requirement: Refund a payment
The service SHALL refund an authorized payment on request.

#### Scenario: Refund succeeds
- **Given** a captured payment
- **When** a refund is requested
- **Then** the amount is returned to the customer
`;
    const p = await makeProject({
      "services/payment-service/spec.md": living,
      "features/FEAT-7-rework/specs/payment-service/spec.md": addOnly,
      "features/FEAT-7-rework/intent.md": AUTHORED_INTENT,
    });
    try {
      expect((await runLoam(p.workDir, "archive", "FEAT-7")).code).toBe(0);
      const merged = await p.read("services/payment-service/spec.md");
      expect(merged.split(note), "the interleaved prose must survive exactly once").toHaveLength(2);
      const reqs = parseRequirements(merged);
      expect(reqs.map((r) => r.name)).toEqual([
        "Authorize a payment",
        "Legacy settlement quirk",
        "Refund a payment",
      ]);
      const auth = reqs[0]!;
      expect(auth.scenarios.at(-1)!.lines.join("\n")).toContain(note);
    } finally {
      await p.destroy();
    }
  });

  it("TWO '## Requirements' headings are refused at plan time — the rewrite cannot choose a section", async () => {
    const living = `${LIVING_SPEC_TWO_REQS}\n## Requirements\n\n### Requirement: Duplicate section dweller\nThe service SHALL not lose this text.\n\n#### Scenario: It stays\n- **Then** it stays\n`;
    const p = await makeProject(proseFixture(living));
    try {
      const before = await treeHashes(p.docsDir);
      const res = await runLoam(p.workDir, "archive", "FEAT-7", "--json");
      expect(res.code).toBe(1);
      const json = JSON.parse(res.stdout);
      expect(json.ok).toBe(false);
      expect(json.error.code).toBe("merge-failed");
      expect(json.error.message).toContain("2 '## Requirements' headings");
      expect(await treeHashes(p.docsDir), "the refusal is plan-phase: nothing written").toEqual(before);
    } finally {
      await p.destroy();
    }
  });

  it("a BOM'd living spec merges without regressing the parser, and keeps its BOM", async () => {
    const p = await makeProject(proseFixture(`\uFEFF${LIVING_SPEC_WITH_PROSE}`));
    try {
      expect((await runLoam(p.workDir, "archive", "FEAT-7")).code).toBe(0);
      const merged = await p.read("services/payment-service/spec.md");
      expect(merged.charCodeAt(0), "head is a raw slice — the BOM byte is the author's").toBe(0xfeff);
      expect(merged.endsWith(NOTES_SECTION)).toBe(true);
      expect(parseRequirements(merged).map((r) => r.name)).toEqual(["Authorize a payment", "Refund a payment"]);
    } finally {
      await p.destroy();
    }
  });

  it("a CRLF living spec keeps CRLF head and tail byte-for-byte; only the rewritten run is LF-normalized", async () => {
    const living = LIVING_SPEC_WITH_PROSE.replaceAll("\n", "\r\n");
    const p = await makeProject(proseFixture(living));
    try {
      expect((await runLoam(p.workDir, "archive", "FEAT-7")).code).toBe(0);
      const merged = await p.read("services/payment-service/spec.md");
      const head = living.slice(0, living.indexOf("### Requirement:"));
      expect(head).toContain("\r\n");
      expect(merged.startsWith(head)).toBe(true);
      expect(merged.endsWith(NOTES_SECTION.replaceAll("\n", "\r\n"))).toBe(true);
      expect(parseRequirements(merged).map((r) => r.name)).toEqual(["Authorize a payment", "Refund a payment"]);
    } finally {
      await p.destroy();
    }
  });
});

describe("overwriting an existing living operation (openapi.op-modified)", () => {
  /*
   * A feature's openapi.yaml restates the full API, and only the operationId
   * set-difference is examined elsewhere — so a changed schema/params/response
   * on an EXISTING operation merges with zero signal while mergeOpenapiPaths
   * overwrites the living method wholesale. The warn is set membership +
   * deep-equal only: no schema-diff semantics.
   */
  function redeclareFixture(featureOpenapi: string): Record<string, string> {
    // Every variant here restates the living /payments/authorize slot, so the
    // feature contract carries the x-loam-based-on pins `loam rebase` would
    // write: openapi.baseline-missing now gates archive, and what this describe
    // pins is the op-modified WARN a pinned edit still gets on merge.
    return {
      "architecture/landscape.likec4": LANDSCAPE,
      "services/payment-service/spec.md": LIVING_SPEC,
      "services/payment-service/openapi.yaml": LIVING_OPENAPI,
      "features/FEAT-4-idem/delta.likec4": REDECLARE_DELTA,
      "features/FEAT-4-idem/specs/payment-service/spec.md": REDECLARE_SPEC,
      "features/FEAT-4-idem/specs/payment-service/openapi.yaml": pinOpenapi(featureOpenapi, LIVING_OPENAPI),
      "features/FEAT-4-idem/intent.md": AUTHORED_INTENT,
    };
  }

  it("a changed existing operation warns by operationId, does not block, and still merges", async () => {
    // REDECLARE_OPENAPI redefines authorizePayment with a different summary.
    const p = await makeProject(redeclareFixture(REDECLARE_OPENAPI));
    try {
      const res = await runLoam(p.workDir, "archive", "FEAT-4");
      expect(res.code).toBe(0);
      expect(res.out).toContain("overwrites 'authorizePayment' (post /payments/authorize)");
      const text = await p.read("services/payment-service/openapi.yaml");
      expect(text).toContain("idempotency key");
    } finally {
      await p.destroy();
    }
  });

  it("an identical restatement of the living operation is silent", async () => {
    const p = await makeProject(redeclareFixture(LIVING_OPENAPI));
    try {
      const res = await runLoam(p.workDir, "archive", "FEAT-4");
      expect(res.code).toBe(0);
      expect(res.out).not.toContain("overwrites");
    } finally {
      await p.destroy();
    }
  });

  it("the warning is in the --json envelope, dry run included", async () => {
    const p = await makeProject(redeclareFixture(REDECLARE_OPENAPI));
    try {
      const res = await runLoam(p.workDir, "archive", "FEAT-4", "--dry-run", "--json");
      expect(res.code).toBe(0);
      const json = JSON.parse(res.out);
      expect(json.ok).toBe(true);
      expect(json.archived).toBe(false);
      const warn = json.warnings.find((w: { code: string }) => w.code === "openapi.op-modified");
      expect(warn).toMatchObject({ severity: "warn", subject: "payment-service" });
      expect(warn.message).toContain("authorizePayment");
    } finally {
      await p.destroy();
    }
  });
});

describe("openapi components ride the merged operations' $refs", () => {
  /*
   * The closed loss: mergeOpenapiPaths merged ONLY the `paths` map, so a
   * feature operation whose schema lived in the FEATURE's `components:` landed
   * in the living document with dangling $refs — nothing merged or checked the
   * components section. Now the $ref closure of the merged path items rides
   * along: copied from the feature doc (recursively — a component's own refs
   * pull in more), identical living components left alone, differing ones
   * overwritten under the op-modified discipline (openapi.component-modified,
   * warn), and a ref resolving in NEITHER document gates the archive
   * (openapi.ref-unresolved, --approve overrides). External refs (anything not
   * starting '#/') are out of scope: untouched, never gated.
   */

  const FEATURE_OPENAPI_WITH_REFS = `openapi: 3.1.0
info:
  title: payment-service
  version: "1.0"
paths:
  /payments/refund:
    post:
      operationId: refundPayment
      summary: Refund a payment
      requestBody:
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/RefundRequest'
      responses:
        "200":
          description: Refunded
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Refund'
components:
  schemas:
    RefundRequest:
      type: object
      properties:
        paymentId:
          type: string
    Refund:
      type: object
      properties:
        amount:
          $ref: '#/components/schemas/Money'
    Money:
      type: object
      properties:
        currency:
          type: string
        amount:
          type: number
    Unrelated:
      type: object
      description: defined in the feature doc but referenced by no merged operation
`;

  /** The living OpenAPI already holding Money — identical to the feature's version. */
  const LIVING_OPENAPI_MONEY_SAME = `${LIVING_OPENAPI}components:
  schemas:
    Money:
      type: object
      properties:
        currency:
          type: string
        amount:
          type: number
`;

  /** The living OpenAPI holding a DIFFERENT Money (no amount property). */
  const LIVING_OPENAPI_MONEY_DIFFERS = `${LIVING_OPENAPI}components:
  schemas:
    Money:
      type: object
      properties:
        currency:
          type: string
`;

  function componentsFixture(
    featureOpenapi: string,
    livingOpenapi: string = LIVING_OPENAPI,
  ): Record<string, string> {
    // /payments/refund is a new slot in every variant, so no baseline pin is
    // due; the intent.md keeps the now-gating intent.empty out of fixtures
    // whose subject is the components closure.
    return {
      "architecture/landscape.likec4": LANDSCAPE,
      "services/payment-service/spec.md": LIVING_SPEC,
      "services/payment-service/openapi.yaml": livingOpenapi,
      "features/FEAT-3-refunds/delta.likec4": REFUND_DELTA,
      "features/FEAT-3-refunds/specs/payment-service/spec.md": REFUND_SPEC,
      "features/FEAT-3-refunds/specs/payment-service/openapi.yaml": featureOpenapi,
      "features/FEAT-3-refunds/intent.md": AUTHORED_INTENT,
    };
  }

  it("a new operation's schema refs land in the living components — the whole nested closure, nothing more", async () => {
    const p = await makeProject(componentsFixture(FEATURE_OPENAPI_WITH_REFS));
    try {
      expect((await runLoam(p.workDir, "archive", "FEAT-3")).code).toBe(0);
      const doc = parse(await p.read("services/payment-service/openapi.yaml"));
      expect(doc.paths["/payments/refund"].post.operationId).toBe("refundPayment");
      expect(doc.components.schemas.RefundRequest).toBeDefined();
      expect(doc.components.schemas.Refund).toBeDefined();
      expect(
        doc.components.schemas.Money,
        "Refund references Money — a component's own $refs must pull their targets in too",
      ).toBeDefined();
      expect(
        doc.components.schemas.Unrelated,
        "the closure is of the MERGED content — an unreferenced feature component must stay behind",
      ).toBeUndefined();
    } finally {
      await p.destroy();
    }
  });

  it("a needed component the living doc already has identically is untouched, with no warning", async () => {
    const p = await makeProject(componentsFixture(FEATURE_OPENAPI_WITH_REFS, LIVING_OPENAPI_MONEY_SAME));
    try {
      const res = await runLoam(p.workDir, "archive", "FEAT-3");
      expect(res.code).toBe(0);
      expect(res.out).not.toContain("overwrites component");
      const doc = parse(await p.read("services/payment-service/openapi.yaml"));
      expect(doc.components.schemas.Money.properties.amount).toEqual({ type: "number" });
      expect(doc.components.schemas.RefundRequest).toBeDefined();
    } finally {
      await p.destroy();
    }
  });

  it("a differing living component is overwritten wholesale, and the plan says so by name", async () => {
    const p = await makeProject(componentsFixture(FEATURE_OPENAPI_WITH_REFS, LIVING_OPENAPI_MONEY_DIFFERS));
    try {
      const res = await runLoam(p.workDir, "archive", "FEAT-3");
      expect(res.code).toBe(0);
      expect(res.out).toContain("overwrites component schemas/Money");
      const doc = parse(await p.read("services/payment-service/openapi.yaml"));
      expect(
        doc.components.schemas.Money.properties.amount,
        "the overwrite is wholesale — the feature's version of the component lands",
      ).toEqual({ type: "number" });
    } finally {
      await p.destroy();
    }
  });

  it("openapi.component-modified is in the --json envelope, dry run included", async () => {
    const p = await makeProject(componentsFixture(FEATURE_OPENAPI_WITH_REFS, LIVING_OPENAPI_MONEY_DIFFERS));
    try {
      const res = await runLoam(p.workDir, "archive", "FEAT-3", "--dry-run", "--json");
      expect(res.code).toBe(0);
      const json = JSON.parse(res.out);
      const warn = json.warnings.find((w: { code: string }) => w.code === "openapi.component-modified");
      expect(warn).toMatchObject({ severity: "warn", subject: "payment-service", gates: false });
      expect(warn.message).toContain("schemas/Money");
    } finally {
      await p.destroy();
    }
  });

  const FEATURE_OPENAPI_GHOST_REF = `openapi: 3.1.0
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
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Ghost'
`;

  it("a $ref resolving in neither document gates the archive, naming the ref and where it is referenced from", async () => {
    const p = await makeProject(componentsFixture(FEATURE_OPENAPI_GHOST_REF));
    try {
      const before = await treeHashes(p.docsDir);
      const res = await runLoam(p.workDir, "archive", "FEAT-3");
      expect(res.code).toBe(1);
      expect(res.out).toContain("BLOCKED");
      expect(res.out).toContain("#/components/schemas/Ghost");
      expect(res.out).toContain("/payments/refund");
      expect(await treeHashes(p.docsDir), "the refusal is plan-phase: nothing written").toEqual(before);
      // A dry run is gated too — a plan for a refused merge describes nothing.
      expect((await runLoam(p.workDir, "archive", "FEAT-3", "--dry-run")).code).toBe(1);
    } finally {
      await p.destroy();
    }
  });

  it("the gate speaks --json: not-coherent, with openapi.ref-unresolved attached and gates resolved", async () => {
    const p = await makeProject(componentsFixture(FEATURE_OPENAPI_GHOST_REF));
    try {
      const res = await runLoam(p.workDir, "archive", "FEAT-3", "--json");
      expect(res.code).toBe(1);
      const json = JSON.parse(res.stdout);
      expect(json.ok).toBe(false);
      expect(json.error.code).toBe("not-coherent");
      const issue = json.issues.find((i: { code: string }) => i.code === "openapi.ref-unresolved");
      expect(issue).toMatchObject({ severity: "error", gates: true, subject: "payment-service" });
      expect(issue.message).toContain("#/components/schemas/Ghost");
    } finally {
      await p.destroy();
    }
  });

  it("--approve overrides it — a judgment call, unlike the mechanical refusals — and records the override", async () => {
    const p = await makeProject(componentsFixture(FEATURE_OPENAPI_GHOST_REF));
    try {
      const res = await runLoam(p.workDir, "archive", "FEAT-3", "--approve", "--json");
      expect(res.code).toBe(0);
      const json = JSON.parse(res.stdout);
      expect(json.ok).toBe(true);
      expect(json.archived).toBe(true);
      expect(json.overridden.map((i: { code: string }) => i.code)).toContain("openapi.ref-unresolved");
      expect(await p.read("services/payment-service/openapi.yaml")).toContain("#/components/schemas/Ghost");
    } finally {
      await p.destroy();
    }
  });

  it("a ref the LIVING document resolves is fine as it stands: nothing copied, nothing gated", async () => {
    const livingOnly = FEATURE_OPENAPI_GHOST_REF.replace("schemas/Ghost", "schemas/LivingThing");
    const living = `${LIVING_OPENAPI}components:
  schemas:
    LivingThing:
      type: object
`;
    const p = await makeProject(componentsFixture(livingOnly, living));
    try {
      const res = await runLoam(p.workDir, "archive", "FEAT-3");
      expect(res.code).toBe(0);
      expect(res.out).not.toContain("unresolved");
      expect(res.out).not.toContain("overwrites component");
    } finally {
      await p.destroy();
    }
  });

  it("external refs (URLs, file paths) are out of scope: untouched, never gated", async () => {
    const external = FEATURE_OPENAPI_GHOST_REF.replace(
      "'#/components/schemas/Ghost'",
      "'https://schemas.example.com/payments.json#/Refund'",
    );
    const p = await makeProject(componentsFixture(external));
    try {
      const res = await runLoam(p.workDir, "archive", "FEAT-3");
      expect(res.code).toBe(0);
      expect(res.out).not.toContain("unresolved");
      expect(await p.read("services/payment-service/openapi.yaml")).toContain(
        "https://schemas.example.com/payments.json#/Refund",
      );
    } finally {
      await p.destroy();
    }
  });

  it("archive then unarchive restores the living openapi byte-identically — the snapshot already covers components", async () => {
    const p = await makeProject(componentsFixture(FEATURE_OPENAPI_WITH_REFS, LIVING_OPENAPI_MONEY_DIFFERS));
    try {
      const before = await treeHashes(p.docsDir);
      expect((await runLoam(p.workDir, "archive", "FEAT-3")).code).toBe(0);
      expect((await runLoam(p.workDir, "unarchive", "FEAT-3")).code).toBe(0);
      expect(await treeHashes(p.docsDir)).toEqual(before);
    } finally {
      await p.destroy();
    }
  });
});

describe("the machine contract (--json)", () => {
  it("success emits one valid JSON document: feature, archived, plan, warnings", async () => {
    const p = await makeProject(coherentFixture());
    try {
      const res = await runLoam(p.workDir, "archive", "FEAT-1", "--json");
      expect(res.code).toBe(0);
      // res.out interleaves stdout and stderr — parsing it whole proves one
      // stream carries nothing but the envelope.
      const json = JSON.parse(res.out);
      expect(json).toMatchObject({ ok: true, feature: "FEAT-1", archived: true, path: "features/archive/FEAT-1-split" });
      expect(json.plan).toEqual(
        expect.arrayContaining([
          { path: "services/payment-split-service/spec.md", action: "create" },
          { path: "services/payment-split-service/openapi.yaml", action: "create" },
          { path: "architecture/landscape.likec4", action: "update" },
        ]),
      );
      expect(json.plan.find((e: { action: string }) => e.action === "move")).toMatchObject({
        path: "features/FEAT-1-split",
        to: "features/archive/FEAT-1-split",
      });
      // The one warning this fixture earns: FEAT-1 brings payment-split-service
      // into existence, and nothing in the merge writes its model.likec4.
      // `overridable` is the additive per-issue key resolved from issue.ts's
      // approveOverrides — pinned here so removing or renaming it is a contract
      // break somebody has to see.
      expect(json.warnings).toEqual([
        {
          severity: "warn",
          code: "service.no-model",
          gates: false,
          overridable: true,
          subject: "payment-split-service",
          message: expect.stringContaining("services/payment-split-service/model.likec4"),
        },
      ]);
      expect(json.overridden).toEqual([]);
      expect(p.exists("features/archive/FEAT-1-split/delta.likec4")).toBe(true);
    } finally {
      await p.destroy();
    }
  });

  it("--dry-run emits the same plan with archived:false, and writes nothing", async () => {
    const p = await makeProject(coherentFixture());
    try {
      const before = await treeHashes(p.docsDir);
      const res = await runLoam(p.workDir, "archive", "FEAT-1", "--dry-run", "--json");
      expect(res.code).toBe(0);
      const json = JSON.parse(res.out);
      expect(json.ok).toBe(true);
      expect(json.archived).toBe(false);
      expect(json.plan.length).toBeGreaterThan(0);
      expect(await treeHashes(p.docsDir)).toEqual(before);
    } finally {
      await p.destroy();
    }
  });

  it("the coherence refusal is not-coherent, with every issue attached", async () => {
    const files = coherentFixture();
    delete files["features/FEAT-1-split/specs/payment-split-service/openapi.yaml"];
    const p = await makeProject(files);
    try {
      const res = await runLoam(p.workDir, "archive", "FEAT-1", "--json");
      expect(res.code).toBe(1);
      const json = JSON.parse(res.out);
      expect(json.ok).toBe(false);
      expect(json.error.code).toBe("not-coherent");
      const codes = json.issues.map((i: { code: string }) => i.code);
      expect(codes).toContain("spec-api.op-undefined");
      expect(codes).toContain("c4-api.op-undefined");
      // `gates` is resolved on every issue — a consumer must not have to
      // re-implement the severity default to know what blocked.
      for (const i of json.issues) expect(typeof i.gates).toBe("boolean");
    } finally {
      await p.destroy();
    }
  });

  it("a gating WARNING blocks alone — severity and gating are separate axes", async () => {
    // delta.requirement-not-merged: the document is legal (warn — validate
    // passes), the merge would drop authored content (gates — archive refuses).
    const files = coherentFixture();
    files["features/FEAT-1-split/specs/payment-split-service/spec.md"] += `
## Behavior

### Requirement: Stranded here
The service SHALL do the stranded thing.

#### Scenario: It happens
- **Then** it happens
`;
    const p = await makeProject(files);
    try {
      const res = await runLoam(p.workDir, "archive", "FEAT-1", "--json");
      expect(res.code).toBe(1);
      const json = JSON.parse(res.out);
      expect(json.error.code).toBe("not-coherent");
      const stranded = json.issues.find(
        (i: { code: string }) => i.code === "delta.requirement-not-merged",
      );
      expect(stranded).toMatchObject({ severity: "warn", gates: true });
    } finally {
      await p.destroy();
    }
  });

  it("--approve success carries the overridden errors by code", async () => {
    const files = coherentFixture();
    delete files["features/FEAT-1-split/specs/payment-split-service/openapi.yaml"];
    const p = await makeProject(files);
    try {
      const res = await runLoam(p.workDir, "archive", "FEAT-1", "--approve", "--json");
      expect(res.code).toBe(0);
      const json = JSON.parse(res.out);
      expect(json.ok).toBe(true);
      expect(json.archived).toBe(true);
      const codes = json.overridden.map((i: { code: string }) => i.code);
      expect(codes).toContain("spec-api.op-undefined");
    } finally {
      await p.destroy();
    }
  });

  it("a taken destination is archive-exists", async () => {
    const files = coherentFixture();
    files["features/archive/FEAT-1-split/stale.md"] = "# leftover from a previous run\n";
    const p = await makeProject(files);
    try {
      const res = await runLoam(p.workDir, "archive", "FEAT-1", "--json");
      expect(res.code).toBe(1);
      expect(JSON.parse(res.out)).toMatchObject({ ok: false, error: { code: "archive-exists" } });
    } finally {
      await p.destroy();
    }
  });

  it("an ALREADY-ARCHIVED feature is unknown-target too, but the message says so honestly", async () => {
    const p = await makeProject({ "features/archive/FEAT-9-shipped/intent.md": "# shipped\n" });
    try {
      const res = await runLoam(p.workDir, "archive", "FEAT-9", "--json");
      expect(res.code).toBe(1);
      const json = JSON.parse(res.stdout);
      // The code stays stable — the ErrorCode union does not grow for a nicer story.
      expect(json).toMatchObject({ ok: false, error: { code: "unknown-target" } });
      expect(json.error.message).toContain("already archived");
      expect(json.error.message).toContain("loam show FEAT-9");
      expect(json.error.message).not.toContain("No feature");
    } finally {
      await p.destroy();
    }
  });

  it("an unknown feature is unknown-target, and a missing config is no-config", async () => {
    const p = await makeProject(coherentFixture());
    try {
      const missing = await runLoam(p.workDir, "archive", "FEAT-77", "--json");
      expect(JSON.parse(missing.out)).toMatchObject({ ok: false, error: { code: "unknown-target" } });
      await rm(join(p.workDir, "loam.json"));
      const noConfig = await runLoam(p.workDir, "archive", "FEAT-1", "--json");
      expect(JSON.parse(noConfig.out)).toMatchObject({ ok: false, error: { code: "no-config" } });
    } finally {
      await p.destroy();
    }
  });

  it("a thrown plan error (unparseable delta.likec4 under --approve) still speaks JSON: merge-failed", async () => {
    const files = coherentFixture();
    files["features/FEAT-1-split/delta.likec4"] = "model { this is not likec4\n";
    const p = await makeProject(files);
    try {
      const res = await runLoam(p.workDir, "archive", "FEAT-1", "--approve", "--json");
      expect(res.code).toBe(1);
      // LikeC4 diagnostics are returned to loam, not logged out-of-band: JSON
      // mode therefore keeps stderr clean as well as stdout parseable.
      expect(res.stderr).toBe("");
      const json = JSON.parse(res.stdout);
      expect(json.ok).toBe(false);
      expect(json.error.code).toBe("merge-failed");
      expect(json.error.message).toContain("architecture axis cannot be merged");
    } finally {
      await p.destroy();
    }
  });

  it("a commit-phase failure rolls back and still speaks JSON: merge-failed, saying so", async () => {
    const p = await makeProject(coherentFixture());
    await p.write("features/archive", "not a directory\n");
    try {
      const before = await treeHashes(p.docsDir);
      const res = await runLoam(p.workDir, "archive", "FEAT-1", "--json");
      expect(res.code).toBe(1);
      const json = JSON.parse(res.out);
      expect(json.ok).toBe(false);
      expect(json.error.code).toBe("merge-failed");
      expect(json.error.message.toLowerCase()).toContain("rolled back");
      expect(await treeHashes(p.docsDir)).toEqual(before);
    } finally {
      await p.destroy();
    }
  });
});

describe("a specs/ directory whose name is not a legal service id blocks archive, --approve and all", () => {
  // The hole this pins, reproduced end to end before the fix: the title
  // fallback made the delta "introduce" 'Payment Service', validate exited 0,
  // archive exited 0 and materialised services/Payment Service/ — a directory
  // service.id-invalid then fails on the next validate --all, and one that no
  // loam command (archive included) can ever address or re-create.
  function spaceFixture(): Record<string, string> {
    return {
      "architecture/landscape.likec4": LANDSCAPE,
      "services/payment-service/spec.md": LIVING_SPEC,
      "services/payment-service/openapi.yaml": LIVING_OPENAPI,
      "features/FEAT-9-space/intent.md": "---\nfeature: FEAT-9\nstatus: proposed\n---\n\n# Space\n",
      "features/FEAT-9-space/delta.likec4": `specification {
  element softwareSystem
  tag FEAT-9
}

model {
  paymentSvc = softwareSystem 'Payment Service' {
    #FEAT-9
  }
}
`,
      "features/FEAT-9-space/specs/Payment Service/spec.md": `# Payment Service — delta for FEAT-9

## ADDED Requirements

### Requirement: Hold the payment
The service SHALL hold the payment.

#### Scenario: Held
- **Given** a payment
- **When** it arrives
- **Then** it is held
`,
    };
  }

  it("refuses before the plan: exit 1, nothing written, services/Payment Service/ never exists", async () => {
    const p = await makeProject(spaceFixture());
    try {
      const before = await treeHashes(p.docsDir);
      const res = await runLoam(p.workDir, "archive", "FEAT-9");
      expect(res.code).toBe(1);
      expect(res.out).toContain("BLOCKED");
      expect(res.out).toContain("illegal service id");
      expect(p.exists("services/Payment Service")).toBe(false);
      expect(await treeHashes(p.docsDir), "a refused archive must write nothing").toEqual(before);
    } finally {
      await p.destroy();
    }
  });

  it("--dry-run is refused too: a plan built on that name describes a forbidden merge", async () => {
    const p = await makeProject(spaceFixture());
    try {
      const before = await treeHashes(p.docsDir);
      const res = await runLoam(p.workDir, "archive", "FEAT-9", "--dry-run");
      expect(res.code).toBe(1);
      expect(res.out).toContain("BLOCKED");
      expect(await treeHashes(p.docsDir)).toEqual(before);
    } finally {
      await p.destroy();
    }
  });

  it("--approve does not pierce it: the refusal is mechanical, not a judgment call", async () => {
    const p = await makeProject(spaceFixture());
    try {
      const before = await treeHashes(p.docsDir);
      const res = await runLoam(p.workDir, "archive", "FEAT-9", "--approve");
      expect(res.code).toBe(1);
      expect(res.out).toContain("--approve does not override");
      expect(p.exists("services/Payment Service")).toBe(false);
      expect(await treeHashes(p.docsDir)).toEqual(before);
    } finally {
      await p.destroy();
    }
  });

  it("--json refuses not-coherent and carries delta.service-id-invalid in issues[]", async () => {
    const p = await makeProject(spaceFixture());
    try {
      const res = await runLoam(p.workDir, "archive", "FEAT-9", "--approve", "--json");
      expect(res.code).toBe(1);
      const json = JSON.parse(res.stdout);
      expect(json.ok).toBe(false);
      expect(json.error.code).toBe("not-coherent");
      // The no-override verdict must reach a --json consumer too, and for the
      // Finding path it travels in error.message — the human view was the only
      // place that said it.
      expect(json.error.message).toContain("--approve does not override this");
      const codes = (json.issues as Array<{ code: string; gates: boolean }>).map((i) => i.code);
      expect(codes).toContain("delta.service-id-invalid");
      for (const i of json.issues as Array<{ gates: boolean }>) expect(i.gates).toBe(true);
    } finally {
      await p.destroy();
    }
  });
});

describe("a tagged element whose explicit binding is an illegal id blocks archive, --approve and all", () => {
  // The hole this pins, reproduced end to end before the fix: the binding
  // parsed cleanly, validate had nothing but the W3 warn, and archive exited 0
  // having spliced '../outside-svc' into the living landscape — whose very
  // next validate --all then failed on landscape.binding-unknown, while the
  // newServices existsSync probe had collapsed services/../outside-svc right
  // out of the docs repo.
  function outsideBindingFixture(): Record<string, string> {
    return {
      "architecture/landscape.likec4": LANDSCAPE,
      "services/payment-service/spec.md": LIVING_SPEC,
      "services/payment-service/openapi.yaml": LIVING_OPENAPI,
      "features/FEAT-8-outside/intent.md": "---\nfeature: FEAT-8\nstatus: proposed\n---\n\n# Outside\n",
      "features/FEAT-8-outside/delta.likec4": `specification {
  element softwareSystem
  tag FEAT-8
}

model {
  outside = softwareSystem 'Outside Payments' {
    #FEAT-8
    metadata { service '../outside-svc' }
  }
}
`,
    };
  }

  it("refuses before the plan: exit 1, the living landscape never sees the name", async () => {
    const p = await makeProject(outsideBindingFixture());
    try {
      const before = await treeHashes(p.docsDir);
      const res = await runLoam(p.workDir, "archive", "FEAT-8");
      expect(res.code).toBe(1);
      expect(res.out).toContain("BLOCKED");
      expect(res.out).toContain("illegal service id");
      expect(await p.read(LANDSCAPE_REL)).toBe(LANDSCAPE);
      expect(await p.read(LANDSCAPE_REL)).not.toContain("outside-svc");
      expect(await treeHashes(p.docsDir), "a refused archive must write nothing").toEqual(before);
    } finally {
      await p.destroy();
    }
  });

  it("--approve does not pierce it, and --dry-run is refused the same way", async () => {
    const p = await makeProject(outsideBindingFixture());
    try {
      const before = await treeHashes(p.docsDir);
      const approved = await runLoam(p.workDir, "archive", "FEAT-8", "--approve");
      expect(approved.code).toBe(1);
      expect(approved.out).toContain("--approve does not override");
      const dry = await runLoam(p.workDir, "archive", "FEAT-8", "--dry-run");
      expect(dry.code).toBe(1);
      expect(dry.out).toContain("BLOCKED");
      expect(await p.read(LANDSCAPE_REL)).toBe(LANDSCAPE);
      expect(await treeHashes(p.docsDir)).toEqual(before);
    } finally {
      await p.destroy();
    }
  });

  it("--json refuses not-coherent and carries c4.service-binding-invalid in issues[]", async () => {
    const p = await makeProject(outsideBindingFixture());
    try {
      const res = await runLoam(p.workDir, "archive", "FEAT-8", "--approve", "--json");
      expect(res.code).toBe(1);
      const json = JSON.parse(res.stdout);
      expect(json.ok).toBe(false);
      expect(json.error.code).toBe("not-coherent");
      const issues = json.issues as Array<{ code: string; gates: boolean }>;
      const binding = issues.filter((i) => i.code === "c4.service-binding-invalid");
      expect(binding).toHaveLength(1);
      expect(binding[0]!.gates).toBe(true);
    } finally {
      await p.destroy();
    }
  });
});

describe("an untagged child riding inside a tagged block is held to the binding grammar too", () => {
  // The bypass this pins, reproduced end to end before the fix: the splice
  // carries a tagged element's WHOLE authored block (landscape-merge.ts's
  // rides() exists exactly so a child travels inside its parent's text), so an
  // untagged container's `metadata { service '../outside-svc' }` reached the
  // living landscape while the coherence check read only the tagged elements
  // themselves — validate --feature exit 0, archive exit 0, and the very next
  // validate --all failed on landscape.binding-unknown.
  //
  // The living landscape must declare the child's KIND (container): without it
  // the merged text fails the splicer's parse net and the defect hides behind
  // a merge-failed refusal that never lets the binding land.
  const NESTED_LANDSCAPE = LANDSCAPE.replace(
    "element softwareSystem",
    "element softwareSystem\n  element container",
  );
  function nestedBindingFixture(): Record<string, string> {
    return {
      "architecture/landscape.likec4": NESTED_LANDSCAPE,
      "services/payment-service/spec.md": LIVING_SPEC,
      "services/payment-service/openapi.yaml": LIVING_OPENAPI,
      "features/FEAT-10-nested/intent.md": "---\nfeature: FEAT-10\nstatus: proposed\n---\n\n# Nested\n",
      "features/FEAT-10-nested/delta.likec4": `specification {
  element softwareSystem
  element container
  tag FEAT-10
}

model {
  outside = softwareSystem 'Outside Payments' {
    #FEAT-10
    worker = container 'Worker' {
      metadata { service '../outside-svc' }
    }
  }
}
`,
    };
  }

  it("refuses before the plan: exit 1, the child's binding never reaches the living landscape", async () => {
    const p = await makeProject(nestedBindingFixture());
    try {
      const before = await treeHashes(p.docsDir);
      const res = await runLoam(p.workDir, "archive", "FEAT-10");
      expect(res.code).toBe(1);
      expect(res.out).toContain("BLOCKED");
      expect(res.out).toContain("illegal service id");
      expect(res.out).toContain("--approve does not override");
      expect(await p.read(LANDSCAPE_REL)).toBe(NESTED_LANDSCAPE);
      expect(await treeHashes(p.docsDir), "a refused archive must write nothing").toEqual(before);
    } finally {
      await p.destroy();
    }
  });

  it("--json refuses not-coherent, says so in error.message, and resolves overridable per issue", async () => {
    const p = await makeProject(nestedBindingFixture());
    try {
      const res = await runLoam(p.workDir, "archive", "FEAT-10", "--approve", "--json");
      expect(res.code).toBe(1);
      const json = JSON.parse(res.stdout);
      expect(json.ok).toBe(false);
      expect(json.error.code).toBe("not-coherent");
      expect(json.error.message).toContain("--approve does not override this");
      const issues = json.issues as Array<{ code: string; gates: boolean; overridable: boolean }>;
      const binding = issues.filter((i) => i.code === "c4.service-binding-invalid");
      expect(binding).toHaveLength(1);
      expect(binding[0]!.gates).toBe(true);
      expect(binding[0]!.overridable).toBe(false);
      // The additive key is resolved on EVERY issue in the envelope, so a
      // consumer branches on data rather than keeping its own code list.
      for (const i of issues) expect(typeof i.overridable).toBe("boolean");
    } finally {
      await p.destroy();
    }
  });
});
