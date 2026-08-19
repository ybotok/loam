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
        properties:
          paymentId:
            type: string
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

  it("never joins on anything inside a payload — the property that keeps Avro a document change", async () => {
    // A payload contributes no NAME to the join, ever: a `name` or `fields`
    // key down there must never leak into the spine, or swapping JSON Schema
    // for Avro stops being free. (The depth probe does read key PRESENCE
    // inside a payload — whether any shape is declared at all — but it
    // contributes no name and skips non-JSON schemaFormats; this test pins
    // that the join stays clean.)
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
    expect(doc).toEqual({
      messages: [],
      sent: [],
      received: [],
      duplicateNames: [],
      unreadable: false,
      danglingRefs: [],
      markers: [],
    });
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

  it("errors on a living contract carrying x-loam-remove, naming the slot", async () => {
    // The marker is feature-delta bookkeeping; published into a living
    // contract it is `openapi.remove-marker-living`'s breach on the event
    // axis. The marker also stops the declaration joining (that is its
    // meaning in a delta), so the test asserts this finding by name rather
    // than an exact set — the newly stranded edge is the marker's own doing.
    const files = fleet({
      "services/payment-service/asyncapi.yaml": PRODUCER.replace(
        "    PaymentAuthorized:\n      name: payment.PaymentAuthorized",
        "    PaymentAuthorized:\n      x-loam-remove: true\n      name: payment.PaymentAuthorized",
      ),
    });
    await withProject(files, {}, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--service", "payment-service", "--json");
      const finding = JSON.parse(res.stdout).targets[0].findings.find(
        (f: { code: string }) => f.code === "asyncapi.remove-marker-living",
      );
      expect(finding.severity).toBe("error");
      expect(finding.message).toContain("components.messages.PaymentAuthorized");
      expect(res.code).toBe(1);
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

/* ------------------------------------------------------------------ */
/* the contract-depth probes — presence, never a field join            */
/* ------------------------------------------------------------------ */

describe("payloadEmpty — does the payload declare any shape at all", () => {
  it("flags a bare type: object and an absent payload; a full schema stays unflagged", async () => {
    const doc = await parseDoc(`asyncapi: 3.0.0
components:
  messages:
    Bare:
      name: payment.Bare
      payload:
        type: object
    Missing:
      name: payment.Missing
    Full:
      name: payment.Full
      payload:
        type: object
        properties:
          id:
            type: string
`);
    const flag = (n: string) => doc.messages.find((m) => m.name === n)?.payloadEmpty;
    expect(flag("payment.Bare")).toBe(true);
    expect(flag("payment.Missing")).toBe(true);
    expect(flag("payment.Full")).toBeUndefined();
  });

  it("never judges a non-JSON schemaFormat — Avro stays a document change", async () => {
    const doc = await parseDoc(`asyncapi: 3.0.0
components:
  messages:
    Avro:
      name: payment.Avro
      payload:
        schemaFormat: application/vnd.apache.avro;version=1.9.0
        schema:
          type: record
`);
    expect(doc.messages[0]!.payloadEmpty).toBeUndefined();
  });

  it("a dangling payload $ref is the ref probe's finding, not an emptiness one", async () => {
    const doc = await parseDoc(`asyncapi: 3.0.0
components:
  messages:
    Ghost:
      name: payment.Ghost
      payload:
        $ref: '#/components/schemas/NoSuchSchema'
`);
    expect(doc.messages[0]!.payloadEmpty).toBeUndefined();
    expect(doc.danglingRefs).toEqual(["#/components/schemas/NoSuchSchema"]);
  });
});

describe("danglingRefs — internal $refs that resolve to nothing", () => {
  it("catches both silent-skip sites: the channel alias and the operation's message list", async () => {
    // Both used to vanish without a trace: an operation-list entry that derefs
    // to nothing "contributes no name", and a channel alias whose target is
    // gone leaves a phantom local key behind. The probe names the pointers.
    const doc = await parseDoc(`asyncapi: 3.0.0
channels:
  c:
    messages:
      Ghost:
        $ref: '#/components/messages/NoSuchMessage'
operations:
  send:
    action: send
    channel:
      $ref: '#/channels/c'
    messages:
      - $ref: '#/components/messages/AlsoMissing'
`);
    expect(doc.danglingRefs).toEqual([
      "#/components/messages/NoSuchMessage",
      "#/components/messages/AlsoMissing",
    ]);
  });
});

describe("validate --service: contract depth on the event axis", () => {
  it("warns asyncapi.payload-undescribed and names the empty message", async () => {
    const files = fleet({
      "services/notification-service/asyncapi.yaml": `asyncapi: 3.0.0
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
`,
    });
    await withProject(files, {}, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--service", "notification-service", "--json");
      expect(res.code).toBe(0); // warn, not a gate
      const f = JSON.parse(res.stdout).targets[0].findings.find(
        (x: { code: string }) => x.code === "asyncapi.payload-undescribed",
      );
      expect(f).toBeDefined();
      expect(f.severity).toBe("warn");
      expect(f.message).toContain("payment.PaymentAuthorized");
    });
  });

  it("warns asyncapi.ref-unresolved with the pointers in details", async () => {
    const files = fleet({
      "services/payment-service/asyncapi.yaml": PRODUCER.replace(
        "$ref: '#/channels/paymentEvents/messages/PaymentAuthorized'",
        "$ref: '#/components/messages/NoSuchMessage'",
      ),
    });
    await withProject(files, {}, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--service", "payment-service", "--json");
      const f = JSON.parse(res.stdout).targets[0].findings.find(
        (x: { code: string }) => x.code === "asyncapi.ref-unresolved",
      );
      expect(f).toBeDefined();
      expect(f.severity).toBe("warn");
      expect(f.details).toEqual(["#/components/messages/NoSuchMessage"]);
    });
  });
});

/* ------------------------------------------------------------------ */
/* spine.message-external — a producer outside the fleet               */
/* ------------------------------------------------------------------ */

/** notification-service consumes a message only an #external element produces. */
function externalFleet(over: Record<string, string> = {}): Record<string, string> {
  return {
    "architecture/landscape.likec4": `specification {
  element softwareSystem
  tag external
}

model {
  notificationService = softwareSystem 'notification-service'
  externalConfig = softwareSystem 'external-config' {
    #external
  }
  kafka = softwareSystem 'kafka' {
    #external
  }
  externalConfig -> kafka 'publishes config refreshes' {
    metadata { publishes 'config.ConfigRefreshed' }
  }
  kafka -> notificationService 'config refreshes' {
    metadata { consumes 'config.ConfigRefreshed' }
  }
}
`,
    "services/notification-service/model.likec4": model("notification-service", "notificationService"),
    "services/notification-service/asyncapi.yaml": `asyncapi: 3.0.0
info:
  title: notification-service events
  version: "1.0"
channels:
  configTopic:
    address: config_topic
    messages:
      ConfigEvent:
        $ref: '#/components/messages/ConfigEvent'
operations:
  receiveConfig:
    action: receive
    channel:
      $ref: '#/channels/configTopic'
components:
  messages:
    ConfigEvent:
      name: config.ConfigRefreshed
      payload:
        type: object
        properties:
          tenant:
            type: string
`,
    ...over,
  };
}

describe("spine.message-external — the producer is outside the fleet", () => {
  it("a carried contract closes the question: no unproduced, no external, spine covered", async () => {
    await withProject(externalFleet(), {}, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--service", "notification-service", "--json");
      expect(res.code).toBe(0);
      const codes = (JSON.parse(res.stdout).targets[0].findings as { code: string }[]).map((f) => f.code);
      expect(codes).not.toContain("spine.message-unproduced");
      expect(codes).not.toContain("spine.message-external");
      expect(codes).toContain("event.covered");
    });
  });

  it("warns spine.message-external while the consumer's own contract defines no shape", async () => {
    const files = externalFleet();
    files["services/notification-service/asyncapi.yaml"] = files[
      "services/notification-service/asyncapi.yaml"
    ]!.replace(
      `      payload:
        type: object
        properties:
          tenant:
            type: string
`,
      `      payload:
        type: object
`,
    );
    await withProject(files, {}, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--service", "notification-service", "--json");
      expect(res.code).toBe(0); // warn, not the old error — honesty no longer costs a red build
      const findings = JSON.parse(res.stdout).targets[0].findings as { code: string; message: string }[];
      const f = findings.find((x) => x.code === "spine.message-external");
      expect(f).toBeDefined();
      expect(f!.message).toContain("outside the fleet");
      expect(f!.message).toContain("'external-config'");
      expect(findings.some((x) => x.code === "spine.message-unproduced")).toBe(false);
    });
  });

  it("an untagged source is still unproduced — the demotion requires the tag", async () => {
    const files = externalFleet();
    files["architecture/landscape.likec4"] = files["architecture/landscape.likec4"]!.replace(
      `  externalConfig = softwareSystem 'external-config' {
    #external
  }`,
      `  externalConfig = softwareSystem 'external-config'`,
    );
    await withProject(files, {}, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--service", "notification-service", "--json");
      expect(res.code).toBe(1);
      const codes = (JSON.parse(res.stdout).targets[0].findings as { code: string }[]).map((f) => f.code);
      expect(codes).toContain("spine.message-unproduced");
      expect(codes).not.toContain("spine.message-external");
    });
  });

  it("a tag on an element that resolves to a real service does not demote — a directory outranks a tag", async () => {
    const files = externalFleet({
      "services/external-config/model.likec4": model("external-config", "externalConfig"),
    });
    await withProject(files, {}, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--service", "notification-service", "--json");
      const codes = (JSON.parse(res.stdout).targets[0].findings as { code: string }[]).map((f) => f.code);
      // The element resolves into the fleet, so the fleet answer applies: the
      // in-fleet external-config service declares no send — unproduced, not external.
      expect(codes).toContain("spine.message-unproduced");
      expect(codes).not.toContain("spine.message-external");
    });
  });

  it("positive evidence is not suspended by an unreadable contract elsewhere", async () => {
    const files = externalFleet({
      "services/svc-b/model.likec4": model("svc-b", "svcB"),
      "services/svc-b/asyncapi.yaml": "channels: [unclosed\n",
    });
    files["services/notification-service/asyncapi.yaml"] = files[
      "services/notification-service/asyncapi.yaml"
    ]!.replace(
      `        properties:
          tenant:
            type: string
`,
      "",
    );
    await withProject(files, {}, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--service", "notification-service", "--json");
      const codes = (JSON.parse(res.stdout).targets[0].findings as { code: string }[]).map((f) => f.code);
      // The unreadable contract suspends the argument from absence
      // (unproduced), never the positive one (external).
      expect(codes).toContain("spine.message-external");
      expect(codes).not.toContain("spine.message-unproduced");
    });
  });

  it("a fleet producer beside the external edge wins — no finding of either kind", async () => {
    const files = externalFleet({
      "services/config-relay/model.likec4": model("config-relay", "configRelay"),
      "services/config-relay/asyncapi.yaml": `asyncapi: 3.0.0
info:
  title: config-relay events
  version: "1.0"
channels:
  configTopic:
    address: config_topic
    messages:
      ConfigEvent:
        $ref: '#/components/messages/ConfigEvent'
operations:
  sendConfig:
    action: send
    channel:
      $ref: '#/channels/configTopic'
components:
  messages:
    ConfigEvent:
      name: config.ConfigRefreshed
      payload:
        type: object
        properties:
          tenant:
            type: string
`,
    });
    await withProject(files, {}, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--service", "notification-service", "--json");
      const codes = (JSON.parse(res.stdout).targets[0].findings as { code: string }[]).map((f) => f.code);
      expect(codes).not.toContain("spine.message-unproduced");
      expect(codes).not.toContain("spine.message-external");
      expect(codes).not.toContain("asyncapi.message-contested");
    });
  });
});
