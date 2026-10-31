/**
 * The verification record as `status` reads it: the rung the record stands on,
 * the projection of what it says, and the two `next[]` steps that discharge it
 * — where a test comes from, and what `loam verify` still wants answered.
 * Every verdict here is `core/verify/`'s own, re-read; nothing in this module is
 * a second definition of "verified".
 */
import type { FeatureEntry } from "../repo/entries.js";
import type { FleetContext } from "../fleet-context.js";
import { featureChecklist } from "../verify/checklist.js";
import { answering, readVerificationState } from "../verify/read/file.js";
import {
  attestedNotice,
  confirmedProvenance,
  tallyRecord,
  uncommittedAttestations,
  type VerificationVerdict,
  type VerifyNotice,
  verificationVerdict,
} from "../verify/record.js";
import type { ArtifactState, ArtifactStatus, NextStep, VerificationState } from "./report.js";
import type { DeltaScan } from "./scan.js";
import type { DocsDir } from "../kernel/ids/dirs.js";

/**
 * Is the done-check discharged? `verificationVerdict`'s answer and nobody
 * else's — status re-deriving it would be a fourth place the words "verified"
 * are defined, and the day one of them changed (a scenario claim on an agent's
 * word stopped counting) the reader's copy would be the one still saying yes.
 * `attested` is deliberately NOT `done` here: it is complete work resting on an
 * assertion, which is what `ready` has always meant — the document is right and
 * the world has not caught up.
 */
export function fullyVerified(v: VerificationState): boolean {
  return v.verdict === "verified";
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
export function verificationStatus(v: VerificationState): ArtifactStatus {
  if (v.state === "absent") return "missing";
  if (v.state === "unreadable" || v.state === "stale") return "draft";
  if (v.state === "recorded") return fullyVerified(v) ? "done" : "ready";
  const unreachable: never = v.state;
  throw new Error(`verificationStatus: no rung for verification state '${String(unreachable)}'`);
}

/**
 * How a caller wants the record graded, beyond reading it.
 */
export interface StateGrading {
  /**
   * The invocation's read index, when the caller holds one. It reaches the
   * checklist derivation, whose enumerations and delta parse are memo hits
   * through it — the difference between one fleet walk per invocation and one
   * per feature for a caller grading several (`loam gate`'s check 3).
   */
  fleet?: FleetContext;
  /**
   * For an ARCHIVED feature only: the checklist digest `loam archive` captured
   * just before its merge (`readSnapshotChecklist`) — the question the feature
   * asked as it shipped, which a frozen record can still be graded against
   * without re-deriving anything. Only `loam gate --since` passes it, because
   * only the deploy question asks whether a record answered the feature that
   * SHIPPED; every other reader leaves it out and reads the record as frozen
   * history, as before. Null — an archive that captured none, by an older loam
   * or over a feature with no record then — is the frozen reading too.
   */
  shipped?: string | null;
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
 * What it CAN be held to is the checklist archive captured as it merged, and
 * that is `grading.shipped`'s: a record answering an older checklist than the
 * one the feature shipped with is stale, archived or not — the gap `gate
 * --since` used to let through, since archiving a feature whose record had
 * gone stale made it read `verified` again.
 */
export async function verificationState(
  docsDir: DocsDir,
  feature: FeatureEntry,
  grading: StateGrading = {},
): Promise<{ state: VerificationState; notice: VerifyNotice | null }> {
  const empty = {
    recorded: null,
    verdict: "unverified" as VerificationVerdict,
    claims: 0,
    confirmed: 0,
    unconfirmed: 0,
    unanswered: 0,
    attested: 0,
    answered: { runner: 0, "external-runner": 0, agent: 0 },
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

  // The checklist the record is held to: the one asked now for an in-flight
  // feature, the one captured at the merge for an archived one when the caller
  // asks for that, none at all otherwise (frozen history). The files are then
  // added up AGAINST it — the per-service files that answered it are the ones
  // that count (`core/verify/read/union.ts`) — without reading them twice.
  const against = feature.archived
    ? (grading.shipped ?? null)
    : (await featureChecklist(docsDir, feature.dir, feature.id, grading.fleet)).digest;
  const v = against === null ? read.verification : (answering(read.files, against) ?? read.verification);
  const stale = against !== null && against !== v.checklist;
  const tally = tallyRecord(v);
  const dirty = uncommittedAttestations(v).map((a) => a.service);
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
      answered: confirmedProvenance(v.claims),
      ...(dirty.length === 0 ? {} : { uncommitted: dirty }),
    },
    notice: attestedNotice(v.claims, feature.id),
  };
}

/**
 * The done-check step, or none. Four different situations reach `loam verify`
 * and they are not the same work — nothing recorded, a file that will not read,
 * a record the feature has moved out from under, and claims still open — so the
 * statement says which. The code splits only where the WORK splits: starting a
 * verification and finishing one are different jobs, and an agent that treats a
 * stale record as a finished one ships a feature nobody checked.
 */
/** The narrowed view a step is written for: what to name, and to whom. */
export interface StepView {
  artifacts?: ArtifactState[];
  services: string[];
  /** The service this repository is bound to, when a command is standing in one. */
  boundService: string | undefined;
}

export function verifyStep(id: string, verification: VerificationState, view: StepView): NextStep[] {
  const { artifacts = [], services, boundService } = view;
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
      // Never "or delete it": the record may be the one-file verification.yaml
      // holding other services' attestations, and the command names the file
      // that actually failed together with the repair that is safe for it.
      statement: `${id}'s record at ${record.path} does not read as a record — the command names the file that failed and its safe repair; never delete a file other services' attestations may be in. Nothing will overwrite it while it is unreadable.`,
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
          `(verify.scenario-attested) — answer them from a test report (a cucumber JSON report, or loam's runner-neutral ` +
          `loamScenarioReport shape for any other runner), and the record stops resting on an assertion.`,
        // The runner-neutral placeholder `verify.scenario-attested` itself
        // suggests: a step that said "cucumber" alone told a fleet whose
        // runner has no cucumber formatter that it had no route to `verified`.
        command: `loam verify ${id} --results <report.json>`,
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
export function testStep(
  id: string,
  verification: VerificationState,
  view: { services: string[]; scans: DeltaScan[]; boundService: string | undefined },
): NextStep[] {
  const { services, scans, boundService } = view;
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
