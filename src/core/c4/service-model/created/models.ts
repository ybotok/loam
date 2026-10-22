/**
 * The model of every service a feature's archive CREATES — one the feature
 * carries `specs/<svc>/` for, the fleet does not enumerate, and the map the
 * merge leaves will draw — as the EMPTY extending model the archive writes
 * beside its first documents.
 *
 * Drawn by the merged map, because the model extends the element that stands
 * for the service there, and only a service the map draws has one: the living
 * map's elements plus the delta's TAGGED ones, which is exactly what the map
 * holds once the merge lands. A context element the delta quotes is merged
 * nowhere, and counting it gave a model to a service nothing would draw — two
 * `landscape.service-unmodelled` on the next `validate --all` (review,
 * 2026-10-22). A `specs/<svc>/` nothing draws is, more often than not, a typo
 * the gate already calls an unknown service; forced through with `--approve`,
 * writing a model there would fabricate a service directory out of it, which
 * the spec merge is careful never to do (it creates no empty living spec
 * either).
 *
 * ## Why the archive writes it
 *
 * It used to leave the file out and say so (`service.no-model`, an error the
 * next `validate --all` repeated), because writing a container model would have
 * been inventing one. An EMPTY extending model invents nothing: LikeC4 reads it
 * as the map's own box with nothing drawn inside, and SCHEMA.md calls an empty
 * file a legal extending model. What it changes is real. The new service's first
 * `validate --all` grades it instead of stopping at a missing file, and the
 * interior a delta draws inside the new service lands in the model — routed like
 * any extending model's — where until now it rode onto the map, because no model
 * existed to own it, and stayed there as interior the map is not supposed to
 * hold. A team that pre-placed an empty model got exactly this (measured on a
 * real fleet, 2026-10); now nobody has to know to. SCHEMA.md, "Which document an
 * addition lands in", records the decision.
 *
 * ## Why it is not beside the archive
 *
 * Two readers, and they must agree. `loam archive` writes these models; the
 * merge PREVIEW every feature-side gate grades against (`../../project/staged.ts`)
 * has to route the new service's interior the same way, or a feature flow
 * hopping to `<new-service-fqn>.<container>` resolves in the preview, passes the
 * gate, and lands in `architecture/usecases/` naming a container the map no
 * longer holds — the outcome the fleet-model list beside this
 * (`../fleet/extending.ts`) exists to prevent. That list could not host this
 * either: `../fleet/` reads the shape scan, which imports `../../project/`, so
 * the preview importing it would be a package cycle. The one part of `core/c4/`
 * this package imports as a value is `../../resolve/`, the binding join, which
 * imports neither the shape scan nor the project.
 *
 * ## Unfiled, always
 *
 * The path is `services/<svc>/`, the spelling the spec merges write a new
 * service's documents to. The archive never reads a subsystem off the map's
 * group nesting or off a delta's metadata — the tree and the map stay
 * independent — so a new service lands in a subsystem only when its directory is
 * already there, and then it is enumerated and not created here at all.
 */
import { existsSync } from "node:fs";
import type { Elem } from "../../likec4.js";
import { elementService } from "../../resolve/service.js";
import type { ExtendingModel } from "../../splice/contract.js";
import type { FleetContext } from "../../../fleet-context.js";
import type { DocsDir, FeatureDir } from "../../../kernel/ids/dirs.js";
import { parseServiceId } from "../../../kernel/ids/service.js";
import { repoPath } from "../../../envelope/json.js";
import { unfiledServicePaths } from "../../../repo/paths.js";
import { featureSpecServices } from "../../../repo/repo.js";
import { enumeratedServiceIds } from "../../../repo/service-target.js";

export interface CreatedModelsRequest {
  docsDir: DocsDir;
  featureDir: FeatureDir;
  /** The feature the header names as the model's origin. */
  featureId: string;
  /** The elements the map holds once the merge lands: the living map's, and the delta's tagged ones. */
  drawn: readonly Elem[];
  fleet?: FleetContext;
}

export async function createdServiceModels(req: CreatedModelsRequest): Promise<ExtendingModel[]> {
  const enumerated = new Set<string>(await enumeratedServiceIds(req.docsDir, req.fleet));
  // Binding first, title as the fallback: the join every check resolves an
  // element to its directory through.
  const drawn = new Set<string>(req.drawn.map((e) => elementService(e)));
  const models: ExtendingModel[] = [];
  for (const raw of await featureSpecServices(req.featureDir, req.fleet)) {
    // An id the service grammar refuses never reaches a path; the gate refuses
    // the feature for it before an archive is planned.
    const parsed = parseServiceId(raw);
    if (!parsed.ok || enumerated.has(parsed.id) || !drawn.has(parsed.id)) continue;
    const paths = unfiledServicePaths(req.docsDir, parsed.id);
    if (existsSync(paths.model)) continue;
    models.push({ service: parsed.id, path: repoPath(req.docsDir, paths.model), text: emptyModel(parsed.id, req.featureId) });
  }
  return models;
}

/** The model a created service starts with: a header saying what the file is for, and an empty `model { }`. */
function emptyModel(svc: string, featureId: string): string {
  return [
    `// ${svc}'s own C4 — what is inside the element the fleet map binds to this`,
    `// directory. \`loam archive ${featureId}\` created it with the service, holding`,
    `// only what that feature's delta drew inside it. It EXTENDS the map: it declares`,
    `// no kinds and no partners, and draws the service's containers inside an`,
    "// `extend <fqn> { … }` block, <fqn> being that element's fully-qualified id.",
    `// SCHEMA.md, "Two shapes of a service model".`,
    "model {",
    "}",
    "",
  ].join("\n");
}
