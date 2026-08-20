/**
 * What did NOT reach a suite, in the emission's own voice.
 *
 * A module of its own for `../gherkin/render.ts`'s reason, and the loss is the
 * same kind. Both flow verbs answer per GROUP — `sync` writes one view per
 * group, `env` answers one environment per group — so a journey carrying no
 * group tag is missing from every line either of them prints, while both
 * commands report success and a group count that is perfectly correct. This is
 * the only place that absence is visible at all, so it must not share a module
 * with a write path or a print loop that can grow past it, and one sentence in
 * one place is what stops the two verbs telling an author different things
 * about the same journey.
 *
 * A NOTE, NEVER A FINDING, and the distinction is the design decision here.
 * `flow.uncovered` and `flow.step-unresolved` are standing obligations on the
 * fleet: a journey nobody covers is a debt whichever command happens to be
 * running, and `validate --all` is where a fleet answers for its debts. A
 * journey in no suite is not one — `core/flows/groups.ts` records that being in
 * no group is legal and normal, exactly as an unfiled service is, and
 * `subsystem list` already answers the unfiled with a count rather than a code.
 * What was missing is not a grade: it is that the two commands whose entire
 * subject is suites never mentioned the journeys that are in none.
 */

/**
 * The unsuited journeys, named, under the total they were counted out of.
 *
 * ONE header line naming every id, then one sentence — rather than the Gherkin
 * renderer's line-per-loss. There the reason differs per scenario (a stepless
 * body and a malformed table are different repairs); here every unsuited
 * journey has the identical explanation, so a line each would print the same
 * paragraph N times and bury the ids it exists to show.
 *
 * NOTHING IS PRINTED WHEN EVERY JOURNEY IS SUITED. A note that fires on a fleet
 * with nothing to say is a note people learn to skip, and this one has to
 * survive being read on the day it matters.
 */
export function printUngrouped(ids: string[], journeys: number): void {
  if (ids.length === 0) return;
  console.log("");
  console.log(`⚠ ${ids.length} of ${journeys} journey(s) in no suite: ${ids.join(", ")}`);
  console.log(`  ${WHY}`);
}

/**
 * Why it matters, and what to do — the half a bare count cannot carry.
 *
 * It says "not a defect" out loud because the alternative reading is the
 * damaging one: an author who takes this for a validation failure fixes it by
 * DELETING the journey, and the drawn journey is the artifact this whole axis
 * exists to make worth maintaining. The feature-id sentence is here rather than
 * left to `flow.group-invalid` because this is where the author is looking at
 * the list: a journey tagged `#FEAT-101` and nothing else appears in it, and
 * without the sentence that entry reads as loam having lost a tag the document
 * plainly carries.
 */
const WHY =
  "A journey with no group tag joins no suite: it appears in no view of " +
  "architecture/flow-groups.likec4 and in no `loam flow env` answer, so nothing stands its " +
  "participants up and nothing will run it. It is still a flow — drawn, and still graded by " +
  "flow.uncovered and flow.step-unresolved — so this is a fact about the suites, not a defect in " +
  "the journey: tag it with a group the fleet map's `specification` block declares, or leave it " +
  "unsuited deliberately. A tag taking the feature-id grammar groups nothing either — loam reads " +
  "it as the feature tag it looks like, and `flow.group-invalid` names it.";
