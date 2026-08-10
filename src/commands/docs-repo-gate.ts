/**
 * The three refusals every command owes a docs repo it cannot read.
 *
 * One doctrine, three ways of reaching it: the gate a command passes before it
 * enumerates anything, the error the enumeration throws when the repo goes away
 * underneath it, and the errno that comes back when the repo is real but one
 * file under it will not open. Six commands reach for one or another of them
 * (`adopt`, `list`, `new`, `show`, `status`, `validate`), and the whole point of
 * collecting them is that all six answer with the same sentences.
 *
 * They live in `commands/` rather than in `core/`: each one calls `fail`, which
 * writes to stdout or stderr and sets the exit code. That is a decision about
 * how this process ends, and core modules compute answers rather than end
 * processes.
 */
import { fail } from "../core/envelope/json.js";
import { docsRepoState, type DocsRepoUnavailableError } from "../core/repo.js";

/**
 * The refusal every READ command owes a `docsDir` that is not a docs repo.
 *
 * It is not a formality. `validate --all` and `list` used to answer a docsDir
 * that does not exist with a green report over zero services, which is the one
 * output a fleet gate must never produce: "nothing is wrong" and "I could not
 * look" are opposite facts, and in CI the first one merges. The two codes are
 * kept apart because the fixes point in different directions — a wrong path in
 * loam.json versus a docs repo that was never cloned or scaffolded — exactly
 * the way `no-config` and `config-invalid` are kept apart.
 *
 * "Zero services" stays reachable, and only from a REAL docs repo whose
 * `services/` is empty: that is a legitimate state (before the first
 * `loam adopt`) and it must keep exiting 0.
 *
 * `need` says how much of a docs repo this particular run has to have. A run
 * that only reads features genuinely does not need `services/` — repo.ts takes
 * the same position for `listFeatures` — and refusing there would turn one
 * diagnosis into two contradictory ones. A run that enumerates services needs
 * the directory that IS the list of services.
 *
 * It used to live in validate.ts, on the reasoning that validate is the fleet
 * gate this doctrine is about. Six commands import it now (`adopt`, `list`,
 * `new`, `show`, `status`, `validate`), so the doctrine outgrew its host: `loam
 * show` was structurally depending on the whole validate implementation for
 * twenty lines of policy. The rule is the module now, and validate is one of
 * its callers like the rest.
 */
export function docsRepoReady(json: boolean, docsDir: string, need: "docs" | "services"): boolean {
  const state = docsRepoState(docsDir);
  if (state.kind === "ok" || (state.kind === "no-services" && need === "docs")) return true;
  if (state.kind === "missing") {
    fail(
      json,
      "docs-missing",
      `The configured docs repo does not exist: ${state.path}. ` +
        "Fix `docsDir` in loam.json, clone the docs repo there, " +
        "or run `loam init --docs <dir> --create` to make a new one.",
    );
    return false;
  }
  fail(
    json,
    "services-missing",
    `${state.path} is not a docs repo — it has no services/ directory. ` +
      "Point `docsDir` in loam.json at the shared docs repo, " +
      "or run `loam init --docs <dir> --create` to make one.",
  );
  return false;
}

/**
 * The same refusal, reached the other way: `listServices`/`listFeatures` throw
 * `DocsRepoUnavailableError` when the repo goes away mid-run (or when a caller
 * reaches enumeration without passing the gate above). Mapping it back onto the
 * same two codes keeps one breach spelled one way, instead of surfacing as the
 * `internal` catch-all in cli.ts.
 */
export function reportDocsRepoError(json: boolean, err: DocsRepoUnavailableError): void {
  fail(json, err.state.kind === "missing" ? "docs-missing" : "services-missing", err.message);
}

/**
 * The third refusal a reading command owes: the docs repo IS a docs repo, but
 * one file under it cannot be read. `list`, `show`, `status` and `validate` all
 * walk a directory tree to answer, so all four owe the same sentence — and all
 * four kept their own copy of it, which is exactly how three of them ended up
 * wrong. Sharing it here, beside `reportDocsRepoError`, is the same trade: one
 * breach spelled one way instead of four that drift.
 *
 * A filesystem failure is recognised by its errno, NOT by carrying a `path`.
 * Node reports EISDIR from `read()` with no path at all — the directory opened,
 * the read failed — so a guard that looked only for `path` was defeated by the
 * commonest way a malformed docs repo breaks: one directory sitting where a
 * file belongs escaped as a bare `internal: EISDIR`, naming neither the file
 * nor the target. Anything carrying no errno at all is a real bug, and still
 * escapes untouched.
 *
 * `consequence` is the clause after "so" — what the caller could not answer
 * because of this. It is the only part that differs between the four.
 */
export function reportRepositoryUnavailable(
  json: boolean,
  err: unknown,
  consequence: string,
  docsDir: string,
): void {
  const e = err as NodeJS.ErrnoException;
  if (e.path === undefined && typeof e.errno !== "number") throw err;
  const why = err instanceof Error ? err.message : String(err);
  fail(
    json,
    "repository-unavailable",
    e.path !== undefined
      ? `${e.path} could not be read, so ${consequence}. ${why}`
      : // Naming the target's own directory here would be a guess, and a guess
        // that is wrong precisely when it matters: one malformed artifact makes
        // every OTHER target's answer fail too, and each would have accused its
        // own files. Say what is known instead.
        `A file under ${docsDir} could not be read, so ${consequence}. ${why}. ` +
        `The failure named no path — that is how Node reports a directory sitting where a file belongs.`,
  );
}
