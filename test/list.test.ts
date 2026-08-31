/**
 * Deep invariant tests for `loam list` (src/commands/list.ts).
 *
 * `list` is the first read command: on a 100+ service fleet it answers "what is
 * in this docs repo" and "what is missing" without opening a single file. It is
 * also the first command with a --json contract, so its shape is pinned here.
 *
 * Families:
 *  - text output: sections, counts, artifact flags, ordering
 *  - filtering: services-only / features-only / archived
 *  - verification column: -, recorded (confirmed/claims), attested, stale, frozen when archived
 *  - --json: envelope, field shape, repo-relative paths, ordering
 *  - failure modes: no config, empty repo
 */
import { describe, expect, it } from "vitest";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  coherentFixture,
  FEATURE_SPEC,
  makeProject,
  makeTmpDir,
  runLoam,
  type Project,
} from "./helpers/harness.js";
import { LOAM_VERSION } from "../src/core/envelope/version.js";

async function withProject(
  files: Record<string, string>,
  fn: (p: Project) => Promise<void>,
): Promise<void> {
  const p = await makeProject(files);
  try {
    await fn(p);
  } finally {
    await p.destroy();
  }
}

/** A repo with two services of differing completeness and three features. */
function fleetFixture(): Record<string, string> {
  return {
    "services/payment-service/model.likec4": "model {}\n",
    "services/payment-service/spec.md": "# payment-service\n",
    "services/payment-service/openapi.yaml": "openapi: 3.1.0\n",
    "services/payment-service/runbook.md": "# runbook\n",
    "services/payment-service/health.yaml": "slo: {}\n",
    "services/payment-service/adrs/0001-outbox.md": "# adr\n",
    "services/checkout-web/spec.md": "# checkout-web\n",
    "features/FEAT-2-refunds/intent.md": "# refunds\n",
    "features/FEAT-10-splitting/intent.md": "# splitting\n",
    "features/FEAT-10-splitting/delta.likec4": "model {}\n",
    "features/FEAT-10-splitting/specs/payment-service/spec.md": "# delta\n",
    "features/archive/FEAT-1-old/intent.md": "# old\n",
  };
}

describe("text output", () => {
  it("lists both sections with counts", async () => {
    await withProject(fleetFixture(), async (p) => {
      const res = await runLoam(p.workDir, "list");
      expect(res.code).toBe(0);
      expect(res.out).toContain("services (2)");
      expect(res.out).toContain("features (2 active)");
      expect(res.out).toContain("payment-service");
      expect(res.out).toContain("checkout-web");
      expect(res.out).toContain("FEAT-2");
      expect(res.out).toContain("FEAT-10");
    });
  });

  it("flags present artifacts and dashes the missing ones", async () => {
    await withProject(fleetFixture(), async (p) => {
      const res = await runLoam(p.workDir, "list", "services");
      const full = res.out.split("\n").find((l) => l.includes("payment-service"))!;
      const bare = res.out.split("\n").find((l) => l.includes("checkout-web"))!;
      // arch.spec.md sits between spec and api, lowercase because it is optional;
      // the async contract follows the API for the same reason, in the same case
      expect(full).toContain("M S - A - R H");
      expect(bare).toContain("- S - - - - -");
    });
  });

  it("shows the ADR count only for services that have ADRs", async () => {
    await withProject(fleetFixture(), async (p) => {
      const res = await runLoam(p.workDir, "list", "services");
      expect(res.out.split("\n").find((l) => l.includes("payment-service"))).toContain("1 adr");
      expect(res.out.split("\n").find((l) => l.includes("checkout-web"))).not.toContain("adr");
    });
  });

  it("marks which features have an intent and a delta, and which services they touch", async () => {
    await withProject(fleetFixture(), async (p) => {
      const res = await runLoam(p.workDir, "list", "features");
      const withDelta = res.out.split("\n").find((l) => l.includes("FEAT-10"))!;
      const without = res.out.split("\n").find((l) => l.includes("FEAT-2"))!;
      expect(withDelta).toContain("I D");
      expect(withDelta).toContain("payment-service");
      expect(without).toContain("I -");
    });
  });

  it("orders features numerically: FEAT-2 before FEAT-10", async () => {
    await withProject(fleetFixture(), async (p) => {
      const res = await runLoam(p.workDir, "list", "features");
      expect(res.out.indexOf("FEAT-2")).toBeLessThan(res.out.indexOf("FEAT-10"));
    });
  });

  it("hides archived features unless --archived is passed", async () => {
    await withProject(fleetFixture(), async (p) => {
      const plain = await runLoam(p.workDir, "list", "features");
      expect(plain.out).not.toContain("FEAT-1 ");
      expect(plain.out).not.toContain("archived");

      const withArchive = await runLoam(p.workDir, "list", "features", "--archived");
      expect(withArchive.out).toContain("FEAT-1");
      expect(withArchive.out).toContain("archived");
    });
  });

  it("narrows to one section when asked", async () => {
    await withProject(fleetFixture(), async (p) => {
      const svcs = await runLoam(p.workDir, "list", "services");
      expect(svcs.out).toContain("services (2)");
      expect(svcs.out).not.toContain("features (");

      const feats = await runLoam(p.workDir, "list", "features");
      expect(feats.out).toContain("features (2 active)");
      expect(feats.out).not.toContain("services (");
    });
  });

  it("says so plainly when a section is empty", async () => {
    // A REAL docs repo whose services/ is empty — the one way "0 services" is
    // reachable now that a missing services/ is a refusal, not a green zero.
    await withProject({ "services/.keep": "" }, async (p) => {
      const res = await runLoam(p.workDir, "list");
      expect(res.code).toBe(0);
      expect(res.out).toContain("services (0)");
      expect(res.out).toContain("features (0 active)");
    });
  });

  it("rejects an unknown section instead of silently listing everything", async () => {
    await withProject(fleetFixture(), async (p) => {
      const res = await runLoam(p.workDir, "list", "widgets");
      expect(res.code).toBe(1);
      expect(res.out).toContain("widgets");
    });
  });

  it("reports the unknown section as `invalid-option` — same code as every bad value", async () => {
    await withProject(fleetFixture(), async (p) => {
      const res = await runLoam(p.workDir, "list", "widgets", "--json");
      expect(res.code).toBe(1);
      expect(JSON.parse(res.stdout)).toMatchObject({ ok: false, error: { code: "invalid-option" } });
    });
  });
});

describe("verification column", () => {
  /**
   * Record FEAT-1's checklist the way an agent would: derive it via `verify
   * --json`, answer every claim (the first `unconfirm` of them honestly no),
   * and record the answers. coherentFixture's FEAT-1 derives 4 claims.
   */
  async function recordFeat1(p: Project, unconfirm = 0): Promise<void> {
    const derived = await runLoam(p.workDir, "verify", "FEAT-1", "--json");
    expect(derived.code, derived.out).toBe(0);
    const claims: { id: string }[] = JSON.parse(derived.stdout).claims;
    const answers = claims.map((c, i) =>
      i < unconfirm
        ? { id: c.id, verdict: "unconfirmed", evidence: [], note: "not yet" }
        : { id: c.id, verdict: "confirmed", evidence: ["src/split/Service.ts:12"] },
    );
    await writeFile(join(p.workDir, "answers.json"), JSON.stringify(answers, null, 2), "utf8");
    const rec = await runLoam(p.workDir, "verify", "FEAT-1", "--record", "answers.json");
    expect(rec.code, rec.out).toBe(0);
  }

  const featureRow = (out: string, id: string): string =>
    out.split("\n").find((l) => l.includes(id))!;

  it("shows '-' and verification: null for a feature nobody has recorded", async () => {
    await withProject(fleetFixture(), async (p) => {
      const res = await runLoam(p.workDir, "list", "features");
      expect(featureRow(res.out, "FEAT-10")).toMatch(/FEAT-10\s+-\s+payment-service/);

      const json = JSON.parse((await runLoam(p.workDir, "list", "features", "--json")).stdout);
      for (const f of json.features) expect(f.verification).toBeNull();
    });
  });

  it("shows confirmed/claims for a record that answers the current checklist", async () => {
    await withProject(coherentFixture(), async (p) => {
      await recordFeat1(p, 1);
      const res = await runLoam(p.workDir, "list", "features");
      expect(featureRow(res.out, "FEAT-1")).toContain("3/4");
      expect(res.out).not.toContain("stale");

      const json = JSON.parse((await runLoam(p.workDir, "list", "features", "--json")).stdout);
      const feat = json.features.find((f: { id: string }) => f.id === "FEAT-1");
      expect(feat.verification).toEqual({
        state: "recorded",
        // One claim is unconfirmed, so the record is short of every verdict —
        // the scenario claim on the agent's word does not change that.
        verdict: "unverified",
        recorded: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        confirmed: 3,
        claims: 4,
        attested: 1,
        // Who answered the CONFIRMED three, by their own `answered_by`. Three
        // agent answers, because nothing mechanical ran — distinct from
        // `attested` above, which asks only about the scenario claim.
        answered: { runner: 0, "external-runner": 0, agent: 3 },
      });
    });
  });

  it("shows 'stale' when the feature moved after the record was written", async () => {
    await withProject(coherentFixture(), async (p) => {
      await recordFeat1(p);
      // Rewriting a scenario body renames its claim (the ids hash the body), so
      // the record's digest no longer answers the current checklist.
      await p.write(
        "features/FEAT-1-split/specs/payment-split-service/spec.md",
        FEATURE_SPEC.replace("two shares are recorded", "three shares are recorded"),
      );
      const res = await runLoam(p.workDir, "list", "features");
      expect(featureRow(res.out, "FEAT-1")).toContain("stale");

      const json = JSON.parse((await runLoam(p.workDir, "list", "features", "--json")).stdout);
      const feat = json.features.find((f: { id: string }) => f.id === "FEAT-1");
      expect(feat.verification.state).toBe("stale");
    });
  });

  it("reports an archived feature's record as frozen history, never stale", async () => {
    await withProject(coherentFixture(), async (p) => {
      await recordFeat1(p);
      const archived = await runLoam(p.workDir, "archive", "FEAT-1");
      expect(archived.code, archived.out).toBe(0);

      // Archive merged createSplit into the living openapi, so a re-derived
      // checklist would be smaller and the digest would mismatch — the frozen
      // record must be reported by its own summary, not judged against that.
      const res = await runLoam(p.workDir, "list", "features", "--archived");
      const row = featureRow(res.out, "FEAT-1");
      expect(row).toContain("4/4");
      expect(row).toContain("(archived)");
      expect(res.out).not.toContain("stale");

      const json = JSON.parse(
        (await runLoam(p.workDir, "list", "features", "--archived", "--json")).stdout,
      );
      const feat = json.features.find((f: { id: string }) => f.id === "FEAT-1");
      expect(feat.archived).toBe(true);
      expect(feat.verification).toEqual({
        state: "recorded",
        // The record was written with --record and no --results, so its one
        // scenario claim rests on an agent's word: attested, never verified.
        verdict: "attested",
        recorded: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        confirmed: 4,
        claims: 4,
        attested: 1,
        answered: { runner: 0, "external-runner": 0, agent: 4 },
      });
    });
  });

  /**
   * The seam this closes: a complete record answered by an agent printed the
   * same `11/11` as a digest-matched green run, under a column headed
   * `verified`, while `verify --json`, `status` and the record itself all said
   * `attested`. `list --json` is how a fleet is graded, so it is the one
   * surface where the distinction most has to survive.
   */
  it("says 'attested', not a bare count, for a record confirmed on an agent's word", async () => {
    await withProject(coherentFixture(), async (p) => {
      await recordFeat1(p);
      const res = await runLoam(p.workDir, "list", "features");
      expect(featureRow(res.out, "FEAT-1")).toContain("4/4 attested");
      // and the heading no longer names the one verdict this row is not
      expect(res.out).not.toContain("[D]elta  verified");

      const json = JSON.parse((await runLoam(p.workDir, "list", "features", "--json")).stdout);
      const feat = json.features.find((f: { id: string }) => f.id === "FEAT-1");
      expect(feat.verification.verdict).toBe("attested");
      expect(feat.verification.attested).toBe(1);

      // the three surfaces agree, which is the whole point
      const verify = JSON.parse((await runLoam(p.workDir, "verify", "FEAT-1", "--json")).stdout);
      expect(verify.verdict).toBe("attested");
      expect(verify.verified).toBe(false);
      const status = JSON.parse((await runLoam(p.workDir, "status", "FEAT-1", "--json")).stdout);
      expect(status.verification.verdict).toBe("attested");
    });
  });
});

describe("maturity ladder", () => {
  /** One service per rung. Presence and provenance state only — never content. */
  function ladderFixture(): Record<string, string> {
    return {
      // empty: the directory exists (a stray untracked file creates it), no artifact does
      "services/svc-empty/notes.txt": "todo\n",
      // partial: some artifacts, not the model+spec+openapi triple
      "services/svc-partial/model.likec4": "model {}\n",
      "services/svc-partial/runbook.md": "# runbook\n",
      // documented: the triple the adopt brief marks required, no sources
      "services/svc-documented/model.likec4": "model {}\n",
      "services/svc-documented/spec.md": "# svc-documented\n",
      "services/svc-documented/openapi.yaml": "openapi: 3.1.0\n",
      // sourced: the triple + declared sources, nobody has vouched
      "services/svc-sourced/model.likec4": "model {}\n",
      "services/svc-sourced/spec.md":
        "---\nservice: svc-sourced\nstatus: draft\nsources:\n  - src/\n---\n\n# svc-sourced\n",
      "services/svc-sourced/openapi.yaml": "openapi: 3.1.0\n",
      // vouched: verified WITH the digest stamp behind it
      "services/svc-vouched/model.likec4": "model {}\n",
      "services/svc-vouched/spec.md":
        "---\nservice: svc-vouched\nstatus: verified\nsources:\n  - src/\nsources_digest: 0123456789abcdef\n---\n\n# svc-vouched\n",
      "services/svc-vouched/openapi.yaml": "openapi: 3.1.0\n",
    };
  }

  it("grades each service by artifact presence and provenance state", async () => {
    await withProject(ladderFixture(), async (p) => {
      const json = JSON.parse((await runLoam(p.workDir, "list", "services", "--json")).stdout);
      const rung = (id: string): string =>
        json.services.find((s: { id: string }) => s.id === id).maturity;
      expect(rung("svc-empty")).toBe("empty");
      expect(rung("svc-partial")).toBe("partial");
      expect(rung("svc-documented")).toBe("documented");
      expect(rung("svc-sourced")).toBe("sourced");
      expect(rung("svc-vouched")).toBe("vouched");
    });
  });

  it("rolls the fleet up as counts per rung, every rung present", async () => {
    await withProject(ladderFixture(), async (p) => {
      const json = JSON.parse((await runLoam(p.workDir, "list", "services", "--json")).stdout);
      expect(json.maturity).toEqual({ empty: 1, partial: 1, documented: 1, sourced: 1, vouched: 1 });
    });
  });

  it("a hand-written verified with no digest stays below vouched — a claim with nothing behind it", async () => {
    const files = ladderFixture();
    files["services/svc-sourced/spec.md"] =
      "---\nservice: svc-sourced\nstatus: verified\nsources:\n  - src/\n---\n\n# svc-sourced\n";
    files["services/svc-documented/spec.md"] =
      "---\nservice: svc-documented\nstatus: verified\n---\n\n# svc-documented\n";
    await withProject(files, async (p) => {
      const json = JSON.parse((await runLoam(p.workDir, "list", "services", "--json")).stdout);
      const rung = (id: string): string =>
        json.services.find((s: { id: string }) => s.id === id).maturity;
      // no digest: sources alone hold it at sourced
      expect(rung("svc-sourced")).toBe("sourced");
      // no sources at all: the status cannot lift it past documented
      expect(rung("svc-documented")).toBe("documented");
    });
  });

  it("prints the rollup as one text line next to the status line, in ladder order", async () => {
    await withProject(ladderFixture(), async (p) => {
      const res = await runLoam(p.workDir, "list", "services");
      expect(res.out).toContain(
        "maturity: 1 empty · 1 partial · 1 documented · 1 sourced · 1 vouched",
      );
    });
  });
});

describe("--json contract", () => {
  it("emits one ok-enveloped object with both collections", async () => {
    await withProject(fleetFixture(), async (p) => {
      const res = await runLoam(p.workDir, "list", "--json");
      expect(res.code).toBe(0);
      const json = JSON.parse(res.stdout);
      expect(json.ok).toBe(true);
      expect(json.docsDir).toBe(p.docsDir);
      expect(Array.isArray(json.services)).toBe(true);
      expect(Array.isArray(json.features)).toBe(true);
    });
  });

  it("describes a service by id, repo-relative path, artifacts and adr count", async () => {
    await withProject(fleetFixture(), async (p) => {
      const json = JSON.parse((await runLoam(p.workDir, "list", "--json")).stdout);
      const svc = json.services.find((s: { id: string }) => s.id === "payment-service");
      expect(svc).toEqual({
        id: "payment-service",
        path: "services/payment-service",
        has: {
          model: true,
          spec: true,
          archSpec: false,
          openapi: true,
          asyncapi: false,
          runbook: true,
          health: true,
        },
        adrs: 1,
        status: null,
        subsystem: [],
        // every artifact, no sources: presence says documented, nothing more
        maturity: "documented",
        missing: ["sources: in the spec.md frontmatter"],
        apiExpected: true,
      });
    });
  });

  it("describes a feature by id, directory, touched services and artifacts", async () => {
    await withProject(fleetFixture(), async (p) => {
      const json = JSON.parse((await runLoam(p.workDir, "list", "--json")).stdout);
      const feat = json.features.find((f: { id: string }) => f.id === "FEAT-10");
      expect(feat).toEqual({
        id: "FEAT-10",
        dirName: "FEAT-10-splitting",
        path: "features/FEAT-10-splitting",
        archived: false,
        services: ["payment-service"],
        has: { intent: true, delta: true },
        verification: null,
      });
    });
  });

  it("keeps paths repo-relative so the output is diffable across machines", async () => {
    await withProject(fleetFixture(), async (p) => {
      const json = JSON.parse((await runLoam(p.workDir, "list", "--json")).stdout);
      for (const s of json.services) expect(s.path.startsWith("services/")).toBe(true);
      for (const f of json.features) expect(f.path.startsWith("features/")).toBe(true);
    });
  });

  it("carries the same ordering as the text output", async () => {
    await withProject(fleetFixture(), async (p) => {
      const json = JSON.parse((await runLoam(p.workDir, "list", "--json")).stdout);
      expect(json.features.map((f: { id: string }) => f.id)).toEqual(["FEAT-2", "FEAT-10"]);
      expect(json.services.map((s: { id: string }) => s.id)).toEqual([
        "checkout-web",
        "payment-service",
      ]);
    });
  });

  it("includes archived features only with --archived, flagged", async () => {
    await withProject(fleetFixture(), async (p) => {
      const plain = JSON.parse((await runLoam(p.workDir, "list", "--json")).stdout);
      expect(plain.features.map((f: { id: string }) => f.id)).not.toContain("FEAT-1");

      const withArchive = JSON.parse(
        (await runLoam(p.workDir, "list", "--json", "--archived")).stdout,
      );
      const archived = withArchive.features.find((f: { id: string }) => f.id === "FEAT-1");
      expect(archived.archived).toBe(true);
      expect(archived.path).toBe("features/archive/FEAT-1-old");
    });
  });

  it("omits the section that was filtered out, and maturity travels with services", async () => {
    await withProject(fleetFixture(), async (p) => {
      const json = JSON.parse((await runLoam(p.workDir, "list", "services", "--json")).stdout);
      expect(json.services).toBeDefined();
      expect(json.maturity).toBeDefined();
      expect(json.features).toBeUndefined();

      const feats = JSON.parse((await runLoam(p.workDir, "list", "features", "--json")).stdout);
      expect(feats.maturity).toBeUndefined();
    });
  });

  it("reports failure inside the envelope, not as loose text, and still exits 1", async () => {
    const bare = await makeTmpDir();
    const res = await runLoam(bare, "list", "--json");
    expect(res.code).toBe(1);
    const json = JSON.parse(res.stdout);
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe("no-config");
    expect(json.error.message).toContain("loam init");
  });

  it("emits valid JSON even for an empty docs repo", async () => {
    await withProject({ "services/.keep": "" }, async (p) => {
      const json = JSON.parse((await runLoam(p.workDir, "list", "--json")).stdout);
      expect(json).toEqual({
        contractVersion: "1.0",
        // From the constant, never a literal: a hardcoded version here is a
        // test that goes red on every release and green again once somebody
        // edits it, which is the opposite of pinning anything.
        version: LOAM_VERSION,
        ok: true,
        command: "list",
        docsDir: p.docsDir,
        // A docs repo with no `architecture/adrs/` reports 0, never omission:
        // the key is unconditional so a consumer never has to tell "no fleet
        // decisions" from "an older loam that did not count them".
        fleetAdrs: 0,
        services: [],
        maturity: { empty: 0, partial: 0, documented: 0, sourced: 0, vouched: 0 },
        subsystems: [],
        unfiledServices: 0,
        features: [],
      });
    });
  });
});

describe("failure modes", () => {
  it("without loam.json points at `loam init` and exits 1", async () => {
    const bare = await makeTmpDir();
    const res = await runLoam(bare, "list");
    expect(res.code).toBe(1);
    expect(res.out).toContain("loam init");
  });

  it("works on the canonical coherent fixture", async () => {
    await withProject(coherentFixture(), async (p) => {
      const res = await runLoam(p.workDir, "list");
      expect(res.code).toBe(0);
      expect(res.out).toContain("payment-service");
      expect(res.out).toContain("FEAT-1");
    });
  });
});

describe("the subsystem tree in list — additive keys, wave 3 of the tree item", () => {
  /** fleetFixture with payment-service filed into a marked group; checkout-web stays unfiled. */
  function filedFleet(): Record<string, string> {
    const files: Record<string, string> = {};
    for (const [path, content] of Object.entries(fleetFixture())) {
      files[path.replace(/^services\/payment-service\//, "services/payments/payment-service/")] = content;
    }
    files["services/payments/subsystem.yaml"] = "title: Payments\n";
    return files;
  }

  it("--json gains services[].subsystem, subsystems[] and unfiledServices — and nothing else moves", async () => {
    await withProject(filedFleet(), async (p) => {
      const json = JSON.parse((await runLoam(p.workDir, "list", "--json")).stdout);
      const filed = json.services.find((s: { id: string }) => s.id === "payment-service");
      expect(filed.subsystem).toEqual(["payments"]);
      expect(filed.path).toBe("services/payments/payment-service");
      const unfiled = json.services.find((s: { id: string }) => s.id === "checkout-web");
      expect(unfiled.subsystem).toEqual([]);
      expect(json.subsystems).toEqual([
        { name: "payments", path: "services/payments", title: "Payments", memberCount: 1 },
      ]);
      expect(json.unfiledServices).toBe(1);
    });
  });

  it("service ordering stays compareIds-global regardless of placement — the --json ordering contract", async () => {
    await withProject(filedFleet(), async (p) => {
      const json = JSON.parse((await runLoam(p.workDir, "list", "--json")).stdout);
      expect(json.services.map((s: { id: string }) => s.id)).toEqual([
        "checkout-web",
        "payment-service",
      ]);
    });
  });

  it("text gains the unfiled count line — and only once a tree exists", async () => {
    await withProject(filedFleet(), async (p) => {
      const res = await runLoam(p.workDir, "list", "services");
      expect(res.code).toBe(0);
      expect(res.out).toContain("subsystems: 1 · unfiled: 1");
    });
    // A flat fleet says nothing: unfiled is the permanent normal state, and a
    // count over a fleet nobody groups would read as work.
    await withProject(fleetFixture(), async (p) => {
      const res = await runLoam(p.workDir, "list", "services");
      expect(res.out).not.toContain("unfiled");
    });
  });
});
