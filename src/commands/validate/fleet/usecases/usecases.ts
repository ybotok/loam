/**
 * The use-case axis of `validate --all`: the `dynamic view`s a fleet declares,
 * graded as business flows against the model they are drawn over.
 *
 * ONLY CAPABILITY-TAGGED VIEWS ARE GRADED, and that opt-in is what lets this
 * ship into a fleet that already has diagrams. An untagged `dynamic view` is
 * somebody's hand-drawn sequence — drawn to explain something to a person, not
 * to be joined to a model — and grading it would turn every existing docs repo
 * red on upgrade over documents nobody promised anything about. A `#cap-` tag is
 * the author saying "this is a use case; hold it to the model", and nothing else
 * says it: a view with no tags and a view whose tags are all somebody's own
 * vocabulary are the same thing here.
 *
 * THE TAG OPTS A VIEW IN WHETHER OR NOT IT RESOLVES. A `#cap-` slug that names
 * no declared capability is a broken claim about the vocabulary, not a withdrawn
 * one, so its steps are still graded — and the step grades read
 * `architecture/capabilities.yaml` nowhere at all. Coupling them would mean a
 * fleet that has not adopted the capability axis could never have a use case
 * checked, which inverts the adoption order the whole axis is built on: draw the
 * flow first, name the capability when the vocabulary exists.
 *
 * Everything here is LINEAR IN STEPS over documents `validate --all` has already
 * parsed, and nothing in it reads a file or throws — a fleet with no tagged view
 * produces exactly nothing. Linear in steps is not free per step: `attributeStep`
 * scans `relationships` once for the exact tier and again for the resolved one,
 * and `isActor` scans `elements`, so the real shape is O(steps × relationships)
 * plus O(steps × elements). That is why `StepGrading` is built once below rather
 * than per hop — the per-hop cost is a scan, so anything rebuilt per hop is paid
 * against every hop in the fleet.
 */
import { compareIds } from "../../../../core/repo/entries.js";
import { CAP_TAG_PREFIX } from "../../../../core/capabilities/usecase-join.js";
import type { Elem, Rel } from "../../../../core/c4/likec4.js";
import type { ParsedView } from "../../../../core/c4/parsed/dynamic-views.js";
import type { Finding } from "../../../../core/vocabulary/report.js";
import { capabilityTagFindings } from "./capability-tag.js";
import { stepFindings, type StepGrading } from "./steps.js";
import { viewFile } from "./place.js";

/** What the use-case grades run over: the views, the model they are drawn on, and the fleet. */
export interface UseCaseScope {
  /**
   * Every `dynamic view` the `architecture/` PROJECT declares, each carrying the
   * file it was written in.
   *
   * The caller must pass views that came from `loadProject` and no others. Only
   * that loader gives a view a `sourcePath` relative to `architecture/`; the
   * single-file loaders name every document after themselves (`source.c4`), and
   * a finding built from one of those would name a file that has never existed
   * — see `./place.ts`, which is where the path is spelled.
   */
  views: readonly ParsedView[];
  elements: Elem[];
  relationships: Rel[];
  /** The `services/<id>/` directories that exist. */
  services: ReadonlySet<string>;
  /** The shared element→service resolver — the same one every other edge join uses. */
  resolve: (id: string) => string;
  /**
   * The declared capability ids, or `null` when `architecture/capabilities.yaml`
   * is absent or does not read as a vocabulary.
   *
   * `null` and `[]` are deliberately different answers, and the join at
   * `core/capabilities/usecase-join.ts` says why it cannot tell them apart
   * itself: an empty list means "the fleet declares no capabilities", which is a
   * real verdict every tag then fails against, while `null` means "there is no
   * vocabulary to grade against" and suspends the tag grade entirely. The
   * caller applies the ladder because the caller is the one that read the file.
   */
  capabilities: readonly string[] | null;
}

/**
 * The capability-tagged views, in a stable order.
 *
 * Sorted by (file, view id) rather than reported in LikeC4's own record order:
 * nothing in loam has measured that the parse preserves declaration order, so a
 * report whose row order depends on that would reorder under a dependency bump
 * — the diff-stability rule `core/capabilities/rollup.ts` states for its rows,
 * applied to findings. The prefix test matches `resolveCapabilityTags`'s exactly,
 * case included, so a view can never be opted in here and read as untagged there.
 */
function gradedViews(views: readonly ParsedView[]): ParsedView[] {
  return views
    .filter((view) => view.tags.some((tag) => tag.startsWith(CAP_TAG_PREFIX)))
    .sort((a, b) => compareIds(viewFile(a), viewFile(b)) || compareIds(a.id, b.id));
}

/**
 * Every use-case finding a fleet's declared views earn.
 *
 * The grading record is built once and shared across every step of every view:
 * `attributeStep` caches its element→service resolver on the identity of the
 * elements array and the fleet set, so handing it one `StepScope` for the whole
 * run is what keeps the fleet's use cases from rebuilding that id map per hop.
 */
export function useCaseFindings(scope: UseCaseScope): Finding[] {
  const grading: StepGrading = {
    // `known` and `services` come from ONE value, so the fleet set the
    // attribution resolves against and the fleet set the provider guard tests
    // cannot drift apart into two answers about the same element.
    model: { elements: scope.elements, relationships: scope.relationships, known: scope.services },
    services: scope.services,
    resolve: scope.resolve,
  };
  const findings: Finding[] = [];
  for (const view of gradedViews(scope.views)) {
    findings.push(...capabilityTagFindings(view, scope.capabilities));
    for (const step of view.steps) findings.push(...stepFindings({ view, step }, grading));
  }
  return findings;
}
