/**
 * The fleet's flow STORAGE, graded: the documents under `architecture/flows/`,
 * the groups they declare, and the generated `architecture/flow-groups.likec4`
 * that mirrors those groups.
 *
 * Three findings, and each answers a different question a fleet cannot answer
 * for itself:
 *
 *   `flow.invalid` — a flow document exists and does not parse. Reported alone,
 *   like `landscape.invalid` and for its reason: an unreadable journey
 *   contributes no group, so grading the generated file behind it would say the
 *   file must be DELETED — destroying every correct group view over one typo.
 *
 *   `flow.group-invalid` — a tag on a flow that takes the feature-id grammar.
 *   Feature tags and group tags share one line of one view, so the shape of the
 *   name is the only thing that can tell them apart; loam reads such a tag as
 *   the feature tag it looks like, and this says so, because a suite that
 *   silently contains nothing looks exactly like a suite nobody has written.
 *
 *   `flow.views-stale` — the generated file's bytes do not match the flows. One
 *   error on exactly one file, repaired by exactly one command
 *   (`loam flow sync`), graded by BYTE COMPARISON and never by a parse: the
 *   file is a scoping convenience for the LikeC4 renderer, nothing in loam ever
 *   reads its content, and a views-only document does not parse standalone
 *   anyway (`core/repo/tree/views.ts` records the spike).
 *
 * Absence counts as a state of its own on both sides: a fleet with groups and
 * no file is stale, and a fleet with NO group and a leftover file is stale too.
 *
 * Graded only when the landscape PARSED (the caller holds that gate): the flow
 * documents are read as one project WITH the fleet map, so an unreadable map
 * would make every participant an unresolved reference and cascade this whole
 * module behind `landscape.missing`/`landscape.invalid`.
 *
 * THE STATE IS HANDED IN, and the read is the caller's (`./load.ts`), because
 * `./flows.ts` grades the SAME journeys against the scenarios covering them:
 * two readers would be two Langium workspaces per run, and — worse than the
 * cost — two answers, so a fleet could be told to write a `Covers:` line for a
 * journey the other half had decided it could not see.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import type { Flow } from "../../../core/c4/flows/flow.js";
import { reservedGroupTags } from "../../../core/flows/groups.js";
import { flowErrorLine, type FlowState } from "../../../core/flows/project.js";
import type { DocsDir } from "../../../core/kernel/ids/dirs.js";
import { FEATURE_ID_RULE } from "../../../core/kernel/ids/feature.js";
import { flowGroupViewsPath } from "../../../core/repo/paths.js";
import type { Finding } from "../../../core/vocabulary/report.js";

/** Where the generated file sits, as every message spells it. */
const VIEWS_FILE = "architecture/flow-groups.likec4";
/** Where the authored journeys sit, as every message spells it. */
const FLOWS_DIR = "architecture/flows";

export async function flowGroupFindings(docsDir: DocsDir, state: FlowState): Promise<Finding[]> {
  if (state.errors.length > 0) {
    return [
      {
        severity: "error",
        code: "flow.invalid",
        subject: FLOWS_DIR,
        message:
          `flows: ${state.errors.length} error(s) reading the fleet's journeys — nothing can be ` +
          `concluded from a journey nobody can read, so the groups they declare and ${VIEWS_FILE} ` +
          "are both ungraded until they do. A flow document names elements and tags the fleet map " +
          "declares, and loam reads the two as one LikeC4 project exactly as the renderer does.",
        details: state.errors.map((err) => flowErrorLine(docsDir, err)),
      },
    ];
  }
  return [...reservedTagFindings(state.flows), ...(await staleFindings(docsDir, state.expected))];
}

/** `flow.group-invalid`, one per (flow, tag) — see the header for why it reports rather than refuses. */
function reservedTagFindings(flows: Flow[]): Finding[] {
  return reservedGroupTags(flows).map((reserved) => ({
    severity: "warn" as const,
    code: "flow.group-invalid",
    subject: reserved.flow,
    message:
      `flows: view '${reserved.flow}' carries tag #${reserved.tag}, which takes the feature-id grammar ` +
      `(${FEATURE_ID_RULE}) — feature tags and group tags sit on the same view, so loam reads it as the ` +
      "FEATURE tag it looks like: it names no suite, joins no group, and puts its participants into no " +
      `view in ${VIEWS_FILE}. Rename the group, or drop the tag if the feature that put it there shipped.`,
  }));
}

/**
 * `flow.views-stale`, by byte comparison against the expected render — the one
 * question loam owes a file it never otherwise reads.
 */
async function staleFindings(docsDir: DocsDir, expected: string | null): Promise<Finding[]> {
  const path = flowGroupViewsPath(docsDir);
  const actual = existsSync(path) ? await readFile(path, "utf8") : null;
  if (actual === expected) return [];
  const state =
    actual === null
      ? "does not exist, but the flows declare groups to mirror"
      : expected === null
        ? "exists, but no flow declares a group — the generated file must be absent"
        : "does not match the flows";
  return [
    {
      severity: "error",
      code: "flow.views-stale",
      subject: VIEWS_FILE,
      message:
        `flows: ${VIEWS_FILE} ${state} — it is generated, one view per group, its members the union of ` +
        "that group's flows' participants, and every scope drawn from it is wrong until it agrees. " +
        "Run `loam flow sync` to regenerate it; never edit it by hand.",
    },
  ];
}
