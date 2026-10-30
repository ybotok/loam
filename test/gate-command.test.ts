/**
 * `loam gate` — the deploy-time PURE QUERY over recorded evidence.
 *
 * Named gate-command to keep clear of test/arch-gate.test.ts (the repo's own
 * architecture gate). What this suite pins, beyond the envelope and the
 * refusals: the four checks' semantics — partners from the LIVING landscape
 * only, freshness filtered to the two staleness codes, verification through
 * `verificationState`'s own verdicts, the `.loam-commit` journal as the one
 * default-failing repo state — and the two properties a deploy gate must
 * never lose: it writes NOTHING (treeHashes identical around every run), and
 * "could not look" never reads as "nothing is wrong" (absent landscape warns,
 * an unreadable sibling artifact is an error, both distinguishable in the
 * exit code). The last block pins `--since <ref>`, the gate's memory of what
 * shipped after the docs commit a deploy last recorded.
 */
import { describe, expect, it, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { cp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseRequirements } from "../src/core/document/parse.js";
import { scenarioDigest } from "../src/core/gherkin/stamp.js";
import {
  citeable,
  coherentFixture,
  makeProject,
  makeTmpDir,
  pinOpenapi,
  runLoam,
  treeHashes,
  writeFiles,
  FEATURE_SPEC,
  type Project,
} from "./helpers/harness.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!();
});

async function project(
  files: Record<string, string>,
  opts: { service?: string } = {},
): Promise<Project> {
  const p = await makeProject(files, opts);
  cleanups.push(() => p.destroy());
  // The all-at-once form resolves every agent citation in the repository it
  // records from, so the evidence this file's answer sets cite is made real.
  await citeable(p.workDir, "src/split/Service.ts:12");
  return p;
}

/**
 * A requirements-only delta that makes FEAT-1 TOUCH payment-service — the
 * canonical fixture's feature only carries specs/payment-split-service/, and
 * gate's "touching" definition is `status --service`'s: a specs/<svc>/ delta.
 */
const TOUCHING_SPEC = `# payment-service — delta for FEAT-1

## ADDED Requirements

### Requirement: Reconcile split payments
The service SHALL reconcile split payments nightly.

#### Scenario: Nightly reconciliation
- **Given** a day of split payments
- **When** reconciliation runs
- **Then** every split is accounted for
`;

function gateFixture(): Record<string, string> {
  return {
    ...coherentFixture(),
    "features/FEAT-1-split/specs/payment-service/spec.md": TOUCHING_SPEC,
  };
}

/**
 * A fleet map that draws two callers of payment-service inside/under
 * `#external`: an unadopted true third party (stripe), and an ADOPTED service
 * (checkout-web) that somebody drew inside an external zone — the shape the
 * exemption must not over-reach.
 */
const EXTERNAL_LANDSCAPE = `specification {
  element softwareSystem
  tag external
}

model {
  thirdParty = softwareSystem 'Third Party Zone' {
    #external
    checkoutWeb = softwareSystem 'checkout-web'
  }
  stripe = softwareSystem 'stripe' {
    #external
  }
  paymentService = softwareSystem 'payment-service'

  checkoutWeb -> paymentService 'Calls authorizePayment' {
    metadata { op 'authorizePayment' }
  }
  stripe -> paymentService 'Confirms captures' {
    metadata { op 'authorizePayment' }
  }
}

views {
  view landscape {
    include *
  }
}
`;

interface GateRun {
  code: number;
  out: string;
  stdout: string;
  payload: Record<string, any>;
}

async function gate(p: Project, ...args: string[]): Promise<GateRun> {
  const res = await runLoam(p.workDir, "gate", "--json", ...args);
  return { code: res.code, out: res.out, stdout: res.stdout, payload: JSON.parse(res.stdout) };
}

function findingsOf(payload: Record<string, any>, check: string): Record<string, any>[] {
  const block = payload.checks.find((c: { check: string }) => c.check === check);
  expect(block, `no '${check}' block in checks[]`).toBeDefined();
  return block.findings;
}

const codesOf = (payload: Record<string, any>, check: string): string[] =>
  findingsOf(payload, check).map((f) => f.code);

/** The digest `loam gherkin` would stamp for a delta's first scenario — what a green run answers. */
function digestFor(spec: string, service: string): string {
  return scenarioDigest(service, parseRequirements(spec)[0]!.scenarios[0]!.lines, "business");
}

/** Agent-answered record: every claim confirmed with evidence, no test run — `attested`. */
async function recordAttested(p: Project): Promise<void> {
  const checklist = JSON.parse((await runLoam(p.workDir, "verify", "FEAT-1", "--json")).stdout);
  const answers = checklist.claims.map((c: { id: string }) => ({
    id: c.id,
    verdict: "confirmed",
    evidence: ["src/split/Service.ts:12"],
  }));
  await writeFile(join(p.workDir, "answers.json"), JSON.stringify({ answers }, null, 2), "utf8");
  const res = await runLoam(p.workDir, "verify", "FEAT-1", "--record", "answers.json");
  expect(res.code, res.out).toBe(0);
}

/** Runner-answered scenarios plus agent-answered rest — the record `verified` requires. */
async function recordVerified(p: Project, digests: string[]): Promise<void> {
  const checklist = JSON.parse((await runLoam(p.workDir, "verify", "FEAT-1", "--json")).stdout);
  const answers = checklist.claims
    .filter((c: { kind: string }) => c.kind !== "scenario.tested")
    .map((c: { id: string }) => ({ id: c.id, verdict: "confirmed", evidence: ["src/split/Service.ts:12"] }));
  await writeFile(join(p.workDir, "answers.json"), JSON.stringify({ answers }, null, 2), "utf8");
  const report = [
    {
      uri: "features/loam/split-a-payment.feature",
      name: "Split a payment",
      keyword: "Feature",
      elements: digests.map((digest, i) => ({
        name: `scenario ${i}`,
        type: "scenario",
        tags: [{ name: "@FEAT-1", line: 2 }, { name: `@loam-digest-${digest}` }],
        // A run with no step results is not a green run — the reader rightly
        // refuses to confirm from it, so the report carries passed steps.
        // One per Given/When/Then: a cucumber run is held to the stamped scenario's step count.
        steps: ["Given ", "When ", "Then "].map((keyword) => ({ keyword, result: { status: "passed", duration: 1 } })),
      })),
    },
  ];
  await writeFile(join(p.workDir, "report.json"), JSON.stringify(report), "utf8");
  const res = await runLoam(
    p.workDir, "verify", "FEAT-1", "--record", "answers.json", "--results", "report.json",
  );
  expect(res.code, res.out).toBe(0);
}

/* ------------------------------------------------------------------ */
/* Refusals                                                            */
/* ------------------------------------------------------------------ */

describe("what gate refuses", () => {
  it("no --service and no binding: invalid-option, the shared sentence", async () => {
    const p = await project(gateFixture());
    const res = await gate(p);
    expect(res.code).toBe(1);
    expect(res.payload.ok).toBe(false);
    expect(res.payload.error.code).toBe("invalid-option");
    expect(res.payload.error.message).toContain("--service");
  });

  it("a service nobody adopted: unknown-service, naming adopt and the near-miss", async () => {
    const p = await project(gateFixture());
    const res = await gate(p, "--service", "payment-servce");
    expect(res.code).toBe(1);
    expect(res.payload.error.code).toBe("unknown-service");
    expect(res.payload.error.message).toContain("loam adopt --service payment-servce");
    // The refusal carries the diagnostic the payload would have shown.
    expect(res.payload.error.message).toContain("payment-service");
  });

  // The first deploy of every service a feature introduces runs `loam gate` in
  // a repository bound to a service the living docs do not have yet. It was
  // told "a service nobody adopted … Run `loam adopt`", while `loam doctor` in
  // the same repository said there was nothing to adopt — and following the
  // gate's advice wrote a baseline that would collide with the feature's own
  // archive (study 2026-10-30, I20). The refusal and its exit stand; the words
  // are doctor's.
  it("a service a feature in flight introduces: unknown-service in doctor's words, and never adopt", async () => {
    const p = await project(gateFixture(), { service: "payment-split-service" });
    const res = await gate(p);
    expect(res.code).toBe(1);
    expect(res.payload.error.code).toBe("unknown-service");
    const message = res.payload.error.message as string;
    expect(message).toContain("FEAT-1 introduces it, and it is not in the living docs until FEAT-1 archives");
    expect(message).toContain("nothing to adopt: FEAT-1's specs/payment-split-service/ are this service's documents");
    expect(message).toContain("`loam status FEAT-1`");
    expect(message).not.toContain("loam adopt");
    expect(message).not.toContain("nobody adopted");
    // One clause, two commands: doctor in the same repository says the same.
    const doctor = JSON.parse((await runLoam(p.workDir, "doctor", "--json")).stdout) as {
      findings: Array<{ code: string; message: string }>;
    };
    const unknown = doctor.findings.find((f) => f.code === "doctor.service-unknown")!;
    expect(unknown.message).toContain("FEAT-1 introduces it, and it is not in the living docs until FEAT-1 archives");
    // The service nobody introduces keeps the adopt advice — the case above is the control.
    const typo = await gate(p, "--service", "payment-servce");
    expect(typo.payload.error.message).toContain("loam adopt --service payment-servce");
  });

  it("an id the grammar refuses: invalid-option, before any path is built", async () => {
    const p = await project(gateFixture());
    const res = await gate(p, "--service", "../outside");
    expect(res.code).toBe(1);
    expect(res.payload.error.code).toBe("invalid-option");
  });

  it("a badly-named directory that EXISTS is graded, not refused — enumeration answers first", async () => {
    // service-target.ts's banner: refusing on the grammar would make the one
    // service loam complains about the one service loam cannot look at.
    const files = gateFixture();
    files["services/Payment Service/spec.md"] = "# Payment Service\n\n## Requirements\n";
    const p = await project(files);
    const res = await gate(p, "--service", "Payment Service");
    expect(res.payload.ok, res.out).toBe(true);
    expect(res.payload.verdict).toBe("fail");
    expect(codesOf(res.payload, "partners")).toContain("gate.service-undocumented");
    expect(res.code).toBe(1);
  });

  it("a docsDir that is gone: docs-missing", async () => {
    const p = await project(gateFixture(), { service: "payment-service" });
    await rm(p.docsDir, { recursive: true, force: true });
    const res = await gate(p);
    expect(res.code).toBe(1);
    expect(res.payload.error.code).toBe("docs-missing");
  });
});

/* ------------------------------------------------------------------ */
/* The partner check                                                   */
/* ------------------------------------------------------------------ */

describe("the partner check", () => {
  it("derives the join partners from the living landscape, both ends resolved", async () => {
    const p = await project(gateFixture(), { service: "payment-service" });
    const res = await gate(p);
    expect(res.payload.ok, res.out).toBe(true);
    expect(res.payload.command).toBe("gate");
    expect(res.payload.service).toBe("payment-service");
    expect(res.payload.landscape).toBe("read");
    // checkout-web calls authorizePayment on the gated service; the customer
    // (a person) joins nothing — actors are never deploy participants. The
    // FEATURE delta's payment-split-service edge is deliberately absent: the
    // living landscape is the only map this check reads.
    expect(res.payload.partners).toEqual([
      {
        service: "checkout-web",
        maturity: null,
        role: "consumer",
        via: ["operation authorizePayment"],
        external: false,
      },
    ]);
    expect(codesOf(res.payload, "partners")).toEqual(["gate.partner-undocumented"]);
    const warn = findingsOf(res.payload, "partners")[0]!;
    expect(warn.severity).toBe("warn");
    expect(warn.subject).toBe("checkout-web");
    // Warnings are advisory: the verdict passes and the run exits 0.
    expect(res.payload.verdict).toBe("pass");
    expect(res.payload.summary.errors).toBe(0);
    expect(res.code).toBe(0);
  });

  it("--strict escalates warnings to exit 1 without moving the verdict or the payload", async () => {
    const p = await project(gateFixture(), { service: "payment-service" });
    const plain = await gate(p);
    const strict = await gate(p, "--strict");
    expect(strict.code).toBe(1);
    expect(strict.payload.verdict).toBe("pass");
    expect(strict.payload.strict).toBe(true);
    // Only the echoed flag and the exit code differ — the report is the report.
    expect({ ...strict.payload, strict: false }).toEqual({ ...plain.payload, strict: false });
  });

  it("an absent landscape is 'nobody could look', never 'no partners'", async () => {
    const files = gateFixture();
    delete files["architecture/landscape.likec4"];
    const p = await project(files, { service: "payment-service" });
    const res = await gate(p);
    expect(res.payload.landscape).toBe("absent");
    expect(res.payload.partners).toEqual([]);
    expect(codesOf(res.payload, "partners")).toContain("gate.partners-unknown");
    expect(res.payload.verdict).toBe("pass");
    expect(res.code).toBe(0);
  });

  it("a landscape that cannot be read grades invalid, contained — and FAILS, carrying the reason", async () => {
    const files = gateFixture();
    delete files["architecture/landscape.likec4"];
    const p = await project(files, { service: "payment-service" });
    // A directory sitting where the file belongs — the commonest malformed-repo
    // shape, and the one that used to escape per-target catches elsewhere.
    await mkdir(join(p.docsDir, "architecture", "landscape.likec4"), { recursive: true });
    const res = await gate(p);
    expect(res.payload.ok, res.out).toBe(true);
    expect(res.payload.landscape).toBe("invalid");
    const unknown = findingsOf(res.payload, "partners").find((f) => f.code === "gate.partners-unknown")!;
    // Absent is a warning; a map that EXISTS and cannot be used is an ERROR —
    // `validate --all` fails this repo for the same file, and the deploy gate
    // must not be the quieter of two contradictory verdicts. The caught
    // reason travels into the finding rather than being swallowed.
    expect(unknown.severity).toBe("error");
    expect(unknown.message).toContain("EISDIR");
    expect(res.payload.verdict).toBe("fail");
    expect(res.code).toBe(1);
  });

  it("a landscape that does not parse is the same error, naming the parse failure", async () => {
    const files = gateFixture();
    files["architecture/landscape.likec4"] = "specification { element softwareSystem }\nmodel { broken";
    const p = await project(files, { service: "payment-service" });
    const res = await gate(p);
    expect(res.payload.landscape).toBe("invalid");
    const unknown = findingsOf(res.payload, "partners").find((f) => f.code === "gate.partners-unknown")!;
    expect(unknown.severity).toBe("error");
    expect(unknown.message).toContain("parse error");
    expect(res.payload.verdict).toBe("fail");
    expect(res.code).toBe(1);
  });

  it("an #external zone never exempts an adopted service drawn inside it", async () => {
    const files = gateFixture();
    files["architecture/landscape.likec4"] = EXTERNAL_LANDSCAPE;
    // checkout-web IS ours: adopted, spec only — `partial` on the ladder.
    files["services/checkout-web/spec.md"] =
      "---\nservice: checkout-web\nstatus: draft\n---\n\n# checkout-web\n\n## Requirements\n";
    const p = await project(files, { service: "payment-service" });
    const res = await gate(p);
    expect(res.payload.ok, res.out).toBe(true);
    // The zone's tag is the zone's claim, not the service's: checkout-web
    // keeps its real rung and its warning; stripe (external, unadopted) keeps
    // the exemption. {external: true, maturity: <rung>} is unrepresentable.
    expect(res.payload.partners).toEqual([
      {
        service: "checkout-web",
        maturity: "partial",
        role: "consumer",
        via: ["operation authorizePayment"],
        external: false,
      },
      {
        service: "stripe",
        maturity: null,
        role: "consumer",
        via: ["operation authorizePayment"],
        external: true,
      },
    ]);
    const partnerWarns = findingsOf(res.payload, "partners").filter(
      (f) => f.code === "gate.partner-undocumented",
    );
    expect(partnerWarns.map((f) => f.subject)).toEqual(["checkout-web"]);
    expect(partnerWarns[0]!.message).toContain("partial");
  });

  it("the fleet's own infrastructure is no partner at all — a store has no docs to grade", async () => {
    // The third of the three surfaces that used to nag a fleet-level store the
    // fleet OWNS (the other two are `landscape.datastore-private` and
    // `landscape.service-undocumented`, both pinned in test/landscape.test.ts).
    // Redis joined svc-a like any other counterparty, and since there is no
    // `services/Redis/` its rung came back null — so `gate.partner-undocumented`
    // told the deployer to "adopt it, bind its landscape element … or tag it
    // #external", three remedies not one of which is true of a cache the fleet
    // runs. It is dropped from the partner SET rather than exempted from the
    // finding, which is the ACTOR precedent exactly: `partners` lists the
    // counterparties whose documentation this gate grades, and a store has none.
    const p = await project(
      {
        "architecture/landscape.likec4": `specification {
  element softwareSystem
  element container
  element database
  tag external
}

model {
  svcA = softwareSystem 'svc-a' {
    metadata { service 'svc-a' }
  }
  redis = database 'Redis'
  svcA -> redis 'caches sessions'
}

views {
  view landscape {
    include *
  }
}
`,
        "services/svc-a/model.likec4": "model {\n  extend svcA {\n    api = container 'api'\n  }\n}\n",
        "services/svc-a/spec.md":
          "---\nservice: svc-a\nstatus: draft\n---\n\n# svc-a\n\n## Requirements\n\n### Requirement: Sessions are cached\nThe service SHALL keep session state in Redis.\n\n#### Scenario: A session round-trips\n- **Given** a session\n- **When** it is written\n- **Then** it can be read back\n",
      },
      { service: "svc-a" },
    );
    const res = await gate(p);
    expect(res.payload.landscape).toBe("read");
    expect(res.payload.partners).toEqual([]);
    expect(findingsOf(res.payload, "partners")).toEqual([]);
    expect(res.payload.verdict).toBe("pass");
    expect(res.code).toBe(0);
  });

  it("…but a BOUND store is an adopted service and keeps its rung — the kind never overrides a binding", async () => {
    // The guard that keeps the exemption from swallowing a real partner. A
    // `database` carrying `metadata { service '<id>' }` is a service somebody
    // adopted that happens to be drawn as a store: its side of the join IS
    // recorded, so it stays in the set and stays graded. Without this,
    // `gate.partner-undocumented` would go silent for every service a fleet
    // chose to draw with a storage shape.
    const p = await project(
      {
        "architecture/landscape.likec4": `specification {
  element softwareSystem
  element container
  element database
  tag external
}

model {
  svcA = softwareSystem 'svc-a' {
    metadata { service 'svc-a' }
  }
  catalogDb = database 'catalog store' {
    metadata { service 'catalog-db' }
  }
  svcA -> catalogDb 'queries'
}

views {
  view landscape {
    include *
  }
}
`,
        "services/svc-a/model.likec4": "model {\n  extend svcA {\n    api = container 'api'\n  }\n}\n",
        "services/svc-a/spec.md":
          "---\nservice: svc-a\nstatus: draft\n---\n\n# svc-a\n\n## Requirements\n\n### Requirement: Reads the catalog\nThe service SHALL read the catalog.\n\n#### Scenario: A read succeeds\n- **Given** a catalog\n- **When** it is read\n- **Then** rows come back\n",
        // Adopted, spec only — `partial` on the ladder, which is what makes it
        // visible here rather than merely present.
        "services/catalog-db/spec.md":
          "---\nservice: catalog-db\nstatus: draft\n---\n\n# catalog-db\n\n## Requirements\n",
      },
      { service: "svc-a" },
    );
    const res = await gate(p);
    expect(res.payload.partners).toEqual([
      {
        service: "catalog-db",
        maturity: "partial",
        role: "provider",
        via: ["edge 'queries'"],
        external: false,
      },
    ]);
    const warns = findingsOf(res.payload, "partners").filter((f) => f.code === "gate.partner-undocumented");
    expect(warns.map((f) => f.subject)).toEqual(["catalog-db"]);
  });

  it("…and a store drawn INSIDE a service is that service's interior, not infrastructure", async () => {
    // The other half of the same guard, and the one that cost a partner. The
    // ordinary way a team draws a private datastore is nested under its owner,
    // so the edge lands on `orderService.db` — and the infra walk read the
    // store's KIND off the endpoint before ever reaching the service above it,
    // marking the whole endpoint infrastructure. order-service then failed
    // `!facts.infra` and left the partner set entirely: a service this gate
    // exists to grade, silently absent, with no finding to say so.
    //
    // `commands/validate/fleet/census.ts` gets this right by construction —
    // `serviceLevelElements` drops a service's interior BEFORE `drawnSystems`
    // applies the kind test — and the two must not disagree about what a
    // partner is.
    const p = await project(
      {
        "architecture/landscape.likec4": `specification {
  element softwareSystem
  element container
  element database
  tag external
}

model {
  svcA = softwareSystem 'svc-a' {
    metadata { service 'svc-a' }
  }
  orderService = softwareSystem 'order-service' {
    metadata { service 'order-service' }
    db = database 'orders'
  }
  svcA -> orderService.db 'reads orders'
}

views {
  view landscape {
    include *
  }
}
`,
        "services/svc-a/model.likec4": "model {\n  extend svcA {\n    api = container 'api'\n  }\n}\n",
        "services/svc-a/spec.md":
          "---\nservice: svc-a\nstatus: draft\n---\n\n# svc-a\n\n## Requirements\n\n### Requirement: Reads orders\nThe service SHALL read orders.\n\n#### Scenario: A read succeeds\n- **Given** an order\n- **When** it is read\n- **Then** it comes back\n",
        // Adopted, spec only — `partial` on the ladder, so the assertion is
        // that the partner arrives WITH its rung, not merely that it arrives.
        "services/order-service/spec.md":
          "---\nservice: order-service\nstatus: draft\n---\n\n# order-service\n\n## Requirements\n",
      },
      { service: "svc-a" },
    );
    const res = await gate(p);
    expect(res.payload.landscape).toBe("read");
    expect(res.payload.partners).toEqual([
      {
        service: "order-service",
        maturity: "partial",
        role: "provider",
        via: ["edge 'reads orders'"],
        external: false,
      },
    ]);
    const warns = findingsOf(res.payload, "partners").filter(
      (f) => f.code === "gate.partner-undocumented",
    );
    expect(warns.map((f) => f.subject)).toEqual(["order-service"]);
  });

  it("an absent landscape does not convict a service for a contract nobody may be owed", async () => {
    // checkout-ui: model + spec, no openapi.yaml — a UI. With the map absent
    // the api question is unanswerable, and the fail-closed apiExpected used
    // to flip this service from pass to gate.service-undocumented: deleting
    // the landscape must not self-escalate into a second error.
    const p = await project(
      {
        "services/checkout-ui/model.likec4":
          "specification {\n  element softwareSystem\n}\n\nmodel {\n  checkoutUi = softwareSystem 'checkout-ui'\n}\n",
        "services/checkout-ui/spec.md":
          "---\nservice: checkout-ui\nstatus: draft\n---\n\n# checkout-ui\n\n## Requirements\n\n### Requirement: Render checkout\nThe UI SHALL render checkout.\n\n#### Scenario: Renders\n- **When** opened\n- **Then** it renders\n",
      },
      { service: "checkout-ui" },
    );
    const res = await gate(p);
    expect(res.payload.landscape).toBe("absent");
    expect(codesOf(res.payload, "partners")).toEqual(["gate.partners-unknown"]);
    expect(res.payload.verdict).toBe("pass");
    expect(res.code).toBe(0);
  });

  it("…but a service undocumented REGARDLESS of the api question still fails without a map", async () => {
    // spec.md only — below `documented` whether or not an API is owed. The
    // suppression above is about the one unanswerable fact, not a blanket
    // amnesty: what IS answerable still convicts.
    const p = await project(
      {
        "services/half-doc/spec.md": "---\nservice: half-doc\n---\n\n# half-doc\n\n## Requirements\n",
      },
      { service: "half-doc" },
    );
    const res = await gate(p);
    expect(res.payload.landscape).toBe("absent");
    const codes = codesOf(res.payload, "partners");
    expect(codes).toContain("gate.service-undocumented");
    expect(res.payload.verdict).toBe("fail");
    expect(res.code).toBe(1);
  });
});

/* ------------------------------------------------------------------ */
/* The verification check                                              */
/* ------------------------------------------------------------------ */

describe("the verification check", () => {
  it("a touching feature with no record warns gate.feature-unverified and names the command", async () => {
    const p = await project(gateFixture(), { service: "payment-service" });
    const res = await gate(p);
    expect(res.payload.features).toHaveLength(1);
    expect(res.payload.features[0]).toMatchObject({
      id: "FEAT-1",
      state: "absent",
      verdict: "unverified",
    });
    const findings = findingsOf(res.payload, "verification");
    expect(findings.map((f) => f.code)).toEqual(["gate.feature-unverified"]);
    expect(findings[0]!.severity).toBe("warn");
    expect(findings[0]!.message).toContain("loam verify FEAT-1 --json");
    expect(res.code).toBe(0);
  });

  it("a feature that does not touch the gated service is not in the report", async () => {
    // coherentFixture's FEAT-1 carries only specs/payment-split-service/ — no
    // delta for payment-service, so gate reports no feature at all.
    const p = await project(coherentFixture(), { service: "payment-service" });
    const res = await gate(p);
    expect(res.payload.features).toEqual([]);
    expect(findingsOf(res.payload, "verification")).toEqual([]);
  });

  it("an agent-answered record is attested — verify.scenario-attested, reused verbatim", async () => {
    // Recorded from an UNBOUND repo: in a bound service repo `verify --record`
    // deliberately federates to that service's own claims, and this record
    // answers the whole checklist. Gate then reads through the --service flag.
    const p = await project(gateFixture());
    await recordAttested(p);
    const res = await gate(p, "--service", "payment-service");
    expect(res.payload.features[0]).toMatchObject({ id: "FEAT-1", verdict: "attested" });
    const codes = codesOf(res.payload, "verification");
    expect(codes).toEqual(["verify.scenario-attested"]);
    expect(res.payload.verdict).toBe("pass");
    expect(res.code).toBe(0);
  });

  it("a runner-answered record is verified — the check goes quiet", async () => {
    const p = await project(gateFixture());
    await recordVerified(p, [
      digestFor(FEATURE_SPEC, "payment-split-service"),
      digestFor(TOUCHING_SPEC, "payment-service"),
    ]);
    const res = await gate(p, "--service", "payment-service");
    expect(res.payload.features[0], res.out).toMatchObject({ id: "FEAT-1", verdict: "verified" });
    expect(findingsOf(res.payload, "verification")).toEqual([]);
  });

  it("a record the feature moved out from under is stale — unverified again", async () => {
    const p = await project(gateFixture());
    await recordAttested(p);
    await p.write(
      "features/FEAT-1-split/specs/payment-service/spec.md",
      TOUCHING_SPEC.replace("reconciliation runs", "reconciliation runs twice"),
    );
    const res = await gate(p, "--service", "payment-service");
    expect(res.payload.features[0]).toMatchObject({ id: "FEAT-1", state: "stale", verdict: "unverified" });
    const findings = findingsOf(res.payload, "verification");
    expect(findings.map((f) => f.code)).toEqual(["gate.feature-unverified"]);
    expect(findings[0]!.message).toContain("moved after");
  });
});

/* ------------------------------------------------------------------ */
/* The freshness check                                                 */
/* ------------------------------------------------------------------ */

describe("the freshness check", () => {
  it("a vouched doc edited since its stamp is content.stale, attributed to its service", async () => {
    const files = gateFixture();
    files["services/payment-service/spec.md"] = [
      "---",
      "service: payment-service",
      "status: verified",
      'content_digest: "0000000000000000"',
      "---",
      "",
      "# payment-service",
      "",
      "## Requirements",
      "",
      "### Requirement: Authorize a payment",
      "The service SHALL authorize a payment before capture.",
      "",
      "Operations: authorizePayment",
      "",
      "#### Scenario: Successful authorization",
      "- **Given** a valid card",
      "- **When** authorization is requested",
      "- **Then** the payment is authorized",
      "",
    ].join("\n");
    const p = await project(files, { service: "payment-service" });
    const res = await gate(p);
    const findings = findingsOf(res.payload, "freshness");
    expect(findings.map((f) => f.code)).toEqual(["content.stale"]);
    expect(findings[0]!.severity).toBe("warn");
    expect(findings[0]!.subject).toBe("payment-service");
    // Staleness reports and never fails by default.
    expect(res.payload.verdict).toBe("pass");
    expect(res.code).toBe(0);
  });

  it("a UTF-16 living spec is an error naming the file — mangled bytes never read as 'nothing stale'", async () => {
    // serviceProvenance's own reads decode with 'utf8', which silently turns
    // UTF-16 into replacement characters: the file then grades as having no
    // frontmatter (a warning this check does not retain), and before the fix
    // the gate passed over a spec `validate` refuses as unreadable.
    const files = gateFixture();
    files["services/checkout-web/spec.md"] = "placeholder (overwritten with UTF-16 bytes below)";
    const p = await project(files, { service: "payment-service" });
    await writeFile(
      join(p.docsDir, "services", "checkout-web", "spec.md"),
      Buffer.from("---\nservice: checkout-web\nstatus: verified\n---\n\n# checkout-web\n", "utf16le"),
    );
    const res = await gate(p);
    expect(res.payload.ok, res.out).toBe(true);
    const unreadable = findingsOf(res.payload, "freshness").filter(
      (f) => f.code === "service.unreadable",
    );
    expect(unreadable).toHaveLength(1);
    expect(unreadable[0]!.subject).toBe("checkout-web");
    expect(unreadable[0]!.message).toContain("spec.md");
    expect(unreadable[0]!.message).toContain("UTF-8");
    expect(res.payload.verdict).toBe("fail");
    expect(res.code).toBe(1);
  });

  it("a header YAML refuses to parse fails the gate — an uncertifiable digest is not a fresh one", async () => {
    const files = gateFixture();
    // An unclosed flow sequence: the header exists and does not parse, so
    // neither content_digest nor sources can be judged — and the partner's
    // rung in the table is presence-derived guesswork the finding must flag.
    files["services/checkout-web/spec.md"] =
      "---\nservice: [checkout-web\n---\n\n# checkout-web\n\n## Requirements\n";
    const p = await project(files, { service: "payment-service" });
    const res = await gate(p);
    expect(res.payload.ok, res.out).toBe(true);
    const malformed = findingsOf(res.payload, "freshness").filter(
      (f) => f.code === "frontmatter.malformed",
    );
    expect(malformed).toHaveLength(1);
    expect(malformed[0]!.subject).toBe("checkout-web");
    expect(malformed[0]!.severity).toBe("error");
    // The partner row still shows the presence-derived rung — the finding is
    // what stops it riding out as a certified one.
    const partner = res.payload.partners.find(
      (x: { service: string }) => x.service === "checkout-web",
    );
    expect(partner.maturity).toBe("partial");
    expect(res.payload.verdict).toBe("fail");
    expect(res.code).toBe(1);
  });

  it("one unreadable partner artifact degrades that partner as an error — the report survives", async () => {
    const files = gateFixture();
    // checkout-web becomes a real (partial) service, whose arch.spec.md is a
    // DIRECTORY: enumeration succeeds, the freshness read of that one file
    // cannot. One sibling's bad byte must cost one subject, not the command —
    // and it must cost the EXIT CODE, because "nobody could look" and
    // "nothing is wrong" are opposite facts.
    files["services/checkout-web/spec.md"] = "# checkout-web\n\n## Requirements\n";
    const p = await project(files, { service: "payment-service" });
    await mkdir(join(p.docsDir, "services", "checkout-web", "arch.spec.md"), { recursive: true });
    const res = await gate(p);
    expect(res.payload.ok, res.out).toBe(true);
    const unreadable = findingsOf(res.payload, "freshness").filter(
      (f) => f.code === "service.unreadable",
    );
    expect(unreadable).toHaveLength(1);
    expect(unreadable[0]!.subject).toBe("checkout-web");
    expect(unreadable[0]!.severity).toBe("error");
    // EISDIR from read() names no path (the policy gate documents the quirk),
    // so the finding says so instead of guessing a filename.
    expect(unreadable[0]!.message).toContain("EISDIR");
    expect(unreadable[0]!.message).toContain("named no path");
    // The rest of the report still arrived.
    expect(res.payload.partners.map((x: { service: string }) => x.service)).toContain("checkout-web");
    expect(res.payload.verdict).toBe("fail");
    expect(res.code).toBe(1);
  });
});

/* ------------------------------------------------------------------ */
/* The interrupted check                                               */
/* ------------------------------------------------------------------ */

describe("the interrupted check", () => {
  it("a .loam-commit journal fails the gate: nothing derived from a half-committed repo can be trusted", async () => {
    const p = await project(gateFixture(), { service: "payment-service" });
    const clean = await gate(p);
    expect(clean.payload.verdict).toBe("pass");
    expect(findingsOf(clean.payload, "interrupted")).toEqual([]);

    await p.write(".loam-commit", "not a journal this loam can read\n");
    const res = await gate(p);
    const findings = findingsOf(res.payload, "interrupted");
    expect(findings.map((f) => f.code)).toEqual(["docs.commit-interrupted"]);
    expect(findings[0]!.severity).toBe("error");
    expect(res.payload.verdict).toBe("fail");
    expect(res.code).toBe(1);
  });
});

/* ------------------------------------------------------------------ */
/* Read-only, deterministic                                            */
/* ------------------------------------------------------------------ */

describe("gate is a pure query", () => {
  it("writes nothing, whatever it finds — pass, warnings and fail alike", async () => {
    const p = await project(gateFixture(), { service: "payment-service" });
    await p.write(".loam-commit", "garbage\n");
    const before = await treeHashes(p.docsDir);
    await gate(p);
    await gate(p, "--strict");
    await gate(p, "--service", "nobody-here");
    expect(await treeHashes(p.docsDir)).toEqual(before);
  });

  it("identical state, identical bytes", async () => {
    const p = await project(gateFixture(), { service: "payment-service" });
    const first = await gate(p);
    const second = await gate(p);
    expect(second.stdout).toBe(first.stdout);
  });
});

/* ------------------------------------------------------------------ */
/* The human view                                                      */
/* ------------------------------------------------------------------ */

describe("the human view", () => {
  it("prints the partner table, the warnings, and the verdict last — advisory said out loud", async () => {
    const p = await project(gateFixture(), { service: "payment-service" });
    const res = await runLoam(p.workDir, "gate");
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("gate — payment-service");
    expect(res.stdout).toContain("partners — landscape read");
    // The partner row is data, the finding is judgement — both appear.
    expect(res.stdout).toContain("checkout-web · no services/ directory · consumer · operation authorizePayment");
    expect(res.stdout).toContain("⚠");
    // "Could not look" quiet-states are said, never blank: an empty check
    // prints its ✓ line, and silence is never the output.
    expect(res.stdout).toContain("nothing recorded has gone stale");
    expect(res.stdout).toContain("no interrupted commit");
    const verdictLine = res.stdout.trimEnd().split("\n").at(-1)!;
    expect(verdictLine).toContain("verdict: pass — 0 errors, 2 warnings");
    expect(verdictLine).toContain("(advisory — `--strict` turns warnings into exit 1)");
  });

  it("under --strict the verdict line says the run exits 1 — never a bare 'pass' on a red step", async () => {
    const p = await project(gateFixture(), { service: "payment-service" });
    const res = await runLoam(p.workDir, "gate", "--strict");
    expect(res.code).toBe(1);
    const verdictLine = res.stdout.trimEnd().split("\n").at(-1)!;
    expect(verdictLine).toBe("verdict: pass — 0 errors, 2 warnings — exit 1: `--strict` fails on warnings");
    expect(verdictLine).not.toContain("advisory");
  });

  it("a failing gate says so in text with the error mark and exit 1 — both modes, same facts", async () => {
    const p = await project(gateFixture(), { service: "payment-service" });
    await p.write(".loam-commit", "garbage\n");
    const res = await runLoam(p.workDir, "gate");
    expect(res.code).toBe(1);
    expect(res.stdout).toContain("✗");
    expect(res.stdout).toContain(".loam-commit");
    expect(res.stdout.trimEnd().split("\n").at(-1)).toContain("verdict: fail");
  });

  it("refusals without --json go to stderr as prose, stdout stays empty", async () => {
    const p = await project(gateFixture());
    const res = await runLoam(p.workDir, "gate", "--service", "nobody-here");
    expect(res.code).toBe(1);
    expect(res.stdout).toBe("");
    expect(res.stderr).toContain("No service 'nobody-here'");
  });
});

/* ------------------------------------------------------------------ */
/* --since <ref>: the features shipped after the last deploy          */
/* ------------------------------------------------------------------ */

/*
 * Without the flag the verification check reads in-flight features only, so
 * a feature left the gate the moment it was archived: on the example fleet,
 * `gate --service order-service --strict` went from exit 1 (FEAT-112 has no
 * verification record) to exit 0 after `loam archive FEAT-112`, which reads
 * no record by design. Archiving was the cheapest way past --strict — on a
 * draft service, and on a VOUCHED one too when the feature changed only a
 * contract, because `content_digest` covers the spec bodies and not
 * openapi.yaml, so freshness cannot catch that ship either.
 *
 * Pinned here: the flag reads the docs repo's git the way `loam diff --base`
 * does — with the git root one level ABOVE the docs repo, so the monorepo
 * prefix is exercised and a broken strip would drag every archived feature
 * in — it adds exactly the features archived after the ref that touch the
 * service (FEAT-088 touches order-service too and was archived BEFORE the ref,
 * so it must stay out), each as the same row plus `archived: true` under the
 * same warn-only code, and the answer without the flag is unchanged.
 */

const SHIPPED_EXAMPLE = fileURLToPath(new URL("../examples/docs", import.meta.url));

function git(cwd: string, ...args: string[]): void {
  const res = spawnSync("git", args, { cwd, encoding: "utf8", timeout: 30_000 });
  if (res.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${res.stderr}`);
}

/** Stage and commit everything under `dir`, initialising the repository first when asked. */
function commitAll(dir: string, message: string, init = false): void {
  if (init) git(dir, "init", "-q", "-b", "main");
  git(dir, "add", "-A");
  git(dir, "-c", "user.email=since@test.invalid", "-c", "user.name=Since Test", "commit", "-q", "-m", message);
}

/** A byte copy of the shipped example docs repo at `<root>/fleet`, committed with the git root at `<root>`. */
async function exampleFleet(): Promise<{ root: string; fleet: string }> {
  const root = await makeTmpDir("loam-gate-since-");
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const fleet = join(root, "fleet");
  await cp(SHIPPED_EXAMPLE, fleet, { recursive: true });
  commitAll(root, "base", true);
  return { root, fleet };
}

/** `gate` from any directory — the example fleet carries its own loam.json, the vouch repo another. */
async function gateIn(cwd: string, ...args: string[]): Promise<GateRun> {
  const res = await runLoam(cwd, "gate", "--json", ...args);
  return { code: res.code, out: res.out, stdout: res.stdout, payload: JSON.parse(res.stdout) };
}

describe("gate --since: a feature archived after the ref is still graded", () => {
  it("archiving FEAT-112 no longer buys a --strict pass — without --since the answer is today's", async () => {
    const { fleet } = await exampleFleet();
    const strict = ["--service", "order-service", "--strict"];

    // In flight: the plain gate already sees it.
    const before = await gateIn(fleet, ...strict);
    expect(before.code, before.out).toBe(1);
    expect(before.payload.since).toBeNull();
    expect(before.payload.features.map((f: { id: string }) => f.id)).toEqual(["FEAT-112"]);
    expect(before.payload.features[0]).not.toHaveProperty("archived");

    const archived = await runLoam(fleet, "archive", "FEAT-112");
    expect(archived.code, archived.out).toBe(0);

    // Without --since: in-flight features only, exactly as before the flag.
    const plain = await gateIn(fleet, ...strict);
    expect(plain.payload.since).toBeNull();
    expect(plain.payload.features).toEqual([]);
    expect(findingsOf(plain.payload, "verification")).toEqual([]);

    // With the ref the last deploy recorded, the shipped feature is back.
    const since = await gateIn(fleet, ...strict, "--since", "main");
    expect(since.code, since.out).toBe(1);
    expect(since.payload.verdict).toBe("pass");
    expect(since.payload.since).toEqual({ ref: "main", commit: expect.stringMatching(/^[0-9a-f]{40}$/) });
    // FEAT-088 touches order-service as well, but its archive directory was
    // there at the ref: it shipped in an earlier deploy and stays out.
    expect(since.payload.features).toEqual([
      expect.objectContaining({ id: "FEAT-112", archived: true, state: "absent", verdict: "unverified" }),
    ]);
    const findings = findingsOf(since.payload, "verification");
    expect(findings.map((f) => [f.severity, f.code, f.subject])).toEqual([
      ["warn", "gate.feature-unverified", "FEAT-112"],
    ]);
    expect(findings[0]!.message).toContain("archived after main");
    // The in-flight remedy would send the pipeline to a `verify --record` an
    // archived feature refuses; the frozen wording names the reopen instead.
    expect(findings[0]!.message).toContain("`loam unarchive FEAT-112`");

    // Advisory without --strict, like every other warning.
    expect((await gateIn(fleet, "--service", "order-service", "--since", "main")).code).toBe(0);

    // The human view names the bound and marks the shipped row.
    const text = await runLoam(fleet, "gate", "--service", "order-service", "--since", "main");
    expect(text.stdout).toContain("verification — in flight, and archived since main");
    // No record is not a record that confirmed nothing: no "0/0" count.
    expect(text.stdout).toContain("FEAT-112 · unverified (no verification record) · archived");
    expect(text.stdout).not.toContain("0/0 confirmed");
  });

  it("a contract-only feature shipped on a VOUCHED service is graded too — freshness cannot see it", async () => {
    const { root, fleet } = await exampleFleet();
    expect((await runLoam(fleet, "archive", "FEAT-112")).code).toBe(0);
    // A bound service repo, so the vouch stamps from the code it names.
    const repo = join(root, "order-repo");
    await writeFiles(repo, {
      "loam.json": JSON.stringify({ docsDir: "../fleet", service: "order-service" }),
      "src/main/kotlin/Order.kt": "class Order\n",
    });
    const vouched = await runLoam(repo, "vouch", "--yes");
    expect(vouched.code, vouched.out).toBe(0);

    // FEAT-200 changes order-service's contract and no requirement.
    const living = await readFile(join(fleet, "services/order-service/openapi.yaml"), "utf8");
    await writeFiles(fleet, {
      "features/FEAT-200-order-gone-status/intent.md": FEAT_200_INTENT,
      "features/FEAT-200-order-gone-status/specs/order-service/spec.md":
        "# order-service — requirement delta for FEAT-200\n",
      "features/FEAT-200-order-gone-status/specs/order-service/openapi.yaml": pinOpenapi(FEAT_200_OPENAPI, living),
    });
    commitAll(root, "deployed: FEAT-200 in flight");

    const inFlight = await gateIn(repo, "--strict");
    expect(inFlight.code, inFlight.out).toBe(1);
    expect(findingsOf(inFlight.payload, "verification").map((f) => f.subject)).toEqual(["FEAT-200"]);

    const shipped = await runLoam(fleet, "archive", "FEAT-200");
    expect(shipped.code, shipped.out).toBe(0);

    // Without --since the verification check has nothing left to read.
    expect(findingsOf((await gateIn(repo, "--strict")).payload, "verification")).toEqual([]);

    // FEAT-112 was archived before this ref, FEAT-200 after it.
    const since = await gateIn(repo, "--strict", "--since", "main");
    expect(since.code, since.out).toBe(1);
    expect(since.payload.features).toEqual([
      expect.objectContaining({ id: "FEAT-200", archived: true, verdict: "unverified" }),
    ]);
    expect(findingsOf(since.payload, "verification").map((f) => [f.code, f.subject])).toEqual([
      ["gate.feature-unverified", "FEAT-200"],
    ]);
  });

  it("an archive directory absent at the ref is git answering — every archived feature shipped since", async () => {
    const p = await project(coherentFixture());
    commitAll(p.docsDir, "base", true);
    expect((await runLoam(p.workDir, "archive", "FEAT-1")).code).toBe(0);
    const since = await gate(p, "--service", "payment-split-service", "--since", "main");
    expect(since.payload.features, since.out).toEqual([expect.objectContaining({ id: "FEAT-1", archived: true })]);
  });
});

describe("gate --since: the refusals are loam diff --base's", () => {
  it("a docs repo git cannot answer from refuses repository-unavailable — never 'nothing shipped'", async () => {
    const p = await project(coherentFixture());
    const res = await gate(p, "--service", "payment-service", "--since", "main");
    expect(res.code).toBe(1);
    expect(res.payload.ok).toBe(false);
    expect(res.payload.error.code).toBe("repository-unavailable");
    expect(res.payload.error.message).toContain("loam gate --since");
  });

  it("a ref that names no commit refuses unknown-target, naming the flag and the ref", async () => {
    const p = await project(coherentFixture());
    commitAll(p.docsDir, "base", true);
    for (const ref of ["no-such-deploy", "--strict"]) {
      const res = await gate(p, "--service", "payment-service", `--since=${ref}`);
      expect(res.code, ref).toBe(1);
      expect(res.payload.error.code, ref).toBe("unknown-target");
      expect(res.payload.error.message, ref).toContain(`--since ${ref}`);
    }
  });
});

const FEAT_200_INTENT = `---
feature: FEAT-200
title: Order gone status
status: in_progress
owner: orders-team
---

# Order gone status

## Why

Purged orders should answer 410 instead of 404 so clients stop retrying.

## Scope

order-service's read contract only.
`;

const FEAT_200_OPENAPI = `openapi: 3.1.0
info:
  title: order-service
  version: "1.0"
paths:
  /orders/{id}:
    get:
      operationId: getOrder
      summary: Read an order
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
            format: uuid
      responses:
        "200":
          description: The order as it currently stands.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Order'
        "404":
          description: No order with that id was ever placed.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Problem'
        "410":
          description: The order was purged.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Problem'
`;
