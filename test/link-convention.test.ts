/**
 * How documents in a docs repo link to one another — a convention loam WRITES
 * and states, and deliberately not a setting, and deliberately not a check.
 *
 * The shape was nearly a `loam.json` field, and the reason it is not is the
 * reason this file exists. A link between two documents here is a JOIN, not
 * decoration: a requirement that names a term wants that term's document linked
 * and that document updated, an ADR that supersedes another wants to say which
 * — the same kind of relationship `Operations:` and `Covers:` already carry.
 * A join loam might one day resolve is a contract, and a contract that half a
 * fleet is configured out of is exactly the drift the rejected service manifest
 * was deleted for. So: one form, stated once, with its reason.
 *
 * Two properties, and they pull in opposite directions, which is why both are
 * pinned here. The generated AGENTS.md must SAY the form and why — agents write
 * most of these documents, so an unstated convention is not one. And loam must
 * say NOTHING about any actual link today: no check reads one, and a corpus
 * mixing both spellings must grade exactly as one containing neither. The day
 * somebody adds the resolvable-link check, the second half of this file is the
 * conversation that has to happen first.
 */
import { describe, expect, it, afterEach } from "vitest";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  LANDSCAPE,
  LIVING_OPENAPI,
  LIVING_SPEC,
  SERVICE_MODEL,
  makeProject,
  makeTmpDir,
  runLoam,
  type Project,
} from "./helpers/harness.js";
import { AGENTS_MD } from "../src/core/agent/agents-md.js";

const ROOT = fileURLToPath(new URL("../", import.meta.url));

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!();
});

async function project(files: Record<string, string>): Promise<Project> {
  const p = await makeProject(files);
  cleanups.push(() => p.destroy());
  return p;
}

/* ------------------------------------------------------------------ */
/* The contract states the form, and why                               */
/* ------------------------------------------------------------------ */

describe("the generated AGENTS.md states the link convention", () => {
  it("names markdown links with a relative-path target, and shows one", () => {
    expect(AGENTS_MD).toContain("## Linking between documents");
    expect(AGENTS_MD).toMatch(/\*\*standard markdown links\*\*/);
    // The example is a real relative path, not a bare filename: "which file"
    // and "where from here" are the same question for a link that resolves.
    expect(AGENTS_MD).toMatch(/\[[^\]\n]+\]\(\.\.\/[^)\n]+\.md\)/);
  });

  it("gives both reasons, and the deciding one is resolvability", () => {
    // Rendering is the reason people notice; resolvability is the reason the
    // form is a convention rather than a taste. A version of this section that
    // kept only the first would be an aesthetic argument, and an aesthetic
    // argument is one somebody reasonably overrules.
    expect(AGENTS_MD).toMatch(/pull-request review/);
    expect(AGENTS_MD).toMatch(/literal\s+brackets/);
    expect(AGENTS_MD).toMatch(/does this\s+link resolve/);
    expect(AGENTS_MD).toMatch(/shortest-unique-path/);
    expect(AGENTS_MD).toMatch(/guessing/);
  });

  it("closes the ergonomic escape hatch instead of ignoring it", () => {
    // "but wikilinks give me autocomplete and rename-tracking" is the real
    // objection, and it is answered by a fact rather than a preference:
    // Obsidian's own setting turns off and produces markdown links.
    expect(AGENTS_MD).toContain("Obsidian");
    expect(AGENTS_MD).toMatch(/\[\[Wikilinks\]\]/);
    expect(AGENTS_MD).toMatch(/autocomplete and rename-tracking/);
  });

  it("says plainly that nothing validates it today", () => {
    // Without this, an agent reading a stated rule looks for the finding that
    // enforces it, concludes it is missing, and files a bug — or worse, adds
    // the check. Stating the absence is what makes the convention honest.
    expect(AGENTS_MD).toMatch(/\*\*Nothing validates this today\.\*\*/);
    expect(AGENTS_MD).toMatch(/produces no finding/);
  });

  it("offers no choice — there is no style to pick and nothing to configure", async () => {
    // The field was considered and rejected. A contract that still described
    // one would send an agent looking for a `loam.json` key that does not
    // exist, and a docs repo half-written in a form no check could resolve.
    expect(AGENTS_MD).not.toContain("linkStyle");
    expect(AGENTS_MD).not.toContain("--link-style");
    const config = await readFile(join(ROOT, "src", "core", "envelope", "config.ts"), "utf8");
    expect(config).not.toContain("linkStyle");
  });

  it("`loam init` has no --link-style flag, and writes no such key", async () => {
    const dir = await makeTmpDir("loam-link-convention-");
    cleanups.push(() => rm(dir, { recursive: true, force: true }));

    // commander itself rejects it, which is the strongest form of "there is no
    // such flag": nothing in `init` had to be taught to refuse it.
    await expect(
      runLoam(dir, "init", "--docs", "./d", "--create", "--link-style", "wiki"),
    ).rejects.toThrow(/unknown option '--link-style'/);

    const created = await runLoam(dir, "init", "--docs", "./d", "--create", "--json");
    expect(created.code, created.out).toBe(0);
    expect(JSON.parse(created.stdout).linkStyle).toBeUndefined();
    const config = JSON.parse(await readFile(join(dir, "loam.json"), "utf8")) as Record<string, unknown>;
    expect(Object.keys(config)).not.toContain("linkStyle");
  });

  it("reaches a scaffolded docs repo, not only the template constant", async () => {
    const dir = await makeTmpDir("loam-link-convention-scaffold-");
    cleanups.push(() => rm(dir, { recursive: true, force: true }));
    await runLoam(dir, "init", "--docs", "./d", "--create");

    const agents = await readFile(join(dir, "d", "AGENTS.md"), "utf8");
    expect(agents).toContain("## Linking between documents");
  });
});

/* ------------------------------------------------------------------ */
/* SCHEMA carries the same convention, in the conventions section      */
/* ------------------------------------------------------------------ */

describe("SCHEMA states it where the docs-repo conventions live", () => {
  it("under Conventions, with the resolvability reason and the absence of a check", async () => {
    const schema = await readFile(join(ROOT, "SCHEMA.md"), "utf8");
    const section = schema.slice(schema.indexOf("## Conventions"), schema.indexOf("## Operating at fleet scale"));
    expect(section.length).toBeGreaterThan(0);
    expect(section).toMatch(/\*\*Documents link to each other with standard markdown links\*\*/);
    expect(section).toMatch(/shortest-unique-path/);
    expect(section).toMatch(/\*\*Nothing validates this today\*\*/);
  });

  it("and not as a loam.json field, because there is none", async () => {
    const schema = await readFile(join(ROOT, "SCHEMA.md"), "utf8");
    const config = schema.slice(schema.indexOf("## `loam.json`"), schema.indexOf("## Conventions"));
    expect(config.length).toBeGreaterThan(0);
    expect(config).not.toContain("linkStyle");
    expect(schema).not.toContain("--link-style");
  });
});

/* ------------------------------------------------------------------ */
/* And loam says nothing about any actual link                         */
/* ------------------------------------------------------------------ */

describe("no check reads a link", () => {
  /** A fleet with no feature in flight — nothing pins against this spec, so its body is free. */
  function fleet(spec: string): Record<string, string> {
    return {
      "architecture/landscape.likec4": LANDSCAPE,
      "services/payment-service/model.likec4": SERVICE_MODEL,
      "services/payment-service/spec.md": spec,
      "services/payment-service/openapi.yaml": LIVING_OPENAPI,
    };
  }

  /**
   * The same living spec with a paragraph of links spliced into the
   * requirement's body — BOTH spellings, in one file, which is the state the
   * convention explicitly tolerates. Placed inside a requirement rather than in
   * a file nothing reads: a corpus loam merely never opens would prove nothing.
   */
  const MIXED_LINKS = LIVING_SPEC.replace(
    "The service SHALL authorize a payment before capture.",
    "The service SHALL authorize a payment before capture.\n" +
      "See [0001 — transactional outbox](../../architecture/adrs/0001-transactional-outbox.md), " +
      "[[0002 circuit breakers]] and [a link that resolves nowhere](../nope/missing.md).",
  );

  /**
   * Every finding, across every target. Flattened from `targets[].findings`,
   * which is where they live — the envelope has no top-level `findings` key,
   * and a helper that read one hands back `[]` for every fleet, which makes the
   * equality below true of nothing. The richness floor is what stops that
   * silently happening again.
   */
  async function findings(p: Project): Promise<Array<{ code: string; message: string }>> {
    const res = await runLoam(p.workDir, "validate", "--all", "--json");
    const json = JSON.parse(res.stdout) as {
      targets?: Array<{ findings?: Array<{ code: string; message: string }> }>;
    };
    const all = (json.targets ?? []).flatMap((t) => t.findings ?? []);
    expect(all.length, `validate --all reported nothing to compare: ${res.stdout}`).toBeGreaterThan(0);
    return all;
  }

  it("a corpus mixing both spellings grades exactly as one with no links at all", async () => {
    // The assertion is EQUALITY, not "no link finding": a check that fired on a
    // wikilink, or on a markdown link whose target does not exist, would show
    // up here as a difference whatever it chose to call itself. Both runs are
    // over the same fleet, so any difference is the links.
    const plain = await project(fleet(LIVING_SPEC));
    const mixed = await project(fleet(MIXED_LINKS));

    const [a, b] = await Promise.all([findings(plain), findings(mixed)]);
    expect(b.map((f) => f.code).sort()).toEqual(a.map((f) => f.code).sort());
  });

  it("the exit code is the same too — no link makes a fleet fail", async () => {
    const plain = await project(fleet(LIVING_SPEC));
    const mixed = await project(fleet(MIXED_LINKS));

    const before = await runLoam(plain.workDir, "validate", "--all", "--json");
    const after = await runLoam(mixed.workDir, "validate", "--all", "--json");
    expect(after.code).toBe(before.code);
  });

  it("a dangling markdown link is not a finding — the check is possible, not present", async () => {
    // `../nope/missing.md` names nothing. The whole argument for the markdown
    // form is that this question HAS a mechanical answer; the argument for
    // stating the convention now is that loam does not ask it yet. Both halves
    // are pinned, because "possible" is what a later change would mistake for
    // "already done".
    const p = await project(fleet(MIXED_LINKS));
    const mentions = (await findings(p)).filter((f) => f.message.includes("missing.md"));
    expect(mentions, JSON.stringify(mentions)).toEqual([]);
  });
});
