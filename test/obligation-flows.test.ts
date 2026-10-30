/**
 * `#obl-<id>` on a `dynamic view`: a fleet flow keeps an architectural
 * obligation.
 *
 * A use case could keep only a business promise, so a cross-service sequence
 * nobody outside the fleet sees was tagged with a business promise it does not
 * keep, or left as a picture nothing graded (ROADMAP, "A fleet flow keeps an
 * architectural obligation"). The tag makes the view a use case and APPLIES the
 * obligation to the relationship behind every hop it draws — and that second
 * half is the property most of these cases pin, because a tag that applied to
 * nothing would let a flow "keep" an obligation no team met.
 *
 * THREE SCOPES, ONE RULE. `validate --all` grades living flows with the axis's
 * existing codes; the feature gate grades a feature's own flows over the map
 * its merge would leave, counting the `Covers:` lines the feature itself adds;
 * and beside a service's model the tag is refused by placement, because there
 * the obligation is met by the arch requirement a flow keeps with `#req-`.
 */
import { afterEach, describe, expect, it } from "vitest";
import { VALIDATE_CHECKS } from "../src/core/brief/checks/checks.js";
import { LIVING_OPENAPI, SERVICE_MODEL, makeProject, runLoam, type Project } from "./helpers/harness.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!();
});

interface JsonFinding {
  severity: string;
  code: string;
  subject?: string;
  message: string;
  details?: string[];
  locations?: Array<{ path: string; role: string }>;
}

/**
 * The living map: a call into payment-service and a publish out of it onto a
 * topic that is no service. The publish edge is the case the owner rule exists
 * for — its target is the topic, and the team that owes the requirement is the
 * publisher at the source.
 */
function landscape(edgeTags: readonly string[] = [], extraEdges = ""): string {
  const onEdge = edgeTags.map((t) => `    #${t}\n`).join("");
  return `specification {
  element softwareSystem
  element person
  element topic
  tag obl-outbox
  tag obl-relay
  tag FEAT-1
}

model {
  customer = person 'Customer'
  checkoutWeb = softwareSystem 'checkout-web' {
    metadata { service 'checkout-web' }
  }
  paymentService = softwareSystem 'payment-service' {
    metadata { service 'payment-service' }
  }
  paymentEvents = topic 'payment-events'

  customer -> checkoutWeb 'Uses'
  checkoutWeb -> paymentService 'Calls authorizePayment' {
${onEdge}    metadata { op 'authorizePayment' }
  }
  paymentService -> paymentEvents 'publishes the authorization'
${extraEdges}}

views {
  view landscape {
    include *
  }
}
`;
}

/** A views-only flow document carrying `tags`, one hop per line of `steps`. */
function flow(tags: readonly string[], steps: readonly string[], id = "uc_relay"): string {
  const carried = tags.map((t) => `    #${t}\n`).join("");
  const hops = steps.map((s) => `    ${s}\n`).join("");
  return `views {\n  dynamic view ${id} {\n${carried}    title 'The authorization reaches the bus'\n${hops}  }\n}\n`;
}

/** A second relationship between checkout-web and payment-service, naming a different operation. */
const REFUND_EDGE = `  checkoutWeb -> paymentService 'Calls refundPayment' {
    metadata { op 'refundPayment' }
  }
`;

/** The call, its reply — one relationship, asked about once — and the publish. */
const RELAY = [
  "checkoutWeb -> paymentService 'authorizes'",
  "checkoutWeb <- paymentService 'authorized'",
  "paymentService -> paymentEvents 'publishes the authorization'",
];

const OUTBOX_YAML = "obligations:\n  outbox:\n    description: Publishers write through a transactional outbox.\n";

function spec(service: string): string {
  return `---\nservice: ${service}\n---\n\n# ${service}\n`;
}

/** A living arch spec whose one requirement covers `covers`. */
function archSpec(covers: string): string {
  return `---
service: payment-service
status: draft
---

# payment-service — architecture

## Requirements

### Requirement: Authorizations leave through the outbox
The service SHALL publish every authorization through a transactional outbox.

Covers: ${covers}

#### Scenario: The broker is down at commit time
- **Given** an authorized payment
- **When** the broker is unreachable
- **Then** the event is published once the broker returns
`;
}

function fleet(extra: Record<string, string>): Record<string, string> {
  return {
    "architecture/landscape.likec4": landscape(),
    "services/checkout-web/spec.md": spec("checkout-web"),
    "services/payment-service/model.likec4": SERVICE_MODEL,
    "services/payment-service/spec.md": spec("payment-service"),
    "services/payment-service/openapi.yaml": LIVING_OPENAPI,
    ...extra,
  };
}

async function project(files: Record<string, string>): Promise<Project> {
  const p = await makeProject(fleet(files), { service: "payment-service" });
  cleanups.push(() => p.destroy());
  return p;
}

function findingsIn(stdout: string): JsonFinding[] {
  const targets: Array<{ findings: JsonFinding[] }> = JSON.parse(stdout).targets ?? [];
  return targets.flatMap((t) => t.findings);
}

async function fleetFindings(p: Project, code: string): Promise<JsonFinding[]> {
  const res = await runLoam(p.workDir, "validate", "--all", "--json");
  return findingsIn(res.stdout).filter((f) => f.code === code);
}

/** Every obligation.* code a run produced, sorted — the shape of the whole verdict. */
async function obligationCodes(p: Project): Promise<string[]> {
  const res = await runLoam(p.workDir, "validate", "--all", "--json");
  return findingsIn(res.stdout)
    .map((f) => f.code)
    .filter((c) => c.startsWith("obligation."))
    .sort();
}

describe("a living flow applies its obligation to every hop it draws", () => {
  it("asks each relationship once — a call and its reply ride one edge — under the team that owes it", async () => {
    const p = await project({
      "architecture/obligations.yaml": OUTBOX_YAML,
      "architecture/usecases/relay.likec4": flow(["obl-outbox"], RELAY),
    });
    const uncovered = await fleetFindings(p, "obligation.uncovered");
    expect(uncovered.map((f) => f.message.split(" carries")[0]).sort()).toEqual([
      "checkoutWeb -> paymentService",
      "paymentService -> paymentEvents",
    ]);
    // The publish edge points at a topic; the team that owes its requirement is
    // the publisher. Filed under the raw target, the row named no team at all.
    expect(uncovered.map((f) => f.subject)).toEqual(["payment-service", "payment-service"]);
    for (const f of uncovered) expect(f.message).toContain("of flow 'uc_relay' (architecture/usecases/relay.likec4) rides it");
    // The flow IS the application: the declaration is cited, so not unapplied.
    expect(await obligationCodes(p)).toEqual(["obligation.uncovered", "obligation.uncovered"]);
  });

  it("goes silent once a living requirement covers every hop", async () => {
    const p = await project({
      "architecture/obligations.yaml": OUTBOX_YAML,
      "architecture/usecases/relay.likec4": flow(["obl-outbox"], RELAY),
      "services/payment-service/arch.spec.md": archSpec("checkoutWeb -> paymentService, paymentService -> paymentEvents"),
    });
    expect(await obligationCodes(p)).toEqual([]);
  });

  it("an edge the map tags AND a flow rides is one finding, read as tagged", async () => {
    const p = await project({
      "architecture/landscape.likec4": landscape(["obl-outbox"]),
      "architecture/obligations.yaml": OUTBOX_YAML,
      "architecture/usecases/relay.likec4": flow(["obl-outbox"], RELAY),
    });
    const uncovered = await fleetFindings(p, "obligation.uncovered");
    expect(uncovered).toHaveLength(2);
    const call = uncovered.find((f) => f.message.startsWith("checkoutWeb -> paymentService"));
    expect(call?.message).not.toContain("rides it");
    // A tagged edge is filed under the service it points into, not under the
    // element id of its target — the map's own tags were the first to get this
    // wrong, as `paymentService`.
    expect(call?.subject).toBe("payment-service");
  });

  it("two flows riding one edge owe one requirement, named by the first flow in file order", async () => {
    const p = await project({
      "architecture/obligations.yaml": OUTBOX_YAML,
      "architecture/usecases/b-refresh.likec4": flow(["obl-outbox"], [RELAY[0]!], "uc_b"),
      "architecture/usecases/a-relay.likec4": flow(["obl-outbox"], [RELAY[0]!], "uc_a"),
    });
    const [call, ...more] = await fleetFindings(p, "obligation.uncovered");
    expect(more).toEqual([]);
    expect(call?.message).toContain("of flow 'uc_a' (architecture/usecases/a-relay.likec4) rides it");
  });

  it("a flow tag nothing declares is obligation.unknown naming the flow, and asks no coverage", async () => {
    const p = await project({
      "architecture/obligations.yaml": OUTBOX_YAML,
      "architecture/usecases/relay.likec4": flow(["obl-relay"], RELAY),
    });
    const [unknown, ...more] = await fleetFindings(p, "obligation.unknown");
    expect(more).toEqual([]);
    expect(unknown?.severity).toBe("error");
    expect(unknown?.details).toEqual(["flow 'uc_relay' (architecture/usecases/relay.likec4)"]);
    // One breach, one finding: nothing asks a team to cover a rule that does
    // not exist. `outbox` is then applied nowhere, which is its own honest warn.
    expect(await obligationCodes(p)).toEqual(["obligation.unapplied", "obligation.unknown"]);
  });
});

describe("the tag opts the view in as a use case", () => {
  it("grades its hops — a hop nothing backs is step-unbacked, and asks no coverage", async () => {
    const p = await project({
      "architecture/obligations.yaml": OUTBOX_YAML,
      "architecture/usecases/relay.likec4": flow(["obl-outbox"], [...RELAY, "checkoutWeb -> paymentEvents 'skips the service'"]),
    });
    const unbacked = await fleetFindings(p, "usecase.step-unbacked");
    expect(unbacked.map((f) => f.subject)).toEqual(["uc_relay"]);
    // Still exactly the two backed relationships: the unbacked hop has no
    // relationship for a `Covers:` line to name.
    expect(await fleetFindings(p, "obligation.uncovered")).toHaveLength(2);
  });

  it("grades the hops even in a fleet with no vocabulary, which hears nothing from the obligation axis", async () => {
    const p = await project({
      "architecture/usecases/relay.likec4": flow(["obl-outbox"], [...RELAY, "checkoutWeb -> paymentEvents 'skips the service'"]),
    });
    expect((await fleetFindings(p, "usecase.step-unbacked")).map((f) => f.subject)).toEqual(["uc_relay"]);
    expect(await obligationCodes(p)).toEqual([]);
  });
});

const FEAT = "FEAT-1";
const FEAT_DIR = "features/FEAT-1-relay";
const INTENT = `---\nfeature: ${FEAT}\nstatus: proposed\n---\n\n# Relay authorizations\n\nAuthorizations reach the bus.\n`;

/** A feature arch delta ADDING one requirement that covers `covers`. */
function archDelta(covers: string): string {
  return `# payment-service — architecture delta for ${FEAT}

## ADDED Requirements

### Requirement: Authorizations leave through the outbox
The service SHALL publish every authorization through a transactional outbox.

Covers: ${covers}

#### Scenario: The broker is down at commit time
- **Given** an authorized payment
- **When** the broker is unreachable
- **Then** the event is published once the broker returns
`;
}

describe("a feature's own flow is graded before the archive", () => {
  it("names each uncovered hop as a warning, with the Covers: line and the delta to write it in", async () => {
    const p = await project({
      "architecture/obligations.yaml": OUTBOX_YAML,
      [`${FEAT_DIR}/intent.md`]: INTENT,
      [`${FEAT_DIR}/usecases/relay.likec4`]: flow(["obl-outbox"], RELAY),
    });
    const res = await runLoam(p.workDir, "validate", "--feature", FEAT, "--json");
    const uncovered = findingsIn(res.stdout).filter((f) => f.code === "obligation.uncovered");
    expect(uncovered.map((f) => f.severity)).toEqual(["warn", "warn"]);
    expect(uncovered.map((f) => f.subject)).toEqual(["payment-service", "payment-service"]);
    expect(uncovered[0]!.locations?.[0]).toEqual({ path: `${FEAT_DIR}/usecases/relay.likec4`, role: "primary" });
    // Spelled by service name where an end is a service — the spelling that
    // survives the archive — and by the map's id for the topic.
    expect(uncovered.map((f) => /`Covers: ([^`]+)`/.exec(f.message)?.[1]).sort()).toEqual([
      "checkout-web -> payment-service",
      "payment-service -> paymentEvents",
    ]);
    expect(uncovered[0]!.message).toContain("this feature's specs/payment-service/arch.spec.md");
    // A warning: it never gates the archive.
    const archived = await runLoam(p.workDir, "archive", FEAT, "--dry-run", "--json");
    expect(archived.code, archived.out).toBe(0);
  });

  it("asks a contested hop once — two relationships between one pair are one Covers: line", async () => {
    // Two edges join checkout-web to payment-service under different
    // operations, so the hop is `usecase.step-contested`. A `Covers:` edge line
    // names endpoints only, and the gate once asked one question per
    // relationship: two identical warnings where `validate --all` gave one.
    const p = await project({
      "architecture/landscape.likec4": landscape([], REFUND_EDGE),
      "architecture/obligations.yaml": OUTBOX_YAML,
      [`${FEAT_DIR}/intent.md`]: INTENT,
      [`${FEAT_DIR}/usecases/relay.likec4`]: flow(["obl-outbox"], ["checkoutWeb -> paymentService 'charges'"]),
    });
    const found = findingsIn((await runLoam(p.workDir, "validate", "--feature", FEAT, "--json")).stdout);
    expect(found.filter((f) => f.code === "usecase.step-contested")).toHaveLength(1);
    expect(found.filter((f) => f.code === "obligation.uncovered")).toHaveLength(1);
  });

  it("counts the Covers: lines the feature's own arch delta ADDS — the same change answers the hop", async () => {
    const p = await project({
      "architecture/obligations.yaml": OUTBOX_YAML,
      [`${FEAT_DIR}/intent.md`]: INTENT,
      [`${FEAT_DIR}/usecases/relay.likec4`]: flow(["obl-outbox"], RELAY),
      [`${FEAT_DIR}/specs/payment-service/arch.spec.md`]: archDelta("checkout-web -> payment-service, payment-service -> paymentEvents"),
    });
    const res = await runLoam(p.workDir, "validate", "--feature", FEAT, "--json");
    expect(findingsIn(res.stdout).filter((f) => f.code.startsWith("obligation."))).toEqual([]);
  });

  it("refuses an undeclared tag at the archive, and --approve may override it", async () => {
    const p = await project({
      "architecture/obligations.yaml": OUTBOX_YAML,
      [`${FEAT_DIR}/intent.md`]: INTENT,
      [`${FEAT_DIR}/usecases/relay.likec4`]: flow(["obl-relay"], RELAY),
    });
    const refused = await runLoam(p.workDir, "archive", FEAT, "--dry-run", "--json");
    expect(refused.code, refused.out).toBe(1);
    const issues: Array<{ code: string; message: string; overridable?: boolean }> = JSON.parse(refused.stdout).issues ?? [];
    const unknown = issues.filter((i) => i.code === "obligation.unknown");
    expect(unknown).toHaveLength(1);
    expect(unknown[0]!.message).toContain(`${FEAT_DIR}/usecases/relay.likec4 — dynamic view 'uc_relay' is tagged #obl-relay`);
    expect(unknown[0]!.overridable).toBe(true);
    expect(issues.filter((i) => i.code === "obligation.uncovered")).toEqual([]);
  });
});

describe("inside a service's own project the tag is refused by placement", () => {
  it("is usecase.obligation-misplaced, and the view's hops are still graded", async () => {
    // The service's own project declares the tag, so the file parses and the
    // refusal is loam's rather than LikeC4's; a second container gives the
    // flow a hop nothing backs, which proves the view is still graded.
    const model = SERVICE_MODEL.replace("  element container\n", "  element container\n  tag obl-outbox\n").replace(
      "    api = container 'api'\n",
      "    api = container 'api'\n    ledger = container 'ledger'\n",
    );
    const p = await project({
      "services/payment-service/model.likec4": model,
      "services/payment-service/usecases/authorize.likec4":
        "views {\n  dynamic view uc_authorize {\n    #obl-outbox\n    paymentService.api -> paymentService.ledger 'writes'\n  }\n}\n",
    });
    const res = await runLoam(p.workDir, "validate", "--service", "payment-service", "--json");
    const found = findingsIn(res.stdout);
    const [misplaced, ...more] = found.filter((f) => f.code === "usecase.obligation-misplaced");
    expect(more).toEqual([]);
    expect(misplaced?.severity).toBe("error");
    expect(misplaced?.subject).toBe("uc_authorize");
    expect(misplaced?.message).toContain("#obl-outbox inside this service's own project");
    expect(misplaced?.locations?.[0]).toEqual({ path: "services/payment-service/usecases/authorize.likec4", role: "primary" });
    expect(found.filter((f) => f.code === "usecase.step-unbacked").map((f) => f.subject)).toEqual(["uc_authorize"]);
    // A code the agent's own baseline run can report is a row in the brief's
    // checks[], filed under the invocation that emits it.
    const row = VALIDATE_CHECKS.find((check) => check.code === "usecase.obligation-misplaced");
    expect(row?.via).toBe("loam validate --service <id>");
    expect(row?.severity).toBe("error");
  });
});
