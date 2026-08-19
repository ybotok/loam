/**
 * The AsyncAPI feature lifecycle, end to end through the real CLI: author a
 * producer delta → the unpinned quotes gate the archive → `loam rebase` pins
 * them → `validate --feature` green → `archive` merges the delta into the
 * living contract (and the new producer resolves the consumer's
 * spine.message-unproduced in `validate --all`) → `unarchive` restores every
 * byte with no --force — and a fault-injected commit failure rolls the
 * asyncapi write back with the rest of the plan (the archive-rollback
 * technique: the harness runs commands in-process, so wrapping this module
 * graph's own node:fs/promises `rename` faults exactly one swap).
 */
import { describe, expect, it, vi } from "vitest";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "yaml";
import {
  FEATURE_ASYNCAPI,
  LIVING_ASYNCAPI,
  LIVING_OPENAPI,
  LIVING_SPEC,
  SERVICE_MODEL,
  makeProject,
  pinAsyncapi,
  runLoam,
  treeHashes,
} from "./helpers/harness.js";

/** Fault injection for the commit phase — passthrough while `onRename` is unset. */
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
 * The consumer half of the spine, LIVING before the feature exists: the
 * landscape edge, the requirement line and billing-service's own receive
 * contract all already consume payment.Refunded — which nothing produces
 * yet. That is exactly the fleet state whose red this feature turns green.
 */
const EVENT_LANDSCAPE = `specification {
  element softwareSystem
}

model {
  paymentService = softwareSystem 'payment-service' {
    description 'Owns payment authorization/capture'
  }
  billingService = softwareSystem 'billing-service' {
    description 'Reconciles refunds from payment events'
  }

  paymentService -> billingService 'Delivers refund events' {
    metadata { consumes 'payment.Refunded' }
  }
}

views {
  view landscape {
    include *
  }
}
`;

const BILLING_MODEL = `specification {
  element softwareSystem
  element container
}

model {
  billingService = softwareSystem 'billing-service' {
    description 'Reconciles refunds from payment events'
    worker = container 'worker'
  }
}

views {
  view of billingService {
    include *
  }
}
`;

const BILLING_SPEC = `---
service: billing-service
status: verified
---

# billing-service

## Requirements

### Requirement: Reconcile refunds
The service SHALL reconcile refunds from the payment refund event.

Consumes: payment.Refunded

#### Scenario: Refund event arrives
- **Given** a refund event
- **When** it is delivered
- **Then** reconciliation runs
`;

const BILLING_ASYNCAPI = `asyncapi: 3.0.0
info:
  title: billing-service events
  version: "1.0"
channels:
  refundEvents:
    address: payment.refunds.v1
    messages:
      Refunded:
        $ref: '#/components/messages/Refunded'
operations:
  receiveRefunded:
    action: receive
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

/** The producer-side requirement delta — the archive's FIRST planned write, so the fault tests have a plan to roll back around the asyncapi swap. */
const FEATURE_SPEC = `# payment-service — delta for FEAT-60

## ADDED Requirements

### Requirement: Publish refund events
The service SHALL publish a refund event when a payment is refunded.

Publishes: payment.Refunded

#### Scenario: Refund published
- **Given** a refunded payment
- **When** the refund settles
- **Then** payment.Refunded is published
`;

const INTENT = `---
feature: FEAT-60
status: proposed
---

# Produce refund events

billing-service already consumes payment.Refunded; give it a producer.
`;

function lifecycleFixture(featureAsyncapi: string = FEATURE_ASYNCAPI): Record<string, string> {
  return {
    "architecture/landscape.likec4": EVENT_LANDSCAPE,
    "services/payment-service/model.likec4": SERVICE_MODEL,
    "services/payment-service/spec.md": LIVING_SPEC,
    "services/payment-service/openapi.yaml": LIVING_OPENAPI,
    "services/payment-service/asyncapi.yaml": LIVING_ASYNCAPI,
    "services/billing-service/model.likec4": BILLING_MODEL,
    "services/billing-service/spec.md": BILLING_SPEC,
    "services/billing-service/asyncapi.yaml": BILLING_ASYNCAPI,
    "features/FEAT-60-refunds/intent.md": INTENT,
    "features/FEAT-60-refunds/specs/payment-service/spec.md": FEATURE_SPEC,
    "features/FEAT-60-refunds/specs/payment-service/asyncapi.yaml": featureAsyncapi,
  };
}

const fleetCodes = (stdout: string): string[] => {
  const payload = JSON.parse(stdout) as { targets: Array<{ findings: Array<{ code: string }> }> };
  return payload.targets.flatMap((t) => t.findings.map((f) => f.code));
};

const ASYNCAPI_TARGET = join("services", "payment-service", "asyncapi.yaml");

describe("the AsyncAPI feature lifecycle, end to end", () => {
  it("author → rebase → validate → archive → validate --all → unarchive restores every byte", async () => {
    const p = await makeProject(lifecycleFixture());
    try {
      // The fleet is red before the feature lands: the consumer's message has
      // no producer anywhere.
      const before = await runLoam(p.workDir, "validate", "--all", "--json");
      expect(before.code).toBe(1);
      expect(fleetCodes(before.stdout)).toContain("spine.message-unproduced");

      // The delta quotes living slots without pins — the archive must refuse
      // until rebase stamps them, or every restatement would overwrite.
      const unpinned = await runLoam(p.workDir, "archive", "FEAT-60", "--json");
      expect(unpinned.code).toBe(1);
      const refusal = JSON.parse(unpinned.stdout);
      expect(refusal.error.code).toBe("not-coherent");
      expect((refusal.issues as Array<{ code: string }>).map((i) => i.code)).toContain("asyncapi.baseline-missing");

      // rebase pins the quoted slots against living; the slots this feature
      // ADDS have no living version and stay honestly unresolved.
      const rebase = await runLoam(p.workDir, "rebase", "FEAT-60", "--json");
      expect(rebase.code).toBe(0);
      const pins = (JSON.parse(rebase.stdout).pins as Array<{ file: string; kind: string; target: string; status: string }>)
        .filter((pin) => pin.file === "asyncapi.yaml");
      expect(pins.map((pin) => [pin.kind, pin.target, pin.status])).toEqual([
        ["channels", "paymentEvents", "pinned"],
        ["channels", "refundEvents", "unresolved"],
        ["operations", "sendAuthorized", "pinned"],
        ["operations", "sendRefunded", "unresolved"],
        ["components.messages", "Authorized", "pinned"],
        ["components.messages", "Refunded", "unresolved"],
      ]);

      expect((await runLoam(p.workDir, "validate", "--feature", "FEAT-60")).code).toBe(0);

      // Everything from here on must be a round trip.
      const pristine = await treeHashes(p.docsDir);

      const archive = await runLoam(p.workDir, "archive", "FEAT-60", "--json");
      expect(archive.code).toBe(0);
      const payload = JSON.parse(archive.stdout);
      expect((payload.plan as Array<{ path: string; action: string }>).map((w) => `${w.action} ${w.path}`)).toEqual([
        "update services/payment-service/spec.md",
        "update services/payment-service/asyncapi.yaml",
        "move features/FEAT-60-refunds",
      ]);
      expect(payload.asyncapiRemovals).toEqual([]);
      const living = await p.read("services/payment-service/asyncapi.yaml");
      expect(living).not.toContain("x-loam");
      const doc = parse(living);
      expect(doc.operations.sendRefunded.action).toBe("send");
      expect(doc.components.messages.Refunded.name).toBe("payment.Refunded");
      // The quoted Authorized slot is living's own copy, not a rewrite.
      expect(doc.components.messages.Authorized).toEqual(parse(LIVING_ASYNCAPI).components.messages.Authorized);

      // The new producer resolves the consumer's spine: the fleet goes green.
      const after = await runLoam(p.workDir, "validate", "--all", "--json");
      expect(after.code).toBe(0);
      expect(fleetCodes(after.stdout)).not.toContain("spine.message-unproduced");

      // unarchive restores the pre-archive tree byte for byte — no --force,
      // no snapshot-stale: the merge wrote exactly what the snapshot recorded.
      expect((await runLoam(p.workDir, "unarchive", "FEAT-60")).code).toBe(0);
      expect(await treeHashes(p.docsDir), "unarchive must be a byte-for-byte round trip").toEqual(pristine);
    } finally {
      await p.destroy();
    }
  });

  it("the verify checklist asks the event question, and a recorded answer round-trips", async () => {
    const p = await makeProject(lifecycleFixture());
    try {
      const res = await runLoam(p.workDir, "verify", "FEAT-60", "--json");
      expect(res.code).toBe(0);
      const claims = JSON.parse(res.stdout).claims as Array<{ id: string; kind: string; subject: string; claim: string }>;
      // One claim per genuinely NEW (direction, message). The delta also
      // restates the living payment.Authorized send — a quote of the living
      // contract is never a question, so exactly one claim comes back.
      const declares = claims.filter((c) => c.kind === "event.declares");
      expect(declares).toHaveLength(1);
      expect(declares[0]!.subject).toBe("payment-service");
      expect(declares[0]!.claim).toBe("payment-service declares it sends message 'payment.Refunded'");

      // The answer round-trips through the record: `--record` accepts the new
      // kind (all-at-once form — no attestations exist here to erase), the
      // written verification.yaml carries it, and a re-read is not stale.
      const answers = claims.map((c) => ({ id: c.id, verdict: "confirmed", evidence: ["src/refunds/publisher.ts:12"] }));
      await writeFile(join(p.workDir, "answers.json"), JSON.stringify({ answers }), "utf8");
      expect((await runLoam(p.workDir, "verify", "FEAT-60", "--record", "answers.json")).code).toBe(0);
      const record = parse(await p.read("features/FEAT-60-refunds/verification.yaml")) as {
        claims: Array<{ id: string; kind: string; verdict: string; evidence?: string[] }>;
      };
      const recorded = record.claims.find((c) => c.kind === "event.declares");
      expect(recorded).toMatchObject({ id: declares[0]!.id, verdict: "confirmed" });
      const back = JSON.parse((await runLoam(p.workDir, "verify", "FEAT-60", "--json")).stdout);
      expect(back.recorded.stale).not.toBe(true);
      const readBack = (back.claims as Array<{ kind: string; verdict: string }>).find((c) => c.kind === "event.declares");
      expect(readBack?.verdict).toBe("confirmed");
      expect(back.verified).toBe(false); // the scenario claim rests on an agent's word: attested
      expect(back.verdict).toBe("attested");
    } finally {
      await p.destroy();
    }
  });

  it("a fault-injected commit failure rolls the asyncapi write back with the rest of the plan", async () => {
    // Pre-pinned via the same function `loam rebase` runs, so the fixture is
    // deterministic without a rebase pass.
    const p = await makeProject(lifecycleFixture(pinAsyncapi(FEATURE_ASYNCAPI, LIVING_ASYNCAPI)));
    try {
      const before = await treeHashes(p.docsDir);
      // The asyncapi swap is the SECOND of the plan's three moves (after the
      // spec.md swap, before the feature move) — failing it exercises a
      // rollback with real pre-image bytes already swapped in.
      fsFault.onRename = (_from, to) => {
        if (to.endsWith(ASYNCAPI_TARGET)) throw new Error("injected: the asyncapi swap failed");
      };
      const res = await runLoam(p.workDir, "archive", "FEAT-60", "--json");
      fsFault.onRename = undefined;

      expect(res.code).toBe(1);
      const json = JSON.parse(res.stdout);
      expect(json.ok).toBe(false);
      expect(json.error.code).toBe("merge-failed");
      expect(json.error.message.toLowerCase()).toContain("rolled back");
      // The whole tree: spec.md (already swapped, restored from its
      // pre-image), the living asyncapi (the failed swap), the feature and
      // its unstamped delta — and no snapshot or temp files left behind.
      expect(await treeHashes(p.docsDir), "the rollback must be byte-identical, tree-wide").toEqual(before);
      expect(p.exists("features/FEAT-60-refunds/.loam-before")).toBe(false);

      // After the rolled-back failure the archive can simply be re-run.
      expect((await runLoam(p.workDir, "archive", "FEAT-60")).code).toBe(0);
      expect(parse(await p.read("services/payment-service/asyncapi.yaml")).components.messages.Refunded).toBeDefined();
      expect(p.exists("features/archive/FEAT-60-refunds")).toBe(true);
    } finally {
      fsFault.onRename = undefined;
      await p.destroy();
    }
  });
});
