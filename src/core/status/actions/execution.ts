/** The executable machine contract layered over status's legacy command hint. */
import type {
  ExecutableNextStep,
  NextExecution,
  NextStep,
} from "../report.js";

const EDIT_STEPS = new Set([
  "next.author-intent",
  "next.touch-service",
  "next.author-spec",
  "next.author-openapi",
  "next.author-scenarios",
]);

const SERVICE_REPO_STEPS = new Set([
  "next.bind-service",
  "next.adopt-first",
  "next.generate-tests",
  "next.verify-unconfirmed",
  "next.attest-service",
  "next.verify-attested",
]);

function placeholders(command: string): string[] {
  return [...command.matchAll(/<([^>]+)>/g)].map((match) => match[1]!);
}

function execution(step: NextStep): NextExecution {
  if (EDIT_STEPS.has(step.code)) {
    return {
      kind: "edit",
      runnable: false,
      cwd: "docs-repo",
      after: step.command,
      needs: [step.path ?? "the artifact named in statement"],
    };
  }
  if (step.code === "next.recover-commit" && step.command === "loam doctor --json") {
    return {
      kind: "human-review",
      runnable: false,
      cwd: "docs-repo",
      needs: ["compare the living docs with version control"],
    };
  }
  const needs = placeholders(step.command);
  const serviceRepo = SERVICE_REPO_STEPS.has(step.code);
  return {
    kind: serviceRepo ? "external-repo" : "command",
    runnable: needs.length === 0,
    cwd: serviceRepo ? "service-repo" : "configured-repo",
    ...(needs.length === 0 ? { command: step.command } : { needs }),
  };
}

export function executableNext(step: NextStep): ExecutableNextStep {
  return { ...step, execution: execution(step) };
}
