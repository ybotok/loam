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
import { cp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  coherentFixture,
  LANDSCAPE,
  LIVING_SPEC,
  makeProject,
  runLoam,
  type Project,
} from "./helpers/harness.js";

const EXAMPLES = fileURLToPath(new URL("../examples/docs", import.meta.url));
const FLEET_FILE = fileURLToPath(new URL("../examples/fleet.yaml", import.meta.url));

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
  targets?: { kind: string; id: string; findings?: { severity: string; code: string; message: string }[] }[];
}

async function validateJson(p: Project, ...args: string[]): Promise<{ code: number; payload: ValidatePayload }> {
  const res = await runLoam(p.workDir, "validate", ...args, "--json");
  return { code: res.code, payload: JSON.parse(res.stdout) as ValidatePayload };
}

/** Every target this run graded, by id — the answer every scope case is really about. */
function graded(payload: ValidatePayload): string[] {
  return (payload.targets ?? []).map((t) => t.id).sort();
}

/** Every non-`ok` finding the run raised, with the target it was filed on. */
function raised(payload: ValidatePayload): { target: string; code: string; message: string }[] {
  return (payload.targets ?? []).flatMap((t) =>
    (t.findings ?? []).filter((f) => f.severity !== "ok").map((f) => ({ target: t.id, code: f.code, message: f.message })),
  );
}

/** Every finding code the run raised at any severity — `ok` included, which is how a grade that PASSED shows. */
function codes(payload: ValidatePayload): string[] {
  return (payload.targets ?? []).flatMap((t) => (t.findings ?? []).map((f) => f.code));
}

/** The shipped example fleet, copied rather than graded in place — see test/examples.test.ts for why. */
async function exampleFleet(): Promise<Project> {
  const p = await makeProject({});
  await cp(EXAMPLES, p.docsDir, { recursive: true });
  return p;
}

/**
 * payment-service's contract cut to the one operation README's spine-first
 * example names — spelled the American way, test/spine-first.test.ts's own
 * fixture, so the misspelling below is the README's one letter exactly.
 */
const PAYMENT_OPENAPI = `openapi: 3.1.0
info:
  title: payment-service
  version: 1.0.0
paths:
  /payments:
    post:
      operationId: authorizePayment
      responses:
        "201":
          description: Authorized
`;

/** The edge `loam seed` writes bare, and what naming its operation turns it into. */
const BARE_EDGE = "  svc_order_service -> svc_payment_service\n";
const namedEdge = (op: string): string =>
  `  svc_order_service -> svc_payment_service 'Authorises' {\n    metadata { op '${op}' }\n  }\n`;

/**
 * A freshly seeded spine-first fleet — README's "Start from the fleet spine",
 * from the shipped `examples/fleet.yaml` — with payment-service's contract
 * dropped in. No service has a model.likec4, so every service target would be
 * red on `service.no-model`; that is what makes it the fleet where grading the
 * PROVIDER rather than the EDGE would be the wrong fix.
 */
async function seededFleet(): Promise<Project> {
  const p = await makeProject({ "services/.gitkeep": "" });
  await writeFile(join(p.workDir, "fleet.yaml"), await readFile(FLEET_FILE, "utf8"), "utf8");
  const seeded = await runLoam(p.workDir, "seed", "--from", "fleet.yaml");
  if (seeded.code !== 0) throw new Error(`seed failed: ${seeded.out}`);
  await p.write("services/payment-service/openapi.yaml", PAYMENT_OPENAPI);
  return p;
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

describe("loam validate --all --base — a call edge the branch edited is graded against its provider", () => {
  // The defect: `spine.op-undefined` is graded on the PROVIDER's service
  // target, and an architecture/ change only ever put the landscape in scope,
  // so README's own one-letter example — the payoff the spine-first path is
  // sold on — merged green through both PR gates, on an adopted fleet and on a
  // seeded one alike. Only the unscoped run, red for other reasons on a fleet
  // mid-adoption, ever named it.
  it("README's misspelt op on the examples fleet fails, with the provider still out of scope", async () => {
    const p = await exampleFleet();
    try {
      commitBase(p.docsDir);
      const map = "architecture/landscape.likec4";
      const before = await p.read(map);
      expect(before).toContain("op 'authorizePayment'");
      await p.write(map, before.replace("op 'authorizePayment'", "op 'authorisePayment'"));
      const { code, payload } = await validateJson(p, "--all", "--base", "main");
      expect(code).toBe(1);
      const spine = raised(payload).filter((f) => f.code === "spine.op-undefined");
      expect(spine).toHaveLength(1);
      expect(spine[0]?.target).toBe("landscape");
      expect(spine[0]?.message).toContain("authorisePayment");
      // The EDGE is graded, not the provider: payment-service's own documents
      // are not what this branch touched, and grading them would hand the PR
      // every finding they already carry.
      expect(payload.scope?.services).toEqual([]);
      expect(graded(payload)).toEqual(["landscape"]);
    } finally {
      await p.destroy();
    }
  });

  it("a misspelt op on an edge written right after a bare `link` line fails too — the link does not swallow the edge", async () => {
    // The splice map read the URI as blank, so `link https://…` was the bare
    // word `link` and ran on into the next line: the edge below it was scanned
    // as `link -> marketplace.orderService`, matched no parsed edge, and the
    // branch's one-letter typo was graded nowhere — exit 0, `valid: true`,
    // where main reported it (probed at 23f1578).
    const p = await exampleFleet();
    try {
      const map = "architecture/landscape.likec4";
      const anchor = "      metadata {\n        service 'checkout-web'\n      }\n";
      const link = "      link https://wiki.example.com/checkout-web\n";
      const before = await p.read(map);
      expect(before).toContain(anchor);
      await p.write(map, before.replace(anchor, anchor + link));
      commitBase(p.docsDir);
      const edge = "      -> marketplace.orderService 'Calls cancelOrder' {\n        metadata { op 'cancelOrdr' }\n      }\n";
      await p.write(map, before.replace(anchor, anchor + link + edge));
      const { code, payload } = await validateJson(p, "--all", "--base", "main");
      expect(code).toBe(1);
      const spine = raised(payload).filter((f) => f.code === "spine.op-undefined");
      expect(spine.map((f) => f.message).join("\n")).toContain("cancelOrdr");
    } finally {
      await p.destroy();
    }
  });

  it("the same misspelling on a freshly seeded spine-first fleet fails — even under --strict it used to be green", async () => {
    const p = await seededFleet();
    try {
      const map = await p.read("architecture/landscape.likec4");
      expect(map).toContain(BARE_EDGE);
      await p.write("architecture/landscape.likec4", map.replace(BARE_EDGE, namedEdge("authorizePayment")));
      commitBase(p.docsDir);
      await p.write("architecture/landscape.likec4", map.replace(BARE_EDGE, namedEdge("authorisePayment")));
      const { code, payload } = await validateJson(p, "--all", "--base", "main", "--strict");
      expect(code).toBe(1);
      expect(raised(payload).map((f) => f.code)).toEqual(["spine.op-undefined"]);
    } finally {
      await p.destroy();
    }
  });

  it("naming the op correctly on a seeded fleet is graded and green — the provider's missing model is not the branch's", async () => {
    const p = await seededFleet();
    try {
      commitBase(p.docsDir);
      const map = await p.read("architecture/landscape.likec4");
      await p.write("architecture/landscape.likec4", map.replace(BARE_EDGE, namedEdge("authorizePayment")));
      const { code, payload } = await validateJson(p, "--all", "--base", "main", "--strict");
      // Five un-adopted services each carry `service.no-model`; pulling the
      // provider into scope would have reddened exactly the labour README's
      // spine-first path asks for.
      expect(code).toBe(0);
      expect(raised(payload)).toEqual([]);
      // ...and the green is a grade, not a skip: the edge was resolved.
      expect(codes(payload)).toContain("spine.resolved");
    } finally {
      await p.destroy();
    }
  });
});

describe("loam validate --all --base — a committed map that does not parse is reported somewhere", () => {
  it("a branch touching only a service carries the parser output on that service, since no landscape target does", async () => {
    // The defect, the reviewer's repro on the examples fleet: the committed map
    // is broken and the branch edits one service's spec. `architecture/` did
    // not change, so the run emits no landscape target — yet the service was
    // told one existed, because "a landscape was preloaded" stood in for "a
    // landscape target was emitted". It printed `spine.landscape-invalid …
    // the parser output is reported once, on the landscape target` with no
    // details, and the parser output was reported nowhere. Present before the
    // service-target helper existed; the helper made it its contract.
    const p = await exampleFleet();
    try {
      const map = "architecture/landscape.likec4";
      await p.write(map, `${await p.read(map)}\nmodel {\n  broken = bogusKind 'Broken'\n}\n`);
      commitBase(p.docsDir);
      const spec = "services/payment-service/spec.md";
      await p.write(spec, `${await p.read(spec)}\n`);
      const { code, payload } = await validateJson(p, "--all", "--base", "main");
      expect(code).toBe(1);
      expect(payload.scope?.landscape).toBe(false);
      expect((payload.targets ?? []).map((t) => t.kind)).not.toContain("landscape");
      const target = (payload.targets ?? []).find((t) => t.id === "payment-service");
      const invalid = (target?.findings ?? []).find((f) => f.code === "spine.landscape-invalid") as
        | { message: string; details?: string[] }
        | undefined;
      expect(invalid, "payment-service must still say the spine could not run").toBeDefined();
      expect(invalid!.message).not.toContain("reported once, on the landscape target");
      expect(invalid!.details?.length ?? 0).toBeGreaterThan(0);
    } finally {
      await p.destroy();
    }
  });
});

describe("loam validate --all --base — a fleet-wide vocabulary is re-graded only when its file changed", () => {
  // The defect: the landscape target is one coarse subject, so ANY
  // architecture/ branch re-graded every fleet-wide vocabulary warning, and
  // under --strict a one-line map edit on the adopted example fleet went red on
  // four warnings that were all there at the base.
  it("a map edit on the examples fleet is green under --strict; the vocabulary's own branch still sees its warning", async () => {
    const p = await exampleFleet();
    try {
      commitBase(p.docsDir);
      const map = await p.read("architecture/landscape.likec4");
      await p.write("architecture/landscape.likec4", `${map}\n`);
      const mapOnly = await validateJson(p, "--all", "--base", "main", "--strict");
      expect(raised(mapOnly.payload)).toEqual([]);
      expect(mapOnly.code).toBe(0);

      // The permission vocabulary itself changed: its warning is this
      // branch's business again — and only its, not its neighbours'.
      const permissions = await p.read("architecture/permissions.yaml");
      await p.write("architecture/permissions.yaml", `${permissions}# reviewed\n`);
      const vocabulary = await validateJson(p, "--all", "--base", "main", "--strict");
      expect(raised(vocabulary.payload).map((f) => f.code)).toEqual(["permissions.unenforced"]);
      expect(vocabulary.code).toBe(1);

      // Unscoped, nothing moved: every fleet-wide warning is still reported.
      const fleet = await validateJson(p, "--all");
      expect(raised(fleet.payload).map((f) => f.code)).toEqual(
        expect.arrayContaining([
          "permissions.unenforced",
          "capability.unrealized",
          "capability.requirement-unrealized",
          "obligation.unapplied",
        ]),
      );
    } finally {
      await p.destroy();
    }
  });

  it("agents.stale rides a scoped run only when AGENTS.md itself changed", async () => {
    const p = await makeProject({
      ...twoServices(),
      "AGENTS.md": "<!-- generated by loam v0.0.1 -->\n# Agents\n",
    });
    try {
      commitBase(p.docsDir);
      await p.write("architecture/landscape.likec4", `${LANDSCAPE}\n`);
      const mapOnly = await validateJson(p, "--all", "--base", "main");
      expect(graded(mapOnly.payload)).toContain("landscape");
      expect(codes(mapOnly.payload)).not.toContain("agents.stale");

      await p.write("AGENTS.md", "<!-- generated by loam v0.0.1 -->\n# Agents\n\nEdited.\n");
      const both = await validateJson(p, "--all", "--base", "main");
      expect(codes(both.payload)).toContain("agents.stale");

      const fleet = await validateJson(p, "--all");
      expect(codes(fleet.payload)).toContain("agents.stale");
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
