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
 * All five models are EXTENDING models — no `specification` block, no partner
 * copies, `extend marketplace.<svc> { … }` on the element the fleet map binds to
 * the directory — and no `likec4.config.json` sits beside any of them. That is
 * what keeps the warning set below at exactly ten: nothing standalone, so no
 * `service.likec4-config-missing`; every added element under its own service, so
 * no `c4.element-unowned`; every health dependency reaching an element of the
 * model's own slice, so no `health.dependency-unmodelled`. The root
 * `likec4.config.json` excludes only the node_modules glob and `features`, which
 * is exactly what `subsystem sync` would write (the assertion below spells both
 * entries), so the "sync is current" assertion covers the exclude list too.
 *
 * The fleet is five services and four features at four points in their life:
 * FEAT-088 and FEAT-120 already archived by a real `loam archive` (snapshot and
 * verification record included), FEAT-101 in flight with a new service arriving,
 * FEAT-112 in flight retiring an operation. Both in-flight archives are planned
 * here file-for-file, because the two plans exercise different halves of the merge.
 *
 * The two archived records are a MATCHED PAIR and the pairing is the point:
 * FEAT-088's scenario claims rest on an agent's word (`attested`), FEAT-120's on
 * a digest-matched runner report (`verified`). A showcase that demonstrated only
 * one of them would teach that the distinction is decorative — which is the one
 * thing this product may not teach, since keeping those two answers apart is
 * most of what it claims to be for.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync } from "node:fs";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
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

describe("examples/docs governs itself", () => {
  it("carries the loam.json the `cd examples/docs` walkthrough depends on", async () => {
    // examples/README.md tells a reader to `cd examples/docs` and run the
    // binary from inside the tree, and that only works because the tree ships
    // the config `loam init --docs . --create` writes. It did not until now:
    // `loam status` there answered "No loam.json found" and exited 1, and the
    // page's workaround was a throwaway config at the loam repository ROOT —
    // which then governed every directory under it, so `loam init` from a
    // sibling refused and forgetting to delete it silently redirected later
    // commands at the example fleet. Nothing pinned the file the walkthrough
    // needs, so nothing would notice it going missing again.
    //
    // Asserted against the COPY rather than examples/ itself, like everything
    // else in this file: what a reader clones is what has to work. Parsed
    // rather than compared byte-for-byte because git hands a Windows clone
    // CRLF and a Linux one LF; the walkthrough depends on the resolved
    // docsDir, not on the newline.
    const raw = await readFile(join(docsDir, "loam.json"), "utf8");
    expect(JSON.parse(raw)).toEqual({ docsDir: "." });

    // And the property that config exists for: a command run from inside the
    // tree resolves to this fleet, with no loam.json anywhere above it.
    const res = await runLoam(docsDir, "status", "--json");
    expect(res.code).toBe(0);
    const payload = JSON.parse(res.stdout);
    expect(payload.ok).toBe(true);
    expect(payload.services.total).toBe(5);
  });

  it("carries five extending models, no per-service project file, and the scaffold's root exclude", async () => {
    // The shape assertion behind the warning set. Read off the TREE rather than
    // off a finding, because the interesting failure is a model quietly regaining
    // a `specification` block: `validate --all` would then still be green — a
    // standalone model is legal — while the example stopped teaching the shape
    // `loam adopt` briefs, and `service.likec4-config-missing` would appear as
    // the eleventh warning one edit later.
    const root = JSON.parse(await readFile(join(docsDir, "likec4.config.json"), "utf8"));
    expect(root.exclude).toEqual(["**/node_modules/**", "features/**"]);
    for (const tree of [
      "checkout-web",
      "order-service",
      "payment-service",
      "platform/identity-service",
      "platform/notification-service",
    ]) {
      const dir = join(docsDir, "services", ...tree.split("/"));
      const model = await readFile(join(dir, "model.likec4"), "utf8");
      expect(model, `${tree}: model.likec4 must extend the fleet map`).toContain(
        "extend marketplace.",
      );
      expect(model, `${tree}: an extending model declares no specification`).not.toContain(
        "specification {",
      );
      expect(
        existsSync(join(dir, "likec4.config.json")),
        `${tree}: an extending model never carries a likec4.config.json`,
      ).toBe(false);
    }
  });
});

describe("examples/docs vs loam validate --all", () => {
  it("is valid: zero errors, and exactly the ten demonstration warnings", async () => {
    const res = await runLoam(workDir, "validate", "--all", "--json");
    expect(res.code).toBe(0);
    const payload = JSON.parse(res.stdout);
    expect(payload.ok).toBe(true);
    expect(payload.valid).toBe(true);
    expect(payload.summary).toEqual({ services: 5, features: 2, errors: 0, warnings: 10 });

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
      // `checkout#CHECKOUT-PRICE-HONOURED` — one promise inside a capability
      // whose OTHER requirement three services realize, so the code below stays
      // silent about it. That contrast is the demonstration.
      "capability.requirement-unrealized",
      // `payments/settlement` — a whole capability nothing realizes.
      "capability.unrealized",
      // `idempotency-key` — an architectural obligation declared and placed
      // nowhere. Its sibling `outbox` IS placed, on the publish edge, and IS
      // covered by ARCH-PAY-OUTBOX, so the axis's working join is silent here:
      // the example demonstrates the gap, not the machinery.
      "obligation.unapplied",
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

describe("examples/docs vs the subsystem tree", () => {
  it("files two services into platform/ and keeps the committed views file exactly current", async () => {
    // The permitted filing set is {identity-service, notification-service,
    // checkout-web}: FEAT-088's committed VERSION-2 snapshot restores
    // order-service and payment-service by literal path, so filing either
    // would break the README's `loam unarchive FEAT-088` walkthrough.
    const list = JSON.parse((await runLoam(workDir, "list", "--json")).stdout);
    expect(list.subsystems).toEqual([
      { name: "platform", path: "services/platform", title: "Platform", memberCount: 2 },
    ]);
    expect(list.unfiledServices).toBe(3);
    const filed = (id: string) =>
      list.services.find((s: { id: string }) => s.id === id).subsystem;
    expect(filed("identity-service")).toEqual(["platform"]);
    expect(filed("notification-service")).toEqual(["platform"]);
    expect(filed("order-service")).toEqual([]);

    // The generated file in the tree is byte-exact: sync answers `current`
    // and writes nothing, which is also what keeps `validate --all` above at
    // zero errors — a stale (or hand-edited) copy would be
    // `subsystem.views-stale`. `sync` also owns the RENDERER wiring now, so
    // "writes nothing" covers two more facts: no per-service
    // `likec4.config.json` is owed (every model extends the map) and the root
    // project's `exclude` already equals what sync would compute.
    const before = await treeHashes(docsDir);
    const sync = await runLoam(workDir, "subsystem", "sync", "--json");
    expect(sync.code).toBe(0);
    expect(JSON.parse(sync.stdout).action).toBe("current");
    expect(await treeHashes(docsDir)).toEqual(before);
  });
});

describe("examples/docs vs loam archive FEAT-101 --dry-run", () => {
  it("plans a coherent seven-file merge plus the move, warning only that the new service has no model", async () => {
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
        // The two keys the shared finding serializer adds to every finding.
        // This producer proves no exact file or line, so `locations` carries
        // the narrowest scope the run proved — the feature being archived.
        details: [],
        locations: [{ path: "features/archive/FEAT-101-payment-splitting", role: "scope" }],
      },
    ]);
    expect(payload.overridden).toEqual([]);
    // The asyncapi update is the event axis's half of the merge: the delta's
    // pinned quotes leave the living slots alone (no *-modified warning above),
    // and only the new payment.PaymentSplitAuthorized slots are written.
    expect(payload.asyncapiRemovals).toEqual([]);
    expect(payload.plan).toEqual([
      { path: "services/checkout-web/spec.md", action: "update" },
      { path: "services/payment-service/spec.md", action: "update" },
      { path: "services/payment-split-service/spec.md", action: "create" },
      { path: "services/payment-split-service/arch.spec.md", action: "create" },
      { path: "services/payment-split-service/openapi.yaml", action: "create" },
      { path: "services/payment-service/asyncapi.yaml", action: "update" },
      { path: "architecture/landscape.likec4", action: "update" },
      {
        path: "features/FEAT-101-payment-splitting",
        action: "move",
        to: "features/archive/FEAT-101-payment-splitting",
      },
    ]);
  });

  it("derives the event.declares claim from the asyncapi delta — the new message only, never the pinned quotes", async () => {
    const res = await runLoam(workDir, "verify", "FEAT-101", "--json");
    expect(res.code).toBe(0);
    const claims = JSON.parse(res.stdout).claims as Array<{ kind: string; subject: string; claim: string }>;
    expect(claims.filter((c) => c.kind === "event.declares")).toEqual([
      expect.objectContaining({
        subject: "payment-service",
        claim: "payment-service declares it sends message 'payment.PaymentSplitAuthorized'",
      }),
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
    expect(payload.asyncapiRemovals).toEqual([]);
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

describe("examples/docs vs the two archived verification records", () => {
  it("reads FEAT-088 as frozen, and as attested rather than verified", async () => {
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

  it("reads FEAT-120 as verified, on a runner report no cucumber wrote", async () => {
    // The other half of the pair. Its five scenario claims were answered by
    // `--results` from `scenario-report.json` — loam's own runner-neutral
    // `{"loamScenarioReport": 1, …}` shape — so the verdict is `verified` with
    // nothing attested, while its two `event.declares` claims still rest on an
    // agent's word. That mix is the honest common case: a fleet whose suite
    // answers the scenarios and whose wiring claims a human still vouches for.
    const res = await runLoam(workDir, "verify", "FEAT-120", "--json");
    expect(res.code).toBe(0);
    const payload = JSON.parse(res.stdout);
    expect(payload.ok).toBe(true);
    expect(payload.frozen).toBe(true);
    expect(payload.verdict).toBe("verified");
    expect(payload.verified).toBe(true);
    expect(payload.attested).toBe(0);
    expect(payload.summary).toEqual({ claims: 7, confirmed: 7, unconfirmed: 0 });
  });

  it("keeps the two verdicts apart — the example exists to show the difference standing", async () => {
    // If these ever agree, either the distinction collapsed or somebody
    // "fixed" the example by making both sides the same. Both are regressions.
    const [attested, verified] = await Promise.all([
      runLoam(workDir, "verify", "FEAT-088", "--json"),
      runLoam(workDir, "verify", "FEAT-120", "--json"),
    ]);
    expect(JSON.parse(attested.stdout).verdict).toBe("attested");
    expect(JSON.parse(verified.stdout).verdict).toBe("verified");
  });
});
