/**
 * Architectural obligations: the architect's second channel to a team, and the
 * first one that can carry a rule which VARIES.
 *
 * loam already had exactly one such channel and it works: an edge carrying
 * `metadata { op }` obliges the provider to define that operationId, or
 * `spine.op-undefined` fails the gate. There was no equivalent for an outbox on
 * this publisher and not that one, and "varies" is why a policy document is the
 * wrong shape — a fleet-wide rule every service inherits is not what an
 * architect actually hands over.
 *
 * So the decision and its scope are separate things: an ADR says WHAT, a
 * `#obl-<name>` tag on the living map says WHERE, `architecture/obligations.yaml`
 * declares the names so a mistyped tag is an error rather than a word nobody
 * notices, and the team's `Covers:` says it is met.
 *
 * THE HEADLINE IS `obligation.uncovered`, and it is the ROADMAP's named
 * prerequisite discharged: `c4.uncovered` could always say "this architecture
 * object owes a requirement" — but only about a NEW tagged element in a
 * feature's `delta.likec4`, never about the map the fleet actually runs on.
 * Both directions of it are pinned below, because a check that fires on
 * everything is as useless as one that fires on nothing.
 *
 * TWO REFUSALS ARE HERE TO STOP A LATER "IMPROVEMENT". An id that a LikeC4 tag
 * name cannot carry refuses the FILE rather than being flattened into a slug —
 * the capability axis pays for flattening with a collision arm at every join,
 * and an obligation id has no life outside its own tag. And a tag naming no
 * declared obligation earns its error WITHOUT also earning `obligation.uncovered`:
 * one breach, one finding.
 */
import { describe, expect, it, afterEach } from "vitest";
import { LIVING_OPENAPI, SERVICE_MODEL, makeProject, runLoam, type Project } from "./helpers/harness.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!();
});

/**
 * A landscape whose payment-service element and whose one edge carry whatever
 * tags the case needs. Tags are DECLARED in `specification` because LikeC4
 * requires it, which is itself part of the story: an obligation tag is visible
 * in the map's own vocabulary before loam ever reads it.
 */
function landscape(opts: { declare: string[]; onElement?: string[]; onEdge?: string[] }): string {
  const tags = opts.declare.map((t) => `  tag ${t}`).join("\n");
  const el = (opts.onElement ?? []).map((t) => `    #${t}`).join("\n");
  const edge = (opts.onEdge ?? []).map((t) => `    #${t}`).join("\n");
  return `specification {
  element softwareSystem
  element person
${tags}
}

model {
  customer = person 'Customer'
  checkoutWeb = softwareSystem 'checkout-web' {
    description 'Customer-facing checkout UI'
  }
  paymentService = softwareSystem 'payment-service' {
${el}
    description 'Owns payment authorization/capture'
  }

  customer -> checkoutWeb 'Uses'
  checkoutWeb -> paymentService 'Calls authorizePayment' {
${edge}
    metadata { op 'authorizePayment' }
  }
}

views {
  view landscape {
    include *
  }
}
`;
}

/** A living spec whose one requirement governs the operation the landscape's edge calls. */
const SPEC = `---
service: payment-service
status: verified
---

# payment-service

## Requirements

### Requirement: Authorize a payment
The service SHALL authorize a payment before capture.

Operations: authorizePayment

#### Scenario: Successful authorization
- **Given** a valid card
- **When** authorization is requested
- **Then** the payment is authorized
`;

/** An architecture spec whose one requirement covers `covers`. */
function archSpec(covers: string): string {
  return `---
service: payment-service
status: verified
---

# payment-service — architecture

## Requirements

### Requirement: Events leave through the outbox
Requirement-ID: ARCH-OUTBOX
The service SHALL publish through a transactional outbox.

Covers: ${covers}

#### Scenario: The broker is down at commit time
- **Given** an authorized payment
- **When** the broker is unreachable
- **Then** the event is still recorded
- **And** it is published once the broker returns
`;
}

/** A fleet with a landscape, one modelled service, and whatever else the case adds. */
function fleet(land: string, extra: Record<string, string> = {}): Record<string, string> {
  return {
    "architecture/landscape.likec4": land,
    "services/payment-service/model.likec4": SERVICE_MODEL,
    "services/payment-service/spec.md": SPEC,
    "services/payment-service/openapi.yaml": LIVING_OPENAPI,
    ...extra,
  };
}

async function project(files: Record<string, string>): Promise<Project> {
  const p = await makeProject(files, { service: "payment-service" });
  cleanups.push(() => p.destroy());
  return p;
}

async function findings(
  p: Project,
  code: string,
): Promise<Array<{ subject?: string; message: string; details?: string[] }>> {
  const res = await runLoam(p.workDir, "validate", "--all", "--json");
  const targets: Array<{ findings: Array<{ code: string; subject?: string; message: string; details?: string[] }> }> =
    JSON.parse(res.stdout).targets ?? [];
  return targets.flatMap((t) => t.findings.filter((f) => f.code === code));
}

/** Every obligation.* code a run produced, sorted — the shape of the whole verdict. */
async function codes(p: Project): Promise<string[]> {
  const res = await runLoam(p.workDir, "validate", "--all", "--json");
  const targets: Array<{ findings: Array<{ code: string }> }> = JSON.parse(res.stdout).targets ?? [];
  return targets
    .flatMap((t) => t.findings.map((f) => f.code))
    .filter((c) => c.startsWith("obligation."))
    .sort();
}

const OUTBOX_YAML = "obligations:\n  outbox:\n    description: Publishers write through a transactional outbox.\n";

describe("the vocabulary is the opt-in", () => {
  it("a fleet with no architecture/obligations.yaml hears nothing, tags or no tags", async () => {
    const p = await project(fleet(landscape({ declare: ["obl-outbox"], onElement: ["obl-outbox"] })));
    expect(p.exists("architecture/obligations.yaml")).toBe(false);
    expect(await codes(p)).toEqual([]);
    const run = await runLoam(p.workDir, "validate", "--all", "--json");
    expect(run.code, run.out).toBe(0);
  });

  it("a vocabulary that does not read is reported ALONE — the family is suspended behind it", async () => {
    const p = await project(
      fleet(landscape({ declare: ["obl-nope"], onElement: ["obl-nope"] }), {
        "architecture/obligations.yaml": "obligations: [not, a, mapping]\n",
      }),
    );
    // Not `obligation.unknown` on top: every tag resolves against this file, so
    // grading them over a broken vocabulary is a cascade, not a diagnosis.
    expect(await codes(p)).toEqual(["obligation.invalid"]);
  });

  it("an id a tag name cannot carry refuses the file, and says why", async () => {
    const p = await project(
      fleet(landscape({ declare: [] }), { "architecture/obligations.yaml": "obligations:\n  payments/outbox: {}\n" }),
    );
    const invalid = await findings(p, "obligation.invalid");
    expect(invalid).toHaveLength(1);
    // The reason names the truncation, which is the part that makes this worth
    // refusing rather than flattening: `#obl-a.b` reads back as `obl-a`, so a
    // rejected character would silently mean a different obligation.
    expect(invalid[0]!.message).toContain("payments/outbox");
    expect(invalid[0]!.message).toContain("truncates the tag");
  });
});

describe("the tag join, read in both directions", () => {
  it("a tag nothing declares is an error naming what it tags, with close names", async () => {
    const p = await project(
      fleet(landscape({ declare: ["obl-outbxo"], onElement: ["obl-outbxo"] }), {
        "architecture/obligations.yaml": OUTBOX_YAML,
      }),
    );
    const unknown = await findings(p, "obligation.unknown");
    expect(unknown).toHaveLength(1);
    expect(unknown[0]!.subject).toBe("outbxo");
    expect(unknown[0]!.message).toContain("did you mean: outbox");
    expect(unknown[0]!.details).toEqual(["paymentService"]);
    // And it is an ERROR, so the fleet gate refuses: a tag that resolves to
    // nothing reads exactly like a rule the fleet keeps.
    expect((await runLoam(p.workDir, "validate", "--all", "--json")).code).toBe(1);
  });

  it("a declaration nothing tags is a warning, and never gates", async () => {
    const p = await project(
      fleet(landscape({ declare: [] }), { "architecture/obligations.yaml": OUTBOX_YAML }),
    );
    const unapplied = await findings(p, "obligation.unapplied");
    expect(unapplied).toHaveLength(1);
    expect(unapplied[0]!.details).toEqual(["outbox"]);
    expect((await runLoam(p.workDir, "validate", "--all", "--json")).code).toBe(0);
  });

  it("an unknown tag does NOT also earn obligation.uncovered — one breach, one finding", async () => {
    const p = await project(
      fleet(landscape({ declare: ["obl-nope"], onElement: ["obl-nope"] }), {
        "architecture/obligations.yaml": OUTBOX_YAML,
      }),
    );
    expect(await codes(p)).toEqual(["obligation.unapplied", "obligation.unknown"]);
  });
});

describe("obligation.uncovered — the living map asks what only a feature delta could be asked before", () => {
  it("a tagged element no living arch requirement covers is named, with the fix", async () => {
    const p = await project(
      fleet(landscape({ declare: ["obl-outbox"], onElement: ["obl-outbox"] }), {
        "architecture/obligations.yaml": OUTBOX_YAML,
      }),
    );
    const uncovered = await findings(p, "obligation.uncovered");
    expect(uncovered).toHaveLength(1);
    // Filed under the service that owns the object, so a fleet report reads as
    // a worklist per team rather than one line naming forty edges.
    expect(uncovered[0]!.subject).toBe("payment-service");
    expect(uncovered[0]!.message).toContain("Covers: paymentService");
    expect((await runLoam(p.workDir, "validate", "--all", "--json")).code).toBe(0);
  });

  it("and goes silent the moment a living requirement covers it", async () => {
    const p = await project(
      fleet(landscape({ declare: ["obl-outbox"], onElement: ["obl-outbox"] }), {
        "architecture/obligations.yaml": OUTBOX_YAML,
        "services/payment-service/arch.spec.md": archSpec("paymentService"),
      }),
    );
    expect(await findings(p, "obligation.uncovered")).toEqual([]);
  });

  it("an EDGE carries an obligation too, and its Covers: entry is the edge form", async () => {
    const tagged = landscape({ declare: ["obl-outbox"], onEdge: ["obl-outbox"] });
    const bare = await project(fleet(tagged, { "architecture/obligations.yaml": OUTBOX_YAML }));
    const uncovered = await findings(bare, "obligation.uncovered");
    expect(uncovered).toHaveLength(1);
    expect(uncovered[0]!.message).toContain("checkoutWeb -> paymentService");

    const covered = await project(
      fleet(tagged, {
        "architecture/obligations.yaml": OUTBOX_YAML,
        "services/payment-service/arch.spec.md": archSpec("checkoutWeb -> paymentService"),
      }),
    );
    expect(await findings(covered, "obligation.uncovered")).toEqual([]);
  });

  it("a Covers: line in the BUSINESS spec counts — the grammar is one grammar", async () => {
    // `Covers:` is parsed in both requirement documents for one grammar's sake,
    // and a fleet that wrote its outbox requirement in spec.md has said the
    // thing loam is asking about. An index built from arch.spec.md alone would
    // report that fleet as having placed a rule nobody keeps.
    const p = await project(
      fleet(landscape({ declare: ["obl-outbox"], onElement: ["obl-outbox"] }), {
        "architecture/obligations.yaml": OUTBOX_YAML,
        "services/payment-service/spec.md": SPEC.replace(
          "Operations: authorizePayment",
          "Operations: authorizePayment\nCovers: paymentService",
        ),
      }),
    );
    expect(await findings(p, "obligation.uncovered")).toEqual([]);
  });
});

describe("the ADR the obligation comes from", () => {
  it("an `adr:` naming no file is an error — a pointer at a decision nobody can read", async () => {
    const p = await project(
      fleet(landscape({ declare: ["obl-outbox"], onElement: ["obl-outbox"] }), {
        "architecture/obligations.yaml": `${OUTBOX_YAML}    adr: architecture/adrs/0001-outbox.md\n`,
      }),
    );
    const missing = await findings(p, "obligation.adr-missing");
    expect(missing).toHaveLength(1);
    expect(missing[0]!.subject).toBe("outbox");
  });

  it("and silent once the record is there", async () => {
    const p = await project(
      fleet(landscape({ declare: ["obl-outbox"], onElement: ["obl-outbox"] }), {
        "architecture/obligations.yaml": `${OUTBOX_YAML}    adr: architecture/adrs/0001-outbox.md\n`,
        "architecture/adrs/0001-outbox.md": "# 0001 — Outbox\n\nStatus: accepted\n",
      }),
    );
    expect(await findings(p, "obligation.adr-missing")).toEqual([]);
  });
});

describe("a map loam could not read suspends the map questions, and only those", () => {
  it("no landscape at all: the vocabulary is still graded, the tags are not", async () => {
    const p = await makeProject(
      {
        "services/payment-service/model.likec4": SERVICE_MODEL,
        "services/payment-service/spec.md": SPEC,
        "architecture/obligations.yaml": `${OUTBOX_YAML}    adr: architecture/adrs/nope.md\n`,
      },
      { service: "payment-service" },
    );
    cleanups.push(() => p.destroy());
    // `obligation.unapplied` would be the WRONG answer here: loam did not read
    // a map, so "no tag applies this anywhere" is a claim about nothing. The
    // suspension is the landscape target's own early return rather than a guard
    // inside the check — a mutation run proved the guard unreachable, and a
    // defensive `land: null` arm on the interface would only invite a caller to
    // reach it. This test is what holds the behaviour wherever it lives.
    expect(await codes(p)).toEqual(["obligation.adr-missing"]);
  });
});
