/**
 * `glossary/<term>.md` — the domain's vocabulary as a tree, graded by who cites
 * it.
 *
 * The axis rests on one earlier decision and would be a heuristic without it:
 * a link is a join loam resolves (`test/links.test.ts`), so "which documents use
 * this term" is an exact question. The alternative that was rejected — matching
 * the term's WORDS against prose — would convict a payments capability for the
 * word "payments", which is the class of check loam refuses everywhere.
 *
 * Three properties carry it, and each test here exists to fail against a
 * plausible wrong implementation rather than to restate the right one.
 *
 * THE DIRECTORY IS THE LIST, and a file is a term. Nesting is spelled by the
 * tree, `README.md` is not a term, and a fleet without `glossary/` must hear
 * nothing at all — the case that fails if the walk is read as "this fleet
 * defines no terms" instead of "there is nothing here to grade".
 *
 * A CITATION FROM INSIDE THE GLOSSARY IS NOT ADOPTION. A glossary is a network
 * of definitions, so `order-line` linking to `order` is correct and proves
 * nothing about whether the fleet uses either word. This is the same judgement
 * `capability.requirement-inert-join` makes one axis over, and it is the
 * difference between a warning worth reading and one that any two mutually
 * citing terms can silence.
 *
 * THE CORPUS STOPS AT THE ARCHIVE. A shipped feature's documents describe the
 * tree as it was; letting one of them count as a citation would keep a deleted
 * word alive forever.
 */
import { describe, expect, it, afterEach } from "vitest";
import { readGlossary } from "../src/core/glossary/tree.js";
import { glossaryDir } from "../src/core/repo/authored/paths.js";
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

const term = (name: string, body = "A word this fleet uses in one sense.") => `# ${name}\n\n${body}\n`;

/** The living spec with `body` spliced into the requirement — where a citation actually sits. */
function specCiting(body: string): string {
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

describe("the glossary tree declares terms", () => {
  it("a markdown file is a term, nesting spells the id, and README.md is neither", async () => {
    const p = await project({
      ...coherentFixture(),
      "glossary/order.md": term("Order"),
      "glossary/payments/authorization.md": term("Authorization"),
      "glossary/README.md": "# The glossary\n\nHow to use this directory.\n",
    });
    const glossary = await readGlossary(glossaryDir(p.docsDir));
    expect(glossary.present).toBe(true);
    // Ordered, so the payload and every finding list are diff-stable; the index
    // page is absent, not listed as a term nobody cites.
    expect(glossary.terms.map((t) => t.id)).toEqual(["order", "payments/authorization"]);
  });

  it("a fleet with no glossary/ hears nothing — the directory's existence is the opt-in", async () => {
    const p = await project(coherentFixture());
    expect(p.exists("glossary")).toBe(false);
    expect((await readGlossary(glossaryDir(p.docsDir))).present).toBe(false);
    expect(await findings(p, "glossary.unlinked", "--all")).toEqual([]);
    const run = await runLoam(p.workDir, "validate", "--all", "--json");
    expect(run.code, run.out).toBe(0);
  });
});

describe("a term is graded by who cites it", () => {
  it("a term cited from a service spec is silent; one cited by nobody warns", async () => {
    const p = await project({
      ...coherentFixture(),
      "glossary/order.md": term("Order"),
      "glossary/refund.md": term("Refund"),
      "services/payment-service/spec.md": specCiting("An [Order](../../glossary/order.md) is what a customer confirmed."),
    });
    const found = await findings(p, "glossary.unlinked", "--all");
    expect(found).toHaveLength(1);
    expect(found[0]!.subject).toBe("refund");
    // A warning, never a gate: writing the vocabulary ahead of the fleet is the
    // intended use, exactly as it is for a capability document.
    const run = await runLoam(p.workDir, "validate", "--all", "--json");
    expect(run.code, run.out).toBe(0);
  });

  it("a term cited ONLY by another term is still unlinked, and the citing term is named", async () => {
    const p = await project({
      ...coherentFixture(),
      "glossary/order.md": term("Order", "One item of it is an [order line](order-line.md)."),
      "glossary/order-line.md": term("Order line", "One item on an [Order](order.md)."),
      "services/payment-service/spec.md": specCiting("An [Order](../../glossary/order.md) is what a customer confirmed."),
    });
    const found = await findings(p, "glossary.unlinked", "--all");
    expect(found).toHaveLength(1);
    expect(found[0]!.subject).toBe("order-line");
    expect(found[0]!.message).toContain("only from other terms");
    expect(found[0]!.details).toEqual(["glossary/order.md"]);
  });

  it("a whole glossary nobody cites is ONE finding, not one per term", async () => {
    const p = await project({
      ...coherentFixture(),
      "glossary/order.md": term("Order"),
      "glossary/refund.md": term("Refund"),
      "glossary/payments/authorization.md": term("Authorization"),
    });
    const found = await findings(p, "glossary.unlinked", "--all");
    expect(found).toHaveLength(1);
    expect(found[0]!.subject).toBeUndefined();
    expect(found[0]!.details).toEqual(["order", "payments/authorization", "refund"]);
  });

  it("an ARCHIVED feature's citation does not keep a term alive", async () => {
    // features/archive/ is the evolution history: its documents describe the
    // tree as it was, and a word retired two releases ago must not be able to
    // cite itself out of the warning forever.
    const p = await project({
      ...coherentFixture(),
      "glossary/retired.md": term("Retired"),
      "features/archive/FEAT-0-old/intent.md":
        "---\nfeature: FEAT-0\nstatus: shipped\n---\n\n# Old\n\nIt used a [Retired](../../../glossary/retired.md) word.\n",
    });
    const found = await findings(p, "glossary.unlinked", "--all");
    expect(found).toHaveLength(1);
    expect(found[0]!.subject).toBe("retired");
  });

  it("a term document's own links are resolved like any other document's", async () => {
    const p = await project({
      ...coherentFixture(),
      "glossary/order.md": term("Order", "See [the missing one](nope.md)."),
      "services/payment-service/spec.md": specCiting("An [Order](../../glossary/order.md) is what a customer confirmed."),
    });
    const broken = await findings(p, "link.unresolved", "--all");
    expect(broken).toHaveLength(1);
    expect(broken[0]!.details).toEqual(["glossary/order.md:3: [the missing one](nope.md)"]);
  });
});

describe("`loam list glossary`", () => {
  it("reports every term with the documents that cite it, and what it could not read", async () => {
    const p = await project({
      ...coherentFixture(),
      "glossary/order.md": term("Order"),
      "glossary/payments/authorization.md": term("Authorization", "Reserved for an [Order](../order.md)."),
      "services/payment-service/spec.md": specCiting(
        "An [Order](../../glossary/order.md) needs an [authorization](../../glossary/payments/authorization.md).",
      ),
    });
    const res = await runLoam(p.workDir, "list", "glossary", "--json");
    expect(res.code, res.out).toBe(0);
    const payload = JSON.parse(res.stdout);
    expect(payload.glossary).toEqual([
      {
        id: "order",
        path: "glossary/order.md",
        // Sorted, and BOTH citations: the intra-glossary one is listed here
        // even though it does not count towards `glossary.unlinked`. The
        // listing answers "who uses this word"; the finding answers "has the
        // fleet adopted it", and conflating them would hide a real citation.
        linkedBy: ["glossary/payments/authorization.md", "services/payment-service/spec.md"],
      },
      {
        id: "payments/authorization",
        path: "glossary/payments/authorization.md",
        linkedBy: ["services/payment-service/spec.md"],
      },
    ]);
    expect(payload.links).toEqual({ unreadable: [] });
  });

  it("bare `loam list --json` is untouched — the section is explicit-only", async () => {
    const p = await project({ ...coherentFixture(), "glossary/order.md": term("Order") });
    const bare = JSON.parse((await runLoam(p.workDir, "list", "--json")).stdout);
    expect(bare.glossary).toBeUndefined();
    expect(bare.links).toBeUndefined();
  });
});
