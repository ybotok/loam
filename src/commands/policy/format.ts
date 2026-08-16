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
export function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}
