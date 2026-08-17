/**
 * The scenario-identity digest — ONE recipe with three consumers, deliberately
 * in one module: `verify/checklist.ts` folds it into `scenario.tested` claim
 * ids and claim digests, and `./stamp.ts` stamps the same hex as the
 * `@loam-digest-…` tag on every generated scenario, which is what a cucumber
 * report carries and what `verify --results` matches on. A second spelling of
 * the hash would silently stop every scenario claim from being answerable by a
 * run — which is why this lives beside the stamper rather than inside either
 * consumer.
 */
import { createHash } from "node:crypto";

/** The axis a scenario's words live on: `spec.md` or `arch.spec.md`. */
export type ScenarioAxis = "business" | "arch";

/**
 * The full sha256 of a scenario's body — its lines joined and edge-trimmed,
 * exactly as `serializeRequirements` frames them. The BODY, not the title,
 * because rewriting the Given/When/Then under an unchanged heading is new text
 * nobody answered for, and the promise — rewording a scenario renames its
 * claim — has to hold for the words that actually specify the behaviour.
 *
 * `scenario.tested` claim ids fold in a prefix of this hex, a claim's `digest`
 * and the `@loam-digest-<16hex>` tag `loam gherkin` stamps both take another
 * (`verify/checklist.ts` owns those lengths, `./stamp.ts` its own) — so the
 * claim, the stamp and the report `--results` reads can never disagree about
 * what a scenario says.
 *
 * The identity is (SERVICE, AXIS, body), and both salts are there for the same
 * reason: a digest that spans two namespaces lets one green run answer a
 * question nobody ran a test for.
 *
 * - The AXIS salt keeps `spec.md` and `arch.spec.md` apart. Without it a green
 *   BUSINESS run answered the arch claim too — an integration test nobody wrote
 *   read as run.
 * - The SERVICE salt keeps two repositories apart. Different services can word
 *   "the service returns 404 for an unknown id" identically; unsalted, those
 *   scenarios share one digest and one repository's green run can appear to
 *   confirm claims from suites that never ran each other's tests.
 *
 * The service salt is what makes that case CORRECT rather than merely refused:
 * `contestedDigests` could only decline to answer a shared digest, which left a
 * fleet with ordinary repeated wording holding claims nothing could ever
 * answer.
 *
 * Both salts renamed every claim id and every stamped tag on the day they
 * landed, and both readings are legible rather than silent: an existing
 * `verification.yaml` answers a checklist digest that is no longer derived and
 * reports STALE, and an existing generated `.feature` carries digests the
 * living spec no longer computes and reports `gherkin.stale` beside the
 * `gherkin.missing` for the new ones. One `loam gherkin` and one re-record
 * clear both.
 */
export function scenarioBodyHash(
  service: string,
  lines: string[],
  axis: ScenarioAxis = "business",
): string {
  // NUL-separated like claimId's tuples (verify/checklist.ts), and for its
  // reason: no body can spell the salt in front of it, so the namespaces stay
  // disjoint. Spelled as an escape and never as a raw NUL in the literal — a
  // raw one makes this file read as `data` to `file(1)` and invisible to
  // `grep`.
  const body = lines.join("\n").trim();
  const onAxis = axis === "arch" ? `arch.spec.md\u0000${body}` : body;
  return createHash("sha256").update(`${service}\u0000${onAxis}`).digest("hex");
}
