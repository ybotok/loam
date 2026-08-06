/**
 * One version string, owned by package.json — read once, imported everywhere a
 * version is spoken. `../../package.json` resolves from src/core/ in dev and
 * from dist/core/ in the published layout alike.
 */
import { createRequire } from "node:module";

/**
 * The read is checked rather than asserted because the failure it would let
 * through is silent, permanent, and invisible on the machine that caused it: an
 * absent or empty `version` stamps `vundefined` into every file loam generates,
 * `agentsStampVersion` then cannot parse that stamp back, and every repository
 * built by that build reports its agent files stale forever with nothing to
 * point at. A build that cannot say what it is has nothing useful to do, so it
 * says so once, loudly, while its own module is being evaluated.
 */
function readVersion(pkg: unknown): string {
  const version = pkg !== null && typeof pkg === "object" && "version" in pkg ? pkg.version : undefined;
  if (typeof version !== "string" || version === "") {
    throw new Error(
      "readVersion: package.json declares no non-empty 'version', so this build cannot say what it is",
    );
  }
  return version;
}

export const LOAM_VERSION = readVersion(createRequire(import.meta.url)("../../package.json"));
