/**
 * The flows a service's LIVING project declares, each with the file it sits
 * in — read the way `loam validate --service` reads them (`../../service/flows.ts`),
 * and only when a byte scan says one of them could carry the tag in question.
 *
 * Two readers ask, and both ask the same question of the same project: does a
 * living flow claim a requirement this feature changes? `../modified.ts` names
 * such a flow (`usecase.requirement-modified`, and the removal's
 * `usecase.requirement-unresolved`); `overwrites` in `./grade.ts` lets a feature replace or
 * retire a living flow only when every promise it claims is one the feature
 * changes. It was `../modified.ts`'s own walk
 * until the second reader arrived, and one reading of "which flows does this
 * service declare" is what keeps the gate and the warning from disagreeing
 * about one file.
 *
 * WHAT IT COSTS. A byte scan for the tag's own spelling (`req-<slug>`) over the
 * service's documents, and a LikeC4 load only for a project one of them is in:
 * a tag name is one token, so a document without its characters cannot carry
 * it. A project that does not parse answers `null`, not a finding —
 * `validate --all` owns that answer (`usecase.flow-invalid`, `c4.invalid`), and
 * a finding about one requirement must not become a second report of a broken
 * project.
 */
import { readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { REQ_TAG_PREFIX, tagSlug } from "../../../capabilities/usecase-join.js";
import type { ParsedView } from "../../../c4/parsed/dynamic-views.js";
import { architectureDocuments } from "../../../c4/project/documents.js";
import type { ServiceModel } from "../../../c4/service-model/load.js";
import type { DocsDir } from "../../../kernel/ids/dirs.js";
import type { ServicePaths } from "../../../repo/paths.js";
import { readServiceFlows } from "../../service/flows.js";

/** One living flow beside a service's model, and the docs-relative file a reader opens. */
export interface LivingServiceFlow {
  view: ParsedView;
  file: string;
}

export interface LivingServiceFlowRequest {
  docsDir: DocsDir;
  paths: ServicePaths;
  /** The enumerated fleet, for the element→service resolver's reason (`../../fleet.ts`). */
  known: ReadonlySet<string>;
  /** A service's model, read the way its shape demands — injected, for `../overlay.ts`'s reason. */
  serviceModel: (paths: ServicePaths) => Promise<ServiceModel>;
  /** The ids whose tag spellings make the read worth paying for. */
  ids: ReadonlySet<string>;
}

/** The tag spellings that could claim one of these ids. */
export function needlesFor(ids: Iterable<string>): string[] {
  return [...new Set([...ids].map((id) => `${REQ_TAG_PREFIX}${tagSlug(id)}`))];
}

/** Does any of these documents contain one of the tag spellings at all? Unreadable fails closed, as `../../fleet.ts`'s gate does. */
export async function mentions(paths: readonly string[], needles: readonly string[]): Promise<boolean> {
  for (const path of paths) {
    try {
      const text = (await readFile(path)).toString("latin1");
      if (needles.some((needle) => text.includes(needle))) return true;
    } catch {
      return true;
    }
  }
  return false;
}

/**
 * The service's living flows, or `null` when its project cannot be read —
 * and `[]` when no document mentions any of the ids, without a load.
 */
export async function livingServiceFlows(req: LivingServiceFlowRequest): Promise<LivingServiceFlow[] | null> {
  const { paths } = req;
  if (!(await mentions(await architectureDocuments(paths.dir), needlesFor(req.ids)))) return [];
  const model = await req.serviceModel(paths);
  if (model.mapUnreadable || model.doc.errors.length > 0) return null;
  const flows = await readServiceFlows({
    paths,
    model: model.doc,
    known: req.known,
    ...(model.shape === "extending" && model.project !== null
      ? { extending: { docsDir: req.docsDir, project: model.project } }
      : {}),
  });
  if (flows.kind !== "read") return flows.kind === "none" ? [] : null;
  return flows.views.map((view) => ({
    view,
    file: relative(req.docsDir, join(paths.dir, view.sourcePath ?? "model.likec4")).split(/[\\/]/).join("/"),
  }));
}
