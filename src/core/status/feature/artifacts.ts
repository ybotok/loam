/**
 * The artifact table: which files a feature owes, whether each is on disk, and
 * which finding turns a row `draft`. Nothing is graded here — the shared
 * checks already ran, and this module only attributes what they reported to
 * the file a reader should edit.
 */
import { existsSync } from "node:fs";
import { repoPath } from "../../envelope/json.js";
import type { CapabilityDoc } from "../../capabilities/tree.js";
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
 * The `capability.*` codes filed against a capability DOCUMENT rather than
 * against a service requirement's join line. Spelled out rather than matched by
 * prefix because the family straddles both corpora, and the whole point of this
 * table is to name one file.
 */
const CAPABILITY_DOCUMENT_CODES = new Set([
  "capability.requirement-unidentified",
  "capability.requirement-service-scoped",
  "capability.requirement-inert-join",
  "capability.uncovered",
  "capability.remove-requirement-realized",
]);

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
 * THE BUSINESS CORPUS IS THE ONE PLACE THE CODE FAMILY IS NOT ENOUGH. A
 * `delta.*` issue's `subject` is a service id OR a capability id
 * (`core/delta/scope.ts`), and nothing in the code says which — so this
 * function answers `spec` for both and `featureArtifacts` below resolves it by
 * MEMBERSHIP, against the two lists it already holds. Where a name is only a
 * capability the capability row is turned `draft` and no service row is; where
 * a fleet holds a service AND a capability of the same name, BOTH are, which is
 * the pessimistic answer this module is required to give and strictly better
 * than the old one (it named the service's spec delta and was silently wrong).
 * The capability-document codes below need no such resolution: they are only
 * ever filed against a capability.
 */
function faultedArtifact(code: string, subject?: string): ArtifactId | null {
  if (code === "delta.invalid" || code === "delta.nothing-tagged") return "delta";
  if (code.startsWith("c4-api.") || code.startsWith("c4-event.") || code.startsWith("c4.")) return "delta";
  if (code.startsWith("openapi.")) return "openapi";
  if (code.startsWith("asyncapi.")) return "asyncapi";
  // The capability document's own grades, and the two halves of the `Realizes:`
  // join a feature can break — every one of them names a
  // `features/<FEAT>/capabilities/<id>/spec.md`, never a service delta. The two
  // `capability.*` codes deliberately absent are `capability.unknown` and
  // `capability.realizes-unknown`: those grade a SERVICE requirement's join
  // lines and carry a service id, so the prefix alone would send their reader
  // to the wrong file.
  if (CAPABILITY_DOCUMENT_CODES.has(code)) return "capabilities";
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
  /**
   * The capability documents this feature's delta carries. Empty for every
   * feature in a fleet that has not adopted the business axis, which is what
   * keeps the rows out of those payloads entirely.
   */
  capabilities: readonly CapabilityDoc[];
}

export function featureArtifacts(
  docsDir: DocsDir,
  feature: FeatureEntry,
  services: readonly PathableService[],
  grading: Grading,
): ArtifactState[] {
  const { blocking, verification, contracted, governs, living, capabilities } = grading;
  const paths = featurePaths(feature.dir);
  const rel = (abs: string): string => repoPath(docsDir, abs);
  const faults = blocking.map((f) => ({ artifact: faultedArtifact(f.code, f.subject), subject: f.subject }));
  const faulted = (id: ArtifactId, service: string | null): boolean =>
    faults.some((f) => f.artifact === id && (service === null || f.subject === service));

  const out: ArtifactState[] = [
    fileState("intent", { service: null, path: rel(paths.intent), exists: existsSync(paths.intent) }, true, faulted("intent", null)),
    fileState("delta", { service: null, path: rel(paths.delta), exists: existsSync(paths.delta) }, false, faulted("delta", null)),
  ];

  // One row per capability document the feature carries, and none at all when
  // it carries none: the row is the answer to "which file do I edit", and a
  // fleet that has not adopted the axis has no such file to name. Never
  // `required` — no feature owes a business change — so absence never shows up
  // as work owed, and only a fault turns one `draft`. A `delta.*` fault carries
  // the capability id in `subject` with nothing saying it is not a service, so
  // the membership test is the resolution the code family cannot give.
  for (const doc of capabilities) {
    out.push({
      id: "capabilities",
      service: null,
      capability: doc.id,
      path: rel(doc.spec),
      exists: existsSync(doc.spec),
      required: false,
      status: faulted("capabilities", doc.id) || faulted("spec", doc.id) ? "draft" : "done",
      blockedBy: [],
    });
  }

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
  //
  // `capabilities` is excluded for exactly that reason and not by oversight:
  // `featureChecklist` derives no claim from a capability document — a business
  // promise is realized by service requirements, and those are what the record
  // answers — so counting one as a feeder would report a capability-only
  // feature as ready to verify against a checklist with nothing in it.
  const feeders = out.filter(
    (a) => a.id !== "intent" && a.id !== "arch-spec" && a.id !== "capabilities" && a.exists,
  );
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
