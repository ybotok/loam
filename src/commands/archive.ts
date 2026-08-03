import type { Command } from "commander";
import { existsSync } from "node:fs";
import { readFile, mkdir, rename } from "node:fs/promises";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { isMap, parseDocument } from "yaml";
import { loadConfig } from "../core/config.js";
import { fail, emitJson, repoPath, reportNoConfig, type ErrorCode } from "../core/json.js";
import { gatesArchive, type Issue } from "../core/issue.js";
import {
  message,
  quietRm,
  rollbackError,
  rollbackStaged,
  snapshotDir,
  stageWrites,
  swapStaged,
  writeSnapshot,
  SNAPSHOT_DIR,
  type PlannedWrite,
} from "../core/staging.js";
import {
  loadFile,
  loadSource,
  maskSource,
  matchBrace,
  scanModel,
  type Elem,
  type Rel,
  type ScannedElement,
  type ScannedModel,
  type ScannedRel,
} from "../core/likec4.js";
import {
  featurePaths,
  featureSpecPaths,
  featureSpecServices,
  featuresDir as featuresRoot,
  landscapePath as landscapeFile,
  missingFeatureMessage,
  resolveFeature,
  servicePaths,
  SPEC_AXES,
} from "../core/repo.js";
import { HTTP_METHODS, operationIds } from "../core/openapi.js";
import { featureCoherence } from "../core/coherence.js";
import {
  parseRequirements,
  serializeRequirements,
  applyRequirementDelta,
  isRequirementsHeading,
  sectionHeadings,
  splitRequirementsSection,
  type Requirement,
} from "../core/spec.js";

interface ArchiveOptions {
  approve?: boolean;
  dryRun?: boolean;
  json?: boolean;
}

/**
 * A refusal or failure with its stable `--json` code attached. Thrown from the
 * plan phase (nothing written yet) and from the commit's rollback path (whose
 * message says whether the rollback held). Anything ELSE that escapes runArchive
 * is a bug, and the action handler reports it as `internal`.
 */
class ArchiveFailure extends Error {
  constructor(
    readonly code: ErrorCode,
    msg: string,
  ) {
    super(msg);
  }
}

export function registerArchive(program: Command): void {
  program
    .command("archive")
    .argument("<featureId>", "feature id, e.g. FEAT-101")
    .description("Merge a shipped feature's deltas into the living specs + model, then archive it")
    .option("--approve", "archive despite GATING coherence issues (may corrupt the living docs); advisory warnings never block")
    .option("--dry-run", "print the whole merge plan and write nothing")
    .option("--json", "emit the machine contract instead of the human view")
    .action(async (featureId: string, opts: ArchiveOptions) => {
      const json = opts.json === true;
      try {
        await runArchive(featureId, opts);
      } catch (err) {
        // Plan-phase failures happen before any write; commit-phase failures are
        // rolled back by runArchive, which says so in the message it throws.
        const code = err instanceof ArchiveFailure ? err.code : "internal";
        fail(json, code, `archive ${featureId} failed: ${message(err)}`);
      }
    });
}

/**
 * An Issue as the `--json` envelope spells it — the Finding shape, minus details.
 * `gates` is always present and already resolved: a consumer must not have to
 * re-implement the severity default to know what blocks archive.
 */
function issueJson(i: Issue): Record<string, unknown> {
  return {
    severity: i.severity,
    code: i.code,
    gates: gatesArchive(i),
    ...(i.subject === undefined ? {} : { subject: i.subject }),
    message: i.message,
  };
}

/** The failure envelope plus the issues that caused it, so a caller need not re-run validate. */
function refuseJson(code: ErrorCode, msg: string, issues: Issue[]): void {
  console.log(JSON.stringify({ ok: false, error: { code, message: msg }, issues: issues.map(issueJson) }, null, 2));
  process.exitCode = 1;
}

async function runArchive(featureId: string, opts: ArchiveOptions): Promise<void> {
  const dryRun = opts.dryRun === true;
  const json = opts.json === true;
  // All prose goes through here so `--json` keeps stdout a single JSON document.
  const say = (line = ""): void => {
    if (!json) console.log(line);
  };
  const config = await loadConfig();
  if (!config) {
    reportNoConfig(json);
    return;
  }
  const featuresDir = featuresRoot(config.docsDir);
  const feature = await resolveFeature(config.docsDir, featureId, "exclude");
  if (!feature) {
    fail(json, "unknown-target", await missingFeatureMessage(config.docsDir, featureId));
    return;
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

  // Gate: GATING issues block the archive. Severity and gating are two
  // different questions (issue.ts): errors gate because the merge would write
  // something wrong, and the rare warning marked `gates` blocks too — the
  // document is legal but the merge would drop authored content. Advisory
  // warnings are printed (and carried into --json) but never block, matching
  // validate's own doctrine (report.ts: "warnings never gate"). --approve
  // overrides the gating issues ONLY, and must say exactly which ones it is
  // walking past. A dry run is gated too: a plan for a merge that would be
  // refused describes nothing that will happen.
  const issues = await featureCoherence(config.docsDir, featureDir, id, deltaDoc);
  const gating = issues.filter(gatesArchive);
  const advisory = issues.filter((i) => !gatesArchive(i));
  if (gating.length > 0 && !opts.approve) {
    const msg = `archive ${id} — BLOCKED: not coherent (${gating.length} gating issue(s), ${advisory.length} advisory warning(s))`;
    if (json) {
      refuseJson("not-coherent", msg, issues);
      return;
    }
    console.error(`${msg}:`);
    for (const i of issues) console.error(`  ${i.severity === "error" ? "✗" : "⚠"} ${i.message}`);
    console.error(`\nFix the gating issues (advisory warnings never block), or re-run with --approve to override them (may corrupt the living docs).`);
    process.exitCode = 1;
    return;
  }
  if (gating.length > 0) {
    say(`⚠ archiving despite ${gating.length} gating issue(s) (--approve):`);
    for (const i of gating) say(`  ${i.severity === "error" ? "✗" : "⚠"} ${i.message}`);
    say();
  }
  if (advisory.length > 0) {
    say(`⚠ ${advisory.length} warning(s) (non-blocking):`);
    for (const i of advisory) say(`  ⚠ ${i.message}`);
    say();
  }

  const deltaServices = await featureSpecServices(featureDir);

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
  for (const svc of deltaServices) {
    for (const axis of SPEC_AXES) {
      if (!existsSync(featureSpecPaths(featureDir, svc)[axis.key])) continue;
      const livingPath = servicePaths(config.docsDir, svc)[axis.key];
      if (!existsSync(livingPath)) continue;
      for (const r of parseRequirements(await readFile(livingPath, "utf8"))) {
        // The ONE definition of the heading (spec.ts): the guard and the rewrite
        // boundary match the same way, so they cannot disagree about "outside".
        if (r.section !== undefined && isRequirementsHeading(r.section)) continue;
        const where = r.section === undefined ? "above every heading" : `under '${r.section}'`;
        strayed.push({
          severity: "error",
          code: "living.requirement-outside-requirements",
          subject: svc,
          message: `${svc}: living requirement '${r.name}' sits ${where} in ${repoPath(config.docsDir, livingPath)} — the merge rewrites only '## Requirements', so it would land in the file twice. Re-home it under '## Requirements' first, then re-run.`,
        });
      }
    }
  }
  if (strayed.length > 0) {
    const msg = `archive ${id} — BLOCKED: ${strayed.length} living requirement(s) outside '## Requirements'`;
    if (json) {
      refuseJson("living-outside-requirements", msg, strayed);
      return;
    }
    console.error(`${msg}:`);
    for (const i of strayed) console.error(`  ✗ ${i.message}`);
    console.error(`\n--approve does not override this — the duplication is mechanical, not a judgment call.`);
    process.exitCode = 1;
    return;
  }

  // Pre-flight: the archive destination must be free, or the final move would fail
  // after the living docs were already rewritten.
  const archiveDir = join(featuresDir, "archive");
  const archiveDest = join(archiveDir, dirName);
  if (existsSync(archiveDest)) {
    fail(json, "archive-exists", `archive ${id} — BLOCKED: features/archive/${dirName} already exists. Remove or rename it, then re-run.`);
    return;
  }

  say(`archive ${id}${dryRun ? "  (dry run)" : ""}\n`);

  // PLAN — compute every merge in memory. Nothing is written until the whole plan
  // succeeds, so a failure on any axis leaves the living docs untouched.
  const writes: PlannedWrite[] = [];
  // Warnings born in the plan itself (openapi.op-modified,
  // openapi.component-modified) — printed with the plan and carried into the
  // --json envelope beside the coherence warnings.
  const planWarns: Issue[] = [];
  // Gating issues born in the plan itself (openapi.ref-unresolved). The gate
  // ran before the plan, but only the computed merge can see these; they block
  // the same way, and --approve overrides them the same way.
  const planGates: Issue[] = [];

  // 1. Requirements merge — apply ADDED/MODIFIED/REMOVED into each living service
  // spec. ONE code path for the pair of requirement-carrying files: the business
  // spec.md and the architecture arch.spec.md ride the same delta algebra, the
  // same prose-preserving rewrite and the same guards, parameterized by filename
  // (SPEC_AXES) — a fork here would be two places the merge could disagree.
  for (const svc of deltaServices) {
    for (const axis of SPEC_AXES) {
      const deltaPath = featureSpecPaths(featureDir, svc)[axis.key];
      if (!existsSync(deltaPath)) continue;
      const deltaReqs = parseRequirements(await readFile(deltaPath, "utf8"));

      const livingPath = servicePaths(config.docsDir, svc)[axis.key];
      if (!existsSync(livingPath)) {
        // New service (or first arch spec) — create the living file from the
        // ADDED/MODIFIED requirements.
        const created = applyRequirementDelta([], deltaReqs);
        if (created.length === 0) {
          say(`  ${axis.label}: ${svc} — nothing to merge (delta leaves no requirements), no living ${axis.file} created`);
          continue;
        }
        const heading = axis.key === "spec" ? svc : `${svc} — architecture`;
        const frontmatter = `---\nservice: ${svc}\nstatus: draft\n---\n\n# ${heading}\n\n`;
        writes.push({ path: livingPath, content: `${frontmatter}## Requirements\n\n${serializeRequirements(created)}` });
        say(`  ${axis.label}: ${svc} — created living ${axis.file} (${created.length} requirement(s))`);
        continue;
      }
      const livingText = await readFile(livingPath, "utf8");
      // TWO `## Requirements` headings would put the rewrite's one-section
      // invariant to a choice it must not make: the run of the first would be
      // rewritten while the second survived verbatim in the tail — and its
      // requirements, collected by parseRequirements, would land in the run TOO.
      // Mechanical, like a model-less landscape, so merge-failed, not --approve.
      const reqHeadings = sectionHeadings(livingText).filter((h) => isRequirementsHeading(h.text));
      if (reqHeadings.length > 1) {
        throw new ArchiveFailure(
          "merge-failed",
          `living ${axis.file} for ${svc} has ${reqHeadings.length} '## Requirements' headings (lines ${reqHeadings.map((h) => h.line).join(", ")}) — the merge rewrites ONE requirements section and cannot choose; merge them into one, then re-run`,
        );
      }
      const merged = applyRequirementDelta(parseRequirements(livingText), deltaReqs);
      writes.push({ path: livingPath, content: rewriteRequirementsRun(livingText, merged) });

      const c = summarize(deltaReqs);
      say(`  ${axis.label}: ${svc} ← +${c.ADDED} ~${c.MODIFIED} -${c.REMOVED} (now ${merged.length} total)`);
    }
  }

  // 1b. OpenAPI merge — fold the feature's openapi deltas into the living service APIs.
  for (const svc of deltaServices) {
    const featOpenapi = featureSpecPaths(featureDir, svc).openapi;
    if (!existsSync(featOpenapi)) continue;
    const featText = await readFile(featOpenapi, "utf8");
    const livingOpenapi = servicePaths(config.docsDir, svc).openapi;
    const ops = await operationIds(featOpenapi);
    if (!existsSync(livingOpenapi)) {
      writes.push({ path: livingOpenapi, content: featText });
      say(`  openapi: ${svc} — created (${ops.join(", ")})`);
    } else {
      const { text, modified, componentsModified, unresolved } = mergeOpenapiPaths(
        await readFile(livingOpenapi, "utf8"),
        featText,
        svc,
      );
      if (text !== null) {
        writes.push({ path: livingOpenapi, content: text });
        say(`  openapi: ${svc} — merged (${ops.join(", ")})`);
      }
      for (const label of modified) {
        planWarns.push({
          severity: "warn",
          code: "openapi.op-modified",
          subject: svc,
          message: `${svc}: the delta redefines ${label}, which the living OpenAPI already has — the merge overwrites the living operation wholesale`,
        });
        say(`      ⚠ overwrites ${label} — the living definition differs`);
      }
      for (const comp of componentsModified) {
        planWarns.push({
          severity: "warn",
          code: "openapi.component-modified",
          subject: svc,
          message: `${svc}: the merged operations carry component '${comp}', which the living OpenAPI already defines differently — the merge overwrites the living component wholesale`,
        });
        say(`      ⚠ overwrites component ${comp} — the living definition differs`);
      }
      for (const u of unresolved) {
        planGates.push({
          severity: "error",
          code: "openapi.ref-unresolved",
          subject: svc,
          message: `${svc}: $ref '${u.ref}' (referenced from ${u.from}) resolves in neither the feature's openapi.yaml nor the living one — the merged document would carry a dangling reference`,
        });
      }
    }
  }

  // 2. Architecture merge — fold the feature's tagged elements/relationships into the living landscape.
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
      const plan = await planLandscapeMerge(landscapePath, deltaLikec4, delta.elements, newEls, newRels, id);
      writes.push(...plan.writes);
      say(`\n  architecture: merged into landscape.likec4 — +${plan.addedEls.length} element(s), +${plan.addedRels.length} relationship(s)`);
      for (const e of plan.addedEls) say(`      + ${e.title} (${e.kind})`);
      for (const r of plan.addedRels) {
        say(`      + ${titleOf(delta.elements, r.source)} -> ${titleOf(delta.elements, r.target)}  "${r.title ?? ""}"`);
      }
    } else {
      say(`\n  architecture: no landscape.likec4 — ${newEls.length} element(s) not merged`);
    }
  }

  // Gate on what only the plan could see: a merged operation pointing at a
  // component that exists nowhere. Same doctrine as the coherence gate — a
  // judgment call --approve overrides (unlike the mechanical merge-failed
  // refusals), and a dry run is gated too. Checked after the whole plan so the
  // refusal costs nothing: no write has happened yet either way.
  if (planGates.length > 0 && !opts.approve) {
    const msg = `archive ${id} — BLOCKED: ${planGates.length} unresolved $ref(s) in the OpenAPI merge`;
    if (json) {
      refuseJson("not-coherent", msg, [...issues, ...planWarns, ...planGates]);
      return;
    }
    console.error(`${msg}:`);
    for (const i of planGates) console.error(`  ✗ ${i.message}`);
    console.error(`\nDefine the referenced component(s) in the feature's openapi.yaml, or fix the ref — or re-run with --approve to merge the dangling reference anyway.`);
    process.exitCode = 1;
    return;
  }
  if (planGates.length > 0) {
    say(`\n  ⚠ archiving despite ${planGates.length} unresolved $ref(s) (--approve):`);
    for (const i of planGates) say(`      ✗ ${i.message}`);
  }

  // The plan as data, verb decided now — after the commit everything would read
  // as an update. The `--json` payload is identical for a dry run and the real
  // thing except for `archived`; what WOULD happen is what DOES happen.
  const warnings = [...advisory, ...planWarns];
  const overridden = opts.approve === true ? [...gating, ...planGates] : [];
  const plan: Array<Record<string, unknown>> = writes.map((w) => ({
    path: repoPath(config.docsDir, w.path),
    action: existsSync(w.path) ? "update" : "create",
  }));
  plan.push({ path: `features/${dirName}`, action: "move", to: `features/archive/${dirName}` });
  const payload = (archived: boolean): Record<string, unknown> => ({
    feature: id,
    archived,
    path: repoPath(config.docsDir, archiveDest),
    plan,
    warnings: warnings.map(issueJson),
    overridden: overridden.map(issueJson),
  });

  if (dryRun) {
    if (json) emitJson(payload(false));
    else printPlan(config.docsDir, writes, dirName);
    return;
  }

  // COMMIT — the whole plan computed cleanly. Stage every new version beside its
  // target, snapshot what is about to be overwritten, then swap them into place.
  const staged = await stageWrites(writes);
  let snapshot = false;
  let createdArchiveDir: string | undefined;
  try {
    await writeSnapshot(featureDir, config.docsDir, id, dirName, staged);
    snapshot = true;
    await swapStaged(staged);
    createdArchiveDir = await mkdir(archiveDir, { recursive: true });
    await rename(featureDir, archiveDest);
  } catch (err) {
    // Everything this run made, unmade: the swapped files, the snapshot inside the
    // feature that is staying put, and features/archive/ if we are the ones who
    // created it (mkdir reports nothing when it was already there).
    const failures = await rollbackStaged(staged);
    // The snapshot goes only when the rollback HELD. On rollback-incomplete it
    // holds the only on-disk pre-images of the very files the message tells the
    // reader to repair by hand — a MODIFIED requirement's previous text appears
    // nowhere else. Retaining it is harmless: the next archive's writeSnapshot
    // begins by clearing the same directory.
    if (snapshot && failures.length === 0) await quietRm(snapshotDir(featureDir));
    if (createdArchiveDir !== undefined) await quietRm(createdArchiveDir);
    // The code is a caller's answer to "can I trust the repo?": merge-failed
    // means yes (rolled back), rollback-incomplete means look at it by hand.
    const wrapped = rollbackError(err, failures);
    const kept =
      snapshot && failures.length > 0
        ? ` Pre-images of the overwritten files are kept in features/${dirName}/${SNAPSHOT_DIR}/files/.`
        : "";
    throw new ArchiveFailure(failures.length > 0 ? "rollback-incomplete" : "merge-failed", wrapped.message + kept);
  }

  if (json) {
    emitJson(payload(true));
    return;
  }
  console.log(`\n  archived: features/${dirName} → features/archive/${dirName}`);
  console.log(`  snapshot: features/archive/${dirName}/${SNAPSHOT_DIR}/ — \`loam unarchive ${id}\` puts it back`);
  console.log("  living spec + landscape are now complete + current.");
}

/** The full plan, as files: what a dry run shows instead of doing. */
function printPlan(docsDir: string, writes: PlannedWrite[], dirName: string): void {
  console.log(`\n  plan — ${writes.length} file(s):`);
  for (const w of writes) {
    const verb = existsSync(w.path) ? "update" : "create";
    console.log(`    ${verb}  ${repoPath(docsDir, w.path)}`);
  }
  console.log(`    move    features/${dirName} → features/archive/${dirName}`);
  console.log("\n  dry run — nothing was written.");
}

/* ------------------------------------------------------------------ */
/* Merging                                                             */
/* ------------------------------------------------------------------ */

/** What mergeOpenapiPaths computed: the merged text, and everything the plan owes an eye. */
interface OpenapiMerge {
  /** The merged living document, or null when the feature document has no paths to merge. */
  text: string | null;
  /** Labels of EXISTING operations the merge overwrites with different content. */
  modified: string[];
  /** `<kind>/<name>` of living components the closure copy overwrites with different content. */
  componentsModified: string[];
  /** Local $refs reachable from the merged content that resolve in NEITHER document. */
  unresolved: Array<{ ref: string; from: string }>;
}

/**
 * Merge the feature's `paths` into the living OpenAPI structurally (YAML AST, not
 * text splicing): a new path is inserted whole; an existing path gains/overwrites
 * the feature's methods. Never produces duplicate keys or mixed indentation; the
 * living document's comments and formatting are preserved. Returns the merged
 * text (null when the feature document has no paths to merge), plus a label for
 * every EXISTING operation the merge overwrites with different content — the
 * feature file restates the full API, so only the operationId set-difference is
 * ever examined elsewhere, and a changed schema/params/response would otherwise
 * land with zero signal. Set membership + deep-equal only; no schema-diff semantics.
 *
 * The merged operations' `$ref` closure rides along: every
 * `#/components/<kind>/<name>` reachable from the merged path items — recursively
 * through the FEATURE's own components, a component referencing another pulls it
 * in — is copied into the living document, so an operation never lands pointing
 * at a schema that stayed behind. A needed component the living document already
 * has identically is left alone; one it has differently is overwritten wholesale
 * and reported (`componentsModified`, the op-modified discipline). A local ref
 * that resolves in NEITHER document is reported as `unresolved` — the caller
 * gates on it. External refs (URLs, file paths — anything not starting `#/`)
 * are out of scope: left untouched, never gated.
 */
function mergeOpenapiPaths(
  livingText: string,
  featureText: string,
  service: string,
): OpenapiMerge {
  const feature = parseDocument(featureText);
  if (feature.errors.length > 0) {
    throw new ArchiveFailure("merge-failed", `feature openapi for ${service} is not valid YAML: ${feature.errors[0]!.message}`);
  }
  const featPaths = feature.get("paths");
  if (!isMap(featPaths) || featPaths.items.length === 0) {
    return { text: null, modified: [], componentsModified: [], unresolved: [] };
  }

  const living = parseDocument(livingText);
  if (living.errors.length > 0) {
    throw new ArchiveFailure("merge-failed", `living openapi for ${service} is not valid YAML: ${living.errors[0]!.message}`);
  }
  const modified: string[] = [];
  for (const item of featPaths.items) {
    const path = scalarKey(item.key);
    const featItem = item.value;
    const existing = living.getIn(["paths", path]);
    if (existing !== undefined && isMap(existing) && isMap(featItem)) {
      for (const method of featItem.items) {
        const m = scalarKey(method.key);
        const before = living.getIn(["paths", path, m]);
        if (HTTP_METHODS.has(m) && before !== undefined && !isDeepStrictEqual(toPlain(before), toPlain(method.value))) {
          modified.push(opLabel(before, method.value, m, path));
        }
        living.setIn(["paths", path, m], toPlain(method.value));
      }
    } else {
      living.setIn(["paths", path], toPlain(featItem));
    }
  }

  // The $ref closure of what was just merged. Resolution is checked against
  // plain snapshots (components untouched so far); the copies land afterwards,
  // in discovery order, so the walk never chases its own writes.
  const featPlain = (feature.toJS() ?? {}) as unknown;
  const livingPlain = (living.toJS() ?? {}) as unknown;
  const componentsModified: string[] = [];
  const unresolved: OpenapiMerge["unresolved"] = [];
  const visited = new Set<string>();
  const copies: Array<{ kind: string; name: string; value: unknown }> = [];

  const visitRef = (ref: string, from: string): void => {
    if (!ref.startsWith("#/")) return; // external — out of scope, untouched, never gated
    const m = /^#\/components\/([^/]+)\/([^/]+)(?:\/|$)/.exec(ref);
    if (!m) {
      // A local ref outside components (rare). Nothing to copy, but it must
      // point at something in one of the two documents being merged.
      if (!resolvePointer(featPlain, ref).found && !resolvePointer(livingPlain, ref).found) {
        unresolved.push({ ref, from });
      }
      return;
    }
    const kind = m[1]!;
    const name = m[2]!;
    const key = `${kind}/${name}`;
    if (visited.has(key)) return;
    visited.add(key);
    const inFeature = resolvePointer(featPlain, `#/components/${kind}/${name}`);
    if (inFeature.found) {
      copies.push({ kind, name, value: inFeature.value });
      walk(inFeature.value, `components/${key}`);
      return;
    }
    // Not the feature's to provide — fine if the living document has it.
    if (!resolvePointer(livingPlain, `#/components/${kind}/${name}`).found) {
      unresolved.push({ ref, from });
    }
  };

  const walk = (node: unknown, from: string): void => {
    for (const ref of collectRefs(node)) visitRef(ref, from);
  };

  for (const item of featPaths.items) {
    walk(toPlain(item.value), `paths ${scalarKey(item.key)}`);
  }

  for (const { kind, name, value } of copies) {
    const existing = living.getIn(["components", kind, name]);
    if (existing !== undefined) {
      if (isDeepStrictEqual(toPlain(existing), value)) continue;
      componentsModified.push(`${kind}/${name}`);
    }
    living.setIn(["components", kind, name], value);
  }

  return { text: living.toString(), modified, componentsModified, unresolved };
}

/** Every `$ref` string value anywhere in a plain JS tree, in document order. */
function collectRefs(node: unknown): string[] {
  const out: string[] = [];
  const walk = (n: unknown): void => {
    if (Array.isArray(n)) {
      for (const v of n) walk(v);
      return;
    }
    if (n !== null && typeof n === "object") {
      for (const [k, v] of Object.entries(n)) {
        if (k === "$ref" && typeof v === "string") out.push(v);
        else walk(v);
      }
    }
  };
  walk(node);
  return out;
}

/**
 * Resolve a local JSON pointer (`#/a/b~1c`) against a plain JS tree. `found`
 * distinguishes "resolves to null/undefined-shaped content" from "no such
 * spot": a component whose body is legitimately null still resolves.
 */
function resolvePointer(root: unknown, ref: string): { found: boolean; value: unknown } {
  let cur: unknown = root;
  for (const raw of ref.slice(2).split("/")) {
    const seg = raw.replace(/~1/g, "/").replace(/~0/g, "~");
    if (Array.isArray(cur)) {
      const i = Number(seg);
      if (!Number.isInteger(i) || i < 0 || i >= cur.length) return { found: false, value: undefined };
      cur = cur[i];
    } else if (cur !== null && typeof cur === "object" && seg in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[seg];
    } else {
      return { found: false, value: undefined };
    }
  }
  return { found: true, value: cur };
}

/** Name an overwritten operation by its operationId (feature's, else living's), or by path+method. */
function opLabel(before: unknown, after: unknown, method: string, path: string): string {
  const idOf = (n: unknown): string | undefined => {
    const v = isMap(n) ? n.get("operationId") : undefined;
    return typeof v === "string" && v.length > 0 ? v : undefined;
  };
  const op = idOf(after) ?? idOf(before);
  return op !== undefined ? `'${op}' (${method} ${path})` : `${method} ${path}`;
}

function scalarKey(key: unknown): string {
  if (key && typeof key === "object" && "value" in key) return String((key as { value: unknown }).value);
  return String(key);
}

function toPlain(node: unknown): unknown {
  if (node && typeof node === "object" && "toJSON" in node) return (node as { toJSON: () => unknown }).toJSON();
  return node;
}

interface LandscapePlan {
  writes: PlannedWrite[];
  addedEls: Elem[];
  addedRels: Rel[];
}

/**
 * Plan the merge of the feature's new elements + relationships into the living
 * landscape's `model { ... }` block (preserving the rest of the file).
 *
 * The additions are SPLICED from delta.likec4 as authored — byte for byte,
 * technology, style, icons, links, metadata, nested children and all — never
 * re-serialized from the parsed model: a rebuild keeps only the fields loam
 * models, and every field it forgets is authored detail destroyed. The one
 * edit on the way over is dropping the feature's own tag — the additions are
 * baseline now (SCHEMA.md documents the drop as why unarchive restores bytes
 * instead of recomputing) — and a construct the strip empties goes with it.
 *
 * Placement: a top-level addition lands in the single "// merged by loam
 * archive" block before the model's closing brace. A NESTED element lands
 * inside its parent's block — inside the living parent when the landscape
 * already has it, riding verbatim inside the spliced parent when the parent
 * is new from the same delta — never as a flat dotted id at top level, which
 * LikeC4 rejects.
 *
 * Existence is checked semantically against the parsed landscape (by element
 * id/title and by edge identity), so re-archiving is idempotent and title
 * strings appearing elsewhere in the source cause no false skips. Assumes the
 * delta reuses the landscape's element identifiers for existing services.
 *
 * Splicing is text surgery, so the computed result is PARSED before it is
 * returned: a merged landscape LikeC4 rejects refuses the archive at plan time
 * (merge-failed, nothing written — the unparseable-delta discipline) instead
 * of landing in the living docs.
 */
async function planLandscapeMerge(
  landscapePath: string,
  deltaPath: string,
  deltaElements: Elem[],
  newEls: Elem[],
  newRels: Rel[],
  featureId: string,
): Promise<LandscapePlan> {
  const text = await readFile(landscapePath, "utf8");
  const land = await loadFile(landscapePath);
  if (land.errors.length > 0) {
    throw new ArchiveFailure("merge-failed", `landscape.likec4 has ${land.errors.length} error(s) — fix it before archiving`);
  }
  const haveIds = new Set(land.elements.map((e) => e.id));
  const haveTitles = new Set(land.elements.map((e) => e.title));
  const addedEls: Elem[] = [];
  for (const e of newEls) {
    if (haveIds.has(e.id) || haveTitles.has(e.title)) continue;
    haveIds.add(e.id);
    haveTitles.add(e.title);
    addedEls.push(e);
  }

  // Edges are matched by COUNT, not by membership: two edges the model cannot tell
  // apart are still two edges, and dropping the second one silently loses a call
  // the author drew. An edge already in the landscape consumes one delta edge of
  // the same identity, which is what keeps re-archiving idempotent.
  const have = new Map<string, number>();
  for (const r of land.relationships) {
    const k = relKey(land.elements, r);
    have.set(k, (have.get(k) ?? 0) + 1);
  }
  const addedRels: Rel[] = [];
  for (const r of newRels) {
    const k = relKey(deltaElements, r);
    const n = have.get(k) ?? 0;
    if (n > 0) {
      have.set(k, n - 1);
      continue;
    }
    addedRels.push(r);
  }

  if (addedEls.length === 0 && addedRels.length === 0) return { writes: [], addedEls, addedRels };

  const deltaText = await readFile(deltaPath, "utf8");
  const scan = scanModel(deltaText);
  if (scan === null) {
    throw new ArchiveFailure("merge-failed", "delta.likec4 has no model block — nothing to splice the additions from");
  }

  // Everything below either locates a declaration's authored bytes or refuses.
  // `spliced` remembers the delta ranges already carried over, so a child whose
  // parent is itself new is recognised as riding inside the parent's text and
  // is never inserted twice.
  const byId = new Map(scan.elements.map((e) => [e.id, e]));
  const spliced: Array<{ start: number; end: number }> = [];
  const rides = (start: number, end: number): boolean =>
    spliced.some((r) => start >= r.start && end <= r.end);

  const topBlocks: Array<{ at: number; text: string }> = [];
  const nested: Array<{ at: number; insert: string; seq: number }> = [];

  let livingScanned: ScannedModel | null | undefined;
  const livingParentOf = (parentId: string): ScannedElement | null => {
    if (livingScanned === undefined) livingScanned = scanModel(text);
    if (livingScanned === null) return null;
    const direct = livingScanned.elements.find((e) => e.id === parentId);
    if (direct !== undefined) return direct;
    // The delta may spell an existing element under its own id; the title is
    // the stable cross-namespace name (the same rule the existence check uses).
    const title = deltaElements.find((e) => e.id === parentId)?.title;
    const livingId = title === undefined ? undefined : land.elements.find((e) => e.title === title)?.id;
    if (livingId === undefined) return null;
    return livingScanned.elements.find((e) => e.id === livingId) ?? null;
  };

  // Ancestors first: a spliced parent covers its children before they are seen.
  const depth = (id: string): number => id.split(".").length;
  const sortedEls = [...addedEls].sort(
    (a, b) => depth(a.id) - depth(b.id) || (byId.get(a.id)?.start ?? 0) - (byId.get(b.id)?.start ?? 0),
  );
  for (const e of sortedEls) {
    const src = byId.get(e.id);
    if (src === undefined) {
      throw new ArchiveFailure(
        "merge-failed",
        `cannot locate '${e.id}' in delta.likec4 — the landscape merge splices authored source, and this declaration was not found`,
      );
    }
    if (rides(src.start, src.end)) continue;
    const dot = e.id.lastIndexOf(".");
    if (dot === -1) {
      topBlocks.push({ at: src.start, text: spliceSource(deltaText, src, featureId, "  ") });
      spliced.push({ start: src.start, end: src.end });
      continue;
    }
    const parentId = e.id.slice(0, dot);
    const parent = livingParentOf(parentId);
    if (parent === null) {
      throw new ArchiveFailure(
        "merge-failed",
        `'${e.id}' nests under '${parentId}', which is neither in the living landscape nor added by this delta — there is nowhere to insert it`,
      );
    }
    nested.push({
      ...nestedInsert(text, parent, spliceSource(deltaText, src, featureId, parent.indent + "  ")),
      seq: nested.length,
    });
    spliced.push({ start: src.start, end: src.end });
  }

  // Relationships: match each parsed addition back to its statement in the
  // delta source — full identity (endpoints, title, op, tags), consumed one
  // statement per addition so duplicates stay duplicates.
  const relKeyOf = (source: string, target: string, title?: string, op?: string, tags: string[] = []): string =>
    JSON.stringify([source, target, title ?? "", op ?? "", [...tags].sort()]);
  const pool = new Map<string, ScannedRel[]>();
  for (const s of scan.rels) {
    const k = relKeyOf(s.source, s.target, s.title, s.op, s.tags);
    pool.set(k, [...(pool.get(k) ?? []), s]);
  }
  for (const r of addedRels) {
    const s = pool.get(relKeyOf(r.source, r.target, r.title, r.op, r.tags))?.shift();
    if (s === undefined) {
      throw new ArchiveFailure(
        "merge-failed",
        `cannot locate the '${r.source} -> ${r.target}' relationship in delta.likec4 — the landscape merge splices authored source, and no matching declaration was found`,
      );
    }
    if (rides(s.start, s.end)) continue;
    topBlocks.push({ at: s.start, text: spliceSource(deltaText, s, featureId, "  ") });
  }

  // Compose: the top-level block first (it sits at the model's closing brace,
  // after every nested position, so the nested offsets — which index the
  // ORIGINAL text — survive it), then the nested inserts back to front so they
  // do not shift each other. Same position means same parent: later inserts go
  // in first, which keeps the children in delta order.
  let content = text;
  if (topBlocks.length > 0) {
    topBlocks.sort((a, b) => a.at - b.at);
    content = insertIntoModelBlock(
      content,
      topBlocks.map((b) => b.text),
    );
  }
  for (const n of [...nested].sort((a, b) => b.at - a.at || b.seq - a.seq)) {
    content = content.slice(0, n.at) + n.insert + content.slice(n.at);
  }

  // The safety net: prove the computed landscape parses before anything is
  // written. Splice bugs — and legal inputs the living document cannot absorb,
  // like a kind its specification never declares — refuse here, at plan time,
  // instead of corrupting the one file the whole fleet reads.
  const check = await loadSource(content);
  if (check.errors.length > 0) {
    const detail = check.errors
      .slice(0, 3)
      .map((e) => (typeof e.line === "number" ? `L${e.line}: ${e.message}` : e.message))
      .join("; ");
    throw new ArchiveFailure(
      "merge-failed",
      `the merged landscape would not parse (${check.errors.length} error(s): ${detail}) — nothing was written. ` +
        `The delta's additions do not fit the living landscape as authored — most often an element kind or tag ` +
        `its specification block does not declare; fix the landscape's specification or the delta, then re-run`,
    );
  }

  return { writes: [{ path: landscapePath, content }], addedEls, addedRels };
}

/**
 * A declaration's authored source, ready to land in the living landscape:
 * byte-verbatim except that the feature's own tag is stripped and the
 * indentation is rebased from where the block sat in the delta to where it
 * lands. A construct the strip leaves empty goes too — a line that held only
 * the tag disappears whole, and `x = kind 'y' { #FEAT-1 }` lands as
 * `x = kind 'y'`, not as a pair of empty braces.
 */
function spliceSource(
  deltaText: string,
  decl: { start: number; end: number; indent: string },
  featureId: string,
  targetIndent: string,
): string {
  const block = deltaText.slice(decl.start, decl.end);
  return reindent(stripFeatureTag(block, featureId), decl.indent, targetIndent);
}

function stripFeatureTag(block: string, featureId: string): string {
  const { code } = maskSource(block);
  const esc = featureId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const removals: Array<[number, number]> = [];
  for (const m of block.matchAll(new RegExp(`#${esc}(?![\\w-])`, "g"))) {
    // Only tags in CODE count — a description quoting "#FEAT-1" is content.
    if (code.slice(m.index, m.index + m[0].length) !== m[0]) continue;
    let s = m.index;
    let e = s + m[0].length;
    // Take the whitespace on ONE side with the token — trailing first, so
    // `#FEAT-1 #critical` leaves `#critical` at its own indent, and a token at
    // the end of a line does not leave a trailing space behind.
    if (block[e] === " " || block[e] === "\t") {
      while (block[e] === " " || block[e] === "\t") e += 1;
    } else {
      while (s > 0 && (block[s - 1] === " " || block[s - 1] === "\t")) s -= 1;
    }
    removals.push([s, e]);
  }
  if (removals.length === 0) return block;

  // A line the strip emptied disappears whole, newline included.
  for (let lineStart = 0; lineStart < block.length; ) {
    const nl = block.indexOf("\n", lineStart);
    const lineEnd = nl === -1 ? block.length : nl + 1;
    if (
      removals.some(([s, e]) => s >= lineStart && e <= lineEnd) &&
      /^\s*$/.test(residual(block, lineStart, nl === -1 ? block.length : nl, removals))
    ) {
      removals.push([lineStart, lineEnd]);
    }
    lineStart = lineEnd;
  }

  // A body the strip emptied goes too, braces and all — but only one the strip
  // emptied: braces that were authored empty are authored bytes and survive.
  for (let at = code.indexOf("{"); at !== -1; at = code.indexOf("{", at + 1)) {
    const closeAt = matchBrace(code, at);
    if (closeAt === -1) continue;
    if (!removals.some(([s, e]) => s > at && e <= closeAt)) continue;
    if (!/^\s*$/.test(residual(block, at + 1, closeAt, removals))) continue;
    let s = at;
    while (s > 0 && /\s/.test(block[s - 1]!)) s -= 1;
    removals.push([s, closeAt + 1]);
  }
  return applyRemovals(block, removals);
}

/** The text of [from, to) with the removal ranges cut out. */
function residual(text: string, from: number, to: number, removals: Array<[number, number]>): string {
  let out = "";
  for (let i = from; i < to; i += 1) {
    if (!removals.some(([s, e]) => i >= s && i < e)) out += text[i];
  }
  return out;
}

function applyRemovals(text: string, removals: Array<[number, number]>): string {
  const sorted = [...removals].sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  let out = "";
  let i = 0;
  for (const [s, e] of sorted) {
    if (s > i) out += text.slice(i, s);
    if (e > i) i = e;
  }
  return out + text.slice(i);
}

/**
 * Rebase a block's indentation: the `base` its lines carried in the delta
 * becomes `target`. The first line arrives with no leading whitespace (the
 * scanner's span starts at the declaration itself), so it only gains `target`.
 */
function reindent(block: string, base: string, target: string): string {
  return block
    .split("\n")
    .map((line, k) => {
      const body = k === 0 ? line : line.startsWith(base) ? line.slice(base.length) : line;
      return body.length === 0 ? "" : target + body;
    })
    .join("\n");
}

/**
 * Where a child block enters an existing living parent: before the closing
 * brace of the parent's body, on its own line at the parent's inner indent —
 * and a parent that never had a body gains one around the child.
 */
function nestedInsert(text: string, parent: ScannedElement, block: string): { at: number; insert: string } {
  if (parent.bodyOpen === -1) {
    return { at: parent.end, insert: ` {\n${block}\n${parent.indent}}` };
  }
  const lineStart = text.lastIndexOf("\n", parent.bodyClose - 1) + 1;
  if (/^[ \t]*$/.test(text.slice(lineStart, parent.bodyClose))) {
    return { at: lineStart, insert: `${block}\n` };
  }
  // `{ ... }` on one line — break the brace onto its own line to make room.
  return { at: parent.bodyClose, insert: `\n${block}\n${parent.indent}` };
}

/**
 * What makes two edges the same edge. Endpoints are compared by TITLE, which is
 * stable across the delta's and the landscape's id namespaces.
 *
 * An edge that carries an `op` IS that call, whatever it is titled — retitling it
 * must not merge a second copy. An edge with no `op` has only its title. The two
 * live in separate namespaces because they are separate things: an op-less edge
 * titled `authorizePayment` is not the edge whose operationId is authorizePayment,
 * and keying on `op ?? title` quietly merged only one of them.
 */
function relKey(els: Elem[], r: Rel): string {
  const src = titleOf(els, r.source);
  const tgt = titleOf(els, r.target);
  return JSON.stringify(r.op !== undefined ? ["op", src, tgt, r.op] : ["title", src, tgt, r.title ?? ""]);
}

/**
 * Insert pre-indented source blocks before the closing brace of the top-level
 * `model { ... }` block. The block is LOCATED on masked source — maskSource
 * blanks string interiors and comments while preserving every offset, the same
 * view scanModel reads — because finding it on raw text let a `model {` spelled
 * inside a block comment (or a string) above the real block capture the match:
 * the brace scan then closed inside the comment and every top-level addition
 * was spliced into it — legal LikeC4, so the parse net passed and the archive
 * reported success over a landscape that contained none of the architecture.
 */
function insertIntoModelBlock(text: string, blocks: string[]): string {
  const { code } = maskSource(text);
  const m = /\bmodel\s*\{/.exec(code);
  if (!m) throw new ArchiveFailure("merge-failed", "landscape.likec4 has no model block");
  const close = matchBrace(code, m.index + m[0].length - 1);
  if (close === -1) throw new ArchiveFailure("merge-failed", "landscape.likec4 has an unbalanced model block");
  const block = `\n  // merged by loam archive\n${blocks.join("\n")}\n`;
  return text.slice(0, close) + block + text.slice(close);
}

/**
 * Rewrite ONLY the requirements run of a living spec. Byte-for-byte preserved:
 * everything before the first requirement inside `## Requirements` (the intro,
 * the heading line, prose under the heading) and everything from the section's
 * end onward (the next `## ` heading to EOF) — the old cut was a substring
 * `indexOf("\n## Requirements")`, a prefix match that also hit
 * `## Requirements Extra` and silently destroyed every section after the
 * requirements. Prose BETWEEN requirements is body text of whatever is open
 * above it (parseRequirements attributes it to the previous requirement's last
 * scenario, or its text) and survives inside the re-serialized run, framing
 * normalized. `merged` must contain every living requirement — runArchive's
 * stray guard refuses any document whose requirements sit outside the section,
 * using the same heading definition, before this output is ever written.
 */
function rewriteRequirementsRun(text: string, merged: Requirement[]): string {
  const s = splitRequirementsSection(text);
  // No `## Requirements` at all: the stray guard has already refused any doc
  // whose requirements live elsewhere, so this one has none — open the section.
  if (s === null) return `${text.trimEnd()}\n\n## Requirements\n\n${serializeRequirements(merged)}`;
  const body = serializeRequirements(merged);
  // head/tail are raw slices; only the run's own framing is normalized. When
  // the section held no requirements yet, the glue supplies the blank line the
  // author never had reason to write.
  const headGlue = s.run !== "" || s.head.endsWith("\n\n") ? "" : s.head.endsWith("\n") ? "\n" : "\n\n";
  const tailGlue = s.tail === "" ? "" : "\n";
  return s.head + headGlue + body + tailGlue + s.tail;
}

function summarize(reqs: Requirement[]): { ADDED: number; MODIFIED: number; REMOVED: number } {
  const c = { ADDED: 0, MODIFIED: 0, REMOVED: 0 };
  for (const r of reqs) {
    if (r.kind === "ADDED") c.ADDED += 1;
    else if (r.kind === "MODIFIED") c.MODIFIED += 1;
    else if (r.kind === "REMOVED") c.REMOVED += 1;
  }
  return c;
}

function titleOf(elements: Elem[], id: string): string {
  return elements.find((e) => e.id === id)?.title ?? id;
}
