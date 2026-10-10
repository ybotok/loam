/**
 * Where the verification record lives on disk — the one-file form, the
 * per-service directory, and which of the two a reader is pointed at.
 *
 * Split out of `./record.ts`, which keeps what gets written down and how a set
 * of answers counts up to a verdict: the addresses are a different subject from
 * the shapes and the arithmetic, and the per-service directory pushed that
 * module over the line limit. The readers (`./read/file.ts`), the writers
 * (`loam verify`'s record step) and `status`'s artifact row all ask where the
 * record is; none of them needs the record's shape to ask it.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { PathableService } from "../kernel/ids/service.js";

/**
 * Where the record lives: inside the feature, so `archive` carries it into
 * `features/archive/` with everything else and a reviewer finds it next to the
 * delta it is about. YAML rather than frontmatter or JSON — it is data, it has
 * to survive without loam, and one claim per block is a diff a person can read.
 *
 * This is the ONE-FILE form: what the all-at-once `--record` (no `--service`)
 * writes, and what every federated record written before the per-service
 * directory existed still is. It is read forever, active and archived alike.
 * A federated attestation no longer goes here — see {@link serviceRecordPath}.
 */
export function verificationPath(featureDir: string): string {
  return join(featureDir, "verification.yaml");
}

/**
 * The federated record: one file per attesting service, and the DIRECTORY is
 * the list — the `glossary/` and `capabilities/` rule.
 *
 * One shared file was the wrong shape for a fleet. Every service's attestation
 * rewrote the same `summary`, `recorded` and checklist-ordered `claims`, so two
 * docs-repo branches recording two DIFFERENT services always conflicted in git
 * — add/add from an empty start, content conflicts on the summary once one
 * attestation had merged — and sorting the attestations did not help, because
 * two insertions at one anchor are a conflict whatever the order. The lock that
 * serialises writers covers one checkout; a fleet records from many. With one
 * file per service, two teams' records touch two different paths and merge
 * cleanly, and the verdict is computed from the union at read time — which it
 * always was: nothing ever trusted the stored `summary`.
 */
export function verificationDir(featureDir: string): string {
  return join(featureDir, "verification");
}

/**
 * One service's attestation file. The service id grammar admits no `/`, so this
 * never leaves the directory — and the parameter type is what makes that a
 * guarantee rather than a hope: a `PathableService` is a name whose provenance
 * is the repository (a validated id, or a directory that exists), so a name a
 * document merely asserts, or a raw flag nobody checked, does not compile here.
 */
export function serviceRecordPath(featureDir: string, service: PathableService): string {
  return join(verificationDir(featureDir), `${service}.yaml`);
}

/**
 * Where a reader should look: the directory once it exists, the one file
 * otherwise. A single path is lossy on purpose — a record mid-migration is
 * both — and what a reader is pointed at is where the next attestation will
 * land. A legacy file beside the directory is still read (see `./read/file.ts`);
 * it is simply no longer where anything is written for a service.
 */
export function recordLocation(featureDir: string): string {
  const dir = verificationDir(featureDir);
  return existsSync(dir) ? dir : verificationPath(featureDir);
}
