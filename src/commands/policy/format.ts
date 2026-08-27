/**
 * Small shaping helpers for the human renderers.
 *
 * They live in `commands/` and not in `core/`: nothing here computes an answer,
 * it only decides how an answer reads to a person. The `--json` payloads never
 * touch this file.
 */
import { type DiscardedAnswer } from "../../core/verify/build.js";

/**
 * "1 service", "2 services". The regular English plural, spelled once because
 * five renderers had drifted into five copies of the same ternary and a sixth
 * would have been written the next time somebody counted something. A noun with
 * an irregular plural does not belong here — say both forms at the call site.
 */
/**
 * The one spelling of "this run first recovered a predecessor's commit" — it
 * existed in three copies (rebase, gherkin, verify --record) before vouch and
 * new needed a fourth and fifth, which is the extraction rule's third strike
 * twice over. Reported at all because docs changing beyond the command's own
 * writes would otherwise read as its doing.
 */
export function sayRecovered(r: { command: string; outcome: string; repaired: string[] }): string {
  return (
    `recovered an interrupted \`loam ${r.command}\` first (${r.outcome}` +
    `${r.repaired.length === 0 ? "" : `: ${r.repaired.join(", ")}`}).`
  );
}

export function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

/**
 * The one spelling of the vocabulary pointer `validate` and `verify` append to
 * a TEXT report that printed findings — one string here rather than one per
 * renderer, because a hand-written second copy is exactly the drift the
 * pointer's target exists to prevent. The sentence says where the codes ARE
 * before naming the lookup: validate's text lines carry messages, not code
 * strings, so a footer asking the reader to explain "a code above" would ask
 * for something never on their screen. Text mode only, by contract: the
 * `--json` payloads are frozen surface and never carry it.
 */
export const EXPLAIN_FOOTER =
  "→ codes ride in `--json`; `loam explain <code>` says what one means and how to fix it";

/**
 * What the previous record answered and the new one does not — printed, never
 * decided here (`buildFederatedVerification` decides; `verify --record`
 * reports). A federated write is a partial write, so the first one over an
 * all-at-once record drops every answer it cannot attribute to a commit —
 * correct, but silence there reads as loam having lost the answers, and nobody
 * goes looking for what to re-record. It lives beside `sayRecovered` because
 * it is the same kind of helper: one spelling of an account the command owes a
 * person about something the run did beyond its own answer.
 */
export function sayDiscarded(discarded: DiscardedAnswer[], recordPath: string, feature: string): void {
  if (discarded.length === 0) return;
  const off = discarded.filter((d) => d.reason === "off-checklist").length;
  console.log(
    `\n  ${plural(discarded.length, "earlier answer")} from ${recordPath} ${discarded.length === 1 ? "is" : "are"} not carried into this record:`,
  );
  for (const d of discarded) {
    console.log(
      `    - ${d.id}${d.subject === undefined ? "" : ` [${d.subject}]`}  ${d.claim}` +
        (d.reason === "off-checklist"
          ? "  (the feature changed; nothing asks this any more)"
          : "  (no commit attestation binds it — its service must record it again)"),
    );
  }
  if (discarded.length > off) {
    console.log(
      `    Each owning service records its own with \`loam verify ${feature} --record answers.json --service <svc>\` in its repo.`,
    );
  }
}
