import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const scratch = await mkdtemp(join(tmpdir(), "loam-package-smoke-"));
const packDir = join(scratch, "pack");
const installDir = join(scratch, "install");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

function run(command, args, cwd, capture = false) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: capture ? "pipe" : "inherit",
  });
  if (result.status !== 0) {
    if (capture) {
      process.stderr.write(result.stdout ?? "");
      process.stderr.write(result.stderr ?? "");
    }
    throw new Error(`${command} ${args.join(" ")} exited ${result.status ?? "without a status"}`);
  }
  return result.stdout ?? "";
}

try {
  await mkdir(packDir, { recursive: true });
  await mkdir(installDir, { recursive: true });
  const packedJson = run(
    npmCommand,
    ["pack", "--json", "--silent", "--pack-destination", packDir],
    projectRoot,
    true,
  );
  const [packed] = JSON.parse(packedJson);
  if (!packed?.filename || !Array.isArray(packed.files)) {
    throw new Error("npm pack did not return a package manifest");
  }

  const paths = packed.files.map((entry) => entry.path);
  for (const required of ["package.json", "README.md", "LICENSE", "dist/cli.js"]) {
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
  const tarball = resolve(packDir, packed.filename);
  run(
    npmCommand,
    ["install", "--ignore-scripts", "--no-audit", "--no-fund", tarball],
    installDir,
  );

  const bin = join(
    installDir,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "loam.cmd" : "loam",
  );
  run(bin, ["--help"], installDir, true);

  const installedManifest = join(
    installDir,
    "node_modules",
    "@spentsov",
    "loam",
    "package.json",
  );
  const manifest = JSON.parse(await readFile(installedManifest, "utf8"));
  if (manifest.name !== "@spentsov/loam" || manifest.bin?.loam !== "dist/cli.js") {
    throw new Error("installed package identity or loam bin mapping is incorrect");
  }

  console.log(
    `ok: packed ${packed.filename} (${paths.length} files), installed it, and ran its loam --help binary`,
  );
} finally {
  // Only a mkdtemp-created, task-specific directory is removed.
  const scratchRelative = relative(tmpdir(), scratch);
  if (scratchRelative && !scratchRelative.startsWith(`..${sep}`) && !scratchRelative.includes(sep)) {
    await rm(scratch, { recursive: true, force: true });
  }
}
