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
 * a second. That measurement held for npm 11 only: npm 10 (Node 22.22.3, the
 * CI floor) installed cafb4d8's lockfile without a word, so npm's verdict is a
 * property of the npm asked, not of the file. `missingFromLock` therefore reads
 * the file first, the same on every host, and npm is asked second.
 *
 * A separate module rather than more of `release-check.mjs` so a test can hand
 * it a deliberately stripped lockfile without running the whole preflight —
 * the same reason `gate-stress-classify.mjs` stands apart from its runner.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
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
 * Every dependency a lockfile entry names that no entry in the lockfile can
 * satisfy, as `{ name, requiredBy }`, found by walking the same lookup Node
 * and npm use: `<entry>/node_modules/<name>`, then each enclosing
 * `node_modules` up to the root.
 *
 * Why this exists beside asking npm: the verdict `npm ci --dry-run` gives
 * depends on WHICH npm answers. npm 11 (Node 24, what the release workflow
 * runs) refuses cafb4d8's lockfile; npm 10 (Node 22.22.3, the CI floor)
 * accepted the very same file — CI run 38047258912 went red on exactly that,
 * the test expecting a refusal and npm 10 installing happily. A preflight run
 * on a Node 22 machine would therefore have passed the lockfile that broke the
 * release. This walk reads the file, not an npm, so its answer is the same on
 * every host; npm is still asked second, for the shapes a structural walk does
 * not model.
 *
 * Counted: `dependencies`, `optionalDependencies`, and `peerDependencies` not
 * marked optional in `peerDependenciesMeta` — npm 7+ installs those peers and
 * records them. cafb4d8 lost `@emnapi/core` and `@emnapi/runtime`, a dependency
 * of `@rolldown/binding-wasm32-wasi` and a required peer of
 * `@napi-rs/wasm-runtime`: four misses here, none on d92bf57's lockfile.
 * Workspace links (`link: true`) resolve through their target and are skipped.
 */
export function missingFromLock(lock) {
  const packages = lock?.packages ?? {};
  const missing = [];
  for (const [path, entry] of Object.entries(packages)) {
    if (path === "" || entry?.link === true) continue;
    const peerMeta = entry.peerDependenciesMeta ?? {};
    const requiredPeers = Object.keys(entry.peerDependencies ?? {}).filter((name) => peerMeta[name]?.optional !== true);
    const names = new Set([
      ...Object.keys(entry.dependencies ?? {}),
      ...Object.keys(entry.optionalDependencies ?? {}),
      ...requiredPeers,
    ]);
    for (const name of names) {
      if (!resolvesFrom(packages, path, name)) missing.push({ name, requiredBy: path });
    }
  }
  return missing;
}

/** Node's lookup from the package installed at `path`: its own node_modules, then every enclosing one. */
function resolvesFrom(packages, path, name) {
  let dir = path;
  for (;;) {
    if (packages[dir === "" ? `node_modules/${name}` : `${dir}/node_modules/${name}`] !== undefined) return true;
    if (dir === "") return false;
    const cut = dir.lastIndexOf("/node_modules/");
    dir = cut >= 0 ? dir.slice(0, cut) : "";
  }
}

/**
 * `{ ok: true }` when `npm ci` would accept `dir`'s lockfile, otherwise
 * `{ ok: false, detail }` carrying the reason — the structural walk's misses
 * first (npm-independent, see `missingFromLock`), else npm's own reason,
 * trimmed to the lines that say what is wrong.
 */
export async function lockfileInSync(dir) {
  const lock = JSON.parse(await readFile(join(dir, "package-lock.json"), "utf8"));
  const missing = missingFromLock(lock);
  if (missing.length > 0) {
    const lines = missing.map((m) => `Missing: ${m.name}@ from lock file (required by ${m.requiredBy})`);
    return { ok: false, detail: `package.json and package-lock.json are not in sync — ${lines.join("; ")}` };
  }
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
