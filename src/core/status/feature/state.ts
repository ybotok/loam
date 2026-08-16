/**
 * One feature, fully graded — the record every question in this package asks
 * about.
 *
 * It exists because eight functions took the same seven or nine values in
 * hand-kept order: a feature, its services, its artifacts, its findings, its
 * verification, its scans, what it is blocked by, and whether a commit was
 * interrupted. Positional, `services` and `blockedBy` are both `string[]` and
 * transposing them compiles.
 *
 * Note what is NOT in here: the `--service` lens. The whole feature is graded
 * and the view is narrowed afterwards, never the other way round — a rollup
 * that moved with the lens would report a feature `ready` because the one
 * service you asked about happens to be written, while three others have
 * nothing.
 */
import { type FeatureEntry } from "../../repo/entries.js";
import { type Finding } from "../../vocabulary/report.js";
import { type DeltaScan } from "../scan.js";
import {
  type ArtifactState,
  type InterruptedCommit,
  type VerificationState,
} from "../report.js";

export interface FeatureState {
  feature: FeatureEntry;
  /** Every service the feature touches — not the narrowed view. */
  services: string[];
  artifacts: ArtifactState[];
  findings: Finding[];
  /** Features that have to archive before this one can. */
  blockedBy: string[];
  verification: VerificationState;
  scans: DeltaScan[];
  interrupted: InterruptedCommit | null;
}
