/**
 * The one command that runs every architecture check the repository claims.
 *
 * docs/DESIGN.md and docs/CODE-STYLE.md state invariants — no import cycles at
 * file or package level, core never imports commands, no barrel re-exports, no
 * output or process-control side effects in core outside the envelope adapter,
 * every child process bounded, brand casts only inside their constructor
 * modules. Before this script, only the package graph and the counted limits
 * were executable; the rest were review guidance, and review guidance drifts.
 *
 *     node scripts/arch-check.mjs            # the repository
 *     node scripts/arch-check.mjs --root X   # a fixture tree (the self-tests)
 *
 * The textual checks are honest-but-approximate: regex over source, not a
 * parser. An aliased import, a cast split across lines, or generated code
 * could slip them. Each check therefore has a negative self-test
 * (test/arch-gate.test.ts) pinning that a representative violation fails —
 * the checks may be approximate, but they may not quietly become no-ops.
 */
import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { existsSync, realpathSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const rootFlag = process.argv.indexOf("--root");
// realpath, not merely resolve: macOS's tmpdir is a symlink (/var/folders ->
// /private/var/folders), and oxlint walking THROUGH the link silently scans
// zero files and exits 0 — a green over a tree it never read, which is the
// one answer this gate must never give.
const root = realpathSync(rootFlag === -1 ? projectRoot : resolve(process.argv[rootFlag + 1]));
const src = join(root, "src");

const posix = (p) => p.split("\\").join("/");

async function sourceFiles(dir) {
  if (!existsSync(dir)) return [];
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await sourceFiles(path)));
    else if (entry.name.endsWith(".ts")) found.push(path);
  }
  return found;
}

/**
 * Source with comments and string CONTENTS blanked, so text inside them
 * cannot match a rule. String DELIMITERS survive — the barrel check's pattern
 * ends on the opening quote of the specifier, and blanking the quote with the
 * contents silently retired that check once already.
 *
 * A single left-to-right scanner, not chained regexes, and that is a lesson:
 * the chained form stripped block comments FIRST, so a `/*` inside a line
 * comment or a glob string ("features/**") opened a phantom block comment
 * that blanked real code to the next `*​/` — 96 lines of new.ts, including
 * everything four of the seven checks would have read. A state machine
 * cannot be reordered into that bug.
 */
function codeOnly(source) {
  let out = "";
  let state = "code";
  for (let i = 0; i < source.length; i += 1) {
    const c = source[i];
    const next = source[i + 1];
    if (state === "code") {
      if (c === "/" && next === "/") { state = "line"; out += "  "; i += 1; }
      else if (c === "/" && next === "*") { state = "block"; out += "  "; i += 1; }
      else if (c === '"' || c === "'" || c === "`") { state = c; out += c; }
      else out += c;
    } else if (state === "line") {
      if (c === "\n") { state = "code"; out += c; }
      else out += " ";
    } else if (state === "block") {
      if (c === "*" && next === "/") { state = "code"; out += "  "; i += 1; }
      else out += c === "\n" ? c : " ";
    } else {
      // Inside a string; `state` is the closing delimiter.
      if (c === "\\") { out += "  "; i += 1; }
      else if (c === state) { out += c; state = "code"; }
      else out += c === "\n" ? c : " ";
    }
  }
  return out;
}

const failures = [];
const say = (check, problem) => failures.push(`[${check}] ${problem}`);

// ---------------------------------------------------------------- 1. file cycles
// oxlint's import plugin reads the real file graph. Branch on the exit code
// only — its human output is a formatter's, and formatters change.
try {
  await run(process.execPath, [join(projectRoot, "node_modules", "oxlint", "bin", "oxlint"), "-D", "import/no-cycle", "--import-plugin", src], {
    timeout: 120_000,
    maxBuffer: 16 * 1024 * 1024,
  });
} catch (err) {
  if (typeof err.code === "number" && err.code > 0) say("file-cycles", "oxlint -D import/no-cycle reports a cycle in src/");
  else say("file-cycles", `oxlint could not be run: ${err.message}`);
}

// ------------------------------------------------------------- 2. package graph
try {
  await run(process.execPath, [join(projectRoot, "scripts", "package-graph.mjs"), ...(root === projectRoot ? [] : ["--root", root])], {
    timeout: 60_000,
    maxBuffer: 16 * 1024 * 1024,
  });
} catch (err) {
  say("package-graph", `scripts/package-graph.mjs failed: exit ${err.code ?? "?"}`);
}

const files = await sourceFiles(src);
const sources = new Map();
for (const file of files) sources.set(file, await readFile(file, "utf8"));

// ------------------------------------------------------------------ 3. layering
// EVERY import counts here, type-only included: DESIGN rule 3 says "core never
// imports commands" with no exemption, and a type edge is still a reader-visible
// dependency pointing the wrong way.
for (const [file, source] of sources) {
  if (!posix(file).includes("/src/core/")) continue;
  for (const m of source.matchAll(/^[ \t]*import[^;]*?from\s*["'](\.[^"']+)["']/gm)) {
    const target = posix(resolve(dirname(file), m[1]));
    if (target.includes("/src/commands/")) {
      say("layering", `${posix(relative(root, file))} imports ${m[1]} — core must never import commands`);
    }
  }
}

// ------------------------------------------------------------------- 4. barrels
for (const [file, source] of sources) {
  if (posix(file).endsWith("/index.ts")) say("barrels", `${posix(relative(root, file))} — no index.ts under src/`);
  for (const m of codeOnly(source).matchAll(/^[ \t]*export\s+(?:type\s+)?(?:\{[^}]*\}|\*)\s*from\s*["']/gm)) {
    void m;
    say("barrels", `${posix(relative(root, file))} re-exports from another module — a barrel hides the real import edge`);
    break;
  }
}

// -------------------------------------------------- 5. console/process boundary
// The deliberate output layer is the one named exception. process.env and
// process.cwd stay legal: reading the environment is not controlling the
// process or printing past the envelope.
const CONSOLE_EXCEPTION = posix(join("src", "core", "envelope", "json.ts"));
for (const [file, source] of sources) {
  const rel = posix(relative(root, file));
  if (!rel.startsWith("src/core/") || rel === CONSOLE_EXCEPTION) continue;
  const code = codeOnly(source);
  for (const m of code.matchAll(/\b(console\.\w+|process\.exit\b|process\.exitCode\b|process\.argv\b)/g)) {
    say("core-boundary", `${rel} uses ${m[1]} — core computes answers; the envelope adapter is the one output layer`);
  }
}

// --------------------------------------------------------- 6. child processes
// Scope: src/ — the product. Every call span must declare a timeout; the
// buffering exec* forms must also declare maxBuffer. Balanced-paren span, so
// options objects on later lines still count.
for (const [file, source] of sources) {
  const code = codeOnly(source);
  if (!/from\s+["']node:child_process["']/.test(source)) continue;
  // (?<!\.) — `.exec(` is RegExp's method, not a child process.
  for (const m of code.matchAll(/(?<!\.)\b(spawn|spawnSync|execFile|execFileSync|exec|execSync)\s*\(/g)) {
    const start = m.index + m[0].length - 1;
    let depth = 0;
    let end = start;
    for (let i = start; i < code.length; i += 1) {
      if (code[i] === "(") depth += 1;
      else if (code[i] === ")") {
        depth -= 1;
        if (depth === 0) { end = i; break; }
      }
    }
    const span = code.slice(start, end + 1);
    const rel = posix(relative(root, file));
    if (!/\btimeout\b/.test(span)) say("child-process", `${rel} calls ${m[1]}() without a timeout`);
    if (m[1].startsWith("exec") && !/\bmaxBuffer\b/.test(span)) {
      say("child-process", `${rel} calls buffering ${m[1]}() without an explicit maxBuffer`);
    }
  }
}

// ----------------------------------------------------------------- 7. brand casts
// A brand is worth its annotations only while the cast inside the constructor
// is the only one. The whitelist is the constructor modules themselves.
const BRANDS = ["ServiceId", "RawServiceId", "DeclaredService", "PathableService", "FeatureId", "RawFeatureId", "DocsDir", "FeatureDir", "ServiceDir", "SubsystemName", "PortablePath"];
const CAST_WHITELIST = [posix(join("src", "core", "kernel", "ids")) + "/", posix(join("src", "core", "kernel", "path-safety.ts"))];
const castPattern = new RegExp(`\\bas\\s+(?:${BRANDS.join("|")})\\b`, "g");
for (const [file, source] of sources) {
  const rel = posix(relative(root, file));
  if (CAST_WHITELIST.some((w) => rel.startsWith(w))) continue;
  for (const m of codeOnly(source).matchAll(castPattern)) {
    say("brand-casts", `${rel} casts with \`${m[0]}\` outside the constructor modules — the smart constructor is the only bridge`);
  }
}

// ------------------------------------------------------- 8. the LikeC4 view stage
// docs/DESIGN.md rule 26: loam reads what a view DECLARES and never computes
// what a view SHOWS. Two scans, because the rule has two halves and they fail
// differently. The compute stages are banned outright — resolving a view's
// predicates against the model is the thing the rule forbids, and there is no
// legitimate caller. `$data` is the raw parsed record the permitted read goes
// through, so it is confined rather than banned: one module reads it, and the
// blast radius of an upstream shape change is that module.
//
// Both had ZERO occurrences when the rule landed, so neither carries a
// whitelist. The one mention of `computedModel` in the tree, at
// core/c4/likec4.ts:270, is inside a comment — which `codeOnly` blanks, and
// that is deliberate: the comment explaining why loam does not call it must
// stay legal to write.
const PARSED_VIEW_READER = posix(join("src", "core", "c4", "parsed")) + "/";
for (const [file, source] of sources) {
  const rel = posix(relative(root, file));
  const code = codeOnly(source);
  for (const m of code.matchAll(/\b(computedModel|layoutedModel)\b/g)) {
    say("view-stage", `${rel} names ${m[1]} — loam never computes a view (docs/DESIGN.md rule 26)`);
  }
  if (rel.startsWith(PARSED_VIEW_READER)) continue;
  for (const m of code.matchAll(/\$data\b/g)) {
    void m;
    say("view-stage", `${rel} reads \`$data\` outside ${PARSED_VIEW_READER} — the raw parsed record has one reader (docs/DESIGN.md rule 26)`);
  }
}

if (failures.length > 0) {
  console.error(`arch-check: ${failures.length} violation(s)\n`);
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}
console.log("arch-check: file cycles, package graph, layering, barrels, core boundary, child processes, brand casts, view stage — all clean");
