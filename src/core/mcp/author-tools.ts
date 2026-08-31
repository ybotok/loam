/** Opt-in MCP writers. Vouch and a committing archive are never exposed. */
import type { McpTool } from "./tools.js";

const WRITE_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
} as const;

const SAFE_WRITE_ANNOTATIONS = {
  ...WRITE_ANNOTATIONS,
  idempotentHint: true,
} as const;

export const MCP_AUTHOR_TOOLS: readonly McpTool[] = [
  {
    name: "loam_new",
    command: "new",
    description:
      "Scaffold a feature in the docs repo. Opt-in writer; refuses an existing feature. " +
      "CLI equivalent: loam new <featureId> [--title <text>] [--touches <id>...] [--new-service <id>...] [--capability <id>...] --json",
    positionals: [
      { property: "featureId", required: true, variadic: false, description: "new feature id, e.g. FEAT-101" },
    ],
    flags: [
      { property: "title", flag: "--title", kind: "string", description: "human title and directory slug" },
      { property: "touches", flag: "--touches", kind: "strings", description: "existing services changed; repeatable" },
      { property: "newServices", flag: "--new-service", kind: "strings", description: "services introduced; repeatable" },
      { property: "capabilities", flag: "--capability", kind: "strings", description: "business capabilities changed; repeatable" },
    ],
    annotations: WRITE_ANNOTATIONS,
  },
  {
    name: "loam_rebase",
    command: "rebase",
    description:
      "Pin a feature delta to the living baselines after the agent has reconciled them. Opt-in journaled writer. " +
      "CLI equivalent: loam rebase <featureId> [--service <id>] --json",
    positionals: [
      { property: "featureId", required: true, variadic: false, description: "feature id whose baselines were reviewed" },
    ],
    flags: [
      { property: "service", flag: "--service", kind: "string", description: "restrict to one touched service" },
    ],
    annotations: SAFE_WRITE_ANNOTATIONS,
  },
  {
    name: "loam_gherkin",
    command: "gherkin",
    description:
      "Generate loam-owned Gherkin files in the bound service repository. Opt-in journaled writer; refuses ownership conflicts. " +
      "CLI equivalent: loam gherkin [featureId] [--service <id>] --json",
    positionals: [
      { property: "featureId", required: false, variadic: false, description: "feature id; omit for the living suite" },
    ],
    flags: [
      { property: "service", flag: "--service", kind: "string", description: "service to emit for" },
    ],
    annotations: SAFE_WRITE_ANNOTATIONS,
  },
  {
    name: "loam_archive_plan",
    command: "archive",
    description:
      "Compute the complete archive plan without writing. The server enforces --dry-run. " +
      "CLI equivalent: loam archive <featureId> --dry-run --json",
    positionals: [
      { property: "featureId", required: true, variadic: false, description: "feature id to review" },
    ],
    flags: [],
    fixed: ["--dry-run"],
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
];
