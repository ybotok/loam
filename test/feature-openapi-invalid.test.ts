/**
 * Feature-side `openapi.invalid` (core/coherence/declared.ts): a feature's own
 * openapi.yaml that EXISTS but does not parse is the finding itself — an error
 * that gates the archive — and every other contract-axis check for that
 * service is suspended, because each of them would be an opinion about a
 * document nobody could open. Before this check, `validate --feature` said
 * nothing about the file: the empty parse skipped every baseline pin and
 * removal marker in it, and graded requirements against a contract that was
 * never read.
 *
 * "Every other contract-axis check" means exactly the ones that READ a
 * contract. The second suite below holds the other edge of that line: the
 * governance question (`c4.op-ungoverned`) joins a tagged edge against
 * requirement DOCUMENTS alone, so a broken YAML cannot change its answer and
 * suspending it only deferred a true warning until somebody fixed an unrelated
 * file.
 *
 * Mirrors the living-side suite ("service mode: openapi.invalid" in
 * test/validate.test.ts) on the feature target.
 */
import { describe, expect, it } from "vitest";
import {
  coherentFixture,
  makeProject,
  runLoam,
  treeHashes,
  pinFor,
  LIVING_SPEC,
  LIVING_OPENAPI,
  FEATURE_DELTA,
  FEATURE_SPEC,
  type Project,
} from "./helpers/harness.js";

const SVC = "payment-service";
const FEATURE_DIR = "features/FEAT-1-split";

async function withProject(
  files: Record<string, string>,
  fn: (p: Project) => Promise<void>,
): Promise<void> {
  const p = await makeProject(files, { service: SVC });
  try {
    await fn(p);
  } finally {
    await p.destroy();
  }
}

interface JsonFinding {
  severity: string;
  code: string;
  subject?: string;
  gates?: boolean;
  message: string;
}

/** Every finding across every target of a --json run. */
function jsonFindings(stdout: string): JsonFinding[] {
  const payload = JSON.parse(stdout) as { targets: Array<{ findings: JsonFinding[] }> };
  return payload.targets.flatMap((t) => t.findings);
}

function byCode(all: JsonFinding[], code: string): JsonFinding[] {
  return all.filter((f) => f.code === code);
}

/** The same definitely-broken YAML the living-side suite uses. */
const BROKEN_YAML = "paths: [unclosed\n  bar: ::::\n";

/**
 * A payment-service delta whose contract half lives entirely in the feature's
 * openapi.yaml — which the tests below break. Both requirements are exactly
 * the shapes that used to false-fire off the empty parse of that file:
 *
 * - the ADDED requirement governs `refundPayment`, an operation the broken
 *   contract WOULD define — graded against zero ops it read as
 *   `spec-api.op-undefined`, pointing at the requirement when the truth is
 *   the YAML;
 * - the REMOVED requirement retires `authorizePayment`, whose
 *   `x-loam-remove` marker likewise lives in the broken file — the empty
 *   parse read "no marker" and reported `openapi.remove-marker-missing` to an
 *   author staring at the marker.
 *
 * The REMOVED requirement is pinned (Based-On) exactly as `loam rebase`
 * would write it, so the requirement-baseline gate does not fire on the
 * fixture instead of the behavior under test.
 */
const PAYMENT_DELTA_SPEC = `# payment-service — delta for FEAT-1

## ADDED Requirements

### Requirement: Refund a payment
The service SHALL refund an authorized payment on request.

Operations: refundPayment

#### Scenario: Refund succeeds
- **Given** an authorized payment
- **When** a refund is requested
- **Then** the payment is refunded

## REMOVED Requirements

### Requirement: Authorize a payment
Based-On: ${pinFor(LIVING_SPEC, "Authorize a payment")}

Operations: authorizePayment
`;

/** The coherent fixture, plus a payment-service delta whose contract is unreadable. */
function brokenFeatureContract(): Record<string, string> {
  const files = coherentFixture();
  files[`${FEATURE_DIR}/specs/${SVC}/spec.md`] = PAYMENT_DELTA_SPEC;
  files[`${FEATURE_DIR}/specs/${SVC}/openapi.yaml`] = BROKEN_YAML;
  return files;
}

describe("feature mode: openapi.invalid — the broken contract is the error, not its neighbours", () => {
  it("broken YAML reports openapi.invalid (error) and suspends the service's contract-axis checks", async () => {
    await withProject(brokenFeatureContract(), async (p) => {
      const res = await runLoam(p.workDir, "validate", "--feature", "FEAT-1", "--json");
      expect(res.code).toBe(1); // an unreadable source of truth is an error
      const all = jsonFindings(res.stdout);
      const invalid = byCode(all, "openapi.invalid");
      expect(invalid).toHaveLength(1);
      expect(invalid[0]).toMatchObject({ severity: "error", subject: SVC, gates: true });
      expect(invalid[0]!.message).toContain("does not parse");
      // The op the requirement governs may well be defined in the file nobody
      // could open — `op-undefined` would point at the requirement when the
      // truth is the YAML.
      expect(byCode(all, "spec-api.op-undefined")).toEqual([]);
      // The REMOVED requirement's removal marker lives in the same file:
      // "no matching marker" would be a claim about a document nobody read.
      expect(byCode(all, "openapi.remove-marker-missing")).toEqual([]);
      // No baseline verdicts either — the restated living slots this file
      // would carry (pinned or not) were never read, so neither "missing"
      // nor "stale" nor "invalid" can honestly be said of them.
      expect(all.filter((f) => f.code.startsWith("openapi.baseline"))).toEqual([]);
      // One breach, one finding: openapi.invalid is the whole error story.
      expect(all.filter((f) => f.severity === "error").map((f) => f.code)).toEqual([
        "openapi.invalid",
      ]);
    });
  });

  it("the archive is refused (not-coherent) on the same error, and writes nothing", async () => {
    await withProject(brokenFeatureContract(), async (p) => {
      const before = await treeHashes(p.docsDir);
      const res = await runLoam(p.workDir, "archive", "FEAT-1", "--json");
      expect(res.code).toBe(1);
      const json = JSON.parse(res.out);
      expect(json.ok).toBe(false);
      expect(json.error.code).toBe("not-coherent");
      const invalid = json.issues.filter((i: { code: string }) => i.code === "openapi.invalid");
      expect(invalid).toHaveLength(1);
      expect(invalid[0]).toMatchObject({ severity: "error", gates: true });
      expect(await treeHashes(p.docsDir), "a refused archive must write nothing").toEqual(before);
    });
  });

  it("an ABSENT feature openapi stays silent — absence is legal, not unreadable", async () => {
    const files = coherentFixture();
    delete files[`${FEATURE_DIR}/specs/payment-split-service/openapi.yaml`];
    // With no contract for the new service, the requirement and the edge stop
    // naming operations — otherwise their own op-undefined errors would fire
    // over the ops the deleted file defined, and the question here is about
    // the absent FILE alone.
    files[`${FEATURE_DIR}/specs/payment-split-service/spec.md`] = FEATURE_SPEC.replace(
      "\nOperations: createSplit\n",
      "",
    );
    files[`${FEATURE_DIR}/delta.likec4`] = FEATURE_DELTA.replace(
      "'Calls createSplit'",
      "'Sends split work'",
    ).replace("    metadata { op 'createSplit' }\n", "");
    await withProject(files, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--feature", "FEAT-1", "--json");
      expect(res.code).toBe(0);
      expect(byCode(jsonFindings(res.stdout), "openapi.invalid")).toEqual([]);
    });
  });
});

/* ------------------------------------------------------------------ */
/* The other edge of the suspension: what does NOT read the contract    */
/* ------------------------------------------------------------------ */

/**
 * A payment-service delta whose requirement half is deliberately smaller than
 * PAYMENT_DELTA_SPEC's: one ADDED requirement, no REMOVED one. The suite below
 * has to swap the broken YAML for a READABLE contract as its control, and a
 * REMOVED requirement would then demand a removal marker addressing a living
 * slot — machinery this subject does not need, whose own findings would
 * crowd the two codes being weighed.
 */
const PAYMENT_EDGE_SPEC = `# payment-service — delta for FEAT-1

## ADDED Requirements

### Requirement: Refund a payment
The service SHALL refund an authorized payment on request.

Operations: refundPayment

#### Scenario: Refund succeeds
- **Given** an authorized payment
- **When** a refund is requested
- **Then** the payment is refunded
`;

/**
 * The readable counterpart to BROKEN_YAML for the same service: one genuinely
 * NEW operation, restating nothing living. Restating would drag the baseline
 * axis in (`openapi.baseline-missing` gates), and the control here only needs
 * the contract to PARSE.
 */
const PAYMENT_EDGE_OPENAPI = `openapi: 3.1.0
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
                type: object
                properties:
                  status:
                    type: string
`;

/** FEATURE_DELTA plus one tagged edge INTO payment-service naming `op`. */
function deltaCalling(op: string): string {
  const edge = `  paymentSplitService -> paymentService 'Calls ${op}' {\n    #FEAT-1\n    metadata { op '${op}' }\n  }\n`;
  return FEATURE_DELTA.replace("}\n\nviews {", `${edge}}\n\nviews {`);
}

/**
 * The coherent fixture with a tagged edge calling `op` on payment-service, and
 * payment-service's own feature contract set to `contract` — BROKEN_YAML for
 * the suspended case, PAYMENT_EDGE_OPENAPI for the control that proves the
 * fixture is live.
 */
function edgeAgainstContract(op: string, contract: string): Record<string, string> {
  const files = coherentFixture();
  files[`${FEATURE_DIR}/delta.likec4`] = deltaCalling(op);
  files[`${FEATURE_DIR}/specs/${SVC}/spec.md`] = PAYMENT_EDGE_SPEC;
  files[`${FEATURE_DIR}/specs/${SVC}/openapi.yaml`] = contract;
  return files;
}

describe("feature mode: an unreadable contract does not suspend the governance question", () => {
  it("reports openapi.invalid AND c4.op-ungoverned in one run", async () => {
    // The edge calls 'settlePayment': no requirement in the delta names it
    // (PAYMENT_EDGE_SPEC governs refundPayment) and none in the living spec
    // does either (LIVING_SPEC governs authorizePayment). Nothing about that
    // join goes near openapi.yaml, so the broken YAML cannot change its
    // answer — and before the narrowing it did, because the unreadable
    // contract skipped the whole edge and the warning only appeared once
    // somebody fixed an unrelated file.
    await withProject(edgeAgainstContract("settlePayment", BROKEN_YAML), async (p) => {
      const res = await runLoam(p.workDir, "validate", "--feature", "FEAT-1", "--json");
      expect(res.code).toBe(1); // the unreadable contract is still the error
      const all = jsonFindings(res.stdout);
      expect(byCode(all, "openapi.invalid")).toHaveLength(1);
      const ungoverned = byCode(all, "c4.op-ungoverned");
      expect(ungoverned).toHaveLength(1);
      expect(ungoverned[0]).toMatchObject({ severity: "warn" });
      // The operation id, not the wording: this must be the edge's op and not
      // the fixture's other one.
      expect(ungoverned[0]!.message).toContain("settlePayment");
      // Narrowed, not deleted: the verdicts that READ the contract stay
      // suspended, so a fix that dropped the suspension outright fails here.
      expect(byCode(all, "c4-api.op-undefined")).toEqual([]);
      expect(byCode(all, "c4-api.op-pending")).toEqual([]);
      expect(byCode(all, "c4-api.op-removing")).toEqual([]);
      // One breach, one error — the governance answer arrives as a warn.
      expect(all.filter((f) => f.severity === "error").map((f) => f.code)).toEqual([
        "openapi.invalid",
      ]);
    });
  });

  it("control: a requirement governing the op leaves openapi.invalid alone", async () => {
    // Byte-identical to the run above but for the Operations: line, so the
    // warning above provably came from the requirement join and not from the
    // broken YAML. E1 stays suspended over the same requirement, which is why
    // governing an operation the unreadable contract may or may not define
    // costs nothing.
    const files = edgeAgainstContract("settlePayment", BROKEN_YAML);
    files[`${FEATURE_DIR}/specs/${SVC}/spec.md`] = PAYMENT_EDGE_SPEC.replace(
      "Operations: refundPayment",
      "Operations: refundPayment, settlePayment",
    );
    await withProject(files, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--feature", "FEAT-1", "--json");
      expect(res.code).toBe(1);
      const all = jsonFindings(res.stdout);
      expect(byCode(all, "openapi.invalid")).toHaveLength(1);
      expect(byCode(all, "c4.op-ungoverned")).toEqual([]);
      expect(byCode(all, "spec-api.op-undefined")).toEqual([]);
    });
  });

  it("the archive refuses on openapi.invalid and writes nothing, warning notwithstanding", async () => {
    // c4.op-ungoverned is a non-gating warn, so it must not be what refuses —
    // and the refusal must still leave the docs repo byte-identical. A
    // narrowing that let one more finding through the same run is exactly the
    // change that could turn a clean refusal into a partial write.
    await withProject(edgeAgainstContract("settlePayment", BROKEN_YAML), async (p) => {
      const before = await treeHashes(p.docsDir);
      const res = await runLoam(p.workDir, "archive", "FEAT-1", "--json");
      expect(res.code).toBe(1);
      const json = JSON.parse(res.out);
      expect(json.ok).toBe(false);
      expect(json.error.code).toBe("not-coherent");
      const codes = json.issues.map((i: { code: string }) => i.code);
      expect(codes).toContain("openapi.invalid");
      expect(codes).toContain("c4.op-ungoverned");
      expect(await treeHashes(p.docsDir), "a refused archive must write nothing").toEqual(before);
    });
  });
});

/** The living contract with authorizePayment marked as on its way out. */
const DEPRECATED_LIVING = LIVING_OPENAPI.replace(
  "      operationId: authorizePayment\n",
  "      operationId: authorizePayment\n      deprecated: true\n",
);

describe("feature mode: the deprecation warning stays suspended with the contract", () => {
  // c4-api.op-deprecated reads the feature's own openapi to ask whether THIS
  // feature is the un-deprecation, so an unreadable one makes it an opinion
  // about a document nobody opened — it belongs on the suspended side of the
  // narrowed line. This pair does not discriminate against the code before the
  // narrowing (the whole-edge skip covered it too); it pins the explicit
  // `!contractUnreadable` guard the narrowing had to add, which is the line a
  // future edit is most likely to drop.

  it("an unreadable feature contract silences it", async () => {
    // Every condition the warning needs is met except a readable contract: the
    // living openapi deprecates authorizePayment, a tagged edge builds new
    // consumption on it, and the feature contract — unreadable — cannot be the
    // un-deprecation. The control below runs the same fixture with the YAML
    // repaired and gets the warning.
    const files = edgeAgainstContract("authorizePayment", BROKEN_YAML);
    files[`services/${SVC}/openapi.yaml`] = DEPRECATED_LIVING;
    await withProject(files, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--feature", "FEAT-1", "--json");
      expect(res.code).toBe(1);
      const all = jsonFindings(res.stdout);
      expect(byCode(all, "openapi.invalid")).toHaveLength(1); // the fixture IS in the broken state
      expect(byCode(all, "c4-api.op-deprecated")).toEqual([]);
    });
  });

  it("control: the same edge over a READABLE contract warns", async () => {
    const files = edgeAgainstContract("authorizePayment", PAYMENT_EDGE_OPENAPI);
    files[`services/${SVC}/openapi.yaml`] = DEPRECATED_LIVING;
    await withProject(files, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--feature", "FEAT-1", "--json");
      const all = jsonFindings(res.stdout);
      expect(byCode(all, "openapi.invalid")).toEqual([]);
      expect(byCode(all, "c4-api.op-deprecated")).toHaveLength(1);
    });
  });
});
