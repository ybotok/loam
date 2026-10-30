/**
 * A generated `.feature` file read back — the stamp, the tags, the scenarios,
 * and the text of each, which is what a hand edit is graded on.
 *
 * The parser is deliberately shallow and forgiving in one direction only: a file
 * without loam's stamp is not loam's to grade, and returns null rather than a
 * partially understood suite. Anything that IS stamped is loam's output, so the
 * digests inside it are trusted to be the ones `./emit.ts` wrote — which is
 * exactly why the TEXT under each digest has to be checked against what
 * `./emit.ts` would write ({@link handEdits}): the digest names the words the
 * spec holds, and nothing about a tag stops the words under it changing.
 */
import { DIGEST_TAG_RE, STAMP_RE } from "./stamp.js";

export interface StampedScenario {
  name: string;
  digest: string;
}

/** A generated file as the staleness checks see it. */
export interface StampedFeature {
  /** The version in the stamp line — which loam wrote the file. */
  version: string;
  /** Tag tokens (without `@`) from tag lines above `Feature:`. */
  tags: string[];
  /** The `Feature:` line's text — the requirement name, by the mapping. */
  featureName: string | null;
  /** Scenarios carrying a `@loam-digest-…` tag. A hand-added scenario has none and is invisible here. */
  scenarios: StampedScenario[];
}

/** A generated file cut where each stamped scenario begins. */
export interface FeatureSegments {
  version: string;
  /** Lines 2.. up to the first stamped scenario: the file's tags, `Feature:`, its description. */
  header: string[];
  /**
   * One per stamped scenario, in file order: its tag lines, its `Scenario:`
   * line, and everything up to the next stamped scenario's tags — so a
   * scenario somebody added by hand, with no digest, lands inside the one above
   * it rather than nowhere.
   */
  scenarios: Array<StampedScenario & { lines: string[] }>;
}

const SCENARIO_RE = /^\s*Scenario(?: Outline)?:\s*(.*)$/;
const FEATURE_RE = /^\s*Feature:\s*(.*)$/;

/**
 * Parse a `.feature` file for its loam stamps. Null when line 1 is not the
 * stamp — an unstamped file is not loam's writing, and no staleness judgment
 * may be built on it. Tag lines above `Feature:` are the file's tags; a tag
 * line after it that carries a `@loam-digest-…` token binds that digest to the
 * immediately following `Scenario:` line (tag lines stack, as Gherkin's do,
 * without breaking the bond); any other non-blank line between them breaks it.
 */
export function parseStampedFeature(text: string): StampedFeature | null {
  const cut = featureSegments(text);
  if (cut === null) return null;
  const tags: string[] = [];
  let featureName: string | null = null;
  for (const line of cut.header) {
    const f = FEATURE_RE.exec(line);
    if (f) {
      featureName = f[1]!.trim();
      break;
    }
    if (/^\s*@/.test(line)) for (const t of line.trim().split(/\s+/)) if (t.startsWith("@")) tags.push(t.slice(1));
  }
  return { version: cut.version, tags, featureName, scenarios: cut.scenarios.map(({ name, digest }) => ({ name, digest })) };
}

/**
 * The one walk over a stamped file — {@link parseStampedFeature} reads its
 * answer, and so does the hand-edit comparison, so the two can never disagree
 * about where a scenario begins or which digest it carries.
 *
 * DOCSTRING BODIES ARE OPAQUE, and that is a correctness requirement rather
 * than tidiness. Since a step may carry a `"""` payload, a request body
 * containing a line that reads `Scenario: …` or begins with `@` would otherwise
 * be read here as a real scenario or a real tag — and every staleness verdict
 * (`gherkin.stale`, `gherkin.missing`, `gherkin.orphaned`) plus the tag that
 * decides whether an in-flight feature's file may be replaced rests on this
 * parse. The payload would be quietly deciding what the suite promises. Its
 * lines are still KEPT, in the segment they sit in: a payload is what a step
 * asserts against, so an edit to one is an edit to the test.
 *
 * Lines are split on `\r?\n`, so a checkout that turned every line ending into
 * CRLF reads exactly as the emitter's LF bytes do.
 */
export function featureSegments(text: string): FeatureSegments | null {
  const lines = text.split(/\r?\n/);
  const m = STAMP_RE.exec(lines[0] ?? "");
  if (!m) return null;
  const header: string[] = [];
  const scenarios: FeatureSegments["scenarios"] = [];
  let current = header;
  let featureSeen = false;
  // Tag lines after `Feature:` are held until it is known what they tag: a
  // `Scenario:` line binds them (and the digest among them) into a new
  // segment; anything else hands them back to the segment they sit in.
  let held: string[] = [];
  let digest: string | null = null;
  const release = (): void => {
    current.push(...held);
    held = [];
    digest = null;
  };
  let inDocString = false;
  for (const line of lines.slice(1)) {
    // `"""` opens and closes; nothing between the two is structure. The emitter
    // escapes an inner `"""` as `\"\"\"`, so an unescaped one here is always a
    // real delimiter.
    const delimiter = /^\s*"""/.test(line);
    if (inDocString || delimiter) {
      if (delimiter) inDocString = !inDocString;
      release();
      current.push(line);
      continue;
    }
    if (featureSeen && /^\s*@/.test(line)) {
      held.push(line);
      for (const t of line.trim().split(/\s+/)) {
        const d = DIGEST_TAG_RE.exec(t);
        if (d) digest = d[1]!;
      }
      continue;
    }
    if (held.length > 0 && line.trim().length === 0) {
      held.push(line);
      continue;
    }
    const s = SCENARIO_RE.exec(line);
    if (s && digest !== null) {
      current = [...held, line];
      scenarios.push({ name: s[1]!.trim(), digest, lines: current });
      held = [];
      digest = null;
      continue;
    }
    release();
    if (!featureSeen && FEATURE_RE.test(line)) featureSeen = true;
    current.push(line);
  }
  release();
  return { version: m[1]!, header, scenarios };
}

/** What differs between a file on disk and the emission it should be. */
export interface HandEdits {
  /** Something a runner executes was added or changed above the first stamped scenario. */
  header: boolean;
  /** Digests whose own segment differs, in disk order. */
  digests: string[];
}

/**
 * Where a stamped file on disk differs from `emitted`, the bytes this loam
 * writes for the same requirement — compared scenario by scenario, keyed on
 * the digest each segment carries.
 *
 * A scenario whose digest the emission does not hold is NOT an edit and is
 * skipped: that is the spec moving under the file, `gherkin.stale`'s finding,
 * and calling it a hand edit would send the reader looking for a person who
 * never touched it. Within a segment the comparison is exact, apart from
 * trailing whitespace and trailing blank lines — an editor's save, not a
 * different test.
 *
 * The header is the one region compared by SHAPE. Its description is the
 * requirement's own prose, which is in no digest — a spec edit to it moves no
 * stamp — so a byte comparison there would accuse the file of the docs repo's
 * change. What a runner reads as structure in a header is still compared: the
 * tag lines, the `Feature:` line, and every line that would end a Gherkin
 * description (a `Background:`, a `Rule:`, a scenario with no digest), which
 * is how a hand-added Background that seeds every scenario's state is caught.
 */
export function handEdits(onDisk: FeatureSegments, emitted: FeatureSegments): HandEdits {
  const pool = new Map<string, string[][]>();
  for (const s of emitted.scenarios) pool.set(s.digest, [...(pool.get(s.digest) ?? []), significant(s.lines)]);
  const digests: string[] = [];
  for (const s of onDisk.scenarios) {
    const want = pool.get(s.digest)?.shift();
    if (want === undefined) continue;
    if (!sameLines(significant(s.lines), want)) digests.push(s.digest);
  }
  return { header: !sameLines(executable(onDisk.header), executable(emitted.header)), digests };
}

/** Trailing whitespace off every line, trailing blank lines off the end. */
function significant(lines: string[]): string[] {
  const out = lines.map((l) => l.trimEnd());
  while (out.length > 0 && out[out.length - 1] === "") out.pop();
  return out;
}

/**
 * The lines a Gherkin parser does NOT read as a feature's description: tags,
 * and the keywords that may follow one (`Feature:`, `Background:`, `Rule:`, a
 * scenario). Step keywords are deliberately absent — in a feature description
 * a line opening `When …` is prose to the parser, and requirement prose in
 * EARS form opens exactly that way, so counting it would turn every reworded
 * requirement into a hand edit. A hand-added Background is caught by its own
 * keyword line, which the emitter never writes.
 */
const STRUCTURE_RE = /^(?:@|(?:Feature|Background|Rule|Scenario(?: Outline| Template)?|Example)\s*:)/;

/** The header as a runner sees it: tags and `Feature:` and any structure below, prose dropped. */
function executable(header: string[]): string[] {
  return header.map((l) => l.trim()).filter((l) => STRUCTURE_RE.test(l));
}

function sameLines(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((l, i) => l === b[i]);
}
