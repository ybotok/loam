/**
 * `loam context <service>` — the context pack: one service's docs slice as one
 * deterministic briefing.
 *
 * What is pinned here, case by case: the `--json` shape over the canonical
 * fixture (requirements verbatim, operations with their governing
 * requirements, the fleet edges agreeing with `loam show`, the permission and
 * capability joins, the in-flight projections); byte-determinism in both
 * output modes; every refusal with its stable code; the `--feature`
 * narrowing including its known-feature-elsewhere stance; and the
 * exit-1-with-ok-true readability guard — the pack is the parse failure, not
 * "nothing here".
 */
import { describe, expect, it, afterEach } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  LIVING_ASYNCAPI,
  coherentFixture,
  makeProject,
  makeTmpDir,
  runLoam,
  type Project,
} from "./helpers/harness.js";
import { rm } from "node:fs/promises";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!();
});

const ARCH_SPEC = `# payment-service — architecture

## Requirements

### Requirement: Outbox for payment events
The service SHALL publish payment events through an outbox.

Covers: paymentService
Requires: user/payments:authorize, profile/channel:send
Capability: payments/authorize
Publishes: payment.Authorized

#### Scenario: Outbox drains
- **Given** a committed payment
- **When** the outbox drains
- **Then** payment.Authorized is published
`;

const PERMISSIONS = `subjects:
  user: {}
permissions:
  user:
    payments:authorize:
      description: authorize a payment
      owned_by: identity-service
      enforced_by:
        - payment-service
`;

const CAPABILITIES = `capabilities:
  payments/authorize:
    description: Take a payment
    owner: team-pay
`;

const FEAT2_SPEC = `# payment-service — delta for FEAT-2

## ADDED Requirements

### Requirement: Audit authorization
The service SHALL record who authorized what.

Operations: auditAuthorization

#### Scenario: Authorization is recorded
- **Given** an authorized payment
- **When** the audit trail is read
- **Then** the authorizing principal is on it
`;

/**
 * The canonical fixture plus everything the pack has an axis for: the event
 * contract, both fleet vocabularies, an arch spec carrying every join line,
 * the presence pointers, and FEAT-2 — a second active feature that (unlike
 * FEAT-1, which touches only payment-split-service) carries a delta FOR
 * payment-service, so the in-flight section has something to project.
 */
function packFixture(): Record<string, string> {
  return {
    ...coherentFixture(),
    "architecture/permissions.yaml": PERMISSIONS,
    "architecture/capabilities.yaml": CAPABILITIES,
    "services/payment-service/asyncapi.yaml": LIVING_ASYNCAPI,
    "services/payment-service/arch.spec.md": ARCH_SPEC,
    "services/payment-service/runbook.md": "# Runbook\n\nRestart it.\n",
    "services/payment-service/adrs/0001-outbox.md": "# ADR-1: outbox\n",
    "features/FEAT-2-audit/intent.md":
      "---\nfeature: FEAT-2\nstatus: proposed\n---\n\n# Audit authorization\n\nMake authorization auditable.\n",
    "features/FEAT-2-audit/specs/payment-service/spec.md": FEAT2_SPEC,
  };
}

async function project(files: Record<string, string>): Promise<Project> {
  const p = await makeProject(files);
  cleanups.push(() => p.destroy());
  return p;
}

describe("loam context --json: the pack over the canonical fixture", () => {
  it("assembles every axis, verbatim where the axis is requirements", async () => {
    const p = await project(packFixture());
    const res = await runLoam(p.workDir, "context", "payment-service", "--json");
    expect(res.code).toBe(0);
    const json = JSON.parse(res.stdout);
    expect(json.ok).toBe(true);
    expect(json.command).toBe("context");
    expect(json.service).toBe("payment-service");
    expect(json.path).toBe("services/payment-service");
    expect(json.maturity).toBe("documented");

    // Requirements travel VERBATIM: body text and Given/When/Then lines.
    const req = json.requirements.find((r: { name: string }) => r.name === "Authorize a payment");
    expect(req.text).toContain("The service SHALL authorize a payment before capture.");
    expect(req.scenarios[0].lines).toContain("- **Given** a valid card");
    // The arch axis rides in the same shape, with all four join lines parsed.
    const arch = json.archRequirements.find(
      (r: { name: string }) => r.name === "Outbox for payment events",
    );
    expect(arch.covers).toEqual(["paymentService"]);
    expect(arch.requires).toEqual(["user/payments:authorize", "profile/channel:send"]);
    expect(arch.capabilities).toEqual(["payments/authorize"]);
    expect(arch.publishes).toEqual(["payment.Authorized"]);

    // Operations carry their governing requirements, x-loam-remove filtered.
    expect(json.operations).toEqual([
      {
        id: "authorizePayment",
        method: "POST",
        path: "/payments/authorize",
        governedBy: ["Authorize a payment"],
      },
    ]);
    // Messages carry the producer/consumer direction off the living contract.
    expect(json.messages).toContainEqual({
      name: "payment.Authorized",
      slot: "components.messages.Authorized",
      direction: "send",
    });
    expect(json.openapi).toEqual({ unreadable: false });
    expect(json.asyncapi).toEqual({ unreadable: false });

    // Provenance and pointers.
    expect(json.frontmatter.status).toBe("verified");
    expect(json.pointers.runbook).toEqual({ present: true, path: "services/payment-service/runbook.md" });
    expect(json.pointers.health.present).toBe(false);
    expect(json.pointers.adrs.count).toBe(1);
    // The default view is not narrowed, and says so.
    expect(json.feature).toBeNull();
  });

  it("permissions resolve against the vocabulary — undeclared entries carried, never refused", async () => {
    const p = await project(packFixture());
    const json = JSON.parse(
      (await runLoam(p.workDir, "context", "payment-service", "--json")).stdout,
    );
    // compareIds order, declared and undeclared as a discriminated pair.
    expect(json.permissions).toEqual([
      { id: "profile/channel:send", declared: false },
      {
        id: "user/payments:authorize",
        declared: true,
        subject: "user",
        name: "payments:authorize",
        description: "authorize a payment",
        ownedBy: "identity-service",
        enforcedBy: ["payment-service"],
      },
    ]);
    expect(json.permissionsVocabulary).toEqual({ present: true });
    expect(json.capabilities).toEqual([
      {
        id: "payments/authorize",
        description: "Take a payment",
        owner: "team-pay",
        requirements: ["Outbox for payment events"],
      },
    ]);
    expect(json.capabilitiesVocabulary).toEqual({ present: true });
    expect(json.capabilitiesUnread).toEqual([]);
  });

  it("the landscape slice agrees with `loam show` about the edges, and carries its own health", async () => {
    const p = await project(packFixture());
    const pack = JSON.parse(
      (await runLoam(p.workDir, "context", "payment-service", "--json")).stdout,
    );
    const show = JSON.parse(
      (await runLoam(p.workDir, "show", "payment-service", "--json")).stdout,
    );
    expect(pack.landscape.inbound).toEqual(show.landscape.inbound);
    expect(pack.landscape.outbound).toEqual(show.landscape.outbound);
    expect(pack.landscape.present).toBe(true);
    expect(pack.landscape.parses).toBe(true);
    expect(pack.landscape.modelled).toBe(true);
  });

  it("the in-flight section projects the features that touch this service, delta's shapes verbatim", async () => {
    const p = await project(packFixture());
    const json = JSON.parse(
      (await runLoam(p.workDir, "context", "payment-service", "--json")).stdout,
    );
    // FEAT-1 touches only payment-split-service and is deliberately absent.
    expect(json.features.map((f: { feature: string }) => f.feature)).toEqual(["FEAT-2"]);
    const feat = json.features[0];
    expect(feat.path).toBe("features/FEAT-2-audit");
    expect(feat.services).toEqual(["payment-service"]);
    expect(feat.intent).toContain("Make authorization auditable.");
    expect(feat.requirements[0].kind).toBe("ADDED");
    expect(feat.requirements[0].scenarios[0].lines).toContain("- **Given** an authorized payment");
    expect(feat.api).toEqual([]);
    expect(feat.openapi).toEqual({ unreadable: false });
    expect(feat.events).toEqual({ changes: [], unreadable: false });
    expect(feat.architecture).toEqual({ isNew: false, inbound: [], outbound: [], errors: [] });
  });
});

describe("determinism: identical state, identical bytes", () => {
  it("two --json runs are byte-identical, and so are two Markdown runs", async () => {
    const p = await project(packFixture());
    const json1 = await runLoam(p.workDir, "context", "payment-service", "--json");
    const json2 = await runLoam(p.workDir, "context", "payment-service", "--json");
    expect(json1.stdout).toBe(json2.stdout);
    const md1 = await runLoam(p.workDir, "context", "payment-service");
    const md2 = await runLoam(p.workDir, "context", "payment-service");
    expect(md1.stdout).toBe(md2.stdout);
  });
});

describe("--feature narrows the in-flight section", () => {
  it("to the one feature named, when it touches the service — and the payload says it is narrowed", async () => {
    const p = await project(packFixture());
    const json = JSON.parse(
      (await runLoam(p.workDir, "context", "payment-service", "--feature", "FEAT-2", "--json"))
        .stdout,
    );
    expect(json.features.map((f: { feature: string }) => f.feature)).toEqual(["FEAT-2"]);
    // A narrowed pack differs from the default only by what it leaves out, so
    // the narrowing itself must be data: an agent resuming from a stored pack
    // has no other way to tell "narrowed" from "the fleet went quiet".
    expect(json.feature).toBe("FEAT-2");
  });

  it("the Markdown view names the narrowing in its In flight heading", async () => {
    const p = await project(packFixture());
    const res = await runLoam(p.workDir, "context", "payment-service", "--feature", "FEAT-2");
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("## In flight (narrowed to FEAT-2)");
  });

  it("a known feature that does NOT touch the service is projected, not refused — empty sections plus its own services list", async () => {
    const p = await project(packFixture());
    const res = await runLoam(
      p.workDir, "context", "payment-service", "--feature", "FEAT-1", "--json",
    );
    expect(res.code).toBe(0);
    const json = JSON.parse(res.stdout);
    expect(json.features).toHaveLength(1);
    const feat = json.features[0];
    expect(feat.feature).toBe("FEAT-1");
    expect(feat.services).toEqual(["payment-split-service"]);
    expect(feat.requirements).toEqual([]);
    // Not all-empty either: FEAT-1's C4 delta draws payment-service calling
    // the new service, and the projection reports that edge exactly as
    // `loam delta FEAT-1 --service payment-service` does.
    expect(feat.architecture.outbound).toEqual([
      { service: "payment-split-service", op: "createSplit", title: "Calls createSplit" },
    ]);
  });

  it("an unknown feature refuses unknown-target through the shared message", async () => {
    const p = await project(packFixture());
    const res = await runLoam(
      p.workDir, "context", "payment-service", "--feature", "FEAT-999", "--json",
    );
    expect(res.code).toBe(1);
    const json = JSON.parse(res.stdout);
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe("unknown-target");
    expect(json.error.message).toContain("FEAT-999");
  });
});

describe("refusals", () => {
  it("a service the enumeration does not answer is unknown-service with a near-miss hint — never an empty pack", async () => {
    const p = await project(packFixture());
    const res = await runLoam(p.workDir, "context", "payment-servce", "--json");
    expect(res.code).toBe(1);
    const json = JSON.parse(res.stdout);
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe("unknown-service");
    expect(json.error.message).toContain("No service 'payment-servce'");
    expect(json.error.message).toContain("'payment-service'");
  });

  it("a name that is neither an enumerated directory nor a legal id is invalid-option — enumeration first, grammar second", async () => {
    // The grammar refusal DELIBERATELY moved behind the config and repo gates.
    // It used to run first, on the raw argument — which repeated the settled
    // mistake core/repo/service-target.ts exists to forbid: a badly-named
    // directory that EXISTS is one `validate --all` grades and `loam list`
    // shows, so refusing it on the grammar made the one service loam
    // complains about the one service nobody could be briefed on. The
    // enumeration now answers first, and only a name no directory matches
    // falls through to the grammar.
    const p = await project(packFixture());
    const res = await runLoam(p.workDir, "context", "../../etc", "--json");
    expect(res.code).toBe(1);
    const json = JSON.parse(res.stdout);
    expect(json.error.code).toBe("invalid-option");
    expect(json.error.message).toContain("service");
    // The consequence of that order in an unwired directory: nothing can be
    // enumerated without a repo, so the same argument now answers no-config —
    // where it used to answer invalid-option before any config was consulted.
    const dir = await makeTmpDir();
    cleanups.push(() => rm(dir, { recursive: true, force: true }));
    const unwired = await runLoam(dir, "context", "../../etc", "--json");
    expect(unwired.code).toBe(1);
    expect(JSON.parse(unwired.stdout).error.code).toBe("no-config");
  });

  it("a badly-named directory that EXISTS is briefed, not refused", async () => {
    // `services/payment service/` — an interior space fails the id grammar but
    // is a directory the enumeration lists (service.id-invalid tells the team
    // to rename it). The pack must be able to brief it: the rename is exactly
    // the work an agent might be sent in to do.
    const p = await project({
      ...packFixture(),
      "services/payment service/spec.md":
        "# payment service\n\n## Requirements\n\n### Requirement: Hold funds\nThe service SHALL hold funds.\n\n#### Scenario: Held\n- **Given** funds\n- **When** a hold is placed\n- **Then** the funds are held\n",
    });
    const res = await runLoam(p.workDir, "context", "payment service", "--json");
    expect(res.code).toBe(0);
    const json = JSON.parse(res.stdout);
    expect(json.ok).toBe(true);
    expect(json.service).toBe("payment service");
    expect(json.requirements.map((r: { name: string }) => r.name)).toEqual(["Hold funds"]);
  });

  it("no loam.json is no-config", async () => {
    const dir = await makeTmpDir();
    cleanups.push(() => rm(dir, { recursive: true, force: true }));
    const res = await runLoam(dir, "context", "payment-service", "--json");
    expect(res.code).toBe(1);
    expect(JSON.parse(res.stdout).error.code).toBe("no-config");
  });

  it("a docsDir pointing at nothing is docs-missing", async () => {
    const dir = await makeTmpDir();
    cleanups.push(() => rm(dir, { recursive: true, force: true }));
    await writeFile(join(dir, "loam.json"), JSON.stringify({ docsDir: "./gone" }), "utf8");
    const res = await runLoam(dir, "context", "payment-service", "--json");
    expect(res.code).toBe(1);
    expect(JSON.parse(res.stdout).error.code).toBe("docs-missing");
  });
});

describe("the readability guard: exit 1 with ok true on a silent hole", () => {
  it("an unreadable living openapi.yaml — the empty operation list is the parse failure, not 'no endpoints'", async () => {
    const p = await project(packFixture());
    await p.write("services/payment-service/openapi.yaml", "openapi: [broken\n");
    const res = await runLoam(p.workDir, "context", "payment-service", "--json");
    expect(res.code).toBe(1);
    const json = JSON.parse(res.stdout);
    expect(json.ok).toBe(true);
    expect(json.openapi.unreadable).toBe(true);
    expect(typeof json.openapi.error).toBe("string");
    expect(json.operations).toEqual([]);
  });

  it("a landscape that is present but does not parse", async () => {
    const p = await project(packFixture());
    await p.write("architecture/landscape.likec4", "model {\n");
    const res = await runLoam(p.workDir, "context", "payment-service", "--json");
    expect(res.code).toBe(1);
    const json = JSON.parse(res.stdout);
    expect(json.ok).toBe(true);
    expect(json.landscape.present).toBe(true);
    expect(json.landscape.parses).toBe(false);
    expect(json.landscape.inbound).toEqual([]);
  });

  it("an included feature's delta.likec4 with errors", async () => {
    const p = await project(packFixture());
    await p.write("features/FEAT-2-audit/delta.likec4", "model {\n");
    const res = await runLoam(p.workDir, "context", "payment-service", "--json");
    expect(res.code).toBe(1);
    const json = JSON.parse(res.stdout);
    expect(json.ok).toBe(true);
    expect(json.features[0].architecture.errors.length).toBeGreaterThan(0);
  });

  it("a feature whose delta does not parse is included in EVERY service's pack — it must not vanish", async () => {
    // FEAT-1 touches only payment-split-service, so before the inclusion rule
    // learned about unreadable deltas, breaking its delta made it VANISH from
    // payment-service's pack at exit 0 — an agent then worked in the service
    // believing nothing was in flight. An unreadable delta names no services,
    // so "does it touch this one?" has no answer, and the honest reading is
    // inclusion with the errors riding.
    const p = await project(packFixture());
    await p.write("features/FEAT-1-split/delta.likec4", "model {\n");
    const res = await runLoam(p.workDir, "context", "payment-service", "--json");
    expect(res.code).toBe(1);
    const json = JSON.parse(res.stdout);
    expect(json.ok).toBe(true);
    const feat1 = json.features.find((f: { feature: string }) => f.feature === "FEAT-1");
    expect(feat1).toBeDefined();
    expect(feat1.architecture.errors.length).toBeGreaterThan(0);
    // Its specs/ list still travels — the one thing the broken delta cannot erase.
    expect(feat1.services).toEqual(["payment-split-service"]);
  });

  it("an unreadable permissions vocabulary — declared:false means nobody could look, and the exit code says so", async () => {
    const p = await project(packFixture());
    await p.write("architecture/permissions.yaml", "subjects: [broken\n");
    const res = await runLoam(p.workDir, "context", "payment-service", "--json");
    expect(res.code).toBe(1);
    const json = JSON.parse(res.stdout);
    expect(json.ok).toBe(true);
    expect(typeof json.permissionsVocabulary.invalid).toBe("string");
    // Every entry degrades to undeclared — a positive false claim without the
    // vocabulary health beside it and the exit code behind it.
    expect(json.permissions.every((entry: { declared: boolean }) => !entry.declared)).toBe(true);
    expect(json.permissions.length).toBeGreaterThan(0);
  });

  it("an unreadable capabilities vocabulary — the empty section is the parse failure, not 'none realized'", async () => {
    const p = await project(packFixture());
    await p.write("architecture/capabilities.yaml", "capabilities: [broken\n");
    const res = await runLoam(p.workDir, "context", "payment-service", "--json");
    expect(res.code).toBe(1);
    const json = JSON.parse(res.stdout);
    expect(json.ok).toBe(true);
    expect(typeof json.capabilitiesVocabulary.invalid).toBe("string");
    expect(json.capabilities).toEqual([]);
  });

  it("one sibling's unreadable spec degrades the capability join per file — never refuses the pack", async () => {
    // The rollup walks EVERY service's spec files, and it only walks at all
    // once the fleet declares a capability — so before the per-read
    // containment, declaring the fleet's first capability turned
    // `context <healthy-service>` from working into a repository-unavailable
    // refusal the moment any sibling's spec.md was saved as UTF-16.
    const p = await project(packFixture());
    await mkdir(join(p.docsDir, "services", "broken-svc"), { recursive: true });
    await writeFile(
      join(p.docsDir, "services", "broken-svc", "spec.md"),
      Buffer.from([0xff, 0xfe, 0x41, 0x00]),
    );
    const res = await runLoam(p.workDir, "context", "payment-service", "--json");
    expect(res.code).toBe(1);
    const json = JSON.parse(res.stdout);
    expect(json.ok).toBe(true);
    expect(json.capabilitiesUnread).toEqual(["services/broken-svc/spec.md"]);
    // The join still answered from the files it COULD read.
    expect(json.capabilities.map((c: { id: string }) => c.id)).toEqual(["payments/authorize"]);
  });
});

describe("the Markdown view", () => {
  it("carries the requirement headings and bodies verbatim, and closes each feature with a runnable delta line", async () => {
    const p = await project(packFixture());
    const res = await runLoam(p.workDir, "context", "payment-service");
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("# payment-service — context pack");
    expect(res.stdout).toContain("### Requirement: Authorize a payment");
    expect(res.stdout).toContain("The service SHALL authorize a payment before capture.");
    expect(res.stdout).toContain("- **Given** a valid card");
    expect(res.stdout).toContain("- POST /payments/authorize  authorizePayment");
    expect(res.stdout).toContain("next: loam delta FEAT-2 --service payment-service");
  });

  it("demotes intent headings below the feature's own — the pack keeps exactly one H1", async () => {
    // FEAT-2's intent opens with its own `# Audit authorization` H1. Pasted
    // raw it split the document in two and could collide with the pack's own
    // section headings (an intent saying `## Operations` shadowed the real
    // one). The prose is untouched; only the heading levels move.
    const p = await project(packFixture());
    const res = await runLoam(p.workDir, "context", "payment-service");
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("#### Audit authorization");
    expect(res.stdout.match(/^# /gm)).toHaveLength(1);
  });

  it("says an unreadable contract first and without hedging, and still exits 1", async () => {
    const p = await project(packFixture());
    await p.write("services/payment-service/openapi.yaml", "openapi: [broken\n");
    const res = await runLoam(p.workDir, "context", "payment-service");
    expect(res.code).toBe(1);
    expect(res.stdout).toContain("! openapi.yaml does not parse");
    // The warning leads; the empty section refers back to it rather than
    // reading as "no endpoints".
    expect(res.stdout.indexOf("! openapi.yaml does not parse")).toBeLessThan(
      res.stdout.indexOf("## Operations"),
    );
  });
});
