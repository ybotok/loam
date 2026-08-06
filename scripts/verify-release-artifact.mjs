import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { appendFile, readFile, readdir, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const MIN_NODE = [22, 22, 3];
const MIN_NPM = [11, 5, 1];
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

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

function usage(message) {
  if (message) console.error(`error: ${message}`);
  console.error("usage: node scripts/verify-release-artifact.mjs --dir <artifact-directory> --tag <vX.Y.Z> --github-output <path>");
  process.exit(2);
}

const options = {};
for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index];
  if (arg === "--dir") options.dir = process.argv[++index];
  else if (arg === "--tag") options.tag = process.argv[++index];
  else if (arg === "--github-output") options.githubOutput = process.argv[++index];
  else if (arg === "--help") usage();
  else usage(`unknown argument ${arg}`);
}
if (!options.dir || !options.tag || !options.githubOutput) usage("--dir, --tag, and --github-output are required");

function tuple(version) {
  return version.split(".").slice(0, 3).map(Number);
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
  return ["alpha", "beta", "rc", "next", "canary", "dev"].includes(channel ?? "") ? channel : "next";
}

const directory = resolve(options.dir);
const artifact = JSON.parse(await readFile(resolve(directory, "release-manifest.json"), "utf8"));
if (artifact.schemaVersion !== "1.0") throw new Error("unsupported release manifest schema");
if (artifact.package !== "@ybotok/loam") throw new Error(`unexpected release package ${artifact.package ?? "(missing)"}`);
if (typeof artifact.filename !== "string" || artifact.filename.includes("/") || artifact.filename.includes("\\")) {
  throw new Error("release manifest has an unsafe tarball filename");
}
if (!SEMVER.test(artifact.version) || options.tag !== `v${artifact.version}`) {
  throw new Error(`tag ${options.tag} does not match artifact version v${artifact.version}`);
}
const expectedFilename = `ybotok-loam-${artifact.version}.tgz`;
if (artifact.filename !== expectedFilename) {
  throw new Error(`release filename ${artifact.filename} does not match canonical ${expectedFilename}`);
}
if (!/^[a-f0-9]{64}$/.test(artifact.sha256)) throw new Error("release manifest has an invalid SHA-256");
if (process.env.GITHUB_ACTIONS !== "true" || process.env.GITHUB_EVENT_NAME !== "push" || process.env.GITHUB_REF_TYPE !== "tag") {
  throw new Error("artifact publication is restricted to a GitHub Actions tag push");
}
// `^{commit}` peels a ref to the commit it names. On a tag push GITHUB_SHA is
// the tag OBJECT's sha whenever the tag is annotated or signed — the default for
// `npm version` and for `git tag -a/-s` — while the manifest records the peeled
// commit, so the two only compare equal after peeling.
const workflowCommit = (() => {
  if (!process.env.GITHUB_SHA) return null;
  const result = spawnSync("git", ["rev-parse", "--verify", "--quiet", `${process.env.GITHUB_SHA}^{commit}`], {
    cwd: projectRoot,
    encoding: "utf8",
  });
  const sha = result.stdout?.trim() ?? "";
  return result.status === 0 && /^[a-f0-9]{40}$/.test(sha) ? sha : null;
})();
if (!workflowCommit || artifact.sourceCommit !== workflowCommit) {
  throw new Error(`artifact commit ${artifact.sourceCommit ?? "(missing)"} does not match workflow commit ${workflowCommit ?? process.env.GITHUB_SHA ?? "(missing)"}`);
}
if (!process.env.ACTIONS_ID_TOKEN_REQUEST_URL || !process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN) {
  throw new Error("GitHub OIDC request context is unavailable");
}
if (!atLeast(tuple(process.versions.node), MIN_NODE)) throw new Error(`Node ${process.versions.node} is below 22.22.3`);
const npm = spawnSync(npmCommand, [...npmPrefix, "--version"], { encoding: "utf8" });
const npmVersion = npm.stdout?.trim() ?? "";
if (npm.status !== 0 || !atLeast(tuple(npmVersion), MIN_NPM)) throw new Error(`npm ${npmVersion || "unavailable"} is below 11.5.1`);

const entries = (await readdir(directory)).sort();
const expected = [artifact.filename, "release-manifest.json"].sort();
if (JSON.stringify(entries) !== JSON.stringify(expected)) throw new Error(`unexpected release artifact contents: ${entries.join(", ")}`);
const tarball = resolve(directory, artifact.filename);
const bytes = await readFile(tarball);
const metadata = await stat(tarball);
const actualHash = createHash("sha256").update(bytes).digest("hex");
if (actualHash !== artifact.sha256) throw new Error(`tarball SHA-256 mismatch: expected ${artifact.sha256}, found ${actualHash}`);
if (metadata.size !== artifact.size) throw new Error(`tarball size mismatch: expected ${artifact.size}, found ${metadata.size}`);

const packedManifestResult = spawnSync("tar", ["-xOf", tarball, "package/package.json"], {
  encoding: "utf8",
  maxBuffer: 4 * 1024 * 1024,
});
if (packedManifestResult.status !== 0) {
  throw new Error(
    `could not read package/package.json from the verified tarball: ${
      packedManifestResult.error?.message
        ?? packedManifestResult.stderr?.trim()
        ?? packedManifestResult.signal
        ?? packedManifestResult.status
    }`,
  );
}
let packedManifest;
try {
  packedManifest = JSON.parse(packedManifestResult.stdout);
} catch (error) {
  throw new Error(
    `verified tarball has an invalid package/package.json: ${error instanceof Error ? error.message : String(error)}`,
  );
}
if (packedManifest.name !== artifact.package) {
  throw new Error(`tarball package ${packedManifest.name ?? "(missing)"} does not match sidecar package ${artifact.package ?? "(missing)"}`);
}
if (packedManifest.version !== artifact.version) {
  throw new Error(`tarball version ${packedManifest.version ?? "(missing)"} does not match sidecar version ${artifact.version}`);
}
if (options.tag !== `v${packedManifest.version}`) {
  throw new Error(`tag ${options.tag} does not match verified tarball version v${packedManifest.version}`);
}

await appendFile(
  options.githubOutput,
  `tarball=${tarball}\ndist-tag=${distTag(artifact.version)}\nversion=${artifact.version}\nsha256=${actualHash}\n`,
  "utf8",
);
console.log(`verified ${artifact.filename} (${actualHash}) for ${options.tag}; npm dist-tag ${distTag(artifact.version)}`);
