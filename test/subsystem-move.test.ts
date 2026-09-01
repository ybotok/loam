/**
 * `subsystem move` / `subsystem rename` — one transaction over N directory
 * renames plus the generated views file, and the exit criteria the roadmap
 * item names: join keys byte-identical across any move, archive → move →
 * unarchive a byte round trip with no --force, the ONLY move-specific
 * refusal being uncommitted git changes, and crash recovery at each commit
 * boundary leaving the tree in exactly one of the two recorded states.
 *
 * The crash-injection half drives the staging pieces directly (the
 * archive-rollback technique): SIGKILL cannot be delivered deterministically
 * between two renames, but the on-disk state it leaves — temps durable,
 * journal fsynced, K of N renames performed — can be built exactly.
 */
import { describe, expect, it, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { recoverForward } from "../src/core/staging/txn/forward.js";
import { readTxnIntent, writeTxnIntent, type TxnSpec } from "../src/core/staging/txn/journal.js";
import { commitStaged } from "../src/core/staging/txn/transaction.js";
import { stageWrites, swapStaged } from "../src/core/staging/commit.js";
import {
  coherentFixture,
  LANDSCAPE,
  LIVING_OPENAPI,
  makeProject,
  pinFor,
  runLoam,
  SERVICE_MODEL,
  treeHashes,
  type Project,
} from "./helpers/harness.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!();
});

async function project(files: Record<string, string>): Promise<Project> {
  const p = await makeProject(files);
  cleanups.push(() => p.destroy());
  return p;
}

/** Assert a refusal: stable code, exit 1, nothing written. Returns the message. */
async function refuses(p: Project, args: string[], code: string): Promise<string> {
  const before = await treeHashes(p.docsDir);
  const res = await runLoam(p.workDir, ...args, "--json");
  expect(res.code, args.join(" ")).toBe(1);
  const payload = JSON.parse(res.stdout);
  expect(payload.error.code, args.join(" ")).toBe(code);
  expect(await treeHashes(p.docsDir), args.join(" ")).toEqual(before);
  return payload.error.message as string;
}

const git = (cwd: string, ...args: string[]): string =>
  execFileSync("git", args, { cwd, encoding: "utf8" });

/**
 * `git init` + one commit of everything — the fixture the uncommitted refusal
 * needs.
 *
 * `-b main` is not decoration: the concurrent-move cases below check the base
 * branch out BY NAME, and an unset `init.defaultBranch` makes git call it
 * `master`. This host names it `main` and every developer machine that hit
 * this file did too, so the tests passed here and failed on the GitHub runner
 * with `pathspec 'main' did not match any file(s) known to git` — a message
 * that reads like a broken fixture rather than a naming default. Every other
 * git fixture in the suite already spells it (diff, validate-base, vouch-pack);
 * this one had not.
 */
function gitInit(dir: string): void {
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.email", "t@example.test");
  git(dir, "config", "user.name", "t");
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "base");
}

describe("moving services and subtrees", () => {
  it("files a service: join keys byte-identical, only the views file otherwise changes, and the fleet stays green", async () => {
    const files = coherentFixture();
    files["services/payments/subsystem.yaml"] = "title: Payments\n";
    const p = await project(files);
    await runLoam(p.workDir, "subsystem", "sync");
    const before = await treeHashes(p.docsDir);

    const res = await runLoam(p.workDir, "subsystem", "move", "payment-service", "--into", "payments", "--json");
    expect(res.code).toBe(0);
    expect(JSON.parse(res.stdout).moved).toEqual([
      {
        name: "payment-service",
        kind: "service",
        from: "services/payment-service",
        to: "services/payments/payment-service",
      },
    ]);

    // Every byte of the service travelled unchanged — the join keys did not
    // move — and nothing else changed except the generated views file.
    const after = await treeHashes(p.docsDir);
    for (const [path, hash] of Object.entries(before)) {
      if (path.startsWith("services/payment-service/")) {
        expect(after[path.replace("services/payment-service/", "services/payments/payment-service/")]).toBe(hash);
        expect(after[path]).toBeUndefined();
      } else if (path !== "architecture/subsystems.likec4") {
        expect(after[path], path).toBe(hash);
      }
    }
    // No verified demotion: the vouched status is frontmatter, and the
    // frontmatter is byte-identical.
    const list = JSON.parse((await runLoam(p.workDir, "list", "services", "--json")).stdout);
    expect(list.services.find((s: { id: string }) => s.id === "payment-service").status).toBe("verified");
    expect((await runLoam(p.workDir, "validate", "--all")).code).toBe(0);
  });

  it("moves a whole subtree, unfiles with --into ., and renames a subsystem — each through the one transaction", async () => {
    const files = coherentFixture();
    files["services/payments/subsystem.yaml"] = "";
    files["services/money/subsystem.yaml"] = "";
    const p = await project(files);
    expect((await runLoam(p.workDir, "subsystem", "move", "payment-service", "--into", "payments")).code).toBe(0);
    // Whole subtree: payments (with the service inside) into money/.
    expect((await runLoam(p.workDir, "subsystem", "move", "payments", "--into", "money")).code).toBe(0);
    expect(p.exists("services/money/payments/payment-service/spec.md")).toBe(true);
    const views = await p.read("architecture/subsystems.likec4");
    expect(views).toContain("view subsystem_money__payments {");

    // Rename the outer group; the inner path follows.
    expect((await runLoam(p.workDir, "subsystem", "rename", "money", "cash")).code).toBe(0);
    expect(p.exists("services/cash/payments/payment-service/spec.md")).toBe(true);
    expect(await p.read("architecture/subsystems.likec4")).toContain("view subsystem_cash__payments {");

    // Unfile: root is a place, spelled `.`.
    expect((await runLoam(p.workDir, "subsystem", "move", "payment-service", "--into", ".")).code).toBe(0);
    expect(p.exists("services/payment-service/spec.md")).toBe(true);
    expect((await runLoam(p.workDir, "validate", "--all")).code).toBe(0);
  });

  it("refuses what a move cannot mean: unknown names, a service as destination, a subtree into itself, a no-op, a rename of a service", async () => {
    const files = coherentFixture();
    files["services/payments/subsystem.yaml"] = "";
    files["services/payments/billing/subsystem.yaml"] = "";
    const p = await project(files);
    await runLoam(p.workDir, "subsystem", "sync");
    expect(await refuses(p, ["subsystem", "move", "payment-servce", "--into", "payments"], "unknown-target")).toContain(
      "payment-service",
    );
    await refuses(p, ["subsystem", "move", "nothing", "--into", "nowhere"], "unknown-target");
    await refuses(p, ["subsystem", "move", "payments", "--into", "payment-service"], "invalid-option");
    await refuses(p, ["subsystem", "move", "payments", "--into", "billing"], "invalid-option");
    await refuses(p, ["subsystem", "move", "payments", "--into", "payments"], "invalid-option");
    await refuses(p, ["subsystem", "move", "billing", "--into", "payments"], "invalid-option");
    expect(await refuses(p, ["subsystem", "rename", "payment-service", "pay"], "invalid-option")).toContain("identity");
    await refuses(p, ["subsystem", "rename", "payments", "payment-service"], "already-exists");
    // Naming both a subtree and something inside it: one root, one rename.
    await refuses(
      p,
      ["subsystem", "move", "payments", "billing", "--into", "."],
      "invalid-option",
    );
  });

  it("refuses visibly under contention: a held docs lock answers docs-busy, and nothing moves", async () => {
    const files = coherentFixture();
    files["services/payments/subsystem.yaml"] = "";
    const p = await project(files);
    await runLoam(p.workDir, "subsystem", "sync");
    // A LIVE holder: this very process's pid, so the stale-lock breaker must
    // not clear it and the second mover must refuse rather than proceed.
    await writeFile(
      join(p.docsDir, ".loam-lock"),
      JSON.stringify({ pid: process.pid, host: (await import("node:os")).hostname(), at: "now" }) + "\n",
    );
    await refuses(p, ["subsystem", "move", "payment-service", "--into", "payments"], "docs-busy");
    await rm(join(p.docsDir, ".loam-lock"));
  });
});

describe("the only move-specific refusal: uncommitted changes", () => {
  it("refuses move-uncommitted on a dirty file under a moved directory, proceeds once committed, and stages the rename without committing", async () => {
    const files = coherentFixture();
    files["services/payments/subsystem.yaml"] = "";
    const p = await project(files);
    await runLoam(p.workDir, "subsystem", "sync");
    gitInit(p.docsDir);

    await p.write("services/payment-service/spec.md", (await p.read("services/payment-service/spec.md")) + "\n<!-- edit -->\n");
    const message = await refuses(p, ["subsystem", "move", "payment-service", "--into", "payments"], "move-uncommitted");
    expect(message).toContain("services/payment-service/spec.md");

    git(p.docsDir, "add", "-A");
    git(p.docsDir, "commit", "-qm", "edit");
    const commits = git(p.docsDir, "rev-list", "--count", "HEAD").trim();
    expect((await runLoam(p.workDir, "subsystem", "move", "payment-service", "--into", "payments")).code).toBe(0);
    // The roadmap's sentence, verbatim: move STAGES renames without
    // committing — the index holds the rename pair, HEAD did not advance.
    const status = git(p.docsDir, "status", "--porcelain");
    expect(status).toMatch(/^R  services\/payment-service\/spec\.md -> services\/payments\/payment-service\/spec\.md$/m);
    expect(git(p.docsDir, "rev-list", "--count", "HEAD").trim()).toBe(commits);
  });

  it("a fleet without git is never refused: the move proceeds where git will not say", async () => {
    const files = coherentFixture();
    files["services/payments/subsystem.yaml"] = "";
    const p = await project(files);
    expect((await runLoam(p.workDir, "subsystem", "move", "payment-service", "--into", "payments")).code).toBe(0);
    expect(p.exists("services/payments/payment-service/spec.md")).toBe(true);
  });
});

describe("THE HEADLINE: archive, move, unarchive — a byte round trip, no --force", () => {
  it("restores the pre-image into the directory the service lives in NOW, with no snapshot-stale", async () => {
    const living = `---
service: payment-service
status: verified
---

# payment-service

## Requirements

### Requirement: Authorize a payment
The service SHALL authorize a payment before capture.

Operations: authorizePayment

#### Scenario: Successful authorization
- **Given** a valid card
- **When** authorization is requested
- **Then** the payment is authorized
`;
    const p = await project({
      "architecture/landscape.likec4": LANDSCAPE,
      "services/payment-service/model.likec4": SERVICE_MODEL,
      "services/payment-service/spec.md": living,
      "services/payment-service/openapi.yaml": LIVING_OPENAPI,
      "services/payments/subsystem.yaml": "title: Payments\n",
      "features/FEAT-20-faster/specs/payment-service/spec.md":
        `# payment-service — delta for FEAT-20\n\n## MODIFIED Requirements\n\n` +
        `### Requirement: Authorize a payment\nBased-On: ${pinFor(living, "Authorize a payment")}\n` +
        `The service SHALL authorize a payment within 2 seconds.\n\nOperations: authorizePayment\n\n` +
        `#### Scenario: Fast authorization\n- **Given** a valid card\n- **When** authorization is requested\n- **Then** it completes within 2 seconds\n`,
      "features/FEAT-20-faster/intent.md":
        "---\nfeature: FEAT-20\nstatus: proposed\n---\n\n# Faster authorization\n\nAuthorize within two seconds.\n",
    });
    await runLoam(p.workDir, "subsystem", "sync");
    const before = await treeHashes(p.docsDir);
    expect((await runLoam(p.workDir, "archive", "FEAT-20")).code).toBe(0);
    expect(await p.read("services/payment-service/spec.md")).toContain("within 2 seconds");

    expect(
      (await runLoam(p.workDir, "subsystem", "move", "payment-service", "--into", "payments")).code,
    ).toBe(0);

    // The v3 snapshot resolves (service, artifact) through the CURRENT
    // enumeration: the restore lands where the service lives now — no
    // --force, no snapshot-stale — and the whole tree is byte-identical to
    // the pre-archive tree with exactly the move applied and nothing else.
    expect((await runLoam(p.workDir, "unarchive", "FEAT-20")).code).toBe(0);
    const expected: Record<string, string> = {};
    for (const [path, hash] of Object.entries(before)) {
      expected[path.replace(/^services\/payment-service\//, "services/payments/payment-service/")] = hash;
    }
    delete expected["services/payment-service/"];
    expected["services/payments/payment-service/"] = "<dir>";
    // The generated views file is the ONE file that rightly differs from the
    // pre-archive tree: it reflects the move (that is its job), and the fleet
    // gate below proves it is exactly current rather than merely different.
    const restored = await treeHashes(p.docsDir);
    expected["architecture/subsystems.likec4"] = restored["architecture/subsystems.likec4"]!;
    expect(restored).toEqual(expected);
    expect(await p.read("services/payments/payment-service/spec.md")).toBe(living);
    expect((await runLoam(p.workDir, "validate", "--all")).code).toBe(0);

    // And archiving AGAIN over the moved tree works with no --force: the
    // clobber guard grades the old snapshot's claims at the service's NEW
    // address, and a fresh cycle round-trips to the same moved tree.
    expect((await runLoam(p.workDir, "archive", "FEAT-20")).code).toBe(0);
    expect((await runLoam(p.workDir, "unarchive", "FEAT-20")).code).toBe(0);
    expect(await treeHashes(p.docsDir)).toEqual(restored);
  });
});

describe("crash recovery at the move's commit boundaries", () => {
  /** A docs root with a filed-tree move planned: two renames plus the views write. */
  async function moveFixture(): Promise<{
    root: string;
    spec: TxnSpec;
    views: { path: string; content: string };
  }> {
    const p = await project({
      "architecture/landscape.likec4": LANDSCAPE,
      "services/payments/subsystem.yaml": "",
      "services/a-service/spec.md": "---\nservice: a-service\n---\n\n# a\n",
      "services/b-service/spec.md": "---\nservice: b-service\n---\n\n# b\n",
      "architecture/subsystems.likec4": "views {\n}\n",
    });
    const root = p.docsDir;
    const views = { path: join(root, "architecture", "subsystems.likec4"), content: "views {\n  // after\n}\n" };
    const spec: TxnSpec = {
      root,
      command: "subsystem",
      rerun: "loam subsystem sync",
      target: "a-service, b-service",
      moves: [
        { from: join(root, "services", "a-service"), to: join(root, "services", "payments", "a-service") },
        { from: join(root, "services", "b-service"), to: join(root, "services", "payments", "b-service") },
      ],
    };
    return { root, spec, views };
  }

  /** The tree an uninterrupted commit of the fixture's plan leaves behind. */
  async function completedTree(): Promise<Record<string, string>> {
    const { root, spec, views } = await moveFixture();
    const staged = await stageWrites([views]);
    const committed = await commitStaged(spec, staged, "moved");
    expect(committed).toEqual({ ok: true });
    return stripRoots(await treeHashes(root));
  }

  /** Hash map with the fixture-root-specific bits that never change dropped. */
  function stripRoots(hashes: Record<string, string>): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(hashes)) if (!k.startsWith(".loam")) out[k] = v;
    return out;
  }

  it("a crash after the journal but before any rename is rolled FORWARD to the complete post-state", async () => {
    const done = await completedTree();
    const { root, spec, views } = await moveFixture();
    const staged = await stageWrites([views]);
    await writeTxnIntent(spec, staged);
    await swapStaged(staged);
    // killed here: zero renames performed
    const intent = await readTxnIntent(root);
    expect(intent).not.toBeNull();
    expect(intent!.moves).toHaveLength(2);
    const outcome = await recoverForward(root, intent!);
    expect(outcome.outcome).toBe("repaired");
    expect(stripRoots(await treeHashes(root))).toEqual(done);
  });

  it("a crash BETWEEN two renames finishes the second — file and both moves land, byte-identical to the clean run", async () => {
    const done = await completedTree();
    const { root, spec, views } = await moveFixture();
    const staged = await stageWrites([views]);
    await writeTxnIntent(spec, staged);
    await swapStaged(staged);
    await rename(spec.moves![0]!.from, spec.moves![0]!.to);
    // killed here
    const outcome = await recoverForward(root, (await readTxnIntent(root))!);
    expect(outcome.outcome).toBe("repaired");
    expect(stripRoots(await treeHashes(root))).toEqual(done);
  });

  it("a crash after every rename but before the journal's removal reads as completed", async () => {
    const done = await completedTree();
    const { root, spec, views } = await moveFixture();
    const staged = await stageWrites([views]);
    await writeTxnIntent(spec, staged);
    await swapStaged(staged);
    for (const m of spec.moves!) await rename(m.from, m.to);
    const outcome = await recoverForward(root, (await readTxnIntent(root))!);
    expect(outcome.outcome).toBe("completed");
    expect(stripRoots(await treeHashes(root))).toEqual(done);
  });

  it("refuses to choose when a moved directory is in NEITHER recorded state", async () => {
    const { root, spec, views } = await moveFixture();
    const staged = await stageWrites([views]);
    await writeTxnIntent(spec, staged);
    await swapStaged(staged);
    // Somebody re-created the source AND the destination since the crash.
    await rename(spec.moves![0]!.from, spec.moves![0]!.to);
    await mkdir(spec.moves![0]!.from, { recursive: true });
    await expect(recoverForward(root, (await readTxnIntent(root))!)).rejects.toThrow(/neither/);
  });

  it("a live failure mid-renames rolls everything back: renames undone, views restored, journal cleared", async () => {
    const { root, spec, views } = await moveFixture();
    const before = stripRoots(await treeHashes(root));
    // Make the SECOND rename fail: its destination already exists, non-empty.
    await mkdir(join(root, "services", "payments", "b-service"), { recursive: true });
    await writeFile(join(root, "services", "payments", "b-service", "squatter"), "x");
    const staged = await stageWrites([views]);
    const committed = await commitStaged(spec, staged, "moved");
    expect(committed.ok).toBe(false);
    if (!committed.ok) expect(committed.code).toBe("merge-failed");
    expect(existsSync(join(root, ".loam-commit"))).toBe(false);
    const after = stripRoots(await treeHashes(root));
    for (const [k, v] of Object.entries(before)) expect(after[k], k).toBe(v);
    expect(existsSync(join(root, "services", "a-service"))).toBe(true);
  });

  it("a version-2 journal (no moves) is still read and recovered exactly as before", async () => {
    const { root, views } = await moveFixture();
    const spec: TxnSpec = { root, command: "subsystem", rerun: "loam subsystem sync", target: "subsystems" };
    const staged = await stageWrites([views]);
    await writeTxnIntent(spec, staged);
    const intent = await readTxnIntent(root);
    expect(intent).not.toBeNull();
    expect(intent!.version).toBe(2);
    expect(intent!.moves).toEqual([]);
    const outcome = await recoverForward(root, intent!);
    expect(outcome.outcome).toBe("repaired");
  });
});

describe("concurrent moves, adjudicated by git itself", () => {
  /** A git repo with two groups, two filed-ready services, views synced and committed. */
  async function gitFleet(): Promise<Project> {
    const files = coherentFixture();
    files["services/ga/subsystem.yaml"] = "";
    files["services/gb/subsystem.yaml"] = "";
    files["services/checkout-web/spec.md"] = "---\nservice: checkout-web\n---\n\n# checkout-web\n";
    // A model too: the post-merge assertion below runs the full fleet gate,
    // and a service without its C4 center is an error unrelated to the tree.
    files["services/checkout-web/model.likec4"] =
      "specification {\n  element softwareSystem\n}\n\nmodel {\n  checkoutWeb = softwareSystem 'checkout-web' {\n" +
      "    description 'Customer-facing checkout UI'\n  }\n}\n\nviews {\n  view of checkoutWeb {\n    include *\n  }\n}\n";
    const p = await project(files);
    await runLoam(p.workDir, "subsystem", "sync");
    gitInit(p.docsDir);
    return p;
  }

  it("two moves into DIFFERENT groups merge without intervention — the generated file's lines are disjoint", async () => {
    const p = await gitFleet();
    const d = p.docsDir;
    git(d, "checkout", "-qb", "move-a");
    expect((await runLoam(p.workDir, "subsystem", "move", "payment-service", "--into", "ga")).code).toBe(0);
    git(d, "commit", "-qm", "file payment-service into ga");
    git(d, "checkout", "-q", "main");
    git(d, "checkout", "-qb", "move-b");
    expect((await runLoam(p.workDir, "subsystem", "move", "checkout-web", "--into", "gb")).code).toBe(0);
    git(d, "commit", "-qm", "file checkout-web into gb");

    // The merge is git's, untouched: different groups touched different
    // include lines, so no human and no loam is needed.
    git(d, "merge", "-q", "--no-edit", "move-a");
    expect(p.exists("services/ga/payment-service/spec.md")).toBe(true);
    expect(p.exists("services/gb/checkout-web/spec.md")).toBe(true);
    // And the merged generated file is EXACTLY what the merged tree renders:
    // the fleet gate stays green, with no sync needed after the merge.
    expect((await runLoam(p.workDir, "validate", "--all")).code).toBe(0);
  });

  it("two moves of the SAME service conflict visibly rather than resolving silently", async () => {
    const p = await gitFleet();
    const d = p.docsDir;
    git(d, "checkout", "-qb", "same-a");
    expect((await runLoam(p.workDir, "subsystem", "move", "payment-service", "--into", "ga")).code).toBe(0);
    git(d, "commit", "-qm", "into ga");
    git(d, "checkout", "-q", "main");
    git(d, "checkout", "-qb", "same-b");
    expect((await runLoam(p.workDir, "subsystem", "move", "payment-service", "--into", "gb")).code).toBe(0);
    git(d, "commit", "-qm", "into gb");

    // git refuses: both branches moved the same lines of the generated file
    // (and the same directory), so the merge stops for a human instead of one
    // branch's placement silently winning.
    expect(() => git(d, "merge", "-q", "--no-edit", "same-a")).toThrow();
    const conflicted = git(d, "status", "--porcelain");
    expect(conflicted).toMatch(/^(UU|AA|DD|AU|UA|DU|UD)/m);
  });
});

describe("archived version-2 snapshots and the move", () => {
  it("notices a v2 snapshot addressing a directory being moved — a warning, and the move proceeds", async () => {
    // A version-2 manifest addresses services by literal pre-move path, so an
    // `unarchive --force` of that feature AFTER the move restores into the old
    // location, resurrecting the directory beside the moved one. The move must
    // say so at plan time — a notice, never a refusal.
    const files = coherentFixture();
    files["services/payments/subsystem.yaml"] = "";
    files["features/archive/FEAT-0-legacy/intent.md"] = "# legacy\n";
    files["features/archive/FEAT-0-legacy/.loam-before/manifest.json"] =
      JSON.stringify({ version: 2, files: [{ path: "services/payment-service/spec.md" }] }) + "\n";
    const p = await project(files);
    await runLoam(p.workDir, "subsystem", "sync");
    const res = await runLoam(p.workDir, "subsystem", "move", "payment-service", "--into", "payments", "--json");
    expect(res.code).toBe(0);
    const payload = JSON.parse(res.stdout);
    expect(payload.warnings).toHaveLength(1);
    expect(payload.warnings[0]).toContain("FEAT-0");
    expect(payload.warnings[0]).toContain("services/payment-service");
    expect(p.exists("services/payments/payment-service/spec.md")).toBe(true);
  });
});

describe("subsystem history across chained moves", () => {
  it("answers both hops of two chained moves, oldest first, and follows a subsystem rename too", async () => {
    const files = coherentFixture();
    files["services/ga/subsystem.yaml"] = "";
    files["services/gb/subsystem.yaml"] = "";
    const p = await project(files);
    await runLoam(p.workDir, "subsystem", "sync");
    gitInit(p.docsDir);

    expect((await runLoam(p.workDir, "subsystem", "move", "payment-service", "--into", "ga")).code).toBe(0);
    git(p.docsDir, "commit", "-qm", "hop 1");
    expect((await runLoam(p.workDir, "subsystem", "move", "payment-service", "--into", "gb")).code).toBe(0);
    git(p.docsDir, "commit", "-qm", "hop 2");

    const res = await runLoam(p.workDir, "subsystem", "history", "payment-service", "--json");
    expect(res.code).toBe(0);
    const payload = JSON.parse(res.stdout);
    expect(payload.answered).toBe(true);
    expect(payload.moves.map((m: { from: string; to: string }) => `${m.from} -> ${m.to}`)).toEqual([
      "services/payment-service -> services/ga/payment-service",
      "services/ga/payment-service -> services/gb/payment-service",
    ]);
    for (const m of payload.moves) expect(m.commit).toMatch(/^[0-9a-f]{40}$/);

    // A subsystem's own history follows its marker.
    expect((await runLoam(p.workDir, "subsystem", "rename", "gb", "payments")).code).toBe(0);
    git(p.docsDir, "commit", "-qm", "rename gb");
    const sub = JSON.parse(
      (await runLoam(p.workDir, "subsystem", "history", "payments", "--json")).stdout,
    );
    expect(sub.kind).toBe("subsystem");
    expect(sub.moves).toEqual([
      { from: "services/gb", to: "services/payments", commit: expect.stringMatching(/^[0-9a-f]{40}$/) },
    ]);
  });

  it("refuses to repeat a hop git paired by guesswork: identical markers moved together answer nothing", async () => {
    // Two subsystems with byte-identical (empty) markers, both renamed in ONE
    // commit: `git log --follow` pairs old and new paths by CONTENT, so the
    // hop it reports for gx can start from gy's old directory — a place the
    // followed marker never lived. The cross-check reads the commit's own
    // rename record, finds two entries carrying one blob, and the whole
    // answer becomes "git will not say" — never a phantom hop.
    const files = coherentFixture();
    files["services/ga/subsystem.yaml"] = "";
    files["services/gb/subsystem.yaml"] = "";
    const p = await project(files);
    await runLoam(p.workDir, "subsystem", "sync");
    gitInit(p.docsDir);
    git(p.docsDir, "mv", "services/ga", "services/gx");
    git(p.docsDir, "mv", "services/gb", "services/gy");
    git(p.docsDir, "commit", "-qm", "multi-name move");

    const res = await runLoam(p.workDir, "subsystem", "history", "gx", "--json");
    expect(res.code).toBe(0);
    const payload = JSON.parse(res.stdout);
    expect(payload.answered).toBe(false);
    expect(payload.moves).toEqual([]);
    const text = await runLoam(p.workDir, "subsystem", "history", "gx");
    expect(text.code).toBe(0);
    expect(text.out).toContain("git will not say");
  });
});
