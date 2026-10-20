/**
 * What one consumer question answers, and the one sentence that phrases it.
 *
 * Moved out of `loam diff`'s victim index (`core/diff/victims.ts`, now
 * `./consumers.ts`) as its own module because three readers phrase the same
 * answer — `loam diff`'s findings, `loam archive`'s overwrite warnings and the
 * coherence gate's refusals — and none of them should have to import the index
 * to name its result type.
 */

/**
 * Why one possible consumer could not be checked. Typed, because the readers do
 * not weigh the kinds alike: a doubt about a DOCUMENT (`documentDoubt`) is one
 * the removal gate refuses on, and a doubt about a DRAWING is not.
 */
export type SuspensionKind =
  /** A consumer's spec.md or arch.spec.md exists and loam refused to read it — non-UTF-8 bytes, a directory where the file belongs. */
  | "unreadable"
  /** Two directories claim the consumer's service id, so neither one's documents were scanned. */
  | "ambiguous"
  /** An edge into the provider drawn with no `metadata { op }`: it calls the provider, and nobody wrote down which operation. */
  | "unlinked"
  /** A use-case hop whose backing relationships name different operations, this one among them. */
  | "contested";

/** One possible consumer the scan could not check, and the sentence that says which and why. */
export interface Suspension {
  kind: SuspensionKind;
  /** What every reader shows — the document, the directories, the edge or the hop, by name. */
  text: string;
}

/**
 * One consumer scan's answer, honest about its own coverage. `victims` is
 * positive evidence; `suspended` names the consumers whose relevant document
 * could not be read (or whose identity is ambiguous), and the callers drawn or
 * flowed too vaguely to attribute, because a scan that skipped a file loam
 * REFUSED to read must never let the caller assert "nobody names it" — the
 * fail-open shape this type exists to forbid.
 */
export interface ConsumerScan {
  victims: string[];
  suspended: Suspension[];
}

/**
 * Is this a doubt about a consumer DOCUMENT — one loam could not read, or could
 * not tell whose it is? Those are what the removal gate refuses on, as the gate
 * before the one index did: it read every consumer's spec itself, and a file it
 * could not decode either stopped `validate` or was read leniently by `archive`
 * and refused. Filing those as warnings let a removal archive at exit 0 over a
 * Latin-1 spec.md that still named the operation (the one-index review, finding 1).
 *
 * The other two kinds are doubts about a DRAWING, and they stay out of the
 * gate on purpose: `loam seed` draws every edge without an op, so refusing on
 * an op-less caller would turn every removal on a seeded fleet red, and a
 * contested hop is a flow the model cannot attribute (`./consumers.ts` and
 * `core/usecases/operations.ts` say why each is a doubt and never a victim).
 * `loam diff` needs no such split: an unreadable document carries its run to
 * exit 1 through its own `unreadable[]` entry, the drawings do not.
 */
export function documentDoubt(s: Suspension): boolean {
  return s.kind === "unreadable" || s.kind === "ambiguous";
}

/** What a reader's `details[]` lists for one scan: positive evidence first, then every doubt — the order `loam diff` lists them in. */
export function scanDetails(scan: ConsumerScan): string[] {
  return [...scan.victims, ...scan.suspended.map((s) => s.text)];
}

/**
 * Three honest phrasings of one consumer scan — never a confident negative
 * over a scan that skipped something it could not check. Beside the type it
 * phrases rather than inside `core/diff/semantic.ts`, because `loam diff` is no longer
 * its only reader: `loam archive`'s overwrite warnings ask the same scan of
 * the same fleet, and one sentence for one answer is what lets a reader meet
 * one vocabulary in both.
 */
export function consumerStance(scan: ConsumerScan): string {
  return scan.victims.length > 0 ? `${scan.victims.length} current consumer(s) still name it`
    : scan.suspended.length > 0 ? "whether current consumers name it could not be fully answered"
    : "no current consumer names it";
}
