/**
 * The artifact table: which files a feature owes, whether each is on disk, and
 * which finding turns a row `draft`. Nothing is graded here — the shared
 * checks already ran, and this module only attributes what they reported to
 * the file a reader should edit.
 */
import { existsSync } from "node:fs";
import { repoPath } from "../../envelope/json.js";
import type { FeatureEntry } from "../../repo/entries.js";
import { featurePaths, featureSpecPaths } from "../../repo/paths.js";
import { verificationPath } from "../../verify.js";
import type { Finding } from "../../vocabulary/report.js";
import { owesContract } from "../contracts.js";
import type { ArtifactId, ArtifactState, ArtifactStatus, VerificationState } from "../report.js";
import { verificationStatus } from "../verification.js";

/**
 * Which artifact an error names.
 *
 * Attribution is by code family, because that is the only machine-readable
 * pointer an `Issue` carries: `subject` narrows to a service, never to a file.
 * The families are unambiguous — `c4-api.*`/`c4.*` and the two `delta.*` codes
 * about the LikeC4 document itself grade the architecture axis, `openapi.*`
 * grades the contract, and the remaining `delta.*` codes are the delta-shape
 * checks, every one of which is about a requirement in a spec delta.
 *
 * An error that maps to nothing (or whose subject is unknown) still lands in
 * `checks.issues` and still drives `next.fix-coherence` — it just does not turn
 * any single artifact `draft`, because guessing which file to blame is how a
 * reader gets sent to edit the wrong one.
 */
function faultedArtifact(code: string): ArtifactId | null {
  if (code === "delta.invalid" || code === "delta.nothing-tagged") return "delta";
  if (code.startsWith("c4-api.") || code.startsWith("c4.")) return "delta";
  if (code.startsWith("openapi.")) return "openapi";
  if (code.startsWith("delta.") || code.startsWith("spec-api.")) return "spec";
  // The two families validate contributes: the frontmatter checks read only
  // intent.md, and a requirement with no scenario is a requirement in a spec
  // delta. Both name exactly one file, so both may turn a row `draft`.
  if (code.startsWith("frontmatter.")) return "intent";
  if (code === "requirements.missing-scenarios") return "spec";
  return null;
}

/**
 * The artifact table. Every entry is graded by two questions in order — is it
 * there, and does anything the shared checks reported name it — so a file that
 * exists and is wrong can never be reported the way one that was never written
 * is.
 */
export function featureArtifacts(
  docsDir: string,
  feature: FeatureEntry,
  services: string[],
  blocking: Finding[],
  verification: VerificationState,
  contracted: ReadonlySet<string>,
  governs: ReadonlySet<string>,
): ArtifactState[] {
  const paths = featurePaths(feature.dir);
  const rel = (abs: string): string => repoPath(docsDir, abs);
  const faults = blocking.map((f) => ({ artifact: faultedArtifact(f.code), subject: f.subject }));
  const faulted = (id: ArtifactId, service: string | null): boolean =>
    faults.some((f) => f.artifact === id && (service === null || f.subject === service));

  const out: ArtifactState[] = [
    fileState("intent", null, rel(paths.intent), existsSync(paths.intent), true, faulted("intent", null)),
    fileState("delta", null, rel(paths.delta), existsSync(paths.delta), false, faulted("delta", null)),
  ];

  for (const svc of services) {
    const p = featureSpecPaths(feature.dir, svc);
    const specFault = faulted("spec", svc);
    out.push(fileState("spec", svc, rel(p.spec), existsSync(p.spec), true, specFault));
    out.push(fileState("arch-spec", svc, rel(p.archSpec), existsSync(p.archSpec), false, specFault));
    out.push(
      fileState(
        "openapi",
        svc,
        rel(p.openapi),
        existsSync(p.openapi),
        owesContract(docsDir, svc, contracted, governs.has(svc)),
        faulted("openapi", svc),
      ),
    );
  }

  // The record is the one artifact with a real prerequisite: its checklist is
  // derived from the delta and the per-service deltas, so with none of them
  // written there is nothing to answer — authoring one is impossible rather
  // than merely premature, which is the whole distinction `blocked` carries.
  const feeders = out.filter((a) => a.id !== "intent" && a.id !== "arch-spec" && a.exists);
  out.push({
    id: "verification",
    service: null,
    path: rel(verificationPath(feature.dir)),
    exists: verification.state !== "absent",
    required: true,
    status: feeders.length === 0 ? "blocked" : verificationStatus(verification),
    blockedBy: feeders.length === 0 ? ["delta", "spec", "openapi"] : [],
  });
  return out;
}

function fileState(
  id: ArtifactId,
  service: string | null,
  path: string,
  exists: boolean,
  required: boolean,
  faulted: boolean,
): ArtifactState {
  const status: ArtifactStatus = !exists
    ? required
      ? "missing"
      : "done"
    : faulted
      ? "draft"
      : "done";
  return { id, service, path, exists, required, status, blockedBy: [] };
}
