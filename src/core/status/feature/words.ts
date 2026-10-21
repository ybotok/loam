/**
 * The stage, said in words a person can act on.
 *
 * `stage` is a closed vocabulary an agent branches on (../report.ts), and it is
 * frozen: renaming `ready` would break every script that reads it. What was
 * wrong was printing it BARE. `ready` means the documents are written and pass
 * the shared checks — nothing about code — and `loam status FEAT-1 — ready`
 * over a feature nobody had built or verified read as "ready to ship". `done
 * (archived)` over a feature that was never verified read as "shipped and
 * checked", when archive checks documents and nothing else.
 *
 * So the machine value stays exactly what it was, and every human surface
 * (the status header and rows, the `next[]` statements that quote a stage)
 * says it through this one module, with the counts that make it true: how
 * many claims were answered of how many asked. One module, because a second
 * spelling of "what does ready mean" is the drift that made the first one
 * misleading.
 */
import type { ArtifactStatus, FleetFeatureState, VerificationState } from "../report.js";

/**
 * What a stage sentence needs to be honest — every field a fact somebody
 * measured, never one inferred from another field being empty. The sentence
 * used to guess "interrupted commit" from an empty `blockedBy` and "no service
 * delta" from an empty `missing`, and both guesses were wrong in a state the
 * report could reach.
 */
export interface StageFacts {
  stage: ArtifactStatus;
  archived: boolean;
  verification: VerificationState;
  /** Claims the checklist asks now — the single-feature form derives it; null where nothing was derived. */
  asked: number | null;
  /** The owed artifacts not written yet (labels), for `missing`. */
  missing: string[];
  /** True when `missing` was read off a `--service` view rather than the whole feature. */
  narrowed: boolean;
  /** How many services the feature carries a delta for. */
  services: number;
  /** Features that must archive first, for `blocked`. */
  blockedBy: string[];
  /** A `.loam-commit` journal is present: some writer was killed mid-commit. */
  interrupted: boolean;
  /** Findings that stop the feature; null where nothing was graded (the fleet form). */
  blocking: number | null;
}

/** `docs ready — nothing verified yet (0 of 19 claims answered)` and its siblings. */
export function stageWords(f: StageFacts): string {
  // Ahead of `archived`, and ahead of `blockedBy`: an interrupted commit blocks
  // even a feature that archived (the files that say so may be half-written),
  // and a feature also waiting on another one cannot move until the repair
  // either — that one cannot archive past the journal any more than this can.
  if (f.stage === "blocked" && f.interrupted) {
    return "blocked — an interrupted archive or unarchive has to be recovered first";
  }
  if (f.archived) return `archived — ${archivedVerification(f.verification)}`;
  switch (f.stage) {
    case "blocked":
      return `blocked — waiting on ${f.blockedBy.join(", ")} to archive first`;
    case "missing":
      return `being written — ${missingWords(f)}`;
    case "draft":
      return `the docs need fixing — ${f.blocking ?? "some"} finding(s) stop it`;
    case "ready":
      return `docs ready — ${openVerification(f.verification, f.asked)}`;
    case "done":
      // The fleet form grades nothing, so it cannot say archive will take it —
      // only that the record is verified. The feature's own status can.
      return f.blocking === null
        ? "verified — every claim confirmed by evidence; its own status says whether archive will take it"
        : "verified — every claim confirmed by evidence; ready to archive";
  }
}

/** `FEAT-101 (Payment splitting)` — the id a machine keys on, and the words a person recognises. */
export function featureLabel(f: { id: string; title: string | null }): string {
  return f.title === null ? f.id : `${f.id} (${f.title})`;
}

/** The fleet form's facts: presence and an existing record only, graded nothing. */
export function fleetStageWords(f: FleetFeatureState, interrupted: boolean): string {
  return stageWords({
    stage: f.stage,
    archived: false,
    verification: f.verification,
    asked: null,
    missing: f.missing,
    narrowed: false,
    services: f.services.length,
    blockedBy: f.blockedBy,
    interrupted,
    blocking: null,
  });
}

/** What is not written yet — the whole feature's list, or as much of it as a `--service` view can see. */
function missingWords(f: StageFacts): string {
  const owed = f.missing.length > 0 ? `not written yet: ${f.missing.join(", ")}` : "";
  if (f.services === 0) return owed === "" ? "no service delta yet" : `no service delta yet; ${owed}`;
  // Only a narrowed view can reach a `missing` stage with nothing missing in it:
  // the stage is the whole feature's, the rows are the lens's.
  if (owed === "") return "another service's artifacts are not written yet (drop --service to see which)";
  return f.narrowed ? `${owed} (in this --service view; drop --service for the whole feature)` : owed;
}

/** Where an in-flight feature's verification stands, counted. */
function openVerification(v: VerificationState, asked: number | null): string {
  if (v.state === "absent") {
    return asked === null
      ? "nothing verified yet (no verification record)"
      : `nothing verified yet (0 of ${asked} claim(s) answered)`;
  }
  if (v.state === "unreadable") return "its verification record does not read";
  if (v.state === "stale") return "its verification record is stale — it answers an older checklist than the one asked now";
  const open = v.unconfirmed + v.unanswered;
  if (v.verdict === "attested") {
    return `every claim answered, but ${v.attested} scenario(s) rest on an agent's word, not a test run (attested)`;
  }
  if (v.claims === 0) return "its verification record answers no claims";
  return `${v.confirmed} of ${v.claims} claim(s) confirmed${open > 0 ? `, ${open} open` : ""}`;
}

/**
 * An archived feature's verification, said plainly. Archive merges documents
 * and checks no code and no evidence, so this sentence — not the word
 * `archived`, and not the stage `done` — is what says whether anybody verified
 * the thing that shipped.
 */
export function archivedVerification(v: VerificationState): string {
  if (v.state === "absent") return "never verified (no verification record)";
  if (v.state === "unreadable") return "its verification record does not read";
  if (v.verdict === "verified") return `verified (${v.confirmed} of ${v.claims} claim(s) confirmed)`;
  if (v.verdict === "attested") {
    return `attested, not verified: ${v.attested} scenario(s) rest on an agent's word (${v.confirmed} of ${v.claims} claim(s) confirmed)`;
  }
  return `not fully verified (${v.confirmed} of ${v.claims} claim(s) confirmed)`;
}
