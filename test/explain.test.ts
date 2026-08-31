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
 *  - the four families no fix table anywhere grades — `doctor.*`, `next.*`,
 *    `diff.*`, `gate.*` — are answered from a hand-written registry
 *    (core/explain/families.ts), which nothing can parse-check; what IS
 *    checkable is that it never answers a code a table already answers, and
 *    that is asserted below;
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
import { JSON_CONTRACT_VERSION, NO_EXPLAIN_POINTER, type ErrorCode } from "../src/core/envelope/json.js";
import { LOAM_VERSION } from "../src/core/envelope/version.js";
import { COMMANDS } from "../src/core/agent/protocol.js";
import { LOAM_CHECK } from "../src/core/agent/workflows/check.js";
import { familyCodes, familyFinding } from "../src/core/explain/families.js";
import { parseFixRows } from "../src/core/explain/fix-tables.js";
import { explainSubject, knownSubjects, listCodes, listTerms } from "../src/core/explain/lookup.js";
import { REFUSAL_MEANINGS } from "../src/core/explain/refusals.js";
import { PIN_SOURCE_TEXT, TERMS } from "../src/core/explain/terms.js";
import { VALIDATE_CHECKS } from "../src/core/brief/checks.js";
import { collectEmittedCodes, collectStableCodes } from "./helpers/stable-codes.js";
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

/**
 * Codes `loam explain --codes` cannot list yet: no fix table grades them, no
 * family registry answers them and no refusal row names them, so
 * `explainSubject` refuses them too.
 *
 * This is a BACKLOG WITH A NAMED OWNER, never a permanent exemption. The owner
 * is the agent-docs axis (src/core/agent/agents-md/): the generated AGENTS.md
 * still carries a per-command code inventory in prose, and it cannot shed that
 * inventory until every code it names is answerable from the binary — which is
 * this list, emptied. The assertion below fails on anything emitted and
 * unlisted that is NOT written here, and equally on an entry that has since
 * earned a row, so the list can only shrink.
 *
 * It held 116 codes. Sixty-five of them — the whole of `doctor.*`, `next.*`,
 * `diff.*` and `gate.*` — were discharged by src/core/explain/families.ts,
 * whose header records why a hand-written registry is not the duplication
 * fix-tables.ts forbids. Fifty-one are left: the 49-code OpenSpec migration
 * surface, with the sharpened reason below, and the two `ok`-severity
 * confirmations at the end.
 *
 * Spelled out code by code rather than matched by a prefix or a wildcard. An
 * `openspec.*` filter would absorb the next `openspec.` code somebody adds
 * without a word of prose, which is exactly the drift the list exists to make
 * visible — the same argument test/codes-drift.test.ts makes for its own
 * roster, and the reason the 65 discharged codes had to be deleted one line at
 * a time rather than by dropping four filters.
 */
const INTENTIONALLY_UNLISTED: readonly string[] = [
  // The OpenSpec migration surface — `mapping.*` grades the mapping file that
  // drives an import, `openspec.*` grades the FOREIGN repository being read.
  //
  // The reason this entry gives has been REPLACED, because the old one stopped
  // applying. It said a migration diagnostic in /loam-check's tables would
  // teach a check that only ever runs once — an argument about fix tables, and
  // the four families above it were lifted out of this list into
  // src/core/explain/families.ts, a registry that is not a fix table at all.
  // The same move is available to these 49 codes, so leaving them here now
  // needs a reason about the REGISTRY:
  //
  // They are the only codes in the vocabulary whose subject is not a loam
  // document. `openspec.*` grades a repository still in another tool's shape,
  // and `mapping.*` grades a decision file that exists for the duration of one
  // import and is then deleted — so a lookup adds nothing their emitters do not
  // already carry (each names the artifact and, where there is one, the line),
  // and the commands that print them, `loam audit-openspec` and `loam
  // migrate-openspec`, run before a repository has a governed loop to look
  // codes up from. Covering them is typing rather than judgement, and it is
  // typing that does not fit: families.ts already spends most of a 400-line
  // file on 65 codes, and src/core/explain/ is at its five-file cap, so the 49
  // would need a package of their own — which is the right shape for this axis
  // to take when somebody actually runs an import, and the wrong one to build
  // speculatively for a command most repositories never run.
  "mapping.change-title-missing",
  "mapping.feature-id-duplicate",
  "mapping.feature-id-invalid",
  "mapping.invalid-artifact-disposition",
  "mapping.invalid-requirement-id",
  "mapping.rename-chain",
  "mapping.rename-double-source",
  "mapping.rename-double-target",
  "mapping.rename-existing-id-conflict",
  "mapping.rename-id-conflict",
  "mapping.rename-source-ambiguous",
  "mapping.rename-source-id-invalid",
  "mapping.rename-source-missing",
  "mapping.rename-target-conflict",
  "mapping.requirement-allocation-missing",
  "mapping.requirement-service-unknown",
  "mapping.service-allocation-empty",
  "mapping.source-digest-mismatch",
  "mapping.source-missing",
  "mapping.source-root-mismatch",
  "mapping.unknown-artifact",
  "mapping.unknown-capability",
  "mapping.unknown-change",
  "mapping.unknown-rename",
  "mapping.unknown-requirement",
  "openspec.change-empty",
  "openspec.change-metadata-invalid",
  "openspec.change-no-specs",
  "openspec.change-quoted-requirements",
  "openspec.change-requirements-outside-delta-sections",
  "openspec.change-schema-unresolved",
  "openspec.change-without-delta-sections",
  "openspec.config-invalid",
  "openspec.external-store-pointer",
  "openspec.hidden-change-directory",
  "openspec.living-delta-section",
  "openspec.living-empty",
  "openspec.living-requirements-outside-section",
  "openspec.non-utf8-artifact",
  "openspec.nonstandard-change-spec",
  "openspec.nonstandard-living-spec",
  "openspec.renamed-malformed",
  "openspec.requirement-id-duplicate",
  "openspec.requirement-id-invalid",
  "openspec.requirement-id-repeated",
  "openspec.skip-specs-with-specs",
  "openspec.specs-missing",
  "openspec.symlink-unsupported",
  "openspec.workspace-empty",
  // Two `ok`-severity confirmations, whose "what to do" column is empty by
  // construction, so nobody wrote the row. Their failing twins
  // (`archedge.uncovered`, `gherkin.stale`) are listed, which is what makes
  // these two visible as an omission rather than a category.
  //
  // `gherkin.path-outside` used to sit here as the third entry. It is not a
  // confirmation — it is a REFUSAL, the one non-`ok` code in this list, and it
  // left `loam validate`'s new code column pointing at an explanation that did
  // not exist. It now has a fix-table row like every other finding.
  "archedge.covered",
  "gherkin.current",
];

describe("the code inventory `--codes` answers", () => {
  it("lists every code loam emits, or names it in the backlog above", async () => {
    // The coverage obligation the whole flag exists for: a caller building a
    // code-to-fix cache from `--codes` must not be handed a set that quietly
    // omits a family. `collectStableCodes` is the same static scan
    // test/codes-drift.test.ts grades the docs with, so the two guards measure
    // the same emitted vocabulary.
    const { codes } = await collectStableCodes();
    const listed = new Set(listCodes().map(({ code }) => code));
    const missing = [...codes].filter((code) => !listed.has(code) && !INTENTIONALLY_UNLISTED.includes(code)).sort();
    expect(
      missing,
      `code(s) loam emits that \`loam explain --codes\` does not list:\n  ${missing.join("\n  ")}\n` +
        "Give each one a fix table row (src/core/agent/workflows/) if a /loam-check scope grades it, " +
        "or a src/core/explain/families.ts entry if no table anywhere does, " +
        "or add it to INTENTIONALLY_UNLISTED with the family's reason.",
    ).toEqual([]);
  });

  it("the backlog can only shrink — a listed or retired entry is stale", async () => {
    const { codes } = await collectStableCodes();
    const listed = new Set(listCodes().map(({ code }) => code));
    const stale = INTENTIONALLY_UNLISTED.filter((code) => listed.has(code) || !codes.has(code)).sort();
    expect(
      stale,
      `INTENTIONALLY_UNLISTED entr(ies) that no longer belong there:\n  ${stale.join("\n  ")}\n` +
        "Each is either explainable now (delete the line — that is the axis finishing) or no longer emitted at all.",
    ).toEqual([]);
  });

  it("resolves every code it lists, with the per-code answer verbatim", () => {
    // The shape claim: `--codes` rows ARE `explain <code> --json` payloads with
    // a `code` key added, not a second contract that can drift from the first.
    for (const listing of listCodes()) {
      const { code, ...payload } = listing;
      expect(payload, code).toEqual(explainSubject(code));
    }
  });

  it("keeps the concept terms out — they are a different kind of subject", () => {
    // The bare `loam explain` listing owns the terms, and a term is not a code
    // an agent branches on; `--codes` promising to enumerate the machine
    // vocabulary must not quietly mix the two families.
    const listed = new Set(listCodes().map(({ code }) => code));
    for (const entry of TERMS) {
      expect(listed.has(entry.term), `term '${entry.term}' leaked into the code listing`).toBe(false);
      for (const alias of entry.aliases) {
        expect(listed.has(alias), `alias '${alias}' leaked into the code listing`).toBe(false);
      }
    }
    for (const name of TERM_NAMES) expect(listed.has(name)).toBe(false);
  });

  it("carries no derived severity — gatesArchive() owns that answer", () => {
    // core/vocabulary/issue.ts computes gating from a per-issue `severity`,
    // an optional `gates`, and a never-overridable code set. The fix tables
    // carry only a scope's verbatim parenthetical, so a severity synthesized
    // here would be a second answer free to disagree with the binary's gate.
    for (const listing of listCodes()) {
      const keys = Object.keys(listing).sort();
      const expected = listing.kind === "finding" ? ["code", "entries", "kind"] : ["code", "kind", "meaning"];
      expect(keys.filter((key) => key !== "via"), listing.code).toEqual(expected);
    }
  });
});

describe("the family registry answers what no fix table reaches, and only that", () => {
  const registry = familyCodes();

  it("holds no code a fix table already answers — the two sources must not be able to disagree", () => {
    // The failure fix-tables.ts's header is about, in the one form it can still
    // take here. A fix table is PARSED out of the bytes the binary ships;
    // families.ts is written by hand. A code in both would have two answers
    // free to drift apart, and the lookup would silently print whichever one
    // `findingFor` happened to try first — a difference no reader could see.
    const tableCodes = new Set(
      COMMANDS.flatMap((command) => parseFixRows(command.body)).flatMap((row) => row.codes),
    );
    const shadowed = registry.filter((code) => tableCodes.has(code)).sort();
    expect(
      shadowed,
      `family-registry code(s) a fix table already grades:\n  ${shadowed.join("\n  ")}\n` +
        "The table wins — delete the registry entry (src/core/explain/families.ts) rather than keeping " +
        "a second answer the lookup will never print.",
    ).toEqual([]);
  });

  it("stays disjoint from the refusal codes and the concept terms too", () => {
    // The same disjointness the three original families are held to, extended
    // to the fourth source. `familyFinding` is tried before REFUSAL_MEANINGS,
    // so a collision here would shadow a refusal rather than be shadowed by it.
    const refusalCodes = new Set(Object.keys(REFUSAL_MEANINGS));
    const termNames = new Set(TERMS.flatMap((entry) => [entry.term, ...entry.aliases]));
    for (const code of registry) {
      expect(refusalCodes.has(code), `family code '${code}' collides with a refusal code`).toBe(false);
      expect(termNames.has(code), `family code '${code}' collides with a concept term`).toBe(false);
    }
  });

  it("covers exactly the four families it claims, and every row carries both columns", () => {
    // The count is the measurement this axis was written against: 116
    // unanswerable codes, 65 of them here. A family that silently loses codes
    // — or grows one from a fifth prefix nobody decided to cover — fails here
    // rather than by leaving `explain` quietly refusing again.
    const byFamily = (prefix: string): string[] => registry.filter((code) => code.startsWith(prefix));
    expect(byFamily("doctor.")).toHaveLength(21);
    expect(byFamily("next.")).toHaveLength(26);
    expect(byFamily("diff.")).toHaveLength(14);
    expect(byFamily("gate.")).toHaveLength(4);
    expect(registry).toHaveLength(65);
    for (const code of registry) {
      const entry = familyFinding(code)!;
      expect(entry.scope.startsWith("loam "), `${code}'s scope must name the invocation that emits it`).toBe(true);
      expect(entry.severityNote.length, `${code} carries no severity note`).toBeGreaterThan(0);
      expect(entry.meaning.length, `${code} carries no meaning`).toBeGreaterThan(0);
      // Unlike a fix table, whose `(ok)` rows legitimately have an empty "what
      // to do" cell, every row here was written because somebody had to decide
      // what to say — including the `next.*` rows, whose answer is that the
      // step's own command IS the action. An empty string there would be the
      // renderer silently dropping the column instead of saying so.
      expect(entry.fix.length, `${code} carries no fix`).toBeGreaterThan(0);
    }
  });

  it("is what `explain` answers those codes from — the same envelope, not a second one", () => {
    for (const code of registry) {
      const explanation = explainSubject(code);
      expect(explanation?.kind, code).toBe("finding");
      if (explanation?.kind === "finding") {
        expect(explanation.entries, code).toEqual([familyFinding(code)]);
        // `via` is a fix-table fact (a VALIDATE_CHECKS entry's invocation
        // string); a registry answer must not invent one.
        expect(explanation.via, code).toBeUndefined();
      }
    }
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

  it("--codes enumerates the vocabulary, and each row is the per-code payload", async () => {
    const dir = await unwiredDir();
    const res = await runLoam(dir, "explain", "--codes", "--json");
    expect(res.code, res.out).toBe(0);
    const json = JSON.parse(res.stdout);
    expect(json).toMatchObject({ ok: true, command: "explain" });
    const codes = json.codes as Array<Record<string, unknown>>;
    expect(codes.length).toBeGreaterThan(250);

    // The verbatim-reuse claim, proven across the process boundary: the row
    // for a code equals what asking for that one code alone returns.
    const one = JSON.parse((await runLoam(dir, "explain", "spine.op-undefined", "--json")).stdout);
    const row = codes.find((entry) => entry.code === "spine.op-undefined")!;
    expect(row.kind).toBe("finding");
    expect(row.entries).toEqual(one.entries);
    expect(row.via).toEqual(one.via);

    const refusal = codes.find((entry) => entry.code === "docs-busy")!;
    expect(refusal.kind).toBe("refusal");
    expect(refusal.meaning).toContain("lock");
    // No severity/gates key — the reason is in CodeListing's comment.
    expect(Object.keys(refusal).sort()).toEqual(["code", "kind", "meaning"]);

    // Both kinds are present, and the terms are not.
    expect(codes.some((entry) => entry.kind === "finding")).toBe(true);
    expect(codes.some((entry) => entry.kind === "refusal")).toBe(true);
    expect(codes.some((entry) => entry.code === "vouch")).toBe(false);
  });

  it("--codes prints a scannable listing grouped by kind", async () => {
    const dir = await unwiredDir();
    const res = await runLoam(dir, "explain", "--codes");
    expect(res.code, res.out).toBe(0);
    expect(res.out).toContain("finding codes");
    expect(res.out).toContain("refusal codes");
    const lines = res.stdout.split("\n");
    const row = lines.find((line) => line.startsWith("  spine.op-undefined "));
    expect(row).toBeDefined();
    // A fragment short enough to survive the SUMMARY_WIDTH cut the assertion
    // below insists on. The gloss reads "a landscape edge calls an operation
    // this service's OpenAPI does not define" and the row is truncated inside
    // that final clause — asserting the tail would be asserting that the
    // listing is NOT the scannable one this test exists to pin.
    expect(row).toContain("a landscape edge calls an operation");
    const docsBusy = lines.find((line) => line.startsWith("  docs-busy "));
    expect(docsBusy).toBeDefined();
    // Scannable means one code per line: a padded code column plus a gloss cut
    // at SUMMARY_WIDTH, never a wrapped paragraph. The bound is loose enough to
    // survive a longer code joining the vocabulary (which widens every row) and
    // tight enough to convict the 377-character first sentences printed whole.
    for (const line of lines) expect(line.length, line).toBeLessThan(140);
  });

  it("--codes takes no subject, and stays off by default", async () => {
    const dir = await unwiredDir();
    const both = await runLoam(dir, "explain", "spine.op-undefined", "--codes", "--json");
    expect(both.code).toBe(1);
    expect(JSON.parse(both.stdout)).toMatchObject({ ok: false, error: { code: "invalid-option" } });

    // The flag is opt-in, so the default output is what it always was: the
    // bare listing carries terms and no `codes` key at all.
    const bare = await runLoam(dir, "explain", "--json");
    expect(bare.code).toBe(0);
    expect(Object.keys(JSON.parse(bare.stdout))).not.toContain("codes");
    const single = await runLoam(dir, "explain", "docs-busy", "--json");
    expect(Object.keys(JSON.parse(single.stdout))).not.toContain("codes");
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

/**
 * The other half of the same promise: a REFUSAL now names its code and the
 * command that explains it.
 *
 * Measured before this existed: of eight wrong invocations a person makes in
 * their first hour, all eight printed prose and no code, and only `loam
 * validate` mentioned `loam explain` at all — so the two refusals that most
 * needed the lookup (`invalid-option`, `already-exists`) were the two with no
 * way to name it. What is pinned here is not the wording but the contract the
 * line makes: the code it prints is one this same binary can answer, and the
 * `--json` stdout beside it did not move by a byte.
 */
describe("a refusal names its own code, and the name resolves", () => {
  it("prints the code and its lookup on stderr, and that lookup answers", async () => {
    const dir = await unwiredDir();
    const res = await runLoam(dir, "status");
    expect(res.code).toBe(1);
    expect(res.stderr.split("\n").at(-1)).toBe("no-config  ·  loam explain no-config");
    // The line is only worth printing if it lands. Run what it literally says
    // to run: a pointer to an explanation that does not exist is worse than
    // printing nothing.
    const explained = await runLoam(dir, "explain", "no-config");
    expect(explained.code, explained.out).toBe(0);
    expect(explained.out).toContain("loam init");
  });

  it("keeps `--json` stdout byte-identical — the pointer is a stderr line and nothing else moved", async () => {
    const dir = await unwiredDir();
    const res = await runLoam(dir, "status", "--json");
    expect(res.code).toBe(1);
    // The whole envelope spelled out, not a `toMatchObject`: a pointer that
    // leaked into the payload — an extra key, a changed message, a trailing
    // line — fails here rather than in whatever pipeline consumes it.
    expect(res.stdout).toBe(
      JSON.stringify(
        {
          contractVersion: JSON_CONTRACT_VERSION,
          version: LOAM_VERSION,
          ok: false,
          error: { code: "no-config", message: "No loam.json found. Run `loam init --docs <dir>` first." },
        },
        null,
        2,
      ),
    );
    expect(res.stderr).toBe("");
  });

  it("reaches the refusals that bypass fail() — archive's gate and delta's no-service arm", async () => {
    // These two print a headline, a list and a closing sentence rather than
    // the one message `fail()` takes, so they had to ask for the pointer
    // explicitly. The code they name is the one their own `--json` branch
    // emits: a reader who switches modes to find the code must not be handed a
    // different answer than the one they just saw.
    const project = await makeProject(coherentFixture());
    cleanups.push(() => project.destroy());
    // A per-service delta addressed to a service that exists nowhere: the gate
    // refuses it by hand, with the multi-line BLOCKED shape only these arms
    // print — asserted, so a fixture that started refusing somewhere else
    // would stop silently claiming to cover this path.
    await project.write(
      "features/FEAT-1-split/specs/ghost-svc/spec.md",
      await project.read("features/FEAT-1-split/specs/payment-split-service/spec.md"),
    );
    const archive = await runLoam(project.workDir, "archive", "FEAT-1", "--dry-run");
    expect(archive.code, archive.out).toBe(1);
    expect(archive.stderr).toContain("BLOCKED:");
    const archiveJson = await runLoam(project.workDir, "archive", "FEAT-1", "--dry-run", "--json");
    const archiveCode = JSON.parse(archiveJson.stdout).error.code;
    expect(archive.stderr.split("\n").at(-1)).toBe(`${archiveCode}  ·  loam explain ${archiveCode}`);

    // loam.json names no service and `--service` was not passed, so delta
    // refuses by hand too — the arm exists because its envelope carries the
    // feature's own service list as data, which `fail()` has no room for.
    const delta = await runLoam(project.workDir, "delta", "FEAT-1");
    expect(delta.code, delta.out).toBe(1);
    expect(delta.stderr).toContain("No service to project FEAT-1 onto");
    const deltaJson = await runLoam(project.workDir, "delta", "FEAT-1", "--json");
    const deltaCode = JSON.parse(deltaJson.stdout).error.code;
    expect(delta.stderr.split("\n").at(-1)).toBe(`${deltaCode}  ·  loam explain ${deltaCode}`);
  });

  it("every refusal that prints a pointer has something to point at", () => {
    // The static half of the CLI pin above, over the whole union rather than
    // the handful a test can provoke. `REFUSAL_MEANINGS` is exhaustive over
    // `ErrorCode` by construction (tsc holds that), so this walks every code
    // `fail()` can ever be handed.
    for (const code of Object.keys(REFUSAL_MEANINGS)) {
      if (NO_EXPLAIN_POINTER.has(code as ErrorCode)) continue;
      expect(explainSubject(code), `refusal '${code}' prints a pointer nothing answers`).not.toBeNull();
    }
  });

  it("the skip set holds only refusals that are not errors to look up", () => {
    // One named set, pinned by membership: an entry added here silently
    // removes a pointer, and a removed pointer is the kind of regression
    // nobody notices because the output simply gets shorter.
    expect([...NO_EXPLAIN_POINTER]).toEqual(["vouch-declined"]);
    for (const code of NO_EXPLAIN_POINTER) expect(Object.keys(REFUSAL_MEANINGS)).toContain(code);
  });
});

describe("every string the text view prints as a code is one `loam explain` answers", () => {
  /** `  (some.code)` at the end of a finding line — the shape validate appends, and nothing else. */
  const TRAILING_CODE = /\s\s\(([a-z][a-z0-9-]*\.[a-z0-9.-]+)\)$/;

  it("swept off real reports, not off the table the renderer reads", async () => {
    const project = await makeProject(coherentFixture());
    cleanups.push(() => project.destroy());
    const runs = [
      await runLoam(project.workDir, "validate", "--service", "ghost-service"),
      await runLoam(project.workDir, "validate", "--all"),
    ];
    const printed = new Set<string>();
    for (const run of runs) {
      for (const line of run.stdout.split("\n")) {
        const match = TRAILING_CODE.exec(line);
        if (match !== null) printed.add(match[1]!);
      }
    }
    // The sweep proves itself before it proves anything else: a regex that
    // stops matching must fail here rather than quietly guard an empty set.
    expect(printed.has("service.unknown"), `sweep found only: ${[...printed].join(", ")}`).toBe(true);
    for (const code of printed) {
      expect(explainSubject(code), `the text report prints (${code}) and \`loam explain\` refuses it`).not.toBeNull();
    }
  });

  it("leaves the `ok` confirmations clean — a passing check has nothing to look up", async () => {
    // The signal-to-noise half. A clean fleet run is several hundred ✓ lines
    // and two warnings; a code on every one of them costs exactly the contrast
    // the exceptions are read for.
    const project = await makeProject(coherentFixture());
    cleanups.push(() => project.destroy());
    const res = await runLoam(project.workDir, "validate", "--all");
    const confirmations = res.stdout.split("\n").filter((line) => line.trimStart().startsWith("✓"));
    expect(confirmations.length).toBeGreaterThan(0);
    for (const line of confirmations) expect(line, line).not.toMatch(TRAILING_CODE);
  });
});
