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
 *
 * "Works" also means "works on Windows", which this project tests in CI: the
 * two rules below are the ones POSIX accepts and Windows does not. They used to
 * live in migrate-openspec.ts alone, as a second, stricter copy of this grammar
 * — so the PRIMARY authoring path (`--service`, `--touches`, `adopt`) accepted
 * ids the migration refused, and `services/CON/` or `services/payments./` got
 * as far as a directory nobody can create or open. Narrowing is not a
 * compatible change, which is exactly why it belongs here, once, rather than in
 * whichever command happened to think of it.
 */

/** The one grammar: alphanumeric head, then alphanumerics, dot, underscore, hyphen. */
const SERVICE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * The MS-DOS device names Windows still reserves. Reserved with any extension
 * and in any case (`nul`, `NUL.txt`), so the test is on the stem — the part
 * before the first dot — uppercased.
 */
const WINDOWS_DEVICE = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/;

/** Prose form of the rule, shown verbatim in every refusal so the fix is obvious. */
const SERVICE_ID_RULE =
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
  // Both refusals below are about Windows, and both get their own sentence for
  // the same reason `..` does: "does not match the id grammar" is true and
  // useless, because the id LOOKS fine and the problem is what the filesystem
  // does with it.
  if (WINDOWS_DEVICE.test(id.split(".")[0]!.toUpperCase())) {
    return (
      `Invalid ${label} '${id}': '${id.split(".")[0]}' is a reserved device name on Windows — ` +
      `services/${id}/ cannot be created there at all, so the docs repo would only work on some of the machines that clone it.`
    );
  }
  if (/[. ]$/.test(id)) {
    return (
      `Invalid ${label} '${id}': a service id may not end with '.' or a space — ` +
      `Windows strips both when creating a directory, so '${id}' and '${id.replace(/[. ]+$/, "")}' would silently become one directory there and two everywhere else.`
    );
  }
  return null;
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

/**
 * Feature ids are `<word>-<number>`: the id has to survive being read back off
 * the directory name (`FEAT-101-payment-splitting` -> `FEAT-101`), or the
 * feature would answer to a name it was never given.
 *
 * Here for the same reason the service grammar is — this was spelled twice,
 * privately, in `commands/new.ts` and `core/openspec-inventory.ts`, and
 * docs/DESIGN.md rule 7 recorded the pair as a hazard rather than a fact. The
 * third caller is what made it one: `loam explore --as <FEAT>` interpolates its
 * argument into a `loam new` line that loam PRINTS for an agent to run, so
 * without this check `explore` cheerfully handed back a command `new` refuses.
 * A guard test catches that class only for literal source strings — a command
 * assembled at runtime from argv is invisible to it — which is exactly why the
 * grammar has to be shared rather than re-derived by whoever needs it next.
 */
const FEATURE_ID = /^[A-Za-z][A-Za-z0-9]*-\d+$/;

/** Prose form, shown verbatim in every refusal so the fix is obvious. */
export const FEATURE_ID_RULE = "Expected <word>-<number>, e.g. FEAT-101 or BUG-42.";

export function isFeatureId(id: unknown): id is string {
  return typeof id === "string" && FEATURE_ID.test(id);
}

/**
 * Why `id` is not a usable feature id, or null when it is — the `serviceIdProblem`
 * shape, so a caller already collecting findings reports the sentence a refusal
 * would print.
 */
export function featureIdProblem(id: unknown, label = "feature id"): string | null {
  if (!isFeatureId(id)) {
    const shown = typeof id === "string" ? `'${id}'` : String(id);
    return `${shown} is not a usable ${label}. ${FEATURE_ID_RULE}`;
  }
  return null;
}
