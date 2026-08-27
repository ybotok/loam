/**
 * The evidence pin's identity: what `verify --service --record` stamps beside a
 * confirmed agent answer so a later `loam validate`, standing in the same
 * service repository, can re-check the citation against the working tree.
 *
 * Be precise about what a pin proves, because the record travels without loam:
 * a pin identifies WHAT was cited at the attested commit — the cited file's
 * normalized sha256, the cited line's text, the literal token the claim
 * asserts. It does not prove the claim true; an agent that cited the wrong
 * line gets a faithful pin of the wrong line. That is why the read side
 * (`./lint.ts`) only ever demotes reviewer confidence: no pin state moves a
 * verdict in either direction.
 */
import { createHash } from "node:crypto";
import { isRecord } from "../../kernel/records.js";

export interface EvidencePin {
  /** The cited file, repo-relative in the portable spelling evidence entries use. */
  path: string;
  /** The cited line, 1-based — the `:N` of the evidence entry this pins. */
  line: number;
  /** sha256 hex of the whole file at the attested commit, normalized — see {@link pinnedDigest}. */
  file_sha256: string;
  /** The cited line at the attested commit, trimmed and capped — see {@link pinnedText}. */
  text: string;
  /**
   * The literal string the claim asserts of the cited artifact — the
   * operationId for `api.exposes`, the message name for `event.declares`, the
   * edge's op for `c4.calls` (`Claim.token`, stamped at record time). Carried
   * on the pin so the read side scans the file for it and never has to
   * re-derive a checklist or parse claim prose. Absent for the kinds that
   * assert no token (`service.exists`, `scenario.tested`) — and absent when
   * the attested blob did not CONTAIN the token: that fact is warned once, at
   * record time, where the answerer can still act on it; a pin carrying it
   * would make `loam validate` repeat "no longer contains" forever about a
   * file that never did, with a re-record that re-derives the same state as
   * the only offered repair. `token-missing` therefore always means "was
   * there at the attested commit and is gone".
   */
  token?: string;
}

/**
 * How much of the cited line a pin carries. Enough to recognize a line of
 * source by eye and by equality; a cap because evidence may cite a line of a
 * generated client or a minified bundle, and the record is a YAML file people
 * read and diff — one pathological line must not turn it into one.
 */
export const PIN_TEXT_CAP = 200;

/** The pin's line recipe: trimmed (indentation is formatting), capped at {@link PIN_TEXT_CAP}. */
export function pinnedText(line: string): string {
  const trimmed = line.trim();
  return trimmed.length > PIN_TEXT_CAP ? trimmed.slice(0, PIN_TEXT_CAP) : trimmed;
}

/**
 * The one spelling of where lines fall. Both sides of the pin — the write
 * side's bounds checks and the read side's re-grade — must number lines
 * identically, or a pin recorded at line 12 gets graded against a different
 * line 12; four call sites each spelling the regex themselves is how that
 * divergence would arrive, so the recipe has exactly one home.
 */
export function sourceLines(source: string): string[] {
  return source.split(/\r\n|\n|\r/);
}

/**
 * The cited line of a source text, through the pin recipe — or undefined when
 * the line is past the end, which the caller grades (a refusal on the write
 * side, `unresolved` on the read side).
 */
export function citedLine(source: string, line: number): string | undefined {
  const raw = sourceLines(source)[line - 1];
  return raw === undefined ? undefined : pinnedText(raw);
}

/**
 * The pin's file digest: sha256 hex over the text with CRLF/CR normalized to
 * LF.
 *
 * Normalized because git's eol config makes blob bytes and working-tree bytes
 * legally differ: on a Windows checkout with `core.autocrlf=true`, the blob
 * the attested commit holds is LF while every file on disk is CRLF, so an
 * unnormalized digest would grade every pin `evidence.moved` forever on the
 * checkout config alone. The pin must convict content change, never checkout
 * config. The recipe is over TEXT by construction — the write side digests
 * `git show` output already decoded as utf8 — and the symmetric cost is
 * accepted and documented in SCHEMA.md: a pure line-ending change is invisible
 * to the lint.
 */
export function pinnedDigest(source: string): string {
  return createHash("sha256").update(source.replace(/\r\n|\r/g, "\n")).digest("hex");
}

/**
 * The read-shape guard `asVerification` (../file.ts) asks per claim, on the
 * `isConsumedContractReport` model to the letter: absent is fine — every
 * record written before pins existed, and every runner-answered claim, has
 * none — but present must be whole for the four fields the lint dereferences.
 * A broken pins block makes the WHOLE record unreadable and therefore never
 * overwritten, exactly the contract-report rule: it is somebody's record, and
 * a lint that silently skipped a malformed pin would read a hand-damaged
 * record as drift-free. `token` stays optional-and-any-string for `format`'s
 * reason — a field a newer loam learned to stamp must not brick the record
 * here.
 */
export function isEvidencePinList(v: unknown): boolean {
  if (v === undefined) return true;
  if (!Array.isArray(v)) return false;
  for (const pin of v) {
    if (!isRecord(pin)) return false;
    if (typeof pin["path"] !== "string") return false;
    if (typeof pin["line"] !== "number" || !Number.isInteger(pin["line"]) || pin["line"] < 1) return false;
    if (typeof pin["file_sha256"] !== "string" || typeof pin["text"] !== "string") return false;
    if (pin["token"] !== undefined && typeof pin["token"] !== "string") return false;
  }
  return true;
}
