/**
 * A feature's journeys, folded into the living fleet: which document each of
 * its dynamic views lands in, and what that document then says.
 *
 * The rule is REPLACE-OR-ADD, keyed on the view id, and it differs from the
 * model merge on purpose — `../c4/splice/view-splice.ts` argues why at the
 * text level. This module answers the other half, the half that needs the
 * repository: *where*.
 *
 *  - A view the living fleet already declares is replaced IN THE FILE THAT
 *    DECLARES IT, which may be `architecture/landscape.likec4` or any document
 *    under `architecture/flows/`. Moving it to loam's preferred file instead
 *    would rewrite two documents to change one view, and the second rewrite
 *    would be a deletion nobody asked for.
 *  - A view nothing declares yet is new, and lands at
 *    `architecture/flows/<view id>.likec4`. One journey per file is the
 *    storage rule the previous slice established; naming the file for the view
 *    is what makes that rule usable, since it is the only spelling that
 *    answers "which file do I edit" from the flow's own name. View ids are
 *    LikeC4 identifiers (`[A-Za-z_]\w*`), so the name needs no escaping and can
 *    hold no path separator.
 *
 * THE PARSE NET IS THE POINT OF DOING THIS BEFORE WRITING. A journey resolves
 * only against the LIVING fleet map — its participants are elements the
 * landscape declares and its group tags are tags the landscape's
 * `specification` block declares — and a delta declares its own. So a view
 * that parsed perfectly inside `delta.likec4` can be unresolvable the moment
 * it lands, and an unreadable document under `architecture/flows/` is the one
 * state `validate --all` reports alone (`flow.invalid`), suppressing the group
 * views of every journey that IS readable. The merge therefore parses the
 * whole proposed `architecture/` project and refuses at plan time, which is
 * exactly what `../c4/splice/landscape-merge.ts` does with the merged fleet
 * map, for the same reason and with the same consequence: nothing is written.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Flow } from "../c4/flows/flow.js";
import { LandscapeSpliceError } from "../c4/splice/contract.js";
import { flowDocument, replaceView, scanDynamicViews, type ViewSource } from "../c4/splice/view-splice.js";
import { repoPath } from "../envelope/json.js";
import type { DocsDir } from "../kernel/ids/dirs.js";
import { flowGroupViewsPath, flowsDir, landscapePath } from "../repo/paths.js";
import { readUtf8, sameBytes } from "../staging/writes.js";
import { flowGroups } from "./groups.js";
import { flowDocuments, flowErrorLine, parseFlowDocuments, type FlowDocument } from "./project.js";
import { renderFlowGroupViews } from "./views.js";

/** Everything the flow merge reads, as text and parsed views already in hand. */
export interface FlowMergeRequest {
  docsDir: DocsDir;
  /** delta.likec4 as authored — the bytes each view is spliced from. */
  deltaText: string;
  /** The delta's dynamic views TAGGED with the feature: the ones to merge. */
  newFlows: Flow[];
  featureId: string;
  /**
   * The fleet map as this archive will leave it — the model merge's output,
   * not the living file. A view merged beside elements the same delta adds
   * must be checked against a landscape that HAS them, or the parse net below
   * refuses every journey that names a new box.
   */
  landscapeText: string;
}

/** One view this merge lands, and where. */
export interface MergedView {
  id: string;
  /**
   * DOCS-RELATIVE path of the document it lands in — the spelling every
   * report of this uses. Relative and not absolute so the command layer has
   * nothing left to convert: an absolute path here would make the one module
   * that already knows the docs root hand the caller a value it must
   * immediately re-derive.
   */
  path: string;
  action: "replaced" | "added";
}

export interface FlowMergePlan {
  /** The fleet map as the merge leaves it — the input text unless it declares one of the views. */
  landscapeText: string;
  /** One write per document under `architecture/flows/` this merge touched, sorted by path. */
  writes: Array<{ path: string; content: string }>;
  merged: MergedView[];
  /**
   * True when this merge leaves `architecture/flow-groups.likec4` no longer
   * matching the flows. Reported rather than repaired: that file has exactly
   * one regenerator (`loam flow sync`), and archive quietly becoming a second
   * one is the ownership rule's own counter-example.
   */
  groupViewsStale: boolean;
}

export async function planFlowMerge(request: FlowMergeRequest): Promise<FlowMergePlan> {
  const { docsDir, deltaText, newFlows, featureId, landscapeText } = request;
  // The early return is what keeps a fleet that never adopts flows costing
  // exactly what it costs today: no directory walk, no decode, and above all
  // no second Langium workspace on the archive path.
  if (newFlows.length === 0) {
    return { landscapeText, writes: [], merged: [], groupViewsStale: false };
  }

  const landscape = landscapePath(docsDir);
  const files = await flowDocuments(docsDir);
  // Decoded, not raw: locating a declaration is a text question. A flow
  // document loam cannot decode is therefore one it cannot merge — `readUtf8`
  // refuses by name, and `archive` reports that as `merge-failed` with nothing
  // written, the same answer any other uncomputable merge gets.
  const texts = new Map<string, string>([[landscape, landscapeText]]);
  for (const file of files) texts.set(file, await readUtf8(file));
  /** Documents this merge composed. Everything else is copied, never rewritten. */
  const touched = new Set<string>();

  // Where each view id is declared TODAY. Built once, from the documents as
  // they stand: a replacement never changes an id, and a view this merge adds
  // cannot collide with one it also replaces (likec4 refuses a document that
  // declares one view id twice, so `newFlows` cannot carry a duplicate).
  const declaredIn = new Map<string, string[]>();
  for (const [path, text] of texts) {
    for (const view of scanDynamicViews(text)) declaredIn.set(view.id, [...(declaredIn.get(view.id) ?? []), path]);
  }
  const deltaViews = new Map(scanDynamicViews(deltaText).map((view) => [view.id, view]));

  const merged: MergedView[] = [];
  // `newFlows` arrives sorted by id (flattenFlows sorts, and a filter keeps
  // that order), so two runs over the same inputs produce the same writes in
  // the same order — which the snapshot manifest and the `--json` plan both
  // report verbatim.
  for (const flow of newFlows) {
    const decl = deltaViews.get(flow.id);
    if (decl === undefined) {
      throw new LandscapeSpliceError(
        `cannot locate the dynamic view '${flow.id}' in delta.likec4 — the flow merge carries authored source, and no matching declaration was found`,
      );
    }
    const source: ViewSource = { deltaText, decl, featureId };
    const homes = declaredIn.get(flow.id) ?? [];
    if (homes.length > 1) {
      // Already broken, and saying so beats picking one: likec4 refuses a
      // project with a duplicate view id, so the fleet does not parse today
      // and merging into either copy would leave it not parsing.
      throw new LandscapeSpliceError(
        `the living fleet declares the dynamic view '${flow.id}' in ${homes.length} documents ` +
          `(${homes.map((p) => repoPath(docsDir, p)).join(", ")}) — likec4 refuses a duplicate view id, ` +
          `so delete all but one before archiving`,
      );
    }
    const home = homes[0];
    if (home !== undefined) {
      const text = texts.get(home)!;
      // Re-scanned against the text as the previous replacement left it: two
      // views merged into one document would otherwise have the second one's
      // offsets computed against a document that no longer exists.
      const at = scanDynamicViews(text).find((view) => view.id === flow.id)!;
      texts.set(home, replaceView(text, at, source));
      touched.add(home);
      merged.push({ id: flow.id, path: repoPath(docsDir, home), action: "replaced" });
      continue;
    }
    const path = join(flowsDir(docsDir), `${flow.id}.likec4`);
    if (texts.has(path) || existsSync(path)) {
      // The file is there and does not declare this view. Two ways in, one
      // answer: a document holding some other journey under this journey's
      // name, or — on a case-insensitive filesystem — a view id differing from
      // another only in case. Overwriting either would delete a journey.
      throw new LandscapeSpliceError(
        `the new journey '${flow.id}' would land at ${repoPath(docsDir, path)}, which already exists and ` +
          `declares no view of that id — rename the view, or move the existing document aside`,
      );
    }
    texts.set(path, flowDocument(source));
    touched.add(path);
    merged.push({ id: flow.id, path: repoPath(docsDir, path), action: "added" });
  }

  const groupViewsStale = await proveParses(docsDir, texts, touched);
  return {
    landscapeText: texts.get(landscape)!,
    writes: [...touched]
      .filter((path) => path !== landscape)
      .sort()
      .map((path) => ({ path, content: texts.get(path)! })),
    merged,
    groupViewsStale,
  };
}

/**
 * The safety net, and the group-views question that rides on it: parse the
 * whole proposed `architecture/` project, then read the flows back out of it.
 *
 * The flows come from the MERGED parse rather than from the delta, because the
 * group tags a generated views file is rendered from are a property of the
 * documents as they will stand — a view the merge replaced with a
 * differently-tagged version changes the answer, and so does one whose only
 * tag was the feature's own.
 *
 * Returns whether `architecture/flow-groups.likec4` is left stale by it.
 */
async function proveParses(docsDir: DocsDir, texts: Map<string, string>, touched: Set<string>): Promise<boolean> {
  const landscape = landscapePath(docsDir);
  // A document this merge did not compose is COPIED rather than re-encoded,
  // keeping `loadFlowProject`'s property that bytes loam did not write reach
  // likec4's reader exactly as the file holds them. The fleet map is always
  // handed over as text: the model merge composed it moments ago.
  const documents: FlowDocument[] = [...texts].map(([path, text]) =>
    touched.has(path) || path === landscape ? { path, text } : { path },
  );
  const project = await parseFlowDocuments(documents);
  if (project.errors.length > 0) {
    throw new LandscapeSpliceError(
      `the merged architecture/ project would not parse (${project.errors.length} error(s): ` +
        `${project.errors.slice(0, 3).map((err) => flowErrorLine(docsDir, err)).join("; ")}) — nothing was ` +
        `written. A journey resolves only against the LIVING fleet map: every participant it names must be an ` +
        `element architecture/landscape.likec4 declares, and every group tag must be declared in that file's ` +
        `specification block. Add the missing declaration there, or correct the view in delta.likec4, then re-run`,
    );
  }
  const expected = renderFlowGroupViews(flowGroups(project.flows));
  const viewsPath = flowGroupViewsPath(docsDir);
  const actual = existsSync(viewsPath) ? await readFile(viewsPath) : null;
  return !sameBytes(actual, expected === null ? null : Buffer.from(expected, "utf8"));
}
