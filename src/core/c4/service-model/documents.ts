/**
 * Which documents a service model is parsed WITH.
 *
 * An extending model declares no element kinds and names the map's elements
 * directly (`extend marketplace.orderService { … }`, an edge to
 * `kafka.orderEvents`), so the set it parses in is not a directory — it is the
 * fleet map's project plus this one file. Measured at the 1.59.2 pin: staged
 * that way the model parses, its containers land under the landscape's element,
 * and every parse error is attributed to `services/<svc>/model.likec4` with a
 * line of its own — including a missing kind, which is ONE error on the model
 * rather than a cascade on the map.
 *
 * Two sets, because two questions are asked of a model. The first is what the
 * model itself says (`modelProjectDocuments`); the second adds every `.likec4`
 * sitting beside it, which is how a service's own use cases are read — a flow
 * file declares views over the model's containers and does not parse alone, the
 * same reason `../project/load.ts` exists at fleet altitude.
 *
 * A CONTRACT ON THE CALLER, since neither function stages anything itself:
 * both sets must be loaded with `base` = the DOCS ROOT, never `architecture/`
 * or the service directory. LikeC4 reports a view's `sourcePath` relative to
 * the project root, so mirroring from the docs root is what makes a view come
 * back spelled `services/<tree>/model.likec4` — the spelling `./load.ts`
 * filters the model's own views by, and the spelling a person reads in a
 * finding. Staged from anywhere else the filter matches nothing and every
 * service reports that it declares no views.
 */
import type { DocsDir } from "../../kernel/ids/dirs.js";
import type { ServicePaths } from "../../repo/paths.js";
import { architectureProjectDocuments } from "../project/architecture.js";
import { architectureDocuments } from "../project/documents.js";

/**
 * The fleet map's project, plus one service model: the set an extending model
 * is graded in.
 *
 * The model is appended rather than merged in through a walk, because it is
 * named — not everything under `services/<tree>/` belongs in this project, and
 * in particular a sibling use-case file does not: it is read separately (see
 * below) so that a broken flow cannot blank the model that the whole service
 * target is graded against.
 */
export async function modelProjectDocuments(docsDir: DocsDir, modelPath: string): Promise<string[]> {
  const sets = await modelProjectSets(docsDir, [modelPath]);
  // One set in, one set out — spelled as a flatMap rather than an index so the
  // empty case is impossible rather than asserted away.
  return sets.flatMap((set) => set.paths);
}

/**
 * The same set for MANY models, with exactly ONE walk of `architecture/`
 * between them.
 *
 * The fleet's prefetch stages one project per extending model, and asking the
 * single-model form above per service would readdir the map's directory once
 * per service — 56 walks of the same tree on the 56-service shape this axis was
 * measured against, for one answer that cannot differ between them.
 */
export async function modelProjectSets(
  docsDir: DocsDir,
  models: readonly string[],
): Promise<{ model: string; paths: string[] }[]> {
  const architecture = await architectureProjectDocuments(docsDir);
  return models.map((model) => ({ model, paths: [...architecture, model] }));
}

/**
 * The same set plus every OTHER `.likec4` under the service's own directory —
 * the project a service's use cases are declared in.
 *
 * `architectureDocuments` is the walk in both cases (it is "every `.likec4`
 * under a directory, sorted, minus a skip list", and the name is about where it
 * first ran rather than about `architecture/`), skipping the model so the
 * concatenation cannot list it twice: a document staged twice at one relative
 * path is one file, but the second copy would overwrite the first and the
 * ordering would decide which — a coin flip loam must not build on.
 */
export async function serviceFlowDocuments(docsDir: DocsDir, paths: ServicePaths): Promise<string[]> {
  const siblings = await architectureDocuments(paths.dir, [paths.model]);
  return [...(await modelProjectDocuments(docsDir, paths.model)), ...siblings];
}
