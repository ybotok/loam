/**
 * Where every artifact lives. Artifact filenames are spelled here and nowhere
 * else, so a rename is one edit rather than a grep.
 *
 * This is also the module that carries loam's one path guarantee.
 * `servicePaths(docsDir, service)` spells `<docsDir>/services/<service>/`, so
 * `service` is caller-controlled path input, and `node:path` cannot help:
 * `join(...paths: string[])` accepts every string there is. The guarantee is
 * this function's own parameter type and nothing else — any code that spells
 * `services/<id>/` with a bare join is outside it, and `commands/new.ts` and
 * the openspec migrator both do, held instead by `resolveInside` at the write.
 */
import { join } from "node:path";

/** Directory under features/ holding shipped features. Never a feature itself. */
export const ARCHIVE_DIR = "archive";

/* ------------------------------------------------------------------ */
/* Paths — artifact filenames are spelled here and nowhere else        */
/* ------------------------------------------------------------------ */

export interface ServicePaths {
  dir: string;
  model: string;
  spec: string;
  archSpec: string;
  openapi: string;
  /** The async contract — the event axis's sibling of `openapi`. */
  asyncapi: string;
  runbook: string;
  health: string;
  adrsDir: string;
}

export function servicePaths(docsDir: string, service: string): ServicePaths {
  const dir = join(docsDir, "services", service);
  return {
    dir,
    model: join(dir, "model.likec4"),
    spec: join(dir, "spec.md"),
    archSpec: join(dir, "arch.spec.md"),
    openapi: join(dir, "openapi.yaml"),
    asyncapi: join(dir, "asyncapi.yaml"),
    runbook: join(dir, "runbook.md"),
    health: join(dir, "health.yaml"),
    adrsDir: join(dir, "adrs"),
  };
}

/**
 * The pair of requirement-carrying spec files, living and delta alike: the
 * business spec and the architecture spec. Same grammar, same delta algebra,
 * same merge — everything that walks "the spec files" of a service walks this
 * list, so the two axes cannot drift apart in what handles them. `key` indexes
 * ServicePaths/FeatureSpecPaths; `label` is how the axis names itself in prose.
 */
export const SPEC_AXES = [
  { key: "spec", file: "spec.md", label: "requirements" },
  { key: "archSpec", file: "arch.spec.md", label: "arch requirements" },
] as const;
export type SpecAxis = (typeof SPEC_AXES)[number];

export interface FeaturePaths {
  dir: string;
  intent: string;
  delta: string;
  specsDir: string;
  adrsDir: string;
}

export function featurePaths(featureDir: string): FeaturePaths {
  return {
    dir: featureDir,
    intent: join(featureDir, "intent.md"),
    delta: join(featureDir, "delta.likec4"),
    specsDir: join(featureDir, "specs"),
    adrsDir: join(featureDir, "adrs"),
  };
}

export interface FeatureSpecPaths {
  dir: string;
  spec: string;
  archSpec: string;
  openapi: string;
}

export function featureSpecPaths(featureDir: string, service: string): FeatureSpecPaths {
  const dir = join(featureDir, "specs", service);
  return {
    dir,
    spec: join(dir, "spec.md"),
    archSpec: join(dir, "arch.spec.md"),
    openapi: join(dir, "openapi.yaml"),
  };
}

export function landscapePath(docsDir: string): string {
  return join(docsDir, "architecture", "landscape.likec4");
}

export function featuresDir(docsDir: string): string {
  return join(docsDir, "features");
}

/**
 * The agent contract's filename, and where it sits in a docs repo.
 *
 * Both spellings are exported because the two questions are different: `init`,
 * `doctor` and `validate` want a path under a docsDir they already hold, while
 * `docs.ts` builds the scaffold as `[relative path, bytes]` pairs and needs the
 * bare name. Four modules spelled the literal out for themselves, and one of
 * them — `init` — uses it to decide whether a directory IS a docs repo at all,
 * so a rename that reached three of the four would leave `init` recognising a
 * file nothing else writes any more.
 *
 * `openspec-inventory.ts`'s "AGENTS.md" is deliberately NOT this constant: it
 * names a file in a foreign OpenSpec tree that happens to share the name.
 */
export const AGENTS_FILENAME = "AGENTS.md";

export function agentsPath(docsDir: string): string {
  return join(docsDir, AGENTS_FILENAME);
}

/**
 * Where shipped features live. `features/archive/` is spelled here and nowhere
 * else for the same reason every other artifact path is: `archive` and
 * `unarchive` move directories in and out of it, and a layout string that two
 * commands re-derive is a layout two commands can disagree about. The
 * `features/archive/…` strings in refusal PROSE are not this path — they are
 * what a reader types into `ls`, and they stay spelled out.
 */
export function archiveDir(docsDir: string): string {
  return join(featuresDir(docsDir), ARCHIVE_DIR);
}
