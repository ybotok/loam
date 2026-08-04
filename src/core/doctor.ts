/** Read-only installation/repository diagnostics for `loam doctor`. */
import { constants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { CONFIG_FILENAME, configPath, parseConfig, type LoamConfig } from "./config.js";
import { LOAM_VERSION } from "./version.js";
import { docsRepoState, landscapePath, listFeatures, listServices } from "./repo.js";
import { loadFile } from "./likec4.js";

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
    package: "@spentsov/loam";
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
  findings: DoctorFinding[];
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
 * The three-way merge left its markers in the file. Checked BEFORE the parser,
 * because a conflicted landscape does parse sometimes — both sides of a
 * conflict can be syntactically valid LikeC4 — and "your map contains two
 * halves of two different maps" is a more useful sentence than any parser
 * error. This is the failure mode of onboarding a fleet: ten people adopt ten
 * services into one landscape.likec4 in the same week.
 */
const CONFLICT_MARKERS = ["<<<<<<<", "=======", ">>>>>>>"];

function conflictMarkerLines(source: string): number[] {
  const out: number[] = [];
  source.split(/\r?\n/).forEach((line, i) => {
    if (CONFLICT_MARKERS.some((m) => line.startsWith(m))) out.push(i + 1);
  });
  return out;
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

  let services: Awaited<ReturnType<typeof listServices>> = [];
  let activeFeatures: Awaited<ReturnType<typeof listFeatures>> = [];
  if (docsDir !== null && readable && servicesDir) {
    try {
      [services, activeFeatures] = await Promise.all([
        listServices(docsDir),
        listFeatures(docsDir),
      ]);
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
  if (currentService.status === "unbound") {
    findings.push({
      severity: "warning",
      code: "doctor.service-unbound",
      message: "loam.json has no service binding; service-repo checks need `service`.",
      fix: `Run \`loam init --docs ${inspected.config?.docsDirAsWritten ?? "<dir>"} --service <id>\` here.`,
    });
  } else if (currentService.status === "unknown") {
    findings.push({
      severity: "warning",
      code: "doctor.service-unknown",
      message: `Configured service '${configuredService}' is not present under services/.`,
      fix: `Run \`loam adopt ${configuredService}\` to onboard it, or fix "service" in ${path}.`,
    });
  }

  return {
    healthy: !findings.some((finding) => finding.severity === "blocker"),
    runtime: {
      package: "@spentsov/loam",
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
    findings,
  };
}
