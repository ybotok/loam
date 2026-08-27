/**
 * The three fleet-vocabulary joins in one service's context pack: the
 * permissions its requirements gate on, the capabilities they realize, and the
 * business flows it is a hop of. All three resolve a per-service fact against a
 * fleet document, which is what separates them from `./living.ts` — that module
 * never has to look past the service's own directory and the fleet map.
 *
 * The use-case join is the newest and the one whose absence was loudest: an
 * agent briefed on a service was told which capabilities its requirements
 * realize and never told that step 4 of Checkout calls it. The capability is the
 * label; the flow is the caller.
 */
import { FleetContext } from "../fleet-context.js";
import { capabilityRollup } from "../capabilities/rollup.js";
import { repoPath } from "../envelope/json.js";
import { readVocabulary } from "../permissions/permissions.js";
import { compareIds, type ServiceEntry } from "../repo/entries.js";
import { capabilitiesPath, permissionsPath, servicePathsAt, SPEC_AXES } from "../repo/paths.js";
import { existsSync } from "node:fs";
import { readUseCases } from "../usecases/fleet.js";
import { flowsClaiming, type ClaimingFlow } from "../usecases/capability.js";
import { flowsTouching, type TouchedUseCase } from "../usecases/touch.js";
import type { Requirement } from "../document/spec.js";
import type { DocsDir } from "../kernel/ids/dirs.js";

/**
 * One `Requires:` entry, resolved against `architecture/permissions.yaml`.
 * A discriminated pair rather than optional-field soup: the declared variant
 * carries what the vocabulary says, the undeclared one carries only the claim
 * — inventing an empty `enforcedBy` for a permission nobody declared would be
 * a statement about a declaration that does not exist. Undeclared entries are
 * carried, never refused: explore's "every miss is a field" ethos, and
 * `permissions.unknown` is `validate`'s finding to make.
 */
export type PackPermission =
  | {
      id: string;
      declared: true;
      subject: string;
      name: string;
      description?: string;
      ownedBy?: string;
      enforcedBy: string[];
    }
  | { id: string; declared: false };

/** One declared capability this service realizes part of, with the realizing requirement names. */
export interface PackCapability {
  id: string;
  description?: string;
  owner?: string;
  /** This service's realizing requirement names, in the rollup's own (file, requirement) order. */
  requirements: string[];
  /**
   * The declared `dynamic view`s that CLAIM this capability, fleet-wide — not
   * only the ones this service is a hop of.
   *
   * Fleet-wide is the deliberate half. A capability is realized by several
   * services and drawn as one flow, so the flow a reader needs in order to
   * understand what this service's requirements are FOR is usually one where
   * this service appears at a single hop, or at none yet. `useCaseSteps` below
   * is the narrower answer — where this service actually appears — and the two
   * are different questions on purpose.
   *
   * Empty when nothing claims it, and empty when `useCaseScan` says nobody could
   * look; that ambiguity is why the scan's health rides beside it.
   */
  useCases: ClaimingFlow[];
}

export interface JoinsSlice {
  permissions: PackPermission[];
  /**
   * Whether the vocabulary itself could be read — beside the entries it
   * resolves, so `declared: false` over a broken file is legible as the
   * file's fault. `invalid` is a HOLE (`packHoles`): every entry above then
   * reports `declared: false` because nobody could look, not because the
   * claim is wrong, and exit 0 over that would be a positive false claim.
   */
  permissionsVocabulary: { present: boolean; invalid?: string };
  capabilities: PackCapability[];
  /** The capability vocabulary's own health — `permissionsVocabulary`'s twin, and a hole for the same reason: an unreadable file empties `capabilities` above, and "(none realized here)" over a parse failure is the vacuously-green trap. */
  capabilitiesVocabulary: { present: boolean; invalid?: string };
  /**
   * Repo-relative paths of OTHER services' spec files the capability rollup
   * could not read. The rollup walks the whole fleet, so an unreadable
   * sibling must degrade (recorded here, graded as a hole) rather than refuse
   * — one service's briefing must never be hostage to another service's
   * encoding. The TARGET's own documents keep their refusal: `living.ts`
   * reads them without this containment.
   */
  capabilitiesUnread: string[];
  /**
   * The declared business flows this service is a hop of, and only the hops that
   * mention it — `core/usecases/touch.ts`'s endpoint join, so a flow drawn for
   * work not yet done still answers.
   */
  useCaseSteps: TouchedUseCase[];
  /**
   * The use-case axis's own health — `permissionsVocabulary`'s twin, and a hole
   * for the same reason. An `architecture/` that does not parse empties BOTH
   * `useCaseSteps` and every `PackCapability.useCases` above while looking
   * exactly like a fleet that draws no flows, and "no business flow depends on
   * this service" is the single most misleading thing this pack could say about
   * a directory nobody opened.
   */
  useCaseScan: { unreadable: boolean; error?: string };
}

export interface JoinsRequest {
  docsDir: DocsDir;
  entry: ServiceEntry;
  context: FleetContext;
}

export async function buildJoins(req: JoinsRequest): Promise<JoinsSlice> {
  const { docsDir, entry, context } = req;
  const paths = servicePathsAt(entry.dir);

  // The same two spec reads `living.ts` makes — memoized on the shared
  // context, so whichever module asks first pays the I/O once and the two
  // cannot read two different versions of one file. Fanned out because the
  // axes are independent; SPEC_AXES order (spec before arch-spec) is preserved
  // by Promise.all, which is what keeps `wanted` deterministic.
  const perAxis: Requirement[][] = await Promise.all(
    SPEC_AXES.map((axis) =>
      existsSync(paths[axis.key]) ? context.readRequirements(paths[axis.key]) : Promise.resolve([]),
    ),
  );
  const active = perAxis.flat().filter((r) => r.kind !== "REMOVED");

  // One vocabulary parse per pack — the pack asks about one service, so this
  // is once per invocation, not the per-service re-parse fleet-context.ts's
  // stats comment warns against copying.
  const vocab = await readVocabulary(permissionsPath(docsDir));
  const wanted = [...new Set(active.flatMap((r) => r.requires))].sort(compareIds);
  const permissions: PackPermission[] = wanted.map((id) => {
    const decl = vocab.byId.get(id);
    if (decl === undefined) return { id, declared: false };
    return {
      id,
      declared: true,
      subject: decl.subject,
      name: decl.name,
      ...(decl.description === undefined ? {} : { description: decl.description }),
      ...(decl.ownedBy === undefined ? {} : { ownedBy: decl.ownedBy }),
      enforcedBy: decl.enforcedBy,
    };
  });

  // One rollup pass through the shared context cache, exactly as explore seeds
  // capabilities — the reader is injected because fleet-context.ts imports the
  // capabilities package and an import back would be a package cycle.
  const entries = await context.listServices(docsDir);
  const capVocab = await context.capabilities(capabilitiesPath(docsDir));
  const unread: string[] = [];
  const rows = await capabilityRollup({
    services: entries,
    vocab: capVocab,
    read: (p) =>
      context.readRequirements(p).catch(() => {
        // Unreadable means "this file's realizations are unknown", never "the
        // pack is unanswerable": the rollup walks EVERY service's spec files,
        // so without this per-read containment one sibling's bad encoding
        // refused every other service's briefing — and only once the fleet
        // declared its first capability, which is exactly the moment the walk
        // starts. The miss travels as `capabilitiesUnread` and is graded as a
        // hole; the target's own copy of the same rejection still refuses the
        // pack through `living.ts`'s uncontained read.
        unread.push(repoPath(docsDir, p));
        return [];
      }),
  });
  // One use-case scan for the whole pack, feeding both joins below. It gates
  // its own load, so a docs repo whose architecture/ never mentions the reserved
  // tag prefix costs a readdir here rather than a LikeC4 workspace — the same
  // discipline `loam delta` needs and this pack inherits for free.
  const known = new Set(entries.map((e) => e.id));
  const scan = await readUseCases({ docsDir, known });
  const capabilities: PackCapability[] = rows
    .filter((row) => row.services.includes(entry.id))
    .map((row) => ({
      id: row.id,
      ...(row.description === undefined ? {} : { description: row.description }),
      ...(row.owner === undefined ? {} : { owner: row.owner }),
      requirements: [
        ...new Set(row.realizedBy.filter((r) => r.service === entry.id).map((r) => r.requirement)),
      ],
      useCases: flowsClaiming(scan, row.id),
    }));

  return {
    permissions,
    permissionsVocabulary: {
      present: vocab.present,
      ...(vocab.invalid === undefined ? {} : { invalid: vocab.invalid }),
    },
    capabilities,
    capabilitiesVocabulary: {
      present: capVocab.present,
      ...(capVocab.invalid === undefined ? {} : { invalid: capVocab.invalid }),
    },
    // The rollup awaits each read in its own walk order, so the push order is
    // already deterministic; sorted anyway, because the CONTRACT is the sorted
    // list, not the walk.
    capabilitiesUnread: [...unread].sort(compareIds),
    useCaseSteps: flowsTouching(scan, new Set([entry.id])),
    useCaseScan:
      scan.kind === "read"
        ? { unreadable: false }
        : { unreadable: true, ...(scan.errors[0] === undefined ? {} : { error: scan.errors[0] }) },
  };
}
