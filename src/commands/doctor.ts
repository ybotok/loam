import type { Command } from "commander";
import { diagnose, type DoctorReport } from "../core/doctor.js";
import { emitJson } from "../core/json.js";

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
    `  agents        ${agents.tools.length === 0 ? "(none)" : agents.tools.join(", ")}`
    + ` (${agents.toolsSource}) · ${agents.plannedFiles} files · ${agents.missingFiles.length} missing`
    + ` · AGENTS.md ${stampLabel(agents.stamp)}`,
  );
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
