/**
 * The words loam prints to a person, answered by `loam explain`.
 *
 * test/explain.test.ts pins the lookup's machinery — the parser, the pin
 * pairing, the disjointness of the four subject families. This file pins the
 * thing a newcomer actually meets: `loam status` prints `ready`, `loam tasks`
 * prints `[implement] scenario.tested` and a frontier, `loam validate --all`
 * prints "0 empty · 0 partial · …" — and until these terms existed every one of
 * those words answered `unknown-target`. Each closed vocabulary is read from
 * the constant that owns it, so a value added to one (a sixth stage, a new
 * claim kind) fails here until `loam explain` can say what it means.
 *
 * The second half pins the finding page's header, which printed a scope as
 * `[--feature <FEAT-id>] (warn)` — the shape a usage line gives an OPTIONAL
 * FLAG — where it meant "this is reported by `loam validate --feature`".
 */
import { afterEach, describe, expect, it } from "vitest";
import { rm } from "node:fs/promises";
import { COMMANDS } from "../src/core/agent/protocol.js";
import { LOAM_CHECK } from "../src/core/agent/workflows/check.js";
import { parseFixRows } from "../src/core/explain/fix-tables.js";
import { explainSubject, listCodes, listTermGroups, listTerms } from "../src/core/explain/lookup.js";
import { TERMS } from "../src/core/explain/terms.js";
import { ARTIFACT_STATUSES } from "../src/core/status/report.js";
import { DESCRIBED_KIND, type TaskStep } from "../src/core/tasks/unit.js";
import { CLAIM_KINDS } from "../src/core/verify/claims/identity.js";
import { VERIFICATION_VERDICTS } from "../src/core/verify/record.js";
import { MATURITY_LADDER } from "../src/core/vocabulary/maturity.js";
import { makeTmpDir, runLoam } from "./helpers/harness.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!();
});

/** A bare directory: no loam.json, no docs repo — `explain` reads nothing. */
async function unwiredDir(): Promise<string> {
  const dir = await makeTmpDir("loam-explain-terms-");
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

/**
 * The steps a `loam tasks` unit waits at. A Record over the union rather than
 * an array, because `TaskStep` is a type with no runtime list: a fifth step
 * added to it is a compile error here until it is listed — and then a test
 * failure until `loam explain` answers it.
 */
const TASK_STEPS: Record<TaskStep, true> = { describe: true, generate: true, implement: true, attested: true };

/** Which term answers each printed word — the aliases as well as the names. */
const ANSWERED_BY: Record<string, string> = {
  stage: "stage",
  missing: "stage",
  blocked: "stage",
  draft: "stage",
  ready: "ready",
  done: "done",
  claim: "claim",
  checklist: "claim",
  confirmed: "claim",
  unconfirmed: "claim",
  unanswered: "claim",
  "service.exists": "service.exists",
  "api.exposes": "api.exposes",
  "event.declares": "event.declares",
  "c4.calls": "c4.calls",
  "scenario.tested": "scenario.tested",
  attested: "attested",
  verified: "verified",
  unverified: "verified",
  verdict: "verified",
  unit: "unit",
  "work packet": "unit",
  frontier: "frontier",
  describe: "describe",
  "requirement.described": "describe",
  generate: "generate",
  implement: "implement",
  coherence: "coherence",
  gates: "coherence",
  maturity: "maturity",
  empty: "maturity",
  partial: "maturity",
  documented: "maturity",
  sourced: "maturity",
  vouched: "vouch",
};

function termOf(subject: string): string | undefined {
  const explanation = explainSubject(subject);
  return explanation?.kind === "term" ? explanation.term : undefined;
}

function paragraphOf(subject: string): string {
  const explanation = explainSubject(subject);
  if (explanation?.kind !== "term") throw new Error(`'${subject}' is not answered as a term`);
  return explanation.paragraph;
}

describe("every closed vocabulary loam prints to a person answers as a term", () => {
  it("the five stage values `loam status` prints", () => {
    for (const stage of ARTIFACT_STATUSES) expect(termOf(stage), stage).toBeDefined();
  });

  it("the claim kinds `loam verify` and `loam tasks` print, and the one unit kind that is not a claim", () => {
    for (const kind of [...CLAIM_KINDS, DESCRIBED_KIND]) expect(termOf(kind), kind).toBeDefined();
  });

  it("the steps a `loam tasks` unit waits at", () => {
    for (const step of Object.keys(TASK_STEPS)) expect(termOf(step), step).toBeDefined();
  });

  it("the verdicts the status row and the fleet scorecard print", () => {
    for (const verdict of VERIFICATION_VERDICTS) expect(termOf(verdict), verdict).toBeDefined();
  });

  it("the maturity rungs `loam list` and the `--all` scorecard print", () => {
    for (const rung of MATURITY_LADDER) expect(termOf(rung), rung).toBeDefined();
  });

  it("each word is answered by the entry that is about it", () => {
    for (const [subject, term] of Object.entries(ANSWERED_BY)) expect(termOf(subject), subject).toBe(term);
  });
});

describe("the two stage words that mislead say what they do NOT mean", () => {
  it("ready: the documents pass, nothing is built or verified", () => {
    const ready = paragraphOf("ready");
    expect(ready).toContain("it does not mean anything is built or verified");
    expect(ready).toContain("the code may not exist yet");
  });

  it("done: an archived feature is done because it is archived, and archive checks no code", () => {
    const done = paragraphOf("done");
    expect(done).toContain("is `done` whatever its record says");
    expect(done).toContain("it checks no code and no evidence");
    expect(done).toContain("`loam archive` will ship an unverified feature.");
  });

  it("the scorecard's rungs and the status row's gate count are spelled out", () => {
    expect(paragraphOf("partial")).toContain("`partial`: some documents, but not the required set");
    expect(paragraphOf("coherence")).toContain("how many stop it");
  });
});

describe("the listing", () => {
  it("groups every term exactly once, in the flat order --json returns", () => {
    const groups = listTermGroups();
    expect(groups.length).toBeGreaterThan(1);
    expect(groups.flatMap((group) => group.terms)).toEqual(listTerms());
    expect(listTerms().map(({ term }) => term)).toEqual(TERMS.map(({ term }) => term));
  });

  it("prints each heading above its own terms, and keeps --json flat", async () => {
    const dir = await unwiredDir();
    const res = await runLoam(dir, "explain");
    expect(res.code, res.out).toBe(0);
    const lines = res.stdout.split("\n");
    for (const { heading, terms } of listTermGroups()) {
      const at = lines.indexOf(heading);
      expect(at, `heading '${heading}' not printed on a line of its own`).toBeGreaterThan(-1);
      terms.forEach(({ term }, i) => {
        expect(lines[at + 1 + i]?.trimStart().startsWith(`${term} `), `${term} under '${heading}'`).toBe(true);
      });
    }

    const json = JSON.parse((await runLoam(dir, "explain", "--json")).stdout);
    for (const row of json.terms) expect(Object.keys(row).sort()).toEqual(["description", "term"]);
    expect(json.terms.map((row: { term: string }) => row.term)).toEqual(TERMS.map(({ term }) => term));
  });
});

describe("the CLI answers the printed words, in a directory with nothing to read", () => {
  it("answers each as a term over --json", async () => {
    const dir = await unwiredDir();
    const subjects = ["ready", "done", "missing", "claim", "scenario.tested", "service.exists"];
    subjects.push("frontier", "implement", "partial", "coherence", "verified");
    for (const subject of subjects) {
      const res = await runLoam(dir, "explain", subject, "--json");
      expect(res.code, `${subject}: ${res.out}`).toBe(0);
      const json = JSON.parse(res.stdout);
      expect(json, subject).toMatchObject({ ok: true, kind: "term", subject, term: ANSWERED_BY[subject] });
    }
  });

  it("says which entry an alias belongs to in the text view", async () => {
    const dir = await unwiredDir();
    const partial = await runLoam(dir, "explain", "partial");
    expect(partial.code, partial.out).toBe(0);
    expect(partial.stdout.split("\n")[0]).toBe("maturity — the entry for 'partial'");
    const ready = await runLoam(dir, "explain", "ready");
    expect(ready.stdout.split("\n")[0]).toBe("ready");
  });
});

describe("a finding page's headers read as words, not as CLI syntax", () => {
  it("names the invocation that reports it, with its severity — never a bracketed flag", async () => {
    const dir = await unwiredDir();
    const res = await runLoam(dir, "explain", "c4.uncovered");
    expect(res.code, res.out).toBe(0);
    expect(res.stdout).toContain("when `loam validate --feature <FEAT-id>` reports it — warn");
    expect(res.stdout).not.toContain("[--");
    expect(res.stdout.split("\n")[0]).toBe("c4.uncovered — a finding code");
  });

  it("leaves the --json scope exactly the table's own label", async () => {
    const dir = await unwiredDir();
    const json = JSON.parse((await runLoam(dir, "explain", "c4.uncovered", "--json")).stdout);
    expect(json.entries.map((entry: { scope: string }) => entry.scope)).toEqual(["--feature <FEAT-id>"]);
  });

  it("puts each severity on its own context instead of joining them on the first line", async () => {
    const dir = await unwiredDir();
    const res = await runLoam(dir, "explain", "service.no-model");
    expect(res.stdout.split("\n")[0]).toBe("service.no-model — a finding code, reported in 2 places");
    expect(res.stdout).not.toContain("(error; warn)");
    expect(res.stdout).toContain("when `loam validate --service <id>` reports it — error");
    expect(res.stdout).toContain("when `loam archive` reports it — warn");
  });

  it("spells a phrase-labelled table as the `loam validate` run it belongs to, keeping the brief's invocation", async () => {
    const dir = await unwiredDir();
    const res = await runLoam(dir, "explain", "frontmatter.malformed");
    expect(res.stdout.split("\n")[0]).toBe("frontmatter.malformed — a finding code; `loam validate --service <id>` reports it");
    expect(res.stdout).toContain("when `loam validate` reports it (frontmatter and provenance) — error");
  });

  it("calls a next-step code a recommendation rather than printing `step` as a severity", async () => {
    const dir = await unwiredDir();
    const res = await runLoam(dir, "explain", "next.archive");
    expect(res.stdout).toContain("when `loam status` suggests it as a next step");
    expect(res.stdout).not.toContain("— step");
  });

  it("only /loam-check introduces a table with a phrase, so reading one as `loam validate` is safe", () => {
    // The text view renders a scope that is neither a flag nor a `loam …`
    // invocation as `loam validate (<phrase>)`. That is only true while every
    // such table is a /loam-check (validate) table; a phrase-introduced table in
    // any other body would be mislabelled, and this is where it would show.
    const checkScopes = new Set(parseFixRows(LOAM_CHECK.body).map((row) => row.scope));
    const named = (scope: string): boolean => scope.startsWith("--") || scope.startsWith("loam ");
    for (const command of COMMANDS) {
      if (command.name === LOAM_CHECK.name) continue;
      for (const row of parseFixRows(command.body)) expect(named(row.scope), `${command.name}: ${row.scope}`).toBe(true);
    }
    const phrases = new Set<string>();
    for (const listing of listCodes()) {
      if (listing.kind !== "finding") continue;
      for (const entry of listing.entries) if (!named(entry.scope)) phrases.add(entry.scope);
    }
    expect(phrases.size, "the probe found no phrase-labelled table at all").toBeGreaterThan(0);
    for (const phrase of phrases) expect(checkScopes.has(phrase), phrase).toBe(true);
  });
});
