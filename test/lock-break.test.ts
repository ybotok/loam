/**
 * The stale-lock break, interleaved by hand (src/core/staging/lock.ts).
 *
 * `breakStaleLock` decides from a READ that a lock's holder is dead, and
 * acts on the PATH. Those are three steps — read, kill(pid, 0), remove — and
 * other writers move in between. test/stress-gherkin.test.ts caught the cost
 * under CPU load: a waiter read the holder's payload, the holder released
 * normally and exited, a third writer linked a fresh lock, and the waiter's
 * ESRCH verdict on the first holder deleted the third writer's LIVE lock. Two
 * `loam gherkin` runs then shared one commit window. The second's recovery
 * read the first's in-flight journal as "interrupted" and swept its staged
 * temps (the sweep is scoped to the journal's own pid). The first's rename
 * then failed ENOENT as `merge-failed`.
 *
 * A stress loop finds that window once in hundreds of rounds. These tests
 * open it on purpose, every time: `node:fs/promises` is wrapped so a hook runs
 * at the exact step where another writer would land, and the hook is that
 * writer, acquiring through the real `acquireDocsLock`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { join } from "node:path";
import { acquireDocsLock, DOCS_LOCK, DocsBusyError } from "../src/core/staging/lock.js";
import { makeTmpDir } from "./helpers/harness.js";

/**
 * The hooks fire once, and only for the lock path, each disarmed before it
 * runs. The hook body acquires the lock too, so its own reads and renames
 * must pass straight through.
 */
const interleave = vi.hoisted(() => ({
  lockPath: "",
  afterLockRead: undefined as undefined | (() => Promise<void>),
  beforeLockRename: undefined as undefined | (() => Promise<void>),
  afterLockRename: undefined as undefined | (() => Promise<void>),
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  const fire = async (hook: "afterLockRead" | "beforeLockRename" | "afterLockRename", path: unknown): Promise<void> => {
    const run = interleave[hook];
    if (run === undefined || String(path) !== interleave.lockPath) return;
    interleave[hook] = undefined;
    await run();
  };
  return {
    ...actual,
    readFile: (async (path: Parameters<typeof actual.readFile>[0], options?: Parameters<typeof actual.readFile>[1]) => {
      const bytes = await actual.readFile(path, options);
      await fire("afterLockRead", path);
      return bytes;
    }) as typeof actual.readFile,
    rename: async (from: Parameters<typeof actual.rename>[0], to: Parameters<typeof actual.rename>[1]) => {
      await fire("beforeLockRename", from);
      await actual.rename(from, to);
      await fire("afterLockRename", from);
    },
  };
});

/** Beyond every platform's pid range, so kill(pid, 0) answers ESRCH — a holder that is gone. */
const GONE_PID = 0x7ffffffe;
const goneHolder = `${JSON.stringify({ pid: GONE_PID, host: hostname(), at: "2026-10-10T00:00:00.000Z" })}\n`;

let dirs: string[] = [];
afterEach(async () => {
  interleave.afterLockRead = interleave.beforeLockRename = interleave.afterLockRename = undefined;
  for (const d of dirs) await rm(d, { recursive: true, force: true });
  dirs = [];
});

async function lockedDir(holder: string): Promise<string> {
  const dir = await makeTmpDir();
  dirs.push(dir);
  interleave.lockPath = join(dir, DOCS_LOCK);
  await writeFile(interleave.lockPath, holder);
  return dir;
}

/** Acquire as the "other writer" inside a hook, and keep the bytes its lock wears. */
async function takeOver(dir: string): Promise<{ release: () => Promise<void>; bytes: Buffer }> {
  const release = await acquireDocsLock(dir);
  return { release, bytes: await readFile(join(dir, DOCS_LOCK)) };
}

describe("breaking a stale lock removes only the lock it judged", () => {
  it("leaves a successor's live lock alone when the judged holder released and exited mid-verdict", async () => {
    // What the waiter reads: a holder that, by the time kill(pid, 0) answers,
    // no longer exists. That is the path a NORMAL exit takes: release, then exit.
    const dir = await lockedDir(goneHolder);
    let successor: Awaited<ReturnType<typeof takeOver>> | undefined;
    let moved = false;
    interleave.afterLockRead = async () => {
      await rm(interleave.lockPath);
      successor = await takeOver(dir);
      interleave.beforeLockRename = async () => {
        moved = true;
      };
    };

    await expect(acquireDocsLock(dir)).rejects.toBeInstanceOf(DocsBusyError);
    expect(await readFile(interleave.lockPath)).toEqual(successor!.bytes);
    // Not even moved and put back: the put-back has a gap of its own (the last
    // test), so a live lock the verdict was never about must not enter it.
    expect(moved).toBe(false);
    await successor!.release();
    expect(await readdir(dir)).toEqual([]);
  });

  it("leaves the first breaker's live lock alone when two waiters break one crashed holder's lock", async () => {
    // A crashed holder: dead AND still in place, which is the one lock a break is
    // for. Between this waiter's read and its verdict, another waiter breaks the
    // same lock and links its own.
    const dir = await lockedDir(goneHolder);
    let first: Awaited<ReturnType<typeof takeOver>> | undefined;
    let moved = false;
    interleave.afterLockRead = async () => {
      first = await takeOver(dir);
      interleave.beforeLockRename = async () => {
        moved = true;
      };
    };

    await expect(acquireDocsLock(dir)).rejects.toBeInstanceOf(DocsBusyError);
    expect(await readFile(interleave.lockPath)).toEqual(first!.bytes);
    expect(moved).toBe(false);
    await first!.release();
    expect(await readdir(dir)).toEqual([]);
  });

  it("puts back, unchanged, a live lock it took when the takeover landed between the re-read and the take", async () => {
    const dir = await lockedDir(goneHolder);
    let first: Awaited<ReturnType<typeof takeOver>> | undefined;
    interleave.beforeLockRename = async () => {
      first = await takeOver(dir);
    };

    await expect(acquireDocsLock(dir)).rejects.toBeInstanceOf(DocsBusyError);
    expect(await readFile(interleave.lockPath)).toEqual(first!.bytes);
    // Nothing of the break is left behind: no private name, no staging temp.
    expect(await readdir(dir)).toEqual([DOCS_LOCK]);
    await first!.release();
    expect(await readdir(dir)).toEqual([]);
  });

  it("never overwrites a third writer that linked inside the put-back gap — the limit the lock names", async () => {
    // The residual the lock's comment names rather than closes: a crashed holder,
    // two breakers racing for its lock, and a third writer linking in the gap
    // between the take and the put-back. The displaced lock cannot go back
    // without overwriting a live one, so it does not go back. The waiter answers
    // docs-busy, never `internal`, and the third writer's lock stands.
    const dir = await lockedDir(goneHolder);
    let third: Awaited<ReturnType<typeof takeOver>> | undefined;
    let first: Awaited<ReturnType<typeof takeOver>> | undefined;
    interleave.beforeLockRename = async () => {
      first = await takeOver(dir);
      interleave.afterLockRename = async () => {
        third = await takeOver(dir);
      };
    };

    await expect(acquireDocsLock(dir)).rejects.toBeInstanceOf(DocsBusyError);
    expect(await readFile(interleave.lockPath)).toEqual(third!.bytes);
    expect(await readdir(dir)).toEqual([DOCS_LOCK]);
    expect(first).toBeDefined();
    await third!.release();
  });
});
