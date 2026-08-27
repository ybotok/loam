/**
 * The four checks behind `loam gate` — a can-i-deploy-shaped PURE QUERY over
 * evidence other commands already recorded. Nothing here executes anything,
 * writes anything, takes the docs lock, or re-derives a coherence plan: every
 * answer is either already on disk (verification.yaml, vouch stamps, the
 * commit journal) or a presence/landscape fact the enumeration carries.
 *
 *   partners      the landscape's direct joins, both ends graded on the ladder
 *   freshness     content.stale / sources.stale over the target and partners,
 *                 plus the one integrity error that makes freshness
 *                 unjudgeable (frontmatter.malformed) and a refusing decode
 *                 of the spec bytes themselves
 *   verification  verificationState per active feature touching the service
 *                 (its own module, `./verification.ts`)
 *   interrupted   the `.loam-commit` journal — the one repo state that poisons
 *                 every other answer above
 *
 * Every `gate.*` code is spelled as a literal `code:` property at its emit
 * site, never through a code-taking factory parameter — verifyStep
 * (core/status/verification.ts) records that test/codes-drift.test.ts's
 * collector is blind to the parameter form, and a refactor toward a factory
 * would silently undocument the family.
 */
import { existsSync } from "node:fs";
import { inOrder } from "../kernel/concurrency.js";
import { serviceProvenance } from "../provenance/findings.js";
import { interruptedCommitFinding } from "../staging/recovery/finding.js";
import { servicePathsAt, SPEC_AXES, type ServicePaths } from "../repo/paths.js";
import { serviceTreePath } from "../kernel/ids/dirs.js";
import { locateServicePaths } from "../repo/service-target.js";
import type { Finding } from "../vocabulary/report.js";
import type { FleetContext } from "../fleet-context.js";
import type { DocsDir } from "../kernel/ids/dirs.js";
import type { RawServiceId } from "../kernel/ids/service.js";
import { atLeastDocumented, partnerScan, type PartnerScan } from "./partners.js";
import { verificationCheck } from "./verification.js";
import { unreadableSubject, type GateCheck, type GateReport } from "./report.js";

export interface GateRequest {
  docsDir: DocsDir;
  /** The service being deployed — a name the enumeration approved. */
  service: RawServiceId;
  /**
   * The repository loam is standing in, passed ONLY when the gated service is
   * this repo's own binding — validate's `repoOf` rule: `sources` are paths
   * into a service's own repository, so `sources.stale` is honestly checkable
   * only there, while `content.stale` needs nothing but the document.
   */
  repoDir?: string;
  fleet: FleetContext;
}

export async function gateReport(req: GateRequest): Promise<GateReport> {
  // The scan first, alone: freshness walks the partner set it derives. The
  // three remaining checks are independent of each other — different files,
  // memoized reads — so they run concurrently; only the scan must be ordered.
  const scan = await partnerScan({ docsDir: req.docsDir, service: req.service, fleet: req.fleet });
  const [freshness, verification, interrupted] = await Promise.all([
    freshnessFindings(req, scan),
    verificationCheck({ docsDir: req.docsDir, service: req.service, fleet: req.fleet }),
    interruptedCommitFinding(req.docsDir),
  ]);
  const checks: GateCheck[] = [
    { check: "partners", findings: partnersFindings(scan, req.service) },
    { check: "freshness", findings: freshness },
    { check: "verification", findings: verification.findings },
    { check: "interrupted", findings: interrupted === null ? [] : [interrupted] },
  ];
  return {
    service: req.service,
    landscape: scan.landscape,
    partners: scan.partners,
    features: verification.features,
    checks,
  };
}

/* ------------------------------------------------------------------ */
/* Check 1: partners                                                   */
/* ------------------------------------------------------------------ */

function partnersFindings(scan: PartnerScan, service: string): Finding[] {
  const findings: Finding[] = [];
  // "Could not look" must never read as "no partners" — the docsRepoReady
  // doctrine one level down. `validate --all` owns the diagnosis of the
  // landscape itself; this code only refuses the false silence. The two ways
  // of not looking are graded apart, the way `landscape.missing` and
  // `landscape.invalid` are: ABSENT is a warning — a repo before its first
  // adopt legitimately has no map yet — but a map that EXISTS and cannot be
  // parsed or read is an ERROR, because `validate --all` fails that repo
  // (`landscape.invalid`) and a deploy gate that passed where the fleet gate
  // fails would be the quieter of two contradictory verdicts.
  if (scan.landscape === "absent") {
    findings.push({
      severity: "warn",
      code: "gate.partners-unknown",
      message: `architecture/landscape.likec4 does not exist, so the partner set for '${service}' could not be derived — an absent map means nobody could look, not that nothing joins this service. \`loam validate --all\` diagnoses the landscape itself.`,
    });
  } else if (scan.landscape === "invalid") {
    findings.push({
      severity: "error",
      code: "gate.partners-unknown",
      message:
        `architecture/landscape.likec4 exists but cannot be used — ${scan.landscapeProblem ?? "it did not parse"} — so the partner set for '${service}' could not be derived. ` +
        `A broken map means nobody could look, not that nothing joins this service, and \`loam validate --all\` fails this repo for the same file. Fix the landscape, then re-run.`,
    });
  }
  // The rung depends on the landscape only through the api question (does
  // anything call this service?). With no readable map that question is
  // unanswerable, and the fail-closed grading — `landscapeEvidence`: no proof
  // means an API is expected — would convict a worker or UI for a contract
  // nobody may be owed. One unanswerable fact yields ONE finding (the
  // landscape's own, above), so under an unreadable map this error fires only
  // when the service is below `documented` REGARDLESS of the api question.
  const target = scan.landscape === "read" ? scan.target : scan.targetWithoutApi;
  if (!atLeastDocumented(target.maturity)) {
    findings.push({
      severity: "error",
      code: "gate.service-undocumented",
      subject: service,
      message:
        `${serviceTreePath(scan.targetEntry)}/ sits at '${target.maturity}' on the adoption ladder — below 'documented', the docs cannot say what its joins even are, so no recorded evidence can answer the deploy question. ` +
        `Author the baseline (\`loam adopt --service ${service}\` briefs it); this check passes once the required artifact set exists.`,
      details: target.gaps,
      text: { detailPrefix: "- " },
    });
  }
  // The partners that HAVE a directory, by id: their findings name it, and it
  // is `services/<subsystem>/<id>/` for a filed one. The no-directory branch
  // below keeps the bare `services/<id>/` spelling deliberately — there is no
  // directory to name, and the unfiled form is what the fix would create.
  const partnerPath = new Map(scan.partnerEntries.map((e) => [e.id as string, serviceTreePath(e)]));
  for (const p of scan.partners) {
    // An `#external` partner is somebody else's system: its side of the join
    // is unrecorded ON PURPOSE, the same exemption the landscape census grants
    // (`landscape.service-undocumented` skips #external too).
    if (p.external) continue;
    if (p.maturity === null) {
      findings.push({
        severity: "warn",
        code: "gate.partner-undocumented",
        subject: p.service,
        message:
          `'${p.service}' joins '${service}' (${p.via.join(", ")}) but has no services/${p.service}/ directory — its side of the join is unrecorded. ` +
          `Adopt it, bind its landscape element to the right service with metadata { service '<id>' }, or tag it #external if it is not ours.`,
        details: p.via,
      });
    } else if (!atLeastDocumented(p.maturity)) {
      findings.push({
        severity: "warn",
        code: "gate.partner-undocumented",
        subject: p.service,
        message:
          `${partnerPath.get(p.service) ?? `services/${p.service}`}/ sits at '${p.maturity}' — below 'documented' — while it joins '${service}' (${p.via.join(", ")}): its side of the join is not fully recorded. \`loam adopt --service ${p.service}\` briefs what is missing.`,
        details: p.via,
      });
    }
  }
  return findings;
}

/* ------------------------------------------------------------------ */
/* Check 2: freshness                                                  */
/* ------------------------------------------------------------------ */

/**
 * `serviceProvenance` filtered to the two staleness codes plus the ONE
 * integrity error that makes freshness unjudgeable: `frontmatter.malformed`.
 * A header YAML refuses to parse cannot certify a `content_digest`, and
 * dropping that error read "cannot judge" as "nothing stale" — the exact
 * fail-open a deploy gate must not have. Everything else provenance grades
 * (missing owners, unstamped sources, absent frontmatter) is `validate`'s
 * report to make — a deploy gate that repeated it would drown the findings a
 * pipeline can actually act on at deploy time.
 */
async function freshnessFindings(req: GateRequest, scan: PartnerScan): Promise<Finding[]> {
  const subjects: { id: RawServiceId; repoDir: string | undefined; paths: ServicePaths }[] = [
    {
      id: req.service,
      repoDir: req.repoDir,
      paths: await locateServicePaths(req.docsDir, req.service, req.fleet),
    },
    // Only the DOCUMENTED partners: a partner with no directory has nothing to
    // grade, and already carries gate.partner-undocumented from check 1.
    ...scan.partnerEntries.map((e) => ({
      id: e.id,
      repoDir: undefined,
      paths: servicePathsAt(e.dir),
    })),
  ];
  // Independent per-subject reads through the shared memo; inOrder keeps the
  // findings in subject order (target first, partners sorted) so identical
  // state yields identical bytes.
  const graded = await inOrder(subjects, async (s) => {
    try {
      // The integrity gate serviceProvenance cannot give: its own reads decode
      // with 'utf8', which silently turns UTF-16 bytes into replacement
      // characters — the file then grades as having no frontmatter at all (a
      // warning this check does not retain), and mangled bytes read as
      // "nothing stale". So both spec axes are decoded FIRST through the
      // invocation's read index, whose decoder refuses non-UTF-8 naming the
      // file (NotUtf8DocumentError spells `path` the way Node does, so the
      // containment below names it without knowing the type).
      for (const axis of SPEC_AXES) {
        const path = s.paths[axis.key];
        if (existsSync(path)) await req.fleet.readText(path);
      }
      const all = await serviceProvenance(req.docsDir, s.id, { repoDir: s.repoDir, fleet: req.fleet });
      return all
        .filter(
          (f) =>
            f.code === "content.stale" ||
            f.code === "sources.stale" ||
            f.code === "frontmatter.malformed",
        )
        // The staleness emitters name the file in the message but set no
        // subject; the payload's per-service attribution should not make a
        // caller parse it back out of prose.
        .map((f) => (f.subject === undefined ? { ...f, subject: s.id } : f));
    } catch (err) {
      return [unreadableSubject("service", s.id, err)];
    }
  });
  return graded.flat();
}
