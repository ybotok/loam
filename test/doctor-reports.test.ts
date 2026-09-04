/**
 * `loam doctor` reading the one directory loam prescribes and never opened.
 *
 * The `loam-report` protocol asks a repository to accumulate a corpus under
 * `loam-reports/` — and `validate --all`, `doctor`, `status` and `list`
 * mentioned that directory zero times between them. This suite pins the read:
 * how many reports there are, what state each one claims, and which ordinal the
 * next report takes, which is the number the protocol now tells an agent to ask
 * for before it writes a file.
 *
 * It is STATE and never a finding. A repository with eleven open reports is not
 * a broken repository, so nothing here may move `healthy` — the assertions
 * check that too, because the tempting version of this feature is the one that
 * warns.
 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { REPORTS_DIR } from "../src/core/doctor/reports/scan.js";
import { coherentFixture, makeProject, runLoam, type Project } from "./helpers/harness.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!();
});

/**
 * One report as an author writes it: the template's leading field block, with
 * or without the `Status:` line that arrived after eleven reports already
 * existed.
 */
function reportFile(title: string, status: string | null): string {
  return [
    `# loam problem report: ${title}`,
    "",
    "- Recorded: 2026-09-01T10:00:00+08:00",
    "- Classification: loam-product",
    ...(status === null ? [] : [`- Status: ${status}`]),
    "- Repository role: docs",
    "- loam version: 0.2.0-alpha.5",
    "",
    "## Summary",
    "",
    "Something behaved unexpectedly.",
    "",
  ].join("\n");
}

/**
 * A healthy repo with `loam-reports/` beside its loam.json — beside the CONFIG,
 * not inside the docs repo, because that is where the protocol puts it ("at the
 * current repository root") and where a service checkout's reports actually
 * land.
 */
async function projectWithReports(files: Record<string, string | Uint8Array>): Promise<Project> {
  const project = await makeProject(coherentFixture(), { service: "payment-service" });
  cleanups.push(() => project.destroy());
  await mkdir(join(project.workDir, REPORTS_DIR), { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    await writeFile(join(project.workDir, REPORTS_DIR, name), content);
  }
  return project;
}

describe("doctor counts the problem reports a repository has collected", () => {
  it("reads every report, its ordinal and its status, and says which ordinal is next", async () => {
    const project = await projectWithReports({
      "001-2026-09-01-a.md": reportFile("a", "open"),
      "002-2026-09-02-b.md": reportFile("b", "fixed in 0.2.0-alpha.5"),
      // The name eleven reports here were written under, before the protocol
      // asked for a number. A legacy name is still a report.
      "2026-09-03-legacy.md": reportFile("legacy", null),
      "003-2026-09-03-c.md": reportFile("c", "superseded by 002"),
    });

    const result = await runLoam(project.workDir, "doctor", "--json");

    expect(result.code).toBe(0);
    const report = JSON.parse(result.stdout);
    // Absolute, and beside the loam.json that resolved: the protocol tells an
    // agent to write there, and a repo-relative spelling would leave it to guess
    // which repository's root "relative" meant.
    expect(report.reports.dir).toBe(join(project.workDir, REPORTS_DIR));
    expect(report.reports.present).toBe(true);
    expect(report.reports.total).toBe(4);
    // One past the HIGHEST, not one past the count: this directory holds four
    // reports and three ordinals, and counting would hand out 005 while 004 was
    // still free — the first number a numbering scheme must not get wrong.
    expect(report.reports.next).toBe("004");
    // Sorted by the ordinal the name claims, which IS report order; an
    // unnumbered legacy name has no ordinal and sorts last.
    expect(report.reports.entries).toEqual([
      { file: "001-2026-09-01-a.md", ordinal: "001", status: "open" },
      { file: "002-2026-09-02-b.md", ordinal: "002", status: "fixed" },
      { file: "003-2026-09-03-c.md", ordinal: "003", status: "superseded" },
      { file: "2026-09-03-legacy.md", ordinal: null, status: "unstated" },
    ]);
    // The corpus is state. Reading it must not grade it.
    expect(report.healthy).toBe(true);
    expect(report.findings.map((f: { code: string }) => f.code))
      .not.toContain("doctor.reports-open");
  });

  it("prints one human line with the zero statuses left out", async () => {
    const project = await projectWithReports({
      "001-2026-09-01-a.md": reportFile("a", "open"),
      "002-2026-09-02-b.md": reportFile("b", "fixed in 0.2.0-alpha.5"),
      "2026-09-03-legacy.md": reportFile("legacy", null),
      "003-2026-09-03-c.md": reportFile("c", "superseded by 002"),
    });

    const result = await runLoam(project.workDir, "doctor");

    // `sent 0` is not news; the total always is. The row is read at a glance,
    // and it is the first place `loam-reports/` has ever been mentioned by a
    // command's own output.
    expect(result.out).toContain(
      "  reports       loam-reports/ 4 · open 1 · fixed 1 · superseded 1 · unstated 1 · next 004",
    );
  });

  it("says (none) for a repository that has never had to write one", async () => {
    // The normal repo. `present: false` is not a gap, and `001` is the ordinal
    // the first report takes — the protocol reads that field before it can name
    // the file it is about to create.
    const project = await makeProject(coherentFixture(), { service: "payment-service" });
    cleanups.push(() => project.destroy());

    const json = await runLoam(project.workDir, "doctor", "--json");
    const report = JSON.parse(json.stdout);
    expect(report.reports).toEqual({
      dir: join(project.workDir, REPORTS_DIR),
      present: false,
      total: 0,
      next: "001",
      entries: [],
    });
    expect(report.healthy).toBe(true);

    const human = await runLoam(project.workDir, "doctor");
    expect(human.out).toContain("  reports       (none)");
  });

  it("survives a report it cannot read: unstated, never a crash", async () => {
    // A report is a hand-written file, so `doctor` meets ones it cannot parse.
    // Both shapes are here: bytes that are not UTF-8 (a `Status:` line loam
    // cannot find), and a path that will not open at all. doctor is the command
    // that must describe a broken repository without becoming the next thing
    // that breaks in it.
    const project = await projectWithReports({
      "001-2026-09-01-a.md": reportFile("a", "open"),
      "002-2026-09-04-utf16.md": Buffer.from("- Status: open\n\n# report\n", "utf16le"),
    });
    await mkdir(join(project.workDir, REPORTS_DIR, "003-2026-09-04-unreadable.md"));

    const result = await runLoam(project.workDir, "doctor", "--json");

    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
    const report = JSON.parse(result.stdout);
    expect(report.reports.total).toBe(3);
    expect(report.reports.next).toBe("004");
    expect(report.reports.entries.map((e: { status: string }) => e.status))
      .toEqual(["open", "unstated", "unstated"]);
    expect(report.healthy).toBe(true);
  });

  it("keeps report order past the thousandth report, where file-name order stops being it", async () => {
    // The ordering rationale in `scan.ts` was "with the ordinal in front, name
    // order IS report order" — true only below 1000, which is the one width the
    // widening rule (`\d{3,}`) was written for. Byte order puts `1000-…` before
    // `998-…`, so the list a reader scans for "where am I up to" read 1000,
    // 1001, 998, 999 (verification 2026-09-04, second pass). Sorted by the
    // NUMBER now, so the promise holds at every width.
    const project = await projectWithReports({
      "1000-2026-09-04-c.md": reportFile("c", "open"),
      "998-2026-09-04-a.md": reportFile("a", "open"),
      "1001-2026-09-04-d.md": reportFile("d", "sent"),
      "999-2026-09-04-b.md": reportFile("b", "fixed"),
      // A legacy name contributes no ordinal, and sorts after every numbered
      // report rather than into the middle of them. TWO of them, because two
      // names with no ordinal have to fall back to the name compare — the
      // arithmetic comparator alone yields NaN there and would leave their
      // relative order to readdir, which is the filesystem's.
      "2026-08-02-legacy-b.md": reportFile("legacy b", null),
      "2026-08-01-legacy-a.md": reportFile("legacy a", null),
    });

    const report = JSON.parse((await runLoam(project.workDir, "doctor", "--json")).stdout);
    expect(report.reports.entries.map((e: { file: string }) => e.file)).toEqual([
      "998-2026-09-04-a.md",
      "999-2026-09-04-b.md",
      "1000-2026-09-04-c.md",
      "1001-2026-09-04-d.md",
      "2026-08-01-legacy-a.md",
      "2026-08-02-legacy-b.md",
    ]);
    expect(report.reports.next).toBe("1002");
  });

  it("counts the corpus beside a loam.json it FOUND but could not parse, from a subdirectory", async () => {
    // The case the preflight exists for: `doctor` is what an agent runs when the
    // config may not resolve, and the `loam-report` protocol then tells it to
    // write `loam-reports/<next>-…`. With the root config unparseable the scan
    // fell back to the raw cwd, so from a subdirectory the envelope named the
    // broken loam.json in `config.path` and reported `total 0, next 001` for a
    // directory holding five reports — handing out an ordinal already taken
    // (verification 2026-09-04, second pass).
    const project = await projectWithReports({
      "001-2026-09-01-a.md": reportFile("a", "open"),
      "002-2026-09-02-b.md": reportFile("b", "open"),
    });
    await writeFile(join(project.workDir, "loam.json"), "{ not json\n");
    const sub = join(project.workDir, "sub");
    await mkdir(sub, { recursive: true });

    const report = JSON.parse((await runLoam(sub, "doctor", "--json")).stdout);

    expect(report.config.status).toBe("invalid");
    expect(report.config.path).toBe(join(project.workDir, "loam.json"));
    // Beside the config loam named in the same envelope, never beside the cwd.
    expect(report.reports.dir).toBe(join(project.workDir, REPORTS_DIR));
    expect(report.reports.total).toBe(2);
    expect(report.reports.next).toBe("003");
    // The broken config is still the blocker; the corpus is still only state.
    expect(report.healthy).toBe(false);
    expect(report.findings.map((f: { code: string }) => f.code)).toContain("doctor.config-invalid");
  });

  it("takes an unrecognised status word as unstated rather than inventing a bucket", async () => {
    // A vocabulary loam does not know is not a state loam can count. The
    // alternative — a sixth bucket per synonym somebody types — would make the
    // payload's union open-ended, and every consumer's switch wrong.
    const project = await projectWithReports({
      "007-2026-09-04-wontfix.md": reportFile("wontfix", "wontfix, by agreement"),
      "008-2026-09-04-sent.md": reportFile("sent", "sent"),
    });

    const report = JSON.parse((await runLoam(project.workDir, "doctor", "--json")).stdout);
    expect(report.reports.entries.map((e: { status: string }) => e.status))
      .toEqual(["unstated", "sent"]);
    expect(report.reports.next).toBe("009");
  });

  it("reads the status out of the header block, never out of a quoted template", async () => {
    // A report about the loam-report protocol pastes the protocol, template and
    // all — and that template's own `- Status: open` line then answered for the
    // report. Two shapes here: a report whose header says `sent` above a fenced
    // template saying `open`, and one that carries NO status of its own and
    // quotes the template further down, which used to count as open.
    const quoted = [
      "- Recorded: 2026-09-04T10:00:00+08:00",
      "- Classification: agent-workflow",
      "",
      "## Summary",
      "",
      "The template the protocol prints is:",
      "",
      "```",
      "    - Classification: <one value above>",
      "    - Status: open",
      "```",
      "",
    ].join("\n");
    const project = await projectWithReports({
      "011-2026-09-04-header-sent.md": `${reportFile("sent above a quote", "sent")}${quoted}`,
      "012-2026-09-04-quote-only.md": `# loam problem report: quote only\n\n${quoted}`,
    });

    const report = JSON.parse((await runLoam(project.workDir, "doctor", "--json")).stdout);
    expect(report.reports.entries.map((e: { status: string }) => e.status))
      .toEqual(["sent", "unstated"]);
  });

  it("drops a nested fence and an indented template out of the header block too", async () => {
    // The two quoting shapes a single-boolean fence reader let through, both of
    // them the same case the block exists for. In the first the outer ```` is
    // closed by the inner ```, so the quoted lines read as fields; in the second
    // the template is INDENTED — which is how `loam instructions loam-report`
    // prints it — and its indented `## Summary` never ends the header either.
    // Neither report states a status of its own, so both are unstated.
    const nested = [
      "# loam problem report: the protocol's own fence",
      "",
      "- Recorded: 2026-09-04T10:00:00+08:00",
      "- Classification: agent-workflow",
      "",
      "The markdown the protocol asks for, quoted verbatim:",
      "",
      "````markdown",
      "```",
      "- Status: open",
      "```",
      "````",
      "",
      "## Summary",
      "",
    ].join("\n");
    const indented = [
      "# loam problem report: the protocol's own template",
      "",
      "- Recorded: 2026-09-04T09:00:00+08:00",
      "- Classification: agent-workflow",
      "",
      "The shape the protocol prints, verbatim:",
      "",
      "    - Classification: <one value above>",
      "    - Status: open",
      "",
      "    ## Summary",
      "",
      "## Summary",
      "",
    ].join("\n");
    const project = await projectWithReports({
      "013-2026-09-04-nested-fence.md": nested,
      "014-2026-09-04-indented.md": indented,
      // The control: a header field still answers, quoting or not.
      "015-2026-09-04-stated.md": `${reportFile("stated", "open")}${indented}`,
    });

    const report = JSON.parse((await runLoam(project.workDir, "doctor", "--json")).stdout);
    expect(report.reports.entries.map((e: { status: string }) => e.status))
      .toEqual(["unstated", "unstated", "open"]);
  });
});
