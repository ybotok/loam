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
  scaffoldAgentCommands,
  type Delivery,
} from "../../core/agent/scaffold.js";
import { AGENT_TOOLS } from "../../core/agent/tools/registry.js";
import { firstHour } from "./first-hour.js";
import { isDocsRepo, resolveTools, storedDocsDir } from "./options.js";

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
  /** --tools: comma-separated AGENT_TOOLS ids, or "all". Absent = autodetect. */
  tools?: string;
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
    .option("--no-commands", "skip the slash commands for this repo entirely")
    .option("--no-skills", "skip the agent skills for this repo entirely")
    .option("--json", "emit the machine contract instead of the human view")
    .action(async (opts: InitOptions, command: Command) => {
      const json = opts.json === true;
      const cwd = process.cwd();

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

      // `skipped` is the other half of the never-overwrite contract: the
      // scaffolds return only what they created, so what they left alone is
      // probed here, before they run — in the order they would create it, so
      // created + skipped is the same list on every repo. Both halves come from
      // the scaffolds' own planned-file lists, so the probe cannot drift from
      // what is actually written.
      const agentFiles = delivery.length > 0 ? plannedCommandFiles(cwd, tools, delivery) : [];
      const candidates = [...plannedDocsFiles(docsDir), ...agentFiles.map((f) => f.path)];
      const skipped = candidates.filter((p) => existsSync(p));

      // Joining touches the docs repo not at all: it is somebody's committed
      // repository, and "point at it" must never mean "write to it".
      const created = joining && opts.create !== true ? [] : (await scaffoldDocs(docsDir)).created;
      const generatedFor = delivery.length > 0 ? tools : [];
      if (delivery.length > 0) {
        created.push(...(await scaffoldAgentCommands(cwd, tools, delivery)));
      }

      const stored = storedDocsDir(docsOption);
      // Union, not replacement: this run's files join the ones earlier runs left
      // on disk, and `agentTools` is a record of what the repo HOLDS. A run that
      // generated nothing adds nothing and erases nothing.
      const recordedTools = [...new Set([...(existing?.agentTools ?? []), ...generatedFor])];
      const config: StoredConfig = {
        ...existing,
        docsDir: stored,
        ...(opts.service ? { service: opts.service } : {}),
        ...(recordedTools.length > 0 ? { agentTools: recordedTools } : {}),
      };
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
          docsDir,
          docsDirStored: stored,
          // Where the pointer came from: `flag` (a --docs somebody typed),
          // `config` (the one this repo already committed — a re-run cannot
          // move it), or `default` (nothing said, nothing committed).
          docsDirSource: docsSource,
          docsRepo: joining ? "existing" : "created",
          services: serviceCount,
          created,
          skipped,
          tools: generatedFor,
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
      if (created.length > 0) {
        console.log("  scaffolded:");
        for (const c of created) console.log(`    + ${c}`);
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
