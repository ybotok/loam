/**
 * The archive-time merge on the event axis (core/asyncapi/merge/): slot
 * upserts, the quote/edit/stale verdicts, removal deletes, the deep marker
 * strip, alias refusals and the dangling-ref sweep — plus the archive plan
 * around it: the per-section overwrite warns, the `asyncapi.ref-unresolved`
 * plan gate, the creation branch, and the additive `asyncapiRemovals` key.
 */
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { AsyncapiMergeError } from "../src/core/asyncapi/merge/error.js";
import { stripAsyncapiMarkers } from "../src/core/asyncapi/merge/markers.js";
import { mergeAsyncapiSlots } from "../src/core/asyncapi/merge/merge.js";
import { pinAsyncapiSlots } from "../src/core/asyncapi/merge/pin.js";
import { slotDigest } from "../src/core/asyncapi/digest.js";
import { makeProject, runLoam } from "./helpers/harness.js";

const LIVING = `# living comment
asyncapi: 3.0.0
info:
  title: payment-service events
  version: "1.0"
channels:
  paymentEvents:
    address: payment.events.v1
    messages:
      Authorized:
        $ref: '#/components/messages/Authorized'
operations:
  sendAuthorized:
    action: send
    channel:
      $ref: '#/channels/paymentEvents'
components:
  messages:
    Authorized:
      name: payment.Authorized
      payload:
        type: object
        properties:
          paymentId:
            type: string
`;

/** The living contract after somebody ELSE landed a change on the Authorized payload. */
const LIVING_MOVED = LIVING.replace("          paymentId:\n            type: string", "          paymentId:\n            type: string\n          settledAt:\n            type: string");

/** A delta that only restates the Authorized message, pinned against `against`. */
function quoteDelta(against: string): string {
  const delta = `asyncapi: 3.0.0
info:
  title: payment-service events
  version: "1.0"
components:
  messages:
    Authorized:
      name: payment.Authorized
      payload:
        type: object
        properties:
          paymentId:
            type: string
`;
  return pinAsyncapiSlots(delta, against, "payment-service").text ?? delta;
}

describe("mergeAsyncapiSlots", () => {
  it("upserts new message, channel and operation slots, preserving living formatting", () => {
    const feature = `asyncapi: 3.0.0
channels:
  refundEvents:
    address: payment.refunds.v1
    messages:
      Refunded:
        $ref: '#/components/messages/Refunded'
operations:
  sendRefunded:
    action: send
    channel:
      $ref: '#/channels/refundEvents'
components:
  messages:
    Refunded:
      name: payment.Refunded
      payload:
        type: object
        properties:
          refundId:
            type: string
`;
    const result = mergeAsyncapiSlots(LIVING, feature, "payment-service");
    expect(result.modified).toEqual([]);
    expect(result.quoted).toEqual([]);
    expect(result.unresolved).toEqual([]);
    expect(result.text).not.toBeNull();
    expect(result.text).toContain("# living comment");
    const merged = parse(result.text!);
    expect(Object.keys(merged.channels)).toEqual(["paymentEvents", "refundEvents"]);
    expect(Object.keys(merged.operations)).toEqual(["sendAuthorized", "sendRefunded"]);
    expect(Object.keys(merged.components.messages)).toEqual(["Authorized", "Refunded"]);
  });

  it("a pinned QUOTE alone writes nothing at all — text is null, the living bytes are never re-serialized", () => {
    const result = mergeAsyncapiSlots(LIVING_MOVED, quoteDelta(LIVING), "payment-service");
    expect(result.text).toBeNull();
    expect(result.quoted).toEqual([{ section: "components.messages", label: "'payment.Authorized' (components.messages.Authorized)" }]);
    expect(result.modified).toEqual([]);
  });

  it("a QUOTE beside a real addition keeps the LIVING copy — the lost-update case", () => {
    // The delta was written against LIVING and restates Authorized verbatim;
    // somebody else's settledAt landed in between. The merge must write the
    // new slot and leave the moved Authorized exactly as living has it.
    const delta = `asyncapi: 3.0.0
components:
  messages:
    Authorized:
      name: payment.Authorized
      payload:
        type: object
        properties:
          paymentId:
            type: string
    Refunded:
      name: payment.Refunded
      payload:
        type: object
        properties:
          refundId:
            type: string
`;
    const pinned = pinAsyncapiSlots(delta, LIVING, "payment-service").text ?? delta;
    const result = mergeAsyncapiSlots(LIVING_MOVED, pinned, "payment-service");
    expect(result.quoted.map((s) => s.label)).toEqual(["'payment.Authorized' (components.messages.Authorized)"]);
    expect(result.text).not.toBeNull();
    const merged = parse(result.text!);
    // The living contract's own version — settledAt survives the restatement.
    expect(Object.keys(merged.components.messages.Authorized.payload.properties)).toEqual(["paymentId", "settledAt"]);
    expect(merged.components.messages.Refunded.name).toBe("payment.Refunded");
  });

  it("an EDIT overwrites and reports each slot under its section", () => {
    const delta = `asyncapi: 3.0.0
channels:
  paymentEvents:
    address: payment.events.v2
    messages:
      Authorized:
        $ref: '#/components/messages/Authorized'
operations:
  sendAuthorized:
    action: send
    summary: Emits the authorization event
    channel:
      $ref: '#/channels/paymentEvents'
components:
  messages:
    Authorized:
      name: payment.Authorized
      payload:
        type: object
        properties:
          paymentId:
            type: string
          amount:
            type: number
`;
    const pinned = pinAsyncapiSlots(delta, LIVING, "payment-service").text ?? delta;
    const result = mergeAsyncapiSlots(LIVING, pinned, "payment-service");
    expect(result.modified).toEqual([
      { section: "channels", label: "channels.paymentEvents" },
      { section: "operations", label: "operations.sendAuthorized" },
      { section: "components.messages", label: "'payment.Authorized' (components.messages.Authorized)" },
    ]);
    expect(result.baselineStale).toEqual([]);
    const merged = parse(result.text!);
    expect(merged.channels.paymentEvents.address).toBe("payment.events.v2");
    expect(merged.operations.sendAuthorized.summary).toBe("Emits the authorization event");
    expect(merged.components.messages.Authorized.payload.properties.amount).toEqual({ type: "number" });
    // The pins never reach the living contract.
    expect(result.text).not.toContain("x-loam-based-on");
  });

  it("a STALE pin still writes — reaching the merge means --approve said to — and is reported", () => {
    // Pinned against LIVING, edited, and the living slot moved since: the pin
    // matches neither side.
    const delta = `asyncapi: 3.0.0
components:
  messages:
    Authorized:
      name: payment.Authorized
      payload:
        type: object
        properties:
          paymentId:
            type: string
          amount:
            type: number
`;
    const pinned = pinAsyncapiSlots(delta, LIVING, "payment-service").text ?? delta;
    const result = mergeAsyncapiSlots(LIVING_MOVED, pinned, "payment-service");
    expect(result.baselineStale.map((s) => s.label)).toEqual(["'payment.Authorized' (components.messages.Authorized)"]);
    expect(result.modified.map((s) => s.label)).toEqual(["'payment.Authorized' (components.messages.Authorized)"]);
    const merged = parse(result.text!);
    expect(Object.keys(merged.components.messages.Authorized.payload.properties)).toEqual(["paymentId", "amount"]);
  });

  it("removal markers delete their slots, the emptied section keys go, and no marker reaches living", () => {
    const feature = `asyncapi: 3.0.0
channels:
  paymentEvents:
    x-loam-remove: true
operations:
  sendAuthorized:
    x-loam-remove: true
components:
  messages:
    Authorized:
      name: payment.Authorized
      x-loam-remove: true
`;
    const result = mergeAsyncapiSlots(LIVING, feature, "payment-service");
    expect(result.removed).toEqual([
      { section: "channels", label: "channels.paymentEvents" },
      { section: "operations", label: "operations.sendAuthorized" },
      { section: "components.messages", label: "'payment.Authorized' (components.messages.Authorized)" },
    ]);
    expect(result.text).not.toContain("x-loam-remove");
    const merged = parse(result.text!);
    expect(merged.channels).toBeUndefined();
    expect(merged.operations).toBeUndefined();
    // messages were all `components` held, so the whole mapping goes with them.
    expect(merged.components).toBeUndefined();
  });

  it("never deletes a DIFFERENT message occupying the requested slot", () => {
    const feature = `asyncapi: 3.0.0
components:
  messages:
    Authorized:
      name: payment.Other
      x-loam-remove: true
`;
    const result = mergeAsyncapiSlots(LIVING, feature, "payment-service");
    expect(result.removed).toEqual([]);
    expect(result.text).toBeNull();
  });

  it("a feature document with no slots is a successful no-op", () => {
    const feature = `asyncapi: 3.0.0\ninfo:\n  title: payment-service events\n  version: "1.0"\n`;
    const result = mergeAsyncapiSlots(LIVING, feature, "payment-service");
    expect(result).toEqual({ text: null, modified: [], removed: [], quoted: [], baselineStale: [], unresolved: [] });
  });

  it("a merged slot whose #/ ref resolves in neither document is returned unresolved", () => {
    const feature = `asyncapi: 3.0.0
components:
  messages:
    Refunded:
      name: payment.Refunded
      payload:
        $ref: '#/components/schemas/RefundPayload'
`;
    const result = mergeAsyncapiSlots(LIVING, feature, "payment-service");
    expect(result.unresolved).toEqual(["#/components/schemas/RefundPayload"]);
  });

  it("refs already dangling in the living contract are not this merge's finding", () => {
    const rotten = LIVING.replace(
      "      payload:\n        type: object\n        properties:\n          paymentId:\n            type: string",
      "      payload:\n        $ref: '#/components/schemas/Gone'",
    );
    const feature = `asyncapi: 3.0.0
components:
  messages:
    Refunded:
      name: payment.Refunded
      payload:
        type: object
        properties:
          refundId:
            type: string
`;
    const result = mergeAsyncapiSlots(rotten, feature, "payment-service");
    expect(result.unresolved).toEqual([]);
  });

  it("refuses to write through a YAML alias with the shared-anchor refusal", () => {
    const aliased = `asyncapi: 3.0.0
x-template: &tpl
  paymentEvents:
    address: payment.events.v1
channels: *tpl
`;
    const feature = `asyncapi: 3.0.0
channels:
  refundEvents:
    address: payment.refunds.v1
`;
    expect(() => mergeAsyncapiSlots(aliased, feature, "payment-service")).toThrowError(AsyncapiMergeError);
    expect(() => mergeAsyncapiSlots(aliased, feature, "payment-service")).toThrowError(/YAML alias/);
  });

  it("a numeric slot key is replaced, never duplicated", () => {
    // `404:` is the YAML number 404 — a plain string-keyed setIn would miss
    // the pair and APPEND a second `404:`, declaring the channel twice.
    const living = `asyncapi: 3.0.0
channels:
  404:
    address: dead.letter.v1
`;
    const delta = `asyncapi: 3.0.0
channels:
  404:
    address: dead.letter.v2
    x-loam-based-on: "${slotDigest(parse(living).channels[404])}"
`;
    const result = mergeAsyncapiSlots(living, delta, "payment-service");
    expect(result.modified.map((s) => s.label)).toEqual(["channels.404"]);
    expect(result.text!.match(/404:/g)).toHaveLength(1);
    expect(parse(result.text!).channels[404].address).toBe("dead.letter.v2");
  });
});

describe("stripAsyncapiMarkers (the creation branch's strip)", () => {
  it("drops removal slots, strips pins, and strips a marker nested on an inline channel message", () => {
    const feature = `# feature comment
asyncapi: 3.0.0
info:
  title: payment-service events
  version: "1.0"
channels:
  paymentEvents:
    address: payment.events.v1
    messages:
      Inline:
        name: payment.Inline
        x-loam-remove: true
        payload:
          type: object
  deadChannel:
    x-loam-remove: true
components:
  messages:
    Authorized:
      name: payment.Authorized
      x-loam-based-on: "0123456789abcdef"
      payload:
        type: object
`;
    const stripped = stripAsyncapiMarkers(feature, "payment-service");
    expect(stripped).not.toContain("x-loam");
    expect(stripped).toContain("# feature comment");
    const doc = parse(stripped);
    // The inline message is CHANNEL INTERIOR: its nested marker goes, the
    // message itself stays — retiring an individual message is
    // components.messages' business, never an inline marker's.
    expect(doc.channels.paymentEvents.messages.Inline).toEqual({ name: "payment.Inline", payload: { type: "object" } });
    expect(doc.channels.deadChannel).toBeUndefined();
    expect(doc.components.messages.Authorized).toEqual({ name: "payment.Authorized", payload: { type: "object" } });
  });

  it("returns the input verbatim when there is nothing to strip", () => {
    expect(stripAsyncapiMarkers(LIVING, "payment-service")).toBe(LIVING);
  });
});

/* ------------------------------------------------------------------ */
/* The archive plan around the merge                                   */
/* ------------------------------------------------------------------ */

const LIVING_SPEC = `---
service: payment-service
status: verified
---

# payment-service

## Requirements

### Requirement: Authorize a payment
The service SHALL authorize a payment before capture.

#### Scenario: Successful authorization
- **Given** a valid card
- **When** authorization is requested
- **Then** the payment is authorized
`;

const INTENT = `---
feature: FEAT-50
status: proposed
---

# Evolve payment events

The payment event contract grows a refund message.
`;

function fixture(featureAsyncapi: string, over: Record<string, string | null> = {}): Record<string, string> {
  const files: Record<string, string | null> = {
    "services/payment-service/spec.md": LIVING_SPEC,
    "services/payment-service/asyncapi.yaml": LIVING,
    "features/FEAT-50-evolve/intent.md": INTENT,
    "features/FEAT-50-evolve/specs/payment-service/asyncapi.yaml": featureAsyncapi,
    ...over,
  };
  return Object.fromEntries(Object.entries(files).filter(([, v]) => v !== null)) as Record<string, string>;
}

describe("loam archive merges the event axis", () => {
  it("an EDIT warns per section, and the merged living contract carries no loam key", async () => {
    const delta = `asyncapi: 3.0.0
channels:
  paymentEvents:
    address: payment.events.v2
    messages:
      Authorized:
        $ref: '#/components/messages/Authorized'
operations:
  sendAuthorized:
    action: send
    summary: Emits the authorization event
    channel:
      $ref: '#/channels/paymentEvents'
components:
  messages:
    Authorized:
      name: payment.Authorized
      payload:
        type: object
        properties:
          paymentId:
            type: string
          amount:
            type: number
`;
    const pinned = pinAsyncapiSlots(delta, LIVING, "payment-service").text ?? delta;
    const p = await makeProject(fixture(pinned));
    try {
      const res = await runLoam(p.workDir, "archive", "FEAT-50", "--json");
      expect(res.code).toBe(0);
      const payload = JSON.parse(res.stdout);
      expect((payload.warnings as Array<{ code: string }>).map((w) => w.code).sort()).toEqual([
        "asyncapi.channel-modified",
        "asyncapi.message-modified",
        "asyncapi.operation-modified",
      ]);
      expect(payload.asyncapiRemovals).toEqual([]);
      const living = await p.read("services/payment-service/asyncapi.yaml");
      expect(living).not.toContain("x-loam");
      expect(parse(living).channels.paymentEvents.address).toBe("payment.events.v2");
    } finally {
      await p.destroy();
    }
  });

  it("a pure-quote delta archives without touching a byte of the living contract", async () => {
    const p = await makeProject(fixture(quoteDelta(LIVING)));
    try {
      const res = await runLoam(p.workDir, "archive", "FEAT-50", "--json");
      expect(res.code).toBe(0);
      const payload = JSON.parse(res.stdout);
      expect((payload.plan as Array<{ path: string }>).map((w) => w.path)).toEqual(["features/FEAT-50-evolve"]);
      expect(await p.read("services/payment-service/asyncapi.yaml")).toBe(LIVING);
    } finally {
      await p.destroy();
    }
  });

  it("a dangling ref the merge would write gates at not-coherent, and --approve merges it anyway", async () => {
    const delta = `asyncapi: 3.0.0
components:
  messages:
    Refunded:
      name: payment.Refunded
      payload:
        $ref: '#/components/schemas/RefundPayload'
`;
    const p = await makeProject(fixture(delta));
    try {
      const blocked = await runLoam(p.workDir, "archive", "FEAT-50", "--json");
      expect(blocked.code).toBe(1);
      const refusal = JSON.parse(blocked.stdout);
      expect(refusal.ok).toBe(false);
      expect(refusal.error.code).toBe("not-coherent");
      const gate = (refusal.issues as Array<{ code: string; message: string }>).find(
        (i) => i.code === "asyncapi.ref-unresolved",
      );
      expect(gate).toBeDefined();
      expect(gate!.message).toContain("#/components/schemas/RefundPayload");
      // Refused before a byte moved.
      expect(await p.read("services/payment-service/asyncapi.yaml")).toBe(LIVING);

      const approved = await runLoam(p.workDir, "archive", "FEAT-50", "--json", "--approve");
      expect(approved.code).toBe(0);
      expect(parse(await p.read("services/payment-service/asyncapi.yaml")).components.messages.Refunded).toBeDefined();
    } finally {
      await p.destroy();
    }
  });

  it("the creation branch strips loam keys and records no removals", async () => {
    // No living asyncapi.yaml: the delta declares one real slot plus a
    // removal marker (which coherence gates — remove-target-missing — so the
    // archive runs --approve), and the created contract must carry neither
    // the marker nor a pin.
    const delta = `asyncapi: 3.0.0
components:
  messages:
    Refunded:
      name: payment.Refunded
      payload:
        type: object
        properties:
          refundId:
            type: string
    Ghost:
      name: payment.Ghost
      x-loam-remove: true
`;
    const p = await makeProject(fixture(delta, { "services/payment-service/asyncapi.yaml": null }));
    try {
      const res = await runLoam(p.workDir, "archive", "FEAT-50", "--json", "--approve");
      expect(res.code).toBe(0);
      expect(JSON.parse(res.stdout).asyncapiRemovals).toEqual([]);
      const living = await p.read("services/payment-service/asyncapi.yaml");
      expect(living).not.toContain("x-loam");
      const doc = parse(living);
      expect(doc.components.messages.Refunded).toBeDefined();
      expect(doc.components.messages.Ghost).toBeUndefined();
    } finally {
      await p.destroy();
    }
  });

  it("a delta whose every slot is a removal marker creates no living contract at all", async () => {
    const delta = `asyncapi: 3.0.0
components:
  messages:
    Ghost:
      name: payment.Ghost
      x-loam-remove: true
`;
    const p = await makeProject(fixture(delta, { "services/payment-service/asyncapi.yaml": null }));
    try {
      const res = await runLoam(p.workDir, "archive", "FEAT-50", "--json", "--approve");
      expect(res.code).toBe(0);
      // An asyncapi.yaml's PRESENCE is graded on this axis; an empty contract
      // would put a presence claim on a service that has none.
      expect(p.exists("services/payment-service/asyncapi.yaml")).toBe(false);
    } finally {
      await p.destroy();
    }
  });
});
