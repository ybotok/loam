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

/* ---------------------------------------------------------------- */
/* The three provenances a service name can have                     */
/* ---------------------------------------------------------------- */

/**
 * A service name is one of three things, and until now all three were `string`.
 *
 * The distinction that matters is not "valid" versus "invalid" — it is WHERE the
 * name came from, because that is what decides whether loam may join it into a
 * path. A directory name read off disk is safe to join whether or not it is a
 * legal id: it demonstrably exists, `readdir` just returned it. A name a
 * *document* asserts is not, because nothing has checked it and `metadata {
 * service '../../../etc' }` parses in LikeC4 without a single error.
 *
 * So `RawServiceId` is the base — a name whose provenance is the repository —
 * and `ServiceId` is that plus the grammar check, which makes it a SUBTYPE
 * rather than a sibling. That hierarchy is deliberate and was measured: with
 * three disjoint brands, `id === dirName`, `Set<RawServiceId>.has(id)` and
 * `[...ids, ...raws].sort()` all stop compiling, and none of them is a safety
 * question — they are the ordinary business of comparing a validated id with a
 * directory that exists. Only `DeclaredService` is disjoint, because only there
 * is the comparison a real crossing.
 *
 * `path.join` is NOT the enforcement point and cannot be made one: node types it
 * `join(...paths: string[])`, so every brand satisfies it. The guarantee lives
 * in `servicePaths`' own parameter type — `PathableService`, declared below and
 * demanded by that signature — so a `DeclaredService` at the call site is a
 * compile error, not a review finding. Code that spells `services/<svc>/` with
 * a bare join is outside the guarantee; `repo/paths.ts`'s banner names it.
 */
declare const provenance: unique symbol;
declare const checked: unique symbol;

/**
 * A directory name read off `services/` or `features/<id>/specs/`. It exists;
 * it may still be an illegal loam id — `core/repo/repo.ts`'s `listServices`
 * deliberately returns those, reporting the failure as an `idProblem` field,
 * because `loam list` must show you the badly-named directory that is there.
 */
export type RawServiceId = string & { readonly [provenance]: "loam" };

/** A name that passed `serviceIdProblem`. The only form a caller may construct. */
export type ServiceId = RawServiceId & { readonly [checked]: true };

/**
 * A name a DOCUMENT asserts — `metadata { service '...' }` in a `.likec4` file,
 * an element title standing in for one, or an element id. Arbitrary unchecked
 * text, and disjoint from the two above on purpose: it must not reach a path
 * join without going through `parseServiceId` first.
 */
export type DeclaredService = string & { readonly [provenance]: "document" };

/** What `servicePaths` accepts: a name whose provenance is the repository. */
export type PathableService = RawServiceId;

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
export function assertServiceId(id: unknown, label = "--service"): asserts id is ServiceId {
  const problem = serviceIdProblem(id, label);
  if (problem !== null) throw new InvalidIdError(typeof id === "string" ? id : String(id), problem);
}

/* ---------------------------------------------------------------- */
/* The three constructors — the only place a brand is asserted       */
/* ---------------------------------------------------------------- */

/**
 * The one constructor that validates. It takes a plain `string`, so a
 * `DeclaredService` flows straight in — a brand is still a string — which is
 * what makes this the single bridge out of document text.
 *
 * The result is a discriminated pair rather than `ServiceId | string`: that
 * second shape compiles and is unusable, because nothing can narrow it back.
 * The problem sentence is the one `serviceIdProblem` already produces, so a
 * caller that is collecting findings prints exactly what a refusal would.
 */
export function parseServiceId(
  raw: string,
  label = "--service",
): { ok: true; id: ServiceId } | { ok: false; problem: string } {
  const problem = serviceIdProblem(raw, label);
  if (problem !== null) return { ok: false, problem };
  // The cast, on the line immediately after the check that earns it.
  return { ok: true, id: raw as ServiceId };
}

/**
 * The plural form, for the two commands that take a LIST of ids.
 *
 * It exists because `for (const id of ids) assertServiceId(id)` narrows the
 * ELEMENT and not the array: the loop leaves `string[]`, so the value that
 * reaches core is unbranded no matter how thoroughly each item was checked.
 * That is invisible in review and the compiler is the only thing that sees it.
 *
 * Returns the offending value alongside the problem so the caller prints the
 * same sentence, with the same code, that the element-wise loop printed.
 */
export function parseServiceIds(
  ids: readonly string[],
  label = "--service",
): { ok: true; ids: ServiceId[] } | { ok: false; problem: string } {
  const out: ServiceId[] = [];
  for (const raw of ids) {
    const parsed = parseServiceId(raw, label);
    if (!parsed.ok) return parsed;
    out.push(parsed.id);
  }
  return { ok: true, ids: out };
}

/**
 * A directory name off `readdir`. Says nothing about whether it is a legal id —
 * that is the point, and `idProblem` is where the answer goes.
 *
 * This is a second cast, and it has to be: `readdir` and `basename` return plain
 * `string`, and a brand does not survive them. What the rule in
 * `docs/CODE-STYLE.md` actually buys is that all three casts live in THIS FILE
 * and nowhere else. A fourth one somewhere in `src/` is a finding, not a shortcut.
 */
export function rawServiceId(dirName: string): RawServiceId {
  return dirName as RawServiceId;
}

/**
 * A name a document asserted. Third and last cast, for the crossing between
 * LikeC4's parse output and loam's type system: `e.service ?? e.title` is a
 * plain `string` and does not brand itself.
 */
export function declaredService(text: string): DeclaredService {
  return text as DeclaredService;
}

/**
 * Feature ids are `<word>-<number>`: the id has to survive being read back off
 * the directory name (`FEAT-101-payment-splitting` -> `FEAT-101`), or the
 * feature would answer to a name it was never given.
 *
 * Here for the same reason the service grammar is — this was spelled twice,
 * privately, in `commands/new.ts` and `core/openspec/`, and
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
