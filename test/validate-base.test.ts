/**
 * `loam validate --all --base <ref>` — the adoption ratchet.
 *
 * The defect: a partly-adopted fleet has no CI setting that is both passing
 * today and tightening over time. `--all` is green over eleven undocumented
 * services because warnings do not gate, and `--strict` is red from the first
 * minute of adoption until the last boundary is written. `--base` is the third
 * setting — grade what the branch touched — and every case below pins one of
 * the four ways it could quietly lie: grading a target the branch never
 * touched, DROPPING one it did (the filed-service case, which a path split on
 * "/" fails), reporting a scoped green in the words of a fleet-wide one, or
 * exiting 0 over an empty scope without saying so.
 *
 * Each case builds a real git history inside the fixture's docs dir, the way
 * test/diff*.test.ts does — the harness tmpdir is not inside any repository, so
 * an un-inited fixture genuinely has no git to ask.
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import {
  coherentFixture,
  LANDSCAPE,
  LIVING_SPEC,
  makeProject,
  runLoam,
  type Project,
} from "./helpers/harness.js";

function git(cwd: string, ...args: string[]): void {
  const res = spawnSync("git", args, { cwd, encoding: "utf8", timeout: 30_000 });
  if (res.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${res.stderr}`);
}

/** Init at `dir` and commit everything as the base ref every case narrows from. */
function commitBase(dir: string): void {
  git(dir, "init", "-q", "-b", "main");
  git(dir, "add", "-A");
  git(dir, "-c", "user.email=base@test.invalid", "-c", "user.name=Base Test", "commit", "-q", "-m", "base");
}

interface ScopePayload {
  base: string;
  commit: string;
  landscape: boolean;
  services: string[];
  features: string[];
  totals: { services: number; features: number };
}

interface ValidatePayload {
  ok?: boolean;
  valid?: boolean;
  error?: { code: string; message: string };
  scope?: ScopePayload;
  scorecard?: unknown;
  summary?: { services: number; features: number; errors: number; warnings: number };
  targets?: { kind: string; id: string }[];
}

async function validateJson(p: Project, ...args: string[]): Promise<{ code: number; payload: ValidatePayload }> {
  const res = await runLoam(p.workDir, "validate", ...args, "--json");
  return { code: res.code, payload: JSON.parse(res.stdout) as ValidatePayload };
}

/** Every target this run graded, by id — the answer every scope case is really about. */
function graded(payload: ValidatePayload): string[] {
  return (payload.targets ?? []).map((t) => t.id).sort();
}

/**
 * The canonical coherent fleet plus a SECOND service nobody in these cases
 * touches. Two services is the smallest fleet in which "in scope" and "graded"
 * can disagree — with one service every scope is the whole fleet, and a
 * narrowing that did nothing would pass.
 */
function twoServices(): Record<string, string> {
  const files = coherentFixture();
  files["services/refund-service/spec.md"] = LIVING_SPEC.replace(/payment-service/g, "refund-service");
  return files;
}

describe("loam validate --all --base — what lands in scope", () => {
  it("a changed service is graded and an untouched one is not, with the fleet's denominators kept", async () => {
    const p = await makeProject(twoServices());
    try {
      commitBase(p.docsDir);
      await p.write(
        "services/payment-service/spec.md",
        LIVING_SPEC.replace("before capture.", "before capture, and never after."),
      );
      const { code, payload } = await validateJson(p, "--all", "--base", "main");
      expect(code).toBe(0);
      expect(payload.scope?.services).toEqual(["payment-service"]);
      // The denominator is the fleet, not the scope: a report that said
      // "1 of 1" would be a whole-fleet claim wearing a scoped run's numbers.
      expect(payload.scope?.totals.services).toBe(2);
      expect(graded(payload)).toEqual(["payment-service"]);
      expect(payload.scope?.landscape).toBe(false);
    } finally {
      await p.destroy();
    }
  });

  it("a service filed under a SUBSYSTEM resolves — the case a path split on '/' drops silently", async () => {
    // `services/platform/payment-service/spec.md` splits to "platform", which
    // is no service id, so a path-splitting scope grades NOTHING and exits 0.
    // The failure is invisible by construction: the run is green either way.
    const files: Record<string, string> = {};
    for (const [path, content] of Object.entries(twoServices())) {
      files[path.replace(/^services\/payment-service\//, "services/platform/payment-service/")] = content;
    }
    files["services/platform/subsystem.yaml"] = "title: Platform\n";
    const p = await makeProject(files);
    try {
      commitBase(p.docsDir);
      await p.write(
        "services/platform/payment-service/spec.md",
        LIVING_SPEC.replace("before capture.", "before capture, and never after."),
      );
      const { code, payload } = await validateJson(p, "--all", "--base", "main");
      expect(code).toBe(0);
      expect(payload.scope?.services).toEqual(["payment-service"]);
      expect(graded(payload)).toEqual(["payment-service"]);
    } finally {
      await p.destroy();
    }
  });

  it("an architecture/ change puts the landscape in scope; a service change alone does not", async () => {
    const p = await makeProject(twoServices());
    try {
      commitBase(p.docsDir);
      await p.write("architecture/landscape.likec4", `${LANDSCAPE}\n`);
      const { payload } = await validateJson(p, "--all", "--base", "main");
      expect(payload.scope?.landscape).toBe(true);
      expect(payload.scope?.services).toEqual([]);
      expect((payload.targets ?? []).map((t) => t.kind)).toContain("landscape");
    } finally {
      await p.destroy();
    }
  });

  it("a changed feature is graded as a feature target, and counts against the feature denominator", async () => {
    const p = await makeProject(twoServices());
    try {
      commitBase(p.docsDir);
      await p.write(
        "features/FEAT-1-split/intent.md",
        "---\nfeature: FEAT-1\nstatus: proposed\n---\n\n# Split payments\n\nLet a payment be split across payees, exactly once.\n",
      );
      const { payload } = await validateJson(p, "--all", "--base", "main");
      expect(payload.scope?.features).toEqual(["FEAT-1"]);
      expect(payload.scope?.totals.features).toBe(1);
      expect(graded(payload)).toEqual(["FEAT-1"]);
    } finally {
      await p.destroy();
    }
  });

  it("a docs repo INSIDE a larger repository still scopes correctly — the prefix pin", async () => {
    const p = await makeProject(twoServices());
    try {
      // The git root is the fixture root ABOVE docsDir, so git answers in the
      // whole repository's paths (`docs/services/...`). Dropping the prefix
      // matches nothing and the run grades the fleet's whole footprint as
      // out of scope — a silent green, in exactly the repositories big enough
      // to have a monorepo.
      commitBase(join(p.docsDir, ".."));
      await p.write(
        "services/refund-service/spec.md",
        LIVING_SPEC.replace(/payment-service/g, "refund-service").replace("before capture.", "before capture, once."),
      );
      const { payload } = await validateJson(p, "--all", "--base", "main");
      expect(payload.scope?.services).toEqual(["refund-service"]);
      expect(graded(payload)).toEqual(["refund-service"]);
    } finally {
      await p.destroy();
    }
  });

  it("a service adopted since the ref and never committed is in scope — validate grades the WORKING TREE", async () => {
    // `git diff` only knows what git tracks, so a scope built from it alone
    // skips the boundary somebody adopted five minutes ago — the flag's first
    // user reporting that it graded nothing.
    const p = await makeProject(twoServices());
    try {
      commitBase(p.docsDir);
      await p.write("services/ledger-service/spec.md", LIVING_SPEC.replace(/payment-service/g, "ledger-service"));
      const { payload } = await validateJson(p, "--all", "--base", "main");
      expect(payload.scope?.services).toEqual(["ledger-service"]);
      expect(payload.scope?.totals.services).toBe(3);
    } finally {
      await p.destroy();
    }
  });
});

describe("loam validate --all --base — a green over nothing says so", () => {
  it("zero targets in scope exits 0, prints that it graded nothing, and names the denominators", async () => {
    const p = await makeProject(twoServices());
    try {
      commitBase(p.docsDir);
      // A change no target owns: the docs repo's own README is under no
      // service, no feature and not under architecture/.
      await p.write("README.md", "# docs\n");
      const res = await runLoam(p.workDir, "validate", "--all", "--base", "main");
      expect(res.code).toBe(0);
      // The exact failure this sentence exists to prevent: an exit 0 with no
      // words, read in CI as a green over the whole system.
      expect(res.stdout).toContain("nothing was graded");
      expect(res.stdout).toContain("0 of 2 services, 0 of 1 features in scope since main");
    } finally {
      await p.destroy();
    }
  });

  it("the same run in --json is valid with no targets, and its scope object says which", async () => {
    const p = await makeProject(twoServices());
    try {
      commitBase(p.docsDir);
      await p.write("README.md", "# docs\n");
      const { code, payload } = await validateJson(p, "--all", "--base", "main");
      expect(code).toBe(0);
      expect(payload.valid).toBe(true);
      expect(payload.targets).toEqual([]);
      expect(payload.summary).toMatchObject({ services: 0, features: 0, errors: 0, warnings: 0 });
      expect(payload.scope).toMatchObject({
        base: "main",
        landscape: false,
        services: [],
        features: [],
        totals: { services: 2, features: 1 },
      });
    } finally {
      await p.destroy();
    }
  });
});

describe("loam validate --all --base — the payload's scope object", () => {
  it("names the base as spelled, the commit it resolved to, and the targets", async () => {
    const p = await makeProject(twoServices());
    try {
      commitBase(p.docsDir);
      await p.write("architecture/landscape.likec4", `${LANDSCAPE}\n`);
      await p.write(
        "services/refund-service/spec.md",
        LIVING_SPEC.replace(/payment-service/g, "refund-service").replace("before capture.", "before capture, once."),
      );
      const { payload } = await validateJson(p, "--all", "--base", "main");
      expect(payload.scope?.base).toBe("main");
      expect(payload.scope?.commit).toMatch(/^[0-9a-f]{40}$/);
      expect(payload.scope?.landscape).toBe(true);
      expect(payload.scope?.services).toEqual(["refund-service"]);
      // The fleet scorecard is a claim about the FLEET's adoption and its
      // denominators are the graded targets, so a scoped run must not carry
      // one — "1 of 1 services documented" over a fleet of two is the same
      // green-over-a-subset this flag exists to make impossible.
      expect(payload.scorecard).toBeUndefined();
    } finally {
      await p.destroy();
    }
  });

  it("an unscoped --all run carries no scope key at all — today's payload is unmoved", async () => {
    const p = await makeProject(twoServices());
    try {
      const { payload } = await validateJson(p, "--all");
      expect(payload.scope).toBeUndefined();
      expect(payload.summary?.services).toBe(2);
    } finally {
      await p.destroy();
    }
  });
});

describe("loam validate --all --base — refusals, by code", () => {
  it("a docs repo git cannot answer for refuses repository-unavailable — diff's code, not a new one", async () => {
    const p = await makeProject(twoServices());
    try {
      const { code, payload } = await validateJson(p, "--all", "--base", "main");
      expect(code).toBe(1);
      expect(payload.ok).toBe(false);
      expect(payload.error?.code).toBe("repository-unavailable");
      expect(payload.error?.message).toContain("git");
    } finally {
      await p.destroy();
    }
  });

  it("a ref that resolves to no commit refuses unknown-target, naming the ref", async () => {
    const p = await makeProject(twoServices());
    try {
      commitBase(p.docsDir);
      const { code, payload } = await validateJson(p, "--all", "--base", "no-such-branch");
      expect(code).toBe(1);
      expect(payload.error?.code).toBe("unknown-target");
      expect(payload.error?.message).toContain("no-such-branch");
    } finally {
      await p.destroy();
    }
  });

  it("--base without --all refuses invalid-option: it narrows a whole-fleet run, it does not name one", async () => {
    const p = await makeProject(twoServices());
    try {
      commitBase(p.docsDir);
      const { code, payload } = await validateJson(p, "--base", "main");
      expect(code).toBe(1);
      expect(payload.error?.code).toBe("invalid-option");
      expect(payload.error?.message).toContain("--all");
    } finally {
      await p.destroy();
    }
  });

  it("--base beside a positional target, --service or --feature refuses invalid-option — two scopes is a contradiction", async () => {
    const p = await makeProject(twoServices());
    try {
      commitBase(p.docsDir);
      for (const args of [
        ["payment-service", "--base", "main"],
        ["--service", "payment-service", "--base", "main"],
        ["--feature", "FEAT-1", "--base", "main"],
      ]) {
        const { code, payload } = await validateJson(p, ...args);
        expect(code, args.join(" ")).toBe(1);
        expect(payload.error?.code, args.join(" ")).toBe("invalid-option");
      }
    } finally {
      await p.destroy();
    }
  });
});
