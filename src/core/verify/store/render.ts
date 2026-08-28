/**
 * The record as bytes: the header and the YAML that `store/commit.ts` swaps
 * into place. Moved here from `../file.ts` when the contract-report validation
 * pushed that module over the line limit — and the seam is real, not
 * arithmetic: reading was never the inverse of rendering (a record is
 * re-graded on the way in, because anything may have edited it since), so the
 * two were cohabiting rather than forming a codec, while the RENDER and the
 * COMMIT genuinely are one concern — this module produces exactly the bytes
 * whose atomic swap that one performs. `../file.ts` keeps the reading and the
 * grading, and its header says where the render went.
 */
import { stringify } from "yaml";
import { type Verification } from "../record.js";

/**
 * The record as a file. The header explains what the reader is looking at,
 * because the whole point is that this is legible to someone who has never run
 * loam — including the part loam cannot vouch for.
 */
export function renderVerification(v: Verification): string {
  const header = [
    `# Verification record for ${v.feature} — written by \`loam verify ${v.feature}\` (--results / --contract-results / --record).`,
    "#",
    "# Every claim below was derived mechanically from this feature's own artifacts:",
    "# delta.likec4, specs/<svc>/spec.md, specs/<svc>/arch.spec.md and specs/<svc>/",
    "# openapi.yaml. Each verdict names who answered it: `answered_by: runner` means a",
    "# test report's digest-tagged scenarios answered it mechanically — cucumber JSON,",
    "# or loam's own {\"loamScenarioReport\": 1, ...} shape that any runner adapts into;",
    "# `answered_by: external-runner` means a contract-test report's operationId-matched",
    "# entries did, and `contractReport:` records which file a --contract-results run",
    "# read; `answered_by: agent` means somebody's word about the code, which loam did",
    "# not check. Nothing gates on any of them.",
    "#",
    "# A `scenario.tested` claim confirmed by an agent is ATTESTED, not run: loam",
    "# reports it as `verify.scenario-attested` and the feature does not count as",
    "# verified until a report answers it. `report:` records the file a --results run",
    "# read — its sha256 and mtime say WHICH file, not that it came from that commit;",
    "# no digest can say that.",
    "#",
    "# `checklist` is a digest of the claim ids. If `loam verify` stops reporting the same",
    "# one, the feature changed after this was recorded and these answers are stale.",
    ...(v.schema === 2
      ? [
          "#",
          "# Schema 2 is federated: each service entry under `attestations` binds its claim ids",
          "# and file:line evidence to that repository's git commit. Missing claims are honestly",
          "# unanswered; another service run may add them without rewriting existing attestations.",
          "# `evidence_pins` records each cited file's sha256 (CRLF-normalized) and line text at",
          "# the attested commit, so `loam validate` in that repo can convict drift later; a pin",
          "# identifies what was cited — it does not prove the claim true.",
        ]
      : []),
    "",
  ].join("\n");
  // lineWidth 0: never fold a claim onto a second line — these are grepped and diffed.
  return header + stringify(v, { lineWidth: 0 });
}
