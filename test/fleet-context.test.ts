import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FleetContext } from "../src/core/fleet-context.js";
import { operationIds, operations, readOpenapi } from "../src/core/openapi/doc.js";
import { featureSpecServices, listFeatures, listServices } from "../src/core/repo/repo.js";
import { makeTmpDir, writeFiles } from "./helpers/harness.js";

async function withRepo(fn: (root: string) => Promise<void>): Promise<void> {
  const root = await makeTmpDir("loam-fleet-context-");
  try {
    await writeFiles(root, {
      "services/payments/spec.md":
        "# payments\n\n## Requirements\n\n### Requirement: Authorize\nOperations: authorizePayment\n\n#### Scenario: accepted\n- **WHEN** valid\n- **THEN** accepted\n",
      "services/payments/openapi.yaml":
        "openapi: 3.1.0\ninfo: { title: payments, version: 1.0.0 }\npaths:\n  /payments:\n    post:\n      operationId: authorizePayment\n      responses: {}\n",
      "services/payments/model.likec4": "model {}\n",
      "features/FEAT-1-checkout/specs/payments/spec.md": "# delta\n",
    });
    await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe("FleetContext", () => {
  it("deduplicates enumeration, text/spec parsing, OpenAPI parsing and LikeC4 loading", async () => {
    await withRepo(async (docsDir) => {
      const fleet = new FleetContext();
      const spec = join(docsDir, "services/payments/spec.md");
      const openapi = join(docsDir, "services/payments/openapi.yaml");
      const model = join(docsDir, "services/payments/model.likec4");
      const feature = join(docsDir, "features/FEAT-1-checkout");

      const [servicesA, servicesB] = await Promise.all([
        listServices(docsDir, fleet),
        listServices(docsDir, fleet),
      ]);
      expect(servicesA).toBe(servicesB);

      const features = await listFeatures(docsDir, {}, fleet);
      expect(await featureSpecServices(feature, fleet)).toEqual(["payments"]);
      expect(features[0]?.services).toEqual(["payments"]);

      const [reqsA, reqsB] = await Promise.all([
        fleet.readRequirements(spec),
        fleet.readRequirements(spec),
      ]);
      expect(reqsA).toBe(reqsB);

      const [doc, ids, ops] = await Promise.all([
        readOpenapi(openapi, fleet),
        operationIds(openapi, fleet),
        operations(openapi, fleet),
      ]);
      expect(doc.ops.map((op) => op.id)).toEqual(ids);
      expect(ops).toEqual(doc.ops);

      const [modelA, modelB] = await Promise.all([
        fleet.loadLikeC4(model),
        fleet.loadLikeC4(model),
      ]);
      expect(modelA).toBe(modelB);

      expect(fleet.stats()).toEqual({
        serviceEnumerations: 1,
        featureEnumerations: 1,
        // Seeded by listFeatures: specs/ is not enumerated a second time.
        featureServiceEnumerations: 0,
        textReads: 1,
        requirementParses: 1,
        openapiParses: 1,
        // Nothing in this fixture reads the async axis, and the counter proves
        // it: the event checks must not make every command pay a fleet walk.
        asyncapiParses: 0,
        likec4Loads: 1,
      });
    });
  });

  it("never leaks a stale cache into a later command context", async () => {
    await withRepo(async (docsDir) => {
      const path = join(docsDir, "services/payments/spec.md");
      const firstCommand = new FleetContext();
      const before = await firstCommand.readText(path);

      await writeFile(path, "# changed by the next command\n", "utf8");

      // A request is a coherent snapshot, even if the filesystem changes under it.
      expect(await firstCommand.readText(path)).toBe(before);
      // A later CLI invocation creates a new context and sees the new source of truth.
      const nextCommand = new FleetContext();
      expect(await nextCommand.readText(path)).toBe("# changed by the next command\n");
    });
  });
});

/** Two self-contained documents, enough for a batch that has something to share. */
const MODEL_A = "specification {\n  element softwareSystem\n}\nmodel {\n  a = softwareSystem 'svc-a'\n}\n";
const MODEL_B = "specification {\n  element softwareSystem\n}\nmodel {\n  b = softwareSystem 'svc-b'\n}\n";

describe("FleetContext.prefetchLikeC4", () => {
  async function withModels(fn: (a: string, b: string) => Promise<void>): Promise<void> {
    const root = await makeTmpDir("loam-fleet-prefetch-");
    try {
      await writeFiles(root, { "a.likec4": MODEL_A, "b.likec4": MODEL_B });
      await fn(join(root, "a.likec4"), join(root, "b.likec4"));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }

  it("seeds the memo, counting each batch-parsed document once and memo hits never", async () => {
    await withModels(async (a, b) => {
      const fleet = new FleetContext();
      await fleet.prefetchLikeC4([a, b]);
      // Two documents parsed via LikeC4 — the counter's meaning is unchanged.
      expect(fleet.stats().likec4Loads).toBe(2);

      const first = await fleet.loadLikeC4(a);
      const second = await fleet.loadLikeC4(a);
      expect(first).toBe(second);
      expect(first.errors).toEqual([]);
      expect(first.elements.map((e) => e.title)).toEqual(["svc-a"]);
      expect((await fleet.loadLikeC4(b)).elements.map((e) => e.title)).toEqual(["svc-b"]);
      // Every load above was a memo hit; a prefetch that made loads RE-parse
      // would show up right here as a higher count.
      expect(fleet.stats().likec4Loads).toBe(2);

      // Prefetching again is free: everything is already memoized.
      await fleet.prefetchLikeC4([a, b]);
      expect(fleet.stats().likec4Loads).toBe(2);
    });
  });

  it("a 0- or 1-path prefetch is a no-op — one document gains nothing from a workspace", async () => {
    await withModels(async (a) => {
      const fleet = new FleetContext();
      const before = fleet.stats();
      await fleet.prefetchLikeC4([]);
      await fleet.prefetchLikeC4([a]);
      expect(fleet.stats()).toEqual(before);
      // The document still loads — through the ordinary per-path road.
      expect((await fleet.loadLikeC4(a)).elements).toHaveLength(1);
      expect(fleet.stats().likec4Loads).toBe(1);
    });
  });

  it("drops a nonexistent path, whose later load rejects exactly as today", async () => {
    await withModels(async (a, b) => {
      const missing = join(a, "..", "never-written.likec4");
      const fleet = new FleetContext();
      await fleet.prefetchLikeC4([a, b, missing]);
      // Only the stageable documents were parsed and seeded.
      expect(fleet.stats().likec4Loads).toBe(2);
      // The missing document is NOT a cached failure: the per-path load runs
      // and rejects with the same ENOENT a batchless run reports.
      await expect(fleet.loadLikeC4(missing)).rejects.toThrow(/ENOENT/);
    });
  });

  it("a later context created after an on-disk edit observes the new bytes", async () => {
    await withModels(async (a, b) => {
      const firstCommand = new FleetContext();
      await firstCommand.prefetchLikeC4([a, b]);
      expect((await firstCommand.loadLikeC4(a)).elements.map((e) => e.title)).toEqual(["svc-a"]);

      await writeFile(a, MODEL_A.replace("'svc-a'", "'svc-a-edited'"), "utf8");

      // The first invocation keeps its snapshot; the next one re-parses disk.
      expect((await firstCommand.loadLikeC4(a)).elements.map((e) => e.title)).toEqual(["svc-a"]);
      const nextCommand = new FleetContext();
      await nextCommand.prefetchLikeC4([a, b]);
      expect((await nextCommand.loadLikeC4(a)).elements.map((e) => e.title)).toEqual(["svc-a-edited"]);
    });
  });
});
