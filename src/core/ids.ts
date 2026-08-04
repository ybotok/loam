/**
 * The spelling rules for the ids loam turns into directory names.
 *
 * A service id is not a label: it becomes `services/<id>/` in the shared docs
 * repo, and it is interpolated into paths by adopt, validate, vouch, gherkin and
 * new. That makes it caller-controlled path input, so it is validated in exactly
 * one place — here — rather than by each command inventing its own guard. The
 * failure mode this closes is not theoretical: `--service ../../etc` would have
 * had `servicePaths()` hand a writer a directory outside the docs repo, and
 * `--service ''` would have made `services//spec.md` collapse to a file the
 * enumeration in repo.ts can never see again.
 *
 * The rule is deliberately narrower than "a path segment that happens to work":
 * ids are also compared, sorted and printed in tables, so shell metacharacters,
 * spaces and leading dots are refused even where the filesystem would accept
 * them. Widening the alphabet later is a compatible change; narrowing it is not.
 */

/** The one grammar: alphanumeric head, then alphanumerics, dot, underscore, hyphen. */
const SERVICE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Prose form of the rule, shown verbatim in every refusal so the fix is obvious. */
export const SERVICE_ID_RULE =
  "a service id must start with a letter or digit and contain only letters, digits, '.', '_' or '-' " +
  "(no slashes, no '..', no spaces) — it becomes the services/<id>/ directory name";

/** Refusal carrying the offending value, so a caller can quote it back. */
export class InvalidIdError extends Error {
  constructor(
    readonly value: string,
    message: string,
  ) {
    super(message);
    this.name = "InvalidIdError";
  }
}

/**
 * Why `id` is not a usable service id, or null when it is. Returning the reason
 * instead of a boolean lets a caller that is already collecting findings report
 * the same sentence a refusal would print.
 */
export function serviceIdProblem(id: unknown, label = "--service"): string | null {
  if (typeof id !== "string" || id === "") {
    return `${label} must name a service: ${SERVICE_ID_RULE}.`;
  }
  // Checked ahead of the pattern purely for the message: '..' is the case a
  // human is most likely to have typed on purpose, and "no '..'" is a more
  // useful answer than "does not match the id grammar".
  if (id.split(/[\\/]/).includes("..") || id.includes("..")) {
    return `Invalid ${label} '${id}': ${SERVICE_ID_RULE}.`;
  }
  if (!SERVICE_ID.test(id)) {
    return `Invalid ${label} '${id}': ${SERVICE_ID_RULE}.`;
  }
  return null;
}

/** True when `id` is a usable service id. */
export function isServiceId(id: unknown): id is string {
  return serviceIdProblem(id) === null;
}

/**
 * Assert that `id` may be used as a `services/<id>/` directory name. Throws
 * InvalidIdError; commands catch it and report `invalid-option`, because a bad
 * id is always something the caller typed, never a state of the repository.
 */
export function assertServiceId(id: unknown, label = "--service"): asserts id is string {
  const problem = serviceIdProblem(id, label);
  if (problem !== null) throw new InvalidIdError(typeof id === "string" ? id : String(id), problem);
}
