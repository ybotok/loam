/**
 * What a write IS before anything touches disk: the planned record, the staged
 * record, and the bytes both are made of.
 *
 * This is the package's floor. Everything else here — the lock, the swap, the
 * snapshot, the recovery journal — is a rule about WHEN bytes may land; only
 * this module decides what they are. Decoding lives here for the same reason:
 * text is produced only where a parser needs it and `readUtf8` is the one door,
 * so no later addition can reach a docs file through `readFile(…, "utf8")` and
 * silently substitute U+FFFD for bytes loam did not understand.
 */
import { isUtf8 } from "node:buffer";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";

/**
 * A planned file write — the merge is computed fully before anything touches
 * disk. `content: null` means "delete this file"; only `unarchive` plans those,
 * to take back a file the archive created.
 *
 * BYTES, not text. The whole write path — pre-image, staged content, snapshot,
 * the compare-and-set before each swap — moves Buffers, because a docs repo is
 * not guaranteed to hold text loam can decode: `Buffer.toString("utf8")` never
 * fails, it substitutes U+FFFD, so reading a file as a string and writing the
 * string back is a silent, permanent rewrite of every byte loam did not
 * understand. It reached the snapshot too, so `unarchive` restored the damage
 * and reported success. Text is now produced only where a PARSER needs it, by
 * `decodeUtf8`, which refuses instead of substituting.
 */
export interface PlannedWrite {
  path: string;
  /**
   * A `string` is accepted for the callers whose new version IS text they
   * composed from nothing (a re-pinned delta, a restamped spec) and is encoded
   * as UTF-8 once, at staging. A caller holding BYTES — anything derived from a
   * file loam read — must hand over the Buffer: the round trip through a string
   * is the corruption above.
   */
  content: string | Buffer | null;
  /** Create the target atomically without replacing a concurrently created file. */
  exclusive?: boolean;
}

/** The one place a planned write becomes bytes. */
export function toBytes(content: string | Buffer | null): Buffer | null {
  return typeof content === "string" ? Buffer.from(content, "utf8") : content;
}

/**
 * The one place that decides whether a planned write is a CREATE.
 *
 * `exclusive` is a no-clobber create (link(2)), so it can only be asked of a
 * path that does not exist yet: asking it of an overwrite would fail EEXIST on
 * every single run. Deciding here — rather than at each of the dozen
 * `writes.push` sites in archive and unarchive — is what keeps the two commands
 * from disagreeing about which of their writes may safely lose a race. An
 * OVERWRITE is not left unguarded: `swapStaged` compares the target against the
 * pre-image immediately before the rename, so a file another writer changed
 * under us stops the commit instead of silently burying their bytes.
 */
export function planWrite(path: string, content: string | Buffer | null): PlannedWrite {
  if (content !== null && !existsSync(path)) return { path, content, exclusive: true };
  return { path, content };
}

/** A planned write with its new bytes parked next to the target, ready to swap in. */
export interface StagedWrite {
  write: PlannedWrite;
  /** What this write puts on disk — `write.content` encoded once. Null for a delete. */
  content: Buffer | null;
  /** Temp file holding the new bytes, in the target's OWN directory. Null for a delete. */
  tmp: string | null;
  /** The target's bytes before the swap; null when it did not exist. */
  before: Buffer | null;
  /**
   * Topmost directory this write had to create, if any — a rollback owes the repo
   * its directories back too. An empty `services/<svc>/` left standing is the
   * fleet claiming a service that was never merged.
   */
  createdDir: string | null;
  swapped: boolean;
}



/**
 * A file loam must PARSE that does not decode as the UTF-8 text loam owns.
 *
 * Commands map this to `merge-failed`: nothing was written, the file is named,
 * and re-saving it as UTF-8 makes the command work. The read-only migration
 * ingest already refuses non-UTF-8 input outright (openspec-inventory.ts) —
 * the destructive path has strictly more to lose, so it refuses the same way
 * rather than substituting U+FFFD and rewriting the file over the author.
 *
 * `reason` says what the bytes actually ARE, because the two ways a document
 * fails this test destroy different things: one substitutes bytes, the other
 * erases the whole document's meaning. A reader told the wrong one goes looking
 * in the wrong place. The advice that follows is the same either way, so it is
 * spelled once, here.
 */
export class NotUtf8Error extends Error {
  override readonly name = "NotUtf8Error";

  constructor(
    readonly path: string,
    reason: string,
  ) {
    super(`${path} ${reason} Nothing was written. Re-save it as UTF-8, then re-run.`);
  }
}

/**
 * Decode bytes a parser is about to be handed, or refuse naming the file.
 *
 * Two tests, the same two the read path makes (document-bytes.ts's
 * `decodeDocument`), because this side has strictly more to lose by missing
 * either. `isUtf8` catches the byte sequences that cannot be UTF-8 at all —
 * which is what a byte-order mark makes UTF-16 into. Without a BOM, UTF-16LE of
 * ASCII is a sequence of perfectly VALID UTF-8 bytes: every other byte is NUL,
 * so `isUtf8` says yes, the file decodes with a U+0000 between every character,
 * and every parser loam owns reads its requirements, frontmatter and headings
 * as absent rather than as unreadable. On the read path that is a document
 * graded green while nothing in it was checked; here it is worse, because
 * `archive` merges against that empty baseline and writes the result back — the
 * author's requirements are not mis-read, they are gone, and the undo snapshot
 * records the same emptiness as the pre-image.
 */
function decodeUtf8(bytes: Buffer, path: string): string {
  if (!isUtf8(bytes)) {
    throw new NotUtf8Error(
      path,
      `is not valid UTF-8 — loam parses this file as text and writes it back, which would replace every ` +
        `undecodable byte with U+FFFD, in the living document AND in the undo snapshot.`,
    );
  }
  const text = bytes.toString("utf8");
  if (text.includes("\u0000")) {
    throw new NotUtf8Error(
      path,
      `holds NUL characters, which no document loam owns does — almost always UTF-16 saved without a byte-order ` +
        `mark. Its bytes are valid UTF-8, so it decodes without complaint into text whose requirements, ` +
        `frontmatter and headings all parse as ABSENT: the merge would compute over an empty baseline and write ` +
        `that back, taking every requirement in the file with it.`,
    );
  }
  return text;
}

/** Read a file loam is going to parse. The only supported way to turn a docs file into a string. */
export async function readUtf8(path: string): Promise<string> {
  return decodeUtf8(await readFile(path), path);
}

/** Same bytes? Absence is its own value: a file that is gone is not a file that is empty. */
export function sameBytes(a: Buffer | null, b: Buffer | null): boolean {
  return a === null || b === null ? a === b : a.equals(b);
}

/* ------------------------------------------------------------------ */
/* Reading loam's own records back off the disk                        */
/* ------------------------------------------------------------------ */

/** The one spelling of a sha256 loam wrote, for reading one back out of a record. */
export function isDigest(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

export function sha256(content: Buffer | string): string {
  return typeof content === "string"
    ? createHash("sha256").update(content, "utf8").digest("hex")
    : createHash("sha256").update(content).digest("hex");
}

