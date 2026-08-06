/**
 * Does the diff apply to the thing it claims to change?
 *
 * A requirement delta is a diff against a living spec, and nothing used to check
 * that it lands. Every failure mode here is silent today: MODIFIED of a
 * requirement that does not exist is merged as a creation, ADDED of one that
 * does exist REPLACES it (scenarios and all) while the author believes they are
 * adding, and a heading that nearly matches the delta grammar parses as plain
 * prose so archive merges nothing at all and says nothing about it.
 *
 * The last of those has a legal-looking cousin: a requirement under an ordinary
 * prose heading (`## Behavior`, `## Error Handling`) is BASE too, and BASE never
 * merges. Upstream OpenSpec deltas are written that way, so the answer is to name
 * what will be lost rather than to start merging prose sections.
 *
 * These run inside the archive gate, because the merge is where the damage lands.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { relative } from "node:path";
import type { Issue } from "./issue.js";
import {
  featureSpecPaths,
  featureSpecServices,
  listFeatures,
  servicePaths,
  SPEC_AXES,
  type SpecAxis,
} from "./repo.js";
import {
  KIND_RE,
  REQUIREMENT_DIGEST_LENGTH,
  REQUIREMENT_DIGEST_RE,
  basedOnDeclarations,
  isRequirementsHeading,
  parseRequirements,
  requirementDigest,
  requirementIdProblems,
  sectionHeadings,
  type Requirement,
} from "./spec.js";
import type { FleetContext } from "./fleet-context.js";

/**
 * `## <word> Requirement(s)` — the shape an author reaches for. Anything matching
 * this but not the real grammar is a near miss: `## ADDED Requirement` (singular),
 * `## NEW Requirements`, `## ADDED Requirements:`. A bare `## Requirements` is not
 * a near miss — quoting the living state inside a delta is legal.
 */
const NEAR_SECTION_RE = /^##\s+[A-Za-z]+\s+Requirements?\s*:?\s*$/i;

/**
 * OpenSpec's fourth delta operation. NEAR_SECTION_RE already catches it, but the
 * generic advice would mislead: a RENAMED body is FROM/TO backtick bullets, not
 * `### Requirement:` headings, so it parses to zero requirements and even the
 * whole-file check below has nothing to count — the heading is the only place to
 * stop it. Rename semantics stay unimplemented (the corpus never uses them); the
 * error says what to write instead.
 */
const RENAMED_SECTION_RE = /^##\s+RENAMED\s+Requirements?\s*:?\s*$/i;

// The one non-delta heading whose requirements are SUPPOSED not to merge — a
// delta quoting the living state for context — is `## Requirements`, matched by
// the shared isRequirementsHeading (spec.ts): the same definition that fixes
// archive's rewrite boundary, so "legal to quote" and "where the merge writes"
// cannot drift apart. Every other heading — `## Behavior`, `## Error Handling`,
// `## Notes` — leaves its requirements as BASE, which the merge skips, so the
// author wrote a change that will never land.

/** Key for the (service, axis, requirement) triple a feature claims. The two
 * axes are separate namespaces on purpose — an arch requirement cannot conflict
 * with a business requirement of the same name, they merge into different files. */
function key(service: string, axis: SpecAxis, identity: string): string {
  return `${service}\0${axis.file}\0${identity}`;
}

/** Stable ID when present; exact heading for a legacy requirement. */
function requirementKey(requirement: Pick<Requirement, "id" | "name">): string {
  return requirement.id === undefined ? `name:${requirement.name}` : `id:${requirement.id}`;
}

export async function deltaShapeIssues(
  docsDir: string,
  featureDir: string,
  featureId: string,
  context?: FleetContext,
): Promise<Issue[]> {
  const issues: Issue[] = [];
  const services = await featureSpecServices(featureDir, context);
  if (services.length === 0) return issues;

  // What OTHER features in flight claim. Only built when a claim has to be
  // checked — the common case never pays for the scan.
  let inFlight: ActiveClaims | null = null;
  const claimedElsewhere = async (
    which: keyof ActiveClaims,
    service: string,
    axis: SpecAxis,
    requirement: Pick<Requirement, "id" | "name">,
  ): Promise<string | undefined> => {
    inFlight ??= await activeClaims(docsDir, featureId, context);
    const map = inFlight[which];
    return map.get(key(service, axis, requirementKey(requirement)))
      ?? map.get(key(service, axis, `name:${requirement.name}`));
  };
  const addedElsewhere = (
    service: string,
    axis: SpecAxis,
    requirement: Pick<Requirement, "id" | "name">,
  ): Promise<string | undefined> => claimedElsewhere("added", service, axis, requirement);

  // Both requirement-carrying files per service run the same checks — one code
  // path parameterized by filename, the merge's own factoring. `where` names
  // the arch file in messages so a finding cannot be chased into the wrong
  // document; spec.md keeps its historical spelling.
  for (const service of services) {
    for (const axis of SPEC_AXES) {
      const specPath = featureSpecPaths(featureDir, service)[axis.key];
      if (!existsSync(specPath)) continue;
      const raw = context === undefined
        ? await readFile(specPath, "utf8")
        : await context.readText(specPath);
      const where = axis.key === "spec" ? service : `${service} (arch.spec.md)`;

      for (const heading of sectionHeadings(raw)) {
        if (KIND_RE.test(heading.text) || !NEAR_SECTION_RE.test(heading.text)) continue;
        issues.push({
          severity: "error",
          code: "delta.unknown-section",
          subject: service,
          message: RENAMED_SECTION_RE.test(heading.text)
            ? `${where}: '${heading.text}' (line ${heading.line}) is OpenSpec rename syntax, which loam does not merge — carry one stable Requirement-ID through a MODIFIED requirement, or express a legacy rename as a REMOVED requirement plus an ADDED one; otherwise the rename happens to nothing`
            : `${where}: '${heading.text}' (line ${heading.line}) is not a delta section — use '## ADDED Requirements', '## MODIFIED Requirements' or '## REMOVED Requirements', or everything under it merges as nothing`,
        });
      }

      const reqs = context === undefined ? parseRequirements(raw) : await context.readRequirements(specPath);

      for (const problem of requirementIdProblems(reqs)) {
        if (problem.kind === "invalid") {
          issues.push({
            severity: "error",
            code: "delta.requirement-id-invalid",
            subject: service,
            message: `${where}: requirement '${problem.requirement}' has invalid Requirement-ID '${problem.value}' — use 1-128 characters matching [A-Za-z][A-Za-z0-9._-]*`,
          });
        } else if (problem.kind === "repeated") {
          issues.push({
            severity: "error",
            code: "delta.requirement-id-repeated",
            subject: service,
            message: `${where}: requirement '${problem.requirement}' declares Requirement-ID ${problem.values.length} times — identity must be declared exactly once`,
          });
        } else {
          issues.push({
            severity: "error",
            code: "delta.requirement-id-duplicate",
            subject: service,
            message: `${where}: Requirement-ID '${problem.id}' is shared by ${problem.requirements.map((name) => `'${name}'`).join(", ")} — one ID may identify only one requirement`,
          });
        }
      }

      // The `Based-On:` pin as a DOCUMENT question, settled before anything is
      // compared against the living spec: a value that is not a digest, or two
      // of them on one requirement, is a pin nobody can evaluate — and a pin
      // that silently protects nothing is worse than no pin at all, because its
      // author believes they are covered. ADDED is refused for the same reason
      // rather than ignored: a requirement with no living version cannot have
      // been written against one, so the line is a misunderstanding today and a
      // digest-shaped lie on the day someone turns it into a MODIFIED.
      for (const r of reqs) {
        const declared = basedOnDeclarations(r);
        if (declared.length > 1) {
          issues.push({
            severity: "error",
            code: "delta.baseline-invalid",
            subject: service,
            message: `${where}: requirement '${r.name}' declares Based-On ${declared.length} times — a delta is written against exactly one living version`,
          });
          continue;
        }
        const pin = declared[0];
        if (pin === undefined) continue;
        if (!REQUIREMENT_DIGEST_RE.test(pin)) {
          issues.push({
            severity: "error",
            code: "delta.baseline-invalid",
            subject: service,
            message: `${where}: requirement '${r.name}' has invalid Based-On '${pin}' — expected ${REQUIREMENT_DIGEST_LENGTH} lowercase hex characters, as \`loam rebase\` writes them`,
          });
        } else if (r.kind === "ADDED") {
          issues.push({
            severity: "error",
            code: "delta.baseline-invalid",
            subject: service,
            message: `${where}: ADDED requirement '${r.name}' carries Based-On '${pin}', but an added requirement has no living version to be based on — drop the line, or make it MODIFIED`,
          });
        }
      }

      // The whole-file version of the near-miss check, and the one that cannot be
      // dodged: NEAR_SECTION_RE only recognizes single-word misses (`## NEW
      // Requirements`), so `## NEWLY ADDED Requirements` — or requirements under a
      // prose heading, or under no heading at all — still parses everything as BASE
      // and archive merges nothing, silently. Same failure class as the BOM incident
      // (see spec.ts). A file that MIXES delta sections with quoted BASE requirements
      // is legal authoring; a file with requirements and no delta kind anywhere is a
      // delta that would do nothing, which cannot be what its author meant.
      if (reqs.length > 0 && reqs.every((r) => r.kind === "BASE")) {
        const rel = relative(docsDir, specPath).split(/[\\/]/).join("/");
        issues.push({
          severity: "error",
          code: "delta.no-delta-sections",
          subject: service,
          message: `${service}: ${rel} contains ${reqs.length} requirement(s) but no '## ADDED|MODIFIED|REMOVED Requirements' section — this delta would merge nothing`,
        });
      }

      const livingPath = servicePaths(docsDir, service)[axis.key];
      const living = existsSync(livingPath)
        ? context === undefined
          ? parseRequirements(await readFile(livingPath, "utf8"))
          : await context.readRequirements(livingPath)
        : [];
      // How the axis's living document is named in messages — spec.md keeps the
      // historical "living spec", the arch axis says which file it means.
      const livingDoc = axis.key === "spec" ? "living spec" : "living arch.spec.md";
      const livingNames = new Set(living.map((r) => r.name));
      const livingByName = new Map<string, Requirement[]>();
      const livingById = new Map<string, Requirement[]>();
      for (const requirement of living) {
        const named = livingByName.get(requirement.name) ?? [];
        named.push(requirement);
        livingByName.set(requirement.name, named);
        if (requirement.id !== undefined) {
          const identified = livingById.get(requirement.id) ?? [];
          identified.push(requirement);
          livingById.set(requirement.id, identified);
        }
      }
      for (const problem of requirementIdProblems(living)) {
        issues.push({
          severity: "error",
          code: "delta.living-requirement-id-invalid",
          subject: service,
          message:
            problem.kind === "invalid"
              ? `${where}: the ${livingDoc} requirement '${problem.requirement}' has invalid Requirement-ID '${problem.value}', so this delta cannot select it safely`
              : problem.kind === "repeated"
                ? `${where}: the ${livingDoc} requirement '${problem.requirement}' declares Requirement-ID more than once, so this delta cannot select it safely`
                : `${where}: the ${livingDoc} shares Requirement-ID '${problem.id}' across ${problem.requirements.map((name) => `'${name}'`).join(", ")}, so this delta cannot select one safely`,
        });
      }
      // Two living requirements under one heading make the delta algebra
      // disagree with itself on the SAME input: MODIFIED replaces the first
      // match (findIndex) while REMOVED deletes every match (filter). So one
      // delta edits one of the twins and leaves the other, and the next one
      // deletes both — and neither outcome is what an author reading the
      // living document could have predicted. Gating rather than advisory,
      // because there is no reading of the delta that makes the merge correct;
      // the fix is in the living document, and it is one rename.
      for (const [name, twins] of livingByName) {
        if (twins.length < 2) continue;
        issues.push({
          severity: "error",
          code: "delta.living-duplicate-requirement",
          subject: service,
          message: `${where}: the ${livingDoc} declares ${twins.length} requirements named '${name}' — MODIFIED would rewrite only the first and REMOVED would delete both, so no delta applies to it predictably. Give them distinct names (or distinct Requirement-IDs and headings) first.`,
        });
      }

      // Lowercased living name -> its exact spelling, for the near-duplicate warning.
      const livingFolded = new Map(living.map((r) => [r.name.toLowerCase(), r.name] as const));

      /**
       * The pin, against the living requirement this delta actually selects.
       *
       * This is the check `delta.modified-conflict` cannot be: that one names
       * the other feature while BOTH are in flight, and the collision that
       * happens on a fleet outlives the window. A archives, leaves `features/`,
       * and stops being an active claim; B revalidates GREEN, and its MODIFIED —
       * carrying the full text it wrote against the pre-A document — replaces
       * A's requirement wholesale, scenarios and all, with `+0 ~1 -0` and exit
       * 0. Nothing downstream can even detect it afterwards: `unarchive A`
       * refuses `snapshot-stale`, and `--force` takes B out with it.
       *
       * A digest of what the author read closes that by not depending on
       * timing at all. Stale is an ERROR and gates, because there is no reading
       * of a stale delta under which the merge is what its author meant.
       * Missing is a warning and does not: a delta adopted from OpenSpec never
       * had the line, and refusing to archive an entire migrated corpus is not
       * a safety property, it is an outage.
       */
      const checkBaseline = (r: Requirement, selected: Requirement): void => {
        // A pin the document pass already refused is not also stale: that would
        // send its author to `loam rebase` for a problem rebase does not fix.
        const declared = basedOnDeclarations(r);
        if (declared.length > 1) return;
        if (r.basedOn !== undefined && !REQUIREMENT_DIGEST_RE.test(r.basedOn)) return;
        const current = requirementDigest(selected);
        if (r.basedOn === undefined) {
          issues.push({
            severity: "warn",
            code: "delta.baseline-missing",
            subject: service,
            message: `${where}: ${r.kind} requirement '${r.name}' carries no Based-On, so nothing can say whether the living text moved since this delta was written. Run \`loam rebase ${featureId}\` to pin it (Based-On: ${current}).`,
          });
          return;
        }
        if (r.basedOn === current) return;
        issues.push({
          severity: "error",
          code: "delta.baseline-stale",
          subject: service,
          message:
            `${where}: ${r.kind} requirement '${r.name}' was written against living version ${r.basedOn}, but the ${livingDoc} now holds ${current} — someone landed a change to it in between. ` +
            (r.kind === "MODIFIED"
              ? `This MODIFIED carries its FULL new text, so merging it would replace theirs outright.`
              : `Merging this REMOVED would delete what they landed.`) +
            ` Re-read the living requirement, fold in what you still mean, then run \`loam rebase ${featureId}\`.`,
        });
      };

      for (const r of reqs) {
        // BASE in a delta file means the requirement is under no delta section, so
        // the merge skips it. Reported rather than merged: deciding that `## Behavior`
        // means ADDED would be archive guessing at intent, and it would guess wrong
        // for every prose section that quotes a requirement as documentation. A
        // requirement above every heading has no heading to name, and no claim to be
        // written in the delta grammar at all — same judgement as `## Requirements`.
        //
        // A warning that GATES archive — the one check where the two axes
        // diverge. Severity says whether the document is valid: this shape is
        // legal OpenSpec, so an error would fail `loam validate` on every
        // adopted repo whose active deltas still use it. Gating says whether
        // the merge is safe: it is not — the merge would silently drop authored
        // content, the exact loss this module exists to prevent — so archive
        // refuses, and `--approve` remains the way to say the loss is meant.
        if (r.kind === "BASE") {
          if (r.section !== undefined && !isRequirementsHeading(r.section)) {
            issues.push({
              severity: "warn",
              gates: true,
              code: "delta.requirement-not-merged",
              subject: service,
              message: `${where}: requirement '${r.name}' sits under '${r.section}', which is not a delta section — archive will NOT merge it. Move it under '## ADDED Requirements' (or MODIFIED/REMOVED), or drop it if it is documentation.`,
            });
          }
          continue;
        }

        if (r.kind === "ADDED") {
          const idMatches = r.id === undefined ? [] : (livingById.get(r.id) ?? []);
          const nameMatches = livingByName.get(r.name) ?? [];
          const nameSelectsOther = r.id !== undefined && nameMatches.some((candidate) => candidate.id !== r.id);
          if (nameSelectsOther) {
            issues.push({
              severity: "error",
              code: "delta.requirement-identity-collision",
              subject: service,
              message: `${where}: ADDED requirement '${r.name}' carries Requirement-ID '${r.id}', but that heading already identifies a different living requirement — ID and name cannot select different identities`,
            });
            continue;
          }
          if ((r.id === undefined && livingNames.has(r.name)) || idMatches.length > 0) {
            issues.push({
              severity: "error",
              code: "delta.added-duplicate",
              subject: service,
              message: r.id === undefined
                ? `${where}: ADDED requirement '${r.name}' already exists in the ${livingDoc} — the merge would REPLACE it, scenarios and all. Use MODIFIED, or rename.`
                : `${where}: ADDED requirement '${r.name}' uses Requirement-ID '${r.id}', which already exists in the ${livingDoc} — use MODIFIED to change that identity`,
            });
            continue;
          }
          // Merge identity is exact string equality (applyRequirementDelta), so a
          // name that differs only in case slips past the duplicate check above and
          // lands as a SECOND requirement next to the living one. A warning, not an
          // error: the author may genuinely mean a distinct requirement, but with
          // LLM authors the case drift is the likely story. Never fires together
          // with added-duplicate — an exact match continues before this runs.
          const near = livingFolded.get(r.name.toLowerCase());
          if (near !== undefined) {
            issues.push({
              severity: "warn",
              code: "delta.added-near-duplicate",
              subject: service,
              message: `${where}: ADDED requirement '${r.name}' differs only in case from living requirement '${near}' — the merge matches names exactly, so both would coexist. Match the living spelling and use MODIFIED, or pick a distinct name.`,
            });
          }
          const other = await addedElsewhere(service, axis, r);
          if (other !== undefined) {
            issues.push({
              severity: "warn",
              code: "delta.added-conflict",
              subject: service,
              message: `${where}: requirement '${r.name}' is also added by ${other} — whichever archives first lands it, and the second archive is refused (delta.added-duplicate) unless --approve`,
            });
          }
          continue;
        }

        // MODIFIED vs MODIFIED on ONE living requirement. The ADDED case has
        // been caught since delta.added-conflict: two features adding the same
        // name collide loudly, because the second archive is refused. Two
        // features CHANGING the same requirement collide in total silence —
        // both deltas apply cleanly, and whichever archives second replaces
        // the first's text, scenarios and all, with a version written against
        // a document that no longer exists. A warning, not a gate: the second
        // author may well be rewriting on purpose, and only they can say.
        const alsoChanged = await claimedElsewhere("changed", service, axis, r);
        if (alsoChanged !== undefined) {
          issues.push({
            severity: "warn",
            code: "delta.modified-conflict",
            subject: service,
            message: `${where}: ${r.kind} requirement '${r.name}' is also changed by ${alsoChanged} — both deltas apply cleanly, so whichever archives second REPLACES the other's text wholesale. Agree on one owner, or fold the two changes together.`,
          });
        }

        if (r.id !== undefined) {
          const idMatches = livingById.get(r.id) ?? [];
          const nameMatches = livingByName.get(r.name) ?? [];
          const nameSelectsOther = nameMatches.some((candidate) => candidate.id !== r.id);
          // The second disjunct is defensive rather than reachable: a living
          // requirement under this heading that the ID did NOT select must carry
          // some other ID, which is what `nameSelectsOther` already says. It is
          // kept because it states the rule the reader is being told — ID and
          // heading must select the same identity — without depending on that
          // derivation holding after the next edit.
          if (nameSelectsOther || (idMatches.length === 0 && nameMatches.length > 0)) {
            issues.push({
              severity: "error",
              code: "delta.requirement-identity-collision",
              subject: service,
              message: `${where}: ${r.kind} requirement '${r.name}' carries Requirement-ID '${r.id}', but its ID and heading select different living requirements — fix the ID or heading; archive will not guess`,
            });
            continue;
          }
          // A differing heading is the explicit loam rename mechanism: the
          // stable ID selects the old requirement, MODIFIED supplies its new name.
          //
          // Total in the ID, deliberately: an ID that matches SEVERAL living
          // requirements has already been refused as
          // `delta.living-requirement-id-invalid` (severity error, so archive is
          // gated either way), and the living document is where it gets fixed.
          // Falling through instead added `delta.modified-unknown` — "does not
          // exist … Did you mean ADDED?" — beside it, which is both false and
          // the more actionable-sounding of the two, and it sends the author to
          // edit the delta over a problem that is not in the delta. There is no
          // baseline to check against an ambiguous selection, so the pin is
          // simply not graded until the ambiguity is gone.
          if (idMatches.length > 0) {
            const selected = idMatches.length === 1 ? idMatches[0] : undefined;
            if (selected !== undefined) checkBaseline(r, selected);
            continue;
          }
        } else if (livingNames.has(r.name)) {
          // Twins under one heading are already refused
          // (`delta.living-duplicate-requirement`), and applyRequirementDelta
          // takes the first either way — so the pin is compared against the
          // same requirement the merge would rewrite.
          checkBaseline(r, livingByName.get(r.name)![0]!);
          continue;
        }

        const other = await addedElsewhere(service, axis, r);
        if (other !== undefined) {
          issues.push({
            severity: "warn",
            code: r.kind === "MODIFIED" ? "delta.modified-pending" : "delta.removed-pending",
            subject: service,
            message: `${where}: ${r.kind} requirement '${r.name}' is not in the ${livingDoc} yet — ${other} introduces it. Archive ${other} first.`,
          });
          continue;
        }
        issues.push({
          severity: "error",
          code: r.kind === "MODIFIED" ? "delta.modified-unknown" : "delta.removed-unknown",
          subject: service,
          message:
            r.kind === "MODIFIED"
              ? `${where}: MODIFIED requirement '${r.name}' does not exist in the ${livingDoc} — the merge would create it. Did you mean ADDED?`
              : `${where}: REMOVED requirement '${r.name}' does not exist in the ${livingDoc} — there is nothing to remove`,
        });
      }
    }
  }

  return issues;
}

/**
 * What other ACTIVE features claim, per (service, axis, requirement): what they
 * ADD, and — separately — what they CHANGE or REMOVE. The two are separate
 * indexes because they mean opposite things to the reader: an addition
 * elsewhere explains why a MODIFIED target is missing today, a change elsewhere
 * warns that the target is contested. One scan builds both; scanning twice
 * would double the fleet walk for the same bytes.
 */
interface ActiveClaims {
  added: Map<string, string>;
  changed: Map<string, string>;
}

async function activeClaims(
  docsDir: string,
  exclude: string,
  context?: FleetContext,
): Promise<ActiveClaims> {
  const added = new Map<string, string>();
  const changed = new Map<string, string>();
  for (const feature of await listFeatures(docsDir, {}, context)) {
    if (feature.id === exclude) continue;
    for (const service of feature.services) {
      for (const axis of SPEC_AXES) {
        const path = featureSpecPaths(feature.dir, service)[axis.key];
        if (!existsSync(path)) continue;
        const reqs = context === undefined
          ? parseRequirements(await readFile(path, "utf8"))
          : await context.readRequirements(path);
        for (const r of reqs) {
          const map = r.kind === "ADDED" ? added : r.kind === "MODIFIED" || r.kind === "REMOVED" ? changed : null;
          if (map === null) continue;
          for (const identity of new Set([requirementKey(r), `name:${r.name}`])) {
            const k = key(service, axis, identity);
            if (!map.has(k)) map.set(k, feature.id);
          }
        }
      }
    }
  }
  return { added, changed };
}
