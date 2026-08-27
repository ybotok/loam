/**
 * `loam open` — derive an editor workspace from the committed bindings.
 *
 * The command computes a join the docs repo cannot see on its own: each
 * service repo's loam.json points AT the docs repo, so membership is
 * {sibling has loam.json} ∧ {it resolves docsDir to this docs repo}, over a
 * depth-1 scan of the two default roots (beside the docs repo, beside the
 * current repo) or the explicit --root replacements. These tests pin the
 * membership rule, the refusal ladder (binding-duplicate, no-members,
 * invalid-option, already-exists), the never-overwrite contract, the
 * forward-slash workspace spellings, and determinism.
 *
 * makeProject's fixture layout — work/ and docs/ as siblings under one tmp
 * root — is exactly the side-by-side checkout topology the scan assumes, so
 * every case here builds on the one harness.
 */
import { describe, expect, it, afterEach } from "vitest";
import { chmod, readFile, rm, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  makeProject,
  makeTmpDir,
  runLoam,
  treeHashes,
  writeFiles,
  type Project,
} from "./helpers/harness.js";
import { renderWorkspace, workspacePathSpelling } from "../src/core/workspace/render.js";
import { discoverMembers, type WorkspaceMember } from "../src/core/workspace/discover.js";
import { docsDirOf } from "../src/core/kernel/ids/dirs.js";
import { DocsRepoUnavailableError } from "../src/core/repo/state.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!();
});

async function project(
  files: Record<string, string> = {},
  opts: { service?: string } = {},
): Promise<Project> {
  const p = await makeProject(files, opts);
  cleanups.push(() => p.destroy());
  return p;
}

async function throwawayDir(): Promise<string> {
  const dir = await makeTmpDir();
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

/** A sibling checkout beside the fixture's docs/ and work/, bound by loam.json. */
async function sibling(p: Project, name: string, config: Record<string, unknown>): Promise<string> {
  const dir = join(dirname(p.workDir), name);
  await writeFiles(dir, { "loam.json": JSON.stringify(config, null, 2) + "\n" });
  return dir;
}

interface MemberRow {
  path: string;
  folder: string;
  name: string;
  service: string | null;
  via: string;
  root?: string;
}

describe("membership: the committed-binding join", () => {
  it("from a service repo: docs repo, current repo, and a bound sibling — relative forward-slash folders, payload spellings equal the file's", async () => {
    const p = await project({}, { service: "payment-service" });
    // Relative docsDir spelling on purpose: exercises parseConfig resolving it
    // against the candidate's own directory, not against the cwd of the run.
    await sibling(p, "svc-b", { docsDir: "../docs", service: "svc-b" });

    const res = await runLoam(p.workDir, "open", "--json");
    expect(res.code).toBe(0);
    const payload = JSON.parse(res.stdout);
    expect(payload.ok).toBe(true);
    expect(payload.command).toBe("open");
    expect(payload.written).toBe(true);
    expect(payload.out).toBe(join(p.workDir, "loam.code-workspace"));
    expect(payload.scannedRoots).toEqual([dirname(p.docsDir)]);

    const members = payload.members as MemberRow[];
    expect(members.map((m) => m.via)).toEqual(["docs-repo", "current-repo", "scan"]);
    expect(members.map((m) => m.name)).toEqual(["docs", "payment-service", "svc-b"]);
    expect(members.map((m) => m.folder)).toEqual(["../docs", ".", "../svc-b"]);
    expect(members[1]!.service).toBe("payment-service");
    expect(members[2]!.root).toBe(dirname(p.docsDir));
    // The additive keys are pinned even when empty, so a consumer can rely on
    // their presence from the first release.
    expect(payload.unreadableRoots).toEqual([]);
    expect(payload.skipped).toEqual([]);

    const written = JSON.parse(await readFile(payload.out, "utf8")) as {
      folders: { name: string; path: string }[];
    };
    // The payload's `folder` is the file's `path`, byte for byte — no
    // consumer should ever have to re-derive the relative spelling.
    expect(written.folders).toEqual(members.map((m) => ({ name: m.name, path: m.folder })));
    for (const folder of written.folders) expect(folder.path).not.toContain("\\");
  });

  it("from the docs repo itself: the bound sibling arrives via scan, and the docs repo is one member, not two", async () => {
    const p = await project({}, { service: "payment-service" });
    await p.write("loam.json", JSON.stringify({ docsDir: "." }, null, 2) + "\n");

    const res = await runLoam(p.docsDir, "open", "--json");
    expect(res.code).toBe(0);
    const payload = JSON.parse(res.stdout);
    const members = payload.members as MemberRow[];
    // work/ is bound to this docs repo through the config makeProject wrote.
    expect(members.map((m) => m.via)).toEqual(["docs-repo", "scan"]);
    expect(members[1]!.name).toBe("payment-service");
    expect(members[1]!.path).toBe(p.workDir);
    expect(existsSync(join(p.docsDir, "loam.code-workspace"))).toBe(true);
  });

  it("a sibling with a corrupt loam.json is reported in skipped[], never a member, and never fatal", async () => {
    const p = await project({}, { service: "payment-service" });
    const dir = join(dirname(p.workDir), "broken");
    await writeFiles(dir, { "loam.json": "not json {" });
    // The other unreadable shape: loam.json as a DIRECTORY — the read fails
    // with an errno instead of a parse error, and must land in skipped[] the
    // same way, not escape as internal.
    const dirShaped = join(dirname(p.workDir), "dir-shaped");
    await writeFiles(dirShaped, { "loam.json/.keep": "" });
    // And the same shape on a repo that is already a MEMBER: the docs repo
    // stays a member no matter what its own loam.json looks like, and one
    // checkout must never be reported both a member and skipped.
    await p.write("loam.json/.keep", "");

    const res = await runLoam(p.workDir, "open", "--json");
    expect(res.code).toBe(0);
    const payload = JSON.parse(res.stdout);
    const memberPaths = (payload.members as MemberRow[]).map((m) => m.path);
    expect(memberPaths).not.toContain(dir);
    expect(memberPaths).not.toContain(dirShaped);
    const skippedPaths = (payload.skipped as { path: string }[]).map((s) => s.path);
    expect(skippedPaths).toEqual([join(dir, "loam.json"), join(dirShaped, "loam.json")]);
  });

  it("a sibling bound to a docs dir that does not exist is silently not a member — a missing fleet is not this fleet", async () => {
    const p = await project({}, { service: "payment-service" });
    await sibling(p, "adrift", { docsDir: "./no-such-docs", service: "adrift-svc" });

    const res = await runLoam(p.workDir, "open", "--json");
    expect(res.code).toBe(0);
    const payload = JSON.parse(res.stdout);
    expect((payload.members as MemberRow[]).map((m) => m.name)).toEqual(["docs", "payment-service"]);
    // Silent, not skipped: the binding READ fine — it just names another
    // (absent) fleet, which is a fact about that checkout, not a defect here.
    expect(payload.skipped).toEqual([]);
  });

  it("the human view names the workspace, each member with its provenance, and every skipped binding", async () => {
    const p = await project({}, { service: "payment-service" });
    await sibling(p, "svc-b", { docsDir: "../docs", service: "svc-b" });
    const broken = join(dirname(p.workDir), "broken");
    await writeFiles(broken, { "loam.json": "not json {" });

    const res = await runLoam(p.workDir, "open");
    expect(res.code).toBe(0);
    expect(res.out).toContain(`workspace: ${join(p.workDir, "loam.code-workspace")} (3 folders)`);
    expect(res.out).toContain("docs  ../docs  (docs repo)");
    expect(res.out).toContain("payment-service  .  (this repo)");
    expect(res.out).toContain(`svc-b  ../svc-b  (found under ${dirname(p.workDir)})`);
    expect(res.out).toContain(`! skipped ${join(broken, "loam.json")}:`);
  });
});

describe("the refusal ladder", () => {
  it("no-members: from the docs repo with no bound checkout — a foreign-bound sibling does not count, and nothing is written", async () => {
    const p = await project();
    await p.write("loam.json", JSON.stringify({ docsDir: "." }, null, 2) + "\n");
    // Unbind the fixture's own work/ so only the docs repo remains…
    await rm(join(p.workDir, "loam.json"));
    // …and plant a sibling bound to a DIFFERENT (existing) docs dir: the
    // realpath join, not mere loam.json presence, decides membership.
    const root = dirname(p.docsDir);
    await writeFiles(join(root, "foreign"), {
      "loam.json": JSON.stringify({ docsDir: "./fdocs" }, null, 2) + "\n",
      "fdocs/.keep": "",
    });
    // A sibling whose binding will not parse must ride the refusal message:
    // a hand-edited loam.json is the likeliest reason the scan came up
    // empty, and "pass --root" is the wrong fix for it.
    const corrupt = join(root, "unparsable");
    await writeFiles(corrupt, { "loam.json": "{ trailing-comma: yes, }" });

    const before = await treeHashes(root);
    const res = await runLoam(p.docsDir, "open", "--json");
    expect(res.code).toBe(1);
    const payload = JSON.parse(res.stdout);
    expect(payload.ok).toBe(false);
    expect(payload.error.code).toBe("no-members");
    expect(payload.error.message).toContain(root);
    expect(payload.error.message).toContain(join(corrupt, "loam.json"));
    expect(await treeHashes(root)).toEqual(before);
  });

  it("binding-duplicate: two checkouts declaring one service — both paths named, nothing written", async () => {
    const p = await project({}, { service: "payment-service" });
    const a = await sibling(p, "dup-a", { docsDir: "../docs", service: "svc-dup" });
    const b = await sibling(p, "dup-b", { docsDir: "../docs", service: "svc-dup" });

    const before = await treeHashes(dirname(p.workDir));
    const res = await runLoam(p.workDir, "open", "--json");
    expect(res.code).toBe(1);
    const payload = JSON.parse(res.stdout);
    expect(payload.error.code).toBe("binding-duplicate");
    expect(payload.error.message).toContain("svc-dup");
    expect(payload.error.message).toContain(a);
    expect(payload.error.message).toContain(b);
    expect(await treeHashes(dirname(p.workDir))).toEqual(before);
  });

  it("already-exists: the workspace file is never silently overwritten; --force is the overwrite", async () => {
    const p = await project({}, { service: "payment-service" });
    const out = join(p.workDir, "loam.code-workspace");
    const mine = "{ \"folders\": \"hand-edited\" }\n";
    await writeFiles(p.workDir, { "loam.code-workspace": mine });

    const refused = await runLoam(p.workDir, "open", "--json");
    expect(refused.code).toBe(1);
    expect(JSON.parse(refused.stdout).error.code).toBe("already-exists");
    expect(await readFile(out, "utf8")).toBe(mine);

    const forced = await runLoam(p.workDir, "open", "--force", "--json");
    expect(forced.code).toBe(0);
    const written = JSON.parse(await readFile(out, "utf8")) as { folders: unknown[] };
    expect(written.folders).toHaveLength(2);
  });

  it("--out that is a directory: already-exists without --force, invalid-option with it — never an internal escape", async () => {
    const p = await project({}, { service: "payment-service" });
    // A directory wearing the target's name. The "wx" probe answers EEXIST
    // and recommends --force — so the forced write's EISDIR must land as a
    // refusal naming the path, not as the internal catch-all one line after
    // the remedy was suggested.
    await mkdir(join(p.workDir, "loam.code-workspace"));

    const plain = await runLoam(p.workDir, "open", "--json");
    expect(plain.code).toBe(1);
    expect(JSON.parse(plain.stdout).error.code).toBe("already-exists");

    const forced = await runLoam(p.workDir, "open", "--force", "--json");
    expect(forced.code).toBe(1);
    const payload = JSON.parse(forced.stdout);
    expect(payload.error.code).toBe("invalid-option");
    expect(payload.error.message).toContain(join(p.workDir, "loam.code-workspace"));
  });

  it("preamble: no loam.json refuses no-config; a docsDir pointing at nothing refuses docs-missing", async () => {
    const bare = await throwawayDir();
    const none = await runLoam(bare, "open", "--json");
    expect(none.code).toBe(1);
    expect(JSON.parse(none.stdout).error.code).toBe("no-config");

    const p = await project({}, { service: "payment-service" });
    await rm(p.docsDir, { recursive: true });
    const gone = await runLoam(p.workDir, "open", "--json");
    expect(gone.code).toBe(1);
    expect(JSON.parse(gone.stdout).error.code).toBe("docs-missing");
  });
});

describe("--out and --root", () => {
  it("--out is honoured; --out into a directory that does not exist refuses invalid-option and writes nothing", async () => {
    const p = await project({}, { service: "payment-service" });
    await mkdir(join(p.workDir, "ws"));
    const res = await runLoam(p.workDir, "open", "--out", join("ws", "fleet.code-workspace"), "--json");
    expect(res.code).toBe(0);
    const out = join(p.workDir, "ws", "fleet.code-workspace");
    expect(JSON.parse(res.stdout).out).toBe(out);
    expect(existsSync(out)).toBe(true);

    const bad = await runLoam(p.workDir, "open", "--out", join("nope", "x.code-workspace"), "--json");
    expect(bad.code).toBe(1);
    expect(JSON.parse(bad.stdout).error.code).toBe("invalid-option");
    expect(existsSync(join(p.workDir, "nope"))).toBe(false);
  });

  it("--root REPLACES the default roots: the remote sibling appears, the default one disappears", async () => {
    const p = await project({}, { service: "payment-service" });
    await sibling(p, "svc-local", { docsDir: "../docs", service: "svc-local" });
    const elsewhere = await throwawayDir();
    // Absolute docsDir here on purpose — a checkout far from the docs repo
    // has no relative spelling, and the join must still recognise it.
    await writeFiles(join(elsewhere, "svc-remote"), {
      "loam.json": JSON.stringify({ docsDir: p.docsDir, service: "svc-remote" }, null, 2) + "\n",
    });

    const defaults = await runLoam(p.workDir, "open", "--json");
    const defaultNames = (JSON.parse(defaults.stdout).members as MemberRow[]).map((m) => m.name);
    expect(defaultNames).toContain("svc-local");
    expect(defaultNames).not.toContain("svc-remote");

    const rooted = await runLoam(
      p.workDir, "open", "--root", elsewhere, "--force", "--json",
    );
    expect(rooted.code).toBe(0);
    const payload = JSON.parse(rooted.stdout);
    expect(payload.scannedRoots).toEqual([elsewhere]);
    const members = payload.members as MemberRow[];
    const names = members.map((m) => m.name);
    expect(names).toContain("svc-remote");
    expect(names).not.toContain("svc-local");
    // The current repo stays a member on its own committed binding — --root
    // narrows the SCAN, never the always-members.
    expect(members.map((m) => m.via)).toEqual(["docs-repo", "current-repo", "scan"]);
    expect(members[2]!.root).toBe(elsewhere);
  });

  it("--root naming a file refuses invalid-option", async () => {
    const p = await project({}, { service: "payment-service" });
    const file = join(dirname(p.workDir), "afile");
    await writeFiles(dirname(p.workDir), { afile: "not a directory\n" });
    const res = await runLoam(p.workDir, "open", "--root", file, "--json");
    expect(res.code).toBe(1);
    const payload = JSON.parse(res.stdout);
    expect(payload.error.code).toBe("invalid-option");
    expect(payload.error.message).toContain(file);
  });

  it("an explicit --root the scan cannot list is refused — 'I could not look' must never answer as an empty scan", async () => {
    // Guarded on the UID, not on the outcome: root ignores mode bits, so for
    // root the case is unstageable and skipping is honest — but on any other
    // host an exit 0 here is exactly the silent-degrade bug this pins, and an
    // outcome guard would wave it through.
    if (process.getuid?.() === 0) return;
    const p = await project({}, { service: "payment-service" });
    const sealed = await throwawayDir();
    await chmod(sealed, 0o000);
    try {
      const res = await runLoam(p.workDir, "open", "--root", sealed, "--json");
      expect(res.code).toBe(1);
      const payload = JSON.parse(res.stdout);
      expect(payload.error.code).toBe("invalid-option");
      expect(payload.error.message).toContain(sealed);
      expect(existsSync(join(p.workDir, "loam.code-workspace"))).toBe(false);
    } finally {
      await chmod(sealed, 0o755);
    }
  });

  it("an unlistable root is recorded in the discovery, not swallowed — the root-proof half of the same rule", async () => {
    // The permission shape above cannot be staged as root, but ENOTDIR can:
    // readdir over a FILE fails for any uid. The command's own --root probe
    // refuses a file first, so the record is pinned at the unit seam — it is
    // what the CLI refusal and both views are built from.
    const p = await project({}, { service: "payment-service" });
    const file = join(dirname(p.workDir), "roots-file");
    await writeFiles(dirname(p.workDir), { "roots-file": "not a directory\n" });

    const discovery = await discoverMembers({
      docsDir: p.docsDir,
      configRoot: p.workDir,
      roots: [file],
    });
    expect(discovery.unreadableRoots).toHaveLength(1);
    expect(discovery.unreadableRoots[0]!.root).toBe(file);
    expect(discovery.unreadableRoots[0]!.problem).not.toBe("");
    // The always-members survive an unlistable root; only the scan is lost.
    expect(discovery.members.map((m) => m.via)).toEqual(["docs-repo", "current-repo"]);
  });
});

describe("discoverMembers — fail closed", () => {
  it("refuses a docs repo whose identity cannot be established, instead of scanning against a guess", async () => {
    // Reachable only as a race — docsRepoReady passed and the repo vanished
    // before the scan — so it is pinned at the unit seam: a guessed identity
    // would match no candidate and answer no-members about a fleet nobody
    // actually scanned.
    const tmp = await throwawayDir();
    await expect(
      discoverMembers({ docsDir: docsDirOf(join(tmp, "vanished")), configRoot: tmp }),
    ).rejects.toThrow(DocsRepoUnavailableError);
  });
});

describe("determinism", () => {
  it("two consecutive runs produce byte-identical workspace files", async () => {
    const p = await project({}, { service: "payment-service" });
    await sibling(p, "svc-b", { docsDir: "../docs", service: "svc-b" });
    const out = join(p.workDir, "loam.code-workspace");

    expect((await runLoam(p.workDir, "open", "--json")).code).toBe(0);
    const first = await readFile(out, "utf8");
    expect((await runLoam(p.workDir, "open", "--force", "--json")).code).toBe(0);
    expect(await readFile(out, "utf8")).toBe(first);
    expect(first.endsWith("\n")).toBe(true);
  });
});

describe("renderWorkspace — the pure spelling rules", () => {
  const member = (path: string, name: string): WorkspaceMember => ({
    path,
    name,
    service: null,
    via: "docs-repo",
  });

  it("spells the member in the output file's own directory as '.', and siblings relatively", () => {
    const { text, folders } = renderWorkspace(
      [member("/repos/work", "work"), member("/repos/docs", "docs")],
      "/repos/work/loam.code-workspace",
    );
    expect(folders.map((f) => f.path)).toEqual([".", "../docs"]);
    expect(JSON.parse(text)).toEqual({
      folders: [
        { name: "work", path: "." },
        { name: "docs", path: "../docs" },
      ],
    });
    expect(text.endsWith("\n")).toBe(true);
  });

  it("normalises win32-shaped relatives to forward slashes, and falls back to the absolute path across drives", () => {
    // The cross-drive shape only the win32 `relative()` produces: no `..`
    // chain crosses drive letters, so the answer comes back absolute. The
    // POSIX platform module can never be steered into producing it, which is
    // why the spelling rule takes `rel` as data.
    expect(workspacePathSpelling("..\\docs", "C:\\repos\\docs")).toBe("../docs");
    expect(workspacePathSpelling("D:\\other\\svc", "D:\\other\\svc")).toBe("D:/other/svc");
    expect(workspacePathSpelling("", "/repos/work")).toBe(".");
  });
});
