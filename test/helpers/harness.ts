/**
 * Shared test harness: build throwaway docs-repo fixtures on disk and run loam
 * commands in-process (fast — no child process, LikeC4 stays warm).
 *
 * Commands resolve `loam.json` from process.cwd() and report failure via
 * process.exitCode, so runLoam() chdirs into the fixture workdir and captures
 * console output + exit code, restoring everything afterwards. Requires the
 * vitest "forks" pool (worker threads cannot chdir).
 *
 * The OTHER side of a federation — the service repositories that stand around a
 * docs repo, their claims and their `--record` runs — lives in
 * `./federated.ts`, which builds on this. It is a separate file because it is a
 * narrower subject: it is pinned to `coherentFixture()`'s one feature, while
 * everything here is fixture-agnostic.
 */
import { mkdtemp, mkdir, writeFile, rm, readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { format } from "node:util";
import { Command } from "commander";
import { registerInit } from "../../src/commands/init/init.js";
import { registerAdopt } from "../../src/commands/adopt/adopt.js";
import { registerList } from "../../src/commands/list/list.js";
import { registerNew } from "../../src/commands/new/new.js";
import { registerSeed } from "../../src/commands/seed/seed.js";
import { registerShow } from "../../src/commands/show/show.js";
import { registerStatus } from "../../src/commands/status/status.js";
import { registerSubsystem } from "../../src/commands/subsystem/subsystem.js";
import { registerDelta } from "../../src/commands/delta/delta.js";
import { registerDiff } from "../../src/commands/diff/diff.js";
import { registerGherkin } from "../../src/commands/gherkin/gherkin.js";
import { registerRebase } from "../../src/commands/rebase/rebase.js";
import { registerArchive } from "../../src/commands/archive/archive.js";
import { registerUnarchive } from "../../src/commands/unarchive/unarchive.js";
import { registerValidate } from "../../src/commands/validate/validate.js";
import { registerVerify } from "../../src/commands/verify/verify.js";
import { registerVouch } from "../../src/commands/vouch/vouch.js";
import { registerGate } from "../../src/commands/gate/gate.js";
import { registerDoctor } from "../../src/commands/doctor.js";
import { registerDependencies } from "../../src/commands/dependencies.js";
import { registerSteps } from "../../src/commands/steps/steps.js";
import { registerExplore } from "../../src/commands/explore.js";
import { registerContext } from "../../src/commands/context/context.js";
import { registerOpen } from "../../src/commands/open.js";
import { registerInstructions } from "../../src/commands/instructions.js";
import { registerExplain } from "../../src/commands/explain/explain.js";
import { registerMigrateOpenSpec } from "../../src/commands/migrate-openspec/migrate-openspec.js";
import { docsDirOf, type DocsDir } from "../../src/core/kernel/ids/dirs.js";
import { parseRequirements } from "../../src/core/document/parse.js";
import { requirementDigest } from "../../src/core/document/spec.js";
import { pinOpenapiOperations } from "../../src/core/openapi/merge/pin.js";
import { planOpenapiBaselines } from "../../src/core/openapi/baseline/plan.js";
import { pinAsyncapiSlots } from "../../src/core/asyncapi/merge/pin.js";

/**
 * The identity `loam vouch` stamps in tests.
 *
 * `gitIdentity` reads GIT_COMMITTER_* ahead of `git config`, exactly as git
 * itself does, so pinning them here makes the stamp the same on a laptop with a
 * global git identity, on a CI runner with none, and inside a container. It is
 * set once at import rather than per run because it is a constant, not state:
 * nothing mutates it, and no test wants a different one — the two that care
 * about a MISSING identity clear it themselves and put it back.
 */
export const TEST_IDENTITY = "Test Voucher <voucher@example.test>";
process.env.GIT_COMMITTER_NAME = "Test Voucher";
process.env.GIT_COMMITTER_EMAIL = "voucher@example.test";

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
  docsDir: DocsDir;
  /** Read a file under docsDir. */
  read(relPath: string): Promise<string>;
  /** Write/overwrite a file under docsDir (parent dirs auto-created). */
  write(relPath: string, content: string): Promise<void>;
  /** existsSync under docsDir. */
  exists(relPath: string): boolean;
  /** Delete the whole fixture tree. */
  destroy(): Promise<void>;
}

/**
 * The `Based-On:` value a delta must carry to be written against `name` as this
 * living document currently spells it — what `loam rebase` would stamp.
 *
 * Fixtures compute their pins instead of hard-coding them: a literal digest in
 * a fixture is a second definition of `requirementDigest`, and the day the
 * canonical serialization legitimately changes, every one of them would have to
 * be re-derived by hand — with a stale one reading as a genuine collision.
 */
export function pinFor(livingMarkdown: string, name: string): string {
  const requirement = parseRequirements(livingMarkdown).find((r) => r.name === name);
  if (!requirement) throw new Error(`no living requirement named '${name}' to pin against`);
  return requirementDigest(requirement);
}

/**
 * A feature contract with every operation pinned against `living`, and the
 * `x-loam-baselines` record for its restated path-item keys and components —
 * byte for byte what `loam rebase` writes on the OpenAPI axis, because these
 * ARE the two functions that command chains, in the same order. A fixture
 * pinning itself by hand would be a second implementation of the rule, free to
 * agree with the merge right up until the day it quietly did not.
 */
export function pinOpenapi(featureYaml: string, livingYaml: string): string {
  const ops = pinOpenapiOperations(featureYaml, livingYaml, "fixture").text ?? featureYaml;
  return planOpenapiBaselines(ops, livingYaml, "fixture").text ?? ops;
}

/**
 * A feature event contract with every slot pinned against `living` — byte for
 * byte what `loam rebase` writes on the AsyncAPI axis, for `pinOpenapi`'s
 * reason: this IS the function that command calls, so a fixture pinning
 * itself by hand would be a second implementation of the digest rule, free to
 * agree with the merge right up until the day it quietly did not.
 */
export function pinAsyncapi(featureYaml: string, livingYaml: string): string {
  return pinAsyncapiSlots(featureYaml, livingYaml, "fixture").text ?? featureYaml;
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
  opts: { service?: string; gherkinDir?: string } = {},
): Promise<Project> {
  const root = await makeTmpDir();
  const workDir = join(root, "work");
  // The fixture's loam.json (written below) spells this same path, so the
  // brand states exactly what loading that config would establish.
  const docsDir = docsDirOf(join(root, "docs"));
  await mkdir(workDir, { recursive: true });
  await mkdir(docsDir, { recursive: true });
  await writeFiles(docsDir, files);
  const config = {
    docsDir,
    ...(opts.service ? { service: opts.service } : {}),
    ...(opts.gherkinDir ? { gherkinDir: opts.gherkinDir } : {}),
  };
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
 * A content fingerprint of a whole tree: sha256 per file, keyed by its path
 * relative to `root` with forward slashes. Directories are keyed with a trailing
 * slash and a marker value, so a directory left behind empty is as visible as a
 * changed byte — which is what "the command touched nothing" and "archive then
 * unarchive is a round trip" actually mean.
 */
export async function treeHashes(root: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name);
      const rel = relative(root, abs).split(/[\\/]/).join("/");
      if (entry.isDirectory()) {
        out[`${rel}/`] = "<dir>";
        await walk(abs);
      } else {
        out[rel] = createHash("sha256").update(await readFile(abs)).digest("hex");
      }
    }
  };
  await walk(root);
  return out;
}

/**
 * Run a loam command in-process from `cwd`.
 * Example: runLoam(p.workDir, "validate", "--feature", "FEAT-1").
 */
/**
 * Serialises the fact runLoam's whole design rests on: cwd, console.log/error
 * and process.exitCode are process-global, so two in-process runs overlapping
 * would silently interleave each other's output and directory. Every call
 * queues behind the previous one's settlement — the ONE module-level mutable
 * value in this harness, tolerated because it exists precisely to contain the
 * module-level-state hazard AGENTS.md names.
 *
 * A queue rather than a refusal, and that is an observed lesson, not a
 * preference: the throw variant was tried first, and under host overload it
 * turned one runner timeout into a cascade — vitest cannot cancel a timed-out
 * test's async work, so the zombie run kept the flag held while every later
 * test in the fork failed the guard with what the failure classifier honestly
 * read as product errors (44 of them in one overloaded coverage run). Waiting
 * keeps the corruption impossible and keeps a timeout being one timeout. The
 * cost — a test that overlaps two runLoam calls by MISTAKE now serialises
 * silently instead of failing loudly — is accepted and recorded here; use
 * spawnLoam from test/helpers/cli-process.ts for real concurrency. runPair in
 * archive-integrity.test.ts is the one audited in-process overlap, and it
 * never enters runLoam.
 */
let runLoamTurn: Promise<unknown> = Promise.resolve();

export async function runLoam(cwd: string, ...args: string[]): Promise<RunResult> {
  const run = runLoamTurn.then(() => runLoamNow(cwd, args));
  // The chain must survive a failed run — otherwise one rejection poisons
  // every later call in the fork with the same stale error.
  runLoamTurn = run.catch(() => undefined);
  return run;
}

async function runLoamNow(cwd: string, args: string[]): Promise<RunResult> {
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
    // registerMcp is deliberately absent: its action awaits process.stdin,
    // which no in-process test owns, so runLoam("mcp") would hang this fork
    // until the runner's timeout. Drive the server through serve() with
    // injected streams (test/mcp-serve.test.ts) or through spawnLoamStdio
    // (test/helpers/cli-process.ts), where stdin has an owner and an end.
    registerInit(program);
    registerAdopt(program);
    registerList(program);
    registerExplore(program);
    registerContext(program);
    registerNew(program);
    registerSeed(program);
    registerShow(program);
    registerStatus(program);
    registerSubsystem(program);
    registerDelta(program);
    registerDiff(program);
    registerGherkin(program);
    registerRebase(program);
    registerArchive(program);
    registerUnarchive(program);
    registerValidate(program);
    registerVerify(program);
    registerVouch(program);
    registerGate(program);
    registerDoctor(program);
    registerDependencies(program);
    registerSteps(program);
    registerInstructions(program);
    registerExplain(program);
    registerOpen(program);
    registerMigrateOpenSpec(program);
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

/**
 * Living OpenAPI for payment-service defining authorizePayment. The response
 * carries a minimal schema on purpose: the canonical fixture demonstrates a
 * complete contract, not the thinnest parsable one — a description-only
 * response is exactly the shape the contract-depth warns exist to name, and
 * the fixture behind every exact-warn-set assertion must not carry it.
 */
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
          content:
            application/json:
              schema:
                type: object
                properties:
                  status:
                    type: string
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

/**
 * Feature OpenAPI delta defining createSplit. Schema present for the same
 * reason as LIVING_OPENAPI's: the canonical fixtures model contract depth.
 */
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
          content:
            application/json:
              schema:
                type: object
                properties:
                  splitId:
                    type: string
`;

/**
 * Living AsyncAPI for payment-service: one send — payment.Authorized reaches
 * the wire through a channel, an operation and a components message, the
 * fully factored shape (the channel entry aliasing the components
 * declaration by `$ref`), so fixtures built on it exercise every join the
 * reader makes.
 */
export const LIVING_ASYNCAPI = `asyncapi: 3.0.0
info:
  title: payment-service events
  version: "1.0"
channels:
  paymentEvents:
    address: payment.events.v1
    messages:
      Authorized:
        $ref: '#/components/messages/Authorized'
operations:
  sendAuthorized:
    action: send
    channel:
      $ref: '#/channels/paymentEvents'
components:
  messages:
    Authorized:
      name: payment.Authorized
      payload:
        type: object
        properties:
          paymentId:
            type: string
`;

/**
 * Feature asyncapi delta for payment-service: a complete document, as the
 * format spec requires — it QUOTES the living Authorized slots verbatim
 * (which is what makes `loam rebase`'s pins load-bearing at the merge) and
 * adds the refund producer side: channel, send operation and message for
 * payment.Refunded. Unpinned as authored; `pinAsyncapi` (or a real
 * `loam rebase` run) stamps the pins.
 */
export const FEATURE_ASYNCAPI = `asyncapi: 3.0.0
info:
  title: payment-service events
  version: "1.0"
channels:
  paymentEvents:
    address: payment.events.v1
    messages:
      Authorized:
        $ref: '#/components/messages/Authorized'
  refundEvents:
    address: payment.refunds.v1
    messages:
      Refunded:
        $ref: '#/components/messages/Refunded'
operations:
  sendAuthorized:
    action: send
    channel:
      $ref: '#/channels/paymentEvents'
  sendRefunded:
    action: send
    channel:
      $ref: '#/channels/refundEvents'
components:
  messages:
    Authorized:
      name: payment.Authorized
      payload:
        type: object
        properties:
          paymentId:
            type: string
    Refunded:
      name: payment.Refunded
      payload:
        type: object
        properties:
          refundId:
            type: string
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
