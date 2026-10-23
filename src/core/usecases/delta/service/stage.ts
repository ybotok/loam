/**
 * A service's own LikeC4 project AS THIS FEATURE'S ARCHIVE WOULD LEAVE IT,
 * staged and parsed, with the feature's service-local flows standing in it.
 *
 * WHY THE POST-MERGE PROJECT. A flow a feature brings for a service is drawn
 * over the interior the same feature gives that service: a container
 * `delta.likec4` routes into the service's extending model, or — for a service
 * the feature creates — the model the archive writes for it. Read against the
 * LIVING project the hop names nothing and the flow is refused for arriving
 * with the change that makes it true; read against no project at all, which is
 * what happened before this module, it was not read. `../../../c4/project/staged.ts`
 * states the same argument for the fleet's flows; this is that argument one
 * project down, and the model half of the same merge preview
 * (`../../../c4/project/merge/preview.ts`, `previewMerge`) is what it stages.
 *
 * THE SET IS THE ONE `validate --service` WILL READ (`../../service/flows.ts`):
 * for an extending model, the `architecture/` project as the archive leaves it
 * — the merged map, and the feature's own fleet flows and topology documents
 * at the paths the archive writes them to — plus the model and every `.likec4`
 * beside it; for a standalone one, the service directory alone, minus what its
 * own `likec4.config.json` excludes (the feature's documents included, by the
 * path they will have). A living file this feature replaces or retires is left
 * out, so the project is the one the archive leaves, not the one it
 * overwrites; and a living sibling stays in, so a feature flow whose view id or
 * tag declaration collides with one is refused here exactly as
 * `validate --service` would refuse it after the archive.
 *
 * AND IT OPENS ONLY WHEN THAT READER WOULD. `readServiceFlows` loads no
 * workspace for a project in which nothing references a reserved tag, and an
 * untagged, broken `views.likec4` there is the renderer's business, never a
 * finding. The same gate here, over the same documents: without it a feature
 * that only retires a flow was refused over a hand-drawn diagram it never
 * touched and the fleet never grades (review, 2026-10-23).
 *
 * STAGED FROM ITS OWN ROOT, for `staged.ts`'s reason: the merged landscape and
 * the merged model exist only in memory, and a feature document is not at the
 * path it will have. The price is paths, and it is paid here: every path that
 * leaves — a view's `sourcePath`, an error's `sourceFsPath` — is the one the
 * author can open, and the temp tree is gone before this returns. A merged
 * document's error names the living file the archive would write.
 *
 * FAIL CLOSED: a throw during staging — the temp directory itself included —
 * is the `unreadable` arm, never a clean project and never a throw: the caller
 * is the archive gate, and the one behaviour it may never have is failing the
 * run, or passing one it could not read.
 */
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import type { LikeC4Error } from "../../../c4/likec4.js";
import { architectureDir, architectureProjectDocuments } from "../../../c4/project/architecture.js";
import { architectureDocuments } from "../../../c4/project/documents.js";
import { asLoadedDoc, loadProject } from "../../../c4/project/load.js";
import type { StagedDocument } from "../../../c4/project/staged.js";
import type { DocsDir } from "../../../kernel/ids/dirs.js";
import { landscapePath, type ServicePaths } from "../../../repo/paths.js";
import { isUseCase, mentionsTagPrefix } from "../../fleet.js";
import { keepIncluded, serviceProjectExclude } from "../../service/exclude.js";
import type { ServiceFlowScan } from "../../service/flows.js";
import { SERVICE_FLOW_DIR } from "./slot.js";

/** The project a service's flows are graded in once the archive lands. */
export interface ServiceStageRequest {
  docsDir: DocsDir;
  /** Where the service lives — or, for one the feature creates, where the archive puts it. */
  paths: ServicePaths;
  /**
   * The model's shape as the archive leaves it. A created model is always
   * extending (`../../../c4/service-model/created/models.ts`).
   */
  shape: "standalone" | "extending";
  /**
   * What the same archive writes besides this service's flows: the merged map
   * (null = as it stands), every model it writes (by repo path), and the
   * feature's other documents under `architecture/` (by their path there).
   */
  merged: { landscape: string | null; models: ReadonlyMap<string, string>; architecture: readonly StagedDocument[] };
  /** Absolute paths of the living flows this feature replaces or retires — left out of the project. */
  overwritten: ReadonlySet<string>;
  /** The feature's statement-bearing documents, by their path inside the slot. */
  documents: readonly { rel: string; path: string }[];
  /** The enumerated fleet, as the merge leaves it — for the resolver, as `ServiceFlowScan.model` requires. */
  known: ReadonlySet<string>;
}

/** A document to stage: a file on disk, or bytes the merge preview holds for a living path. */
type Source = { path: string } | { text: string; at: string };

/**
 * The feature's flows over the post-merge project, or the honest refusal to say.
 *
 * `read` carries the feature's reserved-tag views ONLY, each `sourcePath`
 * spelled `usecases/<rel>` — the path inside the service directory the archive
 * writes it to, which is the spelling `../../service/grade.ts` names a file by.
 * `none` is the reader's own answer for a project nothing opts into.
 */
export async function stageServiceProject(req: ServiceStageRequest): Promise<ServiceFlowScan> {
  let root: string | undefined;
  try {
    const found = await architectureDocuments(req.paths.dir, [req.paths.model]);
    const exclude = req.shape === "standalone" ? await serviceProjectExclude(req.paths.dir) : [];
    // What the RENDERER holds beside the model — `readServiceFlows`' rule, the
    // feature's documents read at the path the archive gives them.
    const siblings = keepIncluded(req.paths.dir, exclude, found).filter((path) => !req.overwritten.has(resolve(path)));
    const future = (rel: string): string => join(req.paths.dir, SERVICE_FLOW_DIR, ...rel.split("/"));
    const documents = req.documents.filter((doc) => keepIncluded(req.paths.dir, exclude, [future(doc.rel)]).length === 1);
    if (!(await mentionsTagPrefix([req.paths.model, ...siblings, ...documents.map((d) => d.path)].filter(onDisk(req))))) {
      return { kind: "none" };
    }

    root = await mkdtemp(join(tmpdir(), "loam-service-flows-"));
    // Staged absolute path -> the path the AUTHOR can open; built as the tree is
    // staged, the one moment both spellings are in hand.
    const authored = new Map<string, string>();
    const staged: string[] = [];
    const tree = root;
    const put = async (rel: string, from: Source): Promise<void> => {
      const dest = resolve(tree, ...rel.split("/"));
      if (authored.has(dest)) return;
      await mkdir(dirname(dest), { recursive: true });
      if ("path" in from) await copyFile(from.path, dest);
      else await writeFile(dest, from.text, "utf8");
      authored.set(dest, "path" in from ? resolve(from.path) : resolve(from.at));
      staged.push(dest);
    };
    const base = req.shape === "extending" ? req.docsDir : req.paths.dir;
    const rel = (path: string): string => relative(base, path).split(/[\\/]/).join("/");

    // The feature's documents FIRST, so the first-wins `put` can never let a
    // living sibling or a map document take their path.
    const mine = new Map<string, string>();
    const dirRel = req.shape === "extending" ? `${rel(req.paths.dir)}/` : "";
    for (const doc of documents) {
      const at = `${dirRel}${SERVICE_FLOW_DIR}/${doc.rel}`;
      await put(at, { path: doc.path });
      mine.set(at, `${SERVICE_FLOW_DIR}/${doc.rel}`);
    }
    if (req.shape === "extending") await stageMap(req, rel, put);
    const mergedModel = req.merged.models.get(relative(req.docsDir, req.paths.model).split(/[\\/]/).join("/"));
    await put(rel(req.paths.model), mergedModel === undefined ? { path: req.paths.model } : { text: mergedModel, at: req.paths.model });
    for (const path of siblings) await put(rel(path), { path });

    const project = await loadProject(root, staged);
    if (!project.clean) {
      const errors: LikeC4Error[] = asLoadedDoc(project).errors.map((e) =>
        e.sourceFsPath === undefined ? e : { ...e, sourceFsPath: authored.get(resolve(e.sourceFsPath)) ?? e.sourceFsPath },
      );
      return { kind: "unreadable", errors };
    }
    const views = project.views.flatMap((view) => {
      const own = view.sourcePath === undefined ? undefined : mine.get(view.sourcePath);
      return own === undefined || !isUseCase(view) ? [] : [{ ...view, sourcePath: own }];
    });
    return { kind: "read", views, model: { elements: project.elements, relationships: project.relationships, known: req.known } };
  } catch (err) {
    // A message with no document is still a hole, and it travels as one.
    return { kind: "unreadable", errors: [{ message: err instanceof Error ? err.message : String(err) }] };
  } finally {
    if (root !== undefined) await rm(root, { recursive: true, force: true });
  }
}

/** The model is on disk unless the archive is the one that creates it. */
function onDisk(req: ServiceStageRequest): (path: string) => boolean {
  return (path) => path !== req.paths.model || !req.merged.models.has(relative(req.docsDir, path).split(/[\\/]/).join("/"));
}

/**
 * The `architecture/` project an extending model is read in, as this archive
 * leaves it: the set `architectureProjectDocuments` names — so the generated
 * views files and a root `exclude` stay out exactly as they do for every other
 * reader of that project — with the merged map in place of the living one,
 * and the feature's own documents that land under `architecture/`. A feature
 * document whose path a living one already holds is refused at the gate
 * (`usecase.flow-exists`, `deployment.doc-exists`); the living copy is staged
 * first and wins here, so the map this grades against is never replaced by a
 * document the archive will not write.
 */
async function stageMap(req: ServiceStageRequest, rel: (path: string) => string, put: (rel: string, from: Source) => Promise<void>): Promise<void> {
  const map = resolve(landscapePath(req.docsDir));
  for (const path of await architectureProjectDocuments(req.docsDir)) {
    const merged = resolve(path) === map ? req.merged.landscape : null;
    await put(rel(path), merged === null ? { path } : { text: merged, at: path });
  }
  for (const doc of req.merged.architecture) {
    await put(rel(join(architectureDir(req.docsDir), ...doc.rel.split("/"))), { path: doc.path });
  }
}
