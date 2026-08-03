/**
 * Drift guard: every stable code loam emits must appear in the agent-facing
 * docs — the AGENTS.md template and the slash commands `loam init` lays down
 * (src/core/agent.ts).
 *
 * The codes are the machine contract: prose may change, codes may not, and an
 * agent branches on them. A code that ships undocumented is a branch nobody was
 * told about — the delta-shape and coherence waves added ten of them before
 * this test existed, and the /loam-check table never noticed.
 *
 * Collection is by regex over the source, because the unions are types and
 * types are erased — there is no runtime constant to import. Four patterns
 * cover every way a code is constructed today: a `code: "…"` literal, both
 * arms of a `code: cond ? "…" : "…"` ternary, the IssueCode/ErrorCode union
 * members in issue.ts and json.ts, and the one code that exists only as a
 * text marker (validate's `⚠ sources.unverifiable-from-here:` summary line).
 * A new construction pattern shows up as a code this test suddenly stops
 * seeing — which is what the collector-sanity test below is for.
 *
 * "Documented" means the code appears BACKTICKED in the docs, the way every
 * code is quoted there — a plain substring match would let prose coincidences
 * ("internal consistency") vouch for the `internal` error code.
 */
import { describe, expect, it } from "vitest";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { AGENTS_MD, SLASH_COMMANDS } from "../src/core/agent.js";

const SRC = fileURLToPath(new URL("../src/", import.meta.url));

/**
 * Codes deliberately kept out of the docs. Empty today: everything loam emits
 * is agent-facing, including the `ok`-severity confirmations — they arrive in
 * the same findings[] an agent branches on, so AGENTS.md names them. Add a
 * code here only with a reason beside it, never by loosening the patterns.
 */
const INTENTIONALLY_UNDOCUMENTED: string[] = [];

/** Every .ts file under src/, recursively. */
async function tsFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await tsFiles(path)));
    else if (entry.name.endsWith(".ts")) out.push(path);
  }
  return out;
}

async function emittedCodes(): Promise<Set<string>> {
  const codes = new Set<string>();
  for (const file of await tsFiles(SRC)) {
    // agent.ts IS the documentation corpus — scanning it would let a code
    // count as emitted merely because it is documented.
    if (file.endsWith("agent.ts")) continue;
    const src = await readFile(file, "utf8");
    for (const m of src.matchAll(/code:\s*"([a-z][a-z0-9.-]*)"/g)) codes.add(m[1]!);
    for (const m of src.matchAll(/code:\s*[^,\n?]*\?\s*"([a-z][a-z0-9.-]*)"\s*:\s*"([a-z][a-z0-9.-]*)"/g)) {
      codes.add(m[1]!);
      codes.add(m[2]!);
    }
    for (const m of src.matchAll(/[⚠✗] ([a-z0-9-]+\.[a-z0-9-]+):/g)) codes.add(m[1]!);
    // The two unions are the only files where a `| "…"` member is a stable code.
    if (file.endsWith("issue.ts") || file.endsWith("json.ts")) {
      for (const m of src.matchAll(/^\s*\|\s*"([a-z][a-z0-9.-]*)"/gm)) codes.add(m[1]!);
    }
  }
  return codes;
}

/** The agent-facing corpus: AGENTS.md plus every slash command init lays down. */
const DOCS = AGENTS_MD + Object.values(SLASH_COMMANDS).join("\n");

describe("the code vocabulary does not drift from the docs", () => {
  it("every stable code emitted in src/ is documented, backticked, in AGENTS.md or a slash command", async () => {
    const missing = [...(await emittedCodes())]
      .filter((c) => !INTENTIONALLY_UNDOCUMENTED.includes(c))
      .filter((c) => !DOCS.includes(`\`${c}\``))
      .sort();
    expect(
      missing,
      `undocumented stable code(s):\n  ${missing.join("\n  ")}\n` +
        "Document each in AGENTS_MD or the /loam-check table (src/core/agent.ts), " +
        "or add it to INTENTIONALLY_UNDOCUMENTED with a reason.",
    ).toEqual([]);
  });

  it("the collector actually collects — every pattern proves itself on a known code", async () => {
    // One probe per collection pattern; a refactor that changes how codes are
    // constructed must fail HERE, not silently shrink the guarded set.
    const codes = await emittedCodes();
    for (const probe of [
      "delta.no-delta-sections", // `code:` literal — in delta.ts, whose NUL-byte key separator defeats grep but not readFile
      "delta.modified-pending", // ternary arm
      "sources.unverifiable-from-here", // exists only as a text marker in validate.ts
      "rollback-incomplete", // ErrorCode union member
      "internal", // union member with neither dot nor dash
      "delta.nothing-tagged", // coherence emission not (yet) in the IssueCode union
    ]) {
      expect(codes.has(probe), `collector lost ${probe}`).toBe(true);
    }
    expect(codes.size).toBeGreaterThan(40);
  });
});
