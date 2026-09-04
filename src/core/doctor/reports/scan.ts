/**
 * The problem reports a repository has collected: how many there are, what
 * state each one is in, and which ordinal the next one takes.
 *
 * A sub-package because `doctor/` is at its five-file limit, and a scan of its
 * own because this is the one directory loam reads that loam never writes. The
 * `loam-report` protocol has always asked a repository to accumulate a corpus
 * under `loam-reports/` and then never looked at it — eleven reports landed in
 * this repository in two days, three of them already closed, and every bit of
 * that state lived outside the files, in whoever remembered. The directory is
 * loam's own convention and its contents are loam's own format, so counting
 * them is a fact loam can read as cheaply as it reads `agentFiles`. Reading is
 * the whole of it: nothing here transmits anything, which is the constraint the
 * protocol is built around.
 *
 * Everything below is best-effort on purpose. A report is a hand-written
 * Markdown file, so an absent directory, an unreadable one, a name written
 * before the numbering existed and a file with no `Status:` line are all
 * ordinary states of a healthy repository. None of them is a finding, and
 * `doctor`'s `healthy` does not move for anything in here — a repo with eleven
 * open reports is not broken, it is one that has been paying attention.
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type ProblemReportEntry,
  type ProblemReports,
  type ProblemReportStatus,
} from "../report.js";

/**
 * The conventional NAME of the directory the `loam-report` protocol asks a
 * repository to accumulate, spelled once — the segment `scanReports` joins onto
 * the resolved root to reach it.
 *
 * A name rather than a path, because two readers want different things out of
 * it and both are right: `ProblemReports.dir` carries the joined ABSOLUTE
 * location, because the protocol tells an agent to write there and a relative
 * spelling leaves it guessing which repository "relative" meant (`../report.ts`
 * records that), while `commands/doctor.ts`'s human row prints this constant, so
 * a person standing in the repository reads `loam-reports/` — what the protocol,
 * the reports themselves and every page that mentions them say.
 */
export const REPORTS_DIR = "loam-reports";

/**
 * The leading ordinal of `012-2026-09-03-slug.md`. Three digits or more, so the
 * thousandth report widens the field instead of losing its number.
 */
const ORDINAL = /^(\d{3,})-/;

/**
 * A name written before the numbering existed: `2026-09-03-slug.md`, the shape
 * eleven reports in this repository already carry.
 *
 * Checked FIRST, and this is the whole reason it exists as its own pattern: a
 * four-digit year satisfies `ORDINAL` perfectly, so a legacy name read as an
 * ordinal is report number 2026 — and the next report loam hands out is then
 * 2027, in a directory whose highest real ordinal is 3. A legacy name is still
 * a report; it just has no number, and contributes none.
 */
const LEGACY_DATE_NAME = /^\d{4}-\d{2}-\d{2}-/;

/** The ordinal a report's file name claims, or null when the name predates numbering. */
function ordinalOf(file: string): string | null {
  if (LEGACY_DATE_NAME.test(file)) return null;
  return ORDINAL.exec(file)?.[1] ?? null;
}

/**
 * The template's `- Status:` line, matched in the header FIELD BLOCK alone (see
 * `headerFields`). Only the first word is captured: the vocabulary's two
 * composite values carry prose after it (`fixed in 0.2.0-alpha.5`,
 * `superseded by 010`) that an author writes for a reader, and parsing further
 * would make loam an authority on a sentence it does not own.
 */
const STATUS_LINE = /^[ \t]*-[ \t]*Status:[ \t]*(\S+)/m;

/** A fenced block's delimiter line, either spelling. */
const FENCE = /^[ \t]*(`{3,}|~{3,})/;

/**
 * An indented code block's line — the OTHER way markdown quotes code, and the
 * way `loam instructions loam-report` prints its own template (the four-space
 * block in ../../agent/support/report.ts). A fence-only reader counted such a
 * report open off the template's `- Status: open`.
 */
const INDENTED = /^(?: {4}|\t)/;

/** A section heading — the line that ends the header field block. */
const SECTION = /^##[ \t]/;

/**
 * The report's header field block: every line above the first `## ` heading,
 * with quoted code — fenced or indented — dropped.
 *
 * Matched anywhere in the file, `- Status:` convicted the wrong reports twice
 * over. A report that QUOTES the protocol template — which several do, because
 * an agent reporting that the protocol is wrong pastes the protocol — carries a
 * `- Status: open` inside a fence and was counted open however its own header
 * read; and a report whose body discusses a status line later on was read the
 * same way. The status a report claims is a header FIELD, written beside
 * `- Classification:` above the first section, so that is the only place it is
 * read from. An unterminated fence swallows the rest of the file rather than
 * flipping back — the safe direction, since the alternative is reading code as
 * a field.
 *
 * Two shapes defeated the first version of that, and both are the same quoting
 * case: a NESTED fence, where the outer ```` opens and the inner ``` was taken
 * for its close, leaving the quoted block read as fields; and an INDENTED
 * block, which the protocol itself uses and whose indented `## Summary` never
 * ends the header either. So a fence is closed only by a run of the same
 * character at least as long as the one that opened it, and an indented block
 * (four spaces after a blank line, through the blank lines inside it) is
 * dropped whole.
 */
function headerFields(text: string): string {
  const kept: string[] = [];
  let fence: string | null = null;
  let indented = false;
  let afterBlank = true;
  for (const line of text.split(/\r?\n/)) {
    if (fence !== null) {
      const close = FENCE.exec(line)?.[1];
      if (close !== undefined && close[0] === fence[0] && close.length >= fence.length) fence = null;
      continue;
    }
    const blank = line.trim() === "";
    if (indented) {
      if (blank || INDENTED.test(line)) continue;
      indented = false;
    }
    const open = FENCE.exec(line)?.[1];
    if (open !== undefined) {
      fence = open;
      afterBlank = false;
      continue;
    }
    if (afterBlank && INDENTED.test(line)) {
      indented = true;
      continue;
    }
    if (SECTION.test(line)) break;
    kept.push(line);
    afterBlank = blank;
  }
  return kept.join("\n");
}

/** The words a `Status:` line may say that loam can count. */
const STATED: readonly ProblemReportStatus[] = ["open", "sent", "fixed", "superseded"];

/**
 * The ordinal the next report takes: one past the highest present, never one
 * past the count.
 *
 * Those two differ exactly when the directory has a gap or a legacy name in it
 * — which this directory does, since the numbering arrived after eleven
 * reports had already been written — and counting instead of maximising is how
 * a next ordinal starts handing out numbers that are already taken.
 */
function nextOrdinal(entries: readonly ProblemReportEntry[]): string {
  let highest = 0;
  for (const entry of entries) {
    if (entry.ordinal === null) continue;
    const value = Number.parseInt(entry.ordinal, 10);
    if (value > highest) highest = value;
  }
  return String(highest + 1).padStart(3, "0");
}

/**
 * What one report's own `Status:` line says, or `unstated`.
 *
 * Unreadable reads as unstated rather than throwing: a report saved as UTF-16,
 * a file the process cannot open, or a directory somebody named `notes.md` are
 * all things a diagnostic must survive. `doctor` is the command that has to be
 * able to describe a broken repository without becoming the next thing that
 * breaks in it.
 */
async function statusOf(path: string): Promise<ProblemReportStatus> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    // Unreadable is not a state the file claims — it is a state of the read.
    return "unstated";
  }
  const word = STATUS_LINE.exec(headerFields(text))?.[1]?.toLowerCase();
  return STATED.find((known) => known === word) ?? "unstated";
}

/**
 * Read `<root>/loam-reports/`, where `root` is the directory holding the
 * `loam.json` that resolved — the repository the reports were written at the
 * root of — falling back, when nothing parsed, to the directory of the
 * `loam.json` loam FOUND (`doctor.ts` says why that and not the cwd), and to the
 * run directory only when there is no config file anywhere above it.
 *
 * Every `*.md` in the directory is an entry, including a hand-written index
 * page: which files in there are "really" reports is a second naming
 * convention, and inventing one would make loam disagree with a directory
 * listing about what the directory holds. An unnumbered entry contributes
 * nothing to `next`, so an index costs the corpus nothing either.
 */
export async function scanReports(root: string): Promise<ProblemReports> {
  const dir = join(root, REPORTS_DIR);
  let names: string[];
  try {
    names = (await readdir(dir)).filter((name) => name.toLowerCase().endsWith(".md"));
  } catch (error) {
    // Absent is the state of every repository that has never had to write a
    // report, and it is the common one — `present: false`, nothing to say. Any
    // other errno means the directory IS there and this process could not list
    // it, which is a different sentence: the corpus exists and loam cannot see
    // into it, so `present` stays true and the counts stay honestly empty.
    const code = (error as NodeJS.ErrnoException).code;
    const present = code !== "ENOENT" && code !== "ENOTDIR";
    return { dir, present, total: 0, next: "001", entries: [] };
  }

  // Sorted here rather than left in readdir order, which is the filesystem's and
  // differs between one machine and another — and sorted by the ORDINAL the name
  // claims, numerically, because report order is what a reader scanning the list
  // expects and byte order stops being it at exactly the point the widening rule
  // was written for: `1000-…` sorts before `998-…`, so a directory that has
  // passed its thousandth report reads 1000, 1001, 998, 999 (verification
  // 2026-09-04, second pass). Unnumbered names — the shape reports carried before
  // the numbering existed — contribute no ordinal, so they sort last among
  // themselves by name, where a reader looking for "the next one" is not looking.
  const rank = (file: string): number => {
    const ordinal = ordinalOf(file);
    return ordinal === null ? Number.POSITIVE_INFINITY : Number.parseInt(ordinal, 10);
  };
  names.sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0));
  // Read together, like `staleAgentFiles` does: a report corpus is a flat
  // directory of small hand-written files, so there is nothing here worth a
  // concurrency cap, and `Promise.all` preserves the order just established.
  const entries = await Promise.all(names.map(async (file): Promise<ProblemReportEntry> => ({
    file,
    ordinal: ordinalOf(file),
    status: await statusOf(join(dir, file)),
  })));

  return {
    dir,
    present: true,
    total: entries.length,
    next: nextOrdinal(entries),
    entries,
  };
}
