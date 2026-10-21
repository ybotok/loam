/**
 * A service an active feature INTRODUCES, as `loam validate` meets it — named
 * by the repository's own binding, or named on the command line.
 *
 * Until the feature archives, such a service's only documents are the
 * feature's `specs/<service>/`: `services/` learns the name at the merge
 * (`core/projection/introduced.ts`, the one answer to "introduces" every
 * command reads). `validate` looked only under `services/`, so in that
 * service's own repository a bare `loam validate` refused with
 * `service.unknown` and "Did you mean: payment-service?" — it read the newest
 * service in the fleet as a typo, while `loam status` and `loam doctor` in the
 * same repository named the feature that introduces it.
 *
 * Two readings, two answers:
 *
 *   the binding (a bare `loam validate`) → the introducing features are
 *     validated in the service's place. They hold every document the service
 *     has, so theirs is the grade there is to give, and it is `--feature`'s
 *     grade target for target — never a slice of it, which would be a green
 *     over whatever the slice left out. The run says first which features it
 *     validated and why, in `show`'s words for the same fact, so a reader never
 *     takes a feature's findings for the service's own.
 *   a name (`--service <id>`, the positional) → still a service target, which
 *     does not exist, so still `service.unknown` at error: `--service` forces
 *     the service reading by contract. Only the prose changes — it names the
 *     feature and the command that validates its documents, where it used to
 *     offer the nearest living id as the correction.
 *
 * A name nothing introduces keeps the near-miss refusal, byte for byte.
 */
import { closeIds } from "../../../core/c4/arch.js";
import type { FleetContext } from "../../../core/fleet-context.js";
import type { DocsDir } from "../../../core/kernel/ids/dirs.js";
import { introducingFeatures } from "../../../core/projection/introduced.js";
import type { FeatureEntry } from "../../../core/repo/entries.js";
import { listServices } from "../../../core/repo/repo.js";
import type { ServiceTarget } from "../../../core/repo/service-target.js";
import type { Finding } from "../../../core/vocabulary/report.js";

/** A bound service a bare run validates through the features that introduce it. */
export interface IntroducedBinding {
  /** The service loam.json names. */
  service: string;
  /** `introducingFeatures`' answer, ordered by id — never empty. */
  features: FeatureEntry[];
}

/**
 * The features a bare run validates in place of the bound service — or null
 * when the binding names a living service, or a name nothing introduces, and
 * the run grades it as a service (`service.unknown` and all) exactly as before.
 */
export async function introducedBinding(
  docsDir: DocsDir,
  resolved: Extract<ServiceTarget, { ok: true }>,
  fleet: FleetContext,
): Promise<IntroducedBinding | null> {
  // An enumerated directory is living. `introducingFeatures` would say so too,
  // after reading every feature to learn it.
  if (resolved.dir !== undefined) return null;
  const features = await introducingFeatures(docsDir, resolved.id, fleet);
  return features.length === 0 ? null : { service: resolved.id, features };
}

/**
 * The two lines a bare run prints above the report: the first is `loam show
 * <service>`'s header for the same state, the second says what was validated
 * instead and why those features.
 */
export function introducedLead({ service, features }: IntroducedBinding): string[] {
  const ids = features.map((f) => f.id);
  const several = ids.length > 1;
  const listed = several ? `${ids.slice(0, -1).join(", ")} and ${ids.slice(-1).join("")}` : ids.join("");
  return [
    `${service}   introduced by ${ids.join(", ")} (in flight) — not in the living docs until ${several ? "one of them" : "it"} archives`,
    `  validating ${listed} instead: ${several ? "their" : "its"} specs/${service}/ are this service's documents until then`,
  ];
}

/**
 * The `--json` payload's `boundService`: why `targets` holds features and no
 * service. The keys are `show`'s and `steps`' for the same fact — `living:
 * false` and `introducedBy` — so a consumer that reads one reads them all.
 */
export function introducedJson({ service, features }: IntroducedBinding): {
  id: string;
  living: false;
  introducedBy: string[];
} {
  return { id: service, living: false, introducedBy: features.map((f) => f.id) };
}

/**
 * `service.unknown`: no directory under `services/` answers to the name. The
 * hint depends on why. A feature in flight introduces it → name the feature
 * and the command that validates its documents, in `loam doctor`'s words for
 * the same state. Something close is living → the near-miss, which is what
 * makes a typo diagnosable. Neither → where to look. Never `loam adopt`, in any
 * branch: adopting a typo would document the misspelling, and adopting an
 * introduced service would write `services/<id>/` ahead of the merge.
 */
export async function unknownServiceFinding(
  docsDir: DocsDir,
  service: string,
  treePath: string,
  fleet: FleetContext,
): Promise<Finding> {
  const ids = (await introducingFeatures(docsDir, service, fleet)).map((f) => f.id);
  const [lead, ...others] = ids;
  if (lead !== undefined) {
    const several = others.length > 0;
    return {
      severity: "error",
      code: "service.unknown",
      message:
        `No service directory at ${treePath}: ${lead} introduces it${several ? ` (so does ${others.join(", ")})` : ""}, ` +
        `and it is not in the living docs until ${several ? "one of them" : lead} archives. Until then its documents are ` +
        `${several ? `the specs/${service}/ of ${ids.join(", ")}` : `${lead}'s specs/${service}/`} — run ` +
        `\`loam validate --feature ${lead}\`${several ? `, and likewise for ${others.join(", ")},` : ""} to validate them.`,
    };
  }
  const close = closeIds(service, (await listServices(docsDir, fleet)).map((s) => s.id));
  return {
    severity: "error",
    code: "service.unknown",
    message:
      `No service directory at ${treePath}.` +
      (close.length > 0
        ? ` Did you mean: ${close.join(", ")}?`
        : " `loam list services` shows what exists."),
  };
}
