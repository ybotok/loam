/**
 * Tests for `loam explain` (src/commands/explain/explain.ts) and the lookup
 * behind it (src/core/explain/).
 *
 * The command's soul is the NO-DRIFT constraint, and that is what most of
 * these pins hold:
 *
 *  - finding-code prose is PARSED at runtime out of the /loam-check fix
 *    tables the binary ships — so the parser probes here are the tripwire
 *    that turns a table reformat into a loud explain failure instead of a
 *    silently empty lookup;
 *  - refusal meanings are compiler-exhaustive over `ErrorCode`
 *    (core/explain/refusals.ts) — tsc pins presence, this file pins that the
 *    lookup resolves them as refusals;
 *  - concept terms are restated paragraphs whose key sentences are pinned
 *    VERBATIM to the agents-md section that teaches them — rewording either
 *    side breaks the pairing here, loudly;
 *  - like `loam instructions`, the command reads nothing: every CLI case
 *    below runs in a bare directory with no loam.json at all.
 */
import { describe, expect, it, afterEach } from "vitest";
import { readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { EXPLAIN_COMMAND } from "../src/core/agent/agents-md/map/explain.js";
import { COMMANDS } from "../src/core/agent/protocol.js";
import { LOAM_CHECK } from "../src/core/agent/workflows/check.js";
import { parseFixRows } from "../src/core/explain/fix-tables.js";
import { explainSubject, knownSubjects, listTerms } from "../src/core/explain/lookup.js";
import { REFUSAL_MEANINGS } from "../src/core/explain/refusals.js";
import { PIN_SOURCE_TEXT, TERMS } from "../src/core/explain/terms.js";
import { VALIDATE_CHECKS } from "../src/core/brief/checks.js";
import { collectEmittedCodes } from "./helpers/stable-codes.js";
import { coherentFixture, makeProject, makeTmpDir, runLoam } from "./helpers/harness.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!();
});

/** A bare directory: no loam.json, no docs repo — the wall is hit before wiring. */
async function unwiredDir(): Promise<string> {
  const dir = await makeTmpDir("loam-explain-");
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

const TERM_NAMES = ["vouch", "attested", "spine", "delta", "axis", "baseline"];

describe("the fix-table parser reads the shipped /loam-check body", () => {
  const rows = parseFixRows(LOAM_CHECK.body);

  it("finds the vocabulary at all — the count floor that convicts a reformat", () => {
    const codes = new Set(rows.flatMap((row) => row.codes));
    expect(codes.size).toBeGreaterThan(120);
  });

  it("reads a plain error row with its scope: spine.op-undefined under --service", () => {
    const row = rows.find((r) => r.codes.includes("spine.op-undefined"));
    expect(row).toBeDefined();
    expect(row!.scope).toBe("--service <id>");
    expect(row!.severityNote).toBe("error");
    expect(row!.meaning).toContain("does not define");
    expect(row!.fix).toContain("broken contract");
  });

  it("reads the feature table: delta.baseline-stale under --feature", () => {
    const row = rows.find((r) => r.codes.includes("delta.baseline-stale"));
    expect(row).toBeDefined();
    expect(row!.scope).toBe("--feature <FEAT-id>");
    expect(row!.fix).toContain("loam rebase");
  });

  it("reads a multi-code row as one shared meaning", () => {
    const row = rows.find((r) => r.codes.includes("delta.requirement-id-invalid"));
    expect(row).toBeDefined();
    expect(row!.codes).toEqual([
      "delta.requirement-id-invalid",
      "delta.requirement-id-repeated",
      "delta.requirement-id-duplicate",
    ]);
  });

  it("keeps the severity parenthetical verbatim — (ok) rows and the long notes included", () => {
    expect(rows.find((r) => r.codes.includes("evidence.checked"))!.severityNote).toBe("ok");
    expect(rows.find((r) => r.codes.includes("openapi.baseline-missing"))!.severityNote).toBe(
      "warn, gates archive; one per service",
    );
    expect(rows.find((r) => r.codes.includes("openapi.ref-unresolved"))!.severityNote).toBe(
      "warn here; error at archive plan time",
    );
  });

  it("keeps every table's scope distinct — the frontmatter and archive tables included", () => {
    expect(rows.find((r) => r.codes.includes("frontmatter.missing"))!.scope).toBe(
      "frontmatter and provenance",
    );
    expect(rows.find((r) => r.codes.includes("living.requirement-outside-requirements"))!.scope).toBe(
      "loam archive",
    );
    expect(rows.find((r) => r.codes.includes("landscape.missing"))!.scope).toBe("--all");
  });

  it("a code graded in two tables keeps both rows: spec.merge-conflict", () => {
    const scopes = rows.filter((r) => r.codes.includes("spec.merge-conflict")).map((r) => r.scope);
    expect(scopes).toEqual(["--service <id>", "--feature <FEAT-id>"]);
  });

  it("walks every workflow body, not only /loam-check: the verify notices resolve", () => {
    // The verify text report prints its notice codes directly above the
    // explain footer, so this family being answerable is what keeps that
    // pointer honest — the rows live in LOAM_VERIFY's own body.
    for (const noticeCode of [
      "verify.claims-open",
      "verify.scenario-attested",
      "verify.digest-contested",
      "verify.operation-contested",
      "verify.record-miscounted",
      "verify.evidence-token-missing",
    ]) {
      const explanation = explainSubject(noticeCode);
      expect(explanation?.kind, noticeCode).toBe("finding");
      if (explanation?.kind === "finding") {
        expect(explanation.entries[0]!.scope, noticeCode).toBe("loam verify");
      }
    }
  });
});

describe("the merged lookup", () => {
  it("resolves every VALIDATE_CHECKS code as a finding, with the brief's via", () => {
    for (const check of VALIDATE_CHECKS) {
      const explanation = explainSubject(check.code);
      expect(explanation?.kind, check.code).toBe("finding");
      if (explanation?.kind === "finding") {
        expect(explanation.via, check.code).toBe(check.via);
        expect(explanation.entries.length, check.code).toBeGreaterThan(0);
      }
    }
  });

  it("resolves every refusal code as a refusal — the union's own keys, so tsc guarantees the set", () => {
    for (const [refusalCode, meaning] of Object.entries(REFUSAL_MEANINGS)) {
      const explanation = explainSubject(refusalCode);
      expect(explanation, refusalCode).toEqual({ kind: "refusal", meaning });
    }
  });

  it("resolves terms by name and by alias, case-insensitively", () => {
    expect(explainSubject("vouch")?.kind).toBe("term");
    const byAlias = explainSubject("attest");
    expect(byAlias?.kind).toBe("term");
    if (byAlias?.kind === "term") expect(byAlias.term).toBe("attested");
    const upper = explainSubject("Spine");
    expect(upper?.kind).toBe("term");
  });

  it("keeps the three families disjoint — resolution order is a tie-break that must never fire", () => {
    // The lookup answers finding tables first, then refusals, then terms; a
    // subject in two families would silently take the earlier answer. No
    // naming convention separates them (`based-on` is a dashed term alias,
    // exactly a refusal code's shape), so disjointness is asserted instead.
    const termNames = new Set(TERMS.flatMap((entry) => [entry.term, ...entry.aliases]));
    const refusalCodes = new Set(Object.keys(REFUSAL_MEANINGS));
    const rowCodes = new Set(COMMANDS.flatMap((command) => parseFixRows(command.body)).flatMap((row) => row.codes));
    for (const name of termNames) {
      expect(refusalCodes.has(name), `term '${name}' collides with a refusal code`).toBe(false);
      expect(rowCodes.has(name), `term '${name}' collides with a finding code`).toBe(false);
    }
    for (const refusalCode of refusalCodes) {
      expect(rowCodes.has(refusalCode), `refusal '${refusalCode}' collides with a finding code`).toBe(false);
    }
  });

  it("answers deterministically, and knownSubjects is sorted for stable suggestions", () => {
    expect(explainSubject("spine.op-undefined")).toEqual(explainSubject("spine.op-undefined"));
    const known = knownSubjects();
    expect(known).toEqual([...known].sort());
    for (const name of TERM_NAMES) expect(known).toContain(name);
    expect(known).toContain("docs-busy");
    expect(known).toContain("spine.op-undefined");
  });

  it("gives every term a first-sentence summary for the listing", () => {
    const terms = listTerms();
    expect(terms.map((t) => t.term)).toEqual(TERM_NAMES);
    for (const { term, summary } of terms) {
      expect(summary.endsWith("."), `${term}'s summary must be one whole sentence`).toBe(true);
      expect(summary.length).toBeLessThan(200);
    }
  });
});

describe("the term pins — the pairing the no-drift constraint requires", () => {
  it("every pin phrase appears verbatim in the paragraph AND in its named agents-md source", () => {
    for (const entry of TERMS) {
      expect(entry.pins.length, `${entry.term} carries no pins`).toBeGreaterThan(0);
      for (const pin of entry.pins) {
        expect(
          entry.paragraph.includes(pin.phrase),
          `${entry.term}: pin phrase not in its own paragraph — "${pin.phrase}"`,
        ).toBe(true);
        expect(
          PIN_SOURCE_TEXT[pin.source].includes(pin.phrase),
          `${entry.term}: pin phrase no longer in ${pin.source} — the docs were reworded; re-pair the paragraph — "${pin.phrase}"`,
        ).toBe(true);
      }
    }
  });
});

describe("every code the footer-carrying surfaces emit is explainable", () => {
  // This scan is what found sources.path-outside, target.ambiguous and the
  // cross.* family unanswerable while the footer below their own output
  // promised a lookup. It reads the `code:` literals of the four source
  // trees whose findings and notices reach validate's and verify's text
  // reports — raw source, comments included, the same NAMED shape the
  // stable-code collector reads — and demands `explainSubject` answers every
  // one, so a new finding code cannot ship with a footer pointing at a
  // refusal.
  const SURFACE_DIRS = [
    "src/commands/validate",
    "src/commands/verify",
    "src/core/provenance",
    "src/core/verify",
  ];

  async function codeLiterals(root: string): Promise<Set<string>> {
    const found = new Set<string>();
    const walk = async (dir: string): Promise<void> => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) await walk(path);
        else if (entry.name.endsWith(".ts")) {
          const src = await readFile(path, "utf8");
          for (const m of src.matchAll(/code: "([a-z][a-z0-9.-]*)"/g)) found.add(m[1]!);
        }
      }
    };
    await walk(root);
    return found;
  }

  it("every code: literal under the validate/verify surfaces resolves", async () => {
    const repo = join(import.meta.dirname, "..");
    const codes = new Set<string>();
    for (const dir of SURFACE_DIRS) for (const c of await codeLiterals(join(repo, dir))) codes.add(c);
    // The scan proves itself on the codes this pin was added for — a regex
    // that stops matching must fail here, not shrink the guarded set.
    for (const probe of ["target.ambiguous", "sources.path-outside", "cross.disagree", "verify.claims-open"]) {
      expect(codes.has(probe), `surface scan lost ${probe}`).toBe(true);
    }
    const unanswerable = [...codes].filter((surfaceCode) => explainSubject(surfaceCode) === null).sort();
    expect(
      unanswerable,
      `code(s) the validate/verify surfaces emit that \`loam explain\` refuses:\n  ${unanswerable.join("\n  ")}\n` +
        "Add each one's row to a fix table (workflows/check.ts or closing.ts) — the text footer promises this lookup.",
    ).toEqual([]);
  });
});

describe("the hand-listed rosters cannot trail their registries", () => {
  it("the AGENTS.md explain section names every concept term", () => {
    // map/explain.ts cannot import TERMS (package cycle: terms.ts reads its
    // pin sources from that package's siblings), so the list is hand-written
    // and this is the pin that keeps it current.
    for (const { term } of TERMS) {
      expect(EXPLAIN_COMMAND, `AGENTS.md explain section is missing the term '${term}'`).toContain(term);
    }
  });
});

describe("the stable-code collector is neither confused nor enlarged", () => {
  it("still resolves every emitter, and the one explain refusal is spelled where it can see it", async () => {
    // collectEmittedCodes THROWS on any call site it cannot read — the
    // registry's parsed prose and record keys must not become emitter shapes.
    const codes = await collectEmittedCodes();
    expect(codes.has("unknown-target")).toBe(true);
    expect(codes.size).toBeGreaterThan(40);
  });
});

describe("the CLI, in a directory with nothing to read", () => {
  it("explains a finding code, machine shape first", async () => {
    const dir = await unwiredDir();
    const res = await runLoam(dir, "explain", "spine.op-undefined", "--json");
    expect(res.code, res.out).toBe(0);
    const json = JSON.parse(res.stdout);
    expect(json).toMatchObject({ ok: true, command: "explain", subject: "spine.op-undefined", kind: "finding" });
    expect(json.via).toContain("loam validate --service");
    expect(json.entries).toHaveLength(1);
    expect(json.entries[0].meaning).toContain("does not define");
    expect(json.entries[0].fix.length).toBeGreaterThan(0);
    expect(json.entries[0].severityNote).toBe("error");
  });

  it("prints the same row as text, under the table's own column names", async () => {
    const dir = await unwiredDir();
    const res = await runLoam(dir, "explain", "spine.op-undefined");
    expect(res.code, res.out).toBe(0);
    expect(res.out).toContain("spine.op-undefined (error)");
    expect(res.out).toContain("what it means:");
    expect(res.out).toContain("what to do:");
  });

  it("explains a code graded in two tables with both contexts", async () => {
    const dir = await unwiredDir();
    const res = await runLoam(dir, "explain", "spec.merge-conflict", "--json");
    expect(res.code, res.out).toBe(0);
    const json = JSON.parse(res.stdout);
    expect(json.entries).toHaveLength(2);
    expect(json.entries.map((e: { scope: string }) => e.scope)).toEqual(["--service <id>", "--feature <FEAT-id>"]);
  });

  it("explains a refusal code", async () => {
    const dir = await unwiredDir();
    const res = await runLoam(dir, "explain", "docs-busy", "--json");
    expect(res.code, res.out).toBe(0);
    const json = JSON.parse(res.stdout);
    expect(json).toMatchObject({ ok: true, kind: "refusal", subject: "docs-busy" });
    expect(json.meaning).toContain("lock");
  });

  it("explains a term, and an alias resolves to it", async () => {
    const dir = await unwiredDir();
    const vouch = await runLoam(dir, "explain", "vouch");
    expect(vouch.code, vouch.out).toBe(0);
    expect(vouch.out).toContain("not yours to run");

    const attested = await runLoam(dir, "explain", "attest", "--json");
    expect(attested.code, attested.out).toBe(0);
    const json = JSON.parse(attested.stdout);
    expect(json).toMatchObject({ kind: "term", term: "attested" });
    expect(json.paragraph).toContain("**attested**, not verified");

    const baseline = await runLoam(dir, "explain", "based-on", "--json");
    expect(baseline.code, baseline.out).toBe(0);
    expect(JSON.parse(baseline.stdout).term).toBe("baseline");
  });

  it("lists the six terms when asked for nothing", async () => {
    const dir = await unwiredDir();
    const res = await runLoam(dir, "explain");
    expect(res.code, res.out).toBe(0);
    for (const name of TERM_NAMES) expect(res.out).toContain(name);

    const json = await runLoam(dir, "explain", "--json");
    expect(json.code).toBe(0);
    const terms = JSON.parse(json.stdout).terms;
    expect(terms.map((t: { term: string }) => t.term)).toEqual(TERM_NAMES);
    for (const t of terms) expect(t.description.length).toBeGreaterThan(0);
  });

  it("refuses an unknown subject with close matches, never an empty success", async () => {
    const dir = await unwiredDir();
    const res = await runLoam(dir, "explain", "spine.op-undefine", "--json");
    expect(res.code).toBe(1);
    const json = JSON.parse(res.stdout);
    expect(json).toMatchObject({ ok: false, error: { code: "unknown-target" } });
    expect(json.error.message).toContain("spine.op-undefined");

    const term = await runLoam(dir, "explain", "vouc", "--json");
    expect(term.code).toBe(1);
    expect(JSON.parse(term.stdout).error.message).toContain("vouch");
  });

  it("reads nothing — the same directory refuses `loam list` with no-config", async () => {
    const dir = await unwiredDir();
    const wired = await runLoam(dir, "list", "--json");
    expect(wired.code).toBe(1);
    expect(JSON.parse(wired.stdout).error.code).toBe("no-config");
    // …and explain answers anyway: the vocabulary wall is hit before wiring.
    const res = await runLoam(dir, "explain", "no-config");
    expect(res.code, res.out).toBe(0);
    expect(res.out).toContain("loam init");
  });
});

describe("the text footers point at the vocabulary", () => {
  it("validate: printed under findings, absent from --json byte for byte", async () => {
    const project = await makeProject(coherentFixture());
    cleanups.push(() => project.destroy());
    const text = await runLoam(project.workDir, "validate", "--service", "ghost-service");
    expect(text.code).toBe(1);
    // Text mode prints the finding's MESSAGE (the code rides in --json), so
    // the pointer must follow the message without claiming a code was shown.
    expect(text.out).toContain("No service directory");
    expect(text.out).toContain("loam explain");

    const json = await runLoam(project.workDir, "validate", "--service", "ghost-service", "--json");
    expect(json.stdout).not.toContain("loam explain");
  });

  it("verify: printed under notices, absent from --json", async () => {
    const project = await makeProject(coherentFixture());
    cleanups.push(() => project.destroy());

    // A record whose claims stay open is the cheapest notice-bearing state:
    // answer every derived claim `unconfirmed`, record, and the read view
    // then carries verify.claims-open (and the attested notice family).
    const checklist = await runLoam(project.workDir, "verify", "FEAT-1", "--json");
    expect(checklist.code, checklist.out).toBe(0);
    const claims = JSON.parse(checklist.stdout).claims as Array<{ id: string }>;
    expect(claims.length).toBeGreaterThan(0);
    const answersPath = join(project.workDir, "answers.json");
    await writeFile(
      answersPath,
      JSON.stringify(claims.map(({ id }) => ({ id, verdict: "unconfirmed", note: "not built yet" }))),
      "utf8",
    );
    const record = await runLoam(project.workDir, "verify", "FEAT-1", "--record", answersPath);
    expect(record.code, record.out).toBe(0);

    const text = await runLoam(project.workDir, "verify", "FEAT-1");
    expect(text.out).toContain("verify.claims-open");
    // APPENDED, as the format.ts comment promises: the pointer is the
    // report's last non-empty line, never a wedge between the notices and
    // the recording instructions.
    const lines = text.stdout.split("\n").filter((line) => line.trim() !== "");
    expect(lines.at(-1)).toContain("loam explain");

    const json = await runLoam(project.workDir, "verify", "FEAT-1", "--json");
    expect(json.stdout).not.toContain("loam explain");
  });
});
