/**
 * Drift guard: every stable code loam emits must appear in the agent-facing
 * docs — the AGENTS.md template and the slash commands `loam init` lays down
 * (src/core/agent/agents-md/ and src/core/agent/workflows/).
 *
 * The codes are the machine contract: prose may change, codes may not, and an
 * agent branches on them. A code that ships undocumented is a branch nobody was
 * told about — the delta-shape and coherence waves added ten of them before
 * this test existed, and the /loam-check table never noticed.
 *
 * The collection machinery lives in test/helpers/stable-codes.ts (it also
 * grades the PUBLIC packaged docs in test/docs-facts.test.ts); the rules of
 * what counts as an emitted code are documented there and are this guard's
 * contract. This file keeps the assertions: documented means BACKTICKED in the
 * docs, the way every code is quoted there — a plain substring match would let
 * prose coincidences ("internal consistency") vouch for the `internal` error
 * code.
 */
import { describe, expect, it } from "vitest";
import { AGENTS_MD } from "../src/core/agent/agents-md.js";
import { PROTOCOLS } from "../src/core/agent/protocol.js";
import { collectStableCodes } from "./helpers/stable-codes.js";

/**
 * Codes deliberately kept out of the docs. Empty today: everything loam emits
 * is agent-facing, including the `ok`-severity confirmations — they arrive in
 * the same findings[] an agent branches on, so AGENTS.md names them. Add a
 * code here only with a reason beside it, never by loosening the patterns.
 */
const INTENTIONALLY_UNDOCUMENTED: string[] = [];

/**
 * The agent-facing corpus: AGENTS.md plus every workflow protocol.
 *
 * `PROTOCOLS`, not `SLASH_COMMANDS`: the generated file is a pointer at
 * `loam instructions`, and the codes live in the protocol it points at. Reading
 * the pointer here would grade the whole vocabulary as undocumented while every
 * code was in fact one command away.
 */
const DOCS = AGENTS_MD + Object.values(PROTOCOLS).join("\n");

describe("the code vocabulary does not drift from the docs", () => {
  it("every stable code emitted in src/ is documented, backticked, in AGENTS.md or a slash command", async () => {
    const { codes } = await collectStableCodes();
    const missing = [...codes]
      .filter((c) => !INTENTIONALLY_UNDOCUMENTED.includes(c))
      .filter((c) => !DOCS.includes(`\`${c}\``))
      .sort();
    expect(
      missing,
      `undocumented stable code(s):\n  ${missing.join("\n  ")}\n` +
        "Document each in AGENTS_MD (src/core/agent/agents-md/) or the /loam-check table (src/core/agent/workflows/check.ts), " +
        "or add it to INTENTIONALLY_UNDOCUMENTED with a reason.",
    ).toEqual([]);
  });

  it("no emitter hands a code this collector cannot read", async () => {
    // The invariant that makes the one above mean something. A code passed as a
    // variable, a template literal or a computed expression is invisible to
    // every pattern here, so it would silently leave the guarded set — which is
    // how the whole `openspec.*` family drifted. Spell the code as a literal at
    // the call site (the house rule) or list it here with a reason.
    const { unresolved } = await collectStableCodes();
    expect(
      unresolved,
      `emitter call site(s) whose code slot is not a string literal:\n  ${unresolved.join("\n  ")}\n` +
        "Spell the code literally at the call site so the drift guard can see it.",
    ).toEqual([]);
  });

  it("the collector actually collects — every pattern proves itself on a known code", async () => {
    // One probe per collection pattern; a refactor that changes how codes are
    // constructed must fail HERE, not silently shrink the guarded set.
    const { codes } = await collectStableCodes();
    for (const probe of [
      "delta.no-delta-sections", // `code:` literal — in delta.ts, whose NUL-byte key separator defeats grep but not readFile
      "delta.modified-pending", // ternary arm
      "sources.unverifiable-from-here", // exists only as a text marker in validate.ts
      "rollback-incomplete", // ErrorCode union member
      "internal", // union member with neither dot nor dash
      "delta.nothing-tagged", // coherence emission not (yet) in the IssueCode union
      // The positional family. `issue(target, scope, code, path, message)` in
      // openspec/scan/shape.ts spells the word `code` only in its signature, so
      // these three exist for this test ONLY through argument resolution — and
      // openspec.requirement-id-* went undocumented for exactly that reason.
      "openspec.living-empty",
      "openspec.requirement-id-duplicate",
      "openspec.symlink-unsupported",
    ]) {
      expect(codes.has(probe), `collector lost ${probe}`).toBe(true);
    }
    expect(codes.size).toBeGreaterThan(40);
  });
});
