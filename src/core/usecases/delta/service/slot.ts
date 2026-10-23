/**
 * A feature's SERVICE-LOCAL flows: `features/<FEAT>/specs/<svc>/usecases/<name>.likec4`.
 *
 * THE HOLE. A flow beside a service's model — a `dynamic view` over its
 * containers, tagged `#req-` with one of its own requirements — could exist only
 * in the living tree. A feature that changes or creates a service carries every
 * other document about it (`specs/<svc>/spec.md`, `arch.spec.md`, the contracts,
 * the C4 interior `delta.likec4` routes into its model), so the flows drawn over
 * that interior were the one thing an author had to hand-copy at archive time,
 * ungraded until then; and a `.likec4` written at this very path was read by
 * nothing — `validate --feature` unchanged, `status` ready, the archive silent,
 * the file left behind in `features/archive/`.
 *
 * WHERE, AND WHY THERE. Beside the service's other deltas, because that is the
 * directory a reader opens to see what this feature does to the service, and
 * it names the service the way every other delta names it: by the directory.
 * `usecases/` because that is the living convention the slot writes into —
 * `services/<…>/<svc>/usecases/<rel>` — so a feature document and the living
 * file it creates or replaces have the same relative path. A flow living
 * elsewhere beside the model (`views.likec4`, or a view inside model.likec4) is
 * not addressable from here: it moves into `usecases/` by a direct edit first.
 *
 * THREE ACTS, decided by the document and the living file at its path:
 *
 *  - CREATE: nothing lives there. The archive copies the document.
 *  - REPLACE: a living flow lives there. The archive overwrites it, and the
 *    pre-image goes into `.loam-before/` like every other overwritten document.
 *  - RETIRE: the document holds no LikeC4 statement and at least one comment
 *    (`readDocument`) — the comment is where the author says why — and a living
 *    flow lives there. The archive deletes it, and `loam unarchive` restores it
 *    from the same snapshot.
 *
 * A document holding NOTHING — zero bytes, or whitespace — is neither, and is
 * refused: it is what an editor or an agent leaves when it creates the file
 * before filling it in, and reading it as a retirement deleted the living flow
 * it was about to redraw.
 *
 * Replacing and retiring are gated (`overwrites` in `./grade.ts`), because a
 * whole-file copy over an authored hop sequence has no pin of its own to
 * collide on.
 */
import { readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { maskSource } from "../../../c4/source-mask.js";
import { relativeDocuments } from "../../../c4/project/documents.js";
import { decodeDocument } from "../../../kernel/document-bytes.js";
import type { FeatureDir } from "../../../kernel/ids/dirs.js";
import type { RawServiceId } from "../../../kernel/ids/service.js";
import { featureSpecPaths } from "../../../repo/paths.js";

/**
 * The directory a service keeps its flows in, by convention — and the one this
 * slot mirrors. The same word as the fleet's `architecture/usecases/` (`../flows.ts`)
 * and a different place; spelled here rather than imported because `../` is the
 * package that imports this one.
 */
export const SERVICE_FLOW_DIR = "usecases";

/** One service-local flow document a feature carries. */
export interface ServiceFlowDoc {
  /** The service directory name it sits under — `specs/<svc>/`. */
  service: RawServiceId;
  /**
   * The path inside `specs/<svc>/usecases/`, `/`-separated — and inside the
   * living `<service dir>/usecases/` the archive writes it to. Nesting is
   * spelled by the tree, as for every other authored tree in the repo.
   */
  rel: string;
  /** The absolute path of the authored file. */
  path: string;
  /** What the document asks of the archive — `DocumentKind`. */
  kind: DocumentKind;
}

/**
 * `flow`: it holds a LikeC4 statement — written to the living path, over a twin
 * if one is there. `retirement`: comments and nothing else — the living file at
 * that path is deleted. `empty`: nothing at all, refused rather than guessed.
 */
export type DocumentKind = "flow" | "retirement" | "empty";

/** The feature's `specs/<svc>/usecases/` directory. */
export function featureServiceFlowDir(featureDir: FeatureDir, service: RawServiceId): string {
  return join(featureSpecPaths(featureDir, service).dir, SERVICE_FLOW_DIR);
}

/**
 * The LIVING path a document addresses, under the directory the service has
 * (or, for a service this feature creates, will have). Spelled once for the
 * gate, the grader and the archive, for `livingFlowPath`'s reason one slot over:
 * a reader resolving it differently would grade one file and write another.
 * `rel` came out of a directory walk, so each component is an entry that exists.
 */
export function livingServiceFlowPath(serviceDir: string, rel: string): string {
  return join(serviceDir, SERVICE_FLOW_DIR, rel);
}

/**
 * What a document's text asks for.
 *
 * The test is the source mask (`c4/source-mask.ts`), the same reading the
 * splice trusts with a brace count, so a `//` inside a string is not taken for a
 * comment and a document whose only statement sits after a block comment is not
 * taken for an empty one. A `views { }` block with nothing in it IS a statement
 * — it replaces the living flow with a document that draws nothing, which is
 * legal and is not what retiring means. A byte-order mark is no content.
 */
export function documentKind(text: string): DocumentKind {
  const masked = maskSource(text);
  if (masked.code.replace(/^﻿/, "").trim() !== "") return "flow";
  return masked.comments.length > 0 ? "retirement" : "empty";
}

/**
 * Every service-local flow document the feature carries, for the services its
 * `specs/` names — ordered by service, then path.
 *
 * Zero readdirs beyond one per touched service when no `usecases/` is there,
 * which is every feature in a fleet that has not adopted the slot:
 * `relativeDocuments` answers an absent directory with an empty list.
 */
export async function featureServiceFlows(featureDir: FeatureDir, services: readonly RawServiceId[]): Promise<ServiceFlowDoc[]> {
  const out: ServiceFlowDoc[] = [];
  for (const service of [...services].sort()) {
    for (const doc of await relativeDocuments(featureServiceFlowDir(featureDir, service))) {
      out.push({ service, rel: doc.rel, path: doc.path, kind: await readDocument(doc.path) });
    }
  }
  return out;
}

/**
 * Does the feature carry at least one flow document for this service? What
 * `loam status` asks before it calls a `specs/<svc>/` without a requirement
 * delta incomplete — on DOCUMENTS, as the gate grades them, never on the
 * directory alone, which may hold nothing a gate reads.
 */
export function carriesServiceFlows(featureDir: FeatureDir, service: RawServiceId): boolean {
  // Synchronous because its two readers are: status builds its artifact rows
  // in one pass. An unreadable directory carries nothing a gate could read.
  try {
    const entries = readdirSync(featureServiceFlowDir(featureDir, service), { recursive: true, encoding: "utf8" });
    return entries.some((entry) => entry.endsWith(".likec4"));
  } catch {
    return false;
  }
}

/**
 * `documentKind` over a file — and never `retirement` or `empty` for a file
 * loam cannot decode. A UTF-16 document is not an empty one, and reading it as
 * one would delete a living flow over an encoding; it stays a flow, is staged
 * as one, and the parse is what names it. A read that fails is the same answer
 * for the same reason: the staging reads the file next and reports it.
 */
async function readDocument(path: string): Promise<DocumentKind> {
  try {
    return documentKind(decodeDocument(await readFile(path), path));
  } catch {
    return "flow";
  }
}
