/**
 * Every service whose `model.likec4` EXTENDS the fleet map, with its living
 * source in hand — the list the landscape merge routes a nested addition
 * through.
 *
 * ## Why it is here and not beside the archive
 *
 * It was `commands/archive/plan/model/extending.ts`'s, beside the proof that
 * the merged model parses, and for one merge that was the right seam: reading
 * the fleet and deciding to write belong to the command, `core/c4/splice/` is a
 * pure text-to-text computation, and nothing else needed the list.
 *
 * Then the archive stopped being the only reader. `../../project/staged.ts`
 * previews the map a feature's own merge would leave, and every feature-side
 * gate rests on that preview — `usecase.flow-invalid` and
 * `deployment.doc-invalid` both refuse on it, and `--approve` reaches neither.
 * A preview computed without this list previews the WRONG map: it holds
 * interior the archive routes into `services/<…>/model.likec4`, so a
 * feature-local flow hopping to `<service-fqn>.<container>` resolved against it,
 * passed the gate, and was copied verbatim into `architecture/usecases/`, where
 * it resolves against nothing (verification 2026-09-04, review finding F8;
 * measured: `loam archive --approve` at exit 0, then `loam validate --all` with
 * one `landscape.invalid` and one `spine.landscape-invalid` per service).
 *
 * A reader in `commands/` cannot close that: `core/` may never import
 * `commands/`. Nor could it live in `../../project/` beside the staging that
 * needs it — the shape scan is `../shape.ts`, and `../` imports
 * `../../project/`, so the edge would be a package cycle
 * (`node scripts/package-graph.mjs` refuses it). So it sits one level BELOW the
 * shape scan it calls, in a package that nothing in `core/c4/` imports back:
 * `core/delta/`, `core/coherence/` and the archive all reach it, and the graph
 * stays acyclic.
 *
 * ## The shape decision is not this file's
 *
 * `../shape.ts` owns it: a model declaring an element kind is STANDALONE, is
 * parsed alone, and owns no share of the merge — the map draws its containers
 * exactly as it did before the extending shape existed. A model that cannot be
 * read is not in the list either, which is the same conservative arm the shape
 * reader takes.
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { inOrder } from "../../../kernel/concurrency.js";
import type { ExtendingModel } from "../../splice/contract.js";
import type { DocsDir } from "../../../kernel/ids/dirs.js";
import type { FleetContext } from "../../../fleet-context.js";
import { repoPath } from "../../../envelope/json.js";
import { servicePathsAt } from "../../../repo/paths.js";
import { enumeratedServices } from "../../../repo/service-target.js";
import { readModelShapes } from "../shape.js";

/**
 * The fleet's extending models, ordered by the enumeration.
 *
 * `fleet` is OPTIONAL for the reason `enumeratedServices` makes it optional:
 * the callers are three, and only two of them run inside an invocation index.
 * With one, the enumeration and the shape scan are memo hits and this costs one
 * small read per extending model; without one, the same bulk scan runs directly
 * (`readModelShapes`) and the answer is identical. What must never differ
 * between the two is the LIST — a gate that routed differently depending on
 * whether its caller happened to hold a read index would be a gate nobody could
 * reproduce.
 */
export async function extendingModels(docsDir: DocsDir, fleet?: FleetContext): Promise<ExtendingModel[]> {
  const services = await enumeratedServices(docsDir, fleet);
  if (services.length === 0) return [];
  const paths = services.map((entry) => servicePathsAt(entry.dir).model);
  const shapes = fleet === undefined ? await readModelShapes(paths) : await fleet.modelShapes(paths);
  const found = await inOrder(services, async (entry): Promise<ExtendingModel | null> => {
    const path = servicePathsAt(entry.dir).model;
    if (shapes.get(resolve(path)) !== "extending") return null;
    try {
      return { service: entry.id, path: repoPath(docsDir, path), text: await readFile(path, "utf8") };
    } catch {
      // Unreadable is not extending: the merge would be splicing into bytes it
      // never saw, and the map's arm is the honest fallback.
      return null;
    }
  });
  return found.filter((model): model is ExtendingModel => model !== null);
}
