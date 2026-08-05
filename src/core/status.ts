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
 * It also grades nothing itself. The verdict on a feature is `featureCoherence`
 * — the same function `loam validate --feature` and `loam archive` run — and
 * the verification state is `readVerificationState` + `featureChecklist`, the
 * same pair `loam verify` uses. A second opinion about whether a feature holds
 * together would be a second answer to grade a pull request against, and the
 * one a reader consults is never the one the gate obeys (doctor.ts learnt this
 * with its own config validator).
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
import { featureCoherence } from "./coherence.js";
import { analyzeDependencies, type DependencyGraph } from "./dependencies.js";
import { FleetContext } from "./fleet-context.js";
import { gatesArchive, type Issue } from "./issue.js";
import { repoPath } from "./json.js";
import {
  compareIds,
  featurePaths,
  featureSpecPaths,
  featureSpecServices,
  listFeatures,
  listServices,
  servicePaths,
  type FeatureEntry,
  type ServiceEntry,
} from "./repo.js";
import { requirementsMissingScenarios } from "./spec.js";
import { featureChecklist, readVerificationState, verificationPath } from "./verify.js";

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
  claims: number;
  confirmed: number;
  unconfirmed: number;
  /** Federated records only: claims nobody has answered yet. */
  unanswered: number;
}

export interface FeatureStatusReport {
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
   * The coherence verdict — `featureCoherence`, the same call `validate
   * --feature` and `archive` make. `ran` is false for an archived feature: its
   * delta is already merged into the living docs, so re-grading it would
   * compare a change against a world that has absorbed it.
   */
  checks: {
    ran: boolean;
    coherent: boolean;
    errors: number;
    warnings: number;
    /** How many issues would stop `loam archive` without `--approve`. */
    gating: number;
    issues: Issue[];
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
  opts: { service?: string; context?: FleetContext } = {},
): Promise<FeatureStatusReport> {
  const context = opts.context ?? new FleetContext();
  const services = await featureSpecServices(feature.dir, context);
  const narrowed = opts.service;
  const inView = narrowed === undefined ? services : services.filter((s) => s === narrowed);

  // An archived feature is history: its delta is already folded into the living
  // docs, so coherence would grade the change against a world that has absorbed
  // it and report contradictions that are only the merge having happened. The
  // same reason `list` never calls an archived record stale.
  const issues = feature.archived
    ? []
    : await featureCoherence(docsDir, feature.dir, feature.id, undefined, context);
  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warn").length;

  const verification = await verificationState(docsDir, feature);
  // The whole feature is graded, then the view is narrowed — never the other
  // way round. `--service` is a lens on the table and the steps; a rollup that
  // moved with it would report a feature `ready` because the one service you
  // asked about happens to be written, while three others have nothing.
  const graded = featureArtifacts(
    docsDir,
    feature,
    services,
    errors,
    verification,
    await contractsInFlight(docsDir, feature.id, context),
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
    feature: {
      id: feature.id,
      dirName: feature.dirName,
      path: repoPath(docsDir, feature.dir),
      archived: feature.archived,
      stage: featureStage(feature, graded, services, errors.length, blockedBy, verification),
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
      gating: issues.filter(gatesArchive).length,
      issues,
    },
    verification,
    next: await featureNext(docsDir, feature, inView, artifacts, issues, blockedBy, verification, context),
  };
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
  errors: number,
  blockedBy: string[],
  verification: VerificationState,
): ArtifactStatus {
  if (feature.archived) return "done";
  // A feature with no `specs/<service>/` changes nothing. There is no artifact
  // row to be missing — the rows are per service — so the emptiness itself is
  // the finding, and `next.touch-service` is the step.
  if (services.length === 0) return "missing";
  if (artifacts.some((a) => a.id !== "verification" && a.status === "missing")) return "missing";
  if (blockedBy.length > 0) return "blocked";
  if (errors > 0) return "draft";
  return verification.state === "recorded" && verification.unconfirmed + verification.unanswered === 0
    ? "done"
    : "ready";
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
  errors: Issue[],
  verification: VerificationState,
  contracted: ReadonlySet<string>,
): ArtifactState[] {
  const paths = featurePaths(feature.dir);
  const rel = (abs: string): string => repoPath(docsDir, abs);
  const faults = errors.map((e) => ({ artifact: faultedArtifact(e.code), subject: e.subject }));
  const faulted = (id: ArtifactId, service: string | null): boolean =>
    faults.some((f) => f.artifact === id && (service === null || f.subject === service));

  const out: ArtifactState[] = [
    fileState("intent", null, rel(paths.intent), existsSync(paths.intent), true, false),
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
        owesContract(docsDir, svc, contracted),
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
 * Only where the service arrives WITH the change and nothing else is giving it
 * a contract: a service the living docs already carry needs no new document,
 * and a service another feature in flight introduces is that feature's job.
 * Without the second half, a change that merely MODIFIES a requirement on a
 * brand-new service is reported as owing its entire contract — the same
 * softening coherence applies with its `*-pending` codes, where an operation
 * "defined by another feature still in flight" is an ordering fact and not a
 * hole.
 */
function owesContract(docsDir: string, svc: string, contracted: ReadonlySet<string>): boolean {
  return !existsSync(servicePaths(docsDir, svc).dir) && !contracted.has(svc);
}

/**
 * Services some OTHER active feature already carries an `openapi.yaml` for.
 * Enumeration only — the feature list and its `specs/` subdirectories are
 * already in the request-scoped index by the time anything asks.
 */
async function contractsInFlight(
  docsDir: string,
  self: string,
  context: FleetContext,
): Promise<Set<string>> {
  const out = new Set<string>();
  for (const f of await listFeatures(docsDir, {}, context)) {
    if (f.id === self) continue;
    for (const svc of f.services) {
      if (existsSync(featureSpecPaths(f.dir, svc).openapi)) out.add(svc);
    }
  }
  return out;
}

/**
 * The record's own rung. `stale` and `unreadable` are `draft` because both mean
 * the file on disk is the thing to fix; unconfirmed claims are `ready` because
 * the file is fine and the answer lives in the code.
 */
function verificationStatus(v: VerificationState): ArtifactStatus {
  if (v.state === "absent") return "missing";
  if (v.state === "unreadable" || v.state === "stale") return "draft";
  return v.unconfirmed + v.unanswered > 0 ? "ready" : "done";
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
async function verificationState(docsDir: string, feature: FeatureEntry): Promise<VerificationState> {
  const empty = { recorded: null, claims: 0, confirmed: 0, unconfirmed: 0, unanswered: 0 };
  const read = await readVerificationState(feature.dir);
  if (read.state === "absent") return { state: "absent", ...empty };
  if (read.state === "unreadable") return { state: "unreadable", ...empty };

  const v = read.verification;
  const stale = feature.archived
    ? false
    : (await featureChecklist(docsDir, feature.dir, feature.id)).digest !== v.checklist;
  return {
    state: stale ? "stale" : "recorded",
    recorded: v.recorded,
    claims: v.summary.claims,
    confirmed: v.summary.confirmed,
    unconfirmed: v.summary.unconfirmed,
    unanswered: v.summary.unanswered ?? 0,
  };
}

/* ------------------------------------------------------------------ */
/* next[] — one feature                                                */
/* ------------------------------------------------------------------ */

/** Codes whose one fix is `loam rebase`: a pin nobody ever wrote, on either axis. */
const UNPINNED = new Set(["delta.baseline-missing", "openapi.baseline-missing"]);

async function featureNext(
  docsDir: string,
  feature: FeatureEntry,
  services: string[],
  artifacts: ArtifactState[],
  issues: Issue[],
  blockedBy: string[],
  verification: VerificationState,
  context: FleetContext,
): Promise<NextStep[]> {
  const id = feature.id;
  if (feature.archived) {
    return [
      {
        code: "next.archived",
        statement: `${id} is archived — it shipped, and its delta is already folded into the living docs.`,
        command: `loam show ${id} --json`,
      },
    ];
  }

  const steps: NextStep[] = [];
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
        statement: `Write ${api.path} — ${svc} is not in the living docs yet, so this feature is the only thing that can give it a contract.`,
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
  for (const gap of await scenarioGaps(docsDir, feature, services, context)) {
    steps.push({
      code: "next.author-scenarios",
      statement:
        `${gap.count} requirement(s) in ${gap.service}'s delta have no '#### Scenario:' ` +
        `(starting with '${gap.first}') — they generate no test and no verify claim.`,
      command: `loam delta ${id} --service ${gap.service} --json`,
      artifact: "spec",
      service: gap.service,
      path: gap.path,
    });
  }

  if (issues.some((i) => UNPINNED.has(i.code))) {
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

  const errors = issues.filter((i) => i.severity === "error");
  if (errors.length > 0) {
    steps.push({
      code: "next.fix-coherence",
      statement: `${id} has ${errors.length} coherence error(s), starting with ${errors[0]!.code} — the three axes disagree, and archive refuses.`,
      command: `loam validate ${id} --json`,
    });
  }

  steps.push(...verifyStep(id, artifacts, verification));

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
  if (open === 0) return [];
  return step({
    code: "next.verify-unconfirmed",
    statement: `${open} of ${verification.claims} claim(s) on ${id} are not confirmed — close them from each affected service's own repository.`,
  });
}

/**
 * Per service, how many of this feature's delta requirements carry no scenario,
 * via the same `requirementsMissingScenarios` every coverage check calls
 * (REMOVED requirements are exempt there and stay exempt here — content on its
 * way out owes no acceptance criteria).
 */
async function scenarioGaps(
  docsDir: string,
  feature: FeatureEntry,
  services: string[],
  context: FleetContext,
): Promise<Array<{ service: string; count: number; first: string; path: string }>> {
  const out: Array<{ service: string; count: number; first: string; path: string }> = [];
  for (const svc of services) {
    const p = featureSpecPaths(feature.dir, svc);
    for (const file of [p.spec, p.archSpec]) {
      if (!existsSync(file)) continue;
      const bare = requirementsMissingScenarios(await context.readRequirements(file));
      if (bare.length === 0) continue;
      out.push({ service: svc, count: bare.length, first: bare[0]!.name, path: repoPath(docsDir, file) });
    }
  }
  return out;
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
  opts: { service?: string; context?: FleetContext } = {},
): Promise<FleetStatusReport> {
  const context = opts.context ?? new FleetContext();
  const narrowed = opts.service;
  const all = await listServices(docsDir, context);
  const services = narrowed === undefined ? all : all.filter((s) => s.id === narrowed);
  const graph = await analyzeDependencies(docsDir, undefined, context);
  const entries = await listFeatures(docsDir, {}, context);
  const inScope = narrowed === undefined ? entries : entries.filter((f) => f.services.includes(narrowed));

  const features = await Promise.all(
    inScope.map(async (f) =>
      fleetFeature(docsDir, f, graph, await contractsInFlight(docsDir, f.id, context)),
    ),
  );
  features.sort((a, b) => compareIds(a.id, b.id));

  return {
    services: {
      total: services.length,
      undocumented: services.filter(undocumented).length,
      draft: services.filter((s) => !undocumented(s) && !vouched(s)).length,
      vouched: services.filter(vouched).length,
    },
    features,
    order: graph.order.filter((id) => features.some((f) => f.id === id)),
    service: narrowed ?? null,
    next: fleetNext(services, features, graph),
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
): Promise<FleetFeatureState> {
  const paths = featurePaths(feature.dir);
  const missing: string[] = [];
  if (!existsSync(paths.intent)) missing.push("intent");
  if (feature.services.length === 0) missing.push("spec");
  for (const svc of feature.services) {
    const p = featureSpecPaths(feature.dir, svc);
    if (!existsSync(p.spec)) missing.push(`${svc}/spec`);
    // The same question featureArtifacts asks, through the same function: the
    // two forms must never disagree about whether a feature owes a contract.
    if (owesContract(docsDir, svc, contracted) && !existsSync(p.openapi)) {
      missing.push(`${svc}/openapi`);
    }
  }
  const verification = await verificationState(docsDir, feature);
  const blockedBy = graph.nodes.find((n) => n.id === feature.id)?.dependsOn ?? [];

  // No `draft` here, ever: that verdict needs the coherence run this form
  // refuses to pay for, and inferring it from presence alone would be a second
  // opinion about validity — the one thing status must never invent.
  const stage: ArtifactStatus =
    missing.length > 0
      ? "missing"
      : blockedBy.length > 0
        ? "blocked"
        : verification.state === "recorded" && verification.unconfirmed + verification.unanswered === 0
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
 * Fleet-level steps, most-unblocking first. A feature ready to ship comes
 * before one that still needs authoring, because archiving it is what releases
 * everything queued behind it; a blocked feature comes last, because there is
 * nothing to do about it from here — its prerequisite is already higher up the
 * list under its own entry.
 */
function fleetNext(
  services: ServiceEntry[],
  features: FleetFeatureState[],
  graph: DependencyGraph,
): NextStep[] {
  const steps: NextStep[] = [];

  for (const s of services.filter(undocumented)) {
    steps.push({
      code: "next.adopt",
      statement: `services/${s.id}/ has no spec.md — nothing about ${s.id} is written down, so no feature can be graded against it.`,
      command: `loam adopt --service ${s.id} --json`,
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
        f.stage === "blocked"
          ? `${f.id} is waiting on ${f.blockedBy.join(", ")}.`
          : `${f.id} is at '${f.stage}'${f.missing.length > 0 ? ` — missing ${f.missing.join(", ")}` : ""}.`,
      command: `loam status ${f.id} --json`,
    });
  }

  if (steps.length === 0) {
    steps.push({
      code: "next.fleet-clean",
      statement:
        "Nothing is in flight and every service is written down — keep the fleet green, then start the next feature.",
      command: "loam validate --all --json",
    });
  }
  return steps;
}
