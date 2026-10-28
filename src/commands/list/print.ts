/**
 * The columns a person reads, and the worklist under them.
 *
 * The worklist is the point of the command rather than a summary: a fleet list
 * that only listed would leave the reader to work out which services are
 * behind, which is the question they opened it with.
 */
import { MATURITY_LADDER, maturityRollup } from "../../core/vocabulary/maturity.js";
import { compareIds } from "../../core/repo/entries.js";
import { answeredSplit } from "../../core/verify/record.js";
import type { FleetTree } from "../../core/repo/tree/walk.js";
import { archivedVerification } from "../../core/status/feature/words.js";
import type { ArchivedFeatureState } from "../../core/status/fleet/report.js";
import type { OwnedRow, OwnersJoin } from "./campaign/owners.js";
import { type FeatureRow, type ServiceView, type VerificationCell } from "./views.js";

/**
 * Fixed-width presence flags. `a` and `A` are deliberately the same letter in
 * two cases: the arch spec and the API are the two things a reader most often
 * mistakes for each other, and one is lowercase because it is optional.
 */
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
 *
 * `vouched (stale)` is the same kind of string for the other thing a stamp can
 * hide: the document's words moved after the person read them, and `loam
 * validate` reports `content.stale` until somebody re-vouches. Both can hold at
 * once — `vouched (sampled, stale)` — because they are different gaps.
 */
function rungLabel(v: ServiceView): string {
  const qualifiers = vouchQualifiers(v);
  return qualifiers.length === 0 ? v.maturity : `${v.maturity} (${qualifiers.join(", ")})`;
}

/** What a `vouched` row's stamp does not cover: a sample, and words moved since. Empty below the rung. */
function vouchQualifiers(v: ServiceView): string[] {
  if (v.maturity !== "vouched") return [];
  return [
    ...(v.entry.vouchScope === "sampled" ? ["sampled"] : []),
    ...(v.entry.contentStale.length > 0 ? ["stale"] : []),
  ];
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
    // One key per column serviceFlags prints, in its order — the `e` column
    // shipped without one, so the legend explained six of seven.
    `services (${views.length})  [M]odel [S]pec [a]rch-spec [A]pi [e]vents [R]unbook [H]ealth`,
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
    // not an answer. Same layout as the validate scorecard's provenance row,
    // and the same two qualifiers the per-row suffix carries, each counted.
    const qualified = (q: string): number => views.filter((v) => vouchQualifiers(v).includes(q)).length;
    const notes = ["sampled", "stale"].filter((q) => qualified(q) > 0).map((q) => `${qualified(q)} ${q}`);
    const rungs = MATURITY_LADDER.filter((m) => rollup[m] > 0).map(
      (m) => `${rollup[m]} ${m}${m === "vouched" && notes.length > 0 ? ` (${notes.join(", ")})` : ""}`,
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
 *
 * `archived` is the work the worklist is NOT about and must not deny: archived
 * features whose done-check is still open (`FleetStatusReport.unverifiedArchived`).
 * The rows stay services — `--needs-work` is the adoption worklist — but the
 * footer said "nothing to do" over a feature archived with six of seven claims
 * unconfirmed (QUICKSTART walk, 2026-10-28), so they are named after the rows and
 * the empty case says what is left instead.
 */
export function printWorklist(
  views: ServiceView[],
  total: number,
  extra: { fanIn?: ReadonlyMap<string, number> | undefined; archived?: readonly ArchivedFeatureState[] } = {},
): void {
  const { fanIn, archived = [] } = extra;
  if (views.length === 0) {
    console.log(
      archived.length === 0
        ? `nothing to do — all ${total} service(s) are vouched`
        : `no service needs work — all ${total} service(s) are vouched — but ${archived.length} archived feature(s) are not verified:`,
    );
    printOpenArchived(archived);
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
  if (archived.length > 0) console.log(`and ${archived.length} archived feature(s) are not verified:`);
  printOpenArchived(archived);
}

/** One line per archived feature with an open done-check, in the verdict words `loam status <FEAT>` uses. */
function printOpenArchived(archived: readonly ArchivedFeatureState[]): void {
  if (archived.length === 0) return;
  const width = Math.max(0, ...archived.map((f) => f.id.length));
  for (const f of archived) console.log(`  ${f.id.padEnd(width)}  ${archivedVerification(f.verification)}`);
  console.log("  `loam status` lists them, and `loam status <FEAT>` says what each record holds.");
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

/** Narrow verification cell: confirmed/claims when a record answers, one word when it does not. */
function verificationMark(v: VerificationCell | null): string {
  if (v === null) return "-";
  if (v.state === "stale") return "stale";
  // `11/11` and `11/11 attested` are different facts — the first is a
  // digest-matched green run, the second is somebody's word about one. Without
  // the suffix a complete count is the same glyph either way, which is exactly
  // the reading `verify`, `status` and the JSON envelope stopped giving.
  //
  // And who answered the confirmed ones, beside it. The verdict turns on the
  // scenario claims alone, so `7/7` under a verified record still read as seven
  // runs where two were an agent's word about a permission or an edge — the
  // split `--json` carried in `answered` and this column did not.
  const split = v.confirmed > 0 ? ` (${answeredSplit(v.answered)})` : "";
  return `${v.confirmed}/${v.claims}${v.verdict === "attested" ? " attested" : ""}${split}`;
}

/** How wide the title column may grow before a title is cut with an ellipsis. */
const TITLE_WIDTH = 40;

export function printFeatures(rows: FeatureRow[]): void {
  const features = rows.map((r) => r.feature);
  const active = features.filter((f) => !f.archived).length;
  const archived = features.length - active;
  const counts = `${active} active${archived > 0 ? `, ${archived} archived` : ""}`;
  // Not `verified`: the column reports three verdicts and only one of them is
  // that one. A heading that names the strong verdict makes every other cell
  // read as it.
  console.log(`features (${counts})  [I]ntent [D]elta  verification`);
  const width = Math.max(0, ...features.map((f) => f.id.length));
  // The title beside the id: an id is a key, and a table of keys told a
  // newcomer which rows existed but not which change any of them was.
  const titles = rows.map((r) => {
    const t = r.title ?? "";
    return t.length > TITLE_WIDTH ? `${t.slice(0, TITLE_WIDTH - 1)}…` : t;
  });
  const titleWidth = Math.max(0, ...titles.map((t) => t.length));
  const cells = rows.map((r) => verificationMark(r.cell));
  const cellWidth = Math.max(0, ...cells.map((c) => c.length));
  for (const [i, f] of features.entries()) {
    const flags = `${f.has.intent ? "I" : "-"} ${f.has.delta ? "D" : "-"}`;
    const svcs = f.services.length > 0 ? f.services.join(", ") : "—";
    const tag = f.archived ? "  (archived)" : "";
    const title = titleWidth === 0 ? "" : `${titles[i]!.padEnd(titleWidth)}  `;
    console.log(`  ${flags}  ${f.id.padEnd(width)}  ${title}${cells[i]!.padEnd(cellWidth)}  ${svcs}${tag}`);
  }
}

/**
 * The glossary table: what the domain's words are, and who actually uses each.
 *
 * The citation count is the column that matters — a definition nothing cites is
 * the drift `glossary.unlinked` warns about, and this is where a reader sees it
 * before the gate does. `unreadable` is printed as a note rather than folded
 * into the counts for `printCapabilities`' reason (`./capabilities/`): "cited by
 * nobody" and "loam could not read everybody" are different answers, and a
 * table that let them look alike would be the more comfortable of the two.
 */
export function printGlossary(
  rows: Array<{ id: string; linkedBy: string[] }>,
  unreadable: string[],
): void {
  console.log(`glossary (${rows.length} term${rows.length === 1 ? "" : "s"})`);
  const width = Math.max(0, ...rows.map((row) => row.id.length));
  for (const row of rows) {
    const n = row.linkedBy.length;
    console.log(`  ${row.id.padEnd(width)}  ${n === 0 ? "cited by nothing" : `${n} document${n === 1 ? "" : "s"}`}`);
  }
  if (unreadable.length > 0) {
    console.log(
      `  note: ${unreadable.length} document(s) could not be read, so a citation from one of them is not counted here — ` +
        `\`loam validate --all\` names each as link.unreadable`,
    );
  }
}
