/**
 * The `Realizes:` grades, both directions: an entry that resolves to nothing,
 * and a capability requirement nothing realizes.
 *
 * Values only — core never prints — and the join rule shaped twice (Finding for
 * validate, Issue for coherence) from ONE message builder, exactly as
 * `../findings.ts` does for `capability.unknown`. Two shapes over one sentence
 * is the only arrangement in which a finding an author reads at the service
 * target and the refusal they hit at `loam archive` cannot describe the same
 * breach differently.
 *
 * WHY THE DELTA SIDE GATES ARCHIVE. A delta requirement whose `Realizes:` entry
 * resolves to nothing would merge a join pointing at a promise that does not
 * exist, and the living document would then carry it looking exactly like a
 * working join — the same argument that made `capability.unknown` a gate.
 * `--approve` overrides it like any other error.
 */
import { compareIds } from "../../repo/entries.js";
import type { Requirement } from "../../document/spec.js";
import type { Finding } from "../../vocabulary/report.js";
import type { Issue } from "../../vocabulary/issue.js";
import { resolveRealizes, type CapabilityRequirementIndex, type RealizesClaim } from "./join.js";

/** Which document is being graded, and under whose name the finding is filed. */
export interface RealizesTargetDoc {
  where: string;
  subject: string;
}

/**
 * An entry that did NOT resolve. Spelled as an exclusion rather than as a
 * second union so the arms cannot drift: adding a failure kind to
 * `RealizesClaim` makes `advice` below fail to compile until it says what to do
 * about it, which is exactly the reminder a new failure mode deserves.
 */
type UnresolvedClaim = Exclude<RealizesClaim, { kind: "resolved" }>;

/**
 * The fix for one unresolved entry, as a sentence. Five arms, five different
 * repairs — the whole reason `RealizesClaim` is not collapsed to a boolean.
 */
function advice(claim: UnresolvedClaim): string {
  switch (claim.kind) {
    case "malformed":
      return (
        "an entry names a capability requirement and is spelled `<capability-id>#<Requirement-ID>` — " +
        "the capability half addresses the document, because a Requirement-ID is unique only inside its own. " +
        "To claim a theme rather than a promise, use the `Capability:` line instead"
      );
    case "unknown-capability":
      return claim.close.length > 0
        ? `no such capability is declared. Did you mean: ${claim.close.join(", ")}?`
        : "no such capability is declared — declare it in architecture/capabilities.yaml, " +
            `write capabilities/${claim.capability}/spec.md, or fix the spelling`;
    case "undocumented-capability":
      return (
        `capability '${claim.capability}' is declared but has no capabilities/${claim.capability}/spec.md, ` +
        "so it carries no requirements to realize. Write the document — a name alone can be claimed with " +
        "`Capability:`, but only a document can be realized"
      );
    case "empty-capability":
      return (
        `capabilities/${claim.capability}/spec.md exists and declares no requirements yet — ` +
        "add the `## Requirements` section, each requirement carrying its `Requirement-ID:`"
      );
    case "unknown-requirement":
      return claim.close.length > 0
        ? `capabilities/${claim.capability}/spec.md declares no requirement with that id. Did you mean: ${claim.close.join(", ")}?`
        : `capabilities/${claim.capability}/spec.md declares no requirement with that id — ` +
            "check the `Requirement-ID:` lines in that document";
  }
}

function unresolvedMessage(where: string, requirement: string, claim: UnresolvedClaim): string {
  return `${where}: requirement '${requirement}' — Realizes: '${claim.entry}' does not resolve: ${advice(claim)}`;
}

/** One unresolved entry, with the requirement that wrote it. */
interface Unresolved {
  requirement: string;
  claim: UnresolvedClaim;
}

/**
 * Non-REMOVED requirements' entries that do not resolve — or nothing at all
 * when the vocabulary cannot be graded against, which `resolveRealizes` answers
 * by returning no claims.
 *
 * REMOVED is skipped for the reason its `Capability:` sibling skips it: a
 * requirement on its way out of the living document is not making a claim about
 * the future, and grading its joins would refuse the very change that removes
 * the last consumer of a retired capability requirement.
 */
function unresolvedEntries(reqs: Requirement[], index: CapabilityRequirementIndex): Unresolved[] {
  const out: Unresolved[] = [];
  for (const r of reqs) {
    if (r.kind === "REMOVED") continue;
    for (const claim of resolveRealizes(r.realizes, index)) {
      if (claim.kind !== "resolved") out.push({ requirement: r.name, claim });
    }
  }
  return out;
}

/**
 * `capability.realizes-unknown` as validate sees it — an ERROR, the grade its
 * two siblings already carry: a join that resolves to nothing reads exactly
 * like a working one in the requirement, in the rollup and in every answer
 * built over either.
 */
export function realizesUnknownFindings(
  reqs: Requirement[],
  target: RealizesTargetDoc,
  index: CapabilityRequirementIndex,
): Finding[] {
  return unresolvedEntries(reqs, index).map((u) => ({
    severity: "error" as const,
    code: "capability.realizes-unknown",
    subject: target.subject,
    message: unresolvedMessage(target.where, u.requirement, u.claim),
  }));
}

/** The same rule shaped as coherence Issues, for a feature's delta documents — see the module comment. */
export function realizesUnknownIssues(
  reqs: Requirement[],
  target: RealizesTargetDoc,
  index: CapabilityRequirementIndex,
): Issue[] {
  return unresolvedEntries(reqs, index).map((u) => ({
    severity: "error" as const,
    code: "capability.realizes-unknown" as const,
    subject: target.subject,
    message: unresolvedMessage(target.where, u.requirement, u.claim),
  }));
}

/** One capability requirement nothing realizes, located exactly. */
export interface UnrealizedRequirement {
  capability: string;
  /** Its `Requirement-ID:`. */
  id: string;
  /** Its `### Requirement:` heading, for a reader who has the document open. */
  name: string;
}

/**
 * `capability.requirement-unrealized` — ONE warn per capability requirement no
 * living service requirement's `Realizes:` line names.
 *
 * The sharper half of the axis, and the reason the join was worth building.
 * `capability.unrealized` already says a whole capability is claimed by nobody,
 * which is the loud case somebody notices; this says the fleet claims the
 * capability and has left one named promise inside it unimplemented — the case
 * that survives every rollup, because the capability's OTHER requirements make
 * its row look healthy.
 *
 * Warn rather than error, and per requirement rather than one rollup finding
 * with details[]: an analyst writing next quarter's promises before anybody
 * implements them is the normal, intended use of the document, and a corpus
 * that fails the gate the moment it is written ahead of the fleet is a corpus
 * nobody writes ahead. Subject is `<capability>#<id>` — the entry an author
 * would type to fix it, which is the string they should be able to copy.
 */
export function requirementUnrealizedFindings(unrealized: UnrealizedRequirement[]): Finding[] {
  return [...unrealized]
    .sort((a, b) => compareIds(a.capability, b.capability) || compareIds(a.id, b.id))
    .map((u) => ({
      severity: "warn" as const,
      code: "capability.requirement-unrealized",
      subject: `${u.capability}#${u.id}`,
      message:
        `landscape: capabilities/${u.capability}/spec.md — '${u.name}' (${u.id}) is realized by no living requirement: ` +
        `no service's \`Realizes:\` line names ${u.capability}#${u.id}. ` +
        "Either the promise is not implemented yet, or the requirements that implement it have not said so — " +
        "add the line to each service requirement that carries part of it",
    }));
}
