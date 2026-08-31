/**
 * Does `meta/docs/architecture/landscape.likec4` still describe `src/`?
 *
 * THIS IS THE CHECK loam CANNOT PERFORM ON ITSELF, and the reason it exists as a
 * script rather than as a finding code. loam reads no source tree — that is a
 * standing non-goal ("no code extractor or generated architecture presented as
 * truth"), and it applies to loam's own repository exactly as it applies to
 * everyone else's. So `loam validate --all` over `meta/docs` can prove that
 * every `Covers:` line resolves to a box that exists (`covers.unknown`) and that
 * the landscape and `services/` agree about the fleet — and it will never,
 * for anybody, answer the two questions this script answers:
 *
 *     a package with no box        — a subject was added and nobody drew it
 *     a box with no package        — a subject was deleted and the map kept it
 *
 * plus the same two for edges: an import the model does not draw, and an edge
 * the model draws that no import makes.
 *
 * IT CONVICTS THE MODEL; IT DOES NOT GENERATE IT. Every failure below prints the
 * exact line to add or delete and then stops. There is deliberately no `--write`,
 * and if one is ever added the non-goal above has been broken — a landscape
 * emitted from a scan is a picture of the code, and the whole claim of the
 * document it would overwrite is that somebody decided what the subjects are.
 *
 *     node scripts/self-model.mjs           # convict; exit 1 on any drift
 *     node scripts/self-model.mjs --print   # the unit graph as the TREE has it
 *
 * The graph comes from `./source-graph.mjs` — the same walk and the same
 * `valueImports` `npm run arch:check` uses, deliberately shared rather than
 * copied, so `import type` is exempt on BOTH sides. A second copy would exempt
 * type-only edges in one place and not the other, and this script would then
 * demand a relationship for an edge arch:check has already, correctly, decided
 * is not an edge.
 *
 * The landscape is read with a regex rather than through LikeC4: the parser
 * lives in `src/`, which is the subject under test, and grading a document with
 * the code it describes makes a parse regression look like a model regression.
 * Honest-but-approximate, like the textual scans in `scripts/arch-check.mjs` —
 * and it is approximate only over a file this repository writes, whose grammar
 * is the four line shapes handled below.
 *
 * To run loam itself over the same tree (which `test/self-model.test.ts` does at
 * gate time), the cwd has to be the one holding the config:
 *
 *     cd meta && npx tsx ../src/cli.ts validate --all
 */
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { collapse, moduleEdges } from "./source-graph.mjs";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const LANDSCAPE = join(projectRoot, "meta", "docs", "architecture", "landscape.likec4");
/** The one element the whole self-model hangs under; `metadata { service 'loam' }` is on it. */
const ROOT = "loam";

/**
 * Mutual dependencies between two TOP-LEVEL subjects, accepted with the refactor
 * that would remove each one named beside it.
 *
 * `npm run arch:graph` cannot see these: it keys on the full relative directory,
 * so `core/c4/project` and `core/c4` are different nodes there and the graph it
 * proves acyclic is a finer one than the subjects `docs/DESIGN.md`'s
 * package-layout table names. That table used to claim, flatly, that every edge
 * points up its row order. It does not, and the claim is now qualified — which
 * is only worth anything if something checks the qualified version, so this is
 * that something.
 *
 * THE LIST MAY ONLY SHRINK, on `test/code-limits-baseline.json`'s doctrine: a
 * cycle not listed here fails the build, and so does a listed one that no longer
 * exists, so the list cannot quietly become the permanent state. Adding an entry
 * is not how you land a change.
 */
const ACCEPTED_CYCLES = [
  // src/core/c4/project/architecture.ts -> ../../repo/paths.ts, against
  // src/core/repo/tree/find.ts -> ../../c4/arch.ts and tree/views.ts ->
  // ../../c4/resolve/service.ts. Breaking it means the path builders the c4
  // project loader needs stop living in `repo/`, which is a move of a hub.
  ["core/c4", "core/repo"],
  // src/core/provenance/findings.ts -> ../repo/paths.ts and
  // ../repo/service-target.ts, against src/core/repo/repo.ts ->
  // ../provenance/sample/scope.ts. Same shape, same size: the sampling scope is
  // a leaf-shaped helper inside a package the read model imports.
  ["core/provenance", "core/repo"],
];

/**
 * The unit a module belongs to — the collapse rule, and the ONE statement of it.
 * `meta/docs/architecture/landscape.likec4`'s banner spells the same rule in
 * English for a reader; this is the copy a machine runs, and if the two ever
 * disagree the file is wrong, because this one is executed.
 *
 *     src/cli.ts             -> cli
 *     src/core/<n>/**        -> core/<n>          src/core/<n>.ts       -> core/<n>
 *     src/commands/<n>/**    -> commands/<n>      src/commands/<n>.ts   -> commands/<n>
 */
function unitOf(module) {
  const parts = module.split("/").slice(1);
  if ((parts[0] === "core" || parts[0] === "commands") && parts.length > 1) {
    return `${parts[0]}/${parts.length === 2 ? parts[1].replace(/\.ts$/, "") : parts[1]}`;
  }
  return parts.join("/").replace(/\.ts$/, "");
}

/** A unit's element id. `-` becomes `_` because a LikeC4 element name is an identifier. */
function elementId(unit) {
  const segments = unit.split("/");
  segments[segments.length - 1] = segments[segments.length - 1].replace(/-/g, "_");
  return [ROOT, ...segments].join(".");
}

/**
 * Comments blanked, offsets preserved, so a line number in a message stays true
 * and a `->` inside a comment is never read as a relationship. Positional, like
 * `codeOnly` in scripts/arch-check.mjs and the mask in scripts/package-docs.mjs.
 */
function codeOnly(text) {
  return text.replace(/\/\/[^\n]*/g, (match) => " ".repeat(match.length));
}

/**
 * The landscape's `model { … }` block, as elements and relationships.
 *
 * Four line shapes and no more, because this repository writes the file:
 * `name = kind 'Title' {`, `name = kind 'Title'`, `source -> target`, and a bare
 * block opener (`metadata {`) that nests without declaring anything. The bare
 * opener pushes a sentinel so its closing brace cannot pop an element's scope —
 * getting that wrong would silently reparent every box after the first
 * `metadata` block, and the diff would then look like a wholesale rename.
 */
function parseLandscape(text) {
  const elements = new Map();
  const relationships = [];
  const stack = [];
  let inModel = false;
  for (const raw of codeOnly(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!inModel) {
      if (/^model\s*\{$/.test(line)) inModel = true;
      continue;
    }
    if (line === "}") {
      if (stack.length === 0) break;
      stack.pop();
      continue;
    }
    const declaration = /^([A-Za-z_]\w*)\s*=\s*([A-Za-z_]\w*)\s+'([^']*)'\s*(\{)?$/.exec(line);
    if (declaration) {
      const [, name, kind, title, opens] = declaration;
      elements.set([...stack.filter((s) => s !== null), name].join("."), { kind, title });
      if (opens) stack.push(name);
      continue;
    }
    const relationship = /^([A-Za-z_][\w.]*)\s*->\s*([A-Za-z_][\w.]*)$/.exec(line);
    if (relationship) {
      relationships.push({ source: relationship[1], target: relationship[2] });
      continue;
    }
    if (line.endsWith("{")) stack.push(null);
  }
  return { elements, relationships };
}

/** Shortest cycle through `start`, or null — the same walk scripts/package-graph.mjs runs. */
function shortestCycleFrom(graph, start) {
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

/**
 * Mutual dependencies between units, as unordered pairs. Pairs rather than paths
 * because `a -> b -> a` and `b -> a -> b` are one fact reported twice, and a
 * baseline keyed on the path would need both spellings to stay green.
 */
function cyclePairs(graph) {
  const pairs = new Map();
  for (const unit of [...graph.keys()].sort()) {
    const cycle = shortestCycleFrom(graph, unit);
    if (cycle === null) continue;
    const members = [...new Set(cycle)].sort();
    pairs.set(members.join("|"), members);
  }
  return pairs;
}

const { modules, edges } = await moduleEdges(projectRoot);
const graph = collapse({ modules, edges }, unitOf);
const units = [...graph.keys()].sort();
/** A unit whose modules are one loose `.ts` file rather than a directory. */
const loose = new Set(modules.map((path) => path.replace(/^src\//, "").replace(/\.ts$/, "")));
const expectedTitle = (unit) => (loose.has(unit) ? `src/${unit}.ts` : `src/${unit}/`);

if (process.argv.includes("--print")) {
  for (const unit of units) {
    console.log(`${elementId(unit)}   '${expectedTitle(unit)}'`);
    for (const target of [...graph.get(unit)].sort()) console.log(`    -> ${elementId(target)}`);
  }
  console.log(`\nunits: ${units.length}   modules: ${modules.length}`);
  console.log("This is the graph the TREE has. It is not the model, and nothing here writes one.");
  process.exit(0);
}

const { elements, relationships } = parseLandscape(await readFile(LANDSCAPE, "utf8"));
/** An element with children is scenery — a grouping. Only the leaves are claims about a package. */
const leaves = [...elements.keys()].filter(
  (id) => id !== ROOT && ![...elements.keys()].some((other) => other.startsWith(`${id}.`)),
);

const problems = [];
const say = (heading, lines) => {
  if (lines.length > 0) problems.push({ heading, lines });
};

const expected = new Map(units.map((unit) => [elementId(unit), unit]));

say(
  "packages with no box — a subject exists in src/ and the model does not draw it",
  units
    .filter((unit) => !elements.has(elementId(unit)))
    .map((unit) => {
      const [area, leaf] = unit.includes("/") ? unit.split("/") : [null, unit];
      const name = (leaf ?? unit).replace(/-/g, "_");
      return `  ${elementId(unit)}   add inside ${area === null ? ROOT : `${ROOT}.${area}`}:  ${name} = container '${expectedTitle(unit)}'`;
    }),
);

say(
  "boxes with no package — the model draws a subject src/ does not have",
  leaves
    .filter((id) => !expected.has(id))
    .map((id) => `  ${id}   delete it, or restore the directory it claims ('${elements.get(id).title}')`),
);

say(
  "boxes whose title is not the path they stand for",
  units
    .filter((unit) => elements.has(elementId(unit)) && elements.get(elementId(unit)).title !== expectedTitle(unit))
    .map((unit) => `  ${elementId(unit)}   title is '${elements.get(elementId(unit)).title}', the path is '${expectedTitle(unit)}'`),
);

const drawn = new Set(relationships.map((r) => `${r.source} -> ${r.target}`));
const real = new Set();
for (const unit of units) for (const target of graph.get(unit)) real.add(`${elementId(unit)} -> ${elementId(target)}`);

say(
  "imports with no relationship — src/ has the edge and the model does not draw it",
  [...real].filter((edge) => !drawn.has(edge)).sort().map((edge) => `  add:  ${edge}`),
);

say(
  "relationships with no import — the model draws an edge no value import makes",
  [...drawn].filter((edge) => !real.has(edge)).sort().map((edge) => `  delete:  ${edge}`),
);

// The qualified acyclicity claim, held rather than merely written. Both
// directions, so the baseline can only shrink.
const found = cyclePairs(graph);
const accepted = new Map(ACCEPTED_CYCLES.map((pair) => [[...pair].sort().join("|"), pair]));
say(
  "mutual dependencies between top-level subjects, not in the accepted baseline",
  [...found.entries()]
    .filter(([key]) => !accepted.has(key))
    .map(([, members]) => `  ${members.join(" <-> ")}   break it, or record it in ACCEPTED_CYCLES with the refactor it needs`),
);
say(
  "accepted mutual dependencies that no longer exist — the baseline may only shrink",
  [...accepted.entries()]
    .filter(([key]) => !found.has(key))
    .map(([, members]) => `  ${members.join(" <-> ")}   delete the ACCEPTED_CYCLES entry; it has been fixed`),
);

console.log(
  `self-model: ${units.length} units / ${real.size} import edges in src/ vs ` +
    `${leaves.length} boxes / ${drawn.size} relationships in meta/docs/architecture/landscape.likec4`,
);

if (problems.length === 0) {
  console.log("\nthe written model describes the tree");
  process.exitCode = 0;
} else {
  for (const { heading, lines } of problems) {
    console.log(`\n${heading}:`);
    for (const line of lines) console.log(line);
  }
  console.log(
    "\nThe fix is printed, never applied. A model finding is edited into\n" +
      "meta/docs/architecture/landscape.likec4 by hand — deciding what the subjects of src/ are\n" +
      "is the whole content of that document, and a landscape emitted from a scan would be a\n" +
      "picture of the code rather than a claim about it. A cycle finding is edited into src/,\n" +
      "or into ACCEPTED_CYCLES above with the refactor it is waiting for.",
  );
  process.exitCode = 1;
}
