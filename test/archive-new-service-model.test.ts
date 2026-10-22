/**
 * A service a feature introduces gets its model from the archive that creates
 * it — empty, extending the map, and holding whatever the delta drew inside the
 * service — instead of landing as a directory with no model and a map box
 * carrying the service's interior.
 *
 * Measured on a real fleet (2026-10), rebuilt here on neutral shapes and on the
 * shipped example: without a model the archive had nowhere to route the new
 * service's containers, so they rode onto the map, and the fleet's next
 * `validate --all` was red (`service.no-model`) over an archive that exited 0.
 * A team that pre-placed an empty extending model got the right result; the
 * archive now does that itself. It does NOT pick a subsystem: the map's group
 * nesting is not a placement the tree may read (SCHEMA.md, "Subsystems"), so the
 * service lands unfiled and the output names the move that files it.
 */
import { describe, expect, it } from "vitest";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadSource } from "../src/core/c4/likec4.js";
import { coherentFixture, FEATURE_DELTA, FEATURE_SPEC, LANDSCAPE, makeProject, makeTmpDir, runLoam } from "./helpers/harness.js";

const EXAMPLES = fileURLToPath(new URL("../examples/docs", import.meta.url));
const NEW_MODEL = "services/payment-split-service/model.likec4";
const FEAT101 = "features/FEAT-101-payment-splitting";

interface Finding {
  code: string;
  severity: string;
  message: string;
}

async function findings(dir: string, ...args: string[]): Promise<Finding[]> {
  const run = await runLoam(dir, "validate", ...args, "--json");
  return (JSON.parse(run.stdout) as { targets: Array<{ findings: Finding[] }> }).targets.flatMap((t) => t.findings);
}

/** A copy of the shipped example fleet, optionally edited, removed when `done` runs. */
async function example(): Promise<{ dir: string; read: (rel: string) => Promise<string>; done: () => Promise<void> }> {
  const root = await makeTmpDir("loam-new-model-");
  const dir = join(root, "fleet");
  await cp(EXAMPLES, dir, { recursive: true });
  return {
    dir,
    read: async (rel) => (await readFile(join(dir, rel), "utf8")).replace(/\r\n/g, "\n"),
    done: () => rm(root, { recursive: true, force: true }),
  };
}

describe("a feature whose delta draws nothing inside its new service", () => {
  it("archives the service with an empty extending model, and adds no error to the fleet gate", async () => {
    const p = await makeProject(coherentFixture());
    try {
      // The fixture carries no generated views file, so the gate is red before
      // anything is archived; what the archive owes is not to add to it.
      const errorsBefore = (await findings(p.workDir, "--all")).filter((f) => f.severity === "error").map((f) => f.code);
      const dry = JSON.parse((await runLoam(p.workDir, "archive", "FEAT-1", "--dry-run", "--json")).stdout) as {
        ok: boolean;
        warnings: Finding[];
        plan: Array<{ path: string; action: string }>;
      };
      expect(dry.ok).toBe(true);
      expect(dry.warnings.map((w) => w.code)).not.toContain("service.no-model");
      expect(dry.plan).toContainEqual(expect.objectContaining({ path: NEW_MODEL, action: "create" }));

      const res = await runLoam(p.workDir, "archive", "FEAT-1");
      expect(res.code).toBe(0);
      expect(res.out).toContain(`created ${NEW_MODEL} — empty`);
      const model = await p.read(NEW_MODEL);
      expect(model).toContain("`loam archive FEAT-1` created it with the service");
      expect(model.endsWith("model {\n}\n")).toBe(true);
      // A flat tree: every service is unfiled there, and that is never news.
      expect(res.out).not.toContain("loam subsystem move");

      const after = await findings(p.workDir, "--all");
      expect(after.filter((f) => f.severity === "error").map((f) => f.code)).toEqual(errorsBefore);
      expect(after.find((f) => f.code === "c4.valid" && f.message.startsWith("payment-split-service:"))).toBeDefined();
    } finally {
      await p.destroy();
    }
  });

  it("leaves a service with a model of its own alone", async () => {
    // A pre-placed model makes the service enumerated: not created, not written.
    const authored = "model {\n  // drawn by the team before the archive\n}\n";
    const p = await makeProject({ ...coherentFixture(), [NEW_MODEL]: authored });
    try {
      expect((await runLoam(p.workDir, "archive", "FEAT-1")).code).toBe(0);
      expect(await p.read(NEW_MODEL)).toBe(authored);
    } finally {
      await p.destroy();
    }
  });
});

describe("a model goes to a service the merged map draws, and nowhere else", () => {
  const LEDGER_SPEC = FEATURE_SPEC.replace("# payment-split-service — delta for FEAT-1", "# ledger-service — delta for FEAT-1").replace(
    "Operations: createSplit\n\n",
    "",
  );

  it("not to a service the delta only quotes, which the merge lands nowhere", async () => {
    // A quoted element the map lacks is merged nowhere: a model for it would
    // extend nothing (review, 2026-10-22: two landscape.service-unmodelled).
    const files = coherentFixture();
    files["features/FEAT-1-split/delta.likec4"] = FEATURE_DELTA.replace(
      "  paymentService = softwareSystem 'payment-service'\n",
      "  paymentService = softwareSystem 'payment-service'\n  ledger = softwareSystem 'ledger-service'\n",
    );
    files["features/FEAT-1-split/specs/ledger-service/spec.md"] = LEDGER_SPEC;
    const p = await makeProject(files);
    try {
      const res = await runLoam(p.workDir, "archive", "FEAT-1", "--approve", "--json");
      expect(res.code, res.stdout).toBe(0);
      expect(p.exists("services/ledger-service/spec.md")).toBe(true);
      expect(p.exists("services/ledger-service/model.likec4")).toBe(false);
      expect(p.exists(NEW_MODEL), "the tagged service still gets its own").toBe(true);
      const warnings = (JSON.parse(res.stdout) as { warnings: Array<{ code: string; subject?: string; message: string }> }).warnings;
      expect(warnings.find((w) => w.code === "service.no-model" && w.subject === "ledger-service")?.message).toContain(
        "this archive creates services/ledger-service/",
      );
    } finally {
      await p.destroy();
    }
  });

  it("to a service the living map already draws, though the delta never names it", async () => {
    const files = coherentFixture();
    files["architecture/landscape.likec4"] = LANDSCAPE.replace(
      "  customer -> checkoutWeb 'Uses'\n",
      "  ledger = softwareSystem 'ledger-service'\n\n  customer -> checkoutWeb 'Uses'\n",
    );
    files["features/FEAT-1-split/specs/ledger-service/spec.md"] = LEDGER_SPEC;
    const p = await makeProject(files);
    try {
      const res = await runLoam(p.workDir, "archive", "FEAT-1", "--approve", "--json");
      expect(res.code, res.stdout).toBe(0);
      expect(p.exists("services/ledger-service/model.likec4")).toBe(true);
      expect((JSON.parse(res.stdout) as { warnings: Array<{ code: string }> }).warnings.map((w) => w.code)).not.toContain("service.no-model");
    } finally {
      await p.destroy();
    }
  });

  it("and a requirement delta that creates nothing claims no directory", async () => {
    // A REMOVED-only delta for a service nobody has: the spec merge writes
    // nothing, so there is no directory to say "this archive creates".
    const files = coherentFixture();
    files["features/FEAT-1-split/specs/void-service/spec.md"] = "# void-service delta\n\n## REMOVED Requirements\n\n### Requirement: Old thing\n";
    const p = await makeProject(files);
    try {
      const res = await runLoam(p.workDir, "archive", "FEAT-1", "--approve", "--json");
      expect(res.code, res.stdout).toBe(0);
      expect(p.exists("services/void-service")).toBe(false);
      const subjects = (JSON.parse(res.stdout) as { warnings: Array<{ code: string; subject?: string }> }).warnings
        .filter((w) => w.code === "service.no-model")
        .map((w) => w.subject);
      expect(subjects).not.toContain("void-service");
    } finally {
      await p.destroy();
    }
  });
});

describe("the shipped example: FEAT-101 introduces payment-split-service with an `api` container", () => {
  it("routes the container into the new model, keeps the map free of it, and names the move that files the service", async () => {
    const f = await example();
    try {
      const res = await runLoam(f.dir, "archive", "FEAT-101");
      expect(res.code).toBe(0);
      expect(res.out).toContain(`architecture: created ${NEW_MODEL} — +1 element(s), +0 relationship(s)`);
      expect(res.out).toContain("loam subsystem move payment-split-service --into <subsystem>");

      const model = await f.read(NEW_MODEL);
      expect(model).toContain("  extend marketplace.paymentSplitService {\n    api = container 'api' {\n      technology 'Spring Boot'\n    }\n  }\n");
      const map = await f.read("architecture/landscape.likec4");
      expect(map).toContain("paymentSplitService = softwareSystem 'payment-split-service'");
      expect(map).not.toContain("api = container 'api'");
      expect((await loadSource(map)).errors).toEqual([]);

      // The archive's own views file follows; then the fleet it left is clean.
      expect((await runLoam(f.dir, "subsystem", "sync")).code).toBe(0);
      const all = await findings(f.dir, "--all");
      expect(all.filter((x) => x.severity === "error"), JSON.stringify(all.filter((x) => x.severity === "error"))).toEqual([]);
      expect(all.find((x) => x.code === "c4.valid" && x.message.startsWith("payment-split-service:"))).toBeDefined();

      // A create, so the snapshot undoes it by deleting.
      expect((await runLoam(f.dir, "unarchive", "FEAT-101")).code).toBe(0);
      expect(existsSync(join(f.dir, NEW_MODEL))).toBe(false);
    } finally {
      await f.done();
    }
  });

  it("the feature gate previews the same routing: a flow hop into the new container is refused before the archive", async () => {
    // Graded against a map that still held `api`, the hop resolved, the gate
    // passed, and the archive copied a flow naming a container the map no
    // longer holds into architecture/usecases/.
    const f = await example();
    try {
      await mkdir(join(f.dir, FEAT101, "usecases"), { recursive: true });
      await writeFile(
        join(f.dir, FEAT101, "usecases", "split.likec4"),
        "views {\n  dynamic view split {\n    #cap-order-notifications\n    marketplace.checkoutWeb -> marketplace.paymentSplitService.api 'Splits the payment'\n  }\n}\n",
        "utf8",
      );
      const all = await findings(f.dir, "--feature", "FEAT-101");
      expect(all.map((x) => x.code)).toContain("usecase.flow-invalid");
    } finally {
      await f.done();
    }
  });
});
