/**
 * A one-keystroke slip in a `.likec4` file must cost an agent a few lines of
 * output, not a few hundred kilobytes.
 *
 * Measured on examples/docs at 0.2.0-alpha.8 (ANALYSIS-7, B7): deleting the
 * closing quote of order-service's `technology 'Spring Boot'` made
 * `validate --service order-service` print 18,503 lines — 434 KB, 458 KB as
 * `--json` — because Chevrotain lists every token sequence the grammar could
 * have accepted, about 6,160 lines per message, and loam printed three of them,
 * two byte-identical. The same slip in a feature's delta.likec4 made
 * `loam context order-service --json` 626 KB instead of 24 KB, and a slip in
 * the fleet map put a 143 KB message into every service's
 * `useCaseScan.error`. And six `covers.unknown` warnings rode along with the
 * parse error, each sending the reader to arch.spec.md to fix an id that was
 * spelled right.
 *
 * The bounds below are an order of magnitude above what the fixed output
 * measures and an order of magnitude below what the broken output measured, so
 * they pin the class without pinning prose.
 */
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { distinctErrors, errorText, loadSource, type LikeC4Error } from "../src/core/c4/likec4.js";
import { coherentFixture, makeProject, makeTmpDir, runLoam, SERVICE_MODEL } from "./helpers/harness.js";

const EXAMPLES = fileURLToPath(new URL("../examples/docs", import.meta.url));

/** payment-service's arch.spec.md: one requirement, one scenario, one `Covers:` line. */
function archSpecCovering(covers: string): string {
  return (
    "---\nservice: payment-service\nstatus: draft\n---\n\n# payment-service — architecture\n\n" +
    "## Requirements\n\n### Requirement: The API is reachable\nThe service SHALL be reachable.\n\n" +
    `Covers: ${covers}\n\n#### Scenario: It answers\n` +
    "- **Given** a request\n- **When** it arrives\n- **Then** it is answered\n"
  );
}

/** The longest one printed diagnostic may be once bounded; the unbounded ones measured 143 KB. */
const ONE_DIAGNOSTIC = 1_000;

interface JsonFinding {
  code: string;
  severity: string;
  details?: string[];
}

function findingsOf(stdout: string): JsonFinding[] {
  const payload = JSON.parse(stdout) as { targets: Array<{ findings: JsonFinding[] }> };
  return payload.targets.flatMap((t) => t.findings);
}

/**
 * A copy of examples/docs with one slip applied — never the tree itself, for
 * the reason test/examples.test.ts gives.
 */
async function exampleWith(file: string, from: string, to: string): Promise<{ workDir: string; destroy: () => Promise<void> }> {
  const root = await makeTmpDir();
  const workDir = join(root, "work");
  const docsDir = join(root, "docs");
  await mkdir(workDir, { recursive: true });
  await cp(EXAMPLES, docsDir, { recursive: true });
  await writeFile(join(workDir, "loam.json"), JSON.stringify({ docsDir }, null, 2) + "\n", "utf8");
  const path = join(docsDir, file);
  const text = await readFile(path, "utf8");
  // The slip must land, or every bound below holds over a clean tree and proves nothing.
  expect(text).toContain(from);
  await writeFile(path, text.replace(from, to), "utf8");
  return { workDir, destroy: () => rm(root, { recursive: true, force: true }) };
}

describe("errorText bounds a parser's list of expected token sequences", () => {
  // Catches: the raw Chevrotain list printed whole — thousands of lines per
  // diagnostic, the bulk of every oversized payload measured.
  it("keeps the first four alternatives, counts the rest, and keeps `but found:`", () => {
    const alternatives = Array.from({ length: 6159 }, (_, i) => `  ${i + 1}. [Token${i}]`);
    const message = ["Expecting: one of these possible Token sequences:", ...alternatives, "but found: 'domain'"].join("\n");
    expect(errorText({ message, line: 28 })).toBe(
      "L29: Expecting: one of these possible Token sequences:\n" +
        "  1. [Token0]\n  2. [Token1]\n  3. [Token2]\n  4. [Token3]\n" +
        "  … (+6155 more)\n" +
        "but found: 'domain'",
    );
  });

  it("leaves a short list, and every other message, exactly as LikeC4 wrote it", () => {
    const short = "Expecting: one of these possible Token sequences:\n  1. [Dot]\n  2. [->]\nbut found: 'x'";
    expect(errorText({ message: short, line: 0 })).toBe(`L1: ${short}`);
    const other = "Could not resolve reference to ElementKind named 'contaner'.";
    expect(errorText({ message: other, line: 4 })).toBe(`L5: ${other}`);
    expect(errorText({ message: other })).toBe(other);
  });

  // The tripwire for the dependency: the cut keys on Chevrotain's own heading,
  // so a LikeC4 upgrade that rewords it must fail here rather than quietly
  // bring the 143 KB messages back.
  it("bounds what the pinned LikeC4 actually reports for a dropped quote", async () => {
    const doc = await loadSource(SERVICE_MODEL.replace("container 'api'", "container 'api"));
    const printed = doc.errors.map(errorText);
    expect(printed.some((text) => text.includes("possible Token sequences") && text.includes("more)"))).toBe(true);
    for (const text of printed) expect(text.length).toBeLessThan(ONE_DIAGNOSTIC);
  });
});

describe("distinctErrors reports each diagnostic once, in line order", () => {
  it("drops a repeat of one message at one line of one file, and sorts stably by line", () => {
    const errors: LikeC4Error[] = [
      { message: "b", line: 9, sourceFsPath: "/docs/model.likec4" },
      { message: "x", line: 2, sourceFsPath: "/docs/model.likec4" },
      { message: "b", line: 9, sourceFsPath: "/docs/model.likec4" },
      // Same message, same line, ANOTHER document: LikeC4 blames a duplicate
      // declaration on both files, and both are lines an author must open.
      { message: "b", line: 9, sourceFsPath: "/docs/landscape.likec4" },
      { message: "y", line: 2, sourceFsPath: "/docs/model.likec4" },
      { message: "document-wide" },
    ];
    expect(distinctErrors(errors).map((e) => `${e.sourceFsPath ?? "-"}:${e.line ?? "-"}:${e.message}`)).toEqual([
      "-:-:document-wide",
      "/docs/model.likec4:2:x",
      "/docs/model.likec4:2:y",
      "/docs/model.likec4:9:b",
      "/docs/landscape.likec4:9:b",
    ]);
  });
});

describe("one dropped quote in a service model", () => {
  // Catches: 458 KB of `--json` for one keystroke, the same diagnostic listed
  // twice, the lexer's error listed above the parser's, and `covers.unknown`
  // cascading out of a model nobody could read.
  it("is one bounded c4.invalid, each diagnostic once and in line order, and no covers.unknown", async () => {
    const p = await exampleWith(
      "services/order-service/model.likec4",
      "technology 'Spring Boot'",
      "technology 'Spring Boot",
    );
    try {
      const res = await runLoam(p.workDir, "validate", "--service", "order-service", "--json");
      expect(res.code).toBe(1);
      expect(res.stdout.length).toBeLessThan(50_000);
      const all = findingsOf(res.stdout);
      const [invalid] = all.filter((f) => f.code === "c4.invalid");
      const details = invalid?.details ?? [];
      expect(details.length).toBeGreaterThan(0);
      for (const detail of details) expect(detail.length).toBeLessThan(ONE_DIAGNOSTIC);
      expect(new Set(details).size).toBe(details.length);
      const lines = details.map((d) => Number(/ L(\d+): /.exec(d)?.[1]));
      expect(lines).toEqual([...lines].sort((a, b) => a - b));
      expect(details.some((d) => d.includes("but found: 'domain'"))).toBe(true);
      expect(all.filter((f) => f.code === "covers.unknown")).toEqual([]);
    } finally {
      await p.destroy();
    }
  });

  // The standalone shape takes the other loader and keeps a readable map, so
  // `Covers:` lines naming the map could still resolve — and are suspended with
  // the rest, because a report graded on half the forms is the partial report
  // the axis refuses for an unreadable map.
  it("suspends covers.unknown for a standalone model that does not parse", async () => {
    const files = coherentFixture();
    files["services/payment-service/model.likec4"] = SERVICE_MODEL.replace("container 'api'", "container 'api");
    files["services/payment-service/arch.spec.md"] = archSpecCovering("paymentService.api");
    const p = await makeProject(files);
    try {
      const res = await runLoam(p.workDir, "validate", "--service", "payment-service", "--json");
      const all = findingsOf(res.stdout);
      expect(all.filter((f) => f.code === "c4.invalid")).toHaveLength(1);
      expect(all.filter((f) => f.code === "covers.unknown")).toEqual([]);
    } finally {
      await p.destroy();
    }
  });
});

describe("one broken document does not bloat anybody else's briefing", () => {
  // Catches: a feature's broken delta.likec4 inflating `loam context` for every
  // service the feature touches — 626 KB where the clean briefing is 24 KB.
  it("context --json carries a broken feature delta's errors bounded", async () => {
    const p = await exampleWith(
      "features/FEAT-101-payment-splitting/delta.likec4",
      "technology 'Spring Boot'",
      "technology 'Spring Boot",
    );
    try {
      const res = await runLoam(p.workDir, "context", "order-service", "--json");
      expect(res.stdout.length).toBeLessThan(100_000);
      const payload = JSON.parse(res.stdout) as { features: Array<{ architecture?: { errors: string[] } }> };
      const errors = payload.features.flatMap((f) => f.architecture?.errors ?? []);
      expect(errors.length).toBeGreaterThan(0);
      for (const text of errors) expect(text.length).toBeLessThan(ONE_DIAGNOSTIC);
    } finally {
      await p.destroy();
    }
  });

  // Catches: the two places a LikeC4 message travelled raw instead of through
  // `errorText` — the fleet use-case scan (`useCaseScan.error` on every
  // service's briefing) and the deploy gate's "landscape cannot be used".
  it("a broken fleet map reaches context and gate through errorText, bounded", async () => {
    const p = await exampleWith(
      "architecture/landscape.likec4",
      "description 'Owns the order lifecycle'",
      "description 'Owns the order lifecycle",
    );
    try {
      const context = await runLoam(p.workDir, "context", "order-service", "--json");
      expect(context.stdout.length).toBeLessThan(100_000);
      const scan = (JSON.parse(context.stdout) as { useCaseScan: { unreadable: boolean; error?: string } }).useCaseScan;
      expect(scan.unreadable).toBe(true);
      expect(scan.error).toMatch(/^L\d+: /);
      expect(scan.error!.length).toBeLessThan(ONE_DIAGNOSTIC);

      const gate = await runLoam(p.workDir, "gate", "--service", "order-service", "--json");
      expect(gate.stdout).toContain("landscape.likec4 exists but cannot be used");
      expect(gate.stdout.length).toBeLessThan(20_000);
    } finally {
      await p.destroy();
    }
  });
});
