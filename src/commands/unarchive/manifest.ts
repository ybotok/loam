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
  SNAPSHOT_COMPAT_VERSION,
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

/**
 * `readManifest`'s inputs, as one object. `serviceDirOf` is the restore-time
 * half of the version-3 re-keying: a service id → its CURRENT docs-relative
 * directory per the enumeration, or null when no such service is enumerated.
 * Injected by the caller (which holds the enumeration) rather than resolved
 * here, so this module keeps validating one file against one repo state.
 */
export interface ManifestRequest {
  featureDir: string;
  docsDir: string;
  featureId: string;
  dirName: string;
  serviceDirOf: (service: string) => string | null;
}

export async function readManifest(request: ManifestRequest): Promise<ValidatedSnapshotManifest | null> {
  const { featureDir, docsDir, featureId, dirName } = request;
  try {
    const path = resolveInside(
      featureDir,
      join(SNAPSHOT_DIR, SNAPSHOT_MANIFEST),
      "snapshot manifest path",
    );
    if (!existsSync(path)) return null;
    const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
    if (!isRecord(parsed)) return null;
    // Version 3 is what archive writes; version 2 is read forever under its own
    // literal-path rules, because version-2 snapshots already sit in archived
    // features and travel with them across loam upgrades. Version 1 stays
    // refused: it records nothing about its restore source.
    if (typeof parsed.version !== "number") return null;
    if (parsed.version !== SNAPSHOT_VERSION && parsed.version !== SNAPSHOT_COMPAT_VERSION) return null;
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

      // The version-3 shape rule, exact in both directions: a `services/` row
      // carries its (service, artifact) key — that key is what version 3 IS,
      // and a row without one is not a manifest this loam wrote — while a row
      // anywhere else carries none, because nothing outside `services/` moves.
      // Version-2 rows never carry the fields and are not asked to.
      const key = readServiceKey(parsed.version, raw);
      if (key === undefined) return null;

      // Where the file lives NOW. A re-keyed row resolves through the current
      // enumeration — the whole point of the bump: the bytes land wherever the
      // service lives today, not where it lived on the day of the archive. An
      // id the enumeration does not answer falls back to the literal path
      // (an absent service restores as a create, exactly as before).
      let targetRel = raw.path;
      if (key !== null) {
        const current = request.serviceDirOf(key.service);
        if (current !== null) targetRel = `${current}/${key.artifact}`;
      }
      // The realpath test stays on this side, and it is not negotiable: this
      // path is WRITTEN through. A symlink that leaves the repo is
      // indistinguishable, lexically, from a service directory the operator
      // mounted on purpose — `escape/owned.txt` and `services/<svc>/spec.md`
      // are both "inside docsDir" until something resolves them — so the only
      // check that can refuse the first is the one that also refuses the
      // second. Restoring is the write; `staging.ts` only reads and compares a
      // digest, which is why its resolution of this same field can be lexical
      // and this one cannot.
      const target = resolvePortableFileInside(docsDir, targetRel, `snapshot path '${raw.path}'`);
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
      // The version as WRITTEN, not as preferred: a caller looking at a
      // validated manifest deserves to know which rules it was read under.
      version: parsed.version,
      feature: featureId,
      dirName,
      archivedAt: parsed.archivedAt,
      files,
    };
  } catch {
    return null;
  }
}

/**
 * The (service, artifact) key of one manifest row, under its version's shape
 * rule. Three answers: the key; null when the row legitimately carries none (a
 * non-`services/` row, or any version-2 row — the key postdates version 2);
 * undefined when the row breaks the rule and the manifest must be refused
 * whole, because a half-keyed or wrongly-keyed row is not a record this loam
 * wrote and nothing can say what else in the file to distrust.
 */
function readServiceKey(
  version: number,
  raw: Record<string, unknown>,
): { service: string; artifact: string } | null | undefined {
  if (version !== SNAPSHOT_VERSION) return null;
  const under = typeof raw.path === "string" && raw.path.startsWith("services/");
  if (!under) return raw.service === undefined && raw.artifact === undefined ? null : undefined;
  // The id is a lookup key into the enumeration and the artifact is joined
  // under the resolved directory, so the id must be a single path segment; the
  // artifact's own containment is `resolvePortableFileInside`'s question.
  if (typeof raw.service !== "string" || raw.service.length === 0 || raw.service.includes("/")) return undefined;
  if (typeof raw.artifact !== "string" || raw.artifact.length === 0) return undefined;
  return { service: raw.service, artifact: raw.artifact };
}

export function isCanonicalIsoDate(value: string): boolean {
  const millis = Date.parse(value);
  return Number.isFinite(millis) && new Date(millis).toISOString() === value;
}

/** Remove `dir` and each empty ancestor, stopping short of `stopAt`. Best effort. */
