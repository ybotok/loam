/**
 * The concept terms `loam explain` answers — the vocabulary wall an agent hits
 * in its first minute, before any docs repo exists to read.
 *
 * Each paragraph is authored HERE, but it is not free to drift: every entry
 * carries pin phrases lifted VERBATIM from the agents-md section that teaches
 * the concept, and test/explain.test.ts asserts each phrase appears both in
 * the paragraph and in its named source constant. Rewording the AGENTS.md
 * prose therefore breaks the pairing loudly — the same discipline the
 * compiler applies to refusals.ts, done with a test because prose has no type.
 * A pin phrase is kept to one source LINE, because the sections wrap at ~80
 * columns and a phrase spanning a wrap would never match.
 */
import { ARTIFACTS } from "../agent/agents-md/artifacts.js";
import { CYCLE } from "../agent/agents-md/cycle.js";
import { REFUSALS } from "../agent/agents-md/refusals.js";
import { SPINE } from "../agent/agents-md/spine.js";

export type PinSource = "SPINE" | "REFUSALS" | "CYCLE" | "ARTIFACTS";

/** The section constants the pins point at, for the drift test and for anyone auditing a pairing. */
export const PIN_SOURCE_TEXT: Record<PinSource, string> = {
  SPINE,
  REFUSALS,
  CYCLE,
  ARTIFACTS,
};

export interface TermPin {
  readonly source: PinSource;
  /** A verbatim single-line substring of both the paragraph and the source section. */
  readonly phrase: string;
}

export interface TermEntry {
  readonly term: string;
  readonly aliases: readonly string[];
  /** The explanation. Its FIRST sentence doubles as the no-argument listing's summary. */
  readonly paragraph: string;
  readonly pins: readonly TermPin[];
}

export const TERMS: readonly TermEntry[] = [
  {
    term: "vouch",
    aliases: ["vouched", "vouching"],
    paragraph:
      "A vouch is the human promotion of a living document from draft to verified. " +
      "Promoting draft to verified is their call, not yours: a person runs `loam vouch --service <id>` in the service's own repo, " +
      "and the stamp records the date, who vouched (from git), and digests of both the source files and the document body — " +
      "which is what lets a later `loam validate` report `sources.stale` and `content.stale` when the code or the words move. " +
      "**`loam vouch` is not yours to run**, and it is built so that it cannot be. It refuses unattended runs (`vouch-unattended`), " +
      "records a no as `vouch-declined`, and refuses to stamp when git can name nobody (`vouch-unattributable`); " +
      "when your work leaves a document ready, hand back and say a vouch is owed.",
    pins: [
      { source: "ARTIFACTS", phrase: "Promoting draft to verified is their call, not yours" },
      { source: "ARTIFACTS", phrase: "**`loam vouch` is not yours to run**, and it is built so that it cannot be." },
    ],
  },
  {
    term: "attested",
    aliases: ["attest", "attestation"],
    paragraph:
      "Attested is the verdict one rung below verified on the done-check's ladder. " +
      "Verified means somebody says the code was built and showed evidence — and for scenario claims that evidence is a " +
      "test runner's report, answered mechanically. Without a runnable suite your word can still answer them " +
      "(`loam verify <FEAT> --record` alone), but the record says who answered, and a feature whose " +
      "scenario claims rest on an agent's word is **attested**, not verified. Nothing gates on the difference; " +
      "pass `--results <report>` the moment a suite runs and the verdict moves on its own.",
    pins: [
      { source: "REFUSALS", phrase: "somebody says the code was built and showed evidence" },
      { source: "CYCLE", phrase: "scenario claims rest on an agent's word is **attested**, not verified" },
    ],
  },
  {
    term: "spine",
    aliases: [],
    paragraph:
      "The spine is a family of exact joins, not one magic id. Its ids are the feature tag (`#FEAT-101`), the service " +
      "binding (`metadata { service }`), the synchronous operationId, the asynchronous message name, `Covers:` " +
      "architecture coverage, `Requires:` permissions and `Capability:` realization. Three artifacts describe one synchronous call — " +
      "a C4 edge, a requirement's `Operations:` line, the provider's openapi.yaml — joined by the operationId, and that " +
      "join is what `loam validate` checks. Spell it identically in all three places. The `spine.*` findings are exactly " +
      "these joins failing to resolve, and a mismatch is a broken contract between services, not a style problem.",
    pins: [
      { source: "SPINE", phrase: "The spine is a family of exact joins, not one magic id" },
      { source: "SPINE", phrase: "Spell it identically in all three places." },
    ],
  },
  {
    term: "delta",
    aliases: ["deltas"],
    paragraph:
      "A delta is a feature's change, stated against the living docs rather than in them. " +
      "The living spec.md is the complete current state; a feature's copy is a diff against it, reviewed as a diff, with " +
      "requirements grouped under `## ADDED`, `## MODIFIED` or `## REMOVED Requirements`; delta.likec4 carries the " +
      "architecture change with every changed element tagged `#<FEAT>` (untagged elements are context, not changes); " +
      "and the contract deltas are complete documents whose baseline pins mark what is merely quoted. " +
      "`loam archive` folds the delta into the living state. The `delta.*` findings grade that algebra — whether the " +
      "diff still applies to the living document it claims to change.",
    pins: [
      { source: "ARTIFACTS", phrase: "is a diff against it, reviewed as a diff" },
      { source: "ARTIFACTS", phrase: "`loam archive` folds the delta into the living state." },
    ],
  },
  {
    term: "axis",
    aliases: ["axes"],
    paragraph:
      "An axis is one language a service is described in, and loam's checks are joins BETWEEN axes rather than opinions within one. " +
      "The three: architecture — a C4 edge names the operation it calls; behaviour — a requirement declares the " +
      "operations it governs; contract — the provider's `openapi.yaml` defines it (asyncapi.yaml is the same axis for " +
      "events, and arch.spec.md is the behaviour axis for architectural obligations). A finding code's prefix names the " +
      "axes that disagree — `spec-api.op-undefined` is the behaviour axis joined against the contract axis — and the fix " +
      "is whichever side is wrong about the world.",
    pins: [
      { source: "SPINE", phrase: "architecture — a C4 edge names the operation it calls" },
      { source: "SPINE", phrase: "behaviour — a requirement declares the operations it governs" },
      { source: "SPINE", phrase: "contract — the provider's `openapi.yaml` defines it" },
    ],
  },
  {
    term: "baseline",
    aliases: ["based-on", "baselines"],
    paragraph:
      "A baseline is the pin tying a delta to the living version it was written against. It rides as `Based-On:` under a " +
      "MODIFIED/REMOVED requirement and `x-loam-based-on` on a contract surface — written by `loam rebase <FEAT>`, never by " +
      "hand. It exists because a MODIFIED requirement carries its FULL new text, not a diff, so the merge REPLACES the " +
      "living text wholesale; the pin is what lets archive tell an edit from a quote and refuse a stale one " +
      "(`delta.baseline-stale`, `openapi.baseline-stale`) instead of silently reverting work that landed in between. " +
      `**Restamping is not resolving.** A pin claims "I read this version". ` +
      "Re-read the living text and fold in what you still mean before you re-pin.",
    pins: [
      // Without the sentence-initial "A": the paragraph embeds the clause
      // mid-sentence, and a pin is a verbatim substring of BOTH sides.
      { source: "SPINE", phrase: "MODIFIED requirement carries its FULL new text, not a diff" },
      { source: "SPINE", phrase: `**Restamping is not resolving.** A pin claims "I read this version".` },
    ],
  },
];
