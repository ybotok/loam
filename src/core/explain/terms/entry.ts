/**
 * What one concept term IS, apart from any term's words: the entry shape the
 * four subject modules beside this one fill in, and the names of the shipped
 * pages a pin may point at.
 *
 * A module of its own, holding only types, because of where the assembler
 * sits. `../terms.ts` imports every subject module of this package to build
 * `TERMS`, so a subject module that reached back up into it for `TermEntry`
 * would close a file-level cycle through a type — erased at runtime, but a
 * cycle every graph in the gate still has to be told to ignore. Down here the
 * graph stays a tree: the subjects import this, the assembler imports them.
 */

/**
 * The shipped texts a pin may name — each one a page `loam instructions`
 * prints, or the AGENTS.md loam writes. `../terms.ts` maps every name to its
 * bytes (`PIN_SOURCE_TEXT`), and the `Record` there makes a name added here
 * without a text a compile error rather than a pin that guards nothing.
 */
export type PinSource =
  | "AGENTS_MD"
  | "SPINE_PAGE"
  | "REFUSALS"
  | "AUTHORING"
  | "DRAWING"
  | "DONE_CHECK"
  | "CODES_PAGE"
  | "CHECK"
  | "FEATURE"
  | "IMPLEMENT"
  | "VERIFY";

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

/**
 * The terms of one subject, under the heading the bare `loam explain` listing
 * prints above them.
 *
 * The heading exists for a reader, not for the lookup: twenty-odd terms in one
 * flat column read as a glossary nobody scans, and the words a newcomer meets
 * arrive in clusters — the stages `loam status` prints, the claims and
 * verdicts of `loam verify`, the steps of `loam tasks` — so the listing is
 * grouped the way the output that printed them is. The `--json` listing stays
 * the flat `terms[]` it always was; a group is typography, never a key.
 */
export interface TermGroup {
  readonly heading: string;
  readonly terms: readonly TermEntry[];
}
