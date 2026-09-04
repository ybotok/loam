/**
 * One service's context pack: the exact docs slice bound to a service —
 * living requirements verbatim, both contracts, the fleet edges one hop out,
 * the permission and capability joins, provenance, and every active feature's
 * delta over it — assembled as one deterministic payload an agent loads before
 * working in that service's repository.
 *
 * Core rather than the command, exactly as `core/explore/explore.ts` sits
 * behind `loam explore`: a future facade (an MCP tool, a second renderer)
 * reuses the assembly without the printing, and the command layer stays I/O.
 * Deterministic by construction — identical state must yield identical bytes:
 * no timestamps, repo-relative forward-slash paths only, every unioned set
 * sorted with `compareIds`, contract entries in document order (a fact of the
 * file, hence of the state).
 */
import { FleetContext } from "../fleet-context.js";
import { repoPath } from "../envelope/json.js";
import { type FeatureEntry, type ServiceEntry } from "../repo/entries.js";
import { buildLiving, type LivingSlice } from "./living.js";
import { buildJoins, type JoinsSlice } from "./joins.js";
import { buildFeatures, type PackFeature } from "./features.js";
import type { DocsDir } from "../kernel/ids/dirs.js";

export interface PackRequest {
  docsDir: DocsDir;
  /** The service, as the enumeration answered it — the entry, not an id and a dir (rule 17). */
  entry: ServiceEntry;
  /** The one feature `--feature` resolved, or null for every touching feature. */
  feature: FeatureEntry | null;
  context: FleetContext;
}

export interface ContextPack extends LivingSlice, JoinsSlice {
  service: string;
  path: string;
  /**
   * The canonical id of the one feature `--feature` narrowed to, or null for
   * the everything-in-flight default. Echoed so a stored pack SAYS it is a
   * narrowed view: two packs of the same service can otherwise differ only by
   * what they silently left out, and an agent diffing them (or resuming from
   * one) has no way to tell a narrowed pack from a fleet gone quiet.
   */
  feature: string | null;
  features: PackFeature[];
}

/**
 * Assemble the pack. Reads only; writes nothing, and refuses nothing — every
 * miss is a field, and an unreadable DOCUMENT is a flag the caller grades
 * (`packHoles`). What does throw — an unreadable directory, bytes that are
 * not UTF-8 — is the all-or-nothing class explore takes too: the honest
 * answer is a refusal naming the path, not a pack with a silent hole.
 */
export async function assemblePack(req: PackRequest): Promise<ContextPack> {
  const { docsDir, entry, feature, context } = req;
  // The three sections are independent derivations over one shared read
  // index; identical reads share their in-flight promise, so the fan-out
  // costs no duplicate I/O and no section can see a different file version.
  const [living, joins, features] = await Promise.all([
    buildLiving({ docsDir, entry, context }),
    buildJoins({ docsDir, entry, context }),
    buildFeatures({ docsDir, entry, feature, context }),
  ]);
  return {
    service: entry.id,
    path: repoPath(docsDir, entry.dir),
    feature: feature === null ? null : feature.id,
    ...living,
    ...joins,
    features,
  };
}

/**
 * Whether the pack has a silent hole: a document that exists but could not be
 * read, so a section that LOOKS empty is really unanswered. The command maps
 * this to exit 1 with `ok: true` — delta's precedent, same reasoning: the
 * pack is consumed by agents that never ran validate, so the exit code must
 * carry the failure itself. Set before the format fork; the guard is about
 * the pack, not about how it is rendered.
 */
export function packHoles(pack: ContextPack): boolean {
  return (
    (pack.landscape.present && !pack.landscape.parses) ||
    pack.openapi.unreadable ||
    pack.asyncapi.unreadable ||
    // The two fleet vocabularies and the rollup's fleet walk fail the same
    // way the contracts do: an unreadable file EMPTIES a section (`declared:
    // false` on every permission, "(none realized here)") while looking like
    // an answer, so their health is part of the hole contract, not decoration.
    pack.permissionsVocabulary.invalid !== undefined ||
    pack.capabilitiesVocabulary.invalid !== undefined ||
    pack.capabilitiesUnread.length > 0 ||
    // The use-case axis fails the same way, and it is still its own clause
    // after `landscape.parses` learned to answer for the whole `architecture/`
    // PROJECT (core/pack/living.ts). It used to be strictly wider: that flag
    // was about `architecture/landscape.likec4` alone, so a use-case file with
    // an unresolved element left it true and emptied every flow in the pack.
    // The two now flip together on a fleet that HAS a landscape — and the one
    // that has none is why this clause stays: `landscape.present` gates the
    // first, so a repo whose only map documents are broken `usecases/*.likec4`
    // would otherwise report a whole empty axis at exit 0.
    pack.useCaseScan.unreadable ||
    pack.features.some(
      (f) => f.architecture.errors.length > 0 || f.openapi.unreadable || f.events.unreadable,
    )
  );
}
