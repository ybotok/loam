/**
 * How documents in a docs repo link to one another — a convention loam WRITES,
 * states, and now RESOLVES, and deliberately not a setting.
 *
 * The shape was nearly a `loam.json` field, and the reason it is not is the
 * reason this file exists. A link between two documents here is a JOIN, not
 * decoration: a requirement that names a term wants that term's document linked
 * and that document updated, an ADR that supersedes another wants to say which
 * — the same kind of relationship `Operations:` and `Covers:` already carry.
 * A join loam resolves is a contract, and a contract that half a fleet is
 * configured out of is exactly the drift the rejected service manifest was
 * deleted for. So: one form, stated once, with its reason.
 *
 * THE SECOND HALF OF THIS FILE WAS REVERSED, and the header it replaces said
 * this was the conversation that had to happen first. It used to pin that loam
 * said NOTHING about any actual link — a corpus mixing both spellings graded
 * exactly as one containing neither — and the honesty of the stated convention
 * rested on it. `link.unresolved` is now that check, so what is pinned instead
 * is the narrower claim the convention actually made: loam resolves the form it
 * chose, and stays silent about the one it did not. A wikilink is not refused,
 * not warned about, and not repaired. It is simply not a link loam can read,
 * which is the whole argument for the markdown form and is now observable.
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
    expect(AGENTS_MD).toMatch(/pull-request\s+review/);
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

  it("names the check that reads a link, its three exclusions, and the one it does grade", () => {
    // An agent that knows the rule and not its boundary writes around the wrong
    // edge: it stops linking to a service's own repository (correctly ignored),
    // or files a bug about a fenced example (correctly ignored). The exclusions
    // are as much of the contract as the code is.
    expect(AGENTS_MD).toMatch(/`link\.unresolved`/);
    expect(AGENTS_MD).toMatch(/outside\s+this repository/);
    expect(AGENTS_MD).toMatch(/#section/);
    expect(AGENTS_MD).toMatch(/fenced code\s+block or an inline code span/);
    expect(AGENTS_MD).toMatch(/CASE\s+\*\*is\*\* graded/);
    // And the old sentence is gone. It said, in bold, that nothing validated
    // this — which is now false, and a stale absence reads as a live promise.
    expect(AGENTS_MD).not.toMatch(/Nothing validates this today/);
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
    expect(section).toMatch(/`link\.unresolved`/);
    expect(section).toMatch(/`link\.unreadable`/);
    expect(section).not.toMatch(/Nothing validates this today/);
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
/* And loam resolves the form it chose, and only that form             */
/* ------------------------------------------------------------------ */

describe("loam reads a markdown link and nothing else", () => {
  /** A fleet with no feature in flight — nothing pins against this spec, so its body is free. */
  function fleet(spec: string): Record<string, string> {
    return {
      "architecture/landscape.likec4": LANDSCAPE,
      "services/payment-service/model.likec4": SERVICE_MODEL,
      "services/payment-service/spec.md": spec,
      "services/payment-service/openapi.yaml": LIVING_OPENAPI,
    };
  }

  /** The living spec with `body` spliced into the requirement — where a link an author writes actually sits. */
  function specLinking(body: string): string {
    return LIVING_SPEC.replace(
      "The service SHALL authorize a payment before capture.",
      `The service SHALL authorize a payment before capture.\n${body}`,
    );
  }

  /**
   * BOTH spellings in one file, which is the state the convention explicitly
   * tolerates — it refuses neither, it only resolves one. Placed inside a
   * requirement rather than in a file nothing reads: a corpus loam merely never
   * opens would prove nothing either way.
   */
  const MIXED_LINKS = specLinking(
    "See [the outbox](../../architecture/adrs/0001-transactional-outbox.md), " +
      "[[0002 circuit breakers]] and [a link that resolves nowhere](../nope/missing.md).",
  );

  /** The wikilink alone, and it names nothing — the spelling loam declines to read. */
  const WIKI_ONLY = specLinking("See [[0002 circuit breakers]], which does not exist.");

  /**
   * Every finding, across every target. Flattened from `targets[].findings`,
   * which is where they live — the envelope has no top-level `findings` key,
   * and a helper that read one hands back `[]` for every fleet, which makes the
   * equality below true of nothing. The richness floor is what stops that
   * silently happening again.
   */
  async function findings(p: Project): Promise<Array<{ code: string; message: string; details?: string[] }>> {
    const res = await runLoam(p.workDir, "validate", "--all", "--json");
    const json = JSON.parse(res.stdout) as {
      targets?: Array<{ findings?: Array<{ code: string; message: string; details?: string[] }> }>;
    };
    const all = (json.targets ?? []).flatMap((t) => t.findings ?? []);
    expect(all.length, `validate --all reported nothing to compare: ${res.stdout}`).toBeGreaterThan(0);
    return all;
  }

  it("a mixed corpus earns exactly one finding, and it names only the markdown targets", async () => {
    // The two spellings sit side by side in one requirement, so any difference
    // in how they are treated shows up in a single run. Both markdown targets
    // dangle and both are listed; the wikilink is absent — not as a second
    // finding, and not folded into this one.
    const p = await project(fleet(MIXED_LINKS));
    const links = (await findings(p)).filter((f) => f.code.startsWith("link."));
    expect(links).toHaveLength(1);
    expect(links[0]!.details).toEqual([
      "services/payment-service/spec.md:12: [the outbox](../../architecture/adrs/0001-transactional-outbox.md)",
      "services/payment-service/spec.md:12: [a link that resolves nowhere](../nope/missing.md)",
    ]);
    expect(JSON.stringify(links)).not.toContain("circuit breakers");
  });

  it("a broken markdown link now fails the fleet, where the same file used to pass", async () => {
    // The reversal, stated as the exit code a CI job reads. This assertion is
    // the user-visible half of the change: a repo whose prose links rotted goes
    // from exit 0 to exit 1 on its first run after the upgrade.
    const plain = await project(fleet(LIVING_SPEC));
    const mixed = await project(fleet(MIXED_LINKS));

    expect((await runLoam(plain.workDir, "validate", "--all", "--json")).code).toBe(0);
    expect((await runLoam(mixed.workDir, "validate", "--all", "--json")).code).toBe(1);
  });

  it("a wikilink is not a finding however broken — loam declines to guess, it does not refuse", async () => {
    // The assertion is EQUALITY against a fleet with no links at all: a check
    // that had learned to resolve `[[…]]`, or one that warned about the
    // spelling, would show up here as a difference whatever it called itself.
    // This is the property the whole convention rests on — resolving a wikilink
    // means reimplementing shortest-unique-path search, which is guessing.
    const plain = await project(fleet(LIVING_SPEC));
    const wiki = await project(fleet(WIKI_ONLY));

    const [a, b] = await Promise.all([findings(plain), findings(wiki)]);
    expect(b.map((f) => f.code).sort()).toEqual(a.map((f) => f.code).sort());
    expect((await runLoam(wiki.workDir, "validate", "--all", "--json")).code).toBe(0);
  });
});
