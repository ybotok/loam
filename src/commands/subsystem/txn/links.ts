/**
 * The link half of `subsystem move` and `rename`: every relative markdown link
 * the renames would break, re-expressed so it reaches the same file.
 *
 * THE DEFECT THIS CLOSES. A move is a directory rename, and a relative link is
 * a route from one directory to another. `services/orders/spec.md` citing
 * `../../glossary/order.md` is two directories below the docs root; moved into
 * `services/commerce/orders/` it is three, and the same text names
 * `services/glossary/order.md`, which is nothing. The move reported success,
 * staged the renames in git, and the next `validate --all` failed
 * `link.unresolved` on every moved document that cited anything outside its
 * own directory — the "failing between two commits" state the commit window
 * exists to refuse. The same rename breaks the other direction too: a
 * capability document or a glossary term citing `services/orders/spec.md`
 * now points where nothing is.
 *
 * SO BOTH DIRECTIONS ARE REWRITTEN, with the one rule archive's merge uses
 * (`core/links/parse.ts`'s `rebaseLinks`): the target is unchanged, only the
 * route to it, and a link whose text still reaches its target from the new
 * place keeps its exact spelling.
 *
 * - Every markdown file under a moved directory, whatever its name — a runbook,
 *   an ADR, a subsystem's own notes: the rename moves them all, so it owes them
 *   all the same correction. Written at the OLD path, because the transaction
 *   swaps files before it renames directories (`core/staging/txn/`), so the
 *   rewritten bytes travel with the rename.
 * - Every other document in the link corpus (`core/links/corpus.ts`: the fleet's
 *   own documents, every service's, every in-flight feature's) whose links
 *   reach INTO a moved directory. Archived features are not in it, for the
 *   corpus's own reason: their links describe the tree as it was, and nothing
 *   grades them.
 *
 * A document that cannot be decoded is left as it is: rewriting means writing
 * the whole file back, and `link.unreadable` already names it.
 */
import { dirname, resolve } from "node:path";
import { allAuthoredDocuments, movedMarkdown } from "../../../core/links/corpus.js";
import { rebaseLinks } from "../../../core/links/parse.js";
import { FleetContext } from "../../../core/fleet-context.js";
import { movedUnderVouch, parseFrontmatter } from "../../../core/document/frontmatter.js";
import { parseRequirements } from "../../../core/document/parse.js";
import { requirementDigest } from "../../../core/document/spec.js";
import { repoPath } from "../../../core/envelope/json.js";
import { featuresDir } from "../../../core/repo/paths.js";
import { inOrder } from "../../../core/kernel/concurrency.js";
import { acrossRename, isPathInside } from "../../../core/kernel/path-safety.js";
import { planWrite, readUtf8, type PlannedWrite } from "../../../core/staging/writes.js";
import type { DocsDir } from "../../../core/kernel/ids/dirs.js";

/** One directory rename, absolute paths. */
export interface DirectoryMove {
  from: string;
  to: string;
}

/** The link rewrites a set of renames owes, and where each rewritten document will be read from. */
export interface MovedLinks {
  /** Planned at each document's CURRENT path — the swap lands before the rename carries it. */
  writes: PlannedWrite[];
  /** Each rewritten document's path once the move has landed, absolute, in the order written. */
  relinked: string[];
  /**
   * The notes a person owes a reading of. A rewritten route is still a
   * changed byte: under a `content_digest` it is `content.stale` until the
   * owner re-vouches, and inside a requirement it moves the digest a
   * `Based-On:` pin holds, so a feature in flight that pins it is
   * `delta.baseline-stale` until it is rebased. Neither is softened — the
   * archive merge reports the first the same way (`revouchOwed`) — but both
   * are said here, by path, rather than discovered by the next gate.
   */
  notices: string[];
}

export async function movedLinks(docsDir: DocsDir, moves: readonly DirectoryMove[]): Promise<MovedLinks> {
  const retarget = (target: string): string => {
    for (const move of moves) {
      if (isPathInside(move.from, target)) return acrossRename(target, move.from, move.to);
    }
    return target;
  };
  const out: MovedLinks = { writes: [], relinked: [], notices: [] };
  // The moved documents first, then every other document the corpus names —
  // one list, deduplicated in order, because the order is what `relinked`
  // reports and a person reads it top to bottom.
  const candidates: string[] = [];
  for (const move of moves) candidates.push(...(await movedMarkdown(move.from)));
  try {
    const corpus = await allAuthoredDocuments(docsDir, new FleetContext());
    candidates.push(...corpus.filter((path) => !moves.some((move) => isPathInside(move.from, path))));
  } catch (err) {
    // The corpus walk enumerates every service and feature; a tree it cannot
    // walk is one `validate` will diagnose, and the moved documents are still
    // corrected. A move is not refused over a question it only asks to be
    // helpful — but it does not pretend the question was answered either.
    out.notices.push(
      `links INTO the moved directories were not checked — the fleet's documents could not be walked (${err instanceof Error ? err.message : String(err)}); ` +
        "`loam validate --all` names any that broke.",
    );
  }
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const path of candidates) {
    if (seen.has(resolve(path))) continue;
    seen.add(resolve(path));
    unique.push(path);
  }
  // Read and rewrite with bounded concurrency — the whole corpus is read
  // before the commit window can land — and apply in input order (`inOrder`).
  const rewritten = await inOrder(unique, async (path) => {
    let text: string;
    try {
      text = await readUtf8(path);
    } catch {
      // Absent (the corpus names every slot a service MAY fill — most have no
      // runbook) or undecodable: either way there are no links to rewrite
      // that loam could write back, and `link.unreadable` names the second.
      return null;
    }
    const after = retarget(path);
    const next = rebaseLinks(text, { from: dirname(path), to: dirname(after), retarget });
    return next === text ? null : { path, after, text, next };
  });
  for (const one of rewritten) {
    if (one === null) continue;
    const { path, after, text, next } = one;
    out.writes.push(planWrite(path, next));
    out.relinked.push(after);
    const where = repoPath(docsDir, after);
    if (movedUnderVouch(parseFrontmatter(next), next) && !movedUnderVouch(parseFrontmatter(text), text)) {
      out.notices.push(`${where} is vouched, and this move rewrote links in it — content.stale follows until its owner re-vouches.`);
    }
    // Living documents only: a `Based-On:` pin holds the digest of a LIVING
    // requirement, so a feature's own delta text moving pins nothing.
    const pinned = (md: string): string => parseRequirements(md).map(requirementDigest).join(",");
    if (!isPathInside(featuresDir(docsDir), path) && pinned(next) !== pinned(text)) {
      out.notices.push(
        `${where}: links this move rewrote sit inside requirements, so a feature in flight that pins one with Based-On: ` +
          "reports delta.baseline-stale until `loam rebase` re-pins it.",
      );
    }
  }
  return out;
}

/**
 * The rewritten documents that do NOT ride a rename — the ones a move touches
 * outside the directories it names, which its uncommitted-work refusal and its
 * git staging have to be told about by path.
 */
export function outside(links: MovedLinks, moves: readonly DirectoryMove[]): string[] {
  return links.writes.map((w) => w.path).filter((path) => !moves.some((move) => isPathInside(move.from, path)));
}
