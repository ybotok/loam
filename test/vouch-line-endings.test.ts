/**
 * A vouch survives a line-ending rewrite (src/core/provenance/stamp.ts's
 * `digestBytes`, src/core/document/frontmatter.ts's `contentDigest`).
 *
 * Both stamps used to hash raw bytes, on the belief that bytes survive a
 * clone. They do not: Git for Windows checks out with `core.autocrlf=true` by
 * default, so a service vouched on an LF machine read `sources.stale` and
 * `content.stale` on every Windows clone — and `vouch --pack` printed "body
 * changed" over an empty diff — with no word of anything changed. The same
 * happened inside one checkout after a plain `git checkout <rev> -- <file>`
 * over a file an agent wrote LF.
 *
 * The pins:
 *  - vouch on LF, rewrite every file CRLF: validate, the pack and the gate
 *    still read fresh — and the other direction;
 *  - a real edit after the rewrite still goes stale, naming only what moved;
 *  - a stamp written by the old raw-bytes recipe on a CRLF checkout still
 *    reads current there, so no existing stamp goes stale by the change;
 *  - a binary file keeps its exact bytes, git's own NUL heuristic.
 */
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { makeProject, makeTmpDir, runLoam, writeFiles, type Project } from "./helpers/harness.js";
import { contentDigest, holdsContentStamp, rawBody } from "../src/core/document/frontmatter.js";
import { digestBytes, sourcesDigest } from "../src/core/provenance/stamp.js";

const SVC = "payment-service";
const SPEC = `services/${SVC}/spec.md`;
const ARCH = `services/${SVC}/arch.spec.md`;

const BODY = `
# payment-service

## Overview
The service authorizes payments.

## Requirements

### Requirement: Authorize a payment
The service SHALL authorize a payment before capture.
`;

const ARCH_BODY = `
# payment-service — architecture

## Requirements

### Requirement: Authorizations are idempotent
The service SHALL treat a repeated authorization request as the original.
`;

const DRAFT_FM = `service: ${SVC}\nstatus: draft\nowner: payments-team\nsources:\n  - src`;

const CODE = {
  "src/payment.ts": "export const authorize = () => true;\n// second line\n",
  "src/capture.ts": "export const capture = () => true;\n",
};

/** Both spec axes as drafts over `src`, and the service repo's code — every file LF. */
async function project(): Promise<Project> {
  const p = await makeProject(
    { [SPEC]: `---\n${DRAFT_FM}\n---\n${BODY}`, [ARCH]: `---\n${DRAFT_FM}\n---\n${ARCH_BODY}` },
    { service: SVC },
  );
  await writeFiles(p.workDir, CODE);
  return p;
}

/** What a CRLF checkout does to a text file: every LF becomes CRLF. */
async function toCrlf(path: string): Promise<void> {
  const text = await readFile(path, "utf8");
  await writeFile(path, text.replace(/\r\n/g, "\n").replace(/\n/g, "\r\n"), "utf8");
}

/** The other direction: every CRLF becomes LF. */
async function toLf(path: string): Promise<void> {
  await writeFile(path, (await readFile(path, "utf8")).replace(/\r\n/g, "\n"), "utf8");
}

/** Every file a vouch stamps or hashes, in this project. */
function everyFile(p: Project): string[] {
  return [join(p.docsDir, SPEC), join(p.docsDir, ARCH), ...Object.keys(CODE).map((rel) => join(p.workDir, rel))];
}

interface FindingJson {
  code: string;
  severity: string;
  message: string;
  details?: string[];
}

async function findings(p: Project): Promise<FindingJson[]> {
  const res = await runLoam(p.workDir, "validate", "--json");
  return (JSON.parse(res.stdout) as { targets: { findings: FindingJson[] }[] }).targets.flatMap((t) => t.findings);
}

const STALE = ["sources.stale", "content.stale"];

describe("a vouch is about content, not one checkout's line endings", () => {
  it("vouched LF, checked out CRLF: validate, the pack and the gate all read fresh", async () => {
    const p = await project();
    try {
      expect((await runLoam(p.workDir, "vouch", "--yes")).code).toBe(0);
      for (const file of everyFile(p)) await toCrlf(file);

      const found = await findings(p);
      expect(found.map((f) => f.code).filter((c) => STALE.includes(c))).toEqual([]);
      expect(found.filter((f) => f.code === "sources.current")).toHaveLength(2);

      // The pack used to say "body changed since …" and then print git's
      // empty diff: the stamp disagreed with the working tree, git did not.
      const pack = JSON.parse((await runLoam(p.workDir, "vouch", "--pack", "--json")).stdout) as {
        spec: { body: { kind: string }; sources: { kind: string } };
        archSpec: { body: { kind: string }; sources: { kind: string } };
      };
      expect(pack.spec.body).toEqual({ kind: "unchanged" });
      expect(pack.spec.sources).toEqual({ kind: "unchanged" });
      expect(pack.archSpec.body).toEqual({ kind: "unchanged" });
      expect(pack.archSpec.sources).toEqual({ kind: "unchanged" });

      // The deploy gate reads freshness through the same findings.
      const gate = JSON.parse((await runLoam(p.workDir, "gate", "--json")).stdout) as {
        checks: { check: string; findings: FindingJson[] }[];
      };
      const freshness = gate.checks.find((c) => c.check === "freshness")!.findings;
      expect(freshness.map((f) => f.code).filter((c) => STALE.includes(c))).toEqual([]);
    } finally {
      await p.destroy();
    }
  });

  it("vouched CRLF, checked out LF — the Windows vouch reads fresh on Linux CI", async () => {
    const p = await project();
    try {
      for (const file of everyFile(p)) await toCrlf(file);
      expect((await runLoam(p.workDir, "vouch", "--yes")).code).toBe(0);
      for (const file of everyFile(p)) await toLf(file);
      expect((await findings(p)).map((f) => f.code).filter((c) => STALE.includes(c))).toEqual([]);
    } finally {
      await p.destroy();
    }
  });

  it("a real edit after the rewrite still goes stale — and names only the file that moved", async () => {
    const p = await project();
    try {
      expect((await runLoam(p.workDir, "vouch", "--yes")).code).toBe(0);
      for (const file of everyFile(p)) await toCrlf(file);
      await writeFile(join(p.workDir, "src/payment.ts"), "export const authorize = () => false;\r\n", "utf8");
      const spec = await p.read(SPEC);
      await p.write(SPEC, spec.replace("authorizes payments.", "authorizes card payments."));

      const found = await findings(p);
      const sources = found.filter((f) => f.code === "sources.stale");
      // Both axes stand over `src`, so both go stale — each naming the one
      // changed file, never the CRLF-rewritten one beside it.
      expect(sources).toHaveLength(2);
      for (const f of sources) expect(f.details).toEqual(["changed  src/payment.ts"]);
      const content = found.filter((f) => f.code === "content.stale");
      expect(content).toHaveLength(1);
      expect(content[0]!.message).toContain("spec.md");
    } finally {
      await p.destroy();
    }
  });

  it("git's own rewrite: `git checkout -- <file>` under autocrlf leaves the vouch current", async () => {
    const p = await project();
    const git = (...args: string[]): void => {
      const res = spawnSync("git", args, { cwd: p.workDir, encoding: "utf8", timeout: 30_000 });
      if (res.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${res.stderr}`);
    };
    try {
      git("init", "-q", "-b", "main");
      git("config", "core.autocrlf", "false");
      git("add", "-A");
      git("-c", "user.email=eol@test.invalid", "-c", "user.name=Eol Test", "commit", "-q", "-m", "base");
      expect((await runLoam(p.workDir, "vouch", "--yes")).code).toBe(0);
      // The report's reproduction: restore an identical file through a CRLF
      // checkout. Same commit, same content — new bytes on disk.
      await rm(join(p.workDir, "src/payment.ts"));
      git("-c", "core.autocrlf=true", "checkout", "--", "src/payment.ts");
      expect(await readFile(join(p.workDir, "src/payment.ts"), "utf8")).toContain("\r\n");
      expect((await findings(p)).map((f) => f.code).filter((c) => STALE.includes(c))).toEqual([]);
    } finally {
      await p.destroy();
    }
  });
});

describe("stamps written before the fold stay readable", () => {
  /** The raw-bytes sources recipe loam stamped until line endings were normalised. */
  async function legacySourcesDigest(repoDir: string, rels: string[]): Promise<string> {
    const outer = createHash("sha256");
    for (const rel of [...rels].sort()) {
      const inner = createHash("sha256").update(await readFile(join(repoDir, rel))).digest("hex");
      outer.update(`${rel}\0${inner}\n`);
    }
    return outer.digest("hex").slice(0, 16);
  }

  it("a raw-bytes stamp made on a CRLF checkout still reads current on that checkout", async () => {
    const p = await project();
    try {
      for (const rel of Object.keys(CODE)) await toCrlf(join(p.workDir, rel));
      const sources = await legacySourcesDigest(p.workDir, Object.keys(CODE));
      // Exactly what the old vouch wrote over a CRLF spec: the body's raw bytes.
      const fm = `service: ${SVC}\r\nstatus: verified\r\nowner: payments-team\r\nlast_verified: 2026-10-01\r\nsources:\r\n  - src`;
      const crlfBody = BODY.replace(/\n/g, "\r\n");
      const legacyContent = createHash("sha256").update(crlfBody, "utf8").digest("hex").slice(0, 16);
      // The point of the pin: the old stamp differs from the new recipe, so
      // only the reader's second answer can make it current.
      expect(legacyContent).not.toBe(contentDigest(`---\n---\n${BODY}`));
      expect(sources).not.toBe((await sourcesDigest(p.workDir, ["src"])).digest);
      await p.write(
        SPEC,
        `---\r\n${fm}\r\nsources_digest: "${sources}"\r\ncontent_digest: "${legacyContent}"\r\n---\r\n${crlfBody}`,
      );
      await rm(join(p.docsDir, ARCH));

      const found = await findings(p);
      expect(found.map((f) => f.code).filter((c) => STALE.includes(c))).toEqual([]);
      expect(found.map((f) => f.code)).toContain("sources.current");
    } finally {
      await p.destroy();
    }
  });
});

describe("the recipe", () => {
  it("folds CRLF in a body, and holds a stamp under either recipe", () => {
    const lf = `---\nstatus: verified\n---\n${BODY}`;
    const crlf = lf.replace(/\n/g, "\r\n");
    expect(contentDigest(crlf)).toBe(contentDigest(lf));
    const raw = createHash("sha256").update(rawBody(crlf), "utf8").digest("hex").slice(0, 16);
    expect(holdsContentStamp(crlf, raw)).toBe(true);
    expect(holdsContentStamp(crlf, contentDigest(lf))).toBe(true);
    expect(holdsContentStamp(crlf.replace("authorizes", "refunds"), contentDigest(lf))).toBe(false);
  });

  it("text by git's heuristic is folded; a lone CR is content; a NUL in the first 8000 bytes keeps the bytes", () => {
    expect(digestBytes(Buffer.from("a\r\nb\r\n")).toString()).toBe("a\nb\n");
    expect(digestBytes(Buffer.from("a\rb\n")).toString()).toBe("a\rb\n");
    const binary = Buffer.from("\0PNG\r\n\x1a\n");
    expect(digestBytes(binary)).toBe(binary);
    // Past git's sniff window a NUL no longer makes the file binary.
    const late = Buffer.concat([Buffer.from("x".repeat(8000)), Buffer.from("\0\r\n")]);
    expect(digestBytes(late).length).toBe(late.length - 1);
  });

  it("a binary source's CRLF is a real change — git never rewrites it, so neither does the digest", async () => {
    const dir = await makeTmpDir();
    try {
      await writeFile(join(dir, "logo.bin"), Buffer.from("\0bin\nary\n"));
      const lf = await sourcesDigest(dir, ["logo.bin"]);
      await writeFile(join(dir, "logo.bin"), Buffer.from("\0bin\r\nary\r\n"));
      const crlf = await sourcesDigest(dir, ["logo.bin"]);
      expect(crlf.digest).not.toBe(lf.digest);
      // And a text file's two recipes agree wherever it carries no CRLF.
      await writeFile(join(dir, "a.ts"), "a\n");
      const text = await sourcesDigest(dir, ["a.ts"]);
      expect(text.rawDigest).toBe(text.digest);
      expect(text.index[0]!.rawSha).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
