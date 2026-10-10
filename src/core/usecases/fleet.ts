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
 * is a use case only if it carries a reserved tag — `#cap-<slug>`,
 * `#req-<slug>` or `#suite-<name>`, `isUseCase` below is the whole test — and
 * a view carries a tag only through a REFERENCE written in the document that
 * declares the view. LikeC4's grammar spells every tag reference `HashId`: the
 * `#` terminal, then the name. Measured at the 1.59.2 pin, the `#` is
 * mandatory — a bare `suite-smoke` in a view body fails to resolve, and
 * `tags #suite-smoke` fails to parse — but LikeC4's four hidden tokens may sit
 * between the `#` and the name: `# suite-smoke`, a `#` ending one line with
 * the name on the next, and a block comment in between all parse to the tag
 * `suite-smoke`. So the scan finds each `#`, skips exactly those tokens
 * (`referencesReservedTag`), and asks whether a reserved prefix starts there.
 * A document set in which no file does declares no use case, however badly it
 * parses, and `{ views: [] }` is the correct answer, not an evasion. A
 * `tag cap-…` line in a `specification` block is a declaration, not a
 * reference, and does not open the gate: a tag no view carries opts nothing
 * in.
 *
 * THE `#` IS WHAT KEEPS PROSE OUT. The scan used to look for the bare
 * substrings, so a view titled 'What the e2e-suite-a job exercises', or a
 * comment naming `req-` in passing, opened it. At fleet scope that cost one
 * project load, because a map that does not parse is `landscape.invalid`
 * whether or not the gate opens; at service scope (`./service/flows.ts`) it
 * turned an untagged hand-drawn sibling that did not parse into
 * `usecase.flow-invalid` — an error, exit 1 — over a diagram that opted
 * nothing in. A `#` followed by a reserved prefix still opens it wherever it
 * is written, a comment or a description included: that over-scan is
 * accepted, because it is spelled as the tag syntax, and the scan must never
 * be narrower than the parser.
 *
 * The scan reads bytes rather than decoded text on purpose: it looks for
 * ASCII, and `readFile(path, "utf8")` on a document that is not UTF-8 would
 * substitute U+FFFD and could hide it. Decoded as latin1 instead, every byte is
 * one character, and the bytes of a multi-byte sequence never read as ASCII.
 *
 * EVERY PREFIX, because the gate and the predicate answer one question and a
 * gate narrower than the predicate is silence rather than a smaller answer. A
 * fleet whose only flow is tagged `#req-` alone writes `cap-` nowhere, so a
 * `cap-`-only scan returned `false` and none of the five readers ever loaded
 * the project — the widening below would have fixed nothing without this one.
 * The suite prefix joined for the same reason the day a `#suite-`-only view
 * became a use case: both now read one list, `USE_CASE_TAG_PREFIXES`, so a
 * fourth prefix cannot be added to one and not the other.
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
import { architectureProjectDocuments, loadArchitecture } from "../c4/project/architecture.js";
import { errorText } from "../c4/likec4.js";
import { serviceResolver } from "../c4/resolve/service.js";
import type { DocsDir } from "../kernel/ids/dirs.js";
import { SUITE_TAG_PREFIX } from "./suites/suites.js";

/**
 * Every reserved prefix that opts a view in — the one list both the byte gate
 * and `isUseCase` read, so the two cannot disagree about which tags make a use
 * case. `cap-` and `req-` are spelled by the capability join that resolves
 * them; `suite-` by `./suites/suites.ts`, which groups by it and resolves
 * nothing, because a suite name is checked by LikeC4's own undeclared-tag
 * refusal rather than by a vocabulary.
 */
const USE_CASE_TAG_PREFIXES: readonly string[] = [CAP_TAG_PREFIX, REQ_TAG_PREFIX, SUITE_TAG_PREFIX];

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
      /**
       * LikeC4's own messages, so a caller can say WHICH document broke —
       * spelled through `errorText` like every other diagnostic loam prints.
       * They used to travel raw, so the 1-based line was missing and one
       * dropped quote in the map put a 143 KB parser message into the
       * `useCaseScan.error` of every service's `loam context --json`.
       */
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
 * Does any document in the set reference a reserved tag — a `#`, then only
 * LikeC4's hidden tokens, then `cap-`, `req-` or `suite-`?
 *
 * Sequential and short-circuiting ON PURPOSE — the usual "no await in a loop"
 * rule is about independent work that all has to finish, and this loop exists
 * precisely so that a fleet whose first file declares a use case stops reading
 * the other ninety-nine.
 *
 * What the scan lets through costs differently at its two callers, and the
 * header above names both. A `#req-…` written in a comment opens it: at fleet
 * scope that is one project load loam could have skipped, a slower right
 * answer; at service scope it loads a sibling set that may not parse, and a
 * broken one is then `usecase.flow-invalid` — an error, but over a document
 * that spelled the tag syntax. Prose without the `#` opens neither. Missing a
 * reference would cost a wrong answer at both: a use case nobody graded.
 *
 * Exported for the service-scope reader (`./service/flows.ts`), which asks the
 * same question of the `.likec4` files beside one `model.likec4`: a sibling set
 * that references no reserved tag declares no use case, so a hand-drawn
 * `views.likec4` costs that service no LikeC4 workspace. One gate, two callers,
 * because a second byte scan spelled in the service package would be free to
 * disagree with this one about which prefixes opt a view in.
 */
export async function mentionsTagPrefix(paths: readonly string[]): Promise<boolean> {
  for (const path of paths) {
    try {
      const bytes = await readFile(path);
      if (referencesReservedTag(bytes.toString("latin1"))) return true;
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
 * Is a reserved prefix written as a tag reference anywhere in this text? Every
 * `#` is tried, wherever it stands — in a view body, a comment, a string —
 * because the scan may over-approximate the parser and never under-approximate
 * it.
 *
 * A text with no `#`, or with no reserved prefix anywhere in it, cannot answer
 * yes, so it is answered before the table below is built: that is nearly every
 * document, and it costs those two native searches and no allocation.
 *
 * Exported for its own test (test/usecase-byte-gate.test.ts), which holds it to
 * the walk the first version made from each `#` over crafted inputs, and holds
 * its cost to one pass over inputs that walk took minutes on.
 */
export function referencesReservedTag(text: string): boolean {
  const first = text.indexOf("#");
  if (first === -1 || !USE_CASE_TAG_PREFIXES.some((prefix) => text.includes(prefix))) return false;
  const nameAt = hiddenRunEnds(text);
  for (let hash = first; hash !== -1; hash = text.indexOf("#", hash + 1)) {
    const name = nameAt[hash + 1]!;
    if (USE_CASE_TAG_PREFIXES.some((prefix) => text.startsWith(prefix, name))) return true;
  }
  return false;
}

/**
 * For every position in `text`, where the next token LikeC4 would read starts
 * from there: past whitespace, line breaks, `//` line comments and block
 * comments — the four terminals the 1.59.2 grammar marks hidden (`WS`, `NL`,
 * `LINE_COMMENT`, `BLOCK_COMMENT`), which its lexer drops between the `#` of a
 * tag reference and the name. Index `text.length` is the end itself.
 *
 * ONE PASS, FROM THE END, so every answer is built from answers already known
 * and the whole table costs one visit per character, however the `#`s and the
 * comments interleave. The first version walked forward from each `#` instead,
 * and a run of hidden tokens with `#`s inside it was re-walked once per `#`:
 * `#/*` repeated took 17.6 s on 100 KB (each unclosed opener searched the rest
 * of the file for a closer), and `#//` repeated on one line, or the same `#/*`
 * run closed once at its end, were quadratic the same way. Remembering only
 * where the closer search last failed would have fixed the first of those
 * three and left the other two; nothing short of reusing every answer fixes
 * the shape, and this scan runs over every document on every reader's path.
 *
 * A hand loop rather than one regular expression: a repeated group of
 * alternatives that can each consume a comment backtracks exponentially on a
 * long run of slashes. An UNTERMINATED block comment is not one LikeC4 can lex
 * as a comment, so only the `/*` itself is stepped over and a name written
 * after it still counts: that can open the gate more often, never less, and
 * the document cannot parse anyway — the load the gate opens is what reports
 * it. The closer is searched from two past the opener, so the `*` of an opener
 * never doubles as the `*` of its closer, exactly as the lexer reads it.
 */
function hiddenRunEnds(text: string): Int32Array {
  const end = new Int32Array(text.length + 1);
  end[text.length] = text.length;
  // The nearest line break at or after the position being read, and the
  // nearest `*/` at or after the NEXT position and the one after that — an
  // opener at `at` searches from `at + 2`, and the pass meets that position
  // before it meets `at`. -1 is "none".
  let lineBreak = text.length;
  let closeFromNext = -1;
  let closeFromAfterNext = -1;
  for (let at = text.length - 1; at >= 0; at -= 1) {
    const char = text[at];
    const closeFromHere = char === "*" && text[at + 1] === "/" ? at : closeFromNext;
    if (char === "\r" || char === "\n") lineBreak = at;
    if (char === " " || char === "\t" || char === "\r" || char === "\n") {
      end[at] = end[at + 1]!;
    } else if (char === "/" && text[at + 1] === "/") {
      // The comment runs to the line break and leaves it unread; the break is
      // whitespace, so the run goes on from there. No break: the text ends.
      end[at] = end[lineBreak]!;
    } else if (char === "/" && text[at + 1] === "*") {
      end[at] = closeFromAfterNext === -1 ? end[at + 2]! : end[closeFromAfterNext + 2]!;
    } else {
      end[at] = at;
    }
    closeFromAfterNext = closeFromNext;
    closeFromNext = closeFromHere;
  }
  return end;
}

/**
 * Is this a use case at all? — the ONE answer, for `validate` and every reader
 * alike.
 *
 * ANY RESERVED PREFIX OPTS A VIEW IN. A view carrying `#req-CHK-ONCE` and no
 * `#cap-` tag is an author who asked to be graded and forgot half the claim; it
 * earns `usecase.requirement-unresolved`'s `unscoped` arm rather than silence,
 * and SCHEMA.md has said so since the tag shipped. A view carrying only
 * `#suite-<name>` claims no capability and no requirement and is still a use
 * case — the owner's call, recorded in SCHEMA.md: putting a journey in a suite
 * is asking for it to be run, and a journey a test stand is provisioned from
 * must be held to the model hop by hop like any other.
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
 * so a caller holding a view-like row does not have to build one to ask. Every
 * prefix test matches its reader's exactly, case included, so a view can never
 * be opted in here and read as untagged in `resolveCapabilityTags` or
 * `suiteNames`.
 *
 * NOT the same question as `flowsClaiming`'s. That one asks which flows claim
 * capability X and matches the whole `cap-<slug>` tag; a `#req-`-only view
 * claims none, and it is correct for it to stay out of that answer while
 * counting as a use case here.
 */
export function isUseCase(view: { tags: readonly string[] }): boolean {
  return view.tags.some((tag) => USE_CASE_TAG_PREFIXES.some((prefix) => tag.startsWith(prefix)));
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
  // EXACTLY the documents `loadArchitecture` will load two lines down, root
  // `exclude` and all — `architectureProjectDocuments` is that one answer
  // (`c4/project/architecture.ts`). The gate used to walk `architecture/` for
  // itself and skip the exclude, which could only over-scan: the byte gate
  // reading a document the loader then drops decides "there might be a use
  // case here" and pays for a project load that finds none. Never a wrong
  // answer, but two lists that disagree about what the project is, and the
  // next reader to take the wider one for the project's would be wrong.
  const documents = await architectureProjectDocuments(req.docsDir);
  if (!(await mentionsTagPrefix(documents))) return none;

  const doc = await loadArchitecture(req.docsDir);
  // loam's standing rule, at project altitude: errors mean no model. A use-case
  // file with one unresolved element leaves the whole project unusable, and
  // grading a flow against half a map is the wrong answer this refuses to give.
  if (doc.errors.length > 0) {
    return { kind: "unreadable", errors: doc.errors.map(errorText) };
  }
  return {
    kind: "read",
    views: (doc.views ?? []).filter(isUseCase),
    model: { elements: doc.elements, relationships: doc.relationships, known: req.known },
    resolve: serviceResolver(doc.elements, req.known),
  };
}
