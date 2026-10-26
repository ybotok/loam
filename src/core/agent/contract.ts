/**
 * The shapes of the agent contract: what a workflow protocol is made of and
 * what a per-tool delivery adds around it. Types only, deliberately — a leaf
 * module the rest of the package `import type`s from. scripts/package-graph.mjs
 * counts only value imports, so keeping this file value-free is what lets
 * workflows/ and tools/ depend on the shapes without a package edge back into
 * the agent root, and what keeps that graph acyclic.
 */
/**
 * One slash command, format-free. `body` is the whole protocol — the per-tool
 * emitters in AGENT_TOOLS add only a path and a wrapper (frontmatter fields, a
 * TOML shell), never their own prose: one source of truth, thin spellings.
 * Bodies write their arguments positionally, `$1`/`$2`, and that is the one
 * thing a wrapper may re-spell: into what its host fills in (Claude Code's
 * named `$feature`, Copilot's `${input:…}`) or into words where the host fills
 * in nothing. Only the placeholder moves; tools/arguments.ts says why one
 * spelling for every host was wrong.
 */
/**
 * What a protocol's positional placeholder denotes. `free` is the one that
 * cannot be checked — `loam-feature`'s `$2` is a human title, and any string is
 * a legal one — and it is spelled rather than left implicit so a new
 * placeholder has to state which of the three it is.
 */
export type PlaceholderKind = "service" | "feature" | "free";

export interface CommandContent {
  /** Stable command name (`loam-check`) — also the flat file name everywhere. */
  name: string;
  description: string;
  /** What the user passes, in Claude's `argument-hint` spelling. */
  argumentHint: string;
  /** One or two sentences: what this workflow is for, and who does which half. */
  purpose: string;
  /**
   * The literal `loam instructions …` line the generated file tells an agent to
   * run, placeholders and all. Spelled per command rather than derived from
   * `argumentHint`, because the mapping from a hint to positional arguments is
   * exactly the kind of clever derivation that is right five times and wrong
   * once — and the once is a command an agent pastes.
   */
  invocation: string;
  /**
   * What `$1`, `$2`, … stand for in `body`, in order — so the substitution can
   * be checked instead of merely performed.
   *
   * `loam instructions loam-adopt "$PWD"` used to render a protocol reading
   * `services//Users/someone/work/svc/` and `--service /Users/someone/…`: the
   * placeholder is a service id, the value was an absolute path, and nothing
   * between the shell and the printed page knew the difference. The commands
   * downstream all refuse it — `assertServiceId` is one rule in one place, and
   * it says so well — so a bad brief could never become bad documentation. But
   * the refusal arrives one step late, after an agent has read a page of
   * confident instructions built around a value that cannot work, and the
   * cheapest place to say "that is not a service id" is the command that was
   * told the argument IS one.
   */
  placeholders: readonly PlaceholderKind[];
  /**
   * The verbs, in order, and nothing else. This is the half of the protocol
   * that does not move between releases: a reader with a stale file can still
   * tell whether a run went sideways, without the file claiming to know this
   * binary's flags or finding codes.
   */
  spine: string[];
  /** The protocol itself: markdown, ends with a newline. */
  body: string;
  /**
   * When a host should load this as a skill: the requests and situations that
   * call for it, in the words a user types rather than loam's. Claude Code's
   * `when_to_use` frontmatter field, which its skill listing appends to
   * `description` — so the trigger can be added without turning the shared
   * description into a pitch (see `skillsIn`). Absent on the reference pages,
   * which no init ever writes as a skill; test/agents.test.ts requires it on
   * every command that is one.
   */
  whenToUse?: string;
}

/**
 * A command as a delivery receives it: `body` is already the pointer, and
 * `protocol` is the page that pointer sends the agent to.
 *
 * The protocol rides along for the one emitter that needs it — a skill's
 * allowlist pre-approves the verbs that page instructs, and the pointer alone
 * names three of them. Carried as data rather than looked up, because the
 * lookup lives in the agent root (`protocol.ts`), and tools/ reaching for it
 * would be the package edge back into the root that this module's value-free
 * shape exists to prevent.
 */
export interface DeliveredCommand extends CommandContent {
  /** The full protocol page, placeholders unsubstituted — `PROTOCOLS[name]`. */
  readonly protocol: string;
}

/**
 * One delivery of one command: where the file goes, and what goes in it. Both
 * halves are thin by construction — the protocol is `CommandContent.body` and
 * nothing here may restate it.
 */
export interface AgentFileEmitter {
  /** Repo-relative path segments of the file. */
  path(name: string): string[];
  /** The full file: this tool's wrapper around the shared body. */
  format(cmd: DeliveredCommand): string;
}

/** One always-read instructions file: where it goes, and its bytes around the version stamp. */
export interface InstructionsEmitter {
  /** Repo-relative path segments of the file. */
  readonly path: readonly string[];
  /** The whole file, given the stamp line and the commands the repository holds skills for. */
  format(stamp: string, commands: readonly CommandContent[]): string;
}

/**
 * A tool the commands can be emitted for — the registry key is the `--tools`
 * id (OpenSpec's ids where the tool has one there). A path and a wrapper are
 * the WHOLE adapter: OpenSpec's per-tool command layer, minus everything loam
 * refuses on principle — no version stamps in command files, no
 * overwrite-on-update, no managed marker blocks in anyone else's file. Paths
 * and wrappers follow each tool's own documented convention, pinned in
 * test/agents.test.ts.
 */
export interface AgentTool {
  /**
   * Repo-relative path segments of one command's file. Absent — together with
   * `format` — for a tool that registers no command files at all: Codex reads
   * skills and nothing else, and inventing a command directory for it would
   * scatter files no agent ever loads.
   */
  path?(name: string): string[];
  /** The full command file: this tool's wrapper around the shared body. */
  format?(cmd: DeliveredCommand): string;
  /** The skill delivery. Absent for a tool with no skills convention. */
  skill?: AgentFileEmitter;
  /**
   * A file the tool reads on every request in the repository — one per repo,
   * not one per command — that tells an agent loam is here before any skill
   * is chosen. Written beside the skills, outside the docs repo, whose
   * AGENTS.md already says it.
   */
  instructions?: InstructionsEmitter;
  /**
   * Repo-relative directory prefixes (ending in `/`) this tool's files were
   * written under before they moved. A re-run removes the files there that
   * loam wrote and nobody edited, so the tool does not read two copies.
   */
  retired?: readonly string[];
  /**
   * Repo-relative paths whose presence means this tool is in use here — what
   * `loam init` scans when no `--tools` says otherwise. Usually just the tool's
   * own dot-directory; spelled per tool because the exceptions matter more than
   * the rule (see `github-copilot`, whose `.github/` says nothing at all).
   */
  detect: string[];
}
