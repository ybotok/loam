/**
 * Whether the model this merge would leave behind is one LikeC4 can read.
 *
 * It is here because this is the seam that HAS the other document: an extending
 * model is never parsed alone, it is parsed beside the `architecture/` project,
 * and the project the merge must be proven against is the one this very archive
 * would leave behind — the merged map, not the living one. `core/c4/splice` is
 * a pure text-to-text computation — texts in, texts out — so proving the result
 * stays with the command that decides to write.
 *
 * READING the fleet's extending models used to be here too, as the other half
 * of one seam. It moved to `core/c4/service-model/fleet/extending.ts` when the
 * archive stopped being the only reader: `core/c4/project/staged.ts` previews
 * the same merge for every feature-side gate, and `core/` may not import
 * `commands/`. That module's header carries the fail-open the move closes.
 */
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { errorText } from "../../../../core/c4/likec4.js";
import { architectureProjectDocuments } from "../../../../core/c4/project/architecture.js";
import { asLoadedDoc, loadProject } from "../../../../core/c4/project/load.js";
import type { DocsDir } from "../../../../core/kernel/ids/dirs.js";
import { repoPath } from "../../../../core/envelope/json.js";
import { landscapePath } from "../../../../core/repo/paths.js";

export interface ModelProof {
  docsDir: DocsDir;
  /** The merged landscape, or null when this archive leaves the map as it is. */
  landscape: string | null;
  /** The merged model: repo-relative path, and the text the archive would write. */
  model: { path: string; content: string };
}

/**
 * What LikeC4 says about the model this merge would leave, read the way the
 * per-service grade reads it — the `architecture/` project plus this one file.
 *
 * Empty means clean. Anything else refuses the archive at plan time, with
 * nothing written, for the reason the landscape's own parse net exists:
 * splicing is text surgery, and a document that does not parse takes a whole
 * service's grade down (`c4.invalid`) the moment it lands.
 *
 * Errors carry the path the author wrote rather than the staged copy's, and a
 * staging failure is reported as an error rather than swallowed: a merge that
 * could not be proven is not one that passed.
 */
export async function modelMergeErrors(proof: ModelProof): Promise<string[]> {
  const { docsDir, landscape, model } = proof;
  let root: string | undefined;
  try {
    root = await mkdtemp(join(tmpdir(), "loam-model-merge-"));
    const map = resolve(landscapePath(docsDir));
    const authored = new Map<string, string>();
    const staged: string[] = [];
    for (const path of await architectureProjectDocuments(docsDir)) {
      const rel = repoPath(docsDir, path);
      const at =
        landscape !== null && resolve(path) === map
          ? await write(root, rel, landscape)
          : await copy(root, rel, path);
      authored.set(at, rel);
      staged.push(at);
    }
    const at = await write(root, model.path, model.content);
    authored.set(at, model.path);
    staged.push(at);
    const doc = asLoadedDoc(await loadProject(root, staged));
    return doc.errors.map((e) => {
      const where = e.sourceFsPath === undefined ? undefined : authored.get(resolve(e.sourceFsPath));
      return where === undefined ? errorText(e) : `${where} ${errorText(e)}`;
    });
  } catch (err) {
    return [err instanceof Error ? err.message : String(err)];
  } finally {
    if (root !== undefined) await rm(root, { recursive: true, force: true });
  }
}

/** Mirror one authored document into the staged tree at its docs-relative path. */
async function copy(root: string, rel: string, path: string): Promise<string> {
  const dest = join(root, ...rel.split("/"));
  await mkdir(dirname(dest), { recursive: true });
  await copyFile(path, dest);
  return resolve(dest);
}

/** The same for bytes loam holds rather than a file — the merge previews. */
async function write(root: string, rel: string, content: string): Promise<string> {
  const dest = join(root, ...rel.split("/"));
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, content, "utf8");
  return resolve(dest);
}
