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
   * Authorization this requirement is gated on, from a `Requires:` line —
   * `<subject>/<permission>` entries declared in `architecture/permissions.yaml`.
   *
   * A third join beside `Operations:` and `Covers:`, and it exists because the
   * other two cannot carry it. A permission is not an operation (one operation
   * is gated by several, and the same permission gates several operations) and
   * it is not a C4 element (it is a domain fact, not a structural one). The
   * subject half is what the OpenAPI security model cannot express at all:
   * `security` names what the CALLER must hold, while a permission is as often
   * checked on an entity inside the request — the profile a message is sent
   * from, the org a resource belongs to.
   */
  requires: string[];
  /**
   * Fleet capabilities this requirement realizes part of, from a `Capability:`
   * (also accepted: `Capabilities:`) line — ids declared in
   * `architecture/capabilities.yaml`.
   *
   * A fourth join beside `Operations:`, `Covers:` and `Requires:`, and a LIST
   * because the relation is many-to-many in both directions: one requirement
   * commonly closes part of two capabilities, and a capability is realized by
   * many requirements across several services — a single-valued field would
   * force authors to pick a lie. Neither existing line can carry it: a
   * capability is not an operation (it is behaviour above any one endpoint)
   * and not a C4 element (it is a business fact, not a structural one).
   * The parse is additive exactly as `requires` is — the line rides in
   * `req.text` and therefore inside `requirementDigest`, so no living
   * document's digest moves merely because loam learned to read it.
   */
  capabilities: string[];
  /**
   * Capability REQUIREMENTS this requirement realizes part of, from a
   * `Realizes:` line — entries spelled `<capability-id>#<Requirement-ID>`,
   * resolving against `capabilities/<cap>/spec.md`.
   *
   * A fifth join, and the one that makes the business tree checkable rather
   * than merely present. `Capability:` beside it answers a DIFFERENT question
   * and neither replaces the other: `Capability: checkout` says this
   * requirement is part of that capability, which is a claim about theme;
   * `Realizes: checkout#CHECKOUT-CHARGE-ONCE` says it is part of what makes one
   * named promise true, which is a claim loam can grade in both directions —
   * an entry that resolves to nothing, and a capability requirement nothing
   * realizes.
   *
   * WHY A COMPOSITE ENTRY RATHER THAN TWO LINES. A `Requirement-ID` is only
   * unique inside its own document, so the capability half is not decoration —
   * it is what makes the target addressable at all. Two lines would let a
   * requirement name three capabilities and four ids with nothing saying which
   * belongs to which.
   *
   * WHY THE SEPARATOR IS THE LAST `#` AND NOT THE FIRST. The requirement half
   * has a strict grammar (`REQUIREMENT_ID_RE`) that excludes `#`, while the
   * capability half is a YAML key and a directory name and is not constrained
   * here at all. Splitting at the last `#` is therefore unambiguous for every
   * capability id there is; splitting at the first would mis-parse any id that
   * contained one, and would do it silently.
   *
   * Parsed additively exactly as `capabilities` is — the line rides in
   * `req.text` and therefore inside `requirementDigest`, so no living
   * document's digest moves merely because loam learned to read it.
   */
  realizes: string[];
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

/**
 * The `Capability:` body line (also accepted: `Capabilities:`), exactly as the
 * parser reads it — `./parse.ts` consumes the capture, migrate-openspec's
 * materializer tests presence with it before appending its own line. One
 * spelling on purpose: two copies of a grammar is how a "presence" test and
 * the parse quietly stop agreeing about what counts as the line.
 */
export const CAPABILITY_LINE_RE = /^\s*Capabilit(?:y|ies):\s*(.+?)\s*$/i;

/**
 * The `Realizes:` body line. One spelling only — no `Realize:` singular
 * alternative, unlike `Operations?:` and the rest — because the verb already
 * reads correctly for one entry and for six, and the plural forms in the older
 * lines exist to forgive a NOUN that changes shape. A grammar with an
 * alternative nobody needs is one more thing two readers can disagree about.
 */
export const REALIZES_LINE_RE = /^\s*Realizes:\s*(.+?)\s*$/i;

/**
 * The separator between a `Realizes:` target and the digest of the capability
 * requirement it was written against — `checkout#CHK-1@9f2c1a4b`.
 *
 * `@` and not a second `#`, because the two halves are read by different rules:
 * `splitRealizesEntry` takes the LAST `#` to find the requirement half, so a
 * second one would move that boundary and re-parse every existing entry. `@`
 * is also excluded from `REQUIREMENT_ID_RE`, which is what makes the split
 * unambiguous rather than a convention — an id can never contain one.
 *
 * NOBODY TYPES THIS. `loam rebase --living` writes it and rewrites it; a human
 * writes `Realizes: checkout#CHK-1` and is never asked for more. An entry
 * without a pin is not a defect and never becomes one — it is a claim that has
 * not been pinned yet, and it grades exactly as it did before pins existed.
 */
export const REALIZES_PIN_SEPARATOR = "@";

/**
 * One `Realizes:` entry split into the target it names and the digest it was
 * written against, or `pin: null` when it carries none.
 *
 * A suffix that is not a well-formed digest is NOT a pin and NOT a refusal:
 * the whole entry stays the target, so `checkout#CHK-1@nonsense` resolves — or
 * fails to resolve — exactly as it would have before, under
 * `capability.realizes-unknown`, whose message names the entry the author
 * actually typed. Inventing a second refusal for one mistake is the failure
 * `splitRealizesEntry` already refuses two lines up.
 */
export function splitRealizesPin(entry: string): { target: string; pin: string | null } {
  const at = entry.lastIndexOf(REALIZES_PIN_SEPARATOR);
  if (at <= 0) return { target: entry, pin: null };
  const suffix = entry.slice(at + 1);
  if (!REQUIREMENT_DIGEST_RE.test(suffix)) return { target: entry, pin: null };
  return { target: entry.slice(0, at), pin: suffix };
}

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
 * The requirement with every `Realizes:` pin stripped back to its bare target —
 * the second thing a digest is taken over, for the same reason as the first.
 *
 * `withoutBaseline`'s argument, one axis over: a pin is a statement ABOUT a
 * join ("this claim was written against that version of the promise"), never
 * part of the requirement making the claim. Left in the digest input it would
 * make re-pinning a content change, so every requirement realizing a capability
 * would go stale against ITS OWN consumers the moment the capability moved —
 * one edit cascading through the corpus, which is the failure the pin exists to
 * report rather than to cause.
 *
 * The line is kept and only the suffix removed, unlike `withoutBaseline` which
 * drops the whole line: the target ids ARE content, and a requirement that
 * stops naming the promise it keeps is a different requirement.
 */
export function withoutRealizesPins(requirement: Requirement): Requirement {
  return {
    ...requirement,
    text: requirement.text.map((line) => {
      const match = REALIZES_LINE_RE.exec(line);
      if (match === null) return line;
      const bare = match[1]!
        .split(",")
        .map((entry) => splitRealizesPin(entry.trim()).target)
        .join(", ");
      return line.replace(match[1]!, bare);
    }),
  };
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
 *
 * The two normalizations are the two kinds of bookkeeping a requirement can
 * carry about its own joins — the baseline pointing AT it, and the `Realizes:`
 * pins pointing OUT of it. Both are stripped for the same reason: a digest that
 * moved when bookkeeping moved would make every pin self-invalidating.
 */
export function requirementDigest(requirement: Requirement): string {
  return createHash("sha256")
    .update(serializeRequirements([withoutRealizesPins(withoutBaseline(requirement))]), "utf8")
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
