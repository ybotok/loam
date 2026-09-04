/**
 * One feature as `loam show` presents it: its intent, its delta, the
 * per-service specs under it, and the business promises it changes.
 *
 * Split from `./service.ts` because a service and a feature answer different
 * questions — what a repository holds now, against what a change proposes —
 * and only the service view has to reach the landscape for its edges. The
 * one-line shapes both write in are in `./marks.ts`.
 *
 * THE CAPABILITY SECTION IS NOT DECORATION. Without it a feature carrying only
 * a `features/<FEAT>/capabilities/<id>/spec.md` — a business change with no
 * service touched yet, which is the first thing an analyst writes and what
 * `loam new --capability` scaffolds — displayed as a feature that carries
 * nothing at all, from the command a person runs to find out what a feature
 * carries. The archive would then refuse it (`capability.uncovered`,
 * `scaffold.placeholder`) over documents this view said were not there.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { emitJson, repoPath } from "../../core/envelope/json.js";
import { type Elem } from "../../core/c4/likec4.js";
import { FleetContext } from "../../core/fleet-context.js";
import { type FeatureEntry } from "../../core/repo/entries.js";
import { featurePaths, featureSpecPaths } from "../../core/repo/paths.js";
import { parseRequirements } from "../../core/document/parse.js";
import { featureCapabilityDeltas } from "../../core/capabilities/delta/tree.js";
import { capabilityDeltaSummaries } from "../../core/capabilities/delta/summary.js";
import { apiChanges } from "../../core/projection/api.js";
import { eventChanges } from "../../core/projection/events.js";
import { featureStatus } from "../../core/status/feature/feature.js";
import { executableNext } from "../../core/status/actions/execution.js";
import { findingJson } from "../../core/vocabulary/report.js";
import type { DocsDir } from "../../core/kernel/ids/dirs.js";
import { plural } from "../policy/format.js";
import { mark } from "./marks.js";
import { errorText } from "../../core/c4/likec4.js";

const REVIEW_INTENT_LIMIT = 1_200;

function intentSummary(text: string): string {
  const withoutFrontmatter = text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "");
  const prose = withoutFrontmatter
    .replace(/<!--[\s\S]*?-->/g, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .join(" ");
  return prose.length <= REVIEW_INTENT_LIMIT
    ? prose
    : `${prose.slice(0, REVIEW_INTENT_LIMIT - 1).trimEnd()}…`;
}

export async function showFeature(
  docsDir: DocsDir,
  feature: FeatureEntry,
  json: boolean,
  context = new FleetContext(),
): Promise<void> {
  const paths = featurePaths(feature.dir);
  const delta = feature.has.delta
    ? await context.loadLikeC4(paths.delta)
    : { errors: [], elements: [] as Elem[], relationships: [] };
  const taggedEls = delta.elements.filter((e) => e.tags.includes(feature.id));
  const taggedRels = delta.relationships.filter((r) => r.tags.includes(feature.id));

  const services = [];
  for (const svc of feature.services) {
    const servicePaths = featureSpecPaths(feature.dir, svc);
    const specPath = servicePaths.spec;
    const reqs = existsSync(specPath) ? parseRequirements(await readFile(specPath, "utf8")) : [];
    services.push({
      id: svc,
      added: reqs.filter((r) => r.kind === "ADDED").length,
      modified: reqs.filter((r) => r.kind === "MODIFIED").length,
      removed: reqs.filter((r) => r.kind === "REMOVED").length,
      operations: [...new Set(reqs.flatMap((r) => r.operations))],
      api: await apiChanges(servicePaths.openapi),
      events: await eventChanges(servicePaths.asyncapi),
    });
  }

  // One `existsSync` for a feature with no capability delta, which is every
  // feature in a fleet that has not adopted the business axis — the walk's own
  // short-circuit, and the whole cost such a fleet pays for this section.
  const capabilities = await capabilityDeltaSummaries(
    (await featureCapabilityDeltas(feature.dir)).docs,
    async (path) => parseRequirements(await readFile(path, "utf8")),
  );

  if (json) {
    const status = await featureStatus(docsDir, feature, { context });
    const issues = status.checks.issues.map((finding) =>
      findingJson(finding, { path: status.feature.path, role: "scope" }),
    );
    const blockers = issues.filter(
      (finding) => finding["severity"] === "error" || finding["gates"] === true,
    );
    const intent = existsSync(paths.intent) ? intentSummary(await readFile(paths.intent, "utf8")) : "";
    emitJson({
      command: "show",
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
      // Additive, which the envelope permits (core/envelope/json.ts), and an
      // EMPTY ARRAY rather than an omitted key for a feature that carries none:
      // a consumer indexing it must not have to tell "no capability delta" from
      // "this loam does not report them", and the two would be the same absence.
      capabilities: capabilities.map((c) => ({
        id: c.id,
        path: repoPath(docsDir, c.spec),
        added: c.added,
        modified: c.modified,
        removed: c.removed,
        promises: c.promises,
      })),
      review: {
        readyToArchive: !feature.archived && status.feature.stage === "done" && blockers.length === 0,
        intent: {
          path: repoPath(docsDir, paths.intent),
          summary: intent,
        },
        architecture: {
          path: repoPath(docsDir, paths.delta),
          elements: taggedEls.map((element) => ({
            id: element.id,
            kind: element.kind,
            title: element.title,
          })),
          relationships: taggedRels.map((relationship) => ({
            source: relationship.source,
            target: relationship.target,
            title: relationship.title ?? null,
            operation: relationship.op ?? null,
          })),
          errors: delta.errors.map(errorText),
        },
        services,
        dependencies: { blockedBy: status.feature.blockedBy },
        artifacts: status.artifacts,
        verification: status.verification,
        blockers,
        advisories: issues.filter(
          (finding) => finding["severity"] === "warn" && finding["gates"] !== true,
        ),
        useCases: status.useCases,
        next: status.next.map(executableNext),
      },
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

  // Printed only when the feature carries one: a fleet that has not adopted the
  // business axis must see nothing, and an empty "capabilities" heading over
  // every feature in every such fleet is exactly the noise that teaches people
  // to stop reading the output.
  if (capabilities.length > 0) {
    console.log("\n  capabilities");
    const width = Math.max(...capabilities.map((c) => c.id.length));
    for (const c of capabilities) {
      // The promise ids, not just the counts: `Realizes: <capability>#<id>` is
      // the line somebody has to write next, and the id is the half of it a
      // reader cannot guess.
      const ids = c.promises.flatMap((p) => (p.id === null ? [] : [p.id]));
      console.log(
        `    ${c.id.padEnd(width)}  +${c.added} ~${c.modified} -${c.removed} promises` +
          (ids.length === 0 ? "" : ` · ${ids.join(", ")}`),
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
