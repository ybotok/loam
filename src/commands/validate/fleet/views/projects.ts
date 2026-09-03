/**
 * A service whose model has no LikeC4 project file beside it —
 * `services/<…>/<id>/model.likec4` exists and `services/<…>/<id>/likec4.config.json`
 * does not — graded as ONE warning per service on the fleet target.
 *
 * WHY A WARNING. The root `likec4.config.json` excludes `services/**` (it
 * must: every model declares its own `specification` block, and a renderer
 * merging the tree reports each one as a duplicate), so a model with no
 * project of its own is a box on the fleet map with nothing renderable inside
 * it from the docs root. That is no picture, and no picture is not a wrong
 * picture: every fact loam grades about the model — its parse, its bindings,
 * its edges into the spine — holds exactly as it did, so nothing here may
 * gate. ROADMAP's clause that rendering "must stay outside validation so view
 * computation cannot slow or change the gate" is about computing views; this
 * check computes nothing and reads nothing — it is one `existsSync` per
 * service, on `viewsStaleFindings`' precedent of grading a renderer-only file
 * by its presence. And the sibling that grades the ROOT file's absence
 * (`doctor.likec4-config-missing`, `core/doctor/doctor.ts`) calls a repo
 * without it "only unrenderable" and warns; the per-service absence is the
 * same condition one directory down and earns the same severity.
 *
 * WHY `validate --all` AND NOT `doctor`. `doctor` is the step-0 preflight
 * of the adopt protocol — wiring, the config, the fleet map's readability —
 * and the protocol's step 5 is the `validate --all` run whose findings the
 * agent branches on. The report that motivated this check had its own
 * `doctor --json` answer `healthy: true` with 0 findings on a tree where every
 * adopted model was unrenderable from the root: the model is written in step
 * 3, so its renderability is a fact that first exists at step 5, and a
 * preflight that ran before the model did could not have said otherwise.
 * Never in `validate --service`, `status` or `doctor`: the writer is a fleet
 * verb (`subsystem sync`) and the finding belongs beside the file that verb
 * owns.
 *
 * WHY PER SERVICE. `subject` is the service id so a `--json` worklist filters
 * by team the way `landscape.service-unmodelled` already lets it — one fleet
 * finding listing every gap would have to be re-parsed to find out whose it
 * is. The `scope` location is the service's tree path, through
 * `serviceTreePath` on the ENTRY the survey hands back — never a join by id:
 * this grade is emitted before the map's early returns precisely so it holds
 * on a broken tree, and a tree with two services sharing a leaf name under
 * different subsystems (`subsystem.name-collision`) is exactly such a tree,
 * still enumerated in full. Joined by id, both findings named the first
 * directory while `subsystem sync` wrote both files at the right paths.
 *
 * WHY THE ROOT GATE, and it does double duty. Semantically: the writer
 * creates a per-service project only when the root `likec4.config.json`
 * exists (the docs root is then a LikeC4 workspace and a nested project is
 * registered inside it — measured at the 1.59.2 pin), so a repo without the
 * root file has `doctor` telling it to write that first and nothing to sync
 * into; grading a gap the writer would not fill is a loop no command can
 * clear. The same rule silences a directory whose name is not a legal service
 * id: the survey skips it (`render/projects.ts` says why), `service.id-invalid`
 * already names it, and a warning here would advertise a repair `sync`
 * refuses to perform. Fixture-wise: `makeProject` writes NO root file, so
 * every existing fixture stays silent under this gate, and the two suites
 * that pin a fleet's warning set exactly (`test/examples.test.ts`,
 * `test/self-model.test.ts`) ship the per-service files and keep their
 * counts. A future fixture that scaffolds with `init --create` and pins its
 * warnings WILL move by one per model-bearing service, and that is this gate
 * working, not breaking.
 */
import { existsSync } from "node:fs";
import { serviceTreePath, type DocsDir } from "../../../../core/kernel/ids/dirs.js";
import type { ServiceEntry } from "../../../../core/repo/entries.js";
import { ARTIFACT_FILES, LIKEC4_PROJECT_FILENAME, rootProjectPath, serviceRenderPaths } from "../../../../core/repo/paths.js";
import { surveyProjects } from "../../../../core/repo/tree/render/projects.js";
import type { Finding } from "../../../../core/vocabulary/report.js";

/**
 * `entries` is the fleet enumeration at whatever depth each service lives;
 * the predicate is `surveyProjects` — the ONE spelling of "has a model,
 * lacks a project file" that `subsystem sync` also fills — so the grader can
 * never name a gap the writer would leave.
 */
export function projectFindings(docsDir: DocsDir, entries: readonly ServiceEntry[]): Finding[] {
  if (!existsSync(rootProjectPath(docsDir))) return [];
  return surveyProjects(entries, serviceRenderPaths).gaps.map(({ service }) => {
    const tree = serviceTreePath(service);
    return {
      severity: "warn",
      code: "service.likec4-config-missing",
      subject: service.id,
      // `scope`, not `primary`: the file does not exist yet, and the
      // actionable place is the directory the writer will create it in.
      locations: [{ path: tree, role: "scope" as const }],
      message:
        `${service.id}: ${tree}/${ARTIFACT_FILES.model} exists and ${tree}/${LIKEC4_PROJECT_FILENAME} does not — ` +
        "the root LikeC4 project excludes services/**, so this model renders only as a project of its own, " +
        "and nothing renders it from the docs root now. Run `loam subsystem sync`; it writes the file (create-only) — never write it by hand.",
    };
  });
}
