/**
 * Tests for `loam vouch --pack` (src/commands/vouch/pack/) — the re-vouch
 * reading pack.
 *
 * The pack is a read-only lens over stamps `loam vouch` already writes: the
 * body's diff from its last vouched ancestor in the DOCS repo's history, the
 * source files that moved against the stamped per-file index, and the
 * sections a previous vouch already covers. So the invariants worth pinning
 * are the honesty ones:
 *  - read-only is a CLAIM, and it is pinned — every case hashes the docs tree
 *    before and after (git's own `.git/` metadata excluded: the stat cache is
 *    git's to touch, the documents are not);
 *  - fail-closed in the safe direction — a git that cannot answer degrades to
 *    "full read", never to a guessed diff, and "nobody could look" never
 *    licenses an unchanged-section claim;
 *  - `--pack --yes` is refused: the pack is the reading list, `--yes` the
 *    unattended stamp, and composing them would defeat the read;
 *  - `--pack --json` needs NO `--yes` — the deliberate contrast with plain
 *    `vouch --json`, whose confirmation cannot be asked on a JSON stream.
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  makeProject,
  runLoam,
  TEST_IDENTITY,
  treeHashes,
  writeFiles,
  LANDSCAPE,
  type Project,
} from "./helpers/harness.js";

const SVC = "payment-service";
const SPEC = `services/${SVC}/spec.md`;
const ARCH = `services/${SVC}/arch.spec.md`;

/** Three H2 sections, so a section delta has something to partition. */
const BODY = `
# payment-service

## Overview
The service authorizes payments.

## Requirements

### Requirement: Authorize a payment
The service SHALL authorize a payment before capture.

## Operations
authorizePayment only.
`;

const DRAFT_FM = `service: ${SVC}\nstatus: draft\nowner: payments-team\nsources:\n  - src`;

const CODE = {
  "src/payment.ts": "export const authorize = () => true;\n",
  "src/capture.ts": "export const capture = () => true;\n",
};

function specFile(fm: string, body: string): string {
  return `---\n${fm}\n---\n${body}`;
}

/** A docs repo with the draft spec, whose workDir doubles as the service repo. */
async function packProject(
  extraDocs: Record<string, string> = {},
  repoFiles: Record<string, string> = CODE,
): Promise<Project> {
  const p = await makeProject(
    { [SPEC]: specFile(DRAFT_FM, BODY), ...extraDocs },
    { service: SVC },
  );
  await writeFiles(p.workDir, repoFiles);
  return p;
}

function git(cwd: string, ...args: string[]): void {
  const res = spawnSync("git", args, { cwd, encoding: "utf8", timeout: 30_000 });
  if (res.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${res.stderr}`);
}

/** diff.test.ts's commitBase idiom, returning the commit for ancestor assertions. */
function commitDocs(dir: string): string {
  git(dir, "init", "-q", "-b", "main");
  git(dir, "add", "-A");
  git(dir, "-c", "user.email=pack@test.invalid", "-c", "user.name=Pack Test", "commit", "-q", "-m", "base");
  const res = spawnSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8", timeout: 30_000 });
  if (res.status !== 0) throw new Error(`git rev-parse failed: ${res.stderr}`);
  return res.stdout.trim();
}

/**
 * The read-only pin: every content byte of the docs tree, minus `.git/` —
 * git may refresh its own stat cache under a worktree diff, and that
 * metadata is git's; the claim under test is that no DOCUMENT moves.
 */
async function docsHashes(p: Project): Promise<Record<string, string>> {
  return Object.fromEntries(
    Object.entries(await treeHashes(p.docsDir)).filter(([k]) => k !== ".git/" && !k.startsWith(".git/")),
  );
}

interface Envelope {
  ok: boolean;
  error?: { code: string; message: string };
}

interface SectionsJson {
  changed: string[];
  added: string[];
  removed: string[];
  unchanged: string[];
}

interface BodyJson {
  kind: string;
  ancestorCommit?: string;
  diff?: string;
  reason?: string;
  sections?: SectionsJson;
}

interface SourcesJson {
  kind: string;
  added?: string[];
  changed?: string[];
  removed?: string[];
  reason?: string;
}

interface AxisJson {
  path: string;
  file: string;
  vouched_by?: string;
  last_verified?: string;
  body: BodyJson;
  sources: SourcesJson;
  skipped?: { path: string; reason: string }[];
  headings?: string[];
}

interface PackPayload extends Envelope {
  mode?: string;
  packMode?: string;
  spec: AxisJson;
  archSpec: AxisJson | null;
  landscape?: { kind: string; inbound?: unknown[]; reason?: string };
}

async function packJson(p: Project): Promise<{ code: number; payload: PackPayload }> {
  const res = await runLoam(p.workDir, "vouch", "--pack", "--json");
  return { code: res.code, payload: JSON.parse(res.stdout) as PackPayload };
}

describe("loam vouch --pack — flag semantics", () => {
  it("--pack --yes is refused invalid-option, exit 1, nothing written", async () => {
    const p = await packProject();
    try {
      const before = await docsHashes(p);
      const res = await runLoam(p.workDir, "vouch", "--pack", "--yes", "--json");
      expect(res.code).toBe(1);
      const payload = JSON.parse(res.stdout) as Envelope;
      expect(payload.ok).toBe(false);
      expect(payload.error?.code).toBe("invalid-option");
      expect(payload.error?.message).toContain("reading list");
      expect(await docsHashes(p)).toEqual(before);
    } finally {
      await p.destroy();
    }
  });

  it("--pack --json needs no --yes, while plain vouch --json still does — the vouch-unattended contrast", async () => {
    const p = await packProject();
    try {
      // The write path first: a JSON vouch without --yes is refused, because
      // its confirmation is a question for a person.
      const plain = await runLoam(p.workDir, "vouch", "--json");
      expect(plain.code).toBe(1);
      expect((JSON.parse(plain.stdout) as Envelope).error?.code).toBe("vouch-unattended");
      // The pack asks nobody anything and stamps nothing, so the same
      // combination succeeds — this is the tested contrast, not an accident.
      const { code, payload } = await packJson(p);
      expect(code).toBe(0);
      expect(payload.ok).toBe(true);
      expect(payload.mode).toBe("pack");
    } finally {
      await p.destroy();
    }
  });

  it("a service with no living spec refuses unknown-target with the adopt advice", async () => {
    const p = await makeProject({}, { service: SVC });
    try {
      const { code, payload } = await packJson(p);
      expect(code).toBe(1);
      expect(payload.error?.code).toBe("unknown-target");
      expect(payload.error?.message).toContain("loam adopt");
    } finally {
      await p.destroy();
    }
  });
});

describe("loam vouch --pack — the source delta", () => {
  it("names exactly the added, changed and removed paths since the stamp", async () => {
    const p = await packProject();
    try {
      expect((await runLoam(p.workDir, "vouch", "--yes")).code).toBe(0);
      await writeFiles(p.workDir, {
        "src/payment.ts": "export const authorize = () => false;\n",
        "src/refund.ts": "export const refund = () => true;\n",
      });
      await rm(join(p.workDir, "src", "capture.ts"));
      const beforeDocs = await docsHashes(p);
      const beforeRepo = await treeHashes(p.workDir);
      const { code, payload } = await packJson(p);
      expect(code).toBe(0);
      expect(payload.packMode).toBe("re-vouch");
      const spec = payload.spec;
      expect(spec.sources).toEqual({
        kind: "delta",
        added: ["src/refund.ts"],
        changed: ["src/payment.ts"],
        removed: ["src/capture.ts"],
      });
      // The body did not move, so the pack says so — the two halves are
      // independent verdicts, not one mood.
      expect(spec.body).toEqual({ kind: "unchanged" });
      expect(await docsHashes(p)).toEqual(beforeDocs);
      expect(await treeHashes(p.workDir)).toEqual(beforeRepo);
    } finally {
      await p.destroy();
    }
  });

  it("nothing moved: body unchanged, sources unchanged, exit 0 — and the text view says so", async () => {
    const p = await packProject();
    try {
      expect((await runLoam(p.workDir, "vouch", "--yes")).code).toBe(0);
      const before = await docsHashes(p);
      const { code, payload } = await packJson(p);
      expect(code).toBe(0);
      expect(payload.spec.body).toEqual({ kind: "unchanged" });
      expect(payload.spec.sources).toEqual({ kind: "unchanged" });
      const text = await runLoam(p.workDir, "vouch", "--pack");
      expect(text.code).toBe(0);
      expect(text.stdout).toContain("body unchanged since");
      expect(text.stdout).toContain("sources unchanged since the stamp");
      expect(await docsHashes(p)).toEqual(before);
    } finally {
      await p.destroy();
    }
  });

  it("broken sources degrade to unavailable with the re-vouch refusal sentence; the body half still answers; exit 0", async () => {
    const p = await packProject();
    try {
      expect((await runLoam(p.workDir, "vouch", "--yes")).code).toBe(0);
      await rm(join(p.workDir, "src"), { recursive: true });
      const before = await docsHashes(p);
      const beforeRepo = await treeHashes(p.workDir);
      const { code, payload } = await packJson(p);
      expect(code).toBe(0);
      const spec = payload.spec;
      expect(spec.sources.kind).toBe("unavailable");
      // The reason IS the sentence the re-vouch would refuse with: fixing it
      // is the first item on the reading list, in the vouch's own words.
      expect(spec.sources.reason).toContain("do not exist");
      expect(spec.body).toEqual({ kind: "unchanged" });
      expect(await docsHashes(p)).toEqual(before);
      expect(await treeHashes(p.workDir)).toEqual(beforeRepo);
    } finally {
      await p.destroy();
    }
  });
});

describe("loam vouch --pack — the body delta", () => {
  it("diffs from the committed vouched ancestor and partitions the sections", async () => {
    const p = await packProject();
    try {
      expect((await runLoam(p.workDir, "vouch", "--yes")).code).toBe(0);
      const sha = commitDocs(p.docsDir);
      // A machine whose git colours every pipe and routes diffs through an
      // external program must get the same machine artifact as every other:
      // plain text, produced by git's own diff. Without the pack's
      // color/ext-diff/textconv suppression these two settings put escape
      // sequences (or nothing at all) into the frozen --json payload.
      git(p.docsDir, "config", "color.ui", "always");
      git(p.docsDir, "config", "diff.external", "no-such-differ");
      const stamped = await p.read(SPEC);
      await p.write(
        SPEC,
        stamped.replace(
          "The service authorizes payments.",
          "The service authorizes and captures payments.",
        ) + "\n## Rollout\nStaged by region.\n",
      );
      const before = await docsHashes(p);
      const { code, payload } = await packJson(p);
      expect(code).toBe(0);
      const spec = payload.spec;
      expect(spec.body.kind).toBe("diff");
      expect(spec.body.ancestorCommit).toBe(sha);
      expect(spec.body.diff).toContain("+The service authorizes and captures payments.");
      expect(spec.body.diff).not.toContain("\u001b");
      expect(spec.body.sections?.changed).toEqual(["## Overview"]);
      expect(spec.body.sections?.added).toEqual(["## Rollout"]);
      expect(spec.body.sections?.removed).toEqual([]);
      // The preamble (the H1 above the first section) is its own unnamed
      // section, and it did not move.
      expect(spec.body.sections?.unchanged).toEqual([
        "(before the first heading)",
        "## Requirements",
        "## Operations",
      ]);
      // The "already covered" listing carries who vouched and when, read back
      // from the stamp the walk matched.
      expect(spec.vouched_by).toBe(TEST_IDENTITY);
      expect(spec.last_verified).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      const text = await runLoam(p.workDir, "vouch", "--pack");
      expect(text.code).toBe(0);
      expect(text.stdout).toContain(`unchanged — previously vouched by ${TEST_IDENTITY}`);
      expect(await docsHashes(p)).toEqual(before);
    } finally {
      await p.destroy();
    }
  });

  it("fails closed to a full read when the docs dir is not a git repository, carrying git's words", async () => {
    const p = await packProject();
    try {
      expect((await runLoam(p.workDir, "vouch", "--yes")).code).toBe(0);
      const stamped = await p.read(SPEC);
      await p.write(SPEC, stamped.replace("authorizes payments", "authorizes most payments"));
      const before = await docsHashes(p);
      const { code, payload } = await packJson(p);
      expect(code).toBe(0);
      const spec = payload.spec;
      expect(spec.body.kind).toBe("full-read");
      expect(spec.body.reason).toContain("git");
      // "Nobody could look" is not "nothing changed": with no ancestor found,
      // no unchanged-section claim may exist anywhere in the axis.
      expect(JSON.stringify(spec.body)).not.toContain("unchanged");
      expect(await docsHashes(p)).toEqual(before);
    } finally {
      await p.destroy();
    }
  });

  it("a vouched body that was never committed walks to no ancestor and says so in the exact sentence", async () => {
    const p = await packProject();
    try {
      // The history holds only the PRE-vouch body; the body then moves before
      // the stamp, so no commit ever held what was vouched.
      commitDocs(p.docsDir);
      await p.write(
        SPEC,
        specFile(DRAFT_FM, BODY.replace("The service authorizes payments.", "The service authorizes payments today.")),
      );
      expect((await runLoam(p.workDir, "vouch", "--yes")).code).toBe(0);
      const stamped = await p.read(SPEC);
      await p.write(SPEC, stamped.replace("payments today.", "payments tomorrow."));
      const before = await docsHashes(p);
      const { code, payload } = await packJson(p);
      expect(code).toBe(0);
      const spec = payload.spec;
      expect(spec.body.kind).toBe("full-read");
      expect(spec.body.reason).toBe("body has no vouched ancestor in history");
      const text = await runLoam(p.workDir, "vouch", "--pack");
      expect(text.stdout).toContain("full read: body has no vouched ancestor in history");
      expect(await docsHashes(p)).toEqual(before);
    } finally {
      await p.destroy();
    }
  });
});

describe("loam vouch --pack — line endings", () => {
  it("a CRLF working tree whose blob was committed LF still finds its vouched ancestor", async () => {
    // The stamp is byte-exact over the WORKING TREE (CRLF); the blob behind
    // the commit is LF once the eol filter cleans it. Without the pack's
    // checkout-rendering candidate hash (gitq/vouched-ancestor.ts), every
    // vouched ancestor would be invisible on exactly the checkouts whose eol
    // config differs from the repo's — degrading every Windows re-vouch to a
    // full read.
    const crlfBody = BODY.replace(/\n/g, "\r\n");
    const p = await makeProject({ [SPEC]: specFile(DRAFT_FM, crlfBody) }, { service: SVC });
    await writeFiles(p.workDir, CODE);
    try {
      expect((await runLoam(p.workDir, "vouch", "--yes")).code).toBe(0);
      git(p.docsDir, "init", "-q", "-b", "main");
      git(p.docsDir, "config", "core.autocrlf", "input");
      git(p.docsDir, "add", "-A");
      git(p.docsDir, "-c", "user.email=pack@test.invalid", "-c", "user.name=Pack Test", "commit", "-q", "-m", "base");
      const stamped = await p.read(SPEC);
      await p.write(
        SPEC,
        stamped.replace("The service authorizes payments.", "The service authorizes card payments."),
      );
      const { code, payload } = await packJson(p);
      expect(code).toBe(0);
      const spec = payload.spec;
      expect(spec.body.kind).toBe("diff");
      expect(spec.body.diff).toContain("+The service authorizes card payments.");
      expect(spec.body.sections?.changed).toEqual(["## Overview"]);
      // Line endings do not vote in the section compare (the pins recipe):
      // every untouched section reads unchanged across the LF/CRLF boundary.
      expect(spec.body.sections?.unchanged).toContain("## Requirements");
      expect(spec.body.sections?.unchanged).toContain("## Operations");
    } finally {
      await p.destroy();
    }
  });
});

describe("loam vouch --pack — honesty riders", () => {
  it("skipped sources ride the pack — the hole in the promise is said before the stamp, not only after", async () => {
    const p = await packProject();
    try {
      // A symlink out of the repo: the digest walk records it and hashes
      // nothing behind it, so the stamp's promise has a hole. The pack is the
      // screen a person reads BEFORE re-staking that promise, and it must
      // name the hole the way the post-stamp screen does.
      await mkdir(join(p.workDir, "..", "outside"), { recursive: true });
      await writeFile(join(p.workDir, "..", "outside", "lib.ts"), "export const x = 1;\n", "utf8");
      await symlink(join(p.workDir, "..", "outside"), join(p.workDir, "src", "vendor"));
      expect((await runLoam(p.workDir, "vouch", "--yes")).code).toBe(0);
      const { code, payload } = await packJson(p);
      expect(code).toBe(0);
      expect(payload.spec.skipped).toEqual([
        { path: "src/vendor", reason: "a symlink whose target is outside this repository" },
      ]);
      const text = await runLoam(p.workDir, "vouch", "--pack");
      expect(text.code).toBe(0);
      expect(text.stdout).toContain("went unhashed");
      expect(text.stdout).toContain("src/vendor — a symlink whose target is outside this repository");
    } finally {
      await p.destroy();
    }
  });

  it("a pending interrupted docs-repo commit is reported, because the pack may be reading pre-swap bytes", async () => {
    const p = await packProject();
    try {
      expect((await runLoam(p.workDir, "vouch", "--yes")).code).toBe(0);
      const clean = await packJson(p);
      expect(clean.payload.pendingCommit).toBe(false);
      // The journal's presence alone is the signal — the pack cannot roll it
      // forward (recovery is a write), so it must at least say the stamps it
      // just read may predate the interrupted writer's swap.
      await p.write(".loam-commit", "{}");
      const { code, payload } = await packJson(p);
      expect(code).toBe(0);
      expect(payload.pendingCommit).toBe(true);
      const text = await runLoam(p.workDir, "vouch", "--pack");
      expect(text.stdout).toContain("interrupted docs-repo commit is pending");
    } finally {
      await p.destroy();
    }
  });
});

describe("loam vouch --pack — the second axis", () => {
  it("an arch.spec.md created after the last vouch gets its reading plan inside a re-vouch pack", async () => {
    const p = await packProject();
    try {
      expect((await runLoam(p.workDir, "vouch", "--yes")).code).toBe(0);
      await p.write(
        ARCH,
        specFile(
          `service: ${SVC}\nstatus: draft\nowner: payments-team\nsources:\n  - src`,
          "\n# payment-service architecture\n\n## Topology\nOne region.\n",
        ),
      );
      const { code, payload } = await packJson(p);
      expect(code).toBe(0);
      // The mode is per service, the plan per axis: the vouched spec.md keeps
      // its incremental verdicts while the brand-new axis — the one genuine
      // whole-document read in the run — gets its section plan.
      expect(payload.packMode).toBe("re-vouch");
      expect(payload.spec.body).toEqual({ kind: "unchanged" });
      expect(payload.archSpec?.body.kind).toBe("full-read");
      expect(payload.archSpec?.sources.kind).toBe("unvouched");
      expect(payload.archSpec?.headings).toEqual(["## Topology"]);
    } finally {
      await p.destroy();
    }
  });

  it("arch.spec.md rides with its own independent body and source verdicts", async () => {
    const archFm = `service: ${SVC}\nstatus: draft\nowner: payments-team\nsources:\n  - infra`;
    const p = await packProject(
      { [ARCH]: specFile(archFm, "\n# payment-service architecture\n\n## Topology\nOne region.\n") },
      { ...CODE, "infra/net.ts": "export const region = 'eu';\n" },
    );
    try {
      expect((await runLoam(p.workDir, "vouch", "--yes")).code).toBe(0);
      await writeFiles(p.workDir, { "infra/net.ts": "export const region = 'us';\n" });
      const before = await docsHashes(p);
      const { code, payload } = await packJson(p);
      expect(code).toBe(0);
      const spec = payload.spec;
      const arch = payload.archSpec;
      expect(spec.sources).toEqual({ kind: "unchanged" });
      expect(arch.path.endsWith("arch.spec.md")).toBe(true);
      expect(arch.body).toEqual({ kind: "unchanged" });
      expect(arch.sources).toEqual({ kind: "delta", added: [], changed: ["infra/net.ts"], removed: [] });
      expect(await docsHashes(p)).toEqual(before);
    } finally {
      await p.destroy();
    }
  });
});

describe("loam vouch --pack — first vouch", () => {
  it("orders the whole-doc pack landscape-claims-first, with the fleet map's edge ahead of the section list", async () => {
    const p = await packProject({ "architecture/landscape.likec4": LANDSCAPE });
    try {
      const before = await docsHashes(p);
      const text = await runLoam(p.workDir, "vouch", "--pack");
      expect(text.code).toBe(0);
      expect(text.stdout).toContain("first-vouch reading pack");
      const edgeAt = text.stdout.indexOf("checkout-web -> payment-service (authorizePayment)");
      const sectionsAt = text.stdout.indexOf("sections to read");
      expect(edgeAt).toBeGreaterThan(-1);
      expect(sectionsAt).toBeGreaterThan(edgeAt);
      const { code, payload } = await packJson(p);
      expect(code).toBe(0);
      expect(payload.packMode).toBe("first-vouch");
      const spec = payload.spec;
      expect(spec.body.kind).toBe("full-read");
      expect(spec.sources.kind).toBe("unvouched");
      expect(spec.headings).toEqual(["## Overview", "## Requirements", "## Operations"]);
      expect(payload.landscape?.kind).toBe("edges");
      expect(payload.landscape?.inbound).toEqual([
        { service: "checkout-web", op: "authorizePayment", title: "Calls authorizePayment" },
      ]);
      expect(await docsHashes(p)).toEqual(before);
    } finally {
      await p.destroy();
    }
  });

  it("an absent fleet map is reported as silence, not as nobody-calls-this", async () => {
    const p = await packProject();
    try {
      const text = await runLoam(p.workDir, "vouch", "--pack");
      expect(text.code).toBe(0);
      expect(text.stdout).toContain(
        `the fleet map says nothing about ${SVC} (absent or unparseable)`,
      );
    } finally {
      await p.destroy();
    }
  });
});
