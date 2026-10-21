/**
 * Where every file of the feature will be once this archive lands — the half of
 * the link rewrite that `core/links/parse.ts`'s `rebaseLinks` cannot know.
 *
 * THE DEFECT THIS CLOSES. The requirement merge has re-expressed a delta's
 * relative links from the directory they were written in to the one they land
 * in since the glossary axis shipped. But it re-expressed them against the
 * target's OLD place, and the same archive moves the targets that sit inside
 * the feature: a link from a delta to `features/<FEAT>/glossary/order.md` was
 * rewritten faithfully into the living spec and resolved to nothing one rename
 * later, when the term had been copied to `glossary/order.md` and the feature
 * directory had gone to `features/archive/<FEAT>/`. Every such link was
 * `link.unresolved` on the first `validate --all` after a clean archive — an
 * error the feature gate could not see, because before the archive the link
 * was correct.
 *
 * TWO RULES, and they are the archive's own moves rather than a guess:
 *
 * - A file the archive COPIES into the living tree — a glossary term, a flow,
 *   a topology document — is cited at its living copy. That is the document
 *   readers are meant to find, and the one `glossary.unlinked` counts a
 *   citation of: a link left on the archived copy would resolve and still
 *   leave the living term reading as a word nobody uses.
 * - Every other file under the feature directory — its ADRs above all, the
 *   intent, the deltas themselves — is cited where the feature now lives,
 *   `features/archive/<FEAT>/`. Nothing else copies a feature ADR anywhere: it
 *   records a decision taken for this change, and it stays with the change
 *   (SCHEMA "Layout" says so beside the slot).
 *
 * Built per call from three directory walks — the glossary, the flows and the
 * topology documents, the same walks `../specs.ts` and `../landscape.ts` make
 * to copy them; a `Gated` field would be one more value the gate computes for
 * a phase it does not own.
 *
 * THE OTHER HALF IS THE FEATURE'S OWN DOCUMENTS (`planFeatureLinks` below):
 * the ones that stay in the feature and ride the rename, whose links out of it
 * are one directory short the moment it lands.
 */
import { dirname, resolve } from "node:path";
import { repoPath } from "../../../../core/envelope/json.js";
import { featureGlossary, livingTermPath } from "../../../../core/glossary/delta.js";
import { movedMarkdown } from "../../../../core/links/corpus.js";
import { rebaseLinks } from "../../../../core/links/parse.js";
import { inOrder } from "../../../../core/kernel/concurrency.js";
import { acrossRename } from "../../../../core/kernel/path-safety.js";
import { featureFlows, livingFlowPath } from "../../../../core/usecases/delta/flows.js";
import { featureDeployments, livingDeploymentPath } from "../../../../core/deployment/delta.js";
import { NotUtf8Error, planWrite, readUtf8 } from "../../../../core/staging/writes.js";
import type { DocsDir } from "../../../../core/kernel/ids/dirs.js";
import type { Gated, Plan } from "../state.js";

/** Absolute path in, the absolute path the same file will have after this archive out. */
export type Retarget = (target: string) => string;

export async function featureRetarget(docsDir: DocsDir, gated: Pick<Gated, "featureDir" | "archiveDest">): Promise<Retarget> {
  const copies = new Map<string, string>();
  for (const term of (await featureGlossary(gated.featureDir)).terms) {
    copies.set(resolve(term.path), resolve(livingTermPath(docsDir, term.id)));
  }
  for (const flow of await featureFlows(gated.featureDir)) {
    copies.set(resolve(flow.path), resolve(livingFlowPath(docsDir, flow.rel)));
  }
  for (const doc of await featureDeployments(gated.featureDir)) {
    copies.set(resolve(doc.path), resolve(livingDeploymentPath(docsDir, doc.rel)));
  }
  return (target: string): string => copies.get(resolve(target)) ?? followsFeature(gated, target);
}

/**
 * The feature's own markdown documents with their relative links re-expressed
 * for `features/archive/<FEAT>/`, planned at their CURRENT paths so the swap
 * lands before the rename carries them (`../../run.ts`).
 *
 * THE DEFECT THIS CLOSES. The archive is a directory rename, and every document
 * that stays in the feature — the intent, its ADRs, the deltas, a capability
 * delta, the archived copy of a term — kept links written one directory
 * shallower than where they now sit: `../../services/x/spec.md` from
 * `features/<FEAT>/intent.md` names `features/services/x/spec.md` once the
 * intent is `features/archive/<FEAT>/intent.md`. Nothing grades an archived
 * feature (`core/links/corpus.ts` says why), so nothing said so — but the
 * living documents link INTO the archived feature's ADRs (`featureRetarget`
 * above), and a reader who followed one landed on a decision whose own links
 * were all off by one.
 *
 * ONE RULE, the rename's: a target inside the feature moves with it and every
 * other target stays put — `subsystem move`'s rule for its own renames
 * (`commands/subsystem/txn/links.ts`). So a link from the intent to its own
 * ADR or its own glossary term is left exactly as written: the archived
 * record keeps citing the archived copy, which is the text the feature was
 * reviewed against, rather than being redirected to a living copy that will go
 * on changing without it. Only the routes the rename broke are touched, and a
 * link whose text still reaches its target keeps its spelling
 * (`rebaseLinks`).
 *
 * The undo is the snapshot's, like every other write here: each rewritten
 * document is a staged write, so its pre-image is parked and `loam unarchive`
 * puts the authored bytes back (`core/staging/snapshot/snapshot.ts` says where
 * it records them).
 *
 * A document that is not UTF-8 is left exactly as written, and the text
 * output says so — `--json` has no key for it, and minting one for a document
 * nothing grades was not worth a contract change. Every other read here would
 * refuse it, but this one only corrects links, and refusing the archive over
 * such a document would be the larger harm.
 *
 * Read with bounded concurrency and applied in input order (`inOrder`), as
 * `subsystem move`'s rewrite reads its own: a large feature — one
 * `loam migrate-openspec` filled with its legacy documents — is read in full
 * under the lock.
 */
export async function planFeatureLinks(
  config: { docsDir: DocsDir },
  gated: Pick<Gated, "featureDir" | "archiveDest">,
  planned: Plan,
  say: (line?: string) => void,
): Promise<void> {
  const { docsDir } = config;
  const retarget = (target: string): string => followsFeature(gated, target);
  const read = await inOrder(await movedMarkdown(gated.featureDir), async (path) => {
    try {
      return { path, text: await readUtf8(path) };
    } catch (err) {
      if (!(err instanceof NotUtf8Error)) throw err;
      return { path, text: null };
    }
  });
  const relinked: string[] = [];
  for (const { path, text } of read) {
    const lands = followsFeature(gated, path);
    if (text === null) {
      say(`  ⚠ ${repoPath(docsDir, lands)} is not UTF-8 — its links were left as written`);
      continue;
    }
    const next = rebaseLinks(text, { from: dirname(path), to: dirname(lands), retarget });
    if (next === text) continue;
    planned.writes.push(planWrite(path, next));
    relinked.push(repoPath(docsDir, lands));
  }
  if (relinked.length === 0) return;
  say(`  feature documents: ${relinked.length} relinked for ${repoPath(docsDir, gated.archiveDest)}/`);
  for (const path of relinked) say(`      ${path}`);
}

/** Where `target` will be once the feature directory has moved: its image under the archive when it is inside the feature, itself otherwise. */
function followsFeature(gated: Pick<Gated, "featureDir" | "archiveDest">, target: string): string {
  return acrossRename(target, gated.featureDir, gated.archiveDest);
}
