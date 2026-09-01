import type { CommandContent } from "../contract.js";

/**
 * The incident-reporting protocol: preserve a small, sanitized reproducer when
 * loam or its agent integration behaves unexpectedly, without turning loam
 * into a telemetry service or retrying a risky write.
 */
export const LOAM_REPORT: CommandContent = {
  name: "loam-report",
  description:
    "Record unexpected loam or agent behavior as a sanitized, reproducible Markdown report",
  argumentHint: "",
  purpose:
    "Collect one unexpected loam or agent-integration incident into a separate, reviewable Markdown file. This is local diagnostics only: redact secrets, never upload automatically, and never repeat a writer merely to reproduce it.",
  invocation: "loam instructions loam-report",
  placeholders: [],
  spine: [
    "preserve the user's original symptom and expected result before investigating",
    "collect the binary version, wiring diagnosis and the smallest safe reproduction",
    "classify the failure without repairing, retrying a writer or changing project documents",
    "sanitize commands, paths and output, then write one report under loam-reports/",
    "hand back the report path, classification and any evidence that could not be collected",
  ],
  body: `Record one incident where loam, a generated command/skill, or the agent following it
behaved unexpectedly. The result is a local diagnostic document, not a repair and not telemetry.
Do not change architecture/spec files while collecting it.

## Preserve the symptom first

Before running anything, write down the user's original request, what they expected, what actually
happened, the command or chat entry point involved, and whether any files may already have changed.
Do not improve or reinterpret the failing command yet: a cleaned-up command is not a reproduction.

Classify the incident as one of these, using \`inconclusive\` until the evidence supports another:

- \`loam-product\` — the binary violated its documented contract or produced internally inconsistent output;
- \`project-data\` — the binary correctly reported invalid, incomplete or stale repository documents;
- \`agent-workflow\` — the generated command/skill was missing, stale, misrouted or followed incorrectly;
- \`host-infrastructure\` — permissions, filesystem, process, shell or tool-host behavior prevented the run;
- \`inconclusive\` — the available evidence does not distinguish the above.

## Collect only safe evidence

1. Run \`loam --version\` and record the result.
2. Run \`loam doctor --json\`. If it succeeds, keep \`healthy\`, the finding codes and their structured
   locations/fixes, the resolved repository role, and the write-path state. If it refuses, keep
   \`error.code\` and the sanitized message. Do not apply the fixes during reporting.
3. When the repository is wired, run \`loam status --json\` and keep only the state and next-action
   rows relevant to this incident. A refusal is evidence too; keep its \`error.code\`.
4. Re-run the original operation only when it is read-only and safe. Never re-run \`init\`, \`new\`,
   \`rebase\`, \`subsystem\`, \`archive\`, \`unarchive\`, \`vouch\`, a recording form of \`verify\`, or
   any other writer merely to make it fail twice. For a writer, record its original exit/output and
   inspect \`doctor\`, \`status\` and version only. Do not repair, roll back or delete anything unless
   the user separately asks for that action.
5. Prefer the JSON envelope: record \`contractVersion\`, \`ok\`, \`command\`, \`error.code\`, finding
   codes and \`locations[]\`. Quote only the smallest stdout/stderr excerpt that demonstrates the
   symptom. State what was omitted.

## Sanitize before writing

Never include credentials, tokens, cookies, authorization headers, private keys, environment dumps,
or values of variables whose names contain \`TOKEN\`, \`SECRET\`, \`PASSWORD\`, \`AUTH\`, \`COOKIE\` or
\`KEY\`. Replace each value with \`<redacted>\`. Replace the user's home directory with \`<home>\` and
prefer repository-relative paths. Do not copy source files, architecture/spec bodies, or a complete
command output when a code and short excerpt prove the same fact. Review the finished report once
more for secrets before handing it back.

## Write one separate report

Create \`loam-reports/YYYY-MM-DD-<short-slug>.md\` at the current repository root. Use a short neutral
slug based on the symptom, not a customer, person or secret. Never overwrite a different incident;
add a numeric suffix when the path exists. Reports are ordinary project files so the team can
review or commit them deliberately, but do not upload, submit an issue, send telemetry, or contact
any service automatically.

Use this shape, omitting only fields that truly cannot be known and marking them \`not collected\`:

    # loam problem report: <short title>

    - Recorded: <ISO-8601 timestamp>
    - Classification: <one value above>
    - Repository role: <docs | service | combined | unresolved>
    - loam version: <version>
    - Entry point: <chat command, skill, or CLI command; sanitized>
    - Side effects observed: <none known | paths changed | unknown>

    ## Summary
    ## Expected
    ## Actual
    ## Minimal safe reproduction
    ## Machine contract
    ## Doctor and status evidence
    ## Files changed or write state
    ## Workaround
    ## Missing evidence
    ## Sanitization

In \`Machine contract\`, include exit code plus the stable envelope fields and relevant finding
codes/locations; do not paste an entire large JSON payload. In \`Sanitization\`, list the kinds of
values removed without revealing them. If no workaround is known, say so rather than inventing one.

Finish by telling the user the report path, classification, whether project files changed, and which
evidence was unavailable. Keep diagnosis separate from certainty: a plausible cause belongs under
\`Summary\` as a hypothesis until the reproduction proves it.
`,
};
