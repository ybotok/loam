/**
 * The PHRASE KEY: what makes two written steps the same step definition.
 *
 * `loam steps` counts by this key, so the moment it ships the recipe is a
 * contract — a team writes glue against the groups it reports, and a key that
 * drifts re-partitions their whole registry. `test/steps-inventory.test.ts`
 * pins it case by case for that reason.
 *
 * ## Why the keyword is dropped
 *
 * Every mainstream runner resolves Given/When/Then/And/But against ONE registry
 * of patterns, so `Given the ledger is open` and `And the ledger is open` are
 * one definition and must count as one row. Keeping the keyword would split
 * every continued step from the step it continues, and the number the whole
 * report exists to give — how many definitions does this suite need — would be
 * wrong in the direction that flatters it.
 *
 * ## Why literals collapse and prose does not
 *
 * A quoted string, an angle-bracket placeholder and a bare number are what a
 * step definition captures as an ARGUMENT; everything else is what it matches
 * on. Collapsing exactly those three is therefore not a heuristic about
 * similarity — it is the same partition the runner will make when the patterns
 * are written. Nothing here measures edit distance: `core/repo/entries.ts`
 * already records that verdict for close-id suggestions, and a third private
 * copy of that function would be the drift it warns about.
 */

const KEYWORD_RE = /^(given|when|then|and|but)\s+/i;

/**
 * A subordinate clause that explains WHY, which a step definition never
 * matches on separately: `validation branch "x" passes because the window is
 * open` is the same definition as `validation branch "x" passes`, with the
 * reason baked into the pattern. Reported as a near-duplicate rather than
 * merged, because the fix — move the reason into the scenario description — is
 * the author's to make.
 */
const RATIONALE_RE = /\s+(because|while|since|unless|so that)\s+.*$/i;

const LEADING_ARTICLE_RE = /^(the|a|an)\s+/i;

export interface Phrase {
  /** Two steps sharing this need ONE step definition. */
  key: string;
  /**
   * The looser key that gathers near-duplicates: the same phrase with a leading
   * article or a trailing rationale clause. Steps sharing a family but not a key
   * are two definitions where the author probably meant one.
   */
  family: string;
}

/** `Given a payment of 100.00 for "<tier>"` -> key `a payment of {n} for {s}`. */
export function phraseOf(stepText: string): Phrase {
  const key = stepText
    .replace(KEYWORD_RE, "")
    // A QUOTED placeholder is still a placeholder — `"<tier>"` is the outline's
    // parameter, and letting the string rule reach it first would collapse the
    // whole token to {s} and hide that the step is parameterized at all.
    .replace(/(["'`])<[^<>\s]+>\1/g, "{p}")
    .replace(/<[^<>\s]+>/g, "{p}")
    .replace(/"[^"]*"/g, "{s}")
    .replace(/'[^']*'/g, "{s}")
    .replace(/`[^`]*`/g, "{s}")
    // A number only when it stands alone: `v1` and `oauth2` are part of a name,
    // and collapsing them would merge two steps that match different patterns.
    .replace(/(?<![\w.])\d+(?:\.\d+)?(?![\w.])/g, "{n}")
    .replace(/\s+/g, " ")
    .trim();
  const family = key
    .replace(RATIONALE_RE, "")
    .replace(LEADING_ARTICLE_RE, "")
    .replace(/[.,;:]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
  return { key, family };
}

/** The canonical keyword of a written step line, for reporting which ones a phrase appears under. */
export function keywordOf(stepText: string): string {
  const m = KEYWORD_RE.exec(stepText);
  if (!m) return "";
  const w = m[1]!.toLowerCase();
  return w[0]!.toUpperCase() + w.slice(1);
}
