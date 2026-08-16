/**
 * Rollback under REAL mid-write failure (src/core/staging.ts, driven by
 * `loam archive`).
 *
 * The commit-phase tests in archive.test.ts fail the FINAL move, after every
 * living-doc swap has already succeeded — which never exercises the interesting
 * half of rollbackStaged: a failure in the MIDDLE of the swap loop, with some
 * files already carrying merged bytes and some not. These tests inject faults
 * into rename(2) itself (the passthrough-wrapper pattern from
 * test/unarchive.test.ts) and pin the two answers the stable codes promise:
 *
 *   merge-failed         the rollback held — the repo is byte-identical to
 *                        before, and re-running can work;
 *   rollback-incomplete  the rollback did NOT hold — the message must name
 *                        every file a human now has to look at.
 */
import { describe, it, expect, vi } from "vitest";
import { join } from "node:path";
import {
  makeProject,
  runLoam,
  treeHashes,
  pinFor,
  pinOpenapi,
  LANDSCAPE,
  LIVING_OPENAPI,
  LIVING_SPEC,
} from "./helpers/harness.js";

/**
 * Fault injection for the commit phase. The harness runs commands in-process,
 * so every swap and rollback rename goes through this module graph's own
 * node:fs/promises — wrapping `rename` lets a test fail exactly one step and
 * watch which stable code comes back. Passthrough while `onRename` is unset.
 */
const fsFault = vi.hoisted(() => ({
  onRename: undefined as undefined | ((from: string, to: string) => void),
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    rename: async (from: Parameters<typeof actual.rename>[0], to: Parameters<typeof actual.rename>[1]) => {
      fsFault.onRename?.(String(from), String(to));
      return actual.rename(from, to);
    },
  };
});

/**
 * A feature whose merge plans exactly THREE living-doc updates, in this order
 * (runArchive plans requirements, then openapi, then architecture):
 *
 *   1. services/payment-service/spec.md      (MODIFIED + ADDED requirements)
 *   2. services/payment-service/openapi.yaml (capturePayment merged in)
 *   3. architecture/landscape.likec4         (the tagged capture edge)
 *
 * All three are updates of files that already exist, so a rollback has real
 * pre-image bytes to restore — not just creations to delete.
 */
const THREE_SWAP_SPEC_DELTA = `# payment-service — delta for FEAT-30

## MODIFIED Requirements

### Requirement: Authorize a payment
Based-On: ${pinFor(LIVING_SPEC, "Authorize a payment")}
The service SHALL authorize a payment within 2 seconds.

Operations: authorizePayment

#### Scenario: Fast authorization
- **Given** a valid card
- **When** authorization is requested
- **Then** it completes within 2 seconds

## ADDED Requirements

### Requirement: Capture a payment
The service SHALL capture an authorized payment exactly once.

Operations: capturePayment

#### Scenario: Successful capture
- **Given** an authorized payment
- **When** capture is requested
- **Then** the payment is captured
`;

/** The full API restated (delta files are complete documents), plus the new op. */
const THREE_SWAP_OPENAPI_DELTA = `openapi: 3.1.0
info:
  title: payment-service
  version: "1.0"
paths:
  /payments/authorize:
    post:
      operationId: authorizePayment
      summary: Authorize a payment
      responses:
        "200":
          description: Authorized
  /payments/capture:
    post:
      operationId: capturePayment
      summary: Capture a payment
      responses:
        "200":
          description: Captured
`;

const THREE_SWAP_C4_DELTA = `specification {
  element softwareSystem
  tag FEAT-30
}

model {
  checkoutWeb = softwareSystem 'checkout-web'
  paymentService = softwareSystem 'payment-service'

  checkoutWeb -> paymentService 'Calls capturePayment' {
    #FEAT-30
    metadata { op 'capturePayment' }
  }
}

views {
  view feat_30 {
    include *
  }
}
`;

function threeSwapFixture(): Record<string, string> {
  return {
    "architecture/landscape.likec4": LANDSCAPE,
    "services/payment-service/spec.md": LIVING_SPEC,
    "services/payment-service/openapi.yaml": LIVING_OPENAPI,
    "features/FEAT-30-capture/delta.likec4": THREE_SWAP_C4_DELTA,
    "features/FEAT-30-capture/specs/payment-service/spec.md": THREE_SWAP_SPEC_DELTA,
    // The restated authorizePayment must carry its x-loam-based-on pin (and the
    // MODIFIED requirement above its Based-On:) or the baseline-missing gates
    // now stop the archive at coherence — before the commit phase these tests
    // exist to fault. Pins are computed, not hard-coded, so the fixture stays
    // byte-deterministic and the pre/post treeHashes comparisons stay honest.
    "features/FEAT-30-capture/specs/payment-service/openapi.yaml": pinOpenapi(
      THREE_SWAP_OPENAPI_DELTA,
      LIVING_OPENAPI,
    ),
    // One line of real prose: the intent.empty gate would otherwise refuse the
    // archive before any swap is planned.
    "features/FEAT-30-capture/intent.md": `---\nfeature: FEAT-30\nstatus: proposed\n---\n\n# Capture payments\n\nLet an authorized payment be captured exactly once.\n`,
  };
}

const OPENAPI_TARGET = join("services", "payment-service", "openapi.yaml");
const SPEC_TARGET = join("services", "payment-service", "spec.md");

describe("rollback under mid-write failure", () => {
  it("plans the three-update merge these tests depend on (fixture self-check)", async () => {
    // If the plan ever stops being [spec.md, openapi.yaml, landscape], the
    // faults below would land on the wrong step and test nothing.
    const p = await makeProject(threeSwapFixture());
    try {
      const res = await runLoam(p.workDir, "archive", "FEAT-30", "--dry-run", "--json");
      expect(res.code).toBe(0);
      const plan = JSON.parse(res.stdout).plan as Array<{ path: string; action: string }>;
      expect(plan.map((w) => `${w.action} ${w.path}`)).toEqual([
        "update services/payment-service/spec.md",
        "update services/payment-service/openapi.yaml",
        "update architecture/landscape.likec4",
        "move features/FEAT-30-capture",
      ]);
    } finally {
      await p.destroy();
    }
  });

  it("second of three swaps fails → everything already swapped is rolled back byte-identically (merge-failed)", async () => {
    const p = await makeProject(threeSwapFixture());
    try {
      const before = await treeHashes(p.docsDir);
      fsFault.onRename = (_from, to) => {
        if (to.endsWith(OPENAPI_TARGET)) throw new Error("injected: the second swap failed");
      };
      const res = await runLoam(p.workDir, "archive", "FEAT-30", "--json");
      fsFault.onRename = undefined;

      expect(res.code).toBe(1);
      const json = JSON.parse(res.stdout);
      expect(json.ok).toBe(false);
      expect(json.error.code).toBe("merge-failed");
      expect(json.error.message.toLowerCase()).toContain("rolled back");
      // The whole tree — spec.md (already swapped, restored from its pre-image),
      // openapi.yaml (the failed swap), landscape (never reached), the feature
      // itself, and no snapshot or temp files left behind.
      expect(await treeHashes(p.docsDir), "the rollback must be byte-identical, tree-wide").toEqual(before);
      // Explicitly: the rollback HELD, so the snapshot describes a merge that
      // never happened and must be gone.
      expect(p.exists("features/FEAT-30-capture/.loam-before")).toBe(false);
    } finally {
      fsFault.onRename = undefined;
      await p.destroy();
    }
  });

  it("after the rolled-back failure the archive can simply be re-run, and succeeds", async () => {
    const p = await makeProject(threeSwapFixture());
    try {
      fsFault.onRename = (_from, to) => {
        if (to.endsWith(OPENAPI_TARGET)) throw new Error("injected: the second swap failed");
      };
      expect((await runLoam(p.workDir, "archive", "FEAT-30")).code).toBe(1);
      fsFault.onRename = undefined;

      expect((await runLoam(p.workDir, "archive", "FEAT-30")).code).toBe(0);
      expect(await p.read("services/payment-service/spec.md")).toContain("Capture a payment");
      expect(p.exists("features/archive/FEAT-30-capture")).toBe(true);
    } finally {
      fsFault.onRename = undefined;
      await p.destroy();
    }
  });

  it("a swap fails AND a rollback rename fails → rollback-incomplete, naming the file left half-merged", async () => {
    const p = await makeProject(threeSwapFixture());
    try {
      // The second swap fails; from then on, restoring spec.md (the one file
      // already swapped) is blocked too — its rollback goes through an atomic
      // write whose final step is itself a rename.
      let swapFailed = false;
      fsFault.onRename = (_from, to) => {
        if (to.endsWith(OPENAPI_TARGET)) {
          swapFailed = true;
          throw new Error("injected: the second swap failed");
        }
        if (swapFailed && to.endsWith(SPEC_TARGET)) {
          throw new Error("injected: rollback blocked");
        }
      };
      const res = await runLoam(p.workDir, "archive", "FEAT-30", "--json");
      fsFault.onRename = undefined;

      expect(res.code).toBe(1);
      const json = JSON.parse(res.stdout);
      expect(json.ok).toBe(false);
      expect(json.error.code).toBe("rollback-incomplete");
      expect(json.error.message).toContain("ROLLBACK INCOMPLETE");
      // The message must name the affected file — it is the to-do list of the
      // human who now has to look at the repo by hand.
      expect(json.error.message).toContain(join("services", "payment-service", "spec.md"));
      expect(json.error.message).not.toContain("landscape.likec4");

      // The repo genuinely is half-merged: spec.md still carries the merged
      // bytes the rollback could not take back; the other two never swapped.
      expect(await p.read("services/payment-service/spec.md")).toContain("within 2 seconds");
      expect(await p.read("services/payment-service/openapi.yaml")).toBe(LIVING_OPENAPI);
      expect(await p.read("architecture/landscape.likec4")).toBe(LANDSCAPE);

      // The snapshot SURVIVES: it holds the only on-disk pre-image of the
      // half-merged spec.md — deleting it here used to destroy the very bytes
      // the message above sends a human off to restore by hand.
      expect(p.exists("features/FEAT-30-capture/.loam-before/manifest.json")).toBe(true);
      expect(
        await p.read("features/FEAT-30-capture/.loam-before/files/services/payment-service/spec.md"),
        "the pre-image must be byte-identical to the living spec before the merge",
      ).toBe(LIVING_SPEC);
      // and the message says where the pre-images live, so the repairer finds them
      expect(json.error.message).toContain("features/FEAT-30-capture/.loam-before/files/");
      // The feature was not archived — it is still here to re-run once the
      // repo has been looked at.
      expect(p.exists("features/FEAT-30-capture/delta.likec4")).toBe(true);
      expect(p.exists("features/archive/FEAT-30-capture")).toBe(false);
    } finally {
      fsFault.onRename = undefined;
      await p.destroy();
    }
  });
});
