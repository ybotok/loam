/**
 * The columns a person reads, and the worklist under them.
 *
 * The worklist is the point of the command rather than a summary: a fleet list
 * that only listed would leave the reader to work out which services are
 * behind, which is the question they opened it with.
 */
import { MATURITY_LADDER, maturityRollup } from "../../core/vocabulary/maturity.js";
import { compareIds, type FeatureEntry } from "../../core/repo/entries.js";
import type { FleetTree } from "../../core/repo/tree/walk.js";
import { type ServiceView, type VerificationCell } from "./views.js";

function serviceFlags(v: ServiceView): string {
  const s = v.entry;
  return [
    s.has.model ? "M" : "-",
    s.has.spec ? "S" : "-",
    v.archSpec ? "a" : "-",
    s.has.openapi ? "A" : "-",
    // The async contract, lowercase like the arch spec and for the same reason:
    // it is optional. A fleet where most services own no topic must not read as
    // a fleet with a column of gaps in it.
    s.has.asyncapi ? "e" : "-",
    s.has.runbook ? "R" : "-",
    s.has.health ? "H" : "-",
  ].join(" ");
}

export function printServices(views: ServiceView[], tree?: FleetTree): void {
  console.log(
    `services (${views.length})  [M]odel [S]pec [a]rch-spec [A]pi [R]unbook [H]ealth`,
  );
  const width = Math.max(0, ...views.map((v) => v.entry.id.length));
  const rungWidth = Math.max(0, ...views.map((v) => v.maturity.length));
  for (const v of views) {
    const s = v.entry;
    const adrs = s.adrs > 0 ? `  (${s.adrs} adr${s.adrs === 1 ? "" : "s"})` : "";
    // The rung per service, not only in the rollup: "12 partial" tells a reader
    // the fleet is unfinished and nothing about which twelve, which is the one
    // question the line is read to answer.
    console.log(
      `  ${serviceFlags(v)}  ${s.id.padEnd(width)}  ${v.maturity.padEnd(rungWidth)}${adrs}`.trimEnd(),
    );
  }
  // How much of the fleet anyone has actually vouched for. On 100+ services this
  // is the number that says whether the docs can be trusted at all.
  if (views.length > 0) {
    const counted = new Map<string, number>();
    for (const v of views) {
      const key = v.entry.status ?? "unmarked";
      counted.set(key, (counted.get(key) ?? 0) + 1);
    }
    const parts = [...counted.entries()]
      .sort((a, b) => compareIds(a[0], b[0]))
      .map(([status, n]) => `${n} ${status}`);
    console.log(`  status: ${parts.join(" · ")}`);
    // The campaign dial next to the trust dial: rungs in ladder order, so the
    // line reads as progress left to right. Presence and provenance state only
    // — completeness is unchecked, so this line never says "adopted".
    const rollup = maturityRollup(views);
    const rungs = MATURITY_LADDER.filter((m) => rollup[m] > 0).map((m) => `${rollup[m]} ${m}`);
    console.log(`  maturity: ${rungs.join(" · ")}`);
    // The tree dial, only once a tree exists: unfiled is permanent and normal
    // (a count, never a finding), and a flat fleet has nothing to say here —
    // printing "5 unfiled" over a fleet nobody groups would read as work.
    if (tree !== undefined && tree.subsystems.length > 0) {
      const unfiled = tree.services.filter((s) => s.subsystem.length === 0).length;
      console.log(`  subsystems: ${tree.subsystems.length} · unfiled: ${unfiled}`);
    }
  }
}

/**
 * The one-shot adoption worklist. Onboarding ten legacy services means asking
 * "what is left" once a day for a month, and the answer used to require reading
 * a presence table and a rollup and joining them by eye. A service whose
 * provenance cannot be judged from here is LISTED, tagged, never dropped:
 * omitting it would read as done.
 */
export function printWorklist(views: ServiceView[], total: number): void {
  if (views.length === 0) {
    console.log(`nothing to do — all ${total} service(s) are vouched`);
    return;
  }
  console.log(`${views.length} of ${total} service(s) need work`);
  const width = Math.max(0, ...views.map((v) => v.entry.id.length));
  const rungWidth = Math.max(0, ...views.map((v) => v.maturity.length));
  for (const v of views) {
    const note = v.unverifiableFromHere ? "  (provenance: unverifiable-from-here)" : "";
    console.log(
      `  ${v.entry.id.padEnd(width)}  ${v.maturity.padEnd(rungWidth)}  missing: ${v.missing.join(", ")}${note}`,
    );
  }
}

/** Narrow verification cell: confirmed/claims when a record answers, one word when it does not. */
function verificationMark(v: VerificationCell | null): string {
  if (v === null) return "-";
  if (v.state === "stale") return "stale";
  // `11/11` and `11/11 attested` are different facts — the first is a
  // digest-matched green run, the second is somebody's word about one. Without
  // the suffix a complete count is the same glyph either way, which is exactly
  // the reading `verify`, `status` and the JSON envelope stopped giving.
  return `${v.confirmed}/${v.claims}${v.verdict === "attested" ? " attested" : ""}`;
}

export function printFeatures(features: FeatureEntry[], verification: (VerificationCell | null)[]): void {
  const active = features.filter((f) => !f.archived).length;
  const archived = features.length - active;
  const counts = `${active} active${archived > 0 ? `, ${archived} archived` : ""}`;
  // Not `verified`: the column reports three verdicts and only one of them is
  // that one. A heading that names the strong verdict makes every other cell
  // read as it.
  console.log(`features (${counts})  [I]ntent [D]elta  verification`);
  const width = Math.max(0, ...features.map((f) => f.id.length));
  const cells = verification.map(verificationMark);
  const cellWidth = Math.max(0, ...cells.map((c) => c.length));
  for (const [i, f] of features.entries()) {
    const flags = `${f.has.intent ? "I" : "-"} ${f.has.delta ? "D" : "-"}`;
    const svcs = f.services.length > 0 ? f.services.join(", ") : "—";
    const tag = f.archived ? "  (archived)" : "";
    console.log(`  ${flags}  ${f.id.padEnd(width)}  ${cells[i]!.padEnd(cellWidth)}  ${svcs}${tag}`);
  }
}
