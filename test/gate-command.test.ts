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
 * exit code).
 */
import { describe, expect, it, afterEach } from "vitest";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { parseRequirements } from "../src/core/document/parse.js";
import { scenarioDigest } from "../src/core/gherkin/stamp.js";
import {
  coherentFixture,
  makeProject,
  runLoam,
  treeHashes,
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
        steps: [{ keyword: "Then ", result: { status: "passed", duration: 1 } }],
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
    expect(verdictLine).toContain("--strict");
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
