/**
 * The `Covers:` index the obligation axis asks its coverage question against —
 * every entry the fleet's requirement documents write, read as the living fleet
 * has them or as one feature's merge would leave them.
 *
 * ONE INDEX FOR TWO SCOPES, because they must not disagree about what "covered"
 * means. `validate --all` asks it of the living fleet
 * (`commands/validate/fleet/obligations/`); the feature gate asks it of a
 * feature's own flows before the archive (`../delta/obligations.ts`),
 * where a hop the feature's flow rides is answered in the same change by an
 * arch requirement its own delta ADDS. Reading the living documents only there
 * would tell an author who has just written that requirement that nothing
 * covers the hop, and the next `validate --all` would agree with them only
 * after the archive.
 *
 * FLEET-WIDE AND NOT PER SERVICE: an obligation is placed by the architect on
 * the map and met by whichever team owns the thing it sits on, so an index of
 * one service would report an edge as uncovered because the requirement that
 * covers it lives in the service at the other end.
 */
import { existsSync } from "node:fs";
import { coversEntries, type CoversEntry } from "../../c4/arch.js";
import { applyRequirementDelta } from "../../document/apply.js";
import type { Requirement } from "../../document/spec.js";
import { SPEC_AXES, servicePathsAt, type SpecAxis } from "../../repo/paths.js";
import type { ServiceEntry } from "../../repo/entries.js";

/**
 * One of a feature's requirement deltas, beside the living text it applies to —
 * the pair the feature walk already holds (`core/delta/delta.ts`), so nothing is
 * read twice. `living` is `[]` for a service the feature introduces.
 */
export interface CoversDelta {
  service: string;
  axis: SpecAxis["key"];
  reqs: readonly Requirement[];
  living: readonly Requirement[];
}

export interface CoversIndexRequest {
  /** Every living service directory. */
  services: readonly ServiceEntry[];
  read: (path: string) => Promise<Requirement[]>;
  /** A feature's deltas, folded the way the archive folds them; absent for the living fleet. */
  deltas?: readonly CoversDelta[];
}

/**
 * Every `Covers:` entry the fleet writes, across both requirement documents of
 * every service — with a feature's deltas folded in when it has any.
 *
 * Existence is checked for both files and for the same reason
 * `permissionFindings` checks it: `arch.spec.md` is optional and most of a
 * legacy fleet has none, while `spec.md` is missing on a half-adopted service —
 * and `FleetContext.readRequirements` throws ENOENT, which surfaces as
 * `repository-unavailable` and takes the whole `--all` run down. Both axes are
 * read, not only the architecture one: `Covers:` is parsed everywhere for one
 * grammar's sake, and a fleet that wrote its outbox requirement in `spec.md`
 * has said the thing loam is asking about.
 */
export async function coversIndex(req: CoversIndexRequest): Promise<CoversEntry[]> {
  const deltas = new Map((req.deltas ?? []).map((d) => [JSON.stringify([d.service, d.axis]), d]));
  const entries: CoversEntry[] = [];
  for (const service of req.services) {
    const paths = servicePathsAt(service.dir);
    for (const axis of SPEC_AXES) {
      const key = JSON.stringify([service.id, axis.key]);
      const delta = deltas.get(key);
      if (delta !== undefined) {
        deltas.delete(key);
        entries.push(...coversEntries(folded(delta)));
      } else if (existsSync(paths[axis.key])) {
        entries.push(...coversEntries(await req.read(paths[axis.key])));
      }
    }
  }
  // What is left belongs to a service no `services/` directory holds yet: the
  // feature introduces it, and its deltas are the whole of its documents.
  for (const delta of deltas.values()) entries.push(...coversEntries(folded(delta)));
  return entries;
}

/**
 * The requirements one document holds after the archive's fold.
 *
 * A delta the merge refuses — `applyRequirementDelta` throws on a repeated,
 * duplicate or invalid `Requirement-ID`, which the delta gate reports and gates
 * on as `delta.requirement-id-*`, `delta.living-requirement-id-invalid` and
 * `delta.requirement-identity-collision` (`core/delta/document.ts`, `core/delta/select.ts`) — is read as the
 * living text PLUS every requirement it ADDS or MODIFIES: `afterMerge`'s
 * reading (`core/consumers/after.ts`), and for the reason that matters here.
 * The author who has just added the arch requirement covering a hop is the one
 * whose delta has an identity error to fix; reading the living text alone
 * would tell them nothing covers the hop and send them to write the same
 * requirement twice. Generous is safe on this one path, because the error
 * beside it already stops the archive. An index that threw instead would take
 * the whole feature walk down over a finding another check is already making.
 */
function folded(delta: CoversDelta): readonly Requirement[] {
  try {
    return applyRequirementDelta([...delta.living], [...delta.reqs]);
  } catch {
    return [...delta.living, ...delta.reqs.filter((r) => r.kind === "ADDED" || r.kind === "MODIFIED")];
  }
}
