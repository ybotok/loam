/**
 * The spelling rule for a capability id that ARRIVED FROM ARGV — the one
 * provenance `repo/paths.ts` says must never reach a path join unchecked.
 *
 * `livingCapabilityPaths` takes a plain `string`, and its comment states why: a
 * capability id has no grammar of its own — it is a YAML key and a chain of
 * directory names — so what holds that join is PROVENANCE. Every id it sees
 * today came out of a `readCapabilityTree` walk, where each component is a
 * `readdir` entry name and therefore demonstrably a directory that exists.
 * (`featureCapabilityDeltasDir` beside it takes a branded `FeatureDir` and no
 * capability id at all; the feature-side join is spelled by `loam new` itself.)
 *
 * `loam new --capability <id>` is the first caller with no such provenance. The
 * string is whatever a person typed, and it is joined as
 * `features/<dirName>/capabilities/<id>/spec.md` — so `--capability ../../evil`
 * resolves to `features/evil/spec.md`, a directory `listFeatures` then
 * enumerates as a feature, and one `..` further reaches the docs-repo root.
 * `resolveInside` cannot refuse either: both are still inside the repo. That is
 * the failure this module closes, and it is the same one
 * `core/kernel/ids/service.ts` opens with one file over.
 *
 * IT IS THE DIRECTORY-NAME RULE, NOT A NEW ONE. Nesting is spelled by the tree
 * (`payments/refunds` is two directories), so an id is legal exactly when every
 * one of its `/`-separated segments is a legal directory name in the docs repo
 * — `dirNameHazard`, the same check a service id and a subsystem name are held
 * to, Windows device names and trailing dots included. A capability tree that
 * only clones onto some of the machines that read it is the same defect there
 * as it is under `services/`.
 *
 * NO BRAND, deliberately, and the reason is the provenance rule above rather
 * than an omission: a brand is worth its annotations when a path builder can
 * DEMAND it, and neither builder can — both are called with walk-derived ids
 * that were never parsed here and must keep working. What this module gives is
 * the check the argv path owes; the rule that walk-derived ids are safe stays
 * where `repo/paths.ts` already writes it down.
 */
import { dirNameHazard } from "./service.js";

/** Prose form of the rule, shown verbatim in the refusal so the fix is obvious. */
const CAPABILITY_ID_RULE =
  "a capability id is one or more '/'-separated segments, each starting with a letter or digit and " +
  "containing only letters, digits, '.', '_' or '-' (no '..', no spaces, no leading or trailing '/') — " +
  "it becomes the capabilities/<id>/ directory chain, one directory per segment";

/**
 * Why `id` cannot be a capability id, or null when it can.
 *
 * A sentence rather than a boolean, matching `serviceIdProblem`: a caller that
 * is collecting findings prints exactly what a refusal would.
 */
export function capabilityIdProblem(id: unknown, label = "--capability"): string | null {
  if (typeof id !== "string" || id === "") {
    return `${label} must name a capability: ${CAPABILITY_ID_RULE}.`;
  }
  for (const segment of id.split("/")) {
    const hazard = dirNameHazard(segment);
    if (hazard === null) continue;
    switch (hazard.kind) {
      case "grammar":
        return `Invalid ${label} '${id}': ${CAPABILITY_ID_RULE}.`;
      // Both Windows refusals keep their own sentence for `serviceIdProblem`'s
      // reason: "does not match the grammar" is true and useless, because the
      // id LOOKS fine and the problem is what the filesystem does with it.
      case "windows-device":
        return (
          `Invalid ${label} '${id}': '${hazard.stem}' is a reserved device name on Windows — ` +
          `the capabilities/${id}/ directory cannot be created there at all, so the docs repo would only work on some of the machines that clone it.`
        );
      case "windows-trailing":
        return (
          `Invalid ${label} '${id}': no segment of a capability id may end with '.' or a space — ` +
          "Windows strips both when creating a directory, so the id would silently name one directory there and another everywhere else."
        );
    }
  }
  return null;
}
