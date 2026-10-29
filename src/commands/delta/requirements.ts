/**
 * The requirement items of `loam delta`'s brief.
 *
 * Split from `./delta.ts`, where the serialization was a closure inside the
 * command's action, so that the item has a home of its own beside the command
 * rather than in the middle of it.
 */
import { type Requirement } from "../../core/document/spec.js";
import { type ScenarioAxis } from "../../core/gherkin/digest.js";
import { scenarioDigest } from "../../core/gherkin/stamp.js";

/**
 * One requirement, verbatim. `axis` and `service` both ride in, because the
 * scenario digest is salted by BOTH — the same Given/When/Then under `spec.md`
 * and under `arch.spec.md` are two different claims, and one hash for both
 * would let a green business run answer an integration test nobody wrote
 * (core/gherkin/digest.ts owns that reasoning and the recipe).
 */
export function requirementJson(r: Requirement, axis: ScenarioAxis, service: string): Record<string, unknown> {
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
