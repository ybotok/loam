/**
 * What `loam delta` reads from the LIVING documents beside the feature's own:
 * the rows a merge would drop, and — under `--diff` — what each requirement,
 * operation and message does to the living ones. Both are comparisons of the
 * projection against what lives, which is why they sit apart from the command
 * that prints them.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { repoPath } from "../../core/envelope/json.js";
import { parseRequirements } from "../../core/document/parse.js";
import { type Requirement } from "../../core/document/spec.js";
import { droppedBy, type DroppedRow } from "../../core/document/apply.js";
import { livingCapabilityPaths } from "../../core/repo/authored/paths.js";
import type { ServicePaths } from "../../core/repo/paths.js";
import type { CapabilityDoc } from "../../core/capabilities/tree.js";
import type { DocsDir } from "../../core/kernel/ids/dirs.js";
import {
  reviewMessages,
  reviewOperations,
  reviewRequirements,
  type Change,
  type Review,
} from "../../core/projection/review.js";

/** The documents one projection's dropped rows are read over. */
interface DroppedRequest {
  /** The service's two spec axes: the feature's parsed delta and the living document's path. */
  axes: Array<{ delta: Requirement[]; living: string }>;
  /** The feature's capability deltas — not narrowed by `--service`, for the capabilities section's reason. */
  capabilities: readonly CapabilityDoc[];
}

/**
 * Each living document's dropped rows (core/document/apply.ts), docs-relative.
 *
 * A pair the merge itself would refuse — malformed or repeated
 * `Requirement-ID`s, an id and a heading selecting different requirements —
 * is skipped rather than reported: `validate --feature` grades each under its
 * own code, the archive refuses it, and a brief that died on it would hide
 * every other section from the implementer. The catch is around the pure
 * algebra alone, whose only throws are those refusals; the reads stay outside.
 */
export async function droppedRows(docsDir: DocsDir, req: DroppedRequest): Promise<Array<DroppedRow & { path: string }>> {
  const pairs = [
    ...req.axes,
    ...(await Promise.all(
      req.capabilities.map(async (doc) => ({
        delta: parseRequirements(await readFile(doc.spec, "utf8")),
        living: livingCapabilityPaths(docsDir, doc.id).spec,
      })),
    )),
  ];
  const out: Array<DroppedRow & { path: string }> = [];
  for (const { delta, living } of pairs) {
    if (delta.length === 0 || !existsSync(living)) continue;
    const livingReqs = parseRequirements(await readFile(living, "utf8"));
    let rows: DroppedRow[];
    try {
      rows = droppedBy(livingReqs, delta);
    } catch {
      continue;
    }
    for (const row of rows) out.push({ path: repoPath(docsDir, living), ...row });
  }
  return out;
}

/** Each item of one service's slice, against the living documents — `--diff`'s whole answer. */
export interface SliceReview {
  /** Aligned with the business requirements, in delta order. */
  business: Review[];
  /** Aligned with the arch requirements, in delta order. */
  arch: Review[];
  /** Keyed `<METHOD> <path>`, as `ApiChange` spells the slot. */
  operations: Map<string, Review>;
  /** Keyed by the declaration's slot. */
  messages: Map<string, Change>;
}

/** The feature's own documents for one service, and the living ones they would merge into. */
export interface SliceReviewRequest {
  reqs: Requirement[];
  archReqs: Requirement[];
  feature: { openapi: string; asyncapi: string };
  living: ServicePaths;
}

/** What `--diff` reports: every comparison against what lives, read once. */
export async function reviewSlice(req: SliceReviewRequest): Promise<SliceReview> {
  const living = async (path: string): Promise<Requirement[]> =>
    existsSync(path) ? parseRequirements(await readFile(path, "utf8")) : [];
  return {
    business: reviewRequirements(req.reqs, await living(req.living.spec)),
    arch: reviewRequirements(req.archReqs, await living(req.living.archSpec)),
    operations: await reviewOperations(req.feature.openapi, req.living.openapi),
    messages: await reviewMessages(req.feature.asyncapi, req.living.asyncapi),
  };
}
