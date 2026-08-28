/**
 * This service's requirement documents: spec.md, arch.spec.md, and the
 * obligations the second of them carries that the first never does.
 *
 * Two entry points because the two happen at different moments in a service's
 * grading and the order of findings is part of the report. `readServiceSpecs`
 * runs first — everything downstream joins through the requirements it parses —
 * while `archAxisFindings` runs last, after both spines, because `covers.unknown`
 * resolves against the C4 model and the landscape and cannot be answered until
 * those are in hand.
 *
 * The arch axis is advisory in what it ASKS for (covers.unknown,
 * health.uncovered are warnings; arch.spec.md's absence is not a finding at all,
 * because partial adoption is supported) but not in whether the file is
 * readable: a conflict marker or a stepless scenario is graded exactly as it is
 * on the business axis. One file, one rule.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { type Elem, type LoadedDoc, type Rel } from "../../../core/c4/likec4.js";
import { type PathableService } from "../../../core/kernel/ids/service.js";
import { type ServicePaths } from "../../../core/repo/paths.js";
import { type Finding } from "../../../core/vocabulary/report.js";
import { parseRequirements } from "../../../core/document/parse.js";
import { steplessFindings } from "../../../core/document/scenarios.js";
import {
  BASED_ON_LINE_RE,
  CAPABILITY_LINE_RE,
  REALIZES_LINE_RE,
  REQUIREMENT_ID_LINE_RE,
  type Requirement,
} from "../../../core/document/spec.js";
import { type CoverageScope } from "../../../core/c4/arch.js";
import { readHealth } from "../../../core/vocabulary/health.js";
import { documentConflictFinding } from "../../../core/conflict-markers.js";
import { FleetContext } from "../../../core/fleet-context.js";
import { healthDependencyFindings } from "../checks/health-deps.js";
import {
  coverageFinding,
  coversEntries,
  coversUnknownFindings,
  duplicateRequirementFindings,
  repeatedListLineFindings,
  requirementIdFindings,
} from "../checks/requirements.js";

/** Both requirement documents, parsed once for every axis that joins through them. */
export interface ServiceSpecs {
  /** spec.md's findings, emitted before any cross-axis check runs. */
  findings: Finding[];
  /** Every requirement spec.md declares, REMOVED ones included. */
  reqs: Requirement[];
  /** The ones that still govern something. */
  livingReqs: Requirement[];
  /** arch.spec.md's text, or null when the service has none. */
  archText: string | null;
  archReqs: Requirement[];
}

export async function readServiceSpecs(input: {
  service: PathableService;
  paths: ServicePaths;
  fleet?: FleetContext;
}): Promise<ServiceSpecs> {
  const { service, paths, fleet } = input;
  const findings: Finding[] = [];

  // Requirement coverage.
  let reqs: Requirement[] = [];
  if (existsSync(paths.spec)) {
    const specText =
      fleet === undefined ? await readFile(paths.spec, "utf8") : await fleet.readText(paths.spec);
    reqs = fleet === undefined ? parseRequirements(specText) : await fleet.readRequirements(paths.spec);
    // Conflict markers first, because they say that nothing below this line is
    // anyone's text. An error, gating by the default rule and deliberately
    // without `gates`: that field is coherence's (issue.ts) and archive does
    // not read validate's findings, so claiming it here would be a promise
    // about a gate that is not wired. What makes it an error rather than a
    // warning is what the next merge does — `loam archive` rewrites the
    // requirements section of this very file and takes whichever marker lines
    // fall inside it, turning a conflict anyone can see into a document nobody
    // can tell is wrong.
    const conflict = documentConflictFinding(`${service}: spec.md`, service, specText);
    if (conflict !== null) findings.push(conflict);
    // A living spec with no `### Requirement:` block at all is the baseline
    // `loam adopt` scaffolds and nobody ever filled in. "requirements covered
    // (0 requirements, all with scenarios)" is true of it and says the opposite
    // of what a reader needs: every cross-axis check downstream — API
    // governance, the Operations: spine, gherkin generation — is vacuous here,
    // and the green tick is what let a whole fleet score `sourced` over empty
    // files.
    if (reqs.length === 0) {
      findings.push({
        severity: "warn",
        code: "spec.no-requirements",
        subject: service,
        message: `${service}: spec.md holds no '### Requirement:' blocks — every requirement-driven check below is vacuous, and nothing here can go out of date because nothing is written down`,
      });
    } else {
      findings.push(coverageFinding(`${service}: requirements`, reqs));
    }
    // The other half of the coverage question, and an error for the same
    // reason the first half is: the whole claim of coverage is that a
    // requirement has a scenario something can RUN. A heading with no steps
    // satisfies the count and tests nothing — cucumber runs it vacuously green
    // and `loam verify --results` can never confirm it — so a fleet gate that
    // called it covered was certifying the absence of a test.
    findings.push(...steplessFindings(`${service}: requirements`, service, reqs));
    findings.push(...duplicateRequirementFindings(reqs, `${service}: spec.md`, service));
    findings.push(...requirementIdFindings(reqs, `${service}: spec.md`, service));
    findings.push(...repeatedListLineFindings(reqs, `${service}: spec.md`, service));
  } else {
    findings.push({
      severity: "warn",
      code: "service.no-spec",
      message: `No living spec at ${paths.spec} — requirement coverage and API governance are unchecked`,
    });
  }

  // The requirements that still govern anything. A REMOVED requirement is on
  // its way out together with the operations it names: it makes no claim on the
  // contract and governs nothing once the retiring feature archives — the same
  // position coherence/coherence.ts takes on the delta side.
  //
  // Spelled once because it was spelled three times and dropped on the fourth:
  // `governedOps` filtered, `spec-api.op-undefined` filtered, and the
  // `api.covered` join did not — so an operation whose only requirement was
  // REMOVED counted as governed, and the one operation about to be left without
  // a requirement was the one the report called covered.
  const livingReqs = reqs.filter((r) => r.kind !== "REMOVED");

  // The architecture spec, read HERE with spec.md rather than with the rest of
  // its own axis below, because the event links are a requirement-level join and
  // BOTH requirement files carry them. Events are architecture as often as they
  // are business — the outbox requirement in a service's arch.spec.md is the
  // canonical place a `Publishes:` line belongs — so handing the event axis only
  // spec.md would silently ignore the lines most authors write.
  const archText = existsSync(paths.archSpec)
    ? fleet === undefined
      ? await readFile(paths.archSpec, "utf8")
      : await fleet.readText(paths.archSpec)
    : null;
  const archReqs =
    archText === null
      ? []
      : fleet === undefined
        ? parseRequirements(archText)
        : await fleet.readRequirements(paths.archSpec);

  return { findings, reqs, livingReqs, archText, archReqs };
}

/** What the arch axis needs once the model and the landscape have been read. */
export interface ArchAxis {
  service: PathableService;
  paths: ServicePaths;
  /** arch.spec.md's text, or null — its absence is not a finding. */
  archText: string | null;
  archReqs: Requirement[];
  /** The service's own C4 model, empty when it has none. */
  elements: Elem[];
  relationships: Rel[];
  /** The living landscape, or null when the repo has none. */
  land: LoadedDoc | null;
  /**
   * The enumerated fleet, for the Covers matcher's endpoint resolution — the
   * same set the caller's own spine resolution uses, so a `Covers:` line
   * naming a service matches an edge drawn into that service's container.
   */
  known?: ReadonlySet<string>;
}

export async function archAxisFindings(axis: ArchAxis): Promise<Finding[]> {
  const { service, paths, archText, archReqs, elements, relationships, land, known } = axis;
  const findings: Finding[] = [];

  // The architecture spec axis — the obligations a business spec never carries
  // (the transactional outbox, retries, metrics, alerts). arch.spec.md is
  // optional and its ABSENCE is not a finding (partial adoption is supported);
  // what exists must hold together: every requirement needs a scenario, every
  // `Covers:` entry must resolve (covers.unknown), and every alert/SLI that
  // health.yaml declares wants a covering requirement (health.uncovered) — the
  // moment health.yaml stops being inert. Warnings, never gates: `--strict` is
  // the CI escalation.
  const health = await readHealth(paths.health);

  // A model that reaches nothing is almost never true — but only when
  // something else attests it should reach. A deliberately shallow synthetic
  // fixture can hold elements without relationships beside sources that name
  // dependencies, yet `0 errors, 0 warnings` would still read as done.
  // Evidence-gated on purpose: a bare root-plus-one-container baseline stays
  // silent (nothing PROVES it thin — the standard mid-adoption shape), the
  // warn needs either a second nested element with no edge joining anything,
  // or dependencies declared in this service's own health.yaml. The health
  // half goes quiet when the file is unreadable — no claims on bad data.
  const nested = elements.filter((e) => e.id.includes(".")).length;
  const deps = health.unreadable ? [] : health.dependencies;
  if (elements.length > 0 && relationships.length === 0 && (nested > 1 || deps.length > 0)) {
    const evidence = [
      ...(nested > 1 ? [`${nested} nested elements with no edge joining them`] : []),
      ...(deps.length > 0
        ? [`health.yaml declares ${deps.length} dependenc${deps.length === 1 ? "y" : "ies"} (${deps.join(", ")})`]
        : []),
    ].join(", and ");
    findings.push({
      severity: "warn",
      code: "c4.no-relationships",
      subject: service,
      message:
        `${service}: model.likec4 declares ${elements.length} element(s) and 0 relationships, yet ${evidence} — ` +
        `a model that reaches nothing is almost never true; draw the edges the service actually has ` +
        `(what its containers call, what reads and writes its stores, what it depends on at runtime)`,
    });
  }

  if (archText !== null) {
    // The arch axis is advisory in what it ASKS for (covers.unknown,
    // health.uncovered are warnings) but not in whether the file is readable:
    // both breaches below are about the document itself, and they are graded
    // exactly as they are on the business axis — one file, one rule.
    const conflict = documentConflictFinding(`${service}: arch.spec.md`, service, archText);
    if (conflict !== null) findings.push(conflict);
    findings.push(coverageFinding(`${service}: arch requirements`, archReqs));
    findings.push(...steplessFindings(`${service}: arch requirements`, service, archReqs));
    findings.push(...duplicateRequirementFindings(archReqs, `${service}: arch.spec.md`, service));
    findings.push(...requirementIdFindings(archReqs, `${service}: arch.spec.md`, service));
    findings.push(...repeatedListLineFindings(archReqs, `${service}: arch.spec.md`, service));
  }
  // A health.yaml that exists but does not read is reported once, and the
  // checks that read it go quiet BOTH ways: its ids are unknown, so no
  // health.uncovered obligation exists (the empty id set below is already
  // silent), and no `Covers: alert:/sli:` entry may be graded a typo against
  // ids nobody could read (coversUnknownFindings mutes on the flag). A warn,
  // not an error: the axis it feeds is advisory end to end.
  if (health.unreadable) {
    findings.push({
      severity: "warn",
      code: "health.invalid",
      subject: service,
      message: `${service}: health.yaml does not parse — alert/SLI ids are unreadable, so Covers: alert:/sli: entries and health coverage are unchecked`,
      ...(health.error === undefined ? {} : { details: [health.error] }),
    });
  }
  const landParses = land !== null && land.errors.length === 0 ? land : null;
  const scope: CoverageScope = {
    elements: [...elements, ...(landParses?.elements ?? [])],
    relationships: [...relationships, ...(landParses?.relationships ?? [])],
    health: health.ids,
    known,
  };
  findings.push(
    ...coversUnknownFindings(archReqs, { where: `${service}: arch.spec.md`, subject: service }, scope, health.unreadable),
  );
  const activeCovers = coversEntries(archReqs);
  for (const { form, ids } of [
    { form: "alert" as const, ids: health.ids.alerts },
    { form: "sli" as const, ids: health.ids.slis },
  ]) {
    for (const id of ids) {
      if (activeCovers.some((e) => e.form === form && e.id === id)) continue;
      findings.push({
        severity: "warn",
        code: "health.uncovered",
        subject: service,
        message: `${service}: health.yaml declares ${form === "alert" ? "alert" : "SLI"} '${id}' but no arch.spec.md requirement covers it — write one with 'Covers: ${form}:${id}', or the signal ships with nothing testing it`,
      });
    }
  }
  // The other direction health.yaml is read in: its dependencies must be the
  // model's dependencies. `deps` is already muted on an unreadable file above.
  findings.push(...healthDependencyFindings({ service, dependencies: deps, elements, modelPath: paths.model }));

  return findings;
}

/**
 * Every body-line directive the requirement grammar recognises, as the patterns
 * that recognise them.
 *
 * The REGEXES are the recognition half and they are not a copy: three are the
 * exported constants `core/document/spec.ts` owns, and the rest are the same
 * literals `core/document/parse.ts` matches with. Recognition therefore cannot
 * drift into calling a real directive unknown.
 *
 * The NAMES below are the did-you-mean half, and they are the half that could
 * drift — so `test/spec-unknown-directive.test.ts` asserts that every name here,
 * spelled as a line, is matched by one of the patterns above it. A name that
 * stops being a directive fails that test rather than going on being suggested.
 */
const DIRECTIVE_PATTERNS: readonly RegExp[] = [
  REQUIREMENT_ID_LINE_RE,
  BASED_ON_LINE_RE,
  CAPABILITY_LINE_RE,
  REALIZES_LINE_RE,
  /^\s*Operations?:\s*(.+?)\s*$/i,
  /^\s*Covers?:\s*(.+?)\s*$/i,
  /^\s*Publishes?:\s*(.+?)\s*$/i,
  /^\s*Consumes?:\s*(.+?)\s*$/i,
  /^\s*Requires?:\s*(.+?)\s*$/i,
];

/** The canonical spelling of each directive — what a near miss is measured against. */
export const DIRECTIVE_NAMES: readonly string[] = [
  "Requirement-ID",
  "Based-On",
  "Capabilities",
  "Realizes",
  "Operations",
  "Covers",
  "Publishes",
  "Consumes",
  "Requires",
];

/** A body line that LOOKS like a directive: a short capitalised key, a colon, a value. */
const CANDIDATE_LINE_RE = /^\s*([A-Za-z][A-Za-z-]{2,30}):\s*\S/;

/**
 * Levenshtein distance, capped — a local one rather than `closeIds`, and the
 * difference matters here.
 *
 * `closeIds` accepts a shared three-character prefix, which is right for ids
 * drawn from a known vocabulary the author was aiming at. Applied to arbitrary
 * prose keys it fires on words that merely start alike: `Context:` would be
 * reported as a near miss for `Consumes:`, in a check whose whole value is that
 * it does not cry wolf. Edit distance separates the two cleanly — `Context` is
 * five edits from `Consumes`, `Realises` is one from `Realizes`.
 */
function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(
        prev[j]! + 1,
        row[j - 1]! + 1,
        prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = row;
  }
  return prev[b.length]!;
}

/**
 * `spec.unknown-directive` — a body line whose key is one or two characters
 * away from a directive and is not one.
 *
 * THE ONE PLACE THE CORPUS IS QUIETER THAN IT LOOKS. Every join in the product
 * is an existence check on a parsed value, so a line the parser did not
 * recognise produces no value, no join, and therefore no finding: `Realises:`,
 * `Capabilties:` and `Require:` all read as ordinary prose, and every check
 * downstream stays green because there is nothing to fail. This is the same
 * judgement `obligation.unknown` already makes one axis over — "a mistyped tag
 * reads exactly like a rule" — applied to the keys themselves.
 *
 * A WARNING, not an error, and the threshold is deliberately mean. A body line
 * is free prose and a fleet may legitimately write `Owner:` or `Context:` in
 * one; the check only speaks when the key is within two edits of a directive,
 * which is close enough that a typo is far likelier than a coincidence. It
 * gates nothing.
 */
export function unknownDirectiveFindings(
  reqs: readonly Requirement[],
  target: { where: string; subject: string },
): Finding[] {
  const findings: Finding[] = [];
  for (const r of reqs) {
    if (r.kind === "REMOVED") continue;
    for (const line of r.text) {
      const candidate = CANDIDATE_LINE_RE.exec(line);
      if (candidate === null) continue;
      if (DIRECTIVE_PATTERNS.some((re) => re.test(line))) continue;
      const key = candidate[1]!;
      const near = DIRECTIVE_NAMES.filter(
        (name) => editDistance(key.toLowerCase(), name.toLowerCase()) <= 2,
      );
      if (near.length === 0) continue;
      findings.push({
        severity: "warn",
        code: "spec.unknown-directive",
        subject: target.subject,
        message:
          `${target.where}: requirement '${r.name}' has a line beginning '${key}:', which is not a directive loam reads — ` +
          `did you mean ${near.map((n) => `\`${n}:\``).join(" or ")}? ` +
          "A key loam does not recognise is prose: the join it looks like simply does not exist, and every check over it " +
          "stays green because there is nothing to fail. Correct the spelling, or reword the line so it does not read as a directive",
      });
    }
  }
  return findings;
}
