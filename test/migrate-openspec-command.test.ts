import { afterEach, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { inventoryOpenSpec } from "../src/core/openspec/inventory.js";
import { createOpenSpecMappingSkeleton, type OpenSpecMappingSkeleton } from "../src/core/openspec/model/mapping.js";
import { OPENSPEC_BASELINES, type OpenSpecInventory } from "../src/core/openspec/model/model.js";
import { makeTmpDir, runLoam, treeHashes, writeFiles } from "./helpers/harness.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!();
});

/** The stable codes of a findings list, in order. */
const codesOf = (findings: Array<{ code: string }>): string[] => findings.map((f) => f.code);

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

const LIVING_TWO = `${LIVING.trimEnd()}

### Requirement: Capture
The system SHALL capture an authorization.

#### Scenario: Captured
- **WHEN** capture is requested
- **THEN** funds are captured
`;

const RENAMED = `## RENAMED Requirements

- FROM: \`### Requirement: Old name\`
- TO: \`### Requirement: New name\`
`;

const RENAMED_AND_MODIFIED = `${RENAMED.trimEnd()}

## MODIFIED Requirements

### Requirement: Old name
The system SHALL use the revised behavior.

#### Scenario: Revised behavior
- **WHEN** the renamed behavior is requested
- **THEN** the revised result is returned
`;

const LIVING_RENAME = `# Payments

## Requirements

### Requirement: Old name
The system SHALL preserve the existing behavior.

#### Scenario: Existing behavior
- **WHEN** the old behavior is requested
- **THEN** it remains available
`;

const LIVING_RENAME_WITH_ID = LIVING_RENAME.replace(
  "The system SHALL preserve",
  "Requirement-ID: payments.old\n\nThe system SHALL preserve",
);

async function workspace(files: Record<string, string>): Promise<{ root: string; openspec: string }> {
  const root = await realpath(await makeTmpDir("loam-openspec-inventory-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const openspec = join(root, "openspec");
  await writeFiles(openspec, files);
  return { root, openspec };
}

function completeSkeleton(inventory: OpenSpecInventory): OpenSpecMappingSkeleton {
  const skeleton = createOpenSpecMappingSkeleton(inventory);
  for (const decision of inventory.mappingDecisions) {
    skeleton.capabilities[decision.capability]!.services = [decision.suggestedService];
  }
  for (const change of Object.values(skeleton.changes)) {
    (change as { feature: string | null }).feature = change.suggestedFeature;
  }
  let renameNumber = 1;
  for (const rename of Object.values(skeleton.renames)) {
    if (rename.requirementId === null) {
      (rename as { requirementId: string | null }).requirementId = `migrated.rename-${renameNumber}`;
    }
    renameNumber += 1;
  }
  for (const artifact of Object.values(skeleton.artifacts)) {
    (artifact as { disposition: string | null }).disposition = artifact.suggestedDisposition;
  }
  return skeleton;
}

async function mappingFile(inventory: OpenSpecInventory): Promise<{ path: string; document: OpenSpecMappingSkeleton }> {
  const dir = await makeTmpDir("loam-openspec-map-");
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, "mapping.yaml");
  const document = completeSkeleton(inventory);
  // JSON is valid YAML and keeps the test focused on the command contract.
  await writeFile(path, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  return { path, document };
}

describe("OpenSpec audit inventory", () => {
  it("pins the released v1.7.0 tag separately from the post-release main canary", () => {
    expect(OPENSPEC_BASELINES).toEqual({
      release: {
        version: "1.7.0",
        ref: "v1.7.0",
        commit: "4e16790d90d8f54d4773ad9a5e71a57cd9f1e86b",
      },
      mainCanary: { ref: "main", commit: "45cca5db6137ed209117cc70510eb3e057fb981b" },
    });
  });

  it("recognizes config.yaml, preserves nested capability ids, and keeps archive diagnostics non-blocking", async () => {
    const fixture = await workspace({
      "config.yaml": "schema: spec-driven\ncontext: product context\nrules:\n  specs:\n    - Be observable\n",
      "specs/payments/refunds/spec.md": LIVING,
      "changes/add-refund/.openspec.yaml": "schema: spec-driven\n",
      "changes/add-refund/proposal.md": "# Proposal\n",
      "changes/add-refund/design.md": "# Design\n",
      "changes/add-refund/tasks.md": "# Tasks\n",
      "changes/add-refund/specs/payments/refunds/spec.md": DELTA,
      "changes/archive/2025-01-01-legacy/proposal.md": "# Legacy\n",
    });

    const inventory = await inventoryOpenSpec(fixture.root);

    expect(inventory.root).toBe(fixture.openspec);
    expect(inventory.workspace.config).toEqual({
      path: "config.yaml",
      schema: "spec-driven",
      store: null,
      hasContext: true,
      ruleArtifacts: ["specs"],
      references: [],
    });
    expect(inventory.living.capabilities.map((capability) => capability.id)).toEqual(["payments/refunds"]);
    expect(inventory.mechanicallyCompatible).toBe(true);
    expect(inventory.readiness).toMatchObject({
      living: { compatible: true, issueCount: 0 },
      active: { compatible: true, issueCount: 0 },
      mappingsResolved: false,
      dispositionsResolved: false,
    });
    expect(inventory.unsupported).toEqual([]);
    expect(inventory.archiveDiagnostics).toEqual([
      expect.objectContaining({ code: "openspec.change-no-specs", scope: "archive" }),
    ]);
    expect(inventory.needsDisposition.map((item) => item.kind).sort()).toEqual([
      "change-design",
      "proposal",
      "tasks",
    ]);
    expect(inventory.artifacts).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "config", disposition: "translate-project-context" }),
      expect.objectContaining({ kind: "living-spec", capability: "payments/refunds" }),
      expect.objectContaining({ kind: "proposal", disposition: "convert-to-intent" }),
    ]));
  });

  it("maps the union of living and active-only nested capabilities, including active requirements", async () => {
    const fixture = await workspace({
      "config.yaml": "schema: spec-driven\n",
      "specs/payments/spec.md": LIVING,
      "changes/add-reports/specs/platform/reports/spec.md": DELTA.replace("Refund", "Export"),
    });

    const inventory = await inventoryOpenSpec(fixture.root);
    expect(inventory.mappingDecisions).toEqual([
      expect.objectContaining({ capability: "payments", hasLivingSpec: true, activeChanges: [] }),
      expect.objectContaining({
        capability: "platform/reports",
        hasLivingSpec: false,
        activeChanges: ["add-reports"],
        suggestedService: "reports",
        requirementServices: { Export: [] },
      }),
    ]);
    expect(createOpenSpecMappingSkeleton(inventory).changes).toEqual({
      "add-reports": {
        feature: null,
        suggestedFeature: "FEAT-1",
        title: "Add reports",
      },
    });
  });

  it("accepts explicit skip_specs for built-in and resolved custom schemas", async () => {
    const fixture = await workspace({
      "config.yaml": "schema: spec-driven\n",
      "specs/payments/spec.md": LIVING,
      "changes/docs-only/.openspec.yaml": "schema: spec-driven\nskip_specs: true\n",
      "changes/docs-only/proposal.md": "# Docs only\n",
      "changes/custom/.openspec.yaml": "schema: custom-flow\nskip_specs: true\n",
      "changes/custom/proposal.md": "# Custom\n",
      "schemas/custom-flow/schema.yaml": "name: custom-flow\nversion: 1\nartifacts:\n  - id: proposal\n    generates: proposal.md\n    description: Proposal\n    template: proposal.md\n",
    });

    const inventory = await inventoryOpenSpec(fixture.root);
    expect(inventory.mechanicallyCompatible).toBe(true);
    expect(inventory.unsupported).toEqual([]);
    expect(inventory.changes.active.map((change) => [change.id, change.metadata.skipSpecs])).toEqual([
      ["custom", true],
      ["docs-only", true],
    ]);
  });

  it("does not infer skip_specs from a custom schema with no specs artifact", async () => {
    const fixture = await workspace({
      "config.yaml": "schema: spec-driven\n",
      "specs/payments/spec.md": LIVING,
      "changes/custom/.openspec.yaml": "schema: custom-flow\n",
      "changes/custom/proposal.md": "# Custom\n",
      "schemas/custom-flow/schema.yaml": "name: custom-flow\nversion: 1\nartifacts:\n  - id: proposal\n    generates: proposal.md\n    description: Proposal\n    template: proposal.md\n",
    });

    const inventory = await inventoryOpenSpec(fixture.root);
    expect(inventory.mechanicallyCompatible).toBe(false);
    expect(inventory.unsupported).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "openspec.change-no-specs",
        path: "changes/custom",
        scope: "active",
      }),
    ]));
  });

  it("rejects traversal, absolute, Windows-separated, and unregistered schema ids", async () => {
    const fixture = await workspace({
      "config.yaml": "schema: spec-driven\n",
      "specs/payments/spec.md": LIVING,
      "changes/traversal/.openspec.yaml": "schema: ../../outside\nskip_specs: true\n",
      "changes/absolute/.openspec.yaml": "schema: /tmp/outside\nskip_specs: true\n",
      "changes/windows/.openspec.yaml": "schema: ..\\\\outside\nskip_specs: true\n",
      "changes/unregistered/.openspec.yaml": "schema: absent-flow\nskip_specs: true\n",
    });
    await writeFiles(fixture.root, {
      "outside/schema.yaml": "name: outside\nartifacts:\n  - id: proposal\n    generates: proposal.md\n",
    });

    const inventory = await inventoryOpenSpec(fixture.root);
    expect(inventory.unsupported.filter((item) => item.code === "openspec.change-schema-unresolved"))
      .toHaveLength(4);
    expect(inventory.ready).toBe(false);
  });

  it.skipIf(process.platform === "win32")(
    "does not resolve symlinked schema directories or schema files",
    async () => {
      const fixture = await workspace({
        "config.yaml": "schema: spec-driven\n",
        "specs/payments/spec.md": LIVING,
        "changes/dir-link/.openspec.yaml": "schema: dir-link\nskip_specs: true\n",
        "changes/file-link/.openspec.yaml": "schema: file-link\nskip_specs: true\n",
      });
      const external = await realpath(await makeTmpDir("loam-openspec-schema-external-"));
      cleanups.push(() => rm(external, { recursive: true, force: true }));
      await writeFiles(external, {
        "dir/schema.yaml": "name: dir-link\nartifacts: []\n",
        "file.yaml": "name: file-link\nartifacts: []\n",
      });
      await mkdir(join(fixture.openspec, "schemas", "file-link"), { recursive: true });
      await symlink(join(external, "dir"), join(fixture.openspec, "schemas", "dir-link"));
      await symlink(join(external, "file.yaml"), join(fixture.openspec, "schemas", "file-link", "schema.yaml"));

      const inventory = await inventoryOpenSpec(fixture.root);
      expect(inventory.unsupported.filter((item) => item.code === "openspec.change-schema-unresolved"))
        .toHaveLength(2);
      expect(inventory.unsupported.filter((item) => item.code === "openspec.symlink-unsupported"))
        .toHaveLength(2);
      expect(inventory.ready).toBe(false);
    },
  );

  it("blocks skip_specs with authored specs and unresolved change schemas", async () => {
    const fixture = await workspace({
      "config.yaml": "schema: spec-driven\n",
      "specs/payments/spec.md": LIVING,
      "changes/conflict/.openspec.yaml": "schema: spec-driven\nskip_specs: true\n",
      "changes/conflict/specs/payments/spec.md": DELTA,
      "changes/unknown/.openspec.yaml": "schema: missing-flow\nskip_specs: true\n",
      "changes/missing-schema/.openspec.yaml": "skip_specs: true\n",
      "changes/wrong-type/.openspec.yaml": "schema: spec-driven\nskip_specs: yes\n",
    });

    const inventory = await inventoryOpenSpec(fixture.root);
    expect(inventory.mechanicallyCompatible).toBe(false);
    expect(inventory.unsupported).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "openspec.skip-specs-with-specs", scope: "active" }),
      expect.objectContaining({ code: "openspec.change-schema-unresolved", scope: "active" }),
      expect.objectContaining({
        code: "openspec.change-metadata-invalid",
        path: "changes/missing-schema/.openspec.yaml",
      }),
      expect.objectContaining({
        code: "openspec.change-metadata-invalid",
        path: "changes/wrong-type/.openspec.yaml",
      }),
    ]));
  });

  it.skipIf(process.platform === "win32")(
    "diagnoses source symlinks and non-UTF-8 artifacts instead of omitting or decoding them",
    async () => {
    const fixture = await workspace({
      "config.yaml": "schema: spec-driven\n",
      "specs/payments/spec.md": LIVING,
      "changes/docs-only/.openspec.yaml": "schema: spec-driven\nskip_specs: true\n",
    });
    const external = join(await makeTmpDir("loam-openspec-external-"), "external.md");
    cleanups.push(() => rm(join(external, ".."), { recursive: true, force: true }));
    await writeFile(external, "outside\n", "utf8");
    await symlink(external, join(fixture.openspec, "changes", "docs-only", "linked.md"));
    await writeFile(join(fixture.openspec, "changes", "docs-only", "blob.bin"), Buffer.from([0xff, 0xfe]));

    const inventory = await inventoryOpenSpec(fixture.root);
    expect(inventory.unsupported).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "openspec.symlink-unsupported" }),
      expect.objectContaining({ code: "openspec.non-utf8-artifact", scope: "active" }),
    ]));
    expect(inventory.ready).toBe(false);
    },
  );

  it("rejects an ambiguous input that is both an OpenSpec root and a parent of openspec/", async () => {
    const root = await realpath(await makeTmpDir("loam-openspec-ambiguous-"));
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    await writeFiles(root, {
      "config.yaml": "schema: spec-driven\n",
      "specs/direct/spec.md": LIVING,
      "openspec/config.yaml": "schema: spec-driven\n",
      "openspec/specs/nested/spec.md": LIVING,
    });

    await expect(inventoryOpenSpec(root)).rejects.toThrow(/Ambiguous OpenSpec root/);
  });

  it("supports one capability split across services only with complete per-requirement allocation", async () => {
    const fixture = await workspace({
      "config.yaml": "schema: spec-driven\n",
      "specs/payments/spec.md": LIVING_TWO,
    });
    const audited = await inventoryOpenSpec(fixture.root);
    const source = { root: audited.root, inventoryDigest: audited.inventoryDigest };
    const incomplete = await inventoryOpenSpec(fixture.root, { mapping: {
      source,
      capabilities: {
        payments: {
          services: ["authorization-service", "capture-service"],
          requirementServices: { Authorize: ["authorization-service"] },
        },
      },
      changes: {},
      renames: {},
      artifacts: {},
    } });
    expect(incomplete.ready).toBe(false);
    expect(incomplete.mappingIssues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "mapping.requirement-allocation-missing", key: "payments:Capture" }),
      expect.objectContaining({ code: "mapping.service-allocation-empty", key: "payments:capture-service" }),
    ]));

    const complete = await inventoryOpenSpec(fixture.root, { mapping: {
      source,
      capabilities: {
        payments: {
          services: ["authorization-service", "capture-service"],
          requirementServices: {
            Authorize: ["authorization-service"],
            Capture: ["capture-service"],
          },
        },
      },
      changes: {},
      renames: {},
      artifacts: {},
    } });
    expect(complete).toMatchObject({ ready: true, readiness: { mappingsResolved: true } });
  });

  it("detects stranded BASE requirements even when a valid ADDED section is also present", async () => {
    const mixed = `## Behavior

### Requirement: Stranded
The system SHALL not lose this.

#### Scenario: Visible
- **WHEN** audited
- **THEN** it is reported

${DELTA}`;
    const fixture = await workspace({
      "config.yaml": "schema: spec-driven\n",
      "specs/payments/spec.md": LIVING,
      "changes/mixed/specs/payments/spec.md": mixed,
    });

    const inventory = await inventoryOpenSpec(fixture.root);
    expect(inventory.mechanicallyCompatible).toBe(false);
    expect(inventory.unsupported).toEqual([
      expect.objectContaining({
        code: "openspec.change-requirements-outside-delta-sections",
        scope: "active",
      }),
    ]);
  });

  it("parses RENAMED FROM/TO without misreporting a rename-only delta as empty", async () => {
    const fixture = await workspace({
      "config.yaml": "schema: spec-driven\n",
      "specs/payments/spec.md": LIVING_RENAME,
      "changes/rename/specs/payments/spec.md": RENAMED,
    });

    const inventory = await inventoryOpenSpec(fixture.openspec);
    expect(inventory.mechanicallyCompatible).toBe(true);
    expect(inventory.renamed).toEqual([{
      key: "changes/rename/specs/payments/spec.md:1:1",
      path: "changes/rename/specs/payments/spec.md",
      line: 1,
      scope: "active",
      changeId: "rename",
      capability: "payments",
      from: "Old name",
      to: "New name",
      existingRequirementId: null,
      requirementId: null,
      status: "needsIdentity",
    }]);
    expect(inventory.unsupported).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "openspec.change-empty" }),
    ]));
  });

  it("recognizes config-only projects and empty Store roots without inventing a missing-spec blocker", async () => {
    const project = await workspace({ "config.yaml": "schema: spec-driven\n" });
    const projectInventory = await inventoryOpenSpec(project.root);
    // No missing-spec blocker is invented — that is what this test is about.
    // But a workspace where loam read no living spec and no active change is
    // not `ready` either: reporting ready over content nobody read is how a
    // whole corpus goes missing behind a green verdict.
    expect(codesOf(projectInventory.unsupported)).not.toContain("openspec.specs-missing");
    expect(codesOf(projectInventory.unsupported)).toEqual(["openspec.workspace-empty"]);
    expect(projectInventory).toMatchObject({ ready: false, mechanicallyCompatible: false });

    const store = await makeTmpDir("loam-openspec-store-");
    cleanups.push(() => rm(store, { recursive: true, force: true }));
    await writeFiles(store, { ".openspec-store/store.yaml": "id: team-plans\n" });
    // The marker picks the KIND; the shape picks the root. A checkout claiming
    // to be a store has to actually hold the planning directory.
    await mkdir(join(store, "openspec"), { recursive: true });
    const storeInventory = await inventoryOpenSpec(store);
    expect(storeInventory.workspace).toMatchObject({
      kind: "store",
      storeMetadataPath: "@workspace/.openspec-store/store.yaml",
    });
    expect(codesOf(storeInventory.unsupported)).not.toContain("openspec.specs-missing");
    expect(codesOf(storeInventory.unsupported)).toEqual(["openspec.workspace-empty"]);
    expect(storeInventory).toMatchObject({ ready: false, mechanicallyCompatible: false });
  });

  it("refuses a store checkout with no planning content at all, rather than auditing nothing", async () => {
    const bare = await makeTmpDir("loam-openspec-bare-store-");
    cleanups.push(() => rm(bare, { recursive: true, force: true }));
    await writeFiles(bare, { ".openspec-store/store.yaml": "id: team-plans\n" });
    await expect(inventoryOpenSpec(bare)).rejects.toThrow(/has no OpenSpec planning content/);
  });
});

describe("OpenSpec audit and mapping-driven migration commands", () => {
  it("audit succeeds with blockers, emits a digest-bound skeleton, and leaves source byte-identical", async () => {
    const fixture = await workspace({
      "config.yaml": "schema: spec-driven\n",
      "specs/payments/spec.md": LIVING,
      "changes/mixed/specs/payments/spec.md": `## Behavior\n\n### Requirement: Legacy\nText.\n`,
    });
    const before = await treeHashes(fixture.root);

    const result = await runLoam(fixture.root, "audit-openspec", fixture.root, "--json");
    const report = JSON.parse(result.stdout);

    expect(result.code).toBe(0);
    expect(report).toMatchObject({
      contractVersion: "1.0",
      ok: true,
      command: "audit-openspec",
      readOnly: true,
      mechanicallyCompatible: false,
      ready: false,
      mappingSkeleton: {
        version: 1,
        source: { root: fixture.openspec },
      },
    });
    expect(report.mappingSkeleton.source.inventoryDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(await treeHashes(fixture.root)).toEqual(before);
  });

  it("uses one planning-root digest and artifact namespace for repository and openspec/ aliases", async () => {
    const fixture = await workspace({
      "config.yaml": "schema: spec-driven\n",
      "specs/payments/spec.md": LIVING,
      "changes/add-refund/proposal.md": "# Proposal\n",
      "changes/add-refund/specs/payments/spec.md": DELTA,
    });
    const fromRepository = await inventoryOpenSpec(fixture.root);
    const fromPlanningRoot = await inventoryOpenSpec(fixture.openspec);
    expect(fromPlanningRoot.root).toBe(fromRepository.root);
    expect(fromPlanningRoot.inventoryDigest).toBe(fromRepository.inventoryDigest);
    expect(fromPlanningRoot.artifacts.map((artifact) => artifact.path))
      .toEqual(fromRepository.artifacts.map((artifact) => artifact.path));
    expect(fromRepository.artifacts.map((artifact) => artifact.path)).toContain("changes/add-refund/proposal.md");

    const mapping = await mappingFile(fromRepository);
    const result = await runLoam(
      fixture.root,
      "migrate-openspec",
      fixture.openspec,
      "--map",
      mapping.path,
      "--json",
    );
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ ready: true, dryRun: true });
  });

  it.skipIf(process.platform === "win32")(
    "rejects a repository whose nested openspec/ planning root is a symlink",
    async () => {
      const repository = await realpath(await makeTmpDir("loam-openspec-linked-root-"));
      const external = await realpath(await makeTmpDir("loam-openspec-linked-external-"));
      cleanups.push(() => rm(repository, { recursive: true, force: true }));
      cleanups.push(() => rm(external, { recursive: true, force: true }));
      await writeFiles(external, { "config.yaml": "schema: spec-driven\n", "specs/payments/spec.md": LIVING });
      await symlink(external, join(repository, "openspec"), "dir");
      const output = join(repository, "mapping.yaml");

      const result = await runLoam(
        repository,
        "audit-openspec",
        repository,
        "--write-mapping",
        output,
        "--json",
      );
      expect(result.code).toBe(1);
      expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, error: { code: "unknown-target" } });
      expect(existsSync(output)).toBe(false);
    },
  );

  it("writes a non-overwriting mapping skeleton only when explicitly requested outside source", async () => {
    const fixture = await workspace({
      "config.yaml": "schema: spec-driven\n",
      "specs/payments/spec.md": LIVING,
    });
    const outputDir = await makeTmpDir("loam-openspec-skeleton-");
    cleanups.push(() => rm(outputDir, { recursive: true, force: true }));
    const output = join(outputDir, "mapping.yaml");

    const result = await runLoam(fixture.root, "audit-openspec", fixture.root, "--write-mapping", output, "--json");
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, readOnly: false, mappingWritten: output });
    expect(parseYaml(await readFile(output, "utf8"))).toMatchObject({
      version: 1,
      source: { root: fixture.openspec },
      capabilities: { payments: { services: [], suggestedServices: ["payments"] } },
      changes: {},
    });

    const second = await runLoam(fixture.root, "audit-openspec", fixture.root, "--write-mapping", output, "--json");
    expect(second.code).toBe(1);
    expect(JSON.parse(second.stdout)).toMatchObject({ ok: false, error: { code: "already-exists" } });
  });

  it("handles prototype-shaped ids safely and quotes YAML-coercible service ids", async () => {
    const fixture = await workspace({
      "config.yaml": "schema: spec-driven\n",
      "specs/__proto__/spec.md": LIVING,
      "changes/constructor/specs/toString/spec.md": DELTA,
    });
    const inventory = await inventoryOpenSpec(fixture.root);
    const mapping = await mappingFile(inventory);
    mapping.document.capabilities.__proto__!.services = ["null"];
    await writeFile(mapping.path, `${JSON.stringify(mapping.document, null, 2)}\n`, "utf8");
    const target = join(await makeTmpDir("loam-openspec-special-ids-"), "target");
    cleanups.push(() => rm(join(target, ".."), { recursive: true, force: true }));

    const result = await runLoam(
      fixture.root,
      "migrate-openspec",
      fixture.root,
      "--map",
      mapping.path,
      "--apply",
      "--target",
      target,
      "--json",
    );

    expect(result.code).toBe(0);
    const living = await readFile(join(target, "services", "null", "spec.md"), "utf8");
    expect(parseYaml(living.split("---")[1]!)).toMatchObject({ service: "null", status: "draft" });
    expect(existsSync(join(target, "features", "FEAT-1-constructor", "specs", "toString", "spec.md"))).toBe(true);
  });

  it("runs collision planning during dry-run and rejects portable case-fold path aliases", async () => {
    const contentCollision = await workspace({
      "config.yaml": "schema: spec-driven\n",
      "specs/first/spec.md": LIVING,
      "specs/second/spec.md": LIVING,
    });
    const contentMap = await mappingFile(await inventoryOpenSpec(contentCollision.root));
    contentMap.document.capabilities.first!.services = ["shared"];
    contentMap.document.capabilities.second!.services = ["shared"];
    await writeFile(contentMap.path, JSON.stringify(contentMap.document), "utf8");
    const contentResult = await runLoam(
      contentCollision.root,
      "migrate-openspec",
      contentCollision.root,
      "--map",
      contentMap.path,
      "--json",
    );
    expect(contentResult.code).toBe(1);
    expect(JSON.parse(contentResult.stdout)).toMatchObject({
      ok: false,
      error: { code: "invalid-option" },
    });

    const pathCollision = await workspace({
      "config.yaml": "schema: spec-driven\n",
      "specs/first/spec.md": LIVING,
      "specs/second/spec.md": LIVING_RENAME,
    });
    const pathMap = await mappingFile(await inventoryOpenSpec(pathCollision.root));
    pathMap.document.capabilities.first!.services = ["Foo"];
    pathMap.document.capabilities.second!.services = ["foo"];
    await writeFile(pathMap.path, JSON.stringify(pathMap.document), "utf8");
    const pathResult = await runLoam(
      pathCollision.root,
      "migrate-openspec",
      pathCollision.root,
      "--map",
      pathMap.path,
      "--json",
    );
    expect(pathResult.code).toBe(1);
    expect(JSON.parse(pathResult.stdout).error.message).toMatch(/portable case\/Unicode normalization/);
  });

  it("rejects final-service duplicate headings independently of stable ids and input ordering", async () => {
    const withId = (id: string | null): string => id === null
      ? LIVING
      : LIVING.replace(
        "The system SHALL authorize.",
        `Requirement-ID: ${id}\n\nThe system SHALL authorize.`,
      );
    const cases: Array<[string | null, string | null]> = [
      ["payments.one", "payments.two"],
      ["payments.one", null],
      [null, "payments.two"],
    ];
    for (const [firstId, secondId] of cases) {
      const fixture = await workspace({
        "config.yaml": "schema: spec-driven\n",
        "specs/first/spec.md": withId(firstId),
        "specs/second/spec.md": withId(secondId),
      });
      const mapping = await mappingFile(await inventoryOpenSpec(fixture.root));
      mapping.document.capabilities.first!.services = ["shared"];
      mapping.document.capabilities.second!.services = ["shared"];
      await writeFile(mapping.path, JSON.stringify(mapping.document), "utf8");

      const result = await runLoam(
        fixture.root,
        "migrate-openspec",
        fixture.root,
        "--map",
        mapping.path,
        "--json",
      );
      expect(result.code, `${firstId ?? "no-id"} then ${secondId ?? "no-id"}`).toBe(1);
      expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, error: { code: "invalid-option" } });
    }
  });

  it("grades mapping service ids with the one shared grammar, not a second copy of it", async () => {
    // `serviceList` used to inline its own alphabet regex, `.`/`..` tests,
    // trailing-dot test and Windows device names. Two copies is how the grammar
    // drifted apart: for a while migrate was the STRICTER of the two, so the
    // primary authoring path (`--service`, `--touches`, `adopt`) accepted ids a
    // migration refused. src/core/kernel/ids.ts owns the rule now; migrate keeps its
    // own refusal shape (`invalid-option`, never an Issue).
    const fixture = await workspace({
      "config.yaml": "schema: spec-driven\n",
      "specs/payments/spec.md": LIVING,
    });
    const inventory = await inventoryOpenSpec(fixture.root);
    const migrateAs = async (service: string): Promise<{ code: number; stdout: string }> => {
      const mapping = await mappingFile(inventory);
      mapping.document.capabilities.payments!.services = [service];
      await writeFile(mapping.path, JSON.stringify(mapping.document), "utf8");
      return runLoam(fixture.root, "migrate-openspec", fixture.root, "--map", mapping.path, "--json");
    };

    // Every id the shared rule refuses is still refused here, under the same
    // code, and the message quotes the value so the YAML line is findable.
    // `pay..ments` is the one the inlined copy ACCEPTED — its alphabet regex
    // allowed dots anywhere — and refusing it now is the point of one grammar.
    for (const bad of ["CON", "nul.txt", "LPT1", "payments.", ".", "..", "../escape", "-leading", "pay..ments"]) {
      const result = await migrateAs(bad);
      expect(result.code, bad).toBe(1);
      const report = JSON.parse(result.stdout);
      expect(report, bad).toMatchObject({ ok: false, error: { code: "invalid-option" } });
      expect(report.error.message, bad).toContain(`'${bad}'`);
      // and the mapping key, so the refusal names the line to edit
      expect(report.error.message, bad).toContain("capabilities.payments.services");
    }

    // Nothing migrate used to accept has become refused: the whole alphabet,
    // and the two ids that only LOOK like reserved device names.
    for (const good of ["payment-service", "payments_v2", "payments.v2", "svc2", "CONSOLE", "nullify"]) {
      const result = await migrateAs(good);
      expect(result.code, good).toBe(0);
      expect(JSON.parse(result.stdout), good).toMatchObject({ ok: true, ready: true });
    }
  });

  it("dry-runs by default, then requires --apply --target to materialize staged living docs", async () => {
    const fixture = await workspace({
      "config.yaml": "schema: spec-driven\n",
      "specs/payments/refunds/spec.md": LIVING,
    });
    const inventory = await inventoryOpenSpec(fixture.root);
    const mapping = await mappingFile(inventory);
    const target = join(await makeTmpDir("loam-openspec-target-parent-"), "target");
    cleanups.push(() => rm(join(target, ".."), { recursive: true, force: true }));
    const before = await treeHashes(fixture.root);

    const dryRun = await runLoam(fixture.root, "migrate-openspec", fixture.root, "--map", mapping.path, "--json");
    expect(dryRun.code).toBe(0);
    expect(JSON.parse(dryRun.stdout)).toMatchObject({
      ok: true,
      command: "migrate-openspec",
      dryRun: true,
      ready: true,
      applied: null,
    });
    expect(existsSync(target)).toBe(false);

    const applied = await runLoam(
      fixture.root,
      "migrate-openspec",
      fixture.root,
      "--map",
      mapping.path,
      "--apply",
      "--target",
      target,
      "--json",
    );
    const report = JSON.parse(applied.stdout);
    expect(applied.code).toBe(0);
    expect(report).toMatchObject({ ok: true, dryRun: false, ready: true, applied: { directory: target } });
    expect(await readFile(join(target, "services", "refunds", "spec.md"), "utf8")).toContain("status: draft");
    expect(await readFile(join(target, "services", "refunds", "spec.md"), "utf8")).toContain("### Requirement: Authorize");
    expect(await readFile(join(target, "FOLLOW-UP.md"), "utf8")).toContain("not presented as a fully valid loam fleet");
    expect(await treeHashes(fixture.root)).toEqual(before);
  });

  it.skipIf(process.platform === "win32")(
    "rejects a symlink leaf target without writing through it",
    async () => {
      const fixture = await workspace({
        "config.yaml": "schema: spec-driven\n",
        "specs/payments/spec.md": LIVING,
      });
      const mapping = await mappingFile(await inventoryOpenSpec(fixture.root));
      const parent = await realpath(await makeTmpDir("loam-openspec-target-link-"));
      cleanups.push(() => rm(parent, { recursive: true, force: true }));
      const realTarget = join(parent, "real-target");
      const linkTarget = join(parent, "linked-target");
      await mkdir(realTarget);
      await symlink(realTarget, linkTarget, "dir");

      const result = await runLoam(
        fixture.root,
        "migrate-openspec",
        fixture.root,
        "--map",
        mapping.path,
        "--apply",
        "--target",
        linkTarget,
        "--json",
      );
      expect(result.code).toBe(1);
      expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, error: { code: "invalid-option" } });
      expect(await readdir(realTarget)).toEqual([]);
    },
  );

  it("materializes an active-only nested capability as a mapped feature delta and preserves its source tree", async () => {
    const activeDelta = DELTA.replaceAll("Refund", "Export").replaceAll("refund", "export");
    const fixture = await workspace({
      "config.yaml": "schema: spec-driven\n",
      "specs/payments/spec.md": LIVING,
      "changes/add-reports/specs/platform/reports/spec.md": activeDelta,
    });
    const inventory = await inventoryOpenSpec(fixture.root);
    const mapping = await mappingFile(inventory);
    const target = join(await makeTmpDir("loam-openspec-active-target-"), "target");
    cleanups.push(() => rm(join(target, ".."), { recursive: true, force: true }));
    const before = await treeHashes(fixture.root);

    const result = await runLoam(
      fixture.root,
      "migrate-openspec",
      fixture.root,
      "--map",
      mapping.path,
      "--apply",
      "--target",
      target,
      "--json",
    );

    expect(result.code).toBe(0);
    const featureDir = join(target, "features", "FEAT-1-add-reports");
    const stagedDelta = await readFile(join(featureDir, "specs", "reports", "spec.md"), "utf8");
    expect(stagedDelta).toContain("## ADDED Requirements");
    expect(stagedDelta).toContain("### Requirement: Export");
    expect(await readFile(join(featureDir, "legacy", "openspec", "specs", "platform", "reports", "spec.md"), "utf8"))
      .toBe(activeDelta);
    expect(await readFile(join(featureDir, "intent.md"), "utf8")).toContain("feature: FEAT-1");
    expect(parseYaml(await readFile(join(target, "mapping.yaml"), "utf8"))).toMatchObject({
      changes: { "add-reports": { feature: "FEAT-1", title: "Add reports" } },
    });
    expect(await readFile(join(target, "FOLLOW-UP.md"), "utf8")).toContain("deliberately not presented as a fully valid loam fleet");
    expect(await treeHashes(fixture.root)).toEqual(before);
  });

  it("validates known changes, non-empty titles, feature id grammar, and case-insensitive feature uniqueness", async () => {
    const fixture = await workspace({
      "config.yaml": "schema: spec-driven\n",
      "specs/payments/spec.md": LIVING,
      "changes/a/.openspec.yaml": "schema: spec-driven\nskip_specs: true\n",
      "changes/b/.openspec.yaml": "schema: spec-driven\nskip_specs: true\n",
      "changes/c/.openspec.yaml": "schema: spec-driven\nskip_specs: true\n",
    });
    const inventory = await inventoryOpenSpec(fixture.root);
    const mapping = await mappingFile(inventory);
    (mapping.document.changes.a as { feature: string | null }).feature = "FEAT-7";
    (mapping.document.changes.b as { feature: string | null }).feature = "feat-7";
    (mapping.document.changes.c as { feature: string | null }).feature = "not-a-feature";
    mapping.document.changes.c!.title = "   ";
    (mapping.document.changes as Record<string, unknown>).ghost = {
      feature: "FEAT-99",
      title: "Ghost",
    };
    await writeFile(mapping.path, `${JSON.stringify(mapping.document, null, 2)}\n`, "utf8");

    const result = await runLoam(fixture.root, "migrate-openspec", fixture.root, "--map", mapping.path, "--json");
    const report = JSON.parse(result.stdout);
    expect(result.code).toBe(1);
    expect(report).toMatchObject({ ok: true, ready: false, readiness: { changesResolved: false } });
    expect(report.mappingIssues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "mapping.feature-id-duplicate" }),
      expect.objectContaining({ code: "mapping.feature-id-invalid", key: "c" }),
      expect.objectContaining({ code: "mapping.change-title-missing", key: "c" }),
      expect.objectContaining({ code: "mapping.unknown-change", key: "ghost" }),
    ]));
  });

  it("materializes RENAMED as one stable-id MODIFIED delta and annotates the living source", async () => {
    const fixture = await workspace({
      "config.yaml": "schema: spec-driven\n",
      "specs/payments/spec.md": LIVING_RENAME,
      "changes/rename/specs/payments/spec.md": RENAMED,
    });
    const inventory = await inventoryOpenSpec(fixture.root);
    const renameKey = inventory.renamed[0]!.key;
    expect(createOpenSpecMappingSkeleton(inventory).renames[renameKey]).toMatchObject({
      existingRequirementId: null,
      requirementId: null,
    });
    const mapping = await mappingFile(inventory);
    const target = join(await makeTmpDir("loam-openspec-rename-target-"), "target");
    cleanups.push(() => rm(join(target, ".."), { recursive: true, force: true }));
    const before = await treeHashes(fixture.root);

    const result = await runLoam(
      fixture.root,
      "migrate-openspec",
      fixture.root,
      "--map",
      mapping.path,
      "--apply",
      "--target",
      target,
      "--json",
    );

    expect(result.code).toBe(0);
    const living = await readFile(join(target, "services", "payments", "spec.md"), "utf8");
    expect(living).toContain("### Requirement: Old name");
    expect(living).toContain("Requirement-ID: migrated.rename-1");
    const delta = await readFile(join(target, "features", "FEAT-1-rename", "specs", "payments", "spec.md"), "utf8");
    expect(delta).toContain("## MODIFIED Requirements");
    expect(delta).toContain("### Requirement: New name");
    expect(delta).toContain("Requirement-ID: migrated.rename-1");
    expect(delta).toContain("OpenSpec-Living-Source: payments :: Old name");
    expect(delta).toContain("#### Scenario: Existing behavior");
    expect(await treeHashes(fixture.root)).toEqual(before);
  });

  it("reuses an existing living Requirement-ID for RENAMED without asking for a replacement", async () => {
    const fixture = await workspace({
      "config.yaml": "schema: spec-driven\n",
      "specs/payments/spec.md": LIVING_RENAME_WITH_ID,
      "changes/rename/specs/payments/spec.md": RENAMED,
    });
    const inventory = await inventoryOpenSpec(fixture.root);
    const renameKey = inventory.renamed[0]!.key;
    const skeleton = createOpenSpecMappingSkeleton(inventory);
    expect(skeleton.renames[renameKey]).toMatchObject({
      existingRequirementId: "payments.old",
      requirementId: "payments.old",
    });
    const mapping = await mappingFile(inventory);

    const result = await runLoam(fixture.root, "migrate-openspec", fixture.root, "--map", mapping.path, "--json");
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ready: true,
      renamed: [expect.objectContaining({ requirementId: "payments.old", status: "mapped" })],
    });
  });

  it("refuses to treat blank or repeated living Requirement-ID declarations as stable rename identity", async () => {
    const repeatedId = LIVING_RENAME.replace(
      "The system SHALL preserve",
      "Requirement-ID: payments.old\nRequirement-ID: payments.other\n\nThe system SHALL preserve",
    );
    const fixture = await workspace({
      "config.yaml": "schema: spec-driven\n",
      "specs/payments/spec.md": repeatedId,
      "changes/rename/specs/payments/spec.md": RENAMED,
    });
    const inventory = await inventoryOpenSpec(fixture.root);
    const renameKey = inventory.renamed[0]!.key;
    expect(createOpenSpecMappingSkeleton(inventory).renames[renameKey]).toMatchObject({
      existingRequirementId: "payments.other",
      requirementId: null,
    });
    const mapping = await mappingFile(inventory);

    const result = await runLoam(fixture.root, "migrate-openspec", fixture.root, "--map", mapping.path, "--json");
    expect(result.code).toBe(1);
    expect(JSON.parse(result.stdout).mappingIssues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "mapping.rename-source-id-invalid" }),
    ]));
  });

  it("combines RENAMED with its authored MODIFIED body instead of overwriting that delta", async () => {
    const fixture = await workspace({
      "config.yaml": "schema: spec-driven\n",
      "specs/payments/spec.md": LIVING_RENAME,
      "changes/rename-and-modify/specs/payments/spec.md": RENAMED_AND_MODIFIED,
    });
    const mapping = await mappingFile(await inventoryOpenSpec(fixture.root));
    const target = join(await makeTmpDir("loam-openspec-rename-modified-target-"), "target");
    cleanups.push(() => rm(join(target, ".."), { recursive: true, force: true }));

    const result = await runLoam(
      fixture.root,
      "migrate-openspec",
      fixture.root,
      "--map",
      mapping.path,
      "--apply",
      "--target",
      target,
      "--json",
    );

    expect(result.code).toBe(0);
    const delta = await readFile(
      join(target, "features", "FEAT-1-rename-and-modify", "specs", "payments", "spec.md"),
      "utf8",
    );
    expect(delta.match(/### Requirement: New name/g)).toHaveLength(1);
    expect(delta).toContain("The system SHALL use the revised behavior.");
    expect(delta).toContain("#### Scenario: Revised behavior");
    expect(delta).not.toContain("The system SHALL preserve the existing behavior.");
  });

  it("blocks missing RENAMED sources, double renames, target collisions, and rename chains", async () => {
    const livingAAndB = `${LIVING_RENAME.trimEnd()}\n\n### Requirement: Second name\nText.\n\n#### Scenario: Second\n- **WHEN** used\n- **THEN** it works\n`;
    const missingFixture = await workspace({
      "config.yaml": "schema: spec-driven\n",
      "specs/payments/spec.md": livingAAndB,
      "changes/missing/specs/payments/spec.md": RENAMED.replace("Old name", "Absent name"),
    });
    const missingMap = await mappingFile(await inventoryOpenSpec(missingFixture.root));
    const missing = await runLoam(
      missingFixture.root,
      "migrate-openspec",
      missingFixture.root,
      "--map",
      missingMap.path,
      "--json",
    );
    expect(JSON.parse(missing.stdout).mappingIssues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "mapping.rename-source-missing" }),
    ]));

    const ambiguousFixture = await workspace({
      "config.yaml": "schema: spec-driven\n",
      "specs/payments/spec.md": `${LIVING_RENAME.trimEnd()}\n\n### Requirement: Old name\nDuplicate.\n\n#### Scenario: Duplicate\n- **WHEN** used\n- **THEN** it is ambiguous\n`,
      "changes/ambiguous/specs/payments/spec.md": RENAMED,
    });
    const ambiguousMap = await mappingFile(await inventoryOpenSpec(ambiguousFixture.root));
    const ambiguous = await runLoam(
      ambiguousFixture.root,
      "migrate-openspec",
      ambiguousFixture.root,
      "--map",
      ambiguousMap.path,
      "--json",
    );
    expect(JSON.parse(ambiguous.stdout).mappingIssues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "mapping.rename-source-ambiguous" }),
    ]));

    const conflictFixture = await workspace({
      "config.yaml": "schema: spec-driven\n",
      "specs/payments/spec.md": livingAAndB,
      "changes/one/specs/payments/spec.md": RENAMED.replace("New name", "Second name"),
      "changes/two/specs/payments/spec.md": RENAMED.replace("New name", "Third name"),
      "changes/three/specs/payments/spec.md": RENAMED
        .replace("Old name", "Second name")
        .replace("New name", "Third name"),
    });
    const conflictMap = await mappingFile(await inventoryOpenSpec(conflictFixture.root));
    const conflict = await runLoam(
      conflictFixture.root,
      "migrate-openspec",
      conflictFixture.root,
      "--map",
      conflictMap.path,
      "--json",
    );
    expect(conflict.code).toBe(1);
    expect(JSON.parse(conflict.stdout).mappingIssues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "mapping.rename-double-source" }),
      expect.objectContaining({ code: "mapping.rename-target-conflict" }),
      expect.objectContaining({ code: "mapping.rename-chain" }),
    ]));
  });

  it("scopes rename identity and target conflicts to the mapped service namespace", async () => {
    const secondLiving = LIVING_RENAME.replaceAll("Old name", "Second name");
    const distinctFixture = await workspace({
      "config.yaml": "schema: spec-driven\n",
      "specs/first/spec.md": LIVING_RENAME,
      "specs/second/spec.md": secondLiving,
      "changes/rename-first/specs/first/spec.md": RENAMED,
      "changes/rename-second/specs/second/spec.md": RENAMED.replace("Old name", "Second name"),
    });
    const distinctMap = await mappingFile(await inventoryOpenSpec(distinctFixture.root));
    for (const rename of Object.values(distinctMap.document.renames)) {
      rename.requirementId = "shared.identity";
    }
    await writeFile(distinctMap.path, JSON.stringify(distinctMap.document), "utf8");
    const distinct = await runLoam(
      distinctFixture.root,
      "migrate-openspec",
      distinctFixture.root,
      "--map",
      distinctMap.path,
      "--json",
    );
    expect(distinct.code).toBe(0);
    expect(JSON.parse(distinct.stdout)).toMatchObject({ ready: true });

    const sharedFixture = await workspace({
      "config.yaml": "schema: spec-driven\n",
      "specs/first/spec.md": LIVING_RENAME,
      "specs/second/spec.md": secondLiving,
      "changes/rename-first/specs/first/spec.md": RENAMED.replace("New name", "Unified name"),
      "changes/rename-second/specs/second/spec.md": RENAMED
        .replace("Old name", "Second name")
        .replace("New name", "Unified name"),
    });
    const sharedMap = await mappingFile(await inventoryOpenSpec(sharedFixture.root));
    sharedMap.document.capabilities.first!.services = ["shared"];
    sharedMap.document.capabilities.second!.services = ["shared"];
    await writeFile(sharedMap.path, JSON.stringify(sharedMap.document), "utf8");
    const shared = await runLoam(
      sharedFixture.root,
      "migrate-openspec",
      sharedFixture.root,
      "--map",
      sharedMap.path,
      "--json",
    );
    expect(shared.code).toBe(1);
    expect(JSON.parse(shared.stdout).mappingIssues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "mapping.rename-double-target" }),
    ]));
  });

  it("materializes skip_specs intent and explicit legacy/ADR dispositions without creating a feature spec delta", async () => {
    const fixture = await workspace({
      "config.yaml": "schema: spec-driven\n",
      "specs/payments/spec.md": LIVING,
      "changes/docs-only/.openspec.yaml": "schema: spec-driven\nskip_specs: true\n",
      "changes/docs-only/proposal.md": "# Proposal\n\nKeep this proposal body.\n",
      "changes/docs-only/design.md": "# Design\n\nKeep this design body.\n",
      "changes/docs-only/tasks.md": "# Tasks\n\n- [ ] Keep this task.\n",
      "changes/docs-only/notes.txt": "custom authored note\n",
      "changes/docs-only/.review.md": "hidden authored review\n",
    });
    const inventory = await inventoryOpenSpec(fixture.root);
    const mapping = await mappingFile(inventory);
    const target = join(await makeTmpDir("loam-openspec-skip-target-"), "target");
    cleanups.push(() => rm(join(target, ".."), { recursive: true, force: true }));
    const before = await treeHashes(fixture.root);

    const result = await runLoam(
      fixture.root,
      "migrate-openspec",
      fixture.root,
      "--map",
      mapping.path,
      "--apply",
      "--target",
      target,
      "--json",
    );

    expect(result.code).toBe(0);
    const featureDir = join(target, "features", "FEAT-1-docs-only");
    expect(await readFile(join(featureDir, "intent.md"), "utf8")).toContain("Keep this proposal body.");
    expect(await readFile(join(featureDir, "adrs", "openspec-design.md"), "utf8")).toContain("Keep this design body.");
    expect(await readFile(join(featureDir, "legacy", "tasks.md"), "utf8")).toContain("Keep this task.");
    expect(await readFile(join(featureDir, "legacy", "openspec", "notes.txt"), "utf8")).toBe("custom authored note\n");
    expect(await readFile(join(featureDir, "legacy", "openspec", ".review.md"), "utf8"))
      .toBe("hidden authored review\n");
    expect(await readFile(join(featureDir, "legacy", "openspec", "proposal.md"), "utf8"))
      .toBe("# Proposal\n\nKeep this proposal body.\n");
    expect(existsSync(join(featureDir, "specs"))).toBe(false);
    const plan = JSON.parse(await readFile(join(target, "migration-plan.json"), "utf8"));
    expect(plan.artifactDisposition).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "proposal",
        disposition: "convert-to-intent",
        selectedDisposition: "convert-to-intent",
      }),
    ]));
    expect(await treeHashes(fixture.root)).toEqual(before);
  });

  it("refuses apply when the audited source digest has changed and creates no target", async () => {
    const fixture = await workspace({
      "config.yaml": "schema: spec-driven\n",
      "specs/payments/spec.md": LIVING,
    });
    const inventory = await inventoryOpenSpec(fixture.root);
    const mapping = await mappingFile(inventory);
    await writeFile(join(fixture.openspec, ".review.md"), "hidden source change\n", "utf8");
    const target = join(await makeTmpDir("loam-openspec-stale-parent-"), "target");
    cleanups.push(() => rm(join(target, ".."), { recursive: true, force: true }));

    const result = await runLoam(
      fixture.root,
      "migrate-openspec",
      fixture.root,
      "--map",
      mapping.path,
      "--apply",
      "--target",
      target,
      "--json",
    );
    expect(result.code).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, error: { code: "invalid-option" } });
    expect(existsSync(target)).toBe(false);
  });

  it("requires explicit authored artifact dispositions before migration is ready", async () => {
    const fixture = await workspace({
      "config.yaml": "schema: spec-driven\n",
      "specs/payments/spec.md": LIVING,
      "changes/add-refund/proposal.md": "# Proposal\n",
      "changes/add-refund/tasks.md": "# Tasks\n",
      "changes/add-refund/specs/payments/spec.md": DELTA,
    });
    const audited = await inventoryOpenSpec(fixture.root);
    const skeleton = createOpenSpecMappingSkeleton(audited);
    skeleton.capabilities.payments!.services = ["payment-service"];
    (skeleton.changes["add-refund"] as { feature: string | null }).feature = "FEAT-1";
    const mapDir = await makeTmpDir("loam-openspec-unresolved-map-");
    cleanups.push(() => rm(mapDir, { recursive: true, force: true }));
    const mapPath = join(mapDir, "mapping.yaml");
    await writeFile(mapPath, JSON.stringify(skeleton), "utf8");

    const result = await runLoam(fixture.root, "migrate-openspec", fixture.root, "--map", mapPath, "--json");
    const report = JSON.parse(result.stdout);
    expect(result.code).toBe(1);
    expect(report).toMatchObject({ ok: true, ready: false, readiness: { dispositionsResolved: false } });
    expect(report.needsDisposition).toHaveLength(2);

    for (const artifact of Object.values(skeleton.artifacts)) {
      (artifact as { disposition: string | null }).disposition = artifact.suggestedDisposition;
    }
    const proposal = Object.entries(skeleton.artifacts).find(([, artifact]) => artifact.kind === "proposal")!;
    (proposal[1] as { disposition: string | null }).disposition = "review-as-feature-adr";
    await writeFile(mapPath, JSON.stringify(skeleton), "utf8");
    const invalid = await runLoam(fixture.root, "migrate-openspec", fixture.root, "--map", mapPath, "--json");
    expect(JSON.parse(invalid.stdout).mappingIssues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "mapping.invalid-artifact-disposition", key: proposal[0] }),
    ]));
  });

  it("fails cleanly for an unknown audit root", async () => {
    const root = await makeTmpDir("loam-openspec-missing-");
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    const result = await runLoam(root, "audit-openspec", join(root, "missing"), "--json");
    expect(result.code).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      contractVersion: "1.0",
      ok: false,
      error: { code: "unknown-target" },
    });
  });
});
