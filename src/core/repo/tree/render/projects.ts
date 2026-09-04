/**
 * The renderer's project file for ONE service — `services/<…>/<id>/likec4.config.json`
 * — the second thing under `services/` that exists only to be rendered.
 *
 * Why it exists, and WHICH MODELS IT IS FOR. A model that STANDS ALONE declares
 * its own `specification` block, so it is parsed alone and the root project must
 * exclude its directory — a renderer merging it into the map reports every kind
 * and element it declares as a duplicate, blamed on both files. The cost of that
 * exclusion went unstated for a release: an adopted service's model — the
 * artifact `loam adopt` spends the most effort on — was a box on the fleet map
 * with nothing renderable inside it from the docs root, and the documented way
 * to see it was one renderer invocation per service directory. Measured at the
 * 1.59.2 pin: a `likec4.config.json` INSIDE a service directory is registered as
 * a project of its own even though the root excludes the directory (the root's
 * `exclude` does not hide a nested project file), the workspace then loads
 * `fleet` plus one project per service with zero errors, and each service
 * project carries LikeC4's own `index` view of the containers beside whatever
 * view the model authors. One two-key file per such directory is therefore what
 * makes that model renderable from the same root, in the same renderer, beside
 * the map.
 *
 * A model that EXTENDS the map is owed NO file, and that is the same
 * measurement read the other way: it declares no kinds, it lives in the ROOT
 * project beside the map, and a nested project file beside it TAKES it out of
 * there — measured at the 1.59.2 pin, the workspace loads two projects and, where
 * the nested one claims the model, it holds it alone (the map's kinds are not in
 * there with it, so it does not resolve) and `export json --project fleet` loses
 * the service's containers. So the survey below takes the shape as a predicate, the writer
 * creates a file only for the standalone half and removes one beside the
 * extending half, and `service.likec4-config-stray` grades what is left.
 *
 * NEVER COMPARED, NEVER REWRITTEN — the root config's ownership rule
 * (`core/docs.ts`: written once, never re-read, the team owns it), NOT the
 * generated views file's. The bytes are a function of the service id alone,
 * which SCHEMA.md defines as the identity no verb ever changes, so nothing can
 * make the file stale; a compare would only fight the per-project keys LikeC4
 * lets a team add (`title`, styles, a contact), and would restale every service
 * on any change to this rule. Presence is the one question loam owes the file,
 * and presence needs no parse: rule 26 stands, and loam still reads none of it.
 *
 * REMOVED IN EXACTLY ONE STATE: beside a model that EXTENDS the map. That is a
 * correction, and it is measured rather than reasoned. The design note said a
 * nested project beside an extending model was registered EMPTY and therefore
 * harmless; on likec4 1.59.2 two agents measured the opposite (verification
 * 2026-09-04, W1) — the nested project CLAIMS the model, the workspace loads
 * "2 projects", the model is Invalid inside its own one (`Could not resolve
 * reference to Element named 'svc_svc_a'`, because the map is not in there with
 * it), and `export json --project fleet` drops the service's containers. So the
 * file is not a leftover, it is a working renderer taken away from the fleet,
 * and `loam subsystem sync` deletes it — which is what SCHEMA, the message and
 * `/loam-adopt` step 5 had been promising all along.
 *
 * THE EXPORT LOSS IS THE WORSE HALF, NOT THE CERTAIN ONE, and the finding's
 * message says so since it was re-measured (re-verification 2026-09-04, area C
 * item 7). Same pin, two fleets: on the seeded fleet above the containers went
 * and came back when the file was deleted; on `examples/docs` a stray beside the
 * extending order-service left `export json --project fleet` byte-identical —
 * 33 elements, every `marketplace.orderService.*` child present — because there
 * the ROOT project kept the model. What is true in every state measured is the
 * second project itself: the docs root stops being a one-project workspace, and
 * `likec4 validate .` goes from ✓ Valid to ✗ Invalid ("Specify exact project,
 * known: [order-service, fleet]"). A message that asserted the export loss
 * unconditionally was refutable on the repository's own example fleet.
 *
 * A leftover beside a model that is GONE stays. That one really is the team's:
 * a nested project holding no `.likec4` file is silently absent from the
 * renderer's project list (measured), so it costs nothing, and a survey that
 * deleted files in directories it found no model in would be a writer acting on
 * an absence.
 *
 * THE NAME. LikeC4's project-name grammar (measured at the pin) refuses an
 * empty name, the word `default`, and the bytes `.`, `@` and `#`; loam's
 * service-id grammar admits `.`. So every `.` becomes `-`, and a name that
 * would then equal the ROOT project's (`fleet` — a nested project of that name
 * is silently registered as `fleet-1`) or LikeC4's reserved `default` is
 * prefixed `service-`. Readable and typeable after `--project`, and NOT
 * injective: an id spelled a.b beside a service literally named a-b, or
 * `service-fleet` beside `fleet`, share a name and the renderer suffixes the
 * later one `-1`. That is disclosed rather than escaped away, because the
 * picker shows the `title` (measured: `title ?? id`), which is ALWAYS the id
 * verbatim, and a collision costs one suffixed label rather than the blanked
 * workspace that made `subsystemViewId` injective. The root's name arrives as
 * a parameter, like every spelling this package needs from `repo/`: `render/`
 * cannot import `repo/paths.ts` (`stale.ts` records the cycle), and a second
 * copy of the word `fleet` here would be the drift the injection prevents.
 *
 * A DIRECTORY THAT IS NOT A LEGAL SERVICE ID IS OWED NO FILE. The tree walk
 * enumerates every directory on purpose — the fleet is never reported smaller
 * than it is — and `service.id-invalid` names the illegal ones. Folding only
 * `.` is right for every LEGAL id, whose remaining bytes LikeC4 accepts; a
 * name like `pay@1` would produce a project file the renderer silently drops
 * (measured: zero errors, the project simply absent from the list), and
 * because the file is create-only the grade below would then be silent
 * forever while the model stayed unrendered — the exact state this file
 * exists to remove, with a label saying it was fixed. So the survey skips
 * such a service: the writer creates nothing, the grader says nothing, and
 * `service.id-invalid`'s own repair — the rename — is what earns the file on
 * the first sync after it.
 *
 * NO MODEL, NO FILE: a service directory without `model.likec4` — one an
 * archive materialised, a spec-only baseline — is owed nothing, and gets its
 * file on the first `loam subsystem sync` after the model lands. A feature's
 * `delta.likec4` is deliberately out of scope: the directory is transient and
 * `loam archive` moves it where a project file would still be registered, so
 * every shipped feature would keep a dead project in the list forever.
 */
import { existsSync } from "node:fs";
import type { ServiceDir } from "../../../kernel/ids/dirs.js";
import { dirNameHazard } from "../../../kernel/ids/service.js";

/** LikeC4's own reserved project name; a file naming it is refused outright. */
const LIKEC4_RESERVED_PROJECT = "default";

/**
 * The project name for a service id — the id itself for every id made of
 * letters, digits, `_` and `-`, which is nearly all of them.
 */
export function serviceProjectName(id: string, rootProject: string): string {
  const folded = id.replace(/\./g, "-");
  return folded === rootProject || folded === LIKEC4_RESERVED_PROJECT ? `service-${folded}` : folded;
}

/**
 * The exact bytes of a service's project file: two keys, two-space JSON, LF,
 * one trailing newline — the root file's own serialisation. `title` is the id
 * verbatim, always, so whatever the renderer labels a project with is the
 * service's real identity even where `name` had to bend.
 */
export function renderServiceProject(id: string, rootProject: string): string {
  return `${JSON.stringify({ name: serviceProjectName(id, rootProject), title: id }, null, 2)}\n`;
}

/**
 * A service whose model has no project file beside it, and where the file
 * goes. The SERVICE travels whole — a walked service or a full entry,
 * whichever the caller surveyed — rather than its id: the grader spells the
 * finding's path from the entry's own placement, and a join back by id would
 * name the wrong directory the moment two services share a leaf name under
 * different subsystems (`subsystem.name-collision` — a broken tree the walk
 * still enumerates in full, and one this grade is emitted on by design).
 */
export interface ProjectGap<T> {
  service: T;
  /** Absolute path of the file `loam subsystem sync` will create. */
  path: string;
}

/**
 * One surveyed model: everything the writer and the four renderer grades ask
 * about a single `model.likec4`, answered in one walk.
 *
 * The SHAPE is on here rather than re-derived per grade because it decides
 * opposite things for the two of them: a model that stands alone is owed a
 * project file and must be excluded from the root project, and a model that
 * extends the map is owed neither and must NOT be excluded. Two readers of the
 * same bytes would be two chances to answer that backwards, and backwards is
 * not a warning — it is a renderer that shows nothing.
 */
export interface SurveyedModel<T> {
  service: T;
  /** Absolute path of the per-service project file, whether or not it exists. */
  path: string;
  /** True when the model declares its own element kinds — the caller's byte scan, injected. */
  standalone: boolean;
  /** True when a `likec4.config.json` already sits beside the model. */
  configured: boolean;
}

/** What one survey of the tree found: the gaps, the models behind them, and the domain they were counted against. */
export interface ProjectSurvey<T> {
  /** Every service owed a file and lacking one, sorted by id. */
  gaps: ProjectGap<T>[];
  /**
   * Every service owed NO file that has one anyway — an extending model with a
   * `likec4.config.json` beside it, sorted by id. The mirror of `gaps`, and the
   * same shape, because the writer does the same thing with it: `subsystem sync`
   * plans a delete where it plans a create, and `service.likec4-config-stray`
   * grades what is left. One predicate for both, so the grader can never name a
   * stray the writer would decline to remove.
   */
  strays: ProjectGap<T>[];
  /** Every model the survey considered, sorted by id — the four renderer grades walk this. */
  models: SurveyedModel<T>[];
  /**
   * Every service the survey considered at all — a model on disk, a legal id
   * — file or no file, whichever shape the model has. It is what the
   * root-missing note is owed to: without the root project file NOTHING under
   * `services/` is written, and the count a person needs there is how many
   * models the run walked past.
   */
  modelled: number;
  /**
   * The subset of those whose model STANDS ALONE — the only services owed a
   * project file at all, and therefore the domain `gaps` was drawn from.
   *
   * Apart from `modelled` because the two stopped meaning the same thing when a
   * model could extend the map, and one subtraction rested on their being
   * equal: `modelled - gaps.length` was "already had a file", and it counted
   * every extending model as one — a fleet that had just migrated reported N
   * services holding a file that must not exist. `standalone - gaps.length` is
   * the same subtraction over the domain that is actually owed the file.
   */
  standalone: number;
}

/**
 * ONE predicate for the writer (`subsystem sync`) and the grader
 * (`validate --all`), on `viewsState`'s precedent — two private spellings of
 * "is this model a project" would be two chances to answer differently about
 * one file, and a grader naming a gap the writer would not fill is a loop no
 * command can clear. Both the gaps AND the count live here for the same
 * reason: a caller re-deriving "has a model" beside this function is the
 * second spelling in another coat.
 *
 * Structural over `{ id, dir }` so a walked service and a full entry both fit,
 * and the two file spellings arrive injected (`repo/paths.ts`'s
 * `serviceRenderPaths`) for the package reason the banner gives. Sorted by id,
 * plain lexicographic like every list this package emits, so the writer's
 * report and the grader's findings come out in one stable order.
 */
export function surveyProjects<T extends { id: string; dir: ServiceDir }>(
  services: readonly T[],
  pathsOf: (dir: ServiceDir) => { model: string; project: string },
  isStandalone: (modelPath: string) => boolean,
): ProjectSurvey<T> {
  const models: SurveyedModel<T>[] = [];
  for (const service of services) {
    // The banner's rule: a name the renderer would refuse earns no file, and
    // `service.id-invalid` — not this survey — is what names the repair.
    if (dirNameHazard(service.id) !== null) continue;
    const paths = pathsOf(service.dir);
    if (!existsSync(paths.model)) continue;
    models.push({
      service,
      path: paths.project,
      // INJECTED rather than read here, and the reason is this package's
      // standing one: `render/` may not import `c4/` (see `./stale.ts` on the
      // cycle), and the shape is a fact about the model's GRAMMAR that
      // `c4/service-model/shape.ts` owns. A predicate crossing the boundary
      // keeps one scanner for the writer and the grader alike.
      standalone: isStandalone(paths.model),
      configured: existsSync(paths.project),
    });
  }
  models.sort((a, b) => (a.service.id < b.service.id ? -1 : a.service.id > b.service.id ? 1 : 0));
  return {
    // A model that EXTENDS the map is owed no project file: it belongs to the
    // root project, and a nested project file beside it CLAIMS it — the model
    // then parses alone, where the map's kinds are not, and the fleet project
    // loses the service's interior. So the gap set narrowed to the standalone
    // shape, and `strays` below is the grade's and the writer's other direction.
    gaps: models.filter((m) => m.standalone && !m.configured).map(({ service, path }) => ({ service, path })),
    // The other direction, and the one the banner's correction is about: the
    // nested project claims the model and the fleet project loses the service's
    // interior, so the file is removed rather than tolerated.
    strays: models.filter((m) => !m.standalone && m.configured).map(({ service, path }) => ({ service, path })),
    models,
    modelled: models.length,
    standalone: models.filter((m) => m.standalone).length,
  };
}
