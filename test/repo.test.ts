/**
 * Deep invariant tests for the docs-repo read model (src/core/repo/repo.ts).
 *
 * This module is the single place that knows the docs-repo layout: which
 * directories are services, which are features, where each artifact lives, and
 * how a feature id maps to a directory name. `list`, `show`, `validate --all`
 * and the three commands that used to each carry their own copy of
 * findFeatureDirName all read the repo through here.
 *
 * Families:
 *  - featureIdFromDirName: id derivation from the <ID>-<slug> convention
 *  - listServices: enumeration, artifact presence, ordering, junk tolerance
 *  - listFeatures: active vs archived, per-feature services, ordering
 *  - resolveFeature: exact id / exact directory name / near-miss / archived / absent
 *  - docsRepoState: absent vs not-a-docs-repo vs empty-but-real
 *  - path helpers: the only place artifact filenames are spelled
 */
import { describe, expect, it } from "vitest";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { makeTmpDir, writeFiles } from "./helpers/harness.js";
import { rawServiceId } from "../src/core/kernel/ids.js";
import { featureIdFromDirName } from "../src/core/repo/entries.js";
import { featurePaths, featureSpecPaths, servicePaths } from "../src/core/repo/paths.js";
import { DocsRepoUnavailableError, docsRepoState } from "../src/core/repo/state.js";
import { ambiguousFeatureMessage, featureCandidates, featureSpecServices, listFeatures, listServices, resolveFeature } from "../src/core/repo/repo.js";

/** Build a throwaway docs repo from relPath → content and hand it to fn. */
async function withDocs(
  files: Record<string, string>,
  fn: (docsDir: string) => Promise<void>,
): Promise<void> {
  const root = await makeTmpDir();
  const docsDir = join(root, "docs");
  await mkdir(docsDir, { recursive: true });
  await writeFiles(docsDir, files);
  try {
    await fn(docsDir);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe("featureIdFromDirName", () => {
  it("strips the slug from the canonical <ID>-<slug> form", () => {
    expect(featureIdFromDirName("FEAT-1-split")).toBe("FEAT-1");
    expect(featureIdFromDirName("FEAT-101-payment-splitting")).toBe("FEAT-101");
  });

  it("leaves a bare id untouched", () => {
    expect(featureIdFromDirName("FEAT-3")).toBe("FEAT-3");
  });

  it("does not confuse FEAT-1 with FEAT-10 (the digit run is taken whole)", () => {
    expect(featureIdFromDirName("FEAT-10-x")).toBe("FEAT-10");
    expect(featureIdFromDirName("FEAT-1-x")).toBe("FEAT-1");
    expect(featureIdFromDirName("FEAT-10-x")).not.toBe(featureIdFromDirName("FEAT-1-x"));
  });

  it("accepts any prefix, not just FEAT", () => {
    expect(featureIdFromDirName("BUG-42-crash-on-save")).toBe("BUG-42");
    expect(featureIdFromDirName("EPIC-7")).toBe("EPIC-7");
  });

  it("falls back to the whole name when there is no <word>-<number> head", () => {
    expect(featureIdFromDirName("payment-splitting")).toBe("payment-splitting");
    expect(featureIdFromDirName("")).toBe("");
  });

  it("takes the FIRST number run — a dated slug keeps only its first segment (documented quirk)", () => {
    expect(featureIdFromDirName("release-2024-01-hardening")).toBe("release-2024");
  });
});

describe("docsRepoState", () => {
  it("tells 'not there' from 'not a docs repo' from 'a docs repo with nothing in it yet'", async () => {
    await withDocs({}, async (docsDir) => {
      expect(docsRepoState(join(docsDir, "nope")).kind).toBe("missing");
      // the directory exists but has no services/ — most often the service
      // repo itself, reached by a typo in docsDir
      expect(docsRepoState(docsDir).kind).toBe("no-services");
      await mkdir(join(docsDir, "services"), { recursive: true });
      // an EMPTY services/ is a real docs repo before the first adopt
      expect(docsRepoState(docsDir).kind).toBe("ok");
    });
  });

  it("treats a file at docsDir as missing, not as a repo", async () => {
    await withDocs({ "afile.txt": "x\n" }, async (docsDir) => {
      expect(docsRepoState(join(docsDir, "afile.txt")).kind).toBe("missing");
    });
  });

  it("reports the path it examined, so a caller can quote it", async () => {
    await withDocs({}, async (docsDir) => {
      expect(docsRepoState(docsDir).path).toBe(docsDir);
    });
  });
});

describe("listServices", () => {
  it("refuses a docsDir that does not exist instead of reporting an empty fleet", async () => {
    // The bug this closes: a mistyped docsDir looked exactly like a docs repo
    // with no services in it, so every fleet-wide command reported success over
    // a repository that was never there.
    await withDocs({}, async (docsDir) => {
      const gone = join(docsDir, "nowhere");
      await expect(listServices(gone)).rejects.toBeInstanceOf(DocsRepoUnavailableError);
      await expect(listServices(gone)).rejects.toThrow(gone);
    });
  });

  it("refuses a directory that is not a docs repo, and says why", async () => {
    await withDocs({ "README.md": "# not docs\n" }, async (docsDir) => {
      await expect(listServices(docsDir)).rejects.toThrow(/no services\/ directory/);
    });
  });

  it("returns [] for an empty services/ directory", async () => {
    await withDocs({}, async (docsDir) => {
      await mkdir(join(docsDir, "services"), { recursive: true });
      expect(await listServices(docsDir)).toEqual([]);
    });
  });

  it("lists one entry per service directory, with its absolute dir", async () => {
    await withDocs(
      {
        "services/payment-service/spec.md": "# payment-service\n",
        "services/checkout-web/spec.md": "# checkout-web\n",
      },
      async (docsDir) => {
        const svcs = await listServices(docsDir);
        expect(svcs.map((s) => s.id)).toEqual(["checkout-web", "payment-service"]);
        expect(svcs[0]!.dir).toBe(join(docsDir, "services", "checkout-web"));
      },
    );
  });

  it("reports which artifacts each service has", async () => {
    await withDocs(
      {
        "services/full/model.likec4": "model {}\n",
        "services/full/spec.md": "# full\n",
        "services/full/openapi.yaml": "openapi: 3.1.0\n",
        "services/full/asyncapi.yaml": "asyncapi: 3.0.0\n",
        "services/full/runbook.md": "# runbook\n",
        "services/full/health.yaml": "slo: {}\n",
        "services/bare/spec.md": "# bare\n",
      },
      async (docsDir) => {
        const [bare, full] = await listServices(docsDir);
        expect(full!.has).toEqual({
          model: true,
          spec: true,
          openapi: true,
          asyncapi: true,
          runbook: true,
          health: true,
        });
        expect(bare!.has).toEqual({
          model: false,
          spec: true,
          openapi: false,
          asyncapi: false,
          runbook: false,
          health: false,
        });
      },
    );
  });

  it("counts ADR files, ignoring non-markdown and a missing adrs/ dir", async () => {
    await withDocs(
      {
        "services/svc/adrs/0001-first.md": "# 1\n",
        "services/svc/adrs/0002-second.md": "# 2\n",
        "services/svc/adrs/notes.txt": "not an adr\n",
        "services/other/spec.md": "# other\n",
      },
      async (docsDir) => {
        const [other, svc] = await listServices(docsDir);
        expect(svc!.adrs).toBe(2);
        expect(other!.adrs).toBe(0);
      },
    );
  });

  it("ignores loose files and dot-directories under services/", async () => {
    await withDocs(
      {
        "services/real/spec.md": "# real\n",
        "services/README.md": "not a service\n",
      },
      async (docsDir) => {
        await mkdir(join(docsDir, "services", ".hidden"), { recursive: true });
        const svcs = await listServices(docsDir);
        expect(svcs.map((s) => s.id)).toEqual(["real"]);
      },
    );
  });

  it("orders services deterministically, with digit runs compared numerically", async () => {
    await withDocs(
      {
        "services/svc-10/spec.md": "x\n",
        "services/svc-2/spec.md": "x\n",
        "services/svc-1/spec.md": "x\n",
      },
      async (docsDir) => {
        const ids = (await listServices(docsDir)).map((s) => s.id);
        expect(ids).toEqual(["svc-1", "svc-2", "svc-10"]);
      },
    );
  });
});

describe("listFeatures", () => {
  const featureFiles: Record<string, string> = {
    "features/FEAT-1-split/intent.md": "# split\n",
    "features/FEAT-1-split/delta.likec4": "model {}\n",
    "features/FEAT-1-split/specs/payment-service/spec.md": "# delta\n",
    "features/FEAT-1-split/specs/payment-split-service/spec.md": "# delta\n",
    "features/FEAT-2-refunds/intent.md": "# refunds\n",
    "features/archive/FEAT-0-old/intent.md": "# old\n",
  };

  it("returns [] when features/ does not exist", async () => {
    await withDocs({}, async (docsDir) => {
      expect(await listFeatures(docsDir)).toEqual([]);
    });
  });

  it("lists active features and excludes the archive/ directory itself", async () => {
    await withDocs(featureFiles, async (docsDir) => {
      const feats = await listFeatures(docsDir);
      expect(feats.map((f) => f.id)).toEqual(["FEAT-1", "FEAT-2"]);
      expect(feats.every((f) => !f.archived)).toBe(true);
    });
  });

  it("includes archived features only on request, flagged as archived", async () => {
    await withDocs(featureFiles, async (docsDir) => {
      const feats = await listFeatures(docsDir, { includeArchived: true });
      expect(feats.map((f) => f.id)).toEqual(["FEAT-0", "FEAT-1", "FEAT-2"]);
      expect(feats.find((f) => f.id === "FEAT-0")!.archived).toBe(true);
      expect(feats.find((f) => f.id === "FEAT-1")!.archived).toBe(false);
    });
  });

  it("carries the directory name separately from the id", async () => {
    await withDocs(featureFiles, async (docsDir) => {
      const feat = (await listFeatures(docsDir))[0]!;
      expect(feat.id).toBe("FEAT-1");
      expect(feat.dirName).toBe("FEAT-1-split");
      expect(feat.dir).toBe(join(docsDir, "features", "FEAT-1-split"));
    });
  });

  it("lists the services a feature touches, sorted, from specs/", async () => {
    await withDocs(featureFiles, async (docsDir) => {
      const feats = await listFeatures(docsDir);
      expect(feats.find((f) => f.id === "FEAT-1")!.services).toEqual([
        "payment-service",
        "payment-split-service",
      ]);
      expect(feats.find((f) => f.id === "FEAT-2")!.services).toEqual([]);
    });
  });

  it("reports intent/delta presence", async () => {
    await withDocs(featureFiles, async (docsDir) => {
      const feats = await listFeatures(docsDir);
      expect(feats.find((f) => f.id === "FEAT-1")!.has).toEqual({ intent: true, delta: true });
      expect(feats.find((f) => f.id === "FEAT-2")!.has).toEqual({ intent: true, delta: false });
    });
  });

  it("ignores loose files under features/", async () => {
    await withDocs({ "features/README.md": "not a feature\n" }, async (docsDir) => {
      expect(await listFeatures(docsDir)).toEqual([]);
    });
  });

  it("orders features numerically by id, not lexically", async () => {
    await withDocs(
      {
        "features/FEAT-10-c/intent.md": "x\n",
        "features/FEAT-2-b/intent.md": "x\n",
        "features/FEAT-1-a/intent.md": "x\n",
      },
      async (docsDir) => {
        const ids = (await listFeatures(docsDir)).map((f) => f.id);
        expect(ids).toEqual(["FEAT-1", "FEAT-2", "FEAT-10"]);
      },
    );
  });

  it("tolerates an archive/ directory holding loose files", async () => {
    await withDocs({ "features/archive/notes.md": "stray\n" }, async (docsDir) => {
      expect(await listFeatures(docsDir, { includeArchived: true })).toEqual([]);
    });
  });
});

describe("resolveFeature", () => {
  const files: Record<string, string> = {
    "features/FEAT-1-split/intent.md": "# split\n",
    "features/FEAT-10-other/intent.md": "# other\n",
    "features/FEAT-3/intent.md": "# bare\n",
    "features/archive/FEAT-0-old/intent.md": "# old\n",
  };

  it("resolves a feature by id when the directory carries a slug", async () => {
    await withDocs(files, async (docsDir) => {
      const feat = await resolveFeature(docsDir, "FEAT-1", "exclude");
      expect(feat?.dirName).toBe("FEAT-1-split");
    });
  });

  it("resolves a directory name to its canonical id — a caller never keeps the raw argument", async () => {
    await withDocs(files, async (docsDir) => {
      const feat = await resolveFeature(docsDir, "FEAT-1-split", "exclude");
      expect(feat?.dirName).toBe("FEAT-1-split");
      expect(feat?.id).toBe("FEAT-1");
    });
  });

  it("resolves a feature whose directory is the bare id", async () => {
    await withDocs(files, async (docsDir) => {
      const feat = await resolveFeature(docsDir, "FEAT-3", "exclude");
      expect(feat?.dirName).toBe("FEAT-3");
    });
  });

  it("does not let FEAT-1 match FEAT-10 (the id is compared whole)", async () => {
    await withDocs(files, async (docsDir) => {
      expect((await resolveFeature(docsDir, "FEAT-1", "exclude"))?.dirName).toBe("FEAT-1-split");
      expect((await resolveFeature(docsDir, "FEAT-10", "exclude"))?.dirName).toBe("FEAT-10-other");
    });
  });

  it("refuses a bare prefix of the id — an argument is a name, not a query", async () => {
    // `loam archive FEAT` used to archive whichever feature sorted first.
    await withDocs(
      {
        "features/FEAT-401-a/intent.md": "# a\n",
        "features/FEAT-402-b/intent.md": "# b\n",
      },
      async (docsDir) => {
        expect(await resolveFeature(docsDir, "FEAT", "exclude")).toBeNull();
        expect(await resolveFeature(docsDir, "FEAT-4", "exclude")).toBeNull();
        expect((await resolveFeature(docsDir, "FEAT-401", "exclude"))?.dirName).toBe("FEAT-401-a");
      },
    );
  });

  it("refuses a slug prefix — 'billing' does not reach into billing-7-rewrite", async () => {
    await withDocs({ "features/billing-7-rewrite/intent.md": "# b\n" }, async (docsDir) => {
      expect(await resolveFeature(docsDir, "billing", "exclude")).toBeNull();
      expect(await resolveFeature(docsDir, "billing-7-rew", "exclude")).toBeNull();
      // both exact spellings still resolve: the canonical id and the directory
      expect((await resolveFeature(docsDir, "billing-7", "exclude"))?.dirName)
        .toBe("billing-7-rewrite");
      expect((await resolveFeature(docsDir, "billing-7-rewrite", "exclude"))?.id).toBe("billing-7");
    });
  });

  it("prefers an exact directory name over a slugged one when both exist", async () => {
    await withDocs(
      {
        "features/FEAT-5/intent.md": "# exact\n",
        "features/FEAT-5-slug/intent.md": "# slug\n",
      },
      async (docsDir) => {
        expect((await resolveFeature(docsDir, "FEAT-5", "exclude"))?.dirName).toBe("FEAT-5");
      },
    );
  });

  it("is deterministic when only slugged candidates collide", async () => {
    await withDocs(
      {
        "features/FEAT-6-zzz/intent.md": "# z\n",
        "features/FEAT-6-aaa/intent.md": "# a\n",
      },
      async (docsDir) => {
        const first = await resolveFeature(docsDir, "FEAT-6", "exclude");
        const second = await resolveFeature(docsDir, "FEAT-6", "exclude");
        expect(first?.dirName).toBe(second?.dirName);
        expect(first?.dirName).toBe("FEAT-6-aaa");
      },
    );
  });

  it("surfaces the collision to a caller that must not guess", async () => {
    await withDocs(
      {
        "features/FEAT-6-zzz/intent.md": "# z\n",
        "features/FEAT-6-aaa/intent.md": "# a\n",
      },
      async (docsDir) => {
        const candidates = await featureCandidates(docsDir, "FEAT-6", "exclude");
        expect(candidates.map((c) => c.dirName)).toEqual(["FEAT-6-aaa", "FEAT-6-zzz"]);
        const message = ambiguousFeatureMessage("FEAT-6", candidates);
        expect(message).toContain("FEAT-6-aaa");
        expect(message).toContain("FEAT-6-zzz");
      },
    );
  });

  it("returns null for an unknown id and for a missing features/ dir", async () => {
    await withDocs(files, async (docsDir) => {
      expect(await resolveFeature(docsDir, "FEAT-999", "exclude")).toBeNull();
    });
    await withDocs({}, async (docsDir) => {
      expect(await resolveFeature(docsDir, "FEAT-1", "exclude")).toBeNull();
    });
  });

  it("'exclude' never reaches into archive/, 'include' does, 'only' reaches nowhere else", async () => {
    await withDocs(files, async (docsDir) => {
      expect(await resolveFeature(docsDir, "FEAT-0", "exclude")).toBeNull();
      const archived = await resolveFeature(docsDir, "FEAT-0", "include");
      expect(archived?.dirName).toBe("FEAT-0-old");
      expect(archived?.archived).toBe(true);
      expect(await resolveFeature(docsDir, "FEAT-0", "only")).toMatchObject({ dirName: "FEAT-0-old" });
      expect(await resolveFeature(docsDir, "FEAT-1", "only")).toBeNull();
    });
  });

  it("'include' prefers an active feature over an archived one; 'only' picks the archived one", async () => {
    await withDocs(
      {
        "features/FEAT-7-live/intent.md": "# live\n",
        "features/archive/FEAT-7-old/intent.md": "# old\n",
      },
      async (docsDir) => {
        const feat = await resolveFeature(docsDir, "FEAT-7", "include");
        expect(feat?.dirName).toBe("FEAT-7-live");
        expect(feat?.archived).toBe(false);
        const shipped = await resolveFeature(docsDir, "FEAT-7", "only");
        expect(shipped?.dirName).toBe("FEAT-7-old");
        expect(shipped?.archived).toBe(true);
      },
    );
  });
});

describe("featureSpecServices", () => {
  it("lists the specs/ subdirectories of a feature, ordered", async () => {
    await withDocs(
      {
        "features/FEAT-1-split/specs/svc-10/spec.md": "x\n",
        "features/FEAT-1-split/specs/svc-2/spec.md": "x\n",
        "features/FEAT-1-split/specs/svc-1/openapi.yaml": "x\n",
      },
      async (docsDir) => {
        const dir = join(docsDir, "features", "FEAT-1-split");
        expect(await featureSpecServices(dir)).toEqual(["svc-1", "svc-2", "svc-10"]);
      },
    );
  });

  it("returns [] when the feature has no specs/ directory", async () => {
    await withDocs({ "features/FEAT-2-x/intent.md": "x\n" }, async (docsDir) => {
      expect(await featureSpecServices(join(docsDir, "features", "FEAT-2-x"))).toEqual([]);
    });
  });
});

describe("path helpers", () => {
  it("servicePaths spells every living service artifact under services/<id>/", () => {
    const p = servicePaths("/docs", rawServiceId("payment-service"));
    expect(p).toEqual({
      dir: join("/docs", "services", "payment-service"),
      model: join("/docs", "services", "payment-service", "model.likec4"),
      spec: join("/docs", "services", "payment-service", "spec.md"),
      archSpec: join("/docs", "services", "payment-service", "arch.spec.md"),
      openapi: join("/docs", "services", "payment-service", "openapi.yaml"),
      asyncapi: join("/docs", "services", "payment-service", "asyncapi.yaml"),
      runbook: join("/docs", "services", "payment-service", "runbook.md"),
      health: join("/docs", "services", "payment-service", "health.yaml"),
      adrsDir: join("/docs", "services", "payment-service", "adrs"),
    });
  });

  it("featurePaths spells the feature-level artifacts", () => {
    const p = featurePaths("/docs/features/FEAT-1-split");
    expect(p).toEqual({
      dir: "/docs/features/FEAT-1-split",
      intent: join("/docs/features/FEAT-1-split", "intent.md"),
      delta: join("/docs/features/FEAT-1-split", "delta.likec4"),
      specsDir: join("/docs/features/FEAT-1-split", "specs"),
      adrsDir: join("/docs/features/FEAT-1-split", "adrs"),
    });
  });

  it("featureSpecPaths spells a feature's per-service delta artifacts", () => {
    const p = featureSpecPaths("/docs/features/FEAT-1-split", "payment-service");
    expect(p).toEqual({
      dir: join("/docs/features/FEAT-1-split", "specs", "payment-service"),
      spec: join("/docs/features/FEAT-1-split", "specs", "payment-service", "spec.md"),
      archSpec: join("/docs/features/FEAT-1-split", "specs", "payment-service", "arch.spec.md"),
      openapi: join("/docs/features/FEAT-1-split", "specs", "payment-service", "openapi.yaml"),
    });
  });

  it("the landscape path is spelled once, under architecture/", async () => {
    await withDocs({}, async (docsDir) => {
      const { landscapePath } = await import("../src/core/repo/paths.js");
      expect(landscapePath(docsDir)).toBe(join(docsDir, "architecture", "landscape.likec4"));
    });
  });
});

describe("docs-repo detection", () => {
  it("a directory with none of the expected subdirs is not a docs repo — services/ makes it one", async () => {
    // This used to read as an empty-but-fine docs repo. A stray directory is
    // not an empty fleet, and the difference is a typo in docsDir.
    await withDocs({}, async (docsDir) => {
      await writeFile(join(docsDir, "loam.docs.json"), '{"version":"0","services":[]}\n', "utf8");
      await expect(listServices(docsDir)).rejects.toBeInstanceOf(DocsRepoUnavailableError);
      // features/ absence, by contrast, means "nothing in flight" and always will
      expect(await listFeatures(docsDir)).toEqual([]);
    });
  });

  it("an empty but real docs repo enumerates to nothing without complaint", async () => {
    await withDocs({}, async (docsDir) => {
      await mkdir(join(docsDir, "services"), { recursive: true });
      expect(await listServices(docsDir)).toEqual([]);
      expect(await listFeatures(docsDir)).toEqual([]);
    });
  });

  it("feature enumeration still refuses a docsDir that is not there at all", async () => {
    await withDocs({}, async (docsDir) => {
      await expect(listFeatures(join(docsDir, "gone"))).rejects
        .toBeInstanceOf(DocsRepoUnavailableError);
    });
  });
});
