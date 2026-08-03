/**
 * Tests for `loam vouch` (src/commands/vouch.ts) — the human half of the
 * provenance loop.
 *
 * `sources` says which code a document was written from, and `loam validate`
 * checks those paths still exist. What it could not say until now is whether
 * the code MOVED since anyone read it. `vouch` is the act that makes that
 * answerable: a human reads the code, and loam stamps `status: verified`, the
 * date, a digest of the source content — and a digest of the document's own
 * body, so the words cannot move under the stamp either. Every later
 * `validate` compares them and says `sources.current`, `sources.stale`, or
 * `content.stale`.
 *
 * So the invariants worth pinning are the ones that make the stamp trustworthy:
 *  - it is a claim, not an edit — the body comes out byte-identical;
 *  - it never stamps something it cannot verify (no sources, a missing path, a
 *    glob matching nothing, a repo that is not this service's);
 *  - a refusal writes nothing at all;
 *  - and both round trips close: unvouched -> current -> stale for the code,
 *    vouched -> edited -> re-vouched for the document.
 */
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { coherentFixture, makeProject, runLoam, writeFiles, type Project } from "./helpers/harness.js";
import { parseFrontmatter, stringField, listField } from "../src/core/frontmatter.js";
import { vouch } from "../src/commands/vouch.js";

const SVC = "payment-service";
const SPEC = `services/${SVC}/spec.md`;

/** The body every fixture spec carries, verbatim — what must survive a vouch. */
const BODY = `
# payment-service

## Requirements

### Requirement: Authorize a payment
The service SHALL authorize a payment before capture.

Operations: authorizePayment

#### Scenario: Successful authorization
- **Given** a valid card
- **When** authorization is requested
- **Then** the payment is authorized
`;

/**
 * A project whose workDir doubles as payment-service's own repo: loam.json says
 * `service: payment-service`, so `sources` resolve against it — which is the only
 * situation vouch runs in.
 */
async function repoProject(
  frontmatter: string,
  repoFiles: Record<string, string>,
  opts: { service?: string } = {},
): Promise<Project> {
  const files = coherentFixture();
  files[SPEC] = `---\n${frontmatter}\n---\n${BODY}`;
  const p = await makeProject(files, { service: opts.service ?? SVC });
  await writeFiles(p.workDir, repoFiles);
  return p;
}

async function withRepo(
  frontmatter: string,
  repoFiles: Record<string, string>,
  fn: (p: Project) => Promise<void>,
  opts: { service?: string } = {},
): Promise<void> {
  const p = await repoProject(frontmatter, repoFiles, opts);
  try {
    await fn(p);
  } finally {
    await p.destroy();
  }
}

const ONE_SOURCE = `service: ${SVC}\nstatus: draft\nowner: payments-team\nsources:\n  - src/payment.ts`;
const CODE = { "src/payment.ts": "export const authorize = () => true;\n" };

describe("what vouch stamps", () => {
  it("writes status, the date and a digest of the sources in one pass", async () => {
    await withRepo(ONE_SOURCE, CODE, async (p) => {
      const res = await runLoam(p.workDir, "vouch");
      expect(res.code).toBe(0);

      const fm = parseFrontmatter(await p.read(SPEC));
      expect(stringField(fm, "status")).toBe("verified");
      expect(stringField(fm, "last_verified")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(stringField(fm, "sources_digest")).toMatch(/^[0-9a-f]{16}$/);
    });
  });

  it("leaves the body byte-identical — a vouch is a claim about the document, not an edit of it", async () => {
    await withRepo(ONE_SOURCE, CODE, async (p) => {
      await runLoam(p.workDir, "vouch");
      const after = await p.read(SPEC);
      expect(after.endsWith(BODY)).toBe(true);
    });
  });

  it("keeps the frontmatter that was already there instead of rewriting the header", async () => {
    await withRepo(ONE_SOURCE, CODE, async (p) => {
      await runLoam(p.workDir, "vouch");
      const fm = parseFrontmatter(await p.read(SPEC));
      expect(stringField(fm, "service")).toBe(SVC);
      expect(stringField(fm, "owner")).toBe("payments-team");
      expect(listField(fm, "sources")).toEqual(["src/payment.ts"]);
    });
  });

  it("takes the date it stamps from its caller, so the stamp is not the clock's opinion", async () => {
    await withRepo(ONE_SOURCE, CODE, async (p) => {
      const out = await vouch({
        docsDir: p.docsDir,
        service: SVC,
        repoDir: p.workDir,
        today: "2020-01-02",
      });
      expect(out.ok).toBe(true);
      expect(stringField(parseFrontmatter(await p.read(SPEC)), "last_verified")).toBe("2020-01-02");
    });
  });

  it("is idempotent while the code sits still — vouching twice writes the same bytes", async () => {
    await withRepo(ONE_SOURCE, CODE, async (p) => {
      const req = { docsDir: p.docsDir, service: SVC, repoDir: p.workDir, today: "2026-08-03" };
      await vouch(req);
      const once = await p.read(SPEC);
      await vouch(req);
      expect(await p.read(SPEC)).toBe(once);
    });
  });

  it("stamps a spec that was never verified before, digest and all", async () => {
    // `status: draft` with no `last_verified` is the state `adopt` leaves behind:
    // the fields have to be created, not just updated.
    await withRepo(`service: ${SVC}\nstatus: draft\nsources:\n  - src/payment.ts`, CODE, async (p) => {
      await runLoam(p.workDir, "vouch");
      const fm = parseFrontmatter(await p.read(SPEC));
      expect(stringField(fm, "status")).toBe("verified");
      expect(stringField(fm, "sources_digest")).toMatch(/^[0-9a-f]{16}$/);
    });
  });
});

describe("what vouch refuses", () => {
  it("refuses a spec that names no sources — there is nothing to vouch it against", async () => {
    await withRepo(`service: ${SVC}\nstatus: draft`, CODE, async (p) => {
      const res = await runLoam(p.workDir, "vouch", "--json");
      expect(res.code).toBe(1);
      const json = JSON.parse(res.stdout);
      expect(json.ok).toBe(false);
      expect(json.error.code).toBe("sources-absent");
    });
  });

  it("refuses when a listed source is gone — stamping would vouch for code that is not there", async () => {
    await withRepo(`service: ${SVC}\nstatus: draft\nsources:\n  - src/gone.ts`, CODE, async (p) => {
      const res = await runLoam(p.workDir, "vouch", "--json");
      expect(res.code).toBe(1);
      const json = JSON.parse(res.stdout);
      expect(json.error.code).toBe("sources-path-missing");
      expect(json.error.message).toContain("src/gone.ts");
    });
  });

  it("refuses a glob that matches no file — an empty digest would read as verified forever", async () => {
    // The directory exists, so the path check passes; the pattern still covers
    // nothing, and a digest over nothing never changes.
    await withRepo(`service: ${SVC}\nstatus: draft\nsources:\n  - src/**/*.java`, CODE, async (p) => {
      const res = await runLoam(p.workDir, "vouch", "--json");
      expect(res.code).toBe(1);
      expect(JSON.parse(res.stdout).error.code).toBe("sources-absent");
    });
  });

  it("refuses to vouch for a service this repo is not — the paths would be someone else's", async () => {
    await withRepo(
      ONE_SOURCE,
      CODE,
      async (p) => {
        const res = await runLoam(p.workDir, "vouch", "--service", SVC, "--json");
        expect(res.code).toBe(1);
        const json = JSON.parse(res.stdout);
        expect(json.error.code).toBe("invalid-option");
        expect(json.error.message).toContain("checkout-web");
      },
      { service: "checkout-web" },
    );
  });

  it("refuses a service with no living spec — there is no document to stamp", async () => {
    await withRepo(
      ONE_SOURCE,
      CODE,
      async (p) => {
        const res = await runLoam(p.workDir, "vouch", "--json");
        expect(res.code).toBe(1);
        expect(JSON.parse(res.stdout).error.code).toBe("unknown-target");
      },
      { service: "ghost-service" },
    );
  });

  it("writes nothing when it refuses — a failed vouch must not leave a half-stamp", async () => {
    await withRepo(`service: ${SVC}\nstatus: draft\nsources:\n  - src/gone.ts`, CODE, async (p) => {
      const before = await p.read(SPEC);
      await runLoam(p.workDir, "vouch");
      expect(await p.read(SPEC)).toBe(before);
    });
  });
});

describe("the content digest (the stamp covers the words, not just the code)", () => {
  it("stamps content_digest with the documented recipe: sha256 of the body below the closing '---', first 16 hex", async () => {
    await withRepo(ONE_SOURCE, CODE, async (p) => {
      await runLoam(p.workDir, "vouch");
      // BODY is byte-for-byte what follows the closing fence line — the vouch
      // rewrites only the header, so the digest recipe is pinnable from here.
      const expected = createHash("sha256").update(BODY, "utf8").digest("hex").slice(0, 16);
      expect(stringField(parseFrontmatter(await p.read(SPEC)), "content_digest")).toBe(expected);
    });
  });

  it("a body edit after the vouch fires content.stale — with no service repo in reach at all", async () => {
    // The forgery this closes: edit the prose, keep `status: verified`. It has
    // to surface from the DOCS repo, where sources.* cannot run — so loam.json
    // here names no service, and the vouch itself goes through the function.
    const files = coherentFixture();
    files[SPEC] = `---\n${ONE_SOURCE}\n---\n${BODY}`;
    const p = await makeProject(files);
    try {
      await writeFiles(p.workDir, CODE);
      const out = await vouch({ docsDir: p.docsDir, service: SVC, repoDir: p.workDir, today: "2026-08-03" });
      expect(out.ok).toBe(true);
      await p.write(SPEC, (await p.read(SPEC)) + "\nThe service SHALL also do a thing nobody vouched for.\n");

      const res = await runLoam(p.workDir, "validate", "--service", SVC, "--json");
      // A warning, not a breach: only a person can say whether verified still holds.
      expect(res.code).toBe(0);
      const findings = JSON.parse(res.stdout).targets[0].findings;
      const stale = findings.find((f: { code: string }) => f.code === "content.stale");
      expect(stale.severity).toBe("warn");
      expect(stale.message).toContain("loam vouch");
      expect(
        findings.map((f: { code: string }) => f.code),
        "sources.* need the service repo; the doc-side check must not",
      ).not.toContain("sources.current");

      // --all sees it too — the docs repo's own CI is the audience.
      const all = await runLoam(p.workDir, "validate", "--all", "--json");
      const allCodes = JSON.parse(all.stdout).targets.flatMap((t: { findings: Array<{ code: string }> }) =>
        t.findings.map((f) => f.code),
      );
      expect(allCodes).toContain("content.stale");
    } finally {
      await p.destroy();
    }
  });

  it("a frontmatter-only edit does not fire it — vouch itself rewrites the header, so the header cannot count", async () => {
    await withRepo(ONE_SOURCE, CODE, async (p) => {
      await runLoam(p.workDir, "vouch");
      const stamped = await p.read(SPEC);
      await p.write(SPEC, stamped.replace("owner: payments-team", "owner: platform-team"));
      const codes = JSON.parse((await runLoam(p.workDir, "validate", "--json")).stdout).targets[0].findings.map(
        (f: { code: string }) => f.code,
      );
      expect(codes).not.toContain("content.stale");
    });
  });

  it("re-vouching refreshes the stamp and clears the warning", async () => {
    await withRepo(ONE_SOURCE, CODE, async (p) => {
      const codes = async (): Promise<string[]> => {
        const json = JSON.parse((await runLoam(p.workDir, "validate", "--json")).stdout);
        return json.targets[0].findings.map((f: { code: string }) => f.code);
      };
      await runLoam(p.workDir, "vouch");
      await p.write(SPEC, (await p.read(SPEC)) + "\nAn edit the vouch never saw.\n");
      expect(await codes()).toContain("content.stale");
      expect((await runLoam(p.workDir, "vouch")).code).toBe(0);
      expect(await codes()).not.toContain("content.stale");
    });
  });
});

describe("the loop it closes", () => {
  it("turns validate's `sources.unvouched` into `sources.current`", async () => {
    await withRepo(ONE_SOURCE, CODE, async (p) => {
      const codes = async (): Promise<string[]> => {
        const json = JSON.parse((await runLoam(p.workDir, "validate", "--json")).stdout);
        return json.targets[0].findings.map((f: { code: string }) => f.code);
      };
      expect(await codes()).toContain("sources.unvouched");
      expect((await runLoam(p.workDir, "vouch")).code).toBe(0);
      expect(await codes()).toContain("sources.current");
    });
  });

  it("goes stale again the moment the code it vouched for changes", async () => {
    await withRepo(ONE_SOURCE, CODE, async (p) => {
      await runLoam(p.workDir, "vouch");
      await writeFile(join(p.workDir, "src/payment.ts"), "export const authorize = () => false;\n", "utf8");

      const res = await runLoam(p.workDir, "validate", "--json");
      // Staleness is a signal, not a breach: it must not gate.
      expect(res.code).toBe(0);
      const finding = JSON.parse(res.stdout).targets[0].findings.find(
        (f: { code: string }) => f.code === "sources.stale",
      );
      expect(finding.severity).toBe("warn");
    });
  });
});

describe("the machine contract", () => {
  it("reports what it stamped, so a caller need not re-read the file", async () => {
    await withRepo(ONE_SOURCE, CODE, async (p) => {
      const res = await runLoam(p.workDir, "vouch", "--json");
      expect(res.code).toBe(0);
      const json = JSON.parse(res.stdout);
      expect(json.ok).toBe(true);
      expect(json.service).toBe(SVC);
      expect(json.status).toBe("verified");
      expect(json.sources).toEqual(["src/payment.ts"]);
      expect(json.sources_digest).toMatch(/^[0-9a-f]{16}$/);
      expect(json.content_digest).toMatch(/^[0-9a-f]{16}$/);
      expect(json.files).toBe(1);
      // The digests it reports are the ones it wrote.
      const fm = parseFrontmatter(await p.read(SPEC));
      expect(stringField(fm, "sources_digest")).toBe(json.sources_digest);
      expect(stringField(fm, "content_digest")).toBe(json.content_digest);
    });
  });

  it("counts every file a directory source expands to", async () => {
    await withRepo(
      `service: ${SVC}\nstatus: draft\nsources:\n  - src/`,
      { "src/a.ts": "a\n", "src/nested/b.ts": "b\n" },
      async (p) => {
        const json = JSON.parse((await runLoam(p.workDir, "vouch", "--json")).stdout);
        expect(json.files).toBe(2);
      },
    );
  });

  it("says so in prose when there is no --json, and names the file it stamped", async () => {
    await withRepo(ONE_SOURCE, CODE, async (p) => {
      const res = await runLoam(p.workDir, "vouch");
      expect(res.out).toContain(SVC);
      expect(res.out).toContain("verified");
      expect(res.out).toContain("spec.md");
      // The prose carries the digest too — it is what a reviewer compares against.
      const digest = stringField(parseFrontmatter(await readFile(join(p.docsDir, SPEC), "utf8")), "sources_digest")!;
      expect(res.out).toContain(digest);
    });
  });
});
