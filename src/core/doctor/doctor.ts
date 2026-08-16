/**
 * The preflight: can loam run here at all, and can its answers be trusted?
 *
 * The walk only. Each question it asks lives in its own module — `./config.ts`
 * for the config and the fleet map, `./agents.ts` for the agent surface,
 * `./residue.ts` for what a killed writer left — and every one of them returns
 * findings rather than printing. That is the whole contract this module keeps:
 * `doctor` is the command that must be able to describe a broken repository
 * without becoming the next thing that breaks in it.
 */
import { constants, existsSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { CONFIG_FILENAME, configPath } from "../envelope/config.js";
import { LOAM_VERSION } from "../envelope/version.js";
import { landscapePath } from "../repo/paths.js";
import { docsRepoState } from "../repo/state.js";
import { listFeatures, listServices } from "../repo/repo.js";
import { LIKEC4_PROJECT_CONFIG, LIKEC4_PROJECT_FILENAME } from "../docs.js";
import { scanWritePathResidue } from "../staging/recovery/residue.js";
import { type DoctorFinding, type DoctorReport } from "./report.js";
import { canAccess, inspectConfig, inspectLandscape } from "./config.js";
import { inspectAgentSurface } from "./agents.js";
import { gradeWritePathResidue } from "./residue.js";

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
