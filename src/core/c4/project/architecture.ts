/**
 * `architecture/` as ONE LikeC4 project — the docsDir-aware wrapper over the two
 * modules beside it.
 *
 * It lived in `commands/validate/fleet/load.ts` until the use-case axis grew a
 * second reader. That was the right home while `validate --all` was the only
 * caller: the command layer is where a `DocsDir` becomes paths. It stopped being
 * the right home the moment `core/usecases/fleet.ts` needed the same load —
 * `core/` may not import from `commands/` (AGENTS.md), so the choice was a second
 * copy of the two-line composition or one copy one level down. A second copy is
 * the copy that drifts, and the thing that would drift is which documents are in
 * the project: the generated `architecture/subsystems.likec4` exclusion is a
 * correctness rule (see `./documents.ts`), not a preference, and a reader that
 * forgot it would blank a fleet's whole map over a stale generated file.
 *
 * So the wrapper moved here and `validate`'s own module kept the landscape
 * CONTAINMENT — `readLandscape` / `unreadableLandscape` — which is genuinely
 * command-layer business: it is about which validate target a failed read is
 * filed against.
 */
import { join } from "node:path";
import type { LoadedDoc } from "../likec4.js";
import { architectureDocuments } from "./documents.js";
import { asLoadedDoc, loadProject } from "./load.js";
import type { DocsDir } from "../../kernel/ids/dirs.js";
import { subsystemViewsPath } from "../../repo/paths.js";

/** `<docsDir>/architecture` — the LikeC4 project root, spelled once. */
export function architectureDir(docsDir: DocsDir): string {
  return join(docsDir, "architecture");
}

/**
 * The fleet map, read as the PROJECT it actually is.
 *
 * `architecture/landscape.likec4` plus every `architecture/usecases/*.likec4`,
 * merged the way the renderer merges them — because a use case declares views
 * over the landscape's elements and does not parse standalone (measured: five
 * errors). `architectureDocuments` owns which files are in and why the
 * generated one is not.
 *
 * A fleet with no use cases loads exactly the landscape and behaves as it
 * always did, which is what keeps this a widening rather than a change.
 */
export async function loadArchitecture(docsDir: DocsDir): Promise<LoadedDoc> {
  const dir = architectureDir(docsDir);
  return asLoadedDoc(await loadProject(dir, await architectureDocuments(dir, [subsystemViewsPath(docsDir)])));
}
