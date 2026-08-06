import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, rmSync } from "node:fs";
import { lstat, mkdir, mkdtemp, readFile, readdir, readlink, realpath, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { performance } from "node:perf_hooks";
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
const PROFILES = ["brownfield-adoption", "active-cross-service"];

function usage(message) {
  if (message) console.error(`error: ${message}`);
  console.error("usage:");
  console.error("  node scripts/pilot-harness.mjs --check-manifest <manifest.json> [--selftest]");
  console.error("  node scripts/pilot-harness.mjs --artifact-dir <release-pack-dir> --manifest <manifest.json> --out <scorecard.json>");
  process.exit(2);
}

const options = {
  artifactDir: undefined,
  checkManifest: undefined,
  manifest: undefined,
  out: undefined,
  selftest: false,
};
for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index];
  if (arg === "--check-manifest") options.checkManifest = process.argv[++index];
  else if (arg === "--selftest") options.selftest = true;
  else if (arg === "--artifact-dir") options.artifactDir = process.argv[++index];
  else if (arg === "--manifest") options.manifest = process.argv[++index];
  else if (arg === "--out") options.out = process.argv[++index];
  else if (arg === "--help") usage();
  else usage(`unknown argument ${arg}`);
}
if (options.checkManifest && (options.artifactDir || options.manifest || options.out)) usage("--check-manifest cannot be combined with a run");
if (!options.checkManifest && options.selftest) usage("--selftest requires --check-manifest");
if (!options.checkManifest && (!options.artifactDir || !options.manifest || !options.out)) {
  usage("a run requires --artifact-dir, --manifest, and --out");
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validateManifest(value, allowPlaceholders) {
  const errors = [];
  if (!isRecord(value)) return ["manifest must be a JSON object"];
  if (value.schemaVersion !== "1.0") errors.push('schemaVersion must be "1.0"');
  if (!['baseline', 'exit'].includes(value.phase)) errors.push('phase must be "baseline" or "exit"');
  if (!Array.isArray(value.fleets) || value.fleets.length !== 2) {
    errors.push("manifest must declare exactly two fleets");
    return errors;
  }

  const profiles = new Set();
  const ids = new Set();
  for (const [index, fleet] of value.fleets.entries()) {
    const where = `fleets[${index}]`;
    if (!isRecord(fleet)) {
      errors.push(`${where} must be an object`);
      continue;
    }
    if (typeof fleet.id !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(fleet.id)) {
      errors.push(`${where}.id must use lowercase letters, digits, and dashes`);
    } else if (ids.has(fleet.id)) errors.push(`${where}.id must be unique`);
    else ids.add(fleet.id);
    if (!PROFILES.includes(fleet.profile)) errors.push(`${where}.profile must be ${PROFILES.join(" or ")}`);
    else if (profiles.has(fleet.profile)) errors.push(`${where}.profile must be unique`);
    else profiles.add(fleet.profile);
    if (typeof fleet.workDir !== "string" || fleet.workDir.length === 0) errors.push(`${where}.workDir is required`);
    if (!allowPlaceholders && /REPLACE|replace-with/i.test(`${fleet.id} ${fleet.workDir}`)) {
      errors.push(`${where} still contains an example placeholder`);
    }
    if (!isRecord(fleet.criteria)) {
      errors.push(`${where}.criteria must be an object`);
      continue;
    }
    for (const field of ["minServices", "minMaturityStates", "minActiveFeatures", "minCrossServiceFeatures", "maxValidateMs"]) {
      if (!Number.isInteger(fleet.criteria[field]) || fleet.criteria[field] < 0) {
        errors.push(`${where}.criteria.${field} must be a non-negative integer`);
      }
    }
    for (const field of ["requireDoctorHealthy", "requireValid"]) {
      if (typeof fleet.criteria[field] !== "boolean") errors.push(`${where}.criteria.${field} must be boolean`);
    }
    if (fleet.profile === "brownfield-adoption") {
      if (fleet.criteria.minServices < 5) errors.push(`${where} brownfield pilot requires minServices >= 5`);
      if (fleet.criteria.minMaturityStates < 3) errors.push(`${where} brownfield pilot requires minMaturityStates >= 3`);
    }
    if (fleet.profile === "active-cross-service") {
      if (fleet.criteria.minServices < 5) errors.push(`${where} cross-service pilot requires minServices >= 5`);
      if (fleet.criteria.minActiveFeatures < 1) errors.push(`${where} cross-service pilot requires minActiveFeatures >= 1`);
      if (fleet.criteria.minCrossServiceFeatures < 1) errors.push(`${where} cross-service pilot requires minCrossServiceFeatures >= 1`);
    }
    if (fleet.criteria.maxValidateMs <= 0) errors.push(`${where}.criteria.maxValidateMs must be greater than zero`);
    if (value.phase === "exit" && fleet.criteria.requireValid !== true) {
      errors.push(`${where}.criteria.requireValid must be true for an exit run`);
    }
    if (value.phase === "exit" && fleet.criteria.requireDoctorHealthy !== true) {
      errors.push(`${where}.criteria.requireDoctorHealthy must be true for an exit run`);
    }
  }
  for (const profile of PROFILES) {
    if (!profiles.has(profile)) errors.push(`one fleet must use profile ${profile}`);
  }
  return errors;
}

async function loadManifest(path, allowPlaceholders) {
  let value;
  try {
    value = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new Error(`cannot read manifest ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const errors = validateManifest(value, allowPlaceholders);
  if (errors.length > 0) throw new Error(`invalid pilot manifest:\n- ${errors.join("\n- ")}`);
  return value;
}

if (options.checkManifest) {
  const manifestPath = resolve(options.checkManifest);
  const manifest = await loadManifest(manifestPath, true);
  console.log(`ok: ${manifestPath} declares ${manifest.phase} criteria for exactly two pilot profiles`);
  if (options.selftest) {
    const invalidExit = structuredClone(manifest);
    invalidExit.phase = "exit";
    invalidExit.fleets[0].criteria.requireDoctorHealthy = false;
    invalidExit.fleets[1].criteria.requireValid = false;
    const invalidErrors = validateManifest(invalidExit, true);
    if (!invalidErrors.some((error) => error.includes("requireDoctorHealthy must be true"))
      || !invalidErrors.some((error) => error.includes("requireValid must be true"))) {
      throw new Error("pilot manifest self-test did not reject disabled exit health gates");
    }
    const validExit = structuredClone(manifest);
    validExit.phase = "exit";
    for (const fleet of validExit.fleets) {
      fleet.criteria.requireDoctorHealthy = true;
      fleet.criteria.requireValid = true;
    }
    const validErrors = validateManifest(validExit, true);
    if (validErrors.length > 0) {
      throw new Error(`pilot manifest self-test rejected valid exit gates: ${validErrors.join("; ")}`);
    }
    console.log("ok: pilot manifest self-test rejects disabled exit health gates");
  }
  process.exit(0);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function treeDigest(root) {
  const hash = createHash("sha256");
  async function visit(directory, prefix = "") {
    const entries = (await readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.name !== ".git")
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const path = resolve(directory, entry.name);
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      const metadata = await lstat(path);
      if (metadata.isDirectory()) {
        hash.update(`d\0${rel}\0`);
        await visit(path, rel);
      } else if (metadata.isSymbolicLink()) {
        hash.update(`l\0${rel}\0${await readlink(path)}\0`);
      } else if (metadata.isFile()) {
        hash.update(`f\0${rel}\0`);
        hash.update(await readFile(path));
        hash.update("\0");
      } else {
        hash.update(`o\0${rel}\0${metadata.mode}\0`);
      }
    }
  }
  await visit(root);
  return hash.digest("hex");
}

function run(command, args, cwd, timeout) {
  const started = performance.now();
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    timeout,
  });
  const durationMs = Math.round(performance.now() - started);
  let payload = null;
  let parseError = null;
  try {
    payload = JSON.parse(result.stdout ?? "");
  } catch (error) {
    parseError = error instanceof Error ? error.message : String(error);
  }
  return {
    exitCode: result.status,
    signal: result.signal,
    durationMs,
    stdoutSha256: sha256(result.stdout ?? ""),
    stderr: (result.stderr ?? "").trim(),
    spawnError: result.error?.message ?? null,
    parseError,
    payload,
  };
}

function gitSource() {
  const commit = spawnSync("git", ["rev-parse", "HEAD"], { cwd: projectRoot, encoding: "utf8" });
  const status = spawnSync("git", ["status", "--porcelain", "--untracked-files=no"], { cwd: projectRoot, encoding: "utf8" });
  const sourceInputs = spawnSync(
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
    ],
    { cwd: projectRoot, encoding: "utf8" },
  );
  return {
    commit: commit.status === 0 ? commit.stdout.trim() : null,
    trackedFilesDirty: status.status !== 0 ? null : status.stdout.trim().length > 0,
    sourceInputsDirty: sourceInputs.status !== 0 ? null : sourceInputs.stdout.trim().length > 0,
  };
}

function gate(id, pass, evidence) {
  return { id, status: pass ? "pass" : "fail", evidence };
}

function inside(parent, child) {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== "..");
}

async function canonicalForCreate(target) {
  let cursor = dirname(target);
  const suffix = [basename(target)];
  while (true) {
    try {
      return resolve(await realpath(cursor), ...suffix);
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) {
        throw error;
      }
      const parent = dirname(cursor);
      if (parent === cursor) throw error;
      suffix.unshift(basename(cursor));
      cursor = parent;
    }
  }
}

const manifestPath = resolve(options.manifest);
const requestedOutputPath = resolve(options.out);
const manifest = await loadManifest(manifestPath, false);
const outputPath = await canonicalForCreate(requestedOutputPath);
try {
  await lstat(outputPath);
  throw new Error(`--out already exists: ${outputPath}`);
} catch (error) {
  if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) {
    throw error;
  }
}

const source = gitSource();
if (!source.commit || source.trackedFilesDirty !== false || source.sourceInputsDirty !== false) {
  throw new Error("pilot runs require clean, committed source inputs at an exact git commit");
}
const packageManifest = JSON.parse(await readFile(resolve(projectRoot, "package.json"), "utf8"));
const artifactDir = await realpath(resolve(options.artifactDir)).catch(() => null);
if (!artifactDir) throw new Error(`release artifact directory does not exist: ${options.artifactDir}`);
const artifactEntries = (await readdir(artifactDir)).sort();
const expectedArtifactEntries = ["release-manifest.json"];
const artifact = JSON.parse(await readFile(resolve(artifactDir, "release-manifest.json"), "utf8"));
if (artifact.schemaVersion !== "1.0"
  || artifact.package !== packageManifest.name
  || artifact.version !== packageManifest.version
  || artifact.sourceCommit !== source.commit
  || typeof artifact.filename !== "string"
  || artifact.filename.includes("/")
  || artifact.filename.includes("\\")
  || !/^[a-f0-9]{64}$/.test(artifact.sha256)
  || !Number.isInteger(artifact.size)
  || artifact.size <= 0) {
  throw new Error("release artifact manifest does not match the clean pilot source commit/package");
}
const canonicalArtifactFilename = `${packageManifest.name.replace(/^@/, "").replaceAll("/", "-")}-${packageManifest.version}.tgz`;
if (artifact.filename !== canonicalArtifactFilename) {
  throw new Error(`release artifact filename ${artifact.filename} does not match ${canonicalArtifactFilename}`);
}
expectedArtifactEntries.push(artifact.filename);
expectedArtifactEntries.sort();
if (JSON.stringify(artifactEntries) !== JSON.stringify(expectedArtifactEntries)) {
  throw new Error(`release artifact directory has unexpected contents: ${artifactEntries.join(", ")}`);
}
const tarballPath = resolve(artifactDir, artifact.filename);
const tarballBytes = await readFile(tarballPath);
const tarballStat = await stat(tarballPath);
if (sha256(tarballBytes) !== artifact.sha256 || tarballStat.size !== artifact.size) {
  throw new Error("release artifact tarball does not match its SHA-256/size manifest");
}

const candidateScratch = await mkdtemp(join(tmpdir(), "loam-pilot-candidate-"));
const scratchRelative = relative(tmpdir(), candidateScratch);
if (!scratchRelative || scratchRelative.startsWith(`..${sep}`) || scratchRelative.includes(sep)) {
  throw new Error(`unsafe pilot scratch directory: ${candidateScratch}`);
}
let scratchCleaned = false;
function cleanupCandidate() {
  if (scratchCleaned) return;
  scratchCleaned = true;
  rmSync(candidateScratch, { recursive: true, force: true });
}
process.once("exit", cleanupCandidate);
const installDir = resolve(candidateScratch, "install");
const cacheDir = resolve(candidateScratch, "npm-cache");
const privateTarballPath = resolve(candidateScratch, artifact.filename);
await mkdir(installDir, { recursive: true });
await mkdir(cacheDir, { recursive: true });
await writeFile(privateTarballPath, tarballBytes, { flag: "wx" });
if (sha256(await readFile(privateTarballPath)) !== artifact.sha256) {
  throw new Error("private pilot candidate copy failed its SHA-256 recheck");
}
await writeFile(resolve(installDir, "package.json"), '{"private":true}\n', { flag: "wx" });
const install = spawnSync(
  npmCommand,
  [...npmPrefix, "install", "--engine-strict", "--ignore-scripts", "--no-audit", "--no-fund", privateTarballPath],
  {
    cwd: installDir,
    encoding: "utf8",
    env: {
      ...process.env,
      npm_config_cache: cacheDir,
      npm_config_engine_strict: "true",
    },
    maxBuffer: 64 * 1024 * 1024,
    timeout: 180_000,
  },
);
if (install.status !== 0) {
  process.stderr.write(install.stdout ?? "");
  process.stderr.write(install.stderr ?? "");
  throw new Error(`isolated candidate install failed with ${install.error?.message ?? install.signal ?? install.status}`);
}
const installedPackageRoot = resolve(installDir, "node_modules", "@ybotok", "loam");
const installedManifest = JSON.parse(await readFile(resolve(installedPackageRoot, "package.json"), "utf8"));
if (installedManifest.name !== artifact.package
  || installedManifest.version !== artifact.version
  || installedManifest.bin?.loam !== "dist/cli.js") {
  throw new Error("installed pilot candidate identity does not match the verified release artifact");
}
const candidateCliPath = resolve(installedPackageRoot, "dist", "cli.js");
await stat(candidateCliPath).catch(() => {
  throw new Error(`installed pilot candidate has no CLI at ${candidateCliPath}`);
});
const cliSha256 = sha256(await readFile(candidateCliPath));
const distSha256 = await treeDigest(resolve(installedPackageRoot, "dist"));
const runtimeTreeSha256 = await treeDigest(resolve(installDir, "node_modules"));
const fleetRuns = [];

for (const fleet of manifest.fleets) {
  const workDir = isAbsolute(fleet.workDir)
    ? fleet.workDir
    : resolve(dirname(manifestPath), fleet.workDir);
  const canonicalWorkDir = await realpath(workDir).catch(() => null);
  if (!canonicalWorkDir) throw new Error(`${fleet.id}: workDir does not exist: ${workDir}`);
  if (fleetRuns.some((candidate) => candidate.workDir === canonicalWorkDir)) {
    throw new Error(`${fleet.id}: the two pilot fleets must use independent workDir repositories`);
  }
  const configPath = resolve(canonicalWorkDir, "loam.json");
  const config = JSON.parse(await readFile(configPath, "utf8"));
  if (typeof config.docsDir !== "string" || config.docsDir.length === 0) {
    throw new Error(`${fleet.id}: ${configPath} has no docsDir`);
  }
  const docsDir = await realpath(resolve(canonicalWorkDir, config.docsDir)).catch(() => null);
  if (!docsDir) throw new Error(`${fleet.id}: configured docsDir does not exist`);
  if (inside(canonicalWorkDir, outputPath)) {
    throw new Error(`${fleet.id}: --out must be outside the measured fleet repository`);
  }
  if (inside(docsDir, outputPath)) {
    throw new Error(`${fleet.id}: --out must be outside the measured docsDir`);
  }

  const before = await treeDigest(docsDir);
  const commands = [
    { id: "doctor", args: ["doctor"] },
    { id: "list", args: ["list"] },
    { id: "validate-all", args: ["validate", "--all"] },
    { id: "dependencies", args: ["dependencies"] },
  ];
  const evidence = {};
  for (const command of commands) {
    const timeout = command.id === "validate-all"
      ? Math.max(fleet.criteria.maxValidateMs * 2, 10_000)
      : 60_000;
    evidence[command.id] = [
      run(process.execPath, [candidateCliPath, ...command.args, "--json"], canonicalWorkDir, timeout),
      run(process.execPath, [candidateCliPath, ...command.args, "--json"], canonicalWorkDir, timeout),
    ];
  }
  const after = await treeDigest(docsDir);

  const first = Object.fromEntries(Object.entries(evidence).map(([id, runs]) => [id, runs[0].payload]));
  const services = Array.isArray(first.list?.services) ? first.list.services.length : 0;
  const activeFeatures = Array.isArray(first.list?.features) ? first.list.features.length : 0;
  const maturityStates = isRecord(first.list?.maturity)
    ? Object.values(first.list.maturity).filter((count) => Number(count) > 0).length
    : 0;
  const crossServiceFeatures = Array.isArray(first.list?.features)
    ? first.list.features.filter((feature) => new Set(feature.services ?? []).size >= 2).length
    : 0;
  const deterministic = Object.values(evidence).every(([left, right]) =>
    left.exitCode === right.exitCode && left.stdoutSha256 === right.stdoutSha256,
  );
  const contractOk = Object.entries(evidence).every(([commandId, runs]) =>
    runs.every((result) => {
      if (result.spawnError !== null
        || result.signal !== null
        || result.parseError !== null
        || result.payload?.contractVersion !== "1.0"
        || result.payload?.ok !== true) return false;
      const expectedExit = commandId === "doctor"
        ? (result.payload.healthy === true ? 0 : 1)
        : commandId === "validate-all"
          ? (result.payload.valid === true ? 0 : 1)
          : 0;
      return result.exitCode === expectedExit;
    }),
  );
  const validateMs = Math.max(...evidence["validate-all"].map((result) => result.durationMs));
  const gates = [
    gate("json-contract", contractOk, "all eight command executions returned an ok v1.0 envelope with the contract-compatible exit code and no signal"),
    gate("deterministic-read-commands", deterministic, "two runs per command have identical exit codes and stdout SHA-256"),
    gate("docs-unchanged", before === after, { beforeSha256: before, afterSha256: after }),
    gate("doctor-healthy", !fleet.criteria.requireDoctorHealthy || first.doctor?.healthy === true, { required: fleet.criteria.requireDoctorHealthy, actual: first.doctor?.healthy ?? null }),
    gate("minimum-services", services >= fleet.criteria.minServices, { required: fleet.criteria.minServices, actual: services }),
    gate("minimum-maturity-states", maturityStates >= fleet.criteria.minMaturityStates, { required: fleet.criteria.minMaturityStates, actual: maturityStates }),
    gate("minimum-active-features", activeFeatures >= fleet.criteria.minActiveFeatures, { required: fleet.criteria.minActiveFeatures, actual: activeFeatures }),
    gate("minimum-cross-service-features", crossServiceFeatures >= fleet.criteria.minCrossServiceFeatures, { required: fleet.criteria.minCrossServiceFeatures, actual: crossServiceFeatures }),
    gate("validate-duration", validateMs <= fleet.criteria.maxValidateMs, { maximumMs: fleet.criteria.maxValidateMs, actualWorstOfTwoMs: validateMs }),
    gate("fleet-valid", !fleet.criteria.requireValid || first["validate-all"]?.valid === true, { required: fleet.criteria.requireValid, actual: first["validate-all"]?.valid ?? null }),
  ];

  fleetRuns.push({
    id: fleet.id,
    profile: fleet.profile,
    workDir: canonicalWorkDir,
    docsDir,
    criteria: fleet.criteria,
    observed: {
      services,
      maturityStates,
      activeFeatures,
      crossServiceFeatures,
      validateValid: first["validate-all"]?.valid ?? null,
      validationSummary: first["validate-all"]?.summary ?? null,
      dependencyConflicts: first.dependencies?.conflicts?.length ?? null,
      dependencyCycles: first.dependencies?.cycles?.length ?? null,
    },
    gates,
    commands: Object.fromEntries(Object.entries(evidence).map(([id, runs]) => [id, runs.map((result) => ({
      exitCode: result.exitCode,
      signal: result.signal,
      durationMs: result.durationMs,
      stdoutSha256: result.stdoutSha256,
      stderr: result.stderr,
      spawnError: result.spawnError,
      parseError: result.parseError,
    }))])),
    automatedStatus: gates.every((candidate) => candidate.status === "pass") ? "pass" : "fail",
    manualAssessment: {
      status: "not-assessed",
      requiredFields: [
        "operator and role",
        "task attempted and completion status",
        "elapsed minutes and undocumented interventions",
        "validator findings classified as true/false positive",
        "P0/P1 integrity or security incidents",
        "operator confidence and blocking feedback",
      ],
    },
  });
}

if (new Set(fleetRuns.map((fleet) => fleet.docsDir)).size !== fleetRuns.length) {
  throw new Error("the two pilot fleets resolve to the same docsDir; independent fleets are required");
}

const scorecard = {
  schemaVersion: "1.0",
  generatedAt: new Date().toISOString(),
  phase: manifest.phase,
  source: {
    package: packageManifest.name,
    version: packageManifest.version,
    artifactFilename: artifact.filename,
    artifactSha256: artifact.sha256,
    artifactSize: artifact.size,
    cliSha256,
    distSha256,
    runtimeTreeSha256,
    ...source,
  },
  environment: {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
  },
  fleets: fleetRuns,
  automatedStatus: fleetRuns.every((fleet) => fleet.automatedStatus === "pass") ? "pass" : "fail",
  manualStatus: "not-assessed",
  pilotStatus: "incomplete",
  note: "The harness never marks a pilot complete: human evidence must be reviewed against docs/pilot/SCORECARD.md.",
};

const recheckedOutputPath = await canonicalForCreate(requestedOutputPath);
if (recheckedOutputPath !== outputPath) {
  throw new Error("--out canonical path changed during the pilot run");
}
for (const fleet of fleetRuns) {
  if (inside(fleet.workDir, recheckedOutputPath) || inside(fleet.docsDir, recheckedOutputPath)) {
    throw new Error(`${fleet.id}: --out resolved inside a measured fleet after the pilot run`);
  }
}
await mkdir(dirname(recheckedOutputPath), { recursive: true });
const finalOutputPath = resolve(await realpath(dirname(recheckedOutputPath)), basename(recheckedOutputPath));
if (finalOutputPath !== recheckedOutputPath) {
  throw new Error("--out parent resolved differently while preparing the scorecard");
}
await writeFile(finalOutputPath, `${JSON.stringify(scorecard, null, 2)}\n`, { flag: "wx" });
cleanupCandidate();
console.log(`wrote ${finalOutputPath}`);
console.log(`automated status: ${scorecard.automatedStatus}; manual status: not-assessed; pilot status: incomplete`);
if (scorecard.automatedStatus !== "pass") process.exitCode = 1;
