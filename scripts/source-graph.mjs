/**
 * The value-import graph of `src/`, as data. No report, no exit code, no
 * top-level side effects — so a script and a test can both import it without
 * running anything (the shape `scripts/package-docs.mjs` already uses).
 *
 * TWO consumers read this, and the reason it is one module rather than two
 * copies is that they must agree about what an EDGE is:
 *
 *   - `scripts/package-graph.mjs` collapses it to directories and reports the
 *     package-level cycles docs/DESIGN.md rule 21 rests on;
 *   - `scripts/self-model.mjs` collapses it to the units `meta/docs` draws and
 *     convicts the written model of not describing this tree.
 *
 * A second copy of `valueImports` would exempt `import type` on one side and
 * not the other, and the self-model would then report a "missing relationship"
 * for an edge `arch:check` has already, correctly, decided is not an edge.
 * Only VALUE imports count: `verbatimModuleSyntax` erases a type-only import,
 * so it is not a runtime edge and cannot make module-evaluation order decide
 * behaviour — the same exemption `import/no-cycle` applies at the file level.
 */
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

/** Backslashes are a Windows accident; every id in this repo's graphs is posix. */
export const posix = (path) => path.split("\\").join("/");

/** Every `.ts` file under `dir`, recursively, as absolute paths. */
export async function sourceFiles(dir) {
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
export function valueImports(source) {
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

/**
 * Every module in `src/` and every value-import edge between two of them, both
 * spelled as project-relative posix paths ending `.ts`.
 *
 * MODULE granularity, not package: the two consumers collapse it differently
 * (one to directories, one to top-level units), and a graph pre-collapsed for
 * either of them cannot answer the other's question. The `.js` → `.ts` rewrite
 * is the ESM specifier convention this repo compiles under; the target file is
 * not stat'ed, because `npm run typecheck` already fails on an import that
 * resolves to nothing and a second existence check here would only disagree.
 */
export async function moduleEdges(projectRoot) {
  const modules = [];
  const edges = [];
  for (const file of await sourceFiles(join(projectRoot, "src"))) {
    const from = posix(relative(projectRoot, file));
    modules.push(from);
    for (const specifier of valueImports(await readFile(file, "utf8"))) {
      const target = resolve(dirname(file), specifier.replace(/\.js$/, ".ts"));
      edges.push({ from, to: posix(relative(projectRoot, target)) });
    }
  }
  return { modules, edges };
}

/**
 * The module graph collapsed onto a caller's own idea of a node.
 *
 * `nodeOf` maps a module path to the node holding it; a self-edge is dropped,
 * because a node importing itself says nothing about which subject depends on
 * which. Every node a module lands in is a key even when it has no outgoing
 * edges — a leaf package still exists, and a consumer counting nodes (or
 * checking one drawn box per node) must see it.
 */
export function collapse({ modules, edges }, nodeOf) {
  const graph = new Map();
  for (const module of modules) {
    const node = nodeOf(module);
    if (!graph.has(node)) graph.set(node, new Set());
  }
  for (const { from, to } of edges) {
    const source = nodeOf(from);
    const target = nodeOf(to);
    if (source === target) continue;
    const out = graph.get(source) ?? new Set();
    graph.set(source, out);
    out.add(target);
  }
  return graph;
}
