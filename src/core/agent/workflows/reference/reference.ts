/**
 * Why the reference pages exist, what decided which content became one, and the
 * list itself.
 *
 * THE MEASUREMENT. AGENTS.md is auto-loaded from the working directory by every
 * agents.md-aware host, on every session, and `loam init` writes it once and
 * never refreshes it. It had reached 109,399 bytes. Codex truncates the
 * AGENTS.md chain at 32,768 bytes and Windsurf caps a workspace rule file at
 * 12,000 characters — both silently, with no error and no way for the reader to
 * tell which half it was holding. Roughly seventy percent of the document was
 * being dropped on those two hosts, and which seventy percent depended on the
 * host rather than on what the reader needed.
 *
 * THE SPLIT RULE, which is not "move the big parts". Two kinds of content were
 * mixed in one file:
 *
 *  - what a reader needs to FORM a question — the layout, the cycle, which
 *    element is which service, what gates and what only advises, what the words
 *    mean. Without it an agent cannot ask anything, so it cannot be behind a
 *    command it does not know to run. That stays in AGENTS.md;
 *  - what a reader CONSULTS at a moment it can name — the grammars for writing
 *    one document, the inventory of what a command can report, the done-check's
 *    channels. The moment is nameable ("I am writing an arch.spec.md", "a run
 *    reported something"), so the page can be fetched then, and paying for it on
 *    every invocation of every session bought nothing.
 *
 * That rule is why `## Which element IS which service` stayed behind in
 * ../../agents-md/spine.ts while the rest of the ID spine left, and why the
 * per-invocation code inventory left while the three facts about the `--json`
 * envelope stayed. Size followed from the rule; it did not drive it.
 *
 * WHAT A PAGE COSTS AND WHAT IT BUYS. A page printed by the binary describes
 * the loam you are about to run, not the one that scaffolded the repository —
 * which is strictly better than a file `loam init` writes once and never
 * refreshes, and is why `agents.stale` exists at all. What it costs is
 * discoverability: a reference nobody can find is content deleted with extra
 * steps. Three things pay that back, and all three are asserted rather than
 * hoped for — AGENTS.md's own "The reference pages" section names each page
 * with the exact command (test/agents.test.ts), bare `loam instructions` lists
 * them beside the workflows (test/instructions.test.ts), and every stable code
 * that left is still in the corpus test/codes-drift.test.ts reads, because
 * {@link REFERENCES} feeds `PROTOCOLS`.
 *
 * WHAT A PAGE IS NOT. It is not a workflow. It has no steps, takes no
 * arguments, and `loam init` writes NO file for it — ../../protocol.ts feeds
 * this list to `PROTOCOLS` and `placeholderProblems` and to nothing else, so
 * `SLASH_COMMANDS` and `plannedCommandFiles` never see it and no repository
 * gains a generated artifact. Four pages are four more files in every repo loam
 * touches, and the whole point of the move was to stop shipping bytes nobody
 * asked for.
 *
 * THE MOVE WAS A MOVE. Every page's text is its AGENTS.md section verbatim.
 * Nothing was rewritten on the way, because a paraphrase is a second copy that
 * can drift — and removing one of those is what this whole change is for.
 */
import type { CommandContent } from "../../contract.js";
import { LOAM_AUTHORING } from "./authoring.js";
import { LOAM_CODES } from "./codes.js";
import { LOAM_DONE_CHECK } from "./done-check.js";
import { LOAM_SPINE } from "./spine.js";

/**
 * The four pages, in the order AGENTS.md's own index names them — which is the
 * order their sections stood in the document they left, so a reader who knew
 * the file finds them where they were.
 */
export const REFERENCES: CommandContent[] = [
  LOAM_CODES,
  LOAM_SPINE,
  LOAM_AUTHORING,
  LOAM_DONE_CHECK,
];
