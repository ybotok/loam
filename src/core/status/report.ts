/**
 * Where does this work stand, and what is the next thing to do?
 *
 * Every other command answers a question you already know how to ask: validate
 * grades a target you name, delta briefs a service you name, verify checks a
 * feature you name. The one thing loam could not answer was the question an
 * agent asks FIRST — the one it has when it joins a repository halfway, or
 * comes back after losing its session. That knowledge existed, but only as
 * prose inside the slash commands ("1. scaffold, 2. author, 3. validate"),
 * which is to say it existed for whoever had read them recently and for nobody
 * else.
 *
 * The obvious implementation is a state file — a `.loam/state.json` recording
 * which step each feature reached. It is rejected here for the reason core/verify/
 * refuses a second mutable database: the moment a second record of the truth
 * exists, an author who edits a file by hand, a merge, a rebase or a
 * `git checkout` desynchronises it, and the state file's answer is confidently
 * wrong exactly when somebody trusts it. So `status` stores nothing and caches
 * nothing. It is a projection: every invocation re-derives the whole answer
 * from the files, and a file edited in another window is visible on the next
 * run with no invalidation step for anyone to forget.
 *
 * It also grades nothing itself. Every verdict here is somebody else's
 * function: `featureCoherence` (what `loam archive` refuses on) plus
 * `featureProvenance` and `requirementsMissingScenarios` (`loam validate
 * --feature`'s other error sources, as far as they exist as shared functions),
 * and `readVerificationState` + `featureChecklist`, the pair `loam verify`
 * uses. A second opinion about whether a feature holds together would be a
 * second answer to grade a pull request against, and the one a reader consults
 * is never the one the gate obeys (doctor.ts learnt this with its own config
 * validator). A check that lives inline inside `validate` cannot be inherited
 * at all, which is why `stage` never rests on `checks.coherent` alone.
 *
 * Which is why the rule this module is held to is one-directional: **status may
 * be more pessimistic than the gates, never greener.** `validate` and `archive`
 * answer two different questions — is the DOCUMENT valid, is the MERGE safe
 * (issue.ts) — and a projection that reported only one of them told an author
 * "ship it" about a feature the other one refuses. So `stage` and `next[]` take
 * the UNION: an error `validate` grades and a warning `archive` gates on both
 * make a feature `draft`, and test/status-agrees-with-gate.test.ts holds the
 * direction on a matrix of deliberately-damaged trees.
 *
 * ## The status vocabulary
 *
 * Five values, closed, and an agent is expected to branch on them:
 *
 *   `missing`  the artifact is owed and is not on disk; nothing stands in the
 *              way of writing it now.
 *   `blocked`  the work is stalled on something that is NOT this artifact — an
 *              artifact it is derived from is absent, or another feature in
 *              flight has to archive first.
 *   `draft`    it is on disk and the shared checks report an error against it:
 *              what exists is wrong.
 *   `ready`    it is on disk and clean, but its obligation is not discharged —
 *              something outside the documents (code, a test run, a recording)
 *              still has to answer it.
 *   `done`     nothing is owed here — and for an ARCHIVED feature, only that:
 *              archive checks documents, never code or evidence, so whether
 *              it was verified is `verification`'s answer, not this one.
 *
 * These are branching values, not sentences: the human view prints them in
 * words with the counts beside them (`feature/words.ts`), because a bare
 * `ready` over a feature with nothing built read as "ready to ship".
 *
 * The two pairs that look alike are the point of the set. `missing` and
 * `blocked` both mean "not written", and they are different instructions: one
 * says write it now, the other says you cannot yet and names what comes first —
 * an agent that cannot tell them apart authors a verification record against a
 * checklist that does not exist. `draft` and `ready` both mean "on disk", and
 * they are different instructions too: `draft` says the document is wrong and
 * the fix is in this repository, `ready` says the document is right and the
 * world has not caught up — the code is not built, or the claims are not
 * answered. Collapsing those two would send an agent to re-edit a spec that is
 * already correct.
 *
 * A value unreachable in a scope is simply never emitted there, deliberately:
 * the fleet form never says `draft`, because grading is a per-feature cost it
 * refuses to pay.
 */
import type { UseCaseBlastRadius } from "../usecases/touch.js";
import type { AnsweredBy } from "../verify/answers.js";
import type { VerificationVerdict } from "../verify/record.js";
import type { Finding } from "../vocabulary/report.js";

/** The closed set. The module header says what each value instructs. */
export const ARTIFACT_STATUSES = ["missing", "blocked", "draft", "ready", "done"] as const;
export type ArtifactStatus = (typeof ARTIFACT_STATUSES)[number];

/**
 * The artifact kinds a feature can owe, in the order the cycle authors them.
 * `spec`, `arch-spec`, `openapi` and `asyncapi` are per-service and repeat
 * once per service the feature touches; `capabilities` repeats once per
 * capability document the feature's delta carries; the rest are feature-wide.
 *
 * `capabilities` sits where an analyst writes it — the business promise comes
 * before the services that keep it, and a capability-only feature is a real and
 * ordinary first commit.
 */
export const ARTIFACT_IDS = [
  "intent",
  "delta",
  "capabilities",
  "spec",
  "arch-spec",
  "openapi",
  "asyncapi",
  "verification",
] as const;
export type ArtifactId = (typeof ARTIFACT_IDS)[number];

export interface ArtifactState {
  id: ArtifactId;
  /** The service this artifact belongs to, or null for the feature-wide ones. */
  service: string | null;
  /**
   * The capability this artifact belongs to, on `capabilities` rows only.
   *
   * A field of its own rather than a capability id put in `service`: the two
   * are different namespaces — a fleet may hold a service and a capability of
   * one name — and bending a published field to carry the other kind is how a
   * consumer grouping by service silently acquires a row that is not one. Absent
   * on every other row, so nothing that reads `service` today changes.
   */
  capability?: string;
  /** Repo-relative with forward slashes — diffable across machines, like every path in the contract. */
  path: string;
  exists: boolean;
  /**
   * Whether ABSENCE is a defect. False for the artifacts a feature may
   * legitimately not have: `delta.likec4` (a requirements-only change deletes
   * it), `arch.spec.md` and `asyncapi.yaml` (optional everywhere), and
   * `openapi.yaml` for a service
   * the living docs already carry. An absent optional artifact is `done` —
   * nothing is owed — and `exists: false` beside it is how a reader tells that
   * from a file that is present and fine.
   */
  required: boolean;
  status: ArtifactStatus;
  /** Artifact ids that must come first. Non-empty only when `status` is `blocked`. */
  blockedBy: string[];
}

export interface NextStep {
  /** Stable — prose may change, this may not. */
  code: string;
  /** One sentence, actionable without reading any other field. */
  statement: string;
  /** The literal command to run. */
  command: string;
  artifact?: ArtifactId;
  service?: string;
  /** The repo-relative file the step is about, when it names one. */
  path?: string;
}

export type NextActionKind = "command" | "edit" | "external-repo" | "human-review";
export type NextActionCwd = "configured-repo" | "docs-repo" | "service-repo";

/**
 * The machine contract beside the legacy `NextStep.command` string.
 *
 * `command` exists only when every argument is concrete. An edit names the
 * file and puts the old command in `after`, because that command grades the
 * authored work rather than performing it. `needs` is data the caller must
 * obtain; it is never smuggled into a shell-looking placeholder.
 */
export interface NextExecution {
  kind: NextActionKind;
  runnable: boolean;
  cwd: NextActionCwd;
  command?: string;
  after?: string;
  needs?: string[];
}

export type ExecutableNextStep = NextStep & { execution: NextExecution };

/**
 * What the record beside the feature says, without asking whether anyone should
 * believe the code. `stale` is its own state and not merely "recorded": the
 * feature moved after the answers were written, so the record answers questions
 * that are no longer the ones being asked — which is exactly why `loam verify
 * --record` refuses to merge into it.
 */
export interface VerificationState {
  state: "absent" | "unreadable" | "stale" | "recorded";
  /** The day the record was written, when there is a readable one. */
  recorded: string | null;
  /**
   * `verify --json`'s own three-valued verdict, through `verificationVerdict` —
   * not a fourth opinion computed here. `attested` is the one that matters to a
   * reader of this command: complete, and resting on somebody's word about a
   * test rather than on a run.
   */
  verdict: VerificationVerdict;
  /** Every count below is `tallyRecord` — the record's `claims:` array, never its `summary:` block. */
  claims: number;
  confirmed: number;
  unconfirmed: number;
  /** Federated records only: claims nobody has answered yet. */
  unanswered: number;
  /** Of the confirmed, the scenario claims on an agent's word (`attestedClaims`). */
  attested: number;
  /**
   * Of the confirmed, one count per `answered_by` value (`confirmedProvenance`),
   * every key present — `list --json`'s `answered`, under the same name. A
   * different question from `attested`: that one asks only about the scenario
   * claims the verdict turns on, this one who answered EVERY kind, so a record
   * `verified` on its scenarios can still say six of its answers were an
   * agent's word about a permission or an edge.
   */
  answered: Record<AnsweredBy, number>;
}

/**
 * A `loam archive`/`unarchive` that was killed mid-commit, read off the intent
 * journal `.loam-commit` leaves in the docs repo.
 *
 * It belongs in a projection that grades nothing because it is not a grade: it
 * is the one repository state where every OTHER answer this command gives is
 * about files that may be half-written. `doctor` blocks on it; `status` is what
 * an agent runs first, and it reported `done` over a half-merged repo — so it
 * says so too, from the same journal, and leads its steps with the repair.
 *
 * Read, never repaired: recovery happens under the docs lock inside `archive`
 * and `unarchive`, and `status` writes nothing and takes no lock.
 */
export interface InterruptedCommit {
  /**
   * Which command was committing, or null when the journal cannot be read at
   * all. A sentence for a human, never a branch: version-2 journals carry any
   * writer's name (rebase, vouch, new, gherkin), so an enum here would be a
   * list this type has to chase.
   */
  command: string | null;
  feature: string | null;
  /** Who and when, so a human can place it against their own shell history. */
  host: string | null;
  pid: number | null;
  at: string | null;
  /** Docs-repo-relative paths that may hold half-written bytes. */
  files: string[];
  /** `.loam-commit` exists but does not parse — the worst case, because nothing can grade it. */
  unreadable: boolean;
  /** The command that recovers, or null when only a human can. */
  recover: string | null;
}

export interface FeatureStatusReport {
  /**
   * A killed commit in this docs repo, or null. Present on both forms: it is a
   * fact about the repository, and every artifact row below it is a fact about
   * files that repository may have half-written.
   */
  interrupted: InterruptedCommit | null;
  feature: {
    id: string;
    /** intent.md's title, for a person (`featureTitle`); null when it names none. Additive. */
    title: string | null;
    /** The questions under intent.md's `## Open questions` (`openQuestions`) — counted, never graded. Additive. */
    openQuestions: number;
    dirName: string;
    path: string;
    archived: boolean;
    /** The feature's own rollup, from the same vocabulary as its artifacts. */
    stage: ArtifactStatus;
    /** Every service the feature touches, whatever `--service` narrowed the view to. */
    services: string[];
    /** Active features that must archive before this one, from the dependency index. */
    blockedBy: string[];
  };
  /** The `--service` narrowing, or null when the whole feature is in view. */
  service: string | null;
  artifacts: ArtifactState[];
  /**
   * The grade, from the same calls the two gates make: `featureCoherence`
   * (archive), plus `featureProvenance` and the scenario-coverage check — the
   * error sources `validate --feature` shares as functions. `ran` is false for
   * an archived feature: its delta is already merged into the living docs, so
   * re-grading it would compare a change against a world that has absorbed it.
   */
  checks: {
    ran: boolean;
    /**
     * No error among the findings above — `loam validate --feature`'s verdict
     * for every error source that is a shared function. It is not on its own
     * what makes a feature shippable: `stage` and `next[]` take the union with
     * archive's gating set, because a warning that gates is a warning this
     * field reports as coherent.
     */
    coherent: boolean;
    errors: number;
    warnings: number;
    /**
     * Findings carrying `gates: true` — archive's judgement calls, which `--approve` overrides. Not
     * every refusal: its pre-plan ones (unknown service, bad specs/ name, conflict markers) are errors.
     */
    gating: number;
    /**
     * Findings, not Issues: the set is wider than coherence now, and `gates` is
     * resolved on every coherence finding so a consumer never re-implements the
     * severity default. One breach reported by `validate` and by `status` has
     * to arrive in one shape.
     */
    issues: Finding[];
  };
  verification: VerificationState;
  /**
   * How many claims the feature's checklist asks NOW, or null for an archived
   * feature (frozen history: nothing is re-derived). Additive. With no record
   * every count in `verification` is zero, and "0 of 0" is not what an
   * unverified feature with nineteen promises is.
   */
  checklist: { claims: number } | null;
  /**
   * The declared business flows the services IN VIEW are hops of — blast
   * radius, and the only field here that is a fact about the fleet rather than
   * about the feature.
   *
   * It narrows with `--service` exactly as `artifacts` and `next` do, because
   * `--service` is a lens on what the reader is being asked to do next. What it
   * must never do is go silently empty: `unreadable` is how it says that
   * `architecture/` could not be read, which is a different fact from a fleet
   * that draws no use cases and produces the identical empty list.
   *
   * The FLEET form has no equivalent, deliberately. That form grades nothing and
   * is coarse by design, and a per-feature flow join over every feature in flight
   * is exactly the per-feature cost it refuses to pay.
   */
  useCases: UseCaseBlastRadius;
  /**
   * The feature's OWN flows through the same services, read against the map
   * its merge would leave — the flows this change is for. Its own hole, for the
   * same reason: a `usecases/` that cannot be read is not one that draws
   * nothing. Empty for an archived feature, whose flows are living now and in
   * `useCases`. Absent unless the caller asked for it (`featureStatus`'s
   * `featureFlows`).
   */
  featureUseCases?: UseCaseBlastRadius;
  next: NextStep[];
}
