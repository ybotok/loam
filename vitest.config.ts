import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // One probe before any test: a host that forbids a required primitive
    // (O_EXCL, link(2), rename-over, symlink, spawn) fails ONCE with a
    // [loam-host]-prefixed cause instead of scattering EPERM failures that
    // read as flakes. See test/helpers/host-probe.ts.
    globalSetup: ["test/helpers/host-probe.ts"],
    // Commands resolve loam.json via process.cwd(); tests chdir per invocation,
    // which worker_threads forbid — run each file in a forked child process instead.
    pool: "forks",
    // LikeC4 parses each .likec4 document in-process (langium) — slow on first load.
    testTimeout: 120_000,
    hookTimeout: 120_000,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      reporter: ["text", "json-summary"],
      thresholds: {
        statements: 91,
        branches: 82,
        functions: 95,
        lines: 93,
      },
    },
  },
});
