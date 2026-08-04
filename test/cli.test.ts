/**
 * Integration invariants for `loam init`, `loam delta`, `loam adopt`, and config
 * handling (src/commands/init.ts, delta.ts, adopt.ts, src/core/config.ts,
 * src/core/docs.ts).
 *
 * Families:
 *   - init: scaffolds the docs-repo skeleton, writes loam.json with an ABSOLUTE
 *     docsDir, is idempotent (never clobbers user files), and preserves
 *     previously configured `service` on re-init (config spread).
 *   - init --json: {ok, docsDir, created, skipped, tools} — skipped is the
 *     other half of the never-overwrite contract, tools names the agent tools
 *     the command files were generated for — and a clean refusal when --docs
 *     names a file. The per-tool matrix itself is pinned in test/agents.test.ts.
 *   - config: missing loam.json is a clean exit-1 error on every command that
 *     needs it; malformed loam.json fails cleanly with a diagnostic naming the
 *     config, and `loam init` can rewrite it.
 *   - delta: per-service projection of a feature — intent body (frontmatter
 *     stripped), requirement delta lines, and the C4 architecture slice
 *     (NEW service / outbound / inbound / no-change), with graceful handling
 *     of missing pieces and broken delta.likec4.
 *   - frontmatter stripping: normal, absent, unterminated-at-EOF, and a later
 *     '---' horizontal rule that must NOT extend the frontmatter.
 *   - feature dir resolution: 'FEAT-1' matches 'FEAT-1-slug' and bare 'FEAT-1',
 *     never 'FEAT-10-x'.
 *   - adopt: only that it needs a loam.json like everything else; the command's
 *     own contract is pinned in test/adopt.test.ts.
 */
import { describe, it, expect, afterEach } from "vitest";
import { readFile, writeFile, realpath, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, isAbsolute } from "node:path";
import {
  coherentFixture,
  makeProject,
  makeTmpDir,
  runLoam,
  writeFiles,
  type Project,
} from "./helpers/harness.js";

/* ------------------------------------------------------------------ */
/* Per-test fixture bookkeeping                                        */
/* ------------------------------------------------------------------ */

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!();
});

/** makeProject + auto-destroy. */
async function project(
  files: Record<string, string>,
  opts: { service?: string } = {},
): Promise<Project> {
  const p = await makeProject(files, opts);
  cleanups.push(() => p.destroy());
  return p;
}

/** Bare throwaway dir (for init tests, which must never touch the repo). */
async function throwawayDir(): Promise<string> {
  const dir = await makeTmpDir("loam-cli-");
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

async function readJson(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
}

/* ------------------------------------------------------------------ */
/* init — scaffolding a fresh docs repo                                */
/* ------------------------------------------------------------------ */

describe("init: scaffolding a fresh docs repo", () => {
  it("creates architecture/ services/ features/, and reports what it scaffolded", async () => {
    const dir = await throwawayDir();
    const res = await runLoam(dir, "init", "--docs", "./docs-x");
    expect(res.code).toBe(0);
    for (const sub of ["architecture", "services", "features"]) {
      expect(existsSync(join(dir, "docs-x", sub))).toBe(true);
    }
    expect(res.out).toContain("loam initialized.");
    expect(res.out).toContain("scaffolded:");
  });

  it("writes no service manifest — the directories under services/ ARE the list", async () => {
    // init used to leave a loam.docs.json listing the repo's services. Nothing read
    // it and nothing kept it current, so it named an empty fleet forever. A second
    // list of services is the drift `landscape.service-unmodelled` exists to catch.
    const dir = await throwawayDir();
    await runLoam(dir, "init", "--docs", "./docs-x");
    expect(existsSync(join(dir, "docs-x", "loam.docs.json"))).toBe(false);
  });

  it("writes loam.json in the cwd with an ABSOLUTE docsDir — relative --docs resolved against the cwd", async () => {
    const dir = await throwawayDir();
    const res = await runLoam(dir, "init", "--docs", "./docs-x");
    expect(res.code).toBe(0);
    const config = await readJson(join(dir, "loam.json"));
    expect(typeof config.docsDir).toBe("string");
    expect(isAbsolute(config.docsDir as string)).toBe(true);
    // compare realpaths: process.chdir resolves tmpdir symlinks on macOS
    expect(await realpath(config.docsDir as string)).toBe(await realpath(join(dir, "docs-x")));
  });

  it("defaults --docs to .loam-docs under the cwd", async () => {
    const dir = await throwawayDir();
    const res = await runLoam(dir, "init");
    expect(res.code).toBe(0);
    expect(existsSync(join(dir, ".loam-docs", "architecture"))).toBe(true);
    const config = await readJson(join(dir, "loam.json"));
    expect(await realpath(config.docsDir as string)).toBe(await realpath(join(dir, ".loam-docs")));
  });

  it("persists --service into loam.json and echoes it", async () => {
    const dir = await throwawayDir();
    const res = await runLoam(dir, "init", "--docs", "./d", "--service", "payment-service");
    expect(res.code).toBe(0);
    const config = await readJson(join(dir, "loam.json"));
    expect(config.service).toBe("payment-service");
    expect(res.out).toContain("service:   payment-service");
  });

  it("a file already at the docs root survives the first init byte-for-byte", async () => {
    // init scaffolds AROUND whatever is there: pointing it at an existing repo
    // must never rewrite that repo's own files.
    const dir = await throwawayDir();
    const custom = "# our docs\n";
    await writeFiles(dir, { "d/README.md": custom });
    const res = await runLoam(dir, "init", "--docs", "./d");
    expect(res.code).toBe(0);
    expect(await readFile(join(dir, "d", "README.md"), "utf8")).toBe(custom);
    // the missing subdirs still get created around it
    expect(existsSync(join(dir, "d", "architecture"))).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* init — idempotency and config preservation                          */
/* ------------------------------------------------------------------ */

describe("init: idempotency and config preservation", () => {
  it("a second init leaves user files untouched and reports nothing scaffolded", async () => {
    const dir = await throwawayDir();
    const first = await runLoam(dir, "init", "--docs", "./d");
    expect(first.code).toBe(0);
    const markerPath = join(dir, "d", "services", "marker.txt");
    await writeFile(markerPath, "keep me\n", "utf8");

    const second = await runLoam(dir, "init", "--docs", "./d");
    expect(second.code).toBe(0);
    expect(await readFile(markerPath, "utf8")).toBe("keep me\n");
    expect(second.out).toContain("loam initialized.");
    expect(second.out).not.toContain("scaffolded");
  });

  it("re-init WITHOUT --service preserves the previously configured service (config spread)", async () => {
    const dir = await throwawayDir();
    await runLoam(dir, "init", "--docs", "./d", "--service", "svc-a");
    const res = await runLoam(dir, "init", "--docs", "./d");
    expect(res.code).toBe(0);
    const config = await readJson(join(dir, "loam.json"));
    expect(config.service).toBe("svc-a");
    expect(res.out).toContain("service:   svc-a");
  });
});

/* ------------------------------------------------------------------ */
/* init — --json contract                                              */
/* ------------------------------------------------------------------ */

describe("init: --json contract", () => {
  it("emits one ok-enveloped object with docsDir, created and skipped — no prose", async () => {
    const dir = await throwawayDir();
    const res = await runLoam(dir, "init", "--docs", "./docs-x", "--json");
    expect(res.code).toBe(0);
    // JSON.parse over the whole stream is the no-prose assertion
    const json = JSON.parse(res.stdout);
    expect(json.ok).toBe(true);
    expect(isAbsolute(json.docsDir)).toBe(true);
    expect(await realpath(json.docsDir)).toBe(await realpath(join(dir, "docs-x")));
    // the docs skeleton, AGENTS.md and the slash commands were all created fresh
    const created: string[] = json.created;
    for (const tail of ["architecture", "services", "features", "AGENTS.md"]) {
      expect(created.some((c) => c.endsWith(tail))).toBe(true);
    }
    expect(created.some((c) => c.includes(join(".claude", "commands")))).toBe(true);
    expect(json.skipped).toEqual([]);
    // no --tools means the one historical target
    expect(json.tools).toEqual(["claude"]);
  });

  it("a second init reports everything as skipped, nothing created — init never overwrites", async () => {
    const dir = await throwawayDir();
    const first = JSON.parse((await runLoam(dir, "init", "--docs", "./d", "--json")).stdout);
    const second = JSON.parse((await runLoam(dir, "init", "--docs", "./d", "--json")).stdout);
    expect(second.ok).toBe(true);
    expect(second.created).toEqual([]);
    // same paths, same order: skipped is the other half of created
    expect(second.skipped).toEqual(first.created);
  });

  it("splits a partially scaffolded repo between created and skipped", async () => {
    const dir = await throwawayDir();
    await writeFiles(dir, { "d/services/.keep": "" });
    const json = JSON.parse((await runLoam(dir, "init", "--docs", "./d", "--json")).stdout);
    expect(json.skipped.some((p: string) => p.endsWith("services"))).toBe(true);
    expect(json.created.some((p: string) => p.endsWith("services"))).toBe(false);
    expect(json.created.some((p: string) => p.endsWith("architecture"))).toBe(true);
  });

  it("--no-commands keeps the slash commands out of both lists", async () => {
    const dir = await throwawayDir();
    const json = JSON.parse(
      (await runLoam(dir, "init", "--docs", "./d", "--no-commands", "--json")).stdout,
    );
    expect(json.ok).toBe(true);
    const all: string[] = [...json.created, ...json.skipped];
    expect(all.some((p) => p.includes(".claude"))).toBe(false);
    // and no tool is claimed to have been generated for
    expect(json.tools).toEqual([]);
  });

  it("refuses --docs naming a file, inside the envelope", async () => {
    const dir = await throwawayDir();
    await writeFile(join(dir, "not-a-dir"), "just a file\n", "utf8");
    const res = await runLoam(dir, "init", "--docs", "./not-a-dir", "--json");
    expect(res.code).toBe(1);
    const json = JSON.parse(res.stdout);
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe("invalid-option");
    expect(json.error.message).toContain("not-a-dir");
  });

  it("refuses --docs naming a file cleanly in text mode too — no mkdir stack trace", async () => {
    const dir = await throwawayDir();
    await writeFile(join(dir, "not-a-dir"), "just a file\n", "utf8");
    const res = await runLoam(dir, "init", "--docs", "./not-a-dir");
    expect(res.code).toBe(1);
    expect(res.out).toContain("not a directory");
    expect(existsSync(join(dir, "loam.json"))).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* config handling                                                     */
/* ------------------------------------------------------------------ */

describe("config handling", () => {
  it("delta without a loam.json fails cleanly: exit 1 and a pointer to `loam init`", async () => {
    const dir = await throwawayDir();
    const res = await runLoam(dir, "delta", "FEAT-1");
    expect(res.code).toBe(1);
    expect(res.out).toContain("No loam.json found");
  });

  it("adopt without a loam.json fails cleanly: exit 1 and a pointer to `loam init`", async () => {
    const dir = await throwawayDir();
    const res = await runLoam(dir, "adopt");
    expect(res.code).toBe(1);
    expect(res.out).toContain("No loam.json found");
  });

  it("malformed loam.json fails delta cleanly: exit 1 with a diagnostic naming the config, no crash", async () => {
    // loadConfig reports an unparsable config and treats it as absent — the
    // command must exit 1 with a diagnostic, never die with a stack trace.
    const dir = await throwawayDir();
    await writeFile(join(dir, "loam.json"), "{ this is not json", "utf8");
    const res = await runLoam(dir, "delta", "FEAT-1");
    expect(res.code).toBe(1);
    expect(res.out).toContain("Invalid loam.json");
  });

  it("re-running `loam init` over a corrupt loam.json repairs it instead of dying", async () => {
    // init spreads the existing config; an unparsable one counts as absent, so
    // init can always rewrite a corrupt loam.json.
    const dir = await throwawayDir();
    await writeFile(join(dir, "loam.json"), "{ definitely not json", "utf8");
    const res = await runLoam(dir, "init", "--docs", "./d");
    expect(res.code).toBe(0);
    const repaired = JSON.parse(await readFile(join(dir, "loam.json"), "utf8"));
    expect(typeof repaired.docsDir).toBe("string");
  });
});

/* ------------------------------------------------------------------ */
/* delta — projection onto services (coherent fixture)                 */
/* ------------------------------------------------------------------ */

describe("delta: projection onto services (coherent fixture)", () => {
  it("prints the feature/service header and the intent body WITHOUT its frontmatter", async () => {
    const p = await project(coherentFixture(), { service: "payment-service" });
    const res = await runLoam(p.workDir, "delta", "FEAT-1", "--service", "payment-service");
    expect(res.code).toBe(0);
    expect(res.out).toContain("FEAT-1 · payment-service");
    expect(res.out).toContain("# Split payments");
    expect(res.out).toContain("Let a payment be split across payees.");
    expect(res.out).not.toContain("feature: FEAT-1");
    expect(res.out).not.toContain("status: proposed");
  });

  it("reports '(none for this service)' when the feature has no requirement delta for the service", async () => {
    const p = await project(coherentFixture(), { service: "payment-service" });
    const res = await runLoam(p.workDir, "delta", "FEAT-1", "--service", "payment-service");
    expect(res.code).toBe(0);
    expect(res.out).toContain("Requirements: (none for this service)");
  });

  it("shows the outbound architecture edge with the target title and edge title for the calling service", async () => {
    const p = await project(coherentFixture(), { service: "payment-service" });
    const res = await runLoam(p.workDir, "delta", "FEAT-1", "--service", "payment-service");
    expect(res.code).toBe(0);
    expect(res.out).toContain("Outbound (new calls from this service):");
    expect(res.out).toContain('→ payment-split-service  "Calls createSplit"');
    expect(res.out).not.toContain("NEW service");
  });

  it("marks a feature-tagged service as NEW and shows the inbound edge from its caller", async () => {
    const p = await project(coherentFixture(), { service: "payment-split-service" });
    const res = await runLoam(p.workDir, "delta", "FEAT-1", "--service", "payment-split-service");
    expect(res.code).toBe(0);
    expect(res.out).toContain("NEW service — create payment-split-service");
    expect(res.out).toContain("Inbound (this service is newly called):");
    expect(res.out).toContain('← payment-service  "Calls createSplit"');
  });

  it("prints '[ADDED] <name>  (1 scenario)' requirement lines with scenario bullets for a service that has a delta", async () => {
    const p = await project(coherentFixture(), { service: "payment-split-service" });
    const res = await runLoam(p.workDir, "delta", "FEAT-1", "--service", "payment-split-service");
    expect(res.code).toBe(0);
    expect(res.out).toContain("Requirements:");
    expect(res.out).toContain("[ADDED] Split a payment  (1 scenario)");
    expect(res.out).toContain("· Split across two payees");
  });

  it("reports '(no architecture change for this service)' for a service the delta does not touch", async () => {
    const p = await project(coherentFixture(), { service: "payment-service" });
    const res = await runLoam(p.workDir, "delta", "FEAT-1", "--service", "checkout-web");
    expect(res.code).toBe(0);
    expect(res.out).toContain("FEAT-1 · checkout-web");
    expect(res.out).toContain("(no architecture change for this service)");
    expect(res.out).not.toContain("NEW service");
  });

  it("defaults to the configured service when --service is omitted", async () => {
    const p = await project(coherentFixture(), { service: "payment-split-service" });
    const res = await runLoam(p.workDir, "delta", "FEAT-1");
    expect(res.code).toBe(0);
    expect(res.out).toContain("FEAT-1 · payment-split-service");
    expect(res.out).toContain("NEW service — create payment-split-service");
  });
});

/* ------------------------------------------------------------------ */
/* delta — degraded inputs                                             */
/* ------------------------------------------------------------------ */

describe("delta: degraded inputs", () => {
  it("unknown feature id exits 1 with a message naming the feature and the features dir", async () => {
    const p = await project(coherentFixture(), { service: "payment-service" });
    const res = await runLoam(p.workDir, "delta", "FEAT-99", "--service", "payment-service");
    expect(res.code).toBe(1);
    expect(res.out).toContain("FEAT-99");
    expect(res.out).toContain("No feature");
    // the path is spelled by featuresDir(), the same as validate/verify
    expect(res.out).toContain(join(p.docsDir, "features"));
  });

  it("exits 1 with a clean message when no service is given and none is configured", async () => {
    const p = await project(coherentFixture());
    const res = await runLoam(p.workDir, "delta", "FEAT-1");
    expect(res.code).toBe(1);
    expect(res.out).toContain("No service");
  });

  it("a broken delta.likec4 makes the architecture section report errors instead of crashing the projection", async () => {
    const files = coherentFixture();
    files["features/FEAT-1-split/delta.likec4"] = "model {\n  broken !!! not likec4\n";
    const p = await project(files, { service: "payment-service" });
    const res = await runLoam(p.workDir, "delta", "FEAT-1", "--service", "payment-service");
    // the sections before architecture still render…
    expect(res.out).toContain("FEAT-1 · payment-service");
    expect(res.out).toContain("Requirements: (none for this service)");
    // …and the arch section degrades to a diagnostic — but the exit code still
    // says 1, exactly like --json: an empty C4 slice from a parse failure must
    // not read as "no architecture change" in either format.
    expect(res.code).toBe(1);
    expect(res.out).toContain("delta.likec4 has errors");
  });

  it("a feature without intent.md still projects requirements and architecture", async () => {
    const files = coherentFixture();
    delete files["features/FEAT-1-split/intent.md"];
    const p = await project(files, { service: "payment-split-service" });
    const res = await runLoam(p.workDir, "delta", "FEAT-1", "--service", "payment-split-service");
    expect(res.code).toBe(0);
    expect(res.out).toContain("[ADDED] Split a payment  (1 scenario)");
    expect(res.out).toContain("NEW service — create payment-split-service");
  });
});

/* ------------------------------------------------------------------ */
/* delta — intent frontmatter stripping                                */
/* ------------------------------------------------------------------ */

describe("delta: intent frontmatter stripping", () => {
  it("an intent.md with NO frontmatter is printed verbatim", async () => {
    const p = await project(
      { "features/FEAT-9/intent.md": "# Raw intent\n\nBody without frontmatter.\n" },
      { service: "any-svc" },
    );
    const res = await runLoam(p.workDir, "delta", "FEAT-9", "--service", "any-svc");
    expect(res.code).toBe(0);
    expect(res.out).toContain("# Raw intent");
    expect(res.out).toContain("Body without frontmatter.");
  });

  it("frontmatter whose closing '---' is the last line without a trailing newline never leaks its keys", async () => {
    const p = await project(
      { "features/FEAT-9/intent.md": "---\nsecret: hidden\n---" },
      { service: "any-svc" },
    );
    const res = await runLoam(p.workDir, "delta", "FEAT-9", "--service", "any-svc");
    expect(res.code).toBe(0);
    // the projection itself still ran (guards against a vacuous pass)
    expect(res.out).toContain("FEAT-9 · any-svc");
    expect(res.out).not.toContain("secret: hidden");
  });

  it("a '---' horizontal rule later in the body does not extend the frontmatter — text on both sides of the rule survives", async () => {
    const p = await project(
      {
        "features/FEAT-9/intent.md":
          "---\nfm_key: fm_value\n---\n\nIntro before rule.\n\n---\n\nAfter the rule.\n",
      },
      { service: "any-svc" },
    );
    const res = await runLoam(p.workDir, "delta", "FEAT-9", "--service", "any-svc");
    expect(res.code).toBe(0);
    expect(res.out).toContain("Intro before rule.");
    expect(res.out).toContain("After the rule.");
    expect(res.out).not.toContain("fm_key");
  });

  it("body text directly after the closing '---' (no blank line) is kept while the frontmatter is stripped", async () => {
    const p = await project(
      { "features/FEAT-9/intent.md": "---\nowner: team-x\n---\nDirect body line.\n" },
      { service: "any-svc" },
    );
    const res = await runLoam(p.workDir, "delta", "FEAT-9", "--service", "any-svc");
    expect(res.code).toBe(0);
    expect(res.out).toContain("Direct body line.");
    expect(res.out).not.toContain("owner: team-x");
  });
});

/* ------------------------------------------------------------------ */
/* delta — feature directory resolution                                */
/* ------------------------------------------------------------------ */

describe("delta: feature directory resolution", () => {
  const twoFeatures = {
    "features/FEAT-1-split/intent.md": "# Intent ONE\n",
    "features/FEAT-10-other/intent.md": "# Intent TEN\n",
  };

  it("'FEAT-1' matches 'FEAT-1-split' and never 'FEAT-10-other'", async () => {
    const p = await project(twoFeatures, { service: "any-svc" });
    const res = await runLoam(p.workDir, "delta", "FEAT-1", "--service", "any-svc");
    expect(res.code).toBe(0);
    expect(res.out).toContain("# Intent ONE");
    expect(res.out).not.toContain("# Intent TEN");
  });

  it("'FEAT-10' matches 'FEAT-10-other' and never 'FEAT-1-split'", async () => {
    const p = await project(twoFeatures, { service: "any-svc" });
    const res = await runLoam(p.workDir, "delta", "FEAT-10", "--service", "any-svc");
    expect(res.code).toBe(0);
    expect(res.out).toContain("# Intent TEN");
    expect(res.out).not.toContain("# Intent ONE");
  });

  it("a bare 'FEAT-2' directory (no slug suffix) resolves by exact name", async () => {
    const p = await project(
      { "features/FEAT-2/intent.md": "# Intent TWO\n" },
      { service: "any-svc" },
    );
    const res = await runLoam(p.workDir, "delta", "FEAT-2", "--service", "any-svc");
    expect(res.code).toBe(0);
    expect(res.out).toContain("# Intent TWO");
  });
});

/* ------------------------------------------------------------------ */
/* adopt — see test/adopt.test.ts                                      */
/* ------------------------------------------------------------------ */

/* The three tests that used to sit here pinned the stub's printed contract
 * ("adopt — not yet implemented", the planned paths, the `<service>` fallback).
 * The stub is gone: adopt now emits an agent brief, and the placeholder path is
 * a refusal, so those assertions could only be deleted, not adapted. The
 * behaviour they guarded — the configured service, the --service override, a
 * missing loam.json — is pinned against the real command in test/adopt.test.ts.
 * The no-config case below is the one that survived unchanged. */
