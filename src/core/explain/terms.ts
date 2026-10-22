/**
 * The concept terms `loam explain` answers — the vocabulary wall an agent hits
 * in its first minute, before any docs repo exists to read, and the words loam
 * itself prints to a person: the stage `loam status` reports, the claims and
 * verdicts of `loam verify`, the steps of `loam tasks`, the rungs of the
 * maturity ladder.
 *
 * The paragraphs live one package down, in ./terms/, one module per subject;
 * this module assembles them and names the texts their pins point at. The
 * split came when the registry outgrew its first six terms: twenty-odd
 * paragraphs do not fit one 400-line file, src/core/explain/ was already at
 * its five-file cap, and the terms fall into the four clusters the listing
 * prints them under — which is a subject seam, not a line count. `TERMS` and
 * `PIN_SOURCE_TEXT` stay exported from here so every importer (the lookup, the
 * MCP tool table, the tests) reads the registry from where it always did.
 *
 * Each paragraph is authored in ./terms/, but it is not free to drift: every
 * entry carries pin phrases lifted VERBATIM from the section that teaches the
 * concept, and test/explain.test.ts asserts each phrase appears both in the
 * paragraph and in its named source constant. Rewording that prose therefore
 * breaks the pairing loudly — the same discipline the compiler applies to
 * refusals.ts, done with a test because prose has no type. A pin phrase is
 * kept to one source LINE, because the sections wrap at ~80 columns and a
 * phrase spanning a wrap would never match.
 *
 * A source is no longer always an agents-md section. When the reference pages
 * were split out of the scaffolded AGENTS.md, the frontmatter teaching went
 * with them, and `vouch`'s pin went with the text rather than being reworded
 * to something still in the file — the pairing is with whatever loam SHIPS as
 * the teaching, not with one delivery of it.
 *
 * The converse failure is a source that ships NOWHERE, and it happened: once
 * AGENTS.md became the one ORIENTATION literal (../agent/agents-md.ts), the old
 * section constants this file still imported — the long cycle, the layout
 * opening, the binding rule — were assembled into nothing, so the pins on them
 * guarded prose no reader could see and the drift test passed vacuously. Those
 * sources were deleted with the constants; a pin now names a page the binary
 * prints or the AGENTS.md it writes, never a constant that merely compiles.
 * The five sources added with the printed-word terms follow that rule: each is
 * a whole page `loam instructions` prints — the loam-codes page rather than its
 * `loam status` section, the /loam-implement body rather than its step 3.
 */
import { AGENTS_MD } from "../agent/agents-md.js";
import { REFUSALS } from "../agent/agents-md/refusals.js";
import { LOAM_CHECK } from "../agent/workflows/check.js";
import { LOAM_VERIFY } from "../agent/workflows/closing.js";
import { LOAM_FEATURE } from "../agent/workflows/feature.js";
import { LOAM_IMPLEMENT } from "../agent/workflows/implement.js";
import { LOAM_AUTHORING } from "../agent/workflows/reference/authoring.js";
import { LOAM_CODES } from "../agent/workflows/reference/codes.js";
import { LOAM_DONE_CHECK } from "../agent/workflows/reference/done-check.js";
import { LOAM_DRAWING } from "../agent/workflows/reference/drawing/drawing.js";
import { LOAM_SPINE } from "../agent/workflows/reference/spine.js";
import { DOCUMENT_TERMS, DRAWING_TERMS } from "./terms/documents.js";
import { DONE_CHECK_TERMS } from "./terms/done-check.js";
import type { PinSource, TermEntry, TermGroup } from "./terms/entry.js";
import { STAGE_TERMS } from "./terms/stages.js";
import { TASK_TERMS } from "./terms/tasks.js";

/**
 * The shipped texts the pins point at, for the drift test and for anyone
 * auditing a pairing.
 *
 * `REFUSALS` is still listed and still pinned against, and it is no longer a
 * section of AGENTS.md — it is the refusal half of the `loam-codes` page. The
 * constant is what a pin names, and the constant did not move; only its
 * delivery did. `CODES_PAGE` is that whole page, which is where the `loam
 * status` section teaching the five stage values is printed.
 *
 * The workflow bodies are the raw protocol text, `$1`/`$2` placeholders and
 * all — `loam instructions` substitutes them on the way out — so a pin phrase
 * must never span a placeholder, or it would match here and not on the page a
 * reader is shown.
 */
export const PIN_SOURCE_TEXT: Record<PinSource, string> = {
  AGENTS_MD,
  SPINE_PAGE: LOAM_SPINE.body,
  REFUSALS,
  AUTHORING: LOAM_AUTHORING.body,
  DRAWING: LOAM_DRAWING.body,
  DONE_CHECK: LOAM_DONE_CHECK.body,
  CODES_PAGE: LOAM_CODES.body,
  CHECK: LOAM_CHECK.body,
  FEATURE: LOAM_FEATURE.body,
  IMPLEMENT: LOAM_IMPLEMENT.body,
  VERIFY: LOAM_VERIFY.body,
};

/**
 * The registry, by subject, in the order the bare `loam explain` listing
 * prints it: where a feature stands first, because `loam status` is the first
 * command a newcomer runs, then the two commands whose words its next steps
 * send a reader to, then the document vocabulary underneath all three, and
 * last the words for drawing the map, which no command prints and every page
 * that draws an edge uses.
 */
export const TERM_GROUPS: readonly TermGroup[] = [
  STAGE_TERMS,
  DONE_CHECK_TERMS,
  TASK_TERMS,
  DOCUMENT_TERMS,
  DRAWING_TERMS,
];

/** Every term, flat, in listing order — what the lookup searches and the `--json` listing returns. */
export const TERMS: readonly TermEntry[] = TERM_GROUPS.flatMap((group) => group.terms);
