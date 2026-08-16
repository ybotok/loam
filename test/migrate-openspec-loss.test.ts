/**
 * The one-way promise: a migration never reports readiness over content it
 * cannot see, and never records a disposition as selected for an artifact it
 * does not migrate.
 *
 * Every case here is a shape that used to audit clean — `ready: true`,
 * `unsupported: []` — while the corpus, or part of it, went nowhere. They are
 * grouped by what was lost rather than by which function was wrong, because the
 * property is one property: MIGRATING-from-OpenSpec.md says "no authored
 * artifact is silently lost", and each of these was a separate way to make that
 * sentence false while exiting 0.
 *
 * The control assertions matter as much as the refusals. A refusal that also
 * fires on a legitimate workspace is not a fix, it is a different bug: a
 * greenfield workspace whose only requirements live under changes/, a rename
 * that really is a rename, a colleague's commit under changes/archive/, and a
 * staging target that merely sits beside a docs repo must all still work.
 */
import { afterEach, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { readFile, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { inventoryOpenSpec } from "../src/core/openspec/inventory.js";
import { createOpenSpecMappingSkeleton, type OpenSpecMappingSkeleton } from "../src/core/openspec/model/mapping.js";
import { type OpenSpecInventory } from "../src/core/openspec/model/model.js";
import { makeTmpDir, runLoam, writeFiles } from "./helpers/harness.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!();
});

/** `## Purpose`, prose under `## Requirements`, and a requirement body. */
const LIVING = `# Payments

## Purpose
Owns payment authorization for orders placed in the storefront.

## Requirements

Money is integer minor units, never floats. This paragraph belongs to the
capability, not to any requirement below it.

### Requirement: Authorize a payment
The system SHALL authorize a payment before any capture is attempted.

#### Scenario: Successful authorization
- **WHEN** a valid card is presented
- **THEN** the payment is authorized
`;

const CAPABILITY_DESIGN = `## Context
The ledger is the source of truth for money movements.

## Decision
Outbox events for every ledger write.
`;

const PROPOSAL = `## Why
Customers cannot get money back without a support ticket.

## What Changes
- Add a refund operation.
`;

const DELTA = `## ADDED Requirements

### Requirement: Refund a payment
The system SHALL refund a captured payment.

#### Scenario: Full refund
- **WHEN** a refund is requested
- **THEN** the full amount is refunded
`;

async function tmp(prefix: string): Promise<string> {
  const dir = await realpath(await makeTmpDir(prefix));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

/** A workspace with the planning shape under `openspec/`, the common form. */
async function workspace(files: Record<string, string>): Promise<{ root: string; openspec: string }> {
  const root = await tmp("loam-openspec-loss-");
  const openspec = join(root, "openspec");
  await writeFiles(openspec, files);
  return { root, openspec };
}

/** Everything a human decides, decided the suggested way. */
function completeSkeleton(inventory: OpenSpecInventory): OpenSpecMappingSkeleton {
  const skeleton = createOpenSpecMappingSkeleton(inventory);
  for (const decision of inventory.mappingDecisions) {
    skeleton.capabilities[decision.capability]!.services = [decision.suggestedService];
  }
  for (const change of Object.values(skeleton.changes)) {
    (change as { feature: string | null }).feature = change.suggestedFeature;
  }
  let rename = 1;
  for (const usage of Object.values(skeleton.renames)) {
    if (usage.requirementId === null) {
      (usage as { requirementId: string | null }).requirementId = `migrated.rename-${rename}`;
    }
    rename += 1;
  }
  for (const artifact of Object.values(skeleton.artifacts)) {
    (artifact as { disposition: string | null }).disposition = artifact.suggestedDisposition;
  }
  return skeleton;
}

async function mappingFile(inventory: OpenSpecInventory): Promise<string> {
  const path = join(await tmp("loam-openspec-loss-map-"), "mapping.yaml");
  // JSON is valid YAML, and keeps the fixture about the decisions.
  await writeFile(path, `${JSON.stringify(completeSkeleton(inventory), null, 2)}\n`, "utf8");
  return path;
}

function codes(inventory: OpenSpecInventory): string[] {
  return inventory.unsupported.map((item) => item.code);
}

describe("a migration never reports readiness over content it cannot see", () => {
  it("audits the corpus of a Store checkout that keeps its planning shape at the checkout root", async () => {
    const root = await tmp("loam-openspec-loss-store-");
    await writeFiles(root, {
      ".openspec-store/store.yaml": "name: payments-store\n",
      "specs/payments/spec.md": LIVING,
    });

    const inventory = await inventoryOpenSpec(root);

    // The failure this replaces was worse than a wrong number: `root` pointed at
    // <checkout>/openspec, which does not exist, and the verdict over that
    // absent directory was `ready` — more confident than any success verdict.
    expect(inventory.root).toBe(root);
    expect(inventory.workspace.kind).toBe("store");
    expect(inventory.living).toMatchObject({ specFiles: 1, requirements: 1 });
    expect(inventory.living.capabilities.map((c) => c.id)).toEqual(["payments"]);
    expect(inventory.ready).toBe(false);
    expect(inventory.mechanicallyCompatible).toBe(true);

    const target = join(await tmp("loam-openspec-loss-target-"), "staged");
    const map = await mappingFile(inventory);
    const applied = await runLoam(root, "migrate-openspec", root, "--map", map, "--apply", "--target", target);
    expect(applied.code).toBe(0);
    expect(await readFile(join(target, "services", "payments", "spec.md"), "utf8"))
      .toContain("### Requirement: Authorize a payment");
  });

  it("refuses a Store checkout with no planning content instead of auditing a directory that is not there", async () => {
    const root = await tmp("loam-openspec-loss-emptystore-");
    await writeFiles(root, { ".openspec-store/store.yaml": "name: payments-store\n" });

    await expect(inventoryOpenSpec(root)).rejects.toThrow(/has no OpenSpec planning content/);
  });

  it("never calls an inventory that read nothing ready, whatever put it in that state", async () => {
    const empty = await workspace({ "config.yaml": "schema: spec-driven\n" });

    const inventory = await inventoryOpenSpec(empty.root);

    // The backstop under the whole family: it does not depend on root selection
    // being right, only on the reading being empty.
    expect(codes(inventory)).toEqual(["openspec.workspace-empty"]);
    expect(inventory.ready).toBe(false);
    expect(inventory.mechanicallyCompatible).toBe(false);
  });

  it("leaves a greenfield workspace alone when its only requirements live under changes/", async () => {
    const greenfield = await workspace({
      "config.yaml": "schema: spec-driven\n",
      "changes/add-refunds/proposal.md": PROPOSAL,
      "changes/add-refunds/specs/payments/spec.md": DELTA,
    });

    const inventory = await inventoryOpenSpec(greenfield.root);

    expect(inventory.living.specFiles).toBe(0);
    expect(codes(inventory)).toEqual([]);
    expect(inventory.mechanicallyCompatible).toBe(true);
  });

  it("reports a living spec whose file name no capability reads, the way it already reports the change twin", async () => {
    const miscased = await workspace({ "specs/payments/Spec.md": LIVING });

    const inventory = await inventoryOpenSpec(miscased.root);

    expect(inventory.unsupported).toContainEqual(expect.objectContaining({
      code: "openspec.nonstandard-living-spec",
      path: "specs/payments/Spec.md",
      scope: "living",
    }));
    expect(inventory.ready).toBe(false);
  });
});

describe("a migration never records a decision for an artifact it does not migrate", () => {
  it("refuses a dot-prefixed change directory and offers no disposition for anything under it", async () => {
    const hidden = await workspace({
      "specs/payments/spec.md": LIVING,
      "changes/.wip-refunds/proposal.md": PROPOSAL,
      "changes/.wip-refunds/specs/payments/spec.md": DELTA,
      "changes/add-refunds/proposal.md": PROPOSAL,
      "changes/add-refunds/specs/payments/spec.md": DELTA,
    });

    const inventory = await inventoryOpenSpec(hidden.root);

    // subdirs() drops it from the enumeration and walkFiles() does not, which is
    // how migration-plan.json came to record `selectedDisposition` for a proposal
    // that reached nothing and was named in no follow-up.
    expect(inventory.changes.active.map((change) => change.id)).toEqual(["add-refunds"]);
    expect(inventory.unsupported).toContainEqual(expect.objectContaining({
      code: "openspec.hidden-change-directory",
      path: "changes/.wip-refunds",
      scope: "active",
    }));
    expect(inventory.artifactDecisions.map((decision) => decision.path))
      .toEqual(["changes/add-refunds/proposal.md"]);
    expect(inventory.ready).toBe(false);
  });

  it("keeps a dot-prefixed archive directory a diagnostic, because frozen history never blocks", async () => {
    const hidden = await workspace({
      "specs/payments/spec.md": LIVING,
      "changes/archive/.2025-01-01-draft/specs/payments/spec.md": DELTA,
    });

    const inventory = await inventoryOpenSpec(hidden.root);

    expect(inventory.archiveDiagnostics).toContainEqual(expect.objectContaining({
      code: "openspec.hidden-change-directory",
      scope: "archive",
    }));
    expect(inventory.mechanicallyCompatible).toBe(true);
  });

  it("demands an allocation only for the requirement names a split capability actually routes", async () => {
    const renamed = await workspace({
      "specs/payments/spec.md": LIVING,
      "changes/rename-auth/proposal.md": PROPOSAL,
      "changes/rename-auth/specs/payments/spec.md": `## RENAMED Requirements

- FROM: \`### Requirement: Authorize a payment\`
- TO: \`### Requirement: Authorize a card payment\`

## MODIFIED Requirements

### Requirement: Authorize a card payment
The system SHALL authorize a card payment before any capture is attempted.

#### Scenario: Successful authorization
- **WHEN** a valid card is presented
- **THEN** the payment is authorized
`,
    });

    const inventory = await inventoryOpenSpec(renamed.root);
    const skeleton = createOpenSpecMappingSkeleton(inventory);

    // Routing follows the rename's FROM — that is what keeps the delta with the
    // living text it rewrites — so a slot for the TO name was a decision apply
    // could only ignore.
    expect(Object.keys(skeleton.capabilities.payments!.requirementServices))
      .toEqual(["Authorize a payment"]);
  });
});

describe("a migration never invents structure that is not there", () => {
  it("does not read a fenced example of the rename syntax as a rename", async () => {
    const fenced = await workspace({
      "specs/payments/spec.md": LIVING,
      "changes/rename-auth/proposal.md": PROPOSAL,
      "changes/rename-auth/specs/payments/spec.md": `## RENAMED Requirements

The syntax, for the team wiki:

\`\`\`markdown
- FROM: \`### Requirement: Old illustrative name\`
- TO: \`### Requirement: New illustrative name\`
\`\`\`

- FROM: \`### Requirement: Authorize a payment\`
- TO: \`### Requirement: Authorize a card payment\`
`,
    });

    const inventory = await inventoryOpenSpec(fenced.root);

    // The phantom pair produced mapping.rename-source-missing, and the only cure
    // was editing the OpenSpec source the tool promises never to touch.
    expect(inventory.renamed.map((usage) => [usage.from, usage.to]))
      .toEqual([["Authorize a payment", "Authorize a card payment"]]);
    expect(inventory.mappingIssues).toEqual([]);
  });

  it("blocks requirements written under ## Requirements in an active delta, which stage nothing", async () => {
    const quoted = await workspace({
      "specs/payments/spec.md": LIVING,
      "changes/add-refunds/proposal.md": PROPOSAL,
      "changes/add-refunds/specs/payments/spec.md": `${DELTA}
## Requirements

### Requirement: Partially refund a payment
The system SHALL support partial refunds.

#### Scenario: Partial refund
- **WHEN** a partial refund is requested
- **THEN** only the requested amount is refunded
`,
    });

    const inventory = await inventoryOpenSpec(quoted.root);

    // `## Requirements` is the heading OpenSpec's own living-spec template
    // mandates, so this is what copying a living spec into a change produces:
    // parsed, counted in the plan, routed nowhere.
    expect(inventory.unsupported).toContainEqual(expect.objectContaining({
      code: "openspec.change-quoted-requirements",
      path: "changes/add-refunds/specs/payments/spec.md",
      scope: "active",
    }));
    expect(inventory.ready).toBe(false);

    const target = join(await tmp("loam-openspec-loss-target-"), "staged");
    const map = await mappingFile(inventory);
    const applied = await runLoam(
      quoted.root, "migrate-openspec", quoted.root, "--map", map, "--apply", "--target", target,
    );
    expect(applied.code).toBe(1);
    expect(existsSync(target)).toBe(false);
  });

  it("accepts a timestamped `created` rather than blocking every change over one field", async () => {
    const iso = await workspace({
      "specs/payments/spec.md": LIVING,
      "changes/add-refunds/.openspec.yaml": "schema: spec-driven\ncreated: 2026-06-14T09:12:00Z\n",
      "changes/add-refunds/proposal.md": PROPOSAL,
      "changes/add-refunds/specs/payments/spec.md": DELTA,
    });

    const inventory = await inventoryOpenSpec(iso.root);

    expect(codes(inventory)).toEqual([]);
    expect(inventory.mechanicallyCompatible).toBe(true);
    expect(inventory.changes.active[0]!.metadata.created).toBe("2026-06-14T09:12:00Z");
  });
});

describe("a completed mapping survives everything it does not depend on", () => {
  it("keeps its binding across a change under changes/archive/ and loses it on a living edit", async () => {
    const source = await workspace({
      "specs/payments/spec.md": LIVING,
      "changes/add-refunds/proposal.md": PROPOSAL,
      "changes/add-refunds/specs/payments/spec.md": DELTA,
      "changes/archive/2025-01-01-initial/specs/payments/spec.md":
        "## ADDED Requirements\n\n### Requirement: Authorize a payment\nThe system SHALL authorize a payment befoer capture.\n",
    });
    const map = await mappingFile(await inventoryOpenSpec(source.root));
    const bound = await runLoam(source.root, "migrate-openspec", source.root, "--map", map, "--json");
    expect(JSON.parse(bound.stdout)).toMatchObject({ ready: true, mappingIssues: [] });

    // A colleague fixes a typo in frozen history. The doc promises archive
    // anomalies never block; the digest covered them anyway, and the only signal
    // was a pair of hashes.
    const archived = join(source.openspec, "changes/archive/2025-01-01-initial/specs/payments/spec.md");
    await writeFile(archived, (await readFile(archived, "utf8")).replace("befoer", "before"), "utf8");
    const afterArchive = await runLoam(source.root, "migrate-openspec", source.root, "--map", map, "--json");
    expect(JSON.parse(afterArchive.stdout)).toMatchObject({ ready: true, mappingIssues: [] });

    const living = join(source.openspec, "specs/payments/spec.md");
    await writeFile(living, (await readFile(living, "utf8")).replace("SHALL authorize", "SHALL always authorize"), "utf8");
    const afterLiving = await runLoam(source.root, "migrate-openspec", source.root, "--map", map, "--json");
    expect(JSON.parse(afterLiving.stdout).mappingIssues)
      .toContainEqual(expect.objectContaining({ code: "mapping.source-digest-mismatch" }));
  });
});

describe("the staged target holds everything, and can answer for itself", () => {
  it("copies the living tree verbatim, because serialization has nowhere to put prose", async () => {
    const source = await workspace({
      "specs/payments/spec.md": LIVING,
      "specs/payments/design.md": CAPABILITY_DESIGN,
    });
    const target = join(await tmp("loam-openspec-loss-target-"), "staged");
    const map = await mappingFile(await inventoryOpenSpec(source.root));

    expect((await runLoam(
      source.root, "migrate-openspec", source.root, "--map", map, "--apply", "--target", target,
    )).code).toBe(0);

    // `## Purpose`, the prose between `## Requirements` and the first
    // requirement, and the whole of design.md — which the summary counts under
    // review-as-service-adr — used to land nowhere at all.
    expect(await readFile(join(target, "legacy/openspec/specs/payments/spec.md"), "utf8")).toBe(LIVING);
    expect(await readFile(join(target, "legacy/openspec/specs/payments/design.md"), "utf8"))
      .toBe(CAPABILITY_DESIGN);
    // Requirement bodies still ride the converted spec: the copy is for what
    // serialization drops, not a replacement for it.
    expect(await readFile(join(target, "services/payments/spec.md"), "utf8"))
      .toContain("The system SHALL authorize a payment before any capture is attempted.");
  });

  it("is a docs repo, so every command FOLLOW-UP.md names can be run against it", async () => {
    const source = await workspace({
      "specs/payments/spec.md": LIVING,
      "changes/add-refunds/proposal.md": PROPOSAL,
      "changes/add-refunds/specs/payments/spec.md": DELTA,
    });
    const target = join(await tmp("loam-openspec-loss-target-"), "staged");
    const map = await mappingFile(await inventoryOpenSpec(source.root));

    expect((await runLoam(
      source.root, "migrate-openspec", source.root, "--map", map, "--apply", "--target", target,
    )).code).toBe(0);

    for (const file of ["loam.json", "AGENTS.md", "architecture/landscape.likec4"]) {
      expect(existsSync(join(target, file))).toBe(true);
    }
    // The landscape is scaffolded EMPTY on purpose: OpenSpec has no topology, so
    // the follow-up item is a real, visible error rather than a guessed map.
    const listed = await runLoam(target, "list", "--json");
    expect(listed.code).toBe(0);
    expect(JSON.parse(listed.stdout)).toMatchObject({
      services: [expect.objectContaining({ id: "payments" })],
      features: [expect.objectContaining({ id: "FEAT-1" })],
    });
    const validated = await runLoam(target, "validate", "--all", "--json");
    const findings = JSON.parse(validated.stdout).targets
      .flatMap((entry: { findings: Array<{ code: string }> }) => entry.findings);
    expect(findings).toContainEqual(expect.objectContaining({ code: "landscape.service-unmodelled" }));
  });

  it("refuses a target inside the live docs tree and allows one beside it", async () => {
    const source = await workspace({ "specs/payments/spec.md": LIVING });
    const map = await mappingFile(await inventoryOpenSpec(source.root));
    const fleet = await tmp("loam-openspec-loss-fleet-");
    expect((await runLoam(fleet, "init", "--create", "--docs", join(fleet, "docs"), "--no-commands", "--no-skills")).code)
      .toBe(0);

    // What the overlap check missed: the target overlapped no OpenSpec source,
    // so `--target <docs>/features/staged` produced phantom features in `list`.
    const inside = await runLoam(
      source.root, "migrate-openspec", source.root, "--map", map,
      "--apply", "--target", join(fleet, "docs", "features", "staged"),
    );
    expect(inside.code).toBe(1);
    expect(inside.out).toMatch(/Refusing to stage a migration inside the live loam docs/);
    expect(existsSync(join(fleet, "docs", "features", "staged"))).toBe(false);

    // The line is the docs tree, not the repository: a sibling of docsDir joins
    // no fleet, and refusing it would only teach people to migrate elsewhere.
    const beside = await runLoam(
      source.root, "migrate-openspec", source.root, "--map", map,
      "--apply", "--target", join(fleet, "staging"),
    );
    expect(beside.code).toBe(0);
    expect(existsSync(join(fleet, "staging", "loam.json"))).toBe(true);
  });
});
