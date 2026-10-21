/**
 * Rewrite a snapshot this loam just wrote into the layout an OLDER loam wrote —
 * the fixture every "snapshots from before the bump are read forever" case
 * needs, spelled once.
 *
 * Two things changed between the layouts, and a downgrade has to undo both or it
 * builds a snapshot no loam ever wrote: version 4 stores each pre-image under
 * its living name plus `PRE_IMAGE_SUFFIX` (versions 2 and 3 used the bare
 * name), and version 3 added the `(service, artifact)` keys version 2 never
 * carried. Rewriting only the manifest's `version` left the pre-images where no
 * older reader looks, and the case then measured a missing file instead of the
 * layout it named.
 */
import { readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PRE_IMAGE_SUFFIX, SNAPSHOT_DIR, SNAPSHOT_MANIFEST } from "../../src/core/staging/snapshot/manifest.js";

interface Row {
  path: string;
  before: string | null;
  service?: string;
  artifact?: string;
}

/** `featureDir` is the feature's directory, active or archived; `version` the layout to leave it in. */
export async function downgradeSnapshot(featureDir: string, version: 2 | 3): Promise<void> {
  const dir = join(featureDir, SNAPSHOT_DIR);
  const manifest = JSON.parse(await readFile(join(dir, SNAPSHOT_MANIFEST), "utf8")) as { version: number; files: Row[] };
  manifest.version = version;
  for (const row of manifest.files) {
    if (row.before !== null) {
      const at = join(dir, "files", ...row.path.split("/"));
      await rename(`${at}${PRE_IMAGE_SUFFIX}`, at);
    }
    if (version === 2) {
      delete row.service;
      delete row.artifact;
    }
  }
  await writeFile(join(dir, SNAPSHOT_MANIFEST), JSON.stringify(manifest, null, 2) + "\n", "utf8");
}
