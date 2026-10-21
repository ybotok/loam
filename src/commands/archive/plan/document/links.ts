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
 * THE OTHER TWO HALVES ARE THE DOCUMENTS THAT DO NOT MERGE. The feature's own
 * (`planFeatureLinks` below) stay in the feature and ride the rename, so their
 * links out of it are one directory short the moment it lands. Every other
 * document in the corpus (`planInboundLinks` below) stays where it is while
 * the files it cites inside the feature move away from under it.
 */
import { dirname, resolve } from "node:path";
import { repoPath } from "../../../../core/envelope/json.js";
import { movedUnderVouch, parseFrontmatter, stringField } from "../../../../core/document/frontmatter.js";
import { parseRequirements } from "../../../../core/document/parse.js";
import { requirementDigest } from "../../../../core/document/spec.js";
import { featureGlossary, livingTermPath } from "../../../../core/glossary/delta.js";
import { allAuthoredDocuments, movedMarkdown } from "../../../../core/links/corpus.js";
import { rebaseLinks } from "../../../../core/links/parse.js";
import { inOrder } from "../../../../core/kernel/concurrency.js";
import { acrossRename, isPathInside } from "../../../../core/kernel/path-safety.js";
import { featuresDir, servicePathsAt } from "../../../../core/repo/paths.js";
import { listServices } from "../../../../core/repo/repo.js";
import { featureFlows, livingFlowPath } from "../../../../core/usecases/delta/flows.js";
import { featureDeployments, livingDeploymentPath } from "../../../../core/deployment/delta.js";
import { NotUtf8Error, planWrite, readUtf8 } from "../../../../core/staging/writes.js";
import type { FleetContext } from "../../../../core/fleet-context.js";
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

/**
 * Every other document in the link corpus whose links reach INTO the feature,
 * re-expressed for where this archive leaves what they cite.
 *
 * THE DEFECT THIS CLOSES. Another change in flight builds on this one's
 * decision (`../FEAT/adrs/0001-x.md` from its intent), or a living ADR cites
 * the decision taken for it while the change is still open. Correct the moment
 * before the archive, so no gate could say otherwise; `link.unresolved` the
 * moment after, because the rename took the directory away from under the
 * link. And no edit the author could make in advance would have helped: the
 * archived path does not exist until the archive does. `subsystem move` has
 * rewritten the links into the directories it renames since it shipped
 * (`commands/subsystem/txn/links.ts`); this is the archive's rename owing the
 * same correction.
 *
 * THE RULE IS `featureRetarget`'s, not the rename's. These documents are not
 * the record of the change; they are the living corpus and the other changes
 * in flight, read against the tree as it is. So a term the archive copies into
 * `glossary/` is cited at the living copy — the one a reader is meant to find
 * and the one `glossary.unlinked` counts — and everything that stays with the
 * change, its ADRs and intent above all, is cited where the feature now lives.
 * Only the routes into the feature change; every other link keeps its
 * spelling (`rebaseLinks`).
 *
 * COMPOSED ONTO THE MERGE. A living spec the merge rewrites can cite the
 * feature in its own narrative, and relinking the bytes on disk would plan a
 * second write of its PRE-merge text — swapped after the merge's, it would
 * undo the merge. So a document this plan already writes is relinked from the
 * text the merge composed, and that one write is replaced in place.
 *
 * THE COSTS ARE SAID THE WAY THE MERGE SAYS ITS OWN. A rewritten route is still
 * a changed byte. Under a vouch stamp it is `content.stale` until the owner
 * re-vouches, so a vouched spec this moves joins `revouchOwed` exactly as one
 * the merge moves does. Inside a living requirement it moves the digest a
 * `Based-On:` pin holds, and the plan names the document. No git refusal of the
 * kind `subsystem move` holds (`move-uncommitted`): archive never stages in
 * git, and its undo is the snapshot — every write here is one of its rows, so
 * `loam unarchive` puts the authored bytes back, and a document edited since
 * is `snapshot-stale` like any other.
 */
export async function planInboundLinks(
  config: { docsDir: DocsDir; fleet: FleetContext },
  gated: Pick<Gated, "featureDir" | "archiveDest">,
  planned: Plan,
  say: (line?: string) => void,
): Promise<void> {
  const { docsDir, fleet } = config;
  let corpus: string[];
  try {
    corpus = await allAuthoredDocuments(docsDir, fleet);
  } catch (err) {
    // The gate enumerated this fleet already, so a walk that fails here is a
    // tree `validate` will diagnose. The archive is not refused over a question
    // it asks to keep the corpus readable — `subsystem move` decides the same —
    // but it does not pretend the question was answered either.
    say(
      `  ⚠ links INTO ${repoPath(docsDir, gated.featureDir)}/ were not checked — the fleet's documents could not be walked ` +
        `(${err instanceof Error ? err.message : String(err)}); \`loam validate --all\` names any that broke.`,
    );
    return;
  }
  const retarget = await featureRetarget(docsDir, gated);
  const vouchable = new Map<string, string>();
  for (const service of await listServices(docsDir, fleet)) {
    const paths = servicePathsAt(service.dir);
    vouchable.set(resolve(paths.spec), service.id);
    vouchable.set(resolve(paths.archSpec), service.id);
  }
  const plannedAt = new Map(planned.writes.map((w, i) => [resolve(w.path), i]));
  const seen = new Set<string>();
  const candidates = corpus.filter((path) => {
    const key = resolve(path);
    if (seen.has(key) || isPathInside(gated.featureDir, path)) return false;
    seen.add(key);
    return true;
  });
  const documents = await inOrder(candidates, async (path) => {
    const at = plannedAt.get(resolve(path));
    if (at !== undefined) {
      // A delete or a Buffer is not text this rewrite may compose onto; no
      // markdown planner hands over either.
      const content = planned.writes[at]!.content;
      return { path, at, text: typeof content === "string" ? content : null };
    }
    try {
      return { path, at, text: await readUtf8(path) };
    } catch {
      // Absent (the corpus names every slot a service MAY fill) or not UTF-8,
      // which `link.unreadable` already names: nothing loam could write back.
      return { path, at, text: null };
    }
  });
  const pinned = (md: string): string => parseRequirements(md).map(requirementDigest).join(",");
  const relinked: string[] = [];
  const notes: string[] = [];
  for (const { path, at, text } of documents) {
    if (text === null) continue;
    const next = rebaseLinks(text, { from: dirname(path), to: dirname(path), retarget });
    if (next === text) continue;
    if (at === undefined) planned.writes.push(planWrite(path, next));
    else planned.writes[at] = { ...planned.writes[at]!, content: next };
    const where = repoPath(docsDir, path);
    relinked.push(where);
    // The merge's own question (`../specs.ts`), asked of the bytes about to be
    // written — and once per document: a spec the merge already named is not
    // owed a second re-vouch for the same commit.
    const service = vouchable.get(resolve(path));
    const fm = parseFrontmatter(next);
    const named = planned.revouchOwed.some((owed) => resolve(owed.path) === resolve(path));
    if (service !== undefined && !named && movedUnderVouch(fm, next)) {
      planned.revouchOwed.push({ service, path, owner: stringField(fm, "owner") ?? null });
    }
    // Living documents only: a pin holds the digest of a LIVING requirement,
    // so another feature's own delta text moving pins nothing.
    if (!isPathInside(featuresDir(docsDir), path) && pinned(next) !== pinned(text)) {
      notes.push(
        `${where}: links this archive rewrote sit inside requirements, so a feature in flight that pins one with Based-On: ` +
          "reports delta.baseline-stale until `loam rebase` re-pins it.",
      );
    }
  }
  if (relinked.length === 0) return;
  say(`  links into the feature: ${relinked.length} document(s) relinked for ${repoPath(docsDir, gated.archiveDest)}/`);
  for (const path of relinked) say(`      ${path}`);
  for (const note of notes) say(`      note: ${note}`);
}

/** Where `target` will be once the feature directory has moved: its image under the archive when it is inside the feature, itself otherwise. */
function followsFeature(gated: Pick<Gated, "featureDir" | "archiveDest">, target: string): string {
  return acrossRename(target, gated.featureDir, gated.archiveDest);
}
