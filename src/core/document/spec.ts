/**
 * What a requirement IS, what makes one the same requirement twice, and the one
 * canonical way it is written back out.
 *
 * Living specs use `## Requirements` with `### Requirement:` + `#### Scenario:`.
 * Feature deltas group requirements under `## ADDED|MODIFIED|REMOVED
 * Requirements`. Scenarios are the acceptance criteria (Given/When/Then) and
 * the source for tests.
 *
 * Identity and serialization cannot be separated here: `requirementDigest` is
 * defined AS the sha256 of the serialized requirement without its baseline, so
 * a second module owning the writer would mean the digest and the bytes it
 * claims to describe could disagree. `./parse.ts` turns markdown into these,
 * `./apply.ts` folds a delta into a living set of them.
 */
import { createHash } from "node:crypto";

export type DeltaKind = "ADDED" | "MODIFIED" | "REMOVED" | "BASE";

export interface Scenario {
  name: string;
  lines: string[];
}

export interface Requirement {
  /** BASE for a living spec; ADDED/MODIFIED/REMOVED inside a feature delta. */
  kind: DeltaKind;
  /**
   * Stable identity from a `Requirement-ID:` body line. Optional so existing
   * OpenSpec-compatible documents continue to use their heading as identity.
   */
  id?: string;
  /**
   * The living requirement this delta was WRITTEN AGAINST, from a `Based-On:`
   * body line — `requirementDigest` of that requirement at authoring time.
   *
   * Delta-only, and meaningful on MODIFIED/REMOVED alone: those two address a
   * requirement that already exists, and a MODIFIED carries its full new text,
   * so archive does not merge the living wording — it REPLACES it. Two features
   * rewriting one requirement therefore lose the loser's text outright, and the
   * in-flight warning (`delta.modified-conflict`) cannot see the case that
   * actually happens: once the first archives it leaves `changes/`, the second
   * goes green again, and its stale text lands on top without a word. This is
   * the pin that closes that window — the same trick as `sources_digest`
   * (core/provenance/stamp.ts), one requirement wide.
   *
   * Absent on requirements adopted from OpenSpec, which never had the line;
   * those keep the older, weaker protection and are told so once (warn).
   */
  basedOn?: string;
  name: string;
  text: string[];
  /** OpenAPI operationIds this requirement governs, from an `Operations:` line. */
  operations: string[];
  /**
   * What this requirement's scenarios exercise, from a `Covers:` line — the
   * architecture analog of `Operations:`. Entries are C4 element ids, edges
   * (`source -> target`), or health signals (`alert:<id>` / `sli:<id>`);
   * core/c4/arch.ts owns the grammar and the resolution. Parsed everywhere for one
   * grammar's sake, meaningful in arch.spec.md.
   */
  covers: string[];
  /**
   * AsyncAPI message names this requirement governs on the PRODUCING side, from
   * a `Publishes:` line — the event-axis analog of `Operations:`.
   *
   * Two lines rather than one, because the async spine is directional in a way
   * the HTTP one is not: `Publishes:` resolves against this service's OWN
   * contract, while `Consumes:` names a message another service declares, and
   * only a fleet-wide view can say whether anybody does. Grading them alike
   * would either excuse a typo in a producer or point a consumer's error at the
   * wrong repository.
   */
  publishes: string[];
  /** AsyncAPI message names this requirement consumes, from a `Consumes:` line. See `publishes`. */
  consumes: string[];
  scenarios: Scenario[];
  /**
   * The H2 heading of its SOURCE DOCUMENT this requirement was parsed under,
   * verbatim (`## Behavior`), or absent if it preceded every heading. Records where
   * the text came from, so it stays true after a merge re-homes the requirement.
   *
   * `kind` alone cannot explain why a requirement is BASE, and the two BASE cases
   * differ completely: under `## Requirements` a delta is legally quoting the
   * living state, while under `## Behavior` the author wrote a change that archive
   * will silently not merge. `delta.requirement-not-merged` tells them apart.
   */
  section?: string;
  /**
   * 1-based line of this requirement's `### Requirement:` heading in its source
   * document. Body line `text[i]` is therefore at line `line + 1 + i` — the
   * capture is contiguous from the heading to the first scenario — which is what
   * lets `loam rebase` rewrite one `Based-On:` line by surgery instead of
   * reserializing the document and flattening the author's sections and prose.
   */
  line?: number;
}

export const KIND_RE = /^##\s+(ADDED|MODIFIED|REMOVED)\s+Requirements\s*$/i;
export const REQUIREMENT_ID_LINE_RE = /^\s*Requirement-ID:\s*(.*?)\s*$/i;
export const BASED_ON_LINE_RE = /^\s*Based-On:\s*(.*?)\s*$/i;

/** Portable, review-friendly stable IDs. Case-sensitive by design. */
export const REQUIREMENT_ID_RE = /^[A-Za-z][A-Za-z0-9._-]{0,127}$/;

/**
 * How much of the sha256 a `Based-On:` line carries — the length
 * `sources_digest` already uses (core/provenance/stamp.ts), for one reason a reader
 * can hold: every digest loam writes into a document reads the same.
 */
export const REQUIREMENT_DIGEST_LENGTH = 16;

/** The value shape of a `Based-On:` line, exactly as `requirementDigest` writes it. */
export const REQUIREMENT_DIGEST_RE = new RegExp(`^[0-9a-f]{${REQUIREMENT_DIGEST_LENGTH}}$`);

export type RequirementIdProblem =
  | { kind: "invalid"; requirement: string; value: string }
  | { kind: "repeated"; requirement: string; values: string[] }
  | { kind: "duplicate"; id: string; requirements: string[] };

/** Every authored Requirement-ID value in a requirement body, including blanks. */
export function requirementIdDeclarations(requirement: Requirement): string[] {
  return requirement.text.flatMap((line) => {
    const match = REQUIREMENT_ID_LINE_RE.exec(line);
    return match === null ? [] : [match[1]!.trim()];
  });
}

/** Structural ID problems within one spec/delta document. */
export function requirementIdProblems(reqs: Requirement[]): RequirementIdProblem[] {
  const problems: RequirementIdProblem[] = [];
  const owners = new Map<string, string[]>();
  for (const requirement of reqs) {
    const declarations = requirementIdDeclarations(requirement);
    const values = declarations.length > 0
      ? declarations
      : requirement.id === undefined
        ? []
        : [requirement.id];
    if (declarations.length > 1) {
      problems.push({ kind: "repeated", requirement: requirement.name, values: declarations });
    }
    for (const value of values) {
      if (!REQUIREMENT_ID_RE.test(value)) {
        problems.push({ kind: "invalid", requirement: requirement.name, value });
      }
    }
    // A repeated declaration is already an error. Do not also pretend its
    // keep-last parse result is an unambiguous document identity.
    if (values.length !== 1 || !REQUIREMENT_ID_RE.test(values[0]!)) continue;
    const names = owners.get(values[0]!) ?? [];
    names.push(requirement.name);
    owners.set(values[0]!, names);
  }
  for (const [id, requirements] of owners) {
    if (requirements.length > 1) problems.push({ kind: "duplicate", id, requirements });
  }
  return problems;
}

/** Every authored `Based-On:` value in a requirement body, including blanks. */
export function basedOnDeclarations(requirement: Requirement): string[] {
  return requirement.text.flatMap((line) => {
    const match = BASED_ON_LINE_RE.exec(line);
    return match === null ? [] : [match[1]!.trim()];
  });
}

/**
 * The requirement without its baseline marker — what a digest is taken over,
 * and what archive merges into the living document.
 *
 * `Based-On:` is a statement ABOUT a delta ("this was written against that"),
 * never part of the requirement it describes, and both consequences of
 * forgetting that are bad. Left in the digest input, a requirement's digest
 * would depend on the pin pointing at it, so no baseline could ever be
 * self-consistent. Left in the merged text — `applyRequirementDelta` copies the
 * delta's body into living wholesale — the living document would grow a pin to
 * a version of itself, and the NEXT feature's baseline would be taken over a
 * document containing the previous feature's bookkeeping.
 */
export function withoutBaseline(requirement: Requirement): Requirement {
  const { basedOn: _dropped, ...rest } = requirement;
  return { ...rest, text: requirement.text.filter((line) => !BASED_ON_LINE_RE.test(line)) };
}

/**
 * The identity of a requirement's CONTENT: sha256 over its canonical
 * serialization, truncated like every other digest loam stamps.
 *
 * Canonical, not raw bytes, and deliberately: a living spec is rewritten by
 * `serializeRequirements` on every archive, so hashing the file's bytes would
 * make a baseline go stale over reflowed blank lines — a false alarm on the one
 * check whose whole value is that it only fires when something real moved.
 * What the hash therefore covers is exactly what survives a round trip: the
 * heading, the body (`Requirement-ID:` and `Operations:`/`Covers:` lines
 * included), and every scenario with its Given/When/Then lines. `kind` and
 * `section` are not serialized and so are not hashed — a requirement does not
 * change because the document quoting it moved it under another heading.
 */
export function requirementDigest(requirement: Requirement): string {
  return createHash("sha256")
    .update(serializeRequirements([withoutBaseline(requirement)]), "utf8")
    .digest("hex")
    .slice(0, REQUIREMENT_DIGEST_LENGTH);
}

/** Serialize requirements back to OpenSpec markdown (`### Requirement:` + `#### Scenario:`). */
export function serializeRequirements(reqs: Requirement[]): string {
  // Framing (blank lines between sections) is normalized here; body content is
  // only edge-trimmed, never collapsed — blank lines inside a scenario (e.g. in
  // fenced code blocks) are verbatim content.
  const chunks: string[] = [];
  for (const r of reqs) {
    const chunk: string[] = [`### Requirement: ${r.name}`];
    const body = [...r.text];
    // Parsed documents already carry the authored line in `text`. This branch
    // also makes programmatically constructed Requirements serialize fully.
    if (r.id !== undefined && !body.some((line) => REQUIREMENT_ID_LINE_RE.test(line))) {
      body.unshift(`Requirement-ID: ${r.id}`);
    }
    // Directly under the identity it pins, which is where `loam rebase` writes
    // it too — the two lines are read together, so they are never apart.
    if (r.basedOn !== undefined && !body.some((line) => BASED_ON_LINE_RE.test(line))) {
      body.splice(body.findIndex((line) => REQUIREMENT_ID_LINE_RE.test(line)) + 1, 0, `Based-On: ${r.basedOn}`);
    }
    const text = body.join("\n").trim();
    if (text) chunk.push("", text);
    for (const s of r.scenarios) {
      chunk.push("", `#### Scenario: ${s.name}`);
      const body = s.lines.join("\n").trim();
      if (body) chunk.push(body);
    }
    chunks.push(chunk.join("\n"));
  }
  return chunks.join("\n\n").trim() + "\n";
}

/**
 * A delta requirement as it lands in the living document, with the bookkeeping
 * that belongs to the DELTA left behind: the `Based-On:` pin (a claim about
 * which living version this was written against — meaningless once it IS the
 * living version, and poison for the next feature's baseline, which would then
 * hash the previous feature's pin) and the line it was parsed from.
 */
