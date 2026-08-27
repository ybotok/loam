/**
 * The three counted limits. (The fourth house limit — a branded type on every
 * validated id or path — is tsc's to hold, and never appears here.)
 *
 *   400 lines per source file       (src/)
 *   4 parameters per function       (src/ and test/)
 *   5 files per package directory   (src/)
 *
 * `docs/CODE-STYLE.md` holds why these numbers exist and — more importantly —
 * the obligation that comes with them: the limit tells you WHEN to split, never
 * WHERE. This file only tells you that something is over.
 *
 * WHY A TEST AND NOT JUST LINT. Two of the three are countable in plain Node
 * and one is not: parameters need a parser. oxlint ships `max-params`, so that
 * half is delegated rather than hand-rolled — a hand-rolled TypeScript
 * parameter scanner would be the least trustworthy code in the repository, and
 * a limits checker nobody trusts is a limits checker somebody switches off.
 * (TypeScript 7 is the Go port and no longer exposes `ts.createSourceFile`, so
 * the compiler API is not an option here even though `typescript` is installed.)
 *
 * The reason the whole thing is a test rather than an entry in the `lint`
 * script is the baseline. 34 source files and 27 functions were already over a
 * limit the day the limits landed; lint has no way to say "these, and only
 * these, and only until they shrink". (All 61 have since been cleared and the
 * file is empty — the mechanism stays because emptiness is a state a repository
 * leaves, and the asymmetry below is what makes leaving it visible.) So:
 *
 *   - The SET of entries in test/code-limits-baseline.json must match exactly.
 *     A violation missing from the baseline fails (a new one landed). A
 *     baseline entry with nothing to cover fails (the file was fixed or moved,
 *     and the entry is now a lie that would silently re-permit the violation).
 *   - Each recorded NUMBER is a ceiling. Shrinking a 2,387-line file to 1,200
 *     needs no baseline edit; growing it past 2,387 fails.
 *
 * That asymmetry is the whole design: the list can only lose entries, and the
 * numbers can only go down. Adding an entry to land a new violation is a
 * visible line in a diff, which is where it belongs — no test can tell an
 * honest baseline edit from a dishonest one, but a reviewer can.
 *
 * When the baseline is out of date, re-derive it rather than hand-editing:
 *
 *   LOAM_CODE_LIMITS_BASELINE=write npx vitest run test/code-limits.test.ts
 *
 * LAYOUT-AGNOSTIC ON PURPOSE. This test walks directories; it hard-codes no
 * module path. `docs/DESIGN.md` rule 21 is in the middle of moving every file
 * this test reads, and a checker that needed updating for each move would be
 * turned off by the third one.
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const MAX_FILE_LINES = 400;
const MAX_PARAMS = 4;
const MAX_PACKAGE_FILES = 5;

const REPO = fileURLToPath(new URL("../", import.meta.url));
const BASELINE = fileURLToPath(new URL("./code-limits-baseline.json", import.meta.url));
const OXLINT_CONFIG = "test/code-limits.oxlintrc.json";

/**
 * Directories the limits cover. `src` gets all three; `test` gets parameters
 * only — a test file is one suite about one subject, and splitting it to reach
 * a line count would scatter a subject across five files to satisfy a number
 * that was chosen for production modules. `scripts/` is release plumbing in
 * .mjs and is out of scope for the same reason it is out of scope for tsc.
 */
const PARAM_ROOTS = ["src", "test"] as const;
const STRUCTURE_ROOT = "src";

/** A count that is over its limit, keyed the way the baseline keys it. */
interface Over {
  /** Baseline section: which limit this is. */
  readonly section: "fileLines" | "packageFiles" | "functionParams";
  /** Repo-relative posix path of the file or directory. */
  readonly where: string;
  /** Function label within `where`, or "" for whole-file and directory counts. */
  readonly label: string;
  /** The measured count. The baseline stores this as a ceiling. */
  readonly count: number;
}

/** Baseline on disk: section → where → (count | label → count). */
interface Baseline {
  readonly fileLines: Record<string, number>;
  readonly packageFiles: Record<string, number>;
  readonly functionParams: Record<string, Record<string, number>>;
}

const EMPTY_BASELINE: Baseline = { fileLines: {}, packageFiles: {}, functionParams: {} };

function posix(path: string): string {
  return path.split("\\").join("/");
}

/**
 * Lines the way `wc -l` counts them: a trailing newline terminates the last
 * line rather than starting an empty one. Getting this wrong by one would make
 * every 301-line file argue with the tool the author used to check it.
 */
function lineCount(text: string): number {
  if (text === "") return 0;
  const body = text.endsWith("\n") ? text.slice(0, -1) : text;
  return body.split("\n").length;
}

/** Every directory at or under `root`, and the files sitting directly in each. */
async function walkPackages(root: string): Promise<Map<string, string[]>> {
  const found = new Map<string, string[]>();
  const visit = async (dir: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true });
    const files: string[] = [];
    const subdirs: string[] = [];
    for (const entry of entries) {
      if (entry.isDirectory()) subdirs.push(join(dir, entry.name));
      else files.push(join(dir, entry.name));
    }
    found.set(posix(relative(REPO, dir)), files);
    await Promise.all(subdirs.map(visit));
  };
  await visit(join(REPO, root));
  return found;
}

async function measureStructure(packages: Map<string, string[]>): Promise<Over[]> {
  const over: Over[] = [];

  for (const [dir, files] of packages) {
    if (files.length > MAX_PACKAGE_FILES) {
      over.push({ section: "packageFiles", where: dir, label: "", count: files.length });
    }
    const measured = await Promise.all(
      files
        .filter((file) => file.endsWith(".ts"))
        .map(async (file) => ({ file, lines: lineCount(await readFile(file, "utf8")) })),
    );
    for (const { file, lines } of measured) {
      if (lines > MAX_FILE_LINES) {
        over.push({ section: "fileLines", where: posix(relative(REPO, file)), label: "", count: lines });
      }
    }
  }
  return over;
}

interface OxlintDiagnostic {
  readonly message: string;
  readonly filename: string;
  readonly labels: readonly { readonly span: { readonly offset: number } }[];
}

interface OxlintReport {
  readonly diagnostics: readonly OxlintDiagnostic[];
  readonly number_of_files: number;
}

/**
 * `max-params` names a function only when the declaration carries one. Methods,
 * constructors, object literal methods and arrow functions all report unnamed,
 * so those are keyed by their ordinal within the file, in source order.
 */
const TOO_MANY = /^(?:Arrow function|Function|Method)(?: '([^']*)')? has too many parameters \((\d+)\)/;

function runOxlint(): OxlintReport {
  const bin = join(REPO, "node_modules", ".bin", "oxlint");
  const args = ["-c", OXLINT_CONFIG, "--format=json", ...PARAM_ROOTS];
  let stdout: string;
  try {
    stdout = execFileSync(bin, args, {
      cwd: REPO,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      timeout: 120_000,
    });
  } catch (err) {
    // oxlint exits 1 whenever it reports a diagnostic, which is the ordinary
    // path here — every grandfathered function is a diagnostic. Only a run that
    // produced no stdout at all is a real failure.
    const failure = err as { stdout?: unknown };
    if (typeof failure.stdout !== "string" || failure.stdout === "") throw err;
    stdout = failure.stdout;
  }
  return JSON.parse(stdout) as OxlintReport;
}

function measureParams(report: OxlintReport): Over[] {
  const byFile = new Map<string, OxlintDiagnostic[]>();
  for (const diagnostic of report.diagnostics) {
    const file = posix(diagnostic.filename);
    const list = byFile.get(file) ?? [];
    list.push(diagnostic);
    byFile.set(file, list);
  }

  const over: Over[] = [];
  for (const [file, diagnostics] of byFile) {
    const ordered = [...diagnostics].sort(
      (a, b) => (a.labels[0]?.span.offset ?? 0) - (b.labels[0]?.span.offset ?? 0),
    );
    let unnamed = 0;
    for (const diagnostic of ordered) {
      const match = TOO_MANY.exec(diagnostic.message);
      // A message shape this file cannot read is indistinguishable from one it
      // has silently stopped reading, so it fails the run by name rather than
      // being skipped. Same reasoning as codes-drift's unresolvable call sites.
      expect(match, `unreadable max-params message in ${file}: ${diagnostic.message}`).not.toBeNull();
      if (!match) continue;
      const named = match[1];
      const label = named !== undefined && named !== "" ? named : `<unnamed> #${(unnamed += 1)}`;
      over.push({ section: "functionParams", where: file, label, count: Number(match[2]) });
    }
  }
  return over;
}

function toBaseline(over: readonly Over[]): Baseline {
  const fileLines: Record<string, number> = {};
  const packageFiles: Record<string, number> = {};
  const functionParams: Record<string, Record<string, number>> = {};
  for (const entry of [...over].sort((a, b) => a.where.localeCompare(b.where) || a.label.localeCompare(b.label))) {
    if (entry.section === "fileLines") fileLines[entry.where] = entry.count;
    else if (entry.section === "packageFiles") packageFiles[entry.where] = entry.count;
    else (functionParams[entry.where] ??= {})[entry.label] = entry.count;
  }
  return { fileLines, packageFiles, functionParams };
}

/** Flatten a baseline back into the same key space the measurements use. */
function baselineEntries(baseline: Baseline): Map<string, number> {
  const flat = new Map<string, number>();
  for (const [where, count] of Object.entries(baseline.fileLines)) flat.set(`fileLines\u0000${where}`, count);
  for (const [where, count] of Object.entries(baseline.packageFiles)) flat.set(`packageFiles\u0000${where}`, count);
  for (const [where, labels] of Object.entries(baseline.functionParams)) {
    for (const [label, count] of Object.entries(labels)) {
      flat.set(`functionParams\u0000${where}\u0000${label}`, count);
    }
  }
  return flat;
}

function measuredEntries(over: readonly Over[]): Map<string, number> {
  const flat = new Map<string, number>();
  for (const entry of over) {
    const key =
      entry.section === "functionParams"
        ? `functionParams\u0000${entry.where}\u0000${entry.label}`
        : `${entry.section}\u0000${entry.where}`;
    flat.set(key, entry.count);
  }
  return flat;
}

function describeKey(key: string): string {
  const [section, where, label] = key.split("\u0000");
  if (section === "fileLines") return `${where} (file length)`;
  if (section === "packageFiles") return `${where}/ (files in package)`;
  return `${where} → ${label}() (parameters)`;
}

async function loadBaseline(): Promise<Baseline> {
  try {
    const raw = JSON.parse(await readFile(BASELINE, "utf8")) as Partial<Baseline>;
    return {
      fileLines: raw.fileLines ?? {},
      packageFiles: raw.packageFiles ?? {},
      functionParams: raw.functionParams ?? {},
    };
  } catch {
    // Absent reads as empty: a repository with no grandfathered violations
    // needs no file, and a first run should report every violation rather than
    // erroring about a missing fixture.
    return EMPTY_BASELINE;
  }
}

describe("code limits", () => {
  it("holds the counted limits against a baseline that may only shrink", async () => {
    // The parameter threshold lives in the oxlint config because that is where
    // oxlint reads it, and in MAX_PARAMS because that is where a reader looks.
    // Two homes for one number is exactly the shape that drifts, so they are
    // compared rather than trusted.
    const configured = JSON.parse(await readFile(join(REPO, OXLINT_CONFIG), "utf8")) as {
      rules?: { "max-params"?: readonly unknown[] };
    };
    expect(
      configured.rules?.["max-params"],
      `${OXLINT_CONFIG} must set max-params to MAX_PARAMS (${MAX_PARAMS})`,
    ).toEqual(["error", MAX_PARAMS]);

    const packages = await walkPackages(STRUCTURE_ROOT);
    const report = runOxlint();
    const structure = await measureStructure(packages);
    const params = measureParams(report);

    // Fail closed on a linter that ran over nothing. A misspelt config path or
    // a moved binary makes oxlint report zero diagnostics, which is
    // indistinguishable from "everything passes" — and would silently retire
    // the parameter limit while the test stayed green.
    const sourceCount = [...packages.values()].flat().filter((file) => file.endsWith(".ts")).length;
    expect(
      report.number_of_files,
      "oxlint reported on fewer files than src/ contains — check test/code-limits.oxlintrc.json",
    ).toBeGreaterThanOrEqual(sourceCount);

    const measured = measuredEntries([...structure, ...params]);

    if (process.env["LOAM_CODE_LIMITS_BASELINE"] === "write") {
      await writeFile(BASELINE, `${JSON.stringify(toBaseline([...structure, ...params]), null, 2)}\n`, "utf8");
    }

    const baseline = baselineEntries(await loadBaseline());

    const landed: string[] = [];
    const grown: string[] = [];
    for (const [key, count] of measured) {
      const allowed = baseline.get(key);
      if (allowed === undefined) landed.push(`${describeKey(key)} — ${count}`);
      else if (count > allowed) grown.push(`${describeKey(key)} — ${count}, baseline allows ${allowed}`);
    }
    const stale = [...baseline.keys()].filter((key) => !measured.has(key)).map(describeKey);

    expect(
      landed,
      "New violations. Split on a seam (docs/CODE-STYLE.md) — do not add these to the baseline.",
    ).toEqual([]);
    expect(grown, "Already over the limit and grew. Shrink it back or split it.").toEqual([]);
    expect(
      stale,
      "Stale baseline entries — fixed or moved. Remove them: LOAM_CODE_LIMITS_BASELINE=write npx vitest run test/code-limits.test.ts",
    ).toEqual([]);
  });
});
