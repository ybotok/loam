/**
 * The checks one run is graded by. Each is deterministic over the transcript
 * and the workspace the run left behind — no model judges another model here,
 * because a grade that moves when the grader is re-run measures the grader.
 *
 * Where the same rule can be read off the transcript AND off the files, the
 * files win: an agent that edits a generated file with `sed` through Bash
 * leaves no Edit call behind, and the bytes still say what it did.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { bashCommand, skillLoaded, writtenFile, type Transcript } from "./transcript.js";

/** Where one run happened. */
export interface Workspace {
  /** The scratch directory everything lives under. */
  root: string;
  /** The directory the agent was started in — the docs repo, or a service repo beside it. */
  cwd: string;
  /** The docs repo. */
  docs: string;
  /** Digests taken by the scenario's setup, for a grader that asks what the run changed. */
  before: ReadonlyMap<string, string>;
}

export interface Evidence {
  transcript: Transcript;
  workspace: Workspace;
}

export interface Grade {
  pass: boolean;
  detail: string;
}

export interface Grader {
  id: string;
  /** What passing means, in one line — the column header of the report. */
  what: string;
  grade(evidence: Evidence): Grade;
}

/** Every file under `dir`, relative and `/`-separated, sorted. */
export function filesUnder(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  const walk = (at: string): void => {
    for (const name of readdirSync(at)) {
      const path = join(at, name);
      if (statSync(path).isDirectory()) walk(path);
      else out.push(relative(dir, path).split(/[\\/]/).join("/"));
    }
  };
  walk(dir);
  return out.sort();
}

/** sha256 of every file under `dir`, keyed by its path relative to `root`. */
export function digestsUnder(root: string, dir: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const rel of filesUnder(dir)) {
    const path = join(dir, rel);
    out.set(relative(root, path).split(/[\\/]/).join("/"), createHash("sha256").update(readFileSync(path)).digest("hex"));
  }
  return out;
}

/** The index of the first call that matches, or -1. */
function firstIndex(t: Transcript, match: (i: number) => boolean): number {
  for (let i = 0; i < t.calls.length; i++) if (match(i)) return i;
  return -1;
}

/**
 * The workflow's protocol was loaded — its skill, or `loam instructions <name>`
 * — before the first file the run wrote. A protocol read after the work is a
 * protocol the work was not done by.
 */
export function protocolFirst(workflow: string): Grader {
  return {
    id: "protocol-first",
    what: `loaded ${workflow} before the first write`,
    grade({ transcript: t }) {
      const loaded = firstIndex(t, (i) => {
        const call = t.calls[i]!;
        const skill = skillLoaded(call);
        if (skill !== null) return skill === workflow || skill.endsWith(`:${workflow}`);
        const command = bashCommand(call);
        return command !== null && new RegExp(`\\bloam instructions ${workflow}\\b`).test(command);
      });
      const wrote = firstIndex(t, (i) => writtenFile(t.calls[i]!) !== null);
      if (loaded < 0) return { pass: false, detail: `never loaded ${workflow}` };
      if (wrote >= 0 && wrote < loaded) return { pass: false, detail: `wrote at call ${wrote}, loaded at ${loaded}` };
      return { pass: true, detail: `loaded at call ${loaded}${wrote < 0 ? ", wrote nothing" : `, first write at ${wrote}`}` };
    },
  };
}

/** No shell command the run executed matches `pattern`. */
export function neverRan(id: string, what: string, pattern: RegExp): Grader {
  return {
    id,
    what,
    grade({ transcript: t }) {
      const hit = t.calls.map(bashCommand).find((c) => c !== null && pattern.test(c));
      return hit === undefined ? { pass: true, detail: "never ran" } : { pass: false, detail: `ran: ${hit}` };
    },
  };
}

/**
 * `loam validate` ran after the last file the run wrote — the order a run that
 * says it is done owes. A run that wrote nothing passes: it claimed nothing it
 * had changed.
 */
export const validatedLast: Grader = {
  id: "validated-last",
  what: "ran loam validate after its last write",
  grade({ transcript: t }) {
    let lastWrite = -1;
    let lastValidate = -1;
    t.calls.forEach((call, i) => {
      if (writtenFile(call) !== null) lastWrite = i;
      const command = bashCommand(call);
      if (command !== null && /\bloam validate\b/.test(command)) lastValidate = i;
      if (command !== null && shellWrites(command)) lastWrite = i;
    });
    if (lastWrite < 0) return { pass: true, detail: "wrote nothing" };
    return lastValidate > lastWrite
      ? { pass: true, detail: `last write at ${lastWrite}, validate at ${lastValidate}` }
      : { pass: false, detail: lastValidate < 0 ? "never validated" : `validated at ${lastValidate}, wrote again at ${lastWrite}` };
  },
};

/**
 * Whether a shell command writes a file — `sed -i`, a redirect into a file, a
 * heredoc, `tee`, `cp`, `mv`. A redirect into `/dev/null` or onto another
 * descriptor (`2>&1`) writes nothing, and a `loam` command's own writes are
 * loam's, never the edit the validate is owed for.
 */
export function shellWrites(command: string): boolean {
  if (/\bloam\b/.test(command)) return false;
  if (/\bsed\s+(-[a-zA-Z]*i|--in-place)\b/.test(command) || /\b(tee|cp|mv)\b/.test(command)) return true;
  return /(^|[^0-9&>])>>?\s*(?!&)(?!\/dev\/null\b)[^\s|&;]/.test(command);
}

/** A fact about the files the run left, read by `check` — a string answer is the failure's detail. */
export function leftFiles(id: string, what: string, check: (ws: Workspace) => true | string): Grader {
  return {
    id,
    what,
    grade({ workspace }) {
      const answer = check(workspace);
      return answer === true ? { pass: true, detail: "as required" } : { pass: false, detail: answer };
    },
  };
}

/** The final message says something matching `pattern` — the hand-back a human reads. */
export function finalSays(id: string, what: string, pattern: RegExp): Grader {
  return {
    id,
    what,
    grade({ transcript: t }) {
      return pattern.test(t.final)
        ? { pass: true, detail: "said it" }
        : { pass: false, detail: t.final === "" ? "no final message" : "the final message does not say it" };
    },
  };
}

/** The files under `dir` (relative to the workspace root) are byte-identical to what setup recorded. */
export function untouched(id: string, what: string, dir: (ws: Workspace) => string): Grader {
  return leftFiles(id, what, (ws) => {
    const now = digestsUnder(ws.root, dir(ws));
    const prefix = relative(ws.root, dir(ws)).split(/[\\/]/).join("/");
    const recorded = [...ws.before].filter(([path]) => path.startsWith(`${prefix}/`));
    if (recorded.length === 0) return `setup recorded nothing under ${prefix}`;
    const changed = recorded.filter(([path, digest]) => now.get(path) !== digest).map(([path]) => path);
    const added = [...now.keys()].filter((path) => !ws.before.has(path));
    return changed.length === 0 && added.length === 0 ? true : `changed: ${[...changed, ...added].join(", ")}`;
  });
}
