import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Commands resolve loam.json via process.cwd(); tests chdir per invocation,
    // which worker_threads forbid — run each file in a forked child process instead.
    pool: "forks",
    // LikeC4 parses each .likec4 document in-process (langium) — slow on first load.
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
