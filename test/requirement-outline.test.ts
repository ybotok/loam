/**
 * `--outline` and `--requirement` — the requirement lenses of `loam delta` and
 * `loam context`.
 *
 * The defect they close was measured on a pilot fleet (2026-10-29): with
 * `--intent-ref` already on, `loam delta <FEAT> --service <svc> --json` handed
 * one service's implementer 434,889 bytes, 334 KB of them the text and
 * Given/When/Then lines of 23 requirements, and `loam context` — the step
 * before it in the implement protocol — carried the same requirements again.
 * Reproduced here on small documents, because nothing from that fleet may enter
 * this repository and the property is not about size: an outline must say
 * where each requirement is so exactly that reading those lines IS reading the
 * requirement, and must keep every join a reader plans from.
 *
 * What is pinned, in the order an agent would be damaged by getting it wrong:
 * that the default brief is untouched (verbatim requirements are frozen
 * contract); that a span is the requirement byte for byte, a fenced heading and
 * a CRLF file included; that the outline keeps every key but the words, the
 * scenario digests among them; that `--requirement` hands back exactly the
 * named requirements in full and refuses a name nothing answers to; and that
 * `loam context` outlines both its living and its in-flight sections.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { coherentFixture, makeProject, runLoam, type Project } from "./helpers/harness.js";
import { toolByName } from "../src/core/mcp/tools.js";
import { toArgv } from "../src/core/mcp/argv.js";

const SPEC_PATH = "features/FEAT-1-split/specs/payment-split-service/spec.md";
const ARCH_PATH = "features/FEAT-1-split/specs/payment-split-service/arch.spec.md";

/**
 * Three requirements: two with a `Requirement-ID:`, one addressed by its
 * heading, and a fenced block inside the second whose lines look like headings
 * — the parse reads them as body, so the span must too.
 */
const SPEC = [
  "# payment-split-service — delta for FEAT-1",
  "",
  "## ADDED Requirements",
  "",
  "### Requirement: Split a payment",
  "Requirement-ID: SPLIT-CREATE",
  "The service SHALL split a payment across payees summing to the total.",
  "",
  "Operations: createSplit",
  "",
  "#### Scenario: Split across two payees",
  "- **Given** a payment of 100.00",
  "- **When** it is split 60/40",
  "- **Then** two shares are recorded",
  "",
  "### Requirement: Round the last share",
  "Requirement-ID: SPLIT-ROUND",
  "The last share SHALL absorb the rounding remainder.",
  "",
  "```",
  "### Requirement: not a heading, fenced",
  "## not a section either",
  "```",
  "",
  "#### Scenario: Three payees",
  "- **Given** a payment of 100.00",
  "- **When** it is split three ways",
  "- **Then** the shares are 33.33, 33.33 and 33.34",
  "",
  "#### Scenario: One payee",
  "- **Given** a payment of 10.00",
  "- **When** it is split one way",
  "- **Then** the share is 10.00",
  "",
  "### Requirement: Report the split",
  "The service SHALL report each split once it is recorded.",
  "",
  "#### Scenario: Reported",
  "- **Given** a recorded split",
  "- **When** the report runs",
  "- **Then** the split is in it",
  "",
  "## Notes",
  "",
  "Prose after the last requirement belongs to no requirement.",
  "",
].join("\n");

/** One arch requirement, in a CRLF file with non-ASCII text — the bytes must be the file's own. */
const ARCH = [
  "# payment-split-service — arch delta for FEAT-1",
  "",
  "## ADDED Requirements",
  "",
  "### Requirement: Record the split durably",
  "Requirement-ID: SPLIT-DURABLE",
  "A split SHALL survive a restart — written before it is acknowledged.",
  "",
  "#### Scenario: Restart after acknowledgement",
  "- **Given** an acknowledged split",
  "- **When** the service restarts",
  "- **Then** the split is still recorded",
  "",
].join("\r\n");

let project: Project | undefined;
afterEach(async () => {
  await project?.destroy();
  project = undefined;
});

async function outlineProject(): Promise<Project> {
  project = await makeProject({ ...coherentFixture(), [SPEC_PATH]: SPEC, [ARCH_PATH]: ARCH });
  return project;
}

interface Item {
  id?: string;
  name: string;
  text?: string;
  path?: string;
  line: number;
  endLine?: number;
  bytes?: number;
  scenarios: Array<{ name: string; line: number; lines?: string[]; digest?: string }>;
  [key: string]: unknown;
}

interface Brief {
  requirements: Item[];
  archRequirements: Item[];
  [key: string]: unknown;
}

async function delta(p: Project, ...flags: string[]): Promise<{ code: number; brief: Brief; stdout: string }> {
  const res = await runLoam(p.workDir, "delta", "FEAT-1", "--service", "payment-split-service", "--json", ...flags);
  return { code: res.code, brief: JSON.parse(res.stdout) as Brief, stdout: res.stdout };
}

/** The file's lines `line` to `endLine`, each with its own line ending — what the span promises to be. */
async function spanText(p: Project, item: Item): Promise<string> {
  const text = await readFile(join(p.docsDir, item.path!), "utf8");
  return text.split(/(?<=\n)/).slice(item.line - 1, item.endLine).join("");
}

describe("loam delta --outline", () => {
  it("leaves the default brief verbatim — the requirement text is frozen contract", async () => {
    const p = await outlineProject();
    const { code, brief } = await delta(p);
    expect(code).toBe(0);
    expect(brief.requirements).toHaveLength(3);
    for (const r of [...brief.requirements, ...brief.archRequirements]) {
      expect(typeof r.text).toBe("string");
      expect(r).not.toHaveProperty("endLine");
      expect(r).not.toHaveProperty("path");
      for (const s of r.scenarios) expect(Array.isArray(s.lines)).toBe(true);
    }
  });

  it("keeps every key but the words, and changes nothing else in the brief", async () => {
    const p = await outlineProject();
    const full = (await delta(p)).brief;
    const { code, brief } = await delta(p, "--outline");
    expect(code).toBe(0);
    for (const axis of ["requirements", "archRequirements"] as const) {
      expect(brief[axis].map((r) => r.id ?? r.name)).toEqual(full[axis].map((r) => r.id ?? r.name));
      for (const [i, r] of brief[axis].entries()) {
        const { text: _text, scenarios: fullScenarios, ...kept } = full[axis][i]!;
        const { path: _path, endLine: _end, bytes: _bytes, scenarios, ...rest } = r;
        expect(rest).toEqual(kept);
        expect(r).not.toHaveProperty("text");
        // The digest is the join key to `loam tasks` and the stamped .feature,
        // computed from the lines the outline no longer carries.
        expect(scenarios).toEqual(fullScenarios.map(({ name, line, digest }) => ({ name, line, digest })));
      }
    }
    const { requirements: _r, archRequirements: _a, ...others } = brief;
    const { requirements: _fr, archRequirements: _fa, ...fullOthers } = full;
    expect(others).toEqual(fullOthers);
  });

  it("points each requirement at its own lines, byte for byte — fenced headings and CRLF included", async () => {
    const p = await outlineProject();
    const { brief } = await delta(p, "--outline");
    const items = [...brief.requirements, ...brief.archRequirements];
    expect(items.map((r) => r.path)).toEqual([SPEC_PATH, SPEC_PATH, SPEC_PATH, ARCH_PATH]);
    for (const r of items) {
      const text = await spanText(p, r);
      expect(text.startsWith(`### Requirement: ${r.name}`)).toBe(true);
      expect(Buffer.byteLength(text, "utf8")).toBe(r.bytes);
    }
    // The fenced lines are inside the second requirement, and it ends where the
    // third begins; the last one stops before `## Notes`, which is nobody's.
    const [split, round, report, durable] = items;
    expect(await spanText(p, round!)).toContain("### Requirement: not a heading, fenced");
    expect(round!.endLine! + 1).toBe(report!.line);
    expect(split!.endLine! + 1).toBe(round!.line);
    expect(await spanText(p, report!)).not.toContain("## Notes");
    expect(await spanText(p, durable!)).toContain("\r\n");
    expect(durable!.bytes).toBe(Buffer.byteLength(ARCH.split("\r\n").slice(4).join("\r\n"), "utf8"));
  });

  it("shows one line per requirement in the human view, and none of its words", async () => {
    const p = await outlineProject();
    const res = await runLoam(p.workDir, "delta", "FEAT-1", "--service", "payment-split-service", "--outline");
    expect(res.code).toBe(0);
    expect(res.stdout).toContain(`Requirements (outline of ${SPEC_PATH}):`);
    expect(res.stdout).toMatch(/SPLIT-ROUND · Round the last share {2}\(lines \d+–\d+, [\d,]+ bytes, 2 scenarios\)/);
    expect(res.stdout).not.toContain("absorb the rounding remainder");
  });
});

describe("loam delta --requirement", () => {
  it("carries only the named requirements, verbatim, on whichever axis holds them", async () => {
    const p = await outlineProject();
    const full = (await delta(p)).brief;
    const { code, brief } = await delta(p, "--requirement", "SPLIT-ROUND", "--requirement", "SPLIT-DURABLE");
    expect(code).toBe(0);
    expect(brief.requirements).toEqual([full.requirements[1]]);
    expect(brief.archRequirements).toEqual(full.archRequirements);
  });

  it("addresses a requirement with no Requirement-ID by its heading", async () => {
    const p = await outlineProject();
    const { brief } = await delta(p, "--requirement", "Report the split");
    expect(brief.requirements.map((r) => r.name)).toEqual(["Report the split"]);
    expect(brief.archRequirements).toEqual([]);
  });

  it("reads a named requirement in full even beside --outline", async () => {
    const p = await outlineProject();
    const { brief } = await delta(p, "--outline", "--requirement", "SPLIT-CREATE");
    expect(brief.requirements).toHaveLength(1);
    expect(brief.requirements[0]!.text).toContain("summing to the total");
  });

  it("refuses a name no requirement answers to, rather than handing back an empty brief", async () => {
    const p = await outlineProject();
    const res = await runLoam(p.workDir, "delta", "FEAT-1", "--service", "payment-split-service", "--json", "--requirement", "SPLIT-RUOND");
    expect(res.code).toBe(1);
    const out = JSON.parse(res.stdout) as { ok: boolean; error: { code: string; message: string } };
    expect(out.ok).toBe(false);
    expect(out.error.code).toBe("unknown-target");
    expect(out.error.message).toContain("'SPLIT-RUOND'");
    expect(out.error.message).toContain("did you mean 'SPLIT-ROUND'");
  });
});

/**
 * FEAT-1 over the LIVING payment-service too: a MODIFIED requirement the
 * review reads as an edit, beside an ADDED one it reads as new — two items
 * whose review keys must not trade places when a lens narrows the section.
 */
const LIVING_DELTA = [
  "# payment-service — delta for FEAT-1",
  "",
  "## MODIFIED Requirements",
  "",
  "### Requirement: Authorize a payment",
  "The service SHALL authorize a payment before capture, and before any split is recorded.",
  "",
  "Operations: authorizePayment",
  "",
  "#### Scenario: Successful authorization",
  "- **Given** a valid card",
  "- **When** authorization is requested",
  "- **Then** the payment is authorized",
  "",
  "## ADDED Requirements",
  "",
  "### Requirement: Refund a payment",
  "Requirement-ID: PAY-REFUND",
  "The service SHALL refund a captured payment.",
  "",
  "#### Scenario: Refunded",
  "- **Given** a captured payment",
  "- **When** a refund is requested",
  "- **Then** the payment is refunded",
  "",
].join("\n");

async function reviewProject(): Promise<Project> {
  project = await makeProject({ ...coherentFixture(), "features/FEAT-1-split/specs/payment-service/spec.md": LIVING_DELTA });
  return project;
}

async function reviewed(p: Project, ...flags: string[]): Promise<{ code: number; stdout: string }> {
  return runLoam(p.workDir, "delta", "FEAT-1", "--service", "payment-service", "--diff", ...flags);
}

describe("the requirement lenses beside --diff", () => {
  it("keep each requirement's own review when --requirement narrows the section", async () => {
    const p = await reviewProject();
    const refund = JSON.parse((await reviewed(p, "--json", "--requirement", "PAY-REFUND")).stdout) as Brief;
    expect(refund.requirements.map((r) => [r.name, r["change"]])).toEqual([["Refund a payment", "new"]]);
    const authorize = JSON.parse((await reviewed(p, "--json", "--requirement", "Authorize a payment")).stdout) as Brief;
    expect(authorize.requirements.map((r) => [r.name, r["change"]])).toEqual([["Authorize a payment", "edit"]]);
    expect(Array.isArray(authorize.requirements[0]!["diff"])).toBe(true);

    const human = await reviewed(p, "--requirement", "PAY-REFUND");
    expect(human.code).toBe(0);
    expect(human.stdout).toContain("[ADDED · new] Refund a payment");
    expect(human.stdout).not.toContain("[MODIFIED");
  });

  it("carry the review on an outline, in the human view as in the JSON", async () => {
    const p = await reviewProject();
    const json = JSON.parse((await reviewed(p, "--json", "--outline")).stdout) as Brief;
    expect(json.requirements.map((r) => [r.name, r["change"], "text" in r])).toEqual([
      ["Authorize a payment", "edit", false],
      ["Refund a payment", "new", false],
    ]);
    const human = await reviewed(p, "--outline");
    expect(human.code).toBe(0);
    expect(human.stdout).toMatch(/\[MODIFIED · edit\] Authorize a payment {2}\(lines \d+–\d+/);
    expect(human.stdout).toContain("+ The service SHALL authorize a payment before capture, and before any split is recorded.");
    expect(human.stdout).toMatch(/\[ADDED · new\] PAY-REFUND · Refund a payment/);
  });

  it("refuse the heading of a requirement that has an id by naming the id", async () => {
    const p = await reviewProject();
    const res = await runLoam(p.workDir, "delta", "FEAT-1", "--service", "payment-service", "--json", "--requirement", "Refund a payment");
    expect(res.code).toBe(1);
    const out = JSON.parse(res.stdout) as { error: { code: string; message: string } };
    expect(out.error.code).toBe("unknown-target");
    expect(out.error.message).toContain("'Refund a payment' is PAY-REFUND");
  });
});

describe("loam context --outline", () => {
  it("outlines the living requirements and the in-flight ones alike", async () => {
    const p = await outlineProject();
    const living = await runLoam(p.workDir, "context", "payment-service", "--json", "--outline");
    expect(living.code).toBe(0);
    const pack = JSON.parse(living.stdout) as { requirements: Item[] };
    expect(pack.requirements).toHaveLength(1);
    const authorize = pack.requirements[0]!;
    expect(authorize).not.toHaveProperty("text");
    expect(authorize.path).toBe("services/payment-service/spec.md");
    expect(await spanText(p, authorize)).toMatch(/^### Requirement: Authorize a payment\n[\s\S]*the payment is authorized\n$/);

    const introduced = await runLoam(p.workDir, "context", "payment-split-service", "--json", "--outline");
    expect(introduced.code).toBe(0);
    const { features } = JSON.parse(introduced.stdout) as { features: Array<{ requirements: Item[]; archRequirements: Item[] }> };
    const inFlight = [...features[0]!.requirements, ...features[0]!.archRequirements];
    expect(inFlight.map((r) => r.id ?? r.name)).toEqual(["SPLIT-CREATE", "SPLIT-ROUND", "Report the split", "SPLIT-DURABLE"]);
    for (const r of inFlight) {
      expect(r).not.toHaveProperty("text");
      expect(Buffer.byteLength(await spanText(p, r), "utf8")).toBe(r.bytes);
    }
  });

  it("leaves the default pack verbatim", async () => {
    const p = await outlineProject();
    const res = await runLoam(p.workDir, "context", "payment-service", "--json");
    const pack = JSON.parse(res.stdout) as { requirements: Item[] };
    expect(pack.requirements[0]!.text).toContain("authorize a payment before capture");
    expect(pack.requirements[0]).not.toHaveProperty("endLine");
  });
});

describe("the MCP tools", () => {
  it("spell both lenses as the CLI does, a repeatable --requirement repeating per value", () => {
    expect(toArgv(toolByName("loam_delta")!, { featureId: "FEAT-1", outline: true, requirement: ["A", "B"] })).toEqual({
      ok: true,
      argv: ["delta", "FEAT-1", "--outline", "--requirement", "A", "--requirement", "B", "--json"],
    });
    expect(toArgv(toolByName("loam_context")!, { service: "payment-service", outline: true })).toEqual({
      ok: true,
      argv: ["context", "payment-service", "--outline", "--json"],
    });
  });
});
