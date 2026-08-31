/**
 * Every `loam …` loam PRINTS has to parse against the loam that receives it.
 *
 * loam ships instructions: AGENTS.md, six command bodies delivered twice per
 * tool, a `fix` on every `doctor` finding, a literal `command` on every
 * `status` next[] step. All of it is text an agent reads and types back, and
 * none of it was ever executed by a test — so `Run \`loam adopt <id>\``, the
 * FIRST instruction a freshly bound service repo receives, shipped for months
 * answering `error: too many arguments for 'adopt'`. The same class hit
 * `migrate-openspec <root>` in the README and the `--tools` flow upstream.
 *
 * The check is: extract every invocation, substitute the placeholders, and hand
 * the tokens to the REAL commander program (`buildProgram()` from src/cli.ts,
 * the one the binary runs), with every action handler replaced by a no-op so
 * parsing has no side effects. Nothing here re-declares a flag or a command —
 * a second copy of the wiring would agree with itself and with nothing else,
 * which is precisely the failure being tested for.
 *
 * What is deliberately NOT asserted: that an invocation SUCCEEDS. Whether
 * `loam archive FEAT-101` finds a feature is a question about a repository.
 * This asks only the question the shipped text is actually making a claim
 * about — that the command, its arguments and its flags exist and fit together.
 */
import { describe, expect, it } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { Command } from "commander";
import { HELP_EPILOG, buildProgram } from "../src/cli.js";
import { AGENTS_MD } from "../src/core/agent/agents-md.js";
import { PROTOCOLS } from "../src/core/agent/protocol.js";
import { SLASH_COMMANDS } from "../src/core/agent/scaffold.js";
import { firstHour } from "../src/commands/init/first-hour.js";

const SRC = fileURLToPath(new URL("../src/", import.meta.url));

/**
 * Spans that name a command loam does NOT have, on purpose. Each needs a reason:
 * an entry here is a promise that the text is talking ABOUT the absence.
 */
const DELIBERATE_NON_COMMANDS = new Map<string, string>([
  [
    "loam abandon",
    "AGENTS.md says \"There is no `loam abandon`, deliberately\" — dropping a feature is `git rm -r`, "
      + "and a removal that computes nothing is what version control is for.",
  ],
]);

/* ---------------------------------------------------------------- */
/* Extraction                                                        */
/* ---------------------------------------------------------------- */

/**
 * Markdown inline-code spans, per line. Per LINE because the corpus is prose:
 * across the whole text a stray backtick pairs with one three paragraphs later
 * and swallows a sentence, and a sentence is not an invocation. Fenced `sh`
 * blocks contribute their lines whole — that is where AGENTS.md keeps the
 * federated `loam verify` form and the two-line bootstrap.
 */
function markdownInvocations(text: string): string[] {
  const out: string[] = [];
  let fenced = false;
  for (const raw of text.split("\n")) {
    if (/^\s*```/.test(raw)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) {
      out.push(raw.replace(/#.*$/, ""));
      continue;
    }
    for (const m of raw.matchAll(/`([^`]+)`/g)) out.push(m[1]!);
  }
  return out;
}

/** `//` and `/* *\/` blanked, so a command named in a code comment is not an instruction. */
function withoutComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/**
 * The commands a source file PRINTS: markdown-backticked spans inside its
 * STRING LITERALS — a `doctor` fix, a finding's message.
 *
 * The literals are pulled out first, and their own delimiters dropped, because
 * a template literal's backticks otherwise shift the parity of every markdown
 * span inside it: in ``fix: `Run \`loam adopt …\` to onboard it.` `` the pairs
 * come out as "Run " and " to onboard it.", and the invocation between them —
 * the whole point — is invisible. Comments go first so a command named in one
 * is not read as an instruction.
 */
function printedInvocations(src: string): string[] {
  const code = withoutComments(src);
  const literals = [
    ...code.matchAll(/`(?:[^`\\]|\\[\s\S])*`/g),
    ...code.matchAll(/"(?:[^"\\\n]|\\[\s\S])*"/g),
  ];
  return literals.flatMap((m) => {
    const body = m[0].slice(1, -1).split("\\`").join("`");
    // Prose quotes a command two ways, and only one of them is markdown. The
    // 'single-quoted' form is what archive.ts and the landscape template use,
    // and reading only backticks is how `loam adopt <path> --service <id>`
    // stayed shipped through the pass that fixed doctor.ts's twin.
    const singles = [...body.matchAll(/'(loam [^']*)'/g)].map((s) => s[1]!);
    return [...markdownInvocations(body), ...singles];
  });
}

/** `loam status`'s next[] steps: the literal command on each entry. */
function nextCommands(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/command:\s*`([^`]*)`/g)) out.push(m[1]!);
  for (const m of src.matchAll(/command:\s*"([^"]*)"/g)) out.push(m[1]!);
  return out;
}

/* ---------------------------------------------------------------- */
/* Normalisation                                                     */
/* ---------------------------------------------------------------- */

/**
 * A documented invocation with its placeholders filled in.
 *
 * `<id>`, `<FEAT-id | service-id>`, `${configuredService}` and Claude's `$1`
 * all stand for one argument, so each collapses to a single token. Square
 * brackets mark an OPTIONAL run of tokens (`[--record rest.json]`) and are
 * simply dropped — the check is that the tokens inside are legal, and they are
 * legal exactly when they are legal without the brackets.
 */
function substitute(text: string): string {
  return text
    .replace(/\$\{[^}]*\}/g, "PLACEHOLDER")
    .replace(/<[^>]*>/g, "PLACEHOLDER")
    .replace(/\$\d/g, "PLACEHOLDER")
    .replace(/[[\]]/g, " ");
}

/** Shell-ish tokens: whitespace-separated, double quotes group. */
function tokenize(line: string): string[] {
  return [...line.matchAll(/"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2]!);
}

/* ---------------------------------------------------------------- */
/* The program under test                                            */
/* ---------------------------------------------------------------- */

/**
 * The real program with every action replaced by a no-op and every diagnostic
 * silenced. Re-calling `.action()` overwrites the handler and touches nothing
 * else, so every option, argument and arity declaration under test is the
 * shipped one.
 */
function inertProgram(): Command {
  const program = buildProgram();
  const silence = { writeOut: () => {}, writeErr: () => {} };
  program.configureOutput(silence);
  for (const cmd of program.commands) {
    cmd.action(() => {});
    cmd.configureOutput(silence);
    cmd.exitOverride();
  }
  return program;
}

const program = inertProgram();
const SUBCOMMANDS = new Set(program.commands.flatMap((c) => [c.name(), ...c.aliases()]));

/** The declared option `flag` on `sub`, or undefined. */
function optionOn(sub: string, flag: string) {
  const cmd = program.commands.find((c) => c.name() === sub);
  return cmd?.options.find((o) => o.long === flag || o.short === flag);
}

/**
 * Parse `args` through a fresh real program; the CommanderError message, or
 * null. `from: "user"` means argv without the binary name, so the leading
 * `loam` token is dropped by the caller. Fresh per call because commander
 * accumulates parsed option values on the Command objects.
 */
async function parseFailure(args: string[]): Promise<string | null> {
  try {
    await inertProgram().parseAsync(args, { from: "user" });
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

/* ---------------------------------------------------------------- */
/* The corpus                                                        */
/* ---------------------------------------------------------------- */

interface Invocation {
  /** As written, before substitution — what a failure message should quote. */
  text: string;
  tokens: string[];
  where: string;
}

/**
 * Every `.ts` under src/, so a remedy printed from anywhere is covered.
 *
 * Naming the two or three files that happened to be wrong is how this class
 * survives: `loam adopt <path> --service <id>` shipped in archive.ts for weeks
 * while doctor.ts's twin was being fixed. A command loam prints is a command
 * loam has, whichever file prints it.
 *
 * The walk is recursive because both directories are trees of packages. It
 * used to stop one level down, which held only while every printing module sat
 * flat in core/ — the day status's next[] steps moved into core/status/, the
 * corpus silently lost every command they print, and only the canary assertion
 * below noticed.
 */
async function sourceFiles(): Promise<Array<[string, string]>> {
  const dir = new URL(".", `file://${SRC}`);
  const out: Array<[string, string]> = [];
  const walk = async (here: URL, label: string): Promise<void> => {
    const entries = (await readdir(here, { withFileTypes: true })).sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    );
    for (const entry of entries) {
      if (entry.isDirectory()) await walk(new URL(`${entry.name}/`, here), `${label}${entry.name}/`);
      else if (entry.name.endsWith(".ts")) out.push([`${label}${entry.name}`, await readFile(new URL(entry.name, here), "utf8")]);
    }
  };
  for (const sub of ["commands", "core"]) await walk(new URL(`${sub}/`, dir), `src/${sub}/`);
  out.push(["src/cli.ts", await readFile(new URL("cli.ts", dir), "utf8")]);
  return out;
}

async function corpus(): Promise<Invocation[]> {
  const files = await sourceFiles();

  const sources: Array<[string, string[]]> = [
    ["AGENTS.md (src/core/agent/agents-md/)", markdownInvocations(AGENTS_MD)],
    // Both deliveries, because both are read by an agent and neither is a copy
    // of the other. PROTOCOLS is what `loam instructions` prints — where the
    // recipes are. SLASH_COMMANDS is the file on disk, whose spine names
    // commands too, and whose whole purpose is one `loam instructions …` line
    // that had better parse.
    ...Object.entries(PROTOCOLS).map(
      ([name, body]) => [`/${name} protocol (src/core/agent/workflows/)`, markdownInvocations(body)] as [string, string[]],
    ),
    ...Object.entries(SLASH_COMMANDS).map(
      ([name, body]) => [`/${name} file (src/core/agent/workflows/)`, markdownInvocations(body)] as [string, string[]],
    ),
    // The init first-hour epilogue, by IMPORT rather than scrape: its printed
    // lines are plain text inside template literals — no markdown backticks,
    // no single-quoted `loam` forms — so printedInvocations cannot see them,
    // and they are the first instruction a single-repo trial user receives:
    // exactly the class this suite's header records shipping broken once.
    [
      "the init first-hour epilogue (src/commands/init/first-hour.ts)",
      firstHour("PLACEHOLDER").map(([command]) => command),
    ],
    // The `--help` epilog, by IMPORT for the same reason. Its two lines are the
    // only instruction a reader who has run nothing yet receives, and one of
    // them exists to be typed into an empty directory. printedInvocations does
    // reach src/cli.ts, but only for as long as HELP_EPILOG stays a
    // double-quoted literal: rewrite it as a template literal and the backtick
    // parity shifts, the scrape stops seeing the two commands, and the corpus
    // loses them without a single assertion changing.
    ["the --help epilog (src/cli.ts)", markdownInvocations(HELP_EPILOG)],
    ...files.map(([where, src]) => [`a message loam prints (${where})`, printedInvocations(src)] as [string, string[]]),
    ...files.map(([where, src]) => [`a next[] step (${where})`, nextCommands(src)] as [string, string[]]),
  ];

  const seen = new Set<string>();
  const out: Invocation[] = [];
  for (const [where, spans] of sources) {
    for (const span of spans) {
      const text = span.trim();
      if (!/^loam(\s|$)/.test(text)) continue;
      const key = `${where}::${text}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ text, tokens: tokenize(substitute(text)), where });
    }
  }
  return out;
}

const INVOCATIONS = await corpus();

describe("every loam command loam prints is a command loam has", () => {
  it("found the instructions at all — the corpus is not silently empty", () => {
    // The whole suite passes vacuously if extraction breaks, and extraction is
    // regex over prose. These four are load-bearing sentences that must be in
    // it: the one that shipped broken, the two the campaign added to the
    // workflow bodies, and one from a generated next[] step.
    const all = INVOCATIONS.map((i) => i.text);
    expect(all).toContain("loam adopt --service ${configuredService}");
    expect(all).toContain("loam rebase $1");
    expect(all).toContain("loam status $1 --json");
    expect(all).toContain("loam adopt --service ${s.id} --json");
    expect(INVOCATIONS.length).toBeGreaterThan(60);
  });

  it("names only subcommands the program declares", () => {
    const unknown = INVOCATIONS.filter((i) => {
      const sub = i.tokens[1];
      if (sub === undefined || sub.startsWith("-")) return false;
      // `loam ${r.command} ${r.feature}` names the command through a variable
      // holding "archive" or "unarchive". Nothing static can read it, and
      // asserting on PLACEHOLDER would only pin the substitution.
      if (sub === "PLACEHOLDER") return false;
      if (DELIBERATE_NON_COMMANDS.has(`loam ${sub}`)) return false;
      return !SUBCOMMANDS.has(sub);
    }).map((i) => `${i.where}: ${i.text}`);
    expect(
      unknown,
      `documented invocation(s) naming a command loam does not have:\n  ${unknown.join("\n  ")}`,
    ).toEqual([]);
  });

  it("names only flags the subcommand declares, even where the text quotes a flag alone", () => {
    // `\`loam verify --record\`` in prose is a reference to the OPTION, not an
    // invocation: it deliberately carries no value. Parsing it would fail on
    // "argument missing" and say nothing about whether the flag is real — so
    // the flag is looked up instead, which is the claim the sentence makes.
    const bad: string[] = [];
    for (const i of INVOCATIONS) {
      const sub = i.tokens[1];
      if (sub === undefined || !SUBCOMMANDS.has(sub)) continue;
      for (const token of i.tokens.slice(2)) {
        if (!token.startsWith("-") || token === "--") continue;
        const flag = token.split("=")[0]!;
        if (optionOn(sub, flag) === undefined) bad.push(`${i.where}: ${i.text} — no ${flag} on \`loam ${sub}\``);
      }
    }
    expect(bad, `documented flag(s) the command does not declare:\n  ${bad.join("\n  ")}`).toEqual([]);
  });

  it("parses against the real commander program", async () => {
    const failures: string[] = [];
    for (const i of INVOCATIONS) {
      const sub = i.tokens[1];
      // A bare `loam archive` is a NAME, not an invocation — prose refers to
      // commands that way constantly, and a name reference makes no claim about
      // arguments. Anything carrying an argument or a flag does.
      if (i.tokens.length < 3 || sub === undefined || !SUBCOMMANDS.has(sub)) continue;
      // …and a span whose last token is an option that takes a value is a
      // reference to that option (checked above), not an invocation missing one.
      const last = i.tokens.at(-1)!;
      if (last.startsWith("-") && optionOn(sub, last.split("=")[0]!)?.required === true) continue;
      const failure = await parseFailure(i.tokens.slice(1));
      if (failure !== null) failures.push(`${i.where}: ${i.text}\n      → ${failure}`);
    }
    expect(
      failures,
      "documented invocation(s) the real CLI refuses:\n  " + failures.join("\n  "),
    ).toEqual([]);
  });

  it("still catches the shape that shipped: `loam adopt <id>` as a positional", async () => {
    // The regression itself, pinned so this suite cannot pass by having stopped
    // looking. `loam adopt` takes no argument; the fix string now spells
    // `--service`, and the positional form must stay a hard failure.
    expect(await parseFailure(["adopt", "payment-service"])).toMatch(/too many arguments/);
    expect(await parseFailure(["adopt", "--service", "payment-service"])).toBeNull();
  });
});
