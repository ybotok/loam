/**
 * The renderer's project file for ONE service — `services/<…>/<id>/likec4.config.json`
 * — the second thing under `services/` that exists only to be rendered.
 *
 * Why it exists. The root `likec4.config.json` scopes the fleet project to
 * `architecture/` and excludes `services/**`, and must: loam parses every
 * `.likec4` file ALONE, so each `model.likec4` declares its own `specification`
 * block, and a renderer merging the tree reports every declaration as a
 * duplicate. The cost of that exclusion went unstated for a release: an
 * adopted service's model — the artifact `loam adopt` spends the most effort
 * on — was a box on the fleet map with nothing renderable inside it from the
 * docs root, and the documented way to see it was one renderer invocation per
 * service directory. Measured at the 1.59.2 pin: a `likec4.config.json` INSIDE
 * a service directory is registered as a project of its own even though the
 * root excludes the directory (the root's `exclude` does not hide a nested
 * project file), the workspace then loads `fleet` plus one project per service
 * with zero errors, and each service project carries LikeC4's own `index` view
 * of the containers beside whatever view the model authors. One two-key file
 * per service directory is therefore what makes the model renderable from the
 * same root, in the same renderer, beside the map.
 *
 * CREATE-ONLY, never compared, never rewritten, never removed — the root
 * config's ownership rule (`core/docs.ts`: written once, never re-read, the
 * team owns it), NOT the generated views file's. The bytes are a function of
 * the service id alone, which SCHEMA.md defines as the identity no verb ever
 * changes, so nothing can make the file stale; a compare would only fight the
 * per-project keys LikeC4 lets a team add (`title`, styles, a contact), and
 * would restale every service on any change to this rule. Presence is the one
 * question loam owes the file, and presence needs no parse: rule 26 stands,
 * and loam still reads none of it. A leftover file after a model is deleted is
 * the team's, and harmless — measured, a nested project holding no `.likec4`
 * file is silently absent from the renderer's project list.
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

/** What one survey of the tree found: the gaps, and the domain they were counted against. */
export interface ProjectSurvey<T> {
  /** Every service owed a file and lacking one, sorted by id. */
  gaps: ProjectGap<T>[];
  /**
   * Every service the survey considered at all — a model on disk, a legal id
   * — file or no file. `modelled - gaps.length` is therefore "already had
   * one", derived from the same walk rather than counted a second way.
   */
  modelled: number;
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
): ProjectSurvey<T> {
  const gaps: ProjectGap<T>[] = [];
  let modelled = 0;
  for (const service of services) {
    // The banner's rule: a name the renderer would refuse earns no file, and
    // `service.id-invalid` — not this survey — is what names the repair.
    if (dirNameHazard(service.id) !== null) continue;
    const paths = pathsOf(service.dir);
    if (!existsSync(paths.model)) continue;
    modelled += 1;
    if (!existsSync(paths.project)) gaps.push({ service, path: paths.project });
  }
  gaps.sort((a, b) => (a.service.id < b.service.id ? -1 : a.service.id > b.service.id ? 1 : 0));
  return { gaps, modelled };
}
