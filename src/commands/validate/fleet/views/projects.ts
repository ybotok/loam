/**
 * The four ways a service's `model.likec4` and the renderer's project files can
 * disagree, graded as one warning per service on the fleet target — plus the
 * one way the same root config can hide the fleet MAP, graded once for the
 * fleet (`landscape.excluded`, at the foot of this module).
 *
 * They are one walk because they are one question — "can the renderer actually
 * show what this model says?" — asked of the two shapes a model has. A model
 * that STANDS ALONE (declares its own element kinds) is parsed alone: it needs a
 * project file of its own, and the root project must exclude its directory. A
 * model that EXTENDS the fleet map declares no kinds and lives IN the root
 * project: it must NOT be excluded, and a project file beside it TAKES it out of
 * there — measured at the 1.59.2 pin, the nested project claims the model, which
 * then does not resolve (the map's kinds are not in there with it) and the fleet
 * project loses the service's interior. Each shape therefore owes the opposite of
 * the other, and each of the four codes below is one half of one of those pairs:
 *
 *  - `service.likec4-config-missing` — standalone, no project file.
 *  - `service.likec4-config-stray`   — extending, project file present.
 *  - `service.model-excluded`        — extending, root `exclude` covers it. Two
 *    questions, not one: the DIRECTORY (`excludingEntry`, which `subsystem sync`
 *    can repair) and, where that says no, the model FILE (`excludingPath`, which
 *    it cannot — the message says so).
 *  - `service.model-unexcluded`      — standalone, root `exclude` does not.
 *
 * `landscape.excluded` is the fifth, and it is the same question asked one
 * level up: the root `exclude` covering `architecture/landscape.likec4` itself.
 *
 * WHY WARNINGS. Every fact loam grades about a model — its parse, its bindings,
 * its edges into the spine — holds exactly as it did in all five states, so
 * nothing here may gate. The fifth is only true because the architecture loader
 * keeps the map whatever the root `exclude` says (`core/c4/project/architecture.ts`);
 * before it did, an excluded map blanked every cross-service grade in the run. ROADMAP's clause that rendering "must stay outside
 * validation so view computation cannot slow or change the gate" is about
 * computing views; this check computes nothing: one `existsSync` per service and
 * one read of the root config. And the sibling that grades the ROOT file's
 * absence (`doctor.likec4-config-missing`, `core/doctor/doctor.ts`) calls a repo
 * without it "only unrenderable" and warns; these are the same condition one
 * directory down and earn the same severity.
 *
 * WHY `validate --all` AND NOT `doctor`. `doctor` is the step-0 preflight of the
 * adopt protocol — wiring, the config, the fleet map's readability — and the
 * protocol's step 5 is the `validate --all` run whose findings the agent
 * branches on. The report that motivated the first of these codes had its own
 * `doctor --json` answer `healthy: true` with 0 findings on a tree where every
 * adopted model was unrenderable from the root: the model is written in step 3,
 * so its renderability is a fact that first exists at step 5, and a preflight
 * that ran before the model did could not have said otherwise. Never in
 * `validate --service`, `status` or `doctor`: the writer is a fleet verb
 * (`subsystem sync`) and the findings belong beside the files that verb owns.
 *
 * WHY PER SERVICE. `subject` is the service id so a `--json` worklist filters by
 * team the way `landscape.service-unmodelled` already lets it — one fleet
 * finding listing every gap would have to be re-parsed to find out whose it is.
 * The `scope` location is the service's tree path, through `serviceTreePath` on
 * the ENTRY the survey hands back — never a join by id: these grades are emitted
 * before the map's early returns precisely so they hold on a broken tree, and a
 * tree with two services sharing a leaf name under different subsystems
 * (`subsystem.name-collision`) is exactly such a tree, still enumerated in full.
 * Joined by id, both findings named the first directory while `subsystem sync`
 * wrote both files at the right paths.
 *
 * WHY THE ROOT GATE, and it does double duty. Semantically: `subsystem sync`
 * writes nothing — no per-service file, no rewritten `exclude` — until the root
 * `likec4.config.json` exists (the docs root is then a LikeC4 workspace and a
 * nested project is registered inside it — measured at the 1.59.2 pin), so a
 * repo without the root file has `doctor` telling it to write that first and
 * nothing to sync into; grading a gap the writer would not fill is a loop no
 * command can clear. The same rule silences a directory whose name is not a
 * legal service id: the survey skips it (`render/projects.ts` says why),
 * `service.id-invalid` already names it, and a warning here would advertise a
 * repair `sync` refuses to perform. Fixture-wise: `makeProject` writes NO root
 * file, so every existing fixture stays silent under this gate, and the suites
 * that pin a fleet's warning set exactly (`test/examples.test.ts`,
 * `test/self-model.test.ts`) ship the files their shapes call for and keep their
 * counts.
 *
 * The exclude half has a SECOND gate, inside `readRootExclude`: a root config
 * loam cannot read an `exclude` list out of answers `null`, and both grades that
 * read it stay silent. loam does not know what the renderer will do with a file
 * it could not parse, and asserting an exclusion on evidence it does not have is
 * worse than saying nothing.
 */
import { existsSync } from "node:fs";
import { relative, resolve } from "node:path";
import type { ModelShape } from "../../../../core/c4/service-model/shape.js";
import { excludingEntry, excludingPath, readRootExclude } from "../../../../core/c4/root-project/exclude.js";
import { serviceTreePath, type DocsDir } from "../../../../core/kernel/ids/dirs.js";
import type { ServiceEntry } from "../../../../core/repo/entries.js";
import { ARTIFACT_FILES, landscapePath, LIKEC4_PROJECT_FILENAME, rootProjectPath, serviceRenderPaths } from "../../../../core/repo/paths.js";
import { surveyProjects } from "../../../../core/repo/tree/render/projects.js";
import type { Finding } from "../../../../core/vocabulary/report.js";

/**
 * The five grades, and the one FACT out of them a second check has to branch on.
 *
 * `mapExcluded` is `landscape.excluded`'s own condition, handed out rather than
 * re-derived: `c4.fleet-project-invalid` loads the fleet project the way the
 * RENDERER does — without the architecture loader's floor under the map — so the
 * same entry that hides the map makes every extending model's `extend` fail to
 * resolve, and one bad line in `exclude` came back as 161 warnings on a
 * five-service fleet. Two spellings of "is the map excluded" would be two
 * chances for the cause and its cascade to disagree about whether they are
 * looking at the same state, which is exactly the pairing the boolean exists to
 * keep.
 */
export interface ProjectGrade {
  findings: Finding[];
  /** True when the root `exclude` covers `architecture/landscape.likec4` — see above. */
  mapExcluded: boolean;
}

/**
 * `entries` is the fleet enumeration at whatever depth each service lives, and
 * `shapes` is the shape of every model in it, keyed by resolved path
 * (`FleetContext.modelShapes`). The shape map is built over the FULL enumeration
 * rather than a `--base` narrowing: a model missing from it would read as
 * standalone, which is the wrong half of every pair above.
 *
 * The predicate handed into the survey is the ONE spelling of "has a model,
 * lacks a project file" that `subsystem sync` also fills, so the grader can
 * never name a gap the writer would leave.
 */
export async function projectFindings(
  docsDir: DocsDir,
  entries: readonly ServiceEntry[],
  shapes: ReadonlyMap<string, ModelShape>,
): Promise<ProjectGrade> {
  // No root project file, no root project — and no `exclude` list either, so the
  // map is not excluded by anything loam can see. `false` here is a fact, not a
  // default: `readRootExclude` would answer `null` one line down and every grade
  // below it stays silent for the same reason.
  if (!existsSync(rootProjectPath(docsDir))) return { findings: [], mapExcluded: false };
  const survey = surveyProjects(entries, serviceRenderPaths, (model) => shapes.get(resolve(model)) !== "extending");
  const exclude = await readRootExclude(docsDir);
  const findings: Finding[] = [];
  // The ONE derivation. The boolean is read off the finding rather than computed
  // beside it, so a fleet where `c4.fleet-project-invalid` is suspended is by
  // construction a fleet where `landscape.excluded` says why.
  const excluded = mapExcluded(docsDir, exclude);
  findings.push(...excluded);
  for (const model of survey.models) {
    const tree = serviceTreePath(model.service);
    // Everything the four share, so each push below is its code and its
    // sentence and nothing else. `scope`, not `primary`: two of the four are
    // about a file that does not exist yet, and the actionable place is the
    // directory either way.
    const at = {
      severity: "warn" as const,
      subject: model.service.id,
      locations: [{ path: tree, role: "scope" as const }],
    };
    if (model.standalone && !model.configured) {
      findings.push({
        ...at,
        code: "service.likec4-config-missing",
        message:
          `${model.service.id}: ${tree}/${ARTIFACT_FILES.model} exists and ${tree}/${LIKEC4_PROJECT_FILENAME} does not — ` +
          "a model that stands alone (declares its own `specification`) renders only as a project of its own, " +
          "and nothing renders it from the docs root now. Run `loam subsystem sync`; it writes the file (create-only) — never write it by hand.",
      });
    }
    if (!model.standalone && model.configured) {
      findings.push({
        ...at,
        code: "service.likec4-config-stray",
        message:
          `${model.service.id}: ${tree}/${ARTIFACT_FILES.model} extends the fleet map and ${tree}/${LIKEC4_PROJECT_FILENAME} ` +
          "sits beside it — the renderer registers that file as a project of its own rooted at that directory, so " +
          "the docs root stops being a one-project workspace (`likec4 validate .` then refuses without `--project`), " +
          "and wherever that nested project claims the model it parses alone, out of the root project where the " +
          "map's kinds are: the model does not resolve and `export json --project fleet` loses this service's " +
          "containers (measured, likec4 1.59.2 — which of the two happens depends on the workspace, and neither is " +
          "a state this file buys anything in). Run `loam subsystem sync`; it deletes the file (or delete it " +
          "yourself). loam never writes one beside an extending model",
      });
    }
    // `excludingEntry` reports the entry VERBATIM because the repair is to
    // delete or narrow THAT line, and a fleet that files its services under
    // subsystems is excluded by `services/platform/**` rather than by anything
    // naming the service — a message that did not quote the entry would send
    // its reader looking for a line that is not there.
    const entry = exclude === null ? null : excludingEntry(exclude, tree);
    // THE SECOND QUESTION, and the state that was silent until it was asked:
    // an entry shaped like a FILE hides the model without covering the
    // directory. `services/**/model.likec4` and the bare `**/model.likec4` each
    // took every extending model out of the renderer on `examples/docs` — 3
    // source files of 8, five drill-down views gone from the export — with the
    // whole run reporting 0 errors and not one line containing the word
    // "exclude" (re-verification 2026-09-04, area C item 5). It is asked ONLY
    // where the directory question said no, because that arm names an entry
    // `subsystem sync` can take back and this one names an entry it cannot.
    const fileEntry =
      exclude === null || entry !== null ? null : excludingPath(exclude, `${tree}/${ARTIFACT_FILES.model}`);
    const hiding = entry ?? fileEntry;
    if (exclude !== null && !model.standalone && hiding !== null) {
      findings.push({
        ...at,
        code: "service.model-excluded",
        message:
          `${model.service.id}: ${tree}/${ARTIFACT_FILES.model} extends the fleet map and the root ` +
          `${LIKEC4_PROJECT_FILENAME} excludes it ('${hiding}') — the renderer never loads it, so the service is ` +
          "a box with nothing inside it from the docs root. " +
          (entry === null
            ? // The repair is an EDIT, not a command, and saying otherwise is the
              // loop `landscape.excluded` already refuses to open: sync recomputes
              // only the `services/<tree>/**` entries and would report success
              // having changed nothing.
              "That entry hides the model file without covering " +
              `${tree}/, so \`loam subsystem sync\` cannot repair it: sync maintains only the ` +
              "`services/` directory entries and leaves every other line exactly as the team wrote it. Narrow that " +
              "entry to the paths it was written for, or delete it"
            : "Run `loam subsystem sync`: it rewrites the root project's `exclude` to cover exactly the models " +
              "that stand alone"),
      });
    }
    if (exclude !== null && model.standalone && entry === null) {
      findings.push({
        ...at,
        code: "service.model-unexcluded",
        message:
          `${model.service.id}: ${tree}/${ARTIFACT_FILES.model} stands alone (declares its own specification) and ` +
          `the root ${LIKEC4_PROJECT_FILENAME} does not exclude ${tree}/ — the renderer merges it into the map ` +
          "and reports every kind and element it declares as a duplicate, blanking the whole root project. " +
          `Run \`loam subsystem sync\`: it adds ${tree}/** to the root project's \`exclude\``,
      });
    }
  }
  return { findings, mapExcluded: excluded.length > 0 };
}

/**
 * `landscape.excluded` — the root `exclude` covers the fleet MAP itself.
 *
 * WHY IT EXISTS AT ALL, and why only now. The architecture loader used to apply
 * the root `exclude` with no floor under it, so an entry covering
 * `architecture/landscape.likec4` — an `architecture/*.likec4` written for a
 * palette, say — left that project EMPTY, and an empty project parses with zero
 * errors. Every reader downstream took that for "the map declares nothing":
 * `landscape.service-unmodelled` on every service, `c4.invalid` on every
 * extending model, `subsystem sync` cutting a good generated file back to a
 * title (verification 2026-09-04, review C). The loader now keeps the map
 * whatever the list says, so loam has stopped asserting those falsehoods — but
 * the RENDERER still applies the entry, and it has no floor. Nothing told the
 * author that the fleet map they are grading is a map nobody can open. This is
 * that sentence, and it is the only finding in the run that names it.
 *
 * WARN, NEVER GATING, for the reason the module banner gives: with the loader's
 * floor in place, every fact loam grades holds identically either way. The gap
 * is a renderer gap, exactly like the four per-service grades above.
 *
 * THE SAME ROOT GATE covers it — the caller returns early with no root
 * `likec4.config.json`, and a config loam cannot read an `exclude` list out of
 * answers `null`, which says nothing rather than guessing. It is gated on the
 * map EXISTING as well: with no file there, `landscape.missing` is the finding
 * and an entry covering a path nobody wrote is not a repair anyone owes.
 *
 * `excludingPath`, not `excludingEntry`: the map is a FILE, and this must fire
 * exactly when `architectureProjectDocuments` would have dropped it — same
 * list, same matcher, same argument. Asking the directory question instead
 * would answer for `architecture/` as a whole and miss `architecture/*.likec4`,
 * which is the spelling that caused the defect.
 *
 * The repair is NOT `loam subsystem sync`, and the message says so where the
 * four grades above name it: sync recomputes only the `services/<tree>/**`
 * entries and leaves every other line in the order the team wrote it, so it
 * would report success and change nothing. The four had a writer; this one has
 * an author.
 *
 * AND IT SUSPENDS `c4.fleet-project-invalid`, which is the cascade discipline
 * `permissions.invalid` and `capability.invalid` already state: a grade that
 * RESOLVES against a document nobody loaded is not a diagnosis. That check
 * builds the fleet project the way the renderer does — no floor under the map —
 * so the very entry named here takes the map out of it and every `extend` in
 * every extending model then resolves against nothing. Measured on
 * `examples/docs` with `architecture/*.likec4` in the list: one
 * `landscape.excluded` and **161** `c4.fleet-project-invalid`, all of them one
 * line's fault. The message carries that clause so the reader knows the fleet
 * project is unread rather than clean, and the caller reads the same fact off
 * `ProjectGrade.mapExcluded` — see `./fleet-project.ts`'s `mapExcluded` gate.
 */
function mapExcluded(docsDir: DocsDir, exclude: readonly string[] | null): Finding[] {
  const map = landscapePath(docsDir);
  if (exclude === null || !existsSync(map)) return [];
  const rel = relative(docsDir, map).split(/[\\/]/).join("/");
  const entry = excludingPath(exclude, rel);
  if (entry === null) return [];
  return [
    {
      severity: "warn",
      code: "landscape.excluded",
      // Quoted VERBATIM, for `service.model-excluded`'s reason one level down:
      // the repair is to edit THAT line, and an entry loam re-spelled is a line
      // its author would go looking for and not find.
      message:
        `landscape: the root ${LIKEC4_PROJECT_FILENAME}'s \`exclude\` covers ${rel} ('${entry}') — the renderer never ` +
        "loads the fleet map, so it draws no map at all and every model that EXTENDS the map resolves against " +
        "nothing in the root project, while loam goes on grading the map it reads from disk. `c4.fleet-project-invalid` " +
        "is NOT graded while this entry stands: that check loads the fleet project the way the renderer does, so it " +
        "would report the same one line as an unresolved reference in every extending model rather than as this. " +
        "Remove that entry, or " +
        `narrow it to the paths it was written for, and the fleet project is graded again. \`loam subsystem sync\` ` +
        "will not do it: that command maintains " +
        "only the `services/` entries in the list and leaves every other line exactly as the team wrote it",
      locations: [{ path: rel, role: "primary" }],
    },
  ];
}
