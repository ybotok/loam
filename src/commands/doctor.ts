import type { Command } from "commander";
import { diagnose } from "../core/doctor/doctor.js";
import { type DoctorReport, type ProblemReportStatus } from "../core/doctor/report.js";
import { REPORTS_DIR } from "../core/doctor/reports/scan.js";
import { emitJson } from "../core/envelope/json.js";

interface DoctorOptions {
  json?: boolean;
}

export function registerDoctor(program: Command): void {
  program
    .command("doctor")
    .description("Diagnose local loam configuration and docs-repo accessibility without writing")
    .option("--json", "emit the machine contract instead of the human view")
    .action(async (opts: DoctorOptions) => {
      const report = await diagnose();
      if (opts.json === true) emitJson({ command: "doctor", ...report });
      else printDoctor(report);
      if (!report.healthy) process.exitCode = 1;
    });
}

function yesNo(value: boolean): string {
  return value ? "yes" : "no";
}

/**
 * The stamp as one readable token. "absent" and "unstamped" are kept apart
 * because they are different repos: the first has no AGENTS.md at all, the
 * second has one nobody has claimed a version for.
 */
function stampLabel(stamp: DoctorReport["agents"]["stamp"]): string {
  if (!stamp.present) return "absent";
  if (stamp.version === null) return "unstamped";
  return `v${stamp.version}${stamp.stale ? " (stale)" : ""}`;
}

/**
 * What a killed writer left in the docs repo, as one line. "clean" is the
 * answer on every healthy repo, and "(unresolved)" keeps it apart from clean:
 * a docsDir that never resolved was never looked at.
 */
function writePathLabel(residue: DoctorReport["writePath"]): string {
  if (residue === null) return "(unresolved)";
  const parts = [
    ...(residue.lock === null ? [] : [`lock held${residue.lock.stale ? " (stale)" : ""}`]),
    ...(residue.intentUnreadable
      ? ["interrupted commit (unreadable)"]
      : residue.intent === null
        ? []
        : [`interrupted ${residue.intent.command} of ${"feature" in residue.intent ? residue.intent.feature : residue.intent.target}`]),
    ...(residue.temps.length === 0 ? [] : [`${residue.temps.length} orphaned temp file(s)`]),
  ];
  return parts.length === 0 ? "clean" : parts.join(" · ");
}

/**
 * The order the statuses are printed in — the lifecycle a report walks, so the
 * row reads left to right the way the corpus drains.
 *
 * A `Record` over the union rather than an array of strings, because that makes
 * tsc the thing that notices a new status: adding one to `ProblemReportStatus`
 * fails to compile here instead of silently never being printed.
 */
const REPORT_STATUS_ORDER: Record<ProblemReportStatus, number> = {
  open: 0,
  sent: 1,
  fixed: 2,
  superseded: 3,
  unstated: 4,
};

/**
 * The report corpus as one line: how many there are, how they split by status,
 * and which ordinal the next one takes.
 *
 * Zero counts are left out — a status nothing is in is not news, and this row
 * is read at a glance — while the total is always there, because "twelve
 * reports" is the fact somebody scanning for the corpus is looking for. An
 * absent or empty directory prints `(none)` rather than a row of zeroes: a
 * repository that has never had to write a report is the normal one.
 */
function reportsLabel(reports: DoctorReport["reports"]): string {
  if (!reports.present || reports.total === 0) return "(none)";
  const counted = new Map<ProblemReportStatus, number>();
  for (const entry of reports.entries) {
    counted.set(entry.status, (counted.get(entry.status) ?? 0) + 1);
  }
  const split = [...counted]
    .sort(([a], [b]) => REPORT_STATUS_ORDER[a] - REPORT_STATUS_ORDER[b])
    .map(([status, count]) => `${status} ${count}`);
  // The directory's NAME, not `reports.dir`: the payload spells the absolute
  // path so an agent can act on it, while the row is read by a person standing
  // in the repository, for whom the absolute spelling is only longer.
  return [`${REPORTS_DIR}/ ${reports.total}`, ...split, `next ${reports.next}`].join(" · ");
}

function printDoctor(report: DoctorReport): void {
  console.log(`loam doctor — ${report.healthy ? "healthy" : "blocked"}`);
  console.log(`  runtime       ${report.runtime.package}@${report.runtime.version}`);
  console.log(`  node          ${report.runtime.node} ${report.runtime.platform}/${report.runtime.arch}`);
  console.log(`  config        ${report.config.status}  ${report.config.path}`);
  if (report.config.error !== null) console.log(`                ${report.config.error}`);
  console.log(`  docsDir       ${report.docs.path ?? "(unresolved)"}`);
  console.log(
    `  access        exists ${yesNo(report.docs.exists)} · read ${yesNo(report.docs.readable)} · write ${yesNo(report.docs.writable)}`,
  );
  console.log(
    `  fleet         services/ ${yesNo(report.docs.servicesDir)} · landscape ${yesNo(report.docs.landscape)} · ${report.counts.services} services · ${report.counts.activeFeatures} active features`,
  );
  console.log(
    `  binding       ${report.currentService.configured ?? "(none)"} · ${report.currentService.status}`,
  );
  // The agent surface is reported whether or not it has drifted — like every
  // line above it, this is state, not a complaint. Only the findings block is
  // silent when there is nothing to say.
  const agents = report.agents;
  console.log(
    `  agents        ${agents.tools.length === 0 ? "(none)" : agents.tools.join(", ")} · ${agents.profile}`
    + ` (${agents.toolsSource}) · ${agents.plannedFiles} files · ${agents.missingFiles.length} missing`
    + ` · ${agents.staleFiles.length} stale · AGENTS.md ${stampLabel(agents.stamp)}`,
  );
  // The problem reports, for the same reason and with a stronger one behind it:
  // the `loam-report` protocol asks a repository to accumulate this corpus, and
  // until now no loam command mentioned the directory at all. Printed as state,
  // never as a finding — an open report is not a defect in the repo holding it.
  console.log(`  reports       ${reportsLabel(report.reports)}`);
  // The write path is state too, and its clean answer is the one worth printing
  // most often: a reader who has just been told the docs are half-written needs
  // to see it go away.
  console.log(`  write path    ${writePathLabel(report.writePath)}`);
  if (report.findings.length > 0) {
    console.log("\n  findings");
    for (const finding of report.findings) {
      console.log(`    ${finding.severity === "blocker" ? "✗" : "⚠"} ${finding.code}: ${finding.message}`);
      // The fix is printed on its own indented line rather than appended to the
      // message: what is wrong and what to type are two different sentences,
      // and someone scanning a blocked repo reads down the `fix:` column.
      console.log(`      fix: ${finding.fix}`);
    }
  }
}
