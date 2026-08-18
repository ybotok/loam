/**
 * What a red gate run MEANS — product defect, runner policy, infrastructure,
 * or a coverage threshold — decided from evidence, never from a retry.
 *
 * The roadmap's concurrency-stability item forbids turning failures into
 * retries, and that prohibition only holds if a failure can be NAMED without
 * re-running it: an unclassified flake invites exactly the quiet rerun that
 * launders a real race into a green gate. This module is pure (no I/O, no
 * process state) so test/gate-stress-classify.test.ts can pin every class on
 * synthetic inputs without running the 200-second gate inside the gate.
 *
 * The classes, and why each is its own:
 *
 * - `infrastructure` — the host forbids a primitive the suite requires. The
 *   vitest globalSetup probe (test/helpers/host-probe.ts) says so with a
 *   `[loam-host]` prefix before any test runs, so a constrained host fails
 *   ONCE with a named cause instead of scattering EPERM/EEXIST failures that
 *   read as nondeterminism.
 * - `runner-policy` — the test pool itself broke: a worker exited, an IPC
 *   channel closed, a hook or test hit the runner's timeout, the report never
 *   became JSON, or a test file the runner discovered never reached the
 *   report. None of these say anything about loam; all of them say the run
 *   was not a measurement.
 * - `coverage-threshold` — every test passed, the report parses, and the run
 *   still exited non-zero under --coverage: that is vitest enforcing the
 *   thresholds in vitest.config.ts, a product signal with not one failing
 *   test in it, and the one shape that fits neither of the above.
 * - `product` — an ordinary assertion failure. The only class where the fix
 *   lives in src/ or test/.
 */

/** Substrings vitest 4 / tinypool emit when the POOL fails rather than a test. */
const RUNNER_PATTERNS = [
  "Tinypool",
  "worker exited unexpectedly",
  "Channel closed",
  "ERR_IPC",
  "SIGSEGV",
  "SIGKILL",
  "out of memory",
  "OutOfMemory",
  "Hook timed out",
  "Test timed out",
];

const HOST_PREFIX = "[loam-host]";

/**
 * One run's verdict from its artifacts. `report` is the parsed vitest JSON
 * reporter output (or null when it did not parse), `stderrText` the child's
 * captured stderr, `exitCode` its exit status, `discoveredFiles` the test
 * files the orchestrator saw on disk before the run, and `coverage` whether
 * the run enforced thresholds.
 */
export function classifyRun({ report, stderrText, exitCode, discoveredFiles, coverage }) {
  const stderr = stderrText ?? "";
  if (stderr.includes(HOST_PREFIX)) {
    return { verdict: "infrastructure", failures: [{ file: null, test: null, class: "infrastructure" }] };
  }
  if (report === null || report === undefined) {
    // A run that left no readable report answered nothing. Exit 0 with no
    // report is still a runner failure: the orchestrator asked for JSON.
    return { verdict: "runner-policy", failures: [{ file: null, test: null, class: "runner-policy" }] };
  }
  const failures = [];
  for (const suite of report.testResults ?? []) {
    for (const test of suite.assertionResults ?? []) {
      if (test.status !== "failed") continue;
      const text = [...(test.failureMessages ?? [])].join("\n");
      failures.push({
        file: suite.name ?? null,
        test: test.fullName ?? test.title ?? null,
        class: RUNNER_PATTERNS.some((p) => text.includes(p)) ? "runner-policy" : "product",
      });
    }
  }
  // A discovered file the report never mentions was dropped by the pool — the
  // silent shape of "the full behavior count did not run", pinned here so no
  // hand-maintained test count has to exist.
  const reported = new Set((report.testResults ?? []).map((s) => s.name));
  for (const file of discoveredFiles ?? []) {
    if (!reported.has(file)) failures.push({ file, test: null, class: "runner-policy" });
  }
  if (failures.length === 0 && exitCode !== 0) {
    // Parsed report, zero failing tests, non-zero exit: under --coverage that
    // is the threshold gate speaking; without it, the runner broke in a way
    // its own report cannot see.
    failures.push({
      file: null,
      test: null,
      class: coverage === true ? "coverage-threshold" : "runner-policy",
    });
  }
  if (failures.length === 0) return { verdict: "clean", failures: [] };
  const classes = new Set(failures.map((f) => f.class));
  const verdict = classes.has("runner-policy")
    ? "runner-policy"
    : classes.has("product")
      ? "product"
      : classes.has("coverage-threshold")
        ? "coverage-threshold"
        : "infrastructure";
  return { verdict, failures };
}
