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
import { existsSync } from "node:fs";
import { relative } from "node:path";
import type { LikeC4Error } from "../../../../core/c4/likec4.js";
import type { Requirement } from "../../../../core/document/spec.js";
import type { ServicePaths } from "../../../../core/repo/paths.js";
import type { ParsedView } from "../../../../core/c4/parsed/dynamic-views.js";
import { serviceResolver } from "../../../../core/c4/resolve/service.js";
import type { DocsDir } from "../../../../core/kernel/ids/dirs.js";
import { compareIds } from "../../../../core/repo/entries.js";
import type { ServiceFlowScan } from "../../../../core/usecases/service/flows.js";
import type { Finding } from "../../../../core/vocabulary/report.js";
import { errorText } from "../../../../core/c4/likec4.js";
import { CAP_TAG_PREFIX, REQ_TAG_PREFIX } from "../../../../core/capabilities/usecase-join.js";
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
    // The hint first, for `c4.invalid`'s reason (`../model/grade.ts`):
    // `capDetails` keeps ten lines, one broken document can carry more than ten
    // errors, and a diagnosis appended after them is dropped exactly when the
    // reader needs it.
    details: [...tagHint(errors), ...errors.map((error) => `${fileOf(scope, error)}: ${errorText(error)}`)],
    locations: [{ path: first, role: "primary" }],
  };
}

/** `Could not resolve reference to Tag named '#req-PAY-AUTH'.` — measured at the 1.59.2 pin. */
const UNDECLARED_TAG = /reference to Tag named '#?([\w.-]+)'/;

/**
 * The one line an undeclared RESERVED tag earns.
 *
 * The opt-in is a tag, LikeC4 refuses a tag no `specification` declares, and the
 * refusal is a bare `Could not resolve reference to Tag named …` — so an author
 * following the protocol's "tag the view `#req-<id>`" got a parse error naming
 * the thing they had just been told to write, with nothing saying a tag must be
 * declared first (verification 2026-09-04, D10). One line, from the first such
 * error only: the second one has the same repair.
 */
function tagHint(errors: readonly LikeC4Error[]): string[] {
  for (const error of errors) {
    const match = UNDECLARED_TAG.exec(error.message);
    const name = match?.[1];
    if (name === undefined) continue;
    // `cap-` and `req-` do NOT share a repair here, and covering both with one
    // hint sent an author two steps where one would do: declaring `tag cap-…`
    // makes the file parse and the very next run says `usecase.capability-
    // unresolved` — "no capability can be claimed inside this service's own
    // project. Drop the tag." A capability is claimed at fleet altitude, so the
    // tag can never resolve to anything beside a model, whatever is declared
    // (verification 2026-09-04).
    if (name.startsWith(CAP_TAG_PREFIX)) {
      return [
        `\`#${name}\` claims a capability, and a capability is claimed at FLEET altitude only — a flow beside ` +
          "model.likec4 is read in this service's own project, where no capability can be resolved. Declaring " +
          `\`tag ${name}\` makes the file parse and earns \`usecase.capability-unresolved\` on the next run: ` +
          `drop the tag, and tag the flow \`#${REQ_TAG_PREFIX}<Requirement-ID>\` instead, or draw it in ` +
          "`architecture/usecases/` where a capability tag belongs",
      ];
    }
    if (!name.startsWith(REQ_TAG_PREFIX)) continue;
    return [
      `declare \`tag ${name}\` in the \`specification { }\` block this project reads — model.likec4's own ` +
        "for a model that stands alone, the fleet map's for one that extends it (or a tags-only " +
        "`specification` in a document beside the model)",
    ];
  }
  return [];
}

/**
 * The FILE each finding is about, as `locations[0]`.
 *
 * The step and tag grades carry no `locations` of their own, so `findingJson`
 * fell back to the target's scope — `services/<tree>` and nothing else — and an
 * agent reading `--json`, which is the reason the envelope exists, had to parse
 * the prose to learn which `.likec4` to open. `usecase.flow-invalid` on this
 * same arm already names its file; these say the file the same way, with the
 * service directory kept beside it as `scope` (`../spine.ts`'s shape).
 */
function atView(scope: ServiceUseCaseScope, view: ParsedView, findings: Finding[]): Finding[] {
  const file = view.sourcePath === undefined ? `${scope.treePath}/` : `${scope.treePath}/${view.sourcePath}`;
  return findings.map((finding) =>
    finding.locations === undefined
      ? {
          ...finding,
          locations: [
            { path: file, role: "primary" as const },
            { path: scope.treePath, role: "scope" as const },
          ],
        }
      : finding,
  );
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
    const forView: Finding[] = [...serviceTagFindings(view, scope, place(view))];
    for (const step of view.steps) forView.push(...stepFindings({ view, step }, grading));
    findings.push(...atView(scope, view, forView));
  }
  return findings;
}

/**
 * The `Requirement-ID`s a service-local `#req-` tag may name: every identified
 * requirement of spec.md (living — a REMOVED one is on its way out and keeps no
 * promise) and of arch.spec.md, as ONE set. `undefined` when NEITHER document
 * exists, which the tag grade reads as "no requirement to satisfy" rather than
 * "none flattening to this slug" — the same two answers the fleet's
 * `requirementsOf` gives for a capability with no document at all.
 *
 * An id both documents declare resolves once (a set dedupes it); two ids that
 * merely flatten alike — `PAY.AUTH` in one file, `PAY-AUTH` in the other — are
 * the `many` arm, because a Requirement-ID is unique inside one document and a
 * flow beside the model has two.
 *
 * It lives beside the grade it feeds rather than in `../service.ts`, which is
 * the ORDER and nothing else: the set is this axis's input, its two answers are
 * this axis's vocabulary, and the order module had grown past its line limit
 * carrying it.
 */
export function requirementIdsOf(
  paths: ServicePaths,
  livingReqs: readonly Requirement[],
  archReqs: readonly Requirement[],
): ReadonlySet<string> | undefined {
  if (!existsSync(paths.spec) && !existsSync(paths.archSpec)) return undefined;
  const ids = new Set<string>();
  for (const req of [...livingReqs, ...archReqs.filter((r) => r.kind !== "REMOVED")]) {
    if (req.id !== undefined) ids.add(req.id);
  }
  return ids;
}
