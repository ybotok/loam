/**
 * The use-case axis of the SERVICE target: the `dynamic view`s a service's own
 * LikeC4 project declares, graded as the hop sequences behind its requirements.
 *
 * The fleet target grades flows drawn over the map (`../../fleet/usecases/`);
 * this grades flows drawn over ONE service's containers, which only that
 * service's project can resolve — the whole reason the slot exists
 * (`core/usecases/service/flows.ts` carries the report). The step grades are
 * the fleet's own `stepFindings`, reused with the service's project as the
 * model, the enumerated fleet as `services`, and one injection: where a
 * finding says the view is. A second verdict→code mapping here would be the
 * drift that package's banner forbids.
 *
 * ONLY VIEWS CARRYING A RESERVED TAG ARE GRADED, as at fleet altitude and for
 * the same reason: a service's `views.likec4` full of hand-drawn diagrams must
 * not turn red on upgrade. The reader applies the opt-in; this module never
 * sees an untagged view. Graded is narrower than LOADED, and the difference is
 * the reader's gate (`core/usecases/service/flows.ts`): an untagged sibling is
 * not even loaded while no view in the project opts in and no sibling mentions
 * either reserved prefix anywhere in its bytes — but once a view in
 * model.likec4 itself opts in, or a sibling mentions `req-` or `cap-` in a
 * comment or a title, every sibling is staged, and a project that does not
 * read is one `usecase.flow-invalid` whether or not any view in it opted in.
 *
 * A SIBLING THAT BREAKS THE PROJECT is ONE `usecase.flow-invalid` — reused,
 * because its meaning is exactly this ("loam could not read the flows against
 * the map they are drawn over, so it graded none of them, and the renderer
 * refuses the same project") applied to the service project instead of the
 * merge preview — and NEVER `c4.invalid`: that code means "model.likec4 does
 * not parse, every model check is suspended", and here the model parses and
 * every model check RAN. Reusing it would tell an agent to fix the wrong file
 * and tell the brief's `checks[]` row ("every other check stops here") a lie.
 */
import { relative } from "node:path";
import type { LikeC4Error } from "../../../../core/c4/likec4.js";
import type { ParsedView } from "../../../../core/c4/parsed/dynamic-views.js";
import { serviceResolver } from "../../../../core/c4/resolve/service.js";
import type { DocsDir } from "../../../../core/kernel/ids/dirs.js";
import { compareIds } from "../../../../core/repo/entries.js";
import type { ServiceFlowScan } from "../../../../core/usecases/service/flows.js";
import type { Finding } from "../../../../core/vocabulary/report.js";
import { errorText } from "../../checks/vocabulary.js";
import { stepFindings, type StepGrading } from "../../fleet/usecases/steps.js";
import { serviceTagFindings, type ServiceTagScope } from "./tags.js";

/** What the service's use-case grades run over. */
export interface ServiceUseCaseScope extends ServiceTagScope {
  /** The docs root, so a project error's absolute path can be spelled repo-relative. */
  docsDir: DocsDir;
  scan: ServiceFlowScan;
  /**
   * The `services/<id>/` directories that exist — the SAME enumerated set the
   * fleet target hands `stepFindings`, never an empty one: `StepGrading`
   * documents why the intra-service exemption is a guard and not a scope.
   */
  services: ReadonlySet<string>;
}

/** `<svc>: services/<tree>/<file> — dynamic view '<id>'` — the service target's spelling of `viewPlace`. */
function servicePlace(scope: ServiceUseCaseScope, view: ParsedView): string {
  // An absent `sourcePath` names the directory rather than guessing a file,
  // for `viewFile`'s reason; nothing at the 1.59.2 pin reaches that arm.
  return `${scope.service}: ${scope.treePath}/${view.sourcePath ?? ""} — dynamic view '${view.id}'`;
}

/** The repo-relative spelling of a project error's document, or the whole project when it carries none. */
function fileOf(scope: ServiceUseCaseScope, error: LikeC4Error): string {
  return error.sourceFsPath === undefined
    ? `${scope.treePath}/`
    : relative(scope.docsDir, error.sourceFsPath).split(/[\\/]/).join("/");
}

/**
 * The one finding a broken project earns. `details` is one `errorText` line
 * per error, each prefixed by its file, because the project may hold several
 * siblings and the fault may sit in any of them — including `model.likec4`
 * itself when a sibling re-declares its `specification` block, an error LikeC4
 * blames on both files. `locations` names the first broken file, in the sorted
 * order the reader produced.
 */
function flowInvalidFinding(scope: ServiceUseCaseScope, errors: readonly LikeC4Error[]): Finding {
  const files = [...new Set(errors.map((error) => fileOf(scope, error)))];
  const [first = `${scope.treePath}/`, ...others] = files;
  const named = others.length === 0 ? first : `${first} and ${others.length} more file(s)`;
  return {
    severity: "error",
    code: "usecase.flow-invalid",
    subject: scope.service,
    message:
      `${scope.service}: ${named} has ${errors.length} error(s) — every .likec4 beside model.likec4 is one LikeC4 ` +
      "project, read the way the renderer reads it, and the renderer refuses the whole project over one broken " +
      "file; no flow in it was graded. model.likec4 itself parses and is graded alone.",
    details: errors.map((error) => `${fileOf(scope, error)}: ${errorText(error)}`),
    locations: [{ path: first, role: "primary" }],
  };
}

/**
 * Every use-case finding a service's own project earns.
 *
 * Views are sorted by (file, view id) for the fleet grader's reason: nothing in
 * loam has measured that the parse preserves declaration order, and a report
 * whose row order depends on it would reorder under a dependency bump.
 */
export function serviceUseCaseFindings(scope: ServiceUseCaseScope): Finding[] {
  const { scan } = scope;
  if (scan.kind === "none") return [];
  if (scan.kind === "unreadable") return [flowInvalidFinding(scope, scan.errors)];

  const place = (view: ParsedView): string => servicePlace(scope, view);
  const grading: StepGrading = {
    model: scan.model,
    services: scope.services,
    // Built over the PROJECT's elements with the fleet set, exactly as the
    // attribution's own fallback tier resolves — so "which service is this
    // container" cannot be answered one way by `attributeStep` and another by
    // the provider guard.
    resolve: serviceResolver(scan.model.elements, scan.model.known),
    place,
  };
  const findings: Finding[] = [];
  const views = [...scan.views].sort(
    (a, b) => compareIds(a.sourcePath ?? "", b.sourcePath ?? "") || compareIds(a.id, b.id),
  );
  for (const view of views) {
    findings.push(...serviceTagFindings(view, scope, place(view)));
    for (const step of view.steps) findings.push(...stepFindings({ view, step }, grading));
  }
  return findings;
}
