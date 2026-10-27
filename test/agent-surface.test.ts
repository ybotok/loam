/**
 * `loam doctor` on the agent surface: which tools this repo has files for,
 * which files the running binary would write that are not there, and whether
 * AGENTS.md still claims the binary that wrote it.
 *
 * The property every test here defends is ownership-aware refresh. Doctor is
 * read-only and explains the state; init may refresh only bytes whose recorded
 * digest still matches, while a human edit revokes that authority.
 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { diagnose } from "../src/core/doctor/doctor.js";
import { scaffoldDocs } from "../src/core/docs.js";
import { agentsStampLine } from "../src/core/agent/agents-stamp.js";
import { plannedCommandFiles } from "../src/core/agent/scaffold.js";
import { LOAM_VERSION } from "../src/core/envelope/version.js";
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

  it("a docs repo is not missing the Copilot instructions file init leaves out of it", async () => {
    // init plans the docs repo itself without that file whatever its profile;
    // doctor planning it anyway would send the repo round a fix that cannot
    // land — re-running init writes nothing, and the warning stays.
    const root = await makeTmpDir("loam-agent-surface-");
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    const res = await runLoam(root, "init", "--docs", ".", "--create", "--tools", "github-copilot");
    expect(res.code, res.out).toBe(0);

    const report = await diagnose(root);

    expect(codes(report.findings)).not.toContain("doctor.agent-files-missing");
    expect(report.agents.missingFiles).toEqual([]);
    expect(report.agents.plannedFiles).toBeGreaterThan(0);
  });

  it("a repo that never asked for skills is not missing them", async () => {
    // §3.7's false positive: `--no-skills` left doctor reporting every skill
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

  it("grades only the workflow subset recorded by the selected profile", async () => {
    const pair = await repoPair();
    const res = await runLoam(
      pair.svc,
      "init",
      "--docs",
      "../docs",
      "--service",
      "payment-service",
      "--agent-profile",
      "service",
    );
    expect(res.code, res.out).toBe(0);

    const report = await diagnose(pair.svc);
    expect(report.agents.profile).toBe("service");
    expect(report.agents.missingFiles).toEqual([]);
    expect(codes(report.findings)).not.toContain("doctor.agent-files-missing");
    expect(existsSync(join(pair.svc, ".claude", "commands", "loam-feature.md"))).toBe(false);
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
    // Existing custom bytes remain sovereign; only manifest-matched generated
    // files may refresh on the re-run.
    expect(fix).toContain("creates files that are absent");
    expect(fix).toContain("unchanged since loam wrote them refresh safely");
    expect(fix).toContain("customized files stay untouched");
    expect(fix).not.toMatch(/overwrit|replac|--force/i);
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
      /^ {2}agents {8}claude · full \(config\) · \d+ files · 1 missing · \d+ stale · AGENTS\.md v/,
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
      profile: "full",
      toolsSource: "config",
      missingFiles: [],
      stamp: { present: true, version: LOAM_VERSION, stale: false },
    });
    expect(typeof report.agents.plannedFiles).toBe("number");
  });
});

describe("doctor.agent-files-stale grades the body, not just the stamp", () => {
  /** Every generated command and skill file `init` wrote into `svc`, absolute. */
  function generatedFiles(svc: string): string[] {
    const planned = plannedCommandFiles(svc, ["claude"]).map((f) => f.path);
    expect(planned.length).toBeGreaterThan(0);
    expect(planned.every((p) => existsSync(p))).toBe(true);
    return planned;
  }

  /** Rewrite one file's stamp to name an older release, then apply `transform` to the result. */
  async function backdate(path: string, transform: (text: string) => string = (t) => t): Promise<void> {
    const text = await readFile(path, "utf8");
    expect(text).toContain(agentsStampLine(LOAM_VERSION));
    const older = text.replace(agentsStampLine(LOAM_VERSION), agentsStampLine("0.0.1"));
    await writeFile(path, transform(older), "utf8");
  }

  const repoRelative = (svc: string, path: string): string =>
    path.slice(svc.length + 1).split(/[\\/]/).join("/");

  it("an older stamp over the body this loam writes is current — an upgrade that changed no pointer is silent", async () => {
    // What every release used to do to every repo of a fleet: the stamp is in
    // the bytes, so a release that did not change a word of a pointer still
    // turned every pointer stale, and the warning was on everywhere, always.
    const { svc } = await initialized();
    for (const path of generatedFiles(svc)) await backdate(path);

    const report = await diagnose(svc);

    expect(report.agents.staleFiles).toEqual([]);
    expect(codes(report.findings)).not.toContain("doctor.agent-files-stale");
  });

  it("the same, checked out with CRLF line endings", async () => {
    // A Windows checkout with core.autocrlf hands back CRLF for a body nobody
    // touched; that is not a body change either.
    const { svc } = await initialized();
    for (const path of generatedFiles(svc)) await backdate(path, (t) => t.replace(/\n/g, "\r\n"));

    expect((await diagnose(svc)).agents.staleFiles).toEqual([]);
  });

  it("an older stamp over a body that is no longer this loam's is stale, and only that file", async () => {
    const { svc } = await initialized();
    const [first, ...rest] = generatedFiles(svc);
    for (const path of rest) await backdate(path);
    await backdate(first!, (t) => `${t}\nRun \`loam validate --all\` twice before anything else.\n`);

    const report = await diagnose(svc);

    expect(report.agents.staleFiles).toEqual([repoRelative(svc, first!)]);
    const finding = report.findings.find((f) => f.code === "doctor.agent-files-stale");
    expect(finding?.severity).toBe("warning");
    expect(finding?.message).toContain(repoRelative(svc, first!));
    expect(finding?.message).toContain("differ from the body");
  });

  it("a file with no stamp at all — the pre-stamp era — is stale", async () => {
    const { svc } = await initialized();
    const [first] = generatedFiles(svc);
    const text = await readFile(first!, "utf8");
    await writeFile(first!, text.replace(`${agentsStampLine(LOAM_VERSION)}\n`, ""), "utf8");

    expect((await diagnose(svc)).agents.staleFiles).toEqual([repoRelative(svc, first!)]);
  });

  it("a customized body under a CURRENT stamp stays quiet: the stamp records that somebody reviewed it", async () => {
    const { svc } = await initialized();
    const [first] = generatedFiles(svc);
    await writeFile(first!, `${await readFile(first!, "utf8")}\nOur team runs the gate twice.\n`, "utf8");

    expect((await diagnose(svc)).agents.staleFiles).toEqual([]);
  });
});


describe("doctor.agents-md-shadowed — a CLAUDE.md that turns the orientation off for Claude Code", () => {
  // Claude Code reads AGENTS.md only when no CLAUDE.md, .claude/CLAUDE.md or
  // CLAUDE.local.md is in the working directory or above it. A team's own
  // CLAUDE.md in the docs repo therefore switched loam's orientation off for
  // every Claude Code session there, under a current stamp and a silent doctor.
  const shadowedFinding = async (svc: string): Promise<{ severity: string; message: string; fix: string } | undefined> =>
    (await diagnose(svc)).findings.find((f) => f.code === "doctor.agents-md-shadowed");

  it("is silent when nothing shadows AGENTS.md", async () => {
    const { svc } = await initialized();
    expect(await shadowedFinding(svc)).toBeUndefined();
  });

  it("warns, naming the file and the one-line fix, for a CLAUDE.md that does not import it", async () => {
    const { docs, svc } = await initialized();
    await writeFile(join(docs, "CLAUDE.md"), "# Our docs repo\n\nRead AGENTS.md first.\n", "utf8");

    const report = await diagnose(svc);
    const finding = report.findings.find((f) => f.code === "doctor.agents-md-shadowed");

    expect(finding?.severity).toBe("warning");
    expect(finding?.message).toContain(join(docs, "CLAUDE.md"));
    expect(finding?.fix).toContain("`@AGENTS.md`");
    // a warning: nothing refuses to run, so the repo stays healthy
    expect(report.healthy).toBe(true);
  });

  it("counts .claude/CLAUDE.md and a personal CLAUDE.local.md the same way", async () => {
    const { docs, svc } = await initialized();
    await mkdir(join(docs, ".claude"), { recursive: true });
    await writeFile(join(docs, ".claude", "CLAUDE.md"), "team notes\n", "utf8");
    await writeFile(join(docs, "CLAUDE.local.md"), "my notes\n", "utf8");

    const finding = await shadowedFinding(svc);

    expect(finding?.message).toContain(join(docs, ".claude", "CLAUDE.md"));
    expect(finding?.message).toContain(join(docs, "CLAUDE.local.md"));
  });

  it("counts a CLAUDE.md above the docs repo, as the host does", async () => {
    const { docs, svc } = await initialized();
    await writeFile(join(docs, "..", "CLAUDE.md"), "workspace notes\n", "utf8");

    // `join` normalises the `..`: the path named is the workspace root's own file
    expect((await shadowedFinding(svc))?.message).toContain(join(docs, "..", "CLAUDE.md"));
  });

  it("is silent when any shadow imports AGENTS.md, in any spelling the host expands", async () => {
    for (const [file, text] of [
      ["CLAUDE.md", "# Docs\n\n@AGENTS.md\n"],
      ["CLAUDE.md", "See @./AGENTS.md for loam.\n"],
      [join(".claude", "CLAUDE.md"), "@../AGENTS.md\n"],
    ] as const) {
      const { docs, svc } = await initialized();
      await mkdir(join(docs, ".claude"), { recursive: true });
      await writeFile(join(docs, file), text, "utf8");
      // a second, unimporting shadow does not matter: the host reads them all
      await writeFile(join(docs, "CLAUDE.local.md"), "my notes\n", "utf8");

      expect(await shadowedFinding(svc), `${file}: ${text}`).toBeUndefined();
    }
  });

  it("is silent for a CLAUDE.md that is a symlink to AGENTS.md", async () => {
    const { docs, svc } = await initialized();
    await symlink("AGENTS.md", join(docs, "CLAUDE.md"));

    expect(await shadowedFinding(svc)).toBeUndefined();
  });

  it("is silent when the docs repo has no AGENTS.md at all — that is the stamp's finding", async () => {
    const { docs, svc } = await initialized();
    await rm(join(docs, "AGENTS.md"));
    await writeFile(join(docs, "CLAUDE.md"), "notes\n", "utf8");

    expect(await shadowedFinding(svc)).toBeUndefined();
  });
});
