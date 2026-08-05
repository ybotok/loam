/**
 * `loam doctor` on the agent surface: which tools this repo has files for,
 * which files the running binary would write that are not there, and whether
 * AGENTS.md still claims the binary that wrote it.
 *
 * The property every test here defends is the one that makes the feature worth
 * having: DETECTION, NEVER REWRITE. OpenSpec answers this drift with
 * `openspec update`, which regenerates its command and skill files in place and
 * thereby teaches every team that the tool owns files they edited. loam says
 * what is missing and stops — so a run of `doctor` must leave both repos byte
 * for byte as it found them, and no finding may offer to refresh anything.
 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { diagnose } from "../src/core/doctor.js";
import { scaffoldDocs } from "../src/core/docs.js";
import { agentsStampLine } from "../src/core/agents-stamp.js";
import { LOAM_VERSION } from "../src/core/version.js";
import { makeTmpDir, runLoam, treeHashes } from "./helpers/harness.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!();
});

/** A docs repo and an un-wired service repo beside it — the shape `init` expects. */
async function repoPair(): Promise<{ docs: string; svc: string }> {
  const root = await makeTmpDir("loam-agent-surface-");
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const docs = join(root, "docs");
  const svc = join(root, "payment-service");
  await mkdir(svc, { recursive: true });
  await scaffoldDocs(docs);
  return { docs, svc };
}

/** The same pair, wired: `loam init` has run in the service repo. */
async function initialized(): Promise<{ docs: string; svc: string }> {
  const pair = await repoPair();
  const res = await runLoam(pair.svc, "init", "--docs", "../docs", "--service", "payment-service");
  expect(res.code, res.out).toBe(0);
  return pair;
}

const codes = (findings: Array<{ code: string }>): string[] => findings.map((f) => f.code);

describe("doctor reports the agent surface", () => {
  it("says nothing about a repo the current binary would write no new file into", async () => {
    // Silence is the contract: a fully current repo produces no agent-surface
    // finding at all, the same way agentsStaleFinding returns null on a current
    // stamp. A diagnostic that fires on a healthy repo trains people to ignore it.
    const { svc } = await initialized();

    const report = await diagnose(svc);

    expect(codes(report.findings)).not.toContain("doctor.agent-files-missing");
    expect(codes(report.findings)).not.toContain("agents.stale");
    expect(report.agents.tools).toEqual(["claude"]);
    expect(report.agents.missingFiles).toEqual([]);
    expect(report.agents.plannedFiles).toBeGreaterThan(0);
  });

  it("a repo that never asked for skills is not missing them", async () => {
    // §3.7's false positive: `--no-skills` left doctor reporting all six skill
    // files as missing on a repo that was correct the moment it was created.
    // Which deliveries a repo holds is written down nowhere and must not be, so
    // the question is asked of the files.
    const pair = await repoPair();
    expect(
      (await runLoam(pair.svc, "init", "--docs", "../docs", "--service", "payment-service", "--no-skills"))
        .code,
    ).toBe(0);

    const report = await diagnose(pair.svc);

    expect(codes(report.findings)).not.toContain("doctor.agent-files-missing");
    expect(report.agents.missingFiles).toEqual([]);

    // The genuine signal survives: a command file deleted from that same repo
    // is still a held delivery with a hole in it.
    await rm(join(pair.svc, ".claude", "commands", "loam-ship.md"));
    expect((await diagnose(pair.svc)).agents.missingFiles).toEqual([
      ".claude/commands/loam-ship.md",
    ]);
  });

  it("names the files the binary would write that are not here, and stays a warning", async () => {
    // The failure this exists for: a seventh slash command ships, and an
    // already-initialized repo simply does not have it. Nothing else in loam
    // says so.
    const { svc } = await initialized();
    const gone = join(svc, ".claude", "commands", "loam-check.md");
    await rm(gone);

    const report = await diagnose(svc);

    const finding = report.findings.find((f) => f.code === "doctor.agent-files-missing");
    expect(finding).toBeDefined();
    // An out-of-date command set is not a repo where anything refuses to run.
    expect(finding!.severity).toBe("warning");
    expect(report.healthy).toBe(true);
    expect(finding!.message).toContain(".claude/commands/loam-check.md");
    expect(report.agents.missingFiles).toEqual([".claude/commands/loam-check.md"]);
  });

  it("names the flags that actually re-scaffold this repo, and promises only what init does", async () => {
    // `loam init` with no --docs defaults to `.loam-docs` and refuses; a fix
    // that said "re-run loam init" would be safe advice that does nothing. And
    // --tools has to name this repo's tools or a cursor-only repo gets claude
    // files it never asked for while its own stay missing.
    const { svc } = await initialized();
    // Delete ONE file, not the directory: a delivery with no files left is
    // indistinguishable on disk from `init --no-commands`, which is the §3.7
    // false positive, so removing the whole directory now reports nothing.
    await rm(join(svc, ".claude", "commands", "loam-check.md"));

    const report = await diagnose(svc);
    const fix = report.findings.find((f) => f.code === "doctor.agent-files-missing")!.fix;

    // No `--service`: a --docs-less re-run now keeps the committed pointer and
    // spreads the config forward, so repeating the binding would be noise.
    expect(fix).toContain("loam init --docs ../docs --tools claude");
    expect(fix).not.toContain("--service");
    expect(fix).toContain("keeps this repo's service binding");
    // and it promises only detection: nothing is offered up for rewriting
    expect(fix).toContain("leaves every existing one untouched");
    expect(fix).toContain("Nothing is regenerated");
    expect(fix).not.toMatch(/overwrit|replac|refresh|\bupdate\b|--force/i);
  });

  it("believes loam.json's own record of the tools over what is on disk", async () => {
    // `agentTools` is what init writes down, accumulated across runs — it is
    // the only thing that can tell a file missing because the binary grew a
    // command from one missing because nobody ever selected that tool.
    const { svc } = await initialized();
    const config = JSON.parse(await readFile(join(svc, "loam.json"), "utf8"));
    expect(config.agentTools).toEqual(["claude"]);
    await writeFile(
      join(svc, "loam.json"),
      JSON.stringify({ ...config, agentTools: ["claude", "cursor"] }, null, 2) + "\n",
      "utf8",
    );

    const report = await diagnose(svc);

    expect(report.agents.toolsSource).toBe("config");
    expect(report.agents.tools).toEqual(["claude", "cursor"]);
    // claude's files are all there; every one of cursor's is not
    expect(report.agents.missingFiles.every((p) => p.startsWith(".cursor/"))).toBe(true);
    expect(report.agents.missingFiles.length).toBeGreaterThan(0);
  });

  it("drops a recorded id this binary has no registry entry for, and never crashes on one", async () => {
    // parseConfig checks agentTools' shape and not its contents on purpose: a
    // config written by a NEWER loam may name a tool this one has never heard
    // of, and plannedCommandFiles throws on an id it does not know.
    const { svc } = await initialized();
    const config = JSON.parse(await readFile(join(svc, "loam.json"), "utf8"));
    await writeFile(
      join(svc, "loam.json"),
      JSON.stringify({ ...config, agentTools: ["claude", "tool-from-the-future"] }, null, 2) + "\n",
      "utf8",
    );

    const report = await diagnose(svc);

    expect(report.config.status).toBe("valid");
    expect(report.agents.tools).toEqual(["claude"]);
    expect(codes(report.findings)).not.toContain("doctor.agent-files-missing");
  });

  it("falls back to disk when the record names nothing this binary can plan for", async () => {
    const { svc } = await initialized();
    const config = JSON.parse(await readFile(join(svc, "loam.json"), "utf8"));
    await writeFile(
      join(svc, "loam.json"),
      JSON.stringify({ ...config, agentTools: ["tool-from-the-future"] }, null, 2) + "\n",
      "utf8",
    );

    const report = await diagnose(svc);

    expect(report.agents.toolsSource).toBe("disk");
    expect(report.agents.tools).toEqual(["claude"]);
  });

  it("detects the tools from disk when loam.json carries no record of them", async () => {
    // A loam.json written before `agentTools` existed, or one somebody typed by
    // hand, is completely legal and is not itself a finding — the files on disk
    // answer the same question.
    const { svc } = await repoPair();
    const res = await runLoam(
      svc, "init", "--docs", "../docs", "--service", "payment-service", "--tools", "cursor,cline",
    );
    expect(res.code, res.out).toBe(0);
    expect(existsSync(join(svc, ".cursor", "commands"))).toBe(true);
    const { agentTools: _dropped, ...older } = JSON.parse(
      await readFile(join(svc, "loam.json"), "utf8"),
    );
    await writeFile(join(svc, "loam.json"), JSON.stringify(older, null, 2) + "\n", "utf8");

    const report = await diagnose(svc);

    expect(report.agents.tools).toEqual(["cursor", "cline"]);
    expect(report.agents.toolsSource).toBe("disk");
    expect(report.agents.missingFiles).toEqual([]);
    // the absent record is not itself a finding, and neither is the fallback
    expect(codes(report.findings)).not.toContain("doctor.agent-files-missing");
    expect(codes(report.findings)).not.toContain("agents.stale");
  });

  it("treats a repo that has no agent files at all as a choice, not as drift", async () => {
    // `--no-commands --no-skills` is supported. A repo that took it is not
    // behind the binary — it opted out — so there is nothing to report, even
    // though its `.claude/` directory would make init's own scan pick it up.
    const { svc } = await repoPair();
    await mkdir(join(svc, ".claude"), { recursive: true });
    const res = await runLoam(svc, "init", "--docs", "../docs", "--no-commands", "--no-skills");
    expect(res.code, res.out).toBe(0);

    const report = await diagnose(svc);

    expect(report.agents.tools).toEqual([]);
    expect(report.agents.plannedFiles).toBe(0);
    expect(codes(report.findings)).not.toContain("doctor.agent-files-missing");
  });

  it("reads the AGENTS.md stamp out of the DOCS repo and reuses the agents.stale comparison", async () => {
    const { docs, svc } = await initialized();
    await writeFile(
      join(docs, "AGENTS.md"),
      `${agentsStampLine("0.0.1")}\n# Working in this docs repo\n`,
      "utf8",
    );

    const report = await diagnose(svc);

    const finding = report.findings.find((f) => f.code === "agents.stale");
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("warning");
    expect(finding!.message).toContain("written by loam v0.0.1");
    expect(finding!.fix).toContain(join(docs, "AGENTS.md"));
    expect(finding!.fix).toContain(agentsStampLine(LOAM_VERSION));
    expect(report.agents.stamp).toEqual({
      path: join(docs, "AGENTS.md"),
      present: true,
      version: "0.0.1",
      stale: true,
    });
  });

  it("keeps 'no AGENTS.md' and 'an AGENTS.md nobody stamped' apart", async () => {
    const { docs, svc } = await initialized();
    await writeFile(join(docs, "AGENTS.md"), "# Working in this docs repo\n", "utf8");

    const unstamped = await diagnose(svc);
    expect(unstamped.agents.stamp).toEqual({
      path: join(docs, "AGENTS.md"),
      present: true,
      version: null,
      stale: true,
    });
    expect(unstamped.findings.find((f) => f.code === "agents.stale")!.message)
      .toContain("no version stamp");

    await rm(join(docs, "AGENTS.md"));
    const absent = await diagnose(svc);
    // No file is no contract to have drifted — the same silence validate keeps.
    expect(absent.agents.stamp.present).toBe(false);
    expect(absent.agents.stamp.stale).toBe(false);
    expect(codes(absent.findings)).not.toContain("agents.stale");
  });

  it("answers from the repo root, not the directory doctor happens to run in", async () => {
    // Config discovery walks upward, so `loam doctor` in src/deep/ must grade
    // the command files where `init` put them — beside loam.json.
    const { svc } = await initialized();
    const deep = join(svc, "src", "deep");
    await mkdir(deep, { recursive: true });

    const report = await diagnose(deep);

    expect(report.agents.tools).toEqual(["claude"]);
    expect(report.agents.missingFiles).toEqual([]);
  });

  it("writes nothing, in either repo, however much has drifted", async () => {
    const { docs, svc } = await initialized();
    await rm(join(svc, ".claude", "commands", "loam-check.md"));
    await writeFile(join(docs, "AGENTS.md"), `${agentsStampLine("0.0.1")}\n# stale\n`, "utf8");
    const beforeDocs = await treeHashes(docs);
    const beforeSvc = await treeHashes(svc);

    const report = await diagnose(svc);

    expect(codes(report.findings)).toEqual(
      expect.arrayContaining(["doctor.agent-files-missing", "agents.stale"]),
    );
    expect(await treeHashes(docs)).toEqual(beforeDocs);
    expect(await treeHashes(svc)).toEqual(beforeSvc);
  });

  it("prints the surface as state and the drift as a finding with its own fix line", async () => {
    const { svc } = await initialized();
    await rm(join(svc, ".claude", "commands", "loam-check.md"));

    const res = await runLoam(svc, "doctor");

    const lines = res.out.split("\n");
    const agentsLine = lines.find((l) => l.startsWith("  agents "));
    expect(agentsLine).toMatch(
      /^ {2}agents {8}claude \(config\) · \d+ files · 1 missing · \d+ stale · AGENTS\.md v/,
    );
    // The write path is state too, and a clean repo says so.
    expect(lines.find((l) => l.startsWith("  write path"))).toMatch(/^ {2}write path {4}clean$/);
    const findingIndex = lines.findIndex((l) => l.includes("doctor.agent-files-missing"));
    expect(findingIndex).toBeGreaterThan(-1);
    expect(lines[findingIndex]).toMatch(/^ {4}⚠ /);
    expect(lines[findingIndex + 1]).toMatch(/^ {6}fix: \S/);
  });

  it("carries the surface in the --json payload under camelCase keys", async () => {
    const { svc } = await initialized();

    const res = await runLoam(svc, "doctor", "--json");
    const report = JSON.parse(res.stdout);

    expect(res.code).toBe(0);
    expect(report.agents).toMatchObject({
      tools: ["claude"],
      toolsSource: "config",
      missingFiles: [],
      stamp: { present: true, version: LOAM_VERSION, stale: false },
    });
    expect(typeof report.agents.plannedFiles).toBe("number");
  });
});

