import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));

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
  console.error("usage: node scripts/pack-release.mjs --out <empty-directory> [--github-output <path>]");
  process.exit(2);
}

let out;
let githubOutput;
for (let index = 2; index < process.argv.length; index += 1) {
  if (process.argv[index] === "--out") out = process.argv[++index];
  else if (process.argv[index] === "--github-output") githubOutput = process.argv[++index];
  else if (process.argv[index] === "--help") usage();
  else usage(`unknown argument ${process.argv[index]}`);
}
if (!out) usage("--out is required");
const outputDir = resolve(out);
if (outputDir === projectRoot) usage("--out cannot be the project root");
await mkdir(outputDir, { recursive: true });
const existing = await readdir(outputDir);
if (existing.length > 0) throw new Error(`release output must be empty: ${outputDir}`);

// `^{commit}` peels a ref to the commit it names. An annotated or signed tag —
// what `npm version` and `git tag -a/-s` create — is its own object, so on a tag
// push GITHUB_SHA is the tag object's sha and only equals HEAD after peeling.
function peeledCommit(ref) {
  const result = spawnSync("git", ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], {
    cwd: projectRoot,
    encoding: "utf8",
  });
  const sha = result.stdout?.trim() ?? "";
  return result.status === 0 && /^[a-f0-9]{40}$/.test(sha) ? sha : null;
}

const sourceCommit = peeledCommit("HEAD");
if (!sourceCommit) {
  throw new Error("release packaging requires an exact git commit");
}
if (process.env.GITHUB_SHA) {
  const workflowCommit = peeledCommit(process.env.GITHUB_SHA);
  if (workflowCommit !== sourceCommit) {
    throw new Error(
      `GITHUB_SHA ${process.env.GITHUB_SHA} resolves to ${workflowCommit ?? "no commit"}, `
        + `which does not match checked-out HEAD ${sourceCommit}`,
    );
  }
}
const trackedDiff = spawnSync("git", ["diff", "--quiet", "HEAD", "--"], {
  cwd: projectRoot,
});
if (trackedDiff.status !== 0) {
  throw new Error("release packaging requires a clean tracked worktree");
}
const publicationInputs = spawnSync(
  "git",
  [
    "status",
    "--porcelain",
    "--untracked-files=all",
    "--",
    "src",
    "package.json",
    "package-lock.json",
    "tsconfig.json",
    "scripts/clean.mjs",
    "README.md",
    "LICENSE",
    "CHANGELOG.md",
    "COMPARISON.md",
    "CONTRIBUTING.md",
    "MIGRATING-from-OpenSpec.md",
    "ROADMAP.md",
    "SCHEMA.md",
    "SECURITY.md",
    "WORKFLOW.md",
  ],
  { cwd: projectRoot, encoding: "utf8" },
);
if (publicationInputs.status !== 0 || publicationInputs.stdout.trim()) {
  throw new Error("release packaging requires every publication/build input to be committed");
}

const result = spawnSync(
  npmCommand,
  [...npmPrefix, "pack", "--json", "--pack-destination", outputDir],
  { cwd: projectRoot, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
);
if (result.stderr) process.stderr.write(result.stderr);
if (result.status !== 0) {
  process.stderr.write(result.stdout ?? "");
  throw new Error(`npm pack failed with ${result.error?.message ?? result.signal ?? result.status}`);
}

const packed = JSON.parse(result.stdout);
if (!Array.isArray(packed) || packed.length !== 1 || typeof packed[0]?.filename !== "string") {
  throw new Error("npm pack did not produce exactly one package manifest");
}
const packageManifest = JSON.parse(await readFile(resolve(projectRoot, "package.json"), "utf8"));
const filename = packed[0].filename;
if (filename.includes("/") || filename.includes("\\")) throw new Error(`unsafe tarball filename: ${filename}`);
if (packed[0].name !== packageManifest.name || packed[0].version !== packageManifest.version) {
  throw new Error(
    `npm pack identity ${packed[0].name ?? "(missing)"}@${packed[0].version ?? "(missing)"} `
      + `does not match package.json ${packageManifest.name}@${packageManifest.version}`,
  );
}
const expectedFilename = `${packageManifest.name.replace(/^@/, "").replaceAll("/", "-")}-${packageManifest.version}.tgz`;
if (filename !== expectedFilename) {
  throw new Error(`npm pack filename ${filename} does not match canonical ${expectedFilename}`);
}
const tarballPath = resolve(outputDir, filename);
const bytes = await readFile(tarballPath);
const metadata = await stat(tarballPath);
const artifact = {
  schemaVersion: "1.0",
  package: packageManifest.name,
  version: packageManifest.version,
  filename,
  sha256: createHash("sha256").update(bytes).digest("hex"),
  size: metadata.size,
  sourceCommit,
};
await writeFile(
  resolve(outputDir, "release-manifest.json"),
  `${JSON.stringify(artifact, null, 2)}\n`,
  { flag: "wx" },
);
console.log(`packed ${filename}`);
console.log(`sha256 ${artifact.sha256}`);
if (githubOutput) {
  await appendFile(
    resolve(githubOutput),
    `tarball=${tarballPath}\nsha256=${artifact.sha256}\nmanifest=${resolve(outputDir, "release-manifest.json")}\n`,
    "utf8",
  );
}
