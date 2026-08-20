/**
 * The ARCHITECTURE axis merge — the fleet map, the journeys drawn over it, and
 * the services this archive brings into existence.
 *
 * The landscape is the one document every feature writes into, so it is spliced
 * rather than rewritten: the authored file keeps its shape and the delta's
 * elements are placed into it. A DYNAMIC VIEW is the same axis and the opposite
 * merge — replaced or added whole, keyed on its id — because it is a small
 * self-contained object with no neighbours inside it to preserve
 * (`core/flows/merge.ts` and `core/c4/splice/view-splice.ts` argue both halves).
 * The two run in that order and share one landscape text, because a view merged
 * beside elements the same delta adds must be checked against a landscape that
 * has them, and because two writes to one path would stage two swaps of the
 * same file.
 *
 * A service arriving on the architecture axis alone has no `model.likec4` yet,
 * and the warning for that is carried out of the plan — `validate` would report
 * it next, and reporting it here is what stops that being a surprise. The
 * generated flow-group views are the same shape of debt and are reported the
 * same way, never repaired here: `loam flow sync` is that file's one writer.
 */
import { existsSync } from "node:fs";
import { planWrite, readUtf8 } from "../../../core/staging/writes.js";
import { planLandscapeMerge } from "../../../core/c4/splice/landscape-merge.js";
import { titleOf } from "../../../core/c4/splice/placement.js";
import { planFlowMerge } from "../../../core/flows/merge.js";
import { parseServiceId } from "../../../core/kernel/ids/service.js";
import { landscapePath as landscapeFile } from "../../../core/repo/paths.js";
import { enumeratedServiceIds } from "../../../core/repo/service-target.js";
import { type Gated, type Plan } from "./state.js";
import { ArchiveFailure } from "./refusal.js";
import { featurePaths } from "../../../core/repo/paths.js";
import type { DocsDir } from "../../../core/kernel/ids/dirs.js";

export async function planLandscape(
  config: { docsDir: DocsDir },
  gated: Gated,
  plan: Plan,
  say: (line?: string) => void,
): Promise<void> {
  const { id, featureDir, deltaDoc, deltaServices } = gated;
  const deltaLikec4 = featurePaths(featureDir).delta;
  const { writes, planWarns, architectureServices, flowViews } = plan;
  const landscapePath = landscapeFile(config.docsDir);
  if (deltaDoc !== undefined) {
    const delta = deltaDoc;
    if (delta.errors.length > 0) {
      // --approve overrides loam's JUDGMENT about coherence, never its ability to
      // read an axis. Skipping here would silently drop one merge axis in the one
      // command engineered against quiet partial merges — same rule as an
      // unparseable landscape or openapi: the plan stops before anything is written.
      throw new ArchiveFailure(
        "merge-failed",
        `delta.likec4 has ${delta.errors.length} parse error(s) — the architecture axis cannot be merged; fix it (\`loam validate --feature ${id}\`) or delete the file`,
      );
    }
    const newEls = delta.elements.filter((e) => e.tags.includes(id));
    const newRels = delta.relationships.filter((r) => r.tags.includes(id));
    if (existsSync(landscapePath)) {
      const landscapeText = await readUtf8(landscapePath);
      const deltaText = await readUtf8(deltaLikec4);
      // Named `merge`, not `plan`: the outer `Plan` parameter is still in scope
      // here, and the shadow that used to stand made every later line in this
      // block correct only by accident of the destructure above it.
      const merge = await planLandscapeMerge({
        landscapeText,
        deltaText,
        deltaElements: delta.elements,
        newEls,
        newRels,
        featureId: id,
      });
      // A service can arrive on the ARCHITECTURE axis alone: an element this
      // merge ADDS, carrying a `metadata { service }` binding, with no
      // `specs/<svc>/` anywhere in the feature. It is a service the fleet gate
      // will demand a directory for the moment this merge lands, so it owes the
      // same warning as one arriving with a requirement delta — and until it
      // did, the closing "complete + current" line printed over a landscape
      // this very archive had just made red. Read off the ADDED elements, not
      // the tagged ones: an element the living landscape already had is not
      // arriving, and one that is never merged is not there to demand anything.
      // A binding is document text, which the service path builders no longer accept.
      // The parse cannot actually filter anything here: an illegal binding is
      // `c4.service-binding-invalid`, a coherence ERROR `--approve` does not
      // override, refused before any merge is planned — so the `ok` test only
      // carries the compiler's proof that document text never reaches a path.
      for (const e of merge.addedEls) {
        const parsed = e.service === undefined ? undefined : parseServiceId(e.service);
        if (parsed?.ok === true) architectureServices.add(parsed.id);
      }
      // The journeys, over the landscape this merge is about to leave behind.
      // One landscape write either way: the flow merge hands back the fleet
      // map's text because a view the fleet map itself declares is replaced
      // there, and two `planWrite`s of one path would stage two swaps of it.
      const flows = await planFlowMerge({
        docsDir: config.docsDir,
        deltaText,
        newFlows: delta.flows.filter((f) => f.tags.includes(id)),
        featureId: id,
        landscapeText: merge.content ?? landscapeText,
      });
      if (flows.landscapeText !== landscapeText) writes.push(planWrite(landscapePath, flows.landscapeText));
      for (const write of flows.writes) writes.push(planWrite(write.path, write.content));
      say(`\n  architecture: merged into landscape.likec4 — +${merge.addedEls.length} element(s), +${merge.addedRels.length} relationship(s)`);
      for (const e of merge.addedEls) say(`      + ${e.title} (${e.kind})`);
      for (const r of merge.addedRels) {
        say(`      + ${titleOf(delta.elements, r.source)} -> ${titleOf(delta.elements, r.target)}  "${r.title ?? ""}"`);
      }
      for (const view of flows.merged) {
        flowViews.push(view);
        say(`      ${view.action === "added" ? "+" : "~"} flow ${view.id} ${view.action} in ${view.path}`);
      }
      if (flows.groupViewsStale) {
        planWarns.push({
          severity: "warn",
          code: "flow.views-stale",
          message:
            `architecture/flow-groups.likec4 no longer matches the fleet's journeys after this merge — ` +
            `'loam validate --all' reports it until it is regenerated. Run 'loam flow sync': that file has ` +
            `exactly one writer, and this merge is deliberately not a second one.`,
        });
      }
    } else {
      // The views are named here too, and not silently dropped: a journey
      // resolves only against the fleet map, so with no map there is nothing
      // for one to be merged INTO — and a merge that happens to be empty must
      // still say what it did not carry.
      const skipped = delta.flows.filter((f) => f.tags.includes(id)).length;
      say(
        `\n  architecture: no landscape.likec4 — ${newEls.length} element(s)` +
          `${skipped === 0 ? "" : ` and ${skipped} journey(s)`} not merged`,
      );
    }
  }

  // A service this archive BRINGS INTO EXISTENCE arrives without the one file
  // `validate` demands of every service: its own model.likec4. The merge cannot
  // write it — the delta's tagged subtree is a landscape-level box, not a
  // container model, and inventing a plausible one is the kind of quiet fiction
  // the rest of loam exists to prevent — so the archive says so instead, and
  // stops claiming the docs are complete. Non-gating: the feature is coherent
  // and the merge is correct; what is missing is the next step, and refusing
  // here would make onboarding a new service impossible in one command.
  // "New" is enumeration membership, not an existsSync of services/<svc>/ at
  // the root: a FILED service exists wherever the tree walk found it, and the
  // root probe would grade every filed service as newly created here.
  const enumerated = new Set<string>(await enumeratedServiceIds(config.docsDir));
  const newServices = [...new Set([...deltaServices, ...architectureServices])].filter(
    (svc) => !enumerated.has(svc),
  );
  for (const svc of newServices) {
    // Two shapes of the same debt: a service with a requirement delta gets its
    // directory from this merge, one that arrives only in the landscape gets no
    // directory at all — and `validate --all` fails the second harder
    // (`landscape.service-unmodelled` names the binding with nothing behind it).
    const creates = deltaServices.some((d) => d === svc)
      ? `this archive creates services/${svc}/, but nothing writes services/${svc}/model.likec4`
      : `this archive puts '${svc}' in the landscape, but the fleet has no services/${svc}/ at all`;
    planWarns.push({
      severity: "warn",
      code: "service.no-model",
      subject: svc,
      message: `${svc}: ${creates} — 'loam validate --all' will report the service as incomplete until it exists. Run 'loam adopt --service ${svc}' from the service repo, or write the model by hand.`,
    });
  }
}
