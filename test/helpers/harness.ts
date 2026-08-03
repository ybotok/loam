/**
 * Shared test harness: build throwaway docs-repo fixtures on disk and run loam
 * commands in-process (fast — no child process, LikeC4 stays warm).
 *
 * Commands resolve `loam.json` from process.cwd() and report failure via
 * process.exitCode, so runLoam() chdirs into the fixture workdir and captures
 * console output + exit code, restoring everything afterwards. Requires the
 * vitest "forks" pool (worker threads cannot chdir).
 */
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { format } from "node:util";
import { Command } from "commander";
import { registerInit } from "../../src/commands/init.js";
import { registerAdopt } from "../../src/commands/adopt.js";
import { registerDelta } from "../../src/commands/delta.js";
import { registerArchive } from "../../src/commands/archive.js";
import { registerValidate } from "../../src/commands/validate.js";

export interface RunResult {
  /** process.exitCode after the command (0 if it never set one). */
  code: number;
  stdout: string;
  stderr: string;
  /** stdout + stderr interleaved in emission order. */
  out: string;
}

export interface Project {
  /** cwd for runLoam — contains loam.json. */
  workDir: string;
  /** The docs repo root loam.json points at. */
  docsDir: string;
  /** Read a file under docsDir. */
  read(relPath: string): Promise<string>;
  /** Write/overwrite a file under docsDir (parent dirs auto-created). */
  write(relPath: string, content: string): Promise<void>;
  /** existsSync under docsDir. */
  exists(relPath: string): boolean;
  /** Delete the whole fixture tree. */
  destroy(): Promise<void>;
}

/** Create a temp dir (caller owns cleanup unless using makeProject().destroy()). */
export async function makeTmpDir(prefix = "loam-test-"): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

/** Write a map of relPath → content under root, creating parent dirs. */
export async function writeFiles(root: string, files: Record<string, string>): Promise<void> {
  for (const [rel, content] of Object.entries(files)) {
    const p = join(root, rel);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, content, "utf8");
  }
}

/**
 * Build a project fixture: a workdir with loam.json pointing at a docs dir
 * populated from `files` (relPath → content, relative to the docs root).
 * Example keys: "architecture/landscape.likec4", "services/x/spec.md",
 * "features/FEAT-1-a/delta.likec4".
 */
export async function makeProject(
  files: Record<string, string>,
  opts: { service?: string } = {},
): Promise<Project> {
  const root = await makeTmpDir();
  const workDir = join(root, "work");
  const docsDir = join(root, "docs");
  await mkdir(workDir, { recursive: true });
  await mkdir(docsDir, { recursive: true });
  await writeFiles(docsDir, files);
  const config = { docsDir, ...(opts.service ? { service: opts.service } : {}) };
  await writeFile(join(workDir, "loam.json"), JSON.stringify(config, null, 2) + "\n", "utf8");
  return {
    workDir,
    docsDir,
    read: (rel) => readFile(join(docsDir, rel), "utf8"),
    write: async (rel, content) => {
      await mkdir(dirname(join(docsDir, rel)), { recursive: true });
      await writeFile(join(docsDir, rel), content, "utf8");
    },
    exists: (rel) => existsSync(join(docsDir, rel)),
    destroy: () => rm(root, { recursive: true, force: true }),
  };
}

/**
 * Run a loam command in-process from `cwd`.
 * Example: runLoam(p.workDir, "validate", "--feature", "FEAT-1").
 */
export async function runLoam(cwd: string, ...args: string[]): Promise<RunResult> {
  const prevCwd = process.cwd();
  const prevExit = process.exitCode;
  const stdout: string[] = [];
  const stderr: string[] = [];
  const all: string[] = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...a: unknown[]) => {
    const s = format(...a);
    stdout.push(s);
    all.push(s);
  };
  console.error = (...a: unknown[]) => {
    const s = format(...a);
    stderr.push(s);
    all.push(s);
  };
  process.exitCode = undefined;
  try {
    process.chdir(cwd);
    const program = new Command();
    program.name("loam").exitOverride();
    registerInit(program);
    registerAdopt(program);
    registerDelta(program);
    registerArchive(program);
    registerValidate(program);
    await program.parseAsync(["node", "loam", ...args]);
  } finally {
    console.log = origLog;
    console.error = origErr;
    process.chdir(prevCwd);
  }
  const code = typeof process.exitCode === "number" ? process.exitCode : 0;
  process.exitCode = prevExit;
  return { code, stdout: stdout.join("\n"), stderr: stderr.join("\n"), out: all.join("\n") };
}

/* ------------------------------------------------------------------ */
/* Canonical minimal fixtures (known-good LikeC4 / OpenSpec / OpenAPI) */
/* ------------------------------------------------------------------ */

/** Minimal living landscape: checkout-web → payment-service, with an op-linked edge. */
export const LANDSCAPE = `specification {
  element softwareSystem
  element person
}

model {
  customer = person 'Customer'
  checkoutWeb = softwareSystem 'checkout-web' {
    description 'Customer-facing checkout UI'
  }
  paymentService = softwareSystem 'payment-service' {
    description 'Owns payment authorization/capture'
  }

  customer -> checkoutWeb 'Uses'
  checkoutWeb -> paymentService 'Calls authorizePayment' {
    metadata { op 'authorizePayment' }
  }
}

views {
  view landscape {
    include *
  }
}
`;

/** Minimal per-service C4 model for payment-service. */
export const SERVICE_MODEL = `specification {
  element softwareSystem
  element container
}

model {
  paymentService = softwareSystem 'payment-service' {
    description 'Owns payment authorization/capture'
    api = container 'api'
  }
}

views {
  view of paymentService {
    include *
  }
}
`;

/** Living spec for payment-service: one requirement, one scenario, governs authorizePayment. */
export const LIVING_SPEC = `---
service: payment-service
status: verified
---

# payment-service

## Requirements

### Requirement: Authorize a payment
The service SHALL authorize a payment before capture.

Operations: authorizePayment

#### Scenario: Successful authorization
- **Given** a valid card
- **When** authorization is requested
- **Then** the payment is authorized
`;

/** Living OpenAPI for payment-service defining authorizePayment. */
export const LIVING_OPENAPI = `openapi: 3.1.0
info:
  title: payment-service
  version: "1.0"
paths:
  /payments/authorize:
    post:
      operationId: authorizePayment
      summary: Authorize a payment
      responses:
        "200":
          description: Authorized
`;

/** Feature delta.likec4 for FEAT-1: new service payment-split-service + op-linked edge. */
export const FEATURE_DELTA = `specification {
  element softwareSystem
  tag FEAT-1
}

model {
  paymentService = softwareSystem 'payment-service'
  paymentSplitService = softwareSystem 'payment-split-service' {
    #FEAT-1
    description 'Splits a payment across payees'
  }

  paymentService -> paymentSplitService 'Calls createSplit' {
    #FEAT-1
    metadata { op 'createSplit' }
  }
}

views {
  view feat_1 {
    include *
  }
}
`;

/** Feature requirement delta for payment-split-service (ADDED, with scenario + Operations). */
export const FEATURE_SPEC = `# payment-split-service — delta for FEAT-1

## ADDED Requirements

### Requirement: Split a payment
The service SHALL split a payment across payees summing to the total.

Operations: createSplit

#### Scenario: Split across two payees
- **Given** a payment of 100.00
- **When** it is split 60/40
- **Then** two shares are recorded
`;

/** Feature OpenAPI delta defining createSplit. */
export const FEATURE_OPENAPI = `openapi: 3.1.0
info:
  title: payment-split-service
  version: "1.0"
paths:
  /splits:
    post:
      operationId: createSplit
      summary: Create a split
      responses:
        "201":
          description: Created
`;

/**
 * A complete coherent fixture: living landscape/spec/openapi for payment-service
 * plus feature FEAT-1 adding payment-split-service. `loam validate --feature FEAT-1`
 * and `loam archive FEAT-1` should both succeed on it.
 */
export function coherentFixture(): Record<string, string> {
  return {
    "architecture/landscape.likec4": LANDSCAPE,
    "services/payment-service/model.likec4": SERVICE_MODEL,
    "services/payment-service/spec.md": LIVING_SPEC,
    "services/payment-service/openapi.yaml": LIVING_OPENAPI,
    "features/FEAT-1-split/delta.likec4": FEATURE_DELTA,
    "features/FEAT-1-split/specs/payment-split-service/spec.md": FEATURE_SPEC,
    "features/FEAT-1-split/specs/payment-split-service/openapi.yaml": FEATURE_OPENAPI,
    "features/FEAT-1-split/intent.md": `---\nfeature: FEAT-1\nstatus: proposed\n---\n\n# Split payments\n\nLet a payment be split across payees.\n`,
  };
}
