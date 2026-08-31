/**
 * The agent surface: which tool files this repo should hold, which it does, and
 * whether they still describe this binary.
 *
 * The registry filter lives here rather than in the config loader because a
 * config written by a newer binary may name a tool this one has never heard of,
 * and refusing to load it would break every command rather than just this
 * check. A tool loam cannot plan files for is a tool it has nothing to say
 * about — so the preflight stays read-only instead of crashing on a config from
 * the future.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { relative } from "node:path";
import { type LoamConfig } from "../envelope/config.js";
import { LOAM_VERSION } from "../envelope/version.js";
import { agentsPath } from "../repo/paths.js";
import {
  DELIVERIES,
  plannedCommandFiles,
  type AgentProfile,
  type Delivery,
} from "../agent/scaffold.js";
import { AGENT_TOOLS } from "../agent/tools/registry.js";
import {
  agentsStaleFinding,
  binaryBehindFinding,
  agentsStampLine,
  agentsStampVersion,
  versionTrails,
} from "../agent/agents-stamp.js";
import { type AgentSurface, type DoctorFinding } from "./report.js";
import type { DocsDir } from "../kernel/ids/dirs.js";

export function recordedTools(config: LoamConfig | null): string[] | null {
  const ids = (config?.agentTools ?? []).filter((t) => t in AGENT_TOOLS);
  return ids.length === 0 ? null : ids;
}

/**
 * Which tools this repo has agent files for, asked of the layout itself: a tool
 * counts when any file it would be given is already there.
 *
 * The fallback for a loam.json written before `agentTools` existed, and the
 * only answer a hand-written one can have — so its absence must never be the
 * thing that reports a problem. This asks a narrower question than `init`'s
 * own scan, and on purpose: init scans for a tool's dot-directory to decide
 * what a repo would LIKE, while doctor grades what loam has already put there.
 * A repo that runs Claude Code and took `--no-commands --no-skills` has chosen
 * to have no loam files, and is not behind the binary for it.
 */
export function detectedTools(repoRoot: string): string[] {
  return Object.keys(AGENT_TOOLS).filter((id) =>
    plannedCommandFiles(repoRoot, [id]).some((f) => existsSync(f.path)));
}

/**
 * Which deliveries this repo actually HOLDS for one tool — a delivery counts
 * when at least one of its files is on disk.
 *
 * `loam init --no-skills` (or `--no-commands`) records the tool in `agentTools`
 * and writes one delivery, so planning both and subtracting what exists reported
 * every skill file as missing on a brand-new repo — under a message saying it
 * "was initialized by an older loam" and a `fix` that re-runs init without the
 * flag that was the whole point. Which deliveries a repo asked for is written
 * down nowhere, and must not be: the files ARE the record (there is no state
 * file loam can disagree with). So the question is asked of them.
 *
 * A tool with NO files at all is the other story — recorded, then deleted — and
 * the caller falls back to the full plan there, which is what the finding's
 * "or they were deleted" already says.
 */
export function heldDeliveries(
  repoRoot: string,
  tool: string,
  profile: AgentProfile = "full",
): readonly Delivery[] {
  const held = DELIVERIES.filter((d) =>
    plannedCommandFiles(repoRoot, [tool], [d], profile).some((f) => existsSync(f.path)));
  return held.length > 0 ? held : DELIVERIES;
}

/**
 * Of the planned files that ARE here, the ones whose stamp is missing or older
 * than this binary.
 *
 * The STALENESS check reads only the stamp, never the body. Safe refresh is a
 * separate decision made by `init`: the current bytes must match the digest
 * recorded when loam wrote them. That proof lets an unchanged pointer refresh
 * without turning a differing body into an offer to overwrite it. A stamp is a
 * different claim — it says which loam wrote these instructions — and it can
 * be false while every edit around it is legitimate. Same doctrine as
 * AGENTS.md (agents-stamp.ts); a customized file is repaired only when a human
 * reviews it and bumps the stamp or deletes it for `loam init` to recreate.
 *
 * Absence of a stamp counts, because that is what every file written before
 * stamping existed looks like — precisely the "initialized by an older loam"
 * population this check is for.
 */
export async function staleAgentFiles(
  repoRoot: string,
  planned: Array<{ path: string }>,
): Promise<string[]> {
  // Read them together rather than one after another. `planned` is bounded by
  // the tool registry — every delivery of every tool loam knows, a couple of
  // hundred small files — so there is nothing here worth a concurrency cap, and
  // `Promise.all` preserves input order, which is the only property the caller
  // asks of the list it gets back.
  const graded = await Promise.all(planned.map(async (file): Promise<string | null> => {
    let text: string;
    try {
      text = await readFile(file.path, "utf8");
    } catch {
      // Unreadable is not stale: it is either the missing-file finding above or
      // a permissions problem, and neither is answered by editing a stamp.
      return null;
    }
    const stamp = agentsStampVersion(text);
    if (stamp === null || versionTrails(stamp, LOAM_VERSION)) {
      return relative(repoRoot, file.path).split(/[\\/]/).join("/");
    }
    return null;
  }));
  return graded.filter((p) => p !== null);
}

/**
 * What the running binary would write for this repo's tools that is not here,
 * and what is here under an older loam's name.
 *
 * Presence is `existsSync`, the same probe `init` uses to compute its `skipped`
 * list, so doctor cannot disagree with init about which files init would write.
 */
export async function inspectAgentSurface(
  repoRoot: string,
  config: LoamConfig | null,
  docsDir: DocsDir | null,
  findings: DoctorFinding[],
): Promise<AgentSurface> {
  const recorded = recordedTools(config);
  const tools = recorded ?? detectedTools(repoRoot);
  const profile = config?.agentProfile ?? "full";
  const planned = tools.flatMap((id) =>
    plannedCommandFiles(repoRoot, [id], heldDeliveries(repoRoot, id, profile), profile));
  const present = planned.filter((f) => existsSync(f.path));
  const missingFiles = planned
    .filter((f) => !existsSync(f.path))
    .map((f) => relative(repoRoot, f.path).split(/[\\/]/).join("/"));
  const staleFiles = await staleAgentFiles(repoRoot, present);

  if (missingFiles.length > 0) {
    // A warning, never a blocker: an out-of-date command set is a repo whose
    // agents have fewer entry points than they could, not one where anything
    // refuses to run. doctor's blockers are for the second kind.
    //
    // The fix spells `--docs` and `--tools` and deliberately NOT `--service`:
    // `init` spreads the committed config forward, and a `--docs`-less re-run
    // keeps the pointer the repo already commits, so the binding survives
    // untouched. Every interpolation here stands for exactly one argument —
    // test/agent-commands-runnable.test.ts parses this string, and a `${flags}`
    // holding three of them is a command it cannot check.
    findings.push({
      severity: "warning",
      code: "doctor.agent-files-missing",
      message:
        `${missingFiles.length} of the ${planned.length} command and skill files loam v${LOAM_VERSION} `
        + `lays down for ${tools.join(", ")} are not in this repo — it was initialized by an older loam, `
        + `or they were deleted: ${missingFiles.join(", ")}`,
      fix:
        `Re-run \`loam init --docs ${config?.docsDirAsWritten ?? "<dir>"} --tools ${tools.join(",")}\` `
        + "here — it creates files that are absent and keeps this repo's service binding. Files unchanged "
        + "since loam wrote them refresh safely; customized files stay untouched.",
    });
  }

  if (staleFiles.length > 0) {
    // Also a warning, and for a stronger reason than the one above: these files
    // are the team's now. Only a person can say whether their edits still mean
    // what the current binary's tables say, so loam reports and stops.
    findings.push({
      severity: "warning",
      code: "doctor.agent-files-stale",
      message:
        `${staleFiles.length} of the ${planned.length} command and skill files here carry no `
        + `\`${agentsStampLine(LOAM_VERSION)}\` stamp, or one older than this loam — the protocol and `
        + `code tables they instruct an agent with may describe a loam that no longer exists: `
        + `${staleFiles.join(", ")}`,
      fix:
        "Read each against the body this loam writes, then set its stamp line to "
        + `\`${agentsStampLine(LOAM_VERSION)}\`; or re-run \`loam init\`. A file whose recorded digest `
        + "still matches is refreshed; a customized file is preserved and remains yours to review.",
    });
  }

  // AGENTS.md lives in the DOCS repo, not here: it travels with the thing it
  // describes. The comparison is `agentsStaleFinding`'s, not a second copy of
  // it — doctor only adds the `fix` column its own findings owe the reader.
  const agentsFile = docsDir === null ? null : agentsPath(docsDir);
  let agentsText: string | null = null;
  if (agentsFile !== null) {
    try {
      agentsText = await readFile(agentsFile, "utf8");
    } catch {
      // Unreadable reads as absent, exactly as `validate --all` treats it: no
      // file, no contract to have drifted. An unreadable docs repo is already
      // its own finding.
    }
  }
  const stale = agentsStaleFinding(agentsText, LOAM_VERSION);
  if (stale !== null) {
    findings.push({
      severity: "warning",
      code: stale.code,
      message: stale.message,
      fix:
        `Review ${agentsFile} against the current \`loam --help\`, then set its stamp line to `
        + `\`${agentsStampLine(LOAM_VERSION)}\`. loam never rewrites that file — bumping the stamp IS `
        + "the record that somebody looked.",
    });
  }
  // The mirror, and a different fix: nothing is wrong with the documents, the
  // reader is behind them — so this one never points at AGENTS.md.
  const behind = binaryBehindFinding(agentsText, LOAM_VERSION);
  if (behind !== null) {
    findings.push({
      severity: "warning",
      code: behind.code,
      message: behind.message,
      fix: "Upgrade loam (`npm i -g @ybotok/loam`), then re-run. Do not edit AGENTS.md: its stamp is correct and this binary is the older half.",
    });
  }

  return {
    tools,
    profile,
    toolsSource: recorded === null ? "disk" : "config",
    plannedFiles: planned.length,
    missingFiles,
    staleFiles,
    stamp: {
      path: agentsFile,
      present: agentsText !== null,
      version: agentsText === null ? null : agentsStampVersion(agentsText),
      stale: stale !== null,
    },
  };
}

/**
 * Grade what a write that did not finish left in the docs repo.
 *
 * Three of the four are blockers, which is unusual for doctor and deliberate:
 * they are not "you have fewer entry points than you could", they are "the
 * living docs may be half-written and the next reader cannot tell". Before this
 * existed, a SIGKILL between two of archive's renames left `doctor: healthy:
 * true` over merged spec.md + openapi.yaml and an unmerged landscape, and the
 * next `loam archive` reported loam's own half-merge as the author's bug.
 *
 * The temp files are the exception: a `.loam-*.tmp` was never linked into place,
 * so nothing reads it and nothing depends on it. It is litter, not damage.
 */
