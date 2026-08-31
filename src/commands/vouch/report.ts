/**
 * What a successful vouch prints: the machine envelope, and the screen the
 * person who just vouched is looking at.
 *
 * Split out of `vouch.ts` when `--sample` arrived and that file reached its
 * line limit, on the phase seam the command already had: everything above it
 * decides whether to write, everything here describes what was written. The
 * two renderings stay in one module because they report the SAME stamp, and
 * the one failure this file exists to prevent is a text screen and a payload
 * that disagree about what a document now says.
 */
import { emitJson, repoPath } from "../../core/envelope/json.js";
import type { DocsDir } from "../../core/kernel/ids/dirs.js";
import { plural, sayRecovered } from "../policy/format.js";
import type { StampedSpec, VouchOutcome } from "./contract.js";
import type { PlannedAxis, SamplePlan } from "./sample/plan.js";
import { scopeJson } from "./sample/print.js";

export interface StampReport {
  service: string;
  docsDir: DocsDir;
  /** The successful arm — the only one that has a stamp to describe. */
  outcome: Extract<VouchOutcome, { ok: true }>;
  /** The reading list this run was answered against, when it was a sampled one. */
  sample?: SamplePlan;
}

/**
 * The plan entry for one stamped file, joined by FILENAME — never by position.
 * The two axes are stamped by two separate calls, and pairing them by index
 * would hang one file's headings off the other file's scope.
 */
function plannedAxis(report: StampReport, spec: StampedSpec): PlannedAxis | undefined {
  return report.sample?.axes.find((axis) => axis.file === spec.file);
}

export function emitStampJson(report: StampReport): void {
  const { spec, archSpec: arch } = report.outcome.stamped;
  emitJson({
    command: "vouch",
    service: report.service,
    path: repoPath(report.docsDir, spec.path),
    ...(report.outcome.recovered === null ? {} : { recovered: report.outcome.recovered }),
    status: report.outcome.status,
    last_verified: report.outcome.lastVerified,
    vouched_by: report.outcome.vouchedBy,
    sources: spec.sources,
    sources_digest: spec.digest,
    content_digest: spec.contentDigest,
    files: spec.files,
    skipped: spec.skipped,
    // Additive, and beside `status` rather than inside it: `verified` is a
    // frozen string and a sampled read is a qualification of it, not a fourth
    // status. Null — never omitted — for a file read in full, so a consumer
    // can tell "this loam says it was full" from "this loam has never heard
    // of scopes".
    vouchScope: scopeJson(spec.vouchScope, plannedAxis(report, spec)),
    // The architecture axis, same keys: null when the service has no
    // arch.spec.md, so a consumer can tell "none present" from an older
    // loam that never reported the axis. status/last_verified are not
    // repeated — the vouch is one act, and they hold for every file in it.
    archSpec:
      arch === null
        ? null
        : {
            path: repoPath(report.docsDir, arch.path),
            sources: arch.sources,
            sources_digest: arch.digest,
            content_digest: arch.contentDigest,
            files: arch.files,
            skipped: arch.skipped,
            // Per file, because the sample is per file: one `--sample 3` run
            // can stamp a sampled spec.md beside a fully-read arch.spec.md,
            // and one scope for the pair would be false about one of them.
            vouchScope: scopeJson(arch.vouchScope, plannedAxis(report, arch)),
          },
  });
}

export function printStamp(report: StampReport): void {
  const { outcome, service } = report;
  const { spec, archSpec: arch } = outcome.stamped;
  // spec.md first, arch.spec.md behind it when present — the order the
  // person who vouched reads them in, and the order the axes are declared.
  if (outcome.recovered !== null) console.log(`${sayRecovered(outcome.recovered)}\n`);
  for (const [i, s] of [spec, ...(arch === null ? [] : [arch])].entries()) {
    console.log(`${i > 0 ? "\n" : ""}${service} vouched — ${repoPath(report.docsDir, s.path)}\n`);
    console.log(`  status          ${outcome.status}`);
    console.log(`  last_verified   ${outcome.lastVerified}`);
    console.log(`  vouched_by      ${outcome.vouchedBy}`);
    console.log(
      `  sources_digest  ${s.digest}  (${plural(s.files, "file")} from ${plural(s.sources.length, "source")})`,
    );
    console.log(`  content_digest  ${s.contentDigest}`);
    // On the same screen as the digests, in the same column, because this is
    // the field that says the promise beside it is partial. A reader who scans
    // the stamp and stops must not be able to miss it.
    if (s.vouchScope !== null) {
      console.log(
        `  vouch_scope     sampled ${s.vouchScope.sections}/${s.vouchScope.of} seed=${s.vouchScope.seed}  ` +
          `(${plural(s.vouchScope.of - s.vouchScope.sections, "section")} unread)`,
      );
    }
    // Said at the moment of stamping, not only later by `loam validate`:
    // this is the one screen the person who vouched is actually looking at,
    // and what it lists is the part of the tree their promise does not cover.
    if (s.skipped.length > 0) {
      console.log(`\n  ⚠ ${plural(s.skipped.length, "path")} under those sources went unhashed:`);
      for (const skip of s.skipped) console.log(`      ${skip.path} — ${skip.reason}`);
    }
  }
  const sampled = [spec, arch].some((s) => s !== null && s.vouchScope !== null);
  console.log(
    `\n\`loam validate\` will now say when that code moves out from under the spec — or when the spec moves under its own stamp.`,
  );
  if (sampled) {
    console.log(
      `It will also report \`sources.sampled-vouch\` for '${service}' until a person vouches for the whole document ` +
        `(\`loam vouch --service ${service}\`, no --sample), which clears the scope.`,
    );
  }
}
