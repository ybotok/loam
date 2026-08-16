/**
 * An archived feature's record, read back and never recomputed.
 *
 * A frozen record is history: the checklist it answered no longer exists in
 * `features/`, so there is nothing to re-derive it from and re-deriving it would
 * be an opinion about a feature nobody can change. Everything here reads the
 * recorded claims, which is also why the marks and notices live beside it.
 */
import { emitJson, repoPath } from "../../core/envelope/json.js";
import { contestedDigests } from "../../core/results.js";
import { type Claim } from "../../core/verify/checklist.js";
import {
  attestedNotice,
  tallyRecord,
  type AnsweredClaim,
  type ConsumedReport,
  type Verification,
  type VerifyNotice,
  verificationPath,
  verificationVerdict,
} from "../../core/verify/record.js";
import { plural } from "../policy/format.js";
import { type VerifyTarget } from "./report.js";

export function reportFrozen(
  target: VerifyTarget,
  featureId: string,
  v: Verification | null,
): void {
  const { docsDir, featureDir, json } = target;
  const tally = v === null ? null : tallyRecord(v);
  const verdict = tally === null ? "unverified" : verificationVerdict(tally);
  const notices = v === null ? [] : noticesFor(v.claims, featureId);

  if (json) {
    emitJson({
      feature: featureId,
      path: repoPath(docsDir, featureDir),
      frozen: true,
      verified: verdict === "verified",
      verdict,
      attested: tally?.attested ?? 0,
      summary: v === null ? null : v.summary,
      recorded:
        v === null
          ? null
          : {
              path: repoPath(docsDir, verificationPath(featureDir)),
              recorded: v.recorded,
              checklist: v.checklist,
              ...(v.attestations === undefined ? {} : { attestations: v.attestations }),
              ...(v.report === undefined ? {} : { report: v.report }),
            },
      claims: v === null ? [] : v.claims,
      ...(notices.length === 0 ? {} : { notices }),
    });
    return;
  }

  if (v === null) {
    console.log(
      `${featureId} is archived and has no verification record — nothing was recorded before it shipped.`,
    );
    return;
  }

  console.log(
    `${featureId} — verification recorded ${v.recorded}, frozen at archive (${repoPath(docsDir, featureDir)})\n`,
  );
  for (const c of v.claims) {
    // `subject` is absent in records written before schema 2 — an old record
    // must read as itself, not gain a service it never named.
    const subject = c.subject === undefined ? "" : `  [${c.subject}]`;
    console.log(`  ${MARK[c.verdict]} ${c.id}${subject}  ${c.claim}${answeredMark(c)}`);
    for (const e of c.evidence) console.log(`      ${e}`);
    if (c.note !== undefined) console.log(`      note: ${c.note}`);
  }
  const counts = tallyRecord(v);
  console.log(`\n  Recorded ${v.recorded} — ${counts.confirmed} confirmed, ${counts.unconfirmed} unconfirmed.`);
  console.log(
    "  This checklist is frozen at record time: the feature is archived and its claims are not re-derived.",
  );
  for (const attestation of v.attestations ?? []) {
    console.log(
      `  Attested by ${attestation.service} at ${attestation.commit.slice(0, 12)} (${attestation.recorded}).`,
    );
    if (attestation.report !== undefined) console.log(`      from ${reportLine(attestation.report)}`);
  }
  if (v.report !== undefined) console.log(`  Answered from ${reportLine(v.report)}.`);
  for (const notice of notices) console.log(`  ⚠ ${notice.code}: ${notice.message}`);
}

export const MARK: Record<string, string> = { confirmed: "✓", unconfirmed: "✗", unanswered: "?" };

/**
 * Who answered, where that changes what the verdict means. `[runner]` is a
 * digest-matched green run; `[attested]` is a scenario claim confirmed on
 * somebody's word — the same ✓, a weaker fact, and it must be visible on the
 * line itself and not only in the summary. Everything else is unmarked: an
 * agent's answer about a service existing or an operation being exposed is
 * exactly what the checklist asks for.
 */
export function answeredMark(c: AnsweredClaim): string {
  if (c.answered_by === "runner") return "  [runner]";
  return c.kind === "scenario.tested" && c.verdict === "confirmed" ? "  [attested]" : "";
}

/** Everything a verify surface has to say about a set of answers beyond the counts. */
export function noticesFor(claims: readonly AnsweredClaim[], feature: string): VerifyNotice[] {
  const attested = attestedNotice(claims, feature);
  return attested === null ? [] : [attested];
}

/**
 * The claims one report could not attribute: a scenario digest — and therefore
 * an `@loam-digest-…` tag — that more than one service claims.
 *
 * This is now a GUARD rather than a diagnosis of ordinary authoring. Until the
 * digest was salted by service, two services wording a scenario identically
 * really did share one tag, and this is what stopped one repository's green run
 * from confirming the other's claim. `scenarioBodyHash` folds the owning
 * service into the hash, so a claim's digest is computed from the same service
 * the claim is filed under and two subjects cannot share one short of a
 * truncated-sha256 collision. It stays because the invariant is worth asserting
 * where it is relied on: if this ever fires, a digest is answering for two
 * services and no report can say which, so nothing here may confirm.
 *
 * Derived from claims rather than from a report, so the read view raises it too
 * — the collision exists the moment the checklist does, and learning about it
 * from a `--results` run that already happened is learning too late.
 */
export function contestedNotices(claims: readonly Claim[]): VerifyNotice[] {
  const contested = contestedDigests(claims);
  if (contested.size === 0) return [];
  const shared = [...contested].map(([digest, services]) => `${digest} (${services.join(", ")})`);
  return [
    {
      code: "verify.digest-contested",
      severity: "warn",
      message:
        `${plural(contested.size, "scenario digest")} claimed by more than one service: ${shared.join("; ")}. ` +
        "The digest is salted by service, so this is a hash collision, not shared wording — but one report still " +
        "cannot say whose suite ran them, so a shared --results run leaves them unconfirmed. " +
        "Record each service's claims from its own repository with --service.",
      claims: claims.filter((c) => c.digest !== undefined && contested.has(c.digest)).map((c) => c.id),
    },
  ];
}

/** The report a `--results` run consumed, as one line a reviewer can check by hand. */
export function reportLine(r: ConsumedReport): string {
  return `${r.path} (sha256 ${r.digest.slice(0, 12)}…, ${plural(r.scenarios, "tagged scenario")}, written ${r.mtime})`;
}

/* ------------------------------------------------------------------ */
/* Recording                                                           */
/* ------------------------------------------------------------------ */

/**
 * `repoDir` is the repository an attestation is ABOUT: the commit it names, the
 * tree its evidence must resolve inside, and where a `--results` report has to
 * live. It is threaded rather than read here because it comes from
 * `config.root`, and a `process.cwd()` in this function was the whole bug —
 * from a subdirectory, "this repo" quietly became that subdirectory.
 */
