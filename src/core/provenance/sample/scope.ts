/**
 * What a SAMPLED vouch claims, how its sample is chosen, and how the claim is
 * written into the document beside `vouched_by`.
 *
 * `loam vouch --sample <n>` exists because the alternative to a partial read
 * is usually not a full read — it is no vouch at all, and a fleet of
 * unvouched drafts. So this deliberately REDUCES the assurance a stamp
 * carries, and every line here exists to make sure the reduction is visible:
 * the scope rides beside `status: verified` (never as a new status — that
 * string is frozen), it says k of n in the document itself, and it carries
 * the seed so anyone can recompute exactly which sections the person was
 * shown. A sampled vouch that could be mistaken for a full one would be worse
 * than no vouch, because it would spend the one signal loam has.
 *
 * The seed is derived from the document's OWN content and the digest of its
 * sources — never from the clock, a counter or a random number — for three
 * reasons, in order of how much they matter:
 *
 *  1. **Anyone can audit it.** The stamp records the seed, k and n; the
 *     document records `content_digest` and `sources_digest`. A reviewer
 *     recomputes `sampleSeed` from those three values and `pickSample` over
 *     the body, and gets back the exact list the voucher was shown.
 *  2. **The pick cannot be re-rolled in place.** A random seed would let an
 *     agent run the vouch — or `--pack --sample` — until the section it wrote
 *     carelessly fell outside the sample, leaving no trace anywhere. Content
 *     derivation makes every re-roll an EDIT to the document: recorded in the
 *     docs repo's history, and moving `content_digest` under any stamp
 *     already standing over it.
 *  3. **The same recipe answers before and after.** The pre-vouch reading
 *     list, the prompt and `loam vouch --pack --sample` all call `planSample`
 *     with the digests the stamp is about to carry, so the pack cannot
 *     prescribe one sample while the stamp records another.
 *
 * Reproducibility rests on one property of the writer:
 * `withFrontmatterFields` leaves the body byte-identical, and `contentDigest`
 * hashes only the body — so `contentDigest(raw)` computed BEFORE the stamp
 * equals the `content_digest` the stamp writes. That is what lets the sample
 * be chosen (and shown to a person) before the value it is keyed to exists on
 * disk.
 *
 * What this does NOT do — and the difference is worth stating plainly, since
 * an overstated claim is worse than none — is make the sample UNPREDICTABLE.
 * The recipe is published (SCHEMA.md), so anybody holding the document can
 * compute the pick before anybody vouches: that IS reason 1, and the two
 * properties are in direct tension. An agent that wants a particular section
 * left out of the read can append a space and recompute until it is, at the
 * cost of one cosmetic edit per attempt in a version-controlled file,
 * immediately before asking a person to vouch. Auditability was chosen over
 * unpredictability deliberately — hiding the recipe needs a secret loam has
 * nowhere to keep, and a sample nobody can check is not evidence of anything.
 * What the design buys is that steering is neither free nor invisible: the
 * same bargain `sources_digest` strikes, which is a change detector and not a
 * seal.
 *
 * It also does not weight the sample. See `pickSample`.
 */
import { createHash } from "node:crypto";
import { stringField, type Frontmatter } from "../../document/frontmatter.js";
import { splitSections, type DocSection } from "./sections.js";

/**
 * Hex characters kept from a sha256 — `provenance/stamp.ts`'s DIGEST_LENGTH,
 * respelled rather than imported because this is a seed and not a digest: the
 * two would be free to diverge, and importing would tie a sampling decision to
 * a change-detection budget. 64 bits is not a seal here either; an adversary
 * who wants a collision can have one, and the audit trail is the git history
 * of the docs repo, not this number.
 */
const SEED_LENGTH = 16;

/** What a sampled vouch stamped: how many sections of how many, and the seed that chose them. */
export interface VouchScope {
  /** k — how many sections the person was shown and asked to read. */
  sections: number;
  /** n — how many the file had when they read it. Always greater than `sections`. */
  of: number;
  /** The seed, `SEED_LENGTH` lowercase hex characters. */
  seed: string;
}

/**
 * The seed for one spec-axis FILE: `sha256(service \0 content_digest \0
 * sources_digest)`, first 16 hex characters.
 *
 * Per file, not per service, because the two inputs are per-file stamps —
 * spec.md and arch.spec.md carry their own digests, so one `--sample 3` run
 * picks three sections of each from two different seeds. The service id is in
 * the hash so two services whose specs happen to be byte-identical (a
 * scaffold, a copy) do not get the same reading list.
 *
 * NUL separators, `sourcesDigest`'s own recipe: without them
 * `("ab", "c")` and `("a", "bc")` hash alike, and a service id may contain
 * dots and dashes.
 */
export function sampleSeed(service: string, contentDigest: string, sourcesDigest: string): string {
  return createHash("sha256")
    .update(`${service}\0${contentDigest}\0${sourcesDigest}`)
    .digest("hex")
    .slice(0, SEED_LENGTH);
}

/**
 * Pick `n` sections deterministically from `sections`, returned in DOCUMENT
 * order.
 *
 * Rank each section by `sha256(seed \0 index \0 heading)` and take the `n`
 * lowest ranks. Hash-ranking rather than a seeded PRNG: there is no PRNG in
 * the standard library, adding a dependency for one is a product decision this
 * repo has already made against, and a hash rank is recomputable one section
 * at a time by anybody with a shell. The index is in the rank so two sections
 * with identical heading text (a document with two `## Notes`) still rank
 * apart, and the index tiebreak below keeps the sort total.
 *
 * Document order on the way out, not rank order: the person is going to read
 * the file top to bottom, and a list that jumps around is a list they lose
 * their place in.
 *
 * **Uniform — the sample is NOT weighted by fan-in**, and that is a decision
 * rather than an omission. `core/dependencies/fanin.ts` counts how many
 * services depend on a SERVICE; nothing in loam says which consumer depends on
 * which SECTION, and the join that would (section -> `Operations:`/`Publishes:`
 * -> landscape edge -> caller) has three defects at this stakes. It is
 * derivable only for `### Requirement:` sections that carry those lines, so
 * every narrative section — `## Overview`, `## Interfaces`, the prose most
 * likely to be quietly false — would weight to zero and effectively stop being
 * sampled. It needs the fleet map and every sibling's contract, so a vouch in
 * a service repo would depend on documents it cannot see, and an unparseable
 * landscape would silently flatten the weights back to uniform without saying
 * so. And decisively: those inputs are documents an agent can edit, and they
 * are not covered by either digest in the seed — so weighting would hand back
 * exactly the steering that content-derived seeding exists to take away. The
 * parameter list has room for weights if a later version can answer those;
 * v1's answer is that an unweighted sample nobody can aim is worth more than a
 * weighted one somebody can.
 */
export function pickSample(sections: readonly DocSection[], n: number, seed: string): DocSection[] {
  return sections
    .map((section, index) => ({
      index,
      section,
      rank: createHash("sha256").update(`${seed}\0${index}\0${section.heading}`).digest("hex"),
    }))
    // Rank first, index second: sha256 makes a tie astronomically unlikely,
    // but "unlikely" is not "total", and an unstable sort over equal ranks
    // would make the pick depend on the engine's sort implementation — which
    // is exactly the reproducibility this whole module promises.
    .sort((a, b) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : a.index - b.index))
    .slice(0, n)
    .sort((a, b) => a.index - b.index)
    .map((ranked) => ranked.section);
}

/** One file's sampling inputs — the two digests its stamp will carry, its body, and k. */
export interface SampleInputs {
  service: string;
  /** As `content_digest` will read — `contentDigest(raw)`, which the stamp preserves. */
  contentDigest: string;
  /** As `sources_digest` will read. */
  sourcesDigest: string;
  /** The document BODY, below the frontmatter (`rawBody`). */
  body: string;
  /** How many sections to read — `--sample <n>`, a whole number of at least 1. */
  n: number;
}

/** What a sample comes to for one file: the seed, how many sections there were, and which were picked. */
export interface PlannedSample {
  seed: string;
  /** n — every section the body has. `picked` is all of them when `of <= n`. */
  of: number;
  picked: DocSection[];
}

/**
 * The whole per-file derivation in one call, so that the reading list, the
 * prompt, `--pack --sample` and the stamp cannot drift into prescribing
 * different samples of the same file. Every caller goes through here.
 *
 * A file with `of <= n` comes back with every section picked: the sample
 * covers the document, so the run is an ordinary full vouch and stamps no
 * scope at all. That case is decided by comparing `picked.length` with `of`,
 * one derivation rather than a boolean somebody has to keep true.
 */
export function planSample(req: SampleInputs): PlannedSample {
  const sections = splitSections(req.body);
  const seed = sampleSeed(req.service, req.contentDigest, req.sourcesDigest);
  return { seed, of: sections.length, picked: pickSample(sections, req.n, seed) };
}

/**
 * The `vouch_scope` value: `sampled 4/17 seed=1a2b3c4d5e6f7089`.
 *
 * One flat string rather than a nested YAML mapping, following the
 * `sources_files` precedent: `withFrontmatterFields` takes string values and
 * promises a byte-identical body, and a mapping value would put the writer in
 * the business of composing YAML structure inside somebody's header. It also
 * reads: a reviewer scanning a diff sees the whole claim on one line.
 */
export function encodeVouchScope(scope: VouchScope): string {
  return `sampled ${scope.sections}/${scope.of} seed=${scope.seed}`;
}

/** Exactly what `encodeVouchScope` writes, and nothing else. */
const SCOPE_RE = new RegExp(String.raw`^sampled (\d+)\/(\d+) seed=([0-9a-f]{${SEED_LENGTH}})$`);

/**
 * Read a stamped `vouch_scope` back, or null when it is not one this loam
 * wrote.
 *
 * Null means "cannot be read", NEVER "is not sampled" — the two are different
 * facts and every caller must keep them apart, which is what `isSampled`
 * below is for. A verified document carrying an unreadable scope is graded as
 * SAMPLED by `sources.sampled-vouch`, `loam list` and `loam show`: fail
 * closed, because the alternative is that mangling one field promotes a
 * partial read to a full one.
 */
export function decodeVouchScope(stamped: string | undefined): VouchScope | null {
  if (stamped === undefined) return null;
  const m = SCOPE_RE.exec(stamped.trim());
  if (m === null) return null;
  const scope = { sections: Number(m[1]!), of: Number(m[2]!), seed: m[3]! };
  // A claim that reads as covering everything is not a sample, and neither is
  // one that read nothing: both are shapes this writer never produces, so
  // treating them as decodable would let a hand-edited `sampled 17/17` grade
  // as a legible partial claim instead of an unreadable one.
  return scope.sections >= 1 && scope.sections < scope.of ? scope : null;
}

/**
 * What a document's `vouch_scope` says, as the ONE question every reader that
 * reports trust must ask.
 *
 * It takes the whole frontmatter rather than a field value because the test
 * that matters is KEY PRESENCE, and no field accessor can express it: a scope
 * written as a YAML mapping or sequence — a hand edit, a merge tool, an agent
 * "tidying" the header into something more legible — reads back from
 * `stringField` as `undefined`, exactly like an absent field, and grading that
 * as a FULL vouch is the promotion this vocabulary exists to prevent. Asking
 * it here, once, is what stops that hole being reopened one reader at a time:
 *
 * - `none` — the key is not there. The only reading that means a full vouch.
 * - `sampled` — a value this loam wrote, with the k/n and seed decoded.
 * - `unreadable` — the key is there and says something else. Graded sampled
 *   by every caller, with `text` for display (null when the value is not even
 *   a scalar, so there is nothing to quote).
 *
 * One hole remains and is not closable here: `vouch_scope:` with no value at
 * all is a key whose value is YAML null, which reads as PRESENT — and simply
 * deleting the line reads as absent, like every other hand-removed stamp. The
 * answer to that is the docs repo's git history, not this parser.
 */
export type ScopeStamp =
  | { kind: "none" }
  | { kind: "sampled"; scope: VouchScope; text: string }
  | { kind: "unreadable"; text: string | null };

export function readVouchScope(fm: Frontmatter): ScopeStamp {
  if (!Object.hasOwn(fm.data, "vouch_scope")) return { kind: "none" };
  const text = stringField(fm, "vouch_scope");
  if (text === undefined) return { kind: "unreadable", text: null };
  const scope = decodeVouchScope(text);
  return scope === null ? { kind: "unreadable", text } : { kind: "sampled", scope, text };
}

/**
 * The scope as a surface shows it: the stamped text, or — for a value that is
 * not even text — one fixed sentence, because what a reader must not be shown
 * for a present scope is nothing at all. Null means the key is absent, which
 * is the only state that reads as a full vouch.
 *
 * One spelling of the unreadable case, because `loam show` and the context
 * pack have to say the same thing about the same document.
 */
export function scopeText(fm: Frontmatter): string | null {
  const stamp = readVouchScope(fm);
  if (stamp.kind === "none") return null;
  if (stamp.kind === "sampled") return stamp.text;
  return stamp.text ?? "present, but its value is not text — graded sampled";
}

/**
 * Which sections a recorded scope actually covered, recomputed from its own
 * seed over the body it was taken over.
 *
 * This is the audit property in code: hand it the stamped scope and the body
 * that was vouched, get back the list the voucher was shown. The re-vouch
 * pack uses it to say which sections a previous sampled vouch READ, so the
 * ones it did not can be named as never-read rather than quietly counted as
 * covered.
 *
 * Null when the body no longer has the section count the scope names — the
 * body has changed, so the pick cannot be reproduced and no claim about what
 * was read is safe. Fail closed: an unreproducible sample licenses nothing.
 */
export function sampledSections(body: string, scope: VouchScope): DocSection[] | null {
  const sections = splitSections(body);
  if (sections.length !== scope.of) return null;
  return pickSample(sections, scope.sections, scope.seed);
}
