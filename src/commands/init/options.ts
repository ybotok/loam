/**
 * The three questions `loam init` answers before it writes anything: which
 * agent tools were asked for, where the docs are being recorded, and whether a
 * directory already IS a docs repo.
 *
 * They are here rather than inline because each one has a default that is a
 * decision. `--tools` has no commander default on purpose, so an explicit flag
 * stays distinguishable from none — which is what lets the autodetection
 * fallback and the `--no-*` contradiction be decided rather than silently
 * arbitrated.
 */
import { existsSync } from "node:fs";
import type { DocsDir } from "../../core/kernel/ids/dirs.js";
import { fail } from "../../core/envelope/json.js";
import { agentsPath } from "../../core/repo/paths.js";
import { docsRepoState } from "../../core/repo/state.js";
import { AGENT_TOOLS } from "../../core/agent/tools/registry.js";
import {
  AGENT_PROFILES,
  type AgentProfile,
} from "../../core/agent/scaffold.js";

export function resolveAgentProfile(
  raw: string | undefined,
  current: AgentProfile | undefined,
  json: boolean,
): AgentProfile | null {
  const value = raw ?? current ?? "full";
  if (AGENT_PROFILES.includes(value as AgentProfile)) return value as AgentProfile;
  fail(json, "invalid-option", `Unknown --agent-profile '${value}'. Expected: ${AGENT_PROFILES.join(" | ")}.`);
  return null;
}

/**
 * Resolve --tools to registry ids, or null after reporting the refusal. The
 * default (the cwd scan) lives at the call site, not in commander, so an
 * explicit `--tools` is distinguishable from none — which is what lets both the
 * autodetection fallback and the `--no-*` contradiction be decided instead of
 * silently arbitrated.
 */
export function resolveTools(raw: string, json: boolean): string[] | null {
  const supported = Object.keys(AGENT_TOOLS);
  if (raw === "all") return supported;
  const ids = [...new Set(raw.split(",").map((t) => t.trim()).filter((t) => t !== ""))];
  const unknown = ids.filter((t) => !(t in AGENT_TOOLS));
  if (ids.length === 0 || unknown.length > 0) {
    fail(
      json,
      "invalid-option",
      (ids.length === 0
        ? "--tools names no tool."
        : `--tools does not recognize: ${unknown.join(", ")}.`) +
        ` Supported: ${supported.join(", ")} — or "all".`,
    );
    return null;
  }
  return ids;
}

/**
 * `--docs` exactly as the caller wrote it, with separators normalised.
 *
 * Stored verbatim on purpose. `init` used to resolve it and write the absolute
 * result, which meant a committed loam.json named a directory that existed on
 * one laptop: every teammate who cloned the service repo got a docsDir under
 * someone else's home directory, and `loam list` reported an empty fleet
 * instead of saying so. `loadConfig` resolves relative paths against the config
 * file's own directory, so `../docs` keeps meaning "next to this repo" wherever
 * the pair is checked out. An absolute `--docs` is still stored absolute — that
 * is the caller's explicit choice, and `loam doctor` warns about it.
 *
 * Backslashes become forward slashes so a config written on Windows resolves on
 * POSIX; a trailing separator is dropped so the stored spelling is stable.
 */
export function storedDocsDir(raw: string): string {
  const slashed = raw.split("\\").join("/");
  if (slashed.length <= 1) return slashed;
  const trimmed = slashed.replace(/\/+$/, "");
  return trimmed === "" ? "/" : trimmed;
}

/**
 * Does this directory already hold a docs repo? `services/` plus `AGENTS.md` —
 * the two things every docs repo has and no service repo does. The pair is the
 * whole point: a single marker would make `init --docs ../srv` (a typo for
 * `../docs`) look like a join and adopt the service repo as the fleet.
 */
export function isDocsRepo(dir: DocsDir): boolean {
  return docsRepoState(dir).kind === "ok" && existsSync(agentsPath(dir));
}
