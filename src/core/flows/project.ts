/**
 * Where a fleet's journeys are STORED, and how loam reads them: every document
 * under `architecture/flows/` plus the fleet map, parsed as ONE LikeC4
 * project.
 *
 * A package beside `../c4/flows/` and not inside it, because the two answer
 * different questions and the import direction proves it: that package is what
 * a dynamic view IS once flattened (`../c4/likec4.ts` depends on it), while
 * this is which FILES a docs repo keeps journeys in and how they are loaded.
 * An edge back from there to here would be the repository's first package
 * cycle.
 *
 * ONE FILE PER JOURNEY, under `architecture/`. Both halves are forced rather
 * than chosen:
 *
 *  - Under `architecture/`, because `likec4.config.json` scopes the project
 *    there and excludes `services/**` — a dynamic view stored under a service
 *    resolves only that service's own containers, so a cross-service journey
 *    resolves at fleet level or not at all. A subdirectory inherits the scope
 *    (the config carries excludes, never an include list), verified against the
 *    pinned likec4 rather than assumed.
 *  - One file per journey, because the single landscape's documented conflict
 *    trigger is exactly what a shared flows file would hit sooner: two features
 *    touching two different journeys then never meet in the same file, and git
 *    merges them without anyone arbitrating.
 *
 * ONE PROJECT, not one project per file — the difference between reading a
 * journey and refusing it. A flow document declares no model of its own: every
 * participant it names is an element the LANDSCAPE declares, and every group
 * tag is declared in a `specification` block there. Staged alone (the
 * per-document isolation `../c4/workspace.ts` insists on) each of those
 * references resolves to nothing and the document reports errors it does not
 * have. So the landscape travels with the flows, in one project folder, and the
 * isolation that matters — no document may resolve a name from OUTSIDE the
 * documents loam handed it — is kept by the crypto-random project name exactly
 * as the batch loader keeps it.
 *
 * The GENERATED `architecture/flow-groups.likec4` is deliberately not staged:
 * loam owns those bytes, nothing in loam ever parses them, and a stale
 * generated file naming a deleted element would otherwise report parse errors
 * that read as the author's.
 */
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { LikeC4 } from "likec4";
import { flattenFlows } from "../c4/flows/flatten.js";
import type { Flow } from "../c4/flows/flow.js";
import type { ReadableViews } from "../c4/flows/parsed-view.js";
import { flattenModel, type LikeC4Error, type ReadableModel } from "../c4/likec4.js";
import type { Elem } from "../c4/model/model.js";
import { repoPath } from "../envelope/json.js";
import { inOrder } from "../kernel/concurrency.js";
import type { DocsDir } from "../kernel/ids/dirs.js";
import { flowsDir, landscapePath } from "../repo/paths.js";
import { flowGroups, type FlowGroup } from "./groups.js";
import { renderFlowGroupViews } from "./views.js";

/** The fleet's flows, and the model they are drawn over, read together. */
export interface FlowProject {
  /**
   * Parse and validation errors across the staged documents, each
   * `sourceFsPath` rewritten back to the real file. Non-empty means NOTHING may
   * be concluded from `flows` — the same boundary `loadSource` applies to a
   * document with errors, for the same reason: an unresolved participant is
   * indistinguishable from a journey that touches nobody.
   */
  errors: LikeC4Error[];
  /** Every element the project declares — what a participant resolves through. */
  elements: Elem[];
  /** Every dynamic view the project declares, sorted by id. */
  flows: Flow[];
  /** The flow documents that were read, absolute, sorted by path. */
  files: string[];
}

/** An empty answer, for a docs repo that draws no journeys at all. */
const NO_FLOWS: FlowProject = { errors: [], elements: [], flows: [], files: [] };

/**
 * Every flow document a docs repo holds, under `architecture/flows/`, sorted by
 * path. One journey per file in one directory is the storage RULE — it is what
 * makes "which file do I edit" answerable from the flow's own name — but the
 * walk is what loam READS, and reading less than the renderer merges is the one
 * thing it must not do.
 */
export async function flowDocuments(docsDir: DocsDir): Promise<string[]> {
  const dir = flowsDir(docsDir);
  if (!existsSync(dir)) return [];
  const found: string[] = [];
  // Recursive, though the storage rule is one journey per file in one
  // directory: the LikeC4 renderer merges everything under `architecture/`, so
  // a document loam declined to walk into would be a suite the renderer draws
  // and loam has decided not to see — the same divergence the extension list
  // below exists to close, reached by a different route.
  const walk = async (at: string): Promise<void> => {
    for (const entry of await readdir(at, { withFileTypes: true })) {
      const path = join(at, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile() && LIKEC4_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) found.push(path);
    }
  };
  await walk(dir);
  return found.sort();
}

/**
 * Both extensions LikeC4 itself reads, verified against the pinned version —
 * and reading only loam's own `.likec4` spelling would be a silent divergence,
 * not a stricter rule: the renderer merges the whole `architecture/` project,
 * so a `checkout.c4` beside the others really IS a flow of this fleet, and loam
 * ignoring it would report the generated views file stale (or absent) against
 * groups it had decided not to see.
 */
const LIKEC4_EXTENSIONS = [".likec4", ".c4"];

/**
 * Read the fleet's flows: every dynamic view the `architecture/` project
 * declares, whichever of its documents declares it.
 *
 * The fleet map is staged WITH the flow documents — it has to be, or their
 * participants resolve to nothing — so its own `views { ... }` block is part of
 * the answer, and that is the only answer that stays stable. Reading the flow
 * directory alone would make a journey drawn in the landscape visible exactly
 * when some unrelated file happened to sit under `flows/`, and deleting that
 * unrelated file would then take the landscape journey's group view with it.
 */
export async function loadFlowProject(docsDir: DocsDir, known?: string[]): Promise<FlowProject> {
  const files = known ?? (await flowDocuments(docsDir));
  const landscape = landscapePath(docsDir);
  const paths = existsSync(landscape) ? [landscape, ...files] : files;
  if (paths.length === 0) return NO_FLOWS;
  return { ...(await parseFlowDocuments(paths.map((path) => ({ path })))), files };
}

/** One document to stage: a file, or the text a caller proposes to put in it. */
export interface FlowDocument {
  path: string;
  /**
   * The bytes to parse INSTEAD of the file's, when the caller is asking about
   * a document that does not exist yet. `archive`'s view merge is the reason:
   * it must know whether the `architecture/` project still parses with its
   * merge applied BEFORE it writes a byte of it, which is the same parse net
   * `../c4/splice/landscape-merge.ts` throws over the merged fleet map.
   */
  text?: string;
}

/**
 * Parse a proposed set of documents as one project, in a workspace of this
 * invocation's own. The only caller that needs it directly is a merge asking
 * "would this still parse"; everything else goes through `loadFlowProject`.
 */
export async function parseFlowDocuments(documents: FlowDocument[]): Promise<Omit<FlowProject, "files">> {
  const root = await mkdtemp(join(tmpdir(), "loam-flows-"));
  try {
    return await parseProject(root, documents);
  } finally {
    // The workspace is this invocation's alone; nothing else may observe it. A
    // kill before this line can strand a loam-flows-* dir in the OS tmpdir —
    // never in the docs repo — exactly as the batch loader accepts.
    await rm(root, { recursive: true, force: true });
  }
}

/**
 * The whole flow answer a caller acts on: the documents, the groups they
 * declare, and the bytes the generated views file must therefore hold.
 *
 * One function rather than three call sites composing the same three steps,
 * for the reason `subsystem sync` and its staleness check share theirs: a
 * second spelling of "what should the views say" is a second chance for the
 * regenerator and the check that grades it to disagree, and the disagreement
 * would present as a fleet that cannot be made green by running the command
 * the finding names.
 */
export interface FlowState extends FlowProject {
  /** Every group the flows declare, sorted by name. Empty whenever `errors` is not. */
  groups: FlowGroup[];
  /**
   * The bytes `architecture/flow-groups.likec4` must hold, or null for "must
   * be absent" — MEANINGFUL ONLY WHEN `errors` IS EMPTY, and every caller
   * gates on that first. A document that did not parse contributes no group,
   * so a fleet whose one flow file has a typo would otherwise compute "no
   * group anywhere" and both the check and the regenerator would conclude a
   * perfectly correct views file has to be deleted.
   */
  expected: string | null;
}

export async function readFlowState(docsDir: DocsDir, declared?: Flow[]): Promise<FlowState> {
  const files = await flowDocuments(docsDir);
  // The one shortcut, and it changes no answer: with nothing under `flows/`
  // the project's flows ARE the fleet map's own views, and a caller that has
  // already parsed the map (`validate --all` always has) hands them in rather
  // than paying a second Langium workspace to be told the same thing. Every
  // fleet that never adopts flows keeps costing exactly what it costs today.
  const project =
    files.length === 0 && declared !== undefined
      ? { errors: [], elements: [], flows: declared, files: [] }
      : await loadFlowProject(docsDir, files);
  // Nothing may be derived from documents that did not parse — in particular
  // not "no flow declares a group", which is what would make the regenerator
  // DELETE a views file that is perfectly correct.
  const groups = project.errors.length > 0 ? [] : flowGroups(project.flows);
  return { ...project, groups, expected: project.errors.length > 0 ? null : renderFlowGroupViews(groups) };
}

/** What one staged document is: its copy's basename, and the file it came from. */
interface StagedDoc {
  staged: string;
  path: string;
}

/**
 * Copy every document into one project folder and parse it.
 *
 * The staged basename carries the document's INDEX (`0-landscape.likec4`)
 * because two flow files may share a name with the landscape or with each other
 * once a subdirectory is ever allowed, and a copy silently overwriting another
 * would drop a journey without an error anywhere.
 */
async function parseProject(root: string, documents: FlowDocument[]): Promise<Omit<FlowProject, "files">> {
  const project = `flows_${randomBytes(8).toString("hex")}`;
  const folder = join(root, project);
  await mkdir(folder);
  await writeFile(join(folder, "likec4.config.json"), JSON.stringify({ name: project }), "utf8");
  // Concurrent, capped, in input order (kernel/concurrency's contract), the way
  // the batch loader stages its own documents: the copies share nothing, and on
  // a network-mounted docs repo the sequential form pays a round-trip each.
  // Raw bytes, never read/decode/write: BOM, CRLF and even non-UTF-8 bytes
  // reach LikeC4's own reader exactly as they would from the original file.
  // A document carrying its own `text` is one the caller PROPOSES rather than
  // one on disk, and it is written as UTF-8 — the encoding the merge that
  // composed it already decoded through.
  const staged: StagedDoc[] = await inOrder([...documents.entries()], async ([i, doc]) => {
    const name = `${i}-${basename(doc.path)}`;
    const at = join(folder, name);
    if (doc.text === undefined) await copyFile(doc.path, at);
    else await writeFile(at, doc.text, "utf8");
    return { staged: name, path: doc.path };
  });
  const likec4 = await LikeC4.fromWorkspace(root, { logger: false });
  try {
    const errors = attribute(likec4.getErrors(), staged);
    // A document with errors yields no model, and the parsed stage would
    // happily produce one over unresolved references — the "errors mean no
    // model" boundary is loam's to apply, not LikeC4's (see `loadSource`).
    if (errors.length > 0) return { errors, elements: [], flows: [] };
    const model = (await likec4.parsedModel(project)) as ReadableModel & ReadableViews;
    const { elements, relationships } = flattenModel(model);
    return { errors, elements, flows: flattenFlows(model, relationships) };
  } finally {
    await likec4.dispose();
  }
}

/**
 * Every error, with its workspace copy's path rewritten to the real document.
 *
 * Matched on the staged BASENAME rather than on a tmp-root prefix compare:
 * darwin hands back realpathed workspace paths (`/var/...` becoming
 * `/private/var/...`) in some environments and the literal mkdtemp path in
 * others, and a prefix compare silently attributes every error to nobody in
 * exactly one of those two worlds.
 *
 * An error this walk cannot attribute keeps its own path rather than being
 * dropped: a dropped error grades the flows clean, which is failing open in the
 * fleet gate, and the message alone is still enough to act on.
 */
function attribute(errors: LikeC4Error[], staged: StagedDoc[]): LikeC4Error[] {
  const pathOf = new Map(staged.map((doc) => [doc.staged, doc.path]));
  return errors.map((err) => {
    const name = err.sourceFsPath?.split(/[\\/]/).findLast((segment) => pathOf.has(segment));
    return name === undefined ? err : { ...err, sourceFsPath: pathOf.get(name) };
  });
}

/**
 * One parse error as a reader has to see it: the document, then the line, then
 * the message. Spelled once because three callers report these — the finding's
 * `details`, and both `loam flow` refusals — and a reader told to "fix the
 * document the details name" has to be given the document. `attribute` above is
 * what makes the path available; dropping it at the last step would waste the
 * one thing this module works to know.
 */
export function flowErrorLine(docsDir: DocsDir, err: LikeC4Error): string {
  const where = err.sourceFsPath === undefined ? "" : `${repoPath(docsDir, err.sourceFsPath)} `;
  const line = typeof err.line === "number" ? `L${err.line}: ` : "";
  return `${where}${line}${err.message}`;
}
