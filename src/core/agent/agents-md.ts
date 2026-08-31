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
import { READING_OUTPUT, REFERENCE_PAGES } from "./agents-md/command-map.js";
import { CYCLE } from "./agents-md/cycle.js";
import { ARCHIVE_GATE } from "./agents-md/shipped/archive-gate.js";
import { SPINE } from "./agents-md/spine.js";

/**
 * Seven sections, and the ones that are NOT here are the point.
 *
 * The per-invocation code inventory, the ID spine's grammars, the authoring
 * grammars and the done-check used to sit between CYCLE and ARCHIVE_GATE. They
 * are now the four pages `loam instructions` prints
 * (./workflows/reference/reference.ts records why), and REFERENCE_PAGES is the
 * index that names each with its exact command — a reference nobody can find
 * being content deleted with extra steps.
 *
 * Nothing was rewritten to move: `codes-drift` reads `AGENTS_MD + PROTOCOLS`
 * and the pages are in `PROTOCOLS`, so every stable code that left this
 * document is still in the corpus that guard grades. The modules the pages are
 * assembled from (`./agents-md/map/`, `./agents-md/map/lenses/`,
 * `./agents-md/refusals.js`) stayed exactly where they were and are imported by
 * ./workflows/reference/codes.ts instead of here — a move of one import, not a
 * repackaging.
 */
export const AGENTS_MD =
  `${agentsStampLine(LOAM_VERSION)}\n` + ARTIFACTS + SPINE + CYCLE + READING_OUTPUT + REFERENCE_PAGES + ARCHIVE_GATE;
