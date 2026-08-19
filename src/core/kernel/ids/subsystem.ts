/**
 * The spelling rule for subsystem names — the directories that GROUP services
 * under `services/`, marked by a `subsystem.yaml` (the walk that classifies
 * them lives in `core/repo/tree/`).
 *
 * A subsystem name takes the service-id grammar and the same Windows rules,
 * through the shared `dirNameHazard` in `./service.ts`, because both kinds of
 * name become directory names in the same tree and share ONE flat namespace —
 * unique across the whole tree at any depth, services and subsystems together.
 * If the two grammars could drift, a name legal as one and illegal as the
 * other would make the namespace-collision refusal incoherent.
 *
 * The BRAND is distinct on purpose, and deliberately not a subtype of
 * `ServiceId`: a subsystem is a place services live, never a thing a `--service`
 * flag may name or a path a spec's frontmatter may claim — `--into <name>` and
 * `--service <id>` must not be satisfiable by each other's values. Placement is
 * never part of any identity, and the type system is where that stops being a
 * review comment.
 */
import { dirNameHazard } from "./service.js";

declare const checked: unique symbol;

/** A name that passed `subsystemNameProblem`. The only form a caller may construct. */
export type SubsystemName = string & { readonly [checked]: "subsystem" };

/** Prose form of the rule, shown verbatim in every refusal so the fix is obvious. */
const SUBSYSTEM_NAME_RULE =
  "a subsystem name must start with a letter or digit and contain only letters, digits, '.', '_' or '-' " +
  "(no slashes, no '..', no spaces) — it becomes a directory name under services/";

/**
 * Why `name` is not a usable subsystem name, or null when it is. The same
 * shape as `serviceIdProblem`, for the same reason: the tree walk reports the
 * sentence as a finding (`subsystem.name-invalid`) while a command refusal
 * prints it verbatim, and the two must not disagree.
 */
export function subsystemNameProblem(name: unknown, label = "subsystem name"): string | null {
  if (typeof name !== "string" || name === "") {
    return `${label} must name a subsystem: ${SUBSYSTEM_NAME_RULE}.`;
  }
  const hazard = dirNameHazard(name);
  if (hazard === null) return null;
  switch (hazard.kind) {
    case "grammar":
      return `Invalid ${label} '${name}': ${SUBSYSTEM_NAME_RULE}.`;
    case "windows-device":
      return (
        `Invalid ${label} '${name}': '${hazard.stem}' is a reserved device name on Windows — ` +
        `a '${name}/' directory cannot be created there at all, so the docs repo would only work on some of the machines that clone it.`
      );
    case "windows-trailing":
      return (
        `Invalid ${label} '${name}': a subsystem name may not end with '.' or a space — ` +
        `Windows strips both when creating a directory, so '${name}' and '${name.replace(/[. ]+$/, "")}' would silently become one directory there and two everywhere else.`
      );
  }
}

/**
 * The one constructor that validates. Discriminated pair rather than
 * `SubsystemName | string` for `parseServiceId`'s reason: the union shape
 * compiles and is unusable, because nothing can narrow it back.
 */
export function parseSubsystemName(
  raw: string,
  label = "subsystem name",
): { ok: true; name: SubsystemName } | { ok: false; problem: string } {
  const problem = subsystemNameProblem(raw, label);
  if (problem !== null) return { ok: false, problem };
  // The cast, on the line immediately after the check that earns it.
  return { ok: true, name: raw as SubsystemName };
}
