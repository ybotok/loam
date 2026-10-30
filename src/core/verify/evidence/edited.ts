/**
 * A green run of a hand-edited generated scenario is not evidence for the
 * scenario the spec holds.
 *
 * The runner answers a `scenario.tested` claim by digest, and a digest is a
 * tag: weaken `Then the answer is 409 with code "copy-held"` to `Then the
 * answer is 409` under the same tag, and cucumber passes the weaker test, the
 * step count still matches, and `--results` used to confirm the claim the spec
 * states in full. The suite is re-emitted in memory and compared
 * (`core/gherkin/stale.ts`'s `generatedEdits`, the same comparison behind
 * `gherkin.edited` in `loam validate`), and every runner confirmation whose
 * scenario differs from its emission is withdrawn to `unconfirmed`, with a note
 * that names the file and the regeneration. Total over the answers handed in,
 * like `contractAnswers` beside it: an answer it has no reason to touch comes
 * back as it went in.
 *
 * Step definitions are outside this by nature: they are the team's code, and
 * loam reads no code.
 */
import { generatedEdits, type SuiteContext } from "../../gherkin/stale.js";
import { scenarioDigestTag } from "../../gherkin/stamp.js";
import { type Answer } from "../answers.js";
import { type Claim } from "../checklist.js";

export async function withdrawEdited(
  answers: Answer[],
  claims: readonly Claim[],
  suite: SuiteContext,
): Promise<Answer[]> {
  const edits = await generatedEdits(suite);
  if (edits.length === 0) return answers;
  const editedAt = new Map<string, { rel: string; regen: string }>();
  for (const e of edits) {
    const regen = e.owner === null ? `loam gherkin --service ${suite.service}` : `loam gherkin ${e.owner}`;
    for (const d of e.digests) editedAt.set(d, { rel: e.rel, regen });
  }
  const digestOf = new Map(claims.map((c) => [c.id, c.digest]));
  return answers.map((a) => {
    const digest = digestOf.get(a.id);
    const edit = digest === undefined ? undefined : editedAt.get(digest);
    if (a.verdict !== "confirmed" || digest === undefined || edit === undefined) return a;
    return {
      id: a.id,
      verdict: "unconfirmed",
      evidence: [],
      note:
        `${scenarioDigestTag(digest)} in ${edit.rel} was edited by hand — the run tested the edited words, not the spec's. ` +
        `\`${edit.regen}\` restores them; run the suite again and record from that report`,
      answered_by: a.answered_by,
    };
  });
}
