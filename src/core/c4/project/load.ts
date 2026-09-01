/**
 * One directory of `.likec4` documents, loaded as ONE LikeC4 project — the way
 * the renderer already reads `architecture/`.
 *
 * A package of its own rather than more of `../workspace.ts`, and the seam is
 * the isolation rule, not the line count. That module stages every document as
 * its own single-file project ON PURPOSE, so an author-written `import` can
 * never resolve against a sibling; this one does the opposite deliberately, for
 * the set of documents that are meant to see each other. Two loaders with
 * opposite contracts should not share a file: the next reader has to be able to
 * tell at a glance which one they are looking at.
 */
import { randomBytes } from "node:crypto";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { LikeC4 } from "likec4";
import { inOrder } from "../../kernel/concurrency.js";
import { flattenModel, type Elem, type LikeC4Error, type LoadedDoc, type ReadableModel, type Rel } from "../likec4.js";
import { readDynamicViews, type ParsedView } from "../parsed/dynamic-views.js";
import { readSpecification, type DocSpecification } from "../parsed/specification.js";
import { readViewIds, type ViewIdClaim } from "../parsed/view-ids.js";
import { readDeployment, NO_DEPLOYMENT, type DeploymentModel } from "../parsed/deployment.js";

/** A directory of `.likec4` documents loaded as one LikeC4 project. */
export interface ProjectDoc {
  /** Errors by the REAL absolute path of the document that raised them. */
  errors: Map<string, LikeC4Error[]>;
  /** True when no document in the project raised one — loam's "errors mean no model" gate. */
  clean: boolean;
  elements: Elem[];
  relationships: Rel[];
  specification?: DocSpecification;
  /** Every dynamic view the project declares, each carrying the file it is written in. */
  views: ParsedView[];
  /** Every authored view id the project claims, each with its file. */
  viewIds: ViewIdClaim[];
  /** The project's deployment model — empty when it declares none, and when it did not parse. */
  deployment: DeploymentModel;
}

/**
 * Stage a set of documents as ONE project, mirroring their paths relative to
 * `base`.
 *
 * The relative structure is preserved rather than flattened to basenames, and
 * that is load-bearing twice over: two use cases named `checkout.likec4` in
 * different subdirectories would overwrite each other on copy, and LikeC4
 * reports a view's `sourcePath` relative to the project root — so flattening
 * would make every finding name a file the author cannot find.
 */
async function stageProject(root: string, base: string, targets: string[]): Promise<Map<string, string>> {
  const project = `arch_${randomBytes(8).toString("hex")}`;
  const folder = join(root, project);
  await mkdir(folder, { recursive: true });
  await writeFile(join(folder, "likec4.config.json"), JSON.stringify({ name: project }), "utf8");
  // rel -> real path, so an error carrying the staged path can be handed back
  // spelled the way the author wrote it.
  const byRel = new Map<string, string>();
  await inOrder(targets, async (path) => {
    const rel = relative(base, path).split(/[\\/]/).join("/");
    const dest = join(folder, ...rel.split("/"));
    try {
      await mkdir(dirname(dest), { recursive: true });
      await copyFile(path, dest);
      byRel.set(rel, path);
    } catch {
      // Dropped, exactly as `stage` drops one: the caller's ordinary per-path
      // load owns the error, and a project missing one document still answers
      // about the rest.
    }
    return null;
  });
  return byRel;
}

/**
 * Load a directory of `.likec4` documents as ONE LikeC4 project — the way the
 * renderer already reads `architecture/`, and the only way a document that
 * declares views over ANOTHER file's elements can be read at all.
 *
 * Measured at the 1.59.2 pin: a views-only `usecases/checkout.likec4` parsed
 * alone is five errors (unresolved tag, unresolved elements); the same file
 * beside its landscape in one project is zero, and each view comes back with
 * its own `sourcePath`. That is the whole reason this function exists — a use
 * case lives in a file of its own, and `loadBatch`'s one-project-per-document
 * isolation makes such a file unreadable by construction.
 *
 * Two rules the caller must know, because both invert what holds elsewhere:
 *
 *  - **Exactly one document in the set declares the `specification` block.**
 *    Every `.likec4` file loam parses alone must declare its own; inside one
 *    project a second declaration is a duplicate error blamed on BOTH files
 *    (measured).
 *  - **Errors are per document, but the MODEL is all-or-nothing.** A typo in
 *    one file is attributed to that file — so the finding names it, which is
 *    better than today, where a use case in the landscape would blame the
 *    landscape — but loam's standing rule is that errors mean no model, and
 *    here the model is the project's. `clean` says which case the caller is in.
 *
 * The generated `architecture/subsystems.likec4` must NOT be in `targets`:
 * docs/DESIGN.md rule 26 keeps it a byte compare, and a stale one whose
 * `include` names a removed element would otherwise be a parse error that
 * blanks the whole fleet map.
 */
export async function loadProject(base: string, paths: string[]): Promise<ProjectDoc> {
  const empty = (errors: Map<string, LikeC4Error[]>, clean: boolean): ProjectDoc => ({
    errors,
    clean,
    elements: [],
    relationships: [],
    views: [],
    viewIds: [],
    deployment: NO_DEPLOYMENT,
  });
  const targets = [...new Set(paths.map((path) => resolve(path)))];
  if (targets.length === 0) return empty(new Map(), true);
  const root = await mkdtemp(join(tmpdir(), "loam-c4-"));
  try {
    const byRel = await stageProject(root, resolve(base), targets);
    if (byRel.size === 0) return empty(new Map(), true);
    const likec4 = await LikeC4.fromWorkspace(root, { logger: false });
    try {
      const errors = groupProjectErrors(likec4, byRel);
      if (errors.size > 0) return empty(errors, false);
      const model = (await likec4.parsedModel()) as ReadableModel;
      return {
        errors,
        clean: true,
        specification: readSpecification(model.specification),
        views: readDynamicViews(model),
        viewIds: readViewIds(model),
        deployment: readDeployment(model),
        ...flattenModel(model),
      };
    } finally {
      await likec4.dispose();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

/**
 * `getErrors()` split per DOCUMENT inside one project, each error's
 * `sourceFsPath` rewritten to the document's real absolute path.
 *
 * `groupErrors` above keys on the project folder segment, which cannot work
 * here — every document shares one project. This keys on the staged relative
 * path instead, longest first so `usecases/checkout.likec4` is matched before a
 * hypothetical `checkout.likec4` at the root. An error nobody can attribute
 * throws for the same reason it does there: a dropped error grades its document
 * clean, which is failing open in the fleet gate.
 */
function groupProjectErrors(likec4: LikeC4, byRel: Map<string, string>): Map<string, LikeC4Error[]> {
  const rels = [...byRel.keys()].sort((a, b) => b.length - a.length);
  const grouped = new Map<string, LikeC4Error[]>();
  for (const err of likec4.getErrors()) {
    const spelled = err.sourceFsPath.split(/[\\/]/).join("/");
    const rel = rels.find((candidate) => spelled.endsWith(`/${candidate}`) || spelled === candidate);
    if (rel === undefined) {
      throw new Error(`unattributable LikeC4 error in project workspace: ${err.message}`);
    }
    const real = byRel.get(rel)!;
    const list = grouped.get(real) ?? [];
    list.push({ ...err, sourceFsPath: real });
    grouped.set(real, list);
  }
  return grouped;
}

/**
 * A `ProjectDoc` in the shape every existing landscape reader already takes.
 *
 * The per-file error map flattens into one list, which loses nothing: each
 * error still carries the real path of the document that raised it, so a
 * finding can name the file even though the list is flat. Sorted by that path
 * so a project with two broken documents reports them in a stable order —
 * `getErrors()` returns whatever order the workspace scan produced.
 *
 * The model travels only when the project is clean, which is loam's standing
 * rule (`errors mean no model`) applied at project altitude: a use-case file
 * with an unresolved element leaves the landscape unusable, and pretending
 * otherwise would grade a fleet against half a map.
 */
export function asLoadedDoc(doc: ProjectDoc): LoadedDoc {
  const errors = [...doc.errors]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .flatMap(([, list]) => list);
  if (!doc.clean) return { errors, elements: [], relationships: [] };
  return {
    errors,
    ...(doc.specification === undefined ? {} : { specification: doc.specification }),
    views: doc.views,
    viewIds: doc.viewIds,
    deployment: doc.deployment,
    elements: doc.elements,
    relationships: doc.relationships,
  };
}
