/**
 * The fleet's ARCHITECTURAL OBLIGATION vocabulary: which architectural rules
 * this fleet has decided on, so a `#obl-<name>` tag on the map resolves or
 * refuses instead of silently labelling.
 *
 * THE GAP IT CLOSES is the architect→team handoff, and loam already had exactly
 * one channel for it: a landscape edge carrying `metadata { op 'authorizePayment' }`
 * obliges the provider to define that operationId, or `spine.op-undefined` fails
 * the gate. The architect writes the edge and the team owes the contract. There
 * was no equivalent for the obligations that VARY — an outbox on this publisher
 * and not that one, a circuit breaker on two edges out of five — and "vary" is
 * why a policy document is the wrong shape: a fleet-wide rule every service
 * inherits is not what an architect actually hands over.
 *
 * SO THE DECISION AND ITS SCOPE ARE SEPARATE THINGS, and each lives where it
 * already belonged. The **ADR** says WHAT was decided, in `architecture/adrs/`,
 * as thin or as thick as the decision needs. A **tag** on a landscape element or
 * edge says WHERE it applies, so one ADR governs three edges and not the fourth
 * without the document forking. This **vocabulary** declares the names, so a
 * mistyped tag is an error rather than a word nobody notices. And the team's
 * **`Covers:`** line says it is met, with a scenario proving it.
 *
 * THE SHAPE IS `permissions.yaml`'s AND `capabilities.yaml`'s, deliberately: a
 * fleet file declares names with prose that has no other home, the join is made
 * elsewhere, and the vocabulary is graded in both directions. What it is NOT is
 * a policy engine — there are no conditions, no severities, no inheritance.
 * Everything past a declared name has no ground truth to check against, which
 * is the same line the permission and capability vocabularies stop at.
 *
 * AN ID IS ITS OWN TAG SUFFIX, so an id is refused unless a LikeC4 tag name can
 * carry it verbatim. The capability axis had to flatten `identity/tokens` into
 * `#cap-identity-tokens` — lossy, and two ids can collapse into one slug — which
 * it pays for with a `many` arm at every join. Here the id is chosen by whoever
 * writes the vocabulary and has no other life, so refusing `payments/outbox` at
 * the source is strictly better than flattening it: the tag is exact, no slug
 * exists, and no collision arm is needed anywhere downstream.
 */
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { isRecord } from "../kernel/records.js";

/** The reserved tag prefix. `#obl-outbox` applies the obligation `outbox`. */
export const OBLIGATION_TAG_PREFIX = "obl-";

/**
 * Every character a LikeC4 tag name accepts, at the 1.59.2 pin — the same
 * measured whitelist `core/capabilities/usecase-join.ts` records, applied here
 * as a REFUSAL rather than as a flattening. A rejected character truncates the
 * tag rather than failing it (`#obl-a.b` reads back as `obl-a`), so a name that
 * cannot be a tag is a name whose tag would silently mean something else.
 */
const TAG_SAFE_NAME = /^[A-Za-z0-9_-]+$/;

/** One declared architectural obligation. */
export interface Obligation {
  /** The name, which is also the tag suffix: `#obl-<id>`. */
  id: string;
  description?: string;
  /**
   * The decision record this obligation comes from, as a path relative to the
   * docs repo root — `architecture/adrs/0001-transactional-outbox.md`.
   *
   * Optional, and RESOLVED when present: this is the join that makes "the ADR
   * says what, the tag says where" checkable rather than a convention. An
   * obligation with no ADR is a legitimate state — the reason may be one
   * sentence of `description` — but a path that names nothing is a pointer at a
   * decision nobody can read, which is the same failure `capability.unknown`
   * catches one axis over.
   */
  adr?: string;
}

export interface ObligationVocabulary {
  /**
   * False when `architecture/obligations.yaml` does not exist. The FILE is the
   * axis's opt-in, exactly as it is for permissions and capabilities: a fleet
   * that has decided nothing architectural owes no vocabulary and hears
   * nothing, however many tags its map already carries.
   */
  present: boolean;
  /** Why the file could not be read as a vocabulary, when it could not. */
  invalid?: string;
  /** Declared obligations, keyed by id. */
  byId: Map<string, Obligation>;
}

const EMPTY: ObligationVocabulary = { present: false, byId: new Map() };

/**
 * Read the vocabulary — the same defensive ladder `permissions.ts` and
 * `capabilities.ts` walk, because the three files fail the same ways. A missing
 * file is silence; a YAML error or a non-mapping shape is `invalid`, one finding
 * for the whole run with the family suspended behind it; an empty document is a
 * present-and-empty vocabulary; and a declaration whose body is not a mapping is
 * read as `{}` rather than refusing the whole file over one leaf.
 *
 * The one rule that is this file's own is the id grammar above, and it refuses
 * the FILE rather than dropping the entry: a vocabulary that silently held only
 * the names loam could tag would grade the rest as undeclared, which reads as
 * "you have a typo" against a line the author did write.
 */
export async function readObligations(path: string): Promise<ObligationVocabulary> {
  if (!existsSync(path)) return EMPTY;
  let doc: unknown;
  try {
    doc = parseYaml(await readFile(path, "utf8"));
  } catch (e) {
    return { ...EMPTY, present: true, invalid: e instanceof Error ? e.message : String(e) };
  }
  if (doc === null || doc === undefined) return { ...EMPTY, present: true };
  if (!isRecord(doc)) return { ...EMPTY, present: true, invalid: "the document is not a mapping" };

  const block = doc["obligations"];
  if (block === undefined) return { present: true, byId: new Map() };
  if (!isRecord(block)) {
    return { ...EMPTY, present: true, invalid: "`obligations` is not a mapping of obligation id to its declaration" };
  }

  const byId = new Map<string, Obligation>();
  for (const [id, body] of Object.entries(block)) {
    if (!TAG_SAFE_NAME.test(id)) {
      return {
        ...EMPTY,
        present: true,
        invalid:
          `'${id}' cannot be a LikeC4 tag name, and an obligation id IS its tag suffix — ` +
          "use letters, digits, `_` and `-` only (a rejected character truncates the tag rather than failing it, " +
          "so `#obl-a.b` would read back as the obligation `a`)",
      };
    }
    const decl = isRecord(body) ? body : {};
    byId.set(id, {
      id,
      ...(typeof decl["description"] === "string" ? { description: decl["description"] } : {}),
      ...(typeof decl["adr"] === "string" ? { adr: decl["adr"] } : {}),
    });
  }
  return { present: true, byId };
}
