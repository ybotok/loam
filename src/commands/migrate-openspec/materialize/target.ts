/**
 * The staged target: plan every byte first, then land them all or none.
 *
 * The two halves are one module because they are one transaction. Planning
 * reads the whole source corpus, so `writeMigrationTarget` re-hashes it
 * afterwards and refuses a snapshot that moved mid-flight; the plan then
 * becomes an exclusive staged write set that rolls back as a unit. Splitting
 * the planner from the writer would put that re-hash on one side of a module
 * boundary and the reads it guards on the other.
 */
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { stringify as stringifyYaml } from "yaml";
import { parseRequirements, type Requirement } from "../../../core/document/spec.js";
import { DOCS_SUBDIRS, docsRepoFiles } from "../../../core/docs.js";
import { ownValue } from "../../../core/kernel/records.js";
import { inventoryOpenSpec, type OpenSpecInventory, type OpenSpecMapping } from "../../../core/openspec-inventory.js";
import { rollbackError, rollbackStaged, stageWrites, swapStaged } from "../../../core/staging/commit.js";
import { planWrite, type PlannedWrite } from "../../../core/staging/writes.js";
import { normalizedMapping } from "../openspec/decisions.js";
import { OpenSpecCommandError } from "../openspec/error.js";
import { safeArtifactRelative } from "../openspec/paths.js";
import { readSourceArtifact } from "../openspec/read.js";
import { materializeActiveChanges } from "./active.js";
import { materializeLivingSpecs } from "./living.js";
import { assertDistinctPlannedPaths, assertEmptyNonOverlappingStage } from "./stage.js";

export async function planMigrationWrites(
  inventory: OpenSpecInventory,
  mapping: OpenSpecMapping,
  target: string,
): Promise<{ livingWrites: PlannedWrite[]; activeWrites: PlannedWrite[]; legacyWrites: PlannedWrite[] }> {
  // One reading of the living corpus for both materializers. They each read and
  // parsed the whole of it independently, which is twice the work and, worse,
  // two readings: a rename resolved against one of them was written beside a
  // living spec built from the other.
  const livingByCapability = new Map<string, Requirement[]>();
  for (const capability of inventory.living.capabilities) {
    livingByCapability.set(
      capability.id,
      parseRequirements(await readSourceArtifact(inventory.root, capability.files[0]!)),
    );
  }
  const livingWrites = await materializeLivingSpecs(inventory, mapping, target, livingByCapability);
  const activeWrites = await materializeActiveChanges(inventory, mapping, target, livingByCapability);
  const legacyWrites = await copyLivingTree(inventory, target);
  assertDistinctPlannedPaths([...livingWrites, ...activeWrites, ...legacyWrites]);
  return { livingWrites, activeWrites, legacyWrites };
}

/**
 * The living tree, byte for byte, the way each change tree already gets
 * `legacy/openspec/`.
 *
 * `materializeLivingSpecs` emits frontmatter plus serialized requirements, so
 * everything a living spec holds AROUND its requirements has nowhere to land:
 * `## Purpose`, prose between `## Requirements` and the first requirement, and
 * the whole of `specs/<capability>/design.md` — which the summary counts under
 * `review-as-service-adr` while FOLLOW-UP.md tells the migrator to review prose
 * that had been written nowhere. (Prose inside a requirement body survives
 * serialization and is not the subject here.)
 */
async function copyLivingTree(inventory: OpenSpecInventory, target: string): Promise<PlannedWrite[]> {
  const writes: PlannedWrite[] = [];
  for (const artifact of inventory.artifacts) {
    if (artifact.scope !== "living") continue;
    const segments = safeArtifactRelative(artifact.path, "specs/", "The OpenSpec living tree");
    writes.push(planWrite(
      join(target, "legacy", "openspec", "specs", ...segments),
      await readSourceArtifact(inventory.root, artifact.path),
    ));
  }
  return writes;
}

export async function writeMigrationTarget(
  inventory: OpenSpecInventory,
  mapping: OpenSpecMapping,
  target: string,
  planned: { livingWrites: PlannedWrite[]; activeWrites: PlannedWrite[]; legacyWrites: PlannedWrite[] },
): Promise<{ directory: string; files: string[]; followUpBlockers: string[] }> {
  await assertEmptyNonOverlappingStage(inventory, target);
  // All migration content was read while planning. Re-hash after those reads so
  // a source edit between audit and materialization cannot produce a mixed snapshot.
  const refreshed = await inventoryOpenSpec(inventory.inputRoot, { mapping });
  if (!refreshed.ready || refreshed.inventoryDigest !== inventory.inventoryDigest) {
    throw new OpenSpecCommandError(
      "invalid-option",
      "OpenSpec source changed while the migration plan was being materialized; re-audit and review a new mapping.",
    );
  }
  const followUpBlockers = [
    "Model every staged service in architecture/landscape.likec4 and bind it with metadata { service '<id>' }; the scaffolded landscape is deliberately empty.",
    "Add each service model.likec4 and OpenAPI contract; migrated requirements have no Operations/Covers links yet unless authored upstream.",
    "Set truthful sources from each service repository, validate, and have a human run loam vouch; staged specs remain status: draft.",
    ...(inventory.changes.active.length === 0
      ? []
      : [
          `Review ${inventory.changes.active.length} staged feature(s), add their LikeC4/OpenAPI deltas, and resolve any retained or manual-review OpenSpec artifacts recorded in migration-plan.json.`,
          // OpenSpec has no equivalent of `Based-On:`, so every migrated
          // MODIFIED/REMOVED requirement arrives unpinned (`delta.baseline-missing`,
          // a warning by design — a corpus that cannot archive is not a safety
          // property). Until someone runs this, two migrated features rewriting
          // one requirement still lose the loser's text silently.
          "Run `loam rebase <FEAT>` per staged feature: OpenSpec deltas carry no Based-On, so no MODIFIED/REMOVED requirement is pinned to the living text it was written against.",
        ]),
    "Review config context/rules, Stores/references, custom schemas, and every artifact disposition in migration-plan.json.",
    "Review the verbatim OpenSpec living tree under legacy/openspec/specs/: Purpose prose, section prose, and capability design.md have no loam equivalent and were copied, not converted.",
    // The cutover was undocumented, which is how a staged target that cannot
    // answer `loam validate` reads as finished work. Naming the two halves —
    // what is fleet content and what is review residue — is the whole procedure.
    "Cut over only once `loam validate --all` here is green: services/ and features/ are the fleet content, while legacy/, mapping.yaml, migration-plan.json, FOLLOW-UP.md, and this repository's own loam.json/AGENTS.md are review residue that does not move.",
  ];
  const plan = {
    version: 1,
    generatedBy: "loam migrate-openspec",
    source: { inputRoot: inventory.inputRoot, root: inventory.root },
    baselines: inventory.baselines,
    readiness: inventory.readiness,
    mapping: normalizedMapping(inventory, mapping),
    living: inventory.living,
    activeChanges: inventory.changes.active,
    archiveDiagnostics: inventory.archiveDiagnostics,
    artifactDisposition: inventory.artifacts.map((artifact) => ({
      ...artifact,
      disposition: ownValue(mapping.artifacts, artifact.path) ?? artifact.disposition,
      selectedDisposition: ownValue(mapping.artifacts, artifact.path) ?? null,
    })),
    followUpBlockers,
    note: "Staged migration docs only. Living specs and mapped active changes were materialized without changing the OpenSpec source or live loam docs. The result is intentionally not expected to validate green until the listed architecture, API, provenance, and review work is completed.",
  };
  const writes: PlannedWrite[] = [
    planWrite(join(target, "migration-plan.json"), `${JSON.stringify(plan, null, 2)}\n`),
    planWrite(join(target, "mapping.yaml"), stringifyYaml(normalizedMapping(inventory, mapping), { lineWidth: 0 })),
    planWrite(join(target, "FOLLOW-UP.md"), renderFollowUp(followUpBlockers)),
    ...docsRepoScaffold(target),
    ...planned.livingWrites,
    ...planned.activeWrites,
    ...planned.legacyWrites,
  ];
  assertDistinctPlannedPaths(writes);
  for (const write of writes) write.exclusive = true;
  const staged = await stageWrites(writes);
  if (staged.some((item) => item.before !== null)) {
    await rollbackStaged(staged);
    throw new OpenSpecCommandError(
      "already-exists",
      "Staging target changed after its emptiness check; refusing to overwrite a concurrently created file.",
    );
  }
  try {
    await swapStaged(staged);
  } catch (error) {
    const failures = await rollbackStaged(staged);
    const code = typeof error === "object" && error !== null && "code" in error ? error.code : null;
    if (code === "EEXIST" && failures.length === 0) {
      throw new OpenSpecCommandError(
        "already-exists",
        "Staging target changed during apply; the migration was rolled back without overwriting the concurrent file.",
      );
    }
    throw rollbackError(error, failures);
  }
  // The skeleton `loam init` lays down, after the content that fills it. A docs
  // repo is recognised by `services/` plus AGENTS.md, and until now `services/`
  // existed only if some capability happened to route there: migrate a corpus
  // whose requirements all live under `changes/` — legitimate, and the shape a
  // greenfield OpenSpec workspace has — and the target came out with no
  // `services/` at all, so `loam init --docs <target> --service <id>` answered
  // "not a docs repo" and every read command refused it as `services-missing`.
  // Empty directories, created after the swap so a rolled-back apply leaves the
  // target as empty as it found it.
  for (const dir of DOCS_SUBDIRS) await mkdir(join(target, dir), { recursive: true });
  return { directory: target, files: writes.map((write) => write.path), followUpBlockers };
}

/**
 * The staged target is a real docs repo, not a folder of markdown.
 *
 * FOLLOW-UP.md tells the migrator to validate, rebase and vouch against this
 * directory, and every one of those commands resolves its fleet from loam.json:
 * without these three files none of the instructions it gives can be executed,
 * and the reviewer has no way to see what is still missing. The landscape is
 * laid down EMPTY for the same reason `loam init` lays it down empty — an absent
 * landscape silences every cross-service check, and a generated one would be a
 * guess presented as the map. Each staged service then shows up as exactly one
 * `landscape.service-unmodelled` error, which is the first follow-up item.
 *
 * The bytes come from `docs.ts`, so this IS the repo `loam init` makes rather
 * than a lookalike. Only the landscape's opening comment differs, and it differs
 * through a parameter: the migrator needs to be told why their map is empty,
 * and everything after that sentence is advice that does not depend on how the
 * repo was created.
 */
function docsRepoScaffold(target: string): PlannedWrite[] {
  return docsRepoFiles({
    landscapePreamble: "// Fleet map for a staged OpenSpec migration. It arrives EMPTY because\n"
      + "// OpenSpec has no topology: loam has nothing to read here and will not\n"
      + "// guess \"who calls whom\" into the source of truth. Every services/<id>/\n"
      + "// staged beside this file needs an element and a binding below — until\n"
      + "// then each one is a `landscape.service-unmodelled` error.",
  }).map(([rel, content]) => planWrite(join(target, rel), content));
}

function renderFollowUp(blockers: string[]): string {
  return `# Staged OpenSpec migration: required follow-up\n\nThis target contains migrated living requirements, mapped active feature deltas, preserved source artifacts, and a review plan. It is deliberately not presented as a fully valid loam fleet. Complete every item before moving it into live docs.\n\n${blockers.map((item) => `- [ ] ${item}`).join("\n")}\n`;
}
