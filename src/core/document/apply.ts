/**
 * A feature's ADDED/MODIFIED/REMOVED requirements folded onto a living set.
 *
 * The one thing `loam archive` does to a spec, and a module of its own because
 * it is where a requirement stops being a delta: `asLiving` drops the
 * `Based-On:` pin, which is a claim about which living version this was written
 * against — meaningless once it IS the living version, and poison for the next
 * feature's baseline, which would otherwise hash the previous feature's pin.
 *
 * It is also where the merge says what it TAKES AWAY (`replacementsOf`,
 * `droppedParts`), because only the algebra knows which living requirement a
 * delta requirement selects: a MODIFIED carries its full new text and replaces
 * the living requirement whole, so every scenario and every join line it does
 * not restate is gone after the archive — and a second reading of "which one
 * does this select" anywhere else would be a second answer free to disagree.
 */
import { requirementIdProblems, splitRealizesPin, withoutBaseline, type DeltaKind, type Requirement } from "./spec.js";

/**
 * A delta requirement as it lands in the living document, with the bookkeeping
 * that belongs to the DELTA left behind: the `Based-On:` pin (a claim about
 * which living version this was written against — meaningless once it IS the
 * living version, and poison for the next feature's baseline, which would then
 * hash the previous feature's pin) and the line it was parsed from.
 */
function asLiving(d: Requirement): Requirement {
  const { line: _dropped, ...rest } = withoutBaseline(d);
  return { ...rest, kind: "BASE" };
}

/** One living requirement a delta requirement takes the place of, or takes away. */
export interface Replacement {
  /**
   * What the delta did to it, NET: MODIFIED or REMOVED — or ADDED, when it lands on a
   * requirement that already exists. A requirement the delta selects twice keeps
   * one record, REMOVED if its last step removed it.
   */
  kind: Exclude<DeltaKind, "BASE">;
  /** The living requirement as it stood before the merge. */
  living: Requirement;
  /** What lands in its place, or null for a removal. */
  merged: Requirement | null;
}

/**
 * Apply a feature's ADDED/MODIFIED/REMOVED requirements onto a living requirement set.
 *
 * A living requirement the delta does not touch comes back as the SAME object
 * it went in as (a living spec's requirements are already BASE), and that
 * identity is load-bearing: archive keys each requirement's raw bytes on it, so
 * an untouched requirement is written back exactly as its author wrote it and
 * only the ones this function replaced or added are serialized.
 */
export function applyRequirementDelta(living: Requirement[], delta: Requirement[]): Requirement[] {
  return foldDelta(living, delta).merged;
}

/**
 * Every living requirement the delta replaces or removes, in delta order — the
 * walk `applyRequirementDelta` takes, so the two cannot disagree about which
 * requirement a MODIFIED selected. Throws exactly when the merge would.
 */
export function replacementsOf(living: Requirement[], delta: Requirement[]): Replacement[] {
  return foldDelta(living, delta).replaced;
}

function foldDelta(living: Requirement[], delta: Requirement[]): { merged: Requirement[]; replaced: Replacement[] } {
  const malformed = [...requirementIdProblems(living), ...requirementIdProblems(delta)];
  if (malformed.length > 0) {
    throw new Error("cannot merge requirements with invalid, repeated, or duplicate Requirement-ID declarations");
  }
  let result: Requirement[] = living.map((r) => (r.kind === "BASE" ? r : { ...r, kind: "BASE" as DeltaKind }));
  const replaced: Replacement[] = [];
  // What each requirement the fold has PRODUCED stands for: the replacement
  // record it belongs to, or null for one this delta added. A delta may select
  // one requirement twice (nothing refuses a repeated heading in a delta), and
  // without this the second step reported the first step's text as "living" —
  // a drop the merge never makes. With it every record stays pre-merge to
  // post-merge, so what `droppedParts` reads is the net change.
  const born = new Map<Requirement, Replacement | null>();
  const record = (kind: Replacement["kind"], previous: Requirement, merged: Requirement | null): void => {
    const earlier = born.get(previous);
    if (earlier === undefined) {
      const entry: Replacement = { kind, living: previous, merged };
      replaced.push(entry);
      if (merged !== null) born.set(merged, entry);
    } else if (earlier === null) {
      // Added by this delta, so nothing living is replaced by rewriting it.
      if (merged !== null) born.set(merged, null);
    } else {
      earlier.merged = merged;
      if (merged === null) earlier.kind = "REMOVED";
      else born.set(merged, earlier);
    }
  };
  const add = (merged: Requirement): void => {
    born.set(merged, null);
    result.push(merged);
  };
  for (const d of delta) {
    // BASE is not a delta kind — a requirement outside an ADDED/MODIFIED/REMOVED
    // section (e.g. quoted under ## Notes) is documentation, not a change.
    if (d.kind === "BASE") continue;
    const kind = d.kind;
    if (d.id !== undefined) {
      const idMatches = result
        .map((r, i) => (r.id === d.id ? i : -1))
        .filter((i) => i >= 0);
      const nameMatches = result
        .map((r, i) => (r.name === d.name ? i : -1))
        .filter((i) => i >= 0);
      const otherNameMatches = nameMatches.filter((i) => !idMatches.includes(i));
      if (idMatches.length > 1 || otherNameMatches.length > 0) {
        throw new Error(
          `ambiguous requirement identity for '${d.name}' (${d.id}): Requirement-ID and heading select different living requirements`,
        );
      }
      if (d.kind === "REMOVED") {
        const selected = new Set(idMatches);
        for (const i of idMatches) record(kind, result[i]!, null);
        result = result.filter((_, i) => !selected.has(i));
      } else {
        const merged: Requirement = asLiving(d);
        const at = idMatches[0];
        if (at === undefined) add(merged);
        else {
          record(kind, result[at]!, merged);
          result[at] = merged;
        }
      }
    } else if (d.kind === "REMOVED") {
      for (const r of result) if (r.name === d.name) record(kind, r, null);
      result = result.filter((r) => r.name !== d.name);
    } else {
      const i = result.findIndex((r) => r.name === d.name);
      // A legacy delta may still modify an ID-bearing living requirement by
      // its exact heading. Keep the identity while the repository migrates.
      const inheritedId = i >= 0 ? result[i]!.id : undefined;
      const merged: Requirement = {
        ...asLiving(d),
        ...(inheritedId === undefined ? {} : { id: inheritedId }),
      };
      if (i < 0) add(merged);
      else {
        record(kind, result[i]!, merged);
        result[i] = merged;
      }
    }
  }
  return { merged: result, replaced };
}

/**
 * The join lines a requirement carries, keyed by `Requirement` field and
 * spelled as the body line writes them — every list the parser reads out of a
 * requirement's text, in one order, so the archive plan, `loam delta` and their
 * `--json` rows name a dropped entry the same way.
 */
export const DIRECTIVE_LINES = {
  operations: "Operations",
  covers: "Covers",
  requires: "Requires",
  capabilities: "Capability",
  realizes: "Realizes",
  publishes: "Publishes",
  consumes: "Consumes",
} as const;

export type DirectiveKey = keyof typeof DIRECTIVE_LINES;

/** What one replacement takes out of the living documents. */
export interface DroppedParts {
  /** Living scenario names the replacement does not carry — every one of them, for a removal. */
  scenarios: string[];
  /** Per join line, the living entries the replacement does not restate. Only lines that lose something are present. */
  directives: Partial<Record<DirectiveKey, string[]>>;
}

/**
 * What a replacement drops: the living scenarios its new text does not carry,
 * by name, and each join-line entry it does not restate, verbatim.
 *
 * VERBATIM AND BY NAME, and that is a reading, not a judgement — with one
 * exception for bookkeeping: a `Realizes:` entry is compared, and reported, by
 * the target it names, its `@<digest>` pin set aside. A scenario
 * renamed is reported dropped, and a `Covers:` entry respelled from an element
 * id to the service name is reported dropped too, though either may mean the
 * same thing — this lists what the living text says that the merged text does
 * not, and the author decides. What it must never be again is the old answer,
 * which was nothing: a MODIFIED that restated one of two scenarios merged, and
 * the second vanished under the archive's exit 0.
 */
export function droppedParts(replacement: Replacement): DroppedParts {
  const { living, merged } = replacement;
  const keptScenarios = new Set((merged?.scenarios ?? []).map((s) => s.name));
  const directives: Partial<Record<DirectiveKey, string[]>> = {};
  for (const key of Object.keys(DIRECTIVE_LINES) as DirectiveKey[]) {
    // A `Realizes:` entry is compared by the target it names: the `@<digest>`
    // pin `loam rebase --living` writes is bookkeeping, and a replacement that
    // restates the target unpinned has kept the join, not dropped it.
    const spell = key === "realizes" ? (entry: string): string => splitRealizesPin(entry).target : (entry: string): string => entry;
    const kept = new Set((merged?.[key] ?? []).map(spell));
    const gone = [...new Set(living[key].map(spell))].filter((entry) => !kept.has(entry));
    if (gone.length > 0) directives[key] = gone;
  }
  return { scenarios: living.scenarios.map((s) => s.name).filter((name) => !keptScenarios.has(name)), directives };
}

/** Does this replacement take anything away at all? */
export function dropsAnything(parts: DroppedParts): boolean {
  return parts.scenarios.length > 0 || Object.keys(parts.directives).length > 0;
}

/** One replacement that takes something away, as both the archive plan and `loam delta` report it. */
export interface DroppedRow extends DroppedParts {
  kind: Replacement["kind"];
  /** The LIVING requirement's heading and id — what a reader finds in the file today. */
  requirement: string;
  id?: string;
}

/**
 * Every replacement that takes something away: a removal always (the
 * requirement itself is what goes), a MODIFIED or a landing ADDED whenever its
 * new text restates less than the living one held.
 */
export function droppedBy(living: Requirement[], delta: Requirement[]): DroppedRow[] {
  return replacementsOf(living, delta).flatMap((replacement) => {
    const parts = droppedParts(replacement);
    if (replacement.kind !== "REMOVED" && !dropsAnything(parts)) return [];
    const { name, id } = replacement.living;
    return [{ kind: replacement.kind, requirement: name, ...(id === undefined ? {} : { id }), ...parts }];
  });
}

/** One dropped row in words — the line the archive plan and `loam delta` both print. */
export function droppedSentence(row: DroppedRow): string {
  const who = row.id === undefined ? `'${row.requirement}'` : `${row.id} '${row.requirement}'`;
  const lost = [
    ...(row.scenarios.length === 0 ? [] : [`scenario ${row.scenarios.map((s) => `'${s}'`).join(", ")}`]),
    ...(Object.keys(DIRECTIVE_LINES) as DirectiveKey[]).flatMap((key) => {
      const gone = row.directives[key];
      return gone === undefined ? [] : [`${DIRECTIVE_LINES[key]}: ${gone.join(", ")}`];
    }),
  ];
  if (row.kind === "REMOVED") return lost.length === 0 ? `${who} is removed` : `${who} is removed, and with it ${lost.join("; ")}`;
  return `${who} is replaced whole, and its new text does not carry ${lost.join("; ")}`;
}
