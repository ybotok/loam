/** Read-only installation/repository diagnostics for `loam doctor`. */
import { constants, existsSync } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { CONFIG_FILENAME, configPath, parseConfig, type LoamConfig } from "./envelope/config.js";
import { LOAM_VERSION } from "./version.js";
import { agentsPath, docsRepoState, landscapePath, listFeatures, listServices } from "./repo.js";
import { loadFile } from "./c4/likec4.js";
import { LIKEC4_PROJECT_CONFIG, LIKEC4_PROJECT_FILENAME } from "./docs.js";
import { conflictMarkerLines } from "./fleet-context.js";
import { AGENT_TOOLS, DELIVERIES, plannedCommandFiles, type Delivery } from "./agent.js";
import {
  agentsStaleFinding,
  agentsStampLine,
  agentsStampVersion,
  versionTrails,
} from "./agents-stamp.js";
import { scanWritePathResidue, type WritePathResidue } from "./staging.js";

export type DoctorSeverity = "blocker" | "warning";

export interface DoctorFinding {
  severity: DoctorSeverity;
  code: string;
  message: string;
  /**
   * The next command or edit that clears this finding. Mandatory, not optional:
   * a diagnostic that names a problem without naming its fix is a diagnostic
   * the reader has to research, and `doctor` is what someone runs precisely
   * because they do not yet know what loam wants from them.
   */
  fix: string;
}

export interface DoctorReport {
  healthy: boolean;
  runtime: {
    package: "@ybotok/loam";
    version: string;
    node: string;
    platform: NodeJS.Platform;
    arch: string;
  };
  config: {
    path: string;
    status: "missing" | "invalid" | "valid";
    error: string | null;
  };
  docs: {
    path: string | null;
    exists: boolean;
    readable: boolean;
    writable: boolean;
    servicesDir: boolean;
    landscape: boolean;
  };
  counts: { services: number; activeFeatures: number };
  currentService: {
    configured: string | null;
    status: "unbound" | "matched" | "unknown";
  };
  /** The agent surface of this repo — see `inspectAgentSurface`. */
  agents: AgentSurface;
  /**
   * What a write that did not finish left in the docs repo, or null when
   * `docsDir` never resolved. Reported as state, like `docs` and `counts`: a
   * lock somebody is legitimately holding right now is a fact, not a complaint.
   */
  writePath: WritePathResidue | null;
  findings: DoctorFinding[];
}

export interface AgentSurface {
  /** Tool ids this repo has an agent surface for. Empty is legal (`init --no-commands`). */
  tools: string[];
  /** Whether `tools` came from loam.json's own record or from what is on disk. */
  toolsSource: "config" | "disk";
  /** How many files the running binary would lay down for `tools`. */
  plannedFiles: number;
  /** Repo-relative paths of those files that are not there. */
  missingFiles: string[];
  /**
   * Repo-relative paths of the ones that ARE there carrying no version stamp,
   * or one older than this binary — see `staleAgentFiles`.
   */
  staleFiles: string[];
  stamp: {
    /** Where the docs repo's AGENTS.md is, or null when `docsDir` did not resolve. */
    path: string | null;
    /** Whether it could be read at all — absent and unstamped are different facts. */
    present: boolean;
    /** The version the stamp names, null when there is none (or an unparseable one). */
    version: string | null;
    /** Whether `agents.stale` fired: the stamp is missing or trails this binary. */
    stale: boolean;
  };
}

interface ConfigInspection {
  status: DoctorReport["config"]["status"];
  config: LoamConfig | null;
  error: string | null;
}

/**
 * Read and validate the config the way every other command does — through
 * `parseConfig`, never through a second implementation.
 *
 * doctor used to carry its own validator. It agreed with `loadConfig` on the
 * fields both happened to check and disagreed everywhere else: doctor accepted
 * a `gherkinDir` of `"../shared"` that `loadConfig` refused outright, so
 * `doctor` reported a healthy repo in which no command could run. Two
 * validators are two opinions about the same file, and the one the user reads
 * is never the one the commands obey.
 */
async function inspectConfig(cwd: string): Promise<ConfigInspection> {
  const path = configPath(cwd);
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return { status: "missing", config: null, error: null };
    return {
      status: "invalid",
      config: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  try {
    return { status: "valid", error: null, config: parseConfig(raw, dirname(path)) };
  } catch (error) {
    return {
      status: "invalid",
      config: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function canAccess(path: string, mode: number): Promise<boolean> {
  try {
    await access(path, mode);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read the landscape, don't just stat it. `doctor` reported `landscape: yes`
 * for a file full of conflict markers — the check answered "is there a file",
 * which is not the question anyone runs doctor to ask.
 */
async function inspectLandscape(path: string, findings: DoctorFinding[]): Promise<void> {
  let source: string;
  try {
    source = await readFile(path, "utf8");
  } catch (error) {
    findings.push({
      severity: "blocker",
      code: "doctor.landscape-unreadable",
      message: `${path} exists but could not be read: ${error instanceof Error ? error.message : String(error)}`,
      fix: `Check permissions on ${path}.`,
    });
    return;
  }

  // The three-way merge left its markers in the file. Checked BEFORE the
  // parser, because a conflicted landscape does parse sometimes — both sides of
  // a conflict can be syntactically valid LikeC4 — and "your map contains two
  // halves of two different maps" is a more useful sentence than any parser
  // error. This is the failure mode of onboarding a fleet: ten people adopt ten
  // services into one landscape.likec4 in the same week.
  //
  // The scan itself is fleet-context's, which is where the same rule already
  // grades every other document loam reads. doctor kept a second copy of it,
  // and a second copy of a rule is a second chance to spell it differently;
  // what doctor owns is what a conflicted landscape COSTS, which is the finding
  // below and not the search.
  const conflicted = conflictMarkerLines(source);
  if (conflicted.length > 0) {
    findings.push({
      severity: "blocker",
      code: "doctor.landscape-merge-conflict",
      message:
        `architecture/landscape.likec4 still contains merge conflict markers ` +
        `(line${conflicted.length === 1 ? "" : "s"} ${conflicted.join(", ")}).`,
      fix: `Resolve the conflict in ${path} — keep BOTH services' elements and edges, then re-run \`loam doctor\`.`,
    });
    return;
  }

  const doc = await loadFile(path);
  if (doc.errors.length > 0) {
    const first = doc.errors[0]!;
    findings.push({
      severity: "blocker",
      code: "doctor.landscape-invalid",
      message:
        `architecture/landscape.likec4 does not parse: ${first.message}` +
        (first.line === undefined ? "" : ` (line ${first.line})`) +
        (doc.errors.length > 1 ? ` — and ${doc.errors.length - 1} more` : ""),
      fix: `Fix ${path}; every fleet-wide check is blind until it parses.`,
    });
  }
}

/**
 * The tool ids loam.json records `init` as having written files for, or null
 * when it records none we can plan for.
 *
 * `parseConfig` checks `agentTools`' SHAPE and deliberately not its contents —
 * a config written by a newer binary may name a tool this one has never heard
 * of, and refusing to load it would break every command, not just this check.
 * So the registry filter belongs here: `plannedCommandFiles` throws on an id it
 * does not know, and a config from the future must not turn the read-only
 * preflight into a crash. A tool we cannot plan files for is a tool we have
 * nothing to say about.
 */
function recordedTools(config: LoamConfig | null): string[] | null {
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
function detectedTools(repoRoot: string): string[] {
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
function heldDeliveries(repoRoot: string, tool: string): readonly Delivery[] {
  const held = DELIVERIES.filter((d) =>
    plannedCommandFiles(repoRoot, [tool], [d]).some((f) => existsSync(f.path)));
  return held.length > 0 ? held : DELIVERIES;
}

/**
 * Of the planned files that ARE here, the ones whose stamp is missing or older
 * than this binary.
 *
 * The stamp is the ONLY thing read out of a generated file — never the body.
 * Comparing bodies would yield "your file differs from the template", one step
 * from offering to rewrite it, which is the thing loam refuses: a team's edits
 * to a generated file outrank ours. A stamp is a different claim — it says
 * which loam wrote these instructions — and it can be false while every edit
 * around it is legitimate. Same doctrine as AGENTS.md (agents-stamp.ts), same
 * repair: a human looks, and bumps the stamp or deletes the file so a re-run of
 * `loam init` lays down the current one.
 *
 * Absence of a stamp counts, because that is what every file written before
 * stamping existed looks like — precisely the "initialized by an older loam"
 * population this check is for.
 */
async function staleAgentFiles(
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
async function inspectAgentSurface(
  repoRoot: string,
  config: LoamConfig | null,
  docsDir: string | null,
  findings: DoctorFinding[],
): Promise<AgentSurface> {
  const recorded = recordedTools(config);
  const tools = recorded ?? detectedTools(repoRoot);
  const planned = tools.flatMap((id) =>
    plannedCommandFiles(repoRoot, [id], heldDeliveries(repoRoot, id)));
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
        + "here — it writes only the files that are absent and leaves every existing one untouched, and "
        + "it keeps this repo's service binding. Nothing is regenerated, so leaving this standing costs "
        + "entry points and nothing else.",
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
        + `\`${agentsStampLine(LOAM_VERSION)}\`; or delete the file and re-run \`loam init\` to lay `
        + "down the current one. loam never rewrites a file that exists — your edits outrank the "
        + "template, which is why the stamp is a human's claim and not a refresh.",
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

  return {
    tools,
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
function gradeWritePathResidue(
  docsDir: string,
  residue: WritePathResidue,
  findings: DoctorFinding[],
): void {
  if (residue.lock !== null) {
    const lockFile = join(docsDir, residue.lock.path);
    findings.push({
      // Held by a live process is a fact about right now — wait and re-run.
      // Held by a process that no longer exists is damage: nothing will ever
      // release it, and every archive and unarchive refuses `docs-busy` until
      // somebody deletes it.
      severity: residue.lock.stale ? "blocker" : "warning",
      code: "doctor.docs-locked",
      message: residue.lock.stale
        ? `${residue.lock.path} is held by ${residue.lock.holder}, a process that no longer exists on this host — every \`loam archive\` and \`loam unarchive\` will refuse with \`docs-busy\` until it is gone.`
        : `${residue.lock.path} is held by ${residue.lock.holder}; another archive or unarchive is running against this docs repo.`,
      fix: residue.lock.stale
        ? `Delete ${lockFile} — its holder is dead, so nothing is going to release it. Check \`loam doctor\` again afterwards for an interrupted commit.`
        : "Wait for it to finish and re-run; nothing is read or written while it is held.",
    });
  }

  if (residue.intentUnreadable) {
    findings.push({
      severity: "blocker",
      code: "doctor.commit-unreadable",
      message: `${docsDir} holds a .loam-commit that cannot be read — a commit was interrupted and the one record of which files it had already written is unreadable.`,
      fix: "Hand this to a human: compare the living docs against version control before running any loam command that writes. `loam archive` and `loam unarchive` both refuse with `commit-interrupted` while it is there.",
    });
  } else if (residue.intent !== null) {
    const i = residue.intent;
    // The command is spelled out per branch rather than interpolated into one
    // sentence: `loam ${i.command} ${i.feature}` reads fine to a person and is
    // opaque to test/agent-commands-runnable.test.ts, which parses the commands
    // loam prints against the real program. Same discipline as spelling `code:`
    // literally — be visible to your own guard.
    const repair = i.command === "archive"
      ? `\`loam archive ${i.feature}\` — it recovers first, under the lock, putting the half-written files back from the snapshot`
      : `\`loam unarchive ${i.feature}\` — it recovers first, under the lock, finishing the restore (an interrupted restore is FINISHED, never undone: the merged text it was replacing is written down nowhere)`;
    findings.push({
      severity: "blocker",
      code: "doctor.commit-interrupted",
      message:
        `A ${i.command === "archive" ? `\`loam archive ${i.feature}\`` : `\`loam unarchive ${i.feature}\``} `
        + `was killed mid-commit (${i.host}, pid ${i.pid}, ${i.at}) — `
        + `${i.files.length} file(s) may be half-written: ${i.files.map((f) => f.path).join(", ")}`,
      fix: `Re-run ${repair}, and refuses with \`commit-interrupted\` rather than guessing if a file has been edited since.`,
    });
  }

  if (residue.temps.length > 0) {
    findings.push({
      severity: "warning",
      code: "doctor.staging-temps",
      message: `${residue.temps.length} orphaned staging file(s) under ${docsDir}: ${residue.temps.join(", ")} — a killed writer's scratch, never linked into place.`,
      fix: "The next `loam archive` or `loam unarchive` removes its own; delete any that remain. Nothing reads them, so they cost disk and nothing else.",
    });
  }
}

export async function diagnose(cwd = process.cwd()): Promise<DoctorReport> {
  const inspected = await inspectConfig(cwd);
  const path = configPath(cwd);
  const findings: DoctorFinding[] = [];
  if (inspected.status === "missing") {
    findings.push({
      severity: "blocker",
      code: "doctor.config-missing",
      message: `No ${CONFIG_FILENAME} found at or above ${cwd}.`,
      fix: "Run `loam init --docs <path-to-docs-repo>` here (add `--create` to make a new docs repo).",
    });
  } else if (inspected.status === "invalid") {
    findings.push({
      severity: "blocker",
      code: "doctor.config-invalid",
      message: `Invalid ${CONFIG_FILENAME}: ${inspected.error ?? "unknown error"}`,
      fix: `Repair ${path} — or delete it and re-run \`loam init\`.`,
    });
  }

  const docsDir = inspected.config?.docsDir ?? null;
  const state = docsDir === null ? null : docsRepoState(docsDir);
  const exists = state !== null && state.kind !== "missing";
  const readable = exists && docsDir !== null ? await canAccess(docsDir, constants.R_OK) : false;
  const writable = exists && docsDir !== null ? await canAccess(docsDir, constants.W_OK) : false;
  const servicesDir = state?.kind === "ok";
  const landscapeFile = docsDir === null ? null : landscapePath(docsDir);
  const landscape = landscapeFile === null ? false : await canAccess(landscapeFile, constants.F_OK);

  // The docs-repo verdict comes from `docsRepoState`, the same function
  // `listServices` refuses on, so doctor cannot call a repo healthy that the
  // enumeration will not read.
  if (state?.kind === "missing") {
    findings.push({
      severity: "blocker",
      code: "doctor.docs-missing",
      message: `Configured docsDir is missing or is not a directory: ${docsDir}`,
      fix: `Fix "docsDir" in ${path}, clone the docs repo to ${docsDir}, or run \`loam init --docs <dir> --create\`.`,
    });
  } else if (state?.kind === "no-services") {
    findings.push({
      severity: "blocker",
      code: "doctor.services-missing",
      message: `Required services/ directory is missing under ${docsDir} — that path is not a docs repo.`,
      fix: `Point "docsDir" in ${path} at the shared docs repo, or run \`loam init --docs ${docsDir} --create\`.`,
    });
  }

  // An absolute docsDir in a committed config names a directory that exists on
  // exactly one machine. It is a warning and not a blocker because it works
  // perfectly — for the person who ran `loam init`, and for nobody who clones
  // the repo afterwards.
  const asWritten = inspected.config?.docsDirAsWritten;
  const configRoot = inspected.config?.root;
  if (
    asWritten !== undefined
    && configRoot !== undefined
    && isAbsolute(asWritten)
    && resolve(asWritten) !== resolve(configRoot)
  ) {
    findings.push({
      severity: "warning",
      code: "doctor.docs-absolute",
      message:
        `"docsDir" is stored as an absolute path (${asWritten}); ` +
        `${CONFIG_FILENAME} is committed, so it will not resolve on anyone else's machine.`,
      fix: `Rewrite "docsDir" in ${path} as a path relative to that file (e.g. "../docs").`,
    });
  }

  if (exists && !readable) {
    findings.push({
      severity: "warning",
      code: "doctor.docs-unreadable",
      message: `docsDir is not readable by this process: ${docsDir}`,
      fix: `Grant read access to ${docsDir} (check ownership and mode).`,
    });
  }
  if (exists && !writable) {
    findings.push({
      severity: "warning",
      code: "doctor.docs-readonly",
      message: `docsDir is not writable; read-only commands work, archive/init do not: ${docsDir}`,
      fix: `Grant write access to ${docsDir} if you need \`loam new\`, \`loam adopt\` or \`loam archive\`.`,
    });
  }
  if (exists && !landscape) {
    findings.push({
      severity: "warning",
      code: "doctor.landscape-missing",
      message: `${landscapeFile} is missing — nothing cross-service can be checked without it.`,
      fix: "Create architecture/landscape.likec4 with one element per service and an edge per call (`loam init --create` writes the empty map).",
    });
  } else if (exists && landscapeFile !== null && readable) {
    await inspectLandscape(landscapeFile, findings);
  }

  // The renderer's view of the repo, which is not loam's. loam parses every
  // `.likec4` file ALONE, so each one declares its own `specification` block and
  // re-declares whatever elements it names; LikeC4's own workspace loader merges
  // the whole tree into one model, and those declarations then collide. The
  // result was two tools disagreeing in the most confusing possible direction:
  // `loam validate --all` reported zero errors on a tree where `npx likec4
  // start` — the command loam's own brief recommends — refused to load at all.
  // `loam init --create` writes the project file that scopes the root project to
  // the landscape; a docs repo created before it exists has to be told, because
  // nothing else will ever mention it. A warning, not a blocker: no loam check
  // reads this file, and a repo without it is only unrenderable.
  if (docsDir !== null && exists && readable && !existsSync(join(docsDir, LIKEC4_PROJECT_FILENAME))) {
    findings.push({
      severity: "warning",
      code: "doctor.likec4-config-missing",
      message:
        `${docsDir}/${LIKEC4_PROJECT_FILENAME} is missing, so this tree is not a loadable LikeC4 workspace — `
        + "every service model and feature delta declares its own `specification` block, and pointing a "
        + "renderer at the repo root merges them into one model and reports every declaration as a duplicate.",
      fix:
        `Write ${docsDir}/${LIKEC4_PROJECT_FILENAME} with:\n${LIKEC4_PROJECT_CONFIG.trimEnd()}\n`
        + "That scopes the root project to architecture/, so `npx likec4 start` in the docs repo renders "
        + "the fleet map. A service model or feature delta is rendered by pointing the renderer at its own "
        + "directory (`npx likec4 start services/<id>`) — being readable alone is what those files are for.",
    });
  }

  // What a killed writer left behind. Read from `scanWritePathResidue`, whose
  // spellings of `.loam-lock` / `.loam-commit` / the temp-file pattern are
  // staging's own — doctor grades, it does not re-spell. This is the surface
  // that used to report `healthy: true` over half-merged docs.
  const writePath = docsDir !== null && exists && readable
    ? await scanWritePathResidue(docsDir)
    : null;
  if (docsDir !== null && writePath !== null) gradeWritePathResidue(docsDir, writePath, findings);

  let services: Awaited<ReturnType<typeof listServices>> = [];
  let activeFeatures: Awaited<ReturnType<typeof listFeatures>> = [];
  // Whether the fleet was actually READ, which is a narrower question than
  // whether reading it was attempted — hence set inside the try and not from
  // the guard, so an enumeration that threw leaves this false alongside its own
  // `doctor.inventory-unreadable`.
  let inventoried = false;
  if (docsDir !== null && readable && servicesDir) {
    try {
      [services, activeFeatures] = await Promise.all([
        listServices(docsDir),
        listFeatures(docsDir),
      ]);
      inventoried = true;
    } catch (error) {
      findings.push({
        severity: "warning",
        code: "doctor.inventory-unreadable",
        message: `Could not inventory the docs repo: ${error instanceof Error ? error.message : String(error)}`,
        fix: `Check that ${docsDir}/services and ${docsDir}/features are readable directories.`,
      });
    }
  }

  const configuredService = inspected.config?.service ?? null;
  const currentService: DoctorReport["currentService"] = configuredService === null
    ? { configured: null, status: "unbound" }
    : services.some((service) => service.id === configuredService)
      ? { configured: configuredService, status: "matched" }
      : { configured: configuredService, status: "unknown" };
  // Standing INSIDE the docs repo, an absent service binding is the correct
  // state, not a gap: the docs repo is the fleet, it is not any one service, and
  // the fix this finding prints — `loam init --service <id>` — would bind the
  // shared repo to one of the services it holds, which is not a thing loam has
  // a meaning for. doctor already knew where it was standing (it prints the
  // fleet count two lines up) and reported the warning anyway, so the first
  // preflight anyone ran in a freshly created docs repo came back yellow with
  // advice that made it worse. The docs repo's own loam.json is the one that
  // resolves `docsDir` to the directory holding it — that identity, not a
  // filename, is the test.
  const inDocsRepo = configRoot !== undefined && docsDir !== null
    && resolve(configRoot) === resolve(docsDir);
  if (currentService.status === "unbound" && !inDocsRepo) {
    findings.push({
      severity: "warning",
      code: "doctor.service-unbound",
      message: "loam.json has no service binding; service-repo checks need `service`.",
      fix: `Run \`loam init --docs ${inspected.config?.docsDirAsWritten ?? "<dir>"} --service <id>\` here.`,
    });
  } else if (currentService.status === "unknown" && inventoried) {
    // Only when there was an inventory to be absent from. This finding is a
    // claim about a fleet that was read; with no docsDir, an unreadable one, or
    // an enumeration that threw, `services` is empty for a reason that has
    // nothing to do with `service`, and doctor pointed the reader at the one
    // config field that was fine while the blocker it had already filed named
    // the real one. `currentService.status` still reports `unknown` — the
    // envelope describes what loam could and could not match, and an unread
    // fleet matches nothing.
    findings.push({
      severity: "warning",
      code: "doctor.service-unknown",
      message: `Configured service '${configuredService}' is not present under services/.`,
      // `--service <id>`, not a positional: `loam adopt` takes no argument, so
      // the spelling this finding used to print was refused by commander with
      // "too many arguments" — as the FIRST instruction a freshly bound service
      // repo ever receives. test/agent-commands-runnable.test.ts parses every
      // `loam …` loam prints against the real program so it cannot recur.
      fix: `Run \`loam adopt --service ${configuredService}\` to onboard it, or fix "service" in ${path}.`,
    });
  }

  // The slash commands (and everything else `init` lays down for a tool) belong
  // to the repo `init` ran in — the directory holding loam.json, which is not
  // the cwd now that config discovery walks upward.
  const agents = await inspectAgentSurface(dirname(path), inspected.config, docsDir, findings);

  return {
    healthy: !findings.some((finding) => finding.severity === "blocker"),
    runtime: {
      package: "@ybotok/loam",
      version: LOAM_VERSION,
      node: process.version,
      platform: process.platform,
      arch: process.arch,
    },
    config: { path, status: inspected.status, error: inspected.error },
    docs: {
      path: docsDir,
      exists,
      readable,
      writable,
      servicesDir,
      landscape,
    },
    counts: { services: services.length, activeFeatures: activeFeatures.length },
    currentService,
    agents,
    writePath,
    findings,
  };
}
