/**
 * Public prose carries facts code can derive, and this file pins every one of
 * them: counted facts are live or sit under a dated assessment context, the
 * README command table matches the registered CLI, SCHEMA's permissions
 * example actually parses through the real reader, every dotted code the
 * packaged docs name is one loam emits, and every known-gap sentence has its
 * owner heading on the roadmap. test/docs-drift.test.ts pins the RELEASE
 * facts; this file pins the derivable ones.
 *
 * The last four describes were added after an audit found the drift sitting
 * exactly where these pins did not reach: thirteen shipped flags no page named,
 * a `loam list` section the table had never heard of, five real artifact paths
 * missing from the layout block readers treat as the map, and an example-fleet
 * count README got wrong while the fixture test and examples/README.md agreed
 * on the right one. Prose about a derivable fact is a claim; this file is where
 * it gets checked.
 */
import { describe, expect, it } from "vitest";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { buildProgram } from "../src/cli.js";
import { readVocabulary } from "../src/core/permissions/permissions.js";
import { CLAIM_KINDS } from "../src/core/verify/claims/identity.js";
import { PACKAGED_MARKDOWN } from "../scripts/package-docs.mjs";
import { collectEmittedCodes } from "./helpers/stable-codes.js";
import { makeProject } from "./helpers/harness.js";

const ROOT = join(import.meta.dirname, "..");

async function read(rel: string): Promise<string> {
  return readFile(join(ROOT, rel), "utf8");
}

/**
 * Collapse every whitespace run to one space. Pinned prose is matched through
 * this: a page rewrapped at 100 columns must not fail a sentence pin, because
 * the pin is about the words, and the line break is a formatting decision the
 * author is allowed to make without touching a test.
 */
function flat(text: string): string {
  // Blockquote continuation marks are line furniture, not prose: a wrapped
  // `> …` callout must match the same sentence an unwrapped one does.
  return text.replace(/^[ \t]*>[ \t]?/gm, "").replace(/\s+/g, " ");
}

/** The pages whose counted facts are graded: the nine shipped + docs/DESIGN.md. */
const FACT_PAGES = [...PACKAGED_MARKDOWN, "docs/DESIGN.md"];

/** Registered command names, from the program the binary actually builds. */
function commandNames(): string[] {
  return buildProgram().commands.map((command) => command.name());
}

/** Distinct ./commands/ import specifiers in src/cli.ts — the command modules. */
async function commandModuleCount(): Promise<number> {
  const cli = await read("src/cli.ts");
  const specifiers = new Set(
    [...cli.matchAll(/from "\.\/commands\/([^"]+)"/g)].map((match) => match[1]!),
  );
  return specifiers.size;
}

/** src/ modules and packages, counted by scripts/package-graph.mjs's rules:
 * a module is a .ts file, a package is a directory directly holding one. */
async function srcCounts(): Promise<{ modules: number; packages: number }> {
  const packages = new Set<string>();
  let modules = 0;
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) await walk(join(dir, entry.name));
      else if (entry.name.endsWith(".ts")) {
        modules += 1;
        packages.add(dir);
      }
    }
  };
  await walk(join(ROOT, "src"));
  return { modules, packages: packages.size };
}

/** Every .ts source under a directory, concatenated — for "does the code still build this path". */
async function sourceUnder(dir: string): Promise<string> {
  let text = "";
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) text += await sourceUnder(join(dir, entry.name));
    else if (entry.name.endsWith(".ts")) text += await readFile(join(dir, entry.name), "utf8");
  }
  return text;
}

async function testFileCount(): Promise<number> {
  const entries = await readdir(join(ROOT, "test"));
  return entries.filter((name) => name.endsWith(".test.ts")).length;
}

/**
 * src/commands/ modules and, for each core hub DESIGN.md's rule 23 names, how
 * many of them import it — the rule's evidence, derived rather than trusted.
 * An importer is a module with a `from "…/<hub>.js"` statement, matching how
 * the prose says "imported by".
 */
async function commandsHubCounts(): Promise<{
  modules: number;
  json: number;
  config: number;
  repo: number;
}> {
  const files: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) await walk(join(dir, entry.name));
      else if (entry.name.endsWith(".ts")) files.push(join(dir, entry.name));
    }
  };
  await walk(join(ROOT, "src", "commands"));
  const counts = { modules: files.length, json: 0, config: 0, repo: 0 };
  for (const file of files) {
    const text = await readFile(file, "utf8");
    if (/from "[^"]*\/core\/envelope\/json\.js"/.test(text)) counts.json += 1;
    if (/from "[^"]*\/core\/envelope\/config\.js"/.test(text)) counts.config += 1;
    if (/from "[^"]*\/core\/repo\/repo\.js"/.test(text)) counts.repo += 1;
  }
  return counts;
}

/**
 * ROADMAP's "## Current assessment" is an audit snapshot governed by the
 * document's leading `_Assessed YYYY-MM-DD._` line — exactly the "assessment
 * context" the roadmap's own criterion prescribes for measured facts.
 *
 * The exemption it grants is now NARROW, and the narrowing is the fix for a
 * drift it licensed: the section spent nine days claiming 261 modules and 21
 * commands against a tree holding 394 and 28 — legally, because a dated heading
 * covered counts that derive from one readdir. A passed/total test count
 * genuinely has no cheap derivation and still belongs here. A module, package,
 * test-file or command count never did, and is graded live wherever written.
 */
async function assessmentRange(): Promise<{ start: number; end: number }> {
  const roadmap = await read("ROADMAP.md");
  expect(
    /^_Assessed \d{4}-\d{2}-\d{2}\._$/m.test(roadmap.slice(0, roadmap.indexOf("\n## "))),
    "ROADMAP.md must open with its `_Assessed YYYY-MM-DD._` context line — it is what licenses the Current assessment's snapshot numbers",
  ).toBe(true);
  const start = roadmap.indexOf("## Current assessment");
  expect(start).toBeGreaterThan(-1);
  const end = roadmap.indexOf("\n## ", start);
  return { start, end: end === -1 ? roadmap.length : end };
}

describe("counted facts are live or dated", () => {
  it("module/package, test-file, test-total and command counts match the tree or sit under the dated assessment", async () => {
    const live = {
      ...(await srcCounts()),
      testFiles: await testFileCount(),
      commands: commandNames().length,
      commandModules: await commandModuleCount(),
    };
    const dated = await assessmentRange();
    const failures: string[] = [];
    const grade = (page: string, match: RegExpExecArray, ok: boolean, expected: string): void => {
      if (ok) return;
      failures.push(
        `${page}: "${match[0]}" does not match the live tree (${expected}) — update the prose. A count this cheap to derive has no dated exemption, on any page.`,
      );
    };
    const int = (text: string): number => Number(text.replace(/,/g, ""));
    for (const page of FACT_PAGES) {
      const text = await read(page);
      for (const m of text.matchAll(/(\d[\d,]*) (?:TypeScript )?modules in (\d[\d,]*) (?:source )?packages/g)) {
        grade(page, m as RegExpExecArray, int(m[1]!) === live.modules && int(m[2]!) === live.packages, `${live.modules} modules in ${live.packages} packages`);
      }
      for (const m of text.matchAll(/(\d[\d,]*) test files/g)) {
        grade(page, m as RegExpExecArray, int(m[1]!) === live.testFiles, `${live.testFiles} test files`);
      }
      for (const m of text.matchAll(/(\d[\d,]*)\/(\d[\d,]*) tests/g)) {
        // A passed/total test count has no cheap live derivation (it needs a
        // full suite run), so the only honest home for one is the dated
        // assessment snapshot; a bare copy anywhere else WILL rot.
        const exempt = page === "ROADMAP.md" && m.index >= dated.start && m.index < dated.end;
        if (!exempt) {
          failures.push(
            `${page}: "${m[0]}" has no live derivation — a passed/total count belongs under ROADMAP's dated Current assessment, or nowhere`,
          );
        }
      }
      for (const m of text.matchAll(/exposes \*\*(\d[\d,]*) commands\*\*/g)) {
        grade(page, m as RegExpExecArray, int(m[1]!) === live.commands, `${live.commands} commands`);
      }
      for (const m of text.matchAll(/(\d[\d,]*) command modules, (\d[\d,]*) commands/g)) {
        grade(page, m as RegExpExecArray, int(m[1]!) === live.commandModules && int(m[2]!) === live.commands, `${live.commandModules} command modules, ${live.commands} commands`);
      }
      for (const m of text.matchAll(/makes (\d[\d,]*) `register\*` calls, which produce\s+\*\*(\d[\d,]*)\*\* commands/g)) {
        grade(page, m as RegExpExecArray, int(m[1]!) === live.commandModules && int(m[2]!) === live.commands, `${live.commandModules} register calls, ${live.commands} commands`);
      }
    }
    expect(failures, failures.join("\n")).toEqual([]);
  });

  it("DESIGN's layers row is present and live — a deleted row must not pass vacuously", async () => {
    const design = await read("docs/DESIGN.md");
    const live = `${await commandModuleCount()} command modules, ${commandNames().length} commands`;
    expect(flat(design), `docs/DESIGN.md's layers table must carry the live "${live}" row`).toContain(live);
  });

  it("DESIGN's rule-23 hub tally is present and live — its four counts are derivable, so they must derive", async () => {
    // "imported by 43 of the 91 modules … by 18 and 24 of them" rots on the
    // next file added to commands/. toMatch (not a loop grade) so a reworded
    // sentence fails loudly instead of passing vacuously; \s+ so reflowing the
    // paragraph does not.
    const design = await read("docs/DESIGN.md");
    const live = await commandsHubCounts();
    expect(design).toMatch(
      new RegExp(
        String.raw`\`core/envelope/json\.ts\`\s+is\s+imported\s+by\s+${live.json}\s+of\s+the\s+${live.modules}\s+modules\s+in\s+\`commands/\``,
      ),
    );
    expect(design).toMatch(
      new RegExp(
        String.raw`\`core/envelope/config\.ts\`\s+and\s+\`core/repo/repo\.ts\`\s+by\s+${live.config}\s+and\s+${live.repo}\s+of\s+them`,
      ),
    );
  });
});

describe("README command table matches buildProgram()", () => {
  it("one row per registered command, set-equal by name", async () => {
    const readme = await read("README.md");
    // Bounded by the NEXT h2, not by a named sibling heading: the per-command
    // notes moved to WORKFLOW.md, and a slice keyed to a heading that has left
    // the page reads as "to the end of the file" rather than failing.
    const from = readme.indexOf("## Commands");
    const to = readme.indexOf("\n## ", from + 1);
    const table = readme.slice(from, to === -1 ? undefined : to);
    const rows = [...table.matchAll(/^\| `loam ([a-z-]+)/gm)].map((match) => match[1]!);
    const registered = commandNames();
    // Set equality both ways, then row count: a parse miss (a reformatted row
    // this regex stops seeing) must fail loudly rather than shrink the set.
    expect([...rows].sort()).toEqual([...registered].sort());
    expect(rows.length).toBe(registered.length);
  });
});

describe("SCHEMA's authorization example parses through the real reader", () => {
  it("the fenced YAML under 'The authorization vocabulary' round-trips readVocabulary()", async () => {
    // The doc's field spellings (owned_by / enforced_by / description, and the
    // subject-declared rule) are pinned to src/core/permissions/permissions.ts:
    // the day the parser's accepted spellings and the published example
    // diverge, this fails.
    const schema = await read("SCHEMA.md");
    const section = schema.slice(schema.indexOf("### The authorization vocabulary"));
    const fence = /```yaml\n([\s\S]*?)```/.exec(section);
    expect(fence, "SCHEMA.md's authorization section must carry its fenced yaml example").not.toBeNull();
    const project = await makeProject({ "architecture/permissions.yaml": fence![1]! });
    try {
      const vocabulary = await readVocabulary(join(project.docsDir, "architecture", "permissions.yaml"));
      expect(vocabulary.present).toBe(true);
      expect(vocabulary.invalid).toBeUndefined();
      expect(vocabulary.subjects).toContain("user");
      const pair = vocabulary.byId.get("user/payments:refund");
      expect(pair, "the documented pair user/payments:refund must be declared").toBeDefined();
      expect(pair!.description).toBe("refund a captured payment");
      expect(pair!.ownedBy).toBe("identity-service");
      expect(pair!.enforcedBy).toEqual(["payment-service"]);
    } finally {
      await project.destroy();
    }
  });
});

describe("public docs name only emitted codes", () => {
  /**
   * Backticked tokens whose dot-separated segments all match the code grammar
   * but that are NOT stable codes, each with the reason it is legal prose.
   * Add here only with a reason — never by loosening the segment grammar
   * (codes-drift's INTENTIONALLY_UNDOCUMENTED discipline). Every entry must
   * still occur in a packaged page and must not shadow a real emitted code;
   * both are asserted below, so this list can only stay honest.
   */
  const ALLOWED_PROSE_TOKENS: Record<string, string> = {
    "error.code": "envelope field path — the JSON key documents point readers at, not a code",
    "error.message": "envelope field path, as above",
    "interrupted.command": "doctor --json writePath field path",
    "recovered.command": "doctor --json writePath field path",
    "checks.coherent": "status --json payload field path",
    "has.asyncapi": "list --json payload field path",
    "claims.answered": "validate --all --json scorecard payload field path — the confirmed claims' provenance split",
    "landscape.instruction": "adopt brief --json payload field path",
    "readiness.living": "audit-openspec --json payload field path",
    "readiness.active": "audit-openspec --json payload field path",
    "baselines.release": "check-openspec-corpus baseline selector, dev tooling not CLI output",
    "user.email": "git config key quoted in vouch's provenance prose",
    "user.name": "git config key, as above",
    "components.messages": "AsyncAPI document section path (the slot grammar), not a finding",
    "components.schemas": "AsyncAPI document section path, as above",
    "loam.json.service": "config key path — the service binding inside loam.json",
    "config.yaml.context": "OpenSpec config key path inventoried by the audit",
  };

  /** File-name tails that make a dotted token a filename, not a code. */
  const EXTENSIONS = new Set([
    "md", "markdown", "yaml", "yml", "json", "likec4", "ts", "js", "mjs", "cmd", "feature", "tgz",
  ]);
  const SEGMENT = /^[a-z][a-z0-9-]*$/;

  async function docTokens(): Promise<Map<string, Set<string>>> {
    const tokens = new Map<string, Set<string>>();
    for (const page of PACKAGED_MARKDOWN) {
      const text = (await read(page)).replace(/```[\s\S]*?```/g, "");
      for (const match of text.matchAll(/`([^`\n]+)`/g)) {
        const segments = match[1]!.split(".");
        if (segments.length < 2) continue;
        if (!segments.every((segment) => SEGMENT.test(segment))) continue;
        if (EXTENSIONS.has(segments[segments.length - 1]!)) continue;
        if (!tokens.has(match[1]!)) tokens.set(match[1]!, new Set());
        tokens.get(match[1]!)!.add(page);
      }
    }
    return tokens;
  }

  it("every dotted backticked token in the packaged pages is an emitted code, a claim kind, or allowed prose", async () => {
    // This is what makes "implemented gates" claims executable: prose
    // advertising `c4.valid` or `permissions.unknown` passes only while loam
    // actually emits those strings, and a retired code fails the page still
    // naming it.
    const emitted = await collectEmittedCodes();
    const accepted = new Set<string>([...emitted, ...CLAIM_KINDS, ...Object.keys(ALLOWED_PROSE_TOKENS)]);
    const failures: string[] = [];
    for (const [token, pages] of await docTokens()) {
      if (accepted.has(token)) continue;
      failures.push(
        `\`${token}\` [${[...pages].join(", ")}] is not a code loam emits — fix the prose, or add it to ALLOWED_PROSE_TOKENS with a reason`,
      );
    }
    expect(failures.sort(), failures.sort().join("\n")).toEqual([]);
  });

  it("the prose allowlist itself does not rot", async () => {
    const emitted = await collectEmittedCodes();
    const tokens = await docTokens();
    const stale = Object.keys(ALLOWED_PROSE_TOKENS).filter((token) => !tokens.has(token));
    expect(
      stale,
      `allowlist entr${stale.length === 1 ? "y" : "ies"} no packaged page still uses: ${stale.join(", ")} — prune`,
    ).toEqual([]);
    const shadowing = Object.keys(ALLOWED_PROSE_TOKENS).filter((token) => emitted.has(token));
    expect(
      shadowing,
      `allowlist entr${shadowing.length === 1 ? "y" : "ies"} now emitted as real code(s): ${shadowing.join(", ")} — prune`,
    ).toEqual([]);
  });
});

describe("known gaps carry owners", () => {
  /**
   * The REGISTERED known-gap sentences in the shipped pages, each paired with
   * the ROADMAP sentence that owns closing it. Registration is opt-in for
   * ordinary prose, with one forced class: every `[later]` marker in SCHEMA.md
   * must be covered by an entry here (asserted below), so a deferral cannot
   * ship ownerless. BOTH sides must exist: shipping a roadmap item deletes its
   * owner sentence, which fails here until the gap prose AND this registry
   * entry are removed in the same change — that coupling is the criterion, so
   * later sessions: when you close a roadmap item, THIS registry and the doc
   * prose it names are part of your change, not someone else's.
   */
  const KNOWN_GAPS: { doc: string; gap: string; owner: string }[] = [
    {
      doc: "README.md",
      gap: "the two-fleet production pilot has not been completed",
      owner: "### Complete the two-fleet pilot",
    },
    {
      doc: "README.md",
      gap: "a components-only OpenAPI delta — and its slot-less AsyncAPI sibling — passes the gate but merges nothing",
      owner: "Still open on both axes.",
    },
    {
      doc: "SCHEMA.md",
      gap: "the complete gate still needs repeatable CI and installed-package evidence observed from an actual push",
      owner: "still release evidence to collect",
    },
    {
      doc: "SCHEMA.md",
      gap: "A components-only feature contract (no `paths` mapping) passes the baseline gate but merges nothing",
      owner: "Still open on both axes.",
    },
    {
      doc: "SCHEMA.md",
      gap: "the event axis has the same shape: a feature asyncapi.yaml declaring no channel/operation/message slot",
      owner: "a slot-less feature asyncapi.yaml merges nothing",
    },
    {
      doc: "SCHEMA.md",
      gap: "**Page-specs** (`ui/pages/*.page.yaml`) are `[later]`",
      owner: "**UI generation:**",
    },
    {
      doc: "SCHEMA.md",
      gap: "UI page-prototypes ─(consume)─► endpoints",
      owner: "**UI generation:**",
    },
    {
      doc: "SCHEMA.md",
      gap: "page-specs (UI services)",
      owner: "**UI generation:**",
    },
  ];

  it("each gap sentence exists in its page AND its owner sentence exists in ROADMAP.md", async () => {
    const roadmap = await read("ROADMAP.md");
    const failures: string[] = [];
    for (const { doc, gap, owner } of KNOWN_GAPS) {
      const text = flat(await read(doc));
      if (!text.includes(flat(gap))) {
        failures.push(`${doc} no longer carries the gap sentence "${gap}" — if the gap closed, remove this registry entry in the same change`);
      }
      if (!flat(roadmap).includes(flat(owner))) {
        failures.push(`ROADMAP.md no longer carries the owner "${owner}" for ${doc}'s gap "${gap}" — closing the item must also remove the gap prose and this entry`);
      }
    }
    expect(failures, failures.join("\n")).toEqual([]);
  });

  it("every `[later]` marker in SCHEMA.md is registered above — a deferral cannot ship ownerless", async () => {
    const schema = await read("SCHEMA.md");
    const registered = KNOWN_GAPS.filter((entry) => entry.doc === "SCHEMA.md").map(
      (entry) => entry.gap,
    );
    let line = 1;
    const paragraphs = schema.split(/\n[ \t]*\n/).map((text) => {
      const at = line;
      line += text.split("\n").length + 1;
      return { text: flat(text), line: at };
    });
    const orphans = paragraphs
      .filter(({ text }) => text.includes("[later]"))
      .filter(({ text }) => !registered.some((gap) => text.includes(flat(gap))))
      .map(({ line: at, text }) => `SCHEMA.md:${at} "${text.slice(0, 120)}"`);
    expect(
      orphans,
      `[later] line(s) no KNOWN_GAPS entry covers:\n${orphans.join("\n")}\n— register each with its ROADMAP owner, or close the deferral`,
    ).toEqual([]);
  });
});

describe("the README names every flag the binary registers", () => {
  it("each long flag appears in its command's row or the prose around it", async () => {
    // Flags were the biggest hole the pins left: the command NAME set was
    // set-equal to the CLI while thirteen shipped flags — `vouch --pack`,
    // `verify --diff-answers`, `new --capability` among them — appeared on no
    // page at all. --json is excluded because one sentence covers it for every
    // command; every other long flag must be spelled where a reader can find it.
    const readme = flat(await read("README.md"));
    const missing: string[] = [];
    for (const command of buildProgram().commands) {
      for (const option of command.options) {
        const long = /--[a-z-]+/.exec(option.flags)?.[0];
        if (long === undefined || long === "--json") continue;
        // Whole-token match: a prefix test would let `--package` vouch for
        // `--pack`, and `--services` for `--service`.
        const named = new RegExp(`\`${long}(?![\\w-])`);
        if (!named.test(readme)) missing.push(`${command.name()} ${long}`);
      }
    }
    expect(
      missing,
      `flag(s) the CLI registers and README never names: ${missing.join(", ")} — add each to its row, or drop the flag`,
    ).toEqual([]);
  });

  it("the list row's sections are the sections the CLI accepts", async () => {
    // The row is an argument list, not a command name, so the set-equality test
    // above cannot see it: `loam list glossary` shipped and worked while the
    // table still offered three sections.
    const readme = await read("README.md");
    const row = /^\| `loam list \[([^\]]+)\]`/m.exec(readme);
    expect(row, "README has no `loam list [sections]` row").not.toBeNull();
    const documented = row![1]!.split("\\|").map((section) => section.trim()).sort();
    const declared = /"\[section\]", "([^"]+)"/.exec(await read("src/commands/list/list.ts"));
    expect(declared, "list.ts's [section] argument description no longer parses").not.toBeNull();
    const real = declared![1]!
      .replace(/\(default:[^)]*\)/, "")
      .split("|")
      .map((section) => section.trim())
      .filter(Boolean)
      .sort();
    expect(documented, "README's list sections and the CLI's disagree").toEqual(real);
  });
});

describe("SCHEMA's layout block is the whole map", () => {
  it("every authored artifact the path builders construct is named in the tree", async () => {
    // The block readers treat as the map had fallen five paths behind the prose
    // in its own file: obligations.yaml, the living and feature-local glossary,
    // the feature-local capability delta and the feature asyncapi delta were all
    // real, all described lower down, and none of them drawn. Both directions
    // are checked — the doc must name it AND src/core/repo/ must still build it —
    // so a retired path fails the doc that still draws it.
    // Line endings normalized: this checkout may be CRLF (git core.autocrlf),
    // and the fence probe below is the one assertion here that is byte-anchored.
    const schema = (await read("SCHEMA.md")).replace(/\r\n/g, "\n");
    const start = schema.indexOf("```\ndocs/");
    expect(start, "SCHEMA.md must open its layout with a fenced `docs/` tree").toBeGreaterThan(-1);
    const layout = schema.slice(start, schema.indexOf("```", start + 4));
    const repo = await sourceUnder(join(ROOT, "src", "core", "repo"));
    const failures: string[] = [];
    for (const [drawn, built] of [
      ["obligations.yaml", '"obligations.yaml"'],
      ["glossary/<term>.md", '"glossary"'],
      ["capabilities/<cap>/spec.md", '"capabilities"'],
      ["specs/<svc>/asyncapi.yaml", '"asyncapi.yaml"'],
    ] as const) {
      const leaf = drawn.split("/").pop()!;
      if (!layout.includes(leaf)) {
        failures.push(`SCHEMA's layout block never draws ${drawn} — the tree is what readers take for the whole map`);
      }
      if (!repo.includes(built)) {
        failures.push(`src/core/repo/ no longer builds ${built} — if the path retired, remove it from the layout and from this list`);
      }
    }
    expect(failures, failures.join("\n")).toEqual([]);
  });
});

describe("the example fleet's headline numbers", () => {
  it("README and examples/README.md quote the count test/examples.test.ts pins", async () => {
    // README claimed seven deliberate warnings for nine days after the count
    // became ten — while the fixture test and examples/README.md both said ten.
    // The fixture test is the authority because it runs the real command, so
    // this reads the number out of it rather than carrying a fourth copy.
    const pinned = /warnings: (\d+)/.exec(await read("test/examples.test.ts"));
    expect(pinned, "examples.test.ts no longer pins a warning count in its summary literal").not.toBeNull();
    const warnings = pinned![1]!;
    expect(
      flat(await read("README.md")),
      `README's example-fleet line must quote the pinned ${warnings} warnings`,
    ).toContain(`0 errors, ${warnings} deliberate warnings`);
    expect(
      flat(await read("examples/README.md")),
      `examples/README.md must quote the pinned ${warnings} warnings`,
    ).toContain(`**0 errors and ${warnings} warnings**`);
  });
});
