/**
 * Does this host permit the primitives the suite is built on? Asked ONCE,
 * before any test runs, so a constrained sandbox fails with a single named
 * cause instead of scattering EPERM/EEXIST failures across the suite that
 * read exactly like nondeterminism.
 *
 * The probes are the suite's real dependencies, each named for the code that
 * needs it: O_EXCL create (the docs lock's breaker path in
 * src/core/staging/lock.ts), link(2) (both the lock's publish and the staged
 * swap's exclusive create in src/core/staging/commit.ts), rename over an
 * existing file (every atomic swap), symlink creation (the containment
 * tests), and a child-process spawn of `git --version` (the federated verify
 * fixtures commit real repositories). process.chdir is deliberately NOT
 * probed: pool "forks" guarantees it — worker_threads would have thrown on
 * the config itself.
 *
 * The default export is vitest's globalSetup contract; its failure message
 * starts with `[loam-host]`, which scripts/gate-stress-classify.mjs reads as
 * the `infrastructure` class — a fact about the host, never about loam.
 */
import { execFile } from "node:child_process";
import { link, mkdtemp, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface HostProbeResult {
  ok: boolean;
  /** The primitive the host refused, when ok is false. */
  primitive?: string;
  cause?: string;
}

export async function probeHostPrimitives(): Promise<HostProbeResult> {
  let dir: string;
  try {
    dir = await mkdtemp(join(tmpdir(), "loam-host-probe-"));
  } catch (err) {
    return { ok: false, primitive: "mkdtemp under os.tmpdir()", cause: message(err) };
  }
  try {
    try {
      await writeFile(join(dir, "excl"), "x", { flag: "wx" });
    } catch (err) {
      return { ok: false, primitive: "O_EXCL create (writeFile wx)", cause: message(err) };
    }
    try {
      await link(join(dir, "excl"), join(dir, "linked"));
    } catch (err) {
      return { ok: false, primitive: "link(2) hardlink", cause: message(err) };
    }
    try {
      await writeFile(join(dir, "target"), "y");
      await rename(join(dir, "linked"), join(dir, "target"));
    } catch (err) {
      return { ok: false, primitive: "rename over an existing file", cause: message(err) };
    }
    try {
      await symlink(join(dir, "excl"), join(dir, "sym"));
    } catch (err) {
      return { ok: false, primitive: "symlink creation", cause: message(err) };
    }
    const spawn = await new Promise<string | null>((done) => {
      execFile("git", ["--version"], { encoding: "utf8", timeout: 10_000 }, (error) => {
        done(error === null ? null : error.message);
      });
    });
    if (spawn !== null) return { ok: false, primitive: "child-process spawn (git --version)", cause: spawn };
    return { ok: true };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** The one spelling of the refusal, exported so the test can pin it without mocking fs. */
export function hostRefusal(result: HostProbeResult): string {
  return (
    `[loam-host] this host forbids a primitive the suite requires: ${result.primitive} (${result.cause}). ` +
    "This is an infrastructure failure of the host, not a product failure — every test would hit it, " +
    "so none were run."
  );
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** vitest globalSetup: refuse the whole run, once, when the host cannot run it. */
export default async function hostProbeSetup(): Promise<void> {
  const result = await probeHostPrimitives();
  if (!result.ok) throw new Error(hostRefusal(result));
}
