/**
 * The package-level import graph of src/, and its cycles.
 *
 * `oxlint -D import/no-cycle` reads the FILE graph. Directories are invisible
 * to it — `../c4/likec4.js` is exactly as legal an import as `./likec4.js`, and
 * two packages can point at each other through a pair of files that are
 * themselves perfectly acyclic. So a grouping can satisfy every check the repo
 * runs and still be a lie about which subject depends on which.
 *
 * docs/DESIGN.md rule 21 requires the package graph to be acyclic and names
 * this script as the thing that proves it. Run it before and after moving
 * anything between directories:
 *
 *     node scripts/package-graph.mjs           # report, exit 1 on a cycle
 *     node scripts/package-graph.mjs --print   # also print the whole graph
 *
 * Only VALUE imports are edges. `import type` is erased by
 * `verbatimModuleSyntax`, so a type-only edge is not a runtime edge and cannot
 * make module-evaluation order decide behaviour — the same exemption
 * `import/no-cycle` applies at the file level.
 */
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const src = join(projectRoot, "src");

const posix = (path) => path.split("\\").join("/");

async function sourceFiles(dir) {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await sourceFiles(path)));
    else if (entry.name.endsWith(".ts")) found.push(path);
  }
  return found;
}

/**
 * Relative imports that survive to runtime. Two type-only spellings exist and
 * both must be skipped: `import type { A } from …` and an import clause whose
 * every named binding carries an inline `type` modifier. Missing the second
 * would report a cycle that does not exist at runtime, and a checker that cries
 * wolf is a checker somebody stops running.
 */
function valueImports(source) {
  const targets = [];
  const pattern = /^[ \t]*import\s+(type\s+)?([^;]*?)\s*from\s*["'](\.[^"']+)["']/gm;
  for (const match of source.matchAll(pattern)) {
    const [, typeKeyword, clause, specifier] = match;
    if (typeKeyword) continue;
    const named = clause.trim().startsWith("{") && clause.trim().endsWith("}");
    if (named) {
      const bindings = clause.trim().slice(1, -1).split(",").filter((b) => b.trim() !== "");
      if (bindings.length > 0 && bindings.every((b) => /^\s*type\s+/.test(b))) continue;
    }
    targets.push(specifier);
  }
  return targets;
}

const files = await sourceFiles(src);
/** package → set of packages it imports from, excluding itself. */
const graph = new Map();

for (const file of files) {
  const from = posix(relative(projectRoot, dirname(file)));
  const edges = graph.get(from) ?? new Set();
  graph.set(from, edges);
  for (const specifier of valueImports(await readFile(file, "utf8"))) {
    const target = resolve(dirname(file), specifier.replace(/\.js$/, ".ts"));
    const to = posix(relative(projectRoot, dirname(target)));
    if (to !== from) edges.add(to);
  }
}

/**
 * Every elementary cycle would be more than anybody reads. One shortest cycle
 * per starting package is enough to act on, and the set of them is empty
 * exactly when the graph is acyclic.
 */
function shortestCycleFrom(start) {
  const queue = [[start]];
  const seen = new Set([start]);
  while (queue.length > 0) {
    const path = queue.shift();
    for (const next of graph.get(path.at(-1)) ?? []) {
      if (next === start) return [...path, start];
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push([...path, next]);
    }
  }
  return null;
}

const cycles = new Map();
for (const pkg of [...graph.keys()].sort()) {
  const cycle = shortestCycleFrom(pkg);
  if (cycle) cycles.set([...cycle].sort().join("|"), cycle);
}

if (process.argv.includes("--print")) {
  for (const pkg of [...graph.keys()].sort()) {
    const edges = [...(graph.get(pkg) ?? [])].sort();
    console.log(`${pkg}/`);
    for (const edge of edges) console.log(`    -> ${edge}/`);
    if (edges.length === 0) console.log("    (no outgoing package edges)");
  }
  console.log("");
}

const overLimit = [];
for (const [pkg] of graph) {
  const entries = await readdir(join(projectRoot, pkg), { withFileTypes: true });
  const count = entries.filter((e) => !e.isDirectory()).length;
  if (count > 5) overLimit.push(`${pkg}/ holds ${count} files`);
}

console.log(`packages: ${graph.size}   files: ${files.length}`);
if (overLimit.length > 0) {
  console.log("\nover the five-file limit (test/code-limits.test.ts owns this):");
  for (const line of overLimit) console.log(`  ${line}`);
}

if (cycles.size === 0) {
  console.log("\npackage graph: acyclic");
  process.exitCode = 0;
} else {
  console.log(`\npackage graph: ${cycles.size} cycle(s)`);
  for (const cycle of cycles.values()) console.log(`  ${cycle.map((p) => `${p}/`).join(" -> ")}`);
  console.log(
    "\nA cycle means two packages are really one subject, or one of them holds a leaf-shaped\n" +
      "helper that belongs lower down. Move the helper; do not import the weight.",
  );
  process.exitCode = 1;
}
