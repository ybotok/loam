/**
 * The async contract axis (AsyncAPI 3) — `src/core/asyncapi.ts` and the event
 * checks in `loam validate --service`.
 *
 * Families:
 *  - the reader: what a document declares, sends and receives
 *  - the reader: payload opacity — the property that keeps Avro a document change
 *  - the reader: unreadable documents are a flag, never an empty parse
 *  - validate: absence graded on what already joins into it
 *  - validate: local resolution (edges and requirement lines)
 *  - validate: the fleet questions (unproduced, contested) — no local answer exists
 */
import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import { readAsyncapi } from "../src/core/asyncapi/read.js";
import { makeProject, makeTmpDir, runLoam, type Project } from "./helpers/harness.js";

async function withProject(
  files: Record<string, string>,
  opts: { service?: string },
  fn: (p: Project) => Promise<void>,
): Promise<void> {
  const p = await makeProject(files, opts);
  try {
    await fn(p);
  } finally {
    await p.destroy();
  }
}

/** Parse a document from bytes, without a docs repo around it. */
async function parseDoc(content: string | Buffer): Promise<Awaited<ReturnType<typeof readAsyncapi>>> {
  const dir = await makeTmpDir("loam-asyncapi-");
  const path = join(dir, "asyncapi.yaml");
  await writeFile(path, content);
  return readAsyncapi(path);
}

/** payment-service: publishes payment.PaymentAuthorized, operation lists its message explicitly. */
const PRODUCER = `asyncapi: 3.0.0
info:
  title: payment-service events
  version: "1.0"
channels:
  paymentEvents:
    address: payment.events.v1
    messages:
      PaymentAuthorized:
        $ref: '#/components/messages/PaymentAuthorized'
operations:
  sendPaymentAuthorized:
    action: send
    channel:
      $ref: '#/channels/paymentEvents'
    messages:
      - $ref: '#/channels/paymentEvents/messages/PaymentAuthorized'
components:
  messages:
    PaymentAuthorized:
      name: payment.PaymentAuthorized
      payload:
        type: object
        required: [paymentId]
        properties:
          paymentId:
            type: string
`;

/**
 * notification-service: receives the same message, and its operation lists NO
 * messages — the AsyncAPI 3 shape that means "every message on this channel",
 * and the shape a minimal hand-written contract actually takes.
 */
const CONSUMER = `asyncapi: 3.0.0
info:
  title: notification-service events
  version: "1.0"
channels:
  paymentEvents:
    address: payment.events.v1
    messages:
      PaymentAuthorized:
        $ref: '#/components/messages/PaymentAuthorized'
operations:
  receivePaymentAuthorized:
    action: receive
    channel:
      $ref: '#/channels/paymentEvents'
components:
  messages:
    PaymentAuthorized:
      name: payment.PaymentAuthorized
      payload:
        type: object
`;

const LANDSCAPE = `specification {
  element softwareSystem
  tag external
}

model {
  paymentService = softwareSystem 'payment-service'
  notificationService = softwareSystem 'notification-service'
  kafka = softwareSystem 'kafka' {
    #external
    description 'Event backbone'
  }

  paymentService -> kafka 'Publishes PaymentAuthorized' {
    metadata { publishes 'payment.PaymentAuthorized' }
  }
  kafka -> notificationService 'PaymentAuthorized' {
    metadata { consumes 'payment.PaymentAuthorized' }
  }
}
`;

function model(svc: string, id: string): string {
  return `specification {
  element softwareSystem
}

model {
  ${id} = softwareSystem '${svc}'
}
`;
}

function spec(svc: string, body = ""): string {
  return `---
service: ${svc}
status: draft
---

# ${svc}

## Requirements

### Requirement: Handle payment events
The service SHALL react to payment lifecycle events.
${body}
#### Scenario: An event arrives
- **Given** a payment event
- **When** it is delivered
- **Then** the service reacts
`;
}

/** The two-service fleet both spines are checked against. */
function fleet(over: Record<string, string> = {}): Record<string, string> {
  return {
    "architecture/landscape.likec4": LANDSCAPE,
    "services/payment-service/model.likec4": model("payment-service", "paymentService"),
    "services/payment-service/spec.md": spec("payment-service", "\nPublishes: payment.PaymentAuthorized\n"),
    "services/payment-service/asyncapi.yaml": PRODUCER,
    "services/notification-service/model.likec4": model("notification-service", "notificationService"),
    "services/notification-service/spec.md": spec("notification-service", "\nConsumes: payment.PaymentAuthorized\n"),
    "services/notification-service/asyncapi.yaml": CONSUMER,
    ...over,
  };
}

/** Finding codes `validate --service <svc>` reports, in report order. */
async function codesFor(p: Project, svc: string): Promise<string[]> {
  const res = await runLoam(p.workDir, "validate", "--service", svc, "--json");
  const json = JSON.parse(res.stdout);
  return (json.targets[0].findings as { code: string }[]).map((f) => f.code);
}

describe("readAsyncapi", () => {
  it("reads a message's name, and which operations send and receive it", async () => {
    const doc = await parseDoc(PRODUCER);
    expect(doc.unreadable).toBe(false);
    expect(doc.messages).toEqual([{ name: "payment.PaymentAuthorized", slot: "components.messages.PaymentAuthorized" }]);
    expect(doc.sent).toEqual(["payment.PaymentAuthorized"]);
    expect(doc.received).toEqual([]);
  });

  it("an operation listing no messages applies to every message on its channel", async () => {
    // The minimal hand-written shape. Reading it as "receives nothing" would
    // report the common case broken, and it is the case a fleet with no schema
    // registry actually writes.
    const doc = await parseDoc(CONSUMER);
    expect(doc.received).toEqual(["payment.PaymentAuthorized"]);
    expect(doc.sent).toEqual([]);
  });

  it("falls back to the declaration key when a message declares no name", async () => {
    const doc = await parseDoc(`asyncapi: 3.0.0
channels:
  c:
    messages:
      OrderPlaced:
        $ref: '#/components/messages/OrderPlaced'
operations:
  send:
    action: send
    channel:
      $ref: '#/channels/c'
components:
  messages:
    OrderPlaced:
      payload:
        type: object
`);
    expect(doc.messages.map((m) => m.name)).toEqual(["OrderPlaced"]);
    expect(doc.sent).toEqual(["OrderPlaced"]);
  });

  it("a channel entry that is a $ref is an alias, not a second declaration", async () => {
    // Every properly factored document aliases its components under channels.
    // Counting the alias would report each message as declared twice, so
    // `asyncapi.duplicate-message` would fire on the spec's own example shape.
    const doc = await parseDoc(PRODUCER);
    expect(doc.duplicateNames).toEqual([]);
    expect(doc.messages).toHaveLength(1);
  });

  it("names one message declared in two slots", async () => {
    const doc = await parseDoc(`asyncapi: 3.0.0
channels:
  c:
    messages:
      Inline:
        name: payment.PaymentAuthorized
        payload:
          type: object
components:
  messages:
    Componentised:
      name: payment.PaymentAuthorized
      payload:
        type: object
`);
    expect(doc.duplicateNames).toEqual(["payment.PaymentAuthorized"]);
    expect(doc.messages.map((m) => m.slot)).toEqual([
      "components.messages.Componentised",
      "channels.c.messages.Inline",
    ]);
  });

  it("never reads inside a payload — the property that keeps Avro a document change", async () => {
    // A payload is opaque bytes to loam. If anything here ever started reading
    // into it, a `name` or `fields` key down there would leak into the join —
    // and swapping JSON Schema for Avro would stop being free.
    const doc = await parseDoc(`asyncapi: 3.0.0
channels:
  c:
    messages:
      Real:
        name: payment.Real
        payload:
          type: object
          properties:
            name:
              type: string
              const: payment.Phantom
          fields:
            - name: payment.AlsoPhantom
`);
    expect(doc.messages.map((m) => m.name)).toEqual(["payment.Real"]);
  });

  it("an absent file declares nothing and is not unreadable", async () => {
    const doc = await readAsyncapi(join(await makeTmpDir("loam-asyncapi-"), "nope.yaml"));
    expect(doc).toEqual({ messages: [], sent: [], received: [], duplicateNames: [], unreadable: false });
  });

  it("grades broken YAML, non-UTF-8 bytes and a non-mapping document as unreadable", async () => {
    const broken = await parseDoc("channels: [unclosed\n");
    expect(broken.unreadable).toBe(true);
    expect(broken.error).toBeDefined();

    const notUtf8 = await parseDoc(Buffer.from([0x61, 0xff, 0xfe, 0x62]));
    expect(notUtf8.unreadable).toBe(true);
    expect(notUtf8.error).toContain("UTF-8");

    const sequence = await parseDoc("- a\n- b\n");
    expect(sequence.unreadable).toBe(true);
    expect(sequence.error).toContain("mapping");

    // An EMPTY file is readable and honestly declares nothing — the distinction
    // `service.no-asyncapi` and `asyncapi.invalid` are graded apart on.
    const empty = await parseDoc("");
    expect(empty.unreadable).toBe(false);
    expect(empty.messages).toEqual([]);
  });

  it("does not hang on a $ref cycle", async () => {
    const doc = await parseDoc(`asyncapi: 3.0.0
components:
  messages:
    Loop:
      $ref: '#/components/messages/Loop'
`);
    expect(doc.unreadable).toBe(false);
    expect(doc.sent).toEqual([]);
  });
});

describe("validate --service: the event axis", () => {
  it("confirms a resolved spine on both sides of one message", async () => {
    await withProject(fleet(), {}, async (p) => {
      expect(await codesFor(p, "payment-service")).toContain("event.covered");
      expect(await codesFor(p, "notification-service")).toContain("event.covered");
    });
  });

  it("errors when the contract is absent and links already point into it", async () => {
    const files = fleet();
    delete files["services/payment-service/asyncapi.yaml"];
    await withProject(files, {}, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--service", "payment-service", "--json");
      const finding = JSON.parse(res.stdout).targets[0].findings.find(
        (f: { code: string }) => f.code === "service.no-asyncapi",
      );
      expect(finding.severity).toBe("error");
      // Both joins are stranded and both ride in details: the edge's metadata
      // and the requirement's Publishes: line name the same message.
      expect(finding.details).toEqual(["payment.PaymentAuthorized"]);
      expect(res.code).toBe(1);
    });
  });

  it("says nothing when the contract is absent and nothing joins into it", async () => {
    // The deliberate asymmetry with service.no-openapi, which warns here. Most
    // services in a legacy fleet touch no topic; a finding on every one of them
    // would name a file nobody owes.
    const files = fleet();
    delete files["services/payment-service/asyncapi.yaml"];
    delete files["services/notification-service/asyncapi.yaml"];
    files["architecture/landscape.likec4"] = LANDSCAPE.replace(/\n\s*metadata \{ (?:publishes|consumes)[^}]*\}/g, "");
    files["services/payment-service/spec.md"] = spec("payment-service");
    files["services/notification-service/spec.md"] = spec("notification-service");
    await withProject(files, {}, async (p) => {
      expect(await codesFor(p, "payment-service")).not.toContain("service.no-asyncapi");
      expect(await codesFor(p, "notification-service")).not.toContain("service.no-asyncapi");
    });
  });

  it("suspends the axis when the contract exists but does not parse", async () => {
    await withProject(fleet({ "services/payment-service/asyncapi.yaml": "channels: [unclosed\n" }), {}, async (p) => {
      const codes = await codesFor(p, "payment-service");
      expect(codes).toContain("asyncapi.invalid");
      // The file is the error, exactly once — not one broken-edge finding per
      // link, which is what grading against an empty parse would produce.
      expect(codes).not.toContain("spine.message-undefined");
      expect(codes).not.toContain("spec-event.message-undefined");
    });
  });

  it("errors on a landscape edge the service's own contract does not declare", async () => {
    const files = fleet({
      "architecture/landscape.likec4": LANDSCAPE.replace(
        "publishes 'payment.PaymentAuthorized'",
        "publishes 'payment.PaymentCaptured'",
      ),
    });
    await withProject(files, {}, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--service", "payment-service", "--json");
      const finding = JSON.parse(res.stdout).targets[0].findings.find(
        (f: { code: string }) => f.code === "spine.message-undefined",
      );
      expect(finding.severity).toBe("error");
      expect(finding.message).toContain("action: send");
    });
  });

  it("reads Publishes:/Consumes: from arch.spec.md as well as spec.md", async () => {
    // Events are architecture at least as often as they are business — the
    // outbox requirement is the canonical home of a `Publishes:` line — so an
    // axis that read only spec.md would ignore the file most authors use.
    const files = fleet({
      "services/payment-service/spec.md": spec("payment-service"),
      "services/payment-service/arch.spec.md": `---
service: payment-service
status: draft
---

# payment-service — architecture

## Requirements

### Requirement: Events leave through the transactional outbox
The service SHALL publish through an outbox relay, never a dual write.

Publishes: payment.Typo

#### Scenario: Broker down at commit time
- **Given** an event in the outbox
- **When** the broker is unavailable
- **Then** it is published once the broker returns
`,
    });
    await withProject(files, {}, async (p) => {
      expect(await codesFor(p, "payment-service")).toContain("spec-event.message-undefined");
    });
  });

  it("errors on a requirement line the service's own contract does not declare", async () => {
    const files = fleet({
      "services/payment-service/spec.md": spec("payment-service", "\nPublishes: payment.Typo\n"),
    });
    await withProject(files, {}, async (p) => {
      expect(await codesFor(p, "payment-service")).toContain("spec-event.message-undefined");
    });
  });

  it("errors when a consumed message has no producer anywhere in the fleet", async () => {
    // The inverted check, and the one with no HTTP analog: the schema a consumer
    // joins to lives in the producer's repository, so no local file can answer it.
    const files = fleet();
    delete files["services/payment-service/asyncapi.yaml"];
    files["services/payment-service/spec.md"] = spec("payment-service");
    files["architecture/landscape.likec4"] = LANDSCAPE.replace(
      /paymentService -> kafka[\s\S]*?\n {2}\}\n/,
      "",
    );
    await withProject(files, {}, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--service", "notification-service", "--json");
      const finding = JSON.parse(res.stdout).targets[0].findings.find(
        (f: { code: string }) => f.code === "spine.message-unproduced",
      );
      expect(finding.severity).toBe("error");
      expect(finding.message).toContain("payment.PaymentAuthorized");
    });
  });

  it("an unreadable producer contract does not make its messages look unproduced", async () => {
    // One broken file in one repository would otherwise become one
    // `spine.message-unproduced` per consuming edge across the whole fleet,
    // every one of them pointing at the wrong repository. The producer's own
    // `asyncapi.invalid` is the finding; nobody else's spine is graded on it.
    const files = fleet({ "services/payment-service/asyncapi.yaml": "channels: [unclosed\n" });
    await withProject(files, {}, async (p) => {
      const codes = await codesFor(p, "notification-service");
      expect(codes).not.toContain("spine.message-unproduced");
      expect(await codesFor(p, "payment-service")).toContain("asyncapi.invalid");
    });
  });

  it("warns when two services declare they send one message", async () => {
    const files = fleet({
      "services/notification-service/asyncapi.yaml": PRODUCER.replace(
        "action: receive",
        "action: send",
      ).replace("receivePaymentAuthorized", "sendPaymentAuthorized"),
    });
    await withProject(files, {}, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--service", "notification-service", "--json");
      const finding = JSON.parse(res.stdout).targets[0].findings.find(
        (f: { code: string }) => f.code === "asyncapi.message-contested",
      );
      expect(finding.severity).toBe("warn");
      expect(finding.message).toContain("notification-service");
      expect(finding.message).toContain("payment-service");
    });
  });

  it("warns when a duplicate name makes every join ambiguous", async () => {
    const files = fleet({
      "services/payment-service/asyncapi.yaml": PRODUCER.replace(
        "components:\n  messages:",
        `components:
  messages:
    Shadow:
      name: payment.PaymentAuthorized
      payload:
        type: object`,
      ),
    });
    await withProject(files, {}, async (p) => {
      expect(await codesFor(p, "payment-service")).toContain("asyncapi.duplicate-message");
    });
  });

  it("warns when messages and requirements exist but nothing links them", async () => {
    const files = fleet({ "services/payment-service/spec.md": spec("payment-service") });
    // The landscape edge would still resolve, so drop it too: this is the
    // migration-debt state, where the axis is vacuously green.
    files["architecture/landscape.likec4"] = LANDSCAPE.replace(
      "metadata { publishes 'payment.PaymentAuthorized' }",
      "",
    );
    await withProject(files, {}, async (p) => {
      expect(await codesFor(p, "payment-service")).toContain("event.messages-unlinked");
    });
  });
});
