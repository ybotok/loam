import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const scratch = await mkdtemp(join(tmpdir(), "loam-package-smoke-"));
const packDir = join(scratch, "pack");
const installDir = join(scratch, "install");
const cacheDir = join(scratch, "npm-cache");

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
const isolatedEnv = {
  ...process.env,
  npm_config_cache: cacheDir,
  npm_config_engine_strict: "true",
};

let suppliedTarball = null;
for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index];
  if (arg === "--tarball") suppliedTarball = process.argv[++index] ?? null;
  else if (arg === "--help") {
    console.log("usage: node scripts/package-smoke.mjs [--tarball <already-packed.tgz>]");
    process.exit(0);
  } else {
    throw new Error(`unknown package-smoke argument: ${arg}`);
  }
}
if (process.argv.includes("--tarball") && suppliedTarball === null) {
  throw new Error("--tarball requires a path");
}

function run(command, args, cwd, capture = false) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: isolatedEnv,
    timeout: 180_000,
    maxBuffer: 64 * 1024 * 1024,
    stdio: capture ? "pipe" : "inherit",
  });
  if (capture && result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) {
    if (capture) {
      process.stderr.write(result.stdout ?? "");
    }
    const why = result.error?.message ?? result.signal ?? result.status ?? "without a status";
    throw new Error(`${command} ${args.join(" ")} exited ${why}`);
  }
  return result.stdout ?? "";
}

// The installed CLI is always run as `node <installed dist/cli.js>`: the
// node_modules/.bin shim is a .cmd on Windows, which Node >= 20.12 will not
// spawn without a shell. The shim's existence is asserted separately.
function jsonCommand(cli, args, cwd) {
  const output = run(process.execPath, [cli, ...args, "--json"], cwd, true);
  const envelope = JSON.parse(output);
  if (envelope.ok !== true || envelope.contractVersion !== "1.0") {
    throw new Error(`loam ${args.join(" ")} did not return a successful v1.0 JSON envelope`);
  }
  return envelope;
}

try {
  await mkdir(packDir, { recursive: true });
  await mkdir(installDir, { recursive: true });
  await mkdir(cacheDir, { recursive: true });
  let tarball;
  let packedFilename;
  let paths;
  if (suppliedTarball === null) {
    const packedJson = run(
      npmCommand,
      [...npmPrefix, "pack", "--json", "--pack-destination", packDir],
      projectRoot,
      true,
    );
    const [packed] = JSON.parse(packedJson);
    if (!packed?.filename || !Array.isArray(packed.files)) {
      throw new Error("npm pack did not return a package manifest");
    }
    packedFilename = packed.filename;
    paths = packed.files.map((entry) => entry.path);
    tarball = resolve(packDir, packed.filename);
  } else {
    tarball = resolve(suppliedTarball);
    await readFile(tarball);
    packedFilename = basename(tarball);
    const listing = run("tar", ["-tzf", tarball], projectRoot, true);
    paths = listing
      .split(/\r?\n/)
      .filter(Boolean)
      .map((entry) => entry.replace(/^package\//, "").replace(/\/$/, ""))
      .filter(Boolean);
  }

  for (const required of [
    "package.json",
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
    "dist/cli.js",
  ]) {
    if (!paths.includes(required)) throw new Error(`tarball is missing ${required}`);
  }
  const forbidden = paths.find(
    (path) => path.startsWith("src/") || path.startsWith("test/") || path.startsWith("scripts/"),
  );
  if (forbidden) throw new Error(`tarball unexpectedly includes ${forbidden}`);

  // A clean build guarantees each emitted module still has a source file. This
  // catches the stale-dist failure that a simple "CLI prints help" smoke misses.
  for (const path of paths.filter(
    (candidate) => candidate.startsWith("dist/") && candidate.endsWith(".js"),
  )) {
    const source = resolve(projectRoot, path.replace(/^dist\//, "src/").replace(/\.js$/, ".ts"));
    try {
      await readFile(source);
    } catch {
      throw new Error(`tarball contains stale build output ${path}`);
    }
  }
  await writeFile(join(installDir, "package.json"), '{"private":true}\n', { flag: "wx" });
  run(
    npmCommand,
    [...npmPrefix, "install", "--engine-strict", "--ignore-scripts", "--no-audit", "--no-fund", tarball],
    installDir,
  );

  const shim = join(
    installDir,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "loam.cmd" : "loam",
  );
  await stat(shim).catch(() => {
    throw new Error(`installing the tarball did not create the loam bin shim at ${shim}`);
  });

  const installedPackageRoot = join(
    installDir,
    "node_modules",
    "@ybotok",
    "loam",
  );
  const installedManifest = join(installedPackageRoot, "package.json");
  const manifest = JSON.parse(await readFile(installedManifest, "utf8"));
  if (manifest.name !== "@ybotok/loam"
    || manifest.bin?.loam !== "dist/cli.js"
    || manifest.engines?.node !== ">=22.22.3") {
    throw new Error("installed package identity, engine contract, or loam bin mapping is incorrect");
  }
  const cli = resolve(installedPackageRoot, manifest.bin.loam);
  run(process.execPath, [cli, "--help"], installDir, true);
  const version = run(process.execPath, [cli, "--version"], installDir, true).trim();
  if (version !== manifest.version) {
    throw new Error(`installed loam --version is ${version}, expected ${manifest.version}`);
  }
  for (const path of paths.filter(
    (candidate) => candidate.startsWith("dist/") && candidate.endsWith(".js.map"),
  )) {
    const map = JSON.parse(await readFile(resolve(installedPackageRoot, path), "utf8"));
    if (!Array.isArray(map.sources) || !Array.isArray(map.sourcesContent)
      || map.sources.length !== map.sourcesContent.length
      || map.sourcesContent.some((source) => typeof source !== "string")) {
      throw new Error(`installed source map ${path} does not embed sourcesContent for published debugging`);
    }
  }

  // Exercise a small real workflow through the installed tarball, not the
  // source tree: initialize a docs repo, scaffold a feature, then inventory it.
  // `--create` is required: init refuses to scaffold a docs repo that --docs
  // only names, so that a misspelled path cannot silently fork the fleet.
  jsonCommand(cli, ["init", "--docs", "docs", "--create", "--no-commands"], installDir);
  jsonCommand(cli, ["new", "SMOKE-1", "--title", "Tarball workflow"], installDir);
  const inventory = jsonCommand(cli, ["list"], installDir);
  if (inventory.features?.length !== 1 || inventory.features[0]?.id !== "SMOKE-1") {
    throw new Error("installed tarball workflow did not inventory the scaffolded SMOKE-1 feature");
  }

  // Exercise the compatibility surface through the installed package too:
  // audit a small living+active OpenSpec workspace, bind the generated mapping,
  // dry-run it, then apply into a separate empty staging target.
  const openspecProject = join(installDir, "openspec-source");
  const openspecRoot = join(openspecProject, "openspec");
  const livingSpecPath = join(openspecRoot, "specs", "payments", "spec.md");
  const deltaSpecPath = join(
    openspecRoot,
    "changes",
    "add-refunds",
    "specs",
    "payments",
    "spec.md",
  );
  await mkdir(dirname(livingSpecPath), { recursive: true });
  await mkdir(dirname(deltaSpecPath), { recursive: true });
  await writeFile(join(openspecRoot, "config.yaml"), "schema: spec-driven\n", { flag: "wx" });
  const livingSource = `# Payments\n\n## Requirements\n\n### Requirement: Capture payment\nThe system SHALL capture an authorized payment.\n\n#### Scenario: Captured\n- **WHEN** capture is requested\n- **THEN** the payment is captured\n`;
  const deltaSource = `# Refunds\n\n## ADDED Requirements\n\n### Requirement: Refund payment\nThe system SHALL refund a captured payment.\n\n#### Scenario: Refunded\n- **WHEN** a refund is requested\n- **THEN** the payment is refunded\n`;
  await writeFile(livingSpecPath, livingSource, { flag: "wx" });
  await writeFile(deltaSpecPath, deltaSource, { flag: "wx" });

  const mappingPath = join(installDir, "openspec-mapping.yaml");
  const audit = jsonCommand(
    cli,
    ["audit-openspec", openspecProject, "--write-mapping", mappingPath],
    installDir,
  );
  if (audit.mappingWritten !== mappingPath || audit.changes?.active?.length !== 1) {
    throw new Error("installed tarball OpenSpec audit did not inventory the active change or write its mapping");
  }
  const mapping = parseYaml(await readFile(mappingPath, "utf8"));
  mapping.capabilities.payments.services = ["payments"];
  mapping.changes["add-refunds"].feature = "FEAT-99";
  mapping.changes["add-refunds"].title = "Add refunds";
  await writeFile(mappingPath, stringifyYaml(mapping, { lineWidth: 0 }), "utf8");

  const dryRun = jsonCommand(
    cli,
    ["migrate-openspec", openspecProject, "--map", mappingPath],
    installDir,
  );
  if (dryRun.dryRun !== true || dryRun.ready !== true || dryRun.applied !== null) {
    throw new Error("installed tarball OpenSpec migration dry-run was not ready and non-writing");
  }
  const migrationTarget = join(installDir, "openspec-migrated");
  const applied = jsonCommand(
    cli,
    [
      "migrate-openspec",
      openspecProject,
      "--map",
      mappingPath,
      "--apply",
      "--target",
      migrationTarget,
    ],
    installDir,
  );
  if (applied.dryRun !== false || applied.applied?.directory !== migrationTarget) {
    throw new Error("installed tarball OpenSpec migration did not apply to the explicit staging target");
  }
  const stagedLiving = await readFile(
    join(migrationTarget, "services", "payments", "spec.md"),
    "utf8",
  );
  const stagedDelta = await readFile(
    join(migrationTarget, "features", "FEAT-99-add-refunds", "specs", "payments", "spec.md"),
    "utf8",
  );
  if (!stagedLiving.includes("### Requirement: Capture payment")
    || !stagedDelta.includes("### Requirement: Refund payment")) {
    throw new Error("installed tarball OpenSpec migration omitted living or active requirements");
  }
  if (await readFile(livingSpecPath, "utf8") !== livingSource
    || await readFile(deltaSpecPath, "utf8") !== deltaSource) {
    throw new Error("installed tarball OpenSpec migration changed its source workspace");
  }

  console.log(
    `ok: verified ${packedFilename} (${paths.length} entries), installed it with an isolated strict-engine npm cache, and completed init/new/list plus OpenSpec audit/dry-run/apply through the tarball binary`,
  );
} finally {
  // Only a mkdtemp-created, task-specific directory is removed.
  const scratchRelative = relative(tmpdir(), scratch);
  if (scratchRelative && !scratchRelative.startsWith(`..${sep}`) && !scratchRelative.includes(sep)) {
    await rm(scratch, { recursive: true, force: true });
  }
}
