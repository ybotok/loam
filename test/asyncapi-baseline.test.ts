/**
 * The event-contract baseline: slot identity, `x-loam-based-on`, and the
 * pins `loam rebase` writes on the asyncapi axis.
 *
 * The digest RULE is the OpenAPI axis's, imported rather than respelled
 * (core/asyncapi/digest.ts), so these tests pin the asyncapi-specific half:
 * what a SLOT is — (section, key) over channels / operations /
 * components.messages, with inline channel messages deliberately interior
 * to their channel — and that `loam rebase` stamps the same quote/edit
 * distinction into a feature's asyncapi.yaml that it stamps into its
 * openapi.yaml.
 *
 * Families:
 *  - the digest: canonical, pin-excluded, payload bytes as content identity
 *  - the slot model: three sections; inline channel messages are interior
 *  - the reader: a removal marker joins nothing
 *  - the pin: statuses, idempotence, alias refusal
 *  - `loam rebase`: pins/repins/unresolved/dry-run through the real command
 */
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import {
  asyncapiSlots,
  isSlotRemoval,
  slotBaselineOf,
  slotDigest,
} from "../src/core/asyncapi/digest.js";
import { classifyBaselineDigests } from "../src/core/openapi/digest.js";
import { pinAsyncapiSlots } from "../src/core/asyncapi/merge/pin.js";
import { readAsyncapi } from "../src/core/asyncapi/read.js";
import { featureCoherence } from "../src/core/coherence/coherence.js";
import { gatesArchive, type Issue } from "../src/core/vocabulary/issue.js";
import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import { coherentFixture, makeProject, makeTmpDir, runLoam, treeHashes } from "./helpers/harness.js";

const SVC = "payment-service";

/**
 * A living-shaped event contract whose message DESCRIPTION is the knob: one
 * channel, one send operation, one components message — three slots. Editing
 * the description edits only the `components.messages.PaymentAuthorized`
 * slot; the channel and the operation stay quotes.
 */
function eventContract(description: string): string {
  return `asyncapi: 3.0.0
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
components:
  messages:
    PaymentAuthorized:
      name: payment.PaymentAuthorized
      description: ${description}
      payload:
        type: object
        properties:
          paymentId:
            type: string
`;
}

const LIVING_EVENTS = eventContract("Authorization landed");

const slotOf = (yaml: string, section: string, key: string): unknown => {
  const slot = asyncapiSlots(parseYaml(yaml)).find((s) => s.section === section && s.key === key);
  return slot?.node;
};

/* ------------------------------------------------------------------ */
/* The digest                                                          */
/* ------------------------------------------------------------------ */

describe("slotDigest is the shared digest rule over asyncapi slots", () => {
  it("ignores key order, arrays stay content", () => {
    const a = { address: "payment.events.v1", messages: { A: { name: "a" } } };
    const b = { messages: { A: { name: "a" } }, address: "payment.events.v1" };
    expect(slotDigest(a)).toBe(slotDigest(b));
    expect(slotDigest({ tags: ["a", "b"] })).not.toBe(slotDigest({ tags: ["b", "a"] }));
  });

  it("excludes the pin, so a slot's identity never depends on the pin naming it", () => {
    const slot = { action: "send", channel: { $ref: "#/channels/paymentEvents" } };
    expect(slotDigest({ ...slot, "x-loam-based-on": "0123456789abcdef" })).toBe(slotDigest(slot));
  });

  it("hashes payload bytes as content identity — a payload change moves the digest, in every section", () => {
    // Content identity is not a join: nothing here reads a field INTO the
    // spine, but a changed payload is a changed slot, and the pin must say so.
    for (const [section, key] of [
      ["channels", "paymentEvents"],
      ["operations", "sendPaymentAuthorized"],
      ["components.messages", "PaymentAuthorized"],
    ] as const) {
      const before = slotOf(LIVING_EVENTS, section, key);
      const after = slotOf(
        LIVING_EVENTS.replace("paymentId:\n            type: string", "paymentId:\n            type: number"),
        section,
        key,
      );
      // Only the message slot carries the payload, so only its digest moves.
      if (section === "components.messages") expect(slotDigest(after)).not.toBe(slotDigest(before));
      else expect(slotDigest(after)).toBe(slotDigest(before));
    }
  });

  it("is 16 lowercase hex characters, like every other digest loam stamps", () => {
    expect(slotDigest({ address: "x" })).toMatch(/^[0-9a-f]{16}$/);
  });
});

/* ------------------------------------------------------------------ */
/* The slot model                                                      */
/* ------------------------------------------------------------------ */

describe("asyncapiSlots — the three sections, and nothing else", () => {
  it("enumerates channels, operations and components.messages with digests and pins", () => {
    const pinned = LIVING_EVENTS.replace(
      "    address: payment.events.v1",
      "    address: payment.events.v1\n    x-loam-based-on: 0123456789abcdef",
    );
    const slots = asyncapiSlots(parseYaml(pinned));
    expect(slots.map((s) => [s.section, s.key])).toEqual([
      ["channels", "paymentEvents"],
      ["operations", "sendPaymentAuthorized"],
      ["components.messages", "PaymentAuthorized"],
    ]);
    expect(slots[0]!.basedOn).toBe("0123456789abcdef");
    expect(slots[1]!.basedOn).toBeUndefined();
    expect(slots.every((s) => /^[0-9a-f]{16}$/.test(s.digest))).toBe(true);
  });

  it("treats an inline channel message as channel interior, never as a slot of its own", () => {
    // SCHEMA.md's recorded decision: channels.<ck>.messages.<mk> declared
    // inline (no $ref) is part of the channels.<ck> slot's content. It gets
    // no slot — so no pin of its own — and editing it moves the CHANNEL's
    // digest, which is what makes the channel an edit.
    const inline = (desc: string): string => `asyncapi: 3.0.0
channels:
  orders:
    address: orders.v1
    messages:
      OrderPlaced:
        name: orders.OrderPlaced
        description: ${desc}
`;
    const slots = asyncapiSlots(parseYaml(inline("v1")));
    expect(slots.map((s) => [s.section, s.key])).toEqual([["channels", "orders"]]);
    expect(slotDigest(slotOf(inline("v1"), "channels", "orders"))).not.toBe(
      slotDigest(slotOf(inline("v2"), "channels", "orders")),
    );
  });

  it("marks removal slots and stringifies a non-string pin so the gate can refuse it", () => {
    const doc = parseYaml(`asyncapi: 3.0.0
components:
  messages:
    Old:
      name: orders.Old
      x-loam-remove: true
`);
    const [slot] = asyncapiSlots(doc);
    expect(slot!.remove).toBe(true);
    expect(isSlotRemoval(slot!.node)).toBe(true);
    expect(slotBaselineOf({ "x-loam-based-on": 42 })).toBe("42");
  });
});

/* ------------------------------------------------------------------ */
/* The verdict                                                         */
/* ------------------------------------------------------------------ */

describe("slot digests feed the shared verdict classifier", () => {
  const living = slotOf(LIVING_EVENTS, "components.messages", "PaymentAuthorized");
  const pin = slotDigest(living);
  const edited = slotOf(eventContract("Authorization landed, with splits"), "components.messages", "PaymentAuthorized");
  const moved = slotOf(eventContract("Someone else's change"), "components.messages", "PaymentAuthorized");

  it("yields quote / edit / stale / unfounded / unpinned exactly as on the openapi axis", () => {
    expect(classifyBaselineDigests(undefined, slotDigest(living), pin)).toBe("unpinned");
    expect(classifyBaselineDigests(pin, pin, slotDigest(moved))).toBe("quote");
    expect(classifyBaselineDigests(pin, slotDigest(edited), pin)).toBe("edit");
    expect(classifyBaselineDigests(pin, slotDigest(edited), slotDigest(moved))).toBe("stale");
    expect(classifyBaselineDigests(pin, slotDigest(living), undefined)).toBe("unfounded");
  });
});

/* ------------------------------------------------------------------ */
/* The reader                                                          */
/* ------------------------------------------------------------------ */

describe("a removal marker joins nothing", () => {
  it("lists the marked declaration with `remove` and keeps it out of sent/received and duplicates", async () => {
    const dir = await makeTmpDir("loam-asyncapi-baseline-");
    const path = join(dir, "asyncapi.yaml");
    await writeFile(path, `asyncapi: 3.0.0
channels:
  paymentEvents:
    messages:
      PaymentAuthorized:
        $ref: '#/components/messages/PaymentAuthorized'
operations:
  sendPaymentAuthorized:
    action: send
    channel:
      $ref: '#/channels/paymentEvents'
components:
  messages:
    PaymentAuthorized:
      name: payment.PaymentAuthorized
      x-loam-remove: true
`);
    const doc = await readAsyncapi(path);
    expect(doc.messages).toEqual([
      { name: "payment.PaymentAuthorized", slot: "components.messages.PaymentAuthorized", remove: true },
    ]);
    // The operation resolves its channel's messages, but the one message is
    // being retired — it must not read as something the service produces.
    expect(doc.sent).toEqual([]);
    expect(doc.duplicateNames).toEqual([]);
    expect(doc.markers).toEqual(["components.messages.PaymentAuthorized"]);
  });
});

/* ------------------------------------------------------------------ */
/* The pin                                                             */
/* ------------------------------------------------------------------ */

describe("pinAsyncapiSlots", () => {
  it("pins every slot to the LIVING version, which is what yields both verdicts", () => {
    const edited = eventContract("Authorization landed, with splits");
    const plan = pinAsyncapiSlots(edited, LIVING_EVENTS, SVC);
    expect(plan.pins.map((p) => [p.section, p.key, p.status])).toEqual([
      ["channels", "paymentEvents", "pinned"],
      ["operations", "sendPaymentAuthorized", "pinned"],
      ["components.messages", "PaymentAuthorized", "pinned"],
    ]);
    // The quoted channel equals its pin; the edited message differs from it.
    const channel = slotOf(plan.text!, "channels", "paymentEvents");
    expect(slotBaselineOf(channel)).toBe(slotDigest(channel));
    const message = slotOf(plan.text!, "components.messages", "PaymentAuthorized");
    expect(slotBaselineOf(message)).not.toBe(slotDigest(message));
    expect(slotBaselineOf(message)).toBe(slotDigest(slotOf(LIVING_EVENTS, "components.messages", "PaymentAuthorized")));
  });

  it("is idempotent, and reports the second run as unchanged", () => {
    const once = pinAsyncapiSlots(eventContract("edited"), LIVING_EVENTS, SVC);
    const twice = pinAsyncapiSlots(once.text!, LIVING_EVENTS, SVC);
    expect(twice.text).toBeNull();
    expect(twice.pins.every((p) => p.status === "unchanged")).toBe(true);
  });

  it("invents nothing for a slot the living contract does not have", () => {
    const added = `asyncapi: 3.0.0
channels:
  splitEvents:
    address: payment.splits.v1
`;
    const plan = pinAsyncapiSlots(added, LIVING_EVENTS, SVC);
    expect(plan.text).toBeNull();
    expect(plan.pins).toEqual([
      expect.objectContaining({ section: "channels", key: "splitEvents", status: "unresolved", to: null }),
    ]);
  });

  it("leaves a removal marker unpinned — its own slot check is what guards it", () => {
    const removing = `asyncapi: 3.0.0
components:
  messages:
    PaymentAuthorized:
      name: payment.PaymentAuthorized
      x-loam-remove: true
`;
    const plan = pinAsyncapiSlots(removing, LIVING_EVENTS, SVC);
    expect(plan.pins).toEqual([]);
    expect(plan.text).toBeNull();
  });

  it("refuses to stamp through a YAML alias rather than pinning every use of the anchor", () => {
    const aliased = `asyncapi: 3.0.0
channels:
  paymentEvents: &chan
    address: payment.events.v1
    messages:
      PaymentAuthorized:
        $ref: '#/components/messages/PaymentAuthorized'
  paymentEventsMirror: *chan
operations:
  sendPaymentAuthorized:
    action: send
    channel:
      $ref: '#/channels/paymentEvents'
components:
  messages:
    PaymentAuthorized:
      name: payment.PaymentAuthorized
      description: edited here
      payload:
        type: object
        properties:
          paymentId:
            type: string
`;
    // The living contract carries BOTH channel keys, so the alias reaches the
    // write attempt itself — an absent living slot would be `unresolved`
    // before the alias mattered.
    const livingWithMirror = LIVING_EVENTS.replace(
      "operations:",
      `  paymentEventsMirror:
    address: payment.events.v1
operations:`,
    );
    const plan = pinAsyncapiSlots(aliased, livingWithMirror, SVC);
    const statuses = new Map(plan.pins.map((p) => [`${p.section} ${p.key}`, p.status]));
    // The first use is a real map and is stamped; the alias is named, not
    // silently skipped, and never written through.
    expect(statuses.get("channels paymentEvents")).toBe("pinned");
    expect(statuses.get("channels paymentEventsMirror")).toBe("unwritable");
    expect(plan.text).not.toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* loam rebase                                                         */
/* ------------------------------------------------------------------ */

describe("loam rebase pins the event axis", () => {
  /** coherentFixture plus an event contract pair on payment-service. */
  function fixture(feature: string, living = LIVING_EVENTS): Record<string, string> {
    return {
      ...coherentFixture(),
      [`services/${SVC}/asyncapi.yaml`]: living,
      [`features/FEAT-1-split/specs/${SVC}/asyncapi.yaml`]: feature,
    };
  }

  const asyncapiPins = (payload: { pins: { file: string }[] }) =>
    payload.pins.filter((p) => p.file === "asyncapi.yaml");

  it("pins, then reports unchanged, with kind = section and target = slot key", async () => {
    const p = await makeProject(fixture(eventContract("Authorization landed, with splits")));
    try {
      const first = await runLoam(p.workDir, "rebase", "FEAT-1", "--json");
      expect(first.code).toBe(0);
      expect(asyncapiPins(JSON.parse(first.stdout)).map((pin) => [pin.kind, pin.target, pin.status])).toEqual([
        ["channels", "paymentEvents", "pinned"],
        ["operations", "sendPaymentAuthorized", "pinned"],
        ["components.messages", "PaymentAuthorized", "pinned"],
      ]);
      const stamped = await p.read(`features/FEAT-1-split/specs/${SVC}/asyncapi.yaml`);
      expect(stamped).toContain("x-loam-based-on");

      const second = await runLoam(p.workDir, "rebase", "FEAT-1", "--json");
      expect(asyncapiPins(JSON.parse(second.stdout)).every((pin) => pin.status === "unchanged")).toBe(true);
    } finally {
      await p.destroy();
    }
  });

  it("repins when the living slot moved, naming both digests", async () => {
    const p = await makeProject(fixture(eventContract("Authorization landed, with splits")));
    try {
      expect((await runLoam(p.workDir, "rebase", "FEAT-1")).code).toBe(0);
      await p.write(`services/${SVC}/asyncapi.yaml`, eventContract("Someone else's change"));
      const res = await runLoam(p.workDir, "rebase", "FEAT-1", "--json");
      const message = asyncapiPins(JSON.parse(res.stdout)).find((pin) => pin.target === "PaymentAuthorized")!;
      expect(message.status).toBe("repinned");
      expect(message.from).not.toBe(message.to);
      expect(message.to).toBe(
        slotDigest(slotOf(eventContract("Someone else's change"), "components.messages", "PaymentAuthorized")),
      );
    } finally {
      await p.destroy();
    }
  });

  it("reports a slot the living contract lacks as unresolved and writes it no pin", async () => {
    // A genuinely new channel beside quoted slots: the quotes pin, the new
    // slot does not — there is no living version to be based on.
    const withNew = eventContract("Authorization landed").replace(
      "operations:",
      `  splitEvents:
    address: payment.splits.v1
operations:`,
    );
    const p = await makeProject(fixture(withNew));
    try {
      const res = await runLoam(p.workDir, "rebase", "FEAT-1", "--json");
      const pins = asyncapiPins(JSON.parse(res.stdout));
      expect(pins.find((pin) => pin.target === "splitEvents")).toEqual(
        expect.objectContaining({ status: "unresolved", to: null }),
      );
      const stamped = await p.read(`features/FEAT-1-split/specs/${SVC}/asyncapi.yaml`);
      expect(parseYaml(stamped).channels.splitEvents["x-loam-based-on"]).toBeUndefined();
    } finally {
      await p.destroy();
    }
  });

  it("honours --dry-run: same pins reported, not a byte written", async () => {
    const p = await makeProject(fixture(eventContract("Authorization landed, with splits")));
    try {
      const before = await treeHashes(p.docsDir);
      const res = await runLoam(p.workDir, "rebase", "FEAT-1", "--dry-run", "--json");
      expect(res.code).toBe(0);
      const payload = JSON.parse(res.stdout);
      expect(payload.dryRun).toBe(true);
      expect(asyncapiPins(payload).map((pin) => pin.status)).toEqual(["pinned", "pinned", "pinned"]);
      expect(payload.written).toEqual([]);
      expect(await treeHashes(p.docsDir)).toEqual(before);
    } finally {
      await p.destroy();
    }
  });
});

/* ------------------------------------------------------------------ */
/* The gate                                                            */
/* ------------------------------------------------------------------ */

describe("the gate", () => {
  /** What `loam rebase` would stamp — the real pin function, never a hand copy. */
  const pinEvents = (feature: string, living: string): string =>
    pinAsyncapiSlots(feature, living, "fixture").text ?? feature;

  async function coherenceOf(files: Record<string, string>): Promise<Issue[]> {
    const p = await makeProject(files);
    try {
      return await featureCoherence({
        docsDir: p.docsDir,
        featureDir: join(p.docsDir, "features", "FEAT-1-split"),
        featureId: "FEAT-1",
      });
    } finally {
      await p.destroy();
    }
  }

  const gateFixture = (featureEvents: string, livingEvents = LIVING_EVENTS): Record<string, string> => ({
    ...coherentFixture(),
    [`services/${SVC}/asyncapi.yaml`]: livingEvents,
    [`features/FEAT-1-split/specs/${SVC}/asyncapi.yaml`]: featureEvents,
  });

  const only = (issues: Issue[], code: string): Issue[] => issues.filter((i) => i.code === code);

  it("refuses a stale pin, naming both digests and the command that repins", async () => {
    const delta = pinEvents(eventContract("Authorization landed, with splits"), LIVING_EVENTS);
    const moved = eventContract("Someone else's change");
    const [issue, ...rest] = only(await coherenceOf(gateFixture(delta, moved)), "asyncapi.baseline-stale");
    expect(rest).toEqual([]);
    expect(issue!.severity).toBe("error");
    expect(gatesArchive(issue!)).toBe(true);
    expect(issue!.message).toContain("components.messages.PaymentAuthorized");
    expect(issue!.message).toContain("loam rebase FEAT-1");
  });

  it("says nothing about a quote, however far the living slot has moved", async () => {
    const delta = pinEvents(LIVING_EVENTS, LIVING_EVENTS);
    const moved = eventContract("Someone else's change");
    const issues = await coherenceOf(gateFixture(delta, moved));
    expect(only(issues, "asyncapi.baseline-stale")).toEqual([]);
    expect(only(issues, "asyncapi.baseline-missing")).toEqual([]);
  });

  it("counts unpinned slots into ONE warning per service, and that warning gates", async () => {
    const [issue, ...rest] = only(
      await coherenceOf(gateFixture(eventContract("Authorization landed, with splits"))),
      "asyncapi.baseline-missing",
    );
    expect(rest).toEqual([]);
    // Warn, not error: the document is legal. Gating, because the merge is
    // not safe — every unpinned restatement reverts whatever landed on it.
    expect(issue!.severity).toBe("warn");
    expect(gatesArchive(issue!)).toBe(true);
    expect(issue!.message).toContain("3 slot(s)");
    expect(issue!.message).toContain("loam rebase FEAT-1");
  });

  it("refuses a malformed pin, and does not ALSO call it stale", async () => {
    const bad = LIVING_EVENTS.replace(
      "    address: payment.events.v1",
      "    address: payment.events.v1\n    x-loam-based-on: yesterday",
    );
    const issues = await coherenceOf(gateFixture(bad));
    expect(only(issues, "asyncapi.baseline-invalid")).toHaveLength(1);
    expect(only(issues, "asyncapi.baseline-stale")).toEqual([]);
  });

  it("refuses a pin on a slot the living contract has no counterpart for", async () => {
    const added = LIVING_EVENTS.replace(
      "operations:",
      `  splitEvents:
    address: payment.splits.v1
    x-loam-based-on: 0123456789abcdef
operations:`,
    );
    const [issue] = only(await coherenceOf(gateFixture(added)), "asyncapi.baseline-invalid");
    expect(issue!.severity).toBe("error");
    expect(issue!.message).toContain("no slot there");
  });

  it("asks nothing of a slot this feature is genuinely adding", async () => {
    const added = pinEvents(
      LIVING_EVENTS.replace(
        "operations:",
        `  splitEvents:
    address: payment.splits.v1
operations:`,
      ),
      LIVING_EVENTS,
    );
    const issues = await coherenceOf(gateFixture(added));
    expect(only(issues, "asyncapi.baseline-missing")).toEqual([]);
    expect(only(issues, "asyncapi.baseline-invalid")).toEqual([]);
  });

  it("archive refuses the unpinned delta at exit 1 under not-coherent, and --approve merges", async () => {
    const p = await makeProject(gateFixture(eventContract("Authorization landed, with splits")));
    try {
      const refused = await runLoam(p.workDir, "archive", "FEAT-1", "--json");
      expect(refused.code).toBe(1);
      expect(JSON.parse(refused.stdout).error.code).toBe("not-coherent");
      // Overriding the gate is what --approve means; the asyncapi MERGE is
      // the next wave, so the assertion here is the refusal lifting, not
      // living bytes changing.
      const approved = await runLoam(p.workDir, "archive", "FEAT-1", "--approve");
      expect(approved.code).toBe(0);
    } finally {
      await p.destroy();
    }
  });
});
