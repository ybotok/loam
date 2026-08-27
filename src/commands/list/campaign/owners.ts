/**
 * The `--owners` join behind `loam list`: read the user-named CODEOWNERS
 * file, bucket the CURRENT listing's rows under the teams it names, and
 * refuse — `owners-unreadable` — when the file cannot be read or a line in
 * it cannot be parsed as `pattern owner…`. The parse and the matching are
 * `core/owners/codeowners.ts`'s (pure; its header records the implemented
 * subset and the skip-don't-guess rule); this module owns the filesystem
 * read and the refusal, because core never prints.
 *
 * The join runs over the rows the listing is about to show, in the order it
 * will show them — after `--subsystem`/`--needs-work` filtering and any
 * `--review-order` ranking — so each team's array IS that team's campaign
 * worklist, not a second, differently-ordered opinion of the fleet.
 */
import { readFile } from "node:fs/promises";
import { fail } from "../../../core/envelope/json.js";
import { ownersFor, parseCodeowners, type SkippedRule } from "../../../core/owners/codeowners.js";

/** One row of the listing, reduced to what the join reads. */
export interface OwnedRow {
  readonly id: string;
  /** The service's docs-repo-relative directory, forward slashes (`repoPath`). */
  readonly repoDir: string;
}

export interface OwnersJoin {
  /** The path exactly as the user named it — the file is theirs, not loam's. */
  readonly path: string;
  /**
   * One bucket per owning team, sorted by owner; rows in row order. The full
   * row, not the id: leaf ids can collide across a broken tree, and the
   * renderers join back to their views by `repoDir` — the row's identity.
   */
  readonly teams: { readonly owner: string; readonly services: readonly OwnedRow[] }[];
  /**
   * Rows no rule matched, or whose LAST matching rule named no owner —
   * GitHub's ownership-clearing form. Listed explicitly, because a service
   * silently absent from every team's queue reads as somebody else's work.
   */
  readonly unowned: readonly OwnedRow[];
  /** Recognised rules outside the implemented subset — reported, never guessed. */
  readonly skipped: readonly SkippedRule[];
}

/**
 * Read, parse and join, or report the refusal and return null. An empty or
 * all-skipped file is NOT a refusal: every row lands in `unowned`, honestly —
 * the file said nothing, and saying so is the answer.
 */
export async function ownersJoin(req: {
  path: string;
  rows: readonly OwnedRow[];
  json: boolean;
}): Promise<OwnersJoin | null> {
  let content: string;
  try {
    content = await readFile(req.path, "utf8");
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    fail(
      req.json,
      "owners-unreadable",
      `Cannot read the CODEOWNERS file at ${req.path}: ${detail}. Nothing was joined; re-run with the path of the file the forge actually uses.`,
    );
    return null;
  }
  const parsed = parseCodeowners(content);
  if (!parsed.ok) {
    fail(
      req.json,
      "owners-unreadable",
      `${req.path}:${parsed.line}: ${parsed.problem}. A rule loam cannot read is never guessed at or silently skipped — fix the line, then re-run.`,
    );
    return null;
  }
  const byOwner = new Map<string, OwnedRow[]>();
  const unowned: OwnedRow[] = [];
  for (const row of req.rows) {
    const owners = ownersFor(row.repoDir.split("/"), parsed.rules);
    if (owners.length === 0) {
      unowned.push(row);
      continue;
    }
    // A rule may name several owners; the service files under EACH — a shared
    // directory is two teams' work, not half of either's. The Set: a rule
    // repeating one owner (`@a @a`) must not list the service twice.
    for (const owner of new Set(owners)) {
      byOwner.set(owner, [...(byOwner.get(owner) ?? []), row]);
    }
  }
  return {
    path: req.path,
    // Plain lexicographic on the owner string: deterministic across machines,
    // and owner handles are not ids, so compareIds' numeric tokenizing has
    // nothing to add.
    teams: [...byOwner.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([owner, services]) => ({ owner, services })),
    unowned,
    skipped: parsed.skipped,
  };
}
