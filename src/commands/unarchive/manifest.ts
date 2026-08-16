/**
 * The snapshot manifest, validated before a single byte is written back.
 *
 * `unarchive` says "I put your docs back", and that sentence must never be
 * sayable over a pre-image edited in the archived feature directory since. Each
 * entry carries the digest of what archive WROTE and the digest of what will be
 * RESTORED, and this is where both are checked — version, timestamp, feature
 * name, duplicate paths and all — so the restore below it can assume the file
 * describes the archive it claims to.
 */
import { existsSync, lstatSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { type ErrorCode } from "../../core/envelope/json.js";
import { resolveInside, resolvePortableFileInside } from "../../core/kernel/path-safety.js";
import { isRecord } from "../../core/kernel/records.js";
import {
  SNAPSHOT_DIR,
  SNAPSHOT_MANIFEST,
  SNAPSHOT_VERSION,
  type SnapshotManifest,
} from "../../core/staging/snapshot.js";

export class RestoreFailure extends Error {
  constructor(
    readonly code: ErrorCode,
    msg: string,
  ) {
    super(msg);
  }
}

export interface ValidatedSnapshotEntry {
  path: string;
  existed: boolean;
  after: string;
  /** sha256 the pre-image beside the manifest must still have; null when archive created the destination. */
  before: string | null;
  /** Contained destination under the docs repo. */
  target: string;
  /** Contained pre-image, or null when archive created the destination. */
  snapshot: string | null;
}

export interface ValidatedSnapshotManifest extends Omit<SnapshotManifest, "files"> {
  files: ValidatedSnapshotEntry[];
}

export async function readManifest(
  featureDir: string,
  docsDir: string,
  featureId: string,
  dirName: string,
): Promise<ValidatedSnapshotManifest | null> {
  try {
    const path = resolveInside(
      featureDir,
      join(SNAPSHOT_DIR, SNAPSHOT_MANIFEST),
      "snapshot manifest path",
    );
    if (!existsSync(path)) return null;
    const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
    if (!isRecord(parsed)) return null;
    if (parsed.version !== SNAPSHOT_VERSION) return null;
    if (parsed.feature !== featureId || parsed.dirName !== dirName) return null;
    if (typeof parsed.archivedAt !== "string" || !isCanonicalIsoDate(parsed.archivedAt)) return null;
    if (!Array.isArray(parsed.files)) return null;

    const seen = new Set<string>();
    const files: ValidatedSnapshotEntry[] = [];
    for (const raw of parsed.files) {
      if (!isRecord(raw)) return null;
      if (typeof raw.path !== "string" || typeof raw.existed !== "boolean") return null;
      if (typeof raw.after !== "string" || !/^[0-9a-f]{64}$/.test(raw.after)) return null;
      // A manifest that claims a pre-image must say what it should hash to, and
      // one that claims none must not. Either way it is a shape question, so it
      // is answered here with the rest of them; whether the bytes MATCH is a
      // different answer with its own code (`snapshot-corrupt`).
      if (raw.existed ? typeof raw.before !== "string" || !/^[0-9a-f]{64}$/.test(raw.before) : raw.before !== null) {
        return null;
      }
      const before = raw.existed ? (raw.before as string) : null;
      if (seen.has(raw.path)) return null;
      seen.add(raw.path);

      // The realpath test stays on this side, and it is not negotiable: this
      // path is WRITTEN through. A symlink that leaves the repo is
      // indistinguishable, lexically, from a service directory the operator
      // mounted on purpose — `escape/owned.txt` and `services/<svc>/spec.md`
      // are both "inside docsDir" until something resolves them — so the only
      // check that can refuse the first is the one that also refuses the
      // second. Restoring is the write; `staging.ts` only reads and compares a
      // digest, which is why its resolution of this same field can be lexical
      // and this one cannot.
      const target = resolvePortableFileInside(docsDir, raw.path, `snapshot path '${raw.path}'`);
      let snapshot: string | null = null;
      const snapshotRel = `${SNAPSHOT_DIR}/files/${raw.path}`;
      if (raw.existed) {
        // Resolve from the feature directory, which always exists. The `files/`
        // directory legitimately does not exist when every archive write was a
        // creation; anchoring here permits that case while still inspecting an
        // existing `files` component for symlink escape.
        snapshot = resolvePortableFileInside(featureDir, snapshotRel, `snapshot pre-image '${raw.path}'`);
        // Archive writes plain files. A missing pre-image or a symlink (even an
        // internally-contained one) is not the byte snapshot this manifest
        // claims, so refuse before any destination is staged.
        if (!existsSync(snapshot) || !lstatSync(snapshot).isFile()) return null;
      } else {
        const unexpected = resolvePortableFileInside(featureDir, snapshotRel, `snapshot pre-image '${raw.path}'`);
        if (existsSync(unexpected)) return null;
      }
      files.push({ path: raw.path, existed: raw.existed, after: raw.after, before, target, snapshot });
    }

    return {
      version: SNAPSHOT_VERSION,
      feature: featureId,
      dirName,
      archivedAt: parsed.archivedAt,
      files,
    };
  } catch {
    return null;
  }
}

export function isCanonicalIsoDate(value: string): boolean {
  const millis = Date.parse(value);
  return Number.isFinite(millis) && new Date(millis).toISOString() === value;
}

/** Remove `dir` and each empty ancestor, stopping short of `stopAt`. Best effort. */
