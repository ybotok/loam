/**
 * The fleet map merge, the flows drawn over it, and the services this archive
 * brings into existence.
 *
 * The landscape is the one document every feature writes into, so it is spliced
 * rather than rewritten: the authored file keeps its shape and the delta's
 * elements are placed into it. A service arriving on the architecture axis alone
 * has no `model.likec4` yet, and the warning for that is carried out of the plan
 * — `validate` would report it next, and reporting it here is what stops that
 * being a surprise.
 *
 * The map is not the only document the C4 axis writes. What a delta nests
 * INSIDE a service belongs to that service's `model.likec4` when the model
 * extends the map — the splicer routes it there, this stages the write, and
 * `./model/extending.ts` proves the result parses beside the merged map before
 * anything lands.
 *
 * `planFlows` at the bottom is the other half of the same axis and shares this
 * module for that reason rather than for the file cap: both write into
 * `architecture/`, and the two merges are read together — the map gains the
 * elements, the flow gains the ordered hops over them. It is a whole-file copy
 * where the landscape is a splice, because a flow is a document of its own and
 * there is nothing to merge partially.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { planWrite, readUtf8 } from "../../../core/staging/writes.js";
import { planLandscapeMerge } from "../../../core/c4/splice/landscape-merge.js";
import { spliceModel } from "../../../core/c4/splice/model/merge.js";
import { titleOf } from "../../../core/c4/splice/identity/edges.js";
import { parseServiceId } from "../../../core/kernel/ids/service.js";
import { landscapePath as landscapeFile } from "../../../core/repo/paths.js";
import { enumeratedServiceIds } from "../../../core/repo/service-target.js";
import { extendingModels } from "../../../core/c4/service-model/fleet/extending.js";
import { modelMergeErrors } from "./model/extending.js";
import { type Gated, type Plan } from "./state.js";
import { ArchiveFailure } from "./refusal.js";
import { featurePaths } from "../../../core/repo/paths.js";
import { featureFlows, livingFlowPath, USECASE_SUBDIR } from "../../../core/usecases/delta/flows.js";
import { featureDeployments, livingDeploymentPath } from "../../../core/deployment/delta.js";
import type { DocsDir } from "../../../core/kernel/ids/dirs.js";
import type { FleetContext } from "../../../core/fleet-context.js";

export async function planLandscape(
  config: { docsDir: DocsDir; fleet: FleetContext },
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
    // The feature tag is the whole selection mechanism of this merge, and since
    // LikeC4 1.59.0 a specification KIND can carry a tag that every element or
    // edge of that kind then inherits. A delta declaring its own feature tag on
    // a kind makes `newEls`/`newRels` below select the entire document —
    // including the context declarations the scaffold ships commented out
    // precisely so they are NOT merged — and archive would splice somebody
    // else's services into the fleet map at exit 0. Mechanical, so `--approve`
    // does not reach it, and refused before the merge is even planned.
    const kindTagged = [
      ...Object.entries(delta.specification?.elementKindTags ?? {}),
      ...Object.entries(delta.specification?.relationshipKindTags ?? {}),
    ].find(([, tags]) => tags.includes(id));
    if (kindTagged !== undefined) {
      throw new ArchiveFailure(
        "merge-failed",
        `delta.likec4 declares the feature tag '#${id}' on kind '${kindTagged[0]}' in its specification block, so every ` +
          `'${kindTagged[0]}' in the file inherits it — the merge would treat the whole document as this feature's ` +
          `additions, context elements included, and splice them into architecture/landscape.likec4. Nothing was ` +
          `written. Remove '#${id}' from the kind and tag only the declarations ${id} actually adds.`,
      );
    }
    const newEls = delta.elements.filter((e) => e.tags.includes(id));
    const newRels = delta.relationships.filter((r) => r.tags.includes(id));
    if (existsSync(landscapePath)) {
      const deltaText = await readUtf8(deltaLikec4);
      const plan = await planLandscapeMerge({
        landscapeText: await readUtf8(landscapePath),
        deltaText,
        deltaElements: delta.elements,
        newEls,
        newRels,
        featureId: id,
        // A service whose model EXTENDS the map owns its own interior, so the
        // merge routes what is nested under it into that model instead of the
        // map (verification 2026-09-04, E1).
        models: await extendingModels(config.docsDir, config.fleet),
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
      for (const additions of plan.models) {
        const content = spliceModel({ additions, deltaText, featureId: id });
        // The model's own parse net, and it has to be a PROJECT one: an
        // extending model resolves against the map, and against the map this
        // very archive would leave — so the merged landscape goes into the set
        // beside it. Refused here, at plan time, nothing written, exactly as an
        // unparseable merged landscape is.
        const errors = await modelMergeErrors({
          docsDir: config.docsDir,
          landscape: plan.content,
          model: { path: additions.model.path, content },
        });
        if (errors.length > 0) {
          throw new ArchiveFailure(
            "merge-failed",
            `the merged ${additions.model.path} would not parse (${errors.length} error(s): ${errors.slice(0, 3).join("; ")}) — ` +
              `nothing was written. This model is read beside architecture/landscape.likec4 and nothing else, so an addition ` +
              `fits only if the map declares its kind and every element it names. Most often it is a kind or tag missing from ` +
              `the map's specification block, or a reference to ANOTHER service's interior, which lives in that service's own ` +
              `model and is not in this project — draw that call service to service on the map instead. Fix the map's ` +
              `specification or the delta, then re-run`,
          );
        }
        writes.push(planWrite(join(config.docsDir, ...additions.model.path.split("/")), content));
        say(
          `  architecture: merged into ${additions.model.path} — ` +
            `+${additions.els.length} element(s), +${additions.rels.length} relationship(s)`,
        );
        for (const e of additions.els) say(`      + ${e.title} (${e.kind})`);
        for (const r of additions.rels) {
          say(`      + ${titleOf(delta.elements, r.source)} -> ${titleOf(delta.elements, r.target)}  "${r.title ?? ""}"`);
        }
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

/**
 * The flows this feature brings, copied into `architecture/usecases/`.
 *
 * A create-only whole-file copy, and the smallest merge in the command: the
 * document is views-only, it names nothing the landscape merge has not already
 * placed (`planFlowOverlay` in the gate is what proves that, before this runs),
 * and a flow the living tree already holds was refused at the gate
 * (`usecase.flow-exists`, `core/usecases/delta/flows.ts` has the reasoning). So
 * by the time this runs every path here is a file that does not exist, and
 * `planWrite` marks it `exclusive` — a race that created it between the gate and
 * the commit fails the write rather than overwriting somebody.
 *
 * It lives beside `planLandscape` rather than beside the requirement merges
 * because it writes into `architecture/`, and the two merges are read together:
 * the landscape gains the elements, the flow gains the hops over them.
 * `unarchive` needs nothing new — a create is undone by deleting, which the
 * snapshot manifest already records for every write in the plan.
 */
export async function planFlows(
  config: { docsDir: DocsDir },
  gated: Gated,
  plan: Plan,
  say: (line?: string) => void,
): Promise<void> {
  const flows = await featureFlows(gated.featureDir);
  if (flows.length === 0) return;
  for (const flow of flows) {
    plan.writes.push(planWrite(livingFlowPath(config.docsDir, flow.rel), await readUtf8(flow.path)));
    say(`  use case: ${flow.rel} — created architecture/${USECASE_SUBDIR}/${flow.rel}`);
  }
}

/**
 * The same copy for the third whole-file axis: the topology a feature brings.
 *
 * Beside `planFlows` rather than folded into it, because the two write to
 * different places — a flow into `architecture/usecases/`, a topology straight
 * into `architecture/` — and one function taking a subdirectory argument would
 * make that difference a parameter instead of a decision each axis states.
 * `unarchive` needs nothing here either: a create is undone by deleting.
 */
export async function planDeployments(
  config: { docsDir: DocsDir },
  gated: Gated,
  plan: Plan,
  say: (line?: string) => void,
): Promise<void> {
  const docs = await featureDeployments(gated.featureDir);
  if (docs.length === 0) return;
  for (const doc of docs) {
    plan.writes.push(planWrite(livingDeploymentPath(config.docsDir, doc.rel), await readUtf8(doc.path)));
    say(`  deployment: ${doc.rel} — created architecture/${doc.rel}`);
  }
}
