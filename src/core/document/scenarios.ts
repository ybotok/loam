/**
 * What a requirement's scenarios are MISSING — the two coverage questions
 * `validate` asks of every spec.
 *
 * Separate from `./parse.ts` because these grade a parsed document rather than
 * produce one, and separate from `./spec.ts` because they answer to
 * `vocabulary/report.ts`: a stepless scenario is a Finding with a subject and a
 * label, and that shape belongs to the report, not to the requirement.
 */
import { scenarioGherkin } from "../vocabulary/steps.js";
import type { Finding } from "../vocabulary/report.js";
import { type Requirement } from "./spec.js";

/** Requirements with no scenario — the OpenSpec coverage rule (every requirement needs ≥1). */
export function requirementsMissingScenarios(reqs: Requirement[]): Requirement[] {
  return reqs.filter((r) => r.kind !== "REMOVED" && r.scenarios.length === 0);
}

/** A `#### Scenario:` heading whose body holds nothing a runner would execute. */
export interface SteplessScenario {
  requirement: string;
  scenario: string;
}

/**
 * Scenarios that satisfy the coverage rule above and test nothing.
 *
 * `requirementsMissingScenarios` counts HEADINGS, so a `#### Scenario:` with no
 * recognizable Given/When/Then line satisfied the fleet gate's coverage claim
 * outright — and it is not a hypothetical shape: it is what `loam new`
 * scaffolds and what an agent writes when it puts the criteria in prose.
 * Downstream the same emptiness is fatal twice over: cucumber runs a stepless
 * scenario vacuously green, and `loam verify --results` can never confirm it.
 *
 * The detector is `loam gherkin`'s own — `scenarioGherkin` decides what a step
 * IS, and a second opinion here would mean the gate and the emitted suite could
 * disagree about whether a scenario has any. That import is the one place these
 * two modules are circular (gherkin.ts parses requirements); both sides export
 * only function declarations, which are hoisted, so neither evaluation order
 * can observe a half-built module.
 */
export function steplessScenarios(reqs: Requirement[]): SteplessScenario[] {
  const out: SteplessScenario[] = [];
  for (const r of reqs) {
    if (r.kind === "REMOVED") continue;
    for (const s of r.scenarios) {
      if (scenarioGherkin(s.lines).steps.length === 0) out.push({ requirement: r.name, scenario: s.name });
    }
  }
  return out;
}

/**
 * The stepless half of the coverage check, as findings — the missing-scenario
 * half stays where it is (`requirementsMissingScenarios`), because the two are
 * different states with different fixes: one requirement owes acceptance
 * criteria, the other owes STEPS in criteria somebody has already written.
 *
 * `label` is the coverage check's own label (`payment-service: requirements`),
 * so both halves of one document name it the same way.
 */
export function steplessFindings(label: string, subject: string, reqs: Requirement[]): Finding[] {
  const bare = steplessScenarios(reqs);
  if (bare.length === 0) return [];
  return [
    {
      severity: "error",
      code: "requirements.stepless-scenario",
      subject,
      message:
        `${label}: ${bare.length} scenario(s) have a heading and no recognizable steps — ` +
        `they satisfy the coverage rule and test nothing. Cucumber runs a stepless scenario vacuously green and ` +
        `\`loam verify --results\` can never confirm it. Write the body as \`- **Given/When/Then**\` bullets.`,
      details: bare.map((s) => `${s.requirement} — ${s.scenario}`),
      text: { detailPrefix: "- " },
    },
  ];
}

