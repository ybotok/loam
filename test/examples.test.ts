/**
 * Pins examples/docs — the README's "Try it" target and SCHEMA.md's runnable
 * companion — against the real commands. Nothing else in the suite reads the
 * example tree, so without this file it can drift from the checks (a new
 * validate rule, a changed archive gate) and the first person to notice is a
 * reader following the README. A failure here means the example and the code
 * disagree: make the example exemplary again, do not loosen the assertions.
 *
 * The warning set is pinned EXACTLY, not merely bounded. Every warning the
 * example carries is a deliberate demonstration — examples/README.md has the
 * table naming what each one teaches — and an exact match makes any new code
 * that starts firing on the example loud instead of quietly accumulating.
 *
 * The fleet is five services and three features at three points in their life:
 * FEAT-088 already archived by a real `loam archive` (snapshot and verification
 * record included), FEAT-101 in flight with a new service arriving, FEAT-112 in
 * flight retiring an operation. Both in-flight archives are planned here
 * file-for-file, because the two plans exercise different halves of the merge.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeTmpDir, runLoam, treeHashes } from "./helpers/harness.js";

const EXAMPLES = fileURLToPath(new URL("../examples/docs", import.meta.url));

// The example is copied into a temp dir rather than validated in place: only
// read-only commands run here today, but a test must not be one bug away from
// rewriting the repo's own example tree.
let root: string;
let workDir: string;
let docsDir: string;

beforeAll(async () => {
  root = await makeTmpDir();
  workDir = join(root, "work");
  docsDir = join(root, "docs");
  await mkdir(workDir, { recursive: true });
  await cp(EXAMPLES, docsDir, { recursive: true });
  await writeFile(
    join(workDir, "loam.json"),
    JSON.stringify({ docsDir }, null, 2) + "\n",
    "utf8",
  );
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

const findings = (payload: {
  targets: Array<{ findings: Array<{ severity: string; code: string }> }>;
}): Array<{ severity: string; code: string }> => payload.targets.flatMap((t) => t.findings);

describe("examples/docs vs loam validate --all", () => {
  it("is valid: zero errors, and exactly the seven demonstration warnings", async () => {
    const res = await runLoam(workDir, "validate", "--all", "--json");
    expect(res.code).toBe(0);
    const payload = JSON.parse(res.stdout);
    expect(payload.ok).toBe(true);
    expect(payload.valid).toBe(true);
    expect(payload.summary).toEqual({ services: 5, features: 2, errors: 0, warnings: 7 });

    const bySeverity = (sev: string) =>
      findings(payload)
        .filter((f) => f.severity === sev)
        .map((f) => f.code)
        .sort();
    expect(bySeverity("error")).toEqual([]);
    // Each of these is authored on purpose; examples/README.md says what for.
    // `api.requirement-deprecated` twice: IDN-VALIDATE-LEGACY and ORD-PLACE-V1
    // each govern only an operation their contract marks deprecated, and only
    // one of the two has a feature open to retire it.
    expect(bySeverity("warn")).toEqual([
      "api.requirement-deprecated",
      "api.requirement-deprecated",
      "c4.uncovered",
      "permissions.unenforced",
      "sources.absent",
      "spine.op-deprecated",
      "spine.op-link-missing",
    ]);
  });

  it("counts four services' sources as unverifiable from outside their repos", async () => {
    // Four living specs name `sources` and this workdir is none of those repos,
    // so the fleet summary reports the blind spot instead of resolving it.
    // checkout-web is the fifth and names none at all — that is `sources.absent`.
    const res = await runLoam(workDir, "validate", "--all", "--json");
    expect(JSON.parse(res.stdout).sourcesUnverifiableFromHere).toBe(4);
  });
});

describe("examples/docs vs loam archive FEAT-101 --dry-run", () => {
  it("plans a coherent six-file merge plus the move, warning only that the new service has no model", async () => {
    const res = await runLoam(workDir, "archive", "FEAT-101", "--dry-run", "--json");
    expect(res.code).toBe(0);
    const payload = JSON.parse(res.stdout);
    expect(payload.ok).toBe(true);
    expect(payload.feature).toBe("FEAT-101");
    expect(payload.archived).toBe(false);
    // FEAT-101 creates services/payment-split-service/ — spec, arch spec and
    // contract — and the landscape gains the element, but nothing writes the
    // service's own model.likec4. Archive used to close with "complete and
    // current" and leave `validate --all` reporting a service it had just
    // created as incomplete; it says so up front now. Advisory: it never gates.
    expect(payload.warnings).toEqual([
      {
        severity: "warn",
        code: "service.no-model",
        gates: false,
        overridable: true,
        subject: "payment-split-service",
        message: expect.stringContaining("model.likec4"),
      },
    ]);
    expect(payload.overridden).toEqual([]);
    expect(payload.plan).toEqual([
      { path: "services/checkout-web/spec.md", action: "update" },
      { path: "services/payment-service/spec.md", action: "update" },
      { path: "services/payment-split-service/spec.md", action: "create" },
      { path: "services/payment-split-service/arch.spec.md", action: "create" },
      { path: "services/payment-split-service/openapi.yaml", action: "create" },
      { path: "architecture/landscape.likec4", action: "update" },
      {
        path: "features/FEAT-101-payment-splitting",
        action: "move",
        to: "features/archive/FEAT-101-payment-splitting",
      },
    ]);
  });

  it("writes nothing — the example tree is byte-identical after the dry run", async () => {
    const before = await treeHashes(docsDir);
    const res = await runLoam(workDir, "archive", "FEAT-101", "--dry-run");
    expect(res.code).toBe(0);
    expect(res.out).toContain("dry run — nothing was written");
    expect(await treeHashes(docsDir)).toEqual(before);
  });
});

describe("examples/docs vs loam archive FEAT-112 --dry-run", () => {
  it("plans the removal of an operation: the REMOVED requirement and the marker's slot", async () => {
    // The other half of the merge, and the shape a one-service change takes:
    // no delta.likec4 at all, no new file, and an operation leaving the living
    // contract because a REMOVED requirement and an `x-loam-remove: true`
    // marker name it together.
    const res = await runLoam(workDir, "archive", "FEAT-112", "--dry-run", "--json");
    expect(res.code).toBe(0);
    const payload = JSON.parse(res.stdout);
    expect(payload.ok).toBe(true);
    expect(payload.warnings).toEqual([]);
    expect(payload.openapiRemovals).toEqual([
      { service: "order-service", operations: ["'createOrderV1' (post /v1/orders)"] },
    ]);
    expect(payload.plan).toEqual([
      { path: "services/order-service/spec.md", action: "update" },
      { path: "services/order-service/openapi.yaml", action: "update" },
      {
        path: "features/FEAT-112-retire-order-v1",
        action: "move",
        to: "features/archive/FEAT-112-retire-order-v1",
      },
    ]);
  });
});

describe("examples/docs vs loam verify FEAT-088", () => {
  it("reads the archived feature's record as frozen, and as attested rather than verified", async () => {
    // The record was written by a real `loam verify --record` before the real
    // `loam archive`, so every claim is confirmed and five of them rest on an
    // agent's word instead of a digest-matched test run. `verified` is reserved
    // for a green run, and the example is here to show the difference standing.
    const res = await runLoam(workDir, "verify", "FEAT-088", "--json");
    expect(res.code).toBe(0);
    const payload = JSON.parse(res.stdout);
    expect(payload.ok).toBe(true);
    expect(payload.frozen).toBe(true);
    expect(payload.verdict).toBe("attested");
    expect(payload.verified).toBe(false);
    expect(payload.attested).toBe(5);
    expect(payload.summary).toEqual({ claims: 7, confirmed: 7, unconfirmed: 0 });
  });
});
