/**
 * The verification record as `status` reads it: the rung the record stands on,
 * the projection of what it says, and the two `next[]` steps that discharge it
 * — where a test comes from, and what `loam verify` still wants answered.
 * Every verdict here is `core/verify/`'s own, re-read; nothing in this module is
 * a second definition of "verified".
 */
import type { FeatureEntry } from "../repo/entries.js";
import { featureChecklist } from "../verify/checklist.js";
import { readVerificationState } from "../verify/file.js";
import { attestedNotice, tallyRecord, type VerificationVerdict, type VerifyNotice, verificationVerdict } from "../verify/record.js";
import type { ArtifactState, ArtifactStatus, NextStep, VerificationState } from "./report.js";
import type { DeltaScan } from "./scan.js";

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
 * Read the record and, only when there is one, ask whether it still answers
 * this feature. The checklist is derived on demand and never speculatively: it
 * loads the delta into a LikeC4 workspace, and paying that in order to print
 * "no record" is the cost `list` refused for its verification column.
 *
 * An archived feature's record is frozen history — archive merged its
 * operations into the living contract, so a re-derived checklist can only
 * mismatch, and calling it stale would slander every feature that shipped.
 */
export async function verificationState(
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

/**
 * The done-check step, or none. Four different situations reach `loam verify`
 * and they are not the same work — nothing recorded, a file that will not read,
 * a record the feature has moved out from under, and claims still open — so the
 * statement says which. The code splits only where the WORK splits: starting a
 * verification and finishing one are different jobs, and an agent that treats a
 * stale record as a finished one ships a feature nobody checked.
 */
export function verifyStep(
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
export function testStep(
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
