/**
 * Deep invariant tests for `loam unarchive` (src/commands/unarchive.ts).
 *
 * unarchive is the only command that claims to UNDO a mutation of the living
 * docs, and a claimed undo that is really an approximation is worse than none:
 * it hands back docs that look restored and are not. So the central test here is
 * not "it ran" but "the docs repo is byte-identical to before the archive",
 * checked over every file and directory rather than the few the merge names.
 *
 * That bar is why unarchive restores a SNAPSHOT rather than inverting the merge.
 * The merge is not invertible: a MODIFIED requirement's previous text is nowhere
 * in the delta, and the landscape merge drops the feature tags, so the added
 * lines stop being identifiable the moment they land. The snapshot pins the one
 * thing that survives — the bytes.
 *
 * The refusals matter as much as the restore. unarchive says no to burying an
 * active feature, to a feature archived before snapshots existed, and to
 * restoring over changes made after the archive — each with its own stable code,
 * because a caller has to know which of them re-running could ever fix.
 */
import { describe, it, expect, vi } from "vitest";
import { join } from "node:path";
import { mkdir, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { readManifest } from "../src/commands/unarchive/manifest.js";
import { parseRequirements } from "../src/core/document/parse.js";
import {
  coherentFixture,
  makeProject,
  pinFor,
  runLoam,
  treeHashes,
  LANDSCAPE,
  LIVING_OPENAPI,
  type Project,
} from "./helpers/harness.js";

/**
 * Fault injection for the commit phase. The harness runs commands in-process,
 * so the swap and the final move go through this module graph's own
 * node:fs/promises — wrapping `rename` lets a test fail exactly one step of
 * the commit and watch which stable code comes back. Everything passes through
 * untouched while `onRename` is unset, so the rest of this file never notices.
 */
const fsFault = vi.hoisted(() => ({
  onRename: undefined as undefined | ((from: string, to: string) => void),
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    rename: async (from: Parameters<typeof actual.rename>[0], to: Parameters<typeof actual.rename>[1]) => {
      fsFault.onRename?.(String(from), String(to));
      return actual.rename(from, to);
    },
  };
});

/** Living spec with a requirement whose text the feature will MODIFY. */
const LIVING_SPEC_TO_MODIFY = `---
service: payment-service
status: verified
owner: payments-team
---

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
 * The delta that rewrites it — and records nothing about what it replaced.
 * The Based-On pin is computed, not hard-coded, because archive now gates on
 * `delta.baseline-missing`: an unpinned MODIFIED requirement no longer merges,
 * and this test is about the round trip, not about that refusal.
 */
const MODIFY_DELTA = `# payment-service — delta for FEAT-20

## MODIFIED Requirements

### Requirement: Authorize a payment
Based-On: ${pinFor(LIVING_SPEC_TO_MODIFY, "Authorize a payment")}
The service SHALL authorize a payment within 2 seconds.

Operations: authorizePayment

#### Scenario: Fast authorization
- **Given** a valid card
- **When** authorization is requested
- **Then** it completes within 2 seconds
`;

function modifyFixture(): Record<string, string> {
  return {
    "architecture/landscape.likec4": LANDSCAPE,
    "services/payment-service/spec.md": LIVING_SPEC_TO_MODIFY,
    "services/payment-service/openapi.yaml": LIVING_OPENAPI,
    "features/FEAT-20-faster/specs/payment-service/spec.md": MODIFY_DELTA,
    // archive now gates on `intent.empty`, so the fixture needs one line of
    // real prose — a missing intent.md would refuse before the merge ran.
    "features/FEAT-20-faster/intent.md": `---\nfeature: FEAT-20\nstatus: proposed\n---\n\n# Faster authorization\n\nAuthorize a payment within two seconds instead of before capture alone.\n`,
  };
}

describe("the round trip", () => {
  it("archive then unarchive leaves the docs repo byte-identical, down to the directories", async () => {
    const p = await makeProject(coherentFixture());
    try {
      const before = await treeHashes(p.docsDir);
      expect((await runLoam(p.workDir, "archive", "FEAT-1")).code).toBe(0);
      expect(await treeHashes(p.docsDir)).not.toEqual(before);

      const res = await runLoam(p.workDir, "unarchive", "FEAT-1");
      expect(res.code).toBe(0);
      expect(await treeHashes(p.docsDir)).toEqual(before);
    } finally {
      await p.destroy();
    }
  });

  it("restores a MODIFIED requirement's previous text — the thing no inverse merge could know", async () => {
    const p = await makeProject(modifyFixture());
    try {
      expect((await runLoam(p.workDir, "archive", "FEAT-20")).code).toBe(0);
      expect(await p.read("services/payment-service/spec.md")).toContain("within 2 seconds");

      expect((await runLoam(p.workDir, "unarchive", "FEAT-20")).code).toBe(0);
      const text = await p.read("services/payment-service/spec.md");
      expect(text).toBe(LIVING_SPEC_TO_MODIFY);
      const reqs = parseRequirements(text);
      expect(reqs[0]!.text.join("\n")).toContain("before capture");
      expect(reqs[0]!.scenarios.map((s) => s.name)).toEqual(["Successful authorization"]);
    } finally {
      await p.destroy();
    }
  });

  it("takes back the files and the directories the merge created", async () => {
    const p = await makeProject(coherentFixture());
    try {
      await runLoam(p.workDir, "archive", "FEAT-1");
      expect(p.exists("services/payment-split-service/spec.md")).toBe(true);

      await runLoam(p.workDir, "unarchive", "FEAT-1");
      expect(p.exists("services/payment-split-service/spec.md")).toBe(false);
      expect(
        p.exists("services/payment-split-service"),
        "a directory left behind empty is still the fleet claiming a service that was never merged",
      ).toBe(false);
      expect(p.exists("features/archive")).toBe(false);
    } finally {
      await p.destroy();
    }
  });

  it("re-opens the feature intact, and leaves no snapshot behind in it", async () => {
    const p = await makeProject(coherentFixture());
    try {
      const delta = await p.read("features/FEAT-1-split/delta.likec4");
      await runLoam(p.workDir, "archive", "FEAT-1");
      await runLoam(p.workDir, "unarchive", "FEAT-1");
      expect(await p.read("features/FEAT-1-split/delta.likec4")).toBe(delta);
      expect(p.exists("features/FEAT-1-split/.loam-before")).toBe(false);
      expect(p.exists("features/archive/FEAT-1-split")).toBe(false);
    } finally {
      await p.destroy();
    }
  });

  it("the re-opened feature can be archived again, to the same result", async () => {
    const p = await makeProject(coherentFixture());
    try {
      await runLoam(p.workDir, "archive", "FEAT-1");
      const merged = await treeHashes(p.docsDir);
      await runLoam(p.workDir, "unarchive", "FEAT-1");
      expect((await runLoam(p.workDir, "archive", "FEAT-1")).code).toBe(0);
      // The snapshot carries a timestamp, so compare what the merge produced.
      const again = await treeHashes(p.docsDir);
      for (const [path, hash] of Object.entries(merged)) {
        if (path.includes(".loam-before")) continue;
        expect(again[path], path).toBe(hash);
      }
    } finally {
      await p.destroy();
    }
  });

  it("restores a create-only archive whose snapshot has no files directory", async () => {
    const files = coherentFixture();
    delete files["architecture/landscape.likec4"];
    const p = await makeProject(files);
    try {
      expect((await runLoam(p.workDir, "archive", "FEAT-1")).code).toBe(0);
      expect(p.exists("features/archive/FEAT-1-split/.loam-before/files")).toBe(false);
      expect(p.exists("services/payment-split-service/spec.md")).toBe(true);

      expect((await runLoam(p.workDir, "unarchive", "FEAT-1")).code).toBe(0);
      expect(p.exists("services/payment-split-service")).toBe(false);
      expect(p.exists("features/FEAT-1-split/specs/payment-split-service/spec.md")).toBe(true);
    } finally {
      await p.destroy();
    }
  });

  it("leaves `loam list` and `loam validate` seeing exactly what they saw before the archive", async () => {
    const p = await makeProject(coherentFixture());
    try {
      const listed = await runLoam(p.workDir, "list", "--json");
      const validated = await runLoam(p.workDir, "validate", "--all", "--json");
      await runLoam(p.workDir, "archive", "FEAT-1");
      await runLoam(p.workDir, "unarchive", "FEAT-1");
      expect((await runLoam(p.workDir, "list", "--json")).stdout).toBe(listed.stdout);
      expect((await runLoam(p.workDir, "validate", "--all", "--json")).stdout).toBe(validated.stdout);
    } finally {
      await p.destroy();
    }
  });
});

/* ------------------------------------------------------------------ */
/* The (service, artifact) re-keying — snapshot version 3              */
/* ------------------------------------------------------------------ */

describe("snapshot versions across the re-keying", () => {
  it("still restores a version-2 snapshot byte for byte, under its literal-path rules", async () => {
    const p = await makeProject(coherentFixture());
    try {
      const before = await treeHashes(p.docsDir);
      expect((await runLoam(p.workDir, "archive", "FEAT-1")).code).toBe(0);
      // Exactly what a pre-re-keying loam archived: version 2, literal paths,
      // no (service, artifact) keys. Such snapshots sit in archived features
      // forever and travel across upgrades — they must keep restoring.
      const path = join(p.docsDir, "features/archive/FEAT-1-split/.loam-before/manifest.json");
      const manifest = JSON.parse(await readFile(path, "utf8")) as {
        version: number;
        files: Array<{ service?: string; artifact?: string }>;
      };
      manifest.version = 2;
      for (const f of manifest.files) {
        delete f.service;
        delete f.artifact;
      }
      await writeFile(path, JSON.stringify(manifest, null, 2) + "\n", "utf8");

      expect((await runLoam(p.workDir, "unarchive", "FEAT-1")).code).toBe(0);
      expect(await treeHashes(p.docsDir)).toEqual(before);
    } finally {
      await p.destroy();
    }
  });

  it("refuses a version-3 manifest whose services/ row lost its key — that is not a manifest loam wrote", async () => {
    const p = await makeProject(coherentFixture());
    try {
      expect((await runLoam(p.workDir, "archive", "FEAT-1")).code).toBe(0);
      const path = join(p.docsDir, "features/archive/FEAT-1-split/.loam-before/manifest.json");
      const manifest = JSON.parse(await readFile(path, "utf8")) as {
        files: Array<{ path: string; service?: string }>;
      };
      const row = manifest.files.find((f) => f.path.startsWith("services/"))!;
      delete row.service;
      await writeFile(path, JSON.stringify(manifest, null, 2) + "\n", "utf8");

      const res = await runLoam(p.workDir, "unarchive", "FEAT-1", "--json");
      expect(res.code).toBe(1);
      expect(JSON.parse(res.stdout).error.code).toBe("snapshot-missing");
    } finally {
      await p.destroy();
    }
  });
});

describe("a service directory moved after the archive", () => {
  /** The move, simulated by hand — what `loam subsystem move` will do (wave 3): mark the group, rename the service in. */
  async function moveServiceByHand(p: Project, service: string): Promise<void> {
    await mkdir(join(p.docsDir, "services/payments-group"), { recursive: true });
    await writeFile(join(p.docsDir, "services/payments-group/subsystem.yaml"), "title: Payments\n", "utf8");
    await rename(join(p.docsDir, "services", service), join(p.docsDir, "services/payments-group", service));
  }

  it("restores into the directory the service lives in NOW — the walk resolves what the flat enumeration refused", async () => {
    const p = await makeProject(modifyFixture());
    try {
      const before = await treeHashes(p.docsDir);
      expect((await runLoam(p.workDir, "archive", "FEAT-20")).code).toBe(0);
      await moveServiceByHand(p, "payment-service");

      // Flipped from the wave-2 waiting state it was born in: until the tree
      // walk landed, the flat enumeration could not see the moved directory,
      // the v3 entry fell back to its literal path, and this run pinned the
      // honest `snapshot-stale` refusal. Now the enumeration answers where the
      // service lives TODAY, so the same run restores — byte for byte, into
      // the moved location, with no --force.
      expect((await runLoam(p.workDir, "unarchive", "FEAT-20")).code).toBe(0);
      const after = await treeHashes(p.docsDir);
      // The end state is the pre-archive bytes, relocated by exactly the move:
      // every services/payment-service/* entry now sits under the group, plus
      // the marker the move wrote. Nothing else may differ.
      const relocated = Object.fromEntries(
        Object.entries(before).map(([path, hash]) => [
          path.replace(/^services\/payment-service\//, "services/payments-group/payment-service/"),
          hash,
        ]),
      );
      expect(after["services/payments-group/subsystem.yaml"]).toBeDefined();
      expect(after["services/payments-group/"]).toBe("<dir>");
      delete after["services/payments-group/subsystem.yaml"];
      delete after["services/payments-group/"];
      expect(after).toEqual(relocated);
    } finally {
      await p.destroy();
    }
  });

  it("resolves a v3 entry through the enumeration it is HANDED — the restore-time target follows the service", async () => {
    const p = await makeProject(modifyFixture());
    try {
      expect((await runLoam(p.workDir, "archive", "FEAT-20")).code).toBe(0);
      await moveServiceByHand(p, "payment-service");

      // The manifest reader with an enumeration that DOES know the moved
      // directory — what the tree walk will hand it. The entry's write target
      // follows the service; the pre-image stays keyed by the as-archived path.
      const featureDir = join(p.docsDir, "features/archive/FEAT-20-faster");
      const manifest = await readManifest({
        featureDir,
        docsDir: p.docsDir,
        featureId: "FEAT-20",
        dirName: "FEAT-20-faster",
        serviceDirOf: (service: string): string | null =>
          service === "payment-service" ? "services/payments-group/payment-service" : null,
      });
      expect(manifest).not.toBeNull();
      const entry = manifest!.files.find((f) => f.path === "services/payment-service/spec.md")!;
      expect(entry.target).toBe(join(p.docsDir, "services/payments-group/payment-service/spec.md"));
      expect(entry.snapshot).toBe(
        join(featureDir, ".loam-before/files/services/payment-service/spec.md"),
      );
    } finally {
      await p.destroy();
    }
  });
});

describe("refusals", () => {
  interface MutableManifest {
    feature: string;
    files: Array<{ path: string; existed: boolean; after: string }>;
    [key: string]: unknown;
  }

  async function archived(): Promise<Project> {
    const p = await makeProject(coherentFixture());
    await runLoam(p.workDir, "archive", "FEAT-1");
    return p;
  }

  const manifestPath = (p: Project): string =>
    join(p.docsDir, "features/archive/FEAT-1-split/.loam-before/manifest.json");

  async function corruptManifest(
    p: Project,
    mutate: (manifest: MutableManifest) => void,
  ): Promise<void> {
    const path = manifestPath(p);
    const manifest = JSON.parse(await readFile(path, "utf8")) as MutableManifest;
    mutate(manifest);
    await writeFile(path, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  }

  it("refuses to bury an active feature of the same id, and changes nothing", async () => {
    const p = await archived();
    try {
      await p.write("features/FEAT-1-split/delta.likec4", "// work in flight\n");
      const before = await treeHashes(p.docsDir);
      const res = await runLoam(p.workDir, "unarchive", "FEAT-1");
      expect(res.code).toBe(1);
      expect(res.out).toContain("BLOCKED");
      expect(await treeHashes(p.docsDir)).toEqual(before);
      expect(await p.read("features/FEAT-1-split/delta.likec4")).toBe("// work in flight\n");
    } finally {
      await p.destroy();
    }
  });

  it("names an active feature as `feature-active`, not as a missing target", async () => {
    const p = await archived();
    try {
      await p.write("features/FEAT-1-split/delta.likec4", "// work in flight\n");
      const res = await runLoam(p.workDir, "unarchive", "FEAT-1", "--json");
      expect(JSON.parse(res.stdout)).toMatchObject({ ok: false, error: { code: "feature-active" } });
    } finally {
      await p.destroy();
    }
  });

  it("a feature archived before snapshots existed fails with an explanation, not a crash", async () => {
    const p = await archived();
    try {
      // Exactly what an older loam left behind: the feature, and no record of what it overwrote.
      await rm(join(p.docsDir, "features/archive/FEAT-1-split/.loam-before"), { recursive: true });
      const before = await treeHashes(p.docsDir);
      const res = await runLoam(p.workDir, "unarchive", "FEAT-1");
      expect(res.code).toBe(1);
      expect(res.out).toContain("BLOCKED");
      expect(res.out).toContain("version control");
      expect(await treeHashes(p.docsDir)).toEqual(before);
    } finally {
      await p.destroy();
    }
  });

  it("reports the missing snapshot under its own code", async () => {
    const p = await archived();
    try {
      await rm(join(p.docsDir, "features/archive/FEAT-1-split/.loam-before"), { recursive: true });
      const res = await runLoam(p.workDir, "unarchive", "FEAT-1", "--json");
      expect(JSON.parse(res.stdout)).toMatchObject({ ok: false, error: { code: "snapshot-missing" } });
    } finally {
      await p.destroy();
    }
  });

  it("rejects non-canonical, duplicate, mismatched, and invalid-hash manifest data before staging", async () => {
    const corruptions: Array<(manifest: MutableManifest, p: Project) => void> = [
      (manifest) => {
        manifest.files[0]!.path = "../outside.txt";
      },
      (manifest, p) => {
        manifest.files[0]!.path = join(p.docsDir, "outside.txt");
      },
      (manifest) => {
        manifest.files.push({ ...manifest.files[0]! });
      },
      (manifest) => {
        manifest.files[0]!.after = "not-a-sha256";
      },
      (manifest) => {
        manifest.feature = "FEAT-OTHER";
      },
    ];

    for (const mutate of corruptions) {
      const p = await archived();
      try {
        await corruptManifest(p, (manifest) => mutate(manifest, p));
        const before = await treeHashes(p.docsDir);
        const res = await runLoam(p.workDir, "unarchive", "FEAT-1", "--json");
        expect(res.code).toBe(1);
        expect(JSON.parse(res.stdout).error.code).toBe("snapshot-missing");
        expect(await treeHashes(p.docsDir)).toEqual(before);
      } finally {
        await p.destroy();
      }
    }
  });

  it("rejects a manifest destination reached through a symlink outside docsDir", async () => {
    const p = await archived();
    try {
      const outside = join(p.docsDir, "..", "outside");
      await mkdir(outside, { recursive: true });
      await writeFile(join(outside, "owned.txt"), "must survive\n", "utf8");
      await symlink(outside, join(p.docsDir, "escape"));
      await corruptManifest(p, (manifest) => {
        manifest.files[0] = {
          ...manifest.files[0],
          path: "escape/owned.txt",
          existed: false,
        };
      });
      const mergedSpec = await p.read("services/payment-split-service/spec.md");
      const manifestBefore = await readFile(manifestPath(p), "utf8");

      const res = await runLoam(p.workDir, "unarchive", "FEAT-1", "--force", "--json");
      expect(res.code).toBe(1);
      expect(JSON.parse(res.stdout).error.code).toBe("snapshot-missing");
      expect(await readFile(join(outside, "owned.txt"), "utf8")).toBe("must survive\n");
      expect(await p.read("services/payment-split-service/spec.md")).toBe(mergedSpec);
      expect(await readFile(manifestPath(p), "utf8")).toBe(manifestBefore);
      expect(p.exists("features/archive/FEAT-1-split/delta.likec4")).toBe(true);
    } finally {
      await p.destroy();
    }
  });

  it("rejects a snapshot pre-image symlink instead of restoring bytes from outside the archive", async () => {
    const p = await archived();
    try {
      const manifest = JSON.parse(await readFile(manifestPath(p), "utf8")) as MutableManifest;
      const entry = manifest.files.find((file) => file.existed)!;
      const preimage = join(
        p.docsDir,
        "features/archive/FEAT-1-split/.loam-before/files",
        ...entry.path.split("/"),
      );
      const outside = join(p.docsDir, "..", "forged-preimage.txt");
      await writeFile(outside, "forged bytes\n", "utf8");
      await rm(preimage);
      await symlink(outside, preimage);
      const living = await p.read(entry.path);

      const res = await runLoam(p.workDir, "unarchive", "FEAT-1", "--force", "--json");
      expect(res.code).toBe(1);
      expect(JSON.parse(res.stdout).error.code).toBe("snapshot-missing");
      expect(await p.read(entry.path)).toBe(living);
      expect(p.exists("features/archive/FEAT-1-split/delta.likec4")).toBe(true);
    } finally {
      await p.destroy();
    }
  });

  it("refuses when a merged file changed after the archive — that is a revert, not an undo", async () => {
    const p = await archived();
    try {
      const edited = (await p.read("services/payment-split-service/spec.md")) + "\nHand-edited since.\n";
      await p.write("services/payment-split-service/spec.md", edited);
      const res = await runLoam(p.workDir, "unarchive", "FEAT-1");
      expect(res.code).toBe(1);
      expect(res.out).toContain("services/payment-split-service/spec.md");
      expect(await p.read("services/payment-split-service/spec.md")).toBe(edited);
    } finally {
      await p.destroy();
    }
  });

  it("--force says the discarding was meant, and does it", async () => {
    const p = await archived();
    try {
      await p.write("services/payment-split-service/spec.md", "hand-edited\n");
      const res = await runLoam(p.workDir, "unarchive", "FEAT-1", "--force");
      expect(res.code).toBe(0);
      expect(res.out).toContain("discarding later changes");
      expect(p.exists("services/payment-split-service/spec.md")).toBe(false);
    } finally {
      await p.destroy();
    }
  });

  it("an unknown feature is an unknown target, and an ACTIVE feature is not unarchivable", async () => {
    const p = await makeProject(coherentFixture());
    try {
      const missing = await runLoam(p.workDir, "unarchive", "FEAT-99", "--json");
      expect(JSON.parse(missing.stdout)).toMatchObject({ ok: false, error: { code: "unknown-target" } });
      // FEAT-1 exists, but only as an active feature — there is nothing to take back.
      const active = await runLoam(p.workDir, "unarchive", "FEAT-1", "--json");
      expect(JSON.parse(active.stdout).error.code).toBe("unknown-target");
    } finally {
      await p.destroy();
    }
  });

  it("without a loam.json it reports no-config like every other command", async () => {
    const p = await makeProject(coherentFixture());
    try {
      await rm(join(p.workDir, "loam.json"));
      const res = await runLoam(p.workDir, "unarchive", "FEAT-1", "--json");
      expect(JSON.parse(res.stdout)).toMatchObject({ ok: false, error: { code: "no-config" } });
    } finally {
      await p.destroy();
    }
  });
});

describe("the commit phase", () => {
  /**
   * The two commit-failure codes answer one question — "can I trust the repo
   * now?" — the way archive's `merge-failed` / `rollback-incomplete` pair does.
   * The faults land on the reopening move (the last step, after every file is
   * already swapped in), because that is the spot where the two outcomes
   * genuinely diverge: the rollback either puts every file back, or it cannot.
   */
  it("a failure the rollback fully undid is `restore-failed`, and the docs are untouched", async () => {
    const p = await makeProject(coherentFixture());
    try {
      expect((await runLoam(p.workDir, "archive", "FEAT-1")).code).toBe(0);
      const before = await treeHashes(p.docsDir);
      fsFault.onRename = (_from, to) => {
        if (to.endsWith(join("features", "FEAT-1-split"))) {
          throw new Error("injected: the reopening move failed");
        }
      };
      const res = await runLoam(p.workDir, "unarchive", "FEAT-1", "--json");
      expect(res.code).toBe(1);
      const json = JSON.parse(res.stdout);
      expect(json.ok).toBe(false);
      expect(json.error.code).toBe("restore-failed");
      expect(json.error.message.toLowerCase()).toContain("rolled back");
      fsFault.onRename = undefined;
      expect(await treeHashes(p.docsDir), "a clean rollback means byte-identical docs").toEqual(before);
    } finally {
      fsFault.onRename = undefined;
      await p.destroy();
    }
  });

  it("a failure whose rollback ALSO failed is `rollback-incomplete`, naming the files", async () => {
    const p = await makeProject(coherentFixture());
    try {
      expect((await runLoam(p.workDir, "archive", "FEAT-1")).code).toBe(0);
      // First the reopening move fails; from then on every rename fails, so the
      // rollback's own atomic writes cannot land either.
      let armed = false;
      fsFault.onRename = (_from, to) => {
        if (armed) throw new Error("injected: rollback blocked");
        if (to.endsWith(join("features", "FEAT-1-split"))) {
          armed = true;
          throw new Error("injected: the reopening move failed");
        }
      };
      const res = await runLoam(p.workDir, "unarchive", "FEAT-1", "--json");
      expect(res.code).toBe(1);
      const json = JSON.parse(res.stdout);
      expect(json.ok).toBe(false);
      expect(json.error.code).toBe("rollback-incomplete");
      // The payload matches archive's discipline: the message says the rollback
      // did not hold and lists the files that need a hand.
      expect(json.error.message).toContain("ROLLBACK INCOMPLETE");
      expect(json.error.message).toContain("landscape.likec4");
    } finally {
      fsFault.onRename = undefined;
      await p.destroy();
    }
  });

  it("a refusal that never reached the commit stays `restore-failed`-free — codes do not leak", async () => {
    // Guard the boundary from the other side: plan-phase refusals keep their own
    // codes, so a consumer can rely on `rollback-incomplete` meaning the commit ran.
    const p = await makeProject(coherentFixture());
    try {
      expect((await runLoam(p.workDir, "archive", "FEAT-1")).code).toBe(0);
      await rm(join(p.docsDir, "features/archive/FEAT-1-split/.loam-before"), { recursive: true });
      const res = await runLoam(p.workDir, "unarchive", "FEAT-1", "--json");
      expect(JSON.parse(res.stdout).error.code).toBe("snapshot-missing");
    } finally {
      await p.destroy();
    }
  });
});

describe("the machine contract", () => {
  it("names what was restored and what was taken back", async () => {
    const p = await makeProject(coherentFixture());
    try {
      await runLoam(p.workDir, "archive", "FEAT-1");
      const res = await runLoam(p.workDir, "unarchive", "FEAT-1", "--json");
      expect(res.code).toBe(0);
      const json = JSON.parse(res.stdout);
      expect(json.ok).toBe(true);
      expect(json.feature).toBe("FEAT-1");
      expect(json.path).toBe("features/FEAT-1-split");
      expect(json.restored).toContain("architecture/landscape.likec4");
      expect(json.removed).toEqual(
        expect.arrayContaining([
          "services/payment-split-service/spec.md",
          "services/payment-split-service/openapi.yaml",
        ]),
      );
      expect(json.discarded).toEqual([]);
    } finally {
      await p.destroy();
    }
  });

  it("emits nothing but JSON on the success path, so one stream always parses", async () => {
    const p = await makeProject(coherentFixture());
    try {
      await runLoam(p.workDir, "archive", "FEAT-1");
      const res = await runLoam(p.workDir, "unarchive", "FEAT-1", "--json");
      expect(() => JSON.parse(res.out)).not.toThrow();
    } finally {
      await p.destroy();
    }
  });
});
