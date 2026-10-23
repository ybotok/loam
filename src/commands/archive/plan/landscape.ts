/**
 * The fleet map merge, the flows drawn over it, and the services this archive
 * brings into existence.
 *
 * The landscape is the one document every feature writes into, so it is spliced
 * rather than rewritten: the authored file keeps its shape and the delta's
 * elements are placed into it. A service arriving on the architecture axis alone
 * has no `model.likec4` yet, and the finding for that is carried out of the plan
 * — `validate` would report it next, at the same severity, and reporting it here
 * is what stops that being a surprise.
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
import { projectDocumentsBesideMap } from "../../../core/c4/project/architecture.js";
import { spliceModel } from "../../../core/c4/splice/model/merge.js";
import { titleOf } from "../../../core/c4/splice/identity/edges.js";
import { parseServiceId, type PathableService } from "../../../core/kernel/ids/service.js";
import { isPathInside } from "../../../core/kernel/path-safety.js";
import { landscapePath as landscapeFile, unfiledServicePaths } from "../../../core/repo/paths.js";
import { enumeratedServiceIds, locateServicePaths } from "../../../core/repo/service-target.js";
import { featureSpecServices } from "../../../core/repo/repo.js";
import { createdServiceModels } from "../../../core/c4/service-model/created/models.js";
import { extendingModels } from "../../../core/c4/service-model/fleet/extending.js";
import { modelMergeErrors } from "./model/extending.js";
import { type Gated, type Plan } from "./state.js";
import { CodedFailure, repoPath } from "../../../core/envelope/json.js";
import { featurePaths } from "../../../core/repo/paths.js";
import { featureFlows, livingFlowPath, USECASE_SUBDIR } from "../../../core/usecases/delta/flows.js";
import { featureServiceFlows, livingServiceFlowPath, SERVICE_FLOW_DIR } from "../../../core/usecases/delta/service/slot.js";
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
  // "New" is enumeration membership, not an existsSync of services/<svc>/ at
  // the root: a FILED service exists wherever the tree walk found it, and the
  // root probe would grade every filed service as newly created here.
  const enumerated = new Set<string>(await enumeratedServiceIds(config.docsDir));
  // The empty extending model of every service this archive creates and the
  // merged map draws — the rule, and the case for writing it, are
  // `createdServiceModels`'s. With no delta or no map there is no merge, and
  // no model.
  const fresh =
    deltaDoc === undefined || !existsSync(landscapePath)
      ? []
      : await createdServiceModels({
          docsDir: config.docsDir,
          featureDir,
          featureId: id,
          drawn: [...(await config.fleet.loadLikeC4(landscapePath)).elements, ...deltaDoc.elements.filter((e) => e.tags.includes(id))],
          fleet: config.fleet,
        });
  // The services that leave this archive with a model.likec4 it wrote.
  const modelled = new Set<string>();
  if (deltaDoc !== undefined) {
    const delta = deltaDoc;
    if (delta.errors.length > 0) {
      // --approve overrides loam's JUDGMENT about coherence, never its ability to
      // read an axis. Skipping here would silently drop one merge axis in the one
      // command engineered against quiet partial merges — same rule as an
      // unparseable landscape or openapi: the plan stops before anything is written.
      throw new CodedFailure(
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
      throw new CodedFailure(
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
        // The tags a relationship kind gives every edge of it: the parsed
        // additions carry them, the delta's statements do not.
        deltaKindTags: delta.specification?.relationshipKindTags ?? {},
        // A service whose model EXTENDS the map owns its own interior, so the
        // merge routes what is nested under it into that model instead of the
        // map (verification 2026-09-04, E1) — and so does a service this
        // archive creates, whose model is written below.
        models: [...(await extendingModels(config.docsDir, config.fleet)), ...fresh],
        // What `modelMergeErrors` below proves each model beside, so a kind or
        // tag another `architecture/` document declares serves the model too.
        projectDocuments: () => projectDocumentsBesideMap(config.docsDir),
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
        const content = spliceModel({
          additions,
          deltaText,
          featureId: id,
          deltaKindTags: delta.specification?.relationshipKindTags ?? {},
        });
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
          throw new CodedFailure(
            "merge-failed",
            `the merged ${additions.model.path} would not parse (${errors.length} error(s): ${errors.slice(0, 3).join("; ")}) — ` +
              `nothing was written. This model is read inside the architecture/ project — the merged landscape and the ` +
              `other architecture/ documents — and no other service's model, so an addition fits only if every element ` +
              `it names is in that project (a kind, tag or color nothing there declares is refused before this, by name). ` +
              `Most often it is a reference to ANOTHER service's interior, which lives in that service's own model and is ` +
              `not in this project — draw that call service to service on the map instead. Fix the delta, then re-run`,
          );
        }
        writes.push(planWrite(join(config.docsDir, ...additions.model.path.split("/")), content));
        const created = fresh.some((m) => m.path === additions.model.path);
        if (created) modelled.add(additions.model.service);
        say(
          `  architecture: ${created ? "created" : "merged into"} ${additions.model.path} — ` +
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
  // A created service the delta drew no interior for still gets its model:
  // empty, which is the whole of what the archive knows about its inside.
  for (const model of fresh.filter((m) => !modelled.has(m.service))) {
    writes.push(planWrite(join(config.docsDir, ...model.path.split("/")), model.text));
    modelled.add(model.service);
    say(`  architecture: created ${model.path} — empty; ${model.service}'s containers go in an \`extend\` block there`);
  }

  // A service this archive BRINGS INTO EXISTENCE without writing its model
  // arrives without the one file `validate` demands of every service. Two
  // shapes: one arriving on the architecture axis alone — a binding the map
  // gains with no `specs/<svc>/` in the feature, so no directory either, and a
  // model would be the one document in a directory the archive invented — and
  // a `specs/<svc>/` the merged map never draws, which the gate calls an unknown
  // service and only `--approve` brings here. The archive says so instead, and
  // stops claiming the docs are complete. Non-gating: the merge is correct;
  // what is missing is the next step, and refusing here would make onboarding
  // a new service impossible in one command.
  const newServices = [...new Set([...deltaServices, ...architectureServices])].filter(
    (svc) => !enumerated.has(svc),
  );
  await sayUnfiled(config, fresh.map((m) => m.service), say);
  // Whether a planned write lands in the service's would-be directory — the
  // spec merge writes nothing for a delta that leaves no requirements, and then
  // there is no directory to speak of.
  const createsDir = (svc: PathableService): boolean => {
    const dir = unfiledServicePaths(config.docsDir, svc).dir;
    return writes.some((w) => w.content !== null && isPathInside(dir, w.path));
  };
  for (const svc of newServices.filter((s) => !modelled.has(s))) {
    // `validate --all` reports the two under different codes, both errors: the
    // directory a requirement delta creates with no model in it is the service
    // target's `service.no-model`; a binding with no directory behind it, the
    // fleet map's `landscape.binding-unknown`. The message names the one that
    // fires, and a service for which neither lands is owed nothing.
    const createsItsDir = deltaServices.some((d) => d === svc) && createsDir(svc);
    if (!createsItsDir && !architectureServices.has(svc)) continue;
    const owed = createsItsDir
      ? { creates: `this archive creates services/${svc}/, but nothing writes services/${svc}/model.likec4`, reports: "service.no-model" }
      : { creates: `this archive puts '${svc}' in the landscape, but the fleet has no services/${svc}/ at all`, reports: "landscape.binding-unknown" };
    // An ERROR that does not gate — the two questions `Issue` keeps apart
    // (core/vocabulary/issue.ts). Severity says whether the documents are valid,
    // and validate files either shape as an error: the plan used to call it a
    // warning, so the same fact read as advice here and as a failure one
    // command later (the real-fleet review, 2026-10-21). Gating says whether the
    // MERGE is safe, and it is — what is missing is the next step, as above.
    planWarns.push({
      severity: "error",
      gates: false,
      code: "service.no-model",
      subject: svc,
      message: `${svc}: ${owed.creates} — 'loam validate --all' will report ${owed.reports}, an error, until it exists. Run 'loam adopt --service ${svc}' from the service repo, or write the model by hand.`,
    });
  }
}

/**
 * The one step left for a service the archive creates in a tree that files its
 * services: moving it there. Printed only when the tree has a subsystem — in a
 * flat tree every service is unfiled and that is normal, never a finding — and
 * never as a guess at WHICH subsystem: the map's nesting is not a placement the
 * tree may read.
 */
async function sayUnfiled(config: { docsDir: DocsDir; fleet: FleetContext }, created: string[], say: (line?: string) => void): Promise<void> {
  // No `services/` yet is a flat tree too — and the walk refuses a docs repo without one.
  if (created.length === 0 || !existsSync(join(config.docsDir, "services"))) return;
  if ((await config.fleet.fleetTree(config.docsDir)).subsystems.length === 0) return;
  for (const svc of created) {
    say(`  ${svc}: created unfiled, at services/${svc}/ — 'loam subsystem move ${svc} --into <subsystem>' files it`);
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
 * The flows this feature brings for a SERVICE, written beside its model — under
 * `services/<…>/<svc>/usecases/`, at the path the document has inside
 * `features/<FEAT>/specs/<svc>/usecases/` (`core/usecases/delta/service/slot.ts`).
 *
 * Unlike `planFlows`, not create-only. A document whose living twin exists
 * REPLACES it, and one holding no LikeC4 statement RETIRES it — a delete. Both
 * were allowed at the gate only when the twin claims a requirement this feature
 * MODIFIES or REMOVES (`usecase.flow-exists` otherwise), and a retirement of
 * nothing was refused there too (`usecase.flow-unknown`); so a twin missing
 * here is a race since the gate, and refused as one rather than reported done.
 * A service this archive creates is unfiled, which is where `locateServicePaths`
 * answers for an id the tree does not hold yet.
 *
 * `unarchive` needs nothing new: an overwrite's pre-image and a delete's are in
 * the snapshot like every other write, and a create is undone by deleting.
 */
export async function planServiceFlows(
  config: { docsDir: DocsDir; fleet: FleetContext },
  gated: Gated,
  plan: Plan,
  say: (line?: string) => void,
): Promise<void> {
  const docs = await featureServiceFlows(gated.featureDir, await featureSpecServices(gated.featureDir, config.fleet));
  for (const doc of docs) {
    const target = livingServiceFlowPath((await locateServicePaths(config.docsDir, doc.service, config.fleet)).dir, doc.rel);
    const file = repoPath(config.docsDir, target);
    const at = `${doc.service}/${SERVICE_FLOW_DIR}/${doc.rel}`;
    if (doc.kind === "flow") {
      const act = existsSync(target) ? "replaced" : "created";
      plan.writes.push(planWrite(target, await readUtf8(doc.path)));
      say(`  use case: ${at} — ${act} ${file}`);
    } else if (doc.kind === "retirement" && existsSync(target)) {
      plan.writes.push({ path: target, content: null });
      say(`  use case: ${at} — retired ${file}`);
    } else {
      // Both arms were refused at the gate, with no `--approve` past them
      // (`usecase.flow-unknown`, and `usecase.flow-invalid` for an empty
      // document): reaching here is the tree moving under the gate.
      throw new CodedFailure("merge-failed", `${file} is not what the gate graded ${at} against — nothing was written; re-run`);
    }
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
