/**
 * Request-scoped read index for commands that walk a whole loam repository.
 *
 * The filesystem remains the source of truth.  This class deliberately has no
 * singleton/global instance: a command creates one after loading loam.json and
 * drops it when that invocation finishes.  Within that lifetime identical
 * reads share their in-flight Promise, which removes both duplicate I/O and
 * duplicate parsing without making a later CLI invocation observe stale data.
 *
 * Because every markdown artifact is read HERE, this is also where the two
 * failures a read must never swallow are answered: bytes that are not UTF-8
 * (which `readFile(path, "utf8")` silently turns into U+FFFD, so a UTF-16
 * spec.md parses as zero requirements and grades green), and git conflict
 * markers left in a living document (which parse as prose, and which the next
 * `loam archive` rewrites away). One place, so no reader can forget. The
 * decode itself lives in `document-bytes.ts`, a leaf: the parsers that read a
 * single file without an index owe the same rule, and must not have to import
 * this module — and the fleet it pulls in behind it — to obey it.
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { readAsyncapi, type AsyncapiDoc } from "./asyncapi.js";
import { decodeDocument } from "./kernel/document-bytes.js";
import { loadFile, type LoadedDoc } from "./c4/likec4.js";
import type { Finding } from "./vocabulary/report.js";
import { readOpenapi, type OpenapiDoc, type Operation } from "./openapi/doc.js";
import type { RawServiceId } from "./kernel/ids.js";
import { type FeatureEntry, type ServiceEntry } from "./repo/entries.js";
import { featureSpecServices, listFeatures, listServices } from "./repo/repo.js";
import { parseRequirements, type Requirement } from "./document/spec.js";

export interface FleetContextStats {
  serviceEnumerations: number;
  featureEnumerations: number;
  featureServiceEnumerations: number;
  textReads: number;
  requirementParses: number;
  openapiParses: number;
  /**
   * Reads of a service's `asyncapi.yaml`. Counted separately because this axis
   * is the one that makes a per-service run read the whole fleet: "does anybody
   * publish this message" has no local answer, so `spine.message-unproduced`
   * walks every service's contract. The memo is what keeps that one walk per
   * command instead of one per consuming edge.
   */
  asyncapiParses: number;
  likec4Loads: number;
}

function key(path: string): string {
  return resolve(path);
}

/* ------------------------------------------------------------------ */
/* What a read must never swallow                                      */
/* ------------------------------------------------------------------ */

/**
 * The three-way merge left its markers in the file — 1-based line numbers.
 *
 * The rule is `loam doctor`'s, verbatim, and it lives here now because doctor
 * checked exactly one file (`architecture/landscape.likec4`) from a command
 * that gates nothing. The same markers in a living `services/<svc>/spec.md`
 * parse as prose: `loam validate --all` reported `valid: true`, and the next
 * `loam archive` rewrote the requirements section and dropped the `=======`
 * line with it, turning a conflict anyone can see into a document nobody can
 * tell is wrong. For a shared docs repo where a fleet lands through PRs this is
 * the DEFAULT failure, not an edge.
 */
const CONFLICT_MARKERS = ["<<<<<<<", "=======", ">>>>>>>"];

export function conflictMarkerLines(source: string): number[] {
  const out: number[] = [];
  source.split(/\r?\n/).forEach((line, i) => {
    if (CONFLICT_MARKERS.some((m) => line.startsWith(m))) out.push(i + 1);
  });
  return out;
}

/** One sentence for the breach, wherever it is found — doctor, validate, either axis. */
function conflictMessage(label: string, lines: number[]): string {
  return (
    `${label} still contains git conflict markers (line${lines.length === 1 ? "" : "s"} ${lines.join(", ")}) — ` +
    `both sides of somebody's merge are in the file, so nothing it says is anyone's text. ` +
    `Resolve the conflict before anything else: loam rewrites this document on archive, and a rewrite deletes ` +
    `whichever marker lines fall inside the section it owns — a visible conflict becomes a silently malformed file.`
  );
}

/**
 * The conflict-marker finding for a requirement document (living spec.md /
 * arch.spec.md, or a feature's delta of one). Null when the text is clean.
 *
 * An error because the document is not valid — nobody wrote what it now says —
 * and because the merge that would consume it is unsafe. It does not carry
 * `gates`: that field is coherence's (issue.ts), and the archive gate has to
 * ask this question itself.
 */
export function documentConflictFinding(label: string, subject: string, text: string): Finding | null {
  const lines = conflictMarkerLines(text);
  if (lines.length === 0) return null;
  return {
    severity: "error",
    code: "spec.merge-conflict",
    subject,
    message: conflictMessage(label, lines),
  };
}

/** The same breach in the fleet map, where it costs every cross-service check at once. */
export function landscapeConflictFinding(label: string, text: string): Finding | null {
  const lines = conflictMarkerLines(text);
  if (lines.length === 0) return null;
  return {
    severity: "error",
    code: "landscape.merge-conflict",
    message: conflictMessage(label, lines),
  };
}

/** One coherent filesystem snapshot for one command invocation. */
export class FleetContext {
  private readonly services = new Map<string, Promise<ServiceEntry[]>>();
  private readonly features = new Map<string, Promise<FeatureEntry[]>>();
  private readonly featureServices = new Map<string, Promise<RawServiceId[]>>();
  private readonly texts = new Map<string, Promise<string>>();
  private readonly requirements = new Map<string, Promise<Requirement[]>>();
  private readonly openapis = new Map<string, Promise<OpenapiDoc>>();
  private readonly asyncapis = new Map<string, Promise<AsyncapiDoc>>();
  private readonly likec4 = new Map<string, Promise<LoadedDoc>>();

  private readonly counts: FleetContextStats = {
    serviceEnumerations: 0,
    featureEnumerations: 0,
    featureServiceEnumerations: 0,
    textReads: 0,
    requirementParses: 0,
    openapiParses: 0,
    asyncapiParses: 0,
    likec4Loads: 0,
  };

  /** A copy suitable for diagnostics/tests; callers cannot mutate the counters. */
  stats(): Readonly<FleetContextStats> {
    return { ...this.counts };
  }

  listServices(docsDir: string): Promise<ServiceEntry[]> {
    const k = key(docsDir);
    let pending = this.services.get(k);
    if (pending === undefined) {
      this.counts.serviceEnumerations += 1;
      pending = listServices(docsDir);
      this.services.set(k, pending);
    }
    return pending;
  }

  listFeatures(docsDir: string, opts: { includeArchived?: boolean } = {}): Promise<FeatureEntry[]> {
    const k = `${key(docsDir)}\0${opts.includeArchived === true ? "all" : "active"}`;
    let pending = this.features.get(k);
    if (pending === undefined) {
      this.counts.featureEnumerations += 1;
      pending = listFeatures(docsDir, opts).then((entries) => {
        // listFeatures has already enumerated every feature's specs/ directory;
        // seed the narrower lookup so validation/coherence do not read it again.
        for (const entry of entries) {
          const featureKey = key(entry.dir);
          if (!this.featureServices.has(featureKey)) {
            this.featureServices.set(featureKey, Promise.resolve(entry.services));
          }
        }
        return entries;
      });
      this.features.set(k, pending);
    }
    return pending;
  }

  featureSpecServices(featureDir: string): Promise<RawServiceId[]> {
    const k = key(featureDir);
    let pending = this.featureServices.get(k);
    if (pending === undefined) {
      this.counts.featureServiceEnumerations += 1;
      pending = featureSpecServices(featureDir);
      this.featureServices.set(k, pending);
    }
    return pending;
  }

  /**
   * A markdown artifact as text. Bytes in, decoded once, and refused rather
   * than degraded when they are not UTF-8 — see NotUtf8DocumentError.
   */
  readText(path: string): Promise<string> {
    const k = key(path);
    let pending = this.texts.get(k);
    if (pending === undefined) {
      this.counts.textReads += 1;
      pending = readFile(path).then((bytes) => decodeDocument(bytes, path));
      this.texts.set(k, pending);
    }
    return pending;
  }

  /**
   * Git conflict markers in an already-read document, by line. Free for any
   * caller that was going to read the file anyway — which is every caller,
   * which is the point: the marker check used to cost a whole extra read of one
   * hand-picked file, so it was done for one hand-picked file.
   */
  async conflictMarkers(path: string): Promise<number[]> {
    return conflictMarkerLines(await this.readText(path));
  }

  readRequirements(path: string): Promise<Requirement[]> {
    const k = key(path);
    let pending = this.requirements.get(k);
    if (pending === undefined) {
      this.counts.requirementParses += 1;
      pending = this.readText(path).then(parseRequirements);
      this.requirements.set(k, pending);
    }
    return pending;
  }

  readOpenapi(path: string): Promise<OpenapiDoc> {
    const k = key(path);
    let pending = this.openapis.get(k);
    if (pending === undefined) {
      this.counts.openapiParses += 1;
      pending = readOpenapi(path);
      this.openapis.set(k, pending);
    }
    return pending;
  }

  readAsyncapi(path: string): Promise<AsyncapiDoc> {
    const k = key(path);
    let pending = this.asyncapis.get(k);
    if (pending === undefined) {
      this.counts.asyncapiParses += 1;
      pending = readAsyncapi(path);
      this.asyncapis.set(k, pending);
    }
    return pending;
  }

  async operations(path: string): Promise<Operation[]> {
    return (await this.readOpenapi(path)).ops;
  }

  async operationIds(path: string): Promise<string[]> {
    return (await this.readOpenapi(path)).ops.map((op) => op.id);
  }

  /*
   * Deliberately no `serviceOperationIds` here. The living-plus-feature union is
   * a RULE — every removal applied before any upsert — not a read, and a second
   * copy of a rule is a second chance to spell it differently. This one did: it
   * interleaved removals with upserts, so a relocated operation answered
   * "defined" through `archive` (no context) and "gone" through `validate` and
   * `status` (context), or the reverse, depending on the order the feature's
   * YAML happened to spell the two slots in. `core/openapi/doc.ts` owns the rule and
   * threads a context through the reads underneath it, which is the only part
   * this class was ever needed for.
   */

  loadLikeC4(path: string): Promise<LoadedDoc> {
    const k = key(path);
    let pending = this.likec4.get(k);
    if (pending === undefined) {
      this.counts.likec4Loads += 1;
      pending = loadFile(path);
      this.likec4.set(k, pending);
    }
    return pending;
  }
}
