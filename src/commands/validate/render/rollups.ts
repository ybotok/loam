/**
 * The lines of a fleet report that describe the WHOLE run rather than one
 * finding: the summary that opens and closes it, the index of its errors, the
 * unverifiable-sources line and the not-started axis banners.
 *
 * Every one of them is tallied off the UNFILTERED findings — the same walk the
 * `--json` summary counts — and none of them is a finding, which is why they
 * all print under `--errors-only` and why no rendering lever (axis grouping,
 * repeat grouping) can move a number in any of them. Under `--spine` the
 * findings they tally are the lens's SHOWN half, the same set `valid` and the
 * `--json` summary read, and the lens's own lines (`LENS_LEAD`, `lensTail`)
 * live here for the same reason: they describe the run, not a finding.
 */
import { SEVERITY_MARK, type Finding, type TargetReport } from "../../../core/vocabulary/report.js";
import { plural } from "../../policy/format.js";
import { ADOPTION_AXES, type Adoption, type AdoptionAxis } from "../fleet/scorecard/adoption.js";
import type { JoinsMeter, LensReport } from "../lens/joins.js";
import type { ValidateSummary } from "../report.js";

/**
 * How many names a counted line spells before the rest become `+N more`.
 *
 * A counted line exists to keep a hundred-service fleet's report readable, and
 * a line that names all hundred is the same wall of text moved sideways. Five
 * is enough to recognise a pattern — "it is every platform service" — and the
 * count beside the list says how much was left out, so nothing reads complete
 * when it is not. `--json` always carries every one.
 */
const NAME_LIMIT = 5;

/** `a, b, c, d, e +3 more` — the one spelling of a capped name list. */
export function cappedNames(names: readonly string[]): string {
  const shown = names.slice(0, NAME_LIMIT).join(", ");
  return names.length > NAME_LIMIT ? `${shown} +${names.length - NAME_LIMIT} more` : shown;
}

/**
 * The counts line, printed above a fleet report and again as its footer.
 *
 * Under the spine lens it drops the feature count and says which lens it
 * counts through: the lens never builds a feature, so "0 features" would read
 * as a fleet with no work in flight, and a bare "0 errors" over a partition
 * is the exact green the lens must not be mistaken for.
 */
export function summaryLine(s: ValidateSummary, lensed = false): string {
  const counts = `${plural(s.errors, "error")}, ${plural(s.warnings, "warning")}`;
  if (lensed) return `${plural(s.services, "service")} — ${counts} (spine lens)`;
  return `${plural(s.services, "service")}, ${plural(s.features, "feature")} — ${counts}`;
}

/** The line a text report opens with under `--spine`, below the scope line when there is one. */
export const LENS_LEAD =
  "spine lens — grading only the fleet's joins: each call's operation against its provider's openapi.yaml, " +
  "each message against both ends' asyncapi.yaml, and whatever would stop that check running";

/**
 * The lines a text report closes with under `--spine`, printed even under
 * `--errors-only` and on a green run: a lensed green that did not say what it
 * set aside, or that it checked no join at all, would be read as a healthy
 * fleet. Both print on every run, one service's included — its joins line
 * counts the joins bound to that service, so a service nothing names says
 * "nothing was checked" instead of the green a resolved one prints. `all`
 * picks which command the hidden line points at — the full picture of one
 * service is not `--all`.
 */
export function lensTail(lens: LensReport, all: boolean): string[] {
  const lines = [joinsLine(lens.joins, lens.over)];
  const { errors, warnings, byCode } = lens.hidden;
  const counted = `not graded under --spine: ${plural(errors, "error")}, ${plural(warnings, "warning")}`;
  if (errors + warnings === 0) return [...lines, counted];
  // Most frequent first, ties in code order — the error index's rule above,
  // so the two code lists a reader holds side by side read alike.
  const codes = Object.entries(byCode)
    .sort(([a, x], [b, y]) => y - x || (a < b ? -1 : 1))
    .map(([raised, n]) => `${raised} ×${n}`);
  const where = all ? "`loam validate --all` reports them" : "the same run without --spine reports them";
  return [...lines, `${counted} — ${cappedNames(codes)}; ${where}`];
}

/**
 * One line for the meter, or the sentence that says no join was checked.
 * `over` names a narrower run's joins (`LensReport`), so a zero on one service
 * or one branch never reads as "the map states none".
 */
function joinsLine(joins: JoinsMeter | null, over: string | null): string {
  const head = over === null ? "joins" : `joins ${over}`;
  if (joins === null) {
    return `${head}: not counted — architecture/landscape.likec4 is missing or does not parse, so no join was checked`;
  }
  if (joins.operations + joins.messages === 0) {
    return over === null
      ? "joins: none stated — nothing was checked; name operations in fleet.yaml ('- a -> b: operationId')"
      : `${head}: none — nothing was checked`;
  }
  const parts = [
    `${plural(joins.operations, "call")} ${joins.operations === 1 ? "names" : "name"} an operation`,
    plural(joins.messages, "message join"),
  ];
  if (joins.drawnOnly.length > 0) parts.push(`drawn only, not checked: ${cappedNames(joins.drawnOnly)}`);
  if (joins.toExternals > 0) parts.push(`${plural(joins.toExternals, "call")} into an external, not graded`);
  return `${head}: ${parts.join(" · ")}`;
}

/**
 * Every error the run raised, one line per code, BEFORE the long listing.
 *
 * A fleet run that fails prints its errors wherever their targets happen to
 * sit, and on a large fleet that is hundreds of lines in: a reader who opens
 * the log at the top saw confirmations and warnings first and had to scroll to
 * learn that, and why, the run was red. The index answers that in a few lines
 * — which codes, how many, on what — and does NOT repeat the findings: each
 * prints further down, under its own target or counted on a repeat group.
 *
 * Each error is named by WHERE it prints and, when narrower, what it is
 * about: `FEAT-112 (order-service)` for a feature's per-service check, bare
 * `payment-service` for a service's own. The subject alone sent a reader to
 * the service section for an error printed under a feature; the target alone
 * hid which service a feature or landscape finding is about. Most frequent
 * first; ties keep the order the report raised them in, because a stable sort
 * over the target walk is deterministic across runs and machines. The ×counts
 * sum to the summary's error count by construction — both walk every error.
 */
export function printErrorIndex(targets: readonly TargetReport[]): void {
  const byCode = new Map<string, { count: number; places: Set<string> }>();
  for (const t of targets) {
    for (const f of t.findings) {
      if (f.severity !== "error") continue;
      const entry = byCode.get(f.code) ?? { count: 0, places: new Set<string>() };
      entry.count += 1;
      const where = f.subject === undefined || f.subject === t.id ? t.id : `${t.id} (${f.subject})`;
      entry.places.add(where);
      byCode.set(f.code, entry);
    }
  }
  if (byCode.size === 0) return;
  console.log("errors by code:");
  const rows = [...byCode].sort(([, a], [, b]) => b.count - a.count);
  for (const [raised, entry] of rows) {
    console.log(`  ${SEVERITY_MARK.error} ${raised} ×${entry.count}: ${cappedNames([...entry.places])}`);
  }
}

/** What the footer needs beyond the targets themselves. */
export interface Footer {
  summary: ValidateSummary;
  /** The fleet's unverifiable-sources subject count. */
  unverifiable: number;
  /** The scorecard facts that licensed axis grouping, or null when nothing was grouped. */
  card: { readonly adoption: Adoption; readonly services: number } | null;
  /** The warn codes axis grouping folded, by axis — empty when `card` is null. */
  grouped: ReadonlyMap<string, AdoptionAxis>;
  /**
   * The predicate the listing dropped findings by. Handed in rather than
   * re-derived from `grouped`, so the banner counts exactly the findings the
   * listing left out — two spellings of one rule are two rules.
   */
  isGrouped: (f: Finding) => boolean;
  /** Under `--spine`: the summary names the lens (`summaryLine`). */
  lensed: boolean;
}

/**
 * The `--all` footer: the summary, the unverifiable-sources line and the axis
 * banners. Printed last because CI logs are read from the tail.
 */
export function printFooter(targets: readonly TargetReport[], footer: Footer): void {
  const { unverifiable, card, grouped, isGrouped } = footer;
  console.log(`\n${summaryLine(footer.summary, footer.lensed)}`);
  // One line for the whole fleet, never one per service: honest about the blind
  // spot without drowning the report in a hundred copies of it.
  if (unverifiable > 0) {
    const whose = unverifiable === 1 ? "1 service's" : `${unverifiable} services'`;
    console.log(
      `⚠ sources.unverifiable-from-here: ${whose} sources can only be checked from their own repos`,
    );
  }
  // The axis banners — one per not-started axis that actually grouped a
  // warning, in the axes' fixed order, each naming its dropped codes with
  // counts. Tallied off the UNFILTERED findings (the same walk the footer
  // counts), and printed under --errors-only too: like the footer and the
  // unverifiable line this is a rollup, not a finding.
  if (card !== null && grouped.size > 0) {
    const tally = new Map<string, number>();
    for (const t of targets) {
      for (const f of t.findings) {
        if (isGrouped(f)) tally.set(f.code, (tally.get(f.code) ?? 0) + 1);
      }
    }
    for (const axis of ADOPTION_AXES) {
      // Insertion order of `grouped` is the table's order, so the pairs render
      // deterministically across runs and machines.
      const pairs = [...grouped]
        .filter(([code, a]) => a === axis && (tally.get(code) ?? 0) > 0)
        .map(([code]) => [code, tally.get(code) ?? 0] as const);
      if (pairs.length === 0) continue;
      const total = pairs.reduce((n, [, k]) => n + k, 0);
      console.log(
        `⚠ ${axis} axis not started fleet-wide (0 of ${plural(card.services, "service")}), ` +
          `expected during staged adoption — ${total} warning(s) grouped: ` +
          `${pairs.map(([code, k]) => `${code}×${k}`).join(", ")}; every finding is unchanged in --json`,
      );
    }
  }
}
