/**
 * One feature as `loam show` presents it: its intent, its delta, and the
 * per-service specs under it.
 *
 * Split from `./service.ts` because a service and a feature answer different
 * questions — what a repository holds now, against what a change proposes —
 * and only the service view has to reach the landscape for its edges. The
 * one-line shapes both write in are in `./marks.ts`.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { emitJson, repoPath } from "../../core/envelope/json.js";
import { loadFile, type Elem } from "../../core/c4/likec4.js";
import { type FeatureEntry } from "../../core/repo/entries.js";
import { featurePaths, featureSpecPaths } from "../../core/repo/paths.js";
import { parseRequirements } from "../../core/document/parse.js";
import { plural } from "../policy/format.js";
import { errorText, mark } from "./marks.js";

export async function showFeature(docsDir: string, feature: FeatureEntry, json: boolean): Promise<void> {
  const paths = featurePaths(feature.dir);
  const delta = feature.has.delta
    ? await loadFile(paths.delta)
    : { errors: [], elements: [] as Elem[], relationships: [] };
  const taggedEls = delta.elements.filter((e) => e.tags.includes(feature.id));
  const taggedRels = delta.relationships.filter((r) => r.tags.includes(feature.id));

  const services = [];
  for (const svc of feature.services) {
    const specPath = featureSpecPaths(feature.dir, svc).spec;
    const reqs = existsSync(specPath) ? parseRequirements(await readFile(specPath, "utf8")) : [];
    services.push({
      id: svc,
      added: reqs.filter((r) => r.kind === "ADDED").length,
      modified: reqs.filter((r) => r.kind === "MODIFIED").length,
      removed: reqs.filter((r) => r.kind === "REMOVED").length,
      operations: [...new Set(reqs.flatMap((r) => r.operations))],
    });
  }

  if (json) {
    emitJson({
      type: "feature",
      id: feature.id,
      dirName: feature.dirName,
      path: repoPath(docsDir, feature.dir),
      archived: feature.archived,
      has: feature.has,
      delta: {
        elements: taggedEls.length,
        relationships: taggedRels.length,
        errors: delta.errors.map(errorText),
      },
      services,
    });
    return;
  }

  const state = feature.archived ? "archived" : "active";
  console.log(`${feature.id}   ${repoPath(docsDir, feature.dir)}   ${state}\n`);

  console.log("  artifacts");
  console.log(`    ${mark(feature.has.intent)} intent.md`);
  const deltaNote =
    delta.errors.length > 0
      ? `${delta.errors.length} error(s)`
      : `${plural(taggedEls.length, "element")} · ${plural(taggedRels.length, "relationship")} tagged ${feature.id}`;
  console.log(`    ${mark(feature.has.delta)} delta.likec4  ${feature.has.delta ? deltaNote : ""}`.trimEnd());

  if (services.length > 0) {
    console.log("\n  services");
    const width = Math.max(...services.map((s) => s.id.length));
    for (const s of services) {
      const ops = s.operations.length > 0 ? ` · ${s.operations.join(", ")}` : "";
      console.log(
        `    ${s.id.padEnd(width)}  +${s.added} ~${s.modified} -${s.removed} requirements${ops}`,
      );
    }
  }

  if (delta.errors.length > 0) {
    console.log("\n  delta errors");
    for (const e of delta.errors) console.log(`    ✗ ${errorText(e)}`);
  }
}

/* ------------------------------------------------------------------ */

/** "-" for absent, matching `list`: ✗ is the error glyph here, and a missing runbook is not an error. */
