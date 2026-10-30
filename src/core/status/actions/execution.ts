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
  "next.redraw-flows",
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
  // An archived feature's record is frozen — `loam verify` refuses it — so no
  // command discharges the step: `loam show` reads, and re-running it changes
  // nothing. As a runnable command it was next[0] of a quiet fleet and of every
  // archived feature's own status, and the "run next[0], repeat" loop never
  // left it. Whether what it left unverified matters is a person's call.
  if (step.code === "next.archived") {
    return {
      kind: "human-review",
      runnable: false,
      cwd: "docs-repo",
      needs: [
        "nothing to run: the feature is archived and its record is frozen — a person decides whether anything it left unverified matters (`loam unarchive <FEAT>` reopens its claims)",
      ],
    };
  }
  // A vouch is a person's act, never an agent's (`loam vouch` refuses without a
  // terminal or `--yes`), so the step is NOT runnable: an agent prepares the
  // reading list with `loam vouch --pack` and hands the stamp to a person.
  if (step.code === "next.revouch") {
    return {
      kind: "human-review",
      runnable: false,
      cwd: "service-repo",
      needs: ["a person who re-reads the moved document and vouches for it from the service's own repository"],
    };
  }
  // The first vouch, for the same reason: the stamp is a person's word that
  // the documents hold of the code, and an agent running it would forge that.
  if (step.code === "next.vouch") {
    return {
      kind: "human-review",
      runnable: false,
      cwd: "service-repo",
      needs: ["a person who reads the service's documents against its code and vouches for them from the service's own repository"],
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
