/**
 * A feature's flows, read against the fleet map AS THIS FEATURE'S MERGE WOULD
 * LEAVE IT.
 *
 * WHY THE POST-MERGE MAP AND NOT THE LIVING ONE. A `dynamic view`'s steps name
 * elements, and a feature that adds a service adds the element its own flow
 * draws a hop into. Graded against the LIVING landscape that flow is unresolved
 * — LikeC4 refuses the document, the project blanks, and loam would report a
 * hole against a file whose only fault is arriving with the change that makes
 * it true. Graded against the merge it resolves exactly when the merge lands
 * the element it names, which is the judgement `core/capabilities/delta/
 * overlay.ts` takes one axis over and `spec-api.op-undefined` takes one axis
 * over from that: inside a feature window, the corpus is feature ∪ living.
 *
 * IT IS ALSO THE CHECK. The merge preview is the only reading under which "a
 * flow naming an element the merge does not land" is answerable at all, and
 * that refusal is why this runs before `loam archive` writes rather than after:
 * without it a flow is copied into `architecture/` and the NEXT reader's `loam
 * validate --all` carries the failure, against a document they did not write.
 *
 * WHY IT STAGES ITS OWN TREE. `loadProject` copies documents from disk, keyed
 * on their path relative to a base — so it can be handed neither a landscape
 * that exists only in memory nor a document living outside `architecture/`, and
 * both are exactly what this needs. Teaching it to take content would put a
 * second, rarely-exercised staging rule inside the loader whose docstring
 * already carries two rules that invert what holds elsewhere. Staging here
 * costs one copy of a handful of small files and keeps that loader's contract
 * at one.
 *
 * THE PRICE OF THAT CHOICE IS PATHS, and it is paid in `authored` below rather
 * than left to the caller: every path LikeC4 reports — a parse error's
 * `sourceFsPath`, a view's `sourcePath` — names this module's temp tree, and a
 * finding naming a temp directory is a finding nobody can act on. Both are
 * mapped back to the file the author wrote before anything leaves here.
 *
 * FAIL CLOSED, and not silently. Every failure is the `unreadable` arm carrying
 * LikeC4's own messages: a flow this cannot read is never a flow that grades
 * clean, which is the asymmetry `../fleet.ts` states for the fleet-scope scan.
 */
import { existsSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { loadFile, type LoadedDoc } from "../../c4/likec4.js";
import { architectureDir } from "../../c4/project/architecture.js";
import { architectureDocuments } from "../../c4/project/documents.js";
import { asLoadedDoc, loadProject } from "../../c4/project/load.js";
import { serviceResolver } from "../../c4/resolve/service.js";
import { planLandscapeMerge } from "../../c4/splice/landscape-merge.js";
import { inOrder } from "../../kernel/concurrency.js";
import { decodeDocument } from "../../kernel/document-bytes.js";
import type { DocsDir, FeatureDir } from "../../kernel/ids/dirs.js";
import { featurePaths, landscapePath, subsystemViewsPath } from "../../repo/paths.js";
import { isUseCase, type UseCaseScan } from "../fleet.js";
import { featureFlows, USECASE_SUBDIR } from "./flows.js";

/** Everything the overlay needs, and nothing it would have to read twice. */
export interface FlowOverlayRequest {
  docsDir: DocsDir;
  featureDir: FeatureDir;
  /** The feature's id — the tag that selects the delta's own additions. */
  featureId: string;
  /**
   * The enumerated fleet, for the element→service resolver. It rides in for the
   * reason every other edge join carries it: without it a hop drawn into a
   * modelled container `payment.api` resolves to a service called "api" that
   * has never existed.
   */
  known: ReadonlySet<string>;
  /**
   * The caller's memoised LikeC4 read, when it has one. Only `delta.likec4` goes
   * through it, and only to compute the merge preview — but the caller
   * (`featureCoherence`) has already loaded that exact document, and loading one
   * spins a fresh Langium workspace, which `core/coherence/coherence.ts` calls
   * the dominant per-feature cost.
   *
   * A FUNCTION rather than the `FleetContext` itself, deliberately: this package
   * has no edge to `core/fleet-context.ts`, one memoised read does not justify
   * adding one, and the edge would push `core/usecases/` up a DAG level for
   * nothing. Absent, the load happens directly, which is right for a caller
   * running outside an invocation index.
   */
  load?: (path: string) => Promise<LoadedDoc>;
}

/**
 * The flows this feature carries, parsed over the post-merge map — or the
 * honest refusal to say.
 *
 * A feature with no `usecases/` directory is `read` with no views, at the cost
 * of one walk over a directory that is not there. That is the axis's
 * per-feature opt-in and the whole price a fleet that has not adopted it pays.
 */
export async function readFeatureFlows(req: FlowOverlayRequest): Promise<UseCaseScan> {
  const flows = await featureFlows(req.featureDir);
  if (flows.length === 0) {
    return { kind: "read", views: [], model: { elements: [], relationships: [], known: req.known }, resolve: (id) => id };
  }
  const merged = await mergedLandscape(req);
  if (merged.kind === "failed") return { kind: "unreadable", errors: [merged.reason] };

  const arch = architectureDir(req.docsDir);
  const living = await architectureDocuments(arch, [subsystemViewsPath(req.docsDir)]);
  const root = await mkdtemp(join(tmpdir(), "loam-flow-"));
  try {
    // Staged rel -> the path the AUTHOR wrote, so every message that leaves here
    // names a file they can open. Built as the tree is staged, because that is
    // the one moment both spellings are in hand.
    const authored = new Map<string, string>();
    const landscape = resolve(landscapePath(req.docsDir));
    await inOrder(living, async (path) => {
      // The living landscape is staged from the merge preview when there is one;
      // copying it as well would declare every element twice.
      if (merged.kind === "merged" && resolve(path) === landscape) return null;
      await stage(root, spell(relative(arch, path)), path, authored);
      return null;
    });
    if (merged.kind === "merged") {
      const rel = spell(relative(arch, landscape));
      await write(root, rel, merged.content);
      authored.set(rel, landscape);
    }
    // The feature's own flows LAST, so a flow whose living twin exists wins the
    // staging rather than colliding with it on view id. That case is already
    // `usecase.flow-exists` — an error the gate refuses before any merge — and
    // grading the feature's version is the more useful of the two answers to
    // give an author who is about to be told to delete the file.
    const rels = new Set<string>();
    for (const flow of flows) {
      const rel = `${USECASE_SUBDIR}/${flow.rel}`;
      await stage(root, rel, flow.path, authored);
      rels.add(rel);
    }
    return interpret(await loadProjectAt(root), { root, authored, rels, known: req.known });
  } catch (err) {
    // The `unreadable` arm is a PROMISE, not a description of the happy path.
    // Two things under here throw rather than return: `loadProject` refuses an
    // error it cannot attribute to a document, and every `mkdir`/`copyFile` in
    // the staging above can fail on a full disk or a denied temp directory. This
    // function is called from `featureCoherence`, which runs inside `loam
    // validate --feature` and the archive gate — and the one behaviour a check
    // added to those may never have is failing the run it was added to
    // (`../fleet.ts` states the same rule for the fleet-scope scan). So a throw
    // becomes the same could-not-look answer a parse error already produces,
    // which the caller turns into `usecase.flow-invalid` and a refusal that
    // writes nothing.
    return { kind: "unreadable", errors: [err instanceof Error ? err.message : String(err)] };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

/** Everything `interpret` needs to turn a staged parse back into authored paths. */
interface Staged {
  root: string;
  /** Staged rel -> authored absolute path. */
  authored: Map<string, string>;
  /** The staged rels that are THIS feature's flows. */
  rels: ReadonlySet<string>;
  known: ReadonlySet<string>;
}

/** The staged project, loaded the way `loadArchitecture` loads the living one. */
async function loadProjectAt(root: string): Promise<LoadedDoc> {
  return asLoadedDoc(await loadProject(root, await architectureDocuments(root)));
}

/**
 * The staged parse, spelled in authored paths.
 *
 * THE FEATURE'S OWN FLOWS ONLY. A living use case is the fleet scan's to report,
 * and repeating it here would file somebody else's finding against this
 * feature's gate — the same scoping every other feature-side check keeps.
 */
function interpret(doc: LoadedDoc, staged: Staged): UseCaseScan {
  const real = (path: string): string => staged.authored.get(spell(relative(staged.root, path))) ?? path;
  if (doc.errors.length > 0) {
    // An error naming no document is LikeC4 declining to attribute one. It still
    // travels: a hole loam cannot place is still a hole, and dropping it here
    // would grade the flow clean on the strength of a missing field.
    return {
      kind: "unreadable",
      errors: doc.errors.map((e) => (e.sourceFsPath === undefined ? e.message : `${real(e.sourceFsPath)}: ${e.message}`)),
    };
  }
  // Through `isUseCase`, because `UseCaseScan.views` is documented as the
  // reserved-tag views ONLY and this is the type's second producer. The
  // resolvers below filter on the prefix anyway, so no answer changes today —
  // but `flowsClaiming` and `servicesInFlowsClaiming` take a `UseCaseScan` and
  // read `scan.views` straight, and the whole point of exporting one predicate
  // was that a second spelling of the opt-in drifts.
  const mine = (doc.views ?? [])
    .filter((view) => view.sourcePath !== undefined && staged.rels.has(view.sourcePath))
    .filter(isUseCase);
  return {
    kind: "read",
    views: mine.map((view) => ({ ...view, sourcePath: staged.authored.get(view.sourcePath ?? "") ?? view.sourcePath })),
    model: { elements: doc.elements, relationships: doc.relationships, known: staged.known },
    resolve: serviceResolver(doc.elements, staged.known),
  };
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
 * an answer about the archive rather than a second opinion beside it: an element
 * placed differently, a tag stripped differently, or a splice refused there and
 * allowed here would be a flow graded against a map the merge never writes.
 *
 * THE PARITY IS THE MERGE, NOT THE WHOLE GATE, and the difference is worth
 * naming rather than leaving for a reader to discover. `planLandscape` runs one
 * check BEFORE it computes the merge and this does not: a delta declaring the
 * feature tag on a specification KIND is refused there, because every element of
 * that kind inherits the tag and the merge would splice the whole document. Such
 * a delta reaches `newEls` here unfiltered, so the preview this grades against
 * is one the archive would never write. It changes no verdict — that archive
 * refuses either way, before anything is written — and it is recorded because
 * the next reader to widen either side needs to know the two are not the same
 * gate.
 *
 * A throw is `failed` rather than propagated. Every `LandscapeSpliceError` this
 * can raise is one `planLandscape` raises again — with its own message, its own
 * refusal code, and before anything is written — so throwing here would only
 * decide which of two identical refusals an author reads first.
 */
async function mergedLandscape(req: FlowOverlayRequest): Promise<MergedLandscape> {
  const deltaPath = featurePaths(req.featureDir).delta;
  const landscape = landscapePath(req.docsDir);
  if (!existsSync(deltaPath) || !existsSync(landscape)) return { kind: "living" };
  const delta = await (req.load ?? loadFile)(deltaPath);
  if (delta.errors.length > 0) {
    return {
      kind: "failed",
      reason: `delta.likec4 has ${delta.errors.length} parse error(s) — a flow cannot be graded against a map that does not parse`,
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
