/**
 * A generated `.feature` file read back — the stamp, the tags, the scenarios.
 *
 * The parser is deliberately shallow and forgiving in one direction only: a file
 * without loam's stamp is not loam's to grade, and returns null rather than a
 * partially understood suite. Anything that IS stamped is loam's output, so the
 * digests inside it are trusted to be the ones `./emit.ts` wrote.
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

/**
 * Parse a `.feature` file for its loam stamps. Null when line 1 is not the
 * stamp — an unstamped file is not loam's writing, and no staleness judgment
 * may be built on it. Tag lines above `Feature:` are the file's tags; a tag
 * line after it that carries a `@loam-digest-…` token binds that digest to the
 * immediately following `Scenario:` line (tag lines stack, as Gherkin's do,
 * without breaking the bond); any other non-blank line between them breaks it.
 *
 * DOCSTRING BODIES ARE SKIPPED WHOLE, and that is a correctness requirement
 * rather than tidiness. Since a step may carry a `"""` payload, a request body
 * containing a line that reads `Scenario: …` or begins with `@` would otherwise
 * be read here as a real scenario or a real tag — and every staleness verdict
 * (`gherkin.stale`, `gherkin.missing`, `gherkin.orphaned`) plus the tag that
 * decides whether an in-flight feature's file may be replaced rests on this
 * parse. The payload would be quietly deciding what the suite promises.
 */
export function parseStampedFeature(text: string): StampedFeature | null {
  const lines = text.split(/\r?\n/);
  const m = STAMP_RE.exec(lines[0] ?? "");
  if (!m) return null;
  const tags: string[] = [];
  let featureName: string | null = null;
  const scenarios: StampedScenario[] = [];
  let pending: string | null = null;
  let inDocString = false;
  for (const line of lines.slice(1)) {
    // `"""` opens and closes; nothing between the two is structure. The emitter
    // escapes an inner `"""` as `\"\"\"`, so an unescaped one here is always a
    // real delimiter.
    if (/^\s*"""/.test(line)) {
      inDocString = !inDocString;
      continue;
    }
    if (inDocString) continue;
    if (/^\s*@/.test(line)) {
      for (const t of line.trim().split(/\s+/)) {
        if (featureName === null) {
          if (t.startsWith("@")) tags.push(t.slice(1));
          continue;
        }
        const d = DIGEST_TAG_RE.exec(t);
        if (d) pending = d[1]!;
      }
      continue;
    }
    const f = /^\s*Feature:\s*(.*)$/.exec(line);
    if (f && featureName === null) {
      featureName = f[1]!.trim();
      continue;
    }
    const s = /^\s*Scenario(?: Outline)?:\s*(.*)$/.exec(line);
    if (s) {
      if (pending !== null) scenarios.push({ name: s[1]!.trim(), digest: pending });
      pending = null;
      continue;
    }
    if (pending !== null && line.trim().length > 0) pending = null;
  }
  return { version: m[1]!, tags, featureName, scenarios };
}
