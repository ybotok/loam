/**
 * The fleet map merge, and the services this archive brings into existence.
 *
 * The landscape is the one document every feature writes into, so it is spliced
 * rather than rewritten: the authored file keeps its shape and the delta's
 * elements are placed into it. A service arriving on the architecture axis alone
 * has no `model.likec4` yet, and the warning for that is carried out of the plan
 * — `validate` would report it next, and reporting it here is what stops that
 * being a surprise.
 */
import { existsSync } from "node:fs";
import { planWrite, readUtf8 } from "../../../core/staging/writes.js";
import { planLandscapeMerge } from "../../../core/c4/splice/landscape-merge.js";
import { titleOf } from "../../../core/c4/splice/placement.js";
import { parseServiceId } from "../../../core/kernel/ids/service.js";
import { landscapePath as landscapeFile, servicePaths } from "../../../core/repo/paths.js";
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
  const { writes, planWarns, architectureServices } = plan;
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
      const plan = await planLandscapeMerge({
        landscapeText: await readUtf8(landscapePath),
        deltaText: await readUtf8(deltaLikec4),
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
      // A binding is document text, which `servicePaths` no longer accepts.
      // The parse cannot actually filter anything here: an illegal binding is
      // `c4.service-binding-invalid`, a coherence ERROR `--approve` does not
      // override, refused before any merge is planned — so the `ok` test only
      // carries the compiler's proof that document text never reaches a path.
      for (const e of plan.addedEls) {
        const parsed = e.service === undefined ? undefined : parseServiceId(e.service);
        if (parsed?.ok === true) architectureServices.add(parsed.id);
      }
      if (plan.content !== null) writes.push(planWrite(landscapePath, plan.content));
      say(`\n  architecture: merged into landscape.likec4 — +${plan.addedEls.length} element(s), +${plan.addedRels.length} relationship(s)`);
      for (const e of plan.addedEls) say(`      + ${e.title} (${e.kind})`);
      for (const r of plan.addedRels) {
        say(`      + ${titleOf(delta.elements, r.source)} -> ${titleOf(delta.elements, r.target)}  "${r.title ?? ""}"`);
      }
    } else {
      say(`\n  architecture: no landscape.likec4 — ${newEls.length} element(s) not merged`);
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
  const newServices = [...new Set([...deltaServices, ...architectureServices])].filter(
    (svc) => !existsSync(servicePaths(config.docsDir, svc).dir),
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
