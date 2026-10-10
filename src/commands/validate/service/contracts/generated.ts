/**
 * The generated-contract check: the build's own OpenAPI document against the
 * copy the docs repo committed.
 *
 * It sits beside the HTTP axis (`../api.ts`) rather than inside it because it
 * reads a different document for a different question. The axis grades the
 * committed contract against the living spec; this asks whether that committed
 * contract is still the one the service serves, and it runs only in a service
 * repo. They used to share one file, and naming the operationIds that moved
 * pushed it over the line limit.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { parse as parseYaml } from "yaml";
import { resolveInside } from "../../../../core/kernel/path-safety.js";
import { canonicalJson } from "../../../../core/openapi/digest.js";
import { openapiFromText } from "../../../../core/openapi/doc.js";
import { type Finding } from "../../../../core/vocabulary/report.js";

/**
 * The build's own contract document, compared with the copy the docs repo
 * committed — `openapi.generated-stale`, `contracts.source-missing`,
 * `contracts.source-invalid`.
 *
 * WHY THIS IS NOT AN EXTRACTOR. It reads no line of service code and derives no
 * meaning: it parses a standard document the team's own build emitted, at a
 * path a human wrote into `loam.json`, and compares a digest. That is the same
 * category as `verify --results` ingesting a cucumber report, and it is the
 * only thing in the product that can notice the assumption SCHEMA quietly makes
 * — that the committed `services/<id>/openapi.yaml` is the contract the service
 * actually serves. Most fleets generate that document; a fleet that copies it
 * by hand in month one is a fleet whose spine checks grade last quarter's
 * endpoints by month six, and until now nothing could say so.
 *
 * IT NEVER WRITES. The copy stays a human `cp`, reviewed in a pull request,
 * because that is what makes the docs-repo document a contract somebody agreed
 * to rather than a cache of whatever the build last produced. loam reports the
 * divergence and stops.
 *
 * THE DIGEST IS OVER CANONICAL JSON, never raw bytes. Two generator versions
 * that order keys differently, or a YAML dumper that re-wraps a description,
 * produce identical documents and must not produce a permanent warning nobody
 * can clear — the lesson `requirementDigest` (core/document/spec.ts) already records.
 *
 * THE DIGEST DECIDES, THE operationId SETS EXPLAIN. A reworded description and
 * 29 vanished endpoints were one identical warning, each costing a manual diff
 * to tell apart, so a fired warning names the set difference both ways (or says
 * the sets agree). The sets never fire it on their own: the digest still does.
 *
 * Runs only in the SERVICE repo. From the docs repo there is no build output to
 * read and the whole family stays silent, exactly as `sources` provenance does.
 */
export async function generatedContractFindings(
  service: string,
  repoDir: string,
  spelled: string | undefined,
  committedPath: string,
): Promise<Finding[]> {
  if (spelled === undefined) return [];
  let generatedPath: string;
  try {
    // Containment is checked HERE rather than at config load, with the service
    // in hand so the refusal can name it — and a path that escapes the repo is
    // a finding, never a thrown config error that would take down every other
    // command in the repo.
    generatedPath = resolveInside(repoDir, spelled, `"contracts.openapi"`);
  } catch (err) {
    return [{
      severity: "error",
      code: "contracts.source-invalid",
      subject: service,
      message:
        `${service}: loam.json names contracts.openapi '${spelled}', which does not resolve inside this repository — ` +
        `${err instanceof Error ? err.message : String(err)}`,
    }];
  }
  if (!existsSync(generatedPath)) {
    return [{
      severity: "error",
      code: "contracts.source-missing",
      subject: service,
      message:
        `${service}: loam.json names contracts.openapi '${spelled}', and nothing is there. ` +
        "Either the build has not run in this checkout, or the path is wrong — CI that validates before it builds " +
        "sees exactly this. Run the build first, or correct the path",
    }];
  }
  const digests: string[] = [];
  const idSets: Set<string>[] = [];
  for (const [label, path] of [["generated", generatedPath], ["committed", committedPath]] as const) {
    if (label === "committed" && !existsSync(path)) return [];
    let parsed: unknown, text: string;
    try {
      text = await readFile(path, "utf8");
      parsed = parseYaml(text);
    } catch (err) {
      // An unreadable GENERATED document is this check's business; an
      // unreadable committed one is already `openapi.invalid` and must not be
      // reported twice under two codes.
      if (label === "committed") return [];
      return [{
        severity: "error",
        code: "contracts.source-invalid",
        subject: service,
        message:
          `${service}: contracts.openapi '${spelled}' does not parse as YAML or JSON — ` +
          `${err instanceof Error ? err.message : String(err)}`,
      }];
    }
    digests.push(createHash("sha256").update(canonicalJson(parsed), "utf8").digest("hex"));
    // The walk every operation join uses: "served" means what a spine check sees.
    idSets.push(new Set(openapiFromText(text).ops.map((op) => op.id)));
  }
  if (digests[0] === digests[1]) return [];
  const [served, committed] = idSets as [Set<string>, Set<string>];
  const added = [...served].filter((id) => !committed.has(id)).sort();
  const removed = [...committed].filter((id) => !served.has(id)).sort();
  const details = [
    ...added.map((id) => `served, not in the committed copy: ${id}`),
    ...removed.map((id) => `committed, no longer served: ${id}`),
  ];
  const moved = details.length === 0
    ? "Every operationId matches, so what moved is inside an operation or outside `paths`. "
    : `${added.length} operation(s) served but not committed, ${removed.length} committed but no longer served (details). `;
  return [{
    severity: "warn",
    code: "openapi.generated-stale",
    subject: service,
    message:
      `${service}: the committed openapi.yaml differs from what this repository's build produces (${spelled}). ${moved}` +
      "The docs-repo copy is what every operation join is graded against, so the fleet is being checked against a " +
      "contract this service no longer serves. Review the difference and copy the generated document across — " +
      "loam never does that for you, because the committed contract is one somebody agreed to, not a cache of the build",
    ...(details.length === 0 ? {} : { details }),
  }];
}
