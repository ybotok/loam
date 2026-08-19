/**
 * Batch loader: many self-contained `.likec4` documents through ONE
 * LikeC4/Langium workspace.
 *
 * `loadFile` pays a fresh workspace per call — ~100ms even warm — which is what
 * made `validate --all` O(documents) workspace spins (13.7s median over the
 * 120-service benchmark fixture, docs/BENCHMARKS.md). This module copies every
 * document into a mkdtemp workspace as one single-file PROJECT each (a
 * `likec4.config.json` per folder), calls `LikeC4.fromWorkspace` once, splits
 * `getErrors()` per document, and flattens each clean project through the same
 * `flattenModel` the per-file path uses. Parity — byte-identical error
 * messages/lines and identical elements/relationships — is pinned by
 * test/likec4-batch-parity.test.ts, which is also the tripwire for the exact
 * likec4 version pin: multi-project workspaces are public API, but this use of
 * them is not documented, so an upgrade must fail that suite before it lands.
 *
 * Isolation is load-bearing, not cosmetic: `fromSource` gives each document a
 * workspace of its own, so an author-written `import ... from 'name'` can never
 * resolve. In a shared workspace it COULD — a sibling project is one lucky name
 * away — so every folder carries one crypto-random per-invocation hex token in
 * its project name. A document cannot import what it cannot name, and the
 * parity suite pins that a guessed sibling name errors identically in both
 * modes.
 *
 * Callers own the failure story: a document that cannot be staged (unreadable,
 * missing) is silently DROPPED from the result so the caller's ordinary
 * per-path load reproduces today's error, and a batch-infrastructure failure
 * (tmpdir denied — the sandboxed-runner class ROADMAP documents) rejects the
 * whole call for the caller to catch and degrade. FleetContext.prefetchLikeC4
 * does exactly that: findings can never change because a workspace could not be
 * created, only the speed can.
 *
 * This file takes core/c4/ to exactly five files — the package is at its limit;
 * the next addition must open a subdirectory seam.
 */
import { randomBytes } from "node:crypto";
import { inOrder } from "../kernel/concurrency.js";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { LikeC4 } from "likec4";
import { flattenModel, type LikeC4Error, type LoadedDoc, type ReadableModel } from "./likec4.js";

/** A staged document: the real path it came from, and its workspace project. */
interface StagedDoc {
  path: string;
  project: string;
}

/**
 * Stage every readable document as its own single-file project. A copy failure
 * removes the half-made folder and drops the path — an empty project must not
 * reach the workspace scan, and the caller's per-path load owns the error. The
 * copy is `copyFile` (raw bytes), not read/decode/write: BOM, CRLF and even
 * non-UTF-8 bytes reach LikeC4's own reader exactly as they would from the
 * original file on disk.
 */
async function stage(root: string, targets: string[]): Promise<StagedDoc[]> {
  const token = randomBytes(8).toString("hex");
  // Concurrent, capped, in input order (kernel/concurrency's contract): the
  // per-document folders share nothing, and on a network-mounted docs repo
  // the sequential form paid three round-trips per document. Nulls mark the
  // drops so indices — and with them the p<i> project names — stay aligned.
  const results = await inOrder([...targets.entries()], async ([i, path]) => {
    const project = `p${i}_${token}`;
    const folder = join(root, project);
    try {
      await mkdir(folder);
      await writeFile(join(folder, "likec4.config.json"), JSON.stringify({ name: project }), "utf8");
      await copyFile(path, join(folder, basename(path)));
      return { path, project };
    } catch {
      await rm(folder, { recursive: true, force: true });
      return null;
    }
  });
  return results.filter((r): r is StagedDoc => r !== null);
}

/**
 * `getErrors()` split per document, each error's `sourceFsPath` rewritten from
 * the workspace copy to the document's real absolute path.
 *
 * Grouping keys on the unique `p<i>_<token>` path SEGMENT, never on a
 * tmp-root prefix compare: darwin hands back realpathed workspace paths
 * (`/var/...` becomes `/private/var/...`) in some environments and the literal
 * mkdtemp path in others, and a prefix compare silently attributes every error
 * to nobody in exactly one of those two worlds. The segment survives both.
 */
function groupErrors(likec4: LikeC4, staged: StagedDoc[]): Map<string, LikeC4Error[]> {
  const pathOf = new Map(staged.map((doc) => [doc.project, doc.path]));
  const grouped = new Map<string, LikeC4Error[]>();
  for (const err of likec4.getErrors()) {
    const project = err.sourceFsPath.split(/[\\/]/).find((segment) => pathOf.has(segment));
    if (project === undefined) {
      // An error this walk cannot attribute would otherwise be DROPPED — and a
      // dropped error grades its document clean, which is failing open in the
      // fleet gate. Unreachable at the pinned likec4 version (every corpus
      // error carries its project folder in sourceFsPath), so the one place a
      // dependency upgrade could break the attribution is the one place that
      // must reject the whole batch: the caller degrades to per-path loads,
      // where the error reappears.
      throw new Error(`unattributable LikeC4 error in batch workspace: ${err.message}`);
    }
    const list = grouped.get(project) ?? [];
    list.push({ ...err, sourceFsPath: pathOf.get(project) });
    grouped.set(project, list);
  }
  return grouped;
}

/**
 * Load and validate many self-contained `.likec4` documents in one workspace.
 * Returns `resolve(path)` → LoadedDoc; paths are deduped through the same
 * resolution, and a path that could not be staged is absent from the result.
 *
 * A document with errors keeps `loadSource`'s exact rule — empty elements and
 * relationships, WITHOUT calling `parsedModel`: the parsed stage succeeds even
 * over unresolved references, so the "errors mean no model" boundary is loam's
 * to apply, not LikeC4's. A clean document is flattened from
 * `parsedModel(project)` — parsed, never computed: the computed stage builds
 * every VIEW, which loam renders nowhere and which is superlinear in edge
 * count (see loadSource).
 */
export async function loadBatch(paths: string[]): Promise<Map<string, LoadedDoc>> {
  const targets = [...new Set(paths.map((path) => resolve(path)))];
  const out = new Map<string, LoadedDoc>();
  if (targets.length === 0) return out;
  const root = await mkdtemp(join(tmpdir(), "loam-c4-"));
  try {
    const staged = await stage(root, targets);
    if (staged.length === 0) return out;
    // One workspace for the whole batch — the entire point. The logger is
    // disabled exactly as in loadSource: diagnostics are returned per document,
    // not written out-of-band to stderr (core never prints).
    const likec4 = await LikeC4.fromWorkspace(root, { logger: false });
    try {
      const grouped = groupErrors(likec4, staged);
      for (const { path, project } of staged) {
        const errors = grouped.get(project) ?? [];
        if (errors.length > 0) {
          out.set(path, { errors, elements: [], relationships: [] });
        } else {
          const model = (await likec4.parsedModel(project)) as ReadableModel;
          out.set(path, { errors, ...flattenModel(model) });
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
