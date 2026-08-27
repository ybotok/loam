/**
 * Tests for `loam vouch --sample <n>` — the flag that deliberately REDUCES
 * what a vouch claims, and the machinery that keeps the reduction visible.
 *
 * The feature only pays for itself if a sampled vouch can never be mistaken
 * for a full one, so that is what most of this file pins: the scope is stamped
 * beside `status: verified` (never inside it — the status string and the
 * `vouched` rung are a published contract), every surface that reports trust
 * says so, a mangled scope still grades as sampled, and a later full vouch
 * clears the field instead of leaving the document reading as partial forever.
 *
 * Two properties get their own tests because the whole design rests on them:
 *
 *  - **Auditability.** The seed is `sha256(service NUL content_digest NUL
 *    sources_digest)` truncated to 16, and the pick is a hash rank. The tests
 *    recompute both from the raw recipe — not by calling the functions under
 *    test — so the documented recipe is what is pinned, and anybody with the
 *    document can reproduce the reading list a person was shown.
 *  - **No re-roll in place.** The seed is derived from the document's own
 *    content, so the pick cannot be moved without editing the document — which
 *    the docs repo's history records and which voids any stamp standing over
 *    it. That is a cost on steering, not a bar to it: the recipe is published,
 *    so the pick is predictable to anyone holding the document, which is the
 *    same property that makes it auditable.
 */
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { coherentFixture, makeProject, runLoam, TEST_IDENTITY, treeHashes, writeFiles, type Project } from "./helpers/harness.js";
import { parseFrontmatter, rawBody, stringField, withFrontmatterFields } from "../src/core/document/frontmatter.js";
import { sectionHeadings } from "../src/core/document/parse.js";
import { splitSections } from "../src/core/provenance/sample/sections.js";
import {
  decodeVouchScope,
  encodeVouchScope,
  pickSample,
  readVouchScope,
  sampledSections,
  sampleSeed,
  scopeText,
} from "../src/core/provenance/sample/scope.js";
import { contentDigest } from "../src/core/provenance/stamp.js";
import { vouch } from "../src/commands/vouch/run.js";
import { buildSamplePlan } from "../src/commands/vouch/sample/plan.js";

const SVC = "payment-service";
const SPEC = `services/${SVC}/spec.md`;
const ARCH = `services/${SVC}/arch.spec.md`;

/**
 * Nine sampling units — two H2s, `## Requirements`, four `### Requirement:`
 * blocks, and two more H2s — plus a fenced `## not a heading` that must never
 * be one of them. Nine so that `--sample 2` is a real reduction and the
 * arithmetic in the assertions is legible.
 */
const BODY = `
# payment-service

## Overview

The payment service authorizes, captures and refunds card payments.

## Interfaces

HTTP, plus one topic.

## Requirements

### Requirement: Authorize a payment
The service SHALL authorize a payment before capture.

Operations: authorizePayment

#### Scenario: Successful authorization
- **Given** a valid card
- **When** authorization is requested
- **Then** the payment is authorized

### Requirement: Capture a payment
The service SHALL capture an authorized payment.

#### Scenario: Capture
- **Given** an authorization
- **When** capture is requested
- **Then** the payment is captured

### Requirement: Refund a payment
The service SHALL refund a captured payment.

#### Scenario: Refund
- **Given** a capture
- **When** a refund is requested
- **Then** the payment is refunded

### Requirement: Void an authorization
The service SHALL void an unused authorization.

#### Scenario: Void
- **Given** an authorization
- **When** a void is requested
- **Then** the authorization is void

## Notes

\`\`\`md
## not a heading
### also not a heading
\`\`\`

## Glossary

Authorization, capture, refund.
`;

/** Every H2/H3 heading in BODY, in document order — the universe every sample is drawn from. */
const SECTIONS = [
  "## Overview",
  "## Interfaces",
  "## Requirements",
  "### Requirement: Authorize a payment",
  "### Requirement: Capture a payment",
  "### Requirement: Refund a payment",
  "### Requirement: Void an authorization",
  "## Notes",
  "## Glossary",
];

const ONE_SOURCE = `service: ${SVC}\nstatus: draft\nowner: payments-team\nsources:\n  - src/payment.ts`;
const CODE = { "src/payment.ts": "export const authorize = () => true;\n" };

async function repoProject(files: Record<string, string> = {}): Promise<Project> {
  const fixture = coherentFixture();
  fixture[SPEC] = `---\n${ONE_SOURCE}\n---\n${BODY}`;
  const p = await makeProject({ ...fixture, ...files }, { service: SVC });
  await writeFiles(p.workDir, CODE);
  return p;
}

async function withRepo(fn: (p: Project) => Promise<void>, files: Record<string, string> = {}): Promise<void> {
  const p = await repoProject(files);
  try {
    await fn(p);
  } finally {
    await p.destroy();
  }
}

/** The seed recipe as the doc comment and SCHEMA.md spell it — recomputed, never imported. */
function recomputeSeed(service: string, content: string, sources: string): string {
  return createHash("sha256").update(`${service}\0${content}\0${sources}`).digest("hex").slice(0, 16);
}

/** The pick recipe, likewise: rank by sha256(seed NUL index NUL heading), lowest n, document order. */
function recomputePick(headings: string[], n: number, seed: string): string[] {
  return headings
    .map((heading, index) => ({
      index,
      heading,
      rank: createHash("sha256").update(`${seed}\0${index}\0${heading}`).digest("hex"),
    }))
    .sort((a, b) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : a.index - b.index))
    .slice(0, n)
    .sort((a, b) => a.index - b.index)
    .map((ranked) => ranked.heading);
}

describe("what a sampled vouch stamps", () => {
  it("records the scope beside vouched_by, with a seed anybody can recompute from the document", async () => {
    await withRepo(async (p) => {
      const res = await runLoam(p.workDir, "vouch", "--sample", "2", "--yes", "--json");
      expect(res.code).toBe(0);
      const json = JSON.parse(res.stdout);

      const fm = parseFrontmatter(await p.read(SPEC));
      // The frozen half is untouched: a sampled vouch is still `verified`,
      // still attributed, still digested. Only the scope is new.
      expect(stringField(fm, "status")).toBe("verified");
      expect(stringField(fm, "vouched_by")).toBe(TEST_IDENTITY);
      const scope = stringField(fm, "vouch_scope");
      expect(scope).toMatch(/^sampled 2\/9 seed=[0-9a-f]{16}$/);

      // The audit: the seed in the document is derivable from two other
      // fields of the same document. If this ever fails, nobody can check a
      // sampled vouch's reading list after the fact, which is the whole
      // reason the seed is content-derived.
      const seed = recomputeSeed(SVC, json.content_digest, json.sources_digest);
      expect(scope).toBe(`sampled 2/9 seed=${seed}`);
      expect(json.vouchScope).toEqual({
        mode: "sampled",
        sections: 2,
        of: 9,
        seed,
        headings: recomputePick(SECTIONS, 2, seed),
      });
    });
  });

  it("stamps the content_digest the seed was derived from — the pre-stamp body IS the stamped body", async () => {
    // The property that lets a person be shown a reading list before the
    // value it is keyed to exists on disk: `withFrontmatterFields` leaves the
    // body byte-identical, so contentDigest(raw) before the stamp equals the
    // content_digest after it.
    await withRepo(async (p) => {
      const before = contentDigest(await p.read(SPEC));
      await runLoam(p.workDir, "vouch", "--sample", "2", "--yes", "--json");
      const after = await p.read(SPEC);
      expect(stringField(parseFrontmatter(after), "content_digest")).toBe(before);
      expect(after.endsWith(BODY)).toBe(true);
    });
  });

  it("picks the same sections twice over identical trees, and different ones after a one-byte edit", async () => {
    const scopeOf = async (p: Project): Promise<string | undefined> =>
      stringField(parseFrontmatter(await p.read(SPEC)), "vouch_scope");
    const first = await repoProject();
    const second = await repoProject();
    try {
      await runLoam(first.workDir, "vouch", "--sample", "3", "--yes", "--json");
      await runLoam(second.workDir, "vouch", "--sample", "3", "--yes", "--json");
      expect(await scopeOf(first)).toBe(await scopeOf(second));

      // One byte of body changes the seed: the sample moves with the text, so
      // a pick can only be moved by an edit — which is recorded, and which
      // voids any stamp standing over the old words.
      await second.write(SPEC, `---\n${ONE_SOURCE}\n---\n${BODY}\nOne more line.\n`);
      await runLoam(second.workDir, "vouch", "--sample", "3", "--yes", "--json");
      expect(await scopeOf(second)).not.toBe(await scopeOf(first));
    } finally {
      await first.destroy();
      await second.destroy();
    }
  });

  it("degrades to an ordinary full vouch when the sample covers every section", async () => {
    await withRepo(async (p) => {
      const res = await runLoam(p.workDir, "vouch", "--sample", "99", "--yes", "--json");
      expect(res.code).toBe(0);
      const json = JSON.parse(res.stdout);
      expect(json.vouchScope).toBeNull();
      expect(stringField(parseFrontmatter(await p.read(SPEC)), "vouch_scope")).toBeUndefined();
    });
  });

  it("says so on the terminal — the reading list, the sections, and what the stamp will claim", async () => {
    await withRepo(async (p) => {
      const res = await runLoam(p.workDir, "vouch", "--sample", "2", "--yes");
      expect(res.code).toBe(0);
      // The list a person reads FROM, with file line numbers rather than
      // body-relative ones, and the preamble named outside the count.
      expect(res.out).toMatch(/spec\.md:\d+ /);
      expect(res.out).toContain("the preamble above the first heading");
      expect(res.out).toContain("sources — 1 entry, 1 file");
      // And the consequence, before and after: the stamp screen carries the
      // scope in the same column as the digests it qualifies.
      expect(res.out).toContain("vouch_scope     sampled 2/9");
      expect(res.out).toContain("7 sections unread");
      expect(res.out).toContain("sources.sampled-vouch");
    });
  });
});

describe("a sampled vouch refuses what it cannot honestly stamp", () => {
  it.each([
    ["0", "zero sections is not a read"],
    ["x", "not a number at all"],
    ["2.5", "a fraction of a section"],
    ["-1", "a negative count"],
  ])("refuses --sample %s (%s) as invalid-option, writing nothing", async (value) => {
    await withRepo(async (p) => {
      const before = await treeHashes(p.docsDir);
      const res = await runLoam(p.workDir, "vouch", `--sample=${value}`, "--yes", "--json");
      expect(res.code).toBe(1);
      expect(JSON.parse(res.stdout).error.code).toBe("invalid-option");
      expect(await treeHashes(p.docsDir)).toEqual(before);
    });
  });

  it("still refuses --json without --yes: sampling never loosens who has to be there", async () => {
    await withRepo(async (p) => {
      const res = await runLoam(p.workDir, "vouch", "--sample", "2", "--json");
      expect(res.code).toBe(1);
      expect(JSON.parse(res.stdout).error.code).toBe("vouch-unattended");
    });
  });

  it("raises the vouch's own source refusals BEFORE anyone is asked to read a sample", async () => {
    // The reading list is built through `verifySpec`, so a document that
    // cannot be vouched for at all refuses with the same code it always did —
    // rather than sending somebody off to read four sections of a document
    // this run was never going to stamp.
    await withRepo(async (p) => {
      await p.write(SPEC, `---\nservice: ${SVC}\nstatus: draft\nsources:\n  - src/gone.ts\n---\n${BODY}`);
      const res = await runLoam(p.workDir, "vouch", "--sample", "2", "--yes", "--json");
      expect(res.code).toBe(1);
      expect(JSON.parse(res.stdout).error.code).toBe("sources-path-missing");
    });
  });

  it("refuses vouch-raced when the document moved while the sample was being read, and writes nothing", async () => {
    await withRepo(async (p) => {
      const built = await buildSamplePlan({ docsDir: p.docsDir, service: SVC, repoDir: p.workDir, n: 2 });
      expect(built.ok).toBe(true);
      if (!built.ok) return;
      // The reading window: minutes pass, and nothing locks the document. The
      // sections that person was shown are no longer the sections a stamp
      // would cover, so the stamp must not happen.
      await p.write(SPEC, `---\n${ONE_SOURCE}\n---\n${BODY}\nEdited while they were reading.\n`);
      const before = await treeHashes(p.docsDir);
      const out = await vouch({
        docsDir: p.docsDir,
        service: SVC,
        repoDir: p.workDir,
        today: "2026-08-27",
        vouchedBy: TEST_IDENTITY,
        sample: built.plan,
      });
      expect(out.ok).toBe(false);
      if (out.ok) return;
      expect(out.code).toBe("vouch-raced");
      expect(out.message).toContain("while you were reading the sample");
      expect(await treeHashes(p.docsDir)).toEqual(before);
    });
  });

  it("refuses when a second spec axis appeared after the reading list was printed", async () => {
    // Nobody was shown arch.spec.md, and an all-or-nothing vouch would stamp
    // it anyway. Joined by filename in both directions for exactly this.
    await withRepo(async (p) => {
      const built = await buildSamplePlan({ docsDir: p.docsDir, service: SVC, repoDir: p.workDir, n: 2 });
      expect(built.ok).toBe(true);
      if (!built.ok) return;
      await p.write(ARCH, `---\nservice: ${SVC}\nstatus: draft\nsources:\n  - src/payment.ts\n---\n${BODY}`);
      const out = await vouch({
        docsDir: p.docsDir,
        service: SVC,
        repoDir: p.workDir,
        today: "2026-08-27",
        vouchedBy: TEST_IDENTITY,
        sample: built.plan,
      });
      expect(out.ok).toBe(false);
      if (out.ok) return;
      expect(out.code).toBe("vouch-raced");
      expect(out.message).toContain("arch.spec.md");
    });
  });
});

describe("both spec axes are sampled independently", () => {
  it("stamps a seed per file and reports both scopes", async () => {
    await withRepo(
      async (p) => {
        const res = await runLoam(p.workDir, "vouch", "--sample", "2", "--yes", "--json");
        expect(res.code).toBe(0);
        const json = JSON.parse(res.stdout);
        expect(json.vouchScope.sections).toBe(2);
        expect(json.archSpec.vouchScope.sections).toBe(2);
        // Different files, different content digests, therefore different
        // seeds: one seed for the pair would read the same sections of both.
        expect(json.archSpec.vouchScope.seed).not.toBe(json.vouchScope.seed);
        expect(stringField(parseFrontmatter(await p.read(ARCH)), "vouch_scope")).toBe(
          `sampled 2/${json.archSpec.vouchScope.of} seed=${json.archSpec.vouchScope.seed}`,
        );
      },
      { [ARCH]: `---\nservice: ${SVC}\nstatus: draft\nsources:\n  - src/payment.ts\n---\n${BODY}\n\n## Deployment\n\nOne region.\n` },
    );
  });

  it("stamps one file sampled and its sibling full when only one is big enough", async () => {
    await withRepo(
      async (p) => {
        const res = await runLoam(p.workDir, "vouch", "--sample", "3", "--yes", "--json");
        const json = JSON.parse(res.stdout);
        expect(json.vouchScope.sections).toBe(3);
        expect(json.archSpec.vouchScope).toBeNull();
        expect(stringField(parseFrontmatter(await p.read(ARCH)), "vouch_scope")).toBeUndefined();
      },
      { [ARCH]: `---\nservice: ${SVC}\nstatus: draft\nsources:\n  - src/payment.ts\n---\n\n## Shape\n\nOne container.\n` },
    );
  });
});

describe("a sampled vouch is distinguishable from a full one on every surface", () => {
  it("list says `vouched (sampled)` in text and carries an additive vouchScope key in --json", async () => {
    await withRepo(async (p) => {
      await runLoam(p.workDir, "vouch", "--sample", "2", "--yes", "--json");

      const text = await runLoam(p.workDir, "list");
      expect(text.out).toContain("vouched (sampled)");

      const json = JSON.parse((await runLoam(p.workDir, "list", "--json")).stdout);
      const row = json.services.find((s: { id: string }) => s.id === SVC);
      // The rung itself is frozen and unchanged — a consumer counting
      // `vouched` keeps counting this one.
      expect(row.maturity).toBe("vouched");
      expect(row.vouchScope).toBe("sampled");
    });
  });

  it("omits the list key entirely for a full vouch — absence is the fine case", async () => {
    await withRepo(async (p) => {
      await runLoam(p.workDir, "vouch", "--yes", "--json");
      const json = JSON.parse((await runLoam(p.workDir, "list", "--json")).stdout);
      const row = json.services.find((s: { id: string }) => s.id === SVC);
      expect(row.maturity).toBe("vouched");
      expect("vouchScope" in row).toBe(false);
    });
  });

  it("validate warns sources.sampled-vouch, naming k/n and the seed, and still exits 0", async () => {
    await withRepo(async (p) => {
      await runLoam(p.workDir, "vouch", "--sample", "2", "--yes", "--json");
      const res = await runLoam(p.workDir, "validate", "--service", SVC, "--json");
      // A warning, by the sources.stale doctrine: incompleteness is a signal,
      // and a fleet that wants a gate branches on the code in its own CI.
      expect(res.code).toBe(0);
      const finding = JSON.parse(res.stdout).targets[0].findings.find(
        (f: { code: string }) => f.code === "sources.sampled-vouch",
      );
      expect(finding.severity).toBe("warn");
      expect(finding.message).toContain("2 of 9 section(s) were read");
      expect(finding.message).toContain("read by nobody");
    });
  });

  it("grades a vouch_scope nobody can decode as sampled anyway — fail closed", async () => {
    await withRepo(async (p) => {
      await runLoam(p.workDir, "vouch", "--yes", "--json");
      // Hand-mangled, the one way a partial claim could try to become a full
      // one: an unreadable field must never be the way through.
      await p.write(SPEC, withFrontmatterFields(await p.read(SPEC), { vouch_scope: "read some of it" }));
      const res = await runLoam(p.workDir, "validate", "--service", SVC, "--json");
      const codes = JSON.parse(res.stdout).targets[0].findings.map((f: { code: string }) => f.code);
      expect(codes).toContain("sources.sampled-vouch");
      const list = JSON.parse((await runLoam(p.workDir, "list", "--json")).stdout);
      expect(list.services.find((s: { id: string }) => s.id === SVC).vouchScope).toBe("sampled");
    });
  });

  it("grades a scope rewritten as structured YAML as sampled on every surface — the fail-open that nearly shipped", async () => {
    // A hand edit, a YAML-aware merge tool, or an agent deciding the field
    // reads better as a mapping. `stringField` answers `undefined` for it,
    // exactly as it does for an absent key, so every reader that asked
    // "is there a string here?" would have promoted a partial vouch to a full
    // one — on the fleet dial, in validate, and worst of all in the reading
    // pack, which would then license skipping sections nobody read.
    await withRepo(async (p) => {
      await runLoam(p.workDir, "vouch", "--yes", "--json");
      const raw = await p.read(SPEC);
      await p.write(SPEC, raw.replace("status: verified", "status: verified\nvouch_scope:\n  sections: 2\n  of: 9"));

      const codes = JSON.parse((await runLoam(p.workDir, "validate", "--service", SVC, "--json")).stdout)
        .targets[0].findings.map((f: { code: string }) => f.code);
      expect(codes).toContain("sources.sampled-vouch");

      const list = JSON.parse((await runLoam(p.workDir, "list", "--json")).stdout);
      expect(list.services.find((s: { id: string }) => s.id === SVC).vouchScope).toBe("sampled");
      expect((await runLoam(p.workDir, "show", SVC)).out).toContain("verified (sampled)");
      expect((await runLoam(p.workDir, "vouch", "--pack")).out).toContain("graded as");
    });
  });

  it("says so when only arch.spec.md was sampled — the sample is per file, the service is not", async () => {
    // A short spec.md read in full beside a long arch.spec.md read from a
    // sample: `validate` reported it and the fleet dial did not, because the
    // row was graded from spec.md's header alone.
    await withRepo(
      async (p) => {
        const res = JSON.parse((await runLoam(p.workDir, "vouch", "--sample", "4", "--yes", "--json")).stdout);
        expect(res.vouchScope).toBeNull();
        expect(res.archSpec.vouchScope.sections).toBe(4);

        const list = JSON.parse((await runLoam(p.workDir, "list", "--json")).stdout);
        expect(list.services.find((s: { id: string }) => s.id === SVC).vouchScope).toBe("sampled");
        expect((await runLoam(p.workDir, "list")).out).toContain("vouched (sampled)");
        const show = await runLoam(p.workDir, "show", SVC);
        expect(show.out).toContain("verified (sampled)");
        expect(show.out).toContain("arch.spec.md sampled 4/");
        const showJson = JSON.parse((await runLoam(p.workDir, "show", SVC, "--json")).stdout);
        expect(showJson.frontmatter.vouch_scope).toBeNull();
        expect(showJson.archSpec.vouch_scope).toMatch(/^sampled 4\//);

        // The intersection this file and context.test.ts each missed one half
        // of: an arch-axis-ONLY sample, read through `loam context`. It was
        // the last surface blind to it — the pack read spec.md's header alone,
        // so it printed `verified` with `vouch_scope: null` and then every
        // arch requirement verbatim, of which that vouch covered four of nine
        // sections. It is also the surface whose reader is an agent about to
        // act on the licence, and `loam_context` exposes it over MCP besides.
        const ctx = await runLoam(p.workDir, "context", SVC);
        expect(ctx.out).toContain("archSpec.vouch_scope: sampled 4/");
        expect(ctx.out).toContain("the rest of arch.spec.md was not read at that vouch");
        const ctxJson = JSON.parse((await runLoam(p.workDir, "context", SVC, "--json")).stdout);
        expect(ctxJson.frontmatter.vouch_scope).toBeNull();
        expect(ctxJson.archSpec.vouch_scope).toMatch(/^sampled 4\//);
        // The pack really does hand over the requirements the sample did not
        // cover — which is why the scope has to travel with them.
        expect(ctxJson.archRequirements.length).toBeGreaterThan(0);
      },
      {
        [SPEC]: `---\n${ONE_SOURCE}\n---\n\n# payment-service\n\n## Overview\n\nShort.\n\n## Requirements\n\n### Requirement: Authorize a payment\nThe service SHALL authorize a payment before capture.\n\nOperations: authorizePayment\n\n#### Scenario: Successful authorization\n- **Given** a valid card\n- **When** authorization is requested\n- **Then** the payment is authorized\n`,
        [ARCH]: `---\nservice: ${SVC}\nstatus: draft\nsources:\n  - src/payment.ts\n---\n${BODY}`,
      },
    );
  });

  it("show qualifies the status badge and prints the scope beside the sources", async () => {
    await withRepo(async (p) => {
      await runLoam(p.workDir, "vouch", "--sample", "2", "--yes", "--json");
      const text = await runLoam(p.workDir, "show", SVC);
      expect(text.out).toContain("verified (sampled)");
      expect(text.out).toContain("spec.md sampled 2/9");
      expect(text.out).toContain("the rest of it was not read at that vouch");
      const json = JSON.parse((await runLoam(p.workDir, "show", SVC, "--json")).stdout);
      expect(json.frontmatter.status).toBe("verified");
      expect(json.frontmatter.vouch_scope).toMatch(/^sampled 2\/9 /);
    });
  });

  it("the context pack carries the scope beside the status an agent reads it by", async () => {
    await withRepo(async (p) => {
      await runLoam(p.workDir, "vouch", "--sample", "2", "--yes", "--json");
      const text = await runLoam(p.workDir, "context", SVC);
      expect(text.out).toMatch(/vouch_scope: sampled 2\/9 /);
      expect(text.out).toContain("the rest was not read at that vouch");
      const json = JSON.parse((await runLoam(p.workDir, "context", SVC, "--json")).stdout);
      expect(json.frontmatter.vouch_scope).toMatch(/^sampled 2\/9 /);
      // The other axis stays null and silent: this fixture has no
      // arch.spec.md, and a per-axis key that fired on absence would put a
      // scope on a document nobody ever stamped.
      expect(json.archSpec.vouch_scope).toBeNull();
      expect(text.out).not.toContain("archSpec.vouch_scope");
    });
  });

  it("the adopt brief names vouch_scope among the fields never to write by hand", async () => {
    // The one stamp an agent could silence by DELETING it, which is why the
    // brief has to name it rather than leave it to the sibling rule.
    await withRepo(async (p) => {
      const json = JSON.parse((await runLoam(p.workDir, "adopt", "--service", SVC, "--json")).stdout);
      expect(json.frontmatter.never).toContain("vouch_scope");
    });
  });

  it("the fleet scorecard counts sampled vouches beside the vouched total, never inside it silently", async () => {
    await withRepo(async (p) => {
      await runLoam(p.workDir, "vouch", "--sample", "2", "--yes", "--json");
      const res = await runLoam(p.workDir, "validate", "--all", "--json");
      const card = JSON.parse(res.stdout).scorecard;
      expect(card.provenance.vouched).toBeGreaterThanOrEqual(1);
      expect(card.provenance.sampledVouched).toBe(1);
      const text = await runLoam(p.workDir, "validate", "--all");
      expect(text.out).toContain("(1 sampled)");
    });
  });

  it("every fleet summary that names `vouched` names the sampled share too", async () => {
    // The per-row suffix is not enough on a hundred-service fleet: these are
    // the three lines a lead actually reads for the trust answer, and
    // recovering "how many of those were read in full" by scanning rows is
    // not an answer. The rung, the rollup and `--needs-work` are untouched.
    await withRepo(async (p) => {
      await runLoam(p.workDir, "vouch", "--sample", "2", "--yes", "--json");
      expect((await runLoam(p.workDir, "list")).out).toMatch(/maturity: .*1 vouched \(1 sampled\)/);
      expect((await runLoam(p.workDir, "status")).out).toContain("1 vouched (1 sampled)");
      const status = JSON.parse((await runLoam(p.workDir, "status", "--json")).stdout);
      expect(status.services.vouched).toBe(1);
      expect(status.services.sampledVouched).toBe(1);
      // A subset, never a fourth bucket: the three states still sum to total.
      expect(status.services.undocumented + status.services.draft + status.services.vouched).toBe(
        status.services.total,
      );
    });
  });
});

describe("a full vouch clears the scope", () => {
  it("deletes vouch_scope from the frontmatter and silences the finding", async () => {
    await withRepo(async (p) => {
      await runLoam(p.workDir, "vouch", "--sample", "2", "--yes", "--json");
      expect(stringField(parseFrontmatter(await p.read(SPEC)), "vouch_scope")).toBeDefined();

      await runLoam(p.workDir, "vouch", "--yes", "--json");
      const after = parseFrontmatter(await p.read(SPEC));
      // Deleted, not blanked: a stale scope left behind would keep a fully
      // read document reading as sampled forever.
      expect(stringField(after, "vouch_scope")).toBeUndefined();
      expect(await p.read(SPEC)).not.toContain("vouch_scope");
      expect(stringField(after, "status")).toBe("verified");

      const res = await runLoam(p.workDir, "validate", "--service", SVC, "--json");
      const codes = JSON.parse(res.stdout).targets[0].findings.map((f: { code: string }) => f.code);
      expect(codes).not.toContain("sources.sampled-vouch");
    });
  });

  it("keeps the body byte-identical while deleting the field", async () => {
    await withRepo(async (p) => {
      await runLoam(p.workDir, "vouch", "--sample", "2", "--yes", "--json");
      await runLoam(p.workDir, "vouch", "--yes", "--json");
      expect((await p.read(SPEC)).endsWith(BODY)).toBe(true);
    });
  });
});

describe("the reading pack and the sample agree", () => {
  it("--pack --sample prescribes exactly the sections the vouch then stamps for", async () => {
    // Two commands, one seeded derivation. A pack that prescribed a different
    // sample than the stamp records would make the record worse than none.
    await withRepo(async (p) => {
      const pack = JSON.parse((await runLoam(p.workDir, "vouch", "--pack", "--sample", "2", "--json")).stdout);
      expect(pack.spec.sample.of).toBe(9);
      expect(pack.spec.sample.headings).toHaveLength(2);

      const stamped = JSON.parse((await runLoam(p.workDir, "vouch", "--sample", "2", "--yes", "--json")).stdout);
      expect(stamped.vouchScope.seed).toBe(pack.spec.sample.seed);
      expect(stamped.vouchScope.headings).toEqual(pack.spec.sample.headings);
    });
  });

  it("--pack --sample prints only the sampled sections, not the full heading list", async () => {
    await withRepo(async (p) => {
      const res = await runLoam(p.workDir, "vouch", "--pack", "--sample", "2");
      expect(res.code).toBe(0);
      expect(res.out).toContain("sampled read — 2 of 9 section(s)");
      expect(res.out).not.toContain("sections to read (9)");
    });
  });

  it("withdraws the already-covered licence after a sampled vouch, and names what nobody read", async () => {
    // The pack's "unchanged — previously vouched" list licenses a person to
    // SKIP a section. After a sampled vouch that licence is not there, and
    // the sections that survived the vouch unread are the actual read.
    await withRepo(async (p) => {
      await runLoam(p.workDir, "vouch", "--sample", "2", "--yes", "--json");
      const res = await runLoam(p.workDir, "vouch", "--pack");
      expect(res.out).toContain("was SAMPLED: 2 of 9 section(s)");
      expect(res.out).toContain('"Unchanged since then" does not mean anybody read it');
      expect(res.out).toContain("NEVER read by anyone (7)");
      expect(res.out).not.toContain("nothing of the document itself to re-read");

      const json = JSON.parse((await runLoam(p.workDir, "vouch", "--pack", "--json")).stdout);
      expect(json.spec.vouchScope.scope).toEqual({ sections: 2, of: 9, seed: expect.any(String) });
      expect(json.spec.vouchScope.read).toHaveLength(2);
      expect(json.spec.vouchScope.unread).toHaveLength(7);
      // What it read is recomputable from the stamp alone — the audit again,
      // this time on the way back out.
      expect([...json.spec.vouchScope.read, ...json.spec.vouchScope.unread].sort()).toEqual([...SECTIONS].sort());
    });
  });

  it("reports the scope but names no covered set when the read cannot be recomputed", async () => {
    await withRepo(async (p) => {
      await runLoam(p.workDir, "vouch", "--sample", "2", "--yes", "--json");
      await p.write(SPEC, `${await p.read(SPEC)}\n## Added after the vouch\n`);
      const json = JSON.parse((await runLoam(p.workDir, "vouch", "--pack", "--json")).stdout);
      // The body moved, so the pick cannot be reproduced over the bytes that
      // person read. Fail closed: the scope is still reported, and nothing is
      // claimed to be covered.
      expect(json.spec.vouchScope.read).toBeNull();
      expect(json.spec.vouchScope.unread).toBeNull();
    });
  });
});

describe("the sampling vocabulary itself", () => {
  it("splits on H2 and H3 outside fences, and agrees with sectionHeadings about every H2", async () => {
    const sections = splitSections(BODY);
    expect(sections.map((s) => s.heading)).toEqual(SECTIONS);
    // The fenced headings are prose about headings, not units.
    expect(sections.map((s) => s.heading)).not.toContain("## not a heading");
    // One fence rule, two walks: the pack's section delta speaks H2 and this
    // speaks H2+H3, and they must name the same H2s to the same person.
    expect(sections.filter((s) => s.level === 2).map((s) => ({ heading: s.heading, line: s.line }))).toEqual(
      sectionHeadings(BODY).map((h) => ({ heading: h.text, line: h.line })),
    );
  });

  it("survives CRLF and a BOM through rawBody", () => {
    const crlf = `---\r\nservice: x\r\n---\r\n\r\n## One\r\n\r\ntext\r\n\r\n### Two\r\n`;
    expect(splitSections(rawBody(`﻿${crlf}`)).map((s) => s.heading)).toEqual(["## One", "### Two"]);
  });

  it("returns the picked sections in document order, however they ranked", () => {
    const sections = splitSections(BODY);
    const picked = pickSample(sections, 4, "0123456789abcdef");
    expect(picked).toHaveLength(4);
    const lines = picked.map((s) => s.line);
    expect(lines).toEqual([...lines].sort((a, b) => a - b));
    // And the recipe is the documented one, recomputed here from scratch.
    expect(picked.map((s) => s.heading)).toEqual(recomputePick(SECTIONS, 4, "0123456789abcdef"));
  });

  it("derives the seed from the service and both digests, NUL-separated", () => {
    expect(sampleSeed("svc", "aaaa", "bbbb")).toBe(recomputeSeed("svc", "aaaa", "bbbb"));
    // The separators earn their keep: without them these two would collide.
    expect(sampleSeed("sv", "caaaa", "bbbb")).not.toBe(sampleSeed("svc", "aaaa", "bbbb"));
    // Same document, different service — different reading list.
    expect(sampleSeed("other", "aaaa", "bbbb")).not.toBe(sampleSeed("svc", "aaaa", "bbbb"));
  });

  it("round-trips the encoded scope and rejects everything else", () => {
    const scope = { sections: 4, of: 17, seed: "0123456789abcdef" };
    expect(encodeVouchScope(scope)).toBe("sampled 4/17 seed=0123456789abcdef");
    expect(decodeVouchScope(encodeVouchScope(scope))).toEqual(scope);
    for (const bad of [
      undefined,
      "",
      "sampled 4/17",
      "sampled 4/17 seed=xyz",
      "sampled 4/17 seed=0123456789abcde", // 15 hex — a truncated write is not a scope
      "sampled 17/17 seed=0123456789abcdef", // a "sample" of everything is not one
      "sampled 0/17 seed=0123456789abcdef",
      "full",
      "yes",
    ]) {
      expect(decodeVouchScope(bad), `decoded ${String(bad)}`).toBeNull();
    }
  });

  it("treats every present scope as sampled — including one that is not text at all", () => {
    // The rule every reader depends on, and the shape that nearly broke it:
    // `stringField` answers `undefined` for a mapping or a sequence exactly as
    // it does for an absent key, so a scope hand-edited (or "tidied") into
    // structured YAML would have read as a FULL vouch on every surface. Key
    // presence is the test.
    const read = (header: string): string => readVouchScope(parseFrontmatter(`---\n${header}\n---\n\nbody\n`)).kind;
    expect(read("vouch_scope: sampled 2/9 seed=0123456789abcdef")).toBe("sampled");
    expect(read("vouch_scope: read some of it")).toBe("unreadable");
    expect(read("vouch_scope:\n  sections: 2\n  of: 9")).toBe("unreadable");
    expect(read("vouch_scope:\n  - 2\n  - 9")).toBe("unreadable");
    expect(read("vouch_scope: 12")).toBe("unreadable");
    expect(read("status: verified")).toBe("none");
    // And the display text never comes back empty for a present scope, since
    // a surface that printed nothing would say "full vouch" by omission.
    const shown = (header: string): string | null => scopeText(parseFrontmatter(`---\n${header}\n---\n\nbody\n`));
    expect(shown("vouch_scope:\n  sections: 2")).toContain("not text");
    expect(shown("vouch_scope: read some of it")).toBe("read some of it");
    expect(shown("status: verified")).toBeNull();
  });

  it("recomputes a recorded sample, and refuses to when the body no longer matches", () => {
    const scope = { sections: 2, of: 9, seed: "0123456789abcdef" };
    expect(sampledSections(BODY, scope)?.map((s) => s.heading)).toEqual(
      recomputePick(SECTIONS, 2, "0123456789abcdef"),
    );
    // A body with a different section count cannot reproduce the pick, so no
    // claim about what was read is safe.
    expect(sampledSections(`${BODY}\n## Added\n`, scope)).toBeNull();
  });
});

describe("withFrontmatterFields removes named keys", () => {
  it("removes the key, keeps its neighbours and their order, and leaves the body byte-identical", () => {
    const source = `---\nservice: x\nstatus: verified\nvouch_scope: sampled 2/9 seed=0123456789abcdef\nowner: t\n---\n\n# Body\n\ntext\n`;
    const out = withFrontmatterFields(source, { last_verified: "2026-08-27" }, ["vouch_scope"]);
    expect(out).not.toContain("vouch_scope");
    expect(out).toContain("service: x");
    expect(out).toContain("owner: t");
    expect(out.indexOf("status:")).toBeLessThan(out.indexOf("owner:"));
    expect(rawBody(out)).toBe(rawBody(source));
  });

  it("removes a key that was never there, and one from a document with no header at all", () => {
    // yaml's own `delete` throws on a document with no mapping contents, so
    // the guard is load-bearing: a first vouch of a header-less document asks
    // for `vouch_scope` to be cleared on the way in.
    expect(withFrontmatterFields(`---\nservice: x\n---\n\nbody\n`, {}, ["vouch_scope"])).toContain("service: x");
    const made = withFrontmatterFields("# Just a body\n", { status: "verified" }, ["vouch_scope"]);
    expect(made).toContain("status: verified");
    expect(made).toContain("# Just a body");
  });

  it("removes a key whose value is a mapping — the shape a hand edit reaches for", () => {
    const source = `---\nstatus: verified\nvouch_scope:\n  sections: 2\n  of: 9\n---\n\nbody\n`;
    const out = withFrontmatterFields(source, { last_verified: "2026-08-27" }, ["vouch_scope"]);
    expect(out).not.toContain("vouch_scope");
    expect(out).not.toContain("sections:");
  });
});
