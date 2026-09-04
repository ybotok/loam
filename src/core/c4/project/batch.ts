/**
 * Many PROJECTS — each a directory-shaped set of documents that must see each
 * other — through ONE LikeC4 workspace.
 *
 * The third loader, and the seam is the same one that already separates the
 * two beside it: `../workspace.ts` batches N documents as N isolated
 * single-file projects, `./load.ts` loads ONE project of N documents, and this
 * loads N projects of N documents each. The shape exists because a service
 * model that EXTENDS the fleet map is only readable beside the map (measured:
 * an `extend <fqn> { … }` model parsed alone is every id unresolved), so a
 * fleet run that used to parse 56 models as 56 isolated documents now needs 56
 * projects — the architecture documents plus one model each. Measured at the
 * 1.59.2 pin on an example landscape with 56 generated models: 56 such projects
 * in ONE workspace take ~700 ms, while 20 SEPARATE workspaces take 2.2 s. The
 * workspace, not the parse, is what a fleet run pays for.
 *
 * Isolation is `../workspace.ts`'s rule verbatim, and for its reason: every
 * project folder is named `p<i>_<token>` with one crypto-random token per
 * invocation, so an author-written `import … from '<name>'` cannot resolve
 * against a sibling project it guessed the name of. Here the sibling projects
 * are other services' — a model importing another service's project would
 * silently grade against documents its own repo never named.
 *
 * The failure story is the caller's, exactly as it is for the other two loaders:
 * a project whose documents could not be staged at all is ABSENT from the
 * result (the caller's ordinary per-project load reproduces the error), and a
 * batch-INFRASTRUCTURE failure — tmpdir denied, the sandboxed-runner class
 * ROADMAP documents — rejects the whole call so `FleetContext` can degrade to
 * per-project loads. Findings can never change because a workspace could not be
 * created; only the speed can.
 */
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { LikeC4 } from "likec4";
import { inOrder } from "../../kernel/concurrency.js";
import type { LikeC4Error, ReadableModel } from "../likec4.js";
import {
  cleanProjectDoc,
  emptyProject,
  groupErrorsByRel,
  stageProject,
  type ProjectDoc,
} from "./load.js";

/** One project to load: the caller's key for it, the root its documents are mirrored relative to, and the documents. */
export interface ProjectRequest {
  /**
   * How the caller will look the answer up. Never derived here from a path,
   * because the caller's identity for a project is not this module's business:
   * `FleetContext` keys on the resolved `model.likec4` path, and a second
   * spelling of that key is a memo the caller can never hit.
   */
  key: string;
  /**
   * The directory the documents' relative structure is preserved against —
   * the docs root for a per-service project, which is what makes a view's
   * `sourcePath` come back spelled `services/<tree>/model.likec4`, the way the
   * renderer spells it from the same root.
   */
  base: string;
  paths: string[];
}

/** A project that reached the workspace: the caller's key, its folder name, and rel → real path. */
interface StagedProject {
  key: string;
  /** The workspace folder name — `parsedModel`'s argument AND the error-attribution segment. */
  project: string;
  byRel: Map<string, string>;
}

/**
 * Load many projects in one workspace. Returns `key` → `ProjectDoc`; a project
 * that could not be staged at all is absent from the result.
 *
 * Each project's verdict is `loadProject`'s, applied per project rather than
 * per workspace: errors mean no model, and the model here is that ONE
 * project's — a broken service model leaves the other 55 projects with their
 * models intact, which is the whole reason the fleet is staged as many projects
 * rather than as one.
 */
export async function loadProjectBatch(
  projects: readonly ProjectRequest[],
): Promise<Map<string, ProjectDoc>> {
  const out = new Map<string, ProjectDoc>();
  if (projects.length === 0) return out;
  const root = await mkdtemp(join(tmpdir(), "loam-c4-"));
  try {
    const staged = await stageAll(root, projects);
    if (staged.length === 0) return out;
    // One workspace for every project — the entire point. The logger is
    // disabled exactly as in the two loaders beside this one: diagnostics are
    // returned per document, not written out-of-band to stderr (core never
    // prints).
    const likec4 = await LikeC4.fromWorkspace(root, { logger: false });
    try {
      const byProject = groupByProject(likec4.getErrors(), new Set(staged.map((s) => s.project)));
      for (const { key, project, byRel } of staged) {
        const errors = groupErrorsByRel(byProject.get(project) ?? [], byRel);
        if (errors.size > 0) {
          out.set(key, emptyProject(errors, false));
        } else {
          out.set(key, cleanProjectDoc((await likec4.parsedModel(project)) as ReadableModel));
        }
      }
    } finally {
      await likec4.dispose();
    }
    return out;
  } finally {
    // The workspace is this invocation's alone; nothing else may observe it.
    // A kill between mkdtemp and here can strand a loam-c4-* dir in OS tmp —
    // never in the docs repo — which docs/DESIGN.md records as accepted.
    await rm(root, { recursive: true, force: true });
  }
}

/**
 * Every project staged into its own folder under `root`, in input order.
 *
 * ONE token for the whole invocation, and the index makes each name unique
 * inside it — `../workspace.ts`'s scheme exactly, so the two batch loaders
 * cannot drift into two answers about whether a sibling project is nameable.
 * A project none of whose documents could be copied is dropped rather than
 * staged empty: an empty project in the workspace would parse clean and grade a
 * service against nothing at all, where absence sends the caller back to its
 * own per-project load and today's error.
 */
async function stageAll(root: string, projects: readonly ProjectRequest[]): Promise<StagedProject[]> {
  const token = randomBytes(8).toString("hex");
  // Concurrent, capped, in input order (kernel/concurrency's contract): the
  // per-project folders share nothing, and on a network-mounted docs repo the
  // sequential form pays a round-trip per document. Nulls mark the drops so the
  // p<i> names stay tied to the caller's own ordering.
  const results = await inOrder([...projects.entries()], async ([i, req]) => {
    const project = `p${i}_${token}`;
    const targets = [...new Set(req.paths.map((path) => resolve(path)))];
    const byRel = await stageProject(root, project, resolve(req.base), targets);
    return byRel.size === 0 ? null : { key: req.key, project, byRel };
  });
  return results.filter((r): r is StagedProject => r !== null);
}

/**
 * One workspace's diagnostics split per PROJECT, keyed on the unique
 * `p<i>_<token>` path SEGMENT.
 *
 * Never a tmp-root prefix compare, for `../workspace.ts`'s measured reason:
 * darwin hands back realpathed workspace paths (`/var/…` becomes
 * `/private/var/…`) in some environments and the literal mkdtemp path in
 * others, and a prefix compare silently attributes every error to nobody in
 * exactly one of those two worlds. The segment survives both.
 *
 * An error this walk cannot attribute throws, and the whole batch with it: a
 * dropped error grades its project clean, which is failing open in the fleet
 * gate. The caller degrades to per-project loads, where the error reappears
 * against the document that raised it.
 */
function groupByProject(
  errors: readonly (LikeC4Error & { sourceFsPath: string })[],
  projects: ReadonlySet<string>,
): Map<string, (LikeC4Error & { sourceFsPath: string })[]> {
  const grouped = new Map<string, (LikeC4Error & { sourceFsPath: string })[]>();
  for (const err of errors) {
    const project = err.sourceFsPath.split(/[\\/]/).find((segment) => projects.has(segment));
    if (project === undefined) {
      throw new Error(`unattributable LikeC4 error in batch workspace: ${err.message}`);
    }
    const list = grouped.get(project) ?? [];
    list.push(err);
    grouped.set(project, list);
  }
  return grouped;
}
