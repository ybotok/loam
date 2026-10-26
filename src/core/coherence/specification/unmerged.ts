/**
 * `delta.specification-not-merged`: the feature's additions use a kind, a tag or
 * a custom color the living map does not declare, so `loam archive` cannot merge
 * them.
 *
 * THE FIX IS A FINDING, NOT A MERGE THAT COPIES DECLARATIONS. The archive could
 * have been taught to add the missing declarations to the map's specification
 * instead, and SCHEMA.md's doctrine is what rules that out:
 *
 *  - `architecture/landscape.likec4` is the extending shape's ONE specification
 *    ("Who declares kinds and tags"): a kind is added there, once, by the fleet,
 *    and every extending model borrows it. A delta's specification is the copy
 *    that lets the delta parse alone — context, like the untagged stubs beside
 *    the change, and the archive merges only what carries the feature tag. A
 *    declaration can carry none, so the merge cannot tell the kind this feature
 *    means to introduce from a copy it quoted, and SCHEMA says outright that it
 *    "never copies a `specification` declaration".
 *  - A kind is fleet-wide vocabulary, not a line. Its style draws every edge or
 *    element of it, everywhere, and since LikeC4 1.59.0 its tags are handed to
 *    each one — tags loam grades (`#external`, `#platform`), so a copied
 *    declaration could switch a check off across the fleet at exit 0, which is
 *    the failure `kindTagFindings` exists to refuse. Two features in flight
 *    could also declare the same kind differently; whichever archived first
 *    would decide for the whole map, inside a merge nobody reviews as a
 *    vocabulary change.
 *  - It is the `info` doctrine one axis over: the contract merges never carry a
 *    delta's `info`, and the remedy they print is to edit the living document
 *    in the same change (`openapi.info-not-merged`). The difference is only
 *    that here the merge cannot succeed without it, so this is an error.
 *
 * So the gate says what the archive would refuse, and the line to add — or, for a
 * name another `architecture/` document declares out of the landscape's sight,
 * the declaration to move.
 *
 * ASKED OF THE ARCHIVE'S OWN MERGE. The names come from `planLandscapeMerge`,
 * through the same preview every feature-side gate reads
 * (`../../c4/project/merge/preview.ts`), with the fleet's extending models passed so
 * an addition is judged in the document the archive would really put it in. A
 * second reading beside the merge would be a second opinion about it.
 *
 * It used to run only when it could matter, because the preview parses the
 * living map — a LikeC4 workspace spin the clean path was not to pay — and
 * whether an addition can be missing a declaration is settled from the two
 * files' text (a delta parses alone, so every name it uses is one its own
 * specification declares). It now runs for every feature whose delta parses,
 * and pays that parse, because it also answers the question the text cannot:
 * whether the merge refuses for ANY other reason — an addition it cannot place,
 * two elements bound to different services, a block it cannot carry. Without
 * that, `validate --feature` and `status` called such a feature ready, and a
 * feature with flows filed the refusal as `usecase.flow-invalid`, as if the
 * flows were at fault (a decision taken 2026-10-27, cost accepted: one merged
 * map parse per active feature in `validate --feature`, `--all` and `status`).
 *
 * `delta.merge-refused` is a PREDICTION. `loam archive` drops it from its own
 * gate and lets its plan refuse with `merge-failed` and the same reason, the
 * refusal it has always given — the archive is the merge, and its answer is
 * the one a script already branches on.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import type { LoadedDoc } from "../../c4/likec4.js";
import { projectDocumentsBesideMap } from "../../c4/project/architecture.js";
import { previewMerge } from "../../c4/project/merge/preview.js";
import type { ExtendingModel } from "../../c4/splice/contract.js";
import {
  declarationLine,
  undeclaredMessage,
  type UndeclaredName,
} from "../../c4/splice/vocabulary/undeclared.js";
import { repoPath } from "../../envelope/json.js";
import { decodeDocument } from "../../kernel/document-bytes.js";
import type { DocsDir, FeatureDir } from "../../kernel/ids/dirs.js";
import { featurePaths, landscapePath } from "../../repo/paths.js";
import type { Issue } from "../../vocabulary/issue.js";

export interface UnmergedRequest {
  docsDir: DocsDir;
  featureDir: FeatureDir;
  featureId: string;
  /** The caller's memoised LikeC4 read, when it has one — the preview's own reason (`MergePreviewRequest.load`). */
  load?: (path: string) => Promise<LoadedDoc>;
  /** The fleet's extending models, read only when the preview runs. */
  models: () => Promise<ExtendingModel[]>;
}

/**
 * What the archive's own C4 merge would refuse this delta for: one
 * `delta.specification-not-merged` per declaration a document it writes is
 * missing, or one `delta.merge-refused` carrying the reason for any other
 * refusal. The caller asks only of a delta that parsed: an unparseable one is
 * `delta.invalid`, and the preview would refuse it for that reason alone.
 */
export async function mergeRefusalIssues(req: UnmergedRequest): Promise<Issue[]> {
  const deltaPath = featurePaths(req.featureDir).delta;
  const mapPath = landscapePath(req.docsDir);
  // No map, no merge: the archive says so ("no landscape.likec4 — not merged")
  // and `landscape.missing` owns the state.
  if (!existsSync(deltaPath) || !existsSync(mapPath)) return [];
  try {
    await read(deltaPath);
    await read(mapPath);
  } catch {
    // A document this cannot decode is one the preview cannot read either, and
    // the refusal for it belongs to the reader that names the encoding.
    return [];
  }

  // Both halves — the map and every model the archive routes an interior into
  // or creates — because a model splice the archive cannot do is a refusal
  // too, and the service-local flow grader reads the same preview.
  const preview = await previewMerge({
    docsDir: req.docsDir,
    featureDir: req.featureDir,
    featureId: req.featureId,
    ...(req.load === undefined ? {} : { load: req.load }),
    models: await req.models(),
    projectDocuments: () => projectDocumentsBesideMap(req.docsDir),
  });
  if (preview.missing !== undefined) {
    // On either arm: a name only a routed model lacks leaves the map
    // previewable, and the merge reports it beside the content instead of
    // refusing — the same finding, because the fix is the same declaration.
    const byLine = new Map<string, UndeclaredName[]>();
    for (const u of preview.missing) byLine.set(declarationLine(u), [...(byLine.get(declarationLine(u)) ?? []), u]);
    return [...byLine.values()].map((uses) => ({
      severity: "error",
      code: "delta.specification-not-merged",
      message: undeclaredMessage(uses),
      locations: [
        { path: repoPath(req.docsDir, mapPath), role: "primary" },
        { path: repoPath(req.docsDir, deltaPath), role: "related" },
      ],
    }));
  }
  if (preview.kind === "planned") return [];
  return [
    {
      severity: "error",
      code: "delta.merge-refused",
      subject: req.featureId,
      message:
        `\`loam archive\` would refuse this feature's C4 merge (merge-failed) and write nothing: ${preview.reason}. ` +
        "Fix the delta as that says — `--approve` cannot help, because approving does not make the merge possible.",
      locations: [{ path: repoPath(req.docsDir, deltaPath), role: "primary" }],
    },
  ];
}

/** A document as the preview reads it — refusing the encodings that decode as empty. */
async function read(path: string): Promise<string> {
  return decodeDocument(await readFile(path), path);
}
