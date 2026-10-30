/**
 * The use-case axis of `validate --all`: the `dynamic view`s a fleet declares,
 * graded as business flows against the model they are drawn over.
 *
 * IN `core/` SINCE THE FEATURE GATE BECAME ITS SECOND CALLER. It began as
 * `commands/validate/fleet/usecases/`, the fleet target's own package; the
 * archive gate and `loam status` both grade a feature through
 * `core/coherence/`, which may not import a command, so a feature's own flows
 * archived ungraded and the next `validate --all` convicted them
 * (`usecase.step-unbacked`, `usecase.requirement-unresolved` — the real-fleet
 * review, 2026-10-21). One grader for both scopes is the rule this package's
 * banner already stated for the service target; `./feature.ts` is the third
 * caller, and `place` on the scope is the one thing each states for itself.
 *
 * ONLY VIEWS CARRYING A RESERVED TAG ARE GRADED, and that opt-in is what lets
 * this ship into a fleet that already has diagrams. An untagged `dynamic view`
 * is somebody's hand-drawn sequence — drawn to explain something to a person,
 * not to be joined to a model — and grading it would turn every existing docs
 * repo red on upgrade over documents nobody promised anything about. A `#cap-`,
 * `#req-`, `#suite-` or `#obl-` tag is the author saying "this is a use case;
 * hold it to the model", and nothing else says it: a view with no tags and a
 * view whose tags are all somebody's own vocabulary are the same thing here. A
 * `#suite-`-only view resolves nothing below — it carries no claim — and its
 * hops are graded like any other's. An `#obl-` tag is a claim, but not one this
 * loop resolves: the obligation axis grades it where its vocabulary and its
 * `Covers:` index are read (`commands/validate/fleet/obligations/` for the
 * living fleet, `../delta/obligations.ts` for a feature's own flows).
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
import { compareIds } from "../../repo/entries.js";
import { resolveCapabilityTags } from "../../capabilities/usecase-join.js";
import { isUseCase } from "../fleet.js";
import type { Elem, Rel } from "../../c4/likec4.js";
import type { ParsedView } from "../../c4/parsed/dynamic-views.js";
import type { Finding } from "../../vocabulary/report.js";
import { capabilityTagFindings } from "./capability-tag.js";
import { requirementTagFindings } from "./requirement-tag.js";
import { stepFindings, type StepGrading } from "./steps.js";
import { viewFile, type ViewPlace } from "../place.js";

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
   * — see `../place.ts`, which is where the path is spelled. A feature's own
   * flows come from the staged post-merge project (`../delta/overlay.ts`), whose
   * `sourcePath` is mapped back to the file the author wrote.
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
  /**
   * The requirement ids one capability's document declares, or `undefined` for a
   * capability with no document — the scope a `#req-` tag is resolved in.
   *
   * A function rather than the map itself, so this package never learns what a
   * capability document is: the fleet target reads them once
   * (`capabilityRequirementIndex`) and hands the lookup over. `undefined` and an
   * empty set are different answers here, exactly as they are one join over —
   * no document at all, against a document declaring no promises yet.
   */
  requirementsOf: (capability: string) => ReadonlySet<string> | undefined;
  /** Where every finding says its view is — the scope's own spelling (`ViewPlace`). */
  place: ViewPlace;
  /**
   * The repo-relative file a view is written in: `locations[0]` of every finding
   * about it. Without it the report's fallback filed a fleet flow's hop under
   * the TARGET, `architecture/landscape.likec4`, and an agent reading `--json`
   * had to parse the prose to learn which `.likec4` to open — the service scope
   * had already fixed that for its own flows (`../service/grade.ts`, `atView`).
   */
  file: (view: ParsedView) => string;
}

/**
 * The views that opted in, in a stable order.
 *
 * The opt-in itself is `isUseCase` in `core/usecases/fleet.ts` and is not
 * restated here. It used to be — the same `startsWith` pair, spelled a second
 * time — and the two spellings drifted: this one took either reserved prefix
 * while the reader-side one took `#cap-` alone, so `validate` graded a
 * `#req-`-only flow that `loam diff`, `delta`, `status`, the packs and `list
 * capabilities` could not see. What is left here is the ORDER, which is this
 * package's own concern.
 *
 * Sorted by (file, view id) rather than reported in LikeC4's own record order:
 * nothing in loam has measured that the parse preserves declaration order, so a
 * report whose row order depends on that would reorder under a dependency bump
 * — the diff-stability rule `core/capabilities/rollup.ts` states for its rows,
 * applied to findings.
 */
function gradedViews(views: readonly ParsedView[]): ParsedView[] {
  return views
    .filter(isUseCase)
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
    place: scope.place,
  };
  const findings: Finding[] = [];
  for (const view of gradedViews(scope.views)) {
    // ONE resolution of this view's capability tags, shared by both grades. The
    // `#req-` tag is scoped by exactly the capabilities the `#cap-` tags resolve
    // to, so resolving twice would be two chances to disagree about which
    // document a `Requirement-ID` is unique inside.
    //
    // THE LADDER IS THE `null`, NOT AN EMPTY LIST, and the distinction is a
    // wrong answer away: a suspended vocabulary handed on as `[]` reads to the
    // requirement grade as "this view resolves no capability", which is its
    // `unscoped` ERROR — so every `#req-` tag in a fleet that has not adopted
    // the capability axis would be convicted for the axis not existing.
    const forView: Finding[] = [];
    if (scope.capabilities !== null) {
      const claims = resolveCapabilityTags(view.tags, scope.capabilities);
      forView.push(...capabilityTagFindings(view, claims, scope.place));
      forView.push(...requirementTagFindings(view, claims, scope.requirementsOf, scope.place));
    }
    for (const step of view.steps) forView.push(...stepFindings({ view, step }, grading));
    const file = scope.file(view);
    findings.push(
      ...forView.map((f) => (f.locations === undefined ? { ...f, locations: [{ path: file, role: "primary" as const }] } : f)),
    );
  }
  return findings;
}
