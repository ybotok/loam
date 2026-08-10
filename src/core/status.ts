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
 * which step each feature reached. It is rejected here for the reason verify.ts
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
 *   `done`     nothing is owed here.
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
 *
 * ## `next[]`
 *
 * The payload's reason to exist. Each entry carries a stable `code` to branch
 * on, one sentence a person can read, and the literal command to run — ordered,
 * first entry first. `command` is the loam invocation that carries the step
 * forward: the one that does the work where loam does it (`rebase`, `archive`),
 * and the one that states or grades the work where the author does it (`delta`,
 * `validate`, `verify`). It is never a command that would write the artifact
 * behind the author's back — loam does not author.
 *
 * `next` is never empty. A feature with nothing outstanding still has a next
 * step (ship it), and a repository with nothing outstanding still has one (keep
 * the fleet green) — an empty array would be indistinguishable from a bug in
 * the caller's own parsing.
 *
 * ## Why the fleet form is cheaper than the feature form
 *
 * `loam status` with no feature runs over every active feature, and deriving a
 * coherence report or a verification checklist per feature means spinning a
 * fresh LikeC4 workspace per feature. On a fleet-sized repository that is the
 * cost that gets a command switched off — `list` made the same call about its
 * verification column. So the fleet form grades nothing: it reports artifact
 * PRESENCE, the dependency order, and a verification record only where one
 * already exists, and its `next[]` hands off to `loam status <FEAT>`, which is
 * where the checks actually run.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { featureCoherence, livingMergeConflicts, unknownDeltaServices } from "./coherence.js";
import { analyzeDependencies, type DependencyGraph } from "./dependencies.js";
import { FleetContext } from "./fleet-context.js";
import { gatesArchive, type Issue } from "./vocabulary/issue.js";
import { repoPath } from "./envelope/json.js";
import { featureProvenance } from "./provenance.js";
import type { Finding } from "./vocabulary/report.js";
import {
  compareIds,
  featurePaths,
  featureSpecPaths,
  featureSpecServices,
  listFeatures,
  listServices,
  servicePaths,
  SPEC_AXES,
  type FeatureEntry,
  type ServiceEntry,
} from "./repo.js";
import { requirementsMissingScenarios, type Requirement } from "./document/spec.js";
import { COMMIT_INTENT, readCommitIntent } from "./staging.js";
import {
  attestedNotice,
  featureChecklist,
  readVerificationState,
  tallyRecord,
  verificationPath,
  verificationVerdict,
  type VerificationVerdict,
  type VerifyNotice,
} from "./verify.js";

/** The closed set. The module header says what each value instructs. */
export const ARTIFACT_STATUSES = ["missing", "blocked", "draft", "ready", "done"] as const;
export type ArtifactStatus = (typeof ARTIFACT_STATUSES)[number];

/**
 * The artifact kinds a feature can owe, in the order the cycle authors them.
 * `spec`, `arch-spec` and `openapi` are per-service and repeat once per service
 * the feature touches; the rest are feature-wide.
 */
export const ARTIFACT_IDS = [
  "intent",
  "delta",
  "spec",
  "arch-spec",
  "openapi",
  "verification",
] as const;
export type ArtifactId = (typeof ARTIFACT_IDS)[number];

export interface ArtifactState {
  id: ArtifactId;
  /** The service this artifact belongs to, or null for the feature-wide ones. */
  service: string | null;
  /** Repo-relative with forward slashes — diffable across machines, like every path in the contract. */
  path: string;
  exists: boolean;
  /**
   * Whether ABSENCE is a defect. False for the artifacts a feature may
   * legitimately not have: `delta.likec4` (a requirements-only change deletes
   * it), `arch.spec.md` (optional everywhere), and `openapi.yaml` for a service
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
  /** Which command was committing, or null when the journal cannot be read at all. */
  command: "archive" | "unarchive" | null;
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
    /** How many findings would stop `loam archive` without `--approve`. */
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
  next: NextStep[];
}

export interface FleetFeatureState {
  id: string;
  dirName: string;
  path: string;
  stage: ArtifactStatus;
  services: string[];
  blockedBy: string[];
  /** Artifacts the feature owes and has not written. Presence only — the fleet form grades nothing. */
  missing: string[];
  verification: VerificationState;
}

export interface FleetStatusReport {
  /** See {@link FeatureStatusReport.interrupted}. */
  interrupted: InterruptedCommit | null;
  /**
   * Three disjoint buckets over `services/`, summing to `total`. Deliberately
   * coarser than `list`'s maturity ladder, and deliberately not the same words:
   * that ladder grades an adoption campaign rung by rung, this asks only
   * whether there is anything here to build a feature on.
   */
  services: {
    total: number;
    /** No `spec.md` — nothing about this service is written down. */
    undocumented: number;
    /** Documented, with no vouch stamp behind it. */
    draft: number;
    /** `status: verified` with a `sources_digest` — a person stood behind it. */
    vouched: number;
  };
  features: FleetFeatureState[];
  /** Dependencies before consumers — which feature has to archive first. */
  order: string[];
  service: string | null;
  next: NextStep[];
}

/* ------------------------------------------------------------------ */
/* The one state that outranks everything else                         */
/* ------------------------------------------------------------------ */

/**
 * The intent journal, if a commit left one behind. Null on every healthy repo,
 * which is every repo except one whose last write was killed.
 *
 * Cheap on purpose: an `existsSync` and, at most, one small JSON read. `doctor`
 * pays for the whole `scanWritePathResidue` walk because it is a diagnosis;
 * `status` is run before every step of the loop and asks the one question whose
 * answer invalidates all its others.
 */
async function readInterruptedCommit(docsDir: string): Promise<InterruptedCommit | null> {
  const intent = await readCommitIntent(docsDir);
  if (intent === null) {
    if (!existsSync(join(docsDir, COMMIT_INTENT))) return null;
    return {
      command: null,
      feature: null,
      host: null,
      pid: null,
      at: null,
      files: [],
      unreadable: true,
      recover: null,
    };
  }
  return {
    command: intent.command,
    feature: intent.feature,
    // Coerced here rather than trusted. `readCommitIntent` validates exactly the
    // fields a REPAIR needs — the version, the command, the restore direction,
    // the feature, the two move paths and the file digests — so `host`, `pid`
    // and `at` arrive as whatever the journal happened to hold, `undefined`
    // included. That is worse than null in both renderings: `JSON.stringify`
    // drops an undefined value's key entirely, so `--json` loses the field
    // instead of reporting it empty, and the two human lines print
    // "(undefined, pid undefined, undefined)". These three are the label a
    // person places the crash against and nothing branches on them, so the
    // coercion belongs at this boundary — widening the validator would change
    // which journals `archive` and `unarchive` agree to repair, which is a
    // decision about somebody's half-written docs, not about a label.
    host: typeof intent.host === "string" ? intent.host : null,
    pid: typeof intent.pid === "number" ? intent.pid : null,
    at: typeof intent.at === "string" ? intent.at : null,
    files: intent.files.map((f) => f.path),
    unreadable: false,
    // The recovering command is the interrupted one re-run: it repairs first,
    // under the lock, from the snapshot it took before the commit. Spelled per
    // branch rather than interpolated, like doctor's own repair line, so
    // test/agent-commands-runnable.test.ts can parse it against the real program.
    recover: intent.command === "archive" ? `loam archive ${intent.feature}` : `loam unarchive ${intent.feature}`,
  };
}

/**
 * The step that has to come before every other one. Always first, and never
 * elided by the fleet form's cap: nothing else in the list can be done until
 * somebody knows whether the living docs are the docs.
 */
function recoverStep(i: InterruptedCommit): NextStep {
  return {
    code: "next.recover-commit",
    statement: i.unreadable
      ? `${COMMIT_INTENT} in this docs repo cannot be read — a commit was interrupted and the one record of which files it had already written is unreadable. Nothing below can be trusted until a human compares the living docs against version control.`
      : `A \`${i.recover}\` was killed mid-commit (${i.host}, pid ${i.pid}, ${i.at}) — ${i.files.length} file(s) may be half-written: ${i.files.join(", ")}. Everything below is derived from those files.`,
    // No command loam offers repairs an unreadable journal — saying otherwise
    // would send an agent to run something that refuses.
    command: i.recover ?? "loam doctor --json",
  };
}

/* ------------------------------------------------------------------ */
/* One feature                                                         */
/* ------------------------------------------------------------------ */

/**
 * Everything about one feature in flight. `service` narrows the per-service
 * artifacts and the per-service steps; the feature's own `services` list stays
 * complete either way, because a narrowed view that also hid which other
 * services exist would read as a feature that touches exactly one.
 */
export async function featureStatus(
  docsDir: string,
  feature: FeatureEntry,
  opts: { service?: string; boundService?: string; context?: FleetContext } = {},
): Promise<FeatureStatusReport> {
  const context = opts.context ?? new FleetContext();
  const interrupted = await readInterruptedCommit(docsDir);
  const services = await featureSpecServices(feature.dir, context);
  const narrowed = opts.service;
  const inView = narrowed === undefined ? services : services.filter((s) => s === narrowed);

  const scans = feature.archived ? [] : await scanDeltas(docsDir, feature, services, context);
  const read = await verificationState(docsDir, feature);
  const verification = read.state;
  // An archived feature is history: its delta is already folded into the living
  // docs, so coherence would grade the change against a world that has absorbed
  // it and report contradictions that are only the merge having happened. The
  // same reason `list` never calls an archived record stale.
  const findings = feature.archived ? [] : await featureFindings(docsDir, feature, scans, context);
  // `verify.scenario-attested` rides in the same array an agent already parses,
  // under verify's own code — a feature confirmed the short way has to be
  // MARKED here, not merely absent from `stage: done`. It is a warning and it
  // gates nothing, so `coherent` is untouched.
  if (!feature.archived && read.notice !== null) {
    findings.push({ severity: read.notice.severity, code: read.notice.code, message: read.notice.message });
  }
  const errors = findings.filter((f) => f.severity === "error");
  const warnings = findings.filter((f) => f.severity === "warn").length;
  // The union of the two gates, and the set every verdict below is drawn from.
  const blocking = findings.filter(unshippable);

  const governs = governedServices(scans);
  // The whole feature is graded, then the view is narrowed — never the other
  // way round. `--service` is a lens on the table and the steps; a rollup that
  // moved with it would report a feature `ready` because the one service you
  // asked about happens to be written, while three others have nothing.
  const graded = featureArtifacts(
    docsDir,
    feature,
    services,
    blocking,
    verification,
    contractsHeldElsewhere(await contractOwners(docsDir, context), feature.id),
    governs,
  );
  const artifacts =
    narrowed === undefined ? graded : graded.filter((a) => a.service === null || a.service === narrowed);

  // The dependency index rather than the `*-pending` issue codes: those name the
  // other feature in prose, and prose is not an API — dependencies.ts opens with
  // exactly that argument. An archived feature waits on nothing; it landed.
  const graph = feature.archived
    ? null
    : await analyzeDependencies(docsDir, feature.id, context);
  const blockedBy = graph?.nodes.find((n) => n.id === feature.id)?.dependsOn ?? [];

  return {
    interrupted,
    feature: {
      id: feature.id,
      dirName: feature.dirName,
      path: repoPath(docsDir, feature.dir),
      archived: feature.archived,
      stage: featureStage(feature, graded, services, blocking.length, blockedBy, verification, interrupted),
      services,
      blockedBy,
    },
    service: narrowed ?? null,
    artifacts,
    checks: {
      ran: !feature.archived,
      coherent: errors.length === 0,
      errors: errors.length,
      warnings,
      gating: findings.filter((f) => f.gates === true).length,
      issues: findings,
    },
    verification,
    next: featureNext(
      feature,
      inView,
      artifacts,
      findings,
      blockedBy,
      verification,
      scans,
      opts.boundService,
      interrupted,
    ),
  };
}

/**
 * Everything `loam validate --feature` and `loam archive` would say about this
 * feature, in one list, through the very functions they call.
 *
 * Coherence alone was not it. `validate --feature` also runs `featureProvenance`
 * over intent.md and the scenario-coverage check over every per-service delta,
 * and both grade ERRORS — so a feature whose requirements carry no scenario at
 * all read `coherent: true` here while `validate` exited 1 on the same tree.
 * The coherence findings carry `gates` resolved, because archive's question is
 * not severity's (issue.ts) and no consumer should re-derive it.
 */
async function featureFindings(
  docsDir: string,
  feature: FeatureEntry,
  scans: DeltaScan[],
  context: FleetContext,
): Promise<Finding[]> {
  const issues: Issue[] = await featureCoherence(docsDir, feature.dir, feature.id, undefined, context);
  const out: Finding[] = issues.map((i) => ({
    severity: i.severity,
    code: i.code,
    gates: gatesArchive(i),
    ...(i.subject === undefined ? {} : { subject: i.subject }),
    message: i.message,
  }));
  out.push(...(await featureProvenance(feature.dir, feature.id)).filter((f) => f.severity !== "ok"));
  // The two refusals `archive` makes at PLAN time, from the same functions it
  // calls. They are not coherence issues — one is about a service id that means
  // nothing, the other about a LIVING document nobody wrote — so they reach
  // archive outside `featureCoherence`, and a projection that only inherited
  // coherence printed "ship it" over both. Errors: each is a refusal, and the
  // rule this module is held to is one-directional.
  out.push(...(await unknownDeltaServices(docsDir, feature.dir, feature.id, undefined, context)));
  out.push(...(await livingMergeConflicts(docsDir, await featureSpecServices(feature.dir, context), context)));
  for (const scan of scans) {
    if (scan.bare.length === 0) continue;
    out.push({
      severity: "error",
      code: "requirements.missing-scenarios",
      subject: scan.service,
      message: `${scan.label}: ${scan.bare.length} requirement(s) without a scenario`,
      details: scan.bare.map((r) => r.name),
    });
  }
  return out;
}

/**
 * Would either gate refuse this? Severity answers `validate`'s question and
 * `gates` answers archive's; a finding that fails EITHER is one an author has
 * work to do about, and collapsing them to `severity === "error"` is how
 * `status` came to print "ship it" beside a warning archive exits 1 on.
 */
function unshippable(f: Finding): boolean {
  return f.severity === "error" || f.gates === true;
}

/**
 * The feature's own rollup, worst first. The order is the order the work has to
 * happen in, so the winning branch is also the phase the feature is in:
 * unwritten artifacts come before an ordering problem (you can author while
 * another feature is still in flight), an ordering problem comes before this
 * feature's own errors (fixing them may be pointless until the other one
 * lands), and everything comes before the record — answers written over a
 * broken feature are answers to questions that are about to change.
 *
 * The record is excluded from the `missing` branch on purpose. It is not
 * something an author writes: it is the done-check's output, and counting its
 * absence as unwritten work would report every correctly-authored feature as
 * `missing` right up until somebody ran `loam verify` — which is the state
 * `ready` exists to name, and which the fleet form already names correctly.
 */
function featureStage(
  feature: FeatureEntry,
  artifacts: ArtifactState[],
  services: string[],
  blocking: number,
  blockedBy: string[],
  verification: VerificationState,
  interrupted: InterruptedCommit | null,
): ArtifactStatus {
  // Ahead of `archived`, and ahead of everything else: a killed commit may be
  // this very feature's, half-applied, so "it shipped" is a claim about files
  // nobody has established the contents of. `blocked` is the honest word — the
  // work is stalled on something that is not this feature's artifact — and it
  // is what stops the projection printing `done` over a half-merged repo.
  if (interrupted !== null) return "blocked";
  if (feature.archived) return "done";
  // A feature with no `specs/<service>/` changes nothing. There is no artifact
  // row to be missing — the rows are per service — so the emptiness itself is
  // the finding, and `next.touch-service` is the step.
  if (services.length === 0) return "missing";
  if (artifacts.some((a) => a.id !== "verification" && a.status === "missing")) return "missing";
  if (blockedBy.length > 0) return "blocked";
  if (blocking > 0) return "draft";
  return fullyVerified(verification) ? "done" : "ready";
}

/**
 * Is the done-check discharged? `verificationVerdict`'s answer and nobody
 * else's — status re-deriving it would be a fourth place the words "verified"
 * are defined, and the day one of them changed (a scenario claim on an agent's
 * word stopped counting) the reader's copy would be the one still saying yes.
 * `attested` is deliberately NOT `done` here: it is complete work resting on an
 * assertion, which is what `ready` has always meant — the document is right and
 * the world has not caught up.
 */
function fullyVerified(v: VerificationState): boolean {
  return v.verdict === "verified";
}

/**
 * Which artifact an error names.
 *
 * Attribution is by code family, because that is the only machine-readable
 * pointer an `Issue` carries: `subject` narrows to a service, never to a file.
 * The families are unambiguous — `c4-api.*`/`c4.*` and the two `delta.*` codes
 * about the LikeC4 document itself grade the architecture axis, `openapi.*`
 * grades the contract, and the remaining `delta.*` codes are the delta-shape
 * checks, every one of which is about a requirement in a spec delta.
 *
 * An error that maps to nothing (or whose subject is unknown) still lands in
 * `checks.issues` and still drives `next.fix-coherence` — it just does not turn
 * any single artifact `draft`, because guessing which file to blame is how a
 * reader gets sent to edit the wrong one.
 */
function faultedArtifact(code: string): ArtifactId | null {
  if (code === "delta.invalid" || code === "delta.nothing-tagged") return "delta";
  if (code.startsWith("c4-api.") || code.startsWith("c4.")) return "delta";
  if (code.startsWith("openapi.")) return "openapi";
  if (code.startsWith("delta.") || code.startsWith("spec-api.")) return "spec";
  // The two families validate contributes: the frontmatter checks read only
  // intent.md, and a requirement with no scenario is a requirement in a spec
  // delta. Both name exactly one file, so both may turn a row `draft`.
  if (code.startsWith("frontmatter.")) return "intent";
  if (code === "requirements.missing-scenarios") return "spec";
  return null;
}

/**
 * The artifact table. Every entry is graded by two questions in order — is it
 * there, and does anything the shared checks reported name it — so a file that
 * exists and is wrong can never be reported the way one that was never written
 * is.
 */
function featureArtifacts(
  docsDir: string,
  feature: FeatureEntry,
  services: string[],
  blocking: Finding[],
  verification: VerificationState,
  contracted: ReadonlySet<string>,
  governs: ReadonlySet<string>,
): ArtifactState[] {
  const paths = featurePaths(feature.dir);
  const rel = (abs: string): string => repoPath(docsDir, abs);
  const faults = blocking.map((f) => ({ artifact: faultedArtifact(f.code), subject: f.subject }));
  const faulted = (id: ArtifactId, service: string | null): boolean =>
    faults.some((f) => f.artifact === id && (service === null || f.subject === service));

  const out: ArtifactState[] = [
    fileState("intent", null, rel(paths.intent), existsSync(paths.intent), true, faulted("intent", null)),
    fileState("delta", null, rel(paths.delta), existsSync(paths.delta), false, faulted("delta", null)),
  ];

  for (const svc of services) {
    const p = featureSpecPaths(feature.dir, svc);
    const specFault = faulted("spec", svc);
    out.push(fileState("spec", svc, rel(p.spec), existsSync(p.spec), true, specFault));
    out.push(fileState("arch-spec", svc, rel(p.archSpec), existsSync(p.archSpec), false, specFault));
    out.push(
      fileState(
        "openapi",
        svc,
        rel(p.openapi),
        existsSync(p.openapi),
        owesContract(docsDir, svc, contracted, governs.has(svc)),
        faulted("openapi", svc),
      ),
    );
  }

  // The record is the one artifact with a real prerequisite: its checklist is
  // derived from the delta and the per-service deltas, so with none of them
  // written there is nothing to answer — authoring one is impossible rather
  // than merely premature, which is the whole distinction `blocked` carries.
  const feeders = out.filter((a) => a.id !== "intent" && a.id !== "arch-spec" && a.exists);
  out.push({
    id: "verification",
    service: null,
    path: rel(verificationPath(feature.dir)),
    exists: verification.state !== "absent",
    required: true,
    status: feeders.length === 0 ? "blocked" : verificationStatus(verification),
    blockedBy: feeders.length === 0 ? ["delta", "spec", "openapi"] : [],
  });
  return out;
}

function fileState(
  id: ArtifactId,
  service: string | null,
  path: string,
  exists: boolean,
  required: boolean,
  faulted: boolean,
): ArtifactState {
  const status: ArtifactStatus = !exists
    ? required
      ? "missing"
      : "done"
    : faulted
      ? "draft"
      : "done";
  return { id, service, path, exists, required, status, blockedBy: [] };
}

/**
 * Does this feature owe `svc` an openapi.yaml?
 *
 * Keyed on the living CONTRACT FILE, never on `services/<svc>/` merely existing
 * as a directory. A service adopted without a contract is precisely the case
 * where a feature that governs operations has to write one, and the directory
 * test answered "none owed" there — printing `(not written — none owed)` beside
 * the `spec-api.op-undefined` finding, in the same payload, about that very
 * file, while suppressing the only step that names it.
 *
 * Two ways to owe nothing, both about somebody else discharging it: the living
 * docs already carry the contract, or another feature in flight brings it — the
 * same softening coherence applies with its `*-pending` codes, where an
 * operation "defined by another feature still in flight" is an ordering fact
 * and not a hole. And one way to owe nothing at all: a service that ALREADY
 * EXISTS under `services/`, has no living contract, and that this feature sends
 * no operation to. A UI or a worker nobody calls has no API to write down,
 * which is the reading `validate` and `list` already take — demanding one from
 * an adopted service of that shape would be loam telling an author to invent a
 * contract.
 *
 * That last exemption is deliberately withheld from a service the living docs
 * have never heard of. A feature that introduces a service and sends it no
 * operation still owes the file, because nothing else in the repository will
 * ever describe its surface, and `c4-api.op-undefined` fires on an op-tagged
 * delta edge whether or not any `Operations:` line was written — so answering
 * "none owed" there printed `(not written — none owed)` in the same payload as
 * an error about that very file.
 */
function owesContract(
  docsDir: string,
  svc: string,
  contracted: ReadonlySet<string>,
  governsOperations: boolean,
): boolean {
  if (existsSync(servicePaths(docsDir, svc).openapi)) return false;
  if (contracted.has(svc)) return false;
  return !existsSync(servicePaths(docsDir, svc).dir) || governsOperations;
}

/**
 * Which features in flight carry an `openapi.yaml` for which service — one
 * enumeration of the whole index, service by service.
 *
 * The owners are recorded as feature IDS rather than directories because that
 * is the comparison {@link contractsHeldElsewhere} makes: two directories that
 * spell the same id are one feature as far as this question goes, and an index
 * keyed by directory would let a duplicated id answer "somebody else has it"
 * about its own twin.
 *
 * Enumeration only — the feature list and its `specs/` subdirectories are
 * already in the request-scoped index by the time anything asks.
 */
async function contractOwners(docsDir: string, context: FleetContext): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  for (const f of await listFeatures(docsDir, {}, context)) {
    for (const svc of f.services) {
      if (!existsSync(featureSpecPaths(f.dir, svc).openapi)) continue;
      const owners = out.get(svc);
      if (owners === undefined) out.set(svc, new Set([f.id]));
      else owners.add(f.id);
    }
  }
  return out;
}

/**
 * Services some OTHER active feature already carries an `openapi.yaml` for.
 *
 * Derived from the shared index rather than re-walked, because the answer for
 * feature A and the answer for feature B are two readings of one enumeration:
 * asking it once per feature made the fleet form pay F²·S `existsSync` calls
 * over the two quantities that actually grow.
 */
function contractsHeldElsewhere(owners: ReadonlyMap<string, ReadonlySet<string>>, self: string): Set<string> {
  const out = new Set<string>();
  for (const [svc, ids] of owners) {
    for (const id of ids) {
      if (id !== self) {
        out.add(svc);
        break;
      }
    }
  }
  return out;
}

/**
 * The record's own rung. `stale` and `unreadable` are `draft` because both mean
 * the file on disk is the thing to fix; unconfirmed claims are `ready` because
 * the file is fine and the answer lives in the code.
 *
 * All four states are spelled, `recorded` included, so the `never` below fails
 * the build rather than the reader: a fifth record state added to
 * {@link VerificationState} would otherwise fall through into the last branch
 * and be graded by `fullyVerified` alone — silently answering `ready` about a
 * record whose new state nobody here has decided a rung for.
 */
function verificationStatus(v: VerificationState): ArtifactStatus {
  if (v.state === "absent") return "missing";
  if (v.state === "unreadable" || v.state === "stale") return "draft";
  if (v.state === "recorded") return fullyVerified(v) ? "done" : "ready";
  const unreachable: never = v.state;
  throw new Error(`verificationStatus: no rung for verification state '${String(unreachable)}'`);
}

/**
 * Read the record and, only when there is one, ask whether it still answers
 * this feature. The checklist is derived on demand and never speculatively: it
 * loads the delta into a LikeC4 workspace, and paying that in order to print
 * "no record" is the cost `list` refused for its verification column.
 *
 * An archived feature's record is frozen history — archive merged its
 * operations into the living contract, so a re-derived checklist can only
 * mismatch, and calling it stale would slander every feature that shipped.
 */
async function verificationState(
  docsDir: string,
  feature: FeatureEntry,
): Promise<{ state: VerificationState; notice: VerifyNotice | null }> {
  const empty = {
    recorded: null,
    verdict: "unverified" as VerificationVerdict,
    claims: 0,
    confirmed: 0,
    unconfirmed: 0,
    unanswered: 0,
    attested: 0,
  };
  const read = await readVerificationState(feature.dir);
  if (read.state === "absent") return { state: { state: "absent", ...empty }, notice: null };
  // A record whose summary contradicts its own claims is refused by the reader
  // itself (`verify.record-miscounted`), so this branch reports zeros rather
  // than salvaging counts from a file nobody can say which half of was edited.
  // Where there ARE counts they are `tallyRecord`'s, never the summary's — the
  // block used to be copied out verbatim, and a record `verify --json` calls
  // unverified read here as "11 of 11 confirmed".
  if (read.state === "unreadable") return { state: { state: "unreadable", ...empty }, notice: null };

  const v = read.verification;
  const stale = feature.archived
    ? false
    : (await featureChecklist(docsDir, feature.dir, feature.id)).digest !== v.checklist;
  const tally = tallyRecord(v);
  return {
    state: {
      state: stale ? "stale" : "recorded",
      recorded: v.recorded,
      verdict: verificationVerdict(tally, stale),
      claims: tally.claims,
      confirmed: tally.confirmed,
      unconfirmed: tally.unconfirmed,
      unanswered: tally.unanswered,
      attested: tally.attested,
    },
    notice: attestedNotice(v.claims, feature.id),
  };
}

/* ------------------------------------------------------------------ */
/* next[] — one feature                                                */
/* ------------------------------------------------------------------ */

/** Codes whose one fix is `loam rebase`: a pin nobody ever wrote, on either axis. */
const UNPINNED = new Set(["delta.baseline-missing", "openapi.baseline-missing"]);

function featureNext(
  feature: FeatureEntry,
  services: string[],
  artifacts: ArtifactState[],
  findings: Finding[],
  blockedBy: string[],
  verification: VerificationState,
  scans: DeltaScan[],
  boundService: string | undefined,
  interrupted: InterruptedCommit | null,
): NextStep[] {
  const id = feature.id;
  // Before the archived shortcut: the interrupted commit may be this feature's
  // own, and "it shipped" is not a thing to tell somebody whose living docs are
  // half-written.
  const first = interrupted === null ? [] : [recoverStep(interrupted)];
  if (feature.archived) {
    return [
      ...first,
      {
        code: "next.archived",
        statement: `${id} is archived — it shipped, and its delta is already folded into the living docs.`,
        command: `loam show ${id} --json`,
      },
    ];
  }

  const steps: NextStep[] = [...first];
  const owed = (kind: ArtifactId, service?: string): ArtifactState | undefined =>
    artifacts.find(
      (a) => a.id === kind && a.status === "missing" && (service === undefined || a.service === service),
    );

  const intent = owed("intent");
  if (intent !== undefined) {
    steps.push({
      code: "next.author-intent",
      statement: `Write ${intent.path} — what ${id} is for, in prose, before anything is derived from it.`,
      command: `loam validate ${id} --json`,
      artifact: "intent",
      path: intent.path,
    });
  }

  if (services.length === 0) {
    steps.push({
      code: "next.touch-service",
      statement: `${id} carries no per-service delta — add specs/<service>/spec.md for every service it changes.`,
      command: "loam list services --json",
    });
  }

  for (const svc of services) {
    const spec = owed("spec", svc);
    if (spec !== undefined) {
      steps.push({
        code: "next.author-spec",
        statement: `Write ${spec.path} — the ADDED/MODIFIED/REMOVED requirements ${id} makes to ${svc}, each with a scenario.`,
        command: `loam delta ${id} --service ${svc} --json`,
        artifact: "spec",
        service: svc,
        path: spec.path,
      });
    }
    const api = owed("openapi", svc);
    if (api !== undefined) {
      steps.push({
        code: "next.author-openapi",
        // Not "the service is not in the living docs": a service adopted
        // without a contract is the commoner case, and that wording sent a
        // reader looking for a directory that was right there. And not "the
        // operations it governs" either — this step also fires for a service
        // the feature INTRODUCES, where owesContract asks nothing about
        // operations and the delta may tag none, so naming them promised the
        // author a list they would go looking for and not find.
        statement: `Write ${api.path} — nothing gives ${svc} a living openapi.yaml, so this feature is the only thing that can write down its API surface.`,
        command: `loam delta ${id} --service ${svc} --json`,
        artifact: "openapi",
        service: svc,
        path: api.path,
      });
    }
  }

  // A requirement with no scenario yields no generated .feature and no
  // scenario.tested claim: a promise that reaches neither the suite nor the
  // done-check, and that nothing downstream will ever mention again. One entry
  // per service rather than per requirement — a delta with forty bare
  // requirements would otherwise BE the payload (validate caps its details for
  // the same reason).
  for (const gap of scans) {
    if (gap.bare.length === 0 || !services.includes(gap.service)) continue;
    steps.push({
      code: "next.author-scenarios",
      statement:
        `${gap.bare.length} requirement(s) in ${gap.service}'s delta have no '#### Scenario:' ` +
        `(starting with '${gap.bare[0]!.name}') — they generate no test and no verify claim.`,
      command: `loam delta ${id} --service ${gap.service} --json`,
      artifact: "spec",
      service: gap.service,
      path: gap.path,
    });
  }

  if (findings.some((f) => UNPINNED.has(f.code))) {
    steps.push({
      code: "next.rebase",
      statement: `${id} carries requirements or operations with no baseline pin — until they have one the merge cannot tell what it EDITS from what it merely quotes.`,
      command: `loam rebase ${id}`,
    });
  }

  if (blockedBy.length > 0) {
    steps.push({
      code: "next.archive-first",
      statement: `${id} builds on ${blockedBy.join(", ")}, which ${blockedBy.length === 1 ? "has" : "have"} to archive first.`,
      command: `loam dependencies ${id} --json`,
    });
  }

  // Everything either gate refuses on, not just the errors: a warning marked
  // `gates: true` stops archive exactly as hard, and leaving it out of the
  // steps was the other half of leaving it out of the stage.
  const blocking = findings.filter(unshippable);
  if (blocking.length > 0) {
    const gating = blocking.filter((f) => f.gates === true && f.severity !== "error").length;
    steps.push({
      code: "next.fix-coherence",
      statement:
        `${id} has ${blocking.length} finding(s) that stop it, starting with ${blocking[0]!.code}` +
        (gating > 0
          ? ` — ${gating} of them ${gating === 1 ? "is a warning that GATES" : "are warnings that GATE"} archive, ` +
            "which `validate` grades valid, so its exit code alone will not show you why archive refuses."
          : " — the axes disagree, and archive refuses."),
      command: `loam validate ${id} --json`,
    });
  }

  // The implementation half of the forward flow, which next[] never named at
  // all: an agent read "author the spec" and then "record the verification",
  // with nothing in between saying where a test comes from — so the only way
  // left to answer a scenario claim was its own word, through `--record`.
  steps.push(...testStep(id, services, scans, verification, boundService));
  steps.push(...verifyStep(id, artifacts, verification, boundService, services));

  // Always last, and always present: a feature whose every artifact holds and
  // whose record is complete still has one thing left to do, and an empty
  // `next[]` would leave a caller unable to tell "finished" from "this command
  // had nothing to say".
  steps.push({
    code: "next.archive",
    statement:
      steps.length === 0
        ? `${id} is authored, coherent and verified — ship it.`
        : `${id} ships once everything above is done; the dry run writes nothing and lists every file the merge would touch.`,
    command: `loam archive ${id} --dry-run --json`,
  });
  return steps;
}

/**
 * The done-check step, or none. Four different situations reach `loam verify`
 * and they are not the same work — nothing recorded, a file that will not read,
 * a record the feature has moved out from under, and claims still open — so the
 * statement says which. The code splits only where the WORK splits: starting a
 * verification and finishing one are different jobs, and an agent that treats a
 * stale record as a finished one ships a feature nobody checked.
 */
function verifyStep(
  id: string,
  artifacts: ArtifactState[],
  verification: VerificationState,
  boundService: string | undefined,
  services: string[],
): NextStep[] {
  const record = artifacts.find((a) => a.id === "verification")!;
  const open = verification.unconfirmed + verification.unanswered;
  // The code is spelled at each call site as a `code:` property rather than
  // passed positionally, and the helper takes the whole pair: test/codes-drift.ts
  // collects the vocabulary by reading the source for that exact shape, so a
  // factory with a `code` PARAMETER would hide every code it emits from the one
  // guard that checks they are documented. Same DRY-ness, visible to the guard.
  const step = (s: { code: string; statement: string }): NextStep[] => [
    { ...s, command: `loam verify ${id} --json`, artifact: "verification", path: record.path },
  ];

  if (record.status === "blocked") {
    return step({
      code: "next.verify",
      statement: `${id} has nothing to derive a checklist from yet — write the delta and the requirement deltas first.`,
    });
  }
  if (verification.state === "absent") {
    return step({
      code: "next.verify",
      statement: `Nothing has been verified for ${id} — derive the checklist and answer every claim with evidence.`,
    });
  }
  if (verification.state === "unreadable") {
    return step({
      code: "next.verify",
      statement: `${record.path} exists but does not read as a record — repair or delete it; nothing will overwrite it while it is unreadable.`,
    });
  }
  if (verification.state === "stale") {
    return step({
      code: "next.verify",
      statement: `${id} moved after ${record.path} was written — the record answers a checklist that is no longer the one being asked.`,
    });
  }
  if (open > 0) {
    // The recording form only when this repository is one of the services that
    // owes an answer: `verify --record --service` binds the answers to THIS
    // repo's HEAD and refuses anywhere else, so handing a docs-repo reader that
    // command would name a step it cannot take.
    return boundService !== undefined && services.includes(boundService)
      ? [
          {
            code: "next.attest-service",
            statement:
              `${open} of ${verification.claims} claim(s) on ${id} are open, and this repository is '${boundService}' — ` +
              `answer the ones filed under it, bound to this commit; the rest belong to their own repositories.`,
            command: `loam verify ${id} --record answers.json --service ${boundService}`,
            artifact: "verification",
            service: boundService,
            path: record.path,
          },
        ]
      : step({
          code: "next.verify-unconfirmed",
          statement: `${open} of ${verification.claims} claim(s) on ${id} are not confirmed — close them from each affected service's own repository.`,
        });
  }
  if (verification.claims === 0) {
    return step({
      code: "next.verify",
      statement: `${record.path} answers no claims at all — nothing was asked, so nothing was checked; re-derive the checklist and see what this feature actually promises.`,
    });
  }
  if (verification.verdict === "attested") {
    return [
      {
        code: "next.verify-attested",
        statement:
          `${verification.attested} of ${id}'s scenario claim(s) are confirmed on an agent's word, not on a test run ` +
          `(verify.scenario-attested) — answer them from a cucumber report, and the record stops resting on an assertion.`,
        command: `loam verify ${id} --results <cucumber-report.json>`,
        artifact: "verification",
        path: record.path,
      },
    ];
  }
  return [];
}

/**
 * Where a test comes from. `loam gherkin` writes the .feature files whose green
 * run is the only thing that may answer a `scenario.tested` claim, and it runs
 * from the service's own repository — so the step exists wherever there are
 * scenarios to generate from, and names the repository to run it in when that
 * is not this one.
 */
function testStep(
  id: string,
  services: string[],
  scans: DeltaScan[],
  verification: VerificationState,
  boundService: string | undefined,
): NextStep[] {
  if (fullyVerified(verification)) return [];
  const withScenarios = [
    ...new Set(scans.filter((s) => s.scenarios > 0 && services.includes(s.service)).map((s) => s.service)),
  ];
  if (withScenarios.length === 0) return [];
  const svc = boundService !== undefined && withScenarios.includes(boundService) ? boundService : withScenarios[0]!;
  const here = svc === boundService;
  return [
    {
      code: "next.generate-tests",
      statement:
        `${id}'s delta for ${svc} carries scenarios that no test run has answered yet — generate the suite, then implement against it` +
        (here
          ? "."
          : `. \`loam gherkin\` writes into the service's own repository, so run it from ${svc}'s${
              withScenarios.length > 1 ? ` (and likewise for ${withScenarios.slice(1).join(", ")})` : ""
            }.`),
      command: `loam gherkin ${id} --service ${svc}`,
      artifact: "spec",
      service: svc,
    },
  ];
}

/**
 * One read of each per-service delta, answering the three questions everything
 * above asks of it: which requirements carry no scenario (via the same
 * `requirementsMissingScenarios` every coverage check calls — REMOVED
 * requirements are exempt there and stay exempt here, content on its way out
 * owes no acceptance criteria), how many scenarios there are to generate a
 * suite from, and whether the delta governs any operation at all — which is
 * what decides whether the service is owed a contract.
 */
interface DeltaScan {
  service: string;
  /** Repo-relative, and the file the steps point at. */
  path: string;
  /** validate's own label for this axis: `<svc>: requirements` / `<svc>: arch requirements`. */
  label: string;
  bare: Requirement[];
  scenarios: number;
  /** Operations the non-REMOVED requirements govern. `spec.md` only, like coherence's own `reqOps`. */
  operations: number;
}

async function scanDeltas(
  docsDir: string,
  feature: FeatureEntry,
  services: string[],
  context: FleetContext,
): Promise<DeltaScan[]> {
  const out: DeltaScan[] = [];
  for (const svc of services) {
    const p = featureSpecPaths(feature.dir, svc);
    // SPEC_AXES already carries the prose name of each axis — "requirements"
    // and "arch requirements" are its `label`s verbatim — so the pair is read
    // from there rather than spelled again, and a service's status can never
    // walk a different set of spec files than its validation does.
    for (const [file, label] of SPEC_AXES.map(
      (axis) => [p[axis.key], `${svc}: ${axis.label}`] as const,
    )) {
      if (!existsSync(file)) continue;
      const reqs = await context.readRequirements(file);
      out.push({
        service: svc,
        path: repoPath(docsDir, file),
        label,
        bare: requirementsMissingScenarios(reqs),
        scenarios: reqs.reduce((n, r) => n + r.scenarios.length, 0),
        operations:
          file === p.spec
            ? reqs.filter((r) => r.kind !== "REMOVED").reduce((n, r) => n + r.operations.length, 0)
            : 0,
      });
    }
  }
  return out;
}

/** Services this feature sends at least one operation to — see {@link owesContract}. */
function governedServices(scans: DeltaScan[]): ReadonlySet<string> {
  return new Set(scans.filter((s) => s.operations > 0).map((s) => s.service));
}

/* ------------------------------------------------------------------ */
/* The whole repository                                                */
/* ------------------------------------------------------------------ */

/**
 * The fleet view: how much of `services/` anyone has written down, every
 * feature in flight with the stage it has reached, and the order they have to
 * land in. Nothing here is graded — the module header says why — so the stages
 * are drawn from artifact presence and from a record that already exists, and
 * `next[]` hands off to `loam status <FEAT>` for everything else.
 */
export async function fleetStatus(
  docsDir: string,
  opts: { service?: string; bound?: string; context?: FleetContext } = {},
): Promise<FleetStatusReport> {
  const context = opts.context ?? new FleetContext();
  const interrupted = await readInterruptedCommit(docsDir);
  const narrowed = opts.service;
  const all = await listServices(docsDir, context);
  const services = narrowed === undefined ? all : all.filter((s) => s.id === narrowed);
  // The service this repository says it IS, when the fleet has never heard of
  // it. Asked against the UNNARROWED list, because "is it adopted" is a question
  // about the fleet and not about the view.
  const unadopted =
    opts.bound !== undefined && !all.some((s) => s.id === opts.bound) ? opts.bound : null;
  const graph = await analyzeDependencies(docsDir, undefined, context);
  const entries = await listFeatures(docsDir, {}, context);
  const inScope = narrowed === undefined ? entries : entries.filter((f) => f.services.some((s) => s === narrowed));
  // Once for the fleet, not once per feature: which features hold a contract
  // for which service is one fact about the repository, and every feature below
  // reads its own row out of it. Built over the UNNARROWED list on purpose — a
  // `--service` view still has to know that a feature outside it discharges the
  // contract, or the narrowing would invent an obligation.
  const owners = await contractOwners(docsDir, context);

  const features = await Promise.all(
    inScope.map((f) =>
      fleetFeature(docsDir, f, graph, contractsHeldElsewhere(owners, f.id), context, interrupted),
    ),
  );
  features.sort((a, b) => compareIds(a.id, b.id));

  return {
    interrupted,
    services: {
      total: services.length,
      undocumented: services.filter(undocumented).length,
      draft: services.filter((s) => !undocumented(s) && !vouched(s)).length,
      vouched: services.filter(vouched).length,
    },
    features,
    order: graph.order.filter((id) => features.some((f) => f.id === id)),
    service: narrowed ?? null,
    // The binding is passed only when this run was NOT narrowed. `--service X`
    // is an explicit question about X, and answering it with a step about
    // whichever service loam.json happens to name would be a different
    // question's answer at the top of the list.
    next: fleetNext(services, features, graph, interrupted, narrowed === undefined ? unadopted : null),
  };
}

/** Nothing is written down: no living spec at all. Every other absence is partial adoption. */
function undocumented(s: ServiceEntry): boolean {
  return !s.has.spec;
}

/** A person stamped it — `loam vouch`'s exact postcondition, read back off the frontmatter. */
function vouched(s: ServiceEntry): boolean {
  return s.status === "verified" && s.sources.stamped;
}

async function fleetFeature(
  docsDir: string,
  feature: FeatureEntry,
  graph: DependencyGraph,
  contracted: ReadonlySet<string>,
  context: FleetContext,
  interrupted: InterruptedCommit | null,
): Promise<FleetFeatureState> {
  const paths = featurePaths(feature.dir);
  const missing: string[] = [];
  if (!existsSync(paths.intent)) missing.push("intent");
  if (feature.services.length === 0) missing.push("spec");
  // Requirement text, not a coherence run: `Operations:` lines are read off the
  // same cached parse `list` already pays for, and the contract question needs
  // them (owesContract). No LikeC4 workspace is spun here, which is the cost
  // this form actually refuses.
  const governs = governedServices(await scanDeltas(docsDir, feature, feature.services, context));
  for (const svc of feature.services) {
    const p = featureSpecPaths(feature.dir, svc);
    if (!existsSync(p.spec)) missing.push(`${svc}/spec`);
    // The same question featureArtifacts asks, through the same function: the
    // two forms must never disagree about whether a feature owes a contract.
    if (owesContract(docsDir, svc, contracted, governs.has(svc)) && !existsSync(p.openapi)) {
      missing.push(`${svc}/openapi`);
    }
  }
  const verification = (await verificationState(docsDir, feature)).state;
  const blockedBy = graph.nodes.find((n) => n.id === feature.id)?.dependsOn ?? [];

  // No `draft` here, ever: that verdict needs the coherence run this form
  // refuses to pay for, and inferring it from presence alone would be a second
  // opinion about validity — the one thing status must never invent.
  //
  // The interrupted commit leads, exactly as it does in the feature form: every
  // presence test below is a question about files a killed `archive` may have
  // half-written, so answering `done` from them is a claim about bytes nobody
  // has established. Without this the two forms contradicted each other over
  // one repository — `loam status --json` said `done` and offered "ship it"
  // while `loam status <FEAT>` said `blocked` — and the module header's rule is
  // that this projection is never greener than the gates.
  const stage: ArtifactStatus =
    interrupted !== null
      ? "blocked"
      : missing.length > 0
        ? "missing"
        : blockedBy.length > 0
          ? "blocked"
          : fullyVerified(verification)
            ? "done"
            : "ready";

  return {
    id: feature.id,
    dirName: feature.dirName,
    path: repoPath(docsDir, feature.dir),
    stage,
    services: feature.services,
    blockedBy,
    missing,
    verification,
  };
}

/** How urgent a stage is at fleet level. See {@link fleetNext}. */
const STAGE_RANK: Record<ArtifactStatus, number> = {
  done: 0,
  ready: 1,
  draft: 2,
  missing: 3,
  blocked: 4,
};

/**
 * How many per-service and per-feature steps the fleet form will print before
 * it stops and says how many it left out. A fleet mid-adoption produced 135
 * entries under the heading "the next thing to do" — a list nobody reads is a
 * list that is not navigation, and the first ten are the ten that matter
 * because the ordering below is already most-unblocking-first.
 *
 * Exported so the test asserts the cap through the constant: a literal 10 in a
 * fixture is a second declaration of the limit, free to disagree the day this
 * one moves.
 */
export const FLEET_NEXT_LIMIT = 10;

/**
 * Fleet-level steps, most-unblocking first. A feature ready to ship comes
 * before one that still needs authoring, because archiving it is what releases
 * everything queued behind it; a blocked feature comes last, because there is
 * nothing to do about it from here — its prerequisite is already higher up the
 * list under its own entry.
 *
 * The gate is the LAST entry and it is always there. `next.fleet-clean` used to
 * be the only route to `loam validate --all`, and it was emitted only when
 * nothing was in flight — so a repository that FAILS the fleet gate, which is
 * every repository with work in it, was handed a green-looking list that never
 * once named the command CI runs. This form grades nothing; the least it can do
 * is say where grading happens.
 */
function fleetNext(
  services: ServiceEntry[],
  features: FleetFeatureState[],
  graph: DependencyGraph,
  interrupted: InterruptedCommit | null,
  unadoptedBinding: string | null,
): NextStep[] {
  const steps: NextStep[] = [];

  // The repository this command is standing in names a service the fleet has no
  // directory for. First, ahead of every other service's partial adoption,
  // because it is the only step that is about HERE.
  //
  // This form used to count the fleet and ignore the binding entirely, so in a
  // service repo bound to an unadopted service — a freshly wired one, the most
  // common repo there is — an empty fleet made "every service is written down"
  // vacuously true and `next.fleet-clean` came out top. `loam doctor` had the
  // right answer (`doctor.service-unknown`) at the same moment, and the
  // documented agent loop reads `status`: an agent following it was sent to
  // start a feature instead of adopting the service under its feet.
  if (unadoptedBinding !== null) {
    steps.push({
      code: "next.adopt-bound",
      statement:
        `This repository's loam.json says it is '${unadoptedBinding}', and the fleet has no ` +
        `services/${unadoptedBinding}/ — nothing about the service you are standing in is written down yet.`,
      command: `loam adopt --service ${unadoptedBinding} --json`,
      service: unadoptedBinding,
    });
  }

  for (const s of services.filter(undocumented)) {
    steps.push({
      code: "next.adopt",
      statement: `services/${s.id}/ has no spec.md — nothing about ${s.id} is written down, so no feature can be graded against it.`,
      command: `loam adopt --service ${s.id} --json`,
      service: s.id,
    });
  }

  // Adoption does not end at spec.md. A service with a living spec and no
  // model.likec4 is the state archive itself warns about (`service.no-model`)
  // and the fleet gate reports — invisible here until now, because this form
  // looked at exactly one bit of each service's artifact set.
  for (const s of services.filter((x) => !undocumented(x) && !x.has.model)) {
    steps.push({
      code: "next.complete-service",
      statement: `services/${s.id}/ has a spec.md but no model.likec4 — the fleet gate reports the service incomplete until something models it.`,
      command: `loam validate --service ${s.id} --json`,
      service: s.id,
    });
  }

  const ordered = [...features].sort(
    (a, b) =>
      STAGE_RANK[a.stage] - STAGE_RANK[b.stage] ||
      graph.order.indexOf(a.id) - graph.order.indexOf(b.id) ||
      compareIds(a.id, b.id),
  );
  for (const f of ordered) {
    if (f.stage === "done") {
      steps.push({
        code: "next.archive",
        statement: `${f.id} is authored and verified — ship it, and everything waiting on it is released.`,
        command: `loam archive ${f.id} --dry-run --json`,
      });
      continue;
    }
    steps.push({
      code: "next.feature",
      statement:
        // The list, not the stage, is what this sentence names. `blocked` has
        // two causes now — another feature in flight, and an interrupted commit
        // that stalls the whole repository — and the second one names no
        // feature, so keying off the stage alone printed "FEAT-1 is waiting
        // on ." The recover step above already says what the repository is
        // waiting on.
        f.stage === "blocked" && f.blockedBy.length > 0
          ? `${f.id} is waiting on ${f.blockedBy.join(", ")}.`
          : `${f.id} is at '${f.stage}'${f.missing.length > 0 ? ` — missing ${f.missing.join(", ")}` : ""}.`,
      command: `loam status ${f.id} --json`,
    });
  }

  const elided = Math.max(0, steps.length - FLEET_NEXT_LIMIT);
  // Outside the cap, not merely first inside it: the one step that must never
  // be the one this list left out.
  const out = [...(interrupted === null ? [] : [recoverStep(interrupted)]), ...steps.slice(0, FLEET_NEXT_LIMIT)];
  if (elided > 0) {
    out.push({
      code: "next.elided",
      statement: `${elided} more step(s) of the same kinds were left out — this list is ordered most-unblocking first, so work down it and run status again.`,
      command: "loam list --json",
    });
  }

  out.push(
    steps.length === 0
      ? {
          code: "next.fleet-clean",
          statement:
            "Nothing is in flight and every service is written down — keep the fleet green, then start the next feature.",
          command: "loam validate --all --json",
        }
      : {
          code: "next.fleet-gate",
          statement:
            `${features.length} feature(s) in flight over ${services.length} service(s) — ` +
            "status grades none of them; `validate --all` is the gate this repository has to pass, and it is what CI runs.",
          command: "loam validate --all --json",
        },
  );
  return out;
}
