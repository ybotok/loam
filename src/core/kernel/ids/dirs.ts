/**
 * The two directory roots loam's path builders spell paths under, branded by
 * PROVENANCE — where the string came from — exactly as the id brands beside
 * this file are.
 *
 * `repo/paths.ts` interpolates caller-controlled ids into these roots, and its
 * guarantee is only as good as the root it starts from: a `servicePaths(dir,
 * id)` whose `dir` is whatever string happened to be in scope spells paths
 * into whatever tree that string names. Honestly stated: these constructors
 * VALIDATE nothing — they RECORD a provenance the caller must already have
 * established, and what the gate contributes is that the cast appears in
 * exactly one place per brand (a cast anywhere else in `src/` is a finding,
 * not a shortcut). `init` brands its `--docs` resolution before its guards
 * run and refuses before any path is built — the provenance comment is the
 * contract those call sites are held to by review, not by the compiler.
 *
 * The two brands are deliberately disjoint: a docs repo root and a feature
 * directory are different trees, and `featurePaths(docsDir)` is precisely the
 * confusion the compiler should refuse.
 */
declare const provenance: unique symbol;

/**
 * The resolved absolute root of the shared docs repo. Provenance: resolved
 * through a loaded config (`parseConfig` resolves the stored spelling against
 * the config file's own directory) or an explicit `--docs` a command
 * validated. NOT the stored spelling — loam.json deliberately keeps the
 * relative form (`storedDocsDir`), and that spelling stays a plain `string`.
 */
export type DocsDir = string & { readonly [provenance]: "docs-dir" };

/**
 * The absolute path of one feature's directory. Provenance: an enumeration
 * read this directory — `listFeatures` joined a name `readdir` returned onto
 * the features root it walked, so the directory demonstrably exists (or did,
 * one readdir ago).
 */
export type FeatureDir = string & { readonly [provenance]: "feature-dir" };

/** The only constructor. `resolved` must carry `DocsDir`'s provenance, above. */
export function docsDirOf(resolved: string): DocsDir {
  return resolved as DocsDir;
}

/** The only constructor. `abs` must carry `FeatureDir`'s provenance, above. */
export function featureDirOf(abs: string): FeatureDir {
  return abs as FeatureDir;
}
