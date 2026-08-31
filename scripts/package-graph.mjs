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
 * `import/no-cycle` applies at the file level. That rule, and the walk it runs
 * over, moved to `./source-graph.mjs` when `scripts/self-model.mjs` became the
 * second reader of the same graph: this file still owns the CYCLE REPORT, which
 * is the only thing rule 21 names it for.
 */
import { readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { collapse, moduleEdges, posix } from "./source-graph.mjs";

// --root lets the self-tests point the same rules at a fixture tree; the
// default is this repository, byte-identical to the pre-flag behaviour.
const rootFlag = process.argv.indexOf("--root");
const projectRoot = rootFlag === -1 ? dirname(dirname(fileURLToPath(import.meta.url))) : resolve(process.argv[rootFlag + 1]);

const modules = await moduleEdges(projectRoot);
const files = modules.modules;
/** package → set of packages it imports from, excluding itself. */
const graph = collapse(modules, (module) => posix(dirname(module)));

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
