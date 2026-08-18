/**
 * Small shaping helpers for the human renderers.
 *
 * They live in `commands/` and not in `core/`: nothing here computes an answer,
 * it only decides how an answer reads to a person. The `--json` payloads never
 * touch this file.
 */

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
