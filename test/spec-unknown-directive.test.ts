/**
 * `spec.unknown-directive` — the one place the corpus was quieter than it looked.
 *
 * Every join loam checks is an existence constraint over a PARSED value, so a
 * body line the parser did not recognise produces no value, no join, and
 * therefore no finding. `Realises:`, `Capabilties:` and `Require:` all read as
 * ordinary prose, and every downstream check stays green because there is
 * nothing to fail. A requirement can claim to realize a promise, publish an
 * event and require a permission, get none of it, and validate clean.
 *
 * Two properties are pinned, and the second is the one that decides whether the
 * check is worth having at all:
 *
 * 1. A near miss is reported, with the directive it was near.
 * 2. Ordinary prose keys are NOT. The pilot's exit criterion caps false
 *    positives at 10% of classified findings, and a grammar guard that fires on
 *    `Note:` or `Context:` would spend that budget by itself. The negative cases
 *    below are the check's real specification.
 *
 * The third test is the anti-drift one: the did-you-mean list is the only half
 * of this check that is not derived from the parser's own patterns, so every
 * name in it is asserted to actually BE a directive.
 */
import { describe, expect, it } from "vitest";
import {
  DIRECTIVE_NAMES,
  unknownDirectiveFindings,
} from "../src/commands/validate/service/specs.js";
import { parseRequirements } from "../src/core/document/parse.js";

const TARGET = { where: "payment-service: spec.md", subject: "payment-service" };

function findingsFor(...bodyLines: string[]): { code: string; message: string }[] {
  const doc = [
    "## Requirements",
    "",
    "### Requirement: Authorize a payment",
    "",
    "Requirement-ID: PAY-AUTH",
    "The service SHALL reserve funds.",
    ...bodyLines,
    "",
    "#### Scenario: Works",
    "- **Given** a card",
    "- **Then** funds are held",
    "",
  ].join("\n");
  return unknownDirectiveFindings(parseRequirements(doc), TARGET);
}

describe("spec.unknown-directive", () => {
  it("reports a key one or two edits from a directive, and names it", () => {
    const realises = findingsFor("Realises: checkout#CHK-1");
    expect(realises).toHaveLength(1);
    expect(realises[0]!.code).toBe("spec.unknown-directive");
    expect(realises[0]!.message).toContain("'Realises:'");
    expect(realises[0]!.message).toContain("`Realizes:`");

    // The failure mode that motivated the check: a join that silently does not
    // exist, in a document that validates clean.
    expect(findingsFor("Capabilties: checkout")).toHaveLength(1);
    expect(findingsFor("Opertaions: authorizePayment")).toHaveLength(1);
    expect(findingsFor("Publsihes: payment.Authorized")).toHaveLength(1);
  });

  it("stays silent on every spelling the parser actually accepts", () => {
    // Singular/plural alternatives, and case, are the grammar's own — the
    // recognition half reads the parser's patterns, so none of these may fire.
    expect(
      findingsFor(
        "Operations: authorizePayment",
        "Operation: authorizePayment",
        "Covers: paymentService.outbox",
        "Cover: paymentService.outbox",
        "Requires: service/payments:capture",
        "Require: service/payments:capture",
        "Publishes: payment.Authorized",
        "Consumes: order.Placed",
        "Capability: checkout",
        "Capabilities: checkout",
        "Realizes: checkout#CHK-1",
        "requirement-id: PAY-AUTH",
        "BASED-ON: 0123456789abcdef",
      ),
    ).toEqual([]);
  });

  it("stays silent on ordinary prose keys", () => {
    // `Context` shares three leading characters with `Consumes`, which is
    // exactly why this check measures edit distance instead of reusing
    // `closeIds`. If this test ever fails, the threshold has been loosened and
    // the check has started costing more than it finds.
    expect(
      findingsFor(
        "Context: this endpoint predates the split.",
        "Note: the retry budget is documented in the runbook.",
        "Owner: payments-team",
        "Rationale: the outbox keeps the two writes in one transaction.",
        "Example: a timeout-and-retry must not reserve twice.",
        "Status: draft",
        "See: ADR 0002",
      ),
    ).toEqual([]);
  });

  it("keeps the did-you-mean list to names that really are directives", () => {
    // The recognition half derives from the parser's patterns; this list does
    // not. A name that stops being a directive must fail here rather than go on
    // being suggested as the fix for a typo.
    for (const name of DIRECTIVE_NAMES) {
      expect(findingsFor(`${name}: something`), `${name} should be a real directive`).toEqual([]);
    }
  });

  it("says nothing about a REMOVED requirement", () => {
    const doc = [
      "## REMOVED Requirements",
      "",
      "### Requirement: Authorize a payment",
      "",
      "Requirement-ID: PAY-AUTH",
      "Realises: checkout#CHK-1",
      "",
    ].join("\n");
    expect(unknownDirectiveFindings(parseRequirements(doc), TARGET)).toEqual([]);
  });
});
