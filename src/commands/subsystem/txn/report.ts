/**
 * What one `loam subsystem sync` SAYS it did — the `--json` envelope and the
 * human lines, in one place.
 *
 * It sits beside `./views.ts` and `./exclude.ts` because it is the third answer
 * about the same three files, and it moved out of `../sync.ts` for that file's
 * standing reason: `sync.ts` is the lock, the transaction and the plan, and it
 * reached the 400-line limit carrying the output too. Composing a report is not
 * a phase of the commit, so nothing here reads the disk or decides anything — a
 * caller hands over what happened and this spells it.
 */
import { emitJson } from "../../../core/envelope/json.js";
import type { CommitRecovery } from "../../../core/staging/interrupted.js";
import type { ExcludePlan } from "./exclude.js";
import { LANDSCAPE_UNREADABLE_NOTE } from "./views.js";

/**
 * What one sync did to the views file — and ONLY that file; the projects report
 * separately.
 *
 * `blocked` is the fifth answer: the map cannot be read, a generated file
 * already exists, and this run left it exactly as it is. The tolerant render
 * used to run anyway and rewrote a good file down to title and description
 * (verification 2026-09-04, W5). The project half is unaffected and still runs —
 * neither the per-service files nor the root `exclude` depend on the map.
 */
export type SyncAction = "current" | "created" | "updated" | "removed" | "blocked";

/** Why a run answered `blocked`. One reason today; a key rather than a bare string so a second one is additive. */
interface SyncBlocked {
  reason: "landscape-invalid";
}

/** The additive `projects` payload key, and what the text lines are composed from. */
export interface ProjectsReport {
  root: boolean;
  /** POSIX paths relative to the DOCS ROOT, written this run, sorted by path. */
  created: string[];
  /**
   * POSIX paths relative to the DOCS ROOT, DELETED this run, sorted by path — a
   * `likec4.config.json` beside a model that extends the map. `[]` rather than
   * absent on a run that removed none, so a consumer reads the key.
   *
   * SORTED BY PATH rather than by service id, which is the order the survey
   * hands them over in: `../sync.ts` sorts both arrays where it spells them, so
   * the `--json` list and the `removed <path>` lines below can never disagree.
   */
  removed: string[];
  current: number;
  modelled: number;
  exclude: ExcludePlan;
}

/** Everything one run has to say, as the caller knows it. */
export interface SyncReport {
  action: SyncAction;
  subsystems: number;
  recovered: CommitRecovery | null;
  projects: ProjectsReport;
  /** The map could not be read at all — the note is owed whether or not a file was protected. */
  mapUnreadable: boolean;
}

export function reportSync(json: boolean, out: SyncReport): void {
  // One reason today, and it is exactly the `action` it explains — spelled as a
  // record so a second cause is an added value rather than a re-read of the
  // sentence a person sees.
  const blocked: SyncBlocked | null = out.action === "blocked" ? { reason: "landscape-invalid" } : null;
  if (json) {
    emitJson({
      command: "subsystem",
      path: "architecture/subsystems.likec4",
      action: out.action,
      subsystems: out.subsystems,
      ...(blocked === null ? {} : { blocked }),
      ...(out.recovered === null ? {} : { recovered: out.recovered }),
      projects: {
        root: out.projects.root,
        created: out.projects.created,
        removed: out.projects.removed,
        current: out.projects.current,
        // Additive, and emitted in every mode including the untouched one: a
        // consumer must be able to read what the root project now excludes
        // without branching on whether this run happened to change it.
        //
        // `unreadable` travels with it because `entries: []` alone collapses the
        // two answers `readRootExclude` insists must stay apart — "the file
        // excludes nothing" and "loam could not read the file" are opposite
        // facts about what the renderer will load, and the text view had the
        // distinction while `--json` did not (verification 2026-09-04, review C).
        exclude: {
          updated: out.projects.exclude.updated,
          entries: out.projects.exclude.entries,
          added: out.projects.exclude.added,
          removed: out.projects.exclude.removed,
          unreadable: out.projects.exclude.unreadable,
        },
      },
    });
    return;
  }
  if (out.recovered !== null && out.recovered.outcome !== "consistent") {
    console.log(
      `note: recovered an interrupted \`loam ${out.recovered.command}\` commit first (${out.recovered.outcome}).`,
    );
  }
  console.log(views(out));
  // Owed on BOTH arms: the run that declined to rewrite an existing file, and
  // the run that wrote the tolerant shape because there was none to protect.
  if (out.mapUnreadable) console.log(LANDSCAPE_UNREADABLE_NOTE);
  projects(out.projects);
  exclude(out.projects);
}

/** The one line about the generated views file. */
function views(out: SyncReport): string {
  // "nothing to write" is a claim about the WHOLE run, and it is false the moment
  // any of this verb's three writers landed something beside a current views
  // file: a project file created, one removed, or the root `exclude` rewritten.
  // The third was missed when it was added, so the tail contradicted the very
  // next line of output (verification 2026-09-04, review C).
  const quiet =
    out.projects.created.length === 0 && out.projects.removed.length === 0 && !out.projects.exclude.updated;
  const sentence: Record<SyncAction, string> = {
    current: `architecture/subsystems.likec4 is current (${out.subsystems} subsystem(s))${quiet ? " — nothing to write." : "."}`,
    created: `wrote architecture/subsystems.likec4 — ${out.subsystems} subsystem view(s).`,
    updated: `updated architecture/subsystems.likec4 — ${out.subsystems} subsystem view(s).`,
    removed: `removed architecture/subsystems.likec4 — the tree has no subsystems, so the generated file must be absent.`,
    blocked:
      "architecture/subsystems.likec4 left as it is — architecture/ does not parse as one project, so the " +
      "render's element join is the landscape file's alone (a use-case document that binds an element of its " +
      "own is not in it), and rewriting the file would take its `include` lines with it.",
  };
  return sentence[out.action];
}

/** The per-service project files this run created and removed. */
function projects(out: ProjectsReport): void {
  if (out.created.length > 0) {
    console.log(
      `wrote ${out.created.length} services/<…>/likec4.config.json — one LikeC4 project per service model whose ` +
        "model stands alone (an existing file is yours and is never rewritten; commit the new ones before a " +
        "`loam subsystem move`, which refuses over untracked paths). With more than one project, " +
        "likec4 validate at the docs root needs --project <name>; build and export take every project.",
    );
  }
  // Named one per line: this is a DELETE of a file a team may have written, and
  // a count would leave a reader nothing to check against their own diff.
  for (const path of out.removed) console.log(`removed ${path}`);
  if (out.removed.length > 0) {
    console.log(
      "— that model extends the fleet map, and a project file beside it registers a second renderer project " +
        "rooted at the service directory: `likec4 validate .` then refuses without `--project`, and wherever " +
        "that project claims the model it loads it alone, where the map's kinds are not, and the fleet project " +
        "loses the service's interior. This is what `service.likec4-config-stray` names.",
    );
  }
  if (!out.root && out.modelled > 0) {
    console.log(
      "note: no likec4.config.json at the docs root, so no service project files were written — " +
        "`loam doctor` prints the root file.",
    );
  }
}

/** The root project's `exclude`, and the one state loam refuses to touch. */
function exclude(out: ProjectsReport): void {
  const plan = out.exclude;
  if (plan.updated) {
    // Named entries rather than a count: this line is the whole record of a
    // rewrite to a file the team owns, and "updated the exclude list" gives a
    // reader nothing to check against their own diff.
    const parts = [
      ...(plan.added.length > 0 ? [`+${plan.added.join(" +")}`] : []),
      ...(plan.removed.length > 0 ? [`-${plan.removed.join(" -")}`] : []),
    ];
    console.log(
      `rewrote likec4.config.json's \`exclude\` (${parts.join(" ")}) — the root project excludes exactly the ` +
        "models that stand alone; a model that extends the fleet map renders from the docs root and must not be excluded.",
    );
  }
  if (plan.unreadable) {
    console.log(
      "note: likec4.config.json at the docs root is not a JSON object with a string `exclude` list, so it was " +
        "left exactly as it is — loam does not rewrite a project file it cannot read.",
    );
  }
}
