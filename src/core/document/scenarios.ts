/**
 * What a requirement's scenarios are MISSING, and where they contradict
 * themselves — the coverage and shape questions `validate` asks of every spec.
 *
 * Separate from `./parse.ts` because these grade a parsed document rather than
 * produce one, and separate from `./spec.ts` because they answer to
 * `vocabulary/report.ts`: a stepless scenario is a Finding with a subject and a
 * label, and that shape belongs to the report, not to the requirement.
 */
import { scenarioGherkin, type EmittedStep } from "../vocabulary/steps.js";
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

/**
 * Scenarios that have steps and assert NOTHING — a body of Given and When with
 * no Then anywhere in it.
 *
 * The third state, and the one that survives both checks above: the requirement
 * has a scenario, the scenario has steps, and the run can only ever confirm that
 * the arrangement did not throw. `And`/`But` are continuations, so their meaning
 * is decided by the keyword they follow — with no `Then` in the body there is
 * nothing for them to continue but the setup.
 *
 * It matters more the more evidence rests on the suite. A stepless scenario is
 * at least visible as an empty body; this one reads like a real test, emits real
 * steps, runs green, and answers a `scenario.tested` claim to the same standard
 * as a scenario that checks twenty things. Under a runner-neutral answer sheet —
 * one `{digest, status}` entry, no steps to count — this document-side check is
 * the only thing left that can tell the two apart.
 */
export function assertionlessScenarios(reqs: Requirement[]): SteplessScenario[] {
  const out: SteplessScenario[] = [];
  for (const r of reqs) {
    if (r.kind === "REMOVED") continue;
    for (const s of r.scenarios) {
      const { steps } = scenarioGherkin(s.lines);
      // Disjoint from stepless by construction: a body with no steps at all is
      // that finding's, and reporting one scenario under both codes would offer
      // two fixes for one defect.
      if (steps.length > 0 && !steps.some((st) => /^Then\b/.test(st.text))) {
        out.push({ requirement: r.name, scenario: s.name });
      }
    }
  }
  return out;
}

/** One scenario's disagreement between its `Examples` columns and its `<placeholders>`. */
export interface ExamplesMismatch {
  requirement: string;
  scenario: string;
  /** `<placeholders>` a step uses that no column supplies. */
  unbound: string[];
  /** Columns no step, docstring or data-table cell refers to. */
  unreferenced: string[];
}

const PLACEHOLDER_RE = /<([^<>\s]+)>/g;

/**
 * Every `<placeholder>` a scenario's steps reach for, arguments included.
 *
 * Docstrings and data tables are scanned too because cucumber substitutes into
 * them: `<fee>` inside a request payload is a real reference, and a check that
 * read only the step lines would call its column unreferenced and invite the
 * author to delete the column the payload depends on.
 */
function placeholdersUsed(steps: EmittedStep[]): Set<string> {
  const used = new Set<string>();
  const scan = (text: string): void => {
    for (const m of text.matchAll(PLACEHOLDER_RE)) used.add(m[1]!);
  };
  for (const st of steps) {
    scan(st.text);
    for (const l of st.docstring?.lines ?? []) scan(l);
    for (const row of st.table ?? []) for (const cell of row) scan(cell);
  }
  return used;
}

/**
 * Scenarios whose `Examples` header and `<placeholders>` disagree.
 *
 * Only scenarios that HAVE an Examples table are considered, and that scoping is
 * load-bearing twice over: a plain scenario's `<angle brackets>` are prose (a
 * generic, a placeholder in a URL template, loam's own scaffold sentinels), and
 * a fleet that never writes an outline must never earn a finding from this.
 *
 * The two halves are different defects. An UNBOUND placeholder is an error the
 * runner cannot repair: cucumber substitutes nothing, so the step definition
 * receives the literal text `<fee>` and either fails obscurely or — worse —
 * matches and asserts against a string nobody meant. An UNREFERENCED column is a
 * warning, because it is usually the fossil of a rename: the column still lists
 * six cases, the step that used it now names something else, and the outline
 * runs six identical passes that read as six cases of coverage.
 */
export function examplesMismatches(reqs: Requirement[]): ExamplesMismatch[] {
  const out: ExamplesMismatch[] = [];
  for (const r of reqs) {
    if (r.kind === "REMOVED") continue;
    for (const s of r.scenarios) {
      const { steps, examples } = scenarioGherkin(s.lines);
      if (examples === null) continue;
      const used = placeholdersUsed(steps);
      const columns = new Set(examples.header);
      const unbound = [...used].filter((p) => !columns.has(p)).sort();
      const unreferenced = examples.header.filter((c) => !used.has(c));
      if (unbound.length > 0 || unreferenced.length > 0) {
        out.push({ requirement: r.name, scenario: s.name, unbound, unreferenced });
      }
    }
  }
  return out;
}

/**
 * The Examples half, as findings — two codes rather than one with two
 * severities, because a machine cannot branch on a severity that depends on the
 * case, and the fixes differ: one adds a column, the other removes one or
 * restores the reference that used to use it.
 */
export function examplesFindings(label: string, subject: string, reqs: Requirement[]): Finding[] {
  const all = examplesMismatches(reqs);
  const findings: Finding[] = [];
  const unbound = all.filter((m) => m.unbound.length > 0);
  if (unbound.length > 0) {
    findings.push({
      severity: "error",
      code: "requirements.examples-unbound",
      subject,
      message:
        `${label}: ${unbound.length} scenario(s) use a \`<placeholder>\` no \`Examples\` column supplies — ` +
        `cucumber substitutes nothing, so the step receives the literal angle-bracket text. ` +
        `Add the column, or correct the placeholder to one the header names.`,
      details: unbound.map((m) => `${m.requirement} — ${m.scenario}: ${m.unbound.map((p) => `<${p}>`).join(", ")}`),
      text: { detailPrefix: "- " },
    });
  }
  const dead = all.filter((m) => m.unreferenced.length > 0);
  if (dead.length > 0) {
    findings.push({
      severity: "warn",
      code: "requirements.examples-unreferenced",
      subject,
      message:
        `${label}: ${dead.length} scenario(s) declare an \`Examples\` column no step refers to — ` +
        `usually the fossil of a rename, and the outline then runs its rows as identical passes that read as cases. ` +
        `Reference the column from a step, or drop it.`,
      details: dead.map((m) => `${m.requirement} — ${m.scenario}: ${m.unreferenced.join(", ")}`),
      text: { detailPrefix: "- " },
    });
  }
  return findings;
}

/** The assertionless half, as findings — same label and subject as its two siblings. */
export function assertionlessFindings(label: string, subject: string, reqs: Requirement[]): Finding[] {
  const mute = assertionlessScenarios(reqs);
  if (mute.length === 0) return [];
  return [
    {
      severity: "error",
      code: "requirements.assertionless-scenario",
      subject,
      message:
        `${label}: ${mute.length} scenario(s) have steps and no \`Then\` — ` +
        `they arrange and act, and assert nothing. The run confirms only that the setup did not throw, ` +
        `and the claim it answers is confirmed on that. Add the \`- **Then**\` the scenario was written for.`,
      details: mute.map((s) => `${s.requirement} — ${s.scenario}`),
      text: { detailPrefix: "- " },
    },
  ];
}
