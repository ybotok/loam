/**
 * `loam verify <FEAT> --diff-answers a.json b.json` — the command surface of
 * the cross-examination lens.
 *
 * A third read form beside the report and frozen views: it takes no lock,
 * needs no service binding, and writes nothing. The payload deliberately
 * carries NO `verified`, `verdict` or `attested` key — their absence is the
 * doctrine made structural (`core/verify/cross/diff.ts` holds the
 * reasoning): this surface ranks review, it grades nothing.
 *
 * Both files validate through the same `checkAnswers` the record path uses,
 * against the same scoped checklist, with `runnerOwned` unset: under a diff
 * both agents answer everything in scope, `scenario.tested` included — that
 * is the attested channel, and this command records nothing. If a future
 * wave ever makes scenario claims runner-only even without `--results`,
 * blind agents can no longer answer them and this command starts refusing;
 * `checkAnswers`' own `runnerOwned` note carries the same warning where that
 * editor will see it.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { emitJson, fail, repoPath } from "../../../core/envelope/json.js";
import { isRecord } from "../../../core/kernel/records.js";
import { checkAnswers, type Answer, type AnswerRefusal } from "../../../core/verify/answers.js";
import { type Checklist, type Claim } from "../../../core/verify/checklist.js";
import { crossExamine, disjointNotice, type CrossAnswer } from "../../../core/verify/cross/diff.js";
import { plural } from "../../policy/format.js";
import { type VerifyTarget } from "../report.js";

/**
 * The two files, named for the order they were given: `a` is the first and
 * every refusal about it says "first answer set". One record rather than two
 * loose strings because they are never asked about separately, and because a
 * transposed pair is exactly the mistake a positional form invites.
 */
export interface AnswerFiles {
  a: string;
  b: string;
}

type SideRead =
  | { ok: true; answers: Answer[]; digest: string }
  | { ok: false; code: AnswerRefusal; message: string };

/**
 * Everything a side is validated against: the lens-scoped claims, the whole
 * checklist behind them (what the honest off-lens diagnosis is written from),
 * and the lens itself. One record because the three are never asked about
 * separately — a scoped array without its checklist is how the false "not on
 * the checklist" diagnosis happened.
 */
interface DiffScope {
  scoped: Claim[];
  checklist: Checklist;
  lens?: string;
}

/**
 * The honest half of a lens-narrowed mismatch. `checkAnswers` is handed only
 * the scoped claims, so an answer naming another service's claim — which IS
 * on the feature's checklist — would otherwise be called "not on the
 * checklist": the same false diagnosis `runnerOwned` exists to prevent on the
 * recording path. When the stray ids are real claims the lens filtered out,
 * say that, and say what the lens narrowed.
 */
function offLensNote(scope: DiffScope, raw: unknown): string {
  if (scope.lens === undefined) return "";
  const entries = Array.isArray(raw)
    ? raw
    : isRecord(raw) && Array.isArray(raw["answers"])
      ? (raw["answers"] as unknown[])
      : [];
  const scoped = new Set(scope.scoped.map((c) => c.id));
  const onChecklist = new Set(scope.checklist.claims.map((c) => c.id));
  const foreign = [
    ...new Set(
      entries
        .filter(isRecord)
        .map((entry) => entry["id"])
        .filter((id): id is string => typeof id === "string" && onChecklist.has(id) && !scoped.has(id)),
    ),
  ];
  if (foreign.length === 0) return "";
  return (
    ` (${foreign.join(", ")}: on the ${scope.checklist.feature} checklist but owned by another service — ` +
    `--service ${scope.lens} narrowed the comparison to ${scope.scoped.length} of ${scope.checklist.claims.length} claims)`
  );
}

/**
 * Read, digest and validate ONE answer set. Fail-closed on purpose at every
 * step: an unreadable or malformed file is a refusal naming which file and
 * why — never a silently empty side, which would grade as "no disagreement"
 * about claims nobody compared.
 */
async function readSide(scope: DiffScope, file: string, side: "first" | "second"): Promise<SideRead> {
  const label = `${side} answer set (${file})`;
  let bytes: Buffer;
  try {
    // cwd-relative deliberately — record.ts's reason for the same choice: the
    // answer sets are the caller's hand-offs, not repository artifacts, and
    // nothing on any record will ever point at them.
    bytes = await readFile(resolve(process.cwd(), file));
  } catch (err) {
    return {
      ok: false,
      code: "answers-unreadable",
      message: `${label}: cannot read: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(bytes.toString("utf8"));
  } catch (err) {
    return {
      ok: false,
      code: "answers-unreadable",
      message: `${label}: not JSON: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  const context = { feature: scope.checklist.feature, ...(scope.lens === undefined ? {} : { service: scope.lens }) };
  const checked = checkAnswers(scope.scoped, raw, undefined, context);
  if (!checked.ok) {
    return { ok: false, code: checked.code, message: `${label}: ${checked.message}${offLensNote(scope, raw)}` };
  }
  // The digest is over the exact bytes read — the same reviewer-checkable
  // promise `reportLine` makes for consumed reports: `shasum -a 256 <file>`
  // answers whether the diff in hand read the file in hand.
  return { ok: true, answers: checked.answers, digest: createHash("sha256").update(bytes).digest("hex") };
}

function sideLine(answer: CrossAnswer): string {
  if (answer.verdict === "confirmed") return `confirmed (${answer.evidence.join(", ")})`;
  return `unconfirmed${answer.note === undefined ? "" : ` — ${answer.note}`}`;
}

export async function diffAnswers(
  target: VerifyTarget,
  checklist: Checklist,
  files: AnswerFiles,
  scope: { lens?: string },
): Promise<void> {
  const { docsDir, featureDir, json } = target;
  const lens = scope.lens;
  // The same lens the read view applies (report.ts): the claims that
  // service's code answers, no repository binding asked for — a diff writes
  // nothing, so there is nothing to bind.
  const scoped = lens === undefined ? checklist.claims : checklist.claims.filter((c) => c.subject === lens);
  // record.ts's refusal, mirrored: a lens that owns nothing here is almost
  // always a typo'd service id, and validating two files against an empty
  // claim set would call every honest answer off-checklist instead of naming
  // the real mistake.
  if (lens !== undefined && scoped.length === 0) {
    return fail(
      json,
      "unknown-service",
      `The current ${checklist.feature} checklist has no claims owned by service '${lens}'.`,
    );
  }
  const diffScope: DiffScope = { scoped, checklist, ...(lens === undefined ? {} : { lens }) };

  // Sequential on purpose — a short-circuit, not a race: readSide never
  // rejects, but when the first file refuses, the second is never read or
  // parsed, so the refusal a caller sees always names the earliest problem
  // and no work is spent on a file whose sibling already failed the run.
  const a = await readSide(diffScope, files.a, "first");
  if (!a.ok) return fail(json, a.code, a.message);
  const b = await readSide(diffScope, files.b, "second");
  if (!b.ok) return fail(json, b.code, b.message);

  const cross = crossExamine(scoped, a.answers, b.answers);
  const notice = disjointNotice(cross.rows);

  if (json) {
    emitJson({
      feature: checklist.feature,
      path: repoPath(docsDir, featureDir),
      digest: checklist.digest,
      // Named only when narrowed — report.ts's rule: a consumer must never
      // mistake one service's cross-examination for the feature's.
      ...(lens === undefined ? {} : { service: lens, checklistClaims: checklist.claims.length }),
      files: {
        a: { path: files.a, digest: a.digest },
        b: { path: files.b, digest: b.digest },
      },
      summary: cross.summary,
      claims: cross.rows,
      disagreements: cross.disagreements,
      ...(notice === null ? {} : { notices: [notice] }),
    });
    return;
  }

  const scopeNote =
    lens === undefined ? "" : ` owned by ${lens} (of ${plural(checklist.claims.length, "claim")} on the checklist)`;
  console.log(
    `${checklist.feature} — cross-examination over ${plural(cross.rows.length, "claim")}${scopeNote} (${files.a} vs ${files.b})\n`,
  );
  if (cross.rows.length === 0) {
    // Only the whole-checklist form can get here: a lens that owns nothing
    // refused `unknown-service` above.
    console.log("  Nothing to cross-examine: this feature's delta, specs and openapi promise nothing yet.");
    return;
  }
  for (const row of cross.rows) {
    if (row.code === "cross.disagree") {
      console.log(`  ✗ cross.disagree ${row.id}  [${row.subject}]  ${row.claim}`);
      console.log(`      a: ${sideLine(row.a)}`);
      console.log(`      b: ${sideLine(row.b)}`);
    } else if (row.code === "cross.agree-unconfirmed") {
      console.log(`  = ${row.id}  [${row.subject}]  ${row.claim}  (both unconfirmed)`);
    } else {
      console.log(`  = ${row.id}  [${row.subject}]  ${row.claim}${row.evidenceDisjoint === true ? "  (disjoint evidence)" : ""}`);
    }
  }
  console.log("");
  if (notice !== null) console.log(`  ⚠ ${notice.code}: ${notice.message}`);
  console.log(
    `  ${cross.summary.agreeConfirmed} agree-confirmed, ${cross.summary.agreeUnconfirmed} agree-unconfirmed, ${cross.summary.disagree} disagree.`,
  );
  console.log("\n  Agreement is not verification — nothing was written and no verdict changed.");
  console.log("  Read the disagreements first, then the disjoint-evidence agreements.");
}
