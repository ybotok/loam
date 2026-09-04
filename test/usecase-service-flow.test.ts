/**
 * The intra-service use case, end to end: a `dynamic view` written BESIDE
 * `services/<…>/<svc>/model.likec4` — the reporter's `views.likec4`, the
 * documented `usecases/<name>.likec4`, or a view inside the model itself —
 * graded by `loam validate --service` and, per service, by `--all`.
 *
 * The report this answers: a requirement whose `Covers:` names containers had
 * no slot for its hop sequence. The documented slot, `architecture/usecases/`,
 * is a separate LikeC4 project that cannot resolve a container (one such file
 * turned a whole fleet `landscape.invalid`), and the workaround — a view beside
 * the model — rendered and was graded by nothing. Every case here is a wrong
 * answer that was reachable on that workaround: an unbacked hop that read as
 * fine in every tool the fleet had, a `#req-` tag nothing resolved, a `#cap-`
 * tag that claimed a fleet promise from inside one service, and a sibling that
 * did not parse and took the renderer's whole project with it in silence.
 *
 * Two corrections in the SHARED graders are pinned here at service altitude
 * and in `test/usecase-checks.test.ts` at fleet altitude, because both scopes
 * run the same code: `attributeStep` no longer lets the service tier back a
 * hop whose two endpoints resolve to ONE service (measured: without that skip
 * every internal relationship was a candidate, so an unbacked intra-service
 * hop graded `attributed` and `usecase.step-unbacked` could never fire on a
 * real model), and `usecase.step-unlinked` no longer fires when the caller
 * resolves to the provider — a service owes no operationId to itself.
 */
import { describe, expect, it } from "vitest";
import { validateService } from "../src/commands/validate/service/service.js";
import { VALIDATE_CHECKS } from "../src/core/brief/checks.js";
import { FleetContext } from "../src/core/fleet-context.js";
import { rawServiceId } from "../src/core/kernel/ids/service.js";
import { LANDSCAPE, LIVING_OPENAPI, LIVING_SPEC, makeProject, runLoam, type Project } from "./helpers/harness.js";

interface JsonFinding {
  severity: string;
  code: string;
  subject?: string;
  message: string;
  details?: string[];
  locations?: Array<{ path: string; role: string }>;
}

interface Payload {
  targets: Array<{ kind: string; id: string; findings: JsonFinding[] }>;
}

function payloadOf(stdout: string): Payload {
  return JSON.parse(stdout) as Payload;
}

function allFindings(stdout: string): JsonFinding[] {
  return payloadOf(stdout).targets.flatMap((t) => t.findings);
}

function useCaseFindings(stdout: string): JsonFinding[] {
  return allFindings(stdout).filter((f) => f.code.startsWith("usecase."));
}

function codeFor(stdout: string, code: string): JsonFinding[] {
  return allFindings(stdout).filter((f) => f.code === code);
}

const SVC = "payment-service";
const DIR = `services/${SVC}`;

/**
 * The service's model: one bound system drawn as three containers with two
 * internal edges. Every tag a view below carries is declared here, because a
 * service project has exactly ONE `specification` block — the model's — and
 * LikeC4 refuses an undeclared tag.
 *
 * `api -> ledger` is deliberately NOT declared. It is the hop this whole axis
 * exists to convict: both containers exist, `workflow -> ledger` exists, and
 * before the tier-2 skip that internal edge was a candidate for a hop it does
 * not back, so the hop graded `attributed` and no finding could ever fire.
 */
const MODEL = `specification {
  element softwareSystem
  element container
  tag req-PAY-AUTH
  tag req-PAY-NOPE
  tag cap-checkout
}

model {
  paymentService = softwareSystem 'payment-service' {
    description 'Owns payment authorization/capture'
    metadata { service 'payment-service' }
    api = container 'api'
    workflow = container 'workflow'
    ledger = container 'ledger'
  }
  paymentService.api -> paymentService.workflow 'delegates'
  paymentService.workflow -> paymentService.ledger 'writes'
}

views {
  view of paymentService {
    include *
  }
}
`;

/** The backed hop sequence — every step is a declared edge. */
const BACKED = "    paymentService.api -> paymentService.workflow 'delegates'\n    paymentService.workflow -> paymentService.ledger 'records'\n";
/** The same sequence plus the hop nothing declares. */
const UNBACKED = `${BACKED}    paymentService.api -> paymentService.ledger 'skips the workflow'\n`;

/** A views-only document holding one dynamic view carrying `tags`, in order. */
function flow(id: string, tags: readonly string[], steps: string): string {
  const carried = tags.map((t) => `    #${t}\n`).join("");
  return `views {\n  dynamic view ${id} {\n${carried}    title 'Authorize a payment'\n${steps}  }\n}\n`;
}

/** A living spec whose requirement carries a `Requirement-ID` — the join a service-local `#req-` resolves against. */
function specWithId(id: string): string {
  return LIVING_SPEC.replace("### Requirement: Authorize a payment\n", `### Requirement: Authorize a payment\nRequirement-ID: ${id}\n`);
}

/** An architecture spec with one identified requirement whose `Covers:` names `covers`. */
function archSpec(id: string, covers: string): string {
  return `---
service: ${SVC}
status: draft
---

# ${SVC} — architecture

## Requirements

### Requirement: The ledger is written once
Requirement-ID: ${id}
The service SHALL write the ledger exactly once per authorization.

Covers: ${covers}

#### Scenario: One write
- **Given** an authorization
- **When** it is recorded
- **Then** the ledger holds one row
`;
}

/**
 * The docs repo: the harness landscape (which already draws payment-service),
 * the service with its model, spec, contract and arch spec, and whatever the
 * case under test writes beside the model.
 */
async function project(extra: Record<string, string>, overrides: Record<string, string> = {}): Promise<Project> {
  return makeProject({
    "architecture/landscape.likec4": LANDSCAPE,
    [`${DIR}/model.likec4`]: MODEL,
    [`${DIR}/spec.md`]: specWithId("PAY-AUTH"),
    [`${DIR}/openapi.yaml`]: LIVING_OPENAPI,
    [`${DIR}/arch.spec.md`]: archSpec("PAY-OUTBOX", "paymentService.ledger"),
    ...overrides,
    ...extra,
  });
}

describe("a #req- flow beside model.likec4 is graded by the service target", () => {
  it("stays silent when every hop is backed, keeps c4.valid on the single-file model, and never grades it on the landscape", async () => {
    const p = await project({ [`${DIR}/views.likec4`]: flow("uc_authorize", ["req-PAY-AUTH"], BACKED) });
    try {
      const single = await runLoam(p.workDir, "validate", "--service", SVC, "--json");
      // Both hops are between two containers of ONE service and both are
      // declared edges carrying no `op`. Before the fourth guard each of them
      // was a `usecase.step-unlinked` — loam demanding an operationId of a
      // service for a call it makes to itself.
      expect(useCaseFindings(single.stdout)).toEqual([]);
      // The model facts come from model.likec4 ALONE, not from the project the
      // flow was read through: the same counts a run with no sibling reports.
      const [valid] = codeFor(single.stdout, "c4.valid");
      expect(valid?.message).toContain("(4 elements · 2 relationships)");

      const all = await runLoam(p.workDir, "validate", "--all", "--json");
      expect(useCaseFindings(all.stdout)).toEqual([]);
      const landscape = payloadOf(all.stdout).targets.find((t) => t.kind === "landscape");
      expect(landscape?.findings.filter((f) => f.code.startsWith("usecase."))).toEqual([]);
    } finally {
      await p.destroy();
    }
  }, 90_000);

  it("convicts the hop no relationship backs, naming the service, the file and the step — never the landscape", async () => {
    const p = await project({ [`${DIR}/views.likec4`]: flow("uc_authorize", ["req-PAY-AUTH"], UNBACKED) });
    try {
      const res = await runLoam(p.workDir, "validate", "--service", SVC, "--json");
      const [unbacked, ...rest] = codeFor(res.stdout, "usecase.step-unbacked");
      expect(rest).toEqual([]);
      expect(unbacked?.severity).toBe("error");
      expect(unbacked?.subject).toBe("uc_authorize");
      expect(unbacked?.message).toContain(
        `${SVC}: ${DIR}/views.likec4 — dynamic view 'uc_authorize' step 3 'skips the workflow'`,
      );
      expect(unbacked?.message).toContain("nothing in the model declares paymentService.api -> paymentService.ledger");
      // The `landscape:` opening is the FLEET target's name; a finding filed on
      // a service target must not claim it.
      expect(unbacked?.message).not.toContain("landscape:");
      expect(unbacked?.message).not.toContain("architecture/");
      // The two backed hops earn nothing: a service owes no operationId to itself.
      expect(codeFor(res.stdout, "usecase.step-unlinked")).toEqual([]);
      expect(useCaseFindings(res.stdout)).toHaveLength(1);

      // Per service under `--all`: the same finding, on the service target.
      const all = await runLoam(p.workDir, "validate", "--all", "--json");
      const service = payloadOf(all.stdout).targets.find((t) => t.kind === "service" && t.id === SVC);
      expect(service?.findings.filter((f) => f.code === "usecase.step-unbacked")).toHaveLength(1);
      expect(useCaseFindings(all.stdout)).toHaveLength(1);
    } finally {
      await p.destroy();
    }
  }, 90_000);

  it("names the FILE holding the flow in `locations`, with the service directory beside it as scope", async () => {
    // `--json` exists so an agent need not parse prose. Every service-arm flow
    // code carried the service DIRECTORY alone, so the one thing the reader
    // needs — which `.likec4` to open — was only in the message text, on the
    // very axis the report asked for (verification 2026-09-04). `flow-invalid`
    // on this arm already named its file; these say it the same way.
    const p = await project({
      [`${DIR}/usecases/authorize.likec4`]: flow("uc_authorize", ["req-PAY-AUTH", "cap-checkout"], UNBACKED),
    });
    try {
      const res = await runLoam(p.workDir, "validate", "--service", SVC, "--json");
      const graded = useCaseFindings(res.stdout);
      expect(graded.length).toBeGreaterThan(0);
      for (const finding of graded) {
        expect(finding.locations).toEqual([
          { path: `${DIR}/usecases/authorize.likec4`, role: "primary" },
          { path: DIR, role: "scope" },
        ]);
      }
      // The two codes this fixture raises, so the pin is not vacuous.
      expect(graded.map((f) => f.code).sort()).toEqual(["usecase.capability-unresolved", "usecase.step-unbacked"]);
    } finally {
      await p.destroy();
    }
  }, 60_000);

  it("reads usecases/<name>.likec4 — the documented convention — exactly as it reads views.likec4", async () => {
    const p = await project({ [`${DIR}/usecases/authorize.likec4`]: flow("uc_authorize", ["req-PAY-AUTH"], UNBACKED) });
    try {
      const res = await runLoam(p.workDir, "validate", "--service", SVC, "--json");
      const [unbacked] = codeFor(res.stdout, "usecase.step-unbacked");
      expect(unbacked?.message).toContain(`${SVC}: ${DIR}/usecases/authorize.likec4 — dynamic view 'uc_authorize' step 3`);
      expect(useCaseFindings(res.stdout)).toHaveLength(1);
    } finally {
      await p.destroy();
    }
  }, 60_000);

  it("still contests a hop two internal edges back with different operations", async () => {
    // Two declared `workflow -> ledger` edges, one naming an op and one naming
    // none: the exact tier finds both and they disagree. WARN, listing the
    // candidates — and the contested verdict is what keeps `step-unlinked` off
    // the same hop, exactly as it does at fleet altitude.
    const model = MODEL.replace(
      "  paymentService.workflow -> paymentService.ledger 'writes'\n",
      "  paymentService.workflow -> paymentService.ledger 'writes' {\n    metadata { op 'writeLedger' }\n  }\n  paymentService.workflow -> paymentService.ledger 'audits'\n",
    );
    const p = await project({ [`${DIR}/views.likec4`]: flow("uc_authorize", ["req-PAY-AUTH"], BACKED) }, { [`${DIR}/model.likec4`]: model });
    try {
      const res = await runLoam(p.workDir, "validate", "--service", SVC, "--json");
      const [contested] = codeFor(res.stdout, "usecase.step-contested");
      expect(contested?.severity).toBe("warn");
      expect(contested?.message).toContain(`${SVC}: ${DIR}/views.likec4 — dynamic view 'uc_authorize' step 2 'records'`);
      expect(contested?.details).toEqual([
        'paymentService.workflow -> paymentService.ledger "writes" (op: writeLedger)',
        'paymentService.workflow -> paymentService.ledger "audits" (no op)',
      ]);
      expect(useCaseFindings(res.stdout)).toHaveLength(1);
    } finally {
      await p.destroy();
    }
  }, 60_000);

  it("still warns usecase.step-unlinked on a hop into a stand-in for ANOTHER service — the guard is the caller resolving to the provider, nothing wider", async () => {
    // The model declares the sibling it calls, titled as that service's
    // directory is named, and the edge carries no `op`. The fourth guard
    // refuses only a hop whose caller and provider resolve to ONE service;
    // this hop crosses the boundary, so it warns exactly as it would on the
    // fleet map — which is why the brief's checks[] lists the code for the
    // service target rather than claiming it cannot fire there.
    const model = MODEL.replace(
      "  paymentService.api -> paymentService.workflow 'delegates'\n",
      "  checkoutWeb = softwareSystem 'checkout-web'\n" +
        "  paymentService.api -> paymentService.workflow 'delegates'\n" +
        "  paymentService.api -> checkoutWeb 'confirms the order'\n",
    );
    const p = await project(
      { [`${DIR}/views.likec4`]: flow("uc_authorize", ["req-PAY-AUTH"], `${BACKED}    paymentService.api -> checkoutWeb 'confirms the order'\n`) },
      {
        [`${DIR}/model.likec4`]: model,
        // Enumerated, so the stand-in resolves to a real services/<id>/ — the
        // provider guard's own condition.
        "services/checkout-web/spec.md": "---\nservice: checkout-web\n---\n\n# checkout-web\n",
      },
    );
    try {
      const res = await runLoam(p.workDir, "validate", "--service", SVC, "--json");
      const [unlinked, ...rest] = codeFor(res.stdout, "usecase.step-unlinked");
      expect(rest).toEqual([]);
      expect(unlinked?.severity).toBe("warn");
      expect(unlinked?.subject).toBe("uc_authorize");
      expect(unlinked?.message).toContain(
        `${SVC}: ${DIR}/views.likec4 — dynamic view 'uc_authorize' step 3 'confirms the order'`,
      );
      expect(unlinked?.message).toContain("names no operation of checkout-web's contract");
      expect(unlinked?.message).not.toContain("landscape:");
      // The two intra-service hops before it stay silent: one finding, on the
      // boundary crossing alone.
      expect(useCaseFindings(res.stdout)).toHaveLength(1);
      // And the brief explains it: a code the agent's own baseline run can
      // report is a row in checks[], filed under the invocation that emits it.
      const row = VALIDATE_CHECKS.find((check) => check.code === "usecase.step-unlinked");
      expect(row?.via).toBe("loam validate --service <id>");
      expect(row?.severity).toBe("warn");
    } finally {
      await p.destroy();
    }
  }, 60_000);
});

describe("the #req- tag resolves against THIS service's own Requirement-IDs", () => {
  it("offers the service's close ids, names an empty and an absent document, and refuses two ids that flatten alike", async () => {
    const p = await project({ [`${DIR}/views.likec4`]: flow("uc_authorize", ["req-PAY-NOPE"], BACKED) });
    try {
      // `none`: spec.md declares PAY-AUTH and arch.spec.md PAY-OUTBOX; the tag
      // names neither, and the close ids are spelled as the TAG to write.
      const none = await runLoam(p.workDir, "validate", "--service", SVC, "--json");
      const [unresolved, ...rest] = codeFor(none.stdout, "usecase.requirement-unresolved");
      expect(rest).toEqual([]);
      expect(unresolved?.severity).toBe("error");
      expect(unresolved?.subject).toBe("uc_authorize");
      expect(unresolved?.message).toContain(`${SVC}: ${DIR}/views.likec4 — dynamic view 'uc_authorize' is tagged #req-PAY-NOPE`);
      expect(unresolved?.message).toContain(`no requirement of ${SVC} (spec.md or arch.spec.md) flattens to 'PAY-NOPE'`);
      expect(unresolved?.message).toContain("PAY-AUTH (#req-PAY-AUTH)");
      // The capability vocabulary is not this join's scope: no `unscoped` arm,
      // no mention of a `#cap-` tag the flow is "missing".
      expect(unresolved?.message).not.toContain("#cap-");
      expect(codeFor(none.stdout, "usecase.capability-unresolved")).toEqual([]);

      // `empty`: both documents exist and neither carries a Requirement-ID.
      await p.write(`${DIR}/spec.md`, LIVING_SPEC);
      await p.write(`${DIR}/arch.spec.md`, archSpec("PAY-OUTBOX", "paymentService.ledger").replace("Requirement-ID: PAY-OUTBOX\n", ""));
      const empty = await runLoam(p.workDir, "validate", "--service", SVC, "--json");
      expect(codeFor(empty.stdout, "usecase.requirement-unresolved")[0]?.message).toContain(
        "declare no `Requirement-ID:` at all",
      );

      // `many`: one id per document, flattening to one slug — a Requirement-ID
      // is unique inside ONE document and this service has two.
      await p.write(`${DIR}/spec.md`, specWithId("PAY-NOPE"));
      await p.write(`${DIR}/arch.spec.md`, archSpec("PAY.NOPE", "paymentService.ledger"));
      const many = await runLoam(p.workDir, "validate", "--service", SVC, "--json");
      expect(codeFor(many.stdout, "usecase.requirement-unresolved")[0]?.message).toContain(
        `2 requirements of ${SVC} flatten to 'PAY-NOPE' (PAY-NOPE, PAY.NOPE)`,
      );

      // `resolved`: the same tag, one document naming it — no finding.
      await p.write(`${DIR}/arch.spec.md`, archSpec("PAY-OUTBOX", "paymentService.ledger"));
      const resolved = await runLoam(p.workDir, "validate", "--service", SVC, "--json");
      expect(useCaseFindings(resolved.stdout)).toEqual([]);
    } finally {
      await p.destroy();
    }
  }, 120_000);

  it("names the absence of both documents rather than guessing a scope", async () => {
    // `undocumented`: neither spec.md nor arch.spec.md exists. A service with
    // no requirement document carries no promise a flow could keep, and the
    // sentence says to write the requirement first.
    const p = await makeProject({
      "architecture/landscape.likec4": LANDSCAPE,
      [`${DIR}/model.likec4`]: MODEL,
      [`${DIR}/views.likec4`]: flow("uc_authorize", ["req-PAY-AUTH"], BACKED),
    });
    try {
      const res = await runLoam(p.workDir, "validate", "--service", SVC, "--json");
      const [unresolved] = codeFor(res.stdout, "usecase.requirement-unresolved");
      expect(unresolved?.message).toContain(`${DIR}/ has no spec.md and no arch.spec.md`);
      expect(useCaseFindings(res.stdout)).toHaveLength(1);
    } finally {
      await p.destroy();
    }
  }, 60_000);
});

describe("a #cap- tag beside a model is refused by placement", () => {
  it("earns usecase.capability-unresolved without any capabilities.yaml, and the view's steps are still graded", async () => {
    const p = await project({ [`${DIR}/views.likec4`]: flow("uc_authorize", ["cap-checkout", "req-PAY-AUTH"], UNBACKED) });
    try {
      const res = await runLoam(p.workDir, "validate", "--service", SVC, "--json");
      const [refused, ...rest] = codeFor(res.stdout, "usecase.capability-unresolved");
      expect(rest).toEqual([]);
      expect(refused?.severity).toBe("error");
      expect(refused?.subject).toBe("uc_authorize");
      expect(refused?.message).toContain("is tagged #cap-checkout inside this service's own project, where no capability can be claimed");
      expect(refused?.message).toContain("Drop the tag");
      // Placement, not vocabulary: the fleet's ladder (silent while the file is
      // absent) does not apply, so the finding fires with no capabilities.yaml.
      expect(p.exists("architecture/capabilities.yaml")).toBe(false);
      // The tag still opts the view in — the `#req-` resolves and the unbacked
      // hop is convicted beside the refusal.
      expect(codeFor(res.stdout, "usecase.step-unbacked")).toHaveLength(1);
      expect(codeFor(res.stdout, "usecase.requirement-unresolved")).toEqual([]);
    } finally {
      await p.destroy();
    }
  }, 60_000);
});

describe("a sibling that does not parse", () => {
  it("earns usecase.flow-invalid naming the file, while model.likec4 keeps grading alone (c4.valid, Covers:)", async () => {
    // A tagged view whose step names a container the model never declares —
    // the renderer refuses the whole service project over it.
    const broken = flow("uc_authorize", ["req-PAY-AUTH"], "    paymentService.api -> paymentService.ghost 'talks to nothing'\n");
    const p = await project(
      { [`${DIR}/views.likec4`]: broken },
      // A `Covers:` entry that resolves to nothing, so the arch axis provably
      // ran from the single-file model rather than from the broken project.
      { [`${DIR}/arch.spec.md`]: archSpec("PAY-OUTBOX", "paymentService.nowhere") },
    );
    try {
      const res = await runLoam(p.workDir, "validate", "--service", SVC, "--json");
      const [invalid, ...rest] = codeFor(res.stdout, "usecase.flow-invalid");
      expect(rest).toEqual([]);
      expect(invalid?.severity).toBe("error");
      expect(invalid?.subject).toBe(SVC);
      expect(invalid?.message).toContain(`${SVC}: ${DIR}/views.likec4 has `);
      expect(invalid?.message).toContain("no flow in it was graded");
      expect(invalid?.locations).toEqual([{ path: `${DIR}/views.likec4`, role: "primary" }]);
      // One evidence line per error, each prefixed by its repo-relative file.
      expect(invalid?.details?.length).toBeGreaterThan(0);
      for (const line of invalid?.details ?? []) expect(line.startsWith(`${DIR}/views.likec4: `)).toBe(true);

      // NEVER c4.invalid: the model parses, and every model check ran.
      expect(codeFor(res.stdout, "c4.invalid")).toEqual([]);
      expect(codeFor(res.stdout, "c4.valid")[0]?.message).toContain("(4 elements · 2 relationships)");
      expect(codeFor(res.stdout, "covers.unknown")).toHaveLength(1);
      // The flows were not graded: no step or tag finding beside the refusal.
      expect(useCaseFindings(res.stdout)).toHaveLength(1);
    } finally {
      await p.destroy();
    }
  }, 60_000);

  it("is never read while untagged — an untagged sibling with a parse error produces NO finding", async () => {
    // The opt-in is the tag, exactly as it is for a fleet view: an untagged
    // sibling is somebody's hand-drawn diagram, and its parse errors are the
    // renderer's business until a view opts the project in. The gate is
    // exact: no view in model.likec4 opts in, and this sibling mentions
    // neither reserved prefix anywhere in its bytes, so it is not even loaded.
    // The case below is the other side of that gate.
    const p = await project({ [`${DIR}/views.likec4`]: flow("uc_sketch", [], "    paymentService.api -> paymentService.ghost 'talks to nothing'\n") });
    try {
      const res = await runLoam(p.workDir, "validate", "--service", SVC, "--json");
      expect(useCaseFindings(res.stdout)).toEqual([]);
      expect(codeFor(res.stdout, "c4.invalid")).toEqual([]);
      expect(codeFor(res.stdout, "c4.valid")).toHaveLength(1);
    } finally {
      await p.destroy();
    }
  }, 60_000);

  it("stages every sibling once a view inside model.likec4 itself opts in — an untagged broken sibling is then usecase.flow-invalid", async () => {
    // The byte gate is skipped when the model's own views opt in: the project
    // is loaded whole, the way the renderer reads it, and a project that does
    // not read is one flow-invalid whether or not the broken sibling carries a
    // tag — nothing in it, the model's tagged view included, is graded. This
    // is the documented behaviour, pinned so the sentence and the gate cannot
    // drift apart again.
    const inline = MODEL.replace(
      "views {\n",
      `views {\n  dynamic view uc_inline {\n    #req-PAY-AUTH\n    title 'Authorize inline'\n${UNBACKED}  }\n`,
    );
    const p = await project(
      { [`${DIR}/views.likec4`]: flow("uc_sketch", [], "    paymentService.api -> paymentService.ghost 'talks to nothing'\n") },
      { [`${DIR}/model.likec4`]: inline },
    );
    try {
      const res = await runLoam(p.workDir, "validate", "--service", SVC, "--json");
      const [invalid, ...rest] = codeFor(res.stdout, "usecase.flow-invalid");
      expect(rest).toEqual([]);
      expect(invalid?.locations).toEqual([{ path: `${DIR}/views.likec4`, role: "primary" }]);
      // The model's own tagged view was not graded either — its unbacked hop
      // earns nothing beside the refusal — and the model is never c4.invalid.
      expect(codeFor(res.stdout, "usecase.step-unbacked")).toEqual([]);
      expect(codeFor(res.stdout, "c4.invalid")).toEqual([]);
      expect(useCaseFindings(res.stdout)).toHaveLength(1);
    } finally {
      await p.destroy();
    }
  }, 60_000);

  it("adds nothing when model.likec4 itself does not parse — c4.invalid owns that, with no cascade", async () => {
    const p = await project(
      { [`${DIR}/views.likec4`]: flow("uc_authorize", ["req-PAY-AUTH"], BACKED) },
      { [`${DIR}/model.likec4`]: MODEL.replace("element container\n", "") },
    );
    try {
      const res = await runLoam(p.workDir, "validate", "--service", SVC, "--json");
      expect(codeFor(res.stdout, "c4.invalid")).toHaveLength(1);
      expect(useCaseFindings(res.stdout)).toEqual([]);
    } finally {
      await p.destroy();
    }
  }, 60_000);
});

describe("the model's own views, and the cost of a fleet without the axis", () => {
  it("grades a tagged dynamic view inside model.likec4 with no sibling, spelled model.likec4", async () => {
    const inline = MODEL.replace(
      "views {\n",
      `views {\n  dynamic view uc_inline {\n    #req-PAY-AUTH\n    title 'Authorize inline'\n${UNBACKED}  }\n`,
    );
    const p = await project({}, { [`${DIR}/model.likec4`]: inline });
    try {
      const res = await runLoam(p.workDir, "validate", "--service", SVC, "--json");
      const [unbacked] = codeFor(res.stdout, "usecase.step-unbacked");
      // The single-file loader names every document `source.c4`; the file is
      // spelled where it is known, and it is the model.
      expect(unbacked?.message).toContain(`${SVC}: ${DIR}/model.likec4 — dynamic view 'uc_inline' step 3`);
      expect(unbacked?.message).not.toContain("source.c4");
      expect(useCaseFindings(res.stdout)).toHaveLength(1);
    } finally {
      await p.destroy();
    }
  }, 60_000);

  it("costs a service with no sibling no LikeC4 load beyond the one it already paid", async () => {
    // The gate is one recursive readdir. With no sibling the model's own views
    // are graded off the load already in hand, so the counters stay at exactly
    // what a service target costs: ONE document parsed alone — this fixture's
    // model declares its own `specification`, so it stands alone — and no
    // per-service project, because a standalone model is never staged beside
    // the map. The fleet map itself is read as the `architecture/` PROJECT in
    // every mode now (it used to be `landscape.likec4` parsed alone, which is
    // why this counter used to read 2), memoised for the whole invocation.
    const p = await project({});
    try {
      const fleet = new FleetContext();
      await validateService({ docsDir: p.docsDir, service: rawServiceId(SVC), fleet });
      expect(fleet.stats().likec4Loads).toBe(1);
      expect(fleet.stats().projectLoads).toBe(0);
    } finally {
      await p.destroy();
    }
  }, 60_000);
});

/**
 * The two things `usecase.flow-invalid` could not say, measured on the tree
 * (verification 2026-09-04, D10).
 *
 * An undeclared reserved tag is a bare `Could not resolve reference to Tag
 * named …` — the author wrote the tag the protocol told them to write, and
 * nothing said a tag has to be declared before it can be carried.
 *
 * And a sibling the SERVICE'S OWN `likec4.config.json` excludes is in no
 * project the renderer loads, while loam staged it anyway: a finding about a
 * file nobody will ever open, under a message claiming the project is read the
 * way the renderer reads it.
 */
describe("what a broken service project says", () => {
  it("names the declaration an undeclared #req- tag is missing", async () => {
    // Every other tag in MODEL is declared; this one is not, which is the only
    // fault in the project.
    const p = await project({ [`${DIR}/views.likec4`]: flow("uc_authorize", ["req-PAY-GHOST"], BACKED) });
    try {
      const res = await runLoam(p.workDir, "validate", "--service", SVC, "--json");
      const [invalid, ...rest] = codeFor(res.stdout, "usecase.flow-invalid");
      expect(rest).toEqual([]);
      expect(invalid?.details?.some((line) => line.includes("Could not resolve reference to Tag"))).toBe(true);
      const hint = invalid?.details?.find((line) => line.startsWith("declare `tag "));
      expect(hint).toContain("declare `tag req-PAY-GHOST` in the `specification { }` block this project reads");
    } finally {
      await p.destroy();
    }
  }, 60_000);

  it("sends an undeclared #cap- tag to the placement rule, not to a declaration that cannot help", async () => {
    // Declaring `tag cap-…` here makes the file parse and earns
    // `usecase.capability-unresolved` on the very next run ("no capability can
    // be claimed … Drop the tag") — two steps where the answer is one, because
    // a capability is claimed at fleet altitude and this project is one
    // service's (verification 2026-09-04).
    const p = await project({ [`${DIR}/views.likec4`]: flow("uc_authorize", ["cap-ghost"], BACKED) });
    try {
      const res = await runLoam(p.workDir, "validate", "--service", SVC, "--json");
      const [invalid, ...rest] = codeFor(res.stdout, "usecase.flow-invalid");
      expect(rest).toEqual([]);
      const hint = invalid?.details?.[0];
      expect(hint).toContain("`#cap-ghost` claims a capability");
      expect(hint).toContain("FLEET altitude");
      expect(hint).toContain("usecase.capability-unresolved");
      // Never the declaration advice: declaring it is the step that does not help.
      expect(hint).not.toContain("declare `tag cap-ghost`");
    } finally {
      await p.destroy();
    }
  }, 60_000);

  it("does not grade a sibling the service's own likec4.config.json excludes", async () => {
    // Measured at the 1.59.2 pin: with this entry the renderer loads
    // model.likec4 alone (`found 1 source files`, valid), so nothing about
    // views.likec4 is a fact about any project.
    const broken = flow("uc_authorize", ["req-PAY-AUTH"], "    paymentService.api -> paymentService.ghost 'talks to nothing'\n");
    const p = await project({
      [`${DIR}/views.likec4`]: broken,
      [`${DIR}/likec4.config.json`]: `{\n  "name": "${SVC}",\n  "title": "${SVC}",\n  "exclude": ["views.likec4"]\n}\n`,
    });
    try {
      const res = await runLoam(p.workDir, "validate", "--service", SVC, "--json");
      expect(useCaseFindings(res.stdout)).toEqual([]);
      expect(codeFor(res.stdout, "c4.valid")).toHaveLength(1);

      // The control, and it is what keeps the silence honest: an entry that
      // covers nothing leaves the file in the project, where it is graded.
      await p.write(`${DIR}/likec4.config.json`, `{\n  "name": "${SVC}",\n  "exclude": ["other.likec4"]\n}\n`);
      const kept = await runLoam(p.workDir, "validate", "--service", SVC, "--json");
      expect(codeFor(kept.stdout, "usecase.flow-invalid")).toHaveLength(1);
    } finally {
      await p.destroy();
    }
  }, 60_000);

  // Catches: the leading `**/`, which the first matcher compiled to a REQUIRED
  // `/` — so every entry written in the recursive spelling matched nothing and
  // loam gated the run (exit 1) on a file in no project it was reading
  // (verification 2026-09-04). Measured at the 1.59.2 pin on a service directory
  // holding model.likec4, views.likec4 and usecases/flow.likec4, by
  // `npx likec4 validate <dir>` counting "found N source files":
  //   `**/usecases/**`  → 2      `**/views.likec4` → 2      `**/*.likec4` → 0
  it.each([
    ["**/usecases/**", "usecases/flow.likec4"],
    ["**/*.likec4", "usecases/flow.likec4"],
    ["**/views.likec4", "views.likec4"],
  ])("does not grade a sibling a recursive entry (%s) excludes", async (entry, where) => {
    const broken = flow("uc_authorize", ["req-PAY-AUTH"], "    paymentService.api -> paymentService.ghost 'talks to nothing'\n");
    const p = await project({
      [`${DIR}/${where}`]: broken,
      [`${DIR}/likec4.config.json`]: `{\n  "name": "${SVC}",\n  "exclude": ["${entry}"]\n}\n`,
    });
    try {
      const res = await runLoam(p.workDir, "validate", "--service", SVC, "--json");
      expect(useCaseFindings(res.stdout)).toEqual([]);
      expect(res.code).toBe(0);
    } finally {
      await p.destroy();
    }
  }, 60_000);
});
