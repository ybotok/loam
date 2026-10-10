/**
 * The record as the union of its files: the one-file `verification.yaml` and
 * one `verification/<svc>.yaml` per attesting service, added up into the single
 * `Verification` every reader already takes.
 *
 * Pure on purpose — `./file.ts` reads and grades the bytes, the writer in
 * `commands/verify/record.ts` hands in the files as they will stand after its
 * commit, and both get the same answer from the same arithmetic. A writer that
 * computed the post-record verdict its own way would be the second opinion
 * `../record.ts` exists to prevent; this way what `--record` prints is exactly
 * what the next read will say.
 *
 * Nothing here reads a `summary` as fact. Each file's own `summary` was graded
 * against its own `claims[]` on the way in, and the union's is recomputed here
 * from the claims it actually counts — so the block that used to be the
 * hottest conflict in a fleet's docs PRs is now derived, never merged.
 */
import { tallyAnswers, type Verification } from "../record.js";

/**
 * Add the files up. `services` are the graded per-service files, each a
 * schema-2 record holding exactly its own service's attestation (the reader
 * refuses one that does not). Null only when there is nothing at all.
 *
 * With no per-service file the one-file record is returned VERBATIM — a record
 * written before the directory existed, or by the all-at-once form, reads
 * exactly as it always did, retained answers and all.
 *
 * Otherwise the record answers ONE version of the checklist: the one its newest
 * file answered (by `recorded`, a later service id breaking a same-day tie, and
 * any per-service file outranking the one-file record). A file that answered a
 * different version keeps its attestation on the list — that is what
 * `verify.checklist-forked` reads to name it — but its answers do not count.
 * The single shared file used to settle this by rewriting: the last writer
 * pruned everybody's answers to ITS checklist. Per-service files are never
 * rewritten by anyone else, so nothing can prune them, and counting an answer
 * filed against another question set would let an old id that the feature no
 * longer asks fill the slot of a new one it does — a record reading `verified`
 * over a question nobody answered. Excluding is the honest half: the service
 * behind is named, and recording it again is the whole fix.
 */
export function assembleRecord(legacy: Verification | null, services: readonly Verification[]): Verification | null {
  if (services.length === 0) return legacy;
  const filed = new Set(services.flatMap((s) => (s.attestations ?? []).map((a) => a.service)));
  const parts = [...legacyRemnant(legacy, filed), ...services];
  // `>=` so a later part wins a same-day tie: services arrive sorted by id,
  // and after the one-file remnant, which is exactly the precedence above.
  const current = parts.reduce((newest, part) => (part.recorded >= newest.recorded ? part : newest));
  const claims = parts.filter((part) => part.checklist === current.checklist).flatMap((part) => part.claims);
  const tally = tallyAnswers(claims);
  return {
    schema: 2,
    feature: current.feature,
    recorded: current.recorded,
    checklist: current.checklist,
    summary: {
      claims: current.summary.claims,
      confirmed: tally.confirmed,
      unconfirmed: tally.unconfirmed,
      unanswered: current.summary.claims - claims.length,
    },
    claims,
    attestations: parts.flatMap((part) => part.attestations ?? []).sort((a, b) => a.service.localeCompare(b.service)),
  };
}

/**
 * What of the one-file record still counts once services have files of their
 * own: the attestations of the services that have NOT re-recorded since, and
 * their answers.
 *
 * A schema-1 (all-at-once) file contributes nothing. Its answers carry no
 * commit attestation, so a federated record could never count them — the rule
 * the first federated write applied when it used to overwrite the file, and the
 * reason that write now deletes it. A schema-2 file's attestation for a service
 * that has a file of its own is superseded by that file and drops out, answers
 * with it; when every attestation in it is superseded, nothing in it counts.
 */
function legacyRemnant(legacy: Verification | null, filed: ReadonlySet<string>): Verification[] {
  if (legacy === null || legacy.schema !== 2) return [];
  const attestations = (legacy.attestations ?? []).filter((a) => !filed.has(a.service));
  if (attestations.length === 0) return [];
  const kept = new Set(attestations.map((a) => a.service));
  return [{ ...legacy, attestations, claims: legacy.claims.filter((c) => c.subject !== undefined && kept.has(c.subject)) }];
}
