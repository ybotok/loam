/**
 * Decode the bytes of a document loam is about to parse, or refuse naming it.
 *
 * The rule belongs to every module that turns a markdown artifact into text —
 * the frontmatter reader, the requirement parser, the fleet-wide read index and
 * three commands that read a single file directly. It lived beside the read
 * index, so each of those imported the whole index (and through it repo.ts,
 * openapi.ts and spec.ts) to reach a dozen lines of decoding, and several of
 * them closed an import cycle doing it. A leaf whose only dependency is
 * `node:buffer` costs nothing to import and can be reached from anywhere.
 */
import { isUtf8 } from "node:buffer";

/**
 * A document loam was about to parse that is not UTF-8 text.
 *
 * Thrown rather than returned, and named as the file rather than as an empty
 * document, because every parser in the codebase reads "no requirements, no
 * frontmatter" as a legitimate state — a fresh baseline looks exactly like it.
 * A `spec.md` saved as UTF-16 (PowerShell's `>` writes UTF-16LE by default)
 * therefore validated green, with every requirement in it invisible.
 *
 * `path` is spelled the way Node spells it on an ErrnoException so that
 * validate's per-target guard names the file without knowing this type; the
 * write path makes the same two tests for the same reasons (staging.ts's
 * `decodeUtf8`), and its messages differ only in saying what a rewrite would
 * additionally destroy, which is not what a reader needs to hear.
 */
export class NotUtf8DocumentError extends Error {
  override readonly name = "NotUtf8DocumentError";

  constructor(
    readonly path: string,
    reason: string,
  ) {
    super(
      `${path} is not a UTF-8 text document — ${reason}. Read as UTF-8 its requirements, frontmatter and headings ` +
        `all come out absent rather than wrong, so the file grades as an empty baseline instead of an unreadable one. ` +
        `Nothing here was checked. Re-save it as UTF-8 (PowerShell's \`>\` and \`Out-File\` write UTF-16 unless told ` +
        `otherwise: use \`Out-File -Encoding utf8\`), then re-run.`,
    );
  }
}

/**
 * Decode a document loam is about to parse, or refuse naming it.
 *
 * Two tests, because one is not enough. `isUtf8` catches the byte sequences
 * that cannot be UTF-8 at all — which is what a byte-order mark makes UTF-16
 * into, and PowerShell writes one. Without a BOM, UTF-16LE of ASCII is a
 * sequence of valid UTF-8 bytes: every other byte is NUL, which decodes to
 * U+0000 and nothing complains. That file parsed as zero requirements and no
 * frontmatter, and validated green. A NUL in a markdown document loam owns has
 * no legitimate spelling, so it is the second test.
 */
export function decodeDocument(bytes: Buffer, path: string): string {
  if (!isUtf8(bytes)) throw new NotUtf8DocumentError(path, "its bytes are not a valid UTF-8 sequence");
  const text = bytes.toString("utf8");
  if (text.includes("\u0000")) {
    throw new NotUtf8DocumentError(
      path,
      "it holds NUL characters, which no markdown document does — almost always UTF-16 saved without a byte-order mark",
    );
  }
  return text;
}
