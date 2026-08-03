/**
 * One version string, owned by package.json — read once, imported everywhere a
 * version is spoken. `../../package.json` resolves from src/core/ in dev and
 * from dist/core/ in the published layout alike.
 */
import { createRequire } from "node:module";

export const LOAM_VERSION = (
  createRequire(import.meta.url)("../../package.json") as { version: string }
).version;
