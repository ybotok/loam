/**
 * `loam verify --results` — the cucumber report as an answer sheet.
 *
 * `loam gherkin` tags every generated scenario `@loam-digest-<16hex>`, and
 * cucumber's JSON format carries tags per scenario — so a test report says,
 * mechanically, which spec scenarios ran green. This module reads that report
 * and answers `scenario.tested` claims from it. The digest is the ONLY
 * identity: a claim's `digest` and the tag are the same 16 hex of the same
 * body hash, and names match nothing — rewording a scenario breaks the match,
 * which is the point, because an agent must not be able to SAY a scenario is
 * tested; only a green run may.
 *
 * That identity is CONTENT, and content stops one step short of a fleet: two
 * services whose specs word a scenario identically share a digest, so one
 * repository's report matches the other repository's claim. Those claims are
 * refused rather than answered — see {@link contestedDigests}.
 *
 * Parsing is deliberately tolerant of everything except the shape it matches
 * on. The format is what cucumber-js `--format json`, cucumber-jvm, behave and
 * SpecFlow emit — an array of features, each `elements[]` (scenarios) with
 * `name`, `tags[] {name}` and `steps[] {result {status}}`, plus the two
 * places those dialects put a failure the steps never see: cucumber-jvm
 * reports @Before/@After hook results in per-element `before[]`/`after[]`
 * arrays (a teardown assertion fails there while every step stays `passed`),
 * and behave carries an element-level `status` that a hook failure flips.
 * Only those fields are contract: unknown fields, tagless elements
 * (backgrounds, hand-written scenarios) and stray entries are skipped without
 * comment. What is NOT tolerated is a file that is not that array at all: a
 * report loam cannot recognize must refuse rather than quietly answer every
 * claim "not found".
 */
import { DIGEST_TAG_RE, scenarioDigestTag } from "./gherkin/stamp.js";
import { isRecord } from "./kernel/records.js";
import type { Answer } from "./verify/answers.js";
import type { Claim } from "./verify/checklist.js";

/** One report scenario, reduced to what matching needs. */
export interface ReportScenario {
  /** `<feature uri or name> › <scenario name>` — where the run can be seen. */
  where: string;
  /** Digests carried as `@loam-digest-…` tags. Usually one; hand-tagging can add more. */
  digests: string[];
  /** Step statuses, lowercased, in order. */
  steps: string[];
  /** Hook statuses from cucumber-jvm's `before[]`/`after[]`, lowercased, in order. */
  hooks: string[];
  /** behave's element-level status, lowercased — absent in the other dialects. */
  status?: string;
}

export type ReportRead =
  | { ok: true; scenarios: ReportScenario[] }
  | { ok: false; message: string };

/**
 * Read a parsed cucumber JSON document down to its digest-tagged scenarios.
 * `reportName` is how the caller spelled the file, for the refusal message.
 */
/** The marker key that makes a JSON document loam's own scenario shape, and the version this loam reads. */
export const SCENARIO_REPORT_MARKER = "loamScenarioReport";
export const SCENARIO_REPORT_VERSION = 1;

/**
 * Is this document loam's own scenario-report shape rather than a cucumber one?
 *
 * Marker-only, deliberately: the caller must be able to choose a READER before
 * either has validated anything, so that a malformed `loamScenarioReport` file
 * refuses as a malformed report of ITS kind rather than as "not a cucumber
 * array". A file that claims the shape and then fails it must never fall
 * through to the other parser and be told it is the wrong sort of document.
 */
export function isScenarioReport(doc: unknown): boolean {
  return isRecord(doc) && doc[SCENARIO_REPORT_MARKER] !== undefined;
}

/**
 * `{"loamScenarioReport": 1, "results": [{"digest": "…", "status": "passed"}]}`
 * — the runner-neutral answer sheet for `scenario.tested` claims.
 *
 * WHY THIS EXISTS. `loam gherkin` stamps every generated scenario
 * `@loam-digest-<16hex>`, and until now only cucumber's JSON carried that tag
 * back. A fleet on JUnit, pytest, Playwright, Vitest or a house runner could
 * therefore never reach `verified` — not because its evidence was weaker, but
 * because of a file format. The example fleet's own shipped record is the proof
 * of the cost: every claim in it is `answered_by: agent`, so the product's
 * showcase demonstrates only the lesser verdict.
 *
 * THE STANDARD OF PROOF IS UNCHANGED, and that is the whole argument. The
 * contract was never the JSON dialect: it is the digest — content-derived, so
 * rewording a `Given` breaks the match — plus a status that says a real run
 * reported it green. Both halves are here. An answer from this file is
 * `answered_by: runner` exactly as a cucumber one is, because it is the same
 * claim answered to the same standard by the same identity.
 *
 * It also adds no forgeability. loam cannot prove any JSON came from executing
 * a commit — SCHEMA says so, and the record stores the file's sha256 and mtime
 * precisely because that is all it can honestly claim. A hand-written cucumber
 * array was always exactly as easy to write as this is.
 *
 * The strict/tolerant split mirrors `verify/evidence/contract.ts` for its
 * reason: a cucumber report is another tool's file full of entries loam has no
 * business judging, while this shape exists for one purpose, so a malformed
 * entry is a malformed report rather than scenery to skip. `status` must be
 * exactly `passed` or `failed`; `skipped`, `pending` and vendor spellings are
 * refused rather than guessed at, because guessing is how a not-run scenario
 * becomes a confirmation.
 */
export function readScenarioReport(doc: unknown, reportName: string): ReportRead {
  if (!isRecord(doc)) {
    return { ok: false, message: `${reportName} is not a JSON object.` };
  }
  const version = doc[SCENARIO_REPORT_MARKER];
  if (version !== SCENARIO_REPORT_VERSION) {
    return {
      ok: false,
      message:
        `${reportName} declares \`${SCENARIO_REPORT_MARKER}: ${JSON.stringify(version)}\`, and this loam reads ` +
        `version ${SCENARIO_REPORT_VERSION}. A report loam cannot read is refused rather than answered in part.`,
    };
  }
  const results = doc["results"];
  if (!Array.isArray(results)) {
    return {
      ok: false,
      message: `${reportName} has no \`results\` array — the shape is {"${SCENARIO_REPORT_MARKER}": 1, "results": [{"digest": "…", "status": "passed"}]}.`,
    };
  }
  const scenarios: ReportScenario[] = [];
  for (const [i, entry] of results.entries()) {
    const at = `${reportName} results[${i}]`;
    if (!isRecord(entry)) return { ok: false, message: `${at} is not an object.` };
    const digest = str(entry["digest"]);
    if (digest === undefined || !/^[0-9a-f]{16}$/.test(digest)) {
      return {
        ok: false,
        message: `${at} has no \`digest\` of 16 lowercase hex characters — that is the \`@loam-digest-…\` tag \`loam gherkin\` stamped on the scenario.`,
      };
    }
    const status = str(entry["status"]);
    if (status !== "passed" && status !== "failed") {
      return {
        ok: false,
        message:
          `${at} has \`status: ${JSON.stringify(entry["status"])}\`; this shape accepts only "passed" or "failed". ` +
          "A scenario that did not run has no place in an answer sheet — omit it, and its claim stays unanswered rather than becoming a confirmation.",
      };
    }
    scenarios.push({
      // The runner's own name for the test, when it gave one — this is where a
      // reader goes to see the run, and it is the only free text here.
      where: str(entry["test"]) ?? `(${SCENARIO_REPORT_MARKER} entry ${i})`,
      digests: [digest],
      steps: [status],
      hooks: [],
    });
  }
  return { ok: true, scenarios };
}

export function readCucumberReport(doc: unknown, reportName: string): ReportRead {
  if (!Array.isArray(doc)) {
    return {
      ok: false,
      message:
        `${reportName} is not a cucumber JSON report — expected the top-level array of features ` +
        "that `cucumber-js --format json` (or cucumber-jvm, behave, SpecFlow) emits.",
    };
  }
  const scenarios: ReportScenario[] = [];
  for (const feature of doc) {
    if (!isRecord(feature)) continue;
    const featureName = str(feature["uri"]) ?? str(feature["name"]) ?? "(unnamed feature)";
    const elements = feature["elements"];
    if (!Array.isArray(elements)) continue;
    for (const el of elements) {
      if (!isRecord(el)) continue;
      const digests: string[] = [];
      const tags = el["tags"];
      if (Array.isArray(tags)) {
        for (const t of tags) {
          const name = typeof t === "string" ? t : isRecord(t) ? str(t["name"]) : undefined;
          const m = name === undefined ? null : DIGEST_TAG_RE.exec(name);
          if (m) digests.push(m[1]!);
        }
      }
      // No digest tag, nothing to match: a background, a hand-written
      // scenario, another tool's output. Invisible here, deliberately.
      if (digests.length === 0) continue;
      const resultStatuses = (raw: unknown): string[] => {
        if (!Array.isArray(raw)) return [];
        return raw.map((s) => {
          const status = isRecord(s) && isRecord(s["result"]) ? str(s["result"]["status"]) : undefined;
          return (status ?? "unknown").toLowerCase();
        });
      };
      const steps = resultStatuses(el["steps"]);
      // cucumber-jvm's @Before/@After hooks: separate arrays, same result shape.
      const hooks = [...resultStatuses(el["before"]), ...resultStatuses(el["after"])];
      // behave's element-level status — a hook failure flips it while the
      // steps that already ran keep "passed".
      const status = str(el["status"])?.toLowerCase();
      scenarios.push({
        where: `${featureName} › ${str(el["name"]) ?? "(unnamed scenario)"}`,
        digests,
        steps,
        hooks,
        ...(status === undefined ? {} : { status }),
      });
    }
  }
  return { ok: true, scenarios };
}

/**
 * The digests that more than one service claims, with the services that claim
 * them — a scenario worded identically in two services' specs.
 *
 * The digest is a hash of the scenario body and of nothing else, so `loam
 * gherkin` stamps the same tag into both repositories and a report from either
 * one matches both claims. A report says which scenario ran; it never says
 * whose suite ran it, and the two repositories never ran each other's tests.
 * loam has no way to tell them apart, so it does not choose: the answer is
 * refused, with the services named, and `--service` is the way to give a report
 * an owner (it narrows the checklist to one repository's claims before the
 * matching starts, so nothing here is contested).
 *
 * Only the SERVICE boundary counts. One service's spec repeating a scenario
 * word for word is genuinely one test — that is the documented meaning of the
 * stamp — and both claims may be answered by the one run.
 */
export function contestedDigests(claims: readonly Claim[]): Map<string, string[]> {
  const owners = new Map<string, Set<string>>();
  for (const c of claims) {
    if (c.digest === undefined) continue;
    const seen = owners.get(c.digest) ?? new Set<string>();
    seen.add(c.subject);
    owners.set(c.digest, seen);
  }
  const contested = new Map<string, string[]>();
  for (const [digest, services] of owners) {
    if (services.size > 1) contested.set(digest, [...services].sort());
  }
  return contested;
}

/**
 * Answer every claim from the report — the runner's half of the record. Meant
 * for `scenario.tested` claims (the only kind carrying a digest); a claim
 * without one is answered `unconfirmed` rather than skipped, because silence
 * must never read as checked.
 *
 * Confirmation is strict on purpose: every matching occurrence — a digest the
 * report holds twice is a re-run, and all of them count — ran at least one
 * step, every step `passed`, every before/after hook `passed`, and the
 * element-level status (when the dialect reports one) is `passed`. One failed
 * occurrence wins as failure, a skipped-only run is "skipped" not green, and
 * no match at all is "not found in report". A digest two services share is
 * refused before any of that: see {@link contestedDigests}.
 */
export function runnerAnswers(
  claims: Claim[],
  scenarios: ReportScenario[],
  reportName: string,
): Answer[] {
  const contested = contestedDigests(claims);
  return claims.map((c) => {
    const rivals = c.digest === undefined ? undefined : contested.get(c.digest);
    if (rivals !== undefined) {
      return answer(
        c.id,
        "unconfirmed",
        [],
        `${scenarioDigestTag(c.digest!)} is worded identically in ${rivals.join(", ")}, so ${reportName} cannot say whose suite ran it. ` +
          "Record each service's claims from its own repo with --service.",
      );
    }
    const runs = c.digest === undefined ? [] : scenarios.filter((s) => s.digests.includes(c.digest!));
    if (runs.length === 0) {
      const tag = c.digest === undefined ? "a digest tag" : scenarioDigestTag(c.digest);
      return answer(c.id, "unconfirmed", [], `not found in report — no scenario in ${reportName} carries ${tag}`);
    }
    const failing = runs.filter((r) => !passed(r));
    if (failing.length === 0) {
      return answer(c.id, "confirmed", runs.map((r) => `${reportName}: ${r.where}`));
    }
    const first = failing[0]!;
    const rerun = runs.length > 1 ? ` — ${failing.length} of ${runs.length} matching runs failed` : "";
    return answer(c.id, "unconfirmed", [], `${reason(first)} (${reportName}: ${first.where})${rerun}`);
  });
}

function answer(id: string, verdict: Answer["verdict"], evidence: string[], note?: string): Answer {
  return { id, verdict, evidence, ...(note === undefined ? {} : { note }), answered_by: "runner" };
}

/**
 * Green means green: at least one step, every step `passed`, every before/
 * after hook `passed`, and the element-level status (when the dialect carries
 * one) `passed` too. The last two exist because a run the runner itself
 * reports as FAILED — a teardown assertion in an @After hook, exactly the
 * shape the arch axis's outbox checks take — used to read as confirmed here:
 * the steps all passed, and the hook failure lived in fields nobody read.
 */
function passed(r: ReportScenario): boolean {
  return (
    r.steps.length > 0 &&
    r.steps.every((s) => s === "passed") &&
    r.hooks.every((h) => h === "passed") &&
    (r.status === undefined || r.status === "passed")
  );
}

/** Why a run did not pass, naming the step, hook or element status that says so. */
function reason(r: ReportScenario): string {
  if (r.steps.length === 0) return "no steps ran";
  const i = r.steps.findIndex((s) => s !== "passed" && s !== "skipped");
  if (i >= 0) return `${r.steps[i]} at step ${i + 1}`;
  if (r.steps.some((s) => s === "skipped")) return "skipped";
  const h = r.hooks.findIndex((s) => s !== "passed");
  if (h >= 0) return `${r.hooks[h]} in a before/after hook`;
  return `scenario status '${r.status ?? "unknown"}'`;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim().length > 0 ? v : undefined;
}
