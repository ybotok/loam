/**
 * What `archive` writes down about the verification a feature ships with: the
 * digest of the checklist it asks at the moment of the merge, captured into
 * the undo snapshot's manifest (`core/staging/snapshot/manifest.ts`,
 * `readSnapshotChecklist`).
 *
 * Archive reads no verdict — verify never gates the merge, and nothing here
 * changes that: a record's state decides nothing about whether the archive
 * runs. But once archived, a record is frozen history, and the checklist it
 * could be held to is gone — the merge moves the feature's operations into the
 * living contract, so a derivation after it can only mismatch. That made
 * archiving the cheapest way past `loam gate --since`: a record gone stale
 * read `verified` again the moment its feature shipped. With the question as
 * it stood at the merge written down beside the record, the gate holds the
 * frozen record to the feature that actually shipped, and `list`, `status` and
 * `verify` keep reading it as the frozen history they always did.
 *
 * A module of its own rather than lines in `./run.ts`, which sequences the
 * commit and is near the line limit; this is the one place archive asks the
 * done-check anything.
 */
import { featureChecklist } from "../../core/verify/checklist.js";
import { readVerificationState } from "../../core/verify/read/file.js";
import type { FleetContext } from "../../core/fleet-context.js";
import type { DocsDir, FeatureDir } from "../../core/kernel/ids/dirs.js";

/**
 * The digest a fresh `loam verify` would derive for the feature right now —
 * call it before the first byte of the merge lands — or undefined when there
 * is nothing worth capturing.
 *
 * Only a feature that carries a READABLE record pays for the derivation (it
 * loads the delta into a LikeC4 workspace): with no record, or one nothing can
 * read, the gate's answer is "absent" or "unreadable" whatever the checklist
 * was, so a capture would buy nothing.
 *
 * Every failure is "nothing captured", never a refusal — verify does not gate
 * the archive, and a derivation that could not run must not start to. The
 * gate reads an absent capture as frozen history and says so.
 */
export async function checklistAtArchive(
  read: { docsDir: DocsDir; fleet: FleetContext },
  feature: { id: string; featureDir: FeatureDir },
): Promise<string | undefined> {
  try {
    const record = await readVerificationState(feature.featureDir);
    if (record.state !== "ok") return undefined;
    return (await featureChecklist(read.docsDir, feature.featureDir, feature.id, read.fleet)).digest;
  } catch {
    return undefined;
  }
}
