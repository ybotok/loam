/**
 * The write path on its NON-happy paths.
 *
 * The round trip itself was already covered (archive → unarchive is byte for
 * byte, and the error path rolls back). Everything here is a way the docs repo
 * could be damaged while every loam surface reported success:
 *
 *  - bytes loam cannot decode, rewritten as U+FFFD in the living document AND in
 *    the undo snapshot, after which `unarchive` said the docs were back;
 *  - a snapshot pre-image nothing ever digested, so an edited one was restored
 *    verbatim and `validate --all` certified the result;
 *  - a commit killed between two renames: half-merged living docs that nothing
 *    could detect, that `validate` misdiagnosed as a bad delta, and that the
 *    next archive made permanent by clearing the one snapshot that could repair
 *    them;
 *  - an `x-loam-remove` written at PATH level, published into the fleet's living
 *    contract with no warning and invisible to every detector afterwards;
 *  - a docs repo whose services are mounted by symlink — a layout loam follows
 *    everywhere else — locked out of retrying its own interrupted archive, so
 *    that a repairable half-merge became a permanent one;
 *  - the closing "complete + current" line printed over a fleet the same archive
 *    had just made red.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { readOpenapi } from "../src/core/openapi/doc.js";
import { stripOpenapiRemovalMarkers } from "../src/core/openapi/merge/markers.js";
import { mergeOpenapiPaths } from "../src/core/openapi/merge/merge.js";
import { stageWrites, swapStaged } from "../src/core/staging/commit.js";
import { COMMIT_INTENT, writeCommitIntent } from "../src/core/staging/recovery/intent.js";
import { recoverInterruptedCommit } from "../src/core/staging/recovery/recover.js";
import { scanWritePathResidue } from "../src/core/staging/recovery/residue.js";
import { SNAPSHOT_DIR, SNAPSHOT_MANIFEST, SNAPSHOT_VERSION, SnapshotClobberError, snapshotDir, writeSnapshot } from "../src/core/staging/snapshot.js";
import { NotUtf8Error, planWrite, readUtf8, sha256 } from "../src/core/staging/writes.js";
import {
  coherentFixture,
  LANDSCAPE,
  LIVING_OPENAPI,
  LIVING_SPEC,
  makeProject,
  runLoam,
  SERVICE_MODEL,
  treeHashes,
  type Project,
} from "./helpers/harness.js";

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

/** The living landscape with a Latin-1 name in it — bytes no UTF-8 decoder can read. */
function latin1Landscape(): Buffer {
  return Buffer.from(
    LANDSCAPE.replace("description 'Customer-facing checkout UI'", "description 'Owned by André Muñoz'"),
    "latin1",
  );
}

/**
 * A feature that introduces `fraud-check` on the ARCHITECTURE axis alone: a
 * tagged element with a `metadata { service }` binding and no `specs/<svc>/`
 * anywhere. The fleet gate demands a directory for it the moment this merges.
 */
const ARCH_ONLY_DELTA = `specification {
  element softwareSystem
  tag FEAT-3
}

model {
  paymentService = softwareSystem 'payment-service'
  fraudCheck = softwareSystem 'fraud-check' {
    #FEAT-3
    description 'Scores an authorization for fraud'
    metadata {
      service 'fraud-check'
    }
  }

  paymentService -> fraudCheck 'Calls scoreRisk' {
    #FEAT-3
  }
}

views {
  view feat_3 {
    include *
  }
}
`;

function archOnlyFixture(): Record<string, string> {
  return {
    "architecture/landscape.likec4": LANDSCAPE,
    "services/payment-service/model.likec4": SERVICE_MODEL,
    "services/payment-service/spec.md": LIVING_SPEC,
    "services/payment-service/openapi.yaml": LIVING_OPENAPI,
    "features/FEAT-3-fraud/delta.likec4": ARCH_ONLY_DELTA,
    "features/FEAT-3-fraud/intent.md": `---\nfeature: FEAT-3\nstatus: proposed\nowner: platform\n---\n\n# Fraud scoring\n\nScore each authorization.\n`,
  };
}

function json(out: string): Record<string, unknown> {
  return JSON.parse(out) as Record<string, unknown>;
}

/* ------------------------------------------------------------------ */
/* Non-UTF-8 bytes                                                     */
/* ------------------------------------------------------------------ */

describe("bytes loam cannot decode", () => {
  let p: Project;
  const cleanup = async (): Promise<void> => {
    await p.destroy();
  };

  it("refuses the merge instead of rewriting the file as U+FFFD", async () => {
    p = await makeProject(coherentFixture());
    try {
      await writeFile(join(p.docsDir, "architecture/landscape.likec4"), latin1Landscape());
      const before = await treeHashes(p.docsDir);

      const res = await runLoam(p.workDir, "archive", "FEAT-1", "--json");

      expect(res.code).toBe(1);
      const payload = json(res.stdout);
      expect(payload.ok).toBe(false);
      expect((payload.error as { code: string }).code).toBe("merge-failed");
      expect((payload.error as { message: string }).message).toContain("not valid UTF-8");
      expect((payload.error as { message: string }).message).toContain("landscape.likec4");
      // Nothing written: not the living docs, not a half-created service.
      expect(await treeHashes(p.docsDir)).toEqual(before);
    } finally {
      await cleanup();
    }
  });

  it("keeps the undecodable bytes intact — the corruption used to reach the snapshot too", async () => {
    p = await makeProject(coherentFixture());
    try {
      const bytes = latin1Landscape();
      await writeFile(join(p.docsDir, "architecture/landscape.likec4"), bytes);
      await runLoam(p.workDir, "archive", "FEAT-1");
      const after = await readFile(join(p.docsDir, "architecture/landscape.likec4"));
      expect(after.equals(bytes)).toBe(true);
      expect(after.includes(Buffer.from([0xef, 0xbf, 0xbd]))).toBe(false);
    } finally {
      await cleanup();
    }
  });

  it("names the file when a parser is handed bytes it cannot decode", async () => {
    p = await makeProject(coherentFixture());
    try {
      const path = join(p.docsDir, "architecture/landscape.likec4");
      await writeFile(path, latin1Landscape());
      await expect(readUtf8(path)).rejects.toThrow(NotUtf8Error);
      await expect(readUtf8(path)).rejects.toThrow(path);
    } finally {
      await cleanup();
    }
  });

  it("grades a non-UTF-8 living contract as unreadable rather than as an empty one", async () => {
    p = await makeProject(coherentFixture());
    try {
      const path = join(p.docsDir, "services/payment-service/openapi.yaml");
      await writeFile(path, Buffer.from(LIVING_OPENAPI.replace("Authorize", "Authorisé"), "latin1"));
      const doc = await readOpenapi(path);
      expect(doc.unreadable).toBe(true);
      expect(doc.error).toContain("UTF-8");
      expect(doc.ops).toEqual([]);
    } finally {
      await cleanup();
    }
  });

  it("carries a Buffer end to end, so a planned write of bytes lands byte for byte", async () => {
    p = await makeProject(coherentFixture());
    try {
      const path = join(p.docsDir, "architecture/landscape.likec4");
      const bytes = latin1Landscape();
      const staged = await stageWrites([planWrite(path, bytes)]);
      await swapStaged(staged);
      expect((await readFile(path)).equals(bytes)).toBe(true);
    } finally {
      await cleanup();
    }
  });
});

/* ------------------------------------------------------------------ */
/* The snapshot pre-image                                              */
/* ------------------------------------------------------------------ */

interface Manifest {
  version: number;
  files: Array<{ path: string; existed: boolean; after: string; before: string | null }>;
}

async function readSnapshotManifest(p: Project, dirName: string): Promise<Manifest> {
  const raw = await p.read(`features/archive/${dirName}/${SNAPSHOT_DIR}/${SNAPSHOT_MANIFEST}`);
  return JSON.parse(raw) as Manifest;
}

describe("the snapshot pre-image", () => {
  it("is digested in the manifest, not just written beside it", async () => {
    const p = await makeProject(coherentFixture());
    try {
      expect((await runLoam(p.workDir, "archive", "FEAT-1")).code).toBe(0);
      const manifest = await readSnapshotManifest(p, "FEAT-1-split");
      expect(manifest.version).toBe(SNAPSHOT_VERSION);
      const landscape = manifest.files.find((f) => f.path === "architecture/landscape.likec4")!;
      expect(landscape.existed).toBe(true);
      const preImage = await p.read(
        `features/archive/FEAT-1-split/${SNAPSHOT_DIR}/files/architecture/landscape.likec4`,
      );
      expect(landscape.before).toBe(sha256(preImage));
      // A file archive CREATED has no pre-image, and must not claim a digest for one.
      const created = manifest.files.find((f) => f.path === "services/payment-split-service/spec.md")!;
      expect(created.existed).toBe(false);
      expect(created.before).toBeNull();
    } finally {
      await p.destroy();
    }
  });

  it("refuses to restore an edited pre-image, and --force does not override it", async () => {
    const p = await makeProject(coherentFixture());
    try {
      await runLoam(p.workDir, "archive", "FEAT-1");
      const rel = `features/archive/FEAT-1-split/${SNAPSHOT_DIR}/files/architecture/landscape.likec4`;
      await p.write(rel, (await p.read(rel)).replace("Owns payment authorization/capture", "TEXT NOBODY WROTE"));
      const merged = await treeHashes(p.docsDir);

      const res = await runLoam(p.workDir, "unarchive", "FEAT-1", "--json");
      expect(res.code).toBe(1);
      const payload = json(res.stdout);
      expect((payload.error as { code: string }).code).toBe("snapshot-corrupt");
      expect((payload.error as { message: string }).message).toContain("architecture/landscape.likec4");
      expect((payload.error as { message: string }).message).toContain("version control");

      const forced = await runLoam(p.workDir, "unarchive", "FEAT-1", "--force", "--json");
      expect(forced.code).toBe(1);
      expect((json(forced.stdout).error as { code: string }).code).toBe("snapshot-corrupt");
      // Refused before anything was staged: the living docs are as the archive left them.
      expect(await treeHashes(p.docsDir)).toEqual(merged);
      expect(await p.read("architecture/landscape.likec4")).not.toContain("TEXT NOBODY WROTE");
    } finally {
      await p.destroy();
    }
  });

  it("refuses a snapshot from a loam that recorded no pre-image digests at all", async () => {
    const p = await makeProject(coherentFixture());
    try {
      await runLoam(p.workDir, "archive", "FEAT-1");
      const rel = `features/archive/FEAT-1-split/${SNAPSHOT_DIR}/${SNAPSHOT_MANIFEST}`;
      const manifest = JSON.parse(await p.read(rel)) as Manifest;
      manifest.version = 1;
      for (const f of manifest.files) delete (f as { before?: unknown }).before;
      await p.write(rel, JSON.stringify(manifest, null, 2) + "\n");

      const res = await runLoam(p.workDir, "unarchive", "FEAT-1", "--json");
      expect(res.code).toBe(1);
      const payload = json(res.stdout);
      expect((payload.error as { code: string }).code).toBe("snapshot-missing");
      expect((payload.error as { message: string }).message).toContain("version control");
    } finally {
      await p.destroy();
    }
  });

  it("still round-trips the happy path byte for byte", async () => {
    const p = await makeProject(coherentFixture());
    try {
      const before = await treeHashes(p.docsDir);
      expect((await runLoam(p.workDir, "archive", "FEAT-1")).code).toBe(0);
      expect((await runLoam(p.workDir, "unarchive", "FEAT-1")).code).toBe(0);
      expect(await treeHashes(p.docsDir)).toEqual(before);
    } finally {
      await p.destroy();
    }
  });
});

/* ------------------------------------------------------------------ */
/* An interrupted commit                                               */
/* ------------------------------------------------------------------ */

/**
 * The on-disk state a SIGKILL between two renames leaves: the snapshot and the
 * intent record are written, some of the swaps have landed, and nothing rolled
 * back or cleaned up. Built from staging's OWN primitives, in archive's own
 * order, so it is the real state rather than a description of one.
 */
async function killMidCommit(
  p: Project,
  opts: { swaps: number },
): Promise<{ featureDir: string; landscape: string; before: Buffer }> {
  const featureDir = join(p.docsDir, "features/FEAT-1-split");
  const landscape = join(p.docsDir, "architecture/landscape.likec4");
  const created = join(p.docsDir, "services/payment-split-service/spec.md");
  const before = await readFile(landscape);
  const writes = [
    planWrite(created, "# payment-split-service\n\n## Requirements\n"),
    planWrite(landscape, before.toString("utf8").replace("model {", "model {\n  // merged by FEAT-1")),
  ];
  const staged = await stageWrites(writes);
  await writeSnapshot(featureDir, p.docsDir, { featureId: "FEAT-1", dirName: "FEAT-1-split" }, staged);
  await writeCommitIntent(
    p.docsDir,
    {
      command: "archive",
      restore: "before",
      feature: "FEAT-1",
      moveFrom: featureDir,
      moveTo: join(p.docsDir, "features/archive/FEAT-1-split"),
    },
    staged,
  );
  await swapStaged(staged.slice(0, opts.swaps));
  return { featureDir, landscape, before };
}

describe("a commit killed between two renames", () => {
  it("leaves a record that names the half-merge, and the next command repairs it", async () => {
    const p = await makeProject(coherentFixture());
    try {
      const clean = await treeHashes(p.docsDir);
      const { landscape, before } = await killMidCommit(p, { swaps: 1 });
      // The half-merge is real: one write landed, the other did not.
      expect(p.exists("services/payment-split-service/spec.md")).toBe(true);
      expect((await readFile(landscape)).equals(before)).toBe(true);
      expect(p.exists(COMMIT_INTENT)).toBe(true);

      const recovery = await recoverInterruptedCommit(p.docsDir);
      expect(recovery).not.toBeNull();
      expect(recovery!.outcome).toBe("repaired");
      expect(recovery!.repaired).toEqual(["services/payment-split-service/spec.md"]);
      expect(recovery!.feature).toBe("FEAT-1");
      expect(p.exists(COMMIT_INTENT)).toBe(false);

      // Back to the bytes the killed run found — including the directory it made
      // and the temp file it could not remove.
      await rm(snapshotDir(join(p.docsDir, "features/FEAT-1-split")), { recursive: true, force: true });
      expect(await treeHashes(p.docsDir)).toEqual(clean);
    } finally {
      await p.destroy();
    }
  });

  it("is repaired by `archive`, which then completes the merge it was interrupted in", async () => {
    const p = await makeProject(coherentFixture());
    try {
      await killMidCommit(p, { swaps: 1 });
      const res = await runLoam(p.workDir, "archive", "FEAT-1");
      expect(res.code).toBe(0);
      expect(res.out).toContain("interrupted `loam archive FEAT-1`");
      expect(res.out).toContain("services/payment-split-service/spec.md");
      expect(res.out).toContain("archived: features/FEAT-1-split");
      expect(p.exists(COMMIT_INTENT)).toBe(false);
      // The delta merged for real, not on top of its own half-merge: the living
      // spec holds the feature's requirement, not the stub the killed run wrote.
      expect(await p.read("services/payment-split-service/spec.md")).toContain("Split a payment");
    } finally {
      await p.destroy();
    }
  });

  it("reports it in --json too", async () => {
    const p = await makeProject(coherentFixture());
    try {
      await killMidCommit(p, { swaps: 1 });
      const res = await runLoam(p.workDir, "archive", "FEAT-1", "--json");
      expect(res.code).toBe(0);
      const payload = json(res.stdout);
      expect(payload.recovered).toMatchObject({ command: "archive", feature: "FEAT-1", outcome: "repaired" });
    } finally {
      await p.destroy();
    }
  });

  it("refuses rather than choosing when the half-written file was edited since", async () => {
    const p = await makeProject(coherentFixture());
    try {
      await killMidCommit(p, { swaps: 1 });
      await p.write("services/payment-split-service/spec.md", "# somebody else got here first\n");
      const res = await runLoam(p.workDir, "archive", "FEAT-1", "--json");
      expect(res.code).toBe(1);
      const payload = json(res.stdout);
      expect((payload.error as { code: string }).code).toBe("commit-interrupted");
      expect((payload.error as { message: string }).message).toContain("neither what it found nor what it wrote");
      // Nothing merged on top of a state loam could not explain.
      expect(await p.read("services/payment-split-service/spec.md")).toBe("# somebody else got here first\n");
    } finally {
      await p.destroy();
    }
  });

  it("says the commit had in fact finished when only the record's removal was lost", async () => {
    const p = await makeProject(coherentFixture());
    try {
      const { featureDir } = await killMidCommit(p, { swaps: 2 });
      await mkdir(join(p.docsDir, "features/archive"), { recursive: true });
      await rename(featureDir, join(p.docsDir, "features/archive/FEAT-1-split"));
      const recovery = await recoverInterruptedCommit(p.docsDir);
      expect(recovery!.outcome).toBe("completed");
      expect(recovery!.repaired).toEqual([]);
      expect(p.exists(COMMIT_INTENT)).toBe(false);
    } finally {
      await p.destroy();
    }
  });

  it("refuses a record it cannot read rather than calling the repo healthy", async () => {
    const p = await makeProject(coherentFixture());
    try {
      await p.write(COMMIT_INTENT, "{ this is not json\n");
      const res = await runLoam(p.workDir, "archive", "FEAT-1", "--json");
      expect(res.code).toBe(1);
      expect((json(res.stdout).error as { code: string }).code).toBe("commit-interrupted");
      expect(p.exists("services/payment-split-service/spec.md")).toBe(false);
    } finally {
      await p.destroy();
    }
  });

  it("reports the residue a killed writer leaves, for doctor to grade", async () => {
    const p = await makeProject(coherentFixture());
    try {
      await killMidCommit(p, { swaps: 1 });
      await p.write(
        ".loam-lock",
        JSON.stringify({ pid: 0x7fffffff, host: (await import("node:os")).hostname(), at: new Date().toISOString() }),
      );
      const residue = await scanWritePathResidue(p.docsDir);
      expect(residue.intent?.feature).toBe("FEAT-1");
      expect(residue.intentUnreadable).toBe(false);
      expect(residue.lock?.stale).toBe(true);
      expect(residue.temps.some((t) => t.endsWith(".tmp"))).toBe(true);
      expect(residue.temps.every((t) => !t.includes(".git/"))).toBe(true);
    } finally {
      await p.destroy();
    }
  });

  it("finishes an interrupted RESTORE — there is no merged text to go back to — and a plain re-run completes it", async () => {
    const p = await makeProject(coherentFixture());
    try {
      const clean = await treeHashes(p.docsDir);
      expect((await runLoam(p.workDir, "archive", "FEAT-1")).code).toBe(0);

      // The state a kill mid-restore leaves: the snapshot and the record are in
      // the ARCHIVED feature, one swap landed, the move did not.
      const featureDir = join(p.docsDir, "features/archive/FEAT-1-split");
      const manifest = await readSnapshotManifest(p, "FEAT-1-split");
      const writes = [];
      for (const f of manifest.files) {
        const target = join(p.docsDir, ...f.path.split("/"));
        const pre = f.existed
          ? await readFile(join(featureDir, SNAPSHOT_DIR, "files", ...f.path.split("/")))
          : null;
        writes.push(planWrite(target, pre));
      }
      const staged = await stageWrites(writes);
      await writeCommitIntent(
        p.docsDir,
        {
          command: "unarchive",
          restore: "after",
          feature: "FEAT-1",
          moveFrom: featureDir,
          moveTo: join(p.docsDir, "features/FEAT-1-split"),
        },
        staged,
      );
      await swapStaged(staged.slice(0, 1));

      const res = await runLoam(p.workDir, "unarchive", "FEAT-1");
      expect(res.code).toBe(0);
      expect(res.out).toContain("interrupted `loam unarchive FEAT-1`");
      expect(res.out).toContain("finished them from its snapshot");
      // No `--force`: a file already holding its own pre-image is not a later
      // change to discard, it is where this restore was going.
      expect(res.out).not.toContain("snapshot-stale");
      expect(res.out).toContain("the living docs are back to what they said before the archive.");
      expect(p.exists(COMMIT_INTENT)).toBe(false);
      expect(await treeHashes(p.docsDir)).toEqual(clean);
    } finally {
      await p.destroy();
    }
  });

  it("refuses to clobber a snapshot whose pre-images are the only record of the living text", async () => {
    const p = await makeProject(coherentFixture());
    try {
      const featureDir = join(p.docsDir, "features/FEAT-1-split");
      // A previous archive of this feature that wrote to the living docs and
      // never took them back: its pre-images no longer match what is there.
      await killMidCommit(p, { swaps: 2 });
      const staged = await stageWrites([planWrite(join(p.docsDir, "architecture/landscape.likec4"), "rewritten\n")]);
      await expect(writeSnapshot(featureDir, p.docsDir, { featureId: "FEAT-1", dirName: "FEAT-1-split" }, staged)).rejects.toThrow(
        SnapshotClobberError,
      );
      // The pre-images are still there to repair from.
      expect(existsSync(join(featureDir, SNAPSHOT_DIR, "files/architecture/landscape.likec4"))).toBe(true);
    } finally {
      await p.destroy();
    }
  });
});

/* ------------------------------------------------------------------ */
/* A docs repo composed of symlinks                                    */
/* ------------------------------------------------------------------ */

/**
 * Move `services/<service>/` out to a sibling checkout and mount it back by
 * symlink — how a worktree, a submodule, or one service's directory shared
 * between two checkouts actually arrives. loam follows these links rather than
 * refusing them (core/repo/repo.ts's `entryIs` says why in full), so every write-path
 * question asked about a file under one has to be answerable too.
 */
async function mountServiceFromSibling(p: Project, service: string): Promise<string> {
  const mounted = join(p.docsDir, "services", service);
  const checkout = join(p.docsDir, "..", "checkouts", service);
  await mkdir(dirname(checkout), { recursive: true });
  await rename(mounted, checkout);
  await symlink(checkout, mounted, "dir");
  return checkout;
}

/** The snapshot an ACTIVE (not yet archived) feature directory carries. */
function activeManifestPath(p: Project, dirName: string): string {
  return join(p.docsDir, "features", dirName, SNAPSHOT_DIR, SNAPSHOT_MANIFEST);
}

describe("a docs repo whose services are mounted by symlink", () => {
  it("can retry an archive that died mid-commit over a mounted service", async () => {
    const p = await makeProject(coherentFixture());
    try {
      await mountServiceFromSibling(p, "payment-service");
      const featureDir = join(p.docsDir, "features/FEAT-1-split");
      const spec = join(p.docsDir, "services/payment-service/spec.md");
      const living = await readFile(spec);

      // What a run killed before its first rename leaves behind: a snapshot
      // naming a file that lives on the far side of the mount, and living docs
      // that still say exactly what its pre-image does.
      const first = await stageWrites([planWrite(spec, living.toString("utf8") + "\n<!-- merged by FEAT-1 -->\n")]);
      await writeSnapshot(featureDir, p.docsDir, { featureId: "FEAT-1", dirName: "FEAT-1-split" }, first);
      const manifest = JSON.parse(await readFile(activeManifestPath(p, "FEAT-1-split"), "utf8")) as Manifest;
      expect(manifest.files.map((f) => f.path)).toContain("services/payment-service/spec.md");

      // The retry. Resolving that row through the realpath check refused it —
      // the mount leaves the docs repo — so this threw `SnapshotClobberError`
      // for as long as the service stayed mounted: `archive` could never run
      // again, the operator was told an intact snapshot was unreadable, and the
      // half-merge it is the only record of could never be repaired.
      const second = await stageWrites([planWrite(spec, living.toString("utf8") + "\n<!-- merged by FEAT-1 -->\n")]);
      await writeSnapshot(featureDir, p.docsDir, { featureId: "FEAT-1", dirName: "FEAT-1-split" }, second);
      const rewritten = JSON.parse(await readFile(activeManifestPath(p, "FEAT-1-split"), "utf8")) as Manifest;
      expect(rewritten.files.map((f) => f.path)).toContain("services/payment-service/spec.md");
      expect(existsSync(join(featureDir, SNAPSHOT_DIR, "files/services/payment-service/spec.md"))).toBe(true);
    } finally {
      await p.destroy();
    }
  });

  it("still refuses a manifest row spelled as a path the docs repo does not own", async () => {
    const p = await makeProject(coherentFixture());
    try {
      const checkout = await mountServiceFromSibling(p, "payment-service");
      const featureDir = join(p.docsDir, "features/FEAT-1-split");
      const spec = join(p.docsDir, "services/payment-service/spec.md");
      const staged = await stageWrites([planWrite(spec, "# rewritten\n")]);
      await writeSnapshot(featureDir, p.docsDir, { featureId: "FEAT-1", dirName: "FEAT-1-split" }, staged);
      const manifestFile = activeManifestPath(p, "FEAT-1-split");
      const original = JSON.parse(await readFile(manifestFile, "utf8")) as Manifest;

      // Following the mount is not the same as accepting any spelling: the first
      // two of these name the very file the mount reaches, and are refused
      // anyway, because the rule is about what the manifest is allowed to SAY.
      const spellings = [
        "../checkouts/payment-service/spec.md",
        join(checkout, "spec.md"),
        "services\\payment-service\\spec.md",
      ];
      for (const spelling of spellings) {
        await writeFile(
          manifestFile,
          JSON.stringify({ ...original, files: original.files.map((f) => ({ ...f, path: spelling })) }, null, 2) + "\n",
          "utf8",
        );
        const retry = await stageWrites([planWrite(spec, "# rewritten again\n")]);
        const rejection: unknown = await writeSnapshot(featureDir, p.docsDir, { featureId: "FEAT-1", dirName: "FEAT-1-split" }, retry).then(
          () => undefined,
          (err: unknown) => err,
        );
        expect(rejection).toBeInstanceOf(SnapshotClobberError);
        expect((rejection as Error).message).toContain(spelling);
        // The refusal kept the pre-images it exists to keep.
        expect(existsSync(join(featureDir, SNAPSHOT_DIR, "files/services/payment-service/spec.md"))).toBe(true);
      }
    } finally {
      await p.destroy();
    }
  });
});

/* ------------------------------------------------------------------ */
/* A loam marker at PATH level                                         */
/* ------------------------------------------------------------------ */

const LIVING_WITH_PATH = `openapi: 3.1.0
info:
  title: payment-service
  version: "1.0"
paths:
  /payments/authorize:
    post:
      operationId: authorizePayment
      summary: Authorize a payment
      responses:
        "200":
          description: Authorized
`;

const FEATURE_PATH_MARKER = `openapi: 3.1.0
info:
  title: payment-service
  version: "1.0"
paths:
  /payments/authorize:
    x-loam-remove: true
    post:
      operationId: authorizePayment
      summary: Authorize a payment, fast
      responses:
        "200":
          description: Authorized
`;

describe("an x-loam-remove written at PATH level", () => {
  it("is never published into the living contract by the merge", () => {
    const merged = mergeOpenapiPaths(LIVING_WITH_PATH, FEATURE_PATH_MARKER, "payment-service");
    expect(merged.text).not.toBeNull();
    expect(merged.text).not.toContain("x-loam-remove");
    expect(merged.text).toContain("Authorize a payment, fast");
    // It is not a key of the contract, so it is not a path-item overwrite either.
    expect(merged.pathItemModified).toEqual([]);
    expect(merged.removed).toEqual([]);
  });

  it("does not publish an operation-less phantom path when it is all the delta says", () => {
    const featureOnlyMarker = `openapi: 3.1.0
info:
  title: payment-service
  version: "1.0"
paths:
  /payments/refund:
    x-loam-remove: true
`;
    const merged = mergeOpenapiPaths(LIVING_WITH_PATH, featureOnlyMarker, "payment-service");
    expect(merged.text ?? LIVING_WITH_PATH).not.toContain("/payments/refund");
    expect(merged.text ?? LIVING_WITH_PATH).not.toContain("x-loam-remove");
  });

  it("is stripped by the feature-side strip too, so both branches agree", () => {
    const stripped = stripOpenapiRemovalMarkers(FEATURE_PATH_MARKER, "payment-service");
    expect(stripped).not.toContain("x-loam-remove");
    expect(stripped).toContain("operationId: authorizePayment");
  });

  it("is visible to the reader, which is method-keyed everywhere else", async () => {
    const p = await makeProject(coherentFixture());
    try {
      await p.write("services/payment-service/openapi.yaml", FEATURE_PATH_MARKER);
      const doc = await readOpenapi(join(p.docsDir, "services/payment-service/openapi.yaml"));
      expect(doc.pathLevelRemovals).toEqual(["/payments/authorize"]);
      // The operation beside it is not a removal — only the path item is marked.
      expect(doc.anonymousRemovals).toEqual([]);
      expect(doc.ops.map((o) => o.id)).toEqual(["authorizePayment"]);
    } finally {
      await p.destroy();
    }
  });

  it("gates the archive as an authoring error, and stays out of the living docs under --approve", async () => {
    const files = coherentFixture();
    files["features/FEAT-1-split/specs/payment-split-service/openapi.yaml"] = files[
      "features/FEAT-1-split/specs/payment-split-service/openapi.yaml"
    ]!.replace("  /splits:\n", "  /splits:\n    x-loam-remove: true\n");
    const p = await makeProject(files);
    try {
      const res = await runLoam(p.workDir, "archive", "FEAT-1", "--json");
      expect(res.code).toBe(1);
      const payload = json(res.stdout);
      expect((payload.error as { code: string }).code).toBe("not-coherent");
      const codes = (payload.issues as Array<{ code: string }>).map((f) => f.code);
      expect(codes).toContain("openapi.remove-marker-path-level");

      const approved = await runLoam(p.workDir, "archive", "FEAT-1", "--approve", "--json");
      expect(approved.code).toBe(0);
      const over = (json(approved.stdout).overridden as Array<{ code: string }>).map((f) => f.code);
      expect(over).toContain("openapi.remove-marker-path-level");
      expect(await p.read("services/payment-split-service/openapi.yaml")).not.toContain("x-loam-remove");
    } finally {
      await p.destroy();
    }
  });
});

/* ------------------------------------------------------------------ */
/* The closing claim                                                   */
/* ------------------------------------------------------------------ */

describe("the closing completeness claim", () => {
  it("is withheld for a service that arrives on the architecture axis alone", async () => {
    const p = await makeProject(archOnlyFixture());
    try {
      const res = await runLoam(p.workDir, "archive", "FEAT-3");
      expect(res.code).toBe(0);
      expect(res.out).not.toContain("living spec + landscape are now complete + current.");
      expect(res.out).toContain("the fleet has no services/fraud-check/ at all");
      // …because the same archive just made the fleet gate red.
      const gate = await runLoam(p.workDir, "validate", "--all", "--json");
      expect(gate.code).toBe(1);
    } finally {
      await p.destroy();
    }
  });

  it("names that service in --json, under the same code as one with a requirement delta", async () => {
    const p = await makeProject(archOnlyFixture());
    try {
      const res = await runLoam(p.workDir, "archive", "FEAT-3", "--json");
      expect(res.code).toBe(0);
      const warnings = json(res.stdout).warnings as Array<{ code: string; subject?: string }>;
      expect(warnings).toContainEqual(
        expect.objectContaining({ code: "service.no-model", subject: "fraud-check" }),
      );
    } finally {
      await p.destroy();
    }
  });

  it("is withheld when --approve merged past a gate", async () => {
    const files = coherentFixture();
    files["features/FEAT-1-split/specs/payment-split-service/openapi.yaml"] = files[
      "features/FEAT-1-split/specs/payment-split-service/openapi.yaml"
    ]!.replace("  /splits:\n", "  /splits:\n    x-loam-remove: true\n");
    const p = await makeProject(files);
    try {
      const res = await runLoam(p.workDir, "archive", "FEAT-1", "--approve");
      expect(res.code).toBe(0);
      expect(res.out).not.toContain("living spec + landscape are now complete + current.");
      expect(res.out).toContain("merged past 1 gating issue(s) with --approve");
    } finally {
      await p.destroy();
    }
  });
});

/* ------------------------------------------------------------------ */
/* Guards on the helpers this file leans on                            */
/* ------------------------------------------------------------------ */

it("leaves no staging temp file behind on the happy path", async () => {
  const p = await makeProject(coherentFixture());
  try {
    await runLoam(p.workDir, "archive", "FEAT-1");
    const leftovers: string[] = [];
    const walk = async (dir: string): Promise<void> => {
      for (const e of await readdir(dir, { withFileTypes: true })) {
        if (e.isDirectory()) await walk(join(dir, e.name));
        else if (e.name.endsWith(".tmp")) leftovers.push(join(dirname(join(dir, e.name)), e.name));
      }
    };
    await walk(p.docsDir);
    expect(leftovers).toEqual([]);
  } finally {
    await p.destroy();
  }
});
