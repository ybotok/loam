/**
 * The retired-operation revival check (`openapi.op-revived`,
 * `asyncapi.slot-revived`): a feature delta spelling an operation, slot or
 * message that another feature already RETIRED and archived.
 *
 * The defect it closes was reproduced on a copy of the shipped example: a
 * feature quoting `createOrderV1` without a pin, archived after FEAT-112
 * retired that operation, put it straight back into the living contract at
 * exit 0 — only the advisory `api.op-unconsumed` said anything, because the
 * baseline gate counts unpinned quotes only for operations the living
 * contract still has. The pinned spelling of the same quote met
 * `openapi.baseline-invalid`, whose remedy ("drop the marker") led to the same
 * revival one step later, and `loam rebase` called the operation one "this
 * feature is adding".
 */
import { afterEach, describe, expect, it } from "vitest";
import { cp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { FleetContext } from "../src/core/fleet-context.js";
import { retiredLookup } from "../src/core/coherence/retired/archived.js";
import { docsDirOf } from "../src/core/kernel/ids/dirs.js";
import type { Finding } from "../src/core/vocabulary/report.js";
import { makeProject, makeTmpDir, pinAsyncapi, pinFor, pinOpenapi, runLoam, type Project } from "./helpers/harness.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!();
});

const SHIPPED_EXAMPLE = fileURLToPath(new URL("../examples/docs", import.meta.url));

interface Fleet {
  fleet: string;
  read(rel: string): string;
  write(rel: string, text: string): void;
}

/** A byte copy of the shipped example docs repo — its loam.json names itself as the docs root. */
async function exampleFleet(): Promise<Fleet> {
  const root = await makeTmpDir("loam-revival-");
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const fleet = join(root, "fleet");
  await cp(SHIPPED_EXAMPLE, fleet, { recursive: true });
  return {
    fleet,
    read: (rel) => readFileSync(join(fleet, rel), "utf8"),
    write: (rel, text) => {
      mkdirSync(dirname(join(fleet, rel)), { recursive: true });
      writeFileSync(join(fleet, rel), text, "utf8");
    },
  };
}

const LIVING_ORDER_API = "services/order-service/openapi.yaml";

/** The living `createOrderV1` operation, copied verbatim out of the example — what an author quoting it pastes. */
const QUOTED_V1 = `openapi: 3.1.0
info:
  title: order-service
  version: "2.0"
paths:
  /v1/orders:
    post:
      operationId: createOrderV1
      summary: Place an order (v1, legacy)
      description: >-
        Superseded by createOrder. Takes a flat basket, assumes EUR and accepts no
        idempotency key, so a replayed import places a second order. One caller left:
        the partner batch importer.
      deprecated: true
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/CreateOrderV1Request'
      responses:
        "201":
          description: The order was accepted.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/OrderV1'
`;

/** A feature that touches only order-service's contract — the smallest shape the gate grades. */
function contractOnly(f: Fleet, feature: string, dir: string, openapi: string): void {
  f.write(
    `features/${dir}/intent.md`,
    `---\nfeature: ${feature}\ntitle: ${dir}\nstatus: in_progress\nowner: orders-team\nservices: [order-service]\n---\n\n# ${feature}\n\n## Why\nThe partner importer wanted one more thing from the v1 path.\n`,
  );
  f.write(`features/${dir}/specs/order-service/openapi.yaml`, openapi);
}

function findings(stdout: string): Finding[] {
  return (JSON.parse(stdout) as { targets: Array<{ findings: Finding[] }> }).targets.flatMap((t) => t.findings);
}

const ofCode = (all: readonly { code: string }[], code: string) => all.filter((f) => f.code === code);

describe("openapi.op-revived — an operation an archived feature retired", () => {
  it("archive refuses an unpinned quote of it; --approve proceeds and names what came back and whose retirement it reverses", async () => {
    const f = await exampleFleet();
    contractOnly(f, "FEAT-304", "FEAT-304-v1-notes", QUOTED_V1);

    const retire = await runLoam(f.fleet, "archive", "FEAT-112");
    expect(retire.code, retire.out).toBe(0);
    expect(f.read(LIVING_ORDER_API)).not.toContain("createOrderV1");

    // validate --feature: a warning, and one that gates.
    const validated = await runLoam(f.fleet, "validate", "--feature", "FEAT-304", "--json");
    const [warned, ...more] = ofCode(findings(validated.stdout), "openapi.op-revived");
    expect(more).toEqual([]);
    expect(warned).toMatchObject({ severity: "warn", gates: true, subject: "order-service" });
    expect(warned!.message).toContain("'createOrderV1' (POST /v1/orders)");
    expect(warned!.message).toContain("archived FEAT-112 retired it");
    expect(warned!.message).toContain("Delete the quote if you only restated it; archive with --approve if the feature brings it back on purpose.");

    const refused = await runLoam(f.fleet, "archive", "FEAT-304", "--json");
    expect(refused.code, refused.out).toBe(1);
    const refusal = JSON.parse(refused.stdout) as { error: { code: string }; issues: Array<{ code: string; gates: boolean; overridable: boolean }> };
    expect(refusal.error.code).toBe("not-coherent");
    expect(ofCode(refusal.issues, "openapi.op-revived")).toEqual([
      expect.objectContaining({ gates: true, overridable: true }),
    ]);
    expect(f.read(LIVING_ORDER_API)).not.toContain("createOrderV1");

    const approved = await runLoam(f.fleet, "archive", "FEAT-304", "--approve", "--json");
    expect(approved.code, approved.out).toBe(0);
    const merged = JSON.parse(approved.stdout) as { overridden: Array<{ code: string; message: string }> };
    const [overridden] = ofCode(merged.overridden, "openapi.op-revived");
    expect(overridden!.message).toContain("'createOrderV1'");
    expect(overridden!.message).toContain("FEAT-112");
    expect(f.read(LIVING_ORDER_API)).toContain("operationId: createOrderV1");
  });

  it("the text archive under --approve says it on the way past", async () => {
    const f = await exampleFleet();
    contractOnly(f, "FEAT-304", "FEAT-304-v1-notes", QUOTED_V1);
    expect((await runLoam(f.fleet, "archive", "FEAT-112")).code).toBe(0);
    const approved = await runLoam(f.fleet, "archive", "FEAT-304", "--approve");
    expect(approved.code, approved.out).toBe(0);
    expect(approved.out).toMatch(/archiving despite \d+ gating issue/);
    expect(approved.out).toContain("spells 'createOrderV1' (POST /v1/orders), which the living contract no longer has — archived FEAT-112 retired it");
  });

  it("the pinned variant: baseline-invalid stops sending the author to drop the pin, and rebase does not bless the operation as new", async () => {
    const f = await exampleFleet();
    // Pinned while createOrderV1 was still living — exactly what `loam rebase` wrote then.
    contractOnly(f, "FEAT-304", "FEAT-304-v1-notes", pinOpenapi(QUOTED_V1, f.read(LIVING_ORDER_API)));
    const pinned = f.read("features/FEAT-304-v1-notes/specs/order-service/openapi.yaml");
    expect(pinned).toContain("x-loam-based-on:");
    expect((await runLoam(f.fleet, "archive", "FEAT-112")).code).toBe(0);

    const all = findings((await runLoam(f.fleet, "validate", "--feature", "FEAT-304", "--json")).stdout);
    const [invalid] = ofCode(all, "openapi.baseline-invalid");
    expect(invalid!.message).not.toContain("drop the marker");
    expect(invalid!.message).toContain("re-read the living contract and delete this operation from the delta");
    expect(invalid!.message).toContain("unless this feature deliberately brings it back");
    expect(ofCode(all, "openapi.op-revived")).toHaveLength(1);

    const json = await runLoam(f.fleet, "rebase", "FEAT-304", "--json");
    expect(json.code, json.out).toBe(0);
    const payload = JSON.parse(json.stdout) as {
      pins: Array<{ target: string; status: string }>;
      revived: Array<{ code: string; severity: string; gates: boolean; message: string }>;
      written: string[];
    };
    expect(payload.pins.find((p) => p.target.includes("createOrderV1"))!.status).toBe("unresolved");
    expect(payload.revived).toEqual([
      expect.objectContaining({ code: "openapi.op-revived", severity: "warn", gates: true }),
    ]);
    expect(payload.revived[0]!.message).toContain("archived FEAT-112 retired it");
    expect(payload.written).toEqual([]);

    const text = await runLoam(f.fleet, "rebase", "FEAT-304");
    expect(text.code, text.out).toBe(0);
    expect(text.out).toContain("unless an archived feature retired it");
    expect(text.out).toContain("RETIRED by an archived feature");
    expect(text.out).toContain("spells 'createOrderV1' (POST /v1/orders)");
    // Nothing was pinned, re-pinned or stripped: the decision is the author's.
    expect(f.read("features/FEAT-304-v1-notes/specs/order-service/openapi.yaml")).toBe(pinned);
  });

  it("a genuinely new operation stays silent — even one reusing the retired path, since identity is the operationId", async () => {
    const f = await exampleFleet();
    expect((await runLoam(f.fleet, "archive", "FEAT-112")).code).toBe(0);
    contractOnly(
      f,
      "FEAT-305",
      "FEAT-305-import",
      `openapi: 3.1.0
info: { title: order-service, version: "2.0" }
paths:
  /v1/orders:
    post:
      operationId: importOrders
      responses:
        "202":
          description: Accepted for import.
          content:
            application/json:
              schema: { type: object }
  /orders/{id}/notes:
    get:
      operationId: listOrderNotes
      responses:
        "200":
          description: The notes.
          content:
            application/json:
              schema: { type: array, items: { type: string } }
`,
    );
    const all = findings((await runLoam(f.fleet, "validate", "--feature", "FEAT-305", "--json")).stdout);
    expect(ofCode(all, "openapi.op-revived")).toEqual([]);
    // They read as the additions they are.
    expect(ofCode(all, "api.op-unconsumed").map((x) => x.message).join("\n")).toContain("importOrders");
  });

  it("retired, re-added on purpose, now living: a later quote of it is not a revival", async () => {
    const f = await exampleFleet();
    contractOnly(f, "FEAT-304", "FEAT-304-v1-notes", QUOTED_V1);
    expect((await runLoam(f.fleet, "archive", "FEAT-112")).code).toBe(0);
    expect((await runLoam(f.fleet, "archive", "FEAT-304", "--approve")).code).toBe(0);
    expect(f.read(LIVING_ORDER_API)).toContain("operationId: createOrderV1");

    contractOnly(f, "FEAT-306", "FEAT-306-v1-again", QUOTED_V1);
    const all = findings((await runLoam(f.fleet, "validate", "--feature", "FEAT-306", "--json")).stdout);
    expect(ofCode(all, "openapi.op-revived")).toEqual([]);
    // The quote of a living operation is the ordinary unpinned-restatement case.
    expect(ofCode(all, "openapi.baseline-missing")).toHaveLength(1);
  });

  it("an in-flight feature sharing an archived feature's id is not excused from that feature's retirement", async () => {
    // Coherence grades only features in flight, so the archived FEAT-112 is
    // never the feature asking — an in-flight directory carrying the same id
    // is another feature, and the retirement it would undo is real. The index
    // used to drop the asking id from the retirers, which could only hide this.
    const f = await exampleFleet();
    expect((await runLoam(f.fleet, "archive", "FEAT-112")).code).toBe(0);
    contractOnly(f, "FEAT-112", "FEAT-112-v1-again", QUOTED_V1);
    const [warned, ...more] = ofCode(
      findings((await runLoam(f.fleet, "validate", "--feature", "FEAT-112", "--json")).stdout),
      "openapi.op-revived",
    );
    expect(more).toEqual([]);
    expect(warned!.message).toContain("archived FEAT-112 retired it");
  });

  it("two archived features retiring one operation are both named, in id order, each once", async () => {
    // FEAT-090 is placed by hand, twice under one id: a directory name is the
    // only place a feature id is read from, so two archived directories can
    // carry the same one, and naming it twice would name one feature as two.
    const f = await exampleFleet();
    expect((await runLoam(f.fleet, "archive", "FEAT-112")).code).toBe(0);
    const marker = `openapi: 3.1.0
paths:
  /v1/orders:
    post:
      operationId: createOrderV1
      x-loam-remove: true
`;
    f.write("features/archive/FEAT-090-early-retire/specs/order-service/openapi.yaml", marker);
    f.write("features/archive/FEAT-090-early-retire-copy/specs/order-service/openapi.yaml", marker);
    contractOnly(f, "FEAT-304", "FEAT-304-v1-notes", QUOTED_V1);
    const [warned, ...more] = ofCode(
      findings((await runLoam(f.fleet, "validate", "--feature", "FEAT-304", "--json")).stdout),
      "openapi.op-revived",
    );
    expect(more).toEqual([]);
    expect(warned!.message).toContain("— archived FEAT-090 and FEAT-112 retired it,");
  });

  it("a path-level or anonymous marker retired nothing, so it is never named as the retirer", async () => {
    // Neither shape deletes anything at archive — the merge removes a living
    // operation only when the one at the marker's own method and path carries
    // the id the marker names, and these name none — so a feature carrying them
    // through `--approve` leaves createOrderV1 living. Removed later by HAND,
    // the operation is gone with no marker anywhere: the documented limit,
    // where the check falls back to calling a quote of it new. Indexing the
    // path-level slot would have named FEAT-113 for a retirement it never made.
    const f = await exampleFleet();
    contractOnly(
      f,
      "FEAT-113",
      "FEAT-113-path-level",
      `openapi: 3.1.0
paths:
  /v1/orders:
    x-loam-remove: true
    post:
      x-loam-remove: true
`,
    );
    const forced = await runLoam(f.fleet, "archive", "FEAT-113", "--approve");
    expect(forced.code, forced.out).toBe(0);
    expect(f.read(LIVING_ORDER_API)).toContain("operationId: createOrderV1");

    const living = f.read(LIVING_ORDER_API);
    const start = living.indexOf("  /v1/orders:");
    const end = living.indexOf("\ncomponents:");
    f.write(LIVING_ORDER_API, living.slice(0, start) + living.slice(end + 1));
    expect(f.read(LIVING_ORDER_API)).not.toContain("createOrderV1");

    contractOnly(f, "FEAT-304", "FEAT-304-v1-notes", QUOTED_V1);
    const all = findings((await runLoam(f.fleet, "validate", "--feature", "FEAT-304", "--json")).stdout);
    expect(ofCode(all, "openapi.op-revived")).toEqual([]);
  });

  it("a marker the merge never carried out retired nothing — a genuinely new operation it named is not a revival", async () => {
    // FEAT-210's markers both miss: GET /orders/export never existed
    // (remove-target-missing), and GET /orders/{id} holds getOrder, not
    // archiveOrder (remove-target-mismatch). Archived past both under
    // --approve, the merge deleted nothing — so FEAT-211 adding either id for
    // the first time is an addition, as its snapshot pre-image proves.
    const f = await exampleFleet();
    contractOnly(
      f,
      "FEAT-210",
      "FEAT-210-drop-export",
      `openapi: 3.1.0
paths:
  /orders/export:
    get:
      operationId: exportOrders
      x-loam-remove: true
  /orders/{id}:
    get:
      operationId: archiveOrder
      x-loam-remove: true
`,
    );
    const forced = await runLoam(f.fleet, "archive", "FEAT-210", "--approve");
    expect(forced.code, forced.out).toBe(0);
    expect(f.read(LIVING_ORDER_API)).toContain("operationId: getOrder");
    contractOnly(
      f,
      "FEAT-211",
      "FEAT-211-add-export",
      `openapi: 3.1.0
paths:
  /orders/export:
    get:
      operationId: exportOrders
      responses:
        "200":
          description: The export.
          content:
            application/json:
              schema: { type: object }
  /orders/{id}/archive:
    post:
      operationId: archiveOrder
      responses:
        "204":
          description: Archived.
`,
    );
    const revived = async (): Promise<Finding[]> =>
      ofCode(findings((await runLoam(f.fleet, "validate", "--feature", "FEAT-211", "--json")).stdout), "openapi.op-revived");
    expect(await revived()).toEqual([]);

    // With no pre-image to check them against, the markers count as written —
    // what the index did before it read pre-images, and the documented limit.
    await rm(join(f.fleet, "features/archive/FEAT-210-drop-export/.loam-before"), { recursive: true });
    expect((await revived()).map((r) => r.message.match(/spells '(\w+)'/)![1])).toEqual(["exportOrders", "archiveOrder"]);
  });

  it("a marker in a contract its own archive created retired nothing — there was nothing before it", async () => {
    // checkout-web has no openapi.yaml: FEAT-212's archive creates one (the
    // snapshot records the file as created, with no pre-image), so its
    // marker had nothing to take — and FEAT-213 adding that id is new.
    const f = await exampleFleet();
    const feature = (id: string, dir: string, openapi: string): void => {
      f.write(`features/${dir}/intent.md`, `---\nfeature: ${id}\ntitle: ${dir}\nstatus: in_progress\nowner: web-team\nservices: [checkout-web]\n---\n\n# ${id}\n\n## Why\nThe web front end grows an API.\n`);
      f.write(`features/${dir}/specs/checkout-web/openapi.yaml`, openapi);
    };
    feature(
      "FEAT-212",
      "FEAT-212-web-api",
      `openapi: 3.1.0
info: { title: checkout-web, version: "1.0" }
paths:
  /session:
    get:
      operationId: getSession
      responses:
        "200":
          description: The session.
  /session/legacy:
    get:
      operationId: getLegacySession
      x-loam-remove: true
`,
    );
    const forced = await runLoam(f.fleet, "archive", "FEAT-212", "--approve");
    expect(forced.code, forced.out).toBe(0);
    expect(f.read("services/checkout-web/openapi.yaml")).toContain("operationId: getSession");
    feature(
      "FEAT-213",
      "FEAT-213-legacy-session",
      `openapi: 3.1.0
paths:
  /session/legacy:
    get:
      operationId: getLegacySession
      responses:
        "200":
          description: The legacy session.
`,
    );
    const all = findings((await runLoam(f.fleet, "validate", "--feature", "FEAT-213", "--json")).stdout);
    expect(ofCode(all, "openapi.op-revived")).toEqual([]);
  });
});

/** The living `cancelOrder`, quoted at the address it stands at in the example. */
const CANCEL_OP = `      operationId: cancelOrder
      summary: Cancel an order
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
            format: uuid
      responses:
        "200":
          description: The order is cancelled.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Order'
        "409":
          description: The order has already been handed to fulfilment.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Problem'
`;
const QUOTED_CANCEL = `openapi: 3.1.0
paths:
  /orders/{id}/cancel:
    post:
${CANCEL_OP}`;
/** FEAT-200: moves cancelOrder to /cancellation — a marker on the old slot, the definition on the new one. */
const MOVE_CANCEL = `openapi: 3.1.0
paths:
  /orders/{id}/cancel:
    post:
      operationId: cancelOrder
      x-loam-remove: true
  /orders/{id}/cancellation:
    post:
${CANCEL_OP}`;

describe("openapi.op-revived — an operation an archived feature MOVED, quoted at the address it left", () => {
  // The baseline gate keys on the slot (nothing living there) and the id check
  // keys on the operationId (still living, at the new slot), so a quote of the
  // old address used to archive at exit 0 and put cancelOrder back beside its
  // new one — one operationId at two addresses, only the advisory
  // openapi.duplicate-operationid saying so afterwards.
  async function moved(): Promise<Fleet> {
    const f = await exampleFleet();
    contractOnly(f, "FEAT-200", "FEAT-200-move-cancel", MOVE_CANCEL);
    const archived = await runLoam(f.fleet, "archive", "FEAT-200");
    expect(archived.code, archived.out).toBe(0);
    expect(f.read(LIVING_ORDER_API)).not.toContain("/orders/{id}/cancel:");
    expect(f.read(LIVING_ORDER_API)).toContain("/orders/{id}/cancellation:");
    return f;
  }

  it("archive refuses the unpinned quote, naming the move and where the operation lives now", async () => {
    const f = await moved();
    contractOnly(f, "FEAT-201", "FEAT-201-quote-cancel", QUOTED_CANCEL);
    const [warned, ...more] = ofCode(
      findings((await runLoam(f.fleet, "validate", "--feature", "FEAT-201", "--json")).stdout),
      "openapi.op-revived",
    );
    expect(more).toEqual([]);
    expect(warned).toMatchObject({ severity: "warn", gates: true, subject: "order-service" });
    expect(warned!.message).toContain("spells 'cancelOrder' at POST /orders/{id}/cancel, an address the living contract no longer has");
    expect(warned!.message).toContain("archived FEAT-200 moved it to POST /orders/{id}/cancellation, where it lives now");
    expect(warned!.message).toContain("one operationId at two addresses");

    const refused = await runLoam(f.fleet, "archive", "FEAT-201", "--json");
    expect(refused.code, refused.out).toBe(1);
    expect((JSON.parse(refused.stdout) as { error: { code: string } }).error.code).toBe("not-coherent");
    expect(f.read(LIVING_ORDER_API)).not.toContain("/orders/{id}/cancel:");
  });

  it("the pinned quote: baseline-invalid says it MOVED and where, never to archive past op-revived — and op-revived fires beside it", async () => {
    const f = await exampleFleet();
    // Pinned while cancelOrder still stood at /cancel — what rebase wrote then.
    contractOnly(f, "FEAT-201", "FEAT-201-quote-cancel", pinOpenapi(QUOTED_CANCEL, f.read(LIVING_ORDER_API)));
    contractOnly(f, "FEAT-200", "FEAT-200-move-cancel", MOVE_CANCEL);
    expect((await runLoam(f.fleet, "archive", "FEAT-200")).code).toBe(0);

    const all = findings((await runLoam(f.fleet, "validate", "--feature", "FEAT-201", "--json")).stdout);
    const [invalid] = ofCode(all, "openapi.baseline-invalid");
    expect(invalid!.message).toContain("'cancelOrder' lives at POST /orders/{id}/cancellation now: a parallel feature moved it");
    expect(invalid!.message).not.toContain("past `openapi.op-revived`");
    expect(ofCode(all, "openapi.op-revived").map((r) => r.message)).toEqual([
      expect.stringContaining("archived FEAT-200 moved it to POST /orders/{id}/cancellation"),
    ]);

    const rebased = JSON.parse((await runLoam(f.fleet, "rebase", "FEAT-201", "--dry-run", "--json")).stdout) as {
      revived: Array<{ code: string; message: string }>;
    };
    expect(rebased.revived.map((r) => r.code)).toEqual(["openapi.op-revived"]);
  });

  it("moving it back on purpose — with a marker at its new address — is a relocation, not a revival", async () => {
    const f = await moved();
    contractOnly(
      f,
      "FEAT-202",
      "FEAT-202-move-back",
      `openapi: 3.1.0
paths:
  /orders/{id}/cancellation:
    post:
      operationId: cancelOrder
      x-loam-remove: true
  /orders/{id}/cancel:
    post:
${CANCEL_OP}`,
    );
    const all = findings((await runLoam(f.fleet, "validate", "--feature", "FEAT-202", "--json")).stdout);
    expect(ofCode(all, "openapi.op-revived")).toEqual([]);
  });

  it("a different operation at the vacated address is new — identity is the operationId", async () => {
    const f = await moved();
    contractOnly(
      f,
      "FEAT-203",
      "FEAT-203-cancel-request",
      `openapi: 3.1.0
paths:
  /orders/{id}/cancel:
    post:
      operationId: requestCancellation
      responses:
        "202":
          description: Cancellation requested.
`,
    );
    const all = findings((await runLoam(f.fleet, "validate", "--feature", "FEAT-203", "--json")).stdout);
    expect(ofCode(all, "openapi.op-revived")).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* The event axis                                                      */
/* ------------------------------------------------------------------ */

const EVENTS_SPEC = `---
service: payment-service
status: verified
---

# payment-service

## Requirements

### Requirement: Legacy events
The service SHALL publish the legacy payment event.

Publishes: payment.Legacy

#### Scenario: Legacy event leaves
- **Given** a payment
- **When** it settles
- **Then** payment.Legacy is published
`;

const LIVING_EVENTS = `asyncapi: 3.0.0
info:
  title: payment-service events
  version: "1.0"
channels:
  legacyEvents:
    address: payment.legacy.v1
    messages:
      Legacy:
        $ref: '#/components/messages/Legacy'
operations:
  sendLegacy:
    action: send
    channel:
      $ref: '#/channels/legacyEvents'
components:
  messages:
    Legacy:
      name: payment.Legacy
      payload:
        type: object
        properties:
          paymentId:
            type: string
`;

/** The same contract with the message declared INLINE under its channel — retired by the channel's own marker. */
const LIVING_EVENTS_INLINE = `asyncapi: 3.0.0
info:
  title: payment-service events
  version: "1.0"
channels:
  legacyEvents:
    address: payment.legacy.v1
    messages:
      Legacy:
        name: payment.Legacy
        payload:
          type: object
          properties:
            paymentId:
              type: string
operations:
  sendLegacy:
    action: send
    channel:
      $ref: '#/channels/legacyEvents'
`;

const RETIRE_SPEC = `# retirement

## REMOVED Requirements

### Requirement: Legacy events
Based-On: ${pinFor(EVENTS_SPEC, "Legacy events")}

Publishes: payment.Legacy
`;

const RETIRE_EVENTS = `asyncapi: 3.0.0
channels:
  legacyEvents:
    x-loam-remove: true
operations:
  sendLegacy:
    x-loam-remove: true
components:
  messages:
    Legacy:
      name: payment.Legacy
      x-loam-remove: true
`;

const RETIRE_CHANNEL = `asyncapi: 3.0.0
channels:
  legacyEvents:
    x-loam-remove: true
operations:
  sendLegacy:
    x-loam-remove: true
`;

const INTENT = (id: string) => `---\nfeature: ${id}\nstatus: in_progress\n---\n\n# ${id}\n\n## Why\nThe legacy payment event has a story to tell.\n`;

async function eventFleet(living: string, retirement: string): Promise<Project> {
  const p = await makeProject({
    "services/payment-service/spec.md": EVENTS_SPEC,
    "services/payment-service/asyncapi.yaml": living,
    "features/FEAT-40-retire-legacy/intent.md": INTENT("FEAT-40"),
    "features/FEAT-40-retire-legacy/specs/payment-service/spec.md": RETIRE_SPEC,
    "features/FEAT-40-retire-legacy/specs/payment-service/asyncapi.yaml": retirement,
  });
  cleanups.push(() => p.destroy());
  const retired = await runLoam(p.workDir, "archive", "FEAT-40");
  expect(retired.code, retired.out).toBe(0);
  expect(await p.read("services/payment-service/asyncapi.yaml")).not.toContain("Legacy");
  return p;
}

async function eventFindings(p: Project, feature: string): Promise<Finding[]> {
  return ofCode(findings((await runLoam(p.workDir, "validate", "--feature", feature, "--json")).stdout), "asyncapi.slot-revived");
}

describe("asyncapi.slot-revived — the event twin", () => {
  it("archive refuses a delta quoting the retired channel, operation and message; --approve re-adds them and says whose retirement it reverses", async () => {
    const p = await eventFleet(LIVING_EVENTS, RETIRE_EVENTS);
    await p.write("features/FEAT-41-legacy-again/intent.md", INTENT("FEAT-41"));
    // The living slots as they stood before FEAT-40 — pasted back, unpinned.
    await p.write("features/FEAT-41-legacy-again/specs/payment-service/asyncapi.yaml", LIVING_EVENTS);

    const warned = await eventFindings(p, "FEAT-41");
    expect(warned.map((w) => w.message.match(/declares (.*?), which/)![1])).toEqual([
      "channels.legacyEvents",
      "operations.sendLegacy",
      "message 'payment.Legacy' (components.messages.Legacy)",
    ]);
    for (const w of warned) {
      expect(w).toMatchObject({ severity: "warn", gates: true, subject: "payment-service" });
      expect(w.message).toContain("archived FEAT-40 retired it");
    }

    const refused = await runLoam(p.workDir, "archive", "FEAT-41", "--json");
    expect(refused.code, refused.out).toBe(1);
    expect(ofCode((JSON.parse(refused.stdout) as { issues: Array<{ code: string }> }).issues, "asyncapi.slot-revived")).toHaveLength(3);
    expect(await p.read("services/payment-service/asyncapi.yaml")).not.toContain("Legacy");

    const approved = await runLoam(p.workDir, "archive", "FEAT-41", "--approve", "--json");
    expect(approved.code, approved.out).toBe(0);
    const overridden = ofCode((JSON.parse(approved.stdout) as { overridden: Array<{ code: string; message: string }> }).overridden, "asyncapi.slot-revived");
    expect(overridden).toHaveLength(3);
    expect(overridden.every((o) => o.message.includes("FEAT-40"))).toBe(true);
    expect(await p.read("services/payment-service/asyncapi.yaml")).toContain("name: payment.Legacy");
  });

  it("a channel removal's inline messages are named from the snapshot pre-image — the delta never spelled them", async () => {
    const p = await eventFleet(LIVING_EVENTS_INLINE, RETIRE_CHANNEL);
    // The message comes back under components.messages: no slot of FEAT-40's
    // delta names it, only the living channel it merged into did.
    await p.write("features/FEAT-41-legacy-again/intent.md", INTENT("FEAT-41"));
    await p.write(
      "features/FEAT-41-legacy-again/specs/payment-service/asyncapi.yaml",
      `asyncapi: 3.0.0
components:
  messages:
    LegacyAgain:
      name: payment.Legacy
      payload:
        type: object
`,
    );
    const [warned, ...more] = await eventFindings(p, "FEAT-41");
    expect(more).toEqual([]);
    expect(warned!.message).toContain("message 'payment.Legacy' (components.messages.LegacyAgain)");
    expect(warned!.message).toContain("archived FEAT-40 retired it");
  });

  it("an edited or missing pre-image is not read — the channel's inline names drop out, the documented limit", async () => {
    const p = await eventFleet(LIVING_EVENTS_INLINE, RETIRE_CHANNEL);
    await p.write("features/FEAT-41-legacy-again/intent.md", INTENT("FEAT-41"));
    await p.write(
      "features/FEAT-41-legacy-again/specs/payment-service/asyncapi.yaml",
      `asyncapi: 3.0.0
components:
  messages:
    LegacyAgain:
      name: payment.Legacy
      payload:
        type: object
`,
    );
    const preImage = join(p.docsDir, "features/archive/FEAT-40-retire-legacy/.loam-before/files/services/payment-service/asyncapi.yaml");
    expect(existsSync(preImage)).toBe(true);
    // Edited since the merge: its bytes no longer hash to what the manifest
    // recorded, so they are not what the merge saw — refused, as unarchive
    // refuses to restore them.
    await writeFile(preImage, (await readFile(preImage, "utf8")).replace("payment.Legacy", "payment.Edited"), "utf8");
    expect(await eventFindings(p, "FEAT-41")).toEqual([]);
    await rm(preImage);
    expect(await eventFindings(p, "FEAT-41")).toEqual([]);
  });

  it("a version-2 manifest is read by its literal path", async () => {
    const p = await eventFleet(LIVING_EVENTS_INLINE, RETIRE_CHANNEL);
    await p.write("features/FEAT-41-legacy-again/intent.md", INTENT("FEAT-41"));
    await p.write(
      "features/FEAT-41-legacy-again/specs/payment-service/asyncapi.yaml",
      `asyncapi: 3.0.0
components:
  messages:
    LegacyAgain:
      name: payment.Legacy
      payload:
        type: object
`,
    );
    const manifestPath = join(p.docsDir, "features/archive/FEAT-40-retire-legacy/.loam-before/manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as { version: number; files: Array<Record<string, unknown>> };
    manifest.version = 2;
    for (const entry of manifest.files) {
      delete entry["service"];
      delete entry["artifact"];
    }
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
    expect(await eventFindings(p, "FEAT-41")).toHaveLength(1);
  });

  it("the pinned event variant: baseline-invalid names the delete-the-quote remedy, and rebase prints the revival", async () => {
    // Pinned while the slots were living — what `loam rebase` wrote then —
    // and only THEN retired underneath it by FEAT-40's archive.
    const p = await makeProject({
      "services/payment-service/spec.md": EVENTS_SPEC,
      "services/payment-service/asyncapi.yaml": LIVING_EVENTS,
      "features/FEAT-40-retire-legacy/intent.md": INTENT("FEAT-40"),
      "features/FEAT-40-retire-legacy/specs/payment-service/spec.md": RETIRE_SPEC,
      "features/FEAT-40-retire-legacy/specs/payment-service/asyncapi.yaml": RETIRE_EVENTS,
      "features/FEAT-41-legacy-again/intent.md": INTENT("FEAT-41"),
      "features/FEAT-41-legacy-again/specs/payment-service/asyncapi.yaml": pinAsyncapi(LIVING_EVENTS, LIVING_EVENTS),
    });
    cleanups.push(() => p.destroy());
    expect((await runLoam(p.workDir, "archive", "FEAT-40")).code).toBe(0);

    const all = findings((await runLoam(p.workDir, "validate", "--feature", "FEAT-41", "--json")).stdout);
    const invalid = ofCode(all, "asyncapi.baseline-invalid");
    expect(invalid.length).toBeGreaterThan(0);
    for (const i of invalid) {
      expect(i.message).not.toContain("drop the marker");
      expect(i.message).toContain("delete this slot from the delta, unless this feature deliberately brings it back");
    }
    expect(ofCode(all, "asyncapi.slot-revived")).toHaveLength(3);

    const rebased = await runLoam(p.workDir, "rebase", "FEAT-41", "--json");
    expect(rebased.code, rebased.out).toBe(0);
    const revived = (JSON.parse(rebased.stdout) as { revived: Array<{ code: string }> }).revived;
    expect(revived.map((r) => r.code)).toEqual(["asyncapi.slot-revived", "asyncapi.slot-revived", "asyncapi.slot-revived"]);
  });

  it("a slot marker the merge never carried out retired nothing — on a key the living contract lacked, or a message name it did not declare there", async () => {
    // `channels.ghostEvents` never existed (remove-target-missing), and the
    // living `components.messages.Legacy` declares payment.Legacy, not
    // payment.Ghost (remove-target-mismatch): the merge deletes neither, so
    // FEAT-43 declaring them for the first time is an addition.
    const p = await makeProject({
      "services/payment-service/spec.md": EVENTS_SPEC,
      "services/payment-service/asyncapi.yaml": LIVING_EVENTS,
      "features/FEAT-42-ghosts/intent.md": INTENT("FEAT-42"),
      "features/FEAT-42-ghosts/specs/payment-service/asyncapi.yaml": `asyncapi: 3.0.0
channels:
  ghostEvents:
    x-loam-remove: true
components:
  messages:
    Legacy:
      name: payment.Ghost
      x-loam-remove: true
`,
    });
    cleanups.push(() => p.destroy());
    const forced = await runLoam(p.workDir, "archive", "FEAT-42", "--approve");
    expect(forced.code, forced.out).toBe(0);
    expect(await p.read("services/payment-service/asyncapi.yaml")).toContain("name: payment.Legacy");
    await p.write("features/FEAT-43-ghosts-for-real/intent.md", INTENT("FEAT-43"));
    await p.write(
      "features/FEAT-43-ghosts-for-real/specs/payment-service/asyncapi.yaml",
      `asyncapi: 3.0.0
channels:
  ghostEvents:
    address: payment.ghost.v1
components:
  messages:
    Ghost:
      name: payment.Ghost
      payload:
        type: object
`,
    );
    // FEAT-42's merge wrote nothing (every marker missed), so its manifest has
    // no row for the contract: an answer, not a gap.
    expect(await eventFindings(p, "FEAT-43")).toEqual([]);

    // No pre-image to check against: counted as written, the documented limit —
    // and a manifest row that cannot be read might have been this contract's,
    // so absence is not concluded past it either.
    const counted = ["channels.ghostEvents", "message 'payment.Ghost' (components.messages.Ghost)"];
    const declared = async (): Promise<string[]> =>
      (await eventFindings(p, "FEAT-43")).map((w) => w.message.match(/declares (.*?), which/)![1]!);
    const manifestPath = join(p.docsDir, "features/archive/FEAT-42-ghosts/.loam-before/manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as { files: unknown[] };
    expect(manifest.files).toEqual([]);
    await writeFile(manifestPath, JSON.stringify({ ...manifest, files: [42] }), "utf8");
    expect(await declared()).toEqual(counted);
    await rm(join(p.docsDir, "features/archive/FEAT-42-ghosts/.loam-before"), { recursive: true });
    expect(await declared()).toEqual(counted);
  });

  it("rebase's standalone read and the gate's walk give one answer on one tree — living present, absent, or unreadable", async () => {
    // Two readers of the same pair of documents (core/coherence/retired/
    // event-pair.ts): the gate's walk behind validate and archive, and the
    // standalone read behind rebase. They used to spell their guards twice.
    const p = await eventFleet(LIVING_EVENTS, RETIRE_EVENTS);
    await p.write("features/FEAT-41-legacy-again/intent.md", INTENT("FEAT-41"));
    await p.write("features/FEAT-41-legacy-again/specs/payment-service/asyncapi.yaml", LIVING_EVENTS);
    const both = async (): Promise<{ gate: string[]; rebase: string[] }> => {
      const gate = (await eventFindings(p, "FEAT-41")).map((f) => f.message);
      const rebased = await runLoam(p.workDir, "rebase", "FEAT-41", "--dry-run", "--json");
      const payload = JSON.parse(rebased.stdout) as { revived?: Array<{ code: string; message: string }> };
      return { gate, rebase: ofCode(payload.revived ?? [], "asyncapi.slot-revived").map((r) => r.message) };
    };
    const living = "services/payment-service/asyncapi.yaml";

    const present = await both();
    expect(present.gate).toHaveLength(3);
    expect(present.rebase).toEqual(present.gate);

    // Absent is an answer: every slot the delta declares is absent from it.
    await rm(join(p.docsDir, living));
    const absent = await both();
    expect(absent.gate).toHaveLength(3);
    expect(absent.rebase).toEqual(absent.gate);

    // Unreadable is not: nothing is graded against a document nobody could open.
    await p.write(living, "asyncapi: 3.0.0\nchannels: [unclosed\n");
    const unreadable = await both();
    expect(unreadable.gate).toEqual([]);
    expect(unreadable.rebase).toEqual(unreadable.gate);
  });

  it("a slot absent from living that nobody retired stays silent", async () => {
    const p = await eventFleet(LIVING_EVENTS, RETIRE_EVENTS);
    await p.write("features/FEAT-41-fresh/intent.md", INTENT("FEAT-41"));
    await p.write(
      "features/FEAT-41-fresh/specs/payment-service/asyncapi.yaml",
      `asyncapi: 3.0.0
channels:
  freshEvents:
    address: payment.fresh.v1
operations:
  sendFresh:
    action: send
    channel:
      $ref: '#/channels/freshEvents'
components:
  messages:
    Legacy:
      name: payment.Fresh
      payload:
        type: object
`,
    );
    // Even the reused `components.messages.Legacy` KEY is silent: a message is
    // its name, and payment.Fresh was never retired.
    expect(await eventFindings(p, "FEAT-41")).toEqual([]);
  });

  it("a message an archived feature MOVED to another key, quoted at the key it left: refused unpinned, and baseline-invalid says where it went when pinned", async () => {
    // The event axis's one slot move: a components.messages marker whose name
    // the same delta declares again under another key. A quote of the old key
    // read as nothing at all — the name is living (so no revival candidate)
    // and the key is empty (so no baseline) — and archived the name back at
    // its old key beside the new one.
    const LEGACY_QUOTE = `asyncapi: 3.0.0
components:
  messages:
    Legacy:
      name: payment.Legacy
      payload:
        type: object
        properties:
          paymentId:
            type: string
`;
    const p = await makeProject({
      "services/payment-service/spec.md": EVENTS_SPEC,
      "services/payment-service/asyncapi.yaml": LIVING_EVENTS,
      "features/FEAT-44-rekey-legacy/intent.md": INTENT("FEAT-44"),
      "features/FEAT-44-rekey-legacy/specs/payment-service/asyncapi.yaml": `asyncapi: 3.0.0
channels:
  legacyEvents:
    address: payment.legacy.v1
    messages:
      Legacy:
        $ref: '#/components/messages/LegacyV2'
components:
  messages:
    Legacy:
      name: payment.Legacy
      x-loam-remove: true
    LegacyV2:
      name: payment.Legacy
      payload:
        type: object
        properties:
          paymentId:
            type: string
`,
      "features/FEAT-45-quote-legacy/intent.md": INTENT("FEAT-45"),
      "features/FEAT-45-quote-legacy/specs/payment-service/asyncapi.yaml": LEGACY_QUOTE,
      // Pinned while Legacy still stood at its old key — what rebase wrote then.
      "features/FEAT-46-pinned-legacy/intent.md": INTENT("FEAT-46"),
      "features/FEAT-46-pinned-legacy/specs/payment-service/asyncapi.yaml": pinAsyncapi(LEGACY_QUOTE, LIVING_EVENTS),
    });
    cleanups.push(() => p.destroy());
    // --approve past the channel restated unpinned: setup, not the subject.
    const rekeyed = await runLoam(p.workDir, "archive", "FEAT-44", "--approve");
    expect(rekeyed.code, rekeyed.out).toBe(0);
    const living = await p.read("services/payment-service/asyncapi.yaml");
    expect(living).toContain("LegacyV2:");
    expect(living).not.toMatch(/^ {4}Legacy:/m);

    const [warned, ...more] = await eventFindings(p, "FEAT-45");
    expect(more).toEqual([]);
    expect(warned!.message).toContain("declares message 'payment.Legacy' at components.messages.Legacy, a key the living contract no longer has");
    expect(warned!.message).toContain("archived FEAT-44 moved it to components.messages.LegacyV2, where it is declared now");

    const pinned = findings((await runLoam(p.workDir, "validate", "--feature", "FEAT-46", "--json")).stdout);
    const [invalid] = ofCode(pinned, "asyncapi.baseline-invalid");
    expect(invalid!.message).toContain("message 'payment.Legacy' is declared at components.messages.LegacyV2 now: a parallel feature moved it");
    expect(invalid!.message).not.toContain("past `asyncapi.slot-revived`");
    expect(ofCode(pinned, "asyncapi.slot-revived")).toHaveLength(1);
  });
});

describe("the index is read once per invocation", () => {
  it("one FleetContext shares one walk; a new invocation builds its own", async () => {
    const p = await makeProject({ "services/payment-service/spec.md": EVENTS_SPEC });
    cleanups.push(() => p.destroy());
    const docsDir = docsDirOf(p.docsDir);
    const run = new FleetContext();
    const first = retiredLookup(docsDir, run)();
    expect(retiredLookup(docsDir, run)()).toBe(first);
    expect(retiredLookup(docsDir, new FleetContext())()).not.toBe(first);
    await first;
  });
});
