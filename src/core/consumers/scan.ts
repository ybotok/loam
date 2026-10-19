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
 * One consumer scan's answer, honest about its own coverage. `victims` is
 * positive evidence; `suspended` names the consumers whose relevant document
 * could not be read (or whose identity is ambiguous), because a scan that
 * skipped a file loam REFUSED to read must never let the caller assert
 * "nobody names it" — the fail-open shape this type exists to forbid.
 */
export interface ConsumerScan {
  victims: string[];
  suspended: string[];
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
