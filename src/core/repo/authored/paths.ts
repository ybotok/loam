/**
 * WHERE THE TWO AUTHORED VOCABULARY TREES LIVE — `capabilities/<id>/` and
 * `glossary/<term>.md`.
 *
 * Split out of `../paths.ts` when that file passed 400 lines, and along the seam
 * that was already there rather than at the line the count happened to land on:
 * everything left in the parent spells the layout loam MAINTAINS — a service's
 * artifacts, a feature's deltas, the generated views — while these two spell the
 * trees a human AUTHORS and loam only reads. They share a rule the parent's
 * paths do not have: the directory IS the list, its existence is the axis's
 * opt-in, and `loam init` scaffolds neither.
 *
 * `ARTIFACT_FILES` is imported back from the parent rather than restated. The
 * capability document is `spec.md` because it is the same grammar read by the
 * same parser as a service's, and a second spelling of that name is exactly the
 * drift the parent's one-table rule exists to prevent.
 */
import { join } from "node:path";
import { ARTIFACT_FILES } from "../paths.js";
import type { DocsDir, FeatureDir } from "../../kernel/ids/dirs.js";

/**
 * The AUTHORED business tree — `capabilities/<id>/`, one directory per
 * capability, each holding the document that describes it.
 *
 * Top-level and not under `architecture/`, because the two altitudes have
 * different authors and different reasons to change: `architecture/` is the
 * architect's — the map, the vocabularies, the use cases — while a capability
 * document is the analyst's, and it must survive every redesign of the fleet
 * that realizes it. A business tree filed inside the architecture tree would
 * say the opposite of what the axis is for.
 *
 * NESTING IS SPELLED BY THE TREE, not inside a name. A capability id keeps its
 * slashes wherever it is written (`core/capabilities/capabilities.ts` preserves
 * the YAML key exactly as a `Capability:` line spells it), so `payments/refunds`
 * lives at `capabilities/payments/refunds/spec.md` and `payments` may be a
 * capability in its own right at `capabilities/payments/spec.md`. A directory is
 * a capability if and only if it holds the document — the same
 * presence-classifies rule `isServiceArtifactName` applies one tree over, and
 * the reason it is safe here too: a group directory that acquires a document
 * becomes a capability visibly, in a diff, rather than by a marker file nobody
 * updated.
 *
 * NOT SCAFFOLDED BY `loam init`, exactly as `architecture/adrs/` is not. git
 * does not carry an empty directory, so a scaffolded one vanishes on the first
 * clone and returns as a diff on the next `init`; and an empty `capabilities/`
 * in a fresh repo reads as an obligation nobody has met, when a fleet that has
 * not adopted the axis owes nothing. The directory's EXISTENCE is the opt-in.
 */
export function capabilityDocsDir(docsDir: DocsDir): string {
  return join(docsDir, "capabilities");
}

export interface CapabilityDocPaths {
  dir: string;
  /**
   * The capability's own document: narrative and requirements in one file.
   * `spec.md`, the same name a service's requirements live under, because it is
   * the same grammar read by the same parser — a second spelling would be a
   * second thing to keep in step for no reader's benefit.
   */
  spec: string;
}

/**
 * The document paths of a capability whose directory is already KNOWN — the
 * enumeration's `dir`, at whatever depth the walk found it. Same discipline as
 * `servicePathsAt`: joining `capabilities/<id>/` at the root is only true for a
 * flat id, and a nested capability would silently grade as absent through it.
 */
export function capabilityDocPathsAt(dir: string): CapabilityDocPaths {
  return { dir, spec: join(dir, ARTIFACT_FILES.spec) };
}

/**
 * The LIVING document a capability id addresses — `capabilities/` with the id's
 * own nesting spelled back out as directories, so `payments/refunds` resolves to
 * `capabilities/payments/refunds/spec.md`.
 *
 * Spelled here because FIVE readers need it — the delta grade, the archive
 * merge, the conflict-marker scan, the archive gate's strayed-requirement scan
 * and `loam rebase` — and a reader that resolved it differently would disagree
 * about which document a feature is changing. The delta grade is where that costs most: a living path that finds
 * nothing reads as an empty document, so every ADDED looks new and no
 * `Based-On:` is ever compared, and the merge then lands over text nobody
 * re-read.
 *
 * `...id.split("/")` rather than passing the id whole is explicitness, not a
 * fix: `node:path.join` already normalizes an embedded separator, so both
 * spellings resolve identically on every platform. The split is what makes the
 * nesting visible at the one place the rule is written down. The mistake this
 * function actually prevents is the OTHER one — resolving a nested id by its
 * leaf, which silently addresses a different capability.
 *
 * `id` IS caller-controlled path input and carries no brand, for the reason
 * `capabilityDocPathsAt` above takes a bare `dir`: a capability id has no
 * grammar — it is a YAML key and a directory name, constrained nowhere — so
 * there is nothing for a smart constructor to validate. What holds the join is
 * PROVENANCE, and every caller owes it: the id must have come from a
 * `readCapabilityTree` walk, where each component is a `readdir` entry name.
 * An id read out of `architecture/capabilities.yaml` has not, and must not
 * reach here.
 */
export function livingCapabilityPaths(docsDir: DocsDir, id: string): CapabilityDocPaths {
  return capabilityDocPathsAt(join(capabilityDocsDir(docsDir), ...id.split("/")));
}

/**
 * A feature's own capability deltas — `features/<FEAT>/capabilities/<id>/`,
 * the delta tree that merges into `capabilityDocsDir` above.
 *
 * The layout MIRRORS the living one exactly, nesting included: a delta for
 * `payments/refunds` sits at `features/<FEAT>/capabilities/payments/refunds/`,
 * so `readCapabilityTree` walks both sides with one implementation and the
 * merge target is the same id split the same way. The alternative — a flat
 * escaped spelling like `payments%2Frefunds/` — would be a second grammar with
 * its own escaping defects, and a diff nobody could read by eye against
 * `specs/<svc>/spec.md` ↔ `services/<svc>/spec.md` one directory over.
 *
 * The DIRECTORY'S EXISTENCE is this axis's per-feature opt-in, exactly as
 * `capabilityDocsDir`'s is the fleet's: a feature without one pays a single
 * `existsSync` and produces no finding, so a fleet that has not adopted the
 * business axis sees nothing.
 */
export function featureCapabilityDeltasDir(featureDir: FeatureDir): string {
  return join(featureDir, "capabilities");
}

/**
 * The domain's own vocabulary — `glossary/<term>.md`, one FILE per term.
 *
 * A FILE, where a capability gets a directory, and the difference is what sits
 * beside the document. A capability's directory is the seam its feature-local
 * deltas and anything later join through; a term has nothing beside it but its
 * definition, and a directory holding one file is ceremony. The general rule
 * both follow is the one `core/capabilities/tree.ts` states: an entry with prose
 * gets a file, an entry without prose stays a line in YAML — and a domain term
 * is prose or it is nothing.
 *
 * NO `glossary.yaml`, for the reason the capability tree gives at length: a
 * single vocabulary file at fleet scale is unworkable, and a second list is the
 * drift `loam init`'s removed `loam.docs.json` was removed for. The DIRECTORY is
 * the list. Unlike the capability axis there is no YAML half to union with —
 * that file predates the tree and carries `description`/`owner` fields prose
 * cannot overwrite, and nothing here has ever had a second side.
 *
 * NESTING IS ALLOWED and spelled by the tree: `glossary/payments/order.md` is
 * the term `payments/order`. A fleet with three hundred terms in one flat
 * directory is the state this prevents, and it costs nothing — the walk is
 * recursive and the id is the path.
 *
 * TOP-LEVEL, not under `architecture/`, and for `capabilityDocsDir`'s reason:
 * the vocabulary is the domain's, and it must survive every redesign of the
 * fleet that speaks it.
 *
 * NOT SCAFFOLDED BY `loam init`, exactly as `architecture/adrs/` and
 * `capabilities/` are not. The directory's existence is the opt-in.
 */
export function glossaryDir(docsDir: DocsDir): string {
  return join(docsDir, "glossary");
}

/**
 * A feature's own glossary deltas — `features/<FEAT>/glossary/<term>.md`, the
 * vocabulary axis's answer to `specs/<svc>/spec.md`.
 *
 * A term a feature INTRODUCES ships and unships with it: the archive copies the
 * definition into `glossary/`, and unarchive takes it back out with everything
 * else the feature landed. That is the whole reason this route exists, and it is
 * why it is CREATE-ONLY (`core/glossary/delta.ts` states the rule and the
 * refusal): a definition is prose with no delta algebra to protect, so rewriting
 * a living one belongs in a pull request where git itself produces the conflict.
 *
 * The DIRECTORY'S EXISTENCE is this axis's per-feature opt-in, exactly as
 * `featureCapabilityDeltasDir`'s is the business axis's: a feature without one
 * pays a single `existsSync` and produces nothing.
 */
export function featureGlossaryDir(featureDir: FeatureDir): string {
  return join(featureDir, "glossary");
}
