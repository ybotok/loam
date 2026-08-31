/**
 * A feature can bring a use case — `features/<FEAT>/usecases/<name>.likec4`,
 * end to end.
 *
 * A `dynamic view` is the only realizer a promise that CROSSES services has, and
 * it was the one realizer no feature could carry: every other axis had a delta
 * slot and this one had none. So the business axis's own headline case was
 * written backwards — an analyst adds a cross-service requirement, the architect
 * answers it with a flow, and the flow could not ship in that change. The
 * promise landed first, kept by nothing, and `capability.uncovered`'s message
 * said so out loud.
 *
 * Four properties, and each fails against a different wrong implementation:
 *
 * THE FLOW SHIPS AND UNSHIPS WITH THE FEATURE. The archive copies it into
 * `architecture/usecases/` and `loam unarchive` takes it back, byte for byte —
 * the create-only route the glossary axis established, refused by
 * `usecase.flow-exists` when the living tree already holds that file.
 *
 * IT IS GRADED AGAINST THE POST-MERGE MAP. A hop naming a service the feature's
 * own `delta.likec4` adds must be legal, because that is the change that makes
 * it true; graded against the LIVING landscape it is an unresolved element and
 * the whole project blanks.
 *
 * AND A HOP NAMING SOMETHING THE MERGE DOES NOT LAND IS REFUSED BEFORE ANYTHING
 * IS WRITTEN. That is the other half of the same reading, and without it a flow
 * is copied into `architecture/` for somebody else's `validate --all` to fail
 * on. `--approve` does not reach it: the flag overrides loam's judgement about
 * coherence, never its ability to read an axis.
 *
 * A RESOLVED `#req-` CLAIM COVERS THE PROMISE. `capability.uncovered` counts the
 * flow, resolving the tag against this feature's own capability delta as well as
 * the living tree — the both-corpora rule `Realizes:` already follows. The
 * negative is the safety property and is asserted beside it: a `#req-` tag
 * naming a DIFFERENT promise covers nothing, or a typo would turn a mistake into
 * a green archive.
 */
import { afterEach, describe, expect, it } from "vitest";
import { makeProject, runLoam, treeHashes, type Project } from "./helpers/harness.js";

const FEAT = "FEAT-1";
const FEAT_DIR = "features/FEAT-1-split";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!();
});

/**
 * The living map. Its `specification` block declares every tag any case below
 * writes, because LikeC4 refuses an undeclared tag and one block serves the
 * whole `architecture/` project — the merged landscape included, which is what
 * makes a feature-local flow's tags legal at grading time.
 */
const LANDSCAPE = `specification {
  element softwareSystem
  tag FEAT-1
  tag cap-checkout
  tag req-CHK-ONCE
  tag req-CHK-OTHER
}

model {
  checkoutWeb = softwareSystem 'checkout-web' {
    metadata { service 'checkout-web' }
  }
  paymentService = softwareSystem 'payment-service' {
    metadata { service 'payment-service' }
  }

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
 * The C4 delta: one new service and one edge into it.
 *
 * The edge carries no `metadata { op }` on purpose. This file is about the FLOW
 * axis, and an operation-linked edge drags the contract spine in — the feature
 * carries no OpenAPI delta, so the edge would be `c4-api.op-undefined` and every
 * archive here would refuse for a reason none of these cases is about.
 */
const DELTA = `specification {
  element softwareSystem
  tag FEAT-1
}

model {
  paymentService = softwareSystem 'payment-service'
  splitService = softwareSystem 'payment-split-service' {
    #FEAT-1
    metadata { service 'payment-split-service' }
  }

  paymentService -> splitService 'Calls createSplit' {
    #FEAT-1
  }
}
`;

/** A views-only flow document — the shape the feature slot takes. */
function flow(step: string, tags: string[] = []): string {
  const carried = tags.map((t) => `    #${t}\n`).join("");
  return `views {\n  dynamic view uc_checkout {\n${carried}    ${step}\n  }\n}\n`;
}

/** A hop over elements the LIVING landscape already draws. */
const LIVING_HOP = "checkoutWeb -> paymentService 'authorizes the payment'";
/** A hop into the service this feature's own delta adds — legal only post-merge. */
const MERGED_HOP = "paymentService -> splitService 'splits the payment'";

function spec(service: string): string {
  return `---\nservice: ${service}\n---\n\n# ${service}\n`;
}

/** The feature's requirement delta, optionally carrying a `Realizes:` line. */
function featureSpec(realizes?: string): string {
  return `# payment-split-service — delta for ${FEAT}

## ADDED Requirements

### Requirement: Split a payment
${realizes === undefined ? "" : `Realizes: ${realizes}\n`}The service SHALL split a payment across payees.

#### Scenario: Split across two payees
- **Given** a payment of 100.00
- **When** it is split 60/40
- **Then** two shares are recorded
`;
}

/** A capability document — living or delta — declaring one promise. */
function capabilityDoc(heading: string | null, id: string): string {
  const body = `### Requirement: Notify once
Requirement-ID: ${id}
A customer SHALL be told exactly once.

#### Scenario: One notice
- **Given** an order
- **When** it is placed
- **Then** the customer is told once
`;
  return heading === null
    ? `# Checkout\n\nWhat a customer expects.\n\n## Requirements\n\n${body}`
    : `# checkout — delta for ${FEAT}\n\n## ${heading}\n\n${body}`;
}

function fleet(files: Record<string, string>): Record<string, string> {
  return {
    "architecture/landscape.likec4": LANDSCAPE,
    "services/checkout-web/spec.md": spec("checkout-web"),
    "services/payment-service/spec.md": spec("payment-service"),
    [`${FEAT_DIR}/intent.md`]: `---\nfeature: ${FEAT}\nstatus: proposed\n---\n\n# Split payments\n\nLet a payment be split across payees.\n`,
    [`${FEAT_DIR}/delta.likec4`]: DELTA,
    [`${FEAT_DIR}/specs/payment-split-service/spec.md`]: featureSpec(),
    ...files,
  };
}

async function project(files: Record<string, string>): Promise<Project> {
  const p = await makeProject(fleet(files), { service: "payment-service" });
  cleanups.push(() => p.destroy());
  return p;
}

interface Refusal {
  ok: boolean;
  error?: { code: string; message: string };
  issues?: Array<{ code: string; message: string; overridable?: boolean }>;
}

/** Every issue of one code an `archive --json` refusal carries. */
function issuesOf(stdout: string, code: string): Array<{ code: string; message: string; overridable?: boolean }> {
  const payload = JSON.parse(stdout) as Refusal;
  return (payload.issues ?? []).filter((i) => i.code === code);
}

describe("a feature brings a flow", () => {
  it("archives it into architecture/usecases/ and unarchives byte-identically", async () => {
    const p = await project({ [`${FEAT_DIR}/usecases/checkout.likec4`]: flow(LIVING_HOP) });
    const before = await treeHashes(p.docsDir);

    const archived = await runLoam(p.workDir, "archive", FEAT, "--json");
    expect(archived.code, archived.out).toBe(0);
    expect(p.exists("architecture/usecases/checkout.likec4")).toBe(true);
    expect(await p.read("architecture/usecases/checkout.likec4")).toBe(flow(LIVING_HOP));

    const restored = await runLoam(p.workDir, "unarchive", FEAT, "--json");
    expect(restored.code, restored.out).toBe(0);
    // The merge CREATED the living flow, so undoing it is a delete — the
    // snapshot manifest's own rule, with no unarchive code of its own.
    expect(p.exists("architecture/usecases/checkout.likec4")).toBe(false);
    expect(await treeHashes(p.docsDir)).toEqual(before);
  });

  it("grades a hop into a service the SAME feature's delta adds — the post-merge map is the corpus", async () => {
    const p = await project({ [`${FEAT_DIR}/usecases/checkout.likec4`]: flow(MERGED_HOP) });
    // Graded against the LIVING landscape this is an unresolved element and the
    // whole project blanks; the archive would then refuse a flow whose only
    // fault is arriving with the change that makes it true.
    const archived = await runLoam(p.workDir, "archive", FEAT, "--json");
    expect(archived.code, archived.out).toBe(0);
    expect(p.exists("architecture/usecases/checkout.likec4")).toBe(true);
  });

  it("refuses a hop naming an element the merge does not land, and --approve does not move it", async () => {
    const p = await project({ [`${FEAT_DIR}/usecases/checkout.likec4`]: flow("paymentService -> ghostService 'talks to nothing'") });
    const before = await treeHashes(p.docsDir);

    const refused = await runLoam(p.workDir, "archive", FEAT, "--json");
    expect(refused.code, refused.out).toBe(1);
    const found = issuesOf(refused.stdout, "usecase.flow-invalid");
    expect(found.length, refused.stdout).toBe(1);
    expect(found[0]!.overridable).toBe(false);
    expect(await treeHashes(p.docsDir), "a refusal must write nothing").toEqual(before);

    const approved = await runLoam(p.workDir, "archive", FEAT, "--approve", "--json");
    expect(approved.code, approved.out).toBe(1);
    expect(await treeHashes(p.docsDir)).toEqual(before);
  });

  it("refuses a flow the living architecture/ already holds", async () => {
    const p = await project({
      "architecture/usecases/checkout.likec4": flow(LIVING_HOP),
      [`${FEAT_DIR}/usecases/checkout.likec4`]: flow(LIVING_HOP),
    });
    const before = await treeHashes(p.docsDir);

    const refused = await runLoam(p.workDir, "archive", FEAT, "--json");
    expect(refused.code, refused.out).toBe(1);
    const found = issuesOf(refused.stdout, "usecase.flow-exists");
    expect(found.length, refused.stdout).toBe(1);
    expect(found[0]!.overridable, "a whole-file copy over an authored flow is not a judgement call").toBe(false);
    expect(found[0]!.message).toContain("architecture/usecases/checkout.likec4");
    expect(await treeHashes(p.docsDir)).toEqual(before);
  });

  it("stays silent for a feature with no usecases/ directory at all", async () => {
    const p = await project({});
    const archived = await runLoam(p.workDir, "archive", FEAT, "--json");
    expect(archived.code, archived.out).toBe(0);
    expect(p.exists("architecture/usecases")).toBe(false);
  });
});

describe("a feature-local flow covers the promise the same feature adds", () => {
  const capabilities = "capabilities:\n  checkout: {}\n";
  const withPromise = (files: Record<string, string>): Record<string, string> => ({
    "architecture/capabilities.yaml": capabilities,
    [`${FEAT_DIR}/capabilities/checkout/spec.md`]: capabilityDoc("ADDED Requirements", "CHK-ONCE"),
    ...files,
  });

  it("a #req- tag resolving to it silences capability.uncovered, and the archive lands both", async () => {
    const p = await project(
      withPromise({ [`${FEAT_DIR}/usecases/checkout.likec4`]: flow(LIVING_HOP, ["cap-checkout", "req-CHK-ONCE"]) }),
    );
    const archived = await runLoam(p.workDir, "archive", FEAT, "--json");
    expect(archived.code, archived.out).toBe(0);
    // Both halves of one change: the promise and the flow that keeps it.
    expect(p.exists("capabilities/checkout/spec.md")).toBe(true);
    expect(p.exists("architecture/usecases/checkout.likec4")).toBe(true);
  });

  it("a #req- tag naming a DIFFERENT promise covers nothing — a typo must not green the gate", async () => {
    const p = await project(
      withPromise({ [`${FEAT_DIR}/usecases/checkout.likec4`]: flow(LIVING_HOP, ["cap-checkout", "req-CHK-OTHER"]) }),
    );
    const refused = await runLoam(p.workDir, "archive", FEAT, "--json");
    expect(refused.code, refused.out).toBe(1);
    expect(issuesOf(refused.stdout, "capability.uncovered").length, refused.stdout).toBe(1);
  });

  it("an UNSCOPED #req- tag covers nothing either — the capability tag is what scopes it", async () => {
    const p = await project(
      withPromise({ [`${FEAT_DIR}/usecases/checkout.likec4`]: flow(LIVING_HOP, ["req-CHK-ONCE"]) }),
    );
    const refused = await runLoam(p.workDir, "archive", FEAT, "--json");
    expect(refused.code, refused.out).toBe(1);
    expect(issuesOf(refused.stdout, "capability.uncovered").length, refused.stdout).toBe(1);
  });

  it("a LIVING flow does not cover it — the promise it names is not merged yet", async () => {
    const p = await project(
      withPromise({ "architecture/usecases/living.likec4": flow(LIVING_HOP, ["cap-checkout", "req-CHK-ONCE"]) }),
    );
    const refused = await runLoam(p.workDir, "archive", FEAT, "--json");
    expect(refused.code, refused.out).toBe(1);
    expect(issuesOf(refused.stdout, "capability.uncovered").length, refused.stdout).toBe(1);
  });

  /**
   * The finding says IN WORDS that no flow keeps the promise. When the flow half
   * could not be evaluated, saying it asserts a negative loam never checked —
   * and gates on it. This is the one shape where that is reachable and invisible:
   * an unparseable `architecture/capabilities.yaml` suspends the `#cap-`
   * resolution, and `core/coherence/declared.ts` deliberately keeps
   * `capability.invalid` for `validate --all`, so nothing else in a feature run
   * points at the file. The author would be told their flow does not resolve a
   * tag it does resolve, with no way on but `--approve`.
   *
   * The `Realizes:` half was still checked, so the finding stands — what must
   * not stand is the accusation.
   */
  it("says the flow half was NOT checked when the vocabulary cannot be resolved, rather than convicting the flow", async () => {
    const p = await project({
      // Present and not a vocabulary: `capabilities:` is a scalar, not a mapping.
      "architecture/capabilities.yaml": "capabilities: not-a-mapping\n",
      [`${FEAT_DIR}/capabilities/checkout/spec.md`]: capabilityDoc("ADDED Requirements", "CHK-ONCE"),
      [`${FEAT_DIR}/usecases/checkout.likec4`]: flow(LIVING_HOP, ["cap-checkout", "req-CHK-ONCE"]),
    });
    const refused = await runLoam(p.workDir, "archive", FEAT, "--json");
    expect(refused.code, refused.out).toBe(1);
    const found = issuesOf(refused.stdout, "capability.uncovered");
    expect(found.length, refused.stdout).toBe(1);
    expect(found[0]!.message).toContain("NOT checked");
    expect(found[0]!.message).toContain("architecture/capabilities.yaml");
    expect(
      found[0]!.message,
      "loam did not resolve the tag, so it must not report that the flow fails to",
    ).not.toContain("resolves a `#req-` tag to it");
    // The flows themselves were readable — only their tags were unresolvable —
    // so the refusal that means "loam could not read the flows" must stay quiet.
    expect(issuesOf(refused.stdout, "usecase.flow-invalid").length, refused.stdout).toBe(0);
  });
});
