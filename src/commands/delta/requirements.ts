/**
 * The requirement items of `loam delta`'s brief: verbatim by default, as an
 * outline under `--outline`, and narrowed to the ones `--requirement` names.
 *
 * Split from `./delta.ts` when the two size lenses arrived, because the item is
 * where both act: `--outline` changes what one requirement carries
 * (`core/pack/requirement.ts` says why, and what an outline keeps), and
 * `--requirement` changes which requirements are carried at all. Neither
 * touches anything else in the brief, so a reader who knows the default shape
 * knows both of theirs.
 */
import { type Requirement } from "../../core/document/spec.js";
import { type ScenarioAxis } from "../../core/gherkin/digest.js";
import { scenarioDigest } from "../../core/gherkin/stamp.js";
import { type RequirementSpan, type SpanOf } from "../../core/pack/requirement.js";
import { nearestIds } from "../../core/repo/entries.js";

/** One document's requirements, as the brief projects them. */
export interface BriefAxis {
  reqs: readonly Requirement[];
  /** A digest SALT, not a label — see `requirementJson`. */
  axis: ScenarioAxis;
  /** Where each requirement sits, under `--outline`; null for the verbatim form. */
  spanOf: SpanOf | null;
}

/**
 * Which requirements `--requirement` asked for, by `requirementAddress`. Null
 * when the flag was not given, which keeps every requirement.
 */
export type Picked = ReadonlySet<string> | null;

/**
 * The name `--requirement` takes: the `Requirement-ID`, or the heading of a
 * requirement that has none — the identity the parse itself falls back to.
 * Never the heading of one that HAS an id: two names for one requirement is a
 * second identity to keep straight. Not `core/delta/scope.ts`'s
 * `requirementKey`, which prefixes the kind so an id cannot collide with a
 * heading: this one is typed by a person, and spelled the way the outline
 * prints it.
 */
export function requirementAddress(r: Requirement): string {
  return r.id ?? r.name;
}

/**
 * Whether a section prints as an outline: under `--outline`, unless
 * `--requirement` named what to read — naming a requirement is asking to read
 * it, so the named ones come in full. ONE decision for both renderers, the JSON
 * items here and the human view in `./delta.ts`, so the two cannot disagree.
 */
export function outlined(spanOf: SpanOf | null, picked: Picked): spanOf is SpanOf {
  return spanOf !== null && picked === null;
}

/** The names `--requirement` gave that no requirement of the brief answers to, in the order given. */
export function unknownRequirements(wanted: readonly string[], axes: ReadonlyArray<readonly Requirement[]>): string[] {
  const known = new Set(axes.flat().map(requirementAddress));
  return [...new Set(wanted)].filter((name) => !known.has(name));
}

/**
 * The refusal for a name nothing answers to. A typo must not be an empty
 * brief: "no requirements here" is what a finished service looks like. A name
 * that is the HEADING of a requirement with an id is no typo — the outline
 * printed it — so the refusal says which id to use instead of guessing.
 */
export function unknownRequirementMessage(unknown: readonly string[], axes: ReadonlyArray<readonly Requirement[]>, scope: string): string {
  const reqs = axes.flat();
  const keys = reqs.map(requirementAddress);
  const headings = unknown.flatMap((name) => reqs.filter((r) => r.id !== undefined && r.name === name).map((r) => `'${name}' is ${r.id}`));
  const near = [...new Set(unknown.flatMap((name) => nearestIds(name, keys)))];
  const hint =
    keys.length === 0 ? " — it carries no requirement delta."
    : headings.length > 0 ? ` — ${headings.join(", ")}: name a requirement by its Requirement-ID.`
    : near.length > 0 ? ` — did you mean ${near.map((n) => `'${n}'`).join(" or ")}?`
    : ".";
  return `No requirement ${unknown.map((n) => `'${n}'`).join(", ")} in ${scope}${hint}`;
}

/**
 * The items of one section, in the form `outlined` chose. `extra(i)` is the
 * review's keys for the requirement at index `i` of the whole section, which is
 * why the narrowing happens here and not before.
 */
export function briefRequirements(
  section: BriefAxis,
  service: string,
  picked: Picked,
  extra: (i: number) => Record<string, unknown>,
): Array<Record<string, unknown>> {
  const spanOf = outlined(section.spanOf, picked) ? section.spanOf : null;
  return section.reqs.flatMap((r, i) => {
    if (picked !== null && !picked.has(requirementAddress(r))) return [];
    const item = spanOf === null ? requirementJson(r, section.axis, service) : outlineJson(r, section.axis, service, spanOf(r));
    return [{ ...item, ...extra(i) }];
  });
}

/**
 * One requirement, verbatim. `axis` and `service` both ride in, because the
 * scenario digest is salted by BOTH — the same Given/When/Then under `spec.md`
 * and under `arch.spec.md` are two different claims, and one hash for both
 * would let a green business run answer an integration test nobody wrote
 * (core/gherkin/digest.ts owns that reasoning and the recipe).
 */
function requirementJson(r: Requirement, axis: ScenarioAxis, service: string): Record<string, unknown> {
  return {
    kind: r.kind,
    id: r.id,
    // Where the requirement sits in the document it was parsed from, so a
    // consumer can send an author to the line rather than to the file.
    line: r.line,
    basedOn: r.basedOn,
    name: r.name,
    text: r.text.join("\n").trim(),
    operations: r.operations,
    covers: r.covers,
    // The five joins this projection used to drop on the floor. Every one
    // of them is already written on the requirement and every one names
    // work: which permission gates it, which capability it belongs to,
    // which named promise it realizes, and which messages it produces and
    // consumes. An implementer handed "add the endpoint" and none of this
    // has to go read the markdown the payload claims to have projected.
    requires: r.requires,
    capabilities: r.capabilities,
    realizes: r.realizes,
    publishes: r.publishes,
    consumes: r.consumes,
    // Scenarios go out verbatim: they are the acceptance criteria and the
    // source for the tests whoever picks this up is expected to write.
    //
    // `digest` is the EXACT join key the rest of the toolchain uses —
    // `loam gherkin` stamps it on the generated scenario as
    // `@loam-digest-<16hex>` (core/gherkin/stamp.ts) and `loam verify`
    // matches a cucumber report's scenarios on it. Without it a consumer
    // of this brief could name the acceptance criteria but not the test
    // that answers them, and had to regenerate the suite to find out.
    scenarios: r.scenarios.map((s) => ({
      name: s.name,
      lines: s.lines,
      line: s.line,
      digest: scenarioDigest(service, s.lines, axis),
    })),
  };
}

/**
 * One requirement as an outline: the verbatim item without `text` and without
 * each scenario's `lines`, with the span in their place. The digest stays,
 * computed from the lines it no longer carries — it is how a unit of `loam
 * tasks` and a stamped `.feature` scenario find the requirement in the outline.
 */
function outlineJson(r: Requirement, axis: ScenarioAxis, service: string, span: RequirementSpan): Record<string, unknown> {
  return {
    kind: r.kind,
    id: r.id,
    ...span,
    basedOn: r.basedOn,
    name: r.name,
    operations: r.operations,
    covers: r.covers,
    requires: r.requires,
    capabilities: r.capabilities,
    realizes: r.realizes,
    publishes: r.publishes,
    consumes: r.consumes,
    scenarios: r.scenarios.map((s) => ({ name: s.name, line: s.line, digest: scenarioDigest(service, s.lines, axis) })),
  };
}
