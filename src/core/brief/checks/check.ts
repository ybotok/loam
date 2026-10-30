/**
 * The shape of one row of the adoption brief's checks table, and the two
 * invocations a row can name — the vocabulary `./checks.ts` and `./usecases.ts`
 * both write their rows in.
 *
 * A module of its own because the table became two: the service's own
 * use-case rows grew into a subject with a header of their own, and the two
 * halves cannot import each other's values without a cycle.
 */

/**
 * The two invocations a baseline meets. `<id>` is a placeholder for the service
 * id — the JSON contract keeps it symbolic, the text renderer substitutes it.
 */
export const VIA_SERVICE = "loam validate --service <id>";
export const VIA_ALL = "loam validate --all";

export interface BriefCheck {
  code: string;
  severity: "error" | "warn";
  /**
   * The invocation that surfaces this check. Most run under `--service`, but
   * the fleet cross-check does not — attributing it there taught agents to
   * expect a finding that run never reports.
   */
  via: typeof VIA_SERVICE | typeof VIA_ALL;
  what: string;
}
