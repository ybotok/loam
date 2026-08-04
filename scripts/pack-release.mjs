import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

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

const head = spawnSync("git", ["rev-parse", "HEAD"], {
  cwd: projectRoot,
  encoding: "utf8",
});
if (head.status !== 0 || !/^[a-f0-9]{40}$/.test(head.stdout.trim())) {
  throw new Error("release packaging requires an exact git commit");
}
const sourceCommit = head.stdout.trim();
if (process.env.GITHUB_SHA && process.env.GITHUB_SHA !== sourceCommit) {
  throw new Error(`GITHUB_SHA ${process.env.GITHUB_SHA} does not match checked-out HEAD ${sourceCommit}`);
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
    "MIGRATING-from-OpenSpec.md",
    "SCHEMA.md",
    "SECURITY.md",
  ],
  { cwd: projectRoot, encoding: "utf8" },
);
if (publicationInputs.status !== 0 || publicationInputs.stdout.trim()) {
  throw new Error("release packaging requires every publication/build input to be committed");
}

const result = spawnSync(
  npmCommand,
  ["pack", "--json", "--pack-destination", outputDir],
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
