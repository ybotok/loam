/**
 * The protocol surface: the six workflow bodies as one list, and everything
 * derived from it — what `loam instructions` prints (commands/instructions.ts)
 * and the corpus every check over loam's agent-facing prose reads
 * (test/codes-drift.test.ts, test/agent-contract.test.ts,
 * test/agent-commands-runnable.test.ts).
 */
import { featureIdProblem } from "../kernel/ids/feature.js";
import { serviceIdProblem } from "../kernel/ids/service.js";
import type { CommandContent, PlaceholderKind } from "./contract.js";
import { LOAM_ADOPT } from "./workflows/adopt.js";
import { LOAM_CHECK } from "./workflows/check.js";
import { LOAM_VERIFY, LOAM_SHIP } from "./workflows/closing.js";
import { LOAM_FEATURE } from "./workflows/feature.js";
import { LOAM_IMPLEMENT } from "./workflows/implement.js";
import { REFERENCES } from "./workflows/reference/reference.js";

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
 * Everything `loam instructions <name>` can print: the six workflows and the
 * four reference pages, in that order.
 *
 * The pages join the workflows HERE and nowhere else — not in {@link COMMANDS},
 * which is what scaffold.ts derives `SLASH_COMMANDS` and `plannedCommandFiles`
 * from. That is the whole mechanism, and the asymmetry is the point: a page is
 * printable by name but `loam init` writes no file for it, so moving 44 KB out
 * of AGENTS.md did not put 44 KB back as four new artifacts in every repository
 * loam touches. workflows/reference/reference.ts records why the pages exist;
 * test/agents.test.ts asserts both halves of this separately, because a future
 * edit can break either alone.
 */
const PRINTABLE: CommandContent[] = [...COMMANDS, ...REFERENCES];

/**
 * The printable bodies, keyed by name — what `loam instructions <name>` prints,
 * and the corpus every check over loam's agent-facing prose reads.
 *
 * Separate from SLASH_COMMANDS since the file became a pointer: the protocol is
 * still the thing that must document every stable code (`codes-drift`) and
 * every `loam …` line it teaches must still parse against the real CLI
 * (`agent-commands-runnable`). Those two properties are about the INSTRUCTIONS,
 * and they did not move just because the delivery did.
 *
 * The reference pages belong in this record for exactly that reason. Every code
 * they carry LEFT AGENTS.md to get here, and `codes-drift` reads
 * `AGENTS_MD + PROTOCOLS` — so the guard stays green by construction, because
 * the codes moved from one half of that corpus into the other. If it goes red
 * after a change here, something was deleted rather than moved.
 */
export const PROTOCOLS: Record<string, string> = Object.fromEntries(
  PRINTABLE.map((c) => [c.name, c.body]),
);

/**
 * What each page's `$1`, `$2`, … denote — see {@link CommandContent.placeholders}.
 * A reference page declares `[]`, which is not a formality: `placeholderProblems`
 * keys off this record, and a name absent from it is treated as unknown rather
 * than as taking no arguments.
 */
export const PLACEHOLDERS: Record<string, readonly PlaceholderKind[]> = Object.fromEntries(
  PRINTABLE.map((c) => [c.name, c.placeholders]),
);

/**
 * Whether nothing was supplied for this position — the two shapes an absent
 * argument actually arrives in, in one place because both call sites below owe
 * the same answer.
 *
 * The first is empty; {@link protocolFor} says which dialects send that. The
 * second is the placeholder ITSELF, arriving as data. One body serves twenty
 * tool dialects (tools/registry.ts) and keeps Claude's positional `$1`/`$2`
 * convention in all of them (see {@link CommandContent}), so every generated
 * stub carries the spelling verbatim: `.gemini/commands/loam/adopt.toml`
 * contains the literal line `loam instructions loam-adopt $1`. Gemini's own
 * convention is `{{args}}` and Copilot's is `${input:…}`, and Cline, Kilo Code
 * and Roo Code substitute nothing whatever — so on those three the `$1` reaches
 * this command exactly as written, and loam refused the literal first
 * instruction of its own workflow with `invalid-option`. (Unquoted in a POSIX
 * shell the same line degrades the other way: `$1` expands to empty, and the
 * agent receives a protocol addressed to nobody.) The same class already cost
 * `loam-check` its placeholder — see the comment in workflows/check.ts; this is
 * the general fix, made once in the RECEIVING command rather than per dialect.
 *
 * Scoped to `^\$[1-9]$` and no wider. `{{args}}` and `${input:…}` are
 * deliberately NOT matched: the tools that spell placeholders that way
 * substitute them before an agent ever reads the file, so they cannot arrive
 * here, and loam emits neither. A value that merely CONTAINS a placeholder
 * (`FEAT-$1`) is a real argument and is still checked as one.
 */
const unsupplied = (arg: string | undefined): boolean =>
  arg === undefined || arg === "" || /^\$[1-9]$/.test(arg);

/**
 * Why the arguments given to `name` cannot be substituted into its protocol, or
 * null when they can. One sentence per bad argument, already naming the
 * placeholder it was meant to fill.
 *
 * The grammars are `core/kernel/ids/`'s, never a second copy: a value this accepts
 * and `loam adopt` refuses would be worse than no check, because the protocol
 * would still be wrong and now something had approved it. An argument nobody
 * supplied is not an error — `protocolFor` leaves that placeholder standing on
 * purpose, so the page reads as "the service id goes here" — and by
 * {@link unsupplied} that covers the placeholder text arriving as the argument,
 * which is what an untouched generated stub sends.
 */
export function placeholderProblems(name: string, args: readonly string[]): string[] | null {
  const kinds = PLACEHOLDERS[name];
  if (kinds === undefined) return null;
  const problems = kinds.flatMap((kind, i) => {
    const arg = args[i];
    // The `undefined` arm is `unsupplied`'s own; it is repeated here because
    // that is what narrows `arg` to a string for the id grammars below.
    if (arg === undefined || unsupplied(arg) || kind === "free") return [];
    const problem = kind === "service"
      ? serviceIdProblem(arg, `$${i + 1}`)
      : featureIdProblem(arg, `feature id ($${i + 1})`);
    return problem === null ? [] : [problem];
  });
  return problems.length === 0 ? null : problems;
}

/** One row of the `loam instructions` menu: enough to choose, and nothing more. */
type MenuRow = Pick<CommandContent, "name" | "description" | "argumentHint">;

const row = ({ name, description, argumentHint }: CommandContent): MenuRow =>
  ({ name, description, argumentHint });

/** The workflow names, in cycle order — `loam instructions` with no argument lists these. */
export const WORKFLOWS: readonly MenuRow[] = COMMANDS.map(row);

/**
 * The reference-page names, listed by the same bare `loam instructions` and
 * kept a SEPARATE list rather than appended to {@link WORKFLOWS}.
 *
 * A page is not a workflow: it has no steps, it is not part of the cycle, and
 * running one is not doing anything. A menu that ran the ten together would
 * read as a ten-step process, which is the one thing the six-step cycle must
 * not be confused with — so the command prints them under their own heading
 * (commands/instructions.ts) and test/instructions.test.ts pins that they stay
 * apart.
 */
export const REFERENCE_PAGES: readonly MenuRow[] = REFERENCES.map(row);

/**
 * One workflow's protocol with `$1`, `$2`, … replaced by the arguments given.
 *
 * An unsupplied placeholder is LEFT STANDING rather than blanked: the bodies
 * are written so `$1` reads as "the feature id goes here", and a protocol that
 * silently dropped it would hand an agent `loam validate --feature --json` — a
 * command that parses, runs, and answers a different question. Extra arguments
 * are ignored for the same reason: this substitutes, it does not validate.
 *
 * "Unsupplied" is {@link unsupplied}'s two shapes, not merely a missing
 * element, and neither is pedantry — they are the two things a tool actually
 * sends. An EMPTY argument is the first: several dialects expand an absent
 * positional to the empty string, and `loam-feature`'s own invocation quotes
 * its second one (`--title "$2"`), so `/loam-feature FEAT-101` with no title
 * arrives here as `["FEAT-101", ""]`. Blanking it produced
 * `loam new FEAT-101 --title ""` — which is exactly the failure the paragraph
 * above describes, reached by the one path that paragraph did not cover: the
 * command succeeds, and writes a feature whose title is the empty string and
 * whose intent.md opens with a bare `#`.
 *
 * The LITERAL PLACEHOLDER is the second: the dialects that substitute nothing
 * hand this command the `$1` their generated stub was written with, so
 * `loam instructions loam-adopt $1` renders the same page as
 * `loam instructions loam-adopt` — the placeholder standing, the protocol
 * printed. Here the shape mostly falls out anyway (planting `$1` where `$1`
 * stood is a no-op); it is spelled all the same, because a MISNUMBERED one
 * would not be — `$3` given for `$1` would renumber the placeholder in the
 * printed page — and because the check above and this render have to agree on
 * one definition or a value can pass one and be rewritten by the other.
 */
export function protocolFor(name: string, args: readonly string[] = []): string | null {
  const body = PROTOCOLS[name];
  if (body === undefined) return null;
  return body.replace(/\$([1-9])/g, (whole, digit: string) => {
    const arg = args[Number(digit) - 1];
    return arg === undefined || unsupplied(arg) ? whole : arg;
  });
}
