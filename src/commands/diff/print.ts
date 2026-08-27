/**
 * Human rendering for `loam diff` — per-service blocks with the shared
 * severity glyphs, victims as detail lines, one summary line. The JSON side
 * lives in `diff.ts` beside the envelope; this module owns only the text.
 */
import { SEVERITY_MARK } from "../../core/vocabulary/report.js";
import type { FleetDiff, ServiceDiff } from "../../core/diff/semantic.js";

function printService(s: ServiceDiff): void {
  console.log(`\n${s.id} — ${s.change}`);
  if (s.ambiguous !== undefined) {
    console.log(
      `  ⚠ service identity ambiguous — claimed by ${s.ambiguous.join(" and ")}; ` +
        `findings for this service are suspended, not empty`,
    );
  }
  for (const u of s.unreadable) {
    // Suspension is not silence: the reader must see that this axis was not
    // graded, or an unreadable file reads as "nothing changed here".
    console.log(`  ⚠ ${u.side}: ${u.path} could not be read — ${u.error}; findings on this axis are suspended, not empty`);
  }
  for (const f of s.findings) {
    console.log(`  ${SEVERITY_MARK[f.severity]} ${f.code}: ${f.message}`);
    for (const d of f.details ?? []) console.log(`    - ${d}`);
  }
}

export function printDiff(diff: FleetDiff, base: { ref: string; commit: string }): void {
  console.log(`diff vs ${base.ref} (${base.commit.slice(0, 12)})`);
  const changed = diff.services.filter((s) => s.change !== "unchanged");
  if (changed.length === 0) {
    console.log("  no fleet-meaningful changes");
    return;
  }
  for (const s of changed) printService(s);
  const sum = diff.summary;
  console.log(
    `\n${sum.added} added · ${sum.removed} removed · ${sum.modified} modified · ${sum.deprecated} deprecated` +
      (sum.unreadable > 0 ? ` · ${sum.unreadable} unreadable` : "") +
      (diff.breaking ? " · BREAKING" : ""),
  );
}
