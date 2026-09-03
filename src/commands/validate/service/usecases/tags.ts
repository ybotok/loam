/**
 * The two tag grades of a SERVICE-LOCAL use case: `usecase.requirement-unresolved`
 * with service-worded arms, and `usecase.capability-unresolved`'s placement arm.
 *
 * Both codes are REUSED from the fleet target rather than minted, under
 * add-error-code's "prefer existing" rule: a caller acts the same way (fix the
 * tag, or the `Requirement-ID:` line it names), and only the sentences differ.
 * The fleet's own graders (`../../fleet/usecases/{requirement,capability}-tag.ts`)
 * are not reused for the sentences, because every one of theirs names a
 * capability document, and a service-local flow has none.
 *
 * WHY `#req-` IS SCOPED BY THE SERVICE. Inside `architecture/`, a `#req-` tag
 * means nothing until a `#cap-` tag has said which capability document the
 * `Requirement-ID` is unique inside. Beside a model there is no such question:
 * the directory IS the scope, and the ids are the ones THIS service's `spec.md`
 * and `arch.spec.md` declare — the flow keeps a container-level promise the way
 * a fleet flow keeps a business one. The join is `resolveRequirementTags` with
 * the service as its one-element scope, so the arms fall out mechanically and
 * `unscoped` is unreachable.
 *
 * WHY `#cap-` IS REFUSED, NOT IGNORED AND NOT RESOLVED. A capability is
 * realized by a hop sequence across the fleet map — "the only join that
 * crosses services" — and `keptBy` reads the fleet project only. Ignoring the
 * tag would leave `#cap-checkout` on a service flow green and silently unread;
 * resolving it against the vocabulary would make validate see a claim no other
 * surface sees. So it is refused by PLACEMENT, whether or not
 * `architecture/capabilities.yaml` exists: the reason is where the tag sits,
 * not what the vocabulary says. The view stays opted in and its steps are
 * graded — either prefix is the opt-in, exactly as at fleet altitude.
 */
import {
  CAP_TAG_PREFIX,
  REQ_TAG_PREFIX,
  resolveRequirementTags,
  tagSlug,
  type RequirementClaim,
} from "../../../../core/capabilities/usecase-join.js";
import type { ParsedView } from "../../../../core/c4/parsed/dynamic-views.js";
import { compareIds } from "../../../../core/repo/entries.js";
import type { Finding } from "../../../../core/vocabulary/report.js";

/** What the tag grades resolve against: the service, and its own identified requirements. */
export interface ServiceTagScope {
  service: string;
  /** Repo-relative tree path of the service directory, for the sentences. */
  treePath: string;
  /**
   * Every `Requirement-ID` this service's spec.md (living, REMOVED skipped) and
   * arch.spec.md declare, or `undefined` when NEITHER document exists — the
   * same two answers `requirementsOf` gives one join over: no document at all,
   * against documents declaring no identified promise yet.
   */
  requirementIds: ReadonlySet<string> | undefined;
}

/** A `Requirement-ID` as an author must write it in a tag: `PAY.AUTH (#req-PAY-AUTH)`. */
function idAndTag(id: string): string {
  return `${id} (#${REQ_TAG_PREFIX}${tagSlug(id)})`;
}

/**
 * The fix for one unresolved claim, in the service's own vocabulary. The same
 * arms the fleet grade has, each sentence pointing at the document that
 * carries the fix here — spec.md and arch.spec.md, never a capability.
 */
function advice(claim: Exclude<RequirementClaim, { kind: "resolved" }>, scope: ServiceTagScope): string {
  const where = `${scope.service} (spec.md or arch.spec.md)`;
  switch (claim.kind) {
    case "unscoped":
      // Unreachable: the scope is always exactly one service. A sentence
      // rather than a throw, because this runs inside a validate run over
      // somebody's fleet, and a broken invariant there is one finding, not a
      // crash.
      return "the flow could not be scoped to this service — report this: a service-local flow is always scoped to its own directory.";
    case "undocumented":
      return (
        `${scope.treePath}/ has no spec.md and no arch.spec.md, so it carries no requirements to satisfy. ` +
        "Write the requirement first — a flow keeps a promise a document makes."
      );
    case "empty":
      return (
        `${scope.service}'s spec.md and arch.spec.md declare no \`Requirement-ID:\` at all — a #req- tag joins by ` +
        "stable id, and a requirement without one cannot be named by a flow. Add `Requirement-ID: <id>` to the " +
        "requirement this flow keeps."
      );
    case "none":
      return claim.close.length > 0
        ? `no requirement of ${where} flattens to '${claim.slug}'. Did you mean: ${claim.close.map(idAndTag).join(", ")}?`
        : `no requirement of ${where} flattens to '${claim.slug}' — check the \`Requirement-ID:\` lines in both documents.`;
    default:
      return (
        `${claim.ids.length} requirements of ${scope.service} flatten to '${claim.slug}' (${claim.ids.join(", ")}) — ` +
        "a Requirement-ID is unique inside ONE document and this service has two, so nothing in the tag can say " +
        "which promise the flow keeps. Rename one of them."
      );
  }
}

/**
 * One finding per `#req-` tag that does not resolve against the service's own
 * ids — never one per view, for the fleet grade's reason: several `#req-` tags
 * on one view are legal and normal, and a broken tag beside a working one must
 * neither swallow the break nor lose the promise the view genuinely keeps.
 */
function requirementFindings(view: ParsedView, scope: ServiceTagScope, place: string): Finding[] {
  const findings: Finding[] = [];
  for (const claim of resolveRequirementTags(view.tags, [scope.service], () => scope.requirementIds)) {
    if (claim.kind === "resolved") continue;
    findings.push({
      severity: "error",
      code: "usecase.requirement-unresolved",
      // The VIEW, not the tag, as at fleet altitude: a subject is what a reader
      // goes and opens, and one broken use case counts once however many of
      // its tags are wrong.
      subject: view.id,
      message: `${place} is tagged #${claim.tag}, and it does not resolve: ${advice(claim, scope)}`,
    });
  }
  return findings;
}

/**
 * One finding per `#cap-` tag the view carries — the placement refusal. Sorted
 * and de-duplicated for `resolveCapabilityTags`' reason: nothing in loam has
 * measured that LikeC4 preserves the author's tag order, and one breach earns
 * one finding.
 */
function capabilityFindings(view: ParsedView, place: string): Finding[] {
  const claimed = [...new Set(view.tags.filter((tag) => tag.startsWith(CAP_TAG_PREFIX)))].sort(compareIds);
  return claimed.map((tag) => ({
    severity: "error",
    code: "usecase.capability-unresolved",
    subject: view.id,
    message:
      `${place} is tagged #${tag} inside this service's own project, where no capability can be claimed: ` +
      "a capability is a fleet promise, and only a flow in architecture/usecases/ can keep one; a flow beside " +
      "model.likec4 keeps THIS service's promises (#req-<Requirement-ID>). Drop the tag: the capability's promise " +
      "is kept by the fleet flow that calls this service, and this flow is the hop sequence inside it.",
  }));
}

/** Every tag finding one service-local view earns: the placement refusals first, then the requirement claims. */
export function serviceTagFindings(view: ParsedView, scope: ServiceTagScope, place: string): Finding[] {
  return [...capabilityFindings(view, place), ...requirementFindings(view, scope, place)];
}
