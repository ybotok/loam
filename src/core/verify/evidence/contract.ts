/**
 * `loam verify --contract-results` — an API contract-test report as the answer
 * sheet for `api.exposes` claims.
 *
 * The accepted shape is loam's own documented one (SCHEMA.md, "Contract-test
 * reports"): `{"loamContractReport": 1, "results": [{"operationId": "…",
 * "status": "passed"}]}`. It is deliberately a shape tools EMIT INTO rather
 * than a vendor format loam parses, because no surveyed vendor format carries
 * both halves of what confirming needs — an unambiguous executed-AND-passed
 * status and a deterministic operation join key. Specmatic's JSON coverage
 * report was the v1 candidate and is declined by name: its `coverageStatus:
 * "covered"` means exercised, not passed (a red run still writes "covered"),
 * so an adapter over it would confirm exactly what a failing suite refuted.
 *
 * The operationId is the ONLY identity, matched against the structured
 * `operation` a claim carries (`../checklist.ts`). It is half an identity, and
 * the design leans on the missing half being supplied by scope: an operationId
 * is unique within ONE contract document, not across a fleet, and a report
 * entry names no service — so when more than one service on the handed-in
 * checklist exposes the same operationId, the claims are refused rather than
 * answered ({@link contestedOperations}), and `--service` is what gives a
 * contract report an owner, exactly as it is for a contested scenario digest.
 * Within one service's claims the match is exact, and renaming an operation
 * renames its claim, so rewording cannot carry an answer over. Names and free
 * text match nothing.
 *
 * Parsing is strict where the cucumber reader is tolerant, and the asymmetry
 * is deliberate: a cucumber report is another tool's file full of legitimate
 * entries loam has no business judging, while this shape exists for exactly
 * one purpose, so an entry that cannot be matched is a malformed report, not
 * scenery. A file that is recognizably not this shape refuses rather than
 * quietly answering every claim "not exercised" — an unparseable report never
 * silently answers zero claims as if none matched.
 */
import { isRecord } from "../../kernel/records.js";
import { type Answer } from "../answers.js";
import { type Claim } from "../checklist.js";

/** The marker key that makes a JSON document this shape, and the version this loam reads. */
export const CONTRACT_REPORT_MARKER = "loamContractReport";
export const CONTRACT_REPORT_VERSION = 1;

/** One report entry, reduced to what matching needs. Extra keys pass untouched. */
export interface ContractRun {
  operationId: string;
  /** Exactly `"passed"` confirms; `"failed"` and every other string do not. */
  status: string;
  /** Optional free text naming the test — it rides into the evidence line. */
  test?: string;
}

export type ContractReportRead =
  | { ok: true; runs: ContractRun[] }
  | { ok: false; message: string };

/**
 * Read a parsed JSON document down to its runs. `reportName` is how the caller
 * spelled the file, for the refusal message; core never prints, so a refusal
 * is data for the command to fail with (`answers-unreadable`).
 */
export function readContractReport(doc: unknown, reportName: string): ContractReportRead {
  const shape =
    `{"${CONTRACT_REPORT_MARKER}": ${CONTRACT_REPORT_VERSION}, "results": [{"operationId": "…", "status": "passed"}]}`;
  if (!isRecord(doc) || !(CONTRACT_REPORT_MARKER in doc)) {
    return {
      ok: false,
      message:
        `${reportName} is not a contract-results report — expected loam's generic shape ${shape} ` +
        "(see SCHEMA.md's contract-test reports section; Specmatic, Pact, Dredd and property harnesses emit it with a one-line transform).",
    };
  }
  if (doc[CONTRACT_REPORT_MARKER] !== CONTRACT_REPORT_VERSION) {
    // A later version may redefine what an entry means; reading it with this
    // parser could confirm something the report never said. Fail closed.
    return {
      ok: false,
      message:
        `${reportName} declares ${CONTRACT_REPORT_MARKER}: ${JSON.stringify(doc[CONTRACT_REPORT_MARKER])} — ` +
        `this loam reads version ${CONTRACT_REPORT_VERSION} only.`,
    };
  }
  const results = doc["results"];
  if (!Array.isArray(results)) {
    return { ok: false, message: `${reportName} has no \`results\` array — expected ${shape}.` };
  }
  const runs: ContractRun[] = [];
  for (const [i, entry] of results.entries()) {
    const where = `${reportName} entry ${i + 1}`;
    if (!isRecord(entry)) return { ok: false, message: `${where} is not an object — expected ${shape}.` };
    const operationId = entry["operationId"];
    if (typeof operationId !== "string" || operationId.length === 0) {
      return { ok: false, message: `${where} has no operationId — every entry must name the operation it exercised.` };
    }
    const status = entry["status"];
    if (typeof status !== "string" || status.length === 0) {
      return {
        ok: false,
        message: `${where} ('${operationId}') has no status — expected "passed", "failed", or the tool's own word for anything else.`,
      };
    }
    const test = entry["test"];
    runs.push({
      operationId,
      status,
      ...(typeof test === "string" && test.trim().length > 0 ? { test: test.trim() } : {}),
    });
  }
  return { ok: true, runs };
}

/**
 * The operationIds that more than one service on this checklist exposes, with
 * the services that expose them — `contestedDigests`' (core/results.ts) exact
 * shape, for this axis's join key.
 *
 * An operationId is unique within one contract document, not across a fleet:
 * two services may each expose a 'createSplit', and a report entry carries no
 * service half, so a single contract report matches both services' claims and
 * cannot say whose suite it describes. The all-at-once form once confirmed a
 * service from a suite that never touched it exactly this way. loam does not
 * choose: those claims are refused rather than answered, and `--service` is
 * what gives a report an owner — it narrows the checklist to one subject
 * before the matching starts, so nothing handed in here is contested.
 */
export function contestedOperations(claims: readonly Claim[]): Map<string, string[]> {
  const owners = new Map<string, Set<string>>();
  for (const c of claims) {
    if (c.operation === undefined) continue;
    const seen = owners.get(c.operation) ?? new Set<string>();
    seen.add(c.subject);
    owners.set(c.operation, seen);
  }
  const contested = new Map<string, string[]>();
  for (const [operation, services] of owners) {
    if (services.size > 1) contested.set(operation, [...services].sort());
  }
  return contested;
}

/**
 * Answer every claim from the report — the contract runner's half of the
 * record. Total over the claims handed in, like `runnerAnswers`: a claim the
 * report does not exercise is answered `unconfirmed`, never skipped, because
 * silence must never read as checked. Report entries matching no claim are
 * skipped silently — a real contract suite exercises the whole living API,
 * and the claims only ever cover what the feature ADDS.
 *
 * Confirmation is strict on purpose: every matching entry (an operationId the
 * report holds twice is two test cases, and all of them count) has status
 * exactly `"passed"`. One non-passed entry wins as failure, and an unknown
 * status is named in the note rather than rounded to either verdict. An
 * operationId two services expose is refused before any of that: see
 * {@link contestedOperations}.
 */
export function contractAnswers(claims: Claim[], runs: ContractRun[], reportName: string): Answer[] {
  const contested = contestedOperations(claims);
  return claims.map((c) => {
    const rivals = c.operation === undefined ? undefined : contested.get(c.operation);
    if (rivals !== undefined) {
      return answer(
        c.id,
        "unconfirmed",
        [],
        `operationId '${c.operation}' is exposed by more than one service on this checklist (${rivals.join(", ")}), ` +
          `so ${reportName} cannot say whose suite exercised it. Record each service's claims from its own repo with --service.`,
      );
    }
    if (c.operation === undefined) {
      // Unreachable for the api.exposes claims this loam derives, which always
      // carry one — but the function is total, and a claim without a join key
      // must fail closed rather than throw or silently confirm.
      return answer(c.id, "unconfirmed", [], "claim carries no operationId for a contract report to match on");
    }
    const matching = runs.filter((r) => r.operationId === c.operation);
    if (matching.length === 0) {
      return answer(
        c.id,
        "unconfirmed",
        [],
        `not exercised — no entry in ${reportName} names operationId '${c.operation}'`,
      );
    }
    const failing = matching.filter((r) => r.status !== "passed");
    if (failing.length === 0) {
      return answer(
        c.id,
        "confirmed",
        matching.map((r) => `${reportName}: ${r.test ?? `operationId '${c.operation}' passed`}`),
      );
    }
    const first = failing[0]!;
    const why = first.status === "failed" ? "failed" : `status '${first.status}' is not 'passed'`;
    const rerun =
      matching.length > 1 ? ` — ${failing.length} of ${matching.length} matching entries did not pass` : "";
    return answer(
      c.id,
      "unconfirmed",
      [],
      `${why} (${reportName}${first.test === undefined ? "" : `: ${first.test}`})${rerun}`,
    );
  });
}

function answer(id: string, verdict: Answer["verdict"], evidence: string[], note?: string): Answer {
  return { id, verdict, evidence, ...(note === undefined ? {} : { note }), answered_by: "external-runner" };
}
