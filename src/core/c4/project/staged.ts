/**
 * The `architecture/` project AS THIS FEATURE'S MERGE WOULD LEAVE IT, staged
 * and parsed, with a feature's own documents standing beside it.
 *
 * WHY THE POST-MERGE MAP AND NOT THE LIVING ONE. A document a feature brings
 * names elements, and a feature that adds a service adds the element its own
 * document names. Graded against the LIVING landscape that name is unresolved —
 * LikeC4 refuses the document, the project blanks, and loam reports a hole
 * against a file whose only fault is arriving with the change that makes it
 * true. Graded against the merge it resolves exactly when the merge lands the
 * element it names, which is `ARCH-LOAM-FEATURE-CORPUS`: inside a feature
 * window, the corpus is feature ∪ living.
 *
 * IT IS ALSO THE CHECK. The merge preview is the only reading under which "a
 * document naming an element the merge does not land" is answerable at all, and
 * that refusal is why it runs before `loam archive` writes rather than after:
 * without it the document is copied into `architecture/` and the NEXT reader's
 * `loam validate --all` carries the failure, against a file they did not write.
 *
 * ## Why it lives here rather than in one axis
 *
 * It was `core/usecases/delta/overlay.ts`'s private machinery while the
 * use-case slot was the only feature-local `.likec4` document. The deployment
 * slot is the second, and a second copy of this staging is the copy that
 * drifts — the two would disagree first about the merge preview, which is the
 * one thing both refusals rest on. So the staging moved down to the package
 * that owns the project loader and the merge, and each axis keeps only its own
 * INTERPRETATION of the parse: which views are the feature's, or which
 * documents failed.
 *
 * ## Why it stages its own tree
 *
 * `loadProject` copies documents from disk, keyed on their path relative to a
 * base — so it can be handed neither a landscape that exists only in memory nor
 * a document living outside `architecture/`, and both are exactly what this
 * needs. Teaching it to take content would put a second, rarely-exercised
 * staging rule inside a loader whose docstring already carries two rules that
 * invert what holds elsewhere. Staging here costs one copy of a handful of
 * small files and keeps that loader's contract at one.
 *
 * THE PRICE OF THAT CHOICE IS PATHS, and it is paid here rather than left to
 * the caller: every path LikeC4 reports — a parse error's `sourceFsPath`, a
 * view's `sourcePath` — names a temp tree, and a finding naming a temp
 * directory is a finding nobody can act on. `real()` maps them back to the file
 * the author wrote, and the temp tree is gone before this returns.
 *
 * FAIL CLOSED, and not silently. Every failure is the `unreadable` arm carrying
 * LikeC4's own messages: a document this cannot read is never one that grades
 * clean.
 */
import { existsSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { loadFile, type LoadedDoc } from "../likec4.js";
import { planLandscapeMerge } from "../splice/landscape-merge.js";
import { inOrder } from "../../kernel/concurrency.js";
import { decodeDocument } from "../../kernel/document-bytes.js";
import type { DocsDir, FeatureDir } from "../../kernel/ids/dirs.js";
import { featurePaths, landscapePath, subsystemViewsPath } from "../../repo/paths.js";
import { architectureDir } from "./architecture.js";
import { architectureDocuments } from "./documents.js";
import { asLoadedDoc, loadProject } from "./load.js";

/** One document a feature brings, and where it would live under `architecture/`. */
export interface StagedDocument {
  /** Its path relative to `architecture/`, `/`-separated — where the merge would write it. */
  rel: string;
  /** The absolute path of the authored file. */
  path: string;
}

export interface StagedProjectRequest {
  docsDir: DocsDir;
  featureDir: FeatureDir;
  /** The feature's id — the tag that selects the delta's own additions. */
  featureId: string;
  /** The feature's own documents, staged LAST so they win over a living twin. */
  documents: readonly StagedDocument[];
  /**
   * The caller's memoised LikeC4 read, when it has one. Only `delta.likec4`
   * goes through it, and only to compute the merge preview — but a caller
   * inside `featureCoherence` has already loaded that exact document, and
   * loading one spins a fresh Langium workspace, which
   * `core/coherence/coherence.ts` calls the dominant per-feature cost.
   */
  load?: (path: string) => Promise<LoadedDoc>;
}

/** The staged parse, or the honest refusal to say. */
export type StagedProject =
  | {
      kind: "read";
      /** The whole staged project, parsed. */
      doc: LoadedDoc;
      /** A path LikeC4 reported, spelled as the author wrote it. */
      real: (path: string) => string;
      /** The staged rels that are THIS feature's documents — everything else is living. */
      mine: ReadonlySet<string>;
    }
  | { kind: "unreadable"; errors: string[] };

/**
 * Stage the living `architecture/` with the merge preview in place of the
 * landscape, add the feature's own documents, and parse the result.
 *
 * A feature bringing no documents is not this function's business: both callers
 * return their own empty answer before reaching it, at the cost of one walk
 * over a directory that is not there. That walk is the axis's per-feature
 * opt-in and the whole price a fleet that has not adopted it pays.
 */
export async function stageMergedProject(req: StagedProjectRequest): Promise<StagedProject> {
  const merged = await mergedLandscape(req);
  if (merged.kind === "failed") return { kind: "unreadable", errors: [merged.reason] };

  const arch = architectureDir(req.docsDir);
  const living = await architectureDocuments(arch, [subsystemViewsPath(req.docsDir)]);
  const root = await mkdtemp(join(tmpdir(), "loam-staged-"));
  try {
    // Staged rel -> the path the AUTHOR wrote, so every message that leaves
    // here names a file they can open. Built as the tree is staged, because
    // that is the one moment both spellings are in hand.
    const authored = new Map<string, string>();
    const landscape = resolve(landscapePath(req.docsDir));
    await inOrder(living, async (path) => {
      // The living landscape is staged from the merge preview when there is
      // one; copying it as well would declare every element twice.
      if (merged.kind === "merged" && resolve(path) === landscape) return null;
      await stage(root, spell(relative(arch, path)), path, authored);
      return null;
    });
    if (merged.kind === "merged") {
      const rel = spell(relative(arch, landscape));
      await write(root, rel, merged.content);
      authored.set(rel, landscape);
    }
    // The feature's own documents LAST, so one whose living twin exists wins
    // the staging rather than colliding with it. That case is already an error
    // the gate refuses before any merge — `usecase.flow-exists`,
    // `deployment.doc-exists` — and grading the feature's version is the more
    // useful of the two answers to give an author who is about to be told to
    // delete the file.
    const mine = new Set<string>();
    for (const document of req.documents) {
      await stage(root, document.rel, document.path, authored);
      mine.add(document.rel);
    }
    const doc = asLoadedDoc(await loadProject(root, await architectureDocuments(root)));
    // TWO SPELLINGS REACH HERE and both must map, which is the one thing this
    // helper cannot be allowed to get half right. A parse error's
    // `sourceFsPath` is an ABSOLUTE path into the temp tree; a view's
    // `sourcePath` is already the project-RELATIVE rel LikeC4 reports. The
    // rel-first lookup answers the second, and the relative() computation the
    // first. Handling only one leaves the other silently returning the temp
    // spelling, which is a finding naming a directory that no longer exists.
    const real = (path: string): string =>
      authored.get(spell(path)) ?? authored.get(spell(relative(root, path))) ?? path;
    if (doc.errors.length > 0) {
      // An error naming no document is LikeC4 declining to attribute one. It
      // still travels: a hole loam cannot place is still a hole, and dropping
      // it here would grade the feature clean on the strength of a missing
      // field.
      return {
        kind: "unreadable",
        errors: doc.errors.map((e) => (e.sourceFsPath === undefined ? e.message : `${real(e.sourceFsPath)}: ${e.message}`)),
      };
    }
    return { kind: "read", doc, real, mine };
  } catch (err) {
    // The `unreadable` arm is a PROMISE, not a description of the happy path.
    // Two things under here throw rather than return: `loadProject` refuses an
    // error it cannot attribute to a document, and every `mkdir`/`copyFile` in
    // the staging above can fail on a full disk or a denied temp directory.
    // Callers run inside `loam validate --feature` and the archive gate — and
    // the one behaviour a check added to those may never have is failing the
    // run it was added to. So a throw becomes the same could-not-look answer a
    // parse error already produces, which each caller turns into its own
    // refusal that writes nothing.
    return { kind: "unreadable", errors: [err instanceof Error ? err.message : String(err)] };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

/** What the landscape looks like after this feature's C4 delta is spliced in. */
type MergedLandscape =
  /** The delta adds nothing, or there is none — the living landscape stands. */
  | { kind: "living" }
  /** The merge preview, as authored bytes. */
  | { kind: "merged"; content: string }
  /** The merge could not be computed; `planLandscape` owns the refusal and says why. */
  | { kind: "failed"; reason: string };

/**
 * The merge preview, computed with the SAME function `loam archive` commits
 * with.
 *
 * Reusing `planLandscapeMerge` rather than approximating it is what makes this
 * an answer about the archive rather than a second opinion beside it: an
 * element placed differently, a tag stripped differently, or a splice refused
 * there and allowed here would be a document graded against a map the merge
 * never writes.
 *
 * THE PARITY IS THE MERGE, NOT THE WHOLE GATE, and the difference is worth
 * naming rather than leaving for a reader to discover. `planLandscape` runs one
 * check BEFORE it computes the merge and this does not: a delta declaring the
 * feature tag on a specification KIND is refused there, because every element
 * of that kind inherits the tag and the merge would splice the whole document.
 * Such a delta reaches `newEls` here unfiltered, so the preview this grades
 * against is one the archive would never write. It changes no verdict — that
 * archive refuses either way, before anything is written — and it is recorded
 * because the next reader to widen either side needs to know the two are not
 * the same gate.
 *
 * A throw is `failed` rather than propagated. Every `LandscapeSpliceError` this
 * can raise is one `planLandscape` raises again — with its own message, its own
 * refusal code, and before anything is written — so throwing here would only
 * decide which of two identical refusals an author reads first.
 */
async function mergedLandscape(req: StagedProjectRequest): Promise<MergedLandscape> {
  const deltaPath = featurePaths(req.featureDir).delta;
  const landscape = landscapePath(req.docsDir);
  if (!existsSync(deltaPath) || !existsSync(landscape)) return { kind: "living" };
  const delta = await (req.load ?? loadFile)(deltaPath);
  if (delta.errors.length > 0) {
    return {
      kind: "failed",
      reason: `delta.likec4 has ${delta.errors.length} parse error(s) — a feature's own documents cannot be graded against a map that does not parse`,
    };
  }
  try {
    const plan = await planLandscapeMerge({
      landscapeText: await text(landscape),
      deltaText: await text(deltaPath),
      deltaElements: delta.elements,
      newEls: delta.elements.filter((e) => e.tags.includes(req.featureId)),
      newRels: delta.relationships.filter((r) => r.tags.includes(req.featureId)),
      featureId: req.featureId,
    });
    return plan.content === null ? { kind: "living" } : { kind: "merged", content: plan.content };
  } catch (err) {
    return { kind: "failed", reason: err instanceof Error ? err.message : String(err) };
  }
}

/** Read a document loam is about to hand LikeC4, refusing the encodings that decode as empty. */
async function text(path: string): Promise<string> {
  return decodeDocument(await readFile(path), path);
}

/** A path spelled the way a staged rel is spelled — `/`-separated, on every platform. */
function spell(path: string): string {
  return path.split(/[\\/]/).join("/");
}

/** Copy one authored document into the staged tree, remembering where it came from. */
async function stage(root: string, rel: string, path: string, authored: Map<string, string>): Promise<void> {
  const dest = join(root, ...rel.split("/"));
  await mkdir(dirname(dest), { recursive: true });
  await copyFile(path, dest);
  authored.set(rel, resolve(path));
}

/** Write one document into the staged tree from bytes loam holds rather than a file. */
async function write(root: string, rel: string, content: string): Promise<void> {
  const dest = join(root, ...rel.split("/"));
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, content, "utf8");
}
