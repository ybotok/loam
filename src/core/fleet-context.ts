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
 * `loam archive` rewrites away). One place, so no reader can forget.
 */
import { isUtf8 } from "node:buffer";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadFile, type LoadedDoc } from "./likec4.js";
import type { Finding } from "./report.js";
import {
  readOpenapi,
  type OpenapiDoc,
  type Operation,
} from "./openapi.js";
import {
  featureSpecServices,
  listFeatures,
  listServices,
  type FeatureEntry,
  type ServiceEntry,
} from "./repo.js";
import { featureSpecPaths, servicePaths } from "./repo.js";
import { parseRequirements, type Requirement } from "./spec.js";

export interface FleetContextStats {
  serviceEnumerations: number;
  featureEnumerations: number;
  featureServiceEnumerations: number;
  textReads: number;
  requirementParses: number;
  openapiParses: number;
  likec4Loads: number;
}

function key(path: string): string {
  return resolve(path);
}

/* ------------------------------------------------------------------ */
/* What a read must never swallow                                      */
/* ------------------------------------------------------------------ */

/**
 * A document loam was about to parse that is not UTF-8 text.
 *
 * Thrown rather than returned, and named as the file rather than as an empty
 * document, because every parser in the codebase reads "no requirements, no
 * frontmatter" as a legitimate state — a fresh baseline looks exactly like it.
 * A `spec.md` saved as UTF-16 (PowerShell's `>` writes UTF-16LE by default)
 * therefore validated green, with every requirement in it invisible.
 *
 * `path` is spelled the way Node spells it on an ErrnoException so that
 * validate's per-target guard names the file without knowing this type; the
 * write path refuses the same way for the same reason (staging.ts's
 * NotUtf8Error), and that message is about what a rewrite would destroy, which
 * is not what a reader needs to hear.
 */
export class NotUtf8DocumentError extends Error {
  override readonly name = "NotUtf8DocumentError";

  constructor(
    readonly path: string,
    reason: string,
  ) {
    super(
      `${path} is not a UTF-8 text document — ${reason}. Read as UTF-8 its requirements, frontmatter and headings ` +
        `all come out absent rather than wrong, so the file grades as an empty baseline instead of an unreadable one. ` +
        `Nothing here was checked. Re-save it as UTF-8 (PowerShell's \`>\` and \`Out-File\` write UTF-16 unless told ` +
        `otherwise: use \`Out-File -Encoding utf8\`), then re-run.`,
    );
  }
}

/**
 * Decode a document loam is about to parse, or refuse naming it.
 *
 * Two tests, because one is not enough. `isUtf8` catches the byte sequences
 * that cannot be UTF-8 at all — which is what a byte-order mark makes UTF-16
 * into, and PowerShell writes one. Without a BOM, UTF-16LE of ASCII is a
 * sequence of valid UTF-8 bytes: every other byte is NUL, which decodes to
 * U+0000 and nothing complains. That file parsed as zero requirements and no
 * frontmatter, and validated green. A NUL in a markdown document loam owns has
 * no legitimate spelling, so it is the second test.
 */
export function decodeDocument(bytes: Buffer, path: string): string {
  if (!isUtf8(bytes)) throw new NotUtf8DocumentError(path, "its bytes are not a valid UTF-8 sequence");
  const text = bytes.toString("utf8");
  if (text.includes("\u0000")) {
    throw new NotUtf8DocumentError(
      path,
      "it holds NUL characters, which no markdown document does — almost always UTF-16 saved without a byte-order mark",
    );
  }
  return text;
}

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
  private readonly featureServices = new Map<string, Promise<string[]>>();
  private readonly texts = new Map<string, Promise<string>>();
  private readonly requirements = new Map<string, Promise<Requirement[]>>();
  private readonly openapis = new Map<string, Promise<OpenapiDoc>>();
  private readonly likec4 = new Map<string, Promise<LoadedDoc>>();

  private readonly counts: FleetContextStats = {
    serviceEnumerations: 0,
    featureEnumerations: 0,
    featureServiceEnumerations: 0,
    textReads: 0,
    requirementParses: 0,
    openapiParses: 0,
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

  featureSpecServices(featureDir: string): Promise<string[]> {
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

  async operations(path: string): Promise<Operation[]> {
    return (await this.readOpenapi(path)).ops;
  }

  async operationIds(path: string): Promise<string[]> {
    return (await this.readOpenapi(path)).ops.map((op) => op.id);
  }

  async serviceOperationIds(docsDir: string, service: string, featureDir?: string): Promise<string[]> {
    const ids = new Set(
      (await this.operations(servicePaths(docsDir, service).openapi))
        .filter((op) => !op.remove)
        .map((op) => op.id),
    );
    if (featureDir !== undefined) {
      for (const op of await this.operations(featureSpecPaths(featureDir, service).openapi)) {
        if (op.remove) ids.delete(op.id);
        else ids.add(op.id);
      }
    }
    return [...ids];
  }

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
