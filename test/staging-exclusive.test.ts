/**
 * The two things a staged write must never do to a CONCURRENT writer: replace
 * bytes it did not read, and clean up by deleting directories that are no
 * longer only ours.
 */
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  StagingRaceError,
  planWrite,
  quietPruneEmptyParents,
  rollbackStaged,
  stageWrites,
  swapStaged,
} from "../src/core/staging.js";

describe("exclusive staged writes", () => {
  it("never recursively removes a file created concurrently with a no-clobber swap", async () => {
    const scratch = await mkdtemp(join(tmpdir(), "loam-exclusive-staging-"));
    try {
      const target = join(scratch, "target", "nested", "result.txt");
      const staged = await stageWrites([{
        path: target,
        content: "migration bytes\n",
        exclusive: true,
      }]);

      await writeFile(target, "concurrent owner bytes\n", { flag: "wx" });
      // The pre-image comparison catches it before link(2) is even reached;
      // link's EEXIST remains the backstop for the sub-millisecond window
      // between that read and the swap, which no test can open deterministically.
      await expect(swapStaged(staged)).rejects.toThrow(StagingRaceError);
      expect(await rollbackStaged(staged)).toEqual([]);
      expect(await readFile(target, "utf8")).toBe("concurrent owner bytes\n");
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });
});

describe("planWrite — which writes may lose a race", () => {
  it("marks a create exclusive and leaves an overwrite alone", async () => {
    const scratch = await mkdtemp(join(tmpdir(), "loam-plan-write-"));
    try {
      const fresh = join(scratch, "new.txt");
      const existing = join(scratch, "old.txt");
      await writeFile(existing, "living\n", "utf8");

      expect(planWrite(fresh, "bytes\n")).toEqual({ path: fresh, content: "bytes\n", exclusive: true });
      // An overwrite CANNOT be exclusive — link(2) would fail EEXIST on every
      // run; it is guarded by the pre-image comparison in swapStaged instead.
      expect(planWrite(existing, "bytes\n")).toEqual({ path: existing, content: "bytes\n" });
      // A delete is not a create either.
      expect(planWrite(existing, null)).toEqual({ path: existing, content: null });
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });
});

describe("pre-image compare-and-set", () => {
  it("refuses to swap over bytes written after the plan was computed", async () => {
    const scratch = await mkdtemp(join(tmpdir(), "loam-cas-"));
    try {
      const target = join(scratch, "living.txt");
      await writeFile(target, "v1\n", "utf8");
      const staged = await stageWrites([planWrite(target, "mine\n")]);
      await writeFile(target, "somebody else's v2\n", "utf8");

      await expect(swapStaged(staged)).rejects.toThrow(StagingRaceError);
      expect(await readFile(target, "utf8")).toBe("somebody else's v2\n");
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });

  it("a rollback leaves a file another writer changed after our swap, and names it", async () => {
    const scratch = await mkdtemp(join(tmpdir(), "loam-rollback-guard-"));
    try {
      const a = join(scratch, "a.txt");
      const b = join(scratch, "b.txt");
      await writeFile(a, "a-v1\n", "utf8");
      await writeFile(b, "b-v1\n", "utf8");
      const staged = await stageWrites([planWrite(a, "a-mine\n"), planWrite(b, "b-mine\n")]);
      await swapStaged(staged);

      // Somebody edits `a` between our swap and the failure that rolls us back.
      await writeFile(a, "a-theirs\n", "utf8");
      const failures = await rollbackStaged(staged);

      expect(failures).toHaveLength(1);
      expect(failures[0]).toContain("a.txt");
      expect(await readFile(a, "utf8")).toBe("a-theirs\n");
      // `b` still holds exactly our bytes, so it is ours to put back.
      expect(await readFile(b, "utf8")).toBe("b-v1\n");
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });
});

describe("quietPruneEmptyParents", () => {
  it("stops at the first directory somebody else has put something in", async () => {
    const scratch = await mkdtemp(join(tmpdir(), "loam-prune-"));
    try {
      const root = join(scratch, "archive");
      const mine = join(root, "FEAT-1");
      const theirs = join(root, "FEAT-2");
      await mkdir(mine, { recursive: true });
      await mkdir(theirs, { recursive: true });
      await writeFile(join(theirs, "intent.md"), "theirs\n", "utf8");

      await quietPruneEmptyParents(mine, root);

      expect(existsSync(mine)).toBe(false);
      expect(existsSync(root)).toBe(true);
      expect(await readFile(join(theirs, "intent.md"), "utf8")).toBe("theirs\n");
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });
});
