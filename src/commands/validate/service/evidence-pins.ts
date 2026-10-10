/**
 * The evidence-pin re-check as validate findings: every ACTIVE feature record
 * this service has attested, its pins graded against THIS working tree.
 *
 * Service-repo-scoped like `sources.*` and the gherkin chain — the citations
 * resolve only inside the service's own repository. From the docs repo this
 * TARGET is silent by design: every pin would grade `unresolved` there, which
 * would be a lie about the code rather than about the record, and
 * `sources.unverifiable-from-here` already names the blind spot once per
 * service. One code of the family is not about the code at all —
 * `evidence.record-unreadable` is about the record, which lives in the docs
 * repo — so the FEATURE target (`../feature.ts`) raises it too, from anywhere,
 * through `featureRecordFindings` below:
 * with only this target raising it, `validate --all` in the docs repo stayed
 * green over a conflict-marked record that `verify` refused and `status`,
 * `gate` and `tasks` all reported. In a service repo's `--all` the same file
 * is therefore named twice, once per target: here as this service's pins
 * going unchecked, there as the feature's record itself.
 *
 * ARCHIVED records are deliberately not linted (a v1 non-goal, recorded here):
 * a frozen record is history, post-ship code drift is normal evolution, and
 * grading it would turn every service's CI permanently yellow the week after
 * every ship. If audit-time re-checks of shipped records are ever wanted, the
 * same `lintEvidencePins` call over `listFeatures` include-archived is the
 * whole change — behind an explicit flag, so the default stays quiet.
 *
 * Everything here demotes reviewer confidence only: warns never flip `valid`,
 * `--strict` may gate on them as it gates on any warning, and no grade ever
 * moves a verdict — `attested` never silently becomes `verified` and a drifted
 * pin never un-confirms a claim.
 */
import { repoPath } from "../../../core/envelope/json.js";
import { inOrder } from "../../../core/kernel/concurrency.js";
import { type PathableService } from "../../../core/kernel/ids/service.js";
import { type FeatureEntry } from "../../../core/repo/entries.js";
import { listFeatures } from "../../../core/repo/repo.js";
import { readVerificationState } from "../../../core/verify/read/file.js";
import { lintEvidencePins, type PinDrift, type PinLint } from "../../../core/verify/pins/lint.js";
import { type Finding } from "../../../core/vocabulary/report.js";
import type { FleetContext } from "../../../core/fleet-context.js";
import type { DocsDir } from "../../../core/kernel/ids/dirs.js";

export async function evidencePinFindings(
  docsDir: DocsDir,
  service: PathableService,
  repoDir: string | undefined,
  fleet?: FleetContext,
): Promise<Finding[]> {
  if (repoDir === undefined) return [];
  // Membership questions cross the provenance line through plain strings by
  // design (kernel/ids/service.ts) — record subjects are document text.
  const me: string = service;
  // ACTIVE features only — see the header for why archived records stay frozen.
  const features = await listFeatures(docsDir, {}, fleet);
  type Linted =
    | null
    | { feature: string; path: string; unreadable: string; advice: string }
    | { feature: string; lint: PinLint };
  const lints = await inOrder(features, async (feature): Promise<Linted> => {
    // Three states, graded apart on purpose. ABSENT is a feature nobody has
    // verified — legitimate silence. UNREADABLE is somebody's record this run
    // could not use, and it must be a finding here rather than a skip: the
    // damage that most plausibly breaks a record in a service repo's CI is a
    // hand edit to the very pins this family grades, and a lint that went
    // silent over it would turn "someone broke the record" into a green run —
    // `verify` names the same file `record-unreadable`, but this CI job never
    // runs verify. An unreadable record also cannot say whether it attests
    // this service, so the finding fires regardless of attestation.
    const read = await readVerificationState(feature.dir);
    if (read.state === "unreadable") {
      return { feature: feature.id, path: repoPath(docsDir, read.path), unreadable: read.reason, advice: read.advice };
    }
    if (read.state === "absent" || read.verification.schema !== 2) return null;
    if (!(read.verification.attestations ?? []).some((a) => a.service === me)) return null;
    return { feature: feature.id, lint: await lintEvidencePins(read.verification.claims, me, repoDir) };
  });

  const findings: Finding[] = [];
  let checked = 0;
  let pinnedRecords = 0;
  let drifted = false;
  for (const entry of lints) {
    if (entry === null) continue;
    if ("unreadable" in entry) {
      findings.push({
        severity: "warn",
        code: "evidence.record-unreadable",
        subject: service,
        message: recordUnreadableMessage(`${me}: ${entry.feature}`, entry),
      });
      continue;
    }
    const { feature, lint } = entry;
    if (lint.checked > 0 || lint.drifts.length > 0) pinnedRecords += 1;
    checked += lint.checked;
    // The code is spelled as a literal at each call below, and the grade rides
    // beside it rather than being sliced back out of the code string — the
    // codes-drift collector resolves the `code` slot, and a derivation would
    // be a second definition of the pairing free to drift from the first.
    const drift = (grade: PinDrift["grade"], code: string, sentence: string): void => {
      const drifts = lint.drifts.filter((d) => d.grade === grade);
      if (drifts.length === 0) return;
      drifted = true;
      findings.push({
        severity: "warn",
        code,
        subject: service,
        message:
          `${me}: ${feature}: ${drifts.length} recorded evidence pin(s) ${sentence} — ` +
          "a reading priority for the reviewer, never a verdict change; re-answer and re-record " +
          `(\`loam verify ${feature} --service ${me} --record answers.json\`) once the evidence is re-read`,
        details: drifts.map(detailLine),
      });
    };
    drift(
      "unresolved",
      "evidence.unresolved",
      "cannot be re-checked in this working tree: the cited file is gone, unreadable, not a regular file, or the cited line is past its end",
    );
    drift("moved", "evidence.moved", "cite a file that changed since the record, though each cited line survives");
    drift("line-changed", "evidence.line-changed", "cite line(s) that no longer say what was recorded");
    drift(
      "token-missing",
      "evidence.token-missing",
      "cite file(s) that no longer contain the literal string the claim asserts",
    );
    if (lint.unpinned > 0) {
      findings.push({
        severity: "ok",
        // The pre-content_digest-vouch precedent: a record from before the
        // capability existed is not wrong, it is unfindable-by-this-check.
        code: "evidence.unpinned",
        subject: service,
        message:
          `${me}: ${feature}: ${lint.unpinned} agent-confirmed citation(s) carry no evidence pin — ` +
          `recorded before pins existed; the next \`loam verify ${feature} --service ${me} --record\` makes them drift-checkable`,
      });
    }
  }
  if (checked > 0 && !drifted) {
    findings.push({
      severity: "ok",
      code: "evidence.checked",
      subject: service,
      message: `${me}: ${checked} evidence pin(s) across ${pinnedRecords} feature record(s) re-checked against this working tree`,
    });
  }
  return findings;
}

/**
 * `evidence.record-unreadable` on the FEATURE target (`../feature.ts`), from
 * anywhere — the docs repo included, which is where the record lives. Kept
 * here, beside the service target's emission, so one module owns the code and
 * its words: the record read is the same `readVerificationState`, the path is
 * made docs-relative the same way, and the message is the same sentence.
 * Readability only — an `ok` record contributes nothing here, its verdict is
 * `verify`'s and `status`'s to state — and a warn for the reasons the header
 * gives: `valid` and `loam archive` are untouched, `--strict` is the lever.
 */
export async function featureRecordFindings(docsDir: DocsDir, feature: FeatureEntry): Promise<Finding[]> {
  const read = await readVerificationState(feature.dir);
  if (read.state !== "unreadable") return [];
  const path = repoPath(docsDir, read.path);
  return [
    {
      severity: "warn",
      code: "evidence.record-unreadable",
      message: recordUnreadableMessage(feature.id, { path, unreadable: read.reason, advice: read.advice }),
      locations: [{ path, role: "primary" }],
    },
  ];
}

/**
 * The sentence `evidence.record-unreadable` carries, for both targets that
 * raise it. Each emission spells the code literally (the codes-drift
 * collector resolves the `code` slot, as `drift` above says); only the words
 * are shared, so the two cannot drift into two descriptions of one file.
 *
 * The reader's own recipe for the one file that failed, never a fixed one:
 * "re-record" alone sent this finding's reader into `--record`'s refusal of
 * the very same file, and the safe repair differs between a service's own
 * attestation file and the one-file record other services' evidence may sit
 * in. `path` is docs-relative.
 */
function recordUnreadableMessage(
  label: string,
  file: { path: string; unreadable: string; advice: string },
): string {
  return (
    `${label}: ${file.path} exists but cannot be read as a verification record (${file.unreadable}) — ` +
    `none of its evidence was checked. ${file.advice} loam never overwrites a record it could not read`
  );
}

/** One drift as a detail line: which claim, which citation, what changed. */
function detailLine(d: PinDrift): string {
  return `${d.claim} ${d.evidence} — ${d.what}`;
}
