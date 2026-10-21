/**
 * A service an active feature INTRODUCES, as `loam show` presents it: which
 * feature carries it, the delta documents under that feature's
 * `specs/<service>/`, what they add, and where a reader goes next.
 *
 * Its own view rather than a branch of `./service.ts`, because every line that
 * view prints is a statement about the LIVING documents — artifact ticks under
 * `services/<id>/`, a vouch, the fleet map's edges — and for this service each
 * one would be a false "absent": the directory does not exist yet, by design,
 * until the feature archives. Until this view existed `loam show` refused the
 * name outright ("No service or feature"), on the same tree where `loam tasks`
 * listed work for it, so the newest service in the fleet was the one a reader
 * could not look up.
 *
 * The per-feature counts are `loam show <FEAT>`'s per-service row, read through
 * the same core projections (`featureSpecPaths`, `apiChanges`, `eventChanges`),
 * so the two views of one delta cannot disagree about what it adds.
 */
import { existsSync } from "node:fs";
import { emitJson, repoPath } from "../../core/envelope/json.js";
import { FleetContext } from "../../core/fleet-context.js";
import { type FeatureEntry } from "../../core/repo/entries.js";
import { featureSpecPaths, type FeatureSpecPaths } from "../../core/repo/paths.js";
import { apiChanges, type ApiSlice } from "../../core/projection/api.js";
import { eventChanges, type EventSlice } from "../../core/projection/events.js";
import { type Requirement } from "../../core/document/spec.js";
import type { RawServiceId } from "../../core/kernel/ids/service.js";
import type { DocsDir } from "../../core/kernel/ids/dirs.js";
import { plural } from "../policy/format.js";
import { kindCounts, mark, requirementJson, requirementLine, scenarioCount } from "./marks.js";

export interface Introduced {
  /** The service, as the introducing feature's own `specs/` readdir spelled it. */
  id: RawServiceId;
  /** `introducingFeatures`' answer — never empty when this view is reached. */
  features: FeatureEntry[];
}

/** One introducing feature's delta over the service, read once for both renderings. */
interface Introduction {
  feature: FeatureEntry;
  paths: FeatureSpecPaths;
  has: { spec: boolean; archSpec: boolean; openapi: boolean; asyncapi: boolean };
  reqs: Requirement[];
  archReqs: Requirement[];
  api: ApiSlice;
  events: EventSlice;
}

export async function showIntroduced(
  docsDir: DocsDir,
  introduced: Introduced,
  json: boolean,
  context: FleetContext,
): Promise<void> {
  const { id } = introduced;
  const rows = await Promise.all(introduced.features.map((f) => readIntroduction(f, id, context)));
  const by = introduced.features.map((f) => f.id).join(", ");

  if (json) {
    emitJson({
      command: "show",
      type: "service",
      id,
      // The marker a consumer branches on, beside the id. It is absent from a
      // living service's payload rather than `true` there, because that
      // payload is published and stays byte-identical.
      living: false,
      introducedBy: introduced.features.map((f) => f.id),
      introductions: rows.map((row) => ({
        feature: row.feature.id,
        path: repoPath(docsDir, row.paths.dir),
        has: row.has,
        // `show <FEAT> --json`'s per-service row, key for key, so a consumer
        // that reads one reads the other.
        ...kindCounts(row.reqs),
        operations: [...new Set(row.reqs.flatMap((r) => r.operations))],
        api: row.api,
        events: row.events,
        // And the living payload's requirement entries, so the delta is
        // listed exactly as the service will list it once it merges.
        requirements: row.reqs.map(requirementJson),
        archSpec: {
          requirements: row.archReqs.length,
          scenarios: scenarioCount(row.archReqs),
          entries: row.archReqs.map(requirementJson),
        },
        next: nextCommands(row.feature, id),
      })),
    });
    return;
  }

  console.log(`${id}   introduced by ${by} (in flight) — not in the living docs until it archives\n`);
  rows.forEach((row, i) => {
    if (i > 0) console.log("");
    printIntroduction(docsDir, row, id);
  });
}

async function readIntroduction(feature: FeatureEntry, id: RawServiceId, context: FleetContext): Promise<Introduction> {
  const paths = featureSpecPaths(feature.dir, id);
  const has = {
    spec: existsSync(paths.spec),
    archSpec: existsSync(paths.archSpec),
    openapi: existsSync(paths.openapi),
    asyncapi: existsSync(paths.asyncapi),
  };
  // The contract projections carry their own readability, so a delta document
  // that does not parse is said below rather than shown as "no operations".
  const [reqs, archReqs, api, events] = await Promise.all([
    has.spec ? context.readRequirements(paths.spec) : [],
    has.archSpec ? context.readRequirements(paths.archSpec) : [],
    apiChanges(paths.openapi),
    eventChanges(paths.asyncapi),
  ]);
  return { feature, paths, has, reqs, archReqs, api, events };
}

/**
 * Where a reader goes next: the feature that carries the service, its delta
 * over it, and the open work on it. Both interpolants are enumeration
 * spellings — the canonical feature id and the feature's own directory name for
 * the service — so the printed commands parse.
 */
function nextCommands(feature: FeatureEntry, id: RawServiceId): string[] {
  return [
    `loam show ${feature.id}`,
    `loam delta ${feature.id} --service ${id}`,
    `loam tasks ${feature.id} --service ${id}`,
  ];
}

function printIntroduction(docsDir: DocsDir, row: Introduction, id: RawServiceId): void {
  console.log(`  ${row.feature.id}   ${repoPath(docsDir, row.paths.dir)}`);
  const specNote = (rs: Requirement[]): string => {
    const k = kindCounts(rs);
    return `+${k.added} ~${k.modified} -${k.removed} requirements · ${plural(scenarioCount(rs), "scenario")}`;
  };
  console.log(`    ${mark(row.has.spec)} spec.md         ${row.has.spec ? specNote(row.reqs) : ""}`.trimEnd());
  console.log(`    ${mark(row.has.archSpec)} arch.spec.md    ${row.has.archSpec ? specNote(row.archReqs) : ""}`.trimEnd());
  const apiNote = row.api.unreadable ? "does not parse" : plural(row.api.changes.length, "operation");
  console.log(`    ${mark(row.has.openapi)} openapi.yaml    ${row.has.openapi ? apiNote : ""}`.trimEnd());
  const eventNote = row.events.unreadable ? "does not read as AsyncAPI 3.0" : plural(row.events.changes.length, "message");
  console.log(`    ${mark(row.has.asyncapi)} asyncapi.yaml   ${row.has.asyncapi ? eventNote : ""}`.trimEnd());

  // The kind leads each line: in a delta it is the fact a reviewer reads first,
  // and a requirement listed here without it would read as one already living.
  if (row.reqs.length > 0) {
    console.log("\n    requirements");
    for (const r of row.reqs) console.log(`      [${r.kind}] ${requirementLine(r)}`);
  }
  if (row.archReqs.length > 0) {
    console.log("\n    arch requirements");
    for (const r of row.archReqs) console.log(`      [${r.kind}] ${requirementLine(r)}`);
  }

  if (row.api.unreadable) {
    console.log("\n    operations");
    console.log(`      ✗ openapi.yaml does not parse — nothing here lists what ${row.feature.id} adds to ${id}`);
    if (row.api.error !== undefined) console.log(`        ${row.api.error}`);
  } else if (row.api.changes.length > 0) {
    console.log("\n    operations");
    for (const op of row.api.changes) {
      console.log(`      ${op.remove ? "REMOVE " : ""}${op.method} ${op.path}  ${op.operationId}`);
    }
  }

  if (row.events.unreadable) {
    console.log("\n    events");
    console.log(`      ✗ asyncapi.yaml does not read as AsyncAPI 3.0 — nothing here lists what ${row.feature.id} adds to ${id}`);
    if (row.events.error !== undefined) console.log(`        ${row.events.error}`);
  } else if (row.events.changes.length > 0) {
    console.log("\n    events");
    for (const m of row.events.changes) {
      const direction = m.direction === null ? "" : `${m.direction.toUpperCase()} `;
      console.log(`      ${m.remove ? "REMOVE " : ""}${direction}${m.message}  (${m.slot})`);
    }
  }

  console.log("\n    next");
  for (const command of nextCommands(row.feature, id)) console.log(`      ${command}`);
}
