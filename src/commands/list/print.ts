/**
 * The columns a person reads, and the worklist under them.
 *
 * The worklist is the point of the command rather than a summary: a fleet list
 * that only listed would leave the reader to work out which services are
 * behind, which is the question they opened it with.
 */
import { MATURITY_LADDER, maturityRollup } from "../../core/vocabulary/maturity.js";
import { type CapabilityRow } from "../../core/capabilities/rollup.js";
import { compareIds, type FeatureEntry } from "../../core/repo/entries.js";
import type { FleetTree } from "../../core/repo/tree/walk.js";
import type { OwnedRow, OwnersJoin } from "./campaign/owners.js";
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

/**
 * The rung as a person reads it. `vouched (sampled)` is a DISPLAY string, not
 * a rung: the ladder, the rollup below and `--needs-work` all still see
 * `vouched`, because that string is a published contract and the document
 * really is stamped by a person. What the suffix says is what the stamp says
 * — they read a recorded sample of it, and `loam validate` will report
 * `sources.sampled-vouch` until somebody reads the rest. Without it, the one
 * line a fleet lead scans for trust would show a sampled vouch and a full one
 * as the same word.
 *
 * Only on `vouched`: a lower rung already says less than "a person vouched",
 * and hanging a scope note on it would explain a claim nothing is making.
 */
function rungLabel(v: ServiceView): string {
  return v.maturity === "vouched" && v.entry.vouchScope === "sampled" ? "vouched (sampled)" : v.maturity;
}

/**
 * The two facts printed under the table that are not about any row — and they
 * are withheld differently, which is the whole reason to name the record
 * instead of passing two arguments and hoping the next caller notices.
 */
export interface FleetFacts {
  /**
   * The subsystem tree, or undefined under `--subsystem`. A slice's own
   * "unfiled: 0" would be read as a fact about the slice, and it is not one.
   */
  tree: FleetTree | undefined;
  /**
   * Markdown files in `architecture/adrs/`. NEVER withheld: unlike the tree
   * dial it is not derived from the rows at all — the same fleet documents are
   * there whichever services this run listed — and the line names the directory
   * so it cannot be misread as a subsystem's own decisions. 0 prints nothing.
   */
  adrs: number;
}

export function printServices(views: ServiceView[], fleet: FleetFacts): void {
  console.log(
    `services (${views.length})  [M]odel [S]pec [a]rch-spec [A]pi [R]unbook [H]ealth`,
  );
  const width = Math.max(0, ...views.map((v) => v.entry.id.length));
  // Measured over the DISPLAY strings, so the column does not shear the first
  // time a sampled row appears in a fleet.
  const rungWidth = Math.max(0, ...views.map((v) => rungLabel(v).length));
  for (const v of views) {
    const s = v.entry;
    const adrs = s.adrs > 0 ? `  (${s.adrs} adr${s.adrs === 1 ? "" : "s"})` : "";
    // The rung per service, not only in the rollup: "12 partial" tells a reader
    // the fleet is unfinished and nothing about which twelve, which is the one
    // question the line is read to answer.
    console.log(
      `  ${serviceFlags(v)}  ${s.id.padEnd(width)}  ${rungLabel(v).padEnd(rungWidth)}${adrs}`.trimEnd(),
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
    // The rollup itself is untouched — the rung IS `vouched`, and both the
    // `--json` payload and `--needs-work` are computed from it. What the TEXT
    // line adds is the qualifier the per-row suffix already carries, because
    // this is the line a fleet lead reads for the trust answer, and recovering
    // "how many of those 118 did anybody read in full" by scanning 118 rows is
    // not an answer. Same layout as the validate scorecard's provenance row.
    const sampled = views.filter((v) => v.maturity === "vouched" && v.entry.vouchScope === "sampled").length;
    const rungs = MATURITY_LADDER.filter((m) => rollup[m] > 0).map(
      (m) => `${rollup[m]} ${m}${m === "vouched" && sampled > 0 ? ` (${sampled} sampled)` : ""}`,
    );
    console.log(`  maturity: ${rungs.join(" · ")}`);
    // The tree dial, only once a tree exists: unfiled is permanent and normal
    // (a count, never a finding), and a flat fleet has nothing to say here —
    // printing "5 unfiled" over a fleet nobody groups would read as work.
    if (fleet.tree !== undefined && fleet.tree.subsystems.length > 0) {
      const unfiled = fleet.tree.services.filter((s) => s.subsystem.length === 0).length;
      console.log(`  subsystems: ${fleet.tree.subsystems.length} · unfiled: ${unfiled}`);
    }
  }
  // OUTSIDE the rollup block above, which only runs when the fleet has
  // services: a fleet can record a decision about how it will build services
  // before it holds one, and that count would otherwise be printed by nothing.
  // Silent at zero, exactly like the per-service `(3 adrs)` column: no fleet
  // owes any fleet-level ADR, so "adrs: 0" would read as a gap.
  if (fleet.adrs > 0) {
    console.log(`  adrs: ${fleet.adrs} fleet decision${fleet.adrs === 1 ? "" : "s"}  (architecture/adrs/)`);
  }
}

/**
 * The one-shot adoption worklist. Onboarding ten legacy services means asking
 * "what is left" once a day for a month, and the answer used to require reading
 * a presence table and a rollup and joining them by eye. A service whose
 * provenance cannot be judged from here is LISTED, tagged, never dropped:
 * omitting it would read as done.
 */
export function printWorklist(
  views: ServiceView[],
  total: number,
  fanIn?: ReadonlyMap<string, number>,
): void {
  if (views.length === 0) {
    console.log(`nothing to do — all ${total} service(s) are vouched`);
    return;
  }
  // Under --review-order the caller hands the rows pre-sorted; the header
  // names the derivation as a caller count, never a priority judgement — the
  // number is who depends on the service, not how important it is.
  const ordered = fanIn === undefined ? "" : " — review order (fan-in: services depending on each)";
  console.log(`${views.length} of ${total} service(s) need work${ordered}`);
  const width = Math.max(0, ...views.map((v) => v.entry.id.length));
  const rungWidth = Math.max(0, ...views.map((v) => rungLabel(v).length));
  const cells = fanIn === undefined ? undefined : views.map((v) => `fan-in: ${fanIn.get(v.entry.id) ?? 0}`);
  const cellWidth = cells === undefined ? 0 : Math.max(0, ...cells.map((c) => c.length));
  for (const [i, v] of views.entries()) {
    const note = v.unverifiableFromHere ? "  (provenance: unverifiable-from-here)" : "";
    // Indexing the same array the loop walks, like printFeatures' cells below.
    const cell = cells === undefined ? "" : `  ${cells[i]!.padEnd(cellWidth)}`;
    console.log(
      `  ${v.entry.id.padEnd(width)}  ${rungLabel(v).padEnd(rungWidth)}${cell}  missing: ${v.missing.join(", ")}${note}`,
    );
  }
}

/**
 * The owner-grouped view under `--owners`: every row of the current listing
 * filed under the team CODEOWNERS names for its directory, unowned last —
 * the per-team campaign queues, each in the exact order the ungrouped
 * listing would print. Text side only; the ids-per-team contract is
 * json.ts's `ownersJson`.
 */
export function printOwners(
  join: OwnersJoin,
  byDir: ReadonlyMap<string, ServiceView>,
  fanIn?: ReadonlyMap<string, number>,
): void {
  const row = (r: OwnedRow): void => {
    // Joined back by DIRECTORY, the row's identity — ids can collide across
    // a broken tree, and an id-keyed map would print one twin's cells under
    // the other twin's team. The join was computed from these same rows so a
    // miss is unreachable, but it is a key join on purpose (docs/CODE-STYLE.md:
    // never join two arrays by position) — and a miss prints the bare id
    // LOUDLY rather than vanishing, so a future row-set drift shows itself.
    const v = byDir.get(r.repoDir);
    if (v === undefined) {
      console.log(`    ${r.id}`);
      return;
    }
    const cell = fanIn === undefined ? "" : `  fan-in: ${fanIn.get(r.id) ?? 0}`;
    const missing = v.missing.length > 0 ? `  missing: ${v.missing.join(", ")}` : "";
    console.log(`    ${r.id}  ${rungLabel(v)}${cell}${missing}`);
  };
  for (const team of join.teams) {
    console.log(`  ${team.owner} (${team.services.length})`);
    for (const r of team.services) row(r);
  }
  // Explicit even in a heading: an unmatched service silently absent from
  // every team's queue would read as somebody else's work.
  if (join.unowned.length > 0) {
    console.log(`  unowned (${join.unowned.length})`);
    for (const r of join.unowned) row(r);
  }
  if (join.skipped.length > 0) {
    // Line AND pattern: `* @org/all` is the most common CODEOWNERS opener,
    // and a note naming only "line 1" would leave the reader unable to tell
    // the fleet-wide default was skipped rather than some docs rule.
    console.log(
      `  note: ${join.skipped.length} rule(s) outside the supported CODEOWNERS subset skipped: ${join.skipped
        .map((rule) => `line ${rule.line} (${rule.pattern})`)
        .join(", ")}`,
    );
  }
}

/**
 * The capability table: what the fleet promises, and how much of each promise
 * anything claims to implement. The `0 — unrealized` marker is the row's whole
 * point — a declared capability nothing realizes is the drift this section
 * exists to make visible — and the draft/verified split says how much of a
 * realized one rests on vouched documents rather than drafts.
 */
export function printCapabilities(rows: CapabilityRow[]): void {
  console.log(`capabilities (${rows.length})`);
  if (rows.length === 0) return;
  const width = Math.max(0, ...rows.map((row) => row.id.length));
  for (const row of rows) {
    const count = row.realizedBy.length;
    const cells =
      count === 0
        ? ["0 — unrealized"]
        : [
            `${count} requirement${count === 1 ? "" : "s"}`,
            row.services.join(", "),
            Object.entries(row.statuses)
              .map(([status, n]) => `${n} ${status}`)
              .join(" · "),
          ];
    const owner = row.owner === undefined ? "" : `  (owner: ${row.owner})`;
    console.log(`  ${row.id.padEnd(width)}  ${cells.join("  ·  ")}${owner}`);
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
