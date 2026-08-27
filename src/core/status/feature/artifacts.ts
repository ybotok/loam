/**
 * The artifact table: which files a feature owes, whether each is on disk, and
 * which finding turns a row `draft`. Nothing is graded here — the shared
 * checks already ran, and this module only attributes what they reported to
 * the file a reader should edit.
 */
import { existsSync } from "node:fs";
import { repoPath } from "../../envelope/json.js";
import type { PathableService } from "../../kernel/ids/service.js";
import type { FeatureEntry } from "../../repo/entries.js";
import { featurePaths, featureSpecPaths } from "../../repo/paths.js";
import { verificationPath } from "../../verify/record.js";
import type { Finding } from "../../vocabulary/report.js";
import { owesContract } from "../contracts.js";
import type { ServiceEntry } from "../../repo/entries.js";
import type { ArtifactId, ArtifactState, ArtifactStatus, VerificationState } from "../report.js";
import { verificationStatus } from "../verification.js";
import type { DocsDir } from "../../kernel/ids/dirs.js";

/**
 * Which artifact an error names.
 *
 * Attribution is by code family, because that is the only machine-readable
 * pointer an `Issue` carries: `subject` narrows to a NAME, never to a file.
 * The families are unambiguous — `c4-api.*`/`c4-event.*`/`c4.*` and the two
 * `delta.*` codes about the LikeC4 document itself grade the architecture
 * axis, `openapi.*` grades the API contract, `asyncapi.*` the event contract,
 * and the remaining `delta.*` codes plus `spec-api.*`/`spec-event.*` are the
 * delta-shape checks, every one of which is about a requirement in a spec
 * delta.
 *
 * An error that maps to nothing (or whose subject is unknown) still lands in
 * `checks.issues` and still drives `next.fix-coherence` — it just does not turn
 * any single artifact `draft`, because guessing which file to blame is how a
 * reader gets sent to edit the wrong one.
 *
 * WHICH IS WHERE THE BUSINESS CORPUS SITS TODAY, and the row below is honest
 * about it rather than quietly wrong. A `delta.*` issue's `subject` is now a
 * service id OR a capability id (`core/delta/scope.ts`), the table has no
 * `capabilities` artifact for the second to land on, and a capability delta's
 * fault therefore maps to `spec` and matches no service — so it turns nothing
 * `draft`, exactly like any other unattributable error. The feature is still
 * refused: the issue reaches `checks.gating` and `next.fix-coherence`, which
 * `test/status-agrees-with-gate.test.ts` pins. What it cannot do yet is NAME
 * the file, and in a fleet holding a service and a capability of the SAME name
 * it names the service's spec delta instead. Fixing that means a `capabilities`
 * ArtifactId with a row per delta document — the same change that has to carry
 * `capability.uncovered`, so it lands with it and not before.
 */
function faultedArtifact(code: string, subject?: string): ArtifactId | null {
  if (code === "delta.invalid" || code === "delta.nothing-tagged") return "delta";
  if (code.startsWith("c4-api.") || code.startsWith("c4-event.") || code.startsWith("c4.")) return "delta";
  if (code.startsWith("openapi.")) return "openapi";
  if (code.startsWith("asyncapi.")) return "asyncapi";
  if (code.startsWith("delta.") || code.startsWith("spec-api.") || code.startsWith("spec-event.")) return "spec";
  // The two families validate contributes: the frontmatter checks read only
  // intent.md, and a requirement with no scenario is a requirement in a spec
  // delta. Both name exactly one file, so both may turn a row `draft`.
  if (code.startsWith("frontmatter.")) return "intent";
  if (code === "requirements.missing-scenarios") return "spec";
  // The authoring gate names exactly one file per finding too — leaving these
  // unmapped had the table calling intent.md `done` ("nothing is owed here")
  // while the archive exited 1 because it says nothing. A placeholder finding
  // carries its service when the text sits in a per-service spec delta, and
  // no subject when it is the C4 delta's scaffolded description.
  if (code === "intent.empty") return "intent";
  if (code === "scaffold.placeholder") return subject === undefined ? "delta" : "spec";
  return null;
}

/**
 * The artifact table. Every entry is graded by two questions in order — is it
 * there, and does anything the shared checks reported name it — so a file that
 * exists and is wrong can never be reported the way one that was never written
 * is.
 */
/** What the grading of one feature's files needs beyond the files themselves. */
export interface Grading {
  /** The findings that make an artifact `draft` rather than `done`. */
  blocking: Finding[];
  verification: VerificationState;
  /** Operations some OTHER feature's contract already holds. */
  contracted: ReadonlySet<string>;
  /** Operations this feature's own requirements govern. */
  governs: ReadonlySet<string>;
  /** The enumeration's entries by id — where each living service is and what it has (owesContract reads both). */
  living: ReadonlyMap<string, ServiceEntry>;
}

export function featureArtifacts(
  docsDir: DocsDir,
  feature: FeatureEntry,
  services: readonly PathableService[],
  grading: Grading,
): ArtifactState[] {
  const { blocking, verification, contracted, governs, living } = grading;
  const paths = featurePaths(feature.dir);
  const rel = (abs: string): string => repoPath(docsDir, abs);
  const faults = blocking.map((f) => ({ artifact: faultedArtifact(f.code, f.subject), subject: f.subject }));
  const faulted = (id: ArtifactId, service: string | null): boolean =>
    faults.some((f) => f.artifact === id && (service === null || f.subject === service));

  const out: ArtifactState[] = [
    fileState("intent", { service: null, path: rel(paths.intent), exists: existsSync(paths.intent) }, true, faulted("intent", null)),
    fileState("delta", { service: null, path: rel(paths.delta), exists: existsSync(paths.delta) }, false, faulted("delta", null)),
  ];

  for (const svc of services) {
    const p = featureSpecPaths(feature.dir, svc);
    const specFault = faulted("spec", svc);
    out.push(fileState("spec", { service: svc, path: rel(p.spec), exists: existsSync(p.spec) }, true, specFault));
    out.push(fileState("arch-spec", { service: svc, path: rel(p.archSpec), exists: existsSync(p.archSpec) }, false, specFault));
    out.push(
      fileState(
        "openapi",
        { service: svc, path: rel(p.openapi), exists: existsSync(p.openapi) },
        owesContract(living.get(svc), contracted.has(svc), governs.has(svc)),
        faulted("openapi", svc),
      ),
    );
    // Never required: an event contract is genuinely optional — the axis's own
    // absence-grading rests on that — so absence is `done`, exactly like
    // arch.spec.md. Present and faulted still turns the row `draft`.
    out.push(
      fileState(
        "asyncapi",
        { service: svc, path: rel(p.asyncapi), exists: existsSync(p.asyncapi) },
        false,
        faulted("asyncapi", svc),
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
    blockedBy: feeders.length === 0 ? ["delta", "spec", "openapi", "asyncapi"] : [],
  });
  return out;
}

/** Where an artifact is and whether it is there — the three facts a grade reads. */
interface FileFacts {
  service: string | null;
  path: string;
  exists: boolean;
}

function fileState(id: ArtifactId, file: FileFacts, required: boolean, faulted: boolean): ArtifactState {
  const { service, path, exists } = file;
  const status: ArtifactStatus = !exists
    ? required
      ? "missing"
      : "done"
    : faulted
      ? "draft"
      : "done";
  return { id, service, path, exists, required, status, blockedBy: [] };
}
