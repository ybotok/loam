/**
 * The pre-pass behind `loam vouch --sample <n>`: decide, before anyone is
 * asked anything, which sections of which files this vouch will actually
 * cover.
 *
 * It has to happen before the confirmation because a sampled vouch's question
 * is different in kind — "have you read THESE four sections", not "have you
 * read the code" — and a question that names nothing is the reflex this
 * command exists to interrupt. So the reading list is computed first, printed,
 * and only then is the person asked.
 *
 * It runs the vouch's own vetting (`../vet/verify.ts`, the same call
 * `run.ts` and the reading pack make), which means every refusal a vouch can
 * raise about a document — an unreadable header, no `sources`, a glob
 * pattern, a source that is gone, an expansion covering no files — fires HERE,
 * before the prompt, with the same code and the same words. A person should
 * not read four sections and then be told the run was never going to stamp.
 *
 * The cost is that the sources are walked and hashed twice: once to seed the
 * sample, once at the stamp. That is the honesty price of the seed being
 * content-derived, and `run.ts` spends the second walk anyway — what the
 * second walk buys is the drift check, which refuses a stamp whose sample was
 * chosen from a document that has since moved.
 */
import { existsSync } from "node:fs";
import { rawBody } from "../../../core/document/frontmatter.js";
import type { DocsDir } from "../../../core/kernel/ids/dirs.js";
import type { PathableService } from "../../../core/kernel/ids/service.js";
import type { DocSection } from "../../../core/provenance/sample/sections.js";
import { planSample, type VouchScope } from "../../../core/provenance/sample/scope.js";
import { contentDigest } from "../../../core/provenance/stamp.js";
import { SPEC_AXES } from "../../../core/repo/paths.js";
import { locateServicePaths } from "../../../core/repo/service-target.js";
import { noLivingSpecMessage, verifySpec, type SpecRefusal, type VerifiedSpec } from "../vet/verify.js";

/**
 * One spec-axis file's share of a `--sample <n>` run, as the pre-pass decided
 * it and the stamp must honour it.
 *
 * A variant rather than an optional `picked?:`, because "read in full" and
 * "sampled" are two different claims and the difference decides whether the
 * file gets a `vouch_scope` at all. The two digests ride on both arms: they
 * are what the seed was derived from, and the stamp re-checks them against a
 * fresh verification, because a person reads for minutes and nothing locks
 * the document while they do.
 */
interface PlannedAxisBase {
  /** The axis's filename — "spec.md" or "arch.spec.md". The key the stamp joins on. */
  file: string;
  /** Absolute path, for the reading list's own line. */
  path: string;
  /** `contentDigest(raw)` when the reading list was built. */
  contentDigest: string;
  /** The sources digest when the reading list was built. */
  sourcesDigest: string;
  /** Every section the body had. */
  of: number;
  /**
   * How many lines of frontmatter sit above the body. `DocSection.line` is
   * counted within the BODY — that is what the splitter can promise, since it
   * is handed a body — and a reading list that printed those numbers as file
   * lines would send a person to the wrong place in every stamped document.
   * Added once, at the display edge.
   */
  lineOffset: number;
  /** The `sources` entries as the frontmatter spells them, and how many files they expanded to. */
  sources: { entries: string[]; files: number };
}

export type PlannedAxis =
  /** `of <= n`: the sample covers the whole file, so this axis is an ordinary full vouch. */
  | (PlannedAxisBase & { mode: "full" })
  | (PlannedAxisBase & { mode: "sampled"; seed: string; picked: readonly DocSection[] });

export interface SamplePlan {
  /** `--sample <n>` as the person typed it — carried so the output can say what was asked for. */
  n: number;
  /**
   * Every spec-axis file the pre-pass verified, sampled or not. Complete on
   * purpose: the stamp compares this roster against what it re-verifies, so an
   * arch.spec.md that appeared while the person was reading refuses the run
   * instead of riding along unread.
   */
  axes: PlannedAxis[];
}

/** The scope a planned axis will stamp, or null for one that was read in full. */
export function axisScope(axis: PlannedAxis): VouchScope | null {
  return axis.mode === "full" ? null : { sections: axis.picked.length, of: axis.of, seed: axis.seed };
}

/**
 * What moved between the reading list and the stamp, as a phrase for the
 * refusal — or null when the plan and the fresh verification describe the same
 * documents.
 *
 * Joined by FILENAME both ways, and both directions matter: a plan entry with
 * no verified file means an axis vanished mid-read, a verified file with no
 * plan entry means one appeared and nobody was shown it. Comparing counts, or
 * zipping the two lists, would call the second case fine.
 *
 * The digests, not the bytes: `content_digest` and `sources_digest` are the
 * seed's own inputs, so a change in either is exactly a change in which
 * sections a sample would pick. It lives here rather than in `run.ts` because
 * it is a question about the PLAN — whether the reading list still describes
 * these files — and the answer has to be computed the same way the plan was.
 */
export function sampleDrift(
  plan: SamplePlan,
  verified: readonly VerifiedSpec[],
  service: string,
): string | null {
  const now = new Map(verified.map((v) => [v.file, v] as const));
  const moved = plan.axes
    .filter((axis) => {
      const v = now.get(axis.file);
      return v === undefined || contentDigest(v.raw) !== axis.contentDigest || v.digest !== axis.sourcesDigest;
    })
    .map((axis) => axis.file);
  const planned = new Set(plan.axes.map((axis) => axis.file));
  const appeared = verified.filter((v) => !planned.has(v.file)).map((v) => v.file);
  const files = [...moved, ...appeared];
  if (files.length === 0) return null;
  // The whole sentence, not the file list: `run.ts` returns it verbatim under
  // `vouch-raced`, and the diagnosis — which is about a READING window nothing
  // locks — belongs beside the check that can explain it.
  return (
    `${service}: ${files.join(", ")} changed while you were reading the sample — the sections you were shown are ` +
    `not the sections a stamp would now cover. Nothing was stamped: re-run for a fresh reading list.`
  );
}

export interface SampleRequest {
  docsDir: DocsDir;
  service: PathableService;
  /** The service's own repo — what `sources` resolve against. */
  repoDir: string;
  /** How many sections to read per spec-axis file. A whole number of at least 1; the caller validates. */
  n: number;
}

export type SampleOutcome =
  | { ok: true; plan: SamplePlan }
  | { ok: false; code: SpecRefusal["code"] | "unknown-target"; message: string };

/**
 * Build the reading list. Same axis walk as `run.ts` — spec.md required,
 * arch.spec.md when it exists — and the same all-or-nothing discipline: one
 * file that cannot be verified refuses the run before a person is asked to
 * read anything.
 */
export async function buildSamplePlan(req: SampleRequest): Promise<SampleOutcome> {
  const paths = await locateServicePaths(req.docsDir, req.service);
  if (!existsSync(paths.spec)) {
    // One sentence, from `vet/verify.ts`: the same absence and the same fix,
    // and three spellings of it would read as three different problems.
    return { ok: false, code: "unknown-target", message: noLivingSpecMessage(paths.spec, req.service) };
  }
  const axes: PlannedAxis[] = [];
  for (const axis of SPEC_AXES) {
    const path = paths[axis.key];
    if (!existsSync(path)) continue;
    // Sequential, not Promise.all: each iteration hashes a whole source tree
    // through the batched digest, and two of those in flight at once doubles
    // the file descriptors that batching exists to bound. Two files.
    const vetted = await verifySpec({ service: req.service, repoDir: req.repoDir }, path, axis.file);
    if (!vetted.ok) return vetted;
    const digest = contentDigest(vetted.raw);
    // The BODY, so no frontmatter line can be picked as a section — and the
    // same slice `content_digest` is taken over, which is what makes the
    // seed's inputs and the sampled text describe one document.
    const body = rawBody(vetted.raw);
    const sample = planSample({
      service: req.service,
      contentDigest: digest,
      sourcesDigest: vetted.digest,
      body,
      n: req.n,
    });
    const base = {
      file: axis.file,
      path,
      contentDigest: digest,
      sourcesDigest: vetted.digest,
      of: sample.of,
      // The header's line count, by subtraction rather than a second parse:
      // `rawBody` is the one definition of where the body starts, and asking
      // it twice is how the two answers drift.
      lineOffset: vetted.raw.slice(0, vetted.raw.length - body.length).split("\n").length - 1,
      sources: { entries: vetted.sources, files: vetted.index.length },
    };
    axes.push(
      sample.picked.length >= sample.of
        ? { ...base, mode: "full" }
        : { ...base, mode: "sampled", seed: sample.seed, picked: sample.picked },
    );
  }
  return { ok: true, plan: { n: req.n, axes } };
}
