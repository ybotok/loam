/**
 * The reading pack's section-level derivations: pure text in, lists of
 * headings out. Three of them, and the last two are why a sampled vouch does
 * not quietly weaken this command —
 *
 *  - `sectionDelta`, the heading summary printed beside the raw git diff and
 *    the source of the "already covered" list;
 *  - `forwardSample`, what the next `--sample <n>` vouch will read;
 *  - `priorScope`, what the last sampled vouch actually did read, so the
 *    covered list cannot count sections nobody opened.
 *
 * It lives in the vouch command package rather than `core/document` because
 * that package sits at its five-file limit and this command package already
 * holds vouch's non-printing logic (`../vet/verify.ts` precedent); the one
 * structural question — what is an H2 heading — is still answered by
 * `core/document/parse.ts`'s `sectionHeadings`, fence- and BOM-aware, so this
 * module can never disagree with the rest of loam about whether a `## ` line
 * inside a code fence is structure.
 */
import { rawBody, type Frontmatter } from "../../../core/document/frontmatter.js";
import { sectionHeadings } from "../../../core/document/parse.js";
import { splitSections } from "../../../core/provenance/sample/sections.js";
import { planSample, readVouchScope, sampledSections, scopeText, type VouchScope } from "../../../core/provenance/sample/scope.js";
import { contentDigest } from "../../../core/provenance/stamp.js";

/** How the delta names the text above the first H2 — a section with no heading to call it by. */
const PREAMBLE_LABEL = "(before the first heading)";

/** The four verdicts, each a list of H2 heading lines as the document spells them. */
export interface SectionDelta {
  /** Present in both bodies with different text — in the new body's order. */
  changed: string[];
  /** Present only in the new body, in its order. */
  added: string[];
  /** Present only in the old body, in its order. */
  removed: string[];
  /** Present in both with identical text — the "already covered" list. */
  unchanged: string[];
}

/**
 * CRLF/CR to LF, the `core/verify/pins/pin.ts` recipe: the old body comes out
 * of a git blob (LF) while the new one comes off a checkout that may be CRLF,
 * and a comparison that let the line endings vote would report every section
 * changed on exactly the machines whose config differs from the repo's.
 * A pure line-ending change is invisible here — the same cost the pins
 * accept, and for a reading list it is the right one: there is nothing to
 * re-read in a CR.
 */
function normalized(text: string): string {
  return text.replace(/\r\n|\r/g, "\n");
}

/**
 * One body as heading -> section text. The heading LINE is the key and is not
 * part of the value, so a section whose only change is its own heading reads
 * as removed+added — which is what a reader must do about it: find it under
 * its new name. A duplicated heading concatenates its sections under the one
 * key rather than letting the last occurrence shadow the rest: the compare
 * then sees all of the text, so an edit under either twin still reads as
 * changed. Text before the first heading files under PREAMBLE_LABEL when any
 * of it is more than whitespace.
 */
function sectionMap(body: string): Map<string, string> {
  const text = normalized(body);
  const lines = text.split("\n");
  const headings = sectionHeadings(text);
  const map = new Map<string, string>();
  const file = (key: string, segment: string): void => {
    map.set(key, map.has(key) ? `${map.get(key)}\n${segment}` : segment);
  };
  const firstHeadingLine = headings[0]?.line ?? lines.length + 1;
  const preamble = lines.slice(0, firstHeadingLine - 1).join("\n");
  if (preamble.trim() !== "") map.set(PREAMBLE_LABEL, preamble);
  headings.forEach((heading, i) => {
    const end = headings[i + 1]?.line ?? lines.length + 1;
    file(heading.text, lines.slice(heading.line, end - 1).join("\n"));
  });
  return map;
}

/** The forward-looking sample: what a `--sample <n>` vouch of this file would cover. */
export interface PackSample {
  /** The seed the stamp will carry, derivable now because the body it hashes will not change. */
  seed: string;
  /** Every section the body has. */
  of: number;
  /** The sections to read, in document order. Headings only — the pack does not renumber lines. */
  headings: string[];
  /** True when `<n>` reached every section: the read is the whole file, and no scope is stamped. */
  covers: boolean;
}

/**
 * What `loam vouch --sample <n>` would read of this file — computed through
 * the same `planSample` the stamp uses, so a pack and the vouch that follows
 * it cannot prescribe different samples of one document. Both digests are the
 * ones the stamp will carry: `contentDigest` survives stamping because the
 * body does, and the sources digest is the vetting's own.
 */
export function forwardSample(doc: {
  service: string;
  /** The file as read, frontmatter included — the same string the stamp is applied to. */
  raw: string;
  sourcesDigest: string;
  n: number;
}): PackSample {
  const planned = planSample({
    service: doc.service,
    contentDigest: contentDigest(doc.raw),
    sourcesDigest: doc.sourcesDigest,
    body: rawBody(doc.raw),
    n: doc.n,
  });
  return {
    seed: planned.seed,
    of: planned.of,
    headings: planned.picked.map((section) => section.heading),
    covers: planned.picked.length >= planned.of,
  };
}

/**
 * What the LAST vouch actually covered, when it was a sampled one.
 *
 * This is the pack's answer to the one way sampling could quietly undo the
 * whole point of it: the "already covered" list licenses a person to NOT
 * re-read a section, on the strength of somebody having read it before. After
 * a sampled vouch that strength is not there — most of those sections were
 * never read by anyone — so the licence has to be withdrawn, and withdrawn
 * with the detail that makes it actionable rather than as a blanket warning.
 *
 * The detail is recomputable because the stamp records the seed: run the same
 * pick over the body that vouch was taken over and you get back the exact
 * list that person was shown. `read` is that list; `unread` is every other
 * section of that body — text that has now survived a vouch without anybody
 * looking at it, which is precisely what a re-voucher most needs to know.
 *
 * Three things come back null-but-still-sampled, and all three fail the same
 * way, closed: a scope that does not decode (mangled by hand), no vouched
 * body to recompute over (the document has changed since the stamp, so the
 * pick cannot be reproduced), and a body whose section count no longer
 * matches what the scope claims. In each case the pack reports the scope and
 * refuses to name a covered set — never the reverse.
 */
export interface PackVouchScope {
  /** The `vouch_scope` value as a reader is shown it — verbatim where it is text at all. */
  stamped: string;
  /** Decoded, or null when the field is not one this loam wrote. */
  scope: VouchScope | null;
  /** The headings that vouch read, in document order — null when they cannot be recomputed. */
  read: string[] | null;
  /** The headings it did not read: present at that stamp, and never read by anyone. */
  unread: string[] | null;
}

export function priorScope(fm: Frontmatter, vouchedBody: string | null): PackVouchScope | null {
  // One reader, `readVouchScope`, decides what "sampled" means — so the pack
  // cannot be the surface that quietly grades a mangled scope as a full vouch
  // while `loam validate` grades it sampled.
  const stamp = readVouchScope(fm);
  if (stamp.kind === "none") return null;
  const stamped = scopeText(fm) ?? "";
  const scope = stamp.kind === "sampled" ? stamp.scope : null;
  const blind: PackVouchScope = { stamped, scope, read: null, unread: null };
  if (scope === null || vouchedBody === null) return blind;
  const picked = sampledSections(vouchedBody, scope);
  if (picked === null) return blind;
  // Partitioned by LINE, not by heading text: a body with two `## Notes`
  // sections has two units, and matching on the text would report both as
  // read when one was picked — turning a section nobody opened into a covered
  // one, which is the exact misreading this function exists to prevent.
  const read = new Set(picked.map((section) => section.line));
  return {
    stamped,
    scope,
    read: picked.map((section) => section.heading),
    unread: splitSections(vouchedBody)
      .filter((section) => !read.has(section.line))
      .map((section) => section.heading),
  };
}

/**
 * Compare two bodies section by section. Exact text per heading after line
 * endings are normalized — no reflow tolerance, because "unchanged" here
 * licenses a person to NOT re-read a section, and the only claim safe to make
 * at that stakes is byte equality.
 */
export function sectionDelta(oldBody: string, newBody: string): SectionDelta {
  const before = sectionMap(oldBody);
  const after = sectionMap(newBody);
  const changed: string[] = [];
  const added: string[] = [];
  const unchanged: string[] = [];
  for (const [heading, text] of after) {
    const prior = before.get(heading);
    if (prior === undefined) added.push(heading);
    else if (prior === text) unchanged.push(heading);
    else changed.push(heading);
  }
  const removed = [...before.keys()].filter((heading) => !after.has(heading));
  return { changed, added, removed, unchanged };
}
