/**
 * The capability half of the use-case axis: which flows CLAIM a declared
 * capability, and which services those flows run through.
 *
 * `core/capabilities/usecase-join.ts` owns the tag grammar and the resolution
 * ladder — it answers "what does this tag name?", including the `many` arm the
 * slug's non-injectivity forces. This module asks the question the other way
 * round: given a capability id somebody already has, which views carry its tag?
 * That direction needs no ladder, because the id is not in doubt; it needs only
 * the slug, so it takes the slug and stops.
 *
 * ## What this deliberately does NOT do
 *
 * It does not grade the tag. A view tagged `#cap-payments-refunds` matches BOTH
 * `payments/refunds` and `payments-refunds` when a fleet declares both, and this
 * module reports it under both — because that is what the tag says, and the tag
 * is what the author wrote. `usecase.capability-unresolved` is already an ERROR
 * over exactly that collision (`validate`'s use-case package), so a second
 * verdict here would be a second answer to a question the gate has already
 * settled. The same stance `PackPermission` takes on an undeclared permission:
 * carry the claim, let validate convict it.
 */
import {
  tagSlug,
  CAP_TAG_PREFIX,
  resolveCapabilityTags,
  resolveRequirementTags,
} from "../capabilities/usecase-join.js";
import { compareIds } from "../repo/entries.js";
import type { ParsedView } from "../c4/parsed/dynamic-views.js";
import type { UseCaseScan } from "./fleet.js";
import { viewFile } from "./place.js";

/** One flow claiming a capability: enough to name it and to open the file it lives in. */
export interface ClaimingFlow {
  id: string;
  title?: string;
  /** Repo-relative document the view is written in. */
  file: string;
}

/** The tag spelling a declared capability id would carry — `identity/tokens` → `cap-identity-tokens`. */
function tagFor(capability: string): string {
  return `${CAP_TAG_PREFIX}${tagSlug(capability)}`;
}

/** Does this view claim the capability? Exact tag match, case included, as `resolveCapabilityTags` matches. */
function claims(view: ParsedView, tag: string): boolean {
  return view.tags.includes(tag);
}

/**
 * The flows claiming one declared capability, sorted by (file, id).
 *
 * Sorted rather than reported in LikeC4's record order for the reason every
 * other list in this axis is: nothing has measured that the parse preserves
 * declaration order, and a payload ordered by an unmeasured upstream detail
 * reorders under a dependency bump.
 */
export function flowsClaiming(scan: UseCaseScan, capability: string): ClaimingFlow[] {
  if (scan.kind !== "read") return [];
  const tag = tagFor(capability);
  return scan.views
    .filter((view) => claims(view, tag))
    .map((view) => ({ id: view.id, ...(view.title === undefined ? {} : { title: view.title }), file: viewFile(view) }))
    .sort((a, b) => compareIds(a.file, b.file) || compareIds(a.id, b.id));
}

/**
 * Every ENUMERATED service the flows claiming these capabilities run through.
 *
 * The restriction to the enumerated fleet is this function's own contract, not
 * a guard somebody downstream is relying on: a step's endpoints resolve to
 * whatever the element stands for, and a sequence diagram is full of endpoints
 * that own no directory — the actor who starts the flow, the topic in the
 * middle, the database at the end. A function called `servicesInFlows…` that
 * answered `Customer` would be lying in its own name. `loam explore`, today's
 * only caller, filters the result against its enumeration again for a different
 * reason (it needs `ServiceEntry`s, in enumeration order), so removing the
 * filter here would not currently change what that command prints — which is
 * exactly why it is written down that the reason it exists is the return type,
 * not the call site.
 *
 * The cost of the restriction, stated so the next reader can weigh it: a flow
 * drawn through a service the fleet has not adopted yet contributes no seed.
 * That service has no documentation to explore, so what is lost is a name in a
 * list, and `usecase.step-unlinked` / `landscape.service-undocumented` are where
 * the fleet is told about it.
 */
export function servicesInFlowsClaiming(scan: UseCaseScan, capabilities: readonly string[]): string[] {
  if (scan.kind !== "read") return [];
  const tags = new Set(capabilities.map(tagFor));
  const known = scan.model.known;
  const out = new Set<string>();
  for (const view of scan.views) {
    if (![...tags].some((tag) => claims(view, tag))) continue;
    for (const step of view.steps) {
      for (const id of [step.source, step.target]) {
        const service = scan.resolve(id);
        if (known.has(service)) out.add(service);
      }
    }
  }
  return [...out].sort(compareIds);
}

/**
 * The `<capability>#<Requirement-ID>` pairs a fleet's flows RESOLVE to — the
 * business promises a use case claims to keep.
 *
 * Lives in core rather than beside the grade that reports a broken tag, because
 * two very different callers need the same answer and they must not compute it
 * twice: `validate --all` subtracts these from
 * `capability.requirement-unrealized` (a promise a flow keeps is not unkept),
 * and `loam list capabilities` reports them beside the service requirements
 * that realize the same promise. Two implementations of "which promises does
 * this fleet keep" is two answers to the question the axis exists to settle.
 *
 * ONLY RESOLVED CLAIMS COUNT, and both halves must resolve: the `#cap-` tag to
 * exactly one declared capability, and the `#req-` tag to exactly one of its
 * requirements. A broken tag of either kind is already an ERROR
 * (`usecase.capability-unresolved`, `usecase.requirement-unresolved`) and must
 * never also mark a promise kept — a typo that silenced the unrealized warning
 * would turn a mistake into a green fleet.
 *
 * `declared` carries the vocabulary ladder: `null` means there is nothing to
 * grade against, and the honest answer is then an empty set — no flow can be
 * said to keep a promise loam cannot see declared.
 */
export function useCaseRequirementClaims(
  views: readonly ParsedView[],
  declared: readonly string[] | null,
  requirementsOf: (capability: string) => ReadonlySet<string> | undefined,
): Set<string> {
  const claimed = new Set<string>();
  if (declared === null) return claimed;
  for (const view of views) {
    const scope = resolveCapabilityTags(view.tags, declared).flatMap((claim) =>
      claim.kind === "resolved" ? [claim.id] : [],
    );
    for (const claim of resolveRequirementTags(view.tags, scope, requirementsOf)) {
      if (claim.kind === "resolved") claimed.add(`${claim.capability}#${claim.id}`);
    }
  }
  return claimed;
}
