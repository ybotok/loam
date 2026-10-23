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
 * (`../../c4/project/staged.ts`), with the fleet's extending models passed so
 * an addition is judged in the document the archive would really put it in. A
 * second reading beside the merge would be a second opinion about it.
 *
 * And only when it can matter, because the preview parses the living map — a
 * LikeC4 workspace spin the clean path must not pay. A delta parses alone, so
 * every name its model uses is one its own specification declares: when the
 * landscape declares all of those too (the feature tag aside — the splice strips
 * it), no addition can be missing anything, and that is settled from the two
 * files' text.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import type { LoadedDoc } from "../../c4/likec4.js";
import { mergedLandscape } from "../../c4/project/staged.js";
import type { ExtendingModel } from "../../c4/splice/contract.js";
import {
  declarationLine,
  declaredVocabulary,
  undeclaredMessage,
  type SpecificationTable,
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
  /** The caller's memoised LikeC4 read, when it has one — the preview's own reason (`StagedProjectRequest.load`). */
  load?: (path: string) => Promise<LoadedDoc>;
  /** The fleet's extending models, read only when the preview runs. */
  models: () => Promise<ExtendingModel[]>;
}

const TABLES: readonly SpecificationTable[] = ["element", "relationship", "tag", "color"];

/**
 * One error per declaration the map is missing. The caller asks only of a
 * delta that parsed: an unparseable one is `delta.invalid`, and the preview
 * would refuse it for that reason alone.
 */
export async function unmergedSpecificationIssues(req: UnmergedRequest): Promise<Issue[]> {
  const deltaPath = featurePaths(req.featureDir).delta;
  const mapPath = landscapePath(req.docsDir);
  // No map, no merge: the archive says so ("no landscape.likec4 — not merged")
  // and `landscape.missing` owns the state.
  if (!existsSync(deltaPath) || !existsSync(mapPath)) return [];
  let texts: { delta: string; map: string };
  try {
    texts = { delta: await read(deltaPath), map: await read(mapPath) };
  } catch {
    // A document this cannot decode is one the preview cannot read either, and
    // the refusal for it belongs to the reader that names the encoding.
    return [];
  }
  const delta = declaredVocabulary(texts.delta);
  const map = declaredVocabulary(texts.map);
  const beyond = TABLES.some((table) =>
    [...delta[table]].some((name) => !map[table].has(name) && !(table === "tag" && name === req.featureId)),
  );
  if (!beyond) return [];

  const merged = await mergedLandscape({
    docsDir: req.docsDir,
    featureDir: req.featureDir,
    featureId: req.featureId,
    ...(req.load === undefined ? {} : { load: req.load }),
    models: await req.models(),
  });
  // On any arm: a name only a routed model lacks leaves the map previewable,
  // and the merge reports it beside the content instead of refusing.
  if (merged.missing === undefined) return [];

  const byLine = new Map<string, UndeclaredName[]>();
  for (const u of merged.missing) byLine.set(declarationLine(u), [...(byLine.get(declarationLine(u)) ?? []), u]);
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

/** A document as the preview reads it — refusing the encodings that decode as empty. */
async function read(path: string): Promise<string> {
  return decodeDocument(await readFile(path), path);
}
