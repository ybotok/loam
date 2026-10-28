/**
 * `loam archive` lands the generated views files in its own commit.
 *
 * Reproduced on the QUICKSTART walk (2026-10-28): a docs repo with one service,
 * a feature that adds a second service and an edge, a clean `loam archive` at
 * exit 0 — and `loam validate --all` red with `subsystem.views-stale` until a
 * `loam subsystem sync` that neither QUICKSTART nor the adopt brief mentions.
 * Archive printed a ⚠ and left the gate red. Both files are a pure function of
 * the tree and the map, and the archive is the writer that just changed both,
 * so it now renders them from its own planned bytes and swaps them in with
 * everything else (`src/commands/archive/views.ts`).
 *
 * The promises pinned here:
 *  - after the archive, `validate --all` reports no `subsystem.views-stale`, and
 *    `subsystem sync` agrees there is nothing to write — the two writers read
 *    the same map and tree;
 *  - the dry run names the views write in its plan, and no ⚠;
 *  - a file loam did not write at a reserved path is never overwritten — the
 *    archive leaves it and says so, as before;
 *  - a plan that feeds neither the map nor the tree writes no views file;
 *  - `loam unarchive` puts the pre-archive views back, and steps over one a
 *    later writer regenerated instead of refusing the whole undo over it.
 */
import { describe, expect, it } from "vitest";
import { coherentFixture, makeProject, runLoam, treeHashes, type Project } from "./helpers/harness.js";

const SERVICE_VIEWS = "architecture/services.likec4";

interface Finding {
  code: string;
  subject?: string;
}

async function viewsFindings(p: Project): Promise<Finding[]> {
  const run = await runLoam(p.workDir, "validate", "--all", "--json");
  const payload = JSON.parse(run.stdout) as { targets: Array<{ findings: Finding[] }> };
  return payload.targets.flatMap((t) => t.findings).filter((f) => f.code === "subsystem.views-stale");
}

/** The canonical fixture, synced first — so the only thing that can restale the views is the archive. */
async function synced(files: Record<string, string> = coherentFixture()): Promise<Project> {
  const p = await makeProject(files);
  const sync = await runLoam(p.workDir, "subsystem", "sync");
  expect(sync.code, sync.out).toBe(0);
  expect(await viewsFindings(p)).toEqual([]);
  return p;
}

describe("archive regenerates the generated views in its own commit", () => {
  it("a feature that adds a service and an edge leaves validate --all free of subsystem.views-stale", async () => {
    const p = await synced();
    try {
      const res = await runLoam(p.workDir, "archive", "FEAT-1", "--json");
      expect(res.code, res.stdout).toBe(0);
      const payload = JSON.parse(res.stdout) as { plan: Array<{ path: string; action: string }>; staleViews?: string[] };
      expect(payload.plan).toContainEqual({ path: SERVICE_VIEWS, action: "update" });
      expect(payload.staleViews).toBeUndefined();
      expect(await p.read(SERVICE_VIEWS)).toContain("payment-split-service");

      expect(await viewsFindings(p)).toEqual([]);
      // The second writer agrees: nothing left for sync to do, not one byte.
      const before = await treeHashes(p.docsDir);
      const sync = JSON.parse((await runLoam(p.workDir, "subsystem", "sync", "--json")).stdout) as {
        serviceViews: { action: string };
      };
      expect(sync.serviceViews.action).toBe("current");
      expect(await treeHashes(p.docsDir)).toEqual(before);
    } finally {
      await p.destroy();
    }
  }, 90_000);

  it("the text run closes on the complete-and-current line, with no ⚠ naming loam subsystem sync", async () => {
    const p = await synced();
    try {
      const res = await runLoam(p.workDir, "archive", "FEAT-1");
      expect(res.code, res.out).toBe(0);
      expect(res.stdout).toContain(`views: ${SERVICE_VIEWS} — regenerated for the merged map and tree`);
      expect(res.stdout).not.toContain("run `loam subsystem sync`");
    } finally {
      await p.destroy();
    }
  }, 90_000);

  it("the dry run lists the views write in its plan and predicts nothing stale", async () => {
    const p = await synced();
    try {
      const dry = await runLoam(p.workDir, "archive", "FEAT-1", "--dry-run");
      expect(dry.code, dry.out).toBe(0);
      expect(dry.stdout).toMatch(new RegExp(`update {2}${SERVICE_VIEWS}`));
      expect(dry.stdout).not.toContain("would no longer match");
      const json = JSON.parse((await runLoam(p.workDir, "archive", "FEAT-1", "--dry-run", "--json")).stdout) as {
        staleViews?: string[];
      };
      expect(json.staleViews).toBeUndefined();
    } finally {
      await p.destroy();
    }
  }, 90_000);

  it("never writes over a file loam did not author at the reserved path — it names it instead", async () => {
    const authored = "// our own overview diagram, drawn by hand\nviews {\n}\n";
    const p = await makeProject({ ...coherentFixture(), [SERVICE_VIEWS]: authored });
    try {
      // The dry run names it with the refusal every writer of the path prints,
      // never "run `loam subsystem sync`" — which refuses the same file.
      const dry = await runLoam(p.workDir, "archive", "FEAT-1", "--dry-run");
      expect(dry.stdout).toContain(`⚠ ${SERVICE_VIEWS} left as it is — its first line is not`);
      expect(dry.stdout).not.toContain(`${SERVICE_VIEWS} would no longer match`);
      const res = await runLoam(p.workDir, "archive", "FEAT-1", "--json");
      expect(res.code, res.stdout).toBe(0);
      expect(await p.read(SERVICE_VIEWS)).toBe(authored);
      const payload = JSON.parse(res.stdout) as { plan: Array<{ path: string }>; staleViews?: string[] };
      expect(payload.plan.map((row) => row.path)).not.toContain(SERVICE_VIEWS);
      expect(payload.staleViews).toEqual([SERVICE_VIEWS]);
    } finally {
      await p.destroy();
    }
  }, 90_000);

  // Catches: the planner reading the tree of a docs repo with no services/ —
  // which the archive tolerates on purpose for a landscape-only feature — and
  // turning that clean archive into `internal`.
  it("a landscape-only archive into a repo with no services/ still succeeds, writing no views", async () => {
    const files = coherentFixture();
    for (const path of Object.keys(files)) if (!path.startsWith("architecture/") && !path.endsWith("delta.likec4")) delete files[path];
    const p = await makeProject(files);
    try {
      expect(p.exists("services")).toBe(false);
      const res = await runLoam(p.workDir, "archive", "FEAT-1", "--approve", "--json");
      expect(res.code, res.stdout).toBe(0);
      const payload = JSON.parse(res.stdout) as { plan: Array<{ path: string }> };
      expect(payload.plan.map((row) => row.path)).not.toContain(SERVICE_VIEWS);
    } finally {
      await p.destroy();
    }
  }, 90_000);

  it("a requirements-only feature writes no views file — nothing it merges feeds them", async () => {
    const files = coherentFixture();
    delete files["features/FEAT-1-split/delta.likec4"];
    files["features/FEAT-1-split/specs/payment-service/spec.md"] = files[
      "features/FEAT-1-split/specs/payment-split-service/spec.md"
    ]!.replaceAll("payment-split-service", "payment-service").replace("Operations: createSplit\n\n", "");
    delete files["features/FEAT-1-split/specs/payment-split-service/spec.md"];
    delete files["features/FEAT-1-split/specs/payment-split-service/openapi.yaml"];
    const p = await synced(files);
    try {
      const res = await runLoam(p.workDir, "archive", "FEAT-1", "--json");
      expect(res.code, res.stdout).toBe(0);
      const payload = JSON.parse(res.stdout) as { plan: Array<{ path: string }> };
      expect(payload.plan.map((row) => row.path).filter((path) => path.startsWith("architecture/"))).toEqual([]);
    } finally {
      await p.destroy();
    }
  }, 90_000);
});

describe("unarchive and the views the archive wrote", () => {
  it("puts the pre-archive views back with the pre-archive map", async () => {
    const p = await synced();
    try {
      const before = await p.read(SERVICE_VIEWS);
      expect((await runLoam(p.workDir, "archive", "FEAT-1")).code).toBe(0);
      expect(await p.read(SERVICE_VIEWS)).not.toBe(before);
      const undo = await runLoam(p.workDir, "unarchive", "FEAT-1");
      expect(undo.code, undo.out).toBe(0);
      expect(await p.read(SERVICE_VIEWS)).toBe(before);
      expect(await viewsFindings(p)).toEqual([]);
    } finally {
      await p.destroy();
    }
  }, 90_000);

  it("steps over a views file regenerated since the archive instead of refusing the undo", async () => {
    const p = await synced();
    try {
      expect((await runLoam(p.workDir, "archive", "FEAT-1")).code).toBe(0);
      // Another writer's regeneration, standing in for a later subsystem verb:
      // still loam's file (the mark survives), different bytes.
      await p.write(SERVICE_VIEWS, `${await p.read(SERVICE_VIEWS)}\n// regenerated\n`);
      const undo = await runLoam(p.workDir, "unarchive", "FEAT-1", "--json");
      expect(undo.code, undo.stdout).toBe(0);
      const payload = JSON.parse(undo.stdout) as { staleViews?: string[] };
      expect(payload.staleViews).toEqual([SERVICE_VIEWS]);
      // And sync repairs it from the restored map, as the line says.
      expect((await runLoam(p.workDir, "subsystem", "sync")).code).toBe(0);
      expect(await viewsFindings(p)).toEqual([]);
    } finally {
      await p.destroy();
    }
  }, 90_000);
});
