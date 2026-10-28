/**
 * A feature's intent.md carried BY REFERENCE: where the file is, which bytes it
 * holds, how it is laid out, and the part of it the brief's own scope needs.
 *
 * The three briefs an implementer is handed — `loam tasks`, `loam delta` and
 * `loam context` — each inlined the whole intent verbatim, and the intent is the
 * one document in a feature that grows without bound: the analyze step writes
 * every decision and every open question into it. Measured on a pilot fleet
 * (2026-10-28), `loam tasks <FEAT> --next --json` handed a worker 219,823 bytes
 * for a unit of about 300, and 215,691 of them were intent.md. That agent ran a
 * local model with a ~50k-token context, so the brief did not fit at all — and
 * the implement loop re-runs `loam tasks` after every recording, paying the
 * same 216 KB each time for words the worker had already read.
 *
 * The reference is what `--intent-ref` puts in place of the text. It is enough
 * to read the file ONCE and to know when to read it again: `sha256` is over the
 * file's bytes, so `sha256sum` on the path answers whether the intent moved
 * since; `sections` is the outline, with a line and a size per heading, so a
 * reader with a small context opens the one section it needs rather than the
 * whole file; and `questions` are the open questions that name the services the
 * brief is about — the only part of the intent that is somebody's work item,
 * and the part `loam delta` already counted for the same reason.
 *
 * Pure on purpose: the callers read the file's bytes and pass its repo-relative
 * path, so this module needs neither the repository layout nor the envelope, and
 * `core/document/` stays below both.
 */
import { createHash } from "node:crypto";
import { decodeDocument } from "../../kernel/document-bytes.js";
import { fenceTracker } from "../../kernel/fences.js";
import { rawBody } from "../frontmatter.js";
import { openQuestions, questionsNaming } from "./questions.js";

/** One heading of the outline: where it starts and how much text sits under it. */
export interface IntentSection {
  /** 1 to 3 — deeper headings are detail inside a section, and an outline of every one is a second copy of the file. */
  level: number;
  heading: string;
  /** 1-based, in the FILE — frontmatter lines included — because that is the line an editor or `sed -n` opens. */
  line: number;
  /** UTF-8 bytes from this heading to the next one of the same or a higher level, or to the end of the file. */
  bytes: number;
}

export interface IntentRef {
  /** Docs-repo-relative, forward slashes — the same spelling every `path` in these payloads has. */
  path: string;
  /** sha256 of the file's bytes, hex. */
  sha256: string;
  /** The file's size in bytes — what inlining it would have cost. */
  bytes: number;
  sections: IntentSection[];
  /**
   * `total` is every open question the intent holds; `naming` is the rows that
   * name one of the brief's services by id, verbatim. A question that names no
   * service is in `total` and not in `naming`, so a reader who sees the two
   * differ knows there is more to read under `## Open questions`.
   */
  questions: { total: number; naming: string[] };
}

/** An ATX heading of level 1 to 3, closing hashes and trailing spaces trimmed. */
const HEADING = /^(#{1,3})[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/;

/**
 * The reference for the intent whose file holds `bytes`. The digest and the size
 * are over those bytes, so `sha256sum` on `path` reproduces them.
 *
 * Decoded through `decodeDocument`, which THROWS `NotUtf8DocumentError` for a
 * file that is not UTF-8 text — an intent saved as UTF-16 by PowerShell's `>`.
 * Read leniently, that file came out with no sections and no open questions,
 * and a digest of replacement characters no file tool could reproduce: a
 * reference that says "nothing here for you" about a file nobody could read.
 * The callers refuse instead, as `loam context` always did for the same file.
 */
export function intentReference(bytes: Buffer, path: string, services: readonly string[]): IntentRef {
  const text = decodeDocument(bytes, path);
  const asked = openQuestions(text);
  // In document order, each row once, whichever of the services it names.
  const named = new Set(services.flatMap((service) => questionsNaming(asked, service)));
  const naming = asked.filter((question) => named.has(question));
  return {
    path,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    bytes: bytes.length,
    sections: outline(text),
    questions: { total: asked.length, naming },
  };
}

/**
 * The headings of the body, outside fenced blocks. The frontmatter is cut with
 * `rawBody` — the one definition of where a header ends — and its lines are
 * skipped rather than removed, so every `line` still counts from the top of the
 * file: a YAML comment is `# text` too, and an outline that listed `# owner` as
 * a section would send the reader into the header.
 */
function outline(text: string): IntentSection[] {
  const lines = text.split("\n");
  const headerLines = countLines(text.slice(0, text.length - rawBody(text).length));
  const fenced = fenceTracker();
  const starts: Array<{ level: number; heading: string; index: number }> = [];
  lines.forEach((raw, index) => {
    if (index < headerLines) return;
    const line = raw.replace(/\r$/, "").replace(/^﻿/, "");
    if (fenced(line)) return;
    const match = HEADING.exec(line);
    if (match !== null) starts.push({ level: match[1]!.length, heading: match[2]!, index });
  });
  const sizes = lines.map((line, index) => Buffer.byteLength(line, "utf8") + (index < lines.length - 1 ? 1 : 0));
  return starts.map((start, i) => {
    const next = starts.slice(i + 1).find((later) => later.level <= start.level);
    const end = next === undefined ? lines.length : next.index;
    const bytes = sizes.slice(start.index, end).reduce((sum, size) => sum + size, 0);
    return { level: start.level, heading: start.heading, line: start.index + 1, bytes };
  });
}

/** Lines in the header `rawBody` cut off — a prefix that ends on its newline, or is empty (or a lone BOM). */
function countLines(prefix: string): number {
  return prefix.split("\n").length - 1;
}

/**
 * `payload` with its verbatim `intent` swapped for `intentRef`, in the same
 * position — a person reading the JSON finds the reference where the text used
 * to be, and every other key keeps its order and its bytes.
 */
export function withIntentRef<T extends { intent: string | null }>(
  payload: T,
  ref: IntentRef | null,
): Omit<T, "intent"> & { intentRef: IntentRef | null } {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (key === "intent") out["intentRef"] = ref;
    else out[key] = value;
  }
  return out as Omit<T, "intent"> & { intentRef: IntentRef | null };
}
