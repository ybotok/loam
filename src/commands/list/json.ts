/**
 * The `--json` rows. Separate from `./print.ts` because only this side is a
 * contract: the payload keys are frozen, the columns beside them are not.
 */
import { repoPath } from "../../core/envelope/json.js";
import { type CapabilityRow } from "../../core/capabilities/rollup.js";
import { type FeatureEntry } from "../../core/repo/entries.js";
import { servicesUnder } from "../../core/repo/tree/find.js";
import type { FleetTree } from "../../core/repo/tree/walk.js";
import type { OwnersJoin } from "./campaign/owners.js";
import { type ServiceView, type VerificationCell } from "./views.js";

/**
 * The `services[]` rows: ranked and decorated under `--review-order`, plain
 * otherwise — as a VARIANT, so a call carrying both a plain list and a ranked
 * queue is unrepresentable rather than resolved by precedence. `fanIn`/
 * `reviewRank` are ADDITIVE and appear ONLY under the flag — bare
 * `loam list --json` and `--needs-work --json` stay byte-identical and
 * cost-identical, the frozen-default doctrine the explicit-only capabilities
 * section also follows. The spread keeps serviceJson at its two-param
 * contract; `reviewRank` is 1-based and equals the row's position, so the
 * array order IS the queue.
 */
export function serviceRows(
  docsDir: string,
  rows: ServiceView[] | { queue: ServiceView[]; fanIn: ReadonlyMap<string, number> },
): Record<string, unknown>[] {
  if (Array.isArray(rows)) return rows.map((v) => serviceJson(docsDir, v));
  return rows.queue.map((v, i) => ({
    ...serviceJson(docsDir, v),
    fanIn: rows.fanIn.get(v.entry.id) ?? 0,
    reviewRank: i + 1,
  }));
}

export function serviceJson(docsDir: string, v: ServiceView): Record<string, unknown> {
  const s = v.entry;
  return {
    id: s.id,
    path: repoPath(docsDir, s.dir),
    // Names from services/ down, outermost first; [] = unfiled. `path` above
    // already truthfully reflects placement — this is the same fact as data
    // instead of a string to split.
    subsystem: s.subsystem,
    has: { ...s.has, archSpec: v.archSpec },
    adrs: s.adrs,
    status: s.status,
    maturity: v.maturity,
    missing: v.missing,
    apiExpected: v.apiExpected,
    // Never omitted when true: a consumer that filters this table into a
    // worklist has to be able to tell "checked and fine" from "not checkable
    // from here", and absence reads as the first one.
    ...(v.unverifiableFromHere ? { provenance: "unverifiable-from-here" } : {}),
    // Additive, and only when there IS a scope — omission is the fine case
    // here, exactly as it is for `provenance` above, and `maturity` stays the
    // frozen `vouched` beside it. A dashboard counting `maturity: "vouched"`
    // rows keeps counting them; one that cares whether a person read the
    // document subtracts these.
    ...(s.vouchScope === "sampled" ? { vouchScope: "sampled" } : {}),
  };
}

/**
 * The subsystem rows beside the service table, sorted by path. `memberCount`
 * is TRANSITIVE — every service beneath, at any depth — matching the
 * generated views file's membership, so the two numbers a consumer can
 * cross-check never disagree about what "in this group" means.
 */
export function subsystemsJson(docsDir: string, tree: FleetTree): Record<string, unknown>[] {
  return [...tree.subsystems]
    .sort((a, b) => (a.path.join("/") < b.path.join("/") ? -1 : 1))
    .map((sub) => ({
      name: sub.name,
      path: repoPath(docsDir, sub.dir),
      title: sub.meta.title ?? null,
      memberCount: servicesUnder(tree, sub).length,
    }));
}

/**
 * The additive `owners` payload key under `--owners` — the join result as a
 * contract: `path` (the file exactly as the user named it), `teams[]` (owner
 * plus that team's services, in the LISTING's own filtered-and-ordered row
 * order, so each array is that team's campaign worklist), `unowned[]` (rows
 * no rule matched — explicit, because absence would read as owned-somewhere),
 * and `skippedRules[]` (recognised rules outside the implemented CODEOWNERS
 * subset, each with its line — reported, never guessed at). Key spellings
 * frozen once shipped; the join itself lives in campaign/owners.ts.
 *
 * The service arrays carry IDS. On a `subsystem.name-collision` fleet —
 * already an error finding — two rows can share an id, so a consumer cannot
 * tell them apart here; if that ever needs disambiguating, the fix is a new
 * ADDITIVE key carrying paths, never a change to these.
 */
export function ownersJson(join: OwnersJoin): Record<string, unknown> {
  return {
    path: join.path,
    teams: join.teams.map((team) => ({ owner: team.owner, services: team.services.map((row) => row.id) })),
    unowned: join.unowned.map((row) => row.id),
    skippedRules: join.skipped.map((rule) => ({ line: rule.line, pattern: rule.pattern })),
  };
}

/**
 * One `capabilities[]` row — additive payload, explicit `loam list
 * capabilities` only, and diff-stable: the rollup already sorts rows,
 * realizedBy and statuses' keys deterministically, and this projection adds
 * nothing that could vary between machines. Optional keys are omitted rather
 * than nulled so a declaration that never carried a description does not grow
 * one in the diff.
 */
export function capabilityJson(row: CapabilityRow): Record<string, unknown> {
  return {
    id: row.id,
    ...(row.description !== undefined ? { description: row.description } : {}),
    ...(row.owner !== undefined ? { owner: row.owner } : {}),
    realizedBy: row.realizedBy,
    services: row.services,
    statuses: row.statuses,
    // Present only for a capability that HAS a document, and absent rather than
    // `[]` for one that does not — the same optional-key rule the two fields
    // above follow, and here it carries a distinction a reader needs: an empty
    // array means the document declares no requirements, while no key at all
    // means there is no document to declare any.
    //
    // Each row inside carries `realizedBy` (the service requirements whose
    // `Realizes:` line names it) and `keptBy` (the flows whose `#cap-`/`#req-`
    // tags resolve to it) — two independent corpora, NEITHER derived from the
    // other, because a cross-service promise can only be kept by a flow and a
    // per-service one is normally kept by a requirement. `keptBy` follows the
    // same three-state rule one level down and `rollup.ts` states it: absent
    // means nobody looked, `[]` means loam looked and no flow keeps it. The
    // payload's own `useCases.unreadable` says which of the two absences it is.
    ...(row.requirements === undefined ? {} : { requirements: row.requirements }),
  };
}

export function featureJson(
  docsDir: string,
  f: FeatureEntry,
  verification: VerificationCell | null,
): Record<string, unknown> {
  return {
    id: f.id,
    dirName: f.dirName,
    path: repoPath(docsDir, f.dir),
    archived: f.archived,
    services: f.services,
    has: f.has,
    verification,
  };
}

/* ------------------------------------------------------------------ */
/* Verification                                                        */
/* ------------------------------------------------------------------ */

/** What the features table says about verification without N `loam verify` runs. */
