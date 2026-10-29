/**
 * The two forms a requirement takes in a brief: VERBATIM, and as an OUTLINE.
 *
 * Verbatim is the default and the frozen contract — the pack is the briefing,
 * and a heading without its body is a table of contents for a file the reader
 * then has to open. The outline is what `--outline` asks for instead, and it
 * exists because the verbatim form does not fit. Measured on a pilot fleet
 * (2026-10-29): `loam delta <FEAT> --service <svc> --json --intent-ref` handed
 * the implementer of one service 434,889 bytes, of which the text and the
 * Given/When/Then lines of 23 requirements were 334 KB — a median requirement of
 * 14 KB, the largest 39 KB — and `loam context <svc> --feature <FEAT>`, the step
 * before it, carried the same requirements again. An agent with a ~50k-token
 * context could read neither, so it read nothing.
 *
 * The outline keeps every key that says what a requirement TOUCHES — its id,
 * its kind, its name, every join line — and drops the two that say what it
 * SAYS: `text`, and each scenario's `lines`. In their place it says where the
 * requirement sits and what reading it costs (`RequirementSpan`), so a reader
 * plans the whole service from the outline and opens one requirement at a time:
 * `path` from `line` to `endLine` is the requirement, heading to last line,
 * byte for byte. The same move `--intent-ref` makes for intent.md, one
 * requirement wide, and the one OpenSpec's `show --requirements` and BMAD's
 * sharded stories make for the same reason.
 */
import { type Requirement } from "../document/spec.js";

/**
 * A requirement as the pack carries it: every join line the requirement writes
 * but `Realizes:`, its body and its scenarios — narrower than `loam delta`'s
 * item (`requirementJson`, `commands/delta/requirements.ts`), which also carries
 * `line`, `basedOn`, `realizes` and each scenario's `line` and `digest`.
 * Verbatim on purpose — the pack is the briefing, and
 * a heading without its body is a table of contents for a file the reader then
 * has to open.
 */
export interface PackRequirement {
  kind: Requirement["kind"];
  id?: string;
  name: string;
  text: string;
  operations: string[];
  covers: string[];
  requires: string[];
  capabilities: string[];
  publishes: string[];
  consumes: string[];
  /** Verbatim: the acceptance criteria, and the source for the tests whoever picks this up writes. */
  scenarios: Array<{ name: string; lines: string[] }>;
}

function packRequirement(r: Requirement): PackRequirement {
  return {
    kind: r.kind,
    ...(r.id === undefined ? {} : { id: r.id }),
    name: r.name,
    text: r.text.join("\n").trim(),
    operations: r.operations,
    covers: r.covers,
    requires: r.requires,
    capabilities: r.capabilities,
    publishes: r.publishes,
    consumes: r.consumes,
    scenarios: r.scenarios.map((s) => ({ name: s.name, lines: s.lines })),
  };
}

/** Where one requirement sits in its document, and what reading it costs. */
export interface RequirementSpan {
  /** Docs-repo-relative, forward slashes — the spelling of every `path` in these payloads. */
  path: string;
  /** 1-based, in the FILE: the `### Requirement:` heading. */
  line: number;
  /** 1-based, inclusive: the last line before the next requirement or `##` heading, or the file's last line. */
  endLine: number;
  /** UTF-8 bytes of lines `line` to `endLine`, line endings included — what opening it costs. */
  bytes: number;
}

/** The span of one requirement of the document a reader was made for. */
export type SpanOf = (r: Requirement) => RequirementSpan;

/**
 * Where each requirement `parseRequirements(md)` returned sits in `md`, the file
 * at `path`. A function of the requirement rather than an array beside the
 * requirements, so no caller can pair a span with the wrong one by position:
 * the requirement carries its own line, and the span is computed from it.
 *
 * Derived from the parse rather than by searching the text again, because the
 * parse is what decided where a requirement ends: from its heading every line
 * is body or scenario until the next requirement or `##` heading, fenced lines
 * included, so the last line is the heading's plus the body's plus each
 * scenario's heading and lines. A second scan with its own idea of a heading
 * would be a second answer to that question. Clamped to the file's own last
 * line: a file that ends on a newline hands the parse one empty line past it.
 */
export function spanReader(md: string, path: string): SpanOf {
  // Each line WITH its terminator, so a CRLF file's bytes are its own.
  const lines = md.split(/(?<=\n)/);
  return (r) => {
    const line = parsedLine(r.line);
    const end = line + r.text.length + r.scenarios.reduce((sum, s) => sum + 1 + s.lines.length, 0);
    const endLine = Math.min(end, lines.length);
    const bytes = lines.slice(line - 1, endLine).reduce((sum, text) => sum + Buffer.byteLength(text, "utf8"), 0);
    return { path, line, endLine, bytes };
  };
}

/**
 * A line `parseRequirements` recorded. Optional on the type because a
 * requirement can be built by hand; every one this module is handed came out
 * of the parser, which records both — so a missing one is a caller's bug, and
 * an outline pointing at line 0 would send the reader to the top of the file.
 */
function parsedLine(line: number | undefined): number {
  if (line === undefined) throw new Error("requirement outline: a requirement that did not come from parseRequirements has no line");
  return line;
}

/** A requirement as `--outline` carries it in the pack: `PackRequirement` without what it says, with where it is. */
export interface PackOutline extends RequirementSpan {
  kind: Requirement["kind"];
  id?: string;
  name: string;
  operations: string[];
  covers: string[];
  requires: string[];
  capabilities: string[];
  publishes: string[];
  consumes: string[];
  /** Each scenario's name and the line its heading sits on — the Given/When/Then is in the file. */
  scenarios: Array<{ name: string; line: number }>;
}

/** Either form, as one pack section carries it — every item of a section is in the same one. */
export type PackItem = PackRequirement | PackOutline;

function packOutline(r: Requirement, span: RequirementSpan): PackOutline {
  return {
    kind: r.kind,
    ...(r.id === undefined ? {} : { id: r.id }),
    name: r.name,
    ...span,
    operations: r.operations,
    covers: r.covers,
    requires: r.requires,
    capabilities: r.capabilities,
    publishes: r.publishes,
    consumes: r.consumes,
    scenarios: r.scenarios.map((s) => ({ name: s.name, line: parsedLine(s.line) })),
  };
}

/**
 * One section of a pack: `reqs` parsed from `md` at `path`, in the form asked
 * for. `md` is null exactly when there is no document, and then so is every
 * requirement — the section is empty either way.
 */
export function packSection(section: { reqs: readonly Requirement[]; md: string | null; path: string }, outline: boolean): PackItem[] {
  if (!outline || section.md === null) return section.reqs.map(packRequirement);
  const spanOf = spanReader(section.md, section.path);
  return section.reqs.map((r) => packOutline(r, spanOf(r)));
}
