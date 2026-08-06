import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { appendFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

// Node >= 20.12 refuses to spawn npm.cmd without a shell (the CVE-2024-27980
// mitigation), and `shell: true` would change quoting for every argument. Run
// npm's own JS entry through this Node instead: npm_execpath is set whenever
// the script runs under `npm run`, and the two layout probes cover a direct
// `node scripts/...` invocation on Windows and on POSIX.
function resolveNpm() {
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
const [npmCommand, ...npmPrefix] = resolveNpm();
const MIN_NODE = [22, 22, 3];
const MIN_OIDC_NPM = [11, 5, 1];
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

function usage(message) {
  if (message) console.error(`error: ${message}`);
  console.error("usage: node scripts/release-check.mjs [--tag vX.Y.Z] [--publish] [--github-output <path>] [--fixture-ready]");
  process.exit(2);
}

const options = { publish: false, tag: undefined, githubOutput: undefined, fixtureReady: false };
for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index];
  if (arg === "--publish") options.publish = true;
  else if (arg === "--tag") options.tag = process.argv[++index];
  else if (arg === "--github-output") options.githubOutput = process.argv[++index];
  else if (arg === "--fixture-ready") options.fixtureReady = true;
  else if (arg === "--help") usage();
  else usage(`unknown argument ${arg}`);
}
if (options.publish && !options.tag) usage("--publish requires --tag");
if (options.githubOutput && !options.publish) usage("--github-output is only valid with --publish");
// The fixture waives three prerequisites that only the canonical repository can
// satisfy, so it must never stand in for the real preflight — which runs on a
// tag. Running inside Actions is not itself the conflict: CI runs this self-test
// on every push and pull request, and refusing there left the static checks
// unverified in the one place the project counts.
if (options.fixtureReady && (options.publish || options.tag || options.githubOutput || process.env.GITHUB_REF_TYPE === "tag")) {
  usage("--fixture-ready is a static self-test only and cannot be combined with a tag, publish, GitHub output, or a tag ref");
}

const failures = [];
const passes = [];
function check(condition, label, failure) {
  if (condition) passes.push(label);
  else failures.push(failure ?? label);
}

function tuple(version) {
  return version.split(".").slice(0, 3).map((part) => Number(part));
}

function atLeast(actual, minimum) {
  for (let index = 0; index < minimum.length; index += 1) {
    if ((actual[index] ?? 0) > minimum[index]) return true;
    if ((actual[index] ?? 0) < minimum[index]) return false;
  }
  return true;
}

function distTag(version) {
  const prerelease = version.match(SEMVER)?.[4];
  if (!prerelease) return "latest";
  const channel = prerelease.split(".").find((part) => /[A-Za-z]/.test(part))?.toLowerCase();
  return ["alpha", "beta", "rc", "next", "canary", "dev"].includes(channel ?? "")
    ? channel
    : "next";
}

function repositorySlug(repository) {
  const raw = typeof repository === "string" ? repository : repository?.url;
  if (typeof raw !== "string") return null;
  const match = raw.match(/^(?:git\+)?https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/);
  return match ? `${match[1]}/${match[2]}` : null;
}

const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const lockfile = JSON.parse(await readFile(join(root, "package-lock.json"), "utf8"));
const changelog = await readFile(join(root, "CHANGELOG.md"), "utf8");
const securityPolicy = await readFile(join(root, "SECURITY.md"), "utf8");
const workflowText = await readFile(join(root, ".github", "workflows", "release.yml"), "utf8");
const workflow = parse(workflowText);
const versionMatch = typeof manifest.version === "string" ? manifest.version.match(SEMVER) : null;

check(manifest.name === "@ybotok/loam", "package identity is @ybotok/loam");
check(Boolean(versionMatch), "package version is canonical semver", `package version is not canonical semver: ${manifest.version}`);
check(manifest.engines?.node === ">=22.22.3", "package engine matches the direct dependency floor");
check(manifest.publishConfig?.access === "public", "scoped package is explicitly public");
check(manifest.publishConfig?.provenance === true, "package requests npm provenance");
check(manifest.bin?.loam === "dist/cli.js", "loam bin points at dist/cli.js");
check(
  lockfile.version === manifest.version && lockfile.packages?.[""]?.version === manifest.version,
  "package-lock root version matches package.json",
  `package-lock root version (${lockfile.version ?? "missing"}/${lockfile.packages?.[""]?.version ?? "missing"}) does not match package.json ${manifest.version}`,
);

const requiredPackageFiles = [
  "dist",
  "CHANGELOG.md",
  "COMPARISON.md",
  "MIGRATING-from-OpenSpec.md",
  "SCHEMA.md",
  "SECURITY.md",
];
for (const path of requiredPackageFiles) {
  check(manifest.files?.includes(path), `tarball allow-list includes ${path}`);
}

// The fixture waives the requirement that a canonical repository be CONFIGURED.
// It cannot waive which repository the manifest names, so the runner cross-check
// below reads the manifest's own slug and never the placeholder: comparing
// `fixture/loam` against GITHUB_REPOSITORY failed in every repository that ran
// the self-test, which is every repository this workflow can run in.
const manifestSlug = repositorySlug(manifest.repository);
const slug = manifestSlug ?? (options.fixtureReady ? "fixture/loam" : null);
check(
  slug !== null,
  manifestSlug !== null ? "package repository is an exact GitHub URL" : "fixture overrides the external repository prerequisite",
  "package.repository is missing or is not an exact https://github.com/<owner>/<repo>[.git] URL; configure it only after the canonical repository is known",
);
if (manifestSlug && process.env.GITHUB_REPOSITORY) {
  check(
    manifestSlug === process.env.GITHUB_REPOSITORY,
    "package repository matches GITHUB_REPOSITORY case-sensitively",
    `package.repository resolves to ${manifestSlug}, but the workflow runs in ${process.env.GITHUB_REPOSITORY}`,
  );
}

if (versionMatch) {
  const escaped = manifest.version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const releaseHeading = new RegExp(`^## \\[${escaped}\\] - \\d{4}-\\d{2}-\\d{2}$`, "m");
  check(
    options.fixtureReady || releaseHeading.test(changelog),
    options.fixtureReady ? "fixture overrides the external changelog-date prerequisite" : `CHANGELOG has a dated ${manifest.version} release entry`,
    `CHANGELOG needs a "## [${manifest.version}] - YYYY-MM-DD" entry before tagging`,
  );
}

const securityRouteBlocker = "<!-- loam-release-blocker: private-security-route -->";
check(
  options.fixtureReady || !securityPolicy.includes(securityRouteBlocker),
  options.fixtureReady ? "fixture overrides the external private-security-route prerequisite" : "SECURITY has a durable private reporting route",
  "SECURITY.md still contains the private-security-route release blocker; configure exact durable reporting instructions before tagging",
);

if (options.tag && versionMatch) {
  check(
    options.tag === `v${manifest.version}`,
    "git tag matches package version exactly",
    `tag ${options.tag} does not match package version v${manifest.version}`,
  );
}

check(workflow?.permissions?.contents === "read", "workflow default permission is contents: read");
check(workflow?.jobs?.["release-gate"]?.permissions?.contents === "read", "gate job is read-only");
check(workflow?.jobs?.publish?.permissions?.contents === "read", "publish job keeps contents read-only");
check(workflow?.jobs?.publish?.permissions?.["id-token"] === "write", "only publish job can mint an OIDC token");
check(workflow?.jobs?.publish?.environment === "npm-production", "publish job uses the protected npm-production environment");
check(workflow?.jobs?.publish?.needs === "release-gate", "publish waits for release-gate");
const checkoutPin = "actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd";
const setupNodePin = "actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e";
const uploadPin = "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a";
const downloadPin = "actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c";
check(workflowText.includes(checkoutPin), "release pins checkout v6.0.2 by full commit SHA");
check(workflowText.includes(setupNodePin), "release pins setup-node v6.4.0 by full commit SHA");
check(workflowText.includes(uploadPin), "release pins upload-artifact v7.0.1 by full commit SHA");
check(workflowText.includes(downloadPin), "release pins download-artifact v8.0.1 by full commit SHA");
const checkoutSteps = Object.values(workflow.jobs).flatMap((job) => job.steps ?? []).filter((step) => step.uses?.startsWith("actions/checkout@"));
check(checkoutSteps.length === 2 && checkoutSteps.every((step) => step.with?.["persist-credentials"] === false), "release checkouts do not persist git credentials");
check(workflowText.includes("registry-url: https://registry.npmjs.org"), "publish configures the npm registry");
check(workflowText.includes("package-manager-cache: false"), "release disables package-manager cache");
check(!/NPM_TOKEN|NODE_AUTH_TOKEN/.test(workflowText), "release has no long-lived npm token fallback");
check(workflowText.includes("npm run test:coverage"), "release gate runs the coverage suite");
check(workflowText.includes("npm run release:pack"), "release gate creates one publication candidate");
check(
  workflowText.includes('npm run test:package -- --tarball "${{ steps.pack.outputs.tarball }}"'),
  "release gate package-smokes the exact publication candidate",
);
check(workflowText.includes("npm publish \"${{ steps.artifact.outputs.tarball }}\""), "publish consumes the verified tarball path");
const publishRuns = workflow.jobs.publish.steps.map((step) => step.run ?? "").join("\n");
check(!/npm (?:ci|install(?! --global npm@11\.5\.1)|run build|pack)/.test(publishRuns), "publish job does not install project dependencies, rebuild, or repack");

const npmCache = await mkdtemp(join(tmpdir(), "loam-release-check-cache-"));
const pack = spawnSync(npmCommand, [...npmPrefix, "pack", "--json", "--dry-run", "--ignore-scripts"], {
  cwd: root,
  encoding: "utf8",
  env: { ...process.env, npm_config_cache: npmCache },
});
await rm(npmCache, { recursive: true, force: true });
if (pack.status !== 0) {
  failures.push(`npm pack --dry-run failed: ${(pack.stderr || pack.stdout).trim()}`);
} else {
  try {
    const [packed] = JSON.parse(pack.stdout);
    const paths = new Set(packed.files.map((entry) => entry.path));
    for (const required of ["package.json", "README.md", "LICENSE", "CHANGELOG.md", "SECURITY.md", "dist/cli.js"]) {
      check(paths.has(required), `dry-run tarball contains ${required}`);
    }
    const forbidden = [...paths].find((path) => /^(src|test|scripts)\//.test(path));
    check(!forbidden, "dry-run tarball excludes source, tests, and scripts", `dry-run tarball includes forbidden path ${forbidden}`);
  } catch (error) {
    failures.push(`could not parse npm pack --json output: ${error instanceof Error ? error.message : String(error)}`);
  }
}

if (options.publish) {
  check(atLeast(tuple(process.versions.node), MIN_NODE), "publish runtime satisfies Node >=22.22.3");
  const npmVersion = spawnSync(npmCommand, [...npmPrefix, "--version"], { encoding: "utf8" });
  const npmText = npmVersion.stdout?.trim() ?? "";
  check(
    npmVersion.status === 0 && atLeast(tuple(npmText), MIN_OIDC_NPM),
    "publish runtime satisfies npm >=11.5.1",
    `trusted publishing needs npm >=11.5.1; found ${npmText || "unavailable"}`,
  );
  check(process.env.GITHUB_ACTIONS === "true", "publish runs in GitHub Actions");
  check(process.env.GITHUB_EVENT_NAME === "push", "publish was triggered by a push event");
  check(process.env.GITHUB_REF_TYPE === "tag", "publish ref is a tag");
  check(Boolean(process.env.ACTIONS_ID_TOKEN_REQUEST_URL), "GitHub exposed an OIDC request URL");
  check(Boolean(process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN), "GitHub exposed an OIDC request token");
}

for (const label of passes) console.log(`ok: ${label}`);
for (const failure of failures) console.error(`blocker: ${failure}`);

if (failures.length > 0) {
  console.error(`release preflight blocked (${failures.length} blocker${failures.length === 1 ? "" : "s"})`);
  process.exit(1);
}

if (options.githubOutput) {
  await appendFile(
    options.githubOutput,
    `version=${manifest.version}\ndist-tag=${distTag(manifest.version)}\n`,
    "utf8",
  );
}
console.log(`release preflight passed for ${manifest.name}@${manifest.version} (npm dist-tag: ${distTag(manifest.version)})`);
