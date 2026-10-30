/**
 * The document terms: the words for how loam reads a docs repo at rest — a
 * feature's change and the pin tying it to what it changes, the joins between
 * the three languages a service is described in, the agreement `loam archive`
 * is gated on, and the two dials of how far a service's documentation has got
 * (`loam vouch`, and the maturity ladder `loam list` and the fleet scorecard
 * print). The first five are the oldest entries in the registry and carry
 * their re-pairing history in the comments beside their pins.
 *
 * The second group below, `DRAWING_TERMS`, is the words for drawing the map
 * and writing a feature a person can follow. It is the vocabulary of the
 * `loam-drawing` page and of `loam-authoring`'s "Writing for a person". It
 * lives in this module rather than one of its own because ./ is at the
 * five-file cap, and because those words are about the same documents: a
 * relationship kind is part of landscape.likec4, and a `## Purpose` is part of
 * a spec delta.
 */
import type { TermGroup } from "./entry.js";

export const DOCUMENT_TERMS: TermGroup = {
  heading: "the documents — what loam reads and grades",
  terms: [
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
        // Both used to pin the long layout opening, which stopped shipping when
        // AGENTS.md was condensed; ORIENTATION's "What is where" teaches the same
        // two facts in its own words. Re-paired on the clauses the two texts
        // already share rather than by rewording either side, so `loam explain
        // delta` prints exactly what it printed before.
        { source: "AGENTS_MD", phrase: "the complete current state" },
        { source: "AGENTS_MD", phrase: "reviewed as a diff" },
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
        { source: "SPINE_PAGE", phrase: "MODIFIED requirement carries its FULL new text, not a diff" },
        { source: "SPINE_PAGE", phrase: `**Restamping is not resolving.** A pin claims "I read this version".` },
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
        { source: "SPINE_PAGE", phrase: "The spine is a family of exact joins, not one magic id" },
        { source: "SPINE_PAGE", phrase: "Spell it identically in all three places." },
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
        { source: "SPINE_PAGE", phrase: "architecture — a C4 edge names the operation it calls" },
        { source: "SPINE_PAGE", phrase: "behaviour — a requirement declares the operations it governs" },
        { source: "SPINE_PAGE", phrase: "contract — the provider's `openapi.yaml` defines it" },
      ],
    },
    {
      // The `coherence` row of `loam status <FEAT>` and the `coherence:` line of
      // `loam validate --feature` both print the word bare, and the row's last
      // count — "N stop it" — is the one a newcomer reads as a severity.
      // Gating and severity are two questions; this entry exists to say so in
      // the place the row sends a reader.
      term: "coherence",
      aliases: ["coherent", "gates", "gating"],
      paragraph:
        "Coherence is whether a feature's documents agree with each other and with the fleet in flight. " +
        "The C4 delta, the requirement deltas and the contracts are joined exactly, as the spine spells them. " +
        "`loam validate --feature <FEAT>` grades it — a change's three axes against each other — and prints " +
        "`coherence: ✓ C4 · requirements · OpenAPI agree` when every join holds. " +
        "`loam status <FEAT>` prints a `coherence` row counting what it graded on the feature — the union of what " +
        "`loam validate --feature` and `loam archive` refuse — as errors, warnings, and how many stop it: the " +
        "findings `loam validate --feature` or `loam archive` refuses on right now. " +
        "Gating is not severity: archive is gated on coherence, so a finding carrying `gates: true` " +
        "will stop `loam archive` even when it is a warning (`delta.requirement-not-merged` warns but gates). " +
        "`--approve` overrides only the gating findings that are judgement calls, never a mechanical loss. " +
        "Note what it does not read: coherence is something loam computed from the documents, and whether the code " +
        "exists is the done-check's question (`loam explain claim`).",
      pins: [
        { source: "CHECK", phrase: "a change's three axes against each other" },
        { source: "CHECK", phrase: "will stop `loam archive` even when it is a warning" },
        { source: "AGENTS_MD", phrase: "archive is gated on coherence" },
        { source: "DONE_CHECK", phrase: "coherence is something loam computed from the documents" },
      ],
    },
    {
      term: "vouch",
      aliases: ["vouched", "vouching"],
      paragraph:
        "A vouch is the human promotion of a living document from draft to verified. " +
        "Promoting draft to verified is their call, not yours: a person runs `loam vouch --service <id>` in the service's own repo, " +
        "and the stamp records the date, who vouched (from git), and digests of both the source files and the document body — " +
        "which is what lets a later `loam validate` report `sources.stale` and `content.stale` when the code or the words move. " +
        "**`loam vouch` is not yours to run**, and it is built so that it cannot be. It refuses unattended runs (`vouch-unattended`), " +
        "records a no as `vouch-declined`, and refuses to stamp when git can name nobody (`vouch-unattributable`). " +
        "`--yes` skips the question for a person's own scripted run, and the stamp carries no mark that it did, " +
        "so typing it on someone's behalf is writing their name. " +
        "When your work leaves a document ready, hand back and say a vouch is owed.",
      pins: [
        // Both phrases left AGENTS.md with the frontmatter teaching and are now
        // in `loam instructions loam-authoring`. Repaired by following the text,
        // not by rewording the paragraph to something still in the file: the
        // pairing exists so this paragraph and the teaching cannot drift, and
        // re-pinning to a different sentence would have quietly ended it.
        { source: "AUTHORING", phrase: "Promoting draft to verified is their call, not yours" },
        { source: "AUTHORING", phrase: "**`loam vouch` is not yours to run**, and it is built so that it cannot be." },
      ],
    },
    {
      // The ladder is defined in core/vocabulary/maturity.ts, a doc comment no
      // reader of the binary sees, and `loam list` and the `--all` scorecard
      // print its five words as bare counts ("0 empty · 0 partial · …"). The
      // pins are the two places a shipped page USES a rung, which is as close
      // as the shipped text comes to defining one — the definitions below are
      // that module's, restated.
      term: "maturity",
      aliases: ["rung", "rungs", "empty", "partial", "documented", "sourced"],
      paragraph:
        "Maturity is how far a service's documentation has got: empty, partial, documented, sourced or vouched. " +
        "Those are the five rungs of one ladder, in order. " +
        "`loam list` prints each service's rung and a `maturity:` rollup, and `loam validate --all` prints the same five " +
        "counts on its fleet scorecard's `services` line. " +
        "`empty`: `services/<id>/` exists and nothing is in it. `partial`: some documents, but not the required set — " +
        "model.likec4 and spec.md, plus openapi.yaml unless the fleet map proves nothing calls the service. " +
        "`documented`: the required set is present. `sourced`: the living spec declares `sources`, so something ties it to code. " +
        "`vouched`: a person stamped it with `loam vouch` — `status: verified` with a sources digest behind it — and " +
        "the maturity rung stays `vouched` when the person read only a sample, which the text views mark `vouched (sampled)`. " +
        "Each rung stands on every rung below it, and the ladder reads presence and provenance only, never completeness: " +
        "a service with one endpoint documented out of thirty climbs it as fast as a thorough one. It matters before a " +
        "feature: a service at `empty` or `partial` has no baseline to write a delta against, so the work starts with " +
        "`loam adopt --service <id>`.",
      pins: [
        { source: "FEATURE", phrase: "a service at `empty` or `partial` has no baseline to" },
        { source: "AUTHORING", phrase: "the maturity rung stays `vouched`" },
      ],
    },
  ],
};

export const DRAWING_TERMS: TermGroup = {
  heading: "the picture — drawing the map and writing for a person",
  terms: [
    {
      // The kind names are aliases because they are what an agent meets on an
      // edge (`-[delivers]->`) and asks about; `readsWrites` is lowercased, as
      // every alias is, because the lookup lowercases the subject first.
      term: "kind",
      aliases: [
        "kinds",
        "relationship-kind",
        "arrow",
        "direction",
        "publishes",
        "delivers",
        "reads",
        "writes",
        "readswrites",
        "calls",
        "connects",
      ],
      paragraph:
        "A relationship kind says what an edge carries, and so which way its arrow points. " +
        "`publishes` runs from a producer to a topic and `delivers` from the topic to a consumer, beside the " +
        "`metadata { publishes }` and `metadata { consumes }` the event spine joins on; `calls` is a synchronous request, " +
        "beside `metadata { op }`; `reads`, `writes` and `readsWrites` are a service's use of a store, and a store edge is ALWAYS written " +
        "service `->` store, with the arrowhead put where the data lands by the kind's style; `connects` is a " +
        "connection whose direction nobody has established, drawn gray and dashed with no arrowhead. " +
        "**Never guess a direction.** Give an edge a direction only from evidence: the code, a configuration name " +
        "that says which side a service is on, or its own asyncapi.yaml. Configuration that only lists an address is " +
        "`connects`, and adopting the service from its code resolves it. The kinds are declared once in " +
        "architecture/landscape.likec4's `specification` block, and again in a feature delta that draws one, and the " +
        "living map must declare a kind before a feature using it archives. No check reads a kind: it is the picture, and " +
        "the metadata is the join. `loam instructions loam-drawing` has the styles.",
      pins: [
        { source: "DRAWING", phrase: "**Never guess a direction.** Give an edge a direction only from evidence:" },
        { source: "DRAWING", phrase: "a store edge is ALWAYS written" },
      ],
    },
    {
      term: "legend",
      aliases: ["legend-view"],
      paragraph:
        "A legend is a view in architecture/landscape.likec4 that draws ONE real " +
        "edge of each kind the map uses, so a reader learns the colours from the fleet itself. It names real services, " +
        "a real topic and a real store, each edge by both of its endpoints, and it gains a line when the map gains a " +
        "kind. A view can name only elements the model declares, so `loam init` cannot scaffold one: the legend is " +
        "written once the map has real edges of each kind.",
      pins: [{ source: "DRAWING", phrase: "edge of each kind the map uses" }],
    },
    {
      term: "overview",
      aliases: ["overviews", "overview-view", "altitude"],
      paragraph:
        "An overview is a view a person reads to answer one question about the fleet. " +
        "**One question per view, at one altitude.** A fleet overview draws subsystem boxes, not services, at most " +
        "about 20 nodes and 25 drawn lines, and the generated subsystem and service views are its drill-down. Above " +
        "service altitude LikeC4 merges every relationship between two boxes into one line, and a line merged from " +
        "different kinds is drawn in the default gray, so filter by one kind: " +
        "`where kind is publishes` keeps the line amber, while a `kind is not` or an `or` filter still merges. " +
        "Never author a `view … of` a subsystem or service element, which would take the drill-down from loam's " +
        "generated views. `loam instructions loam-drawing` lists the spellings that render nothing.",
      pins: [
        { source: "DRAWING", phrase: "**One question per view, at one altitude.**" },
        { source: "DRAWING", phrase: "`where kind is publishes` keeps the line amber" },
      ],
    },
    {
      term: "purpose",
      aliases: ["narrative"],
      paragraph:
        "A `## Purpose` section is the plain-language narrative of a spec delta: what the service does in the change, " +
        "for someone who has never opened its code. " +
        "Each spec delta opens with a plain-language `## Purpose`. Where the delta creates the living document — a " +
        "new service's spec.md, a first arch.spec.md, a new capability — `loam archive` copies the section in as that " +
        "document's narrative, beside the delta's title and frontmatter owner. Where the living document already exists, the " +
        "section stays with the archived delta, and the archive plan says so; edit the living narrative directly when " +
        "it should change. Nothing grades a purpose; `loam instructions loam-authoring`, \"Writing for a person\", has the shape.",
      pins: [
        { source: "AUTHORING", phrase: "Each spec delta opens with a plain-language `## Purpose`" },
        { source: "AUTHORING", phrase: "section stays with the archived delta" },
      ],
    },
  ],
};
