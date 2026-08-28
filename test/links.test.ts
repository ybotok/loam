/**
 * `link.unresolved` and `link.unreadable` — the join loam had written down and
 * never read.
 *
 * The convention (standard markdown links, relative-path targets) has been in
 * SCHEMA.md and the generated AGENTS.md since the fleet-ADR work, and both said
 * in as many words that nothing validated it. These tests are what makes that
 * sentence false, and each one is here to fail against a plausible wrong
 * implementation rather than to restate the right one.
 *
 * A NAIVE REGEX IS THE WRONG IMPLEMENTATION, and two cases prove it, both of
 * which occur in loam's own generated prose: the fenced block where a document
 * SHOWS the link format, and the inline code span where prose quotes a path.
 * Grading either convicts a document for explaining the convention.
 *
 * WHAT IS NOT GRADED IS AS LOAD-BEARING AS WHAT IS. A target outside the docs
 * repo has no answer here — a docs repo is routinely checked out beside nothing
 * else — and a check that answered anyway would report a service's own
 * repository as missing. That exclusion is what lets the finding be an error.
 *
 * THE CORPUS REACHES THE FILES LOAM ONLY EVER COUNTED. ADRs and runbooks are
 * the documents the convention was written for, and reading them at all is new,
 * which is why an undecodable one must name itself instead of blanking its
 * service's whole report through `report.ts`'s `guarded`.
 */
import { describe, expect, it, afterEach } from "vitest";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { coherentFixture, makeProject, runLoam, type Project } from "./helpers/harness.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!();
});

async function project(files: Record<string, string>): Promise<Project> {
  const p = await makeProject(files, { service: "payment-service" });
  cleanups.push(() => p.destroy());
  return p;
}

/** Findings of one code from a `--json` validate run. */
async function findings(
  p: Project,
  code: string,
  ...args: string[]
): Promise<Array<{ subject?: string; message: string; details?: string[] }>> {
  const res = await runLoam(p.workDir, "validate", ...args, "--json");
  const doc = JSON.parse(res.stdout);
  const targets: Array<{ findings: Array<{ code: string; subject?: string; message: string; details?: string[] }> }> =
    doc.targets ?? [];
  return targets.flatMap((t) => t.findings.filter((f) => f.code === code));
}

/** Every broken-link detail line a run produced, flattened. */
async function broken(p: Project, ...args: string[]): Promise<string[]> {
  return (await findings(p, "link.unresolved", ...args)).flatMap((f) => f.details ?? []);
}

/** The living spec, with `body` appended after the requirements — the prose slot links live in. */
function specWith(body: string): string {
  return `---
service: payment-service
status: verified
---

# payment-service

## Requirements

### Requirement: Authorize a payment
The service SHALL authorize a payment before capture.

Operations: authorizePayment

#### Scenario: Successful authorization
- **Given** a valid card
- **When** authorization is requested
- **Then** the payment is authorized

## Notes

${body}
`;
}

const ADR = `# 0001 — Payments outbox

Status: accepted

The service SHALL publish through a transactional outbox.
`;

describe("a markdown link is a join, and loam resolves it", () => {
  it("a link that resolves is silent; one that does not is an error naming file and line", async () => {
    const p = await project({
      ...coherentFixture(),
      "services/payment-service/adrs/0001-outbox.md": ADR,
      "services/payment-service/spec.md": specWith(
        "See [the outbox](adrs/0001-outbox.md), and [the other one](adrs/0002-gone.md).",
      ),
    });
    const found = await findings(p, "link.unresolved", "--all");
    expect(found).toHaveLength(1);
    expect(found[0]!.subject).toBe("payment-service");
    // The resolving link must be absent from the details, not merely
    // outnumbered by them: a resolver that reported every link would still
    // produce one finding on this fixture.
    expect(found[0]!.details).toEqual([
      "services/payment-service/spec.md:22: [the other one](adrs/0002-gone.md)",
    ]);
    const run = await runLoam(p.workDir, "validate", "--all", "--json");
    expect(run.code, run.out).toBe(1);
  });

  it("a document's broken links are ONE finding, however many there are", async () => {
    const p = await project({
      ...coherentFixture(),
      "services/payment-service/spec.md": specWith(
        "[a](a.md) then [b](b.md) then [c](c.md)",
      ),
    });
    const found = await findings(p, "link.unresolved", "--all");
    expect(found).toHaveLength(1);
    expect(found[0]!.details).toHaveLength(3);
    expect(found[0]!.message).toContain("3 markdown link(s)");
  });

  it("a reference definition is the same join written at the bottom of the file", async () => {
    const p = await project({
      ...coherentFixture(),
      "services/payment-service/spec.md": specWith("The decision is [recorded][adr].\n\n[adr]: adrs/0001-gone.md"),
    });
    expect(await broken(p, "--all")).toEqual([
      "services/payment-service/spec.md:24: [adr](adrs/0001-gone.md)",
    ]);
  });

  it("a fragment addresses a heading in a file that must still exist", async () => {
    const p = await project({
      ...coherentFixture(),
      "services/payment-service/adrs/0001-outbox.md": ADR,
      "services/payment-service/spec.md": specWith(
        "[here](adrs/0001-outbox.md#status) and [there](adrs/0002-gone.md#status)",
      ),
    });
    // The anchor half is NOT graded (that is a different question), so the
    // first link is silent and only the missing file is named — with the
    // fragment kept in the quoted text, because that is what the author typed.
    expect(await broken(p, "--all")).toEqual([
      "services/payment-service/spec.md:22: [there](adrs/0002-gone.md#status)",
    ]);
  });

  it("a percent-escaped target is the path an editor writes for a name with a space", async () => {
    const p = await project({
      ...coherentFixture(),
      "services/payment-service/adrs/0001 outbox.md": ADR,
      "services/payment-service/spec.md": specWith("[decision](adrs/0001%20outbox.md)"),
    });
    expect(await broken(p, "--all")).toEqual([]);
  });
});

describe("what is not a link, and what has no answer here", () => {
  it("a fenced block is where a document SHOWS the convention — it is not graded", async () => {
    const p = await project({
      ...coherentFixture(),
      "services/payment-service/spec.md": specWith(
        "Write links like this:\n\n```markdown\n[an example](../../architecture/nothing.md)\n```\n",
      ),
    });
    expect(await broken(p, "--all")).toEqual([]);
  });

  it("an inline code span is prose ABOUT a link", async () => {
    const p = await project({
      ...coherentFixture(),
      "services/payment-service/spec.md": specWith("Write `[Order](../../glossary/order.md)` to cite a term."),
    });
    expect(await broken(p, "--all")).toEqual([]);
  });

  it("a code span does not swallow a real link later on the same line", async () => {
    // The cheap reading of the test above is "skip any line holding a
    // backtick", which passes it and fails this one: the span is blanked in
    // place, so everything else on the line is still read.
    const p = await project({
      ...coherentFixture(),
      "services/payment-service/spec.md": specWith("Write `[Order](order.md)` — see [the guide](guide.md)."),
    });
    expect(await broken(p, "--all")).toEqual([
      "services/payment-service/spec.md:22: [the guide](guide.md)",
    ]);
  });

  it("an absolute URL, a mailto, a bare anchor and a root-relative path are not filesystem questions", async () => {
    const p = await project({
      ...coherentFixture(),
      "services/payment-service/spec.md": specWith(
        "[docs](https://example.com/x.md) [mail](mailto:team@example.com) [top](#requirements) [site](/style.md)",
      ),
    });
    expect(await broken(p, "--all")).toEqual([]);
  });

  it("a target outside the docs repo is not graded — the tree it names may not be checked out", async () => {
    const p = await project({
      ...coherentFixture(),
      "services/payment-service/spec.md": specWith("[the code](../../../payment-svc/README.md)"),
    });
    expect(await broken(p, "--all")).toEqual([]);
  });

  it("a link to a directory resolves", async () => {
    const p = await project({
      ...coherentFixture(),
      "services/payment-service/adrs/0001-outbox.md": ADR,
      "services/payment-service/spec.md": specWith("[every decision](adrs/)"),
    });
    expect(await broken(p, "--all")).toEqual([]);
  });
});

describe("the corpus: which documents are asked", () => {
  it("an ADR's links are graded — the documents the convention was written for", async () => {
    const p = await project({
      ...coherentFixture(),
      "services/payment-service/adrs/0001-outbox.md": `${ADR}\nSupersedes [0000](0000-gone.md).\n`,
    });
    expect(await broken(p, "--all")).toEqual([
      "services/payment-service/adrs/0001-outbox.md:7: [0000](0000-gone.md)",
    ]);
  });

  it("a runbook's links are graded", async () => {
    const p = await project({
      ...coherentFixture(),
      "services/payment-service/runbook.md": "# Runbook\n\nOn page: [the alert](../../architecture/alerts.md).\n",
    });
    expect(await broken(p, "--all")).toEqual([
      "services/payment-service/runbook.md:3: [the alert](../../architecture/alerts.md)",
    ]);
  });

  it("a feature's intent and spec deltas are graded on the FEATURE target", async () => {
    const p = await project({
      ...coherentFixture(),
      "features/FEAT-1-split/intent.md": `---\nfeature: FEAT-1\nstatus: proposed\n---\n\n# Split payments\n\nWhy: [the decision](adrs/0001-gone.md).\n`,
    });
    const found = await findings(p, "link.unresolved", "--all");
    expect(found).toHaveLength(1);
    expect(found[0]!.subject).toBe("FEAT-1");
    expect(found[0]!.details).toEqual(["features/FEAT-1-split/intent.md:8: [the decision](adrs/0001-gone.md)"]);
  });

  it("the fleet's own ADRs are graded once, on the landscape target, and never per service", async () => {
    const p = await project({
      ...coherentFixture(),
      "architecture/adrs/0001-outbox.md": `${ADR}\nSee [the map](landscape.likec4).\n`,
    });
    const all = await findings(p, "link.unresolved", "--all");
    expect(all).toHaveLength(1);
    // Fleet scope: filed on no service, exactly as `permissions.unenforced` is.
    expect(all[0]!.subject).toBeUndefined();
    expect(all[0]!.details).toEqual(["architecture/adrs/0001-outbox.md:7: [the map](landscape.likec4)"]);
    // A single-target run says nothing about the fleet's documents — a fleet
    // fact repeated on every service target is the report.
    expect(await findings(p, "link.unresolved", "--service", "payment-service")).toEqual([]);
  });

  it("a living capability document is graded at fleet scope", async () => {
    const p = await project({
      ...coherentFixture(),
      "capabilities/refunds/spec.md": `# Refunds\n\nSee [the term](../../glossary/refund.md).\n\n## Requirements\n\n### Requirement: Refund a payment\nRequirement-ID: CAP-REFUND-1\nThe fleet SHALL return a customer's money.\n\n#### Scenario: It works\n- **Given** a payment\n- **When** a refund is asked for\n- **Then** the money returns\n`,
    });
    expect(await broken(p, "--all")).toEqual([
      "capabilities/refunds/spec.md:3: [the term](../../glossary/refund.md)",
    ]);
  });
});

describe("a document that cannot be read names itself", () => {
  it("an undecodable runbook is link.unreadable, and the service is still graded", async () => {
    const p = await project(coherentFixture());
    // UTF-16LE without a BOM: valid UTF-8 bytes with a NUL between every
    // character, which is the state `decodeDocument` exists to refuse. Written
    // through the project's own writer would re-encode it, so it goes in raw.
    await writeFile(
      join(p.docsDir, "services", "payment-service", "runbook.md"),
      Buffer.from("# Runbook\n", "utf16le"),
    );
    const unreadable = await findings(p, "link.unreadable", "--all");
    expect(unreadable).toHaveLength(1);
    expect(unreadable[0]!.subject).toBe("payment-service");
    expect(unreadable[0]!.message).toContain("services/payment-service/runbook.md");
    // The point of the code: the rest of the service was still checked. A
    // thrown decode error would have replaced every finding below with one
    // `service.unreadable`.
    expect(await findings(p, "service.unreadable", "--all")).toEqual([]);
    expect(await findings(p, "requirements.covered", "--all")).not.toEqual([]);
  });
});
