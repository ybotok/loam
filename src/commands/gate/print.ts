/**
 * The human rendering of a gate report: one block per check, the partner and
 * feature tables as data lines, findings with the shared severity glyphs, and
 * the verdict last — the line a person scanning a deploy log reads first from
 * the bottom. The JSON contract never comes through here; `gate.ts` emits the
 * envelope from the same report, which is what keeps the two views one
 * derivation.
 */
import { SEVERITY_MARK, type Finding } from "../../core/vocabulary/report.js";
import type { GateReport, GateVerdict } from "../../core/gate/report.js";
import { plural } from "../policy/format.js";

function printFindings(findings: Finding[]): void {
  for (const f of findings) {
    console.log(`  ${SEVERITY_MARK[f.severity]} ${f.message}`);
    for (const d of f.details ?? []) console.log(`    - ${d}`);
  }
}

export function printGate(
  report: GateReport,
  verdict: GateVerdict,
  summary: { errors: number; warnings: number },
): void {
  console.log(`gate — ${report.service} (a query over recorded evidence; it executes nothing)`);

  const check = (name: (typeof report.checks)[number]["check"]): Finding[] =>
    report.checks.find((c) => c.check === name)?.findings ?? [];

  console.log(`\npartners — landscape ${report.landscape}`);
  for (const p of report.partners) {
    const rung = p.external ? "external" : (p.maturity ?? "no services/ directory");
    console.log(`  ${p.service} · ${rung} · ${p.role} · ${p.via.join(", ")}`);
  }
  if (report.partners.length === 0 && report.landscape === "read") {
    console.log("  (the landscape draws no join into or out of this service)");
  }
  printFindings(check("partners"));

  console.log("\nfreshness");
  const freshness = check("freshness");
  if (freshness.length === 0) console.log(`  ${SEVERITY_MARK.ok} nothing recorded has gone stale`);
  printFindings(freshness);

  console.log("\nverification");
  for (const f of report.features) {
    const attested = f.attested > 0 ? `, ${f.attested} on an agent's word` : "";
    console.log(`  ${f.id} · ${f.verdict} (${f.state}; ${f.confirmed}/${f.claims} confirmed${attested})`);
  }
  if (report.features.length === 0) {
    console.log("  (no active feature carries a delta for this service)");
  }
  printFindings(check("verification"));

  console.log("\ninterrupted");
  const interrupted = check("interrupted");
  if (interrupted.length === 0) console.log(`  ${SEVERITY_MARK.ok} no interrupted commit in the docs repo`);
  printFindings(interrupted);

  console.log(
    `\nverdict: ${verdict} — ${plural(summary.errors, "error")}, ${plural(summary.warnings, "warning")}` +
      (verdict === "pass" && summary.warnings > 0
        ? " (advisory — `--strict` turns warnings into exit 1)"
        : ""),
  );
}
