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
import { capabilityRequirementIndex } from "../capabilities/findings.js";
import type { CapabilityVocabulary } from "../capabilities/capabilities.js";
import type { Requirement } from "../document/spec.js";
import { compareIds } from "../repo/entries.js";
import type { ParsedView } from "../c4/parsed/dynamic-views.js";
import type { DocsDir } from "../kernel/ids/dirs.js";
import { readUseCases, type UseCaseScan } from "./fleet.js";
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
 * A MAP RATHER THAN A SET, because the two callers need different depths of the
 * same answer and one of them needs names. `validate` only asks whether a
 * promise is kept (`.has`, which a Map answers identically); a listing that said
 * "kept" without saying by WHAT would leave a reader unable to open the flow, go
 * look at its hops and judge whether the promise really is kept — which is the
 * whole reason the listing carries the realizing service requirements by name
 * rather than as a count. Widening the return type was cheaper than a second
 * function, and a second function is how the two corpora start disagreeing.
 *
 * ONLY RESOLVED CLAIMS COUNT, and both halves must resolve: the `#cap-` tag to
 * exactly one declared capability, and the `#req-` tag to exactly one of its
 * requirements. A broken tag of either kind is already an ERROR
 * (`usecase.capability-unresolved`, `usecase.requirement-unresolved`) and must
 * never also mark a promise kept — a typo that silenced the unrealized warning
 * would turn a mistake into a green fleet.
 *
 * `declared` carries the vocabulary ladder: `null` means there is nothing to
 * grade against, and the honest answer is then an empty map — no flow can be
 * said to keep a promise loam cannot see declared.
 *
 * Diff-stable by construction: the view ids under each promise are DEDUPLICATED
 * and sorted with compareIds, so nothing here depends on LikeC4's view order,
 * on how many tags one view carried, or on the readdir order the project was
 * staged in. The map's own key order reaches no output — both callers look
 * promises up by key — but the values are printed, so they are sorted.
 */
export function useCaseRequirementClaims(
  views: readonly ParsedView[],
  declared: readonly string[] | null,
  requirementsOf: (capability: string) => ReadonlySet<string> | undefined,
): ReadonlyMap<string, string[]> {
  const claimed = new Map<string, Set<string>>();
  if (declared !== null) {
    for (const view of views) {
      const scope = resolveCapabilityTags(view.tags, declared).flatMap((claim) =>
        claim.kind === "resolved" ? [claim.id] : [],
      );
      for (const claim of resolveRequirementTags(view.tags, scope, requirementsOf)) {
        if (claim.kind !== "resolved") continue;
        const key = `${claim.capability}#${claim.id}`;
        const flows = claimed.get(key) ?? new Set<string>();
        flows.add(view.id);
        claimed.set(key, flows);
      }
    }
  }
  return new Map([...claimed].map(([key, flows]) => [key, [...flows].sort(compareIds)]));
}

/**
 * The same answer as `useCaseRequirementClaims`, read from disk — or the honest
 * refusal to give one.
 *
 * `validate --all` already holds the parsed project and has already applied the
 * vocabulary ladder by the time it grades, so it calls the pure function above
 * with what it has. `loam list capabilities` holds neither, and the three steps
 * between a docsDir and that answer — read the flows, take the ladder, index the
 * documents' requirement ids — are three chances to get the suppression rules
 * wrong. They live here rather than in the command for that reason and not for
 * brevity: a command that spelled `[...vocab.byId.keys()]` in place of the
 * ladder would report a flow's promise as kept against a vocabulary nobody could
 * read.
 *
 * THE `unreadable` ARM MUST TRAVEL. An `architecture/` that did not parse yields
 * no views, and an empty map is indistinguishable from "no flow keeps
 * anything" — which is the single wrong answer this axis exists to prevent, and
 * the reason `readUseCases` is a tagged union rather than a list.
 */
export type PromisesKept =
  | { kind: "read"; kept: ReadonlyMap<string, readonly string[]> }
  | { kind: "unreadable"; errors: string[] };

export interface PromisesKeptRequest {
  docsDir: DocsDir;
  vocab: CapabilityVocabulary;
  /** The enumerated fleet — `readUseCases`' own requirement, for its own reason. */
  known: ReadonlySet<string>;
  /** The requirement reader — pass a FleetContext's readRequirements, bound. */
  read: (path: string) => Promise<Requirement[]>;
}

export async function promisesKeptByFlows(req: PromisesKeptRequest): Promise<PromisesKept> {
  const scan = await readUseCases({ docsDir: req.docsDir, known: req.known });
  if (scan.kind !== "read") return { kind: "unreadable", errors: scan.errors };
  // No flow, no claim — and no capability document is opened to prove it.
  // `readUseCases`' byte gate answers a fleet with no use cases without starting
  // LikeC4 at all, and reading every `capabilities/<id>/spec.md` here to resolve
  // a tag set that is empty would put back the cost the gate exists to remove.
  // The `read` arm is still what travels: the fleet WAS looked at.
  if (scan.views.length === 0) return { kind: "read", kept: new Map() };
  const index = await capabilityRequirementIndex(req.vocab, req.read);
  // `index.declared` rather than a second call to `gradableCapabilityIds`: the
  // index applied the ladder when it was built, and two applications of one rule
  // is where the two halves of this join start disagreeing about whether the
  // vocabulary is gradable at all.
  return {
    kind: "read",
    kept: useCaseRequirementClaims(scan.views, index.declared, (c) => index.byCapability.get(c)),
  };
}
