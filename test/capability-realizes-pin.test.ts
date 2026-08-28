/**
 * The `Realizes:` pin — loam's one standing suspect link over the LIVING corpus.
 *
 * Every other capability check is an EXISTENCE constraint: it fires when the
 * target is gone and stays silent when the target merely changed. That silence
 * is what this axis closes, and the property is easy to lose by accident, so
 * three things are pinned here rather than left to review:
 *
 * 1. A promise rewritten under a pinned claim produces `capability.realizes-stale`
 *    at every service that claims it — the whole point.
 * 2. Re-pinning does NOT change the pinning requirement's own digest. Without
 *    `withoutRealizesPins` inside `requirementDigest`, one analyst edit would
 *    invalidate every `Based-On:` baseline in the fleet — the corpus-wide
 *    cascade the pin exists to REPORT rather than to cause. This is the
 *    assertion most likely to catch a future refactor.
 * 3. An UNPINNED corpus grades exactly as it did before pins existed. That is
 *    what lets the feature land without a migration, and it is the assertion a
 *    well-meaning "just pin everything automatically" change would break.
 */
import { describe, it, expect } from "vitest";
import {
  requirementDigest,
  splitRealizesPin,
  withoutRealizesPins,
} from "../src/core/document/spec.js";
import { parseRequirements } from "../src/core/document/parse.js";
import { capabilityRequirementIndex } from "../src/core/capabilities/findings.js";
import { readCapabilityVocabulary } from "../src/core/capabilities/capabilities.js";
import { makeProject, runLoam, type Project } from "./helpers/harness.js";

const CAPABILITY_SPEC = `# checkout

## Requirements

### Requirement: Charge exactly once

Requirement-ID: CHK-ONCE
The customer SHALL be charged exactly once for one confirmed basket.

#### Scenario: A retried confirmation charges once
- **Given** a basket confirmed twice by a retry
- **Then** one charge exists
`;

const SERVICE_SPEC = (realizes: string): string => `---
service: payment-service
status: draft
owner: payments-team
---

# payment-service

## Requirements

### Requirement: Authorize a payment

Requirement-ID: PAY-AUTH
The service SHALL reserve funds before capture.

Realizes: ${realizes}

#### Scenario: Successful authorization
- **Given** a valid payment method
- **When** authorization is requested
- **Then** funds are reserved
`;

const LANDSCAPE = `specification {
  element softwareSystem
}

model {
  paymentService = softwareSystem 'payment-service' {
    metadata {
      service 'payment-service'
    }
  }
}
`;

const SERVICE_MODEL = `specification {
  element softwareSystem
  element container
}

model {
  paymentService = softwareSystem 'payment-service' {
    api = container 'api'
  }
  other = softwareSystem 'order-service' {
    metadata { service 'order-service' }
  }
  paymentService.api -> other 'Notifies'
}
`;

function fixture(realizes: string): Record<string, string> {
  return {
    "architecture/landscape.likec4": LANDSCAPE,
    "architecture/capabilities.yaml": "capabilities:\n  checkout:\n    description: Checkout\n",
    "capabilities/checkout/spec.md": CAPABILITY_SPEC,
    "services/payment-service/model.likec4": SERVICE_MODEL,
    "services/payment-service/spec.md": SERVICE_SPEC(realizes),
  };
}

async function realizesFindings(project: Project): Promise<{ code: string; severity: string }[]> {
  const run = await runLoam(project.workDir, "validate", "--all", "--json");
  const parsed = JSON.parse(run.stdout) as { targets?: { findings?: { code: string; severity: string }[] }[] };
  return (parsed.targets ?? [])
    .flatMap((t) => t.findings ?? [])
    .filter((f) => f.code.startsWith("capability.realizes"));
}

describe("the Realizes pin", () => {
  it("splits a pin off an entry, and refuses to read a non-digest suffix as one", () => {
    expect(splitRealizesPin("checkout#CHK-ONCE@0123456789abcdef")).toEqual({
      target: "checkout#CHK-ONCE",
      pin: "0123456789abcdef",
    });
    expect(splitRealizesPin("checkout#CHK-ONCE")).toEqual({ target: "checkout#CHK-ONCE", pin: null });
    // Not 16 hex characters: the whole string stays the target, so the entry
    // fails under `capability.realizes-unknown` naming what the author typed
    // rather than under a second refusal invented for one mistake.
    expect(splitRealizesPin("checkout#CHK-ONCE@nonsense")).toEqual({
      target: "checkout#CHK-ONCE@nonsense",
      pin: null,
    });
  });

  it("takes the same digest whether or not the requirement's Realizes line is pinned", () => {
    const bare = parseRequirements(SERVICE_SPEC("checkout#CHK-ONCE"))[0]!;
    const pinned = parseRequirements(SERVICE_SPEC("checkout#CHK-ONCE@0123456789abcdef"))[0]!;
    // THE cascade guard. If these ever differ, `loam rebase --living` becomes a
    // command that invalidates every baseline in the fleet.
    expect(requirementDigest(pinned)).toBe(requirementDigest(bare));
    expect(withoutRealizesPins(pinned).text).toEqual(bare.text);
  });

  it("reports nothing for an unpinned corpus, however stale the promise gets", async () => {
    const project = await makeProject(fixture("checkout#CHK-ONCE"));
    try {
      expect(await realizesFindings(project)).toEqual([]);
      await project.write(
        "capabilities/checkout/spec.md",
        CAPABILITY_SPEC.replace("exactly once for one", "exactly once, and never twice, for one"),
      );
      // Still nothing: an entry that was never pinned makes no claim about a
      // version, so there is no claim to have gone stale.
      expect(await realizesFindings(project)).toEqual([]);
    } finally {
      await project.destroy();
    }
  });

  it("reports capability.realizes-stale once the promise moves under a pin", async () => {
    const project = await makeProject(fixture("checkout#CHK-ONCE"));
    try {
      const pinned = await runLoam(project.workDir, "rebase", "--living");
      expect(pinned.code).toBe(0);
      const spec = await project.read("services/payment-service/spec.md");
      expect(spec).toMatch(/Realizes: checkout#CHK-ONCE@[0-9a-f]{16}/);
      // Pinned and current: silent.
      expect(await realizesFindings(project)).toEqual([]);

      await project.write(
        "capabilities/checkout/spec.md",
        CAPABILITY_SPEC.replace("exactly once for one", "exactly once, and never twice, for one"),
      );
      const stale = await realizesFindings(project);
      expect(stale).toHaveLength(1);
      expect(stale[0]!.code).toBe("capability.realizes-stale");
      // A warn, not an error: re-reading a moved promise has three legitimate
      // outcomes and loam cannot tell which. Making this an error would remove
      // two of them without `--approve`.
      expect(stale[0]!.severity).toBe("warn");

      // Recording the re-read clears it, and only that.
      const repinned = await runLoam(project.workDir, "rebase", "--living");
      expect(repinned.code).toBe(0);
      expect(await realizesFindings(project)).toEqual([]);
    } finally {
      await project.destroy();
    }
  });

  it("keeps byCapability and digests over exactly the same ids", async () => {
    const project = await makeProject(fixture("checkout#CHK-ONCE"));
    try {
      const vocab = await readCapabilityVocabulary(project.docsDir);
      const index = await capabilityRequirementIndex(vocab, async (p) =>
        parseRequirements(await import("node:fs/promises").then((fs) => fs.readFile(p, "utf8"))),
      );
      // The one invariant the second map buys its existence with.
      expect([...index.digests.keys()].sort()).toEqual([...index.byCapability.keys()].sort());
      for (const [capability, ids] of index.byCapability) {
        expect([...index.digests.get(capability)!.keys()].sort()).toEqual([...ids].sort());
      }
    } finally {
      await project.destroy();
    }
  });
});
