/**
 * How a pointer's arguments are SPELLED per host. The shared stub writes them
 * positionally — `$1`, `$2`, … in the `loam instructions` line and, for
 * `loam-ship`, in its spine — and each dialect re-spells them into the form its
 * host fills in, or into words where the host fills in nothing.
 *
 * This reverses a decision the contract used to record: one body, `$1`
 * everywhere, because rewriting per tool looked like a second copy of the
 * protocol. Only the placeholder moves, never the prose, and three facts made
 * the single spelling wrong rather than merely plain (each host's own docs,
 * checked 2026-10-27):
 *
 *  - Claude Code counts `$N` from ZERO (code.claude.com/docs/en/skills: "`$0`
 *    for the first argument or `$1` for the second"), and its command files
 *    "work the same way" as skills. `/loam-implement FEAT-101 payment-service`
 *    therefore wrote `loam instructions loam-implement payment-service $2` — the
 *    service where the feature id goes — and a one-argument command left `$1`
 *    standing with the value appended below the file. Named arguments
 *    (`arguments:` in the frontmatter, `$feature` in the body) have no index to
 *    get wrong, and expand to empty when not given.
 *  - Copilot substitutes no `$1` anywhere; its prompt files take
 *    `${input:name:placeholder}`.
 *  - Outside Claude Code, no host checked substitutes inside a skill at all —
 *    Copilot, Codex and OpenCode were — so an Agent Skills file reads
 *    `<FEAT-id>`, which an agent fills in from the request, rather than a `$1`
 *    that looks like a value a host forgot to supply.
 *
 * The command dialects that DO substitute `$1` from one (OpenCode), or keep
 * their own convention loam does not emit (Gemini's `{{args}}`), keep `$1`.
 * The ones that substitute nothing (Cline, Kilo Code, Roo Code) keep it too:
 * `loam instructions` reads a placeholder arriving as data as "not supplied"
 * (`unsupplied` in protocol.ts), in every spelling this module emits.
 */
import type { DeliveredCommand, PlaceholderKind } from "../contract.js";

export interface Argument {
  /** The argument's name wherever a host names arguments: Claude's `$feature`, Copilot's `${input:feature}`, an MCP prompt's argument. */
  readonly name: string;
  /** What the argument is, for a host that shows it while asking for one. */
  readonly description: string;
  /** The argument written as words, for a skill no host substitutes into. */
  readonly word: string;
}

/** Each placeholder kind's spellings. `free` is a title because loam-feature's `$2` is the only one. */
export const ARGUMENTS: Record<PlaceholderKind, Argument> = {
  feature: { name: "feature", description: "feature id, e.g. FEAT-101", word: "<FEAT-id>" },
  service: { name: "service", description: "service id, e.g. payment-service", word: "<service-id>" },
  free: { name: "title", description: "the feature's title, in words", word: "<title>" },
};

/**
 * The body with every `$1`, `$2`, … re-spelled by `spell`, which is told
 * whether this is the placeholder's first occurrence. A `$N` beyond the
 * command's declared placeholders is left as written: it denotes nothing.
 */
function respelled(c: DeliveredCommand, spell: (arg: Argument, first: boolean) => string): DeliveredCommand {
  const seen = new Set<string>();
  const body = c.body.replace(/\$([1-9])/g, (literal, n: string) => {
    const kind = c.placeholders[Number(n) - 1];
    if (kind === undefined) return literal;
    const first = !seen.has(n);
    seen.add(n);
    return spell(ARGUMENTS[kind], first);
  });
  return { ...c, body };
}

/** Claude Code: `$feature`, declared by {@link argumentsLine}. */
export const namedArguments = (c: DeliveredCommand): DeliveredCommand => respelled(c, (a) => `$${a.name}`);

/**
 * Copilot prompt files: `${input:feature:feature id, e.g. FEAT-101}`. The
 * description rides on the first occurrence only — it is what the host shows
 * while asking, and `loam-ship` names its feature five times.
 */
export const inputArguments = (c: DeliveredCommand): DeliveredCommand =>
  respelled(c, (a, first) => (first ? `\${input:${a.name}:${a.description}}` : `\${input:${a.name}}`));

/** Agent Skills: `<FEAT-id>`, filled in from the request. */
export const wordedArguments = (c: DeliveredCommand): DeliveredCommand => respelled(c, (a) => a.word);

/** Claude Code's `arguments:` frontmatter line, which binds `$feature` to the first argument; empty for none. */
export const argumentsLine = (c: DeliveredCommand): string =>
  c.placeholders.length === 0 ? "" : `arguments: ${c.placeholders.map((k) => ARGUMENTS[k].name).join(" ")}\n`;

/**
 * Every spelling of an unsupplied argument this module writes — what an
 * untouched file sends when a host substituted nothing, or an agent pasted the
 * line as it stands. Copilot's `${input:…}` is absent: the host fills it before
 * any agent reads the file, so it cannot arrive as data.
 */
export const ARGUMENT_SPELLINGS: ReadonlySet<string> = new Set(
  Object.values(ARGUMENTS).flatMap((a) => [`$${a.name}`, a.word]),
);
