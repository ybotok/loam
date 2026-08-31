/**
 * Every refusal that happens before a byte is planned.
 *
 * They are gathered here because they share one doctrine that is easy to lose:
 * `--approve` overrides judgments about the FEATURE, and nothing else. A service
 * directory whose name the id grammar refuses, a living document holding git
 * conflict markers, a requirement outside `## Requirements` — those are
 * mechanical facts about paths and files, so `--approve` does not reach them,
 * and the dry run is gated too, since a plan built on one describes a merge loam
 * must never perform.
 *
 * `null` means the refusal has already been printed and the exit code set.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fail, repoPath, sayExplain } from "../../../core/envelope/json.js";
import { approveOverrides, gatesArchive, type Issue } from "../../../core/vocabulary/issue.js";
import { recoverInterruptedCommit } from "../../../core/staging/recovery/recover.js";
import { readUtf8 } from "../../../core/staging/writes.js";
import { loadFile } from "../../../core/c4/likec4.js";
import { archiveDir as archiveRoot, featurePaths, featureSpecPaths, SPEC_AXES } from "../../../core/repo/paths.js";
import { livingCapabilityPaths } from "../../../core/repo/authored/paths.js";
import { featureCapabilityDeltas } from "../../../core/capabilities/delta/tree.js";
import { locateServicePaths } from "../../../core/repo/service-target.js";
import { featureSpecServices, missingFeatureMessage, resolveFeature } from "../../../core/repo/repo.js";
import { featureCoherence } from "../../../core/coherence/coherence.js";
import {
  invalidSpecServiceFindings,
  livingMergeConflicts,
  unknownDeltaServices,
} from "../../../core/coherence/living.js";
import { SEVERITY_MARK } from "../../../core/vocabulary/report.js";
import { isRequirementsHeading, parseRequirements } from "../../../core/document/parse.js";
import { refuseFindings, refuseJson, sayRecovery, type ArchiveOptions } from "./refusal.js";
import { type Gated } from "./state.js";
import type { DocsDir } from "../../../core/kernel/ids/dirs.js";
import type { FleetContext } from "../../../core/fleet-context.js";

export async function gate(
  config: { docsDir: DocsDir; fleet?: FleetContext },
  featureId: string,
  opts: ArchiveOptions,
  say: (line?: string) => void,
): Promise<Gated | null> {
  const json = opts.json === true;
  const dryRun = opts.dryRun === true;
  // the living docs half-written, and every other command in loam would have
  // planned against them as if they were the truth. Under the same lock, so the
  // repair cannot race a writer. It refuses when the half-merged files have been
  // edited since — that is a human's call, not a merge's.
  const recovered = await recoverInterruptedCommit(config.docsDir);
  if (recovered !== null && !json) sayRecovery(recovered);

  const feature = await resolveFeature(config.docsDir, featureId, "exclude");
  if (!feature) {
    fail(json, "unknown-target", await missingFeatureMessage(config.docsDir, featureId));
    return null;
  }
  // The raw argument's last appearance: from here on the feature answers only to
  // its canonical id — tags, coherence, and the self-exclusion scans all match
  // on `id`, and `archive FEAT-5-slug` must plan exactly like `archive FEAT-5`.
  const { id, dirName, dir: featureDir } = feature;

  // Parse delta.likec4 ONCE for the whole run: the coherence gate and the
  // architecture merge below read the same file, and loading it spins up a
  // fresh Langium workspace each time. Nothing writes it in between.
  const deltaLikec4 = featurePaths(featureDir).delta;
  const deltaDoc = existsSync(deltaLikec4) ? await loadFile(deltaLikec4) : undefined;

  const deltaServices = await featureSpecServices(featureDir);
  // The business corpus's delta tree, walked once HERE and carried on `Gated`:
  // the conflict-marker scan, the strayed-requirement scan and the merge itself
  // all ask which capability documents this feature rewrites, and three walks
  // are three chances to answer differently. `featureCoherence` below walks it
  // again on its own — it is called without `config.fleet`, the same
  // no-context path `core/coherence/declared.ts` already documents paying for
  // the arch delta — so this is not the run's only walk, only the one every
  // phase downstream of the gate shares.
  const capabilityDeltas = (
    config.fleet === undefined
      ? await featureCapabilityDeltas(featureDir)
      : await config.fleet.featureCapabilityDeltas(featureDir)
  ).docs;

  // A `specs/<svc>/` whose NAME is not a legal service id, refused before
  // anything joins that name into a path: the conflict scan below probes
  // `services/<svc>/<axis>` with it, and the requirements merge would
  // materialise `services/<svc>/` from it — a directory `service.id-invalid`
  // then calls an error on the next `validate --all`, and one no loam command
  // can address or re-create. The set comes from coherence/living.ts's
  // `invalidSpecServiceFindings` — the same function validate reads — so the
  // two gates cannot drift.
  //
  // --approve does not apply, exactly as with the conflict-marker refusal
  // below: --approve overrides judgments about the FEATURE, and a name the id
  // grammar refuses is a mechanical fact about the path it would become. The
  // dry run is gated too: a plan built on that name describes a merge loam
  // must never perform.
  const illegalServices = await invalidSpecServiceFindings(featureDir);
  if (illegalServices.length > 0) {
    const msg = `archive ${id} — BLOCKED: ${illegalServices.length} per-service delta(s) named by an illegal service id; --approve does not override this`;
    if (json) {
      refuseFindings("not-coherent", msg, illegalServices, `features/${dirName}`);
      return null;
    }
    console.error(`${msg}:`);
    for (const f of illegalServices) console.error(`  ✗ ${f.message}`);
    console.error(`\n--approve does not override this — the directory the merge would create is one loam can never address, mechanically.`);
    // Every arm in this file refuses by hand — it prints a headline, a list and
    // a closing sentence rather than the one message `fail()` takes — so the
    // code and its lookup have to be asked for explicitly. `sayExplain` is
    // called rather than the format being copied six times, and the code passed
    // is the SAME one the `--json` branch a few lines up emits: text and
    // envelope must name one refusal, or a reader who switches modes to find
    // the code is handed a different answer than the one they saw.
    sayExplain("not-coherent");
    process.exitCode = 1;
    return null;
  }

  // Git conflict markers in a LIVING document this merge would rewrite, before
  // anything else is asked of it. Both sides of somebody's merge are in the
  // file, so nothing it says is anyone's text — and the requirements rewrite
  // deletes whichever marker lines fall inside the section it owns, turning a
  // conflict anyone can see into a file nobody can tell is wrong. Checked ahead
  // of the coherence gate for `inspectLandscape`'s reason: a conflicted
  // document parses, so every verdict downstream of it is an opinion about half
  // of two people's work.
  //
  // --approve does not apply, exactly as with the strayed-requirement refusal
  // below: --approve overrides judgments about the FEATURE, and this is a fact
  // about the living document.
  const conflicted = await livingMergeConflicts(config.docsDir, deltaServices, capabilityDeltas.map((d) => d.id));
  if (conflicted.length > 0) {
    const msg = `archive ${id} — BLOCKED: ${conflicted.length} living document(s) still hold git conflict markers`;
    if (json) {
      refuseFindings("merge-failed", msg, conflicted, `features/${dirName}`);
      return null;
    }
    console.error(`${msg}:`);
    for (const f of conflicted) console.error(`  ✗ ${f.message}`);
    console.error(`\n--approve does not override this — the loss is mechanical, not a judgment call.`);
    sayExplain("merge-failed");
    process.exitCode = 1;
    return null;
  }

  // Gate: GATING issues block the archive. Severity and gating are two
  // different questions (issue.ts): errors gate because the merge would write
  // something wrong, and the rare warning marked `gates` blocks too — the
  // document is legal but the merge would drop authored content. Advisory
  // warnings are printed (and carried into --json) but never block, matching
  // validate's own doctrine (report.ts: "warnings never gate"). --approve
  // overrides the gating issues ONLY, and must say exactly which ones it is
  // walking past. A dry run is gated too: a plan for a merge that would be
  // refused describes nothing that will happen.
  const issues = await featureCoherence({ docsDir: config.docsDir, featureDir, featureId: id, preloadedDelta: deltaDoc });
  // The issues --approve cannot move, carved out before the gate below reads
  // the rest. The register is issue.ts's `approveOverrides` — the same data
  // the `overridable` key in the envelope is resolved from — never a code
  // string spelled here, because two spellings of "what the flag moves" would
  // drift. Today the register holds one code: a `metadata { service }` binding
  // the id grammar refuses, anywhere in a tagged element's spliced block. The
  // landscape merge would splice that name into the living map verbatim, and
  // the new-service scan would probe `services/<binding>/` with it — a '../'
  // collapses the probe out of services/ altogether — so the refusal is a
  // mechanical fact about the path the name becomes, not a judgment about the
  // feature. Same doctrine as the illegal-specs-name refusal above; the dry
  // run is gated the same way, and the --json envelope stays not-coherent
  // with every issue attached, exactly like the overridable branch below, so
  // a consumer branches on the code and not on which refusal path fired.
  const nonOverridable = issues.filter((i) => !approveOverrides(i));
  if (nonOverridable.length > 0) {
    const msg = `archive ${id} — BLOCKED: ${nonOverridable.length} element binding(s) name an illegal service id; --approve does not override this`;
    if (json) {
      refuseJson("not-coherent", msg, issues, `features/${dirName}`);
      return null;
    }
    console.error(`${msg}:`);
    // The whole list, not just the carve-out: the reader is about to fix the
    // feature, and the issues --approve COULD have moved are work they still
    // owe — hiding them here made the second refusal a surprise. The closing
    // line says which of the marks the flag cannot move.
    for (const i of issues) console.error(`  ${SEVERITY_MARK[i.severity]} ${i.message}`);
    console.error(
      `\nOf these, --approve does not override the ${nonOverridable.length} illegal binding(s) — the merge would write a name loam can never resolve into services/, mechanically. Fix the binding(s); the other issues gate as usual.`,
    );
    sayExplain("not-coherent");
    process.exitCode = 1;
    return null;
  }
  const gating = issues.filter(gatesArchive);
  const advisory = issues.filter((i) => !gatesArchive(i));
  if (gating.length > 0 && !opts.approve) {
    const msg = `archive ${id} — BLOCKED: not coherent (${gating.length} gating issue(s), ${advisory.length} advisory warning(s))`;
    if (json) {
      refuseJson("not-coherent", msg, issues, `features/${dirName}`);
      return null;
    }
    console.error(`${msg}:`);
    for (const i of issues) console.error(`  ${SEVERITY_MARK[i.severity]} ${i.message}`);
    console.error(`\nFix the gating issues (advisory warnings never block), or re-run with --approve to override them (may corrupt the living docs).`);
    sayExplain("not-coherent");
    process.exitCode = 1;
    return null;
  }
  if (gating.length > 0) {
    say(`⚠ archiving despite ${gating.length} gating issue(s) (--approve):`);
    for (const i of gating) say(`  ${SEVERITY_MARK[i.severity]} ${i.message}`);
    say();
  }
  if (advisory.length > 0) {
    say(`⚠ ${advisory.length} warning(s) (non-blocking):`);
    for (const i of advisory) say(`  ⚠ ${i.message}`);
    say();
  }

  // A `specs/<svc>/` addressed to a service that exists nowhere. `validate`
  // graded this and archive did not, which is the half that costs something:
  // `specs/<svc>/` is what the merge MATERIALISES `services/<svc>/` from, so a
  // one-character slip in `--touches` archived at exit 0 and left the fleet a
  // living service nobody meant to adopt. The set comes from coherence/living.ts's
  // `unknownDeltaServices` — the same function validate reads — so the two
  // gates cannot drift into disagreeing about which ids are real.
  //
  // Gated exactly like a coherence error, --approve included: which service you
  // meant is a judgment about the FEATURE. A feature that genuinely introduces
  // one has a better escape hatch than --approve anyway — tag its element in
  // delta.likec4, which is also what makes the fleet map true afterwards.
  const unknownServices = await unknownDeltaServices(config.docsDir, featureDir, id, { preloadedDelta: deltaDoc });
  if (unknownServices.length > 0 && !opts.approve) {
    const msg = `archive ${id} — BLOCKED: ${unknownServices.length} per-service delta(s) address a service that does not exist`;
    if (json) {
      refuseFindings("not-coherent", msg, unknownServices, `features/${dirName}`);
      return null;
    }
    console.error(`${msg}:`);
    for (const f of unknownServices) console.error(`  ✗ ${f.message}`);
    console.error(`\nFix the id, or introduce the service in this feature's delta.likec4 — or re-run with --approve to create it anyway.`);
    sayExplain("not-coherent");
    process.exitCode = 1;
    return null;
  }
  if (unknownServices.length > 0) {
    say(`⚠ archiving despite ${unknownServices.length} unknown service(s) (--approve) — this merge creates them:`);
    for (const f of unknownServices) say(`  ✗ ${f.message}`);
    say();
  }

  // A LIVING requirement outside `## Requirements` is a merge loam cannot do
  // correctly: the rewrite replaces only the requirements RUN inside that
  // section (rewriteRequirementsRun) while parseRequirements collects from
  // every section — so the strayed requirement keeps its authored copy in the
  // preserved prose AND lands again in the rewritten run, and the next
  // archive's MODIFIED replaces only one of them. Refused rather than
  // repaired: excising blocks from prose programmatically would be archive
  // editing text it does not understand. --approve does not apply — it
  // overrides judgments about the FEATURE, and this is neither.
  const strayed: Issue[] = [];
  const scanStrayed = async (livingPath: string, subject: string): Promise<void> => {
    if (!existsSync(livingPath)) return;
    for (const r of parseRequirements(await readUtf8(livingPath))) {
      // The ONE definition of the heading (spec.ts): the guard and the rewrite
      // boundary match the same way, so they cannot disagree about "outside".
      if (r.section !== undefined && isRequirementsHeading(r.section)) continue;
      const where = r.section === undefined ? "above every heading" : `under '${r.section}'`;
      strayed.push({
        severity: "error",
        code: "living.requirement-outside-requirements",
        subject,
        message: `${subject}: living requirement '${r.name}' sits ${where} in ${repoPath(config.docsDir, livingPath)} — the merge rewrites only '## Requirements', so it would land in the file twice. Re-home it under '## Requirements' first, then re-run.`,
      });
    }
  };
  for (const svc of deltaServices) {
    for (const axis of SPEC_AXES) {
      if (!existsSync(featureSpecPaths(featureDir, svc)[axis.key])) continue;
      // The shared context, because this sits in a deltaServices × SPEC_AXES
      // loop: without it every iteration re-walks and re-reads the fleet.
      await scanStrayed((await locateServicePaths(config.docsDir, svc, config.fleet))[axis.key], svc);
    }
  }
  // The business corpus, for the identical mechanical reason: a capability
  // document is narrative ABOVE `## Requirements`, `rewriteRequirementsRun`
  // rewrites only the run inside that heading, and a requirement filed under
  // `## Notes` would keep its authored copy in the preserved prose AND land
  // again in the rewritten run.
  for (const doc of capabilityDeltas) {
    await scanStrayed(livingCapabilityPaths(config.docsDir, doc.id).spec, doc.id);
  }
  if (strayed.length > 0) {
    const msg = `archive ${id} — BLOCKED: ${strayed.length} living requirement(s) outside '## Requirements'`;
    if (json) {
      refuseJson("living-outside-requirements", msg, strayed, `features/${dirName}`);
      return null;
    }
    console.error(`${msg}:`);
    for (const i of strayed) console.error(`  ✗ ${i.message}`);
    console.error(`\n--approve does not override this — the duplication is mechanical, not a judgment call.`);
    sayExplain("living-outside-requirements");
    process.exitCode = 1;
    return null;
  }

  // Pre-flight: the archive destination must be free, or the final move would fail
  // after the living docs were already rewritten.
  const archiveDir = archiveRoot(config.docsDir);
  const archiveDest = join(archiveDir, dirName);
  if (existsSync(archiveDest)) {
    fail(json, "archive-exists", `archive ${id} — BLOCKED: features/archive/${dirName} already exists. Remove or rename it, then re-run.`);
    return null;
  }

  say(`archive ${id}${dryRun ? "  (dry run)" : ""}\n`);

  return {
    id,
    dirName,
    featureDir,
    deltaDoc,
    deltaServices,
    capabilityDeltas,
    gating,
    advisory,
    archiveDir,
    archiveDest,
    recovered,
    issues,
  };
}
