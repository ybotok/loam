import { existsSync } from "node:fs";
import { type PathableService } from "../../../core/kernel/ids.js";
import { servicePaths, SPEC_AXES } from "../../../core/repo/paths.js";
import { listField, readFrontmatter } from "../../../core/document/frontmatter.js";
import { type Finding } from "../../../core/vocabulary/report.js";
import { missingSources, patternSources, unsafeSources } from "../../../core/provenance/sources.js";
import { emptySourcesMessage, expandSourceFiles } from "../../../core/provenance/stamp.js";
import { UNVERIFIABLE } from "./vocabulary.js";

/**
 * The two things a `sources` list can be that `serviceProvenance` cannot say.
 *
 * `sources.unverifiable-from-here` — the spec names sources and loam is NOT in
 * that service's repository, so every sources check (existence, digest,
 * staleness) is skipped. serviceProvenance returns an empty list in that case
 * and the silence read as "checked and fine". It used to be counted only under
 * `--all` and printed as one rollup line, which meant `validate --service X`
 * run from the docs repo — the single most common way anyone looks at one
 * service — reported nothing at all about its own blind spot. Severity `ok`,
 * deliberately: nothing is WRONG with the docs, the check simply cannot run
 * here, and grading it a warning would make a correctly-adopted fleet
 * permanently yellow and `--strict` permanently red in the docs repo's CI.
 *
 * `sources.empty` — the paths exist, and expand to no files at all: an empty
 * directory, or a tree the repository itself ignores. A digest over nothing
 * never changes, so the stamp would read as current forever. `loam vouch`
 * already refuses to stamp it; until now `validate` said nothing, so an author
 * got a green run followed by a refusal, two commands contradicting each other
 * about one document. The sentence comes from `emptySourcesMessage`, the same
 * definition vouch refuses with, under the label vouch uses.
 */
export async function sourceScopeFindings(
  docsDir: string,
  service: PathableService,
  repoDir: string | undefined,
): Promise<Finding[]> {
  const paths = servicePaths(docsDir, service);
  const out: Finding[] = [];
  // The axis pair is SPEC_AXES', not this function's: `serviceProvenance` grades
  // the same two files from the same list, and a scope check that walked a
  // shorter list than the grading would go quiet on the axis it forgot.
  for (const { path, file } of SPEC_AXES.map((axis) => ({ path: paths[axis.key], file: axis.file }))) {
    if (!existsSync(path)) continue;
    const sources = listField(await readFrontmatter(path), "sources");
    if (sources.length === 0) continue;
    // vouch's own labelling: a bare service id for spec.md, qualified for the
    // arch axis. The refusal and the finding must be the same sentence.
    const label = file === "spec.md" ? service : `${service}: ${file}`;
    if (repoDir === undefined) {
      out.push({
        severity: "ok",
        code: UNVERIFIABLE,
        subject: service,
        message: `${label}: ${sources.length} source(s) declared, but this is not ${service}'s repository — nothing here can resolve them. Run \`loam validate --service ${service}\` from inside it.`,
      });
      continue;
    }
    // Every other shape of broken list is serviceProvenance's to grade, and
    // grading them twice would send an author fixing one thing from two
    // findings. "Covers no files" is only meaningful once the paths are real.
    if (
      patternSources(sources).length > 0 ||
      unsafeSources(repoDir, sources).length > 0 ||
      missingSources(repoDir, sources).length > 0
    ) {
      continue;
    }
    const expansion = await expandSourceFiles(repoDir, sources, label);
    if (expansion.files.length > 0) continue;
    out.push({
      severity: "warn",
      code: "sources.empty",
      subject: service,
      message: expansion.empty ?? emptySourcesMessage(label, sources),
    });
  }
  return out;
}

