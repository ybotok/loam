/**
 * The agent contract's docs-repo half: AGENTS.md, which `loam init` lays down
 * so a coding agent can run the cycle without being told it each time.
 * AGENTS.md goes into the docs repo — it travels with the thing it describes.
 * It is never overwritten: it is a starting point, and a team's edits to it
 * outrank ours. (The other half — the per-tool command and skill files — is
 * scaffold.ts.)
 *
 * The stamp on the first line is the one concession to that never-refresh
 * contract: it records which loam wrote the file, so `loam validate --all` can
 * say when the tables below describe a binary that no longer exists
 * (`agents.stale` — detection only, never a rewrite; agents-stamp.ts).
 *
 * The document is assembled from its sections by PLAIN CONCATENATION — no join
 * separator. Each section is carved at line boundaries and carries its own
 * trailing newline, so the assembled string is byte-identical to the single
 * template literal this package replaced.
 */
import { agentsStampLine } from "./agents-stamp.js";
import { LOAM_VERSION } from "../envelope/version.js";
import { ARTIFACTS } from "./agents-md/artifacts.js";
import { COMMAND_MAP } from "./agents-md/command-map.js";
import { SUBSYSTEM_COMMANDS } from "./agents-md/map/subsystem.js";
import { CYCLE } from "./agents-md/cycle.js";
import { REFUSALS } from "./agents-md/refusals.js";
import { SPINE } from "./agents-md/spine.js";

export const AGENTS_MD =
  `${agentsStampLine(LOAM_VERSION)}\n` + ARTIFACTS + SPINE + CYCLE + COMMAND_MAP + SUBSYSTEM_COMMANDS + REFUSALS;
