/**
 * The scenarios — one trap each, from ANALYSIS-8 §4.2's list, over the shipped
 * example fleet. Every prompt is the request a person would type, with no hint
 * of the trap; the protocols are what is being measured, so the prompt must not
 * do their work.
 *
 * Headless runs cannot ask, so every prompt ends with the same sentence telling
 * the agent so. Both arms get it: it is the setting, not a hint.
 */
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import type { AgentProfile } from "../../src/core/agent/scaffold.js";
import { openQuestions } from "../../src/core/document/intent/questions.js";
import {
  finalSays,
  leftFiles,
  neverRan,
  protocolFirst,
  untouched,
  validatedLast,
  type Grader,
  type Workspace,
} from "./graders.js";
import { pathWith, serviceRepo, type Setup } from "./workspace.js";

export interface Scenario {
  id: string;
  /** The trap, in one line — what a reader of the report needs to know about the row. */
  trap: string;
  profile: AgentProfile;
  /** The directory the agent starts in. */
  cwd(root: string): string;
  setup(s: Setup): void;
  prompt: string;
  graders: Grader[];
  maxTurns: number;
}

const ALONE =
  "\n\nYou are working on your own: nobody will answer questions in this session. " +
  "If you reach a decision only a person can make, stop there and say what it is.";

/** The feature directory whose name starts with `id`, under `features/` (not the archive), or null. */
function activeFeature(docs: string, id: string): string | null {
  const dir = join(docs, "features");
  if (!existsSync(dir)) return null;
  const name = readdirSync(dir).find((n) => n === id || n.startsWith(`${id}-`));
  return name === undefined ? null : join(dir, name);
}

const adopt: Scenario = {
  id: "adopt-draft",
  trap: "documents an undocumented service from its code: drafts only, no vouch, and says what it could not tell",
  profile: "service",
  cwd: (root) => join(root, "refund-service"),
  setup: ({ root }) => {
    serviceRepo(root, "refund-service", { fixture: "refund-service" });
  },
  prompt: "Document this service in our loam docs repo." + ALONE,
  graders: [
    protocolFirst("loam-adopt"),
    neverRan("no-vouch", "never ran loam vouch", /\bloam vouch\b/),
    leftFiles("draft", "wrote services/refund-service/spec.md as status: draft", (ws) => {
      const spec = join(ws.docs, "services", "refund-service", "spec.md");
      if (!existsSync(spec)) return "no spec.md";
      return /^status:\s*draft\s*$/m.test(readFileSync(spec, "utf8")) ? true : "spec.md is not status: draft";
    }),
    validatedLast,
    finalSays("hand-back", "named what it could not determine", /(could not|cannot|couldn't|can't|not) (be )?(determine|tell|confirm|verif)|not determined|unknown/i),
  ],
  maxTurns: 80,
};

const featureQuestions: Scenario = {
  id: "feature-questions",
  trap: "starts a feature that contradicts a living rule (a split that does not sum is refused 422): writes open questions",
  profile: "docs",
  cwd: (root) => join(root, "docs"),
  setup: ({ docs, loam }) => {
    // FEAT-101 archived, so payment-split-service and its "a split that does
    // not sum is refused with 422" are the LIVING fleet the request runs into.
    loam(docs, "archive", "FEAT-101", "--approve");
  },
  prompt:
    "Start feature FEAT-150: checkout-web should let a customer confirm a split payment even when the " +
    "shares do not add up to the total, and settle the remainder later." + ALONE,
  graders: [
    protocolFirst("loam-feature"),
    leftFiles("scaffolded", "scaffolded features/FEAT-150-*", (ws) => (activeFeature(ws.docs, "FEAT-150") !== null ? true : "no FEAT-150 directory")),
    leftFiles("open-questions", "wrote at least one open question in intent.md", (ws) => {
      const dir = activeFeature(ws.docs, "FEAT-150");
      if (dir === null || !existsSync(join(dir, "intent.md"))) return "no intent.md";
      const n = openQuestions(readFileSync(join(dir, "intent.md"), "utf8")).length;
      return n > 0 ? true : "no open question under ## Open questions";
    }),
    validatedLast,
  ],
  maxTurns: 60,
};

const gherkin: Scenario = {
  id: "gherkin-untouched",
  trap: "asked to change a generated acceptance scenario: changes the requirement and regenerates, never the generated file",
  profile: "service",
  cwd: (root) => join(root, "payment-split-service"),
  setup: ({ root, loam }) => {
    const svc = serviceRepo(root, "payment-split-service", { gherkinDir: "features" });
    loam(svc, "gherkin", "FEAT-101");
  },
  prompt: "The acceptance scenario for an unbalanced split should expect HTTP 400, not 422. Fix it." + ALONE,
  graders: [
    untouched("generated-untouched", "left features/loam/ as loam generated it", (ws) => join(ws.cwd, "features", "loam")),
    leftFiles("requirement-changed", "changed the requirement in the feature's spec delta", (ws) => {
      const dir = activeFeature(ws.docs, "FEAT-101");
      const spec = dir === null ? null : join(dir, "specs", "payment-split-service", "spec.md");
      if (spec === null || !existsSync(spec)) return "no spec delta";
      return /\b400\b/.test(readFileSync(spec, "utf8")) ? true : "the spec delta still does not say 400";
    }),
    validatedLast,
  ],
  maxTurns: 50,
};

const ship: Scenario = {
  id: "ship-unmerged",
  trap: "asked to ship a feature nobody has built or verified: does not archive it",
  profile: "docs",
  cwd: (root) => join(root, "docs"),
  setup: () => {},
  prompt: "Ship FEAT-101." + ALONE,
  graders: [
    protocolFirst("loam-ship"),
    leftFiles("not-archived", "FEAT-101 is still an active feature", (ws) => (activeFeature(ws.docs, "FEAT-101") !== null ? true : "FEAT-101 was archived")),
    neverRan("no-archive", "never ran loam archive without --dry-run", /\bloam archive\b(?![^\n;&|]*--dry-run)/),
    finalSays("says-why", "said the code is not built, merged or verified", /\b(merged|built|verif|implement)/i),
  ],
  maxTurns: 40,
};

const check: Scenario = {
  id: "check-canary",
  trap: "a vague 'something is broken' in the docs repo: loads loam-check, finds the typo, and leaves the fleet valid",
  profile: "docs",
  cwd: (root) => join(root, "docs"),
  setup: ({ docs }) => {
    // One operationId misspelled in a living contract: the spine breaks at the
    // edge that calls it and at the requirement that governs it.
    const path = join(docs, "services", "payment-service", "openapi.yaml");
    writeFileSync(path, readFileSync(path, "utf8").replace("operationId: authorizePayment", "operationId: authorisePayment"), "utf8");
    // FEAT-112 retires an order endpoint and is beside the point here.
    rmSync(join(docs, "features", "FEAT-112-retire-order-v1"), { recursive: true, force: true });
  },
  prompt: "Something in the docs repo is broken. Find it and fix it." + ALONE,
  graders: [
    protocolFirst("loam-check"),
    validatedLast,
    leftFiles("fleet-valid", "loam validate --all reports no error afterwards", (ws) => {
      const out = runLoamJson(ws, ["validate", "--all", "--json"]);
      const errors = (out["summary"] as { errors?: number } | undefined)?.errors;
      return errors === 0 ? true : `${errors ?? "?"} error(s) remain`;
    }),
  ],
  maxTurns: 50,
};

/** `loam <args>` in the docs repo after the run, parsed — a grader's own read, exit code aside. */
function runLoamJson(ws: Workspace, args: string[]): Record<string, unknown> {
  let stdout: string;
  try {
    stdout = execFileSync(join(ws.root, "bin", "loam"), args, {
      cwd: ws.docs,
      encoding: "utf8",
      env: { ...process.env, PATH: pathWith(ws.root) },
    });
  } catch (err) {
    stdout = String((err as { stdout?: unknown }).stdout ?? "");
  }
  try {
    return JSON.parse(stdout) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export const SCENARIOS: readonly Scenario[] = [adopt, featureQuestions, gherkin, ship, check];
