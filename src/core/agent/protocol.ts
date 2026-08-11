/**
 * The protocol surface: the six workflow bodies as one list, and everything
 * derived from it — what `loam instructions` prints (commands/instructions.ts)
 * and the corpus every check over loam's agent-facing prose reads
 * (test/codes-drift.test.ts, test/agent-contract.test.ts,
 * test/agent-commands-runnable.test.ts).
 */
import { featureIdProblem, serviceIdProblem } from "../kernel/ids.js";
import type { CommandContent, PlaceholderKind } from "./contract.js";
import { LOAM_ADOPT } from "./workflows/adopt.js";
import { LOAM_CHECK } from "./workflows/check.js";
import { LOAM_VERIFY, LOAM_SHIP } from "./workflows/closing.js";
import { LOAM_FEATURE } from "./workflows/feature.js";
import { LOAM_IMPLEMENT } from "./workflows/implement.js";

/**
 * The six protocols, in cycle order. One assembly, exported: scaffold.ts
 * derives the generated files through this same list, so what
 * `loam instructions` prints and what a fresh scaffold writes cannot drift
 * apart.
 */
export const COMMANDS: CommandContent[] = [
  LOAM_ADOPT,
  LOAM_FEATURE,
  LOAM_IMPLEMENT,
  LOAM_CHECK,
  LOAM_VERIFY,
  LOAM_SHIP,
];

/**
 * The workflow protocols themselves, keyed by command name — what
 * `loam instructions <name>` prints, and the corpus every check over loam's
 * agent-facing prose reads.
 *
 * Separate from SLASH_COMMANDS since the file became a pointer: the protocol is
 * still the thing that must document every stable code (`codes-drift`) and
 * every `loam …` line it teaches must still parse against the real CLI
 * (`agent-commands-runnable`). Those two properties are about the INSTRUCTIONS,
 * and they did not move just because the delivery did.
 */
export const PROTOCOLS: Record<string, string> = Object.fromEntries(
  COMMANDS.map((c) => [c.name, c.body]),
);

/** What each workflow's `$1`, `$2`, … denote — see {@link CommandContent.placeholders}. */
export const PLACEHOLDERS: Record<string, readonly PlaceholderKind[]> = Object.fromEntries(
  COMMANDS.map((c) => [c.name, c.placeholders]),
);

/**
 * Why the arguments given to `name` cannot be substituted into its protocol, or
 * null when they can. One sentence per bad argument, already naming the
 * placeholder it was meant to fill.
 *
 * The grammars are `core/kernel/ids.ts`'s, never a second copy: a value this accepts
 * and `loam adopt` refuses would be worse than no check, because the protocol
 * would still be wrong and now something had approved it. An argument nobody
 * supplied is not an error — `protocolFor` leaves that placeholder standing on
 * purpose, so the page reads as "the service id goes here".
 */
export function placeholderProblems(name: string, args: readonly string[]): string[] | null {
  const kinds = PLACEHOLDERS[name];
  if (kinds === undefined) return null;
  const problems = kinds.flatMap((kind, i) => {
    const arg = args[i];
    if (arg === undefined || arg === "" || kind === "free") return [];
    const problem = kind === "service"
      ? serviceIdProblem(arg, `$${i + 1}`)
      : featureIdProblem(arg, `feature id ($${i + 1})`);
    return problem === null ? [] : [problem];
  });
  return problems.length === 0 ? null : problems;
}

/** The workflow names, in cycle order — `loam instructions` with no argument lists these. */
export const WORKFLOWS: ReadonlyArray<Pick<CommandContent, "name" | "description" | "argumentHint">> =
  COMMANDS.map(({ name, description, argumentHint }) => ({ name, description, argumentHint }));

/**
 * One workflow's protocol with `$1`, `$2`, … replaced by the arguments given.
 *
 * An unsupplied placeholder is LEFT STANDING rather than blanked: the bodies
 * are written so `$1` reads as "the feature id goes here", and a protocol that
 * silently dropped it would hand an agent `loam validate --feature --json` — a
 * command that parses, runs, and answers a different question. Extra arguments
 * are ignored for the same reason: this substitutes, it does not validate.
 *
 * An EMPTY argument counts as unsupplied, and that is not pedantry. Several
 * tool dialects expand an absent positional to the empty string, and
 * `loam-feature`'s own invocation quotes its second one (`--title "$2"`), so
 * `/loam-feature FEAT-101` with no title arrives here as `["FEAT-101", ""]`.
 * Blanking it produced `loam new FEAT-101 --title ""` — which is exactly the
 * failure the paragraph above describes, reached by the one path that paragraph
 * did not cover: the command succeeds, and writes a feature whose title is the
 * empty string and whose intent.md opens with a bare `#`.
 */
export function protocolFor(name: string, args: readonly string[] = []): string | null {
  const body = PROTOCOLS[name];
  if (body === undefined) return null;
  return body.replace(/\$([1-9])/g, (whole, digit: string) => {
    const arg = args[Number(digit) - 1];
    return arg === undefined || arg === "" ? whole : arg;
  });
}
