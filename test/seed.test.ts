/**
 * `loam seed` — fleet.yaml templated into the landscape + service dirs.
 *
 * The emitted-DSL-parses requirement is pinned through the REAL validator,
 * not a unit assertion: seed then `validate --all` must leave the landscape
 * target carrying `landscape.matched` and no `subsystem.views-stale`. A
 * freshly seeded service is pre-adoption BY DESIGN, so `service.no-model`
 * (error) per created service is the expected fleet state — the suite asserts
 * it is the ONLY error code, which is what proves the landscape itself
 * introduced none.
 *
 * Every refusal test carries the treeHashes no-write proof: seed's promise is
 * that a refusal costs nothing, and a hash compare over the whole docs tree
 * is what that sentence means.
 */
import { describe, expect, it } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildProgram } from "../src/cli.js";
import { docsRepoFiles } from "../src/core/docs.js";
import { parseServiceId } from "../src/core/kernel/ids/service.js";
import { renderLandscape } from "../src/core/c4/seed/template.js";
import { landscapeProvenance, sealLandscape } from "../src/core/c4/seed/stamp.js";
import { LANDSCAPE, makeProject, runLoam, treeHashes, type Project } from "./helpers/harness.js";

/** The scaffold's landscape, from the scaffolder itself — never a hand copy. */
const scaffoldLandscape = (): string =>
  docsRepoFiles().find(([rel]) => rel.endsWith("landscape.likec4"))![1];

/** The two dirs docsRepoFiles keeps in git; seed's gate refuses a repo without services/. */
const EMPTY_REPO = { "services/.gitkeep": "", "features/.gitkeep": "" };

const FLEET = `subsystems:
  - payments
services:
  - id: checkout
    subsystem: payments
  - id: payment-service
    subsystem: payments
  - billing
externals:
  - stripe
calls:
  - checkout -> payment-service
  - payment-service -> stripe
  - billing -> payment-service
`;

async function writeFleet(p: Project, yaml: string): Promise<void> {
  await writeFile(join(p.workDir, "fleet.yaml"), yaml, "utf8");
}

interface Finding {
  severity: string;
  code: string;
  message: string;
}
interface Target {
  kind: string;
  id: string;
  findings: Finding[];
}

/** Does this invocation parse against the real CLI? Actions inert, output silenced. */
async function parses(text: string): Promise<boolean> {
  const program = buildProgram();
  const silence = { writeOut: () => {}, writeErr: () => {} };
  program.configureOutput(silence);
  for (const cmd of program.commands) {
    cmd.action(() => {});
    cmd.configureOutput(silence);
    cmd.exitOverride();
  }
  try {
    await program.parseAsync(text.split(/\s+/).slice(1), { from: "user" });
    return true;
  } catch {
    return false;
  }
}

/** Run seed expecting a refusal: asserts the code, exit 1, and the no-write proof. */
async function refusedSeed(p: Project, code: string): Promise<{ message: string; payload: Record<string, unknown> }> {
  const before = await treeHashes(p.docsDir);
  const run = await runLoam(p.workDir, "seed", "--json");
  expect(run.code).toBe(1);
  const payload = JSON.parse(run.stdout) as { ok: boolean; error: { code: string; message: string } };
  expect(payload.ok).toBe(false);
  expect(payload.error.code).toBe(code);
  expect(await treeHashes(p.docsDir)).toEqual(before);
  return { message: payload.error.message, payload: payload as unknown as Record<string, unknown> };
}

describe("loam seed — the happy path, through the real validator", () => {
  it("templates the landscape, the subsystem, the service dirs and the views file, and validates", async () => {
    const p = await makeProject({ ...EMPTY_REPO, "architecture/landscape.likec4": scaffoldLandscape() });
    try {
      await writeFleet(p, FLEET);
      const run = await runLoam(p.workDir, "seed", "--json");
      expect(run.code).toBe(0);
      const payload = JSON.parse(run.stdout);
      expect(payload.ok).toBe(true);
      expect(payload.fleetFile).toBe("fleet.yaml");
      expect(payload.landscape).toBe("replaced-stub");
      expect(payload.services).toEqual({
        created: ["billing", "checkout", "payment-service"],
        existing: [],
      });
      expect(payload.subsystems).toEqual(["payments"]);
      expect(payload.externals).toEqual(["stripe"]);
      expect(payload.calls).toBe(3);
      expect(p.exists("services/payments/subsystem.yaml")).toBe(true);
      expect(p.exists("services/payments/checkout/.gitkeep")).toBe(true);
      expect(p.exists("services/payments/payment-service/.gitkeep")).toBe(true);
      expect(p.exists("services/billing/.gitkeep")).toBe(true);
      expect(p.exists("architecture/subsystems.likec4")).toBe(true);

      // Every `next` command must parse against the real CLI — loam instructs
      // agents, and an instruction that does not parse is a defect.
      expect(payload.next.length).toBeGreaterThanOrEqual(3);
      expect(payload.next).toContain("loam adopt --service billing");
      for (const n of payload.next as string[]) expect(await parses(n), n).toBe(true);

      // The real validator over the seeded repo: the landscape target agrees
      // with services/ (the emitted DSL parsed, every binding resolves, the
      // generated views are current), and the ONLY error anywhere is the
      // expected pre-adoption `service.no-model` — one per created service.
      const validate = await runLoam(p.workDir, "validate", "--all", "--json");
      const report = JSON.parse(validate.stdout) as { targets: Target[] };
      const landscape = report.targets.find((t) => t.kind === "landscape")!;
      expect(landscape.findings.map((f) => f.code)).toEqual(["landscape.matched"]);
      const all = report.targets.flatMap((t) => t.findings);
      expect(all.map((f) => f.code)).not.toContain("subsystem.views-stale");
      const errors = new Set(all.filter((f) => f.severity === "error").map((f) => f.code));
      expect([...errors]).toEqual(["service.no-model"]);
    } finally {
      await p.destroy();
    }
  });

  it("reads a section written without the dash as the one-entry list it plainly means", async () => {
    // `services: checkout` is a one-service fleet spelled the short way, and
    // the reader says so (core/c4/seed/items.ts's listOf). Pinned because the
    // leniency is a claim in that comment: everything that is NOT a legal
    // entry still fails the per-item type check with its own line.
    const p = await makeProject({ ...EMPTY_REPO });
    try {
      await writeFleet(p, "services: checkout\nexternals: stripe\ncalls: checkout -> stripe\n");
      const run = await runLoam(p.workDir, "seed", "--json");
      expect(run.code).toBe(0);
      const payload = JSON.parse(run.stdout);
      expect(payload.services).toEqual({ created: ["checkout"], existing: [] });
      expect(payload.externals).toEqual(["stripe"]);
      expect(payload.calls).toBe(1);
    } finally {
      await p.destroy();
    }
  });

  it("human mode names what it wrote and ends with the literal next commands", async () => {
    const p = await makeProject({ ...EMPTY_REPO });
    try {
      await writeFleet(p, FLEET);
      const run = await runLoam(p.workDir, "seed");
      expect(run.code).toBe(0);
      expect(run.stdout).toContain("architecture/landscape.likec4 created");
      expect(run.stdout).toContain("Next:");
      expect(run.stdout).toContain("loam validate --all");
      expect(run.stdout).toContain("loam list --needs-work");
      // First CREATED id in sort order — billing < checkout < payment-service.
      expect(run.stdout).toContain("loam adopt --service billing");
    } finally {
      await p.destroy();
    }
  });
});

describe("the stamp: regenerate while provably untouched, refuse the moment it is not", () => {
  it("re-running unedited regenerates byte-identically; a flipped byte refuses with no write", async () => {
    const p = await makeProject({ ...EMPTY_REPO, "architecture/landscape.likec4": scaffoldLandscape() });
    try {
      await writeFleet(p, FLEET);
      expect((await runLoam(p.workDir, "seed", "--json")).code).toBe(0);
      const first = await p.read("architecture/landscape.likec4");
      expect(first).toMatch(/^\/\/ loam-seed sha256:[0-9a-f]{64}/);

      const rerun = await runLoam(p.workDir, "seed", "--json");
      expect(rerun.code).toBe(0);
      expect(JSON.parse(rerun.stdout).landscape).toBe("regenerated");
      // Determinism is the stamp's precondition: identical fleet.yaml,
      // identical bytes, or the next run would read as hand-edited.
      expect(await p.read("architecture/landscape.likec4")).toBe(first);

      await p.write("architecture/landscape.likec4", first.replace("softwareSystem", "softwareSYSTEM"));
      const { message } = await refusedSeed(p, "seed-landscape-edited");
      expect(message).toContain("hand-edited");
      expect(message).toContain("fleet.yaml");
    } finally {
      await p.destroy();
    }
  });

  it("a hand-authored landscape (no stamp, not the stub) refuses seed-landscape-edited", async () => {
    const p = await makeProject({ ...EMPTY_REPO, "architecture/landscape.likec4": LANDSCAPE });
    try {
      await writeFleet(p, FLEET);
      const { message } = await refusedSeed(p, "seed-landscape-edited");
      expect(message).toContain("not the scaffold's untouched stub");
    } finally {
      await p.destroy();
    }
  });

  it("round-trips its own provenance: stamped, edited, foreign", () => {
    const sealed = sealLandscape("model {\n}\n");
    expect(landscapeProvenance(sealed)).toBe("seed-stamped");
    expect(landscapeProvenance(sealed.replace("model", "MODEL"))).toBe("seed-edited");
    expect(landscapeProvenance("// some other file\nmodel {\n}\n")).toBe("foreign");
  });
});

describe("fleet.yaml refusals — each names file and line, none writes a byte", () => {
  const cases: Array<{ name: string; fleet: string; code: string; expects: string[] }> = [
    {
      name: "a YAML parse error names the line",
      fleet: "services: [checkout\n",
      code: "seed-file-invalid",
      expects: ["fleet.yaml", "YAML"],
    },
    {
      name: "a non-mapping document",
      fleet: "- checkout\n- billing\n",
      code: "seed-file-invalid",
      expects: ["must be a YAML mapping"],
    },
    {
      name: "an unknown top-level key, with a did-you-mean",
      fleet: "servcies:\n  - checkout\n",
      code: "seed-file-invalid",
      expects: ["unknown key 'servcies'", "'services'"],
    },
    {
      name: "no services at all",
      fleet: "subsystems:\n  - payments\n",
      code: "seed-file-invalid",
      expects: ["declares no services"],
    },
    {
      name: "an illegal service id quotes the grammar rule",
      fleet: "services:\n  - ../etc\n",
      code: "seed-file-invalid",
      expects: ["must start with a letter or digit"],
    },
    {
      name: "a duplicate service id names both lines",
      fleet: "services:\n  - checkout\n  - checkout\n",
      code: "seed-duplicate-service",
      expects: ["fleet.yaml:3", "fleet.yaml:2", "flat namespace"],
    },
    {
      name: "an id doubling as an external is the same duplicate",
      fleet: "services:\n  - checkout\nexternals:\n  - checkout\n",
      code: "seed-duplicate-service",
      expects: ["fleet.yaml:4", "fleet.yaml:2"],
    },
    {
      name: "an unknown subsystem reference carries the close-name hint",
      fleet: "subsystems:\n  - payments\nservices:\n  - id: checkout\n    subsystem: paymets\n",
      code: "seed-unknown-subsystem",
      expects: ["'paymets'", "'payments'"],
    },
    {
      name: "a call endpoint nothing declares reuses unknown-service, with the hint",
      fleet: "services:\n  - checkout\n  - payment-service\ncalls:\n  - checkout -> paymet\n",
      code: "unknown-service",
      expects: ["'paymet'", "'payment-service'"],
    },
    {
      name: "a call naming a subsystem is refused as an endpoint — groups are not callable",
      fleet: "subsystems:\n  - payments\nservices:\n  - id: checkout\n    subsystem: payments\ncalls:\n  - checkout -> payments\n",
      code: "unknown-service",
      expects: ["subsystem 'payments'", "never a call endpoint"],
    },
    {
      // LikeC4 reads `a -> a` as a parent-child relationship and refuses the
      // file, so an unrefused self-call reaches the self-check and comes back
      // as `internal` — loam blaming itself for the caller's copy-paste.
      name: "a call with the same service at both ends is refused with its own line",
      fleet: "services:\n  - checkout\ncalls:\n  - checkout -> checkout\n",
      code: "seed-file-invalid",
      expects: ["fleet.yaml:4", "both ends", "self-edge"],
    },
    {
      name: "a non-string services entry says what an entry may be",
      fleet: "services:\n  - 7\n",
      code: "seed-file-invalid",
      expects: ["fleet.yaml:2", "a services entry is a string id"],
    },
    {
      name: "a malformed call line says the shape",
      fleet: "services:\n  - checkout\ncalls:\n  - checkout payment-service\n",
      code: "seed-file-invalid",
      expects: ["'caller -> callee'"],
    },
  ];
  for (const c of cases) {
    it(c.name, async () => {
      const p = await makeProject({ ...EMPTY_REPO, "architecture/landscape.likec4": scaffoldLandscape() });
      try {
        await writeFleet(p, c.fleet);
        const { message } = await refusedSeed(p, c.code);
        for (const fragment of c.expects) expect(message).toContain(fragment);
      } finally {
        await p.destroy();
      }
    });
  }

  it("an emptied-out section is the empty list, not a malformed entry", async () => {
    // `parseDocument` gives a heading with nothing under it a Scalar HOLDING
    // null, so deleting the last entry under `externals:` used to refuse with
    // "quote it if YAML reads it as something else" — advice about a value
    // that is not there.
    const p = await makeProject({ ...EMPTY_REPO });
    try {
      await writeFleet(p, "services:\n  - checkout\nsubsystems:\nexternals:\ncalls:\n");
      const run = await runLoam(p.workDir, "seed", "--json");
      expect(run.code, run.stdout).toBe(0);
      const payload = JSON.parse(run.stdout);
      expect(payload.externals).toEqual([]);
      expect(payload.subsystems).toEqual([]);
      expect(payload.calls).toBe(0);
    } finally {
      await p.destroy();
    }
  });

  it("an emptied-out services: gets the sentence written for that case", async () => {
    const p = await makeProject({ ...EMPTY_REPO, "architecture/landscape.likec4": scaffoldLandscape() });
    try {
      await writeFleet(p, "services:\n");
      const { message } = await refusedSeed(p, "seed-file-invalid");
      expect(message).toContain("declares no services");
    } finally {
      await p.destroy();
    }
  });

  it("a missing fleet file refuses seed-file-invalid without touching the repo", async () => {
    const p = await makeProject({ ...EMPTY_REPO, "architecture/landscape.likec4": scaffoldLandscape() });
    try {
      const { message } = await refusedSeed(p, "seed-file-invalid");
      expect(message).toContain("fleet.yaml does not exist");
    } finally {
      await p.destroy();
    }
  });
});

describe("the wholesale-regenerate preflight and existing directories", () => {
  it("an existing service fleet.yaml does not name refuses, with the ids as data", async () => {
    const p = await makeProject({
      ...EMPTY_REPO,
      "architecture/landscape.likec4": scaffoldLandscape(),
      "services/extra/spec.md": "# extra\n",
    });
    try {
      await writeFleet(p, "services:\n  - checkout\n");
      const { message, payload } = await refusedSeed(p, "seed-file-invalid");
      expect(message).toContain("extra");
      expect(payload["missingServices"]).toEqual(["extra"]);
    } finally {
      await p.destroy();
    }
  });

  it("an existing service named under a different subsystem is never moved", async () => {
    const p = await makeProject({
      ...EMPTY_REPO,
      "architecture/landscape.likec4": scaffoldLandscape(),
      "services/extra/spec.md": "# extra\n",
    });
    try {
      await writeFleet(
        p,
        "subsystems:\n  - payments\nservices:\n  - id: extra\n    subsystem: payments\n  - checkout\n",
      );
      const run = await runLoam(p.workDir, "seed", "--json");
      expect(run.code).toBe(0);
      const payload = JSON.parse(run.stdout);
      expect(payload.services).toEqual({ created: ["checkout"], existing: ["extra"] });
      expect(p.exists("services/extra/spec.md")).toBe(true);
      expect(p.exists("services/payments/extra")).toBe(false);
      // The text form owes the person the same fact.
      const again = await runLoam(p.workDir, "seed");
      expect(again.stdout).toContain("services/extra/ already exists");
    } finally {
      await p.destroy();
    }
  });

  it("a fleet.yaml name colliding with an existing directory of another kind refuses", async () => {
    const p = await makeProject({
      ...EMPTY_REPO,
      "architecture/landscape.likec4": scaffoldLandscape(),
      "services/payments/subsystem.yaml": "",
    });
    try {
      // 'payments' exists as a subsystem; declaring it as a SERVICE would
      // claim the same name in the flat namespace with a different kind.
      await writeFleet(p, "services:\n  - payments\n");
      const { message } = await refusedSeed(p, "seed-file-invalid");
      expect(message).toContain("existing subsystem directory");
    } finally {
      await p.destroy();
    }
  });
});

describe("element-id sanitizing and the views tripwire", () => {
  it("dot, hyphen and digit-initial ids all seed, deterministically suffixed, and the landscape stays matched", async () => {
    const p = await makeProject({ ...EMPTY_REPO, "architecture/landscape.likec4": scaffoldLandscape() });
    try {
      await writeFleet(p, "services:\n  - payment-service\n  - payment.service\n  - 9lives\n");
      const run = await runLoam(p.workDir, "seed", "--json");
      expect(run.code).toBe(0);
      const landscape = await p.read("architecture/landscape.likec4");
      expect(landscape).toContain("svc_payment_service = softwareSystem 'payment-service'");
      expect(landscape).toContain("svc_payment_service_2 = softwareSystem 'payment.service'");
      expect(landscape).toContain("svc_9lives = softwareSystem '9lives'");

      const validate = await runLoam(p.workDir, "validate", "--all", "--json");
      const report = JSON.parse(validate.stdout) as { targets: Target[] };
      const fleetTarget = report.targets.find((t) => t.kind === "landscape")!;
      expect(fleetTarget.findings.map((f) => f.code)).toEqual(["landscape.matched"]);
    } finally {
      await p.destroy();
    }
  });

  it("seeds services whose ids are LikeC4 keywords — the id prefix is what makes that safe", async () => {
    // `notes`, `view`, `metadata`, `description`, `link` and some thirty more
    // are LikeC4 keywords. Emitted bare in element-id position they do not
    // parse, and the self-check would then refuse `internal` — loam blaming
    // itself for a fleet whose only sin is a service called `notes`. The
    // `svc_`/`ext_` prefix is provably keyword-proof: no keyword holds a `_`.
    const p = await makeProject({ ...EMPTY_REPO });
    try {
      await writeFleet(
        p,
        "services:\n  - notes\n  - view\n  - metadata\n  - description\nexternals:\n  - link\ncalls:\n  - notes -> link\n",
      );
      const run = await runLoam(p.workDir, "seed", "--json");
      expect(run.code, run.stdout).toBe(0);
      const landscape = await p.read("architecture/landscape.likec4");
      expect(landscape).toContain("svc_notes = softwareSystem 'notes'");
      expect(landscape).toContain("ext_link = softwareSystem 'link'");
      expect(landscape).toContain("svc_notes -> ext_link");

      // Through the real validator, because "it parsed" is the whole claim.
      const validate = await runLoam(p.workDir, "validate", "--all", "--json");
      const report = JSON.parse(validate.stdout) as { targets: Target[] };
      const landscapeTarget = report.targets.find((t) => t.kind === "landscape")!;
      expect(landscapeTarget.findings.map((f) => f.code)).toEqual(["landscape.matched"]);
    } finally {
      await p.destroy();
    }
  });

  it("the seeded views block is byte-identical to the scaffold stub's — the drift tripwire", () => {
    // BYTE-identical, not just the view names. A names-only compare passed
    // happily while one copy's `view platform` predicate was corrected and the
    // other kept the broken spelling — every seeded fleet map would render the
    // old one, and the gate would stay green. Comments count: they are the
    // advice that explains the predicate, and they drift the same way.
    const id = parseServiceId("checkout", "test fixture");
    if (!id.ok) throw new Error(id.problem);
    const body = renderLandscape({
      services: [{ id: id.id, subsystem: null }],
      subsystems: [],
      externals: [],
      calls: [],
    });
    const viewsBlock = (text: string): string => {
      const start = text.indexOf("views {");
      expect(start, "no views block to compare — the tripwire must not pass vacuously").toBeGreaterThanOrEqual(0);
      return text.slice(start).trimEnd();
    };
    expect(viewsBlock(body)).toBe(viewsBlock(scaffoldLandscape()));
    expect(viewsBlock(body)).toContain("view platform");
  });
});

describe("a Windows checkout: line endings are not hand edits", () => {
  // `core.autocrlf` is Git for Windows' installer default and the docs repo
  // ships no `.gitattributes`, so an ordinary clone rewrites every line of
  // both files below and changes not one fact in them. When seed read that as
  // hand-authored, `loam status` told the reader to run seed and seed refused
  // on the grounds status had just denied — and after the first success, a
  // re-clone made seed refuse to regenerate its own output.
  const crlf = (text: string): string => text.replace(/\n/g, "\r\n");

  it("recognises a CRLF-rewritten scaffold stub as the untouched stub", async () => {
    const p = await makeProject({ ...EMPTY_REPO, "architecture/landscape.likec4": crlf(scaffoldLandscape()) });
    try {
      await writeFleet(p, FLEET);
      const run = await runLoam(p.workDir, "seed", "--json");
      expect(run.code, run.stdout).toBe(0);
      expect(JSON.parse(run.stdout).landscape).toBe("replaced-stub");
    } finally {
      await p.destroy();
    }
  });

  it("regenerates a seeded landscape a CRLF checkout rewrote, and says so", async () => {
    const p = await makeProject({ ...EMPTY_REPO });
    try {
      await writeFleet(p, FLEET);
      expect((await runLoam(p.workDir, "seed", "--json")).code).toBe(0);
      const seeded = await p.read("architecture/landscape.likec4");
      await p.write("architecture/landscape.likec4", crlf(seeded));

      const rerun = await runLoam(p.workDir, "seed", "--json");
      expect(rerun.code, rerun.stdout).toBe(0);
      expect(JSON.parse(rerun.stdout).landscape).toBe("regenerated");
      // Regenerated back to the bytes seed writes — LF, and identical.
      expect(await p.read("architecture/landscape.likec4")).toBe(seeded);
    } finally {
      await p.destroy();
    }
  });

  it("still refuses a real edit made on a CRLF checkout — normalising endings is not normalising content", async () => {
    const p = await makeProject({ ...EMPTY_REPO });
    try {
      await writeFleet(p, FLEET);
      expect((await runLoam(p.workDir, "seed", "--json")).code).toBe(0);
      const seeded = await p.read("architecture/landscape.likec4");
      await p.write("architecture/landscape.likec4", crlf(seeded).replace("softwareSystem", "softwareSYSTEM"));
      const { message } = await refusedSeed(p, "seed-landscape-edited");
      expect(message).toContain("hand-edited");
    } finally {
      await p.destroy();
    }
  });
});

describe("the generated views file, including its absence", () => {
  it("removes a leftover subsystems.likec4 when the seeded tree has no subsystems", async () => {
    // renderSubsystemViews' contract is that a subsystem-less tree owes NO
    // views file, and validate grades a leftover `subsystem.views-stale`. Seed
    // exiting 0 and then sending the caller to `loam validate --all` — its own
    // next command — over a file it had in hand is the failure this pins.
    const p = await makeProject({
      ...EMPTY_REPO,
      "architecture/landscape.likec4": scaffoldLandscape(),
      "architecture/subsystems.likec4": "// stale leftover\nviews {\n}\n",
    });
    try {
      await writeFleet(p, "services:\n  - checkout\n");
      const run = await runLoam(p.workDir, "seed", "--json");
      expect(run.code, run.stdout).toBe(0);
      const payload = JSON.parse(run.stdout);
      expect(payload.removed).toEqual(["architecture/subsystems.likec4"]);
      expect(p.exists("architecture/subsystems.likec4")).toBe(false);

      const validate = await runLoam(p.workDir, "validate", "--all", "--json");
      const report = JSON.parse(validate.stdout) as { targets: Target[] };
      expect(report.targets.flatMap((t) => t.findings).map((f) => f.code)).not.toContain(
        "subsystem.views-stale",
      );
    } finally {
      await p.destroy();
    }
  });

  it("gives a git-invisible service directory the .gitkeep that keeps it across a clone", async () => {
    // An empty services/<id>/ is a service to the walk and nothing at all to
    // git — the tree seed's own pre-journal crash window leaves behind. Without
    // the keep, seed writes a landscape declaring a service the next clone does
    // not have, and reports success.
    const p = await makeProject({ ...EMPTY_REPO, "architecture/landscape.likec4": scaffoldLandscape() });
    try {
      await mkdir(join(p.docsDir, "services", "billing"), { recursive: true });
      await writeFleet(p, "services:\n  - billing\n  - checkout\n");
      const run = await runLoam(p.workDir, "seed", "--json");
      expect(run.code, run.stdout).toBe(0);
      expect(JSON.parse(run.stdout).services).toEqual({ created: ["checkout"], existing: ["billing"] });
      expect(p.exists("services/billing/.gitkeep")).toBe(true);
    } finally {
      await p.destroy();
    }
  });
});

describe("a refusal must not send the caller into the next refusal", () => {
  it("calls a name the tree holds as a service and the file as an external a collision, not a missing service", async () => {
    // Both facts are true at once. The missing-service arm used to win and say
    // "add stripe to services:, exactly as spelled" — which earns
    // seed-duplicate-service on the very next run, because the file already
    // declares stripe as an external.
    const p = await makeProject({
      ...EMPTY_REPO,
      "architecture/landscape.likec4": scaffoldLandscape(),
      "services/stripe/spec.md": "# stripe\n",
    });
    try {
      await writeFleet(p, "services:\n  - checkout\nexternals:\n  - stripe\n");
      const { message } = await refusedSeed(p, "seed-file-invalid");
      expect(message).toContain("external 'stripe' is an existing service directory");
      expect(message).not.toContain("exactly as spelled");
    } finally {
      await p.destroy();
    }
  });

  it("says rename-the-directory for an existing directory whose name is not a legal id", async () => {
    // "Add it to services:, exactly as spelled" cannot be followed — the fleet
    // file refuses that entry. Seed was simply unusable on such a repo and
    // never said why.
    const p = await makeProject({
      ...EMPTY_REPO,
      "architecture/landscape.likec4": scaffoldLandscape(),
      "services/My Service/spec.md": "# my service\n",
    });
    try {
      await writeFleet(p, "services:\n  - checkout\n");
      const { message } = await refusedSeed(p, "seed-file-invalid");
      expect(message).toContain("My Service");
      expect(message).toContain("not a legal service id");
      expect(message).toContain("rename");
    } finally {
      await p.destroy();
    }
  });
});

describe("the transaction posture", () => {
  it("refuses commit-interrupted over a predecessor's unreadable journal", async () => {
    const p = await makeProject({ ...EMPTY_REPO, "architecture/landscape.likec4": scaffoldLandscape() });
    try {
      await writeFleet(p, FLEET);
      await p.write(".loam-commit", "not a journal");
      const run = await runLoam(p.workDir, "seed", "--json");
      expect(run.code).toBe(1);
      expect(JSON.parse(run.stdout).error.code).toBe("commit-interrupted");
      expect(p.exists("services/billing")).toBe(false);
    } finally {
      await p.destroy();
    }
  });
});
