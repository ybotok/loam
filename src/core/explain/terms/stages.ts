/**
 * The stage terms: the five closed values `loam status` reports for a feature
 * and for every artifact it owes (core/status/report.ts, "The status
 * vocabulary"), and the two of them that mislead.
 *
 * `ready` and `done` are entries of their own rather than aliases of `stage`
 * because they are where a reader goes wrong, and in opposite directions.
 * `ready` reads as "built" and means only that the DOCUMENTS are right — the
 * code may not exist and no claim may be answered. `done` on an archived
 * feature reads as "verified" and means only that it was archived, which
 * checks no code and no evidence. The JSON `stage` values are a frozen
 * contract and keep their spelling; the words around them are what can be
 * fixed, and these paragraphs are where `loam explain` fixes them.
 *
 * The other three share `stage` as aliases: each one is a single clause, and
 * the pairs (missing against blocked, draft against ready) are only legible
 * read together.
 */
import type { TermGroup } from "./entry.js";

export const STAGE_TERMS: TermGroup = {
  heading: "feature stages — what `loam status` reports",
  terms: [
    {
      term: "stage",
      aliases: ["stages", "missing", "blocked", "draft"],
      paragraph:
        "A stage is where a feature, or one artifact it owes, stands — one of five closed values `loam status` reports. " +
        "In `--json` a feature carries it as `stage` and each artifact as `status`. " +
        "`missing` (owed, nothing in the way — write it now). " +
        "`blocked` (not written and not writable yet; the entry names what comes first — an artifact it derives from, " +
        "or another feature that has to archive first). " +
        "`draft` (on disk, and the shared checks report an error against it, or a warning that gates archive — what " +
        "exists is wrong, and the fix is in the documents). " +
        "`ready` and `done` have entries of their own, because they are the two that mislead. " +
        "The pairs are the point: `missing` says write it now where `blocked` says you cannot yet, and `draft` says the " +
        "document is wrong where `ready` says it is right and the world has not caught up. " +
        "A feature's stage is the worst thing it owes, graded on the union of what `loam validate --feature` and " +
        "`loam archive` refuse, so it may be more pessimistic than either and can never be greener than both; the " +
        "fleet form never says `draft`, because grading is a per-feature cost it does not pay. " +
        "Not to be confused with `status: draft` in a document's frontmatter, which says no person has vouched for it " +
        "yet (`loam explain vouch`).",
      pins: [
        { source: "CODES_PAGE", phrase: "`missing` (owed, nothing in" },
        { source: "CODES_PAGE", phrase: "`blocked` (not written and not writable yet; the entry" },
        { source: "CODES_PAGE", phrase: "`draft` (on disk, and the shared checks report an error" },
        { source: "CODES_PAGE", phrase: "so it may be more pessimistic than either and can never be greener than both" },
      ],
    },
    {
      term: "ready",
      aliases: [],
      paragraph:
        "Ready means the documents are written and pass the shared checks — it does not mean anything is built or verified. " +
        "On a feature, `ready` is every artifact on disk and clean while the done-check is not yet discharged: the " +
        "code may not exist yet, and the claims `loam verify` asks are not all answered by evidence. " +
        "As an artifact's `status`, `ready` (on disk and clean, but something outside the documents — code, a test " +
        "run, a recording — still has to answer it) is a verification record whose claims are still open. " +
        "A record that is complete but rests on an agent's word for a scenario claim — **attested** — is still " +
        "`ready`, because only a `verified` verdict makes a feature `done`. " +
        "So the next move from `ready` is never another edit to a document that is already right: it is " +
        "`loam tasks <FEAT>` for the work still open, and `loam verify <FEAT>` for what the checklist still asks. " +
        "The stage that means the document itself is wrong is `draft`.",
      pins: [
        { source: "CODES_PAGE", phrase: "`ready` (on disk and clean, but something" },
        { source: "CODES_PAGE", phrase: "outside the documents — code, a test run, a recording — still has to answer it" },
      ],
    },
    {
      term: "done",
      aliases: [],
      paragraph:
        "Done means nothing more is owed — and on an archived feature it says only that the feature was archived, not that " +
        "anybody verified it. " +
        "A feature in flight earns `done`: every artifact is clean and the done-check's verdict is `verified` (every " +
        "claim recorded confirmed, the scenario claims by a test run), so its next step is `next.archive` — a dry run " +
        "of `loam archive <FEAT>`, then the merge. " +
        "An ARCHIVED feature is `done` whatever its record says, because it is archived and for no other reason. " +
        "Archiving merges documents; it checks no code and no evidence, and it does not wait for the done-check. " +
        "**Nothing gates on it.** `loam archive` will ship an unverified feature. " +
        "The verification verdict beside the stage (`verified`, `attested`, `unverified`, or no record at all) is what " +
        "says whether it was ever verified, and the `next.archived` step `loam status` gives it says the same. " +
        "On an artifact row, `done` on a file that is not there means the feature owes no such file. " +
        "In `loam tasks`, `done` counts units that have left the packet: the unit no longer appears, and it stops " +
        "appearing only once its claim is recorded confirmed in a verification record that is not stale.",
      pins: [
        { source: "CODES_PAGE", phrase: "is `done` whatever its record says" },
        { source: "DONE_CHECK", phrase: "**Nothing gates on it.** `loam archive` will ship an unverified feature." },
        { source: "IMPLEMENT", phrase: "the unit no longer appears, and it stops appearing only once its claim is" },
      ],
    },
  ],
};
