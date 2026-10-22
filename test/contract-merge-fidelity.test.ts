/**
 * The contract merges keep every byte they did not change, and say when the
 * delta's `info` will not land.
 *
 * UNTOUCHED BYTES. Both merges used to hand the living contract back through
 * the `yaml` printer, which re-folds every plain scalar at 80 columns, re-pads
 * every flow sequence and turns CRLF into LF — so adding one channel rewrote a
 * long `description` three sections away, and the diff a reviewer reads to learn
 * what the feature changed carried lines nobody touched. `writeTreeOver`
 * (core/openapi/contract-tree.ts) now splices: only the entries the merge added,
 * replaced or removed are printed, and the result is verified to read back as
 * the merged tree, or the old whole-document write is used.
 *
 * REBASE'S PINS. `loam rebase` writes into the AUTHOR's contract, not the
 * living one, and it took the same whole-document write: stamping one
 * `x-loam-based-on` re-folded every long line of the feature's openapi.yaml or
 * asyncapi.yaml and turned it LF, so the rebase diff was mostly lines loam had
 * no business touching. Its three writers — the operation pin, the slot pin and
 * the `x-loam-baselines` record — now write over the feature's own text.
 *
 * `info` DRIFT. Neither merge carries `info`, by design — but a delta that moved
 * it (a new version, a new description) lost the change with exit 0 and not a
 * word. `openapi.info-not-merged` / `asyncapi.info-not-merged` say so in the plan.
 */
import { afterEach, describe, expect, it } from "vitest";
import { parse, parseDocument, type Document } from "yaml";
import { mergeAsyncapiSlots } from "../src/core/asyncapi/merge/merge.js";
import { mergeOpenapiPaths } from "../src/core/openapi/merge/merge.js";
import { planOpenapiBaselines } from "../src/core/openapi/baseline/plan.js";
import { writeTreeOver } from "../src/core/openapi/contract-tree.js";
import { LIVING_ASYNCAPI, LIVING_OPENAPI, coherentFixture, makeProject, runLoam, type Project } from "./helpers/harness.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!();
});

const LONG = "This is a deliberately long single-line description of the contract that runs well past eighty characters.";

/** The living event contract with the two shapes the printer used to rewrite: a long plain scalar and a padded-free flow sequence. */
const LIVING_EVENTS = LIVING_ASYNCAPI.replace(
  'info:\n  title: payment-service events\n  version: "1.0"\n',
  `info:\n  title: payment-service events\n  version: "1.0"\n  description: ${LONG}\n  tags: [{name: payments}, {name: customer-facing}]\n`,
).replace("        type: object\n", "        type: object\n        required: [paymentId]\n");

/** A delta adding one channel, one operation and one message — nothing else. */
const ADD_REFUND = `asyncapi: 3.0.0
info:
  title: payment-service events
  version: "1.0"
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
`;

/**
 * The `+` side of a line diff, in order: the lines of `after` outside a longest
 * common subsequence with `before`. A real diff rather than a set difference,
 * because a new slot repeats lines (`    action: send`) the old text already has.
 */
function added(before: string, after: string): string[] {
  const a = before.split(/\r?\n/);
  const b = after.split(/\r?\n/);
  const lcs = Array.from({ length: a.length + 1 }, () => Array.from({ length: b.length + 1 }, () => 0));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }
  const out: string[] = [];
  let i = 0;
  let j = 0;
  while (j < b.length) {
    if (i < a.length && a[i] === b[j]) {
      i += 1;
      j += 1;
    } else if (i < a.length && lcs[i + 1]![j]! >= lcs[i]![j + 1]!) i += 1;
    else out.push(b[j++]!);
  }
  return out;
}

describe("the contract merge keeps the bytes it did not touch", () => {
  it("adding a channel leaves a long description and a flow sequence exactly as written", () => {
    const merged = mergeAsyncapiSlots(LIVING_EVENTS, ADD_REFUND, "payment-service");
    const text = merged.text!;
    // Every original line survives verbatim — the printer would have folded the
    // description and written `[ { name: payments }, … ]`.
    for (const line of LIVING_EVENTS.split("\n")) expect(text.split("\n"), line).toContain(line);
    expect(added(LIVING_EVENTS, text)).toEqual([
      "  refundEvents:",
      "    address: payment.refunds.v1",
      "    messages:",
      "      Refunded:",
      '        $ref: "#/components/messages/Refunded"',
      "  sendRefunded:",
      "    action: send",
      "    channel:",
      '      $ref: "#/channels/refundEvents"',
      "    Refunded:",
      "      name: payment.Refunded",
      "      payload:",
      "        type: object",
    ]);
    // And it is the merged document, value for value.
    const expected = parse(LIVING_EVENTS) as Record<string, Record<string, Record<string, unknown>>>;
    expected.channels!.refundEvents = {
      address: "payment.refunds.v1",
      messages: { Refunded: { $ref: "#/components/messages/Refunded" } },
    };
    expected.operations!.sendRefunded = { action: "send", channel: { $ref: "#/channels/refundEvents" } };
    (expected.components!.messages as Record<string, unknown>).Refunded = { name: "payment.Refunded", payload: { type: "object" } };
    expect(parse(text)).toEqual(expected);
  });

  it("keeps a CRLF contract CRLF, new lines included", () => {
    const crlf = LIVING_EVENTS.replace(/\n/g, "\r\n");
    const text = mergeAsyncapiSlots(crlf, ADD_REFUND, "payment-service").text!;
    expect(text.replace(/\r\n/g, "")).not.toContain("\n");
    expect(text).toContain(`  description: ${LONG}\r\n`);
  });

  it("replacing one OpenAPI operation rewrites that operation and nothing else", () => {
    const living = LIVING_OPENAPI.replace('  version: "1.0"\n', `  version: "1.0"\n  description: ${LONG}\n`) +
      "  /payments/{id}:\n    get:\n      operationId: getPayment\n      tags: [payments, read]\n      responses:\n        \"200\":\n          description: The payment\n";
    const feature = `openapi: 3.1.0\ninfo:\n  title: payment-service\n  version: "1.0"\npaths:\n  /payments/authorize:\n    post:\n      operationId: authorizePayment\n      summary: Authorize a payment, now with 3-D Secure\n      responses:\n        "200":\n          description: Authorized\n          content:\n            application/json:\n              schema:\n                type: object\n                properties:\n                  status:\n                    type: string\n`;
    const text = mergeOpenapiPaths(living, feature, "payment-service").text!;
    expect(added(living, text)).toEqual(["      summary: Authorize a payment, now with 3-D Secure"]);
    expect(text).toContain(`  description: ${LONG}\n`);
    expect(text).toContain("      tags: [payments, read]\n");
  });

  it("a removal cuts the entry and the comment written directly above it", () => {
    // A second operation keeps the section, so the cut is one entry deep.
    const living = LIVING_EVENTS.replace("operations:\n", "operations:\n  # the producer side of Authorized\n").replace(
      "components:\n",
      "  receiveAuthorized:\n    action: receive\n    channel:\n      $ref: '#/channels/paymentEvents'\ncomponents:\n",
    );
    const retire = `asyncapi: 3.0.0\ninfo:\n  title: payment-service events\n  version: "1.0"\noperations:\n  sendAuthorized:\n    x-loam-remove: true\n`;
    const text = mergeAsyncapiSlots(living, retire, "payment-service").text!;
    expect(text).not.toContain("the producer side of Authorized");
    expect(text).not.toContain("sendAuthorized");
    expect(text).toContain("operations:\n  receiveAuthorized:\n    action: receive\n");
    expect(text).toContain(`  description: ${LONG}\n`);
  });
});

async function project(files: Record<string, string>): Promise<Project> {
  const p = await makeProject(files);
  cleanups.push(() => p.destroy());
  return p;
}

/** coherentFixture plus a payment-service event contract and a feature that changes it. */
function eventFleet(featureEvents: string): Record<string, string> {
  return {
    ...coherentFixture(),
    "services/payment-service/asyncapi.yaml": LIVING_EVENTS,
    "features/FEAT-1-split/specs/payment-service/asyncapi.yaml": featureEvents,
  };
}

function warningsOf(stdout: string, code: string): Array<{ code: string; message: string; subject?: string }> {
  return (JSON.parse(stdout) as { warnings: Array<{ code: string; message: string; subject?: string }> }).warnings.filter(
    (w) => w.code === code,
  );
}

describe("the delta's info, which no merge carries", () => {
  it("asyncapi.info-not-merged names the info keys the delta moved, and the living info stays", async () => {
    const moved = ADD_REFUND.replace('  version: "1.0"\n', '  version: "2.0"\n  description: Target contract — now also refunds.\n');
    const p = await project(eventFleet(moved));
    const plan = await runLoam(p.workDir, "archive", "FEAT-1", "--dry-run", "--json");
    expect(plan.code, plan.out).toBe(0);
    const found = warningsOf(plan.stdout, "asyncapi.info-not-merged");
    expect(found, plan.stdout).toHaveLength(1);
    expect(found[0]!.subject).toBe("payment-service");
    expect(found[0]!.message).toContain("info.description, info.version");

    const human = await runLoam(p.workDir, "archive", "FEAT-1", "--dry-run");
    expect(human.stdout).toContain("⚠ info not merged — the delta's info.description, info.version differ(s) from the living asyncapi.yaml");

    const archived = await runLoam(p.workDir, "archive", "FEAT-1");
    expect(archived.code, archived.out).toBe(0);
    const living = parse(await p.read("services/payment-service/asyncapi.yaml")) as { info: Record<string, unknown> };
    expect(living.info.version).toBe("1.0");
    expect(living.info.description).toBe(LONG);
  });

  it("is said for a delta whose ONLY change is its info, which merges nothing at all", async () => {
    const infoOnly = `openapi: 3.1.0\ninfo:\n  title: payment-service\n  version: "2.0"\npaths: {}\n`;
    const p = await project({ ...coherentFixture(), "features/FEAT-1-split/specs/payment-service/openapi.yaml": infoOnly });
    const plan = await runLoam(p.workDir, "archive", "FEAT-1", "--dry-run", "--json");
    const found = warningsOf(plan.stdout, "openapi.info-not-merged");
    expect(found, plan.stdout).toHaveLength(1);
    expect(found[0]!.message).toContain("info.version");
  });

  it("stays silent when the delta restates the living info, or leaves a key out", async () => {
    const p = await project(eventFleet(ADD_REFUND.replace('  version: "1.0"\n', "")));
    const plan = await runLoam(p.workDir, "archive", "FEAT-1", "--dry-run", "--json");
    expect(plan.code, plan.out).toBe(0);
    expect(warningsOf(plan.stdout, "asyncapi.info-not-merged")).toEqual([]);
  });
});

describe("writeTreeOver on the shapes a range walk gets wrong", () => {
  /** Edit a parsed copy of `source`, then write it back over `source`. */
  function edited(source: string, edit: (doc: Document) => void): string {
    const doc = parseDocument(source);
    edit(doc);
    return writeTreeOver(doc, source, (detail) => new Error(detail));
  }

  // `[x, y]` is the canary: the whole-document printer writes `[ x, y ]`, so a
  // result that still has it was spliced, not silently re-printed.
  it("cuts an entry whose value is empty without leaving a blank line", () => {
    expect(edited("a: 1\nd:\ne: [x, y]\n", (doc) => doc.deleteIn(["d"]))).toBe("a: 1\ne: [x, y]\n");
    expect(edited("a: 1\r\nd:\r\ne: [x, y]\r\n", (doc) => doc.deleteIn(["d"]))).toBe("a: 1\r\ne: [x, y]\r\n");
  });

  it("replaces an empty value in place, and inserts after one on a line of its own", () => {
    expect(edited("a: [x, y]\nd:\ne: 2\n", (doc) => doc.setIn(["d"], 5))).toBe("a: [x, y]\nd: 5\ne: 2\n");
    expect(edited("a: [x, y]\nd:\n", (doc) => doc.setIn(["f"], 1))).toBe("a: [x, y]\nd:\nf: 1\n");
  });

  it("takes a comment the library attaches across a blank line with the entry it is about", () => {
    const source = "paths:\n  /a:\n    x: [1, 2]\n\n  # deprecated, see /v2\n\n  /b:\n    y: 1\n";
    expect(edited(source, (doc) => doc.deleteIn(["paths", "/b"]))).toBe("paths:\n  /a:\n    x: [1, 2]\n\n");
  });
});

describe("loam rebase stamps its pins and touches nothing else", () => {
  /** `text` without the lines rebase writes: every in-value pin, and the root record with its entries. */
  function unpinned(text: string): string {
    return text.replace(/^ *x-loam-based-on: [0-9a-f]{16}\r\n/gm, "").replace(/^x-loam-baselines:\r\n(?: +.*\r\n)*/m, "");
  }
  const PIN = /^ *x-loam-based-on: [0-9a-f]{16}$/;

  /** A living contract with a component, so the run writes the root record as well as the operation pin. */
  const LIVING_WITH_SCHEMA = `${LIVING_OPENAPI}components:\n  schemas:\n    Payment:\n      type: object\n      required: [id]\n`;

  /** The feature's openapi.yaml as an author on Windows writes it: CRLF, two long lines, two flow sequences. */
  const FEATURE_OPENAPI_CRLF = `openapi: 3.1.0
info:
  title: payment-service
  version: "1.0"
  description: ${LONG}
paths:
  /payments/authorize:
    post:
      operationId: authorizePayment
      summary: Authorize a payment, now with 3-D Secure for every card network that asks for it
      tags: [payments, write]
      responses:
        "200":
          description: Authorized
components:
  schemas:
    Payment:
      type: object
      required: [id]
`.replace(/\n/g, "\r\n");

  /** The living event contract, restated with one edit, in CRLF. */
  const FEATURE_EVENTS_CRLF = LIVING_EVENTS.replace(
    "    action: send\n",
    "    action: send\n    summary: Publish the authorization, now carrying the amount the card network approved\n",
  ).replace(/\n/g, "\r\n");

  it("leaves a CRLF feature contract byte-for-byte as written apart from the pin lines, on both axes", async () => {
    // Before this, both files came back LF, with the description and the summary
    // folded at 80 columns and every flow sequence written `[ a, b ]`.
    const p = await project({
      ...coherentFixture(),
      "services/payment-service/openapi.yaml": LIVING_WITH_SCHEMA,
      "services/payment-service/asyncapi.yaml": LIVING_EVENTS,
      "features/FEAT-1-split/specs/payment-service/openapi.yaml": FEATURE_OPENAPI_CRLF,
      "features/FEAT-1-split/specs/payment-service/asyncapi.yaml": FEATURE_EVENTS_CRLF,
    });
    const run = await runLoam(p.workDir, "rebase", "FEAT-1");
    expect(run.code, run.out).toBe(0);

    const api = await p.read("features/FEAT-1-split/specs/payment-service/openapi.yaml");
    expect(unpinned(api)).toBe(FEATURE_OPENAPI_CRLF);
    expect(added(FEATURE_OPENAPI_CRLF, api)).toEqual([
      expect.stringMatching(PIN),
      "x-loam-baselines:",
      "  components:",
      expect.stringMatching(/^ {4}schemas\/Payment: [0-9a-f]{16}$/),
    ]);

    const events = await p.read("features/FEAT-1-split/specs/payment-service/asyncapi.yaml");
    expect(unpinned(events)).toBe(FEATURE_EVENTS_CRLF);
    expect(added(FEATURE_EVENTS_CRLF, events)).toEqual([
      expect.stringMatching(PIN),
      expect.stringMatching(PIN),
      expect.stringMatching(PIN),
    ]);

    // And a second run, with nothing left to pin, writes nothing.
    expect((await runLoam(p.workDir, "rebase", "FEAT-1")).code).toBe(0);
    expect(await p.read("features/FEAT-1-split/specs/payment-service/openapi.yaml")).toBe(api);
    expect(await p.read("features/FEAT-1-split/specs/payment-service/asyncapi.yaml")).toBe(events);
  });

  it("a record left with nothing to pin is cut out the same way, its neighbours untouched", () => {
    // The record's other write: every surface it named is gone from the delta,
    // so the rebuilt record is empty and the key is deleted rather than set.
    const stale = `${FEATURE_OPENAPI_CRLF.replace(/components:\r\n(?:.*\r\n)*$/, "")}x-loam-baselines:\r\n  components:\r\n    schemas/Payment: 0123456789abcdef\r\n`;
    const plan = planOpenapiBaselines(stale, LIVING_WITH_SCHEMA);
    expect(plan.text).toBe(FEATURE_OPENAPI_CRLF.replace(/components:\r\n(?:.*\r\n)*$/, ""));
  });
});
