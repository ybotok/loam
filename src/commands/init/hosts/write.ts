/**
 * How `init` lays down a file a host reads and a person owns from then on — an
 * MCP config, Copilot's setup workflow: create it where the path is free, and
 * otherwise leave it byte-for-byte alone. No parse, no key merge, no rewrite.
 * Unlike the agent files, nothing here is ever refreshed: these are config, and
 * the first edit somebody makes to one is the point of having it.
 */
import { existsSync } from "node:fs";
import { relative } from "node:path";
import { stageWrites } from "../../../core/staging/commit.js";
import { commitStaged } from "../../../core/staging/txn/transaction.js";
import { planWrite } from "../../../core/staging/writes.js";

/**
 * What happened to one such file on this run. `skipped` is the never-overwrite
 * contract every other init delivery follows, and for the same reason: loam
 * does not merge into a file a human owns.
 */
export type CreateOutcome =
  | { kind: "created" }
  | { kind: "skipped" }
  | { kind: "failed"; code: "merge-failed" | "rollback-incomplete"; message: string };

/** One file a host reads: where it goes, what it holds, and what to tell a person who has one already. */
export interface HostFile {
  readonly path: string;
  /** Every path whose presence means the host's file is a person's already. */
  readonly owned: readonly string[];
  readonly content: string;
  /** The command a killed run's journal tells a person to run again. */
  readonly rerun: string;
  /** Where loam's entry goes in a file loam did not write, and the entry — null where there is no entry to paste. */
  readonly paste: { readonly into: string; readonly lines: readonly string[] } | null;
}

/** The path of a host's file that is already here, or null when loam may create one. */
export const ownedAlready = (file: HostFile): string | null => file.owned.find((p) => existsSync(p)) ?? null;

/** What happened to each host file on this run. */
export interface HostWrites {
  created: string[];
  /** Somebody's already: left alone. `found` is the repo-relative file that was there. */
  skipped: Array<{ file: HostFile; found: string }>;
  failed: Extract<CreateOutcome, { kind: "failed" }> | null;
}

/**
 * Write each file that is not there yet, stopping at the first that fails: a
 * config half-landed is a host that starts a broken server.
 */
export async function writeHostFiles(cwd: string, files: readonly HostFile[]): Promise<HostWrites> {
  const out: HostWrites = { created: [], skipped: [], failed: null };
  for (const file of files) {
    const owned = ownedAlready(file);
    const outcome = owned === null ? await createOnce(cwd, file.path, file.content, file.rerun) : { kind: "skipped" as const };
    if (outcome.kind === "failed") return { ...out, failed: outcome };
    if (outcome.kind === "created") out.created.push(file.path);
    else out.skipped.push({ file, found: relative(cwd, owned ?? file.path).split(/[\\/]/).join("/") });
  }
  return out;
}

/**
 * The human half of a skip. A refusal that only says "already there" leaves a
 * person to work the entry out from a WORKFLOW.md example that names the bare
 * binary, which may be the wrong one here — so each skipped file comes with
 * the exact entry, in the launch form this install shape needs. Nothing was
 * read out of their file to produce it.
 */
export function skippedNotes(writes: HostWrites): string[] {
  return writes.skipped.flatMap(({ file, found }) => [
    `  ${(file.paste === null ? "setup:" : "mcp:").padEnd(11)}${found} is already here — left exactly as it is.`,
    ...(file.paste === null
      ? []
      : [`             paste this into ${file.paste.into}:`, ...file.paste.lines.map((line) => `               ${line}`)]),
  ]);
}

/**
 * Create `path` with `content`, or report why not.
 *
 * Through the journaled transaction every other loam writer uses, not a bare
 * `writeFile`: the write is an exclusive create (the existsSync above proves
 * the path is free), so two inits racing for the same repository serialise
 * into the same "already there, left alone" answer instead of one of them
 * silently burying the other's bytes. `cwd` is the repository being
 * scaffolded, which is where a killed run's `.loam-commit` belongs — the same
 * place `gherkin` journals its own writes into a service repo. `rerun` is the
 * command that journal tells a person to run again.
 */
export async function createOnce(cwd: string, path: string, content: string, rerun: string): Promise<CreateOutcome> {
  if (existsSync(path)) return { kind: "skipped" };

  const staged = await stageWrites([planWrite(path, content)]);
  const target = relative(cwd, path).split(/[\\/]/).join("/");
  const committed = await commitStaged({ root: cwd, command: "init", rerun, target }, staged, "written");
  if (committed.ok) return { kind: "created" };
  // A lost exclusive create is the never-overwrite contract firing one layer
  // down — somebody else's file is there now, and "present, so skipped" is the
  // answer the probe above would have given a moment later. Nothing of ours
  // went in; there is no half-state to report.
  if (committed.raced) return { kind: "skipped" };
  return { kind: "failed", code: committed.code, message: committed.message };
}
