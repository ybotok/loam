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

/**
 * A feature row's count clause. A feature with no record, or one that cannot
 * be read, has no claims to count — "0/0 confirmed" read as a record that
 * answered nothing, when no record was there to ask.
 */
function countClause(f: GateReport["features"][number]): string {
  if (f.state === "absent") return "no verification record";
  if (f.state === "unreadable") return "verification record unreadable";
  const attested = f.attested > 0 ? `, ${f.attested} on an agent's word` : "";
  return `${f.state}; ${f.confirmed}/${f.claims} confirmed${attested}`;
}

/**
 * The tail of the verdict line. `--strict` never moves the verdict (gate.ts),
 * so a passing run with warnings exits 1 under it — and a deploy log that
 * ends "verdict: pass" on a red step reads as a broken gate. The line says
 * which of the two this run is.
 */
function verdictTail(verdict: GateVerdict, warnings: number, strict: boolean): string {
  if (verdict !== "pass" || warnings === 0) return "";
  return strict
    ? " — exit 1: `--strict` fails on warnings"
    : " (advisory — `--strict` turns warnings into exit 1)";
}

export function printGate(
  report: GateReport,
  verdict: GateVerdict,
  summary: { errors: number; warnings: number },
  strict: boolean,
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

  // Under --since the heading names the bound, so a deploy log says which
  // shipped features it graded; without it, that only in-flight ones were.
  const since = report.since;
  console.log(since === null ? "\nverification" : `\nverification — in flight, and archived since ${since.ref}`);
  for (const f of report.features) {
    const shipped = f.archived === true ? " · archived" : "";
    // A record made over uncommitted changes names a commit that need not hold
    // the tested code — the deploy log says so on the row, not only in verify.
    const dirty = f.uncommitted === undefined ? "" : ` + uncommitted changes (${f.uncommitted.join(", ")})`;
    console.log(`  ${f.id} · ${f.verdict}${dirty} (${countClause(f)})${shipped}`);
    // A record read as frozen history because its archive captured no
    // checklist (`checklistAtArchive: null`) was not held to the feature that
    // shipped; a deploy log must not read that row as one that was.
    if (f.archived === true && f.checklistAtArchive === null && f.state === "recorded") {
      console.log(
        "    its archive captured no checklist (archived by an older loam), so whether the record still answered the feature when it shipped is unknown — read as frozen history",
      );
    }
  }
  if (report.features.length === 0) {
    console.log(
      since === null
        ? "  (no active feature carries a delta for this service)"
        : `  (no feature in flight or archived since ${since.ref} carries a delta for this service)`,
    );
  }
  printFindings(check("verification"));

  console.log("\ninterrupted");
  const interrupted = check("interrupted");
  if (interrupted.length === 0) console.log(`  ${SEVERITY_MARK.ok} no interrupted commit in the docs repo`);
  printFindings(interrupted);

  console.log(
    `\nverdict: ${verdict} — ${plural(summary.errors, "error")}, ${plural(summary.warnings, "warning")}` +
      verdictTail(verdict, summary.warnings, strict),
  );
}
