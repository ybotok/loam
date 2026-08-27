/**
 * The fleet gate's guard against a tag loam grades on exempting a service.
 *
 * LikeC4 1.59.0 added tags in the specification block, and 1.59.2 applies them
 * before loam sees anything: `specification { element softwareSystem {
 * #external } }` makes EVERY softwareSystem in the document carry `#external`,
 * on `Elem.tags`, indistinguishable from a tag somebody wrote on the element.
 *
 * loam reads `#external` as "deliberately not ours — stop grading it". So those
 * six words switched the landscape↔services reconciliation off for the whole
 * fleet, and the gate then printed `landscape.matched` — "N service(s) modelled
 * … and services/ agree" — over a map it had stopped checking. That is the worst
 * failure this product has: not a wrong answer, but a green one.
 *
 * ## Why this is not simply "refuse a graded tag on a kind"
 *
 * Because a graded tag on a kind is a pattern loam DOCUMENTS and the shipped
 * example depends on. `examples/docs/architecture/landscape.likec4` declares
 *
 *     element topic { #external #platform style { shape queue } }
 *
 * so that the Kafka topics nested inside an external broker do not each demand a
 * `services/payment.events/` nobody owes. Every `topic` is foreign by
 * construction; saying so once on the kind is the spelling that scales, and
 * test/landscape.test.ts has pinned it since long before kind tags existed.
 * Refusing that would be loam breaking its own published fleet map.
 *
 * The line is therefore not WHERE the tag is written but WHAT it exempts:
 *
 *  - a kind whose elements stand for nothing in `services/` — `topic`,
 *    `externalSystem`, `saasVendor` — is the legitimate idiom, and silent here;
 *  - a kind whose elements stand for a REAL `services/<id>/` directory, by an
 *    explicit `metadata { service }` binding or by a title naming one, is the
 *    fail-open. That element is provably ours and provably exempted, and loam
 *    has just been told to stop grading the thing it exists to grade.
 *
 * The second case is also exactly where the suppression reaches ERROR severity:
 * `landscape.binding-unknown` — a binding naming a directory that does not exist
 * — is skipped for `#external` elements, and only a bound element can raise it.
 *
 * Two further limits, both deliberate:
 *
 *  - Only the tags in `GRADED_TAGS`. A kind declaring `#tier1` or `#legacy` is
 *    ordinary LikeC4 that loam does not read, and refusing it would be loam
 *    inventing a rule about somebody else's vocabulary.
 *  - Relationship kinds are not graded. loam reads no relationship tag on the
 *    landscape — `#external` and `#platform` are asked of elements only — so a
 *    relationship kind declaring one changes no conclusion. The relationship
 *    half of the same defect bites on the FEATURE tag at archive time, and is
 *    refused there (`commands/archive/plan/landscape.ts`), where it costs
 *    something.
 *
 * A residual is accepted knowingly: a kind-wide graded tag over elements that
 * stand for no directory still silences `landscape.service-undocumented` for
 * them. That is the `topic` idiom's whole purpose, and it cannot be told from
 * abuse without loam guessing which foreign systems somebody meant to adopt.
 * `landscape.service-unmodelled` — the ERROR that a `services/<id>/` is undrawn
 * — reads no tags at all, so the fleet's own directories are never exempted by
 * any of this.
 */
import type { Elem } from "../../../core/c4/likec4.js";
import type { DocSpecification } from "../../../core/c4/parsed/specification.js";
import { GRADED_TAGS } from "../../../core/vocabulary/maturity.js";
import { type Finding } from "../../../core/vocabulary/report.js";
import { standsForService } from "./census.js";

export interface KindTagInput {
  /** The landscape's own specification block; absent for a document that did not parse. */
  specification: DocSpecification | undefined;
  /** Every element the landscape declares, at any depth. */
  elements: Elem[];
  /** The `services/<id>/` directories that exist — what "ours" is measured against. */
  services: ReadonlySet<string>;
}

/**
 * One finding per (kind, graded tag) whose elements include something that
 * stands for a real service directory. An ERROR, not a warning: the whole point
 * is that the run must not be able to end green, and a warning leaves exit code
 * 0 for every caller not passing `--strict`.
 */
export function kindTagFindings(input: KindTagInput): Finding[] {
  const { specification, elements, services } = input;
  if (specification === undefined) return [];
  const findings: Finding[] = [];
  for (const [kind, tags] of Object.entries(specification.elementKindTags)) {
    const graded = tags.filter((t) => GRADED_TAGS.includes(t));
    if (graded.length === 0) continue;
    const ours = elements.filter((e) => e.kind === kind && standsForService(e, services));
    if (ours.length === 0) continue;
    const named = ours.slice(0, 3).map((e) => `'${e.title}'`).join(", ");
    for (const tag of graded) {
      findings.push({
        severity: "error",
        code: "landscape.kind-tag-graded",
        subject: kind,
        message:
          `landscape: the specification declares '#${tag}' on element kind '${kind}', so every '${kind}' ` +
          `inherits it — including ${ours.length} that stand(s) for a services/ directory of ours ` +
          `(${named}${ours.length > 3 ? ", …" : ""}). loam reads '#${tag}' as "not ours, stop grading", so the ` +
          `landscape↔services checks are silenced for exactly the elements they exist for. Remove '#${tag}' from ` +
          `the kind and write it on the individual elements that really are foreign — or, if every '${kind}' is ` +
          `foreign, stop drawing our services as one.`,
      });
    }
  }
  return findings;
}
