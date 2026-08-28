/**
 * The join from a service requirement INTO the authored business tree:
 * `Realizes: <capability-id>#<Requirement-ID>`.
 *
 * This is the axis's load-bearing edge. `Capability:` beside it answers a
 * different question and neither replaces the other — `Capability: checkout`
 * claims a theme, `Realizes: checkout#CHECKOUT-CHARGE-ONCE` claims that this
 * requirement is part of what makes one named promise true. Only the second can
 * be graded in both directions, and both directions are the point: an entry
 * that resolves to nothing, and a capability requirement nothing realizes.
 *
 * WHO WRITES IT. Not the analyst. The analyst writes the capability and its
 * requirements and names no service; whoever implements a service requirement
 * writes the line that says which promise it serves. That is why the line lives
 * on the SERVICE requirement and not as a back-reference in the capability
 * document: a business document must not have to be edited every time a fleet
 * rearranges which service carries which part.
 *
 * WHY NO SEPARATE LINE FOR THE API HOP. A capability requirement reaches its
 * operations by composing this join with the `Operations:` lines that already
 * exist on the requirements realizing it. A third place to keep in sync would
 * buy nothing and could disagree with the two.
 *
 * DELIBERATELY THE NARROWEST LAYER THAT CAN MEAN IT, exactly as
 * `../usecase-join.ts` is: no file is read, no finding is emitted, nothing is
 * thrown, and — the load-bearing part — this package does NOT import
 * `../capabilities.js`. It takes ids somebody else supplies. That keeps the
 * package edge one-way (`capabilities` → `capabilities/realizes`), and it keeps
 * the resolution testable without a filesystem.
 *
 * WHAT THE CALLER STILL OWES. The vocabulary ladder in `../findings.ts` — an
 * absent or unreadable `architecture/capabilities.yaml` means silence, not a
 * fleet full of unresolved joins — is applied BEFORE calling here, and travels
 * as `declared: null`.
 */
import { closeIds } from "../../c4/arch.js";
import { splitRealizesPin } from "../../document/spec.js";
import { compareIds } from "../../repo/entries.js";

/**
 * The separator between the two halves of an entry.
 *
 * A composite entry rather than two lines because a `Requirement-ID` is unique
 * only inside its own document: the capability half is not decoration, it is
 * what makes the target addressable. Two lines would let one requirement name
 * three capabilities and four ids with nothing saying which belongs to which.
 */
export const REALIZES_SEPARATOR = "#";

/** The two halves of one entry, plus the version it was written against. */
export interface RealizesTarget {
  capability: string;
  requirement: string;
  /**
   * The digest of the capability requirement this claim was last pinned to, or
   * `null` for an unpinned entry. Written by `loam rebase --living`, never by
   * hand; `null` is the normal state of a corpus that has not been pinned and
   * grades exactly as it did before pins existed.
   */
  pin: string | null;
}

/**
 * Split one entry, or `null` when it has no two halves.
 *
 * THE LAST SEPARATOR, NOT THE FIRST, and the asymmetry is the reason: the
 * requirement half has a strict grammar (`REQUIREMENT_ID_RE` in
 * `core/document/spec.ts`) that excludes `#`, while the capability half is a
 * YAML key and a directory name and is constrained nowhere. Splitting at the
 * last `#` is therefore unambiguous for every capability id there is;
 * splitting at the first would mis-parse any id containing one, and would do it
 * silently — the failure mode this whole axis exists to refuse.
 *
 * Both halves must be non-empty. `checkout#`, `#CHK-1` and a bare `checkout`
 * are all one answer — `null` — because the fix for all three is the same
 * sentence, and inventing three refusals for one mistake helps nobody.
 */
export function splitRealizesEntry(entry: string): RealizesTarget | null {
  // The pin comes off FIRST. It is a suffix of the whole entry, and leaving it
  // on would put `@<digest>` inside the requirement half, where it would fail
  // to resolve against an id that never contained one.
  const { target, pin } = splitRealizesPin(entry);
  const at = target.lastIndexOf(REALIZES_SEPARATOR);
  if (at <= 0 || at === target.length - 1) return null;
  return { capability: target.slice(0, at), requirement: target.slice(at + 1), pin };
}

/**
 * What the tree declares, as the resolution needs it.
 *
 * The two fields answer different questions and both are needed to tell the
 * failures apart: `declared` is every capability id the fleet knows — the union
 * of the YAML and the tree — while `byCapability` holds only those with a
 * document, since only a document can carry requirements. A capability in
 * `declared` and absent from `byCapability` is declared-but-undocumented, which
 * is a real and common mid-adoption state with a fix of its own.
 */
export interface CapabilityRequirementIndex {
  /**
   * Every declared capability id, or `null` when the vocabulary cannot be
   * graded against at all. `null` and `[]` are never interchangeable — the same
   * distinction `gradableCapabilityIds` draws, for the same reason.
   */
  declared: readonly string[] | null;
  /** Requirement ids per capability that HAS a document. Present-and-empty is a real answer. */
  byCapability: ReadonlyMap<string, ReadonlySet<string>>;
  /**
   * The current `requirementDigest` of each id in `byCapability`, for the pin
   * comparison and nothing else.
   *
   * A second collection over the same keys, which is a shape this codebase
   * otherwise refuses — the justification is that the alternative is worse.
   * Widening `byCapability`'s values to a Map would change what `[...ids]`
   * iterates at four call sites that legitimately want the ids alone, and a
   * silent change of meaning in an existing iteration is a far more expensive
   * mistake than a redundant map built in the same loop. The invariant — same
   * capabilities, same ids, both sides — is asserted by
   * `test/capability-realizes-pin.test.ts` rather than left to a comment.
   */
  digests: ReadonlyMap<string, ReadonlyMap<string, string>>;
}

/**
 * What one `Realizes:` entry joins to. Branch on `kind`; every arm carries the
 * entry it is about, so a message can name it without re-deriving it.
 *
 * Five arms because there are five different fixes. Collapsing them would be
 * cheaper to write and worse to read: "does not resolve" tells an author
 * nothing about whether to declare a capability, write a document, add a
 * requirements section, or correct four characters.
 */
export type RealizesClaim =
  /**
   * Both halves resolve. `stale` is the pin verdict, and it is a THIRD state
   * rather than a boolean: `null` means the entry carries no pin, which is not
   * the same answer as a pin that still matches. Only `true` is a finding.
   */
  | {
      entry: string;
      kind: "resolved";
      capability: string;
      requirement: string;
      pin: string | null;
      /** The target's digest now, or `null` when the index could not supply one. */
      current: string | null;
      stale: boolean | null;
    }
  /** No usable separator — the fix is the spelling of the entry itself. */
  | { entry: string; kind: "malformed" }
  /** Nothing declares the capability half. `close` holds real declared ids. */
  | { entry: string; kind: "unknown-capability"; capability: string; close: string[] }
  /** Declared, but with no `capabilities/<id>/spec.md` — so it has no requirements at all. */
  | { entry: string; kind: "undocumented-capability"; capability: string }
  /** The document exists and declares no requirements yet. */
  | { entry: string; kind: "empty-capability"; capability: string }
  /** The document exists and declares requirements, but not this one. */
  | { entry: string; kind: "unknown-requirement"; capability: string; requirement: string; close: string[] };

/**
 * Resolve every entry, in the order the author wrote them.
 *
 * Order preserved and repeats NOT collapsed, matching the `Capability:` line's
 * behaviour in `../findings.ts` rather than the `#cap-` tag's in
 * `../usecase-join.ts`. The two siblings differ because a tag set is a set —
 * LikeC4 hands it over with no authored order to preserve — while a body line
 * is text somebody typed, and a reader chasing a finding is looking at that
 * text. Consistency with the line beside it is worth more here than a
 * deduplication nobody asked for.
 *
 * An empty result when `declared` is `null` is the ladder, not an answer: there
 * is nothing to grade against, so nothing is graded.
 */
export function resolveRealizes(
  entries: readonly string[],
  index: CapabilityRequirementIndex,
): RealizesClaim[] {
  const { declared, byCapability, digests } = index;
  if (declared === null) return [];
  const known = new Set(declared);

  return entries.map((entry): RealizesClaim => {
    const target = splitRealizesEntry(entry);
    if (target === null) return { entry, kind: "malformed" };
    const { capability, requirement, pin } = target;
    if (!known.has(capability)) {
      return { entry, kind: "unknown-capability", capability, close: closeIds(capability, declared) };
    }
    const ids = byCapability.get(capability);
    if (ids === undefined) return { entry, kind: "undocumented-capability", capability };
    if (ids.size === 0) return { entry, kind: "empty-capability", capability };
    if (ids.has(requirement)) {
      // An index with no digest for a resolved id leaves the verdict UNKNOWN
      // rather than STALE. The two are not the same claim, and a reader who is
      // told a pin went stale because the grader could not compute the other
      // side would be told something false.
      const current = digests.get(capability)?.get(requirement) ?? null;
      const stale = pin === null || current === null ? null : pin !== current;
      return { entry, kind: "resolved", capability, requirement, pin, current, stale };
    }
    return {
      entry,
      kind: "unknown-requirement",
      capability,
      requirement,
      close: closeIds(requirement, [...ids].sort(compareIds)),
    };
  });
}

/**
 * The capabilities an entry list CLAIMS, whether or not each entry resolves.
 *
 * Used to widen the set `capability.unrealized` is taken against, and the
 * widening is a correctness fix rather than a convenience: realizing a
 * capability's requirement IS realizing part of that capability, so an author
 * who wrote only `Realizes:` lines would otherwise be warned that a capability
 * demonstrably realized by their fleet is realized by nobody.
 *
 * Claims from UNRESOLVED entries count too, and that is deliberate. The entry
 * already earns `capability.realizes-unknown`; letting it also produce a
 * spurious `capability.unrealized` would be two findings for one mistake, and
 * the second would point at the analyst's document rather than at the typo.
 */
export function capabilitiesClaimedByRealizes(entries: readonly string[]): string[] {
  return entries.flatMap((entry) => {
    const target = splitRealizesEntry(entry);
    return target === null ? [] : [target.capability];
  });
}
