/**
 * A feature's own flows, graded the way `validate --all` will grade them once
 * the archive has copied them into `architecture/usecases/`.
 *
 * WHY THIS EXISTS. The feature gate used to READ a feature's flows — parsed
 * over the map its own merge would leave (`../delta/overlay.ts`), which is
 * `usecase.flow-invalid` — and then grade only the promises they keep. Two
 * flows the very next `validate --all` convicts passed it: one whose hop joins
 * two services nothing on that map connects (`usecase.step-unbacked`), and one
 * tagged `#req-` with no `#cap-` to scope it, or with a `#req-` naming no
 * requirement (`usecase.requirement-unresolved`). Both archived at exit 0 under
 * "living spec + landscape are now complete + current." (the real-fleet review,
 * 2026-10-21). SCHEMA.md already said feature flows are graded against the map
 * the merge leaves behind; for every grade but the parse, they were not.
 *
 * THE FLEET'S GRADER, NOT A COPY. `./usecases.ts` is `validate --all`'s own
 * per-view loop — the opt-in, the capability and requirement tags, every hop —
 * handed the staged post-merge model, the vocabulary and requirement index the
 * merge would leave, and a `place` naming the file the author is still editing.
 * A second verdict→code mapping for this scope would be the drift that
 * package's banner forbids, and the drift would show up first as the gate
 * passing what the fleet then fails.
 *
 * Issues, because the archive gate files Issues: every finding the grader
 * writes carries a code the `IssueCode` union admits for exactly this
 * (`core/vocabulary/issue.ts`). The severities travel unchanged — the two
 * errors gate the archive, the two hop warnings and nothing else advise.
 */
import { relative } from "node:path";
import type { ParsedView } from "../../c4/parsed/dynamic-views.js";
import type { DocsDir } from "../../kernel/ids/dirs.js";
import type { Issue, IssueCode } from "../../vocabulary/issue.js";
import type { Finding } from "../../vocabulary/report.js";
import type { UseCaseScan } from "../fleet.js";
import { useCaseFindings } from "./usecases.js";

/** What the feature's flows are graded against — everything as the merge would leave it. */
export interface FeatureFlowScope {
  docsDir: DocsDir;
  /** The feature's flows, parsed over the post-merge map — the readable arm only; unreadable is `usecase.flow-invalid`. */
  scan: Extract<UseCaseScan, { kind: "read" }>;
  /** The capability ids the merge would leave declared, or `null` when the vocabulary suspends the tag grades. */
  capabilities: readonly string[] | null;
  /** The requirement ids each capability document would declare after the merge. */
  requirementsOf: (capability: string) => ReadonlySet<string> | undefined;
}

/**
 * The codes `useCaseFindings` writes, each mapped to its `IssueCode` member — a
 * table rather than a cast, so a sixth grade added to the fleet grader is a
 * thrown error the first time a feature trips it rather than a finding this
 * gate silently drops.
 */
const AS_ISSUE: Readonly<Record<string, IssueCode>> = {
  "usecase.capability-unresolved": "usecase.capability-unresolved",
  "usecase.requirement-unresolved": "usecase.requirement-unresolved",
  "usecase.step-unbacked": "usecase.step-unbacked",
  "usecase.step-contested": "usecase.step-contested",
  "usecase.step-unlinked": "usecase.step-unlinked",
};

/**
 * Where a feature flow's finding says the view is:
 * `features/FEAT-1-split/usecases/checkout.likec4 — dynamic view 'uc_checkout'`.
 * The staged parse has already mapped `sourcePath` back to the authored file;
 * this spells it docs-relative, the way every other feature finding names a file.
 */
function featurePlace(docsDir: DocsDir): (view: ParsedView) => string {
  return (view) => {
    const file = view.sourcePath === undefined ? "usecases/" : relative(docsDir, view.sourcePath).split(/[\\/]/).join("/");
    return `${file} — dynamic view '${view.id}'`;
  };
}

/**
 * One grader finding as the archive gate files it. Exported for the gate's
 * second use-case reader, a feature's service-local flows
 * (`../delta/service/grade.ts`), whose grader is the service target's and
 * writes the same five codes — one table, so neither scope can drop a code the
 * other files. `locations` travels: the service grader names the file a hop
 * is in, and an agent reading `--json` should not have to parse the prose for
 * it.
 */
export function asIssue(finding: Finding): Issue[] {
  if (finding.severity === "ok") return [];
  const code = AS_ISSUE[finding.code];
  if (code === undefined) {
    throw new Error(`the use-case grader wrote '${finding.code}', which the feature gate has no IssueCode for — add it to AS_ISSUE`);
  }
  return [
    {
      severity: finding.severity,
      code,
      ...(finding.subject === undefined ? {} : { subject: finding.subject }),
      ...(finding.details === undefined ? {} : { details: finding.details }),
      ...(finding.locations === undefined ? {} : { locations: finding.locations }),
      message: finding.message,
    },
  ];
}

export function featureFlowIssues(scope: FeatureFlowScope): Issue[] {
  const { scan } = scope;
  if (scan.views.length === 0) return [];
  return useCaseFindings({
    views: scan.views,
    elements: scan.model.elements,
    relationships: scan.model.relationships,
    services: scan.model.known,
    resolve: scan.resolve,
    capabilities: scope.capabilities,
    requirementsOf: scope.requirementsOf,
    place: featurePlace(scope.docsDir),
  }).flatMap(asIssue);
}
