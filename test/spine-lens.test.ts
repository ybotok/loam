/**
 * `loam validate --spine` — level 1 of adoption: the fleet's joins graded on
 * their own, before anybody has written a model, a spec or a requirement.
 *
 * The fixture is the five services of `examples/docs` with nothing but their
 * six contracts copied in and a map whose edges name operations and messages
 * — the state `loam seed` leaves a fleet in once fleet.yaml states its joins.
 * The map is written here directly, edge by edge in seed's shape, rather than
 * seeded, so this file pins the LENS and nothing about how seed draws.
 *
 * What it pins, in the order the design states the invariants:
 *   - a fleet whose joins are right is green under the lens, and the default
 *     run over the same tree did not move a byte of its shape (I4's other half:
 *     the lens partitions, it never re-grades);
 *   - the lens FAILS VISIBLE: the codes that mean a join was suspended or never
 *     checked are shown, by name, and the whole hidden set is a snapshot a new
 *     code cannot join without somebody deciding it should;
 *   - a lensed run always says what it hid, by code, and how many joins it
 *     checked — including "none" in words (I5);
 *   - a feature is refused under the lens, however it was named.
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { coherentFixture, makeProject, runLoam, type Project } from "./helpers/harness.js";
import { collectEmittedCodes } from "./helpers/stable-codes.js";
import {
  SPINE_HIDE_EXACT,
  SPINE_HIDE_PREFIX,
  SPINE_MUST_SHOW,
  spineHides,
} from "../src/commands/validate/lens/spine.js";

const EXAMPLE_SERVICES = fileURLToPath(new URL("../examples/docs/services/", import.meta.url));

/** The six contracts the example fleet's joins are checked against, docs-relative. */
const CONTRACTS = [
  "services/order-service/openapi.yaml",
  "services/order-service/asyncapi.yaml",
  "services/payment-service/openapi.yaml",
  "services/payment-service/asyncapi.yaml",
  "services/platform/identity-service/openapi.yaml",
  "services/platform/notification-service/asyncapi.yaml",
];

const SERVICE_DIRS = [
  "services/checkout-web",
  "services/order-service",
  "services/payment-service",
  "services/platform/identity-service",
  "services/platform/notification-service",
];

/** One joined edge, in the shape seed draws it: kind, title = the id, one metadata key. */
function joined(from: string, kind: "calls" | "publishes" | "delivers", to: string, id: string): string {
  const key = kind === "calls" ? "op" : kind === "publishes" ? "publishes" : "consumes";
  return `  ${from} -[${kind}]-> ${to} '${id}' {\n    metadata { ${key} '${id}' }\n  }\n`;
}

/** The example fleet's joins — seven operations, three publishes, three consumes, two bare calls. */
function joins(over: { authorize?: string; captured?: string; introspect?: string } = {}): string {
  return (
    joined("svc_checkout_web", "calls", "svc_order_service", "createOrder") +
    joined("svc_checkout_web", "calls", "svc_order_service", "getOrder") +
    joined("svc_checkout_web", "calls", "svc_payment_service", over.authorize ?? "authorizePayment") +
    "  ext_customer -[calls]-> svc_checkout_web\n" +
    joined("svc_order_service", "calls", "svc_identity_service", over.introspect ?? "introspectToken") +
    joined("svc_order_service", "calls", "svc_payment_service", "capturePayment") +
    joined("svc_order_service", "calls", "svc_payment_service", "refundPayment") +
    joined("svc_payment_service", "calls", "svc_identity_service", "introspectToken") +
    "  svc_payment_service -[calls]-> ext_stripe\n" +
    joined("svc_order_service", "publishes", "ext_kafka", "order.OrderPlaced") +
    joined("svc_payment_service", "publishes", "ext_kafka", "payment.PaymentAuthorized") +
    joined("svc_payment_service", "publishes", "ext_kafka", "payment.PaymentCaptured") +
    joined("ext_kafka", "delivers", "svc_notification_service", "order.OrderPlaced") +
    joined("ext_kafka", "delivers", "svc_notification_service", over.captured ?? "payment.PaymentCaptured") +
    joined("ext_kafka", "delivers", "svc_order_service", "payment.PaymentAuthorized")
  );
}

/** The same fleet's calls with no join stated — a fleet.yaml written before the joins could be. */
const BARE_CALLS = [
  "  ext_customer -[calls]-> svc_checkout_web",
  "  svc_checkout_web -[calls]-> svc_order_service",
  "  svc_checkout_web -[calls]-> svc_payment_service",
  "  svc_order_service -[calls]-> svc_identity_service",
  "  svc_order_service -[calls]-> svc_payment_service",
  "  svc_payment_service -[calls]-> svc_identity_service",
  "  svc_payment_service -[calls]-> ext_stripe",
  "",
].join("\n");

function landscape(edges: string): string {
  const services = ["checkout-web", "identity-service", "notification-service", "order-service", "payment-service"];
  const elements = [
    ...services.map((s) => `  svc_${s.replaceAll("-", "_")} = softwareSystem '${s}' {\n    metadata { service '${s}' }\n  }\n`),
    ...["customer", "kafka", "stripe"].map((x) => `  ext_${x} = softwareSystem '${x}' {\n    #external\n  }\n`),
  ].join("");
  return (
    "specification {\n  element person\n  element softwareSystem\n  element container\n  element database\n" +
    "  tag platform\n  tag external\n  relationship publishes\n  relationship delivers\n  relationship calls\n}\n\n" +
    `model {\n${elements}\n${edges}}\n`
  );
}

/** The example fleet at level 1: directories, the subsystem marker, six contracts, and `edges` on the map. */
async function spineFleet(edges = joins(), extra: Record<string, string> = {}): Promise<Project> {
  const files: Record<string, string> = {
    "architecture/landscape.likec4": landscape(edges),
    "services/platform/subsystem.yaml": "# subsystem marker\n",
  };
  for (const dir of SERVICE_DIRS) files[`${dir}/.gitkeep`] = "";
  for (const path of CONTRACTS) {
    files[path] = await readFile(join(EXAMPLE_SERVICES, path.slice("services/".length)), "utf8");
  }
  return makeProject({ ...files, ...extra });
}

interface Finding {
  severity: string;
  code: string;
  message: string;
}
interface Target {
  kind: string;
  id: string;
  findings: Finding[];
}
interface Lens {
  name: string;
  joins?: { operations: number; messages: number; drawnOnly: string[]; toExternals: number };
  hidden: { errors: number; warnings: number; byCode: Record<string, number> };
  featuresSkipped: number;
}
interface Payload {
  ok: boolean;
  valid?: boolean;
  summary?: { services: number; features: number; errors: number; warnings: number };
  lens?: Lens;
  scorecard?: unknown;
  scope?: unknown;
  fixes?: Record<string, unknown>;
  targets?: Target[];
  error?: { code: string; message: string };
}

async function validateJson(p: Project, ...args: string[]): Promise<{ code: number; payload: Payload }> {
  const res = await runLoam(p.workDir, "validate", ...args, "--json");
  return { code: res.code, payload: JSON.parse(res.stdout) as Payload };
}

const findingsOf = (payload: Payload): Finding[] => (payload.targets ?? []).flatMap((t) => t.findings);
const codesOf = (payload: Payload): string[] => findingsOf(payload).map((f) => f.code);
const raisedOf = (payload: Payload): string[] => findingsOf(payload).filter((f) => f.severity !== "ok").map((f) => f.code);

const LEAD =
  "spine lens — grading only the fleet's joins: each call's operation against its provider's openapi.yaml, " +
  "each message against both ends' asyncapi.yaml, and whatever would stop that check running";
const METER =
  "joins: 7 calls name an operation · 6 message joins · drawn only, not checked: customer → checkout-web · " +
  "1 call into an external, not graded";
const HIDDEN =
  "not graded under --spine: 5 errors, 11 warnings — service.no-model ×5, service.no-spec ×5, " +
  "api.ungoverned ×3, event.ungoverned ×3; `loam validate --all` reports them";

describe("validate --spine on a fleet whose joins are right", () => {
  let fleet: Project;

  beforeAll(async () => {
    fleet = await spineFleet();
    // The generated views a seeded fleet carries — `loam seed` writes them in
    // the same transaction as the map — so the default run below reads the
    // way a freshly seeded fleet's does.
    expect((await runLoam(fleet.workDir, "subsystem", "sync")).code).toBe(0);
  });
  afterAll(async () => {
    await fleet.destroy();
  });

  it("is green, and counts every adoption finding instead of grading it", async () => {
    const { code, payload } = await validateJson(fleet, "--all", "--spine");
    expect(code).toBe(0);
    expect(payload.valid).toBe(true);
    // Fail-visible, read off the payload: nothing the lens hides reached it.
    expect(codesOf(payload).filter(spineHides)).toEqual([]);
    expect(codesOf(payload).filter((c) => c === "spine.resolved")).toHaveLength(3);
    expect(codesOf(payload)).toContain("landscape.matched");
    expect(payload.lens).toEqual({
      name: "spine",
      joins: { operations: 7, messages: 6, drawnOnly: ["customer → checkout-web"], toExternals: 1 },
      hidden: {
        errors: 5,
        warnings: 11,
        byCode: { "api.ungoverned": 3, "event.ungoverned": 3, "service.no-model": 5, "service.no-spec": 5 },
      },
      featuresSkipped: 0,
    });
    // `valid`, `summary` and `fixes` are the shown half's; the scorecard's
    // denominators are adoption measures, so it is not there at all.
    expect(payload.summary).toEqual({ services: 5, features: 0, errors: 0, warnings: 0 });
    expect(payload.fixes).toEqual({});
    expect(payload).not.toHaveProperty("scorecard");
    expect((payload.targets ?? []).some((t) => t.kind === "feature")).toBe(false);
  });

  it("the default run over the same tree did not move: same keys, and the lens only partitioned it", async () => {
    const plain = await validateJson(fleet, "--all");
    const lensed = await validateJson(fleet, "--all", "--spine");
    expect(plain.code).toBe(1);
    // The default payload's top-level keys, exactly — no `lens`, the scorecard back.
    expect(Object.keys(plain.payload)).toEqual([
      "contractVersion", "version", "ok", "command", "valid", "summary",
      "sourcesUnverifiableFromHere", "scorecard", "fixes", "targets",
    ]);
    expect(raisedOf(plain.payload).filter((c) => c === "service.no-model")).toHaveLength(5);

    // Every check ran exactly as it runs without the flag: per target, the
    // lensed findings ARE the default findings minus the hidden ones, in order,
    // and the hidden ones are exactly what `lens.hidden` counts.
    const lensedTargets = new Map((lensed.payload.targets ?? []).map((t) => [`${t.kind}:${t.id}`, t.findings]));
    const counted: Record<string, number> = {};
    for (const t of plain.payload.targets ?? []) {
      expect(lensedTargets.get(`${t.kind}:${t.id}`)).toEqual(t.findings.filter((f) => !spineHides(f.code)));
      for (const f of t.findings) {
        if (spineHides(f.code) && f.severity !== "ok") counted[f.code] = (counted[f.code] ?? 0) + 1;
      }
    }
    expect(lensed.payload.lens?.hidden.byCode).toEqual(counted);
  });

  it("prints the lead, the joins meter and what it hid — under --errors-only on a green run too", async () => {
    const res = await runLoam(fleet.workDir, "validate", "--all", "--spine", "--errors-only");
    expect(res.code).toBe(0);
    const lines = res.stdout.split("\n");
    expect(lines[0]).toBe(LEAD);
    expect(lines).toContain("5 services — 0 errors, 0 warnings (spine lens)");
    expect(lines).toContain(METER);
    expect(lines).toContain(HIDDEN);
    // The tail sits under the footer it qualifies.
    expect(lines.indexOf(METER)).toBe(lines.indexOf("5 services — 0 errors, 0 warnings (spine lens)") + 1);
    expect(res.stdout).not.toContain("fleet scorecard");

    const plain = await runLoam(fleet.workDir, "validate", "--all", "--errors-only");
    expect(plain.stdout).not.toContain("spine lens");
    expect(plain.stdout).not.toContain("not graded under --spine");
    expect(plain.stdout.split("\n").filter((line) => line.startsWith("joins:"))).toEqual([]);
    expect(plain.stdout).toContain("5 services, 0 features — 5 errors, 11 warnings");
    expect(plain.stdout).toContain("fleet scorecard");
  });

  it("--strict counts what the lens shows: green, because no deprecated operation is called", async () => {
    expect((await runLoam(fleet.workDir, "validate", "--all", "--spine", "--strict")).code).toBe(0);
    expect((await runLoam(fleet.workDir, "validate", "--all", "--strict")).code).toBe(1);
  });

  it("narrows one service the same way, and points at the run that reports the rest", async () => {
    const { code, payload } = await validateJson(fleet, "--service", "payment-service", "--spine");
    expect(code).toBe(0);
    expect(codesOf(payload)).toContain("spine.resolved");
    // One service's meter counts the joins bound to THAT service, never the
    // map's: the three calls into payment-service, the two messages it
    // publishes, and its own call into stripe.
    expect(payload.lens?.joins).toEqual({ operations: 3, messages: 2, drawnOnly: [], toExternals: 1 });
    expect(payload.lens?.hidden.byCode["service.no-model"]).toBe(1);

    const res = await runLoam(fleet.workDir, "validate", "payment-service", "--spine");
    expect(res.code).toBe(0);
    expect(res.stdout.split("\n")[0]).toBe(LEAD);
    expect(res.stdout).toContain("the same run without --spine reports them");
    expect(res.stdout.split("\n").filter((line) => line.startsWith("joins"))).toEqual([
      "joins on payment-service: 3 calls name an operation · 2 message joins · 1 call into an external, not graded",
    ]);
  });

  it("one service no join names says nothing was checked, instead of the green a resolved one prints", async () => {
    // checkout-web's only inbound edge is the customer's, which names nothing:
    // the run passes, and has to say it passed over no join at all (I5).
    const { code, payload } = await validateJson(fleet, "--service", "checkout-web", "--spine");
    expect(code).toBe(0);
    expect(payload.lens?.joins).toEqual({ operations: 0, messages: 0, drawnOnly: ["customer → checkout-web"], toExternals: 0 });
    const res = await runLoam(fleet.workDir, "validate", "--service", "checkout-web", "--spine", "--errors-only");
    expect(res.stdout).toContain("joins on checkout-web: none — nothing was checked");
  });
});

describe("what the lens never hides", () => {
  it("a misspelled operation and message, each with the name the contract does declare", async () => {
    const p = await spineFleet(joins({ authorize: "authorisePayment", captured: "payment.PaymentCapturd" }));
    try {
      const { code, payload } = await validateJson(p, "--all", "--spine");
      expect(code).toBe(1);
      const op = findingsOf(payload).find((f) => f.code === "spine.op-undefined");
      expect(op?.message).toContain(
        "calls 'authorisePayment', not defined in payment-service's OpenAPI — did you mean 'authorizePayment'?",
      );
      const message = findingsOf(payload).find((f) => f.code === "spine.message-undefined");
      expect(message?.message).toContain("consumes 'payment.PaymentCapturd'");
      expect(message?.message).toContain("— did you mean 'payment.PaymentCaptured'?");
      expect(codesOf(payload)).toContain("spine.message-unproduced");
      // The hint is prose on the finding itself, so the default run carries it too.
      const plain = await validateJson(p, "--all");
      expect(findingsOf(plain.payload).find((f) => f.code === "spine.op-undefined")?.message).toContain(
        "did you mean 'authorizePayment'?",
      );
    } finally {
      await p.destroy();
    }
  });

  it("a deprecated operation fails --spine --strict, and only --strict", async () => {
    const p = await spineFleet(joins({ introspect: "validateToken" }));
    try {
      expect((await runLoam(p.workDir, "validate", "--all", "--spine")).code).toBe(0);
      const { code, payload } = await validateJson(p, "--all", "--spine", "--strict");
      expect(code).toBe(1);
      expect(raisedOf(payload)).toEqual(["spine.op-deprecated"]);
    } finally {
      await p.destroy();
    }
  });

  it("an unreadable contract, a contract a join needs, an interrupted commit and a newer corpus", async () => {
    const p = await spineFleet(joins(), {
      ".loam-commit": "not a journal this loam can read\n",
      "AGENTS.md": "<!-- generated by loam v99.0.0 -->\n# Agents\n",
    });
    try {
      await p.write("services/payment-service/openapi.yaml", "openapi: [this is not\n");
      await rm(join(p.docsDir, "services/platform/identity-service/openapi.yaml"));
      const { code, payload } = await validateJson(p, "--all", "--spine");
      expect(code).toBe(1);
      const raised = raisedOf(payload);
      expect(raised).toContain("openapi.invalid");
      expect(raised).toContain("docs.commit-interrupted");
      // The one finding that changes what a PASS means is never set aside.
      expect(raised).toContain("docs.binary-behind");
      const missing = findingsOf(payload).find((f) => f.code === "service.no-openapi");
      expect(missing?.severity).toBe("error");
    } finally {
      await p.destroy();
    }
  });

  it("a map that does not parse — and the meter says no join was counted", async () => {
    const p = await spineFleet("  svc_checkout_web -[calls]-> {\n");
    try {
      const { code, payload } = await validateJson(p, "--all", "--spine");
      expect(code).toBe(1);
      expect(raisedOf(payload)).toContain("landscape.invalid");
      expect(raisedOf(payload)).toContain("spine.landscape-invalid");
      expect(payload.lens).not.toHaveProperty("joins");
      const res = await runLoam(p.workDir, "validate", "--all", "--spine", "--errors-only");
      expect(res.stdout).toContain(
        "joins: not counted — architecture/landscape.likec4 is missing or does not parse, so no join was checked",
      );
    } finally {
      await p.destroy();
    }
  });

  it("a fleet with no join stated says nothing was checked, in words, and exits 0", async () => {
    const p = await spineFleet(BARE_CALLS);
    try {
      const { code, payload } = await validateJson(p, "--all", "--spine");
      expect(code).toBe(0);
      expect(payload.lens?.joins).toEqual({
        operations: 0,
        messages: 0,
        drawnOnly: [
          "customer → checkout-web",
          "checkout-web → order-service",
          "checkout-web → payment-service",
          "order-service → identity-service",
          "order-service → payment-service",
          "payment-service → identity-service",
        ],
        toExternals: 1,
      });
      const res = await runLoam(p.workDir, "validate", "--all", "--spine");
      expect(res.stdout).toContain(
        "joins: none stated — nothing was checked; name operations in fleet.yaml ('- a -> b: operationId')",
      );
    } finally {
      await p.destroy();
    }
  });
});

/**
 * The hidden set, pinned. A code that lands under a hidden prefix fails here
 * until somebody decides the lens should hide it — the review a deny-list
 * otherwise never gets. Regenerate by reading the failure's diff, never by
 * copying it blind: each new row is a code `--spine` will stop showing.
 */
const HIDDEN_SNAPSHOT = [
  "agents.stale",
  "api.covered", "api.op-unconsumed", "api.ops-unlinked", "api.requirement-deprecated", "api.response-ungoverned",
  "api.ungoverned",
  "archedge.covered", "archedge.uncovered",
  "asyncapi.payload-undescribed",
  "c4-api.op-deprecated", "c4-api.op-pending", "c4-api.op-removing", "c4-api.op-undefined",
  "c4-event.message-pending", "c4-event.message-undefined",
  "c4.declaration-diverged", "c4.element-unowned", "c4.invalid", "c4.no-relationships", "c4.op-link-missing",
  "c4.op-ungoverned", "c4.service-binding-invalid", "c4.uncovered", "c4.valid",
  "capability.doc-missing", "capability.invalid", "capability.realizes-stale", "capability.realizes-unknown",
  "capability.remove-requirement-realized", "capability.requirement-inert-join", "capability.requirement-service-scoped",
  "capability.requirement-unidentified", "capability.requirement-unrealized", "capability.uncovered", "capability.unknown",
  "capability.unrealized",
  "coherence.ok",
  "content.stale",
  "covers.unknown",
  "cross.agree-confirmed", "cross.agree-unconfirmed", "cross.disagree", "cross.evidence-disjoint",
  "delta.added-conflict", "delta.added-duplicate", "delta.added-near-duplicate", "delta.baseline-invalid",
  "delta.baseline-missing", "delta.baseline-stale", "delta.changes-nothing", "delta.invalid",
  "delta.living-duplicate-requirement", "delta.living-requirement-id-invalid", "delta.merge-refused",
  "delta.modified-conflict", "delta.modified-pending", "delta.modified-unknown", "delta.no-delta-sections",
  "delta.no-requirements", "delta.nothing-tagged", "delta.removed-pending",
  "delta.removed-unknown", "delta.requirement-id-duplicate", "delta.requirement-id-invalid", "delta.requirement-id-repeated",
  "delta.requirement-identity-collision", "delta.requirement-not-merged", "delta.service-id-invalid", "delta.service-unknown",
  "delta.specification-not-merged", "delta.unknown-section", "delta.valid",
  "deployment.doc-exists", "deployment.doc-invalid", "deployment.doc-reserved",
  "event.covered", "event.messages-unlinked", "event.ungoverned",
  "evidence.checked", "evidence.line-changed", "evidence.moved", "evidence.record-unreadable", "evidence.token-missing",
  "evidence.unpinned", "evidence.unresolved",
  "frontmatter.field-mismatch", "frontmatter.field-missing", "frontmatter.malformed", "frontmatter.missing",
  "frontmatter.owner-mismatch", "frontmatter.status-unknown",
  "gherkin.current", "gherkin.edited", "gherkin.missing", "gherkin.orphaned", "gherkin.path-outside", "gherkin.stale",
  "glossary.term-exists", "glossary.unlinked",
  "health.dependency-unmodelled", "health.invalid", "health.uncovered",
  "intent.empty",
  "landscape.datastore-shared", "landscape.platform-candidate", "landscape.service-isolated",
  "link.unreadable", "link.unresolved",
  "living.requirement-outside-requirements",
  "obligation.adr-missing", "obligation.invalid", "obligation.unapplied", "obligation.uncovered", "obligation.unknown",
  "openapi.response-undescribed",
  "permissions.invalid", "permissions.unenforced", "permissions.unknown",
  "requirements.argument-stranded", "requirements.assertionless-scenario", "requirements.covered",
  "requirements.examples-malformed", "requirements.examples-unbound", "requirements.examples-unreferenced",
  "requirements.missing-scenarios", "requirements.stepless-scenario",
  "scaffold.placeholder",
  "service.likec4-config-missing", "service.likec4-config-stray", "service.model-excluded", "service.model-unexcluded",
  "service.no-model", "service.no-requirement-delta", "service.no-spec",
  "sources.absent", "sources.current", "sources.empty", "sources.path-missing", "sources.path-outside", "sources.resolved",
  "sources.sampled-vouch", "sources.skipped", "sources.stale", "sources.unverifiable-from-here", "sources.unvouched",
  "sources.unwalked", "sources.walked",
  "spec-api.op-pending", "spec-api.op-undefined",
  "spec-event.message-pending", "spec-event.message-undefined",
  "spec.duplicate-requirement", "spec.merge-conflict", "spec.no-requirements", "spec.repeated-covers",
  "spec.repeated-operations", "spec.requirement-id-duplicate", "spec.requirement-id-invalid", "spec.requirement-id-repeated",
  "spec.unknown-directive",
  "subsystem.view-id-collision", "subsystem.views-stale",
  "usecase.capability-unresolved", "usecase.flow-exists", "usecase.flow-invalid", "usecase.flow-unknown",
  "usecase.obligation-misplaced", "usecase.requirement-modified", "usecase.requirement-unresolved", "usecase.step-contested",
  "usecase.step-unbacked", "usecase.step-unlinked",
  "verify.checklist-forked", "verify.claims-open", "verify.digest-contested", "verify.evidence-token-missing",
  "verify.operation-contested", "verify.record-miscounted", "verify.scenario-attested", "verify.uncommitted-changes",
];

describe("the classification fails visible", () => {
  it("no must-show code matches a hide rule, and every one of them is a code loam emits", async () => {
    const emitted = await collectEmittedCodes();
    expect(SPINE_MUST_SHOW.filter(spineHides)).toEqual([]);
    expect(SPINE_MUST_SHOW.filter((c) => !emitted.has(c))).toEqual([]);
    // Every spine code, by family rather than by the list: the family is what
    // the lens exists to show, and a new spine code must not need a row here.
    expect([...emitted].filter((c) => c.startsWith("spine.") && spineHides(c))).toEqual([]);
    expect(spineHides("docs.binary-behind")).toBe(false);
    expect(spineHides("c4.fleet-project-invalid")).toBe(false);
  });

  it("every hide rule hides something real: no dead exact row, no dead prefix", async () => {
    const emitted = [...(await collectEmittedCodes())];
    expect([...SPINE_HIDE_EXACT].filter((c) => !emitted.includes(c))).toEqual([]);
    expect(SPINE_HIDE_PREFIX.filter((prefix) => !emitted.some((c) => c.startsWith(prefix)))).toEqual([]);
  });

  it("the hidden set is the pinned snapshot — a new code under a hidden prefix is a decision, not a default", async () => {
    const hidden = [...(await collectEmittedCodes())].filter(spineHides).sort();
    expect(hidden).toEqual([...HIDDEN_SNAPSHOT].sort());
  });

  it("an unclassified code is shown", () => {
    expect(spineHides("spine.some-future-check")).toBe(false);
    expect(spineHides("brand-new.family")).toBe(false);
  });
});

describe("a feature is refused under the lens, however it was named", () => {
  const REFUSAL = "--spine grades the living fleet map's joins; a feature is a proposal graded by its own gate — drop one.";

  it("--feature, a positional feature id, and a bound service only a feature introduces", async () => {
    // coherentFixture: FEAT-1 introduces payment-split-service; payment-service is living.
    const p = await makeProject(coherentFixture(), { service: "payment-split-service" });
    try {
      for (const args of [["--feature", "FEAT-1"], ["FEAT-1"], []]) {
        const { code, payload } = await validateJson(p, ...args, "--spine");
        expect(code).toBe(1);
        expect(payload.error).toEqual({ code: "invalid-option", message: REFUSAL });
      }
      // The fleet run skips the feature instead, and says how many it skipped.
      const { payload } = await validateJson(p, "--all", "--spine");
      expect((payload.targets ?? []).map((t) => t.kind)).not.toContain("feature");
      expect(payload.lens?.featuresSkipped).toBe(1);
    } finally {
      await p.destroy();
    }
  });
});

function git(cwd: string, ...args: string[]): void {
  const res = spawnSync("git", args, { cwd, encoding: "utf8", timeout: 30_000 });
  if (res.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${res.stderr}`);
}

function commit(dir: string, message: string): void {
  git(dir, "add", "-A");
  git(dir, "-c", "user.email=spine@test.invalid", "-c", "user.name=Spine Test", "commit", "-q", "-m", message);
}

describe("--spine with --base", () => {
  let p: Project;

  beforeAll(async () => {
    p = await spineFleet();
    // The base ref is a fleet still waiting on identity-service's contract.
    await rm(join(p.docsDir, "services/platform/identity-service/openapi.yaml"));
    git(p.docsDir, "init", "-q", "-b", "main");
    commit(p.docsDir, "base");
  });
  afterAll(async () => {
    await p.destroy();
  });

  it("a branch the spine reads nothing of says nothing was checked — not the map's seven joins", async () => {
    await p.write("README.md", "# the fleet\n");
    const { code, payload } = await validateJson(p, "--all", "--base", "main", "--spine");
    expect(code).toBe(0);
    expect(payload.targets).toEqual([]);
    expect(payload.lens?.joins).toEqual({ operations: 0, messages: 0, drawnOnly: [], toExternals: 0 });
    const text = await runLoam(p.workDir, "validate", "--all", "--base", "main", "--spine");
    expect(text.stdout.split("\n").filter((line) => line.startsWith("joins"))).toEqual([
      "joins in this run's scope: none — nothing was checked",
    ]);
  });

  it("a branch that only adds a contract is green under the lens and red without it", async () => {
    await p.write(
      "services/platform/identity-service/openapi.yaml",
      await readFile(join(EXAMPLE_SERVICES, "platform/identity-service/openapi.yaml"), "utf8"),
    );
    const lensed = await validateJson(p, "--all", "--base", "main", "--spine");
    expect(lensed.code).toBe(0);
    expect(lensed.payload).toHaveProperty("scope");
    expect((lensed.payload.targets ?? []).map((t) => t.id)).toEqual(["identity-service"]);
    expect(codesOf(lensed.payload)).toContain("spine.resolved");
    expect(lensed.payload.lens?.hidden.byCode["service.no-model"]).toBe(1);
    // The meter counts the joins the scope graded: the two calls into identity-service.
    expect(lensed.payload.lens?.joins).toEqual({ operations: 2, messages: 0, drawnOnly: [], toExternals: 0 });

    const plain = await validateJson(p, "--all", "--base", "main");
    expect(plain.code).toBe(1);
    expect(raisedOf(plain.payload)).toContain("service.no-model");

    // The scope line first, then the lens's lead: what was looked at, then how.
    const text = await runLoam(p.workDir, "validate", "--all", "--base", "main", "--spine");
    const [scope, lead] = text.stdout.split("\n");
    expect(scope).toContain("in scope since main");
    expect(lead).toBe(LEAD);
  });

  it("a branch that misspells an operation on the map is red under both", async () => {
    commit(p.docsDir, "identity contract");
    const map = await p.read("architecture/landscape.likec4");
    await p.write("architecture/landscape.likec4", map.replace("'createOrder' {\n    metadata { op 'createOrder' }", "'createOrdr' {\n    metadata { op 'createOrdr' }"));
    for (const args of [["--spine"], []]) {
      const { code, payload } = await validateJson(p, "--all", "--base", "HEAD", ...args);
      expect(code).toBe(1);
      const undefinedOp = findingsOf(payload).find((f) => f.code === "spine.op-undefined");
      expect(undefinedOp?.message).toContain("did you mean 'createOrder'?");
      // No service changed, and the one join graded is the edge the branch
      // wrote — graded on the landscape target against a provider out of scope.
      if (args.length > 0) expect(payload.lens?.joins?.operations).toBe(1);
    }
  });
});
