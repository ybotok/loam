/** Read-only installation/repository diagnostics for `loam doctor`. */
import { constants } from "node:fs";
import { access, readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { CONFIG_FILENAME, configPath, type LoamConfig } from "./config.js";
import { LOAM_VERSION } from "./version.js";
import { listFeatures, listServices } from "./repo.js";

export type DoctorSeverity = "blocker" | "warning";

export interface DoctorFinding {
  severity: DoctorSeverity;
  code: string;
  message: string;
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
    const value: unknown = JSON.parse(raw);
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("configuration must be a JSON object");
    }
    const record = value as Record<string, unknown>;
    if (typeof record.docsDir !== "string" || record.docsDir.length === 0) {
      throw new Error('"docsDir" must be a non-empty string');
    }
    if (record.service !== undefined
      && (typeof record.service !== "string" || record.service.length === 0)) {
      throw new Error('"service" must be a non-empty string when present');
    }
    if (record.gherkinDir !== undefined
      && (typeof record.gherkinDir !== "string" || record.gherkinDir.length === 0)) {
      throw new Error('"gherkinDir" must be a non-empty string when present');
    }
    return {
      status: "valid",
      error: null,
      config: {
        docsDir: resolve(dirname(path), record.docsDir),
        ...(record.service === undefined ? {} : { service: record.service as string }),
        ...(record.gherkinDir === undefined ? {} : { gherkinDir: record.gherkinDir as string }),
      },
    };
  } catch (error) {
    return {
      status: "invalid",
      config: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
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

export async function diagnose(cwd = process.cwd()): Promise<DoctorReport> {
  const inspected = await inspectConfig(cwd);
  const findings: DoctorFinding[] = [];
  if (inspected.status === "missing") {
    findings.push({
      severity: "blocker",
      code: "doctor.config-missing",
      message: `No ${CONFIG_FILENAME} found at ${configPath(cwd)}.`,
    });
  } else if (inspected.status === "invalid") {
    findings.push({
      severity: "blocker",
      code: "doctor.config-invalid",
      message: `Invalid ${CONFIG_FILENAME}: ${inspected.error ?? "unknown error"}`,
    });
  }

  const docsDir = inspected.config?.docsDir ?? null;
  const exists = docsDir === null ? false : await isDirectory(docsDir);
  const readable = exists && docsDir !== null ? await canAccess(docsDir, constants.R_OK) : false;
  const writable = exists && docsDir !== null ? await canAccess(docsDir, constants.W_OK) : false;
  const servicesPath = docsDir === null ? null : join(docsDir, "services");
  const servicesDir = servicesPath === null ? false : await isDirectory(servicesPath);
  const landscape = docsDir === null
    ? false
    : await canAccess(join(docsDir, "architecture", "landscape.likec4"), constants.F_OK);

  if (docsDir !== null && !exists) {
    findings.push({
      severity: "blocker",
      code: "doctor.docs-missing",
      message: `Configured docsDir is missing or is not a directory: ${docsDir}`,
    });
  } else if (exists && !servicesDir) {
    findings.push({
      severity: "blocker",
      code: "doctor.services-missing",
      message: `Required services/ directory is missing under ${docsDir}.`,
    });
  }
  if (exists && !readable) {
    findings.push({
      severity: "warning",
      code: "doctor.docs-unreadable",
      message: `docsDir is not readable by this process: ${docsDir}`,
    });
  }
  if (exists && !writable) {
    findings.push({
      severity: "warning",
      code: "doctor.docs-readonly",
      message: `docsDir is not writable; read-only commands work, archive/init do not: ${docsDir}`,
    });
  }
  if (exists && !landscape) {
    findings.push({
      severity: "warning",
      code: "doctor.landscape-missing",
      message: "architecture/landscape.likec4 is missing.",
    });
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
    });
  } else if (currentService.status === "unknown") {
    findings.push({
      severity: "warning",
      code: "doctor.service-unknown",
      message: `Configured service '${configuredService}' is not present under services/.`,
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
    config: { path: configPath(cwd), status: inspected.status, error: inspected.error },
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
