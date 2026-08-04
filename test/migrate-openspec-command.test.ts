import { afterEach, describe, expect, it } from "vitest";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { inventoryOpenSpec } from "../src/core/openspec-inventory.js";
import { makeTmpDir, runLoam, treeHashes, writeFiles } from "./helpers/harness.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!();
});

const LIVING = `# Payments

## Purpose
Take money.

## Requirements

### Requirement: Authorize
The system SHALL authorize.

#### Scenario: Accepted
- **WHEN** a valid card is used
- **THEN** it is accepted
`;

const DELTA = `## ADDED Requirements

### Requirement: Refund
The system SHALL refund.

#### Scenario: Refunded
- **WHEN** a refund is requested
- **THEN** it is refunded
`;

const RENAMED = `## RENAMED Requirements

- FROM: \`### Requirement: Old name\`
- TO: \`### Requirement: New name\`
`;

async function workspace(files: Record<string, string>): Promise<{ root: string; openspec: string }> {
  const root = await makeTmpDir("loam-openspec-inventory-");
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const openspec = join(root, "openspec");
  await writeFiles(openspec, files);
  return { root, openspec };
}

describe("OpenSpec dry-run inventory", () => {
  it("counts living, active and archived specs and separates compatibility from mapping readiness", async () => {
    const fixture = await workspace({
      "project.md": "# Project\n",
      "specs/payments/spec.md": LIVING,
      "changes/add-refund/specs/payments/spec.md": DELTA,
      "changes/archive/2025-01-01-bootstrap/specs/payments/spec.md": DELTA,
    });

    const inventory = await inventoryOpenSpec(fixture.root);

    expect(inventory.root).toBe(fixture.openspec);
    expect(inventory.mechanicallyCompatible).toBe(true);
    expect(inventory.ready).toBe(false);
    expect(inventory.living).toMatchObject({
      specFiles: 1,
      requirements: 1,
      scenarios: 1,
    });
    expect(inventory.living.capabilities.map((capability) => capability.id)).toEqual(["payments"]);
    expect(inventory.changes.counts).toEqual({ active: 1, archived: 1 });
    expect(inventory.needsMapping).toEqual([{
      capability: "payments",
      service: null,
      suggestedService: "payments",
      status: "needsMapping",
    }]);
  });

  it("reports RENAMED and unsupported shapes with stable typed codes", async () => {
    const fixture = await workspace({
      "specs/payments/spec.md": LIVING,
      "changes/rename/specs/payments/spec.md": RENAMED,
    });

    const inventory = await inventoryOpenSpec(fixture.openspec);

    expect(inventory.mechanicallyCompatible).toBe(false);
    expect(inventory.ready).toBe(false);
    expect(inventory.renamed).toEqual([{
      path: "changes/rename/specs/payments/spec.md",
      line: 1,
    }]);
    expect(inventory.unsupported).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "openspec.renamed-unsupported" }),
      expect.objectContaining({ code: "openspec.change-empty" }),
    ]));
  });

  it("CLI emits the JSON v1.0 report and leaves the OpenSpec workspace byte-identical", async () => {
    const fixture = await workspace({
      "specs/payments/spec.md": LIVING,
      "changes/add-refund/specs/payments/spec.md": DELTA,
    });
    const before = await treeHashes(fixture.root);

    const result = await runLoam(fixture.root, "migrate-openspec", fixture.root, "--json");
    const inventory = JSON.parse(result.stdout);

    expect(result.code).toBe(1); // mechanically valid, but capability ownership is still undecided
    expect(inventory).toMatchObject({
      contractVersion: "1.0",
      ok: true,
      command: "migrate-openspec",
      dryRun: true,
      mechanicallyCompatible: true,
      ready: false,
    });
    expect(await treeHashes(fixture.root)).toEqual(before);
  });

  it("fails cleanly when the requested checkout does not exist", async () => {
    const root = await makeTmpDir("loam-openspec-missing-");
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    const result = await runLoam(root, "migrate-openspec", join(root, "missing"), "--json");
    expect(result.code).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      contractVersion: "1.0",
      ok: false,
      error: { code: "unknown-target" },
    });
  });

  it("can report an empty but structurally present inventory as ready", async () => {
    const root = await makeTmpDir("loam-openspec-empty-");
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    await mkdir(join(root, "specs"));
    const inventory = await inventoryOpenSpec(root);
    expect(inventory).toMatchObject({ ready: true, mechanicallyCompatible: true });
    expect(inventory.needsMapping).toEqual([]);
  });
});
