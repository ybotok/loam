import { describe, expect, it, vi } from "vitest";
import { parse } from "yaml";
import { makeProject, pinFor, runLoam, treeHashes } from "./helpers/harness.js";

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

const LIVING_SPEC = `# payment-service

## Requirements

### Requirement: Legacy authorization
The service SHALL authorize through the legacy endpoint.

Operations: legacyOp

#### Scenario: Legacy authorization
- **Given** a payment
- **When** legacy authorization runs
- **Then** it completes
`;

const LIVING_OPENAPI = `openapi: 3.1.0
info: { title: payment-service, version: "1" }
paths:
  /legacy:
    post:
      operationId: legacyOp
      responses: { "200": { description: ok } }
  /health:
    get:
      operationId: health
      responses: { "200": { description: ok } }
components:
  schemas:
    Legacy: { type: object }
`;

// The REMOVED requirement carries a Based-On pin because delta.baseline-missing
// now gates archive: an unpinned removal cannot prove the living text it deletes
// is the text it was written against. The pin is computed, not hard-coded, so the
// unarchive round-trip stays byte-deterministic. The x-loam-remove marker below
// needs no x-loam-based-on — a removal marker is not a restatement, and its slot
// is guarded by the remove-target checks instead.
const REMOVED_SPEC = `# retirement

## REMOVED Requirements

### Requirement: Legacy authorization
Based-On: ${pinFor(LIVING_SPEC, "Legacy authorization")}

Operations: legacyOp
`;

const REMOVAL_OPENAPI = `openapi: 3.1.0
paths:
  /legacy:
    post:
      operationId: legacyOp
      x-loam-remove: true
`;

function fixture(): Record<string, string> {
  return {
    "services/payment-service/spec.md": LIVING_SPEC,
    "services/payment-service/openapi.yaml": LIVING_OPENAPI,
    "features/FEAT-40-retire-legacy/specs/payment-service/spec.md": REMOVED_SPEC,
    "features/FEAT-40-retire-legacy/specs/payment-service/openapi.yaml": REMOVAL_OPENAPI,
    // intent.empty now gates archive, and a feature with no intent.md at all
    // gates identically to one whose intent is still the scaffold's comments —
    // so the fixture states its Why in one line of real prose.
    "features/FEAT-40-retire-legacy/intent.md": `# Retire legacy authorization

The legacy authorization endpoint is being retired from payment-service.
`,
  };
}

describe("archive OpenAPI operation removal", () => {
  it("does not turn a removal marker into a new-api verification claim", async () => {
    const p = await makeProject(fixture(), { service: "payment-service" });
    try {
      const res = await runLoam(p.workDir, "verify", "FEAT-40", "--json");
      expect(res.code).toBe(0);
      const payload = JSON.parse(res.stdout);
      expect(payload.claims.filter((claim: { kind: string }) => claim.kind === "api.exposes")).toEqual([]);
    } finally {
      await p.destroy();
    }
  });

  it("dry-run reports the deletion as data and remains byte-transactional", async () => {
    const p = await makeProject(fixture(), { service: "payment-service" });
    try {
      const before = await treeHashes(p.docsDir);
      const res = await runLoam(p.workDir, "archive", "FEAT-40", "--dry-run", "--json");
      expect(res.code).toBe(0);
      const payload = JSON.parse(res.stdout);
      expect(payload.openapiRemovals).toEqual([
        { service: "payment-service", operations: ["'legacyOp' (post /legacy)"] },
      ]);
      expect(await treeHashes(p.docsDir)).toEqual(before);
    } finally {
      await p.destroy();
    }
  });

  it("deletes the living method, keeps components, and never persists the marker", async () => {
    const p = await makeProject(fixture(), { service: "payment-service" });
    try {
      const res = await runLoam(p.workDir, "archive", "FEAT-40");
      expect(res.code).toBe(0);
      expect(res.out).toContain("removes 'legacyOp' (post /legacy)");
      const text = await p.read("services/payment-service/openapi.yaml");
      const api = parse(text);
      // `/legacy` held only the retired operation, so the path goes too — an
      // empty path item is a route the contract advertises and nothing serves.
      expect(api.paths["/legacy"]).toBeUndefined();
      expect(api.paths["/health"].get.operationId).toBe("health");
      expect(api.components.schemas.Legacy).toBeDefined();
      expect(text).not.toContain("x-loam-remove");
    } finally {
      await p.destroy();
    }
  });

  it("unarchive restores the removed operation byte-for-byte", async () => {
    const p = await makeProject(fixture(), { service: "payment-service" });
    try {
      const before = await treeHashes(p.docsDir);
      expect((await runLoam(p.workDir, "archive", "FEAT-40")).code).toBe(0);
      expect((await runLoam(p.workDir, "unarchive", "FEAT-40")).code).toBe(0);
      expect(await treeHashes(p.docsDir)).toEqual(before);
    } finally {
      await p.destroy();
    }
  });

  it("a mid-commit failure rolls an already-applied requirement deletion back", async () => {
    const p = await makeProject(fixture(), { service: "payment-service" });
    try {
      const before = await treeHashes(p.docsDir);
      fsFault.onRename = (_from, to) => {
        if (to.endsWith("services/payment-service/openapi.yaml")) {
          throw new Error("injected removal swap failure");
        }
      };
      const res = await runLoam(p.workDir, "archive", "FEAT-40", "--json");
      fsFault.onRename = undefined;
      expect(res.code).toBe(1);
      expect(JSON.parse(res.stdout).error.code).toBe("merge-failed");
      expect(await treeHashes(p.docsDir)).toEqual(before);
    } finally {
      fsFault.onRename = undefined;
      await p.destroy();
    }
  });
});
