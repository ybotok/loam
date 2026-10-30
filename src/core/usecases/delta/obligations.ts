/**
 * The obligations a feature's own flows carry, graded before the archive.
 *
 * WHY AT FEATURE SCOPE AT ALL. The obligation axis was a question about the
 * LIVING map, and for a tag on an edge that is still where it is asked. A flow
 * is different in the one way that matters to the people downstream of it: it
 * is the shape an architect answers a feature with. When the flow's
 * `#obl-<id>` applies an obligation to every hop it draws
 * (`../obligations/flows.ts`), each team on the path owes an arch
 * requirement covering its hop — and a gate that said so only after the
 * archive would tell them once the feature they were meant to build it in had
 * shipped. So the feature gate asks the fleet's two questions of the feature's
 * own `usecases/` flows, over the map its merge would leave behind.
 *
 * THE TWO QUESTIONS AND THEIR INDEXES.
 * - `obligation.unknown` (error): a tag `architecture/obligations.yaml` does not
 *   declare. Against the LIVING vocabulary, because nothing else exists — the
 *   vocabulary is edited directly, under review, and never through a feature —
 *   so an author introducing an obligation with its first flow declares it in
 *   the same change. An absent vocabulary is the axis's opt-out and is silence,
 *   exactly as at fleet scope; one that does not read is the fleet target's
 *   `obligation.invalid` and suspends the question here rather than restating it
 *   once per flow.
 * - `obligation.uncovered` (warning, never gates): a relationship a hop rides
 *   that no `Covers:` line THE MERGE WOULD LEAVE covers — every service's living
 *   requirements with this feature's deltas folded in
 *   (`../obligations/covers.ts`), so an arch requirement the feature ADDS for
 *   the hop answers it in the same change. A warning, as `c4.uncovered` is one
 *   scope over: the document is legal and the work is outstanding, which is an
 *   honest state for a feature in flight.
 *
 * Only a RESOLVED tag is asked about coverage, for the fleet grader's reason: a
 * tag naming nothing has earned its error, and asking every team on the path to
 * cover a rule that does not exist would be the same breach restated as work.
 */
import { closeIds, coversEdge, type CoversEntry } from "../../c4/arch.js";
import type { ParsedView } from "../../c4/parsed/dynamic-views.js";
import type { DocsDir } from "../../kernel/ids/dirs.js";
import { OBLIGATION_TAG_PREFIX, type ObligationVocabulary } from "../../obligations/obligations.js";
import { edgeKey, edgeOwner, hopEdges, viewObligations } from "../obligations/flows.js";
import { compareIds } from "../../repo/entries.js";
import type { Issue } from "../../vocabulary/issue.js";
import type { UseCaseScan } from "../fleet.js";
import { authoredFile, stepPlace } from "../place.js";

/** What the two questions are asked against — both thunks, so a feature whose flows carry no `#obl-` reads neither. */
export interface FeatureObligationInputs {
  /** The LIVING vocabulary, `architecture/obligations.yaml`. */
  vocabulary: () => Promise<ObligationVocabulary>;
  /** Every `Covers:` entry the feature's merge would leave, fleet-wide. */
  covers: () => Promise<readonly CoversEntry[]>;
}

/** One flow carrying one obligation. */
interface Carried {
  view: ParsedView;
  obligation: string;
}

/**
 * Every obligation issue a feature's own flows earn.
 *
 * `scan` is the readable arm the feature gate already holds — the flows parsed
 * over the post-merge map — so the hops are attributed against the same model
 * `usecase.step-unbacked` is graded on, and a hop that one check calls unbacked
 * is never one the other calls covered.
 */
export async function featureObligationIssues(
  scan: Extract<UseCaseScan, { kind: "read" }>,
  docsDir: DocsDir,
  inputs: FeatureObligationInputs,
): Promise<Issue[]> {
  // Sorted by (file, view id) for `gradedViews`' reason: when two flows ride
  // one edge the first one seen names the finding, and nothing in loam has
  // measured that the parse preserves declaration order.
  const file = authoredFile(docsDir);
  const views = [...scan.views].sort((a, b) => compareIds(file(a), file(b)) || compareIds(a.id, b.id));
  const carried: Carried[] = views.flatMap((view) => viewObligations(view).map((obligation) => ({ view, obligation })));
  if (carried.length === 0) return [];
  const vocabulary = await inputs.vocabulary();
  if (!vocabulary.present || vocabulary.invalid !== undefined) return [];

  const issues: Issue[] = carried
    .filter((c) => !vocabulary.byId.has(c.obligation))
    .map((c) => unknownIssue(c, file(c.view), [...vocabulary.byId.keys()]));
  const declared = carried.filter((c) => vocabulary.byId.has(c.obligation));
  if (declared.length === 0) return issues;

  const covers = await inputs.covers();
  const { elements, known } = scan.model;
  // Once per obligation and ENDPOINT PAIR across every flow of the feature —
  // the fleet grader's key, `<source> -> <target>` beside the obligation — so
  // two flows riding one edge owe one requirement, and the feature gate and the
  // next `validate --all` count the same findings.
  const asked = new Set<string>();
  for (const c of declared) {
    for (const hop of hopEdges(c.view, scan.model)) {
      const key = JSON.stringify([c.obligation, edgeKey(hop.edge)]);
      if (asked.has(key)) continue;
      asked.add(key);
      if (covers.some((entry) => coversEdge(entry, hop.edge, elements, known))) continue;
      // Spelled by service name where an end IS a service — the spelling that
      // resolves the same before and after the archive, which is what
      // `c4.uncovered` offers one scope over — and by the map's own id where it
      // is a topic or a partner system, which has no other name.
      const name = (id: string): string => {
        const service = scan.resolve(id);
        return known.has(service) ? service : id;
      };
      const owner = edgeOwner(hop.edge, scan.resolve, known);
      const cover = `${name(hop.edge.source)} -> ${name(hop.edge.target)}`;
      issues.push({
        severity: "warn",
        code: "obligation.uncovered",
        ...(owner === undefined ? {} : { subject: owner }),
        locations: [{ path: file(c.view), role: "primary" }],
        message:
          `${file(c.view)} — dynamic view '${c.view.id}' carries #${OBLIGATION_TAG_PREFIX}${c.obligation}, which applies to every hop it draws, ` +
          `and ${stepPlace(hop.step)} rides ${hop.edge.source} -> ${hop.edge.target}, which no arch requirement the merge would leave covers. ` +
          `Add a requirement with \`Covers: ${cover}\` and a scenario that proves it to ` +
          (owner === undefined ? "the arch.spec.md delta of whichever service answers for this hop" : `this feature's specs/${owner}/arch.spec.md`) +
          ` — or take the hop out of the flow if the obligation does not govern it.`,
      });
    }
  }
  return issues;
}

/** `obligation.unknown` for one flow's tag, with the close names the fleet grader offers. */
function unknownIssue(c: Carried, file: string, declared: string[]): Issue {
  const close = closeIds(c.obligation, declared);
  return {
    severity: "error",
    code: "obligation.unknown",
    subject: c.obligation,
    locations: [{ path: file, role: "primary" }],
    message:
      `${file} — dynamic view '${c.view.id}' is tagged #${OBLIGATION_TAG_PREFIX}${c.obligation}, and architecture/obligations.yaml declares no obligation '${c.obligation}'` +
      (close.length > 0 ? ` — did you mean: ${close.join(", ")}?` : "") +
      ". A flow's tag applies the obligation to every hop it draws, so one naming nothing reads exactly like a rule the fleet keeps. " +
      "Fix the tag, or declare the obligation in architecture/obligations.yaml in this same change — the vocabulary is edited directly, never through a feature.",
  };
}
