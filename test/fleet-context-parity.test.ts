/**
 * Parity between every `FleetContext` reader and the core function it stands
 * in front of — the executable form of DESIGN rule 12: *a FleetContext method
 * may memoise; it may never compute.*
 *
 * The class is a request-scoped cache, so each of its methods has exactly one
 * honest implementation: call the module that owns the question and remember
 * the promise. The moment a method computes its own answer instead, loam has
 * two implementations of one rule and no way to notice they disagree — because
 * which one runs depends on whether the caller happened to thread a context
 * through. That is not hypothetical: `fleet-context.ts` carries a tombstone
 * where `serviceOperationIds` did exactly this, interleaving OpenAPI removals
 * with upserts so `archive` (no context) and `validate`/`status` (context)
 * disagreed about whether an operation existed — and the disagreement gated an
 * archive.
 *
 * So the suite is a table, not a set of hand-written cases: every reader on the
 * class is a row, asked once through the memo and once of the core module
 * directly, over ONE project on disk. Adding a method to `FleetContext` without
 * adding its row here leaves the new method unpinned, which is the only way
 * this file can rot.
 *
 * Two guards keep the table honest:
 *
 *  - a richness floor per row, because a reader run over an absent artifact
 *    compares `[]` with `[]` and passes while proving nothing;
 *  - a negative control, because a comparison that cannot fail is not a
 *    comparison. A doctored context whose `readRequirements` invents one extra
 *    requirement must be caught by the same `toEqual` the rows use.
 *
 * The fixture is `coherentFixture()` plus extras written LOCALLY here: the
 * shared fixture carries no asyncapi.yaml, no archived feature and no
 * half-merged document, and thirty-nine other suites pin its exact shape — so
 * this file grows its own copy of what it needs instead of moving theirs.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readAsyncapi } from "../src/core/asyncapi/read.js";
import { readCapabilityVocabulary } from "../src/core/capabilities/capabilities.js";
import { featureCapabilityDeltas } from "../src/core/capabilities/delta/tree.js";
import { loadFile } from "../src/core/c4/likec4.js";
import { parseRequirements } from "../src/core/document/parse.js";
import { type Requirement } from "../src/core/document/spec.js";
import { conflictMarkerLines } from "../src/core/conflict-markers.js";
import { FleetContext } from "../src/core/fleet-context.js";
import { decodeDocument } from "../src/core/kernel/document-bytes.js";
import { operationIds, operations, readOpenapi } from "../src/core/openapi/doc.js";
import { type FeatureEntry } from "../src/core/repo/entries.js";
import { featureSpecServices, listFeatures, listFleetTree, listServices } from "../src/core/repo/repo.js";
import { coherentFixture, LANDSCAPE, makeProject, type Project } from "./helpers/harness.js";

/** payment-service's async contract: one message, produced. */
const ASYNCAPI = `asyncapi: 3.0.0
info:
  title: payment-service events
  version: "1.0"
channels:
  paymentEvents:
    address: payment.events.v1
    messages:
      PaymentAuthorized:
        $ref: '#/components/messages/PaymentAuthorized'
operations:
  sendPaymentAuthorized:
    action: send
    channel:
      $ref: '#/channels/paymentEvents'
    messages:
      - $ref: '#/channels/paymentEvents/messages/PaymentAuthorized'
components:
  messages:
    PaymentAuthorized:
      name: payment.PaymentAuthorized
      payload:
        type: object
        properties:
          paymentId:
            type: string
`;

/**
 * A living spec somebody's merge left half-resolved. It is a real service's
 * document rather than a scratch file because that is the case
 * `conflictMarkers` was built for: markers in `services/<svc>/spec.md` parse as
 * prose, and the next archive rewrites them away.
 */
const CONFLICTED = `# checkout-web

## Requirements

### Requirement: Show the split
<<<<<<< HEAD
The UI SHALL show each payee's share.
=======
The UI SHALL show each payee's share and the total.
>>>>>>> feature/split

#### Scenario: Two payees
- **Given** a split across two payees
- **When** the summary renders
- **Then** both shares are shown
`;

/** A shipped feature, so the two `includeArchived` arms cannot answer alike. */
const ARCHIVED_SPEC = `# payment-service — delta for FEAT-0

## ADDED Requirements

### Requirement: Capture an authorization
The service SHALL capture an authorized payment.

#### Scenario: Capture after authorization
- **Given** an authorized payment
- **When** capture is requested
- **Then** the payment is captured
`;

/** A small capability vocabulary, so the capabilities row cannot pass vacuously. */
const CAPABILITIES_YAML = `capabilities:
  payments:
    description: take money for an order
    owner: payments-team
  payments/refunds: {}
`;

/**
 * An AUTHORED capability document, so the row covers the vocabulary's SECOND
 * side. The YAML declares three names and the tree declares a fourth, which is
 * the only shape in which a memo that read one file could be told apart from
 * one that reads the union.
 */
const CAPABILITY_DOC = `# Chargebacks

A customer can reverse a payment through their bank.

## Requirements

### Requirement: Accept a chargeback
Requirement-ID: CAP-CHARGEBACK-1
The fleet SHALL accept a chargeback raised by a customer's bank.

#### Scenario: A bank raises one
- **Given** a settled payment
- **When** the bank reverses it
- **Then** the fleet accepts the reversal
`;

/**
 * A capability DELTA — the feature-local half of the business corpus. Its
 * `## ADDED Requirements` heading is what makes it a delta rather than a second
 * living document, and the walk that finds it must not care either way.
 */
const CAPABILITY_DELTA = `# a capability — delta for FEAT-1

## ADDED Requirements

### Requirement: Reverse within five days
Requirement-ID: CAP-REVERSE-1
The fleet SHALL reverse a payment within five days.

#### Scenario: A reversal is asked for
- **Given** a settled payment
- **When** a reversal is requested
- **Then** the money is returned within five days
`;

/**
 * The harness landscape, declaring one global style group. The shared
 * constant declares none, so the `loadLikeC4` row would otherwise compare an
 * empty census with an empty census — the vacuous pass the floor exists to
 * refuse. Written locally for the banner's reason: the shared fixture's exact
 * shape is pinned by dozens of other suites.
 */
const STYLED_LANDSCAPE = LANDSCAPE.replace("specification {", "specification {\n  tag external").replace(
  "views {",
  "global {\n  styleGroup fleetPalette {\n    style element.tag = #external { color gray }\n  }\n}\n\nviews {",
);

/** `coherentFixture()` plus what the readers below need and it does not carry. */
function parityFixture(): Record<string, string> {
  const files = coherentFixture();
  files["architecture/landscape.likec4"] = STYLED_LANDSCAPE;
  files["services/payment-service/asyncapi.yaml"] = ASYNCAPI;
  files["architecture/capabilities.yaml"] = CAPABILITIES_YAML;
  files["capabilities/chargebacks/spec.md"] = CAPABILITY_DOC;
  // The feature's OWN capability deltas — two of them, one nested under a group
  // directory that is not itself a capability, so the row below compares a walk
  // rather than a presence flag.
  files["features/FEAT-1-split/capabilities/chargebacks/spec.md"] = CAPABILITY_DELTA;
  files["features/FEAT-1-split/capabilities/payments/refunds/spec.md"] = CAPABILITY_DELTA;
  files["services/checkout-web/spec.md"] = CONFLICTED;
  files["features/archive/FEAT-0-capture/intent.md"] =
    "---\nfeature: FEAT-0\nstatus: shipped\n---\n\n# Capture payments\n";
  files["features/archive/FEAT-0-capture/specs/payment-service/spec.md"] = ARCHIVED_SPEC;
  return files;
}

/** Where the one project's artifacts are, resolved once for the whole table. */
interface Fixture {
  docsDir: Project["docsDir"];
  featureDir: FeatureEntry["dir"];
  spec: string;
  openapi: string;
  asyncapi: string;
  landscape: string;
  conflicted: string;
  /** Two documents no other row loads, so the prefetch row truly batches. */
  model: string;
  delta: string;
}

/**
 * One reader of the class, the same question asked of the module that owns it,
 * and what the answer must contain for the comparison to mean anything.
 */
interface Reader {
  name: string;
  /** Through the memo. */
  memo(fleet: FleetContext, at: Fixture): Promise<unknown>;
  /** Straight to the core module, no context anywhere. */
  direct(at: Fixture): Promise<unknown>;
  /** Fails the run if the fixture would let this row pass vacuously. */
  floor(answer: any): void;
}

const READERS: Reader[] = [
  {
    name: "listServices",
    memo: (fleet, at) => fleet.listServices(at.docsDir),
    direct: (at) => listServices(at.docsDir),
    floor: (services) => {
      expect(services.length).toBeGreaterThanOrEqual(2);
      expect(services.map((s: { id: string }) => s.id)).toContain("payment-service");
    },
  },
  {
    name: "fleetTree",
    memo: (fleet, at) => fleet.fleetTree(at.docsDir),
    direct: (at) => listFleetTree(at.docsDir),
    floor: (tree) => {
      expect(tree.services.length).toBeGreaterThanOrEqual(2);
      expect(tree.services.map((s: { id: string }) => s.id)).toContain("payment-service");
    },
  },
  {
    name: "listFeatures (in flight)",
    memo: (fleet, at) => fleet.listFeatures(at.docsDir),
    direct: (at) => listFeatures(at.docsDir),
    floor: (features) => {
      expect(features.length).toBeGreaterThanOrEqual(1);
      expect(features.every((f: { archived: boolean }) => !f.archived)).toBe(true);
    },
  },
  {
    name: "listFeatures (includeArchived)",
    memo: (fleet, at) => fleet.listFeatures(at.docsDir, { includeArchived: true }),
    direct: (at) => listFeatures(at.docsDir, { includeArchived: true }),
    floor: (features) => {
      // Strictly more than the arm above, or the two arms prove one thing.
      expect(features.length).toBeGreaterThanOrEqual(2);
      expect(features.some((f: { archived: boolean }) => f.archived)).toBe(true);
    },
  },
  {
    name: "featureSpecServices",
    memo: (fleet, at) => fleet.featureSpecServices(at.featureDir),
    direct: (at) => featureSpecServices(at.featureDir),
    floor: (services) => expect(services).toContain("payment-split-service"),
  },
  {
    name: "readText",
    memo: (fleet, at) => fleet.readText(at.spec),
    direct: async (at) => decodeDocument(await readFile(at.spec), at.spec),
    floor: (text) => expect(text).toContain("## Requirements"),
  },
  {
    name: "conflictMarkers",
    memo: (fleet, at) => fleet.conflictMarkers(at.conflicted),
    direct: async (at) => conflictMarkerLines(await readFile(at.conflicted, "utf8")),
    floor: (lines) => expect(lines).toHaveLength(3),
  },
  {
    name: "readRequirements",
    memo: (fleet, at) => fleet.readRequirements(at.spec),
    direct: async (at) => parseRequirements(decodeDocument(await readFile(at.spec), at.spec)),
    floor: (requirements) => {
      expect(requirements.length).toBeGreaterThanOrEqual(1);
      expect(requirements[0].scenarios.length).toBeGreaterThanOrEqual(1);
    },
  },
  {
    name: "readOpenapi",
    memo: (fleet, at) => fleet.readOpenapi(at.openapi),
    direct: (at) => readOpenapi(at.openapi),
    floor: (doc) => expect(doc.ops.length).toBeGreaterThanOrEqual(1),
  },
  {
    name: "readAsyncapi",
    memo: (fleet, at) => fleet.readAsyncapi(at.asyncapi),
    direct: (at) => readAsyncapi(at.asyncapi),
    floor: (doc) => {
      expect(doc.messages.length).toBeGreaterThanOrEqual(1);
      expect(doc.sent).toContain("payment.PaymentAuthorized");
    },
  },
  {
    name: "capabilities",
    // Keyed by the DOCS DIR, not by a file: the vocabulary is the union of
    // `architecture/capabilities.yaml` and the `capabilities/` tree, and a memo
    // keyed on either file alone would answer one half of it.
    memo: (fleet, at) => fleet.capabilities(at.docsDir),
    direct: (at) => readCapabilityVocabulary(at.docsDir),
    floor: (vocab) => {
      expect(vocab.present).toBe(true);
      // Both declaration shapes, so the parity covers the leaf-shape ladder:
      // a full body and a bare `{}` (and the nested id stays one flat key).
      expect(vocab.byId.get("payments")?.owner).toBe("payments-team");
      expect(vocab.byId.has("payments/refunds")).toBe(true);
      // And the authored side, which only the union answers — without it the
      // row would compare two readers over the YAML alone and pass while the
      // tree half of the union went unread through the memo.
      expect(vocab.byId.get("chargebacks")?.source).toBe("tree");
      expect(vocab.tree.docs.map((d) => d.id)).toEqual(["chargebacks"]);
    },
  },
  {
    name: "featureCapabilityDeltas",
    // Keyed by the FEATURE dir, not the docs dir: this is the feature's own
    // `capabilities/` delta tree, and a memo keyed on the repo root would
    // answer one feature's deltas for every other feature in the run.
    memo: (fleet, at) => fleet.featureCapabilityDeltas(at.featureDir),
    direct: (at) => featureCapabilityDeltas(at.featureDir),
    floor: (tree) => {
      // Present, nested, and with a group directory that is NOT itself a
      // capability — the shape that separates a real walk from "the deepest
      // directory wins", and the one a memo returning a bare `[]` would pass.
      expect(tree.present).toBe(true);
      expect(tree.docs.map((d: { id: string }) => d.id)).toEqual(["chargebacks", "payments/refunds"]);
    },
  },
  {
    name: "operations",
    memo: (fleet, at) => fleet.operations(at.openapi),
    direct: (at) => operations(at.openapi),
    floor: (ops) => expect(ops.length).toBeGreaterThanOrEqual(1),
  },
  {
    name: "operationIds",
    memo: (fleet, at) => fleet.operationIds(at.openapi),
    direct: (at) => operationIds(at.openapi),
    floor: (ids) => expect(ids).toContain("authorizePayment"),
  },
  {
    name: "loadLikeC4",
    memo: (fleet, at) => fleet.loadLikeC4(at.landscape),
    direct: (at) => loadFile(at.landscape),
    floor: (doc) => {
      expect(doc.errors).toEqual([]);
      expect(doc.elements.length).toBeGreaterThanOrEqual(3);
      expect(doc.relationships.length).toBeGreaterThanOrEqual(2);
      // The global style census rides the memo too: the generated subsystem
      // views are graded off this document under `validate --all`, so a memo
      // that dropped the field would grade a styled fleet stale forever.
      expect(doc.globalStyles).toEqual(["fleetPalette"]);
    },
  },
  {
    name: "prefetchLikeC4",
    // Not a reader of its own: prefetch SEEDS loadLikeC4's memo through the
    // shared batch workspace. Its parity claim is the seed's — a load answered
    // from a prefetched document equals the same document read directly. The
    // two paths are ones no earlier row memoized, so the batch genuinely runs
    // (a single miss would be the documented no-op).
    memo: async (fleet, at) => {
      await fleet.prefetchLikeC4([at.model, at.delta]);
      return fleet.loadLikeC4(at.model);
    },
    direct: (at) => loadFile(at.model),
    floor: (doc) => {
      expect(doc.errors).toEqual([]);
      expect(doc.elements.length).toBeGreaterThanOrEqual(1);
    },
  },
];

/** The row by name — the negative control needs one specific reader. */
function reader(name: string): Reader {
  const found = READERS.find((r) => r.name === name);
  if (found === undefined) throw new Error(`no reader row named '${name}'`);
  return found;
}

/**
 * A context that COMPUTES instead of memoising — the drift rule 12 forbids,
 * made concrete as one extra requirement nobody wrote. It exists to prove the
 * comparison above can fail; nothing else uses it.
 */
class DriftingContext extends FleetContext {
  override async readRequirements(path: string): Promise<Requirement[]> {
    const real = await super.readRequirements(path);
    return [...real, real[0]!];
  }
}

describe("every FleetContext reader answers exactly what the core module answers", () => {
  let project: Project;
  let fleet: FleetContext;
  let at: Fixture;

  beforeAll(async () => {
    project = await makeProject(parityFixture());
    const docsDir = project.docsDir;
    // The feature directory comes from the enumeration rather than from a
    // joined string, so the row asks about a directory loam itself found.
    const inFlight = (await listFeatures(docsDir)).find((f) => f.id === "FEAT-1");
    if (inFlight === undefined) throw new Error("the parity fixture lost its in-flight feature");
    at = {
      docsDir,
      featureDir: inFlight.dir,
      spec: join(docsDir, "services/payment-service/spec.md"),
      openapi: join(docsDir, "services/payment-service/openapi.yaml"),
      asyncapi: join(docsDir, "services/payment-service/asyncapi.yaml"),
      landscape: join(docsDir, "architecture/landscape.likec4"),
      conflicted: join(docsDir, "services/checkout-web/spec.md"),
      model: join(docsDir, "services/payment-service/model.likec4"),
      delta: join(inFlight.dir, "delta.likec4"),
    };
    fleet = new FleetContext();
  });

  afterAll(async () => {
    await project.destroy();
  });

  it.each(READERS)("$name reads the fixture, so its parity is not vacuous", async (row) => {
    row.floor(await row.direct(at));
  });

  it.each(READERS)("$name through the memo equals $name read directly", async (row) => {
    expect(await row.memo(fleet, at)).toEqual(await row.direct(at));
  });

  it("every reader on the class has a row — a new method cannot arrive unpinned", () => {
    // The class's own method list, minus the diagnostics accessor. `stats()`
    // reports the memo's counters and reads nothing, so it has no counterpart.
    const methods = Object.getOwnPropertyNames(FleetContext.prototype)
      .filter((name) => name !== "constructor" && name !== "stats")
      .sort();
    const covered = [...new Set(READERS.map((r) => r.name.replace(/ \(.*\)$/, "")))].sort();
    expect(covered).toEqual(methods);
  });

  it("negative control: the comparison DOES catch a context that computes its own answer", async () => {
    const row = reader("readRequirements");
    const direct = await row.direct(at);
    // One extra requirement is the whole drift — and the same toEqual the rows
    // above use must go red on it, or this file is theater.
    expect(await row.memo(new DriftingContext(), at)).not.toEqual(direct);
    // The honest memo, compared the same way, still agrees: the control is
    // discriminating between contexts, not between comparisons.
    expect(await row.memo(new FleetContext(), at)).toEqual(direct);
  });
});
