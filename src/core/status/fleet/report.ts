/**
 * The fleet form's report — every feature in flight, the archived ones whose
 * done-check is still open, and the next steps over all of it.
 *
 * Moved out of `../report.ts` when the archived list joined it and that file
 * reached its line limit. The seam was already there: `../report.ts` holds the
 * vocabulary both forms share (the five statuses, the verification state, the
 * next step) and the single-feature report; this file holds only what the
 * repository-wide walk (`./fleet.ts`) returns.
 */
import type { ArtifactStatus, InterruptedCommit, NextStep, VerificationState } from "../report.js";

export interface FleetFeatureState {
  id: string;
  /** See `FeatureStatusReport.feature`'s `title` (`../report.ts`). */
  title: string | null;
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
  /** See `FeatureStatusReport.interrupted` (`../report.ts`). */
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
    /**
     * Documented, with no vouch stamp behind it. Each one whose model and
     * baseline are complete is a `next.vouch` step below; the rest owe the
     * earlier rung first.
     */
    draft: number;
    /** `status: verified` with a `sources_digest` — a person stood behind it. */
    vouched: number;
    /**
     * Of `vouched`, the ones read from a recorded SAMPLE rather than in full
     * (`vouch_scope`, either axis) — a SUBSET: the three above still sum to `total`.
     */
    sampledVouched: number;
    /**
     * Of `vouched`, the ones with a stamped document whose words moved after
     * the vouch (`content.stale`, either axis) — a SUBSET like
     * `sampledVouched`, and each one is a `next.revouch` step below.
     */
    contentStale: number;
  };
  features: FleetFeatureState[];
  /**
   * Every ARCHIVED feature whose done-check was never discharged — any verdict
   * but `verified` (`fullyVerified`): no record, a record that does not read,
   * claims left unconfirmed, or scenarios resting on an agent's word. Additive.
   *
   * Open work must not disappear at archive. The fleet form walked active
   * features only, so a feature archived with one of seven claims confirmed
   * vanished from every repository-wide surface the moment it merged — `loam
   * status <FEAT>` said "archived — not fully verified" and nothing else did
   * (QUICKSTART walk, 2026-10-28). The record is frozen once the feature
   * archives (`loam verify` refuses to re-answer it), so this lists rather than
   * grades: one record read per archived feature, no checklist derived, which
   * keeps the module header's cost rule. Narrowed by `--service` like
   * `features`.
   */
  unverifiedArchived: ArchivedFeatureState[];
  /** Dependencies before consumers — which feature has to archive first. */
  order: string[];
  service: string | null;
  next: NextStep[];
  /**
   * Every per-service rung (`next.adopt`, `next.complete-service`,
   * `next.vouch`, `next.revouch`), UNCAPPED and grouped by code, services in
   * `next[]` order.
   * Additive. `next[]` stops at ten, so mid-adoption it cannot say how much
   * adoption work there is; this can, and the human view folds it into one
   * counted line under the features.
   */
  serviceSteps: Array<{ code: string; services: string[]; command: string }>;
}

/** One archived feature the fleet form still lists — see {@link FleetStatusReport.unverifiedArchived}. */
export interface ArchivedFeatureState {
  id: string;
  title: string | null;
  dirName: string;
  path: string;
  services: string[];
  verification: VerificationState;
}
