/**
 * The fleet's use cases, read once for whoever asks — and NOT read at all when
 * the fleet demonstrably has none.
 *
 * `validate --all` grades use cases as part of a run that was already loading
 * `architecture/` as a LikeC4 project, so it pays nothing extra. Every reader
 * added in phase 4 is in a different position: `loam diff`, `loam delta`,
 * `loam context` and `loam explore` did not load the fleet map as a project
 * before, and `loam delta` in particular sits in `/loam-implement`'s inner loop
 * — a Langium workspace spin-up there is felt on every iteration of somebody's
 * day. So this module's whole job is to answer "which use cases does the fleet
 * declare?" and, in the common case where the answer is none, to answer it
 * without starting LikeC4 at all.
 *
 * THE CHEAP GATE IS A BYTE SCAN, and it is sound rather than heuristic. A view
 * is a use case only if it carries a reserved tag — `#cap-<slug>` or
 * `#req-<slug>`, `isUseCase` below is the whole test — and LikeC4 refuses an
 * undeclared tag, so a fleet with a use case has the literal text `cap-` or
 * `req-` in the file that declares the view AND in the file that declares the
 * tag. A document set in which no file contains either substring therefore
 * declares no use case, and `{ views: [] }` is the correct answer, not an
 * evasion. The scan reads bytes rather than decoded text on purpose: it is
 * looking for an ASCII substring, and `readFile(path, "utf8")` on a document
 * that is not UTF-8 would substitute U+FFFD and could hide it.
 *
 * BOTH PREFIXES, because the gate and the predicate answer one question and a
 * gate narrower than the predicate is silence rather than a smaller answer. A
 * fleet whose only flow is tagged `#req-` alone declares `tag req-…` and no
 * `cap-` anywhere, so a `cap-`-only scan returned `false` and none of the five
 * readers ever loaded the project — the widening below would have fixed nothing
 * without this one.
 *
 * The gate FAILS CLOSED. A document this module cannot open is treated as one
 * that might mention the prefix, so the project load happens and reports the
 * failure as a hole. The alternative — reading an EACCES as "no tag here" — is
 * the fail-open shape docs/CODE-STYLE.md forbids at a validator, arriving in an
 * optimisation.
 */
import { readFile } from "node:fs/promises";
import type { StepScope } from "../c4/resolve/steps.js";
import { CAP_TAG_PREFIX, REQ_TAG_PREFIX } from "../capabilities/usecase-join.js";
import type { ParsedView } from "../c4/parsed/dynamic-views.js";
import { architectureDir, loadArchitecture } from "../c4/project/architecture.js";
import { architectureDocuments } from "../c4/project/documents.js";
import { serviceResolver } from "../c4/resolve/service.js";
import type { DocsDir } from "../kernel/ids/dirs.js";
import { subsystemViewsPath } from "../repo/paths.js";

/**
 * What the fleet's use cases are, or the honest refusal to say.
 *
 * Two variants rather than a record with an `unreadable` flag, because the
 * fields are not independent: a project that did not parse has no elements to
 * resolve against and no views to grade, and a caller handed
 * `{ views: [], unreadable: true }` is one `.length` check away from printing
 * "no use cases touch this service" about a fleet nobody could read. Tagged,
 * that state stops being constructible — every caller has to name the
 * `unreadable` arm to get at the views.
 *
 * `read` with an empty `views` is the ordinary answer for a fleet that draws no
 * use cases, and it is exactly what the cheap gate returns without loading
 * anything: the gate is an optimisation over a question with a known answer,
 * never a third verdict.
 */
export type UseCaseScan =
  | {
      kind: "read";
      /** The reserved-tag views ONLY — `isUseCase` below is the opt-in, and the only one. */
      views: readonly ParsedView[];
      /**
       * What a hop is attributed against, built ONCE per scan. It carries the
       * fleet set that `resolve` below was built from, which is what stops
       * "which service is this element" being answered one way by
       * `attributeStep`'s fallback tier and another by a caller's own join —
       * the same reason `validate`'s `StepGrading` holds both together.
       *
       * `known` is REQUIRED here while `StepScope` leaves it optional, and the
       * narrowing is load-bearing rather than tidy: every scan is built from a
       * `UseCaseRequest` that has one, so a consumer reading `model.known` was
       * writing an `undefined` branch that could not be reached and could not be
       * tested. A `StepScope` is still what `attributeStep` receives.
       */
      model: StepScope & { known: ReadonlySet<string> };
      /** One element→service resolver for the whole scan, built with the enumerated fleet. */
      resolve: (id: string) => string;
    }
  | {
      kind: "unreadable";
      /** LikeC4's own messages, so a caller can say WHICH document broke. */
      errors: string[];
    };

export interface UseCaseRequest {
  docsDir: DocsDir;
  /**
   * The enumerated fleet. It rides into the resolver for the reason every other
   * edge join carries it: without it, a step drawn into a modelled container
   * `payment.api` resolves to a service called "api" that has never existed
   * (docs/DESIGN.md's serviceResolver-known row).
   */
  known: ReadonlySet<string>;
}

/**
 * Does any document in the set even mention a reserved tag prefix?
 *
 * Sequential and short-circuiting ON PURPOSE — the usual "no await in a loop"
 * rule is about independent work that all has to finish, and this loop exists
 * precisely so that a fleet whose first file declares a use case stops reading
 * the other ninety-nine.
 *
 * `req-` is the looser of the two substrings and that is accepted knowingly: a
 * document mentioning it in prose costs one project load loam would otherwise
 * have skipped, which is a slower right answer. Dropping it costs a wrong one.
 */
async function mentionsTagPrefix(paths: readonly string[]): Promise<boolean> {
  for (const path of paths) {
    try {
      const bytes = await readFile(path);
      if (bytes.includes(CAP_TAG_PREFIX) || bytes.includes(REQ_TAG_PREFIX)) return true;
    } catch {
      // Unreadable is not "no tag": the project load below owns that failure and
      // will report it as a hole naming the document. Answering `false` here
      // would let an unopenable file grade the fleet as having no use cases.
      return true;
    }
  }
  return false;
}

/**
 * Is this a use case at all? — the ONE answer, for `validate` and every reader
 * alike.
 *
 * EITHER RESERVED PREFIX OPTS A VIEW IN. A view carrying `#req-CHK-ONCE` and no
 * `#cap-` tag is an author who asked to be graded and forgot half the claim; it
 * earns `usecase.requirement-unresolved`'s `unscoped` arm rather than silence,
 * and SCHEMA.md has said so since the tag shipped.
 *
 * It is exported because it was the asymmetry, not the rule, that was the
 * defect. `validate --all` widened here and the readers did not, so a
 * `#req-`-only flow was graded hop by hop by the gate and invisible to `loam
 * diff`, `delta`, `status`, the packs and `list capabilities` — a fleet where
 * the gate and the report disagree about what exists, which is worse than
 * either answer alone. One predicate is what stops that recurring: a caller
 * that spells `startsWith` itself is a second answer waiting to drift.
 *
 * The parameter is the smallest shape the test needs rather than `ParsedView`,
 * so a caller holding a view-like row does not have to build one to ask. Both
 * prefix tests match their resolver's exactly, case included, so a view can
 * never be opted in here and read as untagged in `resolveCapabilityTags`.
 *
 * NOT the same question as `flowsClaiming`'s. That one asks which flows claim
 * capability X and matches the whole `cap-<slug>` tag; a `#req-`-only view
 * claims none, and it is correct for it to stay out of that answer while
 * counting as a use case here.
 */
export function isUseCase(view: { tags: readonly string[] }): boolean {
  return view.tags.some((tag) => tag.startsWith(CAP_TAG_PREFIX) || tag.startsWith(REQ_TAG_PREFIX));
}

/**
 * The fleet's declared use cases, with the model they are drawn over.
 *
 * Reads only, throws nothing, and refuses nothing: every failure is the
 * `unreadable` arm. Callers memoise this per invocation — nothing is cached
 * here, because a module-level cache keyed on a docsDir would leak across the
 * `chdir`-per-test processes AGENTS.md warns about and, in a long-running host,
 * across invocations.
 */
export async function readUseCases(req: UseCaseRequest): Promise<UseCaseScan> {
  const none: UseCaseScan = {
    kind: "read",
    views: [],
    model: { elements: [], relationships: [], known: req.known },
    resolve: (id) => id,
  };
  const dir = architectureDir(req.docsDir);
  const documents = await architectureDocuments(dir, [subsystemViewsPath(req.docsDir)]);
  if (!(await mentionsTagPrefix(documents))) return none;

  const doc = await loadArchitecture(req.docsDir);
  // loam's standing rule, at project altitude: errors mean no model. A use-case
  // file with one unresolved element leaves the whole project unusable, and
  // grading a flow against half a map is the wrong answer this refuses to give.
  if (doc.errors.length > 0) {
    return { kind: "unreadable", errors: doc.errors.map((e) => e.message) };
  }
  return {
    kind: "read",
    views: (doc.views ?? []).filter(isUseCase),
    model: { elements: doc.elements, relationships: doc.relationships, known: req.known },
    resolve: serviceResolver(doc.elements, req.known),
  };
}
