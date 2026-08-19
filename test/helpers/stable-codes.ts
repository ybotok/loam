/**
 * The stable-code collector: every code loam emits, gathered by static
 * analysis of src/, because the unions are types and types are erased — there
 * is no runtime constant to import. Extracted from test/codes-drift.test.ts so
 * test/docs-facts.test.ts can grade the PUBLIC packaged docs against the same
 * emitted set the agent-docs drift guard uses; the collection rules are that
 * guard's contract and must change only with it.
 *
 * Two families of pattern:
 *
 *   NAMED — the code arrives as a `code:` property: a `"…"` literal, either arm
 *   of a `code: cond ? "…" : "…"` ternary, an IssueCode/ErrorCode union member
 *   in issue.ts or json.ts, or the one code that exists only as a text marker
 *   (validate's `⚠ sources.unverifiable-from-here:` summary line).
 *
 *   POSITIONAL — the code arrives as an ARGUMENT to a helper. This is the hole
 *   that let a whole family drift: all 23 `openspec.*` diagnostics go through
 *   `issue(target, scope, code, path, message)` in openspec/scan/shape.ts, where
 *   the code is the third positional argument and the word `code` appears
 *   nowhere near it. The literal patterns above saw none of them, which is
 *   exactly why `openspec.*` went undocumented while every `mapping.*` code —
 *   emitted as a `code:` property — stayed documented. Fixing three codes would
 *   have left the collector blind; the collector is the bug.
 *
 * So the positional half RESOLVES rather than pattern-matches: find every
 * function in src/ that declares a parameter named `code`, remember which
 * argument slot that is, and read the literal out of that slot at each call
 * site. A call whose code slot is NOT statically resolvable is reported in
 * `unresolved` — the safer invariant, because an emitter shape this file cannot
 * see is indistinguishable from one it has silently stopped seeing.
 */
import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = fileURLToPath(new URL("../../src/", import.meta.url));

/** Every .ts file under src/, recursively. */
async function tsFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await tsFiles(path)));
    else if (entry.name.endsWith(".ts")) out.push(path);
  }
  return out;
}

/** A code slot: this function's argument number `index` is the code. */
interface Emitter {
  name: string;
  index: number;
}

/**
 * The one string-literal shape a code may take. Anchored, so a template
 * literal, a variable, a member expression or a call is NOT resolvable and the
 * caller reports it instead of quietly skipping it.
 */
const CODE_LITERAL = /^"([a-z][a-z0-9.-]*)"$/;

/** `cond ? "a" : "b"` — two literals, both reachable, both collected. */
const CODE_TERNARY = /\?\s*"([a-z][a-z0-9.-]*)"\s*:\s*"([a-z][a-z0-9.-]*)"\s*$/;

/**
 * A slot that FORWARDS a code somebody else already spelled: the emitter's own
 * `code` parameter passed on, or a `.code` read off a typed value (an
 * `ArchiveFailure`, a `VerificationRead`). Every literal that can reach one of
 * those is collected where it is written — as a `code:` property or as a union
 * member — so the slot itself contributes nothing new. Anything outside this
 * list is an emitter shape the collector cannot see, and it says so.
 */
const CODE_FORWARD = /^(?:code|[A-Za-z_$][\w$]*(?:\.[\w$]+)*\.code|[A-Za-z_$][\w$]*\.code\s*\?\?[^?]*)$/;

/** Which characters sit inside a comment or a string literal — see `mask`. */
type Mask = Uint8Array;

/**
 * Blank out comments and string/template literals, positionally.
 *
 * Needed because this collector matches call sites by name, and prose is full
 * of them: `delta.nothing-tagged` exists to refuse (an author who forgot the
 * tags)` in a comment in new.ts read as a call to verify.ts's `refuse` helper.
 * A mask keeps the offsets intact, so `splitArgs` still reads real source and
 * line numbers stay true.
 *
 * Regex literals are masked too, and they are the reason this is a scanner
 * rather than three regexes: `/^\s*(\`\`\`|~~~)/` in openspec/scan/shape.ts opens
 * a template literal to anything that only tracks quotes, which swallowed the
 * whole `issue()` family — the very hole this rewrite exists to close. Whether
 * a `/` opens a regex is the usual heuristic: it does when the last meaningful
 * character cannot end an expression.
 */
const BEFORE_REGEX = /[([{,;:=!&|?+\-*%~^<>]$|\b(?:return|typeof|case|in|of|do|else)$/;

function mask(src: string): Mask {
  const out = new Uint8Array(src.length);
  let i = 0;
  let prev = "";
  while (i < src.length) {
    const two = src.slice(i, i + 2);
    if (two === "//") {
      while (i < src.length && src[i] !== "\n") out[i++] = 1;
      continue;
    }
    if (two === "/*") {
      while (i < src.length && src.slice(i, i + 2) !== "*/") out[i++] = 1;
      out[i++] = 1;
      out[i++] = 1;
      continue;
    }
    const ch = src[i]!;
    if (ch === '"' || ch === "'" || ch === "`") {
      out[i++] = 1;
      while (i < src.length && src[i] !== ch) {
        if (src[i] === "\\") out[i++] = 1;
        out[i++] = 1;
      }
      out[i++] = 1;
      prev = "x";
      continue;
    }
    if (ch === "/" && (prev === "" || BEFORE_REGEX.test(prev))) {
      out[i++] = 1;
      let klass = false;
      while (i < src.length && (klass || src[i] !== "/") && src[i] !== "\n") {
        if (src[i] === "\\") out[i++] = 1;
        else if (src[i] === "[") klass = true;
        else if (src[i] === "]") klass = false;
        out[i++] = 1;
      }
      out[i++] = 1;
      prev = "x";
      continue;
    }
    if (!/\s/.test(ch)) prev = (prev + ch).slice(-8);
    i += 1;
  }
  return out;
}

/**
 * Split an argument list into top-level arguments. A hand-rolled scanner rather
 * than a split on commas because every emitter in this codebase passes nested
 * calls, ternaries, objects and string literals holding commas — `issue(scope
 * === "archive" ? archiveDiagnostics : blockers, scope, "…", path, msg)` is a
 * real call site. Returns null when the list does not close, which happens only
 * if this scanner is wrong about the language.
 */
function splitArgs(src: string, open: number): string[] | null {
  const args: string[] = [];
  let depth = 0;
  let start = open + 1;
  let quote: string | null = null;
  for (let i = open + 1; i < src.length; i += 1) {
    const ch = src[i]!;
    if (quote !== null) {
      if (ch === "\\") i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") depth += 1;
    else if (ch === ")" || ch === "]" || ch === "}") {
      if (ch === ")" && depth === 0) {
        args.push(src.slice(start, i));
        return args;
      }
      depth -= 1;
    } else if (ch === "," && depth === 0) {
      args.push(src.slice(start, i));
      start = i + 1;
    }
  }
  return null;
}

/**
 * Every function in `src` that takes a parameter named `code`, with the slot it
 * sits in. Declarations and arrow assignments both — `issue(...)` is a
 * declaration, `refuse(code, message)` in verify.ts is an arrow const.
 */
function emittersIn(src: string, blank: Mask): Emitter[] {
  const found: Emitter[] = [];
  const decl = /(?:function\s+([A-Za-z_$][\w$]*)\s*|const\s+([A-Za-z_$][\w$]*)\s*(?::[^=]*)?=\s*)\(/g;
  for (const m of src.matchAll(decl)) {
    if (blank[m.index] === 1) continue;
    const name = m[1] ?? m[2]!;
    const params = splitArgs(src, m.index + m[0].length - 1);
    if (params === null) continue;
    const index = params.findIndex((p) => /^\s*(?:readonly\s+)?code\s*[:?]/.test(p));
    if (index !== -1) found.push({ name, index });
  }
  return found;
}

/**
 * Names a file can call an emitter by: whatever it declares itself, plus
 * whatever it imports. Without the import test, `refuse` declared in verify.ts
 * would be resolved against a same-named local helper in another file and
 * report a slot that is not a code at all.
 */
function visibleNames(src: string): Set<string> {
  const names = new Set<string>();
  for (const m of src.matchAll(/^import\s+(?:type\s+)?\{([^}]*)\}/gm)) {
    for (const part of m[1]!.split(",")) {
      const id = part.trim().split(/\s+as\s+/).pop()?.trim();
      if (id !== undefined && id !== "") names.add(id);
    }
  }
  return names;
}

export interface CollectedCodes {
  codes: Set<string>;
  /** `file:line — call` for every code slot this file could not read a literal out of. */
  unresolved: string[];
}

export async function collectStableCodes(): Promise<CollectedCodes> {
  const codes = new Set<string>();
  const unresolved: string[] = [];
  const sources = new Map<string, { src: string; blank: Mask }>();
  // The agents-md/ sections and the workflows/ bodies ARE the documentation
  // corpus — AGENTS_MD and PROTOCOLS are assembled from them — so scanning
  // them would let a code count as emitted merely because it is documented.
  // (The corpus was one file, excluded as `agent.ts`; the split widened this
  // to the two directories that now hold the prose.)
  const CORPUS = [join("core", "agent", "agents-md"), join("core", "agent", "workflows")];
  for (const file of await tsFiles(SRC)) {
    if (CORPUS.some((dir) => relative(SRC, file).startsWith(dir))) continue;
    const src = await readFile(file, "utf8");
    sources.set(file, { src, blank: mask(src) });
  }

  // Emitter signatures are gathered across the whole tree first: a helper
  // declared in one file and called from another (`fail` in json.ts) has to be
  // resolvable at its call sites too. Which of them a given file may CALL is
  // then narrowed by that file's imports.
  const emitters = new Map<string, number>();
  const declaredIn = new Map<string, Set<string>>();
  for (const [file, { src, blank }] of sources) {
    const local = new Set<string>();
    for (const e of emittersIn(src, blank)) {
      emitters.set(e.name, e.index);
      local.add(e.name);
    }
    declaredIn.set(file, local);
  }

  // A function whose declared return type IS a code union: every literal it
  // returns is a code, and a call to it is a legitimate emitter argument
  // (`fail(json, archiveErrorCode(err), …)`).
  const codeReturning = new Set<string>();

  for (const [file, { src, blank }] of sources) {
    for (const m of src.matchAll(/code:\s*"([a-z][a-z0-9.-]*)"/g)) codes.add(m[1]!);
    for (const m of src.matchAll(/code:\s*[^,\n?]*\?\s*"([a-z][a-z0-9.-]*)"\s*:\s*"([a-z][a-z0-9.-]*)"/g)) {
      codes.add(m[1]!);
      codes.add(m[2]!);
    }
    for (const m of src.matchAll(/[⚠✗] ([a-z0-9-]+\.[a-z0-9-]+):/g)) codes.add(m[1]!);
    // The two unions are the only files where a `| "…"` member is a stable code.
    if (file.endsWith("issue.ts") || file.endsWith("json.ts")) {
      for (const m of src.matchAll(/^\s*\|\s*"([a-z][a-z0-9.-]*)"/gm)) codes.add(m[1]!);
    }
    for (const m of src.matchAll(/function\s+([A-Za-z_$][\w$]*)[^)]*\)\s*:\s*(?:ErrorCode|IssueCode)\s*\{([\s\S]*?)\n\}/g)) {
      codeReturning.add(m[1]!);
      for (const r of m[2]!.matchAll(/return\s+"([a-z][a-z0-9.-]*)"/g)) codes.add(r[1]!);
    }

    const callable = new Set([...declaredIn.get(file)!, ...visibleNames(src)]);
    for (const [name, index] of emitters) {
      if (!callable.has(name)) continue;
      const call = new RegExp(`(?<![\\w$.])${name}\\s*\\(`, "g");
      for (const m of src.matchAll(call)) {
        if (blank[m.index] === 1) continue;
        // The declaration itself, not a call.
        if (/(?:function\s+|const\s+[\w$]*\s*(?::[^=]*)?=\s*)$/.test(src.slice(Math.max(0, m.index - 60), m.index))) continue;
        const args = splitArgs(src, m.index + m[0].length - 1);
        const slot = args?.[index]?.trim();
        if (slot === undefined) continue;

        const literal = CODE_LITERAL.exec(slot);
        if (literal !== null) {
          codes.add(literal[1]!);
          continue;
        }
        const ternary = CODE_TERNARY.exec(slot);
        if (ternary !== null) {
          codes.add(ternary[1]!);
          codes.add(ternary[2]!);
          continue;
        }
        if (CODE_FORWARD.test(slot)) continue;
        const called = /^([A-Za-z_$][\w$]*)\(/.exec(slot);
        if (called !== null && codeReturning.has(called[1]!)) continue;

        const line = src.slice(0, m.index).split("\n").length;
        unresolved.push(`${relative(SRC, file)}:${line} — ${name}(… ${slot.split("\n")[0]!.trim()} …)`);
      }
    }
  }
  return { codes, unresolved };
}

/**
 * The emitted-code set, or a loud failure when any emitter call site is not
 * statically resolvable — a consumer grading docs against a silently shrunken
 * set would vouch for prose the collector never actually checked.
 */
export async function collectEmittedCodes(): Promise<Set<string>> {
  const { codes, unresolved } = await collectStableCodes();
  if (unresolved.length > 0) {
    throw new Error(
      `emitter call site(s) whose code slot is not a string literal:\n  ${unresolved.join("\n  ")}\n` +
        "Spell the code literally at the call site so the drift guards can see it.",
    );
  }
  return codes;
}
