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
import { VALIDATE_CHECKS } from "../src/core/brief/checks/checks.js";
import { listCodes } from "../src/core/explain/lookup.js";
import { PACKAGED_MARKDOWN } from "../scripts/package-docs.mjs";
import { committedBlock, defaultCalls, measurePayloads, payloadBlock, type Payloads } from "../scripts/payload-sizes.js";
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
  // Offsets into flat(roadmap), not into the raw page, because every pin below
  // now matches against the flattened text. A raw offset would put the
  // exemption window at the wrong characters the moment a paragraph above it
  // rewrapped — an exemption that silently moves is worse than no exemption.
  const flatRoadmap = flat(roadmap);
  const start = flatRoadmap.indexOf("## Current assessment");
  expect(start).toBeGreaterThan(-1);
  const end = flatRoadmap.indexOf(" ## ", start);
  return { start, end: end === -1 ? flatRoadmap.length : end };
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
      // flat(), not the raw page, and this is a FIX rather than a tidy. Every
      // pattern below is a run of words with single spaces in it, and a
      // hundred-column page wraps wherever it likes: the `register*` pin below
      // required a literal space before `commands`, docs/DESIGN.md wrapped at
      // exactly that point, and the pin therefore matched NOTHING for its whole
      // life while the sentence it was guarding said 27 and 28 against a tree
      // holding 28 and 29. Every other loop here had the same hole waiting —
      // `2 test files`, `28 command modules, 29 commands` and `394 modules in
      // 122 packages` all wrap as readily. The sibling `it` two describes down
      // already used flat() for this reason; this loop had not.
      const text = flat(await read(page));
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

  it("DESIGN's register-call sentence is present and live — the pin that never once matched", async () => {
    // The loop above grades this sentence only if it FINDS it, and for the
    // whole life of that pin it did not: the pattern wanted a literal space
    // before `commands`, the page wrapped there, and 27/28 sat unchallenged
    // against a tree of 28/29. The wrap is fixed by flat(); the vacuum is
    // fixed HERE, by asserting the sentence exists at all. A pin that can pass
    // by not matching is worse than no pin, which is this file's own doctrine.
    const design = flat(await read("docs/DESIGN.md"));
    const live = `makes ${await commandModuleCount()} \`register*\` calls, which produce **${commandNames().length}** commands`;
    expect(design, `docs/DESIGN.md must carry the live "${live}" sentence`).toContain(live);
  });

  it("the adopt brief's check count is live where README and WORKFLOW name it", async () => {
    // Both pages said "52" against a brief of 53 — a count nothing derived,
    // in the one sentence that tells an evaluator what --targets leaves out.
    // toHaveLength first, so a reworded sentence fails here instead of
    // passing by not matching.
    const pages = ["README.md", "WORKFLOW.md"];
    const found: string[] = [];
    for (const page of pages) {
      for (const m of flat(await read(page)).matchAll(/the (\d+) (?:named )?checks and the seventeen statements/g)) {
        found.push(`${page}: ${m[1]}`);
      }
    }
    expect(found, "README and WORKFLOW must each name the brief's check count once").toHaveLength(pages.length);
    expect(found).toEqual(pages.map((page) => `${page}: ${VALIDATE_CHECKS.length}`));
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

  it("a finding- or refusal-code count, wherever a page quotes one, is the count `loam explain --codes` lists", async () => {
    // README and WORKFLOW said "293 finding codes and 46 refusal codes" for six
    // weeks after the vocabulary reached 304: the number was typed in once and
    // nothing derived it. The pages now say "every finding code" instead, and
    // this keeps a number from coming back unless it is the live one. The
    // byte sizes those same sentences quoted (`loam-check`'s page, the
    // orientation file) were dropped rather than pinned — they move on every
    // edit to a fix table, and the one that matters as a limit, AGENTS.md's
    // 12,000-byte ceiling, is asserted by test/agents.test.ts itself.
    const codes = listCodes();
    const live = {
      finding: codes.filter((c) => c.kind === "finding").length,
      refusal: codes.filter((c) => c.kind === "refusal").length,
    };
    const failures: string[] = [];
    // CHANGELOG is the one page that is SUPPOSED to hold old counts: each entry
    // records what was true the day it was cut.
    for (const page of FACT_PAGES.filter((p) => p !== "CHANGELOG.md")) {
      const text = flat(await read(page));
      for (const m of text.matchAll(/(\d[\d,]*) (finding|refusal) codes/g)) {
        const kind = m[2] as "finding" | "refusal";
        if (Number(m[1]!.replace(/,/g, "")) !== live[kind]) {
          failures.push(`${page}: "${m[0]}" — \`loam explain --codes\` lists ${live[kind]} ${kind} codes`);
        }
      }
    }
    expect(failures, failures.join("\n")).toEqual([]);
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
    "checks.gating": "status --json payload field path — the findings carrying `gates`",
    "feature.title": "status --json payload field path — intent.md's title beside the id",
    "review.next": "show --json payload field path — the feature's next steps, `loam status`'s list",
    "size.calls": "tasks --json payload field path — the call edges a lens carries",
    "has.asyncapi": "list --json payload field path",
    "claims.answered": "validate --all --json scorecard payload field path — the confirmed claims' provenance split",
    "landscape.instruction": "adopt brief --json payload field path",
    "landscape.elements": "adopt brief --json payload field path",
    "landscape.touched": "adopt brief --json payload field path",
    "landscape.attested": "adopt brief --json payload field path",
    "landscape.modelled": "adopt brief --json payload field path",
    "landscape.parses": "adopt brief --json payload field path",
    "landscape.present": "context --json payload field path — whether architecture/landscape.likec4 is on disk, beside `landscape.parses` about the project",
    "landscape.broken": "context/explore --json payload field path — the architecture/ documents that failed, beside `landscape.parses` about the project",
    "landscape.inbound": "adopt brief --json payload field path",
    "landscape.outbound": "adopt brief --json payload field path",
    "landscape.expects": "adopt brief --json payload field path",
    "readiness.living": "audit-openspec --json payload field path",
    "readiness.active": "audit-openspec --json payload field path",
    "baselines.release": "check-openspec-corpus baseline selector, dev tooling not CLI output",
    "user.email": "git config key quoted in vouch's provenance prose",
    "user.name": "git config key, as above",
    "components.messages": "AsyncAPI document section path (the slot grammar), not a finding",
    "components.schemas": "AsyncAPI document section path, as above",
    "capabilities.prompts": "MCP initialize result field path — the prompts capability `loam mcp` declares",
    "loam.json.service": "config key path — the service binding inside loam.json",
    "config.yaml.context": "OpenSpec config key path inventoried by the audit",
    "contracts.openapi": "config key path — where loam.json names the build's OpenAPI output",
    "living.deployment": "context --json payload field path — the service's slice of the fleet topology",
    "projects.exclude": "subsystem sync --json payload field path — the root likec4.config.json exclude list it rewrote",
    "projects.created": "subsystem sync --json payload field path — the per-service project files it wrote",
    "projects.removed": "subsystem sync --json payload field path — the stray per-service project files it deleted",
    "projects.current": "subsystem sync --json payload field path — the services already holding the project file they are owed",
    "projects.exclude.removed": "subsystem sync --json payload field path — the exclude entries the rewrite took back",
    "projects.exclude.unreadable": "subsystem sync --json payload field path — the root config exists and holds no readable exclude list, which is not the same answer as an empty one",
    "blocked.reason": "subsystem sync --json payload field path — why the generated views file was left alone",
    "reports.dir": "doctor --json payload field path — the absolute loam-reports/ directory the protocol writes into",
    "reports.present": "doctor --json payload field path — whether that directory exists",
    "reports.total": "doctor --json payload field path — how many reports it holds",
    "reports.next": "doctor --json payload field path — the ordinal the next report takes",
    // The first RETIRED code to reach this list, and the reason is worded for
    // the next one rather than for this one. A code loam has stopped emitting
    // still occurs in immutable release history: CHANGELOG entries describe the
    // releases that shipped it, and a roadmap line may cite the defect that
    // retired it. Those sentences are true and must not be edited — a changelog
    // that rewrites what an old version emitted is worse than one naming a dead
    // code. What the entry does NOT license is a LIVE page telling a reader a
    // retired code will fire: the check below still proves the token appears
    // somewhere packaged, and the sibling check still proves it is not emitted,
    // so an entry here can only ever be honest about history. When a future
    // retirement lands, add its code with this same reason.
    "landscape.datastore-private":
      "retired code, named in release history — CHANGELOG and ROADMAP describe the releases that emitted it (retired 2026-09-07: where a store is drawn is the team's choice)",
  };

  /** File-name tails that make a dotted token a filename, not a code. */
  const EXTENSIONS = new Set([
    "md", "markdown", "yaml", "yml", "json", "likec4", "ts", "js", "mjs", "cmd", "feature", "tgz",
  ]);
  const SEGMENT = /^[a-z][a-z0-9-]*$/;

  /**
   * The sample docs repo's OWN content is out of scope, and the distinction is
   * the whole point of this check rather than an exemption from it.
   *
   * `examples/docs/**` is a fleet's documentation, not loam's. Its runbooks
   * name that fleet's Kafka topics (`order.events.v1`), its specs name its
   * operation ids; every one of them is a dotted backticked token and not one
   * of them is a claim about what loam emits. Grading them here asks "does
   * loam emit `order.events.v1`" of a sentence that never said it did, and the
   * answer would keep being no for every artifact the example ever gains.
   *
   * What this check exists for is loam's claims ABOUT ITSELF: a page
   * advertising `c4.valid` passes only while loam emits that string, and a
   * retired code fails the page still naming it. `examples/README.md` is
   * loam's own prose about the example and stays in scope; the tree it
   * describes does not.
   */
  const SAMPLE_DOCS = "examples/docs/";

  async function docTokens(): Promise<Map<string, Set<string>>> {
    const tokens = new Map<string, Set<string>>();
    for (const page of PACKAGED_MARKDOWN.filter((path) => !path.startsWith(SAMPLE_DOCS))) {
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
      gap: "has yet to be observed green at the budget it was given on 2026-10-28",
      owner: "still release evidence to collect",
    },
    {
      doc: "SCHEMA.md",
      gap: "has yet to be observed green at the budget it was given on 2026-10-28",
      owner: "still release evidence to collect",
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

describe("one stance on whose document holds a service's interior", () => {
  /**
   * The stance CHANGED on 2026-09-07 and this block changed with it, so read
   * both halves before editing either.
   *
   * The old stance was a preference loam enforced: a one-consumer store drawn
   * as a fleet-level peer earned `landscape.datastore-private`, whose whole
   * message prescribed deleting the peer and writing the store inside its
   * owner. This block then existed to stop SCHEMA re-narrowing to "the map
   * holds no service's interior" while that message told an agent to put one
   * there. The maintainer's verdict on the preference itself: "that is not
   * correct" — where a store is drawn is the team's choice, and grading the
   * DRAWING while the identical nested store was silent graded the picture
   * rather than the architecture.
   *
   * So the code is retired and the pins are inverted. What must hold now is
   * that no surface prescribes a move — and that the one genuinely
   * load-bearing consequence, which is a fact about LikeC4 and not a
   * preference, survived the deletion instead of going with it: a second
   * consumer's edge resolves only against a declaration the MAP holds, because
   * a per-service project is `architecture/` plus one model. That sentence is
   * why placement is a decision at all, and it is the half a rewrite would
   * most plausibly throw away along with the prescription.
   */
  it("placement is free, the LikeC4 consequence survives, and no emitted code grades where a store is drawn", async () => {
    const schema = flat(await read("SCHEMA.md"));
    // Kept from the old block, and still true for the old reason: the archive's
    // title-join and `loam archive`'s routing both put containers on the map.
    expect(
      schema,
      "SCHEMA still forbids a placement `loam validate` accepts",
    ).not.toContain("the map holds no service's interior");
    expect(
      schema,
      "SCHEMA's `Private stores` must offer BOTH placements — a store nested in the owner's model and one drawn as a fleet-level peer are equally first-class",
    ).toContain("or inside the service's element on the map when the map draws that service's containers");
    expect(
      schema,
      "SCHEMA's `Private stores` must say outright that the placement is the team's choice — the sentence that replaced the prescription",
    ).toContain("Where a store is drawn is the team's choice");
    expect(
      schema,
      "SCHEMA dropped the one consequence that is a FACT rather than a preference — a second consumer's edge needs the store on the MAP",
    ).toContain("a per-service project is `architecture/` plus one model");
    // The proof that no message prescribes a move is that the code which did no
    // longer exists. `collectEmittedCodes` reads the source the way
    // codes-drift does, so this fails the moment the arm is restored — and a
    // restored arm is exactly what would make the SCHEMA pins above wrong.
    const emitted = await collectEmittedCodes();
    expect(
      emitted.has("landscape.datastore-private"),
      "`landscape.datastore-private` is emitted again — it graded WHERE a store is drawn, which is the team's choice; if it was deliberately restored, this whole block and SCHEMA's `Private stores` move with it",
    ).toBe(false);
    // The surviving grade states coupling and never placement, so its remedy
    // must be about the DATA. "let this warning state the coupling" is the
    // clause that makes that explicit, and it is the one a re-prescription
    // would delete first. flat() because the sentence is assembled across
    // source lines and this checkout's line endings are not the pin's business.
    const consumers = flat(await read("src/commands/validate/fleet/map/consumers.ts"));
    expect(
      consumers,
      "`landscape.datastore-shared`'s remedy no longer says a store may stay where it is — the shared grade is about the same DATA, never about the drawing",
    ).toContain("let this warning state the coupling");
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

/**
 * Both payload tests read one measurement: it is some four hundred in-process
 * invocations, and taking it twice would double the cost of this file for no
 * second fact.
 */
let payloads: Promise<Payloads> | undefined;
const measured = (): Promise<Payloads> => (payloads ??= measurePayloads());

describe("docs/BENCHMARKS.md's payload table is this tree's, not a recollection", () => {
  it("the committed block is exactly what scripts/payload-sizes.ts measures now", async () => {
    // What loam hands an agent is the cost an evaluator reproduces in a minute,
    // and it moves on every edit to a protocol, a fix table or the brief. The
    // figures used to live only in prose — the README adopt row's "54,833 bytes
    // to 20,062", true on the day it was typed and about 60 KB to 25 KB a month
    // later with nothing saying so. The script measures in process through the
    // real program, so this costs seconds and needs no build. A mismatch means
    // the tree moved and the page did not; the fix is to regenerate, never to
    // edit the numbers by hand.
    const committed = committedBlock(await read("docs/BENCHMARKS.md"));
    expect(
      committed,
      "docs/BENCHMARKS.md has lost its payload-sizes block — the markers are what scripts/payload-sizes.ts rewrites",
    ).not.toBeNull();
    expect(
      committed,
      "docs/BENCHMARKS.md's payload table is behind this tree — run `npx tsx scripts/payload-sizes.ts --write` and commit the result",
    ).toBe(await payloadBlock(await measured()));
  });
});

/**
 * The calls whose default form is ALLOWED past the ceiling, each with the reason
 * it may be. Shrinks only: an entry whose call has come back under the line
 * fails below, so this cannot quietly become the permanent state — the same
 * discipline as test/code-limits-baseline.json.
 */
const OVER_THE_CEILING = new Map<string, string>([
  [
    "`loam adopt --service payment-service --json`",
    "one service's whole brief, read once per adoption; `--targets` is its per-service part at under half the size, "
      + "and moving the fleet-invariant half (the walk, the checks, the unchecked list) out of the default is a "
      + "change to what adopt prints, not to a page",
  ],
  [
    "`loam explain --codes --json`",
    "the whole code vocabulary, which is what `--codes` asks for by name; `loam explain <code>` is the one-code form",
  ],
  [
    "`loam instructions loam-codes`",
    "the per-invocation inventory of every code, read as a reference rather than at a workflow step; "
      + "`loam explain <code>` answers any one of them",
  ],
]);

describe("no default payload outgrows what a host keeps inline", () => {
  it("every call in its default form is under 50,000 characters, or a named exception with its reason", async () => {
    // Claude Code moves an MCP tool result over 50,000 characters into a file, and an
    // agent reading through a shell sees a preview and reads the rest in pieces.
    // /loam-check printed 138 KB by default — every agent whose pointer called it
    // bare paid that — and only AGENTS.md had a ceiling. Bytes stand in for
    // characters: never fewer, so a call under the line in bytes is under it in
    // characters too.
    const CEILING = 50_000;
    const calls = defaultCalls(await measured());
    expect(calls.length).toBeGreaterThan(10);
    for (const { invocation, bytes } of calls) {
      const reason = OVER_THE_CEILING.get(invocation);
      if (reason === undefined) {
        expect(bytes, `${invocation} prints ${bytes} bytes by default — over the ${CEILING} ceiling`).toBeLessThan(CEILING);
      } else {
        expect(bytes, `${invocation} is back under the ceiling — remove it from OVER_THE_CEILING`).toBeGreaterThanOrEqual(CEILING);
        expect(reason.length).toBeGreaterThan(40);
      }
    }
    for (const invocation of OVER_THE_CEILING.keys()) {
      expect(calls.map((c) => c.invocation), `OVER_THE_CEILING names ${invocation}, which is not measured`).toContain(invocation);
    }
  });
});
