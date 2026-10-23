/**
 * What this feature's C4 merge would leave the map saying, computed before
 * anything is written — the merge PREVIEW every feature-side gate grades a
 * document against.
 *
 * It was the second half of `../staged.ts` while staging was its only reader.
 * The phases are distinct and so are their readers: the preview is a pure
 * question about the archive's merge (texts in, the merged landscape out),
 * while the staging copies a tree and parses it. That module's header carries
 * the WHY of grading against the post-merge corpus; this one carries why the
 * preview is the archive's own merge and not a second opinion beside it.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { loadFile, type LoadedDoc } from "../../likec4.js";
import { createdServiceModels } from "../../service-model/created/models.js";
import type { ExtendingModel } from "../../splice/contract.js";
import { planLandscapeMerge } from "../../splice/landscape-merge.js";
import { decodeDocument } from "../../../kernel/document-bytes.js";
import type { DocsDir, FeatureDir } from "../../../kernel/ids/dirs.js";
import { featurePaths, landscapePath } from "../../../repo/paths.js";

/** What the merge preview is computed from: the feature, and what the caller already holds. */
export interface MergePreviewRequest {
  docsDir: DocsDir;
  featureDir: FeatureDir;
  /** The feature's id — the tag that selects the delta's own additions. */
  featureId: string;
  /**
   * The caller's memoised LikeC4 read, when it has one. Only `delta.likec4`
   * goes through it, and only to compute the merge preview — but a caller
   * inside `featureCoherence` has already loaded that exact document, and
   * loading one spins a fresh Langium workspace, which
   * `core/coherence/coherence.ts` calls the dominant per-feature cost.
   */
  load?: (path: string) => Promise<LoadedDoc>;
  /**
   * The fleet's extending models — the SAME list `loam archive` merges with.
   * The merge routes a nested addition into the model that owns that service's
   * interior, so a preview computed without this list holds interior the
   * archive will put somewhere else, and every gate resting on the preview
   * grades a map that will never exist (verification 2026-09-04, review C).
   *
   * Optional because it must be INJECTED rather than read here: the shape scan
   * that decides which models extend the map lives in
   * `../service-model/shape.ts`, and that package imports this one — reading it
   * from here would be a package cycle. The reader is
   * `../service-model/fleet/extending.ts`, one level below that scan, and both
   * shipped callers fill this in from it: `core/delta/delta.ts` for the
   * use-case overlay, `core/coherence/coherence.ts` for the deployment one.
   * Omitted, the preview is the pre-routing one — the behaviour every caller
   * had before this field existed, and what a fleet whose models all stand
   * alone gets either way.
   */
  models?: readonly ExtendingModel[];
}

/** What the landscape looks like after this feature's C4 delta is spliced in. */
export type MergedLandscape =
  /** The delta adds nothing, or there is none — the living landscape stands. */
  | { kind: "living" }
  /** The merge preview, as authored bytes. */
  | { kind: "merged"; content: string }
  /** The merge could not be computed; `planLandscape` owns the refusal and says why. */
  | { kind: "failed"; reason: string };

/**
 * The merge preview, computed with the SAME function `loam archive` commits
 * with.
 *
 * Reusing `planLandscapeMerge` rather than approximating it is what makes this
 * an answer about the archive rather than a second opinion beside it: an
 * element placed differently, a tag stripped differently, or a splice refused
 * there and allowed here would be a document graded against a map the merge
 * never writes.
 *
 * THE PARITY IS THE MERGE, NOT THE WHOLE GATE, and the two places the sides
 * differ are worth naming rather than leaving for a reader to discover.
 *
 * The first changes no verdict. `planLandscape` runs one check BEFORE it
 * computes the merge and this does not: a delta declaring the feature tag on a
 * specification KIND is refused there, because every element of that kind
 * inherits the tag and the merge would splice the whole document. Such a delta
 * reaches `newEls` here unfiltered, so the preview this grades against is one
 * the archive would never write — but that archive refuses either way, before
 * anything is written.
 *
 * The second changed every verdict about a fleet with extending models, and is
 * why `models` is on the request at all. `planLandscape` names the fleet's
 * extending models, so a nested addition is ROUTED into the model that owns
 * that service's interior and never reaches the map; a request that omits them
 * previews a map holding interior the archive will put somewhere else. A
 * feature-local `usecases/<x>.likec4` whose hop names `<service-fqn>.<container>`
 * then resolved in the preview, passed `usecase.flow-invalid` — the gate whose
 * own message is "the archive would land an architecture/ nothing has checked",
 * and which `--approve` cannot override — and was copied verbatim into
 * `architecture/`, where it resolves against nothing and takes the whole fleet
 * map down (verification 2026-09-04, review C; SCHEMA names that outcome as the
 * thing that must not happen). A caller that leaves `models` out is asking for
 * the pre-routing preview, and gets exactly the answers it got before.
 *
 * A throw is `failed` rather than propagated. Every `LandscapeSpliceError` this
 * can raise is one `planLandscape` raises again — with its own message, its own
 * refusal code, and before anything is written — so throwing here would only
 * decide which of two identical refusals an author reads first.
 */
export async function mergedLandscape(req: MergePreviewRequest): Promise<MergedLandscape> {
  const deltaPath = featurePaths(req.featureDir).delta;
  const landscape = landscapePath(req.docsDir);
  if (!existsSync(deltaPath) || !existsSync(landscape)) return { kind: "living" };
  const delta = await (req.load ?? loadFile)(deltaPath);
  if (delta.errors.length > 0) {
    return {
      kind: "failed",
      reason: `delta.likec4 has ${delta.errors.length} parse error(s) — a feature's own documents cannot be graded against a map that does not parse`,
    };
  }
  // The models the archive will CREATE route exactly as the living ones do —
  // a new service's interior lands in its new model, never on the map — so a
  // preview asking for the routing gets them too (`createdServiceModels` says why).
  const models =
    req.models === undefined
      ? undefined
      : [
          ...req.models,
          ...(await createdServiceModels({
            docsDir: req.docsDir,
            featureDir: req.featureDir,
            featureId: req.featureId,
            drawn: [...(await (req.load ?? loadFile)(landscape)).elements, ...delta.elements.filter((e) => e.tags.includes(req.featureId))],
          })),
        ];
  try {
    const plan = await planLandscapeMerge({
      landscapeText: await text(landscape),
      deltaText: await text(deltaPath),
      deltaElements: delta.elements,
      newEls: delta.elements.filter((e) => e.tags.includes(req.featureId)),
      newRels: delta.relationships.filter((r) => r.tags.includes(req.featureId)),
      featureId: req.featureId,
      // As `planLandscape` passes it: without the table every edge of a tagged
      // kind is a statement the splice cannot locate, and the preview fails a
      // feature's flows over a merge the archive itself computes.
      deltaKindTags: delta.specification?.relationshipKindTags ?? {},
      ...(models === undefined ? {} : { models }),
    });
    return plan.content === null ? { kind: "living" } : { kind: "merged", content: plan.content };
  } catch (err) {
    return { kind: "failed", reason: err instanceof Error ? err.message : String(err) };
  }
}

/** Read a document loam is about to hand LikeC4, refusing the encodings that decode as empty. */
async function text(path: string): Promise<string> {
  return decodeDocument(await readFile(path), path);
}
