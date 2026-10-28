/**
 * How big ONE printed LikeC4 diagnostic may be — `boundedMessage`, the cut
 * `../likec4.ts`'s `errorText` applies to every message it prints.
 *
 * Moved out of that module verbatim when it reached its 400-line limit: these
 * read nothing but a message string, which makes them the one self-contained
 * piece of it, and a leaf package importing nothing cannot close a cycle.
 */

/**
 * How many alternatives of a parser's "one of these possible Token sequences"
 * list a printed diagnostic keeps — the number `likec4 validate` itself prints
 * before its `...`.
 */
const TOKEN_ALTERNATIVES = 4;

/** The heading line of Chevrotain's no-viable-alternative message, whose numbered list follows it. */
const TOKEN_SEQUENCES = /possible Token sequences:$/;

/** One numbered alternative in that list: `  12. [IdTerminal, Dot]`. */
const ALTERNATIVE = /^\s+\d+\. /;

/**
 * A LikeC4 message, with Chevrotain's list of expected token sequences cut to
 * its first few alternatives and a count of the rest.
 *
 * When the parser meets a token no rule can take, Chevrotain lists EVERY token
 * sequence any rule could have accepted there — and inside a LikeC4 `model { }`
 * block that is the whole grammar. Measured at the 1.59.2 pin: deleting the
 * closing quote of one `technology '…'` makes three such messages of about
 * 6,160 lines each, and `loam validate --service` printed 18,503 lines
 * (434 KB; 458 KB as `--json`) for one keystroke. `capDetails` bounds how MANY
 * details a finding prints, never how big one is, and `loam context` has no cap
 * at all — so a broken feature delta turned a 24 KB briefing into 626 KB for
 * every agent working on any service the feature touches. An agent in the
 * check-fix loop gets nothing from alternative 4,000: what it acts on is the
 * line number and the `but found: '…'` line, which is kept.
 *
 * Upstream `likec4 validate` keeps the first five lines of any message and
 * prints `...`; this cuts the LIST only, so the `but found:` line after it
 * survives, and says how many alternatives were dropped so nothing reads as
 * complete when it is not (the convention `capDetails` uses). Any other
 * message is returned exactly as LikeC4 wrote it.
 */
export function boundedMessage(message: string): string {
  const lines = message.split("\n");
  if (!TOKEN_SEQUENCES.test(lines[0] ?? "")) return message;
  const alternatives = lines.filter((line) => ALTERNATIVE.test(line)).length;
  if (alternatives <= TOKEN_ALTERNATIVES) return message;
  const kept: string[] = [];
  let seen = 0;
  for (const line of lines) {
    if (!ALTERNATIVE.test(line)) kept.push(line);
    else if (++seen <= TOKEN_ALTERNATIVES) kept.push(line);
    else if (seen === TOKEN_ALTERNATIVES + 1) kept.push(`  … (+${alternatives - TOKEN_ALTERNATIVES} more)`);
  }
  return kept.join("\n");
}
