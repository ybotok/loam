/**
 * Tests for the sources digest itself (src/core/provenance/stamp.ts and walk.ts) — what the walk
 * counts as source, what it refuses to follow, and what the stamp remembers.
 *
 * `sources_digest` is the only mechanical tie between a document and the code
 * it describes, so the walk's edges are the trust boundary, not an
 * implementation detail:
 *
 *  - what it must NOT hash: build output the repository already ignores, and
 *    `node_modules`. Both move without anybody writing code, and a staleness
 *    warning that fires on a schedule is one people learn to close;
 *  - what it must NOT skip in silence: a symlink. Before the walk had a branch
 *    for one, a symlinked file — and a whole subtree behind a symlinked
 *    directory — fell between readdir's isFile()/isDirectory() arms and left
 *    the digest with nothing said. Rewrite the target and `validate` still
 *    printed "sources unchanged";
 *  - what the empty expansion is worth: the same sentence to `vouch` (which
 *    refuses) and to `validate`, so a green run and a refusing one cannot
 *    disagree about one document;
 *  - what a stale stamp can name: the paths that actually moved, not the
 *    `sources` entries the author wrote themselves;
 *  - and that two service repos vouching into one shared docs repo do not take
 *    each other's stamps back out.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { execFile } from "node:child_process";
import { mkdir, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { coherentFixture, makeProject, makeTmpDir, runLoam, TEST_IDENTITY, writeFiles, type Project } from "./helpers/harness.js";
import { parseFrontmatter, stringField } from "../src/core/document/frontmatter.js";
import { expandSourceFiles, sourcesDigest } from "../src/core/provenance/stamp.js";
import { vouch } from "../src/commands/vouch/run.js";

const run = promisify(execFile);

/**
 * A hook that fires right after a file is read (the passthrough-wrapper pattern
 * from vouch-rollback's `rename` mock). The harness runs commands in-process, so
 * vouch's own reads go through this module graph's node:fs/promises — which is
 * the only way to land a concurrent write in the exact window the race guard
 * covers, between the read a stamp is computed from and the swap that commits
 * it. Sleeping and hoping tests the scheduler, not the guard. Passthrough while
 * `afterRead` is unset.
 */
const fsHook = vi.hoisted(() => ({
  afterRead: undefined as undefined | ((path: string) => Promise<void>),
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    readFile: async (path: unknown, ...rest: unknown[]) => {
      const read = (actual.readFile as (...a: unknown[]) => Promise<unknown>)(path, ...rest);
      const content = await read;
      if (fsHook.afterRead !== undefined) await fsHook.afterRead(String(path));
      return content;
    },
  };
});

afterEach(() => {
  fsHook.afterRead = undefined;
});

const SVC = "payment-service";
const SPEC = `services/${SVC}/spec.md`;

/** A throwaway repo holding exactly these files. */
async function repoOf(files: Record<string, string>): Promise<string> {
  const dir = await makeTmpDir("loam-digest-");
  await writeFiles(dir, files);
  return dir;
}

/** The same, turned into a git checkout — no commits needed, check-ignore reads the worktree. */
async function gitRepoOf(files: Record<string, string>): Promise<string> {
  const dir = await repoOf(files);
  await run("git", ["init", "-q", "."], { cwd: dir });
  return dir;
}

describe("what the walk leaves out", () => {
  it("does not hash what the repository itself ignores — build output must not age a doc nobody edited", async () => {
    const dir = await gitRepoOf({ ".gitignore": "src/generated/\n", "src/keep/a.ts": "a\n" });
    try {
      const before = await sourcesDigest(dir, ["src/"]);
      expect(before.files).toEqual(["src/keep/a.ts"]);

      // Exactly what a CI run does: writes generated code under a listed
      // directory, touching nothing a person wrote.
      await mkdir(join(dir, "src/generated"), { recursive: true });
      await writeFile(join(dir, "src/generated/x.js"), "// generated\n", "utf8");

      const after = await sourcesDigest(dir, ["src/"]);
      expect(after.digest, "an ignored file must not move the stamp").toBe(before.digest);
      expect(after.files).toEqual(["src/keep/a.ts"]);
      // And nothing is quietly hidden either: it is not "skipped", it is not
      // this repository's own content at all.
      expect(after.skipped).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("still hashes everything when there is no git to ask — a missing exclusion is noise, an invented one is a blind spot", async () => {
    // The same tree with the same .gitignore, minus the checkout. The fallback
    // has to be "hash it": loam must never drop a file from a digest a person
    // is going to sign on the strength of a guess.
    const dir = await repoOf({ ".gitignore": "src/generated/\n", "src/keep/a.ts": "a\n" });
    try {
      const before = await sourcesDigest(dir, ["src/"]);
      await mkdir(join(dir, "src/generated"), { recursive: true });
      await writeFile(join(dir, "src/generated/x.js"), "// generated\n", "utf8");
      const after = await sourcesDigest(dir, ["src/"]);
      expect(after.digest).not.toBe(before.digest);
      expect(after.files).toEqual(["src/generated/x.js", "src/keep/a.ts"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("skips node_modules unconditionally, git or no git", async () => {
    const dir = await repoOf({ "src/a.ts": "a\n" });
    try {
      const before = await sourcesDigest(dir, ["src/"]);
      await mkdir(join(dir, "src/node_modules/pkg"), { recursive: true });
      await writeFile(join(dir, "src/node_modules/pkg/index.js"), "module.exports = 1;\n", "utf8");
      const after = await sourcesDigest(dir, ["src/"]);
      expect(after.digest).toBe(before.digest);
      expect(after.files).toEqual(["src/a.ts"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("still moves when a real file moves — the exclusions must not have switched the check off", async () => {
    const dir = await gitRepoOf({ ".gitignore": "src/generated/\n", "src/keep/a.ts": "a\n" });
    try {
      const before = await sourcesDigest(dir, ["src/"]);
      await writeFile(join(dir, "src/keep/a.ts"), "a changed\n", "utf8");
      expect((await sourcesDigest(dir, ["src/"])).digest).not.toBe(before.digest);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("symlinks under a listed directory", () => {
  it("follows one that stays inside the repo — it is content the doc was written from", async () => {
    const dir = await repoOf({ "src/real/a.ts": "a\n" });
    try {
      const before = await sourcesDigest(dir, ["src/"]);
      expect(before.files).toEqual(["src/real/a.ts"]);

      await symlink(join(dir, "src/real/a.ts"), join(dir, "src/link.ts"));
      const after = await sourcesDigest(dir, ["src/"]);
      // The link's own spelling is what the author sees, so that is the path in
      // the digest; the bytes come from the target.
      expect(after.files).toEqual(["src/link.ts", "src/real/a.ts"]);
      expect(after.digest).not.toBe(before.digest);
      expect(after.skipped).toEqual([]);

      // And it is watched: editing through the link ages the stamp.
      await writeFile(join(dir, "src/real/a.ts"), "b\n", "utf8");
      expect((await sourcesDigest(dir, ["src/"])).digest).not.toBe(after.digest);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("walks a symlinked directory, and does not loop when it points at an ancestor", async () => {
    const dir = await repoOf({ "src/real/deep/a.ts": "a\n" });
    try {
      await symlink(join(dir, "src/real"), join(dir, "src/mirror"));
      // A link back up the tree: without the realpath visited-set this walk
      // never returns.
      await symlink(join(dir, "src"), join(dir, "src/real/up"));
      const { files, skipped } = await sourcesDigest(dir, ["src/"]);
      expect(files).toContain("src/real/deep/a.ts");
      expect(files).toContain("src/mirror/deep/a.ts");
      // The cycle is not a warning: everything behind it is already hashed under
      // another spelling, so nothing has stopped being watched.
      expect(skipped).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("reports one that leaves the repo instead of dropping it — the stamp says nothing about what is behind it", async () => {
    const outsideDir = await makeTmpDir("loam-digest-outside-");
    const dir = await repoOf({ "src/a.ts": "a\n" });
    try {
      await writeFile(join(outsideDir, "vendored.ts"), "// not ours\n", "utf8");
      await symlink(join(outsideDir, "vendored.ts"), join(dir, "src/external.ts"));

      const { files, skipped } = await sourcesDigest(dir, ["src/"]);
      expect(files).toEqual(["src/a.ts"]);
      expect(skipped).toEqual([
        { path: "src/external.ts", reason: "a symlink whose target is outside this repository" },
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
      await rm(outsideDir, { recursive: true, force: true });
    }
  });

  it("reports a dangling one the same way", async () => {
    const dir = await repoOf({ "src/a.ts": "a\n" });
    try {
      await symlink(join(dir, "src/never-existed.ts"), join(dir, "src/broken.ts"));
      const { files, skipped } = await sourcesDigest(dir, ["src/"]);
      expect(files).toEqual(["src/a.ts"]);
      expect(skipped.map((s) => s.path)).toEqual(["src/broken.ts"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("surfaces the skip through validate and through vouch, rather than only in the walk", async () => {
    const outsideDir = await makeTmpDir("loam-digest-outside-");
    const files = coherentFixture();
    files[SPEC] = `---\nservice: ${SVC}\nstatus: draft\nowner: payments-team\nsources:\n  - src/\n---\n\n# ${SVC}\n`;
    const p = await makeProject(files, { service: SVC });
    try {
      await writeFiles(p.workDir, { "src/a.ts": "a\n" });
      await writeFile(join(outsideDir, "vendored.ts"), "// not ours\n", "utf8");
      await symlink(join(outsideDir, "vendored.ts"), join(p.workDir, "src/external.ts"));

      const validated = await runLoam(p.workDir, "validate", "--json");
      // A warning, not a gate: the doc may be perfectly right about the code
      // behind that link. What loam can say is that it is not watching it.
      expect(validated.code).toBe(0);
      const finding = JSON.parse(validated.stdout).targets[0].findings.find(
        (f: { code: string }) => f.code === "sources.skipped",
      );
      expect(finding.severity).toBe("warn");
      expect(finding.details).toEqual(["src/external.ts — a symlink whose target is outside this repository"]);

      // The person doing the vouching is the one who most needs to know.
      const vouched = await runLoam(p.workDir, "vouch", "--yes", "--json");
      expect(vouched.code).toBe(0);
      expect(JSON.parse(vouched.stdout).skipped).toEqual([
        { path: "src/external.ts", reason: "a symlink whose target is outside this repository" },
      ]);
      expect((await runLoam(p.workDir, "vouch", "--yes")).out).toContain("went unhashed");
    } finally {
      await p.destroy();
      await rm(outsideDir, { recursive: true, force: true });
    }
  });
});

describe("an expansion that covers nothing", () => {
  it("is one answer both commands give — validate can now say what vouch refuses over", async () => {
    // A directory that exists and holds only entries the walk leaves out. The
    // paths "resolve"; the digest would be taken over nothing and read as
    // current forever. Before the expansion was exported, `validate` went green
    // here and the very next `vouch` refused, with nothing in the green run to
    // predict it.
    const files = coherentFixture();
    files[SPEC] = `---\nservice: ${SVC}\nstatus: draft\nowner: payments-team\nsources:\n  - src/empty/\n---\n\n# ${SVC}\n`;
    const p = await makeProject(files, { service: SVC });
    try {
      await writeFiles(p.workDir, { "src/empty/.gitkeep": "" });

      const expansion = await expandSourceFiles(p.workDir, ["src/empty/"], SVC);
      expect(expansion.files).toEqual([]);
      expect(expansion.skipped).toEqual([]);
      expect(expansion.empty).toBeDefined();

      const res = await runLoam(p.workDir, "vouch", "--yes", "--json");
      expect(res.code).toBe(1);
      const json = JSON.parse(res.stdout);
      expect(json.error.code).toBe("sources-absent");
      // The same words, from the same definition — not two descriptions of one
      // document that an author has to reconcile.
      expect(json.error.message).toBe(expansion.empty);
    } finally {
      await p.destroy();
    }
  });

  it("carries no message when the sources do cover something", async () => {
    const dir = await repoOf({ "src/a.ts": "a\n" });
    try {
      const expansion = await expandSourceFiles(dir, ["src/"], SVC);
      expect(expansion.files).toEqual(["src/a.ts"]);
      expect(expansion.empty).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("what sources.stale names", () => {
  /** A vouched project: payment-service's own repo, sources: src/, already stamped. */
  async function vouchedProject(repoFiles: Record<string, string>): Promise<Project> {
    const files = coherentFixture();
    files[SPEC] = `---\nservice: ${SVC}\nstatus: draft\nowner: payments-team\nsources:\n  - src/\n---\n\n# ${SVC}\n`;
    const p = await makeProject(files, { service: SVC });
    await writeFiles(p.workDir, repoFiles);
    const res = await runLoam(p.workDir, "vouch", "--yes");
    expect(res.code, res.out).toBe(0);
    return p;
  }

  const staleFinding = async (p: Project): Promise<{ severity: string; message: string; details: string[] }> => {
    const res = await runLoam(p.workDir, "validate", "--json");
    // Staleness is a signal, never a gate.
    expect(res.code).toBe(0);
    return JSON.parse(res.stdout).targets[0].findings.find((f: { code: string }) => f.code === "sources.stale");
  };

  it("stamps the per-file index beside the digest, so the next run has something to compare against", async () => {
    const p = await vouchedProject({ "src/a.ts": "a\n", "src/deep/b.ts": "b\n" });
    try {
      const stamped = stringField(parseFrontmatter(await p.read(SPEC)), "sources_files")!;
      expect(stamped.split("\n")).toHaveLength(2);
      expect(stamped).toMatch(/^[0-9a-f]{16} {2}src\/a\.ts$/m);
      expect(stamped).toMatch(/^[0-9a-f]{16} {2}src\/deep\/b\.ts$/m);
    } finally {
      await p.destroy();
    }
  });

  it("names the one file that changed, not the directory the author listed", async () => {
    const p = await vouchedProject({ "src/a.ts": "a\n", "src/deep/b.ts": "b\n" });
    try {
      await writeFile(join(p.workDir, "src/a.ts"), "a, edited\n", "utf8");
      const stale = await staleFinding(p);
      expect(stale.severity).toBe("warn");
      expect(stale.details).toEqual(["changed  src/a.ts"]);
      // The old behaviour — repeating `sources:` back — answered a question
      // nobody asked: the author wrote that list.
      expect(stale.details).not.toContain("src/");
      expect(stale.message).toContain("1 path(s) moved");
    } finally {
      await p.destroy();
    }
  });

  it("lists what a deleted subdirectory took with it, and what arrived", async () => {
    const p = await vouchedProject({ "src/a.ts": "a\n", "src/deep/b.ts": "b\n", "src/deep/c.ts": "c\n" });
    try {
      await rm(join(p.workDir, "src/deep"), { recursive: true, force: true });
      await writeFile(join(p.workDir, "src/new.ts"), "n\n", "utf8");
      const stale = await staleFinding(p);
      expect(stale.details).toEqual(["added    src/new.ts", "removed  src/deep/b.ts", "removed  src/deep/c.ts"]);
    } finally {
      await p.destroy();
    }
  });

  it("records only the count once the index would swamp the document it annotates", async () => {
    // 101 files is one past the readability budget. The header of a spec.md a
    // person reads must not be longer than its requirements — past the limit the
    // stamp keeps the count, and staleness says how many files moved rather than
    // which. Worse advice; a legible document.
    const many: Record<string, string> = {};
    for (let i = 0; i < 101; i++) many[`src/f${String(i).padStart(3, "0")}.ts`] = `${i}\n`;
    const p = await vouchedProject(many);
    try {
      expect(stringField(parseFrontmatter(await p.read(SPEC)), "sources_files")).toBe("101");
      await writeFile(join(p.workDir, "src/f000.ts"), "changed\n", "utf8");
      const stale = await staleFinding(p);
      expect(stale.message).toContain("101 file(s) then, 101 now");
      expect(stale.details).toEqual(["src/"]);
    } finally {
      await p.destroy();
    }
  });

  it("falls back to the listed entries when the stamp predates the index", async () => {
    // Exactly what a spec vouched by an older loam carries: a digest and no
    // record of what it covered. Worse advice, honestly given.
    const files = coherentFixture();
    files[SPEC] =
      `---\nservice: ${SVC}\nstatus: verified\nlast_verified: 2026-07-31\n` +
      `sources:\n  - src/\nsources_digest: "0000000000000000"\n---\n\n# ${SVC}\n`;
    const p = await makeProject(files, { service: SVC });
    try {
      await writeFiles(p.workDir, { "src/a.ts": "a\n" });
      const stale = await staleFinding(p);
      expect(stale.details).toEqual(["src/"]);
      expect(stale.message).toContain("2026-07-31");
    } finally {
      await p.destroy();
    }
  });

  it("treats a hand-mangled index as no index rather than as 'every file was deleted'", async () => {
    const p = await vouchedProject({ "src/a.ts": "a\n", "src/deep/b.ts": "b\n" });
    try {
      const stamped = await p.read(SPEC);
      // Somebody edited the header. The stamp can no longer be read back, and
      // the one answer that must NOT come out is a list of removals nobody made.
      await p.write(SPEC, stamped.replace(/sources_files: \|-\n(?:.*\n)+?(?=[a-z_]+:)/, "sources_files: nonsense\n"));
      await writeFile(join(p.workDir, "src/a.ts"), "a, edited\n", "utf8");
      const stale = await staleFinding(p);
      expect(stale.details).toEqual(["src/"]);
      expect(stale.details.join(" ")).not.toContain("removed");
    } finally {
      await p.destroy();
    }
  });

  it("goes quiet again once the stamp is refreshed", async () => {
    const p = await vouchedProject({ "src/a.ts": "a\n" });
    try {
      await writeFile(join(p.workDir, "src/a.ts"), "a, edited\n", "utf8");
      expect(await staleFinding(p)).toBeDefined();
      expect((await runLoam(p.workDir, "vouch", "--yes")).code).toBe(0);
      const codes = JSON.parse((await runLoam(p.workDir, "validate", "--json")).stdout).targets[0].findings.map(
        (f: { code: string }) => f.code,
      );
      expect(codes).toContain("sources.current");
      expect(codes).not.toContain("sources.stale");
    } finally {
      await p.destroy();
    }
  });
});

describe("two service repos, one docs repo", () => {
  /** A second service beside payment-service, with a spec vouch can stamp. */
  const OTHER = "checkout-web";

  it("vouching from both at once keeps both stamps — neither run takes the other's back out", async () => {
    const files = coherentFixture();
    files[SPEC] = `---\nservice: ${SVC}\nstatus: draft\nowner: payments-team\nsources:\n  - src/\n---\n\n# ${SVC}\n`;
    files[`services/${OTHER}/spec.md`] =
      `---\nservice: ${OTHER}\nstatus: draft\nowner: web-team\nsources:\n  - src/\n---\n\n# ${OTHER}\n`;
    const p = await makeProject(files);
    const paymentRepo = await makeTmpDir("loam-repo-payment-");
    const webRepo = await makeTmpDir("loam-repo-web-");
    try {
      await writeFiles(paymentRepo, { "src/payment.ts": "authorize\n" });
      await writeFiles(webRepo, { "src/checkout.ts": "checkout\n" });

      const both = await Promise.all([
        vouch({ docsDir: p.docsDir, service: SVC, repoDir: paymentRepo, today: "2026-08-04", vouchedBy: TEST_IDENTITY }),
        vouch({ docsDir: p.docsDir, service: OTHER, repoDir: webRepo, today: "2026-08-04", vouchedBy: TEST_IDENTITY }),
      ]);
      expect(both.map((o) => o.ok)).toEqual([true, true]);

      for (const rel of [SPEC, `services/${OTHER}/spec.md`]) {
        const fm = parseFrontmatter(await p.read(rel));
        expect(stringField(fm, "status"), rel).toBe("verified");
        expect(stringField(fm, "sources_digest"), rel).toMatch(/^[0-9a-f]{16}$/);
        expect(stringField(fm, "content_digest"), rel).toMatch(/^[0-9a-f]{16}$/);
      }
      // Each stamp is over its OWN repo, not whichever ran last.
      expect(stringField(parseFrontmatter(await p.read(SPEC)), "sources_files")).toContain("src/payment.ts");
      expect(
        stringField(parseFrontmatter(await p.read(`services/${OTHER}/spec.md`)), "sources_files"),
      ).toContain("src/checkout.ts");
    } finally {
      await p.destroy();
      await rm(paymentRepo, { recursive: true, force: true });
      await rm(webRepo, { recursive: true, force: true });
    }
  });

  it("refuses rather than overwrite a stamp that landed between the read and the write", async () => {
    // The same race narrowed to one file: the spec moves under the run. Writing
    // the computed bytes would silently take the other stamp back out, because
    // they were computed from what the file said BEFORE it moved.
    const files = coherentFixture();
    files[SPEC] = `---\nservice: ${SVC}\nstatus: draft\nowner: payments-team\nsources:\n  - src/\n---\n\n# ${SVC}\n`;
    const p = await makeProject(files, { service: SVC });
    try {
      await writeFiles(p.workDir, { "src/payment.ts": "authorize\n" });

      // The other repo's vouch lands the instant this one has read the spec —
      // so the bytes about to be written were computed from a document that no
      // longer exists. The read that matters is VERIFICATION's read, not the
      // first read of the file: `locateServicePaths`' enumeration reads every
      // spec.md's frontmatter before `verifySpec` ever runs, and a swap landed
      // on that earlier read sits BEFORE the race window — verification then
      // reads the new bytes and the stamp is sound, so the guard never fires
      // and this test stops testing it. Skip the enumeration's read and land
      // the swap on the second, which is verifySpec's. If the read order ever
      // shifts again, the swap lands outside the window and the `vouch-raced`
      // assertion below fails loudly — this pin cannot disarm silently.
      const theirs = `---\nservice: ${SVC}\nstatus: verified\nowner: payments-team\nsources:\n  - src/\nsources_digest: "1111111111111111"\n---\n\n# ${SVC}\n`;
      const specPath = join(p.docsDir, "services", SVC, "spec.md");
      let specReads = 0;
      fsHook.afterRead = async (path) => {
        if (path !== specPath) return;
        specReads += 1;
        if (specReads < 2) return;
        fsHook.afterRead = undefined;
        await writeFile(specPath, theirs, "utf8");
      };

      const result = await vouch({ docsDir: p.docsDir, service: SVC, repoDir: p.workDir, today: "2026-08-04", vouchedBy: TEST_IDENTITY });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe("vouch-raced");
      expect(result.message).toContain("Nothing was stamped");
      // The other writer's bytes survive, verbatim — and nothing was left beside
      // them: a refused vouch takes its staged temp files with it.
      expect(await p.read(SPEC)).toBe(theirs);
      const beside = await readdir(join(p.docsDir, "services", SVC));
      expect(beside.filter((n) => n.includes(".tmp"))).toEqual([]);
    } finally {
      await p.destroy();
    }
  });
});
