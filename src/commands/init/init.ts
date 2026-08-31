import type { Command } from "commander";
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import {
  CONFIG_FILENAME,
  findConfigPath,
  loadConfig,
  localConfigPath,
  saveConfig,
  type StoredConfig,
} from "../../core/envelope/config.js";
import { docsDirOf } from "../../core/kernel/ids/dirs.js";
import { emitJson, fail } from "../../core/envelope/json.js";
import { plannedDocsFiles, scaffoldDocs } from "../../core/docs.js";
import { docsRepoState } from "../../core/repo/state.js";
import { listServices } from "../../core/repo/repo.js";
import { InvalidIdError, assertServiceId } from "../../core/kernel/ids/service.js";
import {
  detectAgentTools,
  plannedCommandFiles,
  syncAgentCommands,
  updatedAgentFileManifest,
  type Delivery,
} from "../../core/agent/scaffold.js";
import { AGENT_TOOLS } from "../../core/agent/tools/registry.js";
import { initExample } from "./example.js";
import { firstHour } from "./first-hour.js";
import { MCP_CONFIG_FILENAME, mcpConfigPath, mcpServerSnippet, writeMcpConfig } from "./mcp.js";
import { isDocsRepo, resolveAgentProfile, resolveTools, storedDocsDir } from "./options.js";

interface InitOptions {
  docs: string;
  service?: string;
  /** --create: make a new docs repo at --docs instead of joining an existing one. */
  create?: boolean;
  /** --force: write loam.json here even though one already governs a parent directory. */
  force?: boolean;
  /** commander's --no-commands: true unless the flag is passed. */
  commands: boolean;
  /** commander's --no-skills: true unless the flag is passed. */
  skills: boolean;
  /**
   * --mcp: also write the repo-root `.mcp.json`. Opt-in and default off — a
   * third delivery, independent of the two `--no-*` flags rather than a
   * variation on them, so it neither contradicts them nor is suppressed by
   * either. See ./mcp.ts for why the file is opt-in at all.
   */
  mcp?: boolean;
  mcpAuthor?: boolean;
  /** --tools: comma-separated AGENT_TOOLS ids, or "all". Absent = autodetect. */
  tools?: string;
  /** Workflow subset to scaffold. */
  agentProfile?: string;
  /** --example: copy the packaged example fleet to this directory and do nothing else. */
  example?: string;
  json?: boolean;
}

export function registerInit(program: Command): void {
  program
    .command("init")
    .description("Initialize loam: create/point at the shared docs repo and write local config")
    .option("--docs <dir>", "path to the shared docs repo (the source of truth)", ".loam-docs")
    .option("--service <id>", "canonical id of the service in this repo")
    .option("--create", "create a new docs repo at --docs instead of joining an existing one")
    .option("--force", `write ${CONFIG_FILENAME} here even though one governs a parent directory`)
    .option(
      "--tools <ids>",
      "agent tools to generate for, overriding the scan of this directory: " +
        `comma-separated (${Object.keys(AGENT_TOOLS).join(", ")}) or "all"`,
    )
    .option("--agent-profile <profile>", "workflow set: full | service | docs")
    .option(
      "--example <dir>",
      "copy the packaged example fleet to <dir> and stop: no repository is bound, nothing is scaffolded",
    )
    .option("--no-commands", "skip the slash commands for this repo entirely")
    .option("--no-skills", "skip the agent skills for this repo entirely")
    .option(
      "--mcp",
      `also write ${MCP_CONFIG_FILENAME} here, so an MCP host launches \`loam mcp\` for this repo`,
    )
    .option("--mcp-author", `write ${MCP_CONFIG_FILENAME} with the opt-in authoring profile`)
    .option("--json", "emit the machine contract instead of the human view")
    .action(async (opts: InitOptions, command: Command) => {
      const json = opts.json === true;
      const cwd = process.cwd();

      // FIRST, before every guard below including the governing-config one:
      // `--example` writes a fresh tree, it does not join a system. A
      // loam.json in an ancestor governs the directories a repository is bound
      // INTO, and this flag binds nothing — refusing here would be the tool
      // declining to show itself working because of a config that has no
      // bearing on the copy. Before the --service id check too, so a run
      // combining the two answers the contradiction rather than grading an id
      // it is about to refuse to use.
      if (opts.example !== undefined) {
        await initExample({
          dir: opts.example,
          conflicts: [
            // `--docs` carries a default, so only its SOURCE can say whether
            // anybody typed it — the same question the docsDir precedence
            // below asks, for the same reason.
            ...(command.getOptionValueSource("docs") !== "default" ? ["--docs"] : []),
            ...(opts.service !== undefined ? ["--service"] : []),
            ...(opts.create === true ? ["--create"] : []),
            ...(opts.tools !== undefined ? ["--tools"] : []),
            ...(opts.agentProfile !== undefined ? ["--agent-profile"] : []),
            ...(opts.mcpAuthor === true ? ["--mcp-author"] : []),
          ],
          json,
        });
        return;
      }

      // The id becomes services/<id>/ in the shared repo, so it is validated
      // before anything is written — by the same rule adopt, vouch and gherkin
      // use, never by a guard invented here.
      if (opts.service !== undefined) {
        try {
          assertServiceId(opts.service);
        } catch (err) {
          if (!(err instanceof InvalidIdError)) throw err;
          fail(json, "invalid-option", err.message);
          return;
        }
      }

      // A loam.json in an ancestor already governs this directory: every command
      // run from here resolves to it. Writing a second one below it would shadow
      // the first for this subtree only — the kind of split-brain nobody
      // discovers until two commands disagree about which docs repo is the fleet.
      const governing = findConfigPath(cwd);
      if (governing !== null && governing !== localConfigPath(cwd) && opts.force !== true) {
        fail(
          json,
          "already-exists",
          `${governing} already governs this directory. ` +
            `Run loam from ${resolve(governing, "..")}, or pass --force to give this ` +
            `subdirectory its own ${CONFIG_FILENAME}.`,
        );
        return;
      }

      // Only THIS directory's config is spread forward. Under --force there is
      // a config in an ancestor too, and inheriting its `service` would bind
      // this repo to a service somebody else's repo declared.
      // `kind: "invalid"` reads as null on purpose: init REPAIRS a corrupt
      // loam.json by rewriting it, so a config nobody can read is treated
      // exactly like no config at all. The old stderr line about it was
      // core's side effect, promised nowhere.
      const load = existsSync(localConfigPath(cwd)) ? await loadConfig(cwd) : null;
      const existing = load?.kind === "loaded" ? load.config : null;

      // A re-run must not move a committed pointer. `--docs` has a default
      // (`.loam-docs`), so an init invoked for any OTHER reason — `--service`,
      // a new `--tools`, the fix `doctor.agent-files-missing` prints — used to
      // arrive here carrying a docsDir nobody typed: the default then named no
      // docs repo, the refusal steered the caller to `--create`, and `--create`
      // rewrote `docsDir` in the committed loam.json to a freshly scaffolded
      // empty one. `validate --all` went green over an empty fleet, which is
      // the exact outcome `--create` exists to prevent. So the flag wins only
      // when it was actually passed; otherwise the file this repo already
      // committed does.
      const committedDocs = existing?.docsDirAsWritten;
      const docsTyped = command.getOptionValueSource("docs") !== "default";
      const docsSource: "flag" | "config" | "default" =
        docsTyped ? "flag" : committedDocs === undefined ? "default" : "config";
      const docsOption = !docsTyped && committedDocs !== undefined ? committedDocs : opts.docs;
      // Branded at the resolution, because the guards below are what validate
      // it — the brand's provenance is "an explicit --docs a command
      // validated", and this command is the one that does. The STORED spelling
      // (`storedDocsDir` below) deliberately stays a plain string.
      const docsDir = docsDirOf(resolve(cwd, docsOption));

      // The one predictable failure: --docs naming a file. Refused here so the
      // caller gets a clean envelope/message instead of mkdir's ENOTDIR throw.
      if (existsSync(docsDir) && !statSync(docsDir).isDirectory()) {
        fail(json, "invalid-option", `--docs points at a file, not a directory: ${docsDir}`);
        return;
      }

      // Joining an existing docs repo and creating a new one are different
      // intentions, and `init` used to perform the second one whenever the first
      // was misspelled: `--docs ../dcos` scaffolded a second, empty docs repo
      // beside the real one, and the fleet quietly split in two. Creation is now
      // something the caller asks for.
      const joining = isDocsRepo(docsDir);
      if (!joining && opts.create !== true) {
        fail(
          json,
          "invalid-option",
          docsRepoState(docsDir).kind === "missing"
            ? `--docs points at a directory that does not exist: ${docsDir}. ` +
              "If that is a typo, fix it; to create a new docs repo there, pass --create."
            : `--docs points at ${docsDir}, which is not a docs repo ` +
              "(a docs repo has services/ and AGENTS.md). " +
              "Point --docs at the shared docs repo, or pass --create to make a new one here.",
        );
        return;
      }

      // --tools selects the files to write; --no-commands and --no-skills each
      // say write none of that kind. Together they contradict — refused, not
      // arbitrated, in either combination.
      const suppressed = [
        ...(opts.commands ? [] : ["--no-commands"]),
        ...(opts.skills ? [] : ["--no-skills"]),
      ];
      if (opts.tools !== undefined && suppressed.length > 0) {
        fail(
          json,
          "invalid-option",
          `--tools contradicts ${suppressed.join(" and ")}: ` +
            "one selects the files to generate, the other suppresses them.",
        );
        return;
      }
      const delivery: Delivery[] = [
        ...(opts.commands ? (["commands"] as const) : []),
        ...(opts.skills ? (["skills"] as const) : []),
      ];

      // Without --tools the repo decides: whichever tools have left their own
      // dot-directories here. Falling back to claude keeps a bare repo behaving
      // exactly as it did before the scan existed. `detected` is reported either
      // way — what the scan saw is a fact about the repo, not about the flags.
      const detected = detectAgentTools(cwd);
      const scanned = detected.length > 0 ? detected : ["claude"];
      const tools = opts.tools === undefined ? scanned : resolveTools(opts.tools, json);
      if (tools === null) return;
      const profile = resolveAgentProfile(opts.agentProfile, existing?.agentProfile, json);
      if (profile === null) return;

      // Probe the pre-existing paths in planned order. Managed files refreshed
      // below are removed from `skipped`; custom and already-current files stay.
      const plannedAgentFiles = delivery.length > 0 ? plannedCommandFiles(cwd, tools, delivery, profile) : [];
      // `.mcp.json` joins the same list rather than being reported on the side:
      // it is a scaffolded path like any other, so it must appear in `created`
      // or in `skipped` by the one rule that governs both. Last, because it is
      // written last.
      const candidates = [
        ...plannedDocsFiles(docsDir),
        ...plannedAgentFiles.map((f) => f.path),
        ...(opts.mcp === true || opts.mcpAuthor === true ? [mcpConfigPath(cwd)] : []),
      ];
      let skipped = candidates.filter((p) => existsSync(p));

      // Joining touches the docs repo not at all: it is somebody's committed
      // repository, and "point at it" must never mean "write to it".
      const created = joining && opts.create !== true ? [] : (await scaffoldDocs(docsDir)).created;
      const generatedFor = delivery.length > 0 ? tools : [];
      let refreshed: string[] = [];
      let managedFiles: Record<string, string> = {};
      if (delivery.length > 0) {
        const synced = await syncAgentCommands({
          cwd,
          toolIds: tools,
          delivery,
          profile,
          known: existing?.agentFiles,
        });
        created.push(...synced.created);
        refreshed = synced.refreshed;
        managedFiles = synced.managed;
        skipped = skipped.filter((path) => !refreshed.includes(path));
      }

      // The third delivery, and the only machine-readable one. It refuses out
      // loud rather than being written best-effort: a `.mcp.json` half-landed
      // is a host that starts a broken server, and the caller asked for it by
      // name. Before saveConfig, so a run that cannot write this file has not
      // yet moved the committed pointer either.
      let mcpWritten = false;
      if (opts.mcp === true || opts.mcpAuthor === true) {
        const write = await writeMcpConfig(cwd, opts.mcpAuthor === true);
        if (write.kind === "failed") {
          fail(json, write.code, write.message);
          return;
        }
        mcpWritten = write.kind === "created";
        if (mcpWritten) created.push(mcpConfigPath(cwd));
      }

      const stored = storedDocsDir(docsOption);
      // Union, not replacement: this run's files join the ones earlier runs left
      // on disk, and `agentTools` is a record of what the repo HOLDS. A run that
      // generated nothing adds nothing and erases nothing.
      const recordedTools = [...new Set([...(existing?.agentTools ?? []), ...generatedFor])];
      const agentFileManifest = updatedAgentFileManifest(cwd, plannedAgentFiles, existing?.agentFiles, managedFiles);
      const config: StoredConfig = {
        ...existing,
        docsDir: stored,
        ...(opts.service ? { service: opts.service } : {}),
        ...(recordedTools.length > 0 ? { agentTools: recordedTools } : {}),
        agentProfile: profile,
      };
      if (Object.keys(agentFileManifest).length > 0) config.agentFiles = agentFileManifest;
      const configFile = await saveConfig(config, cwd);

      const serviceCount = (await listServices(docsDir)).length;

      if (json) {
        // `docsDir` stays the resolved absolute path — it is what a consumer
        // needs to find the repo. `docsDirStored` is what was written to
        // loam.json, which is the fact this command is now careful about.
        // `tools` names what files were generated FOR — empty when every
        // delivery was suppressed and none were. `detected` is the separate
        // question of what the scan SAW, which `--tools` overrides without
        // changing: an agent comparing the two learns whether its selection
        // matches the repo.
        emitJson({
          command: "init",
          docsDir,
          docsDirStored: stored,
          // Where the pointer came from: `flag` (a --docs somebody typed),
          // `config` (the one this repo already committed — a re-run cannot
          // move it), or `default` (nothing said, nothing committed).
          docsDirSource: docsSource,
          docsRepo: joining ? "existing" : "created",
          services: serviceCount,
          created,
          refreshed,
          skipped,
          tools: generatedFor,
          agentProfile: profile,
          detected,
        });
        return;
      }

      console.log("loam initialized.");
      if (joining) {
        console.log(`  docs repo: ${docsDir}`);
        console.log(`             pointing at existing docs repo (${serviceCount} services)`);
      } else {
        console.log(`  docs repo: ${docsDir}  (created)`);
      }
      console.log(
        `  docsDir:   ${stored}  (as stored in ${CONFIG_FILENAME}`
        + (docsSource === "config" ? " — kept; no --docs was passed" : "") + ")",
      );
      if (config.service) console.log(`  service:   ${config.service}`);
      console.log(`  config:    ${configFile}`);
      console.log(`             commit ${CONFIG_FILENAME} — docsDir is resolved relative to it`);
      if (opts.tools === undefined && detected.length > 0) {
        console.log(`  detected:  ${detected.join(", ")}`);
      }
      if (opts.commands) console.log(`  commands:  ${tools.join(", ")}`);
      if (opts.skills) console.log(`  skills:    ${tools.join(", ")}`);
      console.log(`  profile:   ${profile}`);
      if (created.length > 0) {
        console.log("  scaffolded:");
        for (const c of created) console.log(`    + ${c}`);
      }
      if (refreshed.length > 0) {
        console.log("  refreshed (unchanged since loam last wrote them):");
        for (const path of refreshed) console.log(`    ↻ ${path}`);
      }

      // The one skipped path that earns more than its line in `skipped`: loam
      // will not merge into a `.mcp.json` a human owns, and the caller asked
      // for this delivery by name — so they are handed the exact key to paste
      // into their own `mcpServers` object. Nothing was read out of their file
      // to produce it; the snippet is the same bytes a fresh write would have
      // used, which is also why it names the launch form this install shape
      // actually needs.
      if ((opts.mcp === true || opts.mcpAuthor === true) && !mcpWritten) {
        console.log(`  mcp:       ${MCP_CONFIG_FILENAME} is already here — left exactly as it is.`);
        console.log(`             paste this into its "mcpServers" object:`);
        for (const line of mcpServerSnippet(cwd, opts.mcpAuthor === true)) console.log(`               ${line}`);
      }

      // Printed ONLY for the single-repo trial composition: one run that both
      // created the docs repo and left a service bound (the binding may
      // predate the run — the config spread above carries an existing
      // loam.json's `service` forward). `loam status` is NOT mute here — its
      // first-hour ladder (core/status/fleet/next.ts) already answers
      // `next.adopt-bound` in exactly this state — but status has to be run
      // to say so, and no status rung ever names `loam vouch`, the one step
      // of this loop that is a person's; init's output is already on screen,
      // so it prints the whole hour once. A join stays silent on purpose: a
      // joined fleet has other repositories already through this loop, and
      // `loam status` in its docs repo is the working guide there. The --json
      // path returned above, so the envelope is byte-identical to before
      // this block existed.
      if (!joining && config.service !== undefined) {
        const steps = firstHour(config.service);
        const width = Math.max(...steps.map(([command]) => command.length));
        console.log("  next — the first hour:");
        for (const [command, why] of steps) {
          console.log(`    ${command.padEnd(width)}   # ${why}`);
        }
      }
    });
}
