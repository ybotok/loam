/**
 * The part of `init`'s human view that says what the run did to files: what
 * it wrote, what it refreshed, what moved, and what it left alone and why.
 * Lines rather than printing, as first-hour.ts does, so init.ts stays the
 * wiring and this stays a function of its inputs.
 */
import type { RetiredAgentFiles } from "../../core/agent/scaffold.js";
import { copilotCloudNote, type McpLaunch } from "./hosts/mcp.js";
import { skippedNotes, type HostWrites } from "./hosts/write.js";

export interface Written {
  created: readonly string[];
  refreshed: readonly string[];
  retired: RetiredAgentFiles;
  hosts: HostWrites;
  /** The launch Copilot's cloud agent is told to use — set when this run wrote MCP config with Copilot selected. */
  cloud: McpLaunch | null;
}

const section = (heading: string, mark: string, paths: readonly string[]): string[] =>
  paths.length === 0 ? [] : [`  ${heading}:`, ...paths.map((path) => `    ${mark} ${path}`)];

export function writtenLines(w: Written): string[] {
  return [
    ...section("scaffolded", "+", w.created),
    ...section("refreshed (unchanged since loam last wrote them)", "↻", w.refreshed),
    ...section("removed (the tool reads them elsewhere now; unchanged since loam wrote them)", "-", w.retired.removed),
    ...section("left in place (edited since loam wrote them; the tool reads both copies until you merge or delete each)", "!", w.retired.superseded),
    // A skipped host file earns more than its line in `skipped`: the caller
    // asked for it by name, so they are handed the entry to paste.
    ...skippedNotes(w.hosts),
    ...(w.cloud === null ? [] : copilotCloudNote(w.cloud)),
  ];
}
