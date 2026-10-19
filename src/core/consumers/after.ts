/**
 * The consumer index read AFTER one feature — the documents as that feature's
 * merge would leave them, so a consumer the same feature removes or rewrites
 * stops counting.
 *
 * WHY THE GATE NEEDS IT. The archive gate's question is not "who names this
 * operation today" but "who will still name it once this archive lands", and
 * the two differ by exactly what the feature itself writes. A rename has to
 * restate the requirement that governs the old operation, and a removal whose
 * feature also REMOVES another service's requirement naming it has already
 * retired that consumer — the remedy the refusal itself gives ("retire the
 * requirement that names it"). Read off the living files alone, both were
 * refused for a consumer the same archive deletes: the requirement scan read
 * living spec.md only, so following the remedy inside the feature did not clear
 * the finding (the capability axis's `capability.remove-requirement-realized`
 * has always graded its own join after the merge; this is the contract axes
 * catching up).
 *
 * WHAT A FEATURE CAN EXPRESS, AND WHAT IT CANNOT. Requirements, yes: a spec
 * delta MODIFIES or REMOVES a requirement of any service it carries
 * `specs/<svc>/` for, and the merge is `applyRequirementDelta` — the archive's
 * own function, so the view cannot disagree with what the archive writes. A
 * contract, yes: the ownership check below asks the contract the merge would
 * write. EDGES AND USE-CASE HOPS, NO: the landscape merge only ADDS edges and a
 * feature's flows are create-only, so no `delta.likec4` and no `usecases/`
 * document can take a living edge or hop away. Those are read as they stand —
 * the one way to drop or redraw a living edge is to edit the living map in the
 * same change, and that edit is then simply what the index reads.
 */
import { existsSync } from "node:fs";
import { applyRequirementDelta } from "../document/apply.js";
import type { Requirement } from "../document/spec.js";
import { featureSpecPaths } from "../repo/paths.js";
import { serviceOperationIds } from "../openapi/doc.js";
import type { FleetContext } from "../fleet-context.js";
import type { DocsDir, FeatureDir } from "../kernel/ids/dirs.js";
import type { RawServiceId } from "../kernel/ids/service.js";

/** The two requirement files a service carries — every consumer scan reads both. */
export type SpecAxis = "spec" | "archSpec";

/** One requirement as the merge would leave it, and whether THIS feature wrote it there. */
export interface MergedRequirement {
  requirement: Requirement;
  /** True for a requirement the feature's delta added or rewrote — what lets a finding say whose line it is. */
  written: boolean;
}

/** What the index asks of the feature it reads after. */
export interface FeatureView {
  /** The feature's own requirement delta for one service's spec file, or `undefined` when it carries none (or none that reads). */
  delta(service: RawServiceId, axis: SpecAxis): Promise<Requirement[] | undefined>;
  /** Does `service`'s contract, as this merge leaves it, define `op`? `undefined` when the feature carries no contract delta for it — the living contract answers. */
  defines(service: RawServiceId, op: string): Promise<boolean | undefined>;
}

/** The feature whose merge a view reads after. */
export interface FeatureScope {
  docsDir: DocsDir;
  featureDir: FeatureDir;
  context: FleetContext;
}

export function featureView(scope: FeatureScope): FeatureView {
  const { docsDir, featureDir, context } = scope;
  const deltas = new Map<string, Promise<Requirement[] | undefined>>();
  const contracts = new Map<string, Promise<ReadonlySet<string> | undefined>>();
  return {
    delta: (service, axis) => {
      const key = `${service}\0${axis}`;
      let pending = deltas.get(key);
      if (pending === undefined) {
        const path = featureSpecPaths(featureDir, service)[axis];
        // A delta that does not read is the delta checks' finding to make
        // (`delta.*`); here it credits nothing, which can only keep a consumer
        // counted — the closed direction.
        pending = existsSync(path) ? context.readRequirements(path).catch(() => undefined) : Promise.resolve(undefined);
        deltas.set(key, pending);
      }
      return pending;
    },
    defines: async (service, op) => {
      let pending = contracts.get(service);
      if (pending === undefined) {
        // `serviceOperationIds` is the rule every same-feature contract check
        // reads — living upserts minus removals, removals first — so the
        // ownership question cannot disagree with E1 about what the merge
        // leaves defined.
        pending = existsSync(featureSpecPaths(featureDir, service).openapi)
          ? serviceOperationIds(docsDir, service, featureDir, context).then((ids) => new Set(ids))
          : Promise.resolve(undefined);
        contracts.set(service, pending);
      }
      const ids = await pending;
      return ids === undefined ? undefined : ids.has(op);
    },
  };
}

/**
 * One spec file's requirements as the merge would leave them — and FAILING
 * CLOSED when the merge would refuse.
 *
 * No delta (or one holding only quoted, BASE requirements) is the living file
 * itself, read directly. That is not an optimisation: `applyRequirementDelta`
 * grades the LIVING file's `Requirement-ID` declarations too, so asking it to
 * apply an empty delta over a living spec with one malformed id threw, and the
 * catch that used to follow answered "no consumers" — a removal of an
 * operation that spec still governed then passed the gate at exit 0, and the
 * next `validate --all` reported `spec-api.op-undefined` (review 2026-10-12,
 * finding 5).
 *
 * A delta the merge refuses is the living file PLUS every requirement the delta
 * ADDS or MODIFIES. Its identity errors already gate (`delta.*`), and nothing it
 * says can land until they are fixed — but "nothing can land" was never a
 * reason to answer "nobody consumes it": the fix that lands next is one of the
 * readings this union covers, so a consumer in any of them still counts. A
 * REMOVED requirement credits nothing on this path, because whether it would
 * select the living one is exactly what the merge could not decide.
 *
 * Untouched requirements come back from the merge as the very objects that went
 * in (`apply.ts` states the identity is load-bearing), which is what tells a
 * living consumer from one this feature wrote.
 */
export function afterMerge(living: Requirement[], delta: Requirement[] | undefined): MergedRequirement[] {
  const asLiving = (requirement: Requirement): MergedRequirement => ({ requirement, written: false });
  if (delta === undefined || delta.every((d) => d.kind === "BASE")) return living.map(asLiving);
  try {
    const untouched = new Set(living);
    return applyRequirementDelta(living, delta).map((requirement) => ({ requirement, written: !untouched.has(requirement) }));
  } catch {
    return [
      ...living.map(asLiving),
      ...delta.filter((d) => d.kind === "ADDED" || d.kind === "MODIFIED").map((requirement) => ({ requirement, written: true })),
    ];
  }
}
