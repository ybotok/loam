/**
 * A feature can carry a SERVICE-LOCAL use case —
 * `features/<FEAT>/specs/<svc>/usecases/<name>.likec4`, end to end.
 *
 * A flow beside a service's model (a `dynamic view` over its containers, tagged
 * `#req-` with one of its requirements) could exist only in the living tree. A
 * feature changing or creating that service carried every other document about
 * it — and a `.likec4` at this very path was read by nothing: `validate
 * --feature` unchanged, `status` ready, the archive silent, the file left behind
 * in `features/archive/`. The redrawn flow of a MODIFIED requirement had to be
 * hand-copied at archive time, ungraded until then.
 *
 * What each block pins, and the wrong implementation it fails against:
 *
 * IT IS GRADED against the project the archive leaves — the service's model
 * with the delta's interior routed in, or the model the archive CREATES — by
 * the grader `validate --service` runs, with the requirement ids the merge
 * leaves (living + ADDED/MODIFIED − REMOVED). Graded against the living model a
 * hop into a routed container is unresolved; graded by nothing, a broken hop
 * archives clean.
 *
 * IT SHIPS AND UNSHIPS: created, replaced or retired by the archive, and put
 * back byte for byte by `unarchive` — a retirement included, which the snapshot
 * used to read back as a file edited since.
 *
 * REPLACING OR RETIRING IS GATED on a promise the feature redraws: the living
 * twin must claim a requirement this feature MODIFIES or REMOVES, or it is
 * `usecase.flow-exists`; a retirement of nothing is `usecase.flow-unknown`.
 * Neither moves under `--approve`.
 *
 * A TAG THE FEATURE ADDS is declared by the flow document itself, and a second
 * declaration is the duplicate the post-merge parse refuses.
 */
import { afterEach, describe, expect, it } from "vitest";
import { documentKind } from "../src/core/usecases/delta/service/slot.js";
import { makeProject, pinFor, runLoam, treeHashes, type Project } from "./helpers/harness.js";

const FEAT = "FEAT-1";
const FEAT_DIR = "features/FEAT-1-refunds";
const SLOT = `${FEAT_DIR}/specs/order-service/usecases`;

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!();
});

/** The map: order-service extends it, payment-service stands alone. No tag a service flow uses is declared here. */
const LANDSCAPE = `specification {
  element softwareSystem
  element container
  tag FEAT-1
}

model {
  orderService = softwareSystem 'order-service' {
    metadata { service 'order-service' }
  }
  paymentService = softwareSystem 'payment-service' {
    metadata { service 'payment-service' }
  }

  orderService -> paymentService 'Authorizes payments'
}

views {
  view landscape {
    include *
  }
}
`;

/** order-service's EXTENDING model: its interior inside the map's element. */
const ORDER_MODEL = `model {
  extend orderService {
    api = container 'api'
    domain = container 'domain'
    api -> domain 'places and cancels'
  }
}
`;

const ORDER_SPEC = `---
service: order-service
---

# order-service

## Requirements

### Requirement: Place an order
Requirement-ID: ORD-PLACE
The service SHALL accept an order.

#### Scenario: Placed
- **Given** a basket
- **When** it is ordered
- **Then** an order exists

### Requirement: Cancel an order
Requirement-ID: ORD-CANCEL
The service SHALL let an order be cancelled before fulfilment.

#### Scenario: Cancelled
- **Given** an order
- **When** it is cancelled
- **Then** it is cancelled
`;

/** A service-local flow document. `declares` is the tags-only specification it carries, if any. */
function flow(view: string, tag: string, steps: string[], declares?: string): string {
  const spec = declares === undefined ? "" : `specification {\n  tag ${declares}\n}\n\n`;
  return `${spec}views {\n  dynamic view ${view} {\n    #${tag}\n${steps.map((s) => `    ${s}\n`).join("")}  }\n}\n`;
}

/** The living flow behind ORD-CANCEL — it declares its own tag, as SCHEMA allows beside an extending model. */
const LIVING_CANCEL = flow("uc_cancel", "req-ORD-CANCEL", ["orderService.api -> orderService.domain 'cancels the order'"], "req-ORD-CANCEL");

/** The delta: a `refunds` container routed into order-service's model, and a new refund-service with an interior of its own. */
const DELTA = `specification {
  element softwareSystem
  element container
  tag FEAT-1
}

model {
  orderService = softwareSystem 'order-service' {
    domain = container 'domain'
    refunds = container 'refunds' {
      #FEAT-1
    }
    domain -> refunds 'hands the refund over' {
      #FEAT-1
    }
  }

  refundService = softwareSystem 'refund-service' {
    #FEAT-1
    metadata { service 'refund-service' }
    api = container 'api'
    ledger = container 'ledger'
  }

  orderService -> refundService 'Records refunds' {
    #FEAT-1
  }
  refundService.api -> refundService.ledger 'records the refund' {
    #FEAT-1
  }
}
`;

/** order-service's delta: ORD-CANCEL MODIFIED (pinned as `loam rebase` pins it), ORD-REFUND ADDED. */
const ORDER_DELTA = `# order-service — delta for ${FEAT}

## MODIFIED Requirements

### Requirement: Cancel an order
Requirement-ID: ORD-CANCEL
Based-On: ${pinFor(ORDER_SPEC, "Cancel an order")}
The service SHALL let an order be cancelled before fulfilment and hand its refund over.

#### Scenario: Cancelled
- **Given** an order
- **When** it is cancelled
- **Then** its refund is handed over

## ADDED Requirements

### Requirement: Track a refund
Requirement-ID: ORD-REFUND
The service SHALL track each refund it hands over.

#### Scenario: Tracked
- **Given** a handed-over refund
- **When** it is read
- **Then** its state is known
`;

const REFUND_DELTA = `# refund-service — delta for ${FEAT}

## ADDED Requirements

### Requirement: Record a refund
Requirement-ID: RFD-RECORD
The service SHALL record each refund once.

#### Scenario: Recorded
- **Given** a refund
- **When** it arrives
- **Then** it is recorded once
`;

/** The redrawn ORD-CANCEL flow: its new hop is into the container the delta routes in. */
const REDRAWN_CANCEL = flow(
  "uc_cancel",
  "req-ORD-CANCEL",
  ["orderService.api -> orderService.domain 'cancels the order'", "orderService.domain -> orderService.refunds 'hands the refund over'"],
  "req-ORD-CANCEL",
);

/** A flow for the ADDED requirement, declaring the tag nothing living declares yet. */
const TRACK = flow("uc_track", "req-ORD-REFUND", ["orderService.domain -> orderService.refunds 'hands the refund over'"], "req-ORD-REFUND");

/** A flow for the service this feature creates, over the interior its delta draws. */
const RECORD = flow("uc_record", "req-RFD-RECORD", ["refundService.api -> refundService.ledger 'records the refund'"], "req-RFD-RECORD");

function fleet(files: Record<string, string>): Record<string, string> {
  return {
    "architecture/landscape.likec4": LANDSCAPE,
    "services/order-service/model.likec4": ORDER_MODEL,
    "services/order-service/spec.md": ORDER_SPEC,
    "services/order-service/usecases/cancel.likec4": LIVING_CANCEL,
    "services/payment-service/spec.md": "---\nservice: payment-service\n---\n\n# payment-service\n",
    [`${FEAT_DIR}/intent.md`]: `---\nfeature: ${FEAT}\nstatus: proposed\n---\n\n# Refunds\n\nRefunds go through a ledger.\n`,
    [`${FEAT_DIR}/delta.likec4`]: DELTA,
    [`${FEAT_DIR}/specs/order-service/spec.md`]: ORDER_DELTA,
    [`${FEAT_DIR}/specs/refund-service/spec.md`]: REFUND_DELTA,
    ...files,
  };
}

async function project(files: Record<string, string>): Promise<Project> {
  const p = await makeProject(fleet(files));
  cleanups.push(() => p.destroy());
  return p;
}

interface JsonIssue {
  code: string;
  message: string;
  overridable?: boolean;
  details?: string[];
  locations?: Array<{ path: string; role: string }>;
}

/** The `usecase.*` issues a `validate --feature --json` run reports, wherever the envelope nests them. */
async function featureIssues(p: Project): Promise<JsonIssue[]> {
  const res = await runLoam(p.workDir, "validate", "--feature", FEAT, "--json");
  const out: JsonIssue[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) node.forEach(walk);
    else if (node !== null && typeof node === "object") {
      const record = node as Record<string, unknown>;
      if (typeof record.code === "string" && record.code.startsWith("usecase.")) out.push(record as unknown as JsonIssue);
      Object.values(record).forEach(walk);
    }
  };
  walk(JSON.parse(res.stdout));
  return out;
}

/** The issues an `archive --json` refusal carries. */
function refusalIssues(stdout: string): JsonIssue[] {
  return (JSON.parse(stdout) as { issues?: JsonIssue[] }).issues ?? [];
}

const ALL_FLOWS = {
  [`${SLOT}/cancel.likec4`]: REDRAWN_CANCEL,
  [`${SLOT}/track.likec4`]: TRACK,
  [`${FEAT_DIR}/specs/refund-service/usecases/record.likec4`]: RECORD,
};

describe("a feature carries its services' flows", () => {
  it("replaces the flow of a MODIFIED requirement, adds one for an ADDED requirement and one for a created service — and unarchives byte for byte", async () => {
    const p = await project(ALL_FLOWS);
    const before = await treeHashes(p.docsDir);

    // Graded, and clean: every hop is backed by the model the merge leaves, every tag resolves
    // to an id the merge leaves — and the living flow the feature redraws earns no
    // `usecase.requirement-modified`, because the archive replaces it.
    expect(await featureIssues(p)).toEqual([]);
    const status = JSON.parse((await runLoam(p.workDir, "status", FEAT, "--json")).stdout) as {
      feature: { stage: string };
      checks: { issues: JsonIssue[] };
    };
    expect(status.checks.issues.filter((i) => i.code.startsWith("usecase.")), JSON.stringify(status.checks.issues)).toEqual([]);

    const dry = await runLoam(p.workDir, "archive", FEAT, "--dry-run", "--json");
    expect(dry.code, dry.out).toBe(0);
    const plan = (JSON.parse(dry.stdout) as { plan: Array<{ path: string; action: string }> }).plan;
    expect(plan).toEqual(
      expect.arrayContaining([
        { path: "services/order-service/usecases/cancel.likec4", action: "update" },
        { path: "services/order-service/usecases/track.likec4", action: "create" },
        { path: "services/refund-service/usecases/record.likec4", action: "create" },
      ]),
    );

    const archived = await runLoam(p.workDir, "archive", FEAT, "--json");
    expect(archived.code, archived.out).toBe(0);
    expect(await p.read("services/order-service/usecases/cancel.likec4")).toBe(REDRAWN_CANCEL);
    expect(await p.read("services/order-service/usecases/track.likec4")).toBe(TRACK);
    expect(await p.read("services/refund-service/usecases/record.likec4")).toBe(RECORD);

    // The prediction holds: the service target grades the archived flows and finds nothing.
    for (const service of ["order-service", "refund-service"]) {
      const graded = await runLoam(p.workDir, "validate", "--service", service, "--json");
      expect(graded.stdout, service).not.toMatch(/"code":\s*"usecase\./);
    }

    const restored = await runLoam(p.workDir, "unarchive", FEAT, "--json");
    expect(restored.code, restored.out).toBe(0);
    expect(await p.read("services/order-service/usecases/cancel.likec4")).toBe(LIVING_CANCEL);
    expect(await treeHashes(p.docsDir)).toEqual(before);
  });

  it("grades a hop against the model the merge leaves — an unbacked one stops the archive before anything is written", async () => {
    const p = await project({
      [`${SLOT}/track.likec4`]: flow("uc_track", "req-ORD-REFUND", ["orderService.refunds -> orderService.api 'asks the api'"], "req-ORD-REFUND"),
    });
    const found = (await featureIssues(p)).filter((i) => i.code === "usecase.step-unbacked");
    expect(found.length, JSON.stringify(found)).toBe(1);
    // Named where the author is editing, with the living service directory as its scope.
    expect(found[0]!.message).toContain(`${SLOT}/track.likec4`);
    expect(found[0]!.locations).toEqual([
      { path: `${SLOT}/track.likec4`, role: "primary" },
      { path: "services/order-service", role: "scope" },
    ]);

    const status = JSON.parse((await runLoam(p.workDir, "status", FEAT, "--json")).stdout) as { feature: { stage: string } };
    expect(status.feature.stage).not.toBe("ready");

    const before = await treeHashes(p.docsDir);
    const refused = await runLoam(p.workDir, "archive", FEAT, "--json");
    expect(refused.code, refused.out).toBe(1);
    expect(refusalIssues(refused.stdout).map((i) => i.code)).toContain("usecase.step-unbacked");
    expect(await treeHashes(p.docsDir), "a refusal must write nothing").toEqual(before);
  });

  it("resolves a tag against the ids the merge leaves: an ADDED id resolves, a typo does not, a REMOVED id does not", async () => {
    const typo = await project({
      [`${SLOT}/track.likec4`]: flow("uc_track", "req-ORD-REFUNDS", ["orderService.domain -> orderService.refunds 'hands it over'"], "req-ORD-REFUNDS"),
    });
    const unresolved = (await featureIssues(typo)).filter((i) => i.code === "usecase.requirement-unresolved");
    expect(unresolved.length).toBe(1);
    expect(unresolved[0]!.message).toContain("ORD-REFUND (#req-ORD-REFUND)");

    // ORD-PLACE removed by the same delta: a new flow naming it names a promise the merge takes away.
    const removing = ORDER_DELTA.replace(
      "## ADDED Requirements",
      `## REMOVED Requirements\n\n### Requirement: Place an order\nRequirement-ID: ORD-PLACE\nBased-On: ${pinFor(ORDER_SPEC, "Place an order")}\n\n## ADDED Requirements`,
    );
    const removed = await project({
      [`${FEAT_DIR}/specs/order-service/spec.md`]: removing,
      [`${SLOT}/place.likec4`]: flow("uc_place", "req-ORD-PLACE", ["orderService.api -> orderService.domain 'places'"], "req-ORD-PLACE"),
    });
    expect((await featureIssues(removed)).map((i) => i.code)).toContain("usecase.requirement-unresolved");
  });

  it("asks a feature's flow to declare the tag of an id it adds, in the document itself — and refuses a second declaration", async () => {
    const undeclared = await project({
      [`${SLOT}/track.likec4`]: flow("uc_track", "req-ORD-REFUND", ["orderService.domain -> orderService.refunds 'hands it over'"]),
    });
    const invalid = (await featureIssues(undeclared)).filter((i) => i.code === "usecase.flow-invalid");
    expect(invalid.length).toBe(1);
    expect(invalid[0]!.overridable ?? false).toBe(false);
    expect(invalid[0]!.details?.[0]).toContain("tags-only `specification { tag req-ORD-REFUND }`");

    // ORD-CANCEL's tag is already declared by the living cancel.likec4 beside the model.
    const duplicate = await project({
      [`${SLOT}/cancel-again.likec4`]: flow("uc_cancel_again", "req-ORD-CANCEL", ["orderService.api -> orderService.domain 'cancels'"], "req-ORD-CANCEL"),
    });
    const dup = (await featureIssues(duplicate)).filter((i) => i.code === "usecase.flow-invalid");
    expect(dup.length).toBe(1);
    expect(dup[0]!.details?.join("\n")).toMatch(/Duplicate tag 'req-ORD-CANCEL'/);
  });

  it("refuses to replace a living flow whose promise this feature does not change, and --approve does not move it", async () => {
    const p = await project({
      "services/order-service/usecases/place.likec4": flow("uc_place", "req-ORD-PLACE", ["orderService.api -> orderService.domain 'places'"], "req-ORD-PLACE"),
      [`${SLOT}/place.likec4`]: flow("uc_place", "req-ORD-PLACE", ["orderService.api -> orderService.domain 'places it now'"]),
    });
    const exists = (await featureIssues(p)).filter((i) => i.code === "usecase.flow-exists");
    expect(exists.length).toBe(1);
    expect(exists[0]!.message).toContain("services/order-service/usecases/place.likec4 already exists");

    const before = await treeHashes(p.docsDir);
    for (const args of [[], ["--approve"]]) {
      const refused = await runLoam(p.workDir, "archive", FEAT, ...args, "--json");
      expect(refused.code, refused.out).toBe(1);
      const issue = refusalIssues(refused.stdout).find((i) => i.code === "usecase.flow-exists");
      expect(issue?.overridable).toBe(false);
    }
    expect(await treeHashes(p.docsDir)).toEqual(before);
  });

  it("retires a living flow through a document holding only comments, and unarchive puts it back", async () => {
    const p = await project({ [`${SLOT}/cancel.likec4`]: "// Retired by FEAT-1: the cancellation flow is redrawn as part of the refund flow.\n" });
    expect(await featureIssues(p)).toEqual([]);
    const before = await treeHashes(p.docsDir);

    const dry = await runLoam(p.workDir, "archive", FEAT, "--dry-run", "--json");
    const plan = (JSON.parse(dry.stdout) as { plan: Array<{ path: string; action: string }> }).plan;
    expect(plan).toContainEqual({ path: "services/order-service/usecases/cancel.likec4", action: "delete" });

    const archived = await runLoam(p.workDir, "archive", FEAT, "--json");
    expect(archived.code, archived.out).toBe(0);
    expect(p.exists("services/order-service/usecases/cancel.likec4")).toBe(false);

    // The deletion is what the archive LEFT — not a file edited since, which would need --force.
    const restored = await runLoam(p.workDir, "unarchive", FEAT, "--json");
    expect(restored.code, restored.out).toBe(0);
    expect(await p.read("services/order-service/usecases/cancel.likec4")).toBe(LIVING_CANCEL);
    expect(await treeHashes(p.docsDir)).toEqual(before);
  });

  it("refuses a retirement naming no living flow, and --approve does not move it", async () => {
    const p = await project({ [`${SLOT}/never-was.likec4`]: "// retired\n" });
    const unknown = (await featureIssues(p)).filter((i) => i.code === "usecase.flow-unknown");
    expect(unknown.length).toBe(1);
    const approved = await runLoam(p.workDir, "archive", FEAT, "--approve", "--json");
    expect(approved.code, approved.out).toBe(1);
    expect(refusalIssues(approved.stdout).find((i) => i.code === "usecase.flow-unknown")?.overridable).toBe(false);
  });

  // Catches: "SOME claimed promise changed" as the replacement rule. With it, a
  // feature changing ORD-CANCEL alone could replace a flow that also keeps
  // ORD-PLACE — and a second feature changing ORD-PLACE could then replace it
  // again, burying the first redraw with no pin between them (review,
  // 2026-10-23). Every promise the flow keeps must be one the feature changes.
  it("replaces a flow keeping two promises only when the feature changes both", async () => {
    const both = flow(
      "uc_order",
      "req-ORD-CANCEL",
      ["orderService.api -> orderService.domain 'places or cancels'"],
      "req-ORD-PLACE",
    ).replace("    #req-ORD-CANCEL\n", "    #req-ORD-CANCEL\n    #req-ORD-PLACE\n");
    const living = { "services/order-service/usecases/order.likec4": both.replace("specification {\n  tag req-ORD-PLACE\n}", "specification {\n  tag req-ORD-PLACE\n  tag req-ORD-CANCEL\n}"), "services/order-service/usecases/cancel.likec4": "// none\n" };
    const redraw = { [`${SLOT}/order.likec4`]: both.replace("'places or cancels'", "'places or cancels it now'").replace("specification {\n  tag req-ORD-PLACE\n}", "specification {\n  tag req-ORD-PLACE\n  tag req-ORD-CANCEL\n}") };
    const partial = await project({ ...living, ...redraw });
    const refused = (await featureIssues(partial)).filter((i) => i.code === "usecase.flow-exists");
    expect(refused.length, JSON.stringify(refused)).toBe(1);
    expect(refused[0]!.message).toContain("it also keeps ORD-PLACE, which this feature does not change");

    // Restating ORD-PLACE as a MODIFIED puts its pin under the redraw too.
    const restated = ORDER_DELTA.replace(
      "## MODIFIED Requirements\n",
      `## MODIFIED Requirements\n\n### Requirement: Place an order\nRequirement-ID: ORD-PLACE\nBased-On: ${pinFor(ORDER_SPEC, "Place an order")}\nThe service SHALL accept an order.\n\n#### Scenario: Placed\n- **Given** a basket\n- **When** it is ordered\n- **Then** an order exists\n`,
    );
    const whole = await project({ ...living, ...redraw, [`${FEAT_DIR}/specs/order-service/spec.md`]: restated });
    expect((await featureIssues(whole)).filter((i) => i.code === "usecase.flow-exists")).toEqual([]);
  });

  // Catches: a zero-byte document read as a retirement. It is what an editor or
  // an agent leaves when it creates the file before writing it, and the archive
  // deleted the living flow it was about to redraw (review, 2026-10-23).
  it("refuses an EMPTY document rather than retiring the living flow with it", async () => {
    const p = await project({ [`${SLOT}/cancel.likec4`]: "" });
    const invalid = (await featureIssues(p)).filter((i) => i.code === "usecase.flow-invalid");
    expect(invalid.length).toBe(1);
    expect(invalid[0]!.message).toContain("is empty, so it is neither a flow nor a retirement");
    const before = await treeHashes(p.docsDir);
    const refused = await runLoam(p.workDir, "archive", FEAT, "--approve", "--json");
    expect(refused.code, refused.out).toBe(1);
    expect(await treeHashes(p.docsDir)).toEqual(before);
  });

  it("reads a document as a flow, a retirement or nothing by its statements, not its bytes", () => {
    expect(documentKind("")).toBe("empty");
    expect(documentKind("﻿\n  \n")).toBe("empty");
    expect(documentKind("// retired: the cancellation is part of the refund flow now\n")).toBe("retirement");
    expect(documentKind("/* why */\n")).toBe("retirement");
    expect(documentKind("// a note\nviews {\n}\n")).toBe("flow");
    expect(documentKind("views { dynamic view x { title '// not a comment' } }\n")).toBe("flow");
  });

  // Catches: staging the LIVING architecture/ only. After the archive an
  // extending model's project also holds the feature's own fleet flows, so a
  // service flow sharing a view id with the fleet flow it drills down from
  // passed the gate and was `Duplicate view` under the next validate --service
  // (review, 2026-10-23).
  it("stages the feature's own fleet flows where the archive writes them, so a shared view id is refused first", async () => {
    const p = await project({
      [`${FEAT_DIR}/usecases/track.likec4`]: "views {\n  dynamic view uc_track {\n    title 'Track a refund, fleet view'\n    orderService -> paymentService 'authorizes'\n  }\n}\n",
      [`${SLOT}/track.likec4`]: TRACK.replace("uc_track", "uc_track"),
    });
    const invalid = (await featureIssues(p)).filter((i) => i.code === "usecase.flow-invalid");
    expect(invalid.length, JSON.stringify(invalid)).toBe(1);
    expect(invalid[0]!.details?.join("\n")).toMatch(/Duplicate view 'uc_track'/);
  });

  // Catches: a stage that always opens a workspace. `readServiceFlows` grades
  // nothing in a project no document opts into, and an untagged broken diagram
  // there is the renderer's business — a gate that parsed it anyway refused an
  // archive the fleet grades clean.
  it("opens the project only when the reader validate --service uses would", async () => {
    const p = await project({
      "services/order-service/usecases/cancel.likec4": "views {\n  view scratch {\n    include nothing.here\n  }\n}\n",
      [`${FEAT_DIR}/specs/order-service/spec.md`]: ORDER_DELTA.replace(/## MODIFIED Requirements[\s\S]*?## ADDED Requirements/, "## ADDED Requirements"),
      [`${SLOT}/diagram.likec4`]: "views {\n  view orders_sketch {\n    include *\n  }\n}\n",
    });
    expect(await featureIssues(p)).toEqual([]);
  });

  it("names the slot in the warning on a living flow whose MODIFIED promise the feature has not redrawn", async () => {
    const p = await project({});
    const modified = (await featureIssues(p)).filter((i) => i.code === "usecase.requirement-modified");
    expect(modified.length).toBe(1);
    expect(modified[0]!.message).toContain(`redraw it in this change at ${SLOT}/cancel.likec4`);
  });

  it("takes a service delta holding only a flow as a complete delta — status owes it no spec.md", async () => {
    const files = fleet({
      [`${SLOT}/place.likec4`]: flow("uc_place", "req-ORD-PLACE", ["orderService.api -> orderService.domain 'places'"], "req-ORD-PLACE"),
    });
    delete files[`${FEAT_DIR}/specs/order-service/spec.md`];
    const p = await makeProject(files);
    cleanups.push(() => p.destroy());
    expect(await featureIssues(p)).toEqual([]);
    const status = JSON.parse((await runLoam(p.workDir, "status", FEAT, "--json")).stdout) as {
      artifacts: Array<{ id: string; service?: string; required: boolean; status: string }>;
    };
    const spec = status.artifacts.find((a) => a.id === "spec" && a.service === "order-service");
    expect(spec, JSON.stringify(status.artifacts)).toMatchObject({ required: false, status: "done" });
    const fleetStatus = await runLoam(p.workDir, "status", "--json");
    expect(fleetStatus.stdout).not.toContain("order-service/spec");
  });

  it("grades a flow beside a STANDALONE model against that model's own project", async () => {
    const STANDALONE = `specification {\n  element softwareSystem\n  element container\n  tag req-PAY-AUTH\n}\n\nmodel {\n  paymentService = softwareSystem 'payment-service' {\n    metadata { service 'payment-service' }\n    api = container 'api'\n    domain = container 'domain'\n    api -> domain 'authorizes'\n  }\n}\n`;
    const PAY_SPEC = `---\nservice: payment-service\n---\n\n# payment-service\n\n## Requirements\n\n### Requirement: Authorize\nRequirement-ID: PAY-AUTH\nThe service SHALL authorize.\n\n#### Scenario: Authorized\n- **Given** a card\n- **When** it is authorized\n- **Then** it is recorded\n`;
    const PAY_DELTA = `# payment-service — delta for ${FEAT}\n\n## ADDED Requirements\n\n### Requirement: Refund\nRequirement-ID: PAY-REFUND\nThe service SHALL refund.\n\n#### Scenario: Refunded\n- **Given** a payment\n- **When** it is refunded\n- **Then** it is refunded\n`;
    const slot = `${FEAT_DIR}/specs/payment-service/usecases`;
    const clean = await project({
      "services/payment-service/model.likec4": STANDALONE,
      "services/payment-service/spec.md": PAY_SPEC,
      [`${FEAT_DIR}/specs/payment-service/spec.md`]: PAY_DELTA,
      [`${slot}/refund.likec4`]: flow("uc_refund", "req-PAY-REFUND", ["paymentService.api -> paymentService.domain 'refunds'"], "req-PAY-REFUND"),
    });
    // The base fleet's un-redrawn ORD-CANCEL flow keeps its warning; this case is about payment-service.
    const own = async (q: Project): Promise<string[]> => (await featureIssues(q)).filter((i) => i.code !== "usecase.requirement-modified").map((i) => i.code);
    expect(await own(clean)).toEqual([]);

    // The model's own block already declares req-PAY-AUTH: a flow re-declaring it is the duplicate.
    const dup = await project({
      "services/payment-service/model.likec4": STANDALONE,
      "services/payment-service/spec.md": PAY_SPEC,
      [`${FEAT_DIR}/specs/payment-service/spec.md`]: PAY_DELTA,
      [`${slot}/auth.likec4`]: flow("uc_auth", "req-PAY-AUTH", ["paymentService.api -> paymentService.domain 'authorizes'"], "req-PAY-AUTH"),
    });
    expect(await own(dup)).toEqual(["usecase.flow-invalid"]);
  });
});
