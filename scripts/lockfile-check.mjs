/**
 * Whether `npm ci` will accept a checkout's lockfile — asked of npm itself,
 * offline, in a scratch copy, before any tag exists.
 *
 * The defect it closes: 0.2.0-alpha.8 was cut (cafb4d8) after the version bump
 * synced the lockfile with `npm install --package-lock-only` on Windows, which
 * silently dropped `@emnapi/core` and `@emnapi/runtime` — dependencies of the
 * wasm32 rolldown binding, an optional package for another platform. The
 * release runner's first step, `npm ci`, refused the tree; a tag is immutable,
 * so that version never published. `release:check` had passed, because the only
 * thing it read from the lockfile was its two version fields — and those were
 * right. The bump was never the problem; the packages were.
 *
 * How: copy `package.json` and `package-lock.json` into a scratch directory and
 * run `npm ci --dry-run --offline --ignore-scripts` there with an empty cache.
 * Validating the lockfile against the manifest is the first thing `npm ci`
 * does, before it fetches anything, so the verdict needs no network: a lockfile
 * in sync passes with nothing cached, and a stripped one fails with npm's own
 * "Missing: <name>@ from lock file" lines — the exact refusal the runner
 * printed. `--dry-run` installs nothing, and the scratch copy is what keeps the
 * checkout's own `node_modules` out of it, since a real `npm ci` in place
 * deletes that directory first. Measured 2026-10-10 on macOS with npm 11.8:
 * cafb4d8's lockfile exits 1 naming both packages; d92bf57's exits 0 in about
 * a second.
 *
 * A separate module rather than more of `release-check.mjs` so a test can hand
 * it a deliberately stripped lockfile without running the whole preflight —
 * the same reason `gate-stress-classify.mjs` stands apart from its runner.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/**
 * The argv that runs npm, as `[command, ...prefix]`.
 *
 * Node >= 20.12 refuses to spawn npm.cmd without a shell (the CVE-2024-27980
 * mitigation), and `shell: true` would change quoting for every argument. Run
 * npm's own JS entry through this Node instead: npm_execpath is set whenever
 * the script runs under `npm run`, and the two layout probes cover a direct
 * `node scripts/...` invocation on Windows and on POSIX.
 */
export function resolveNpm() {
  const nodeDir = dirname(process.execPath);
  const candidates = [
    process.env.npm_execpath,
    join(nodeDir, "node_modules", "npm", "bin", "npm-cli.js"),
    join(nodeDir, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.endsWith("npm-cli.js") && existsSync(candidate)) {
      return [process.execPath, candidate];
    }
  }
  if (process.platform === "win32") {
    throw new Error("cannot locate npm-cli.js, and npm.cmd is not spawnable without a shell on Node >= 20.12");
  }
  return ["npm"];
}

/**
 * `{ ok: true }` when `npm ci` would accept `dir`'s lockfile, otherwise
 * `{ ok: false, detail }` carrying npm's own reason, trimmed to the lines that
 * say what is wrong.
 */
export async function lockfileInSync(dir) {
  const [npmCommand, ...npmPrefix] = resolveNpm();
  const scratch = await mkdtemp(join(tmpdir(), "loam-lockfile-check-"));
  try {
    const project = join(scratch, "project");
    await mkdir(project);
    await copyFile(join(dir, "package.json"), join(project, "package.json"));
    await copyFile(join(dir, "package-lock.json"), join(project, "package-lock.json"));
    const ci = spawnSync(
      npmCommand,
      [...npmPrefix, "ci", "--dry-run", "--offline", "--ignore-scripts", "--no-audit", "--no-fund"],
      {
        cwd: project,
        encoding: "utf8",
        timeout: 120_000,
        env: { ...process.env, npm_config_cache: join(scratch, "cache"), npm_config_update_notifier: "false" },
      },
    );
    if (ci.status === 0) return { ok: true };
    const output = `${ci.stderr ?? ""}\n${ci.stdout ?? ""}`;
    const reasons = output
      .split("\n")
      .map((line) => line.replace(/^npm error\s*/, "").trim())
      .filter((line) => /in sync|^Missing:|^Invalid:/.test(line));
    const detail = reasons.length > 0 ? reasons.join("; ") : (ci.error?.message ?? output.trim()) || `exit ${ci.status}`;
    return { ok: false, detail };
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}
