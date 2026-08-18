/**
 * The spelling rule for feature ids, and the brands that carry its provenance.
 *
 * Split out of `service.ts` when the feature grammar grew the same brand
 * lattice the service grammar has: the two rules share a package because both
 * become directory names in the shared docs repo, but a feature id is not a
 * service id — the brands below are deliberately disjoint from `RawServiceId`
 * and `ServiceId`, so one grammar's checked value cannot stand in where the
 * other's is demanded.
 */

/* ---------------------------------------------------------------- */
/* The two provenances a feature name can have                       */
/* ---------------------------------------------------------------- */

/**
 * Same hierarchy as the service brands, for the same measured reason: the raw
 * form is the base — a name whose provenance is the repository — and the
 * checked form is a SUBTYPE, so `id === arg`, `Set<RawFeatureId>.has(id)` and
 * sorting a mixed list all stay the ordinary string business they are.
 */
declare const provenance: unique symbol;
declare const checked: unique symbol;

/**
 * A feature id a repository listed this directory for: read back off a
 * `features/` directory name by the enumeration. It exists; it may still be an
 * illegal loam id — `core/repo/repo.ts`'s `listFeatures` deliberately returns
 * those, because `loam list` must show you the badly-named directory that is
 * there.
 */
export type RawFeatureId = string & { readonly [provenance]: "loam" };

/** An id that passed `featureIdProblem`. The only form a caller may construct. */
export type FeatureId = RawFeatureId & { readonly [checked]: true };

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

/* ---------------------------------------------------------------- */
/* The two constructors — the only place a brand is asserted         */
/* ---------------------------------------------------------------- */

/**
 * The one constructor that validates — `parseServiceId`'s shape, for the same
 * reason: a discriminated pair rather than `FeatureId | string`, because that
 * second shape compiles and is unusable, and the problem sentence is the one
 * `featureIdProblem` already produces, so a caller that is collecting findings
 * prints exactly what a refusal would.
 */
export function parseFeatureId(
  raw: string,
  label = "feature id",
): { ok: true; id: FeatureId } | { ok: false; problem: string } {
  const problem = featureIdProblem(raw, label);
  if (problem !== null) return { ok: false, problem };
  // The cast, on the line immediately after the check that earns it.
  return { ok: true, id: raw as FeatureId };
}

/**
 * An id derived from a directory name a repository listed. Says nothing about
 * whether it is a legal id — that is the point: the enumeration must be able to
 * name the directory that is there, however it is spelled.
 *
 * This is a cast, and it has to be: the derivation in
 * `core/repo/entries.ts`'s `featureIdFromDirName` starts from a plain `readdir`
 * string, and a brand does not survive it. What the rule in
 * `docs/CODE-STYLE.md` buys is that both of this file's casts live HERE and
 * nowhere else — a third one somewhere in `src/` is a finding, not a shortcut.
 */
export function rawFeatureId(derived: string): RawFeatureId {
  return derived as RawFeatureId;
}
