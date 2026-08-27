import type { Command } from "commander";
import { statSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { loadConfig } from "../core/envelope/config.js";
import { emitJson, fail, reportNoConfig } from "../core/envelope/json.js";
import { DocsRepoUnavailableError } from "../core/repo/state.js";
import { discoverMembers, type Discovery } from "../core/workspace/discover.js";
import { renderWorkspace, type RenderedFolder } from "../core/workspace/render.js";
import { docsRepoReady, reportDocsRepoError } from "./policy/gate.js";

interface OpenOptions {
  json?: boolean;
  /** --root, collected: each value REPLACES the default scan roots. */
  root?: string[];
  out?: string;
  force?: boolean;
}

/**
 * A fixed default name, not `<basename(docsDir)>.code-workspace`: predictable
 * beats collision-proof for a file that is regenerable on demand, and `--out`
 * is the lever for anyone holding two fleets' workspaces in one directory.
 */
const DEFAULT_OUT = "loam.code-workspace";

/**
 * Is there a directory at `path`? A probe that cannot answer says "no": for a
 * value the user typed, "cannot be read" earns the same `invalid-option`
 * refusal as "is not there" — never an `internal` escape. throwIfNoEntry folds
 * the absent case into the same answer with no window between probe and use;
 * the catch covers the errnos statSync can still raise (EACCES, ENOTDIR — a
 * path routed through a file).
 */
function directoryAt(path: string): boolean {
  try {
    return statSync(path, { throwIfNoEntry: false })?.isDirectory() === true;
  } catch {
    return false;
  }
}

/** The write-path errnos that mean the OUT PATH is wrong, not loam. */
const OUT_PATH_ERRNOS = new Set(["EISDIR", "EACCES", "EPERM", "ENOTDIR", "EINVAL"]);

export function registerOpen(program: Command): void {
  program
    .command("open")
    .description("Write a .code-workspace joining the docs repo and every bound service checkout")
    .option(
      "--root <dir>",
      "scan this directory for bound checkouts instead of the defaults; repeatable",
      (value: string, prev: string[] = []) => [...prev, value],
    )
    .option("--out <file>", `workspace file to write (default ${DEFAULT_OUT} in the current directory)`)
    .option("--force", "overwrite the workspace file if it already exists")
    .option("--json", "emit the machine contract instead of the human view")
    .action(async (opts: OpenOptions) => {
      const json = opts.json === true;
      const loaded = await loadConfig();
      if (loaded.kind !== "loaded") {
        reportNoConfig(json, loaded);
        return;
      }
      const config = loaded.config;
      const { docsDir } = config;
      // "docs", not "services": this command enumerates checkouts on the LOCAL
      // filesystem, not services/ in the docs repo, and a docs repo nobody has
      // run `loam adopt` against is still worth opening an editor on.
      if (!docsRepoReady(json, docsDir, "docs")) return;

      // Both typed paths are validated before any discovery runs: a --root or
      // --out typo is a fact about the INVOCATION, not the fleet, and it must
      // refuse before the scan — not after verdicts were computed over
      // directories nobody meant, and not from the write at the very end.
      const roots = (opts.root ?? []).map((dir) => resolve(dir));
      for (const dir of roots) {
        if (!directoryAt(dir)) {
          fail(json, "invalid-option", `--root does not name a readable directory: ${dir}`);
          return;
        }
      }
      const out = resolve(opts.out ?? DEFAULT_OUT);
      const parent = dirname(out);
      if (!directoryAt(parent)) {
        fail(json, "invalid-option", `--out points into a directory that does not exist: ${parent}`);
        return;
      }

      let discovery: Discovery;
      try {
        discovery = await discoverMembers({
          docsDir,
          // parseConfig always derives `root`; the fallback only documents
          // which absence the optional type would otherwise leave a guess.
          configRoot: config.root ?? process.cwd(),
          ...(config.service === undefined ? {} : { service: config.service }),
          ...(roots.length === 0 ? {} : { roots }),
        });
      } catch (err) {
        // The gate above passed, so this is the repo vanishing mid-run —
        // the same breach the enumeration reports, spelled the same way.
        if (!(err instanceof DocsRepoUnavailableError)) throw err;
        reportDocsRepoError(json, err);
        return;
      }

      // An explicit --root that cannot be LISTED refuses: the caller named the
      // directory, so "I could not look" must never come back as an empty
      // scan. The default roots keep degrading to empty — a CI sandbox that
      // denies the docs repo's parent is survivable, and both views still
      // report the degrade below.
      if (roots.length > 0 && discovery.unreadableRoots.length > 0) {
        const listing = discovery.unreadableRoots
          .map((entry) => `${entry.root} (${entry.problem})`)
          .join("; ");
        fail(json, "invalid-option", `--root cannot be scanned: ${listing}`);
        return;
      }

      if (discovery.duplicates.length > 0) {
        const claims = discovery.duplicates.map(
          (d) => `'${d.service}' is declared by ${d.paths.join(" and ")}`,
        );
        fail(
          json,
          "binding-duplicate",
          `Two checkouts declare the same service for this docs repo: ${claims.join("; ")}. ` +
            "loam will not guess which checkout speaks for the service — narrow the scan " +
            "with --root, or fix the stray loam.json, then re-run.",
        );
        return;
      }
      // Only reachable from the docs repo itself — a service-repo invocation
      // always contributes its own checkout as a member. Skipped candidates
      // ride the message: a checkout whose binding would not parse is the
      // likeliest reason the scan came up empty, and the real fix is that
      // file, not --root.
      if (!discovery.members.some((member) => member.via !== "docs-repo")) {
        const unread = discovery.skipped.length === 0
          ? ""
          : ` ${discovery.skipped.length} candidate binding(s) could not be read and did not` +
            ` count: ${discovery.skipped.map((s) => `${s.path} (${s.problem})`).join("; ")}.`;
        fail(
          json,
          "no-members",
          `No service checkout bound to ${docsDir} was found under ` +
            `${discovery.scannedRoots.join(", ")} — the workspace would hold only the docs ` +
            "repo. Clone a bound service repo beside it, run `loam open` from a service " +
            `repo, or pass --root naming the directory the checkouts live in.${unread}`,
        );
        return;
      }

      const rendered = renderWorkspace(discovery.members, out);
      try {
        // "wx" makes probe-and-write one operation, so a concurrent writer
        // cannot land between an existsSync and the write. --force is honest
        // here where init's generated files needed skip-forever: a workspace
        // file is wholly derived, so overwriting it loses nothing authored.
        await writeFile(out, rendered.text, {
          encoding: "utf8",
          flag: opts.force === true ? "w" : "wx",
        });
      } catch (err) {
        const e = err as NodeJS.ErrnoException;
        if (e.code === "EEXIST") {
          fail(
            json,
            "already-exists",
            `${out} already exists. Pass --out naming another file, or --force to overwrite it.`,
          );
          return;
        }
        // The path-shaped failures: --out names a directory (EISDIR — the
        // exact target the EEXIST remedy above just told the caller to
        // --force), or a place this process may not write. Each is a fact
        // about the out path, so it earns invalid-option, not internal.
        if (typeof e.code === "string" && OUT_PATH_ERRNOS.has(e.code)) {
          fail(
            json,
            "invalid-option",
            `The workspace file cannot be written at ${out}: ${e.message}. ` +
              "Pass --out naming a writable file path.",
          );
          return;
        }
        throw err;
      }

      if (json) {
        emitJson({
          command: "open",
          docsDir,
          out,
          written: true,
          members: rendered.folders.map((folder) => ({
            path: folder.member.path,
            // The exact spelling written into the workspace file, so a
            // consumer never re-derives (and mis-derives) the relative form.
            folder: folder.path,
            name: folder.name,
            service: folder.member.service,
            via: folder.member.via,
            ...(folder.member.via === "scan" ? { root: folder.member.root } : {}),
          })),
          scannedRoots: discovery.scannedRoots,
          unreadableRoots: discovery.unreadableRoots,
          skipped: discovery.skipped,
        });
        return;
      }
      printWorkspace(out, discovery, rendered.folders);
    });
}

function viaText(folder: RenderedFolder): string {
  const member = folder.member;
  if (member.via === "docs-repo") return "docs repo";
  if (member.via === "current-repo") return "this repo";
  return `found under ${member.root}`;
}

function printWorkspace(out: string, discovery: Discovery, folders: RenderedFolder[]): void {
  console.log(`workspace: ${out} (${folders.length} folders)`);
  for (const folder of folders) {
    console.log(`  ${folder.name}  ${folder.path}  (${viaText(folder)})`);
  }
  // Reported beside the result, not folded into it: an unreadable binding or
  // an unlistable default root proves nothing, but silence about either would
  // read as "not bound" / "nothing there".
  for (const entry of discovery.unreadableRoots) {
    console.log(`  ! could not scan ${entry.root}: ${entry.problem}`);
  }
  for (const entry of discovery.skipped) {
    console.log(`  ! skipped ${entry.path}: ${entry.problem}`);
  }
}
