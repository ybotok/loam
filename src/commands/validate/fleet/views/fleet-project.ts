/**
 * `c4.fleet-project-invalid` — the one thing no per-document grade can see:
 * every document loam reads is clean, and the project the RENDERER builds out of
 * them is not.
 *
 * loam grades a fleet document by document, and that is deliberate: a service's
 * model is graded on its own merits, and one broken model must not blank the
 * fleet. The renderer has no such rule. Point `npx likec4 start` at the docs
 * root and it merges every `.likec4` the root project reads into ONE model — the
 * map, every extending model, and every `.likec4` sitting beside one — so a
 * declaration made in two of those documents is a duplicate there and nowhere
 * else. Measured at the 1.59.2 pin: a tags-only `specification { tag req-X }` in
 * an extending model is legal, and the SAME tag declared in a second extending
 * model is a duplicate blamed on both files. Two services, two clean grades, and
 * a renderer that draws nothing.
 *
 * So this is one extra load, and it is the renderer's reading rather than
 * loam's. What it reports is the SET DIFFERENCE: an error already reported where
 * loam grades that document — the map's own parse, a per-service project's
 * `c4.invalid`, a service flow project's use-case failure — is not repeated
 * here, because the fix is one file either way and N copies of one cascade is
 * the report. What is left over is exactly the class above: errors that exist
 * only because these documents were merged.
 *
 * WHICH DOCUMENTS ARE IN IT is `./root-documents.ts`'s question, and it is a
 * walk of the docs root rather than a list of the shapes loam knows about: a
 * `.likec4` in a SUBSYSTEM directory — the parent of service directories — was
 * in none of the three roots this used to merge, and went unreported while the
 * renderer refused the whole project over it (verification 2026-09-04, R2). That
 * module also carries why the generated `architecture/subsystems.likec4`,
 * every standalone service directory and `features/` stay out.
 *
 * `--all` ONLY, and only when at least one model extends the map, the map itself
 * parses, and the root `exclude` does not hide it. A single-target run has not
 * enumerated the fleet, so it cannot build the project at all; a fleet whose
 * models all stand alone has no such project (every one of them is excluded from
 * the root); and a map that does not parse would report its own cascade here
 * under a second code while `landscape.invalid` already names the file.
 *
 * THE LAST OF THOSE GATES IS THE CASCADE RULE, the one `permissions.invalid` and
 * `capability.invalid` already state: a grade that resolves against a
 * document nobody loaded is not a diagnosis. `architectureProjectDocuments`
 * keeps the map whatever the root `exclude` says — that floor is what stopped
 * loam asserting a fleet's map declares nothing — but this load has no such
 * floor ON PURPOSE, because its whole claim is to read what the renderer reads.
 * So an entry covering `architecture/landscape.likec4` leaves every extending
 * model in the project with its `extend <fqn>` resolving against nothing:
 * measured on `examples/docs` with `architecture/*.likec4` in the list, one
 * authored line came back as 161 warnings under this code. `landscape.excluded`
 * (`./projects.ts`) is the one finding that names the cause, and it says the
 * fleet project is not graded until the entry goes. The fact arrives as
 * `mapExcluded` rather than being re-read here, so the two can never disagree
 * about which state they are in.
 *
 * WHY A WARNING. Nothing loam concludes changes: every model still parses where
 * loam reads it, every binding still resolves, the spine is unaffected. What is
 * broken is the picture, which is what `service.likec4-config-missing` and its
 * three siblings in `./projects.ts` also grade, at the same severity.
 */
import { existsSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { errorText, type LikeC4Error, type LoadedDoc } from "../../../../core/c4/likec4.js";
import { asLoadedDoc, loadProject } from "../../../../core/c4/project/load.js";
import type { ViewIdClaim } from "../../../../core/c4/parsed/view-ids.js";
import type { ModelShape } from "../../../../core/c4/service-model/shape.js";
import { FleetContext } from "../../../../core/fleet-context.js";
import { inOrder } from "../../../../core/kernel/concurrency.js";
import type { DocsDir } from "../../../../core/kernel/ids/dirs.js";
import type { ServiceEntry } from "../../../../core/repo/entries.js";
import { servicePathsAt, type ServicePaths } from "../../../../core/repo/paths.js";
import type { FleetTree } from "../../../../core/repo/tree/walk.js";
import { readServiceFlows } from "../../../../core/usecases/service/flows.js";
import type { Finding } from "../../../../core/vocabulary/report.js";
import { rootProjectDocuments } from "./root-documents.js";

export interface FleetProjectCheck {
  docsDir: DocsDir;
  /** The FULL enumeration — the project the renderer builds holds every model, not a narrowed run's subset. */
  entries: readonly ServiceEntry[];
  /** Each model's shape, keyed by resolved path (`FleetContext.modelShapes`). */
  shapes: ReadonlyMap<string, ModelShape>;
  /** The run's read index: the per-service projects it already parsed are half of the set difference. */
  fleet: FleetContext;
  /** The map parsed ALONE — the gate, and the other half of the difference. */
  architecture: LoadedDoc;
  /**
   * Whether the root `exclude` hides the map itself — `landscape.excluded`'s own
   * condition, computed once in `./projects.ts` and carried here rather than
   * re-derived. It is a GATE, for the reason the banner's cascade-rule paragraph
   * gives: this load has no floor under the map, so the entry that hides it
   * turns one authored line into an unresolved reference in every extending
   * model.
   */
  mapExcluded: boolean;
  /** The walked tree, for the view-id census this load makes answerable. */
  tree: FleetTree;
  /** Every service directory that exists — the flow scan's resolver evidence. */
  known: ReadonlySet<string>;
}

/**
 * What the merged load found, as three answers rather than one list — because
 * the caller has a second question to ask of it and the answers are mutually
 * exclusive.
 *
 * `skipped` is "there is no such project, or loam declines to read one": no model
 * extends the map, the map does not parse, the root `exclude` hides the map
 * (`landscape.excluded` names that entry and this grade stands down behind it),
 * or the run has no fleet index. `clean` carries the view-id
 * CENSUS, which is the only thing a caller may take from a project that parsed —
 * and the reason this is not just an empty finding list: an empty list and a
 * clean census are the same thing to `.length`, and one of them licenses
 * `subsystem.view-id-collision` to be graded over every extending model's
 * authored ids while the other does not.
 */
export type FleetProjectGrade =
  | { kind: "skipped" }
  | { kind: "invalid"; findings: Finding[] }
  | { kind: "clean"; viewIds: ViewIdClaim[] };

export async function fleetProjectFindings(check: FleetProjectCheck): Promise<FleetProjectGrade> {
  // A map that did not parse is `landscape.invalid`'s, and this load would only
  // repeat its cascade under a second code.
  if (check.architecture.errors.length > 0) return { kind: "skipped" };
  // A map the root `exclude` hides is `landscape.excluded`'s, for the same
  // reason one line up — see the banner's cascade-rule paragraph. The view-id
  // census goes with it: `clean` is a claim about a project that parsed, and
  // there is none.
  if (check.mapExcluded) return { kind: "skipped" };
  const shapeOf = (entry: ServiceEntry): ModelShape | null => {
    const model = servicePathsAt(entry.dir).model;
    return existsSync(model) ? (check.shapes.get(resolve(model)) ?? null) : null;
  };
  const extending = check.entries.filter((entry) => shapeOf(entry) === "extending");
  if (extending.length === 0) return { kind: "skipped" };

  const paths = extending.map((entry) => servicePathsAt(entry.dir));
  // The TREE, not three roots. `./root-documents.ts` carries what comes out of
  // it and why; the standalone directories are handed in because their shape is
  // this run's memo and re-reading every model here would be a second scanner.
  const documents = await rootProjectDocuments(
    check.docsDir,
    check.entries.filter((entry) => shapeOf(entry) === "standalone").map((entry) => entry.dir),
  );
  const project = await loadProject(check.docsDir, documents);

  if (project.clean) {
    // The census `subsystem.view-id-collision` needs and could not have until
    // now: an extending model's authored view ids live in the SAME flat
    // namespace as the map's, because both documents are in this project. The
    // claims arrive docs-relative, which is the spelling `viewIdFindings` takes.
    return { kind: "clean", viewIds: project.viewIds };
  }

  const reported = await alreadyReported(check, paths);
  const findings: Finding[] = [];
  for (const err of asLoadedDoc(project).errors) {
    if (reported.has(errorKey(err))) continue;
    const owner = extending.find(
      (entry) => err.sourceFsPath !== undefined && err.sourceFsPath.startsWith(`${entry.dir}${sep}`),
    );
    const file =
      err.sourceFsPath === undefined ? null : relative(check.docsDir, err.sourceFsPath).split(/[\\/]/).join("/");
    findings.push({
      severity: "warn",
      code: "c4.fleet-project-invalid",
      ...(owner === undefined ? {} : { subject: owner.id }),
      // The file the error is IN, never the map by default: `locations[0].path`
      // was `architecture/landscape.likec4` on every one of these, so a reader
      // acting on the payload opened a document that was not the one at fault
      // (verification 2026-09-04, D10). Absent when LikeC4 declined to attribute
      // the error to a document at all — a location loam cannot spell is left
      // unspelled rather than guessed.
      ...(file === null ? {} : { locations: [{ path: file, role: "primary" as const }] }),
      details: [file === null ? errorText(err) : `${file}: ${errorText(err)}`],
      message:
        `fleet project: ${file ?? "the merged project"}: ${errorText(err)} — each document reads clean where ` +
        "loam grades it, but the renderer merges every `.likec4` the root project reads except the generated " +
        "subsystems.likec4 — the map, every extending model and every `.likec4` beside one — into ONE project, " +
        `and that project does not parse. ${remedy(err.message)}`,
    });
  }
  return { kind: "invalid", findings };
}

/**
 * The tail that names WHICH failure this is.
 *
 * It used to say "a tag or an element declared in two of those documents is
 * declared twice there" for every error, including the ones that are not a
 * double declaration at all (verification 2026-09-04, D10) — an unresolved
 * reference sent its reader hunting for a second declaration that does not
 * exist. LikeC4's own wording is the evidence, matched loosely on purpose: an
 * unrecognised message falls to the third arm, which asserts nothing beyond
 * where to look.
 */
function remedy(message: string): string {
  if (/duplicat|already (declared|defined)|declared (more than once|twice)/i.test(message)) {
    return (
      "A tag or an element declared in two of those documents is declared twice there; declare it once " +
      "(the map, or the one service that owns it)"
    );
  }
  if (/could not resolve|unresolved|unknown/i.test(message)) {
    return (
      "A name resolves against ALL of those documents here, so a reference the renderer cannot place is one " +
      "no document in the project declares; declare it where the reader can see it, or drop the reference"
    );
  }
  return "Open the file and line named above — every reader who points a renderer at the docs root sees this";
}

/**
 * Every parse error this run has ALREADY reported against one of these
 * documents, keyed so the merged project's copy can be recognised.
 *
 * Two sources, and both are loads the run made anyway or would make: each
 * extending model's own per-service project (`c4.invalid` on the service
 * target) and, where nothing was wrong there, each service's FLOW project
 * (`readServiceFlows` — the use-case grade names the file). The flow read goes
 * through that function rather than a second `loadProject` here so the OPT-IN
 * gate is the same one: a broken sibling that nothing tagged is loaded by
 * neither, which is exactly why the merged project has to report it.
 *
 * Computed only when the merged project actually failed, which is why it is a
 * function rather than an input: on a healthy fleet this whole file costs one
 * load and nothing else.
 *
 * THE FLOW PROJECTS ARE PARSED AGAIN by `validateService` later in the same run,
 * and that is accepted rather than unnoticed: it happens only on the path where
 * the merged project already failed, so a healthy fleet pays nothing, and the
 * `ServiceModel` half above IS the run's memo. If that path ever becomes hot,
 * the follow-up is to memoise the flow scan on `FleetContext` beside the
 * per-service projects — not to hand the scan in here, which would make this
 * grade depend on an argument the caller has no reason to have loaded.
 */
async function alreadyReported(
  check: FleetProjectCheck,
  paths: readonly ServicePaths[],
): Promise<ReadonlySet<string>> {
  // Both sets reach the same documents through `architectureProjectDocuments`,
  // which now drops what the root `exclude` covers exactly as the merged load's
  // own walk does — so a document out of one is out of both, and the generated
  // `subsystems.likec4` is out of all of them without being remembered twice.
  //
  // Pooled rather than awaited one at a time: each entry is an independent
  // LikeC4 workspace over one service's own documents, which is exactly the
  // work `inOrder` rations — and a serial loop here made the ONE path that
  // already costs a fleet its whole set of flow projects pay for them in
  // sequence.
  const perService = await inOrder(paths, async (service) => {
    const model = await check.fleet.serviceModel(check.docsDir, service);
    const errors = [...model.doc.errors];
    if (errors.length > 0 || model.mapUnreadable) return errors;
    // `model.project` is non-null here by construction — these are extending
    // models whose own load came back clean, which is the arm that carries it —
    // and the guard is the compiler's rather than an assertion: a null would
    // mean grading a flow against a document that did not load.
    if (model.project === null) return [];
    const flows = await readServiceFlows({
      paths: service,
      model: model.doc,
      known: check.known,
      extending: { docsDir: check.docsDir, project: model.project },
    });
    return flows.kind === "unreadable" ? flows.errors : [];
  });
  return new Set(perService.flat().map(errorKey));
}

/**
 * One error's identity across two loads of overlapping document sets: the real
 * file, the line, and the message.
 *
 * There is no id to join on — LikeC4 mints diagnostics per parse — and the
 * message has to be part of the key: two DIFFERENT problems on one line of one
 * file are two errors, and collapsing them would let a merged-project-only
 * failure hide behind a per-service one that happens to share a line.
 */
function errorKey(err: LikeC4Error): string {
  return JSON.stringify([err.sourceFsPath ?? "", err.line ?? -1, err.message]);
}
