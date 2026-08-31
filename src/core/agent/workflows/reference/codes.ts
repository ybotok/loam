/**
 * The `loam-codes` reference page: which codes each INVOCATION can raise.
 *
 * The largest of the four pages and the one this migration is mostly about. As
 * a section of AGENTS.md it was 44,433 bytes — 41% of a 109,399-byte file that
 * Codex truncates at 32,768 and Windsurf at 12,000 characters, both silently.
 * It is also the half a reader consults at a moment it can NAME (a run reported
 * something) rather than the half it needs to form a question at all, which is
 * what decided which side of the split it went. ./reference.ts carries the rest
 * of that argument.
 *
 * This module does one thing: it CONCATENATES, in the order ../../agents-md.ts
 * used to. Nothing here reformats a part on the way past, and nothing here is
 * written — every byte comes from ../../agents-md/, which is where the sections
 * already lived and where they stayed. The parts still carry their own trailing
 * newlines and are joined with no separator, so the printed page is the old
 * section byte for byte.
 *
 * WHAT IS AND IS NOT DUPLICATED. `## Reading loam's output` still exists in
 * AGENTS.md (../../agents-md/command-map.ts's READING_OUTPUT), and it is a
 * different three facts, not a summary of these: that every command speaks
 * JSON, that the envelope survives a bad invocation, and that codes are the
 * contract, plus the two places the detail went. The per-invocation inventory
 * below appears in exactly one place.
 */
import { CODE_MAP } from "../../agents-md/command-map.js";
import { CONTEXT_COMMAND } from "../../agents-md/map/lenses/context.js";
import { DIFF_COMMAND } from "../../agents-md/map/lenses/diff.js";
import { GATE_COMMAND } from "../../agents-md/map/lenses/gate.js";
import { EXPLAIN_COMMAND } from "../../agents-md/map/explain.js";
import { MCP_COMMAND } from "../../agents-md/map/mcp.js";
import { SUBSYSTEM_COMMANDS } from "../../agents-md/map/subsystem.js";
import { USECASE_VIEWS } from "../../agents-md/map/usecases.js";
import { REFUSALS } from "../../agents-md/refusals.js";
import type { CommandContent } from "../../contract.js";

export const LOAM_CODES: CommandContent = {
  name: "loam-codes",
  description: "Reference: which codes each invocation can raise, command by command",
  // No arguments: one document, printed whole. See ./spine.ts for why the hint
  // is empty rather than a spelled-out "<none>".
  argumentHint: "",
  purpose:
    "The per-invocation inventory: which findings `validate --service` / `--feature` / `--all`, `status`, `doctor`, `gate`, `context`, `diff`, `explore`, `dependencies`, `rebase`, `seed`, `subsystem` and `mcp` can report, and the refusals the containment surface answers with.",
  invocation: "loam instructions loam-codes",
  placeholders: [],
  // The page carries no `## ` headings — it is one list, and the bullets are
  // the structure. The spine names the invocations it walks instead, which is
  // what a reader is actually looking one of up.
  spine: [
    "validate --service / --feature / --all",
    "status, doctor, rebase, dependencies, explore, seed",
    "context, gate, subsystem, use-case views, diff, explain, mcp",
    "the containment refusals and the OpenSpec migration surface",
  ],
  // CODE_MAP already opens with the page's own "**What this page is.**" and
  // leads with `status`, the orientation command.
  body:
    CODE_MAP +
    CONTEXT_COMMAND +
    GATE_COMMAND +
    SUBSYSTEM_COMMANDS +
    USECASE_VIEWS +
    DIFF_COMMAND +
    EXPLAIN_COMMAND +
    MCP_COMMAND +
    REFUSALS,
};
