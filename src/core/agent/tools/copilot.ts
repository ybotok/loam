/**
 * Copilot's always-read instructions file, `.github/instructions/loam.instructions.md`.
 *
 * A service repository carries no AGENTS.md of loam's — the docs repo has the
 * one AGENTS.md, and this repository's own, if any, is the team's — so the
 * only thing that told an agent here that loam exists was a skill it happened
 * to load. Copilot's cloud agent reads `.github/instructions/*.instructions.md`
 * whose `applyTo` matches the files it works on, on every task, which makes
 * this the one place a pointer reaches it before any skill is chosen.
 *
 * Loam's own file, under its own name, and never the shared
 * `.github/copilot-instructions.md`: that one is the team's, and a delivery
 * that had to merge into it would break the rule every init delivery keeps.
 * The file is a pointer like the skills — what loam is for here, which skills
 * exist, the two rules that hold on every path — and refreshes the way they
 * do, while its bytes match the digest loam recorded.
 */
import type { CommandContent, InstructionsEmitter } from "../contract.js";

export const COPILOT_INSTRUCTIONS: InstructionsEmitter = {
  path: [".github", "instructions", "loam.instructions.md"],
  format: (stamp, commands) => `---
applyTo: "**"
---

${stamp}

# loam

This repository is documented in a loam docs repository — \`loam.json\` here names it. The docs
repo holds the fleet's architecture, requirements and API and event contracts as files, and loam
checks that they agree. It never reads this code: the docs about this service were written from
it, and stay drafts until a person vouches for them.

Before you change what this service does, or how it talks to another one, load the loam skill
that matches the work — or run \`loam instructions <skill>\` and follow the page it prints:

${commands.map((c: CommandContent) => `- \`${c.name}\` — ${c.description}`).join("\n")}

\`loam status --json\` puts the ordered work queue in \`next[]\`, each entry a code and the
literal command. Branch on the codes, never on the prose. Never run \`loam vouch\`: it records
that a person read the code, and only a person can say so.

Every \`loam\` command assumes loam is on PATH. Where this repository installs it as a
devDependency instead, run each one as \`npx loam …\`.
`,
};
