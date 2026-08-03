/**
 * `loam verify <FEAT>` — the done-check.
 *
 * Two modes, one subject. Without `--record` it derives the checklist from the
 * feature's own artifacts and reports it, together with whatever has already
 * been answered. With `--record <answers.json>` it takes the answers back, and
 * refuses everything that does not correspond to the current checklist.
 *
 * It reports; it does not gate. Archive refuses an incoherent feature because
 * loam COMPUTED the incoherence from the documents in front of it. A verdict
 * here is somebody's word about code loam never read, and making it the last
 * obstacle before shipping is how a checklist turns into a formality — the
 * cheapest way past a gate is always to say yes.
 */
import type { Command } from "commander";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadConfig } from "../core/config.js";
import { emitJson, emitJsonError, reportNoConfig, type ErrorCode } from "../core/json.js";
import { featuresDir, resolveFeature } from "../core/repo.js";
import { repoPath } from "./list.js";
import {
  buildVerification,
  checkAnswers,
  featureChecklist,
  readVerification,
  verificationPath,
  writeVerification,
  type Checklist,
  type Verification,
} from "../core/verify.js";

interface VerifyOptions {
  record?: string;
  json?: boolean;
}

/** A claim plus what has been said about it. `unanswered` is the honest default. */
interface ClaimStatus {
  id: string;
  kind: string;
  subject: string;
  claim: string;
  verdict: "confirmed" | "unconfirmed" | "unanswered";
  evidence: string[];
  note?: string;
}

export function registerVerify(program: Command): void {
  program
    .command("verify")
    .argument("<featureId>", "feature id, e.g. FEAT-101")
    .description("Check a shipped feature against its own promises: derive the claims, record the answers")
    .option("--record <file>", "record a JSON answer set against the current checklist")
    .option("--json", "emit the machine contract instead of the human view")
    .action(async (featureId: string, opts: VerifyOptions) => {
      const json = opts.json === true;

      const config = await loadConfig();
      if (!config) {
        reportNoConfig(json);
        return;
      }
      const { docsDir } = config;

      // Archived features resolve too: a shipped feature's verification is worth
      // reading back, and it travelled into the archive with everything else.
      const feature = await resolveFeature(docsDir, featureId, { includeArchived: true });
      if (!feature) {
        return fail(json, "unknown-target", `No feature '${featureId}' under ${featuresDir(docsDir)}.`);
      }

      const checklist = await featureChecklist(docsDir, feature.dir, feature.id);

      if (opts.record !== undefined) {
        if (feature.archived) {
          return fail(
            json,
            "invalid-option",
            `${feature.id} is archived — its verification is history now. \`loam unarchive ${feature.id}\` first if the answers really need to change.`,
          );
        }
        await record(docsDir, feature.dir, checklist, opts.record, json);
        return;
      }

      report(docsDir, feature.dir, checklist, await readVerification(feature.dir), json);
    });
}

/* ------------------------------------------------------------------ */
/* Reading                                                             */
/* ------------------------------------------------------------------ */

function statuses(checklist: Checklist, recorded: Verification | null): ClaimStatus[] {
  const byId = new Map((recorded?.claims ?? []).map((c) => [c.id, c]));
  return checklist.claims.map((c) => {
    const answer = byId.get(c.id);
    return {
      id: c.id,
      kind: c.kind,
      subject: c.subject,
      claim: c.claim,
      verdict: answer?.verdict ?? "unanswered",
      evidence: answer?.evidence ?? [],
      ...(answer?.note === undefined ? {} : { note: answer.note }),
    };
  });
}

function report(
  docsDir: string,
  featureDir: string,
  checklist: Checklist,
  recorded: Verification | null,
  json: boolean,
): void {
  const claims = statuses(checklist, recorded);
  const count = (v: string): number => claims.filter((c) => c.verdict === v).length;
  const summary = {
    claims: claims.length,
    confirmed: count("confirmed"),
    unconfirmed: count("unconfirmed"),
    unanswered: count("unanswered"),
  };
  // A record that answers a different question set is not an answer to this one,
  // however complete it looks — so staleness disqualifies it as a whole.
  const stale = recorded !== null && recorded.checklist !== checklist.digest;
  const verified = recorded !== null && !stale && claims.length > 0 && summary.confirmed === claims.length;

  if (json) {
    emitJson({
      feature: checklist.feature,
      path: repoPath(docsDir, featureDir),
      digest: checklist.digest,
      verified,
      summary,
      recorded:
        recorded === null
          ? null
          : {
              path: repoPath(docsDir, verificationPath(featureDir)),
              recorded: recorded.recorded,
              checklist: recorded.checklist,
              stale,
            },
      claims,
    });
    return;
  }

  console.log(`${checklist.feature} — ${plural(claims.length, "claim")} derived from ${repoPath(docsDir, featureDir)}\n`);
  if (claims.length === 0) {
    console.log("  Nothing to check: this feature's delta, specs and openapi promise nothing yet.");
    return;
  }
  for (const c of claims) {
    console.log(`  ${MARK[c.verdict]} ${c.id}  ${c.claim}`);
    for (const e of c.evidence) console.log(`      ${e}`);
    if (c.note !== undefined) console.log(`      note: ${c.note}`);
  }

  console.log("");
  if (recorded === null) {
    console.log(`  Not verified — no ${repoPath(docsDir, verificationPath(featureDir))}.`);
  } else {
    console.log(
      `  Recorded ${recorded.recorded} — ${summary.confirmed} confirmed, ${summary.unconfirmed} unconfirmed, ${summary.unanswered} unanswered.`,
    );
    if (stale) {
      console.log("  STALE: the feature changed after this was recorded. Answer the claims above again.");
    }
  }
  if (!verified) {
    console.log("\n  Answer each claim, then record the answers:\n");
    console.log('    [{ "id": "<claim id>", "verdict": "confirmed", "evidence": ["src/x.ts:42"] }]');
    console.log(`\n    loam verify ${checklist.feature} --record answers.json`);
    console.log("\n  A claim you cannot show evidence for is `unconfirmed` — say why in `note`.");
  }
}

const MARK: Record<string, string> = { confirmed: "✓", unconfirmed: "✗", unanswered: "?" };

/* ------------------------------------------------------------------ */
/* Recording                                                           */
/* ------------------------------------------------------------------ */

async function record(
  docsDir: string,
  featureDir: string,
  checklist: Checklist,
  answersFile: string,
  json: boolean,
): Promise<void> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(resolve(process.cwd(), answersFile), "utf8"));
  } catch (err) {
    return fail(
      json,
      "answers-unreadable",
      `Cannot read ${answersFile}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const checked = checkAnswers(checklist.claims, raw);
  if (!checked.ok) return fail(json, checked.code, checked.message);

  const verification = buildVerification(checklist, checked.answers, today(new Date()));
  const path = await writeVerification(featureDir, verification);
  const unconfirmed = verification.claims.filter((c) => c.verdict === "unconfirmed");

  if (json) {
    emitJson({
      feature: verification.feature,
      path: repoPath(docsDir, path),
      digest: verification.checklist,
      recorded: verification.recorded,
      summary: verification.summary,
      unconfirmed: unconfirmed.map((c) => ({ id: c.id, claim: c.claim, ...(c.note === undefined ? {} : { note: c.note }) })),
    });
    return;
  }

  console.log(`${verification.feature} verification recorded — ${repoPath(docsDir, path)}\n`);
  console.log(
    `  ${verification.summary.confirmed} of ${plural(verification.summary.claims, "claim")} confirmed with evidence.`,
  );
  for (const c of unconfirmed) {
    console.log(`  ✗ ${c.claim}${c.note === undefined ? "" : ` — ${c.note}`}`);
  }
  console.log(
    unconfirmed.length === 0
      ? "\n  The record travels with the feature into features/archive/."
      : "\n  Recorded as it stands. Nothing gates on this — it is what a reviewer reads later, so leave it true.",
  );
}

/**
 * The local calendar day, like `vouch`: a record is somebody saying "today I
 * looked", and `toISOString` files an evening in the Americas under tomorrow.
 */
function today(now: Date): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function fail(json: boolean, code: ErrorCode, message: string): void {
  if (json) {
    emitJsonError(code, message);
    return;
  }
  console.error(message);
  process.exitCode = 1;
}

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}
