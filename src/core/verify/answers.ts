/**
 * The answers, and the one thing loam checks about them.
 *
 * loam does not judge an answer. It cannot: it never read the code. What it
 * guarantees is that every question was asked and that every answer sits next
 * to the question it answers — so an answer set that does not correspond to the
 * current checklist is refused rather than merged. An unchecked claim must
 * never be able to masquerade as checked, and that refusal is `checkAnswers`.
 *
 * A scenario claim is answered mechanically wherever it can be: `--results`
 * reads a cucumber JSON report and matches it by the digest tag `loam gherkin`
 * stamped, and only a green run confirms one (`core/results.ts`). Where it
 * cannot — a legacy service whose suite is months away, which is the fleet loam
 * exists for — `--record` may still take an agent's word for it, and
 * `./record.ts` marks that answer attested rather than run.
 */
import { isRecord } from "../kernel/records.js";
import { type Claim } from "./checklist.js";

/**
 * Two verdicts, deliberately. Anything an agent cannot show evidence for is
 * unconfirmed — a third value for "not applicable" would absorb every claim
 * nobody wanted to answer.
 */
export const VERDICTS = ["confirmed", "unconfirmed"] as const;
export type Verdict = (typeof VERDICTS)[number];

/**
 * Who answered a claim: the `runner` (a cucumber report's digest-tagged
 * scenarios, matched mechanically by `--results`) or an `agent` (somebody's
 * word about the code, taken back by `--record`). On the record so a reviewer
 * can tell a green run from an assertion.
 */
export const ANSWERED_BY = ["runner", "agent"] as const;
export type AnsweredBy = (typeof ANSWERED_BY)[number];

export interface Answer {
  id: string;
  verdict: Verdict;
  /** Where it can be seen — `file:line`, or a report scenario for the runner. Required for `confirmed`. */
  evidence: string[];
  note?: string;
  answered_by: AnsweredBy;
}

/** Why an answer set was refused. Each names a different way it fails to answer. */
export type AnswerRefusal = "answers-unreadable" | "answers-mismatch" | "answers-unevidenced";

export type AnswerCheck =
  /** The answers, re-ordered to the checklist, one per claim. */
  | { ok: true; answers: Answer[] }
  | { ok: false; code: AnswerRefusal; message: string };

/**
 * Accept an answer set only if it answers THIS checklist: every claim once, no
 * claim twice, nothing extra, and no "confirmed" that shows nothing.
 *
 * The refusals are the point of the command. If a stale or partial answer file
 * could be recorded, `verification.yaml` would say a claim was checked when
 * nobody ever asked it — and a record that can lie is worse than no record,
 * because it looks like evidence.
 *
 * `runnerOwned` is the composition rule under `--results`: ids the test runner
 * answers, which an answers file must therefore not touch. An entry naming one
 * refuses with its own diagnosis — the id IS on the feature's checklist, so
 * calling it unknown would send the caller hunting a staleness that is not
 * there.
 *
 * `context` is what turns the last line from a circle into an instruction. In a
 * fleet the commonest way to "miss" a claim is that it is not yours: the
 * checklist spans ten repositories and this one can only answer its own. Told
 * only to "answer the claims it lists", an agent in the payment-service repo
 * re-runs verify, sees the same checkout-web claims it cannot speak for, and
 * either loops or invents evidence. So when every unanswered claim belongs to
 * another service, say THAT, and name the command that records them.
 */
export function checkAnswers(
  claims: Claim[],
  raw: unknown,
  runnerOwned?: ReadonlySet<string>,
  context?: { feature: string; service?: string },
): AnswerCheck {
  const refuse = (code: AnswerRefusal, message: string): AnswerCheck => ({ ok: false, code, message });

  const list = Array.isArray(raw)
    ? raw
    : isRecord(raw) && Array.isArray(raw["answers"])
      ? (raw["answers"] as unknown[])
      : null;
  if (list === null) {
    return refuse(
      "answers-unreadable",
      "Expected a JSON array of answers, or an object with an `answers` array: " +
        `[{ "id": "...", "verdict": "confirmed", "evidence": ["file:line"] }]`,
    );
  }

  const answers: Answer[] = [];
  for (const [i, entry] of list.entries()) {
    const where = `answer ${i + 1}`;
    if (!isRecord(entry)) return refuse("answers-unreadable", `${where} is not an object`);
    const id = entry["id"];
    if (typeof id !== "string" || id.length === 0) {
      return refuse("answers-unreadable", `${where} has no claim id`);
    }
    const verdict = entry["verdict"];
    if (typeof verdict !== "string" || !(VERDICTS as readonly string[]).includes(verdict)) {
      return refuse(
        "answers-unreadable",
        `${where} ('${id}') has verdict ${JSON.stringify(verdict)} — expected one of ${VERDICTS.join(", ")}`,
      );
    }
    const note = typeof entry["note"] === "string" ? entry["note"].trim() : "";
    answers.push({
      id,
      verdict: verdict as Verdict,
      evidence: stringList(entry["evidence"]),
      ...(note.length > 0 ? { note } : {}),
      answered_by: "agent",
    });
  }

  const byId = new Map<string, Answer>();
  const twice: string[] = [];
  for (const a of answers) {
    if (byId.has(a.id)) twice.push(a.id);
    else byId.set(a.id, a);
  }
  const known = new Set(claims.map((c) => c.id));
  const strayIds = [...new Set(answers.map((a) => a.id).filter((id) => !known.has(id)))];
  const runnerHit = strayIds.filter((id) => runnerOwned?.has(id) === true);
  const unknown = strayIds.filter((id) => runnerOwned?.has(id) !== true);
  const missingClaims = claims.filter((c) => !byId.has(c.id));
  const missing = missingClaims.map((c) => c.id);
  if (runnerHit.length + unknown.length + missing.length + twice.length > 0) {
    const parts = [
      runnerHit.length > 0
        ? `${runnerHit.length} answer(s) name scenario claim(s) the test runner owns under --results: ${runnerHit.join(", ")} — the report answers those; take them out of the answers file`
        : "",
      unknown.length > 0 ? `${unknown.length} answer(s) name a claim that is not on the checklist: ${unknown.join(", ")}` : "",
      missing.length > 0 ? `${missing.length} claim(s) have no answer: ${missing.join(", ")}` : "",
      twice.length > 0 ? `${twice.length} claim(s) answered more than once: ${[...new Set(twice)].join(", ")}` : "",
    ].filter((s) => s.length > 0);
    return refuse(
      "answers-mismatch",
      `These answers do not match the checklist — ${parts.join("; ")}. ` +
        missingAdvice(missingClaims, claims.filter((c) => byId.has(c.id)), context),
    );
  }

  const unevidenced = claims
    .map((c) => byId.get(c.id)!)
    .filter((a) => a.verdict === "confirmed" && a.evidence.length === 0)
    .map((a) => a.id);
  if (unevidenced.length > 0) {
    return refuse(
      "answers-unevidenced",
      `${unevidenced.length} claim(s) are confirmed with no evidence: ${unevidenced.join(", ")}. A confirmation with nothing behind it is an assertion — give a file:line, or answer 'unconfirmed'.`,
    );
  }

  // Checklist order, not the order they were written in: the record reads in the
  // order the questions were asked, whatever the agent did.
  return { ok: true, answers: claims.map((c) => byId.get(c.id)!) };
}

/**
 * The last sentence of an `answers-mismatch`. "Re-run and answer the claims it
 * lists" is sound advice only when the caller CAN answer them. In a fleet the
 * checklist is federated — a feature's claims are filed under the service whose
 * code answers them — so the honest diagnosis for a repo that answered
 * everything it owns is "the rest is not yours", together with the form that
 * records the rest. Anything else sends the caller round the same loop.
 */
function missingAdvice(
  missing: Claim[],
  answered: Claim[],
  context?: { feature: string; service?: string },
): string {
  const generic = "Re-run `loam verify` and answer the claims it lists.";
  if (context === undefined || missing.length === 0 || answered.length === 0) return generic;
  // The signature of "I answered mine and the rest is not mine": the services
  // that own the unanswered claims and the services that own the answered ones
  // do not overlap. A single-service checklist with one claim forgotten fails
  // this test and keeps the generic advice, which is the right advice there —
  // that claim really is the caller's to answer.
  const owners = [...new Set(missing.map((c) => c.subject))].sort();
  const covered = new Set(answered.map((c) => c.subject));
  if (owners.some((s) => covered.has(s))) return generic;
  const form = `\`loam verify ${context.feature} --record answers.json --service <svc>\``;
  const mine = context.service;
  return mine === undefined
    ? `Those claims are owned by ${owners.join(", ")} — each service attests its own from its own repository (${form}); ` +
        "this all-at-once form has to answer the whole checklist in one file."
    : `Every unanswered claim belongs to a different service (${owners.join(", ")}) and this repository can only attest '${mine}' — ` +
        `run ${form} in each of those repositories instead.`;
}

function stringList(v: unknown): string[] {
  if (typeof v === "string") return v.trim().length > 0 ? [v.trim()] : [];
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x).trim()).filter((s) => s.length > 0);
}

