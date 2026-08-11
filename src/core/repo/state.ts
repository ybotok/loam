/**
 * Is there a docs repo there at all?
 *
 * Three answers, not two: missing, present-but-empty, and ok. The middle one
 * exists because a freshly cloned docs repo whose `services/` git never tracked
 * looks identical to a directory nobody wired — and the fix differs.
 */
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";

/* ------------------------------------------------------------------ */
/* Is there a docs repo there at all?                                  */
/* ------------------------------------------------------------------ */

/**
 * What is actually at `docsDir`. Three answers, because they point at three
 * different fixes and the enumeration below used to give all of them the same
 * one — an empty list:
 *
 *  - `missing`     — nothing there (or not a directory): `docsDir` in loam.json
 *                    is wrong, or the docs repo was never cloned;
 *  - `no-services` — a directory, but with no `services/`: it is some other
 *                    directory, most often the service repo itself after a typo;
 *  - `ok`          — a docs repo. `services/` may still be EMPTY, and that is a
 *                    legitimate state: a docs repo before the first `loam adopt`.
 *
 * "Empty fleet" and "wrong path" are the same output only if nobody asks this
 * question, and a green `loam list` over a docsDir that does not exist is worse
 * than a red one: it says the fleet is fine.
 */
export type DocsRepoKind = "missing" | "no-services" | "ok";

export interface DocsRepoState {
  kind: DocsRepoKind;
  /** The path examined, so a caller can quote it without re-deriving it. */
  path: string;
}

export function docsRepoState(docsDir: string): DocsRepoState {
  const path = docsDir;
  let isDir = false;
  try {
    isDir = statSync(path).isDirectory();
  } catch {
    isDir = false;
  }
  if (!isDir) return { kind: "missing", path };
  return { kind: existsSync(join(path, "services")) ? "ok" : "no-services", path };
}

/**
 * The docs repo is not there. Thrown rather than returned because every caller
 * of the enumeration wants the same thing — to stop — and a `[]` return is the
 * bug this closes. `message` is written for a human at a terminal: the CLI's
 * top-level handler prints it verbatim, and commands that catch it report
 * `repository-unavailable`.
 */
export class DocsRepoUnavailableError extends Error {
  constructor(
    readonly state: DocsRepoState,
    message: string,
  ) {
    super(message);
    this.name = "DocsRepoUnavailableError";
  }
}

/**
 * Refuse to enumerate a docs repo that is not one. `allow` names the states the
 * caller can honestly survive: features/ may be absent from a real docs repo
 * (nothing is in flight yet), so feature enumeration only insists the docs repo
 * EXISTS, while service enumeration insists it is shaped like a docs repo — a
 * `services/` directory is what makes it one.
 */
export function requireDocsRepo(docsDir: string, allow: DocsRepoKind[]): void {
  const state = docsRepoState(docsDir);
  if (allow.includes(state.kind)) return;
  if (state.kind === "missing") {
    throw new DocsRepoUnavailableError(
      state,
      `The configured docs repo does not exist: ${state.path}. ` +
        "Fix `docsDir` in loam.json, clone the docs repo there, " +
        "or run `loam init --docs <dir> --create` to make a new one.",
    );
  }
  throw new DocsRepoUnavailableError(
    state,
    `${state.path} is not a docs repo — it has no services/ directory. ` +
      "Point `docsDir` in loam.json at the shared docs repo, " +
      "or run `loam init --docs <dir> --create` to make one.",
  );
}
