/**
 * The contract baseline: `x-loam-based-on`, `operationDigest`, and the merge
 * verdict that tells a QUOTE from an EDIT.
 *
 * This axis needs the pin more than the requirement axis does, and for a reason
 * that has nothing to do with two teams wanting the same thing. A feature's
 * openapi.yaml is a COMPLETE document — authors restate the living contract
 * around the slot they are changing — and the merge upserts every operation the
 * document spells. So there are two distinct losses, and only the first has a
 * counterpart on the requirement axis:
 *
 *   1. Both features edit ONE operation. The second to archive replaces the
 *      first's version. Needs deliberate overlap; rare-ish.
 *   2. Two features edit DIFFERENT operations of the same service. Each quotes
 *      the other's operation verbatim, so whichever archives second reverts the
 *      other's shipped change — with no overlap between the features at all.
 *      On a thirty-operation service a delta quotes twenty-nine of them.
 *
 * Families:
 *  - the digest: canonical (key order cannot matter, because the merge's own
 *    isDeepStrictEqual ignores it), pin-excluded
 *  - the verdict: quote / edit / stale / unfounded / unpinned
 *  - the merge: quotes are skipped, pins never reach a living contract
 *  - both losses above, end to end, through the real commands
 *  - the gate: stale refuses, missing is one warning per service
 *  - the closed gaps: components and path-level keys ride the same verdicts
 *    through the `x-loam-baselines` record
 */
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { mergeOpenapiPaths } from "../src/core/openapi/merge/merge.js";
import { classifyOperationBaseline, pinOpenapiOperations } from "../src/core/openapi/merge/pin.js";
import { operationDigest } from "../src/core/openapi/digest.js";
import { operations } from "../src/core/openapi/doc.js";
import { gatesArchive, type Issue } from "../src/core/vocabulary/issue.js";
import { featureCoherence } from "../src/core/coherence/coherence.js";
import { join } from "node:path";
import { coherentFixture, makeProject, pinOpenapi, runLoam, type Project } from "./helpers/harness.js";

const SVC = "payment-service";

/** A two-operation living contract: the shape that exposes the quote problem. */
function contract(cancel: string, refund: string): string {
  return `openapi: 3.1.0
info: { title: orders, version: "1.0" }
paths:
  /orders/{id}/cancel:
    post:
      operationId: cancelOrder
      summary: ${cancel}
      responses:
        "200": { description: ok }
  /orders/{id}/refund:
    post:
      operationId: refundOrder
      summary: ${refund}
      responses:
        "200": { description: ok }
`;
}

const LIVING = contract("Cancel an order", "Refund an order");

const opOf = (yaml: string, path: string, method = "post"): unknown =>
  ((parseYaml(yaml) as Record<string, Record<string, Record<string, unknown>>>).paths[path] ?? {})[method];

const cancelOf = (yaml: string) => opOf(yaml, "/orders/{id}/cancel");
const refundOf = (yaml: string) => opOf(yaml, "/orders/{id}/refund");

/** The summaries of the two operations, in a shape a failure message can read. */
function summaries(yaml: string): Record<string, unknown> {
  const doc = parseYaml(yaml) as Record<string, Record<string, Record<string, Record<string, unknown>>>>;
  return {
    cancel: doc.paths?.["/orders/{id}/cancel"]?.["post"]?.["summary"],
    refund: doc.paths?.["/orders/{id}/refund"]?.["post"]?.["summary"],
  };
}

/* ------------------------------------------------------------------ */
/* The digest                                                          */
/* ------------------------------------------------------------------ */

describe("operationDigest matches the comparison the merge itself makes", () => {
  it("ignores key order, because isDeepStrictEqual does", () => {
    // The merge decides "this operation differs" with isDeepStrictEqual, which
    // is order-blind. A digest that were not would go stale over a reordered
    // summary/operationId pair the merge calls identical.
    const a = { operationId: "x", summary: "s", responses: { "200": { description: "ok" } } };
    const b = { responses: { "200": { description: "ok" } }, summary: "s", operationId: "x" };
    expect(operationDigest(a)).toBe(operationDigest(b));
  });

  it("does not ignore array order, because that is content", () => {
    expect(operationDigest({ tags: ["a", "b"] })).not.toBe(operationDigest({ tags: ["b", "a"] }));
  });

  it("excludes the pin, so an operation's identity never depends on the pin naming it", () => {
    const op = { operationId: "x", summary: "s" };
    expect(operationDigest({ ...op, "x-loam-based-on": "0123456789abcdef" })).toBe(operationDigest(op));
  });

  it("moves for any real content change", () => {
    const base = { operationId: "x", summary: "s" };
    expect(operationDigest({ ...base, summary: "t" })).not.toBe(operationDigest(base));
    expect(operationDigest({ ...base, deprecated: true })).not.toBe(operationDigest(base));
    expect(operationDigest({ operationId: "y", summary: "s" })).not.toBe(operationDigest(base));
  });

  it("is 16 lowercase hex characters, like every other digest loam stamps", () => {
    expect(operationDigest({ operationId: "x" })).toMatch(/^[0-9a-f]{16}$/);
  });

  it("rides on every parsed Operation, so callers never re-hash by hand", async () => {
    const p = await makeProject({ "services/orders/openapi.yaml": LIVING });
    try {
      const ops = await operations(join(p.docsDir, "services", "orders", "openapi.yaml"));
      expect(ops.map((o) => o.digest)).toEqual([
        operationDigest(cancelOf(LIVING)),
        operationDigest(refundOf(LIVING)),
      ]);
    } finally {
      await p.destroy();
    }
  });
});

/* ------------------------------------------------------------------ */
/* The verdict                                                         */
/* ------------------------------------------------------------------ */

describe("classifyOperationBaseline", () => {
  const living = cancelOf(LIVING);
  const pin = operationDigest(living);
  const pinned = (op: object, value = pin) => ({ ...op, "x-loam-based-on": value });

  it("calls an unpinned operation unpinned, whatever it says", () => {
    expect(classifyOperationBaseline(cancelOf(LIVING), living)).toBe("unpinned");
  });

  it("calls a verbatim restatement a quote — decided against its OWN content", () => {
    expect(classifyOperationBaseline(pinned(cancelOf(LIVING) as object), living)).toBe("quote");
    // Still a quote after somebody else changes the living operation: that is
    // the whole point — the author did not edit it, so it is not theirs to write.
    const moved = cancelOf(contract("Cancel an order, someone else's change", "Refund an order"));
    expect(classifyOperationBaseline(pinned(cancelOf(LIVING) as object), moved)).toBe("quote");
  });

  it("calls a changed operation an edit while the living one is still what it was based on", () => {
    const edited = cancelOf(contract("Cancel an order within 30 minutes", "Refund an order"));
    expect(classifyOperationBaseline(pinned(edited as object), living)).toBe("edit");
  });

  it("calls it stale when both sides moved", () => {
    const edited = cancelOf(contract("Cancel an order within 30 minutes", "Refund an order"));
    const moved = cancelOf(contract("Cancel an order, someone else's change", "Refund an order"));
    expect(classifyOperationBaseline(pinned(edited as object), moved)).toBe("stale");
  });

  it("calls a pin on an operation with no living counterpart unfounded", () => {
    expect(classifyOperationBaseline(pinned(cancelOf(LIVING) as object), undefined)).toBe("unfounded");
  });

  it("treats a malformed pin as stale, never as a quote", () => {
    // A value nobody can evaluate must never be the reason the merge quietly
    // drops an operation; the gate refuses it as `openapi.baseline-invalid`.
    expect(classifyOperationBaseline(pinned(cancelOf(LIVING) as object, "nonsense"), living)).toBe("stale");
  });
});

/* ------------------------------------------------------------------ */
/* The merge                                                           */
/* ------------------------------------------------------------------ */

describe("the merge writes edits and leaves quotes alone", () => {
  /** FEAT edits cancelOrder and quotes refundOrder, pinned against LIVING. */
  const delta = pinOpenapi(contract("Cancel an order within 30 minutes", "Refund an order"), LIVING);

  it("skips the quoted operation and reports it", () => {
    // Living has moved on refundOrder since the delta was written — exactly the
    // case that used to be reverted.
    const movedLiving = contract("Cancel an order", "Refund an order, partially if asked");
    const merged = mergeOpenapiPaths(movedLiving, delta, SVC);
    expect(merged.quoted).toHaveLength(1);
    expect(merged.quoted[0]).toContain("refundOrder");
    expect(summaries(merged.text!)).toEqual({
      cancel: "Cancel an order within 30 minutes",
      refund: "Refund an order, partially if asked",
    });
  });

  it("still writes the edited operation", () => {
    const merged = mergeOpenapiPaths(LIVING, delta, SVC);
    expect(merged.modified.join()).toContain("cancelOrder");
    expect(summaries(merged.text!).cancel).toBe("Cancel an order within 30 minutes");
  });

  it("never lets a pin reach the living contract", () => {
    const merged = mergeOpenapiPaths(LIVING, delta, SVC);
    expect(merged.text).not.toContain("x-loam-based-on");
    // …which is what keeps the NEXT feature's baseline honest: a pin left in
    // would make the following delta hash this feature's bookkeeping.
    const next = pinOpenapi(merged.text!, merged.text!);
    expect(classifyOperationBaseline(cancelOf(next), cancelOf(merged.text!))).toBe("quote");
  });

  it("reports a stale operation and, having got this far, still merges it", () => {
    // Reaching the merge with a stale pin means `--approve`: the gate refuses
    // it, and overriding a gate is what --approve means.
    const movedLiving = contract("Cancel an order, someone else's change", "Refund an order");
    const merged = mergeOpenapiPaths(movedLiving, delta, SVC);
    expect(merged.baselineStale.join()).toContain("cancelOrder");
    expect(summaries(merged.text!).cancel).toBe("Cancel an order within 30 minutes");
  });

  it("leaves an unpinned delta on the old behavior — upsert everything", () => {
    const unpinned = contract("Cancel an order within 30 minutes", "Refund an order");
    const movedLiving = contract("Cancel an order", "Refund an order, partially if asked");
    const merged = mergeOpenapiPaths(movedLiving, unpinned, SVC);
    expect(merged.quoted).toEqual([]);
    // The revert, still there for an adopted corpus that has never been pinned.
    expect(summaries(merged.text!).refund).toBe("Refund an order");
  });
});

describe("pinOpenapiOperations", () => {
  it("pins every operation to the LIVING version, which is what yields both verdicts", () => {
    const edited = contract("Cancel an order within 30 minutes", "Refund an order");
    const plan = pinOpenapiOperations(edited, LIVING, SVC);
    expect(plan.pins.map((p) => [p.operationId, p.status])).toEqual([
      ["cancelOrder", "pinned"],
      ["refundOrder", "pinned"],
    ]);
    // The edited one differs from its pin; the quoted one equals it.
    expect(classifyOperationBaseline(cancelOf(plan.text!), cancelOf(LIVING))).toBe("edit");
    expect(classifyOperationBaseline(refundOf(plan.text!), refundOf(LIVING))).toBe("quote");
  });

  it("is idempotent, and reports the second run as unchanged", () => {
    const once = pinOpenapiOperations(contract("a", "b"), LIVING, SVC);
    const twice = pinOpenapiOperations(once.text!, LIVING, SVC);
    expect(twice.text).toBeNull();
    expect(twice.pins.every((p) => p.status === "unchanged")).toBe(true);
  });

  it("invents nothing for an operation the living contract does not have", () => {
    const added = `openapi: 3.1.0
paths:
  /orders/{id}/hold:
    post:
      operationId: holdOrder
      responses:
        "200": { description: ok }
`;
    const plan = pinOpenapiOperations(added, LIVING, SVC);
    expect(plan.text).toBeNull();
    expect(plan.pins).toEqual([
      expect.objectContaining({ operationId: "holdOrder", status: "unresolved", to: null }),
    ]);
  });

  it("leaves a removal marker unpinned — its own slot check is what guards it", () => {
    const removing = `openapi: 3.1.0
paths:
  /orders/{id}/refund:
    post:
      operationId: refundOrder
      x-loam-remove: true
`;
    const plan = pinOpenapiOperations(removing, LIVING, SVC);
    expect(plan.pins).toEqual([]);
    expect(plan.text).toBeNull();
  });

  it("refuses to stamp through a YAML alias rather than pinning every use of the anchor", () => {
    const aliased = `openapi: 3.1.0
paths:
  /orders/{id}/cancel:
    post: &op
      operationId: cancelOrder
      summary: Cancel an order
      responses:
        "200": { description: ok }
  /orders/{id}/refund:
    post: *op
`;
    const plan = pinOpenapiOperations(aliased, LIVING, SVC);
    // The first use is a real map and is stamped; the alias is named, not
    // silently skipped, and not written through.
    expect(plan.pins.map((p) => p.status)).toEqual(["pinned", "unwritable"]);
    expect(plan.text).not.toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* The gate                                                            */
/* ------------------------------------------------------------------ */

describe("the gate", () => {
  async function coherenceOf(files: Record<string, string>): Promise<Issue[]> {
    const p: Project = await makeProject(files);
    try {
      return await featureCoherence({ docsDir: p.docsDir, featureDir: join(p.docsDir, "features", "FEAT-1-split"), featureId: "FEAT-1" });
    } finally {
      await p.destroy();
    }
  }

  const fixture = (featureApi: string, livingApi = LIVING): Record<string, string> => ({
    ...coherentFixture(),
    [`services/${SVC}/openapi.yaml`]: livingApi,
    [`features/FEAT-1-split/specs/${SVC}/openapi.yaml`]: featureApi,
  });

  const only = (issues: Issue[], code: string): Issue[] => issues.filter((i) => i.code === code);

  it("refuses a stale pin, naming both digests and the command that repins", async () => {
    const delta = pinOpenapi(contract("Cancel an order within 30 minutes", "Refund an order"), LIVING);
    const moved = contract("Cancel an order, someone else's change", "Refund an order");
    const [issue, ...rest] = only(await coherenceOf(fixture(delta, moved)), "openapi.baseline-stale");
    expect(rest).toEqual([]);
    expect(issue!.severity).toBe("error");
    expect(gatesArchive(issue!)).toBe(true);
    expect(issue!.message).toContain("cancelOrder");
    expect(issue!.message).toContain("loam rebase FEAT-1");
  });

  it("says nothing about a quote, however far the living operation has moved", async () => {
    const delta = pinOpenapi(contract("Cancel an order within 30 minutes", "Refund an order"), LIVING);
    const moved = contract("Cancel an order", "Refund an order, partially if asked");
    const issues = await coherenceOf(fixture(delta, moved));
    expect(only(issues, "openapi.baseline-stale")).toEqual([]);
    expect(only(issues, "openapi.baseline-missing")).toEqual([]);
  });

  it("counts unpinned operations into ONE warning per service, and that warning gates", async () => {
    const [issue, ...rest] = only(await coherenceOf(fixture(LIVING)), "openapi.baseline-missing");
    expect(rest).toEqual([]);
    // Warn, not error: the document is legal. Gating, because the merge is
    // not safe — every unpinned restatement reverts whatever landed on it,
    // which is the exact loss the pin exists to prevent. `--approve` remains
    // the deliberate way past.
    expect(issue!.severity).toBe("warn");
    expect(gatesArchive(issue!)).toBe(true);
    // Two unpinned operations, one finding — twenty-nine identical findings
    // naming a one-command fix teach people to filter the code out.
    expect(issue!.message).toContain("2 operation(s)");
    expect(issue!.message).toContain("loam rebase FEAT-1");
  });

  it("refuses a malformed pin, and does not ALSO call it stale", async () => {
    const bad = LIVING.replace(
      "      operationId: cancelOrder",
      "      operationId: cancelOrder\n      x-loam-based-on: yesterday",
    );
    const issues = await coherenceOf(fixture(bad));
    expect(only(issues, "openapi.baseline-invalid")).toHaveLength(1);
    expect(only(issues, "openapi.baseline-stale")).toEqual([]);
  });

  it("refuses a pin on an operation the living contract has no slot for", async () => {
    const added = `openapi: 3.1.0
paths:
  /orders/{id}/hold:
    post:
      operationId: holdOrder
      x-loam-based-on: 0123456789abcdef
      responses:
        "200": { description: ok }
`;
    const [issue] = only(await coherenceOf(fixture(added)), "openapi.baseline-invalid");
    expect(issue!.severity).toBe("error");
    expect(issue!.message).toContain("no operation at that slot");
  });

  it("asks nothing of an operation this feature is genuinely adding", async () => {
    const added = `openapi: 3.1.0
paths:
  /orders/{id}/hold:
    post:
      operationId: holdOrder
      responses:
        "200": { description: ok }
`;
    const issues = await coherenceOf(fixture(added));
    expect(only(issues, "openapi.baseline-missing")).toEqual([]);
    expect(only(issues, "openapi.baseline-invalid")).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* Both losses, end to end                                             */
/* ------------------------------------------------------------------ */

describe("two features over one service", () => {
  /**
   * FEAT-2 edits cancelOrder, FEAT-3 edits refundOrder. Each QUOTES the
   * other's operation, because an openapi delta is a complete document.
   */
  async function twoFeatures(pin: boolean): Promise<Project> {
    const files = coherentFixture();
    files[`services/${SVC}/openapi.yaml`] = LIVING;
    const deltas = {
      "FEAT-2": contract("Cancel an order within 30 minutes", "Refund an order"),
      "FEAT-3": contract("Cancel an order", "Refund an order, partially if asked"),
    } as const;
    for (const [id, api] of Object.entries(deltas)) {
      files[`features/${id}-x/intent.md`] = `---\nfeature: ${id}\nstatus: proposed\n---\n\n# ${id}\n\nWhy.\n`;
      files[`features/${id}-x/specs/${SVC}/openapi.yaml`] = pin ? pinOpenapi(api, LIVING) : api;
    }
    return makeProject(files);
  }

  it("no overlap needed: the unpinned quote's rollback is refused, and takes --approve to choose", async () => {
    // This used to archive both features at exit 0 and let FEAT-2's quote of
    // refundOrder write over FEAT-3's landed change — the silent rollback the
    // pin exists for. The gate refuses the FIRST unpinned archive; the
    // rollback is still reachable, but only through the flag whose help text
    // says "may corrupt the living docs", twice, on purpose.
    const p = await twoFeatures(false);
    try {
      const blocked = await runLoam(p.workDir, "archive", "FEAT-3", "--json");
      expect(blocked.code).toBe(1);
      const refusal = JSON.parse(blocked.stdout + blocked.stderr) as {
        issues: Array<{ code: string; gates: boolean; overridable: boolean }>;
      };
      expect(refusal.issues).toContainEqual(
        expect.objectContaining({ code: "openapi.baseline-missing", gates: true, overridable: true }),
      );
      // The refused run merged nothing.
      expect(summaries(await p.read(`services/${SVC}/openapi.yaml`)).refund).toBe("Refund an order");

      expect((await runLoam(p.workDir, "archive", "FEAT-3", "--approve")).code).toBe(0);
      expect(summaries(await p.read(`services/${SVC}/openapi.yaml`)).refund).toBe("Refund an order, partially if asked");
      // FEAT-2 never meant to touch refundOrder. It quoted it — and under
      // --approve the merge still cannot tell, so the quote writes back over
      // FEAT-3's change. The loss is unchanged; what changed is that somebody
      // had to ask for it by name.
      expect((await runLoam(p.workDir, "archive", "FEAT-2", "--approve")).code).toBe(0);
      expect(summaries(await p.read(`services/${SVC}/openapi.yaml`))).toEqual({
        cancel: "Cancel an order within 30 minutes",
        refund: "Refund an order",
      });
    } finally {
      await p.destroy();
    }
  });

  it("pinned, both changes survive and neither feature is blocked", async () => {
    const p = await twoFeatures(true);
    try {
      expect((await runLoam(p.workDir, "archive", "FEAT-3")).code).toBe(0);
      // Nothing about FEAT-2 is wrong: its edit is untouched and its quote is
      // not its business, so validate stays green.
      const check = await runLoam(p.workDir, "validate", "FEAT-2", "--json");
      expect(check.stdout).not.toContain("openapi.baseline-stale");
      expect((await runLoam(p.workDir, "archive", "FEAT-2")).code).toBe(0);
      expect(summaries(await p.read(`services/${SVC}/openapi.yaml`))).toEqual({
        cancel: "Cancel an order within 30 minutes",
        refund: "Refund an order, partially if asked",
      });
      expect(await p.read(`services/${SVC}/openapi.yaml`)).not.toContain("x-loam-based-on");
    } finally {
      await p.destroy();
    }
  });

  it("the same-operation collision is refused after the first lands", async () => {
    const files = coherentFixture();
    files[`services/${SVC}/openapi.yaml`] = LIVING;
    for (const [id, cancel] of [
      ["FEAT-2", "Cancel an order within 30 minutes"],
      ["FEAT-3", "Cancel an order and refund it"],
    ] as const) {
      files[`features/${id}-x/intent.md`] = `---\nfeature: ${id}\nstatus: proposed\n---\n\n# ${id}\n\nWhy.\n`;
      files[`features/${id}-x/specs/${SVC}/openapi.yaml`] = pinOpenapi(contract(cancel, "Refund an order"), LIVING);
    }
    const p = await makeProject(files);
    try {
      expect((await runLoam(p.workDir, "archive", "FEAT-2")).code).toBe(0);
      const blocked = await runLoam(p.workDir, "archive", "FEAT-3", "--json");
      expect(blocked.code).toBe(1);
      const refusal = JSON.parse(blocked.stdout + blocked.stderr) as {
        issues: Array<{ code: string; gates: boolean }>;
      };
      expect(refusal.issues).toContainEqual(
        expect.objectContaining({ code: "openapi.baseline-stale", gates: true }),
      );
      // FEAT-2's change is still standing.
      expect(summaries(await p.read(`services/${SVC}/openapi.yaml`)).cancel).toBe("Cancel an order within 30 minutes");
    } finally {
      await p.destroy();
    }
  });

  it("`loam rebase` pins the contract axis and reports what moved", async () => {
    const p = await twoFeatures(false);
    try {
      const run = await runLoam(p.workDir, "rebase", "FEAT-2", "--json");
      const payload = JSON.parse(run.stdout) as {
        pins: Array<{ file: string; kind: string; status: string; target: string }>;
      };
      const api = payload.pins.filter((pin) => pin.file === "openapi.yaml");
      expect(api.map((pin) => pin.status)).toEqual(["pinned", "pinned"]);
      expect(api[0]!.kind).toBe("POST");
      expect(await p.read(`features/FEAT-2-x/specs/${SVC}/openapi.yaml`)).toContain("x-loam-based-on");
    } finally {
      await p.destroy();
    }
  });
});

/* ------------------------------------------------------------------ */
/* The closed gaps                                                     */
/* ------------------------------------------------------------------ */

describe("what the pin now covers: the surfaces beside the operations", () => {
  // These two used to pin the DOCUMENTED LOSSES — a quoted component and a
  // quoted path-level key were upserted wholesale, because neither had a slot
  // to hang a pin on. The `x-loam-baselines` record closed both gaps, so the
  // tests flip: the same restatement, pinned when it was authored, is now a
  // QUOTE the merge skips, and the living document keeps whatever landed on
  // it since. The fixtures pin against the living AS IT STOOD at authoring
  // time (a pure restatement), then merge against a moved living — the exact
  // sequence that used to revert the other team's change.
  it("a quoted component is skipped: the living document keeps the newer value", () => {
    const authored = `openapi: 3.1.0
paths:
  /a:
    post:
      operationId: a
      requestBody:
        content:
          application/json:
            schema: { $ref: "#/components/schemas/Order" }
components:
  schemas:
    Order: { type: object, title: "as authored" }
`;
    const delta = pinOpenapi(authored, authored);
    const living = authored.replace('title: "as authored"', 'title: "changed by somebody else"');
    const merged = mergeOpenapiPaths(living, delta, SVC);
    // The operation is a quote and is skipped, as it always was…
    expect(merged.quoted).toHaveLength(1);
    // …and its component no longer rides along: the record entry equals the
    // delta's own content, so the copy is a quote too, and skipping it is what
    // keeps somebody else's landed change standing.
    expect(merged.componentsModified).toEqual([]);
    expect(merged.componentsQuoted).toEqual(["schemas/Order"]);
    expect(merged.text).toContain("changed by somebody else");
  });

  it("a quoted path-level key is skipped, not upserted wholesale", () => {
    const authored = `openapi: 3.1.0
paths:
  /a:
    parameters: [{ name: tenant, in: header }]
    post:
      operationId: a
      responses:
        "200": { description: ok }
`;
    const delta = pinOpenapi(authored, authored);
    const living = authored.replace("[{ name: tenant, in: header }]", "[{ name: tenant, in: header, required: true }]");
    const merged = mergeOpenapiPaths(living, delta, SVC);
    expect(merged.quoted).toHaveLength(1);
    expect(merged.pathItemModified).toEqual([]);
    expect(merged.pathItemQuoted).toEqual(["'parameters' (/a)"]);
    expect(merged.text).toContain("required: true");
  });
});
