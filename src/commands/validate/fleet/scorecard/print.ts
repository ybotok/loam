/**
 * The fleet scorecard's one table — how the `--all` text report renders what
 * `./scorecard.js` derived. A module of its own for validate's own discipline
 * (validate.ts's header: the checks produce findings and none of them print;
 * printing happens after the last target is graded), and so the derivation
 * and the formatting do not share a file whose one seam is exactly that.
 *
 * One line per axis, ceiling before actual, read left to right the way the
 * numbers are read in a CI log — except the adoption row, which states
 * participation over the denominator (`requirements 3/40`): adoption is an
 * N-of-M spread, not a ceiling chased by an actual, and forcing it into the
 * arrow idiom would read as one. It prints under `--errors-only` too, on
 * purpose: like the summary footer it is a rollup, not a finding, and
 * `--errors-only` is a findings-rendering lever (report.ts).
 */
import { ARTIFACT_STATUSES } from "../../../../core/status/report.js";
import { ANSWERED_BY } from "../../../../core/verify/answers.js";
import { VERIFICATION_VERDICTS } from "../../../../core/verify/record.js";
import { MATURITY_LADDER } from "../../../../core/vocabulary/maturity.js";
import { ADOPTION_AXES } from "./adoption.js";
import { type Scorecard } from "./scorecard.js";

export function printScorecard(card: Scorecard): void {
  const { maturity, provenance: p, verification: v, operations: o, messages: m, c4, features: f } =
    card;
  console.log("\nfleet scorecard (ceiling → actual)");
  console.log(
    `  services      ${card.services} — ` +
      MATURITY_LADDER.map((rung) => `${maturity[rung]} ${rung}`).join(" · "),
  );
  console.log(
    // The sampled count rides INSIDE the vouched number rather than after it,
    // because that is where it changes the reading: "120 vouched" and "120
    // vouched (100 sampled)" are different fleets, and a reader who stops at
    // the first number must not have been told the stronger of the two.
    `  provenance    ${p.vouched} vouched${p.sampledVouched > 0 ? ` (${p.sampledVouched} sampled)` : ""} — ` +
      `${p.staleDigests} stale digest(s) · ${p.unverifiableFromHere} unverifiable from here`,
  );
  // The ceiling is the features axis's `active` — the payload deliberately
  // carries that denominator once, so this line reads it from there.
  console.log(
    `  verification  ${f.active} feature(s) → ${v.recorded} recorded — ` +
      VERIFICATION_VERDICTS.map((verdict) => `${v.verdicts[verdict]} ${verdict}`).join(" · ") +
      ` — claims ${v.claims.confirmed}/${v.claims.total} confirmed ` +
      // Every provenance, under its own `answered_by` spelling and always all
      // three — the same stable-shape rendering as the verdicts before it. Two
      // buckets could not name what they held: the line said "runner" over
      // claims no runner answered, and no label short of the real one fixes
      // that, because `external-runner` is neither of the other two.
      `(${ANSWERED_BY.map((who) => `${v.claims.answered[who]} ${who}`).join(" · ")})`,
  );
  console.log(
    `  operations    ${o.defined} defined → ${o.governed} governed · ` +
      `${o.deprecated} deprecated (${o.deprecatedStillConsumed} still consumed)`,
  );
  console.log(`  messages      ${m.defined} defined → ${m.linked} linked`);
  console.log(`  c4            ${c4.elements} elements → ${c4.covered} covered`);
  // Participation per axis over the one denominator, then the same facts as
  // the sentence a standup reads out: which axes the fleet has started at
  // all. "adopted" here means at least one participating service — the
  // per-axis counts on the line above say how many.
  const a = card.adoption;
  console.log(
    `  adoption      ` +
      ADOPTION_AXES.map((axis) => `${axis} ${a[axis]}/${card.services}`).join(" · "),
  );
  const adopted = ADOPTION_AXES.filter((axis) => a[axis] > 0);
  const notStarted = ADOPTION_AXES.filter((axis) => a[axis] === 0);
  console.log(
    `  axes          adopted: ${adopted.length === 0 ? "none" : adopted.join(", ")}` +
      (notStarted.length === 0 ? "" : ` · not started: ${notStarted.join(", ")}`),
  );
  console.log(
    `  features      ${f.active} active — ` +
      ARTIFACT_STATUSES.map((stage) => `${f.stages[stage]} ${stage}`).join(" · "),
  );
}
