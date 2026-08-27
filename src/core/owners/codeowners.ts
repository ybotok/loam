/**
 * A deliberately small CODEOWNERS reader: directory-pattern rules only,
 * parsed fail-closed, matched mechanically — the join behind
 * `loam list --owners <path>`. loam does not grow an ownership model of its
 * own (SCHEMA.md: ownership is CODEOWNERS); this module only reads back, as
 * data, what the forge's file already says.
 *
 * Three postures, and the line between them is the module's whole design:
 *
 * - A rule the subset UNDERSTANDS — a plain directory path, optionally
 *   anchored with a leading `/`, optionally ending `/`, `/*` or `/**` — is
 *   matched, last match winning, GitHub's own precedence. An OWNER-LESS rule
 *   with such a pattern is understood too: it CLEARS ownership for what it
 *   matches, exactly as the forge reads it — skipping it would fail in the
 *   dangerous direction, leaving the earlier broad rule's team holding a
 *   service the forge explicitly took off their plate.
 * - A rule the subset RECOGNISES but does not implement — any other wildcard
 *   use, `*` and `*.md` above all — is SKIPPED and reported, never guessed
 *   at: an attribution computed from a half-understood pattern would file
 *   services under teams the forge never named. Skipping only ever
 *   UNDER-attributes (a service reads unowned, honestly listed), never the
 *   reverse. The caller surfaces `skipped` beside the join.
 * - A line that cannot be read as `pattern owner…` at all refuses as data
 *   (`{ ok: false, line }`): silently dropping lines of a corrupted file
 *   would grade it as a thin one — the same fail-closed rule the answers
 *   reader applies to the other user-named file (`answers-unreadable`).
 *
 * Matching is by path SEGMENTS: a rule matches a service directory when the
 * pattern's segments appear as one contiguous run in the service's
 * docs-repo-relative directory segments — starting at the root when the
 * pattern is anchored, at any depth when it is not. Two deliberate
 * divergences from gitignore semantics, both pinned by
 * test/list-campaign.test.ts so they are documented behaviour, not accident:
 * a slash-containing pattern WITHOUT a leading `/` (`services/payments/`)
 * matches at any depth here, where the forge would anchor it to the root —
 * a BROADER attribution, since a rule can match at a depth GitHub would
 * not, though the segments still have to appear verbatim; and a trailing
 * `/*` is read as the directory itself (services anywhere beneath match),
 * where GitHub would stop at direct children. One rule for all spellings
 * keeps the subset explainable in a sentence.
 *
 * Pure on purpose: content arrives as a string, and nothing here touches the
 * filesystem or prints, so the command layer owns the read and the
 * `owners-unreadable` refusal (core never prints — AGENTS.md).
 */

/** One rule the implemented subset accepted, in file order. */
export interface OwnersRule {
  /** 1-based line number in the file, for messages and reports. */
  readonly line: number;
  /** The pattern exactly as written, for reporting. */
  readonly pattern: string;
  /** True when the pattern began with `/` — matched from the repo root only. */
  readonly anchored: boolean;
  /** The pattern's path segments, leading `/`, trailing `/`, `/*`, `/**` stripped. */
  readonly segments: readonly string[];
  readonly owners: readonly string[];
}

/** A recognised rule outside the implemented subset — reported, never guessed. */
export interface SkippedRule {
  readonly line: number;
  readonly pattern: string;
}

export type ParsedCodeowners =
  | { readonly ok: true; readonly rules: readonly OwnersRule[]; readonly skipped: readonly SkippedRule[] }
  | { readonly ok: false; readonly line: number; readonly problem: string };

/**
 * What an owner token may look like: `@user`, `@org/team`, or an email — the
 * three forms GitHub's own syntax accepts. Anything else in owner position is
 * a corrupted line, not a rule, and the whole parse refuses with its number.
 */
const OWNER_TOKEN = /^@[^\s@/]+(?:\/[^\s@/]+)?$|^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function parseCodeowners(content: string): ParsedCodeowners {
  const rules: OwnersRule[] = [];
  const skipped: SkippedRule[] = [];
  // A UTF-8 BOM would otherwise glue itself onto the first pattern and turn
  // an anchored rule silently unanchored.
  const lines = content.replace(/^\uFEFF/, "").split(/\r?\n/);
  for (const [index, raw] of lines.entries()) {
    const line = index + 1;
    const text = raw.trim();
    if (text === "" || text.startsWith("#")) continue;
    // A trailing comment is dropped from its `#` token on. Owners precede any
    // comment, so nothing a comment says can change the rule it annotates —
    // and the `#` token cannot be index 0, because a line whose first token
    // starts with `#` took the comment branch above.
    const tokens = text.split(/\s+/);
    const hash = tokens.findIndex((token) => token.startsWith("#"));
    const effective = hash === -1 ? tokens : tokens.slice(0, hash);
    const pattern = effective[0]!;
    const owners = effective.slice(1);
    const bad = owners.find((token) => !OWNER_TOKEN.test(token));
    if (bad !== undefined) {
      return { ok: false, line, problem: `'${bad}' is not an owner (@user, @org/team or an email address)` };
    }
    const read = readPattern(pattern);
    if (read === null) {
      skipped.push({ line, pattern });
      continue;
    }
    // `owners` may be empty: an owner-less in-subset rule is GitHub's
    // ownership-clearing form, and last-match-wins performs the clear for
    // free — a matching empty rule overwrites the earlier team with nobody.
    rules.push({ line, pattern, ...read, owners });
  }
  return { ok: true, rules, skipped };
}

/** The pattern grammar of the implemented subset, or null when outside it. */
function readPattern(pattern: string): { anchored: boolean; segments: string[] } | null {
  const trimmed = pattern.endsWith("/**")
    ? pattern.slice(0, -3)
    : pattern.endsWith("/*")
      ? pattern.slice(0, -2)
      : pattern;
  // Any wildcard, character class, negation or escape elsewhere in the
  // pattern is real CODEOWNERS syntax this subset does not implement.
  if (/[*?[\]!\\]/.test(trimmed)) return null;
  const anchored = trimmed.startsWith("/");
  const body = (anchored ? trimmed.slice(1) : trimmed).replace(/\/$/, "");
  if (body === "") return null;
  const segments = body.split("/");
  if (segments.some((segment) => segment === "")) return null;
  return { anchored, segments };
}

/**
 * The owners of the LAST rule matching this directory, or `[]` for an
 * unowned one — later rules override earlier ones, GitHub's own precedence,
 * so a specific team can reclaim a corner of a broadly-owned tree. `dir` is
 * the service's docs-repo-relative directory split on `/`
 * (`["services", "payments", "pay-a"]`).
 */
export function ownersFor(dir: readonly string[], rules: readonly OwnersRule[]): readonly string[] {
  let owners: readonly string[] = [];
  for (const rule of rules) {
    if (matches(dir, rule)) owners = rule.owners;
  }
  return owners;
}

/**
 * A directory pattern names a directory, and covers the service AT that
 * directory and every service beneath it — which is exactly "the pattern's
 * segments appear as a contiguous run in the service's own segments".
 */
function matches(dir: readonly string[], rule: OwnersRule): boolean {
  const last = dir.length - rule.segments.length;
  if (last < 0) return false;
  const startsAt = (from: number): boolean =>
    rule.segments.every((segment, i) => dir[from + i] === segment);
  if (rule.anchored) return startsAt(0);
  for (let from = 0; from <= last; from += 1) {
    if (startsAt(from)) return true;
  }
  return false;
}
