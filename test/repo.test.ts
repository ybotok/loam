/**
 * Deep invariant tests for the docs-repo read model (src/core/repo.ts).
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
 *  - resolveFeature: exact / prefix / near-miss / archived / absent
 *  - path helpers: the only place artifact filenames are spelled
 */
import { describe, expect, it } from "vitest";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { makeTmpDir, writeFiles } from "./helpers/harness.js";
import {
  featureIdFromDirName,
  featurePaths,
  featureSpecPaths,
  featureSpecServices,
  listFeatures,
  listServices,
  resolveFeature,
  servicePaths,
} from "../src/core/repo.js";

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

describe("listServices", () => {
  it("returns [] when services/ does not exist", async () => {
    await withDocs({}, async (docsDir) => {
      expect(await listServices(docsDir)).toEqual([]);
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
          runbook: true,
          health: true,
        });
        expect(bare!.has).toEqual({
          model: false,
          spec: true,
          openapi: false,
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
      const feat = await resolveFeature(docsDir, "FEAT-1");
      expect(feat?.dirName).toBe("FEAT-1-split");
    });
  });

  it("resolves a feature whose directory is the bare id", async () => {
    await withDocs(files, async (docsDir) => {
      const feat = await resolveFeature(docsDir, "FEAT-3");
      expect(feat?.dirName).toBe("FEAT-3");
    });
  });

  it("does not let FEAT-1 match FEAT-10 (prefix match respects the id boundary)", async () => {
    await withDocs(files, async (docsDir) => {
      expect((await resolveFeature(docsDir, "FEAT-1"))?.dirName).toBe("FEAT-1-split");
      expect((await resolveFeature(docsDir, "FEAT-10"))?.dirName).toBe("FEAT-10-other");
    });
  });

  it("prefers an exact directory name over a slugged one when both exist", async () => {
    await withDocs(
      {
        "features/FEAT-5/intent.md": "# exact\n",
        "features/FEAT-5-slug/intent.md": "# slug\n",
      },
      async (docsDir) => {
        expect((await resolveFeature(docsDir, "FEAT-5"))?.dirName).toBe("FEAT-5");
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
        const first = await resolveFeature(docsDir, "FEAT-6");
        const second = await resolveFeature(docsDir, "FEAT-6");
        expect(first?.dirName).toBe(second?.dirName);
        expect(first?.dirName).toBe("FEAT-6-aaa");
      },
    );
  });

  it("returns null for an unknown id and for a missing features/ dir", async () => {
    await withDocs(files, async (docsDir) => {
      expect(await resolveFeature(docsDir, "FEAT-999")).toBeNull();
    });
    await withDocs({}, async (docsDir) => {
      expect(await resolveFeature(docsDir, "FEAT-1")).toBeNull();
    });
  });

  it("does not reach into archive/ by default, but does on request", async () => {
    await withDocs(files, async (docsDir) => {
      expect(await resolveFeature(docsDir, "FEAT-0")).toBeNull();
      const archived = await resolveFeature(docsDir, "FEAT-0", { includeArchived: true });
      expect(archived?.dirName).toBe("FEAT-0-old");
      expect(archived?.archived).toBe(true);
    });
  });

  it("prefers an active feature over an archived one with the same id", async () => {
    await withDocs(
      {
        "features/FEAT-7-live/intent.md": "# live\n",
        "features/archive/FEAT-7-old/intent.md": "# old\n",
      },
      async (docsDir) => {
        const feat = await resolveFeature(docsDir, "FEAT-7", { includeArchived: true });
        expect(feat?.dirName).toBe("FEAT-7-live");
        expect(feat?.archived).toBe(false);
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
    const p = servicePaths("/docs", "payment-service");
    expect(p).toEqual({
      dir: join("/docs", "services", "payment-service"),
      model: join("/docs", "services", "payment-service", "model.likec4"),
      spec: join("/docs", "services", "payment-service", "spec.md"),
      openapi: join("/docs", "services", "payment-service", "openapi.yaml"),
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
      openapi: join("/docs/features/FEAT-1-split", "specs", "payment-service", "openapi.yaml"),
    });
  });

  it("the landscape path is spelled once, under architecture/", async () => {
    await withDocs({}, async (docsDir) => {
      const { landscapePath } = await import("../src/core/repo.js");
      expect(landscapePath(docsDir)).toBe(join(docsDir, "architecture", "landscape.likec4"));
    });
  });
});

describe("docs-repo detection", () => {
  it("a directory with none of the expected subdirs is still readable, just empty", async () => {
    await withDocs({}, async (docsDir) => {
      await writeFile(join(docsDir, "loam.docs.json"), '{"version":"0","services":[]}\n', "utf8");
      expect(await listServices(docsDir)).toEqual([]);
      expect(await listFeatures(docsDir)).toEqual([]);
    });
  });
});
