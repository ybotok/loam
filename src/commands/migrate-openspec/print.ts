/**
 * The human view of an inventory, shared by both verbs.
 *
 * `audit-openspec` and `migrate-openspec` print the same block and differ only
 * in the word above it, so the renderer takes the mode rather than existing
 * twice — the audit's readiness line and the migration's are the same claim and
 * have to stay the same claim.
 *
 * The local `plural` is not a duplicate of `../format.ts`'s. That one spells
 * the regular English plural only, and says so: an irregular noun belongs at
 * the call site. "capability"/"capabilities" is exactly that noun, so this
 * renderer carries the two-form variant instead of misspelling a count.
 */
import { type OpenSpecInventory } from "../../core/openspec-inventory.js";

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

export function printInventory(inventory: OpenSpecInventory, mode: "audit" | "migration"): void {
  const status = inventory.ready
    ? "ready"
    : inventory.mechanicallyCompatible
      ? "compatible; explicit mapping/identity decisions remain"
      : "living or active blockers found";
  console.log(`OpenSpec ${mode} inventory — ${status}`);
  console.log(`  root          ${inventory.root}`);
  console.log(
    `  baseline      release ${inventory.baselines.release.version}@${inventory.baselines.release.commit} · main canary ${inventory.baselines.mainCanary.commit.slice(0, 7)}`,
  );
  console.log(
    `  living       ${plural(inventory.living.capabilities.length, "capability", "capabilities")} · ${plural(inventory.living.specFiles, "spec file")} · ${plural(inventory.living.requirements, "requirement")} · ${plural(inventory.living.scenarios, "scenario")}`,
  );
  console.log(
    `  changes      ${inventory.changes.counts.active} active · ${inventory.changes.counts.archived} archived`,
  );
  console.log(
    `  readiness    living ${inventory.readiness.living.compatible ? "ok" : "blocked"} · active ${inventory.readiness.active.compatible ? "ok" : "blocked"} · source ${inventory.readiness.sourceCurrent ? "current" : "stale"} · capabilities ${inventory.readiness.mappingsResolved ? "resolved" : "open"} · changes ${inventory.readiness.changesResolved ? "resolved" : "open"} · dispositions ${inventory.readiness.dispositionsResolved ? "resolved" : "open"} · archive ${inventory.archiveDiagnostics.length} diagnostic(s)`,
  );

  if (inventory.needsMapping.length > 0) {
    console.log("\n  capability → service decisions");
    for (const decision of inventory.needsMapping) {
      console.log(`    ? ${decision.capability} → ${decision.suggestedService}  [${decision.status}]`);
    }
  }
  if (inventory.needsChangeMapping.length > 0) {
    console.log("\n  change → feature decisions");
    for (const decision of inventory.needsChangeMapping) {
      console.log(`    ? ${decision.change} → ${decision.suggestedFeature}  [${decision.status}]`);
    }
  }
  const activeRenames = inventory.renamed.filter((rename) => rename.scope === "active");
  if (activeRenames.length > 0) {
    console.log("\n  RENAMED identity decisions");
    for (const rename of activeRenames) {
      console.log(
        `    ${rename.status === "mapped" ? "✓" : "?"} ${rename.key}  ${rename.from ?? "<missing FROM>"} → ${rename.to ?? "<missing TO>"}${rename.requirementId ? `  [${rename.requirementId}]` : ""}`,
      );
    }
  }
  if (inventory.needsDisposition.length > 0) {
    console.log(`\n  authored artifact decisions (${inventory.needsDisposition.length})`);
    for (const decision of inventory.needsDisposition.slice(0, 12)) {
      console.log(`    ? ${decision.path} → ${decision.suggestedDisposition}  [${decision.status}]`);
    }
    if (inventory.needsDisposition.length > 12) {
      console.log(`    … ${inventory.needsDisposition.length - 12} more in --json/mapping output`);
    }
  }
  if (inventory.mappingIssues.length > 0) {
    console.log("\n  mapping issues");
    for (const item of inventory.mappingIssues) console.log(`    ✗ ${item.code}  ${item.message}`);
  }
  if (inventory.unsupported.length > 0) {
    console.log("\n  living/active blockers");
    for (const item of inventory.unsupported) {
      console.log(`    ✗ ${item.code}  ${item.path} — ${item.message}`);
    }
  }
  if (inventory.archiveDiagnostics.length > 0) {
    console.log(`\n  archive diagnostics (non-blocking, ${inventory.archiveDiagnostics.length})`);
    for (const item of inventory.archiveDiagnostics.slice(0, 12)) {
      console.log(`    · ${item.code}  ${item.path} — ${item.message}`);
    }
    if (inventory.archiveDiagnostics.length > 12) {
      console.log(`    … ${inventory.archiveDiagnostics.length - 12} more in --json output`);
    }
  }
  const dispositions = new Map<string, number>();
  for (const artifact of inventory.artifacts) {
    dispositions.set(artifact.disposition, (dispositions.get(artifact.disposition) ?? 0) + 1);
  }
  if (dispositions.size > 0) {
    console.log("\n  artifact disposition");
    for (const [disposition, count] of [...dispositions].sort(([a], [b]) => a.localeCompare(b))) {
      console.log(`    · ${disposition}  ${count}`);
    }
  }
}
