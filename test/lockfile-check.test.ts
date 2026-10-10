/**
 * The release preflight's lockfile check, on this checkout's own lockfile and
 * on a copy stripped the way npm on Windows stripped cafb4d8's.
 *
 * 0.2.0-alpha.8 never published: its tag's `npm ci` refused a lockfile from
 * which the version-bump sync had dropped the dependencies of another
 * platform's optional package, and `release:check` had passed it because it
 * read only the lockfile's version fields. The fixture below rebuilds that
 * shape from whatever the current lockfile holds rather than committing a
 * 100 KB copy of the broken one — an optional package that carries
 * dependencies, with those dependencies' entries removed — so the test keeps
 * meaning the same thing after the dependency tree moves.
 */
import { copyFile, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// eslint-disable-next-line -- a .mjs module; vitest transforms it fine.
import { lockfileInSync, missingFromLock } from "../scripts/lockfile-check.mjs";
import { makeTmpDir } from "./helpers/harness.js";

const ROOT = join(import.meta.dirname, "..");

interface LockEntry {
  optional?: boolean;
  dependencies?: Record<string, string>;
}

/** This checkout's manifest and lockfile, copied into a fresh directory. */
async function copyOfCheckout(): Promise<string> {
  const dir = await makeTmpDir("loam-lockfile-check-test-");
  await copyFile(join(ROOT, "package.json"), join(dir, "package.json"));
  await copyFile(join(ROOT, "package-lock.json"), join(dir, "package-lock.json"));
  return dir;
}

describe("release:check asks npm whether it will install the lockfile", () => {
  it("accepts the lockfile this checkout ships", async () => {
    const dir = await copyOfCheckout();
    try {
      expect(await lockfileInSync(dir)).toEqual({ ok: true });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 120_000);

  it("refuses one whose optional package lost its dependencies — cafb4d8's shape — and names them", async () => {
    const dir = await copyOfCheckout();
    try {
      const path = join(dir, "package-lock.json");
      const lock = JSON.parse(await readFile(path, "utf8")) as { packages: Record<string, LockEntry> };
      // An optional package whose dependencies are hoisted to the top level:
      // dropping those top-level entries is exactly what the Windows sync did.
      const stripped = Object.values(lock.packages)
        .filter((entry) => entry.optional === true && entry.dependencies !== undefined)
        .flatMap((entry) => Object.keys(entry.dependencies!))
        .filter((name) => lock.packages[`node_modules/${name}`]?.optional === true);
      expect(stripped.length, "the lockfile no longer holds an optional package with optional dependencies").toBeGreaterThan(0);
      for (const name of stripped) delete lock.packages[`node_modules/${name}`];
      await writeFile(path, JSON.stringify(lock, null, 2) + "\n", "utf8");

      const verdict = await lockfileInSync(dir);
      expect(verdict.ok).toBe(false);
      const detail = (verdict as { detail: string }).detail;
      expect(detail).toContain("in sync");
      expect(detail).toMatch(/Missing: \S+@ from lock file/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 120_000);
});

// The refusal above must not depend on which npm answers: npm 10 (Node 22.22.3)
// installed cafb4d8's lockfile while npm 11 refused it, and CI run 38047258912
// went red on the difference. These pin the structural walk that runs first.
describe("missingFromLock reads the lockfile the way Node resolves it", () => {
  it("finds a dependency hoisted to the root, or nested under an enclosing package", () => {
    expect(
      missingFromLock({
        packages: {
          "": {},
          "node_modules/a": { dependencies: { b: "^1", c: "^1" } },
          "node_modules/a/node_modules/b": { dependencies: { c: "^1" } },
          "node_modules/c": {},
        },
      }),
    ).toEqual([]);
  });

  it("names cafb4d8's shape: an optional package's dependency and a required peer, both absent", () => {
    expect(
      missingFromLock({
        packages: {
          "": {},
          "node_modules/binding": { optional: true, dependencies: { core: "^1" } },
          "node_modules/runtime": { peerDependencies: { core: "^1" } },
        },
      }),
    ).toEqual([
      { name: "core", requiredBy: "node_modules/binding" },
      { name: "core", requiredBy: "node_modules/runtime" },
    ]);
  });

  it("skips optional peers and workspace links, and never lets a sibling's private copy satisfy another package", () => {
    expect(
      missingFromLock({
        packages: {
          "": {},
          "node_modules/x": { peerDependencies: { y: "^1" }, peerDependenciesMeta: { y: { optional: true } } },
          "node_modules/p/node_modules/q": {},
          "node_modules/r": { dependencies: { q: "^1" } },
          "node_modules/ws": { link: true, dependencies: { nowhere: "^1" } },
        },
      }),
    ).toEqual([{ name: "q", requiredBy: "node_modules/r" }]);
  });
});
