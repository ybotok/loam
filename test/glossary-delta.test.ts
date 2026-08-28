/**
 * `features/<FEAT>/glossary/<term>.md` — a change that needs a new word brings
 * the word with it, and `loam unarchive` takes it back.
 *
 * CREATE-ONLY is the axis's one real design decision, and three tests here
 * exist to hold it rather than to demonstrate it. A capability delta is a
 * DELTA — requirement algebra, `Requirement-ID:` identity, `Based-On:` pins —
 * because it merges into a living document part by part. A term document has
 * one part, so the merge is a whole-file copy and there is nothing to merge
 * partially: replacing a living definition through a feature would be a silent
 * overwrite with no pin to collide on, where editing `glossary/<term>.md`
 * directly in the same pull request produces an ordinary git conflict.
 * `glossary.term-exists` refuses the first and `--approve` does not move it —
 * approving it would be approving a deletion nobody described.
 *
 * THE LINK REBASE IS THE OTHER HALF and it is not glossary-specific. A feature's
 * `specs/<svc>/spec.md` sits four directories below the docs root and the living
 * `services/<svc>/spec.md` sits two, so a citation copied verbatim by the merge
 * lands pointing above the repository. That defect predates this axis — a delta
 * requirement citing an ADR has always had it — and the axis is the first thing
 * that makes it visible, because a requirement citing a domain term is the whole
 * point of a glossary.
 */
import { describe, expect, it, afterEach } from "vitest";
import { rebaseLinks } from "../src/core/links/parse.js";
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

const ORDER = "# Order\n\nWhat a customer has committed to buy.\n";

/**
 * The feature's spec delta, citing the term at the path it will need once the
 * requirement has merged into `services/payment-service/spec.md`. Four levels
 * up from `features/FEAT-1-split/specs/payment-split-service/`.
 */
function deltaCiting(target: string): string {
  return `## ADDED Requirements

### Requirement: Split a payment
Requirement-ID: SPLIT-1
The service SHALL split an [Order](${target}) across payees.

Operations: createSplit

#### Scenario: A split is created
- **Given** an order
- **When** a split is requested
- **Then** the split is created
`;
}

/** Findings of one code from a `--json` validate run. */
async function findings(p: Project, code: string, ...args: string[]): Promise<Array<{ message: string }>> {
  const res = await runLoam(p.workDir, "validate", ...args, "--json");
  const targets: Array<{ findings: Array<{ code: string; message: string }> }> = JSON.parse(res.stdout).targets ?? [];
  return targets.flatMap((t) => t.findings.filter((f) => f.code === code));
}

describe("a feature brings its own words", () => {
  it("archive creates the living term, and unarchive takes it back", async () => {
    const p = await project({
      ...coherentFixture(),
      "features/FEAT-1-split/glossary/order.md": ORDER,
    });
    expect(p.exists("glossary")).toBe(false);

    const archived = await runLoam(p.workDir, "archive", "FEAT-1", "--approve");
    expect(archived.code, archived.out).toBe(0);
    // Byte-identical: the definition the author wrote IS the definition that
    // lands. loam merges requirements, never prose, and a term is all prose.
    expect(await p.read("glossary/order.md")).toBe(ORDER);
    // The adoption line: this merge opts the fleet into an axis `validate --all`
    // grades from the next command on, and it must not do that silently.
    expect(archived.out).toContain("opts the fleet into the domain vocabulary");

    const back = await runLoam(p.workDir, "unarchive", "FEAT-1");
    expect(back.code, back.out).toBe(0);
    expect(p.exists("glossary/order.md")).toBe(false);
  });

  it("a nested term keeps its nesting on the way in", async () => {
    const p = await project({
      ...coherentFixture(),
      "features/FEAT-1-split/glossary/payments/authorization.md": "# Authorization\n\nReserved, not taken.\n",
    });
    expect((await runLoam(p.workDir, "archive", "FEAT-1", "--approve")).code).toBe(0);
    expect(p.exists("glossary/payments/authorization.md")).toBe(true);
  });

  it("a term the living glossary already defines is refused, and --approve does not move it", async () => {
    const p = await project({
      ...coherentFixture(),
      "glossary/order.md": ORDER,
      "features/FEAT-1-split/glossary/order.md": "# Order\n\nSomething else entirely.\n",
    });
    const refused = await runLoam(p.workDir, "archive", "FEAT-1", "--approve", "--json");
    expect(refused.code, refused.out).toBe(1);
    const payload = JSON.parse(refused.stdout);
    expect(payload.error.code).toBe("not-coherent");
    const issue = (payload.issues as Array<{ code: string; overridable: boolean }>).find(
      (i) => i.code === "glossary.term-exists",
    );
    // The `overridable: false` key is the machine half of the refusal: a --json
    // consumer must be able to tell "add --approve" from "there is no flag".
    expect(issue, JSON.stringify(payload.issues)).toBeDefined();
    expect(issue!.overridable).toBe(false);
    // And the living definition is untouched — the whole reason this refuses.
    expect(await p.read("glossary/order.md")).toBe(ORDER);
  });

  it("a fleet with no features/*/glossary/ is unaffected", async () => {
    const p = await project(coherentFixture());
    const archived = await runLoam(p.workDir, "archive", "FEAT-1", "--approve");
    expect(archived.code, archived.out).toBe(0);
    expect(archived.out).not.toContain("glossary");
  });
});

describe("a feature may cite the word it is introducing", () => {
  it("the citation resolves while the feature is in flight, and after it ships", async () => {
    const p = await project({
      ...coherentFixture(),
      "features/FEAT-1-split/glossary/order.md": ORDER,
      // Four levels up: features/FEAT-1-split/specs/payment-split-service/ → docs root.
      "features/FEAT-1-split/specs/payment-split-service/spec.md": deltaCiting("../../../../glossary/order.md"),
    });
    // In flight: the term is not living yet, and without the overlay the axis
    // would refuse its own headline case.
    expect(await findings(p, "link.unresolved", "--all")).toEqual([]);

    expect((await runLoam(p.workDir, "archive", "FEAT-1", "--approve")).code).toBe(0);
    // Shipped: the requirement now lives two levels down, so the merge had to
    // rewrite the route. Verbatim copying would have left `../../../../` here,
    // pointing two directories above the repository.
    expect(await p.read("services/payment-split-service/spec.md")).toContain("[Order](../../glossary/order.md)");
    expect(await findings(p, "link.unresolved", "--all")).toEqual([]);
  });

  it("a citation the feature does NOT introduce is still broken, overlay or not", async () => {
    // The overlay must admit exactly the feature's own terms. A set built from
    // "anything under glossary/" would make every typo resolve.
    const p = await project({
      ...coherentFixture(),
      "features/FEAT-1-split/glossary/order.md": ORDER,
      "features/FEAT-1-split/specs/payment-split-service/spec.md": deltaCiting("../../../../glossary/refund.md"),
    });
    const broken = await findings(p, "link.unresolved", "--all");
    expect(broken).toHaveLength(1);
    expect(broken[0]!.message).toContain("features/FEAT-1-split/specs/payment-split-service/spec.md");
  });
});

describe("rebaseLinks re-expresses a route without touching anything else", () => {
  const from = "/docs/features/F/specs/svc";
  const to = "/docs/services/svc";

  it("re-expresses a relative target and leaves the text, title and prose alone", () => {
    expect(rebaseLinks('See [Order](../../../../glossary/order.md "The term") now.', { from, to })).toBe(
      'See [Order](../../glossary/order.md "The term") now.',
    );
  });

  it("keeps the fragment, the angle brackets and the percent escapes", () => {
    expect(rebaseLinks("[a](../../../../glossary/order.md#what-it-is)", { from, to })).toBe(
      "[a](../../glossary/order.md#what-it-is)",
    );
    expect(rebaseLinks("[a](<../../../../glossary/order line.md>)", { from, to })).toBe(
      "[a](<../../glossary/order line.md>)",
    );
    expect(rebaseLinks("[a](../../../../glossary/order%20line.md)", { from, to })).toBe(
      "[a](../../glossary/order%20line.md)",
    );
  });

  it("leaves alone everything that means the same from every directory", () => {
    const untouched = "[a](https://example.com/x.md) [b](#section) [c](/site.md) [d]()";
    expect(rebaseLinks(untouched, { from, to })).toBe(untouched);
  });

  it("does not rewrite inside a fence or a code span", () => {
    const md = "```\n[a](../../../../glossary/order.md)\n```\n`[b](../../../../glossary/order.md)`\n";
    expect(rebaseLinks(md, { from, to })).toBe(md);
  });

  it("rewrites a reference definition, which is the same join written lower down", () => {
    expect(rebaseLinks("[order]: ../../../../glossary/order.md", { from, to })).toBe(
      "[order]: ../../glossary/order.md",
    );
  });

  it("is a no-op when nothing moves, byte for byte", () => {
    const md = "[a](./x.md) and [b](../y.md#z)\r\nsecond line\n";
    expect(rebaseLinks(md, { from, to: from })).toBe(md);
  });

  it("preserves a document's own mixture of line endings", () => {
    const md = "[a](../../../../glossary/order.md)\r\n[b](../../../../glossary/order.md)\n";
    expect(rebaseLinks(md, { from, to })).toBe("[a](../../glossary/order.md)\r\n[b](../../glossary/order.md)\n");
  });

  it("writes a sibling as `./name`, which is what an author writes", () => {
    // A bare `name.md` is a legal relative link and also what a reference
    // LABEL looks like; the explicit `./` keeps the two apart in the output.
    expect(rebaseLinks("[a](../svc/x.md)", { from, to: "/docs/features/F/specs" })).toBe("[a](./svc/x.md)");
  });
});
