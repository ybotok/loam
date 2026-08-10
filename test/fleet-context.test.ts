import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FleetContext } from "../src/core/fleet-context.js";
import { operationIds, operations, readOpenapi } from "../src/core/openapi.js";
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
