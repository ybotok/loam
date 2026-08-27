/**
 * A spec body cut into the units a sampled vouch reads.
 *
 * The unit is a heading and the contiguous text under it, at H2 *and* H3, cut
 * at the next heading of either level — leaf blocks, no overlap. H3 counts
 * because of what a living spec actually looks like: `## Requirements` holds
 * every `### Requirement:` in the document, so an H2-only cut offers a sample
 * of four or five units, one of which is most of the file. "Read two of these
 * nine" is only an honest reduction if the units are the size of a thing a
 * person reads.
 *
 * The fence rule is `core/document/parse.ts`'s own `fenceTracker`, imported
 * rather than restated: a `## ` line inside a code block is prose about a
 * heading, not structure, and a sampler that disagreed with `sectionHeadings`
 * about that would prescribe sections no reader can find. On the H2 subset
 * this walk returns exactly what `sectionHeadings` returns — same test, same
 * `line.trim()` spelling, same 1-based line — and test/vouch-sample.test.ts
 * pins that agreement, because the reading list and the re-vouch pack's
 * "already covered" list name headings to the same person.
 *
 * No BOM strip here: every caller hands in `rawBody(raw)`, which already drops
 * a BOM above the frontmatter, and stripping again at position 0 of a *body*
 * would eat an author's zero-width no-break space.
 */
import { fenceTracker } from "../../document/parse.js";

/** One sampling unit: the heading that names it, and where it starts. */
export interface DocSection {
  /** The heading line as the document spells it, trimmed — `sectionHeadings`' spelling. */
  heading: string;
  level: 2 | 3;
  /** 1-based, counted within the BODY that was passed — not the file. */
  line: number;
}

/**
 * Two or three `#` followed by whitespace. `####` and deeper cannot match at
 * all — `#{2,3}` has nowhere to leave a space before the fourth `#` — which is
 * how a `#### Scenario:` stays interior to the requirement it belongs to
 * rather than becoming a unit of its own. `sectionHeadings` spells the H2 half
 * of this as `/^##\s+/` plus a `###` exclusion; both accept the same lines,
 * and the exclusion is why THIS pattern cannot be written that way: `^##\s+`
 * never matches `### ` at all, because the character after `##` is a `#`.
 * Getting that wrong is not a compile error, it is a splitter that silently
 * drops every requirement in the document.
 */
const HEADING_RE = /^(#{2,3})\s+/;

/**
 * Every H2 and H3 heading outside a fenced block, in document order.
 *
 * The text above the first heading is deliberately not a unit: it has no
 * heading to name it in a reading list, and it is short. The reading list
 * says "read the preamble" outside the k/n count instead, so a sample is
 * never the reason nobody read the opening paragraph.
 */
export function splitSections(body: string): DocSection[] {
  const fenced = fenceTracker();
  const out: DocSection[] = [];
  body.split(/\r?\n/).forEach((line, i) => {
    if (fenced(line)) return;
    const m = HEADING_RE.exec(line);
    if (m === null) return;
    out.push({ heading: line.trim(), level: m[1]!.length === 3 ? 3 : 2, line: i + 1 });
  });
  return out;
}
