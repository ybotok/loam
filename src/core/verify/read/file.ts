/**
 * The verification record read back, and refused when it cannot be trusted.
 *
 * The record is several files now: the one-file `verification.yaml` (the
 * all-at-once form, and every federated record written before the directory
 * existed) and one `verification/<svc>.yaml` per attesting service. Each file
 * is graded on its own here, and `./union.ts` adds the graded files up
 * into the one `Verification` every reader takes — so no reader learns the
 * layout, and a record that is half one form and half the other reads as one
 * record.
 *
 * Reading is deliberately not the inverse of rendering. A file loam wrote is
 * re-graded on the way in — git conflict markers, unreadable YAML, a shape that
 * is not a verification, a `summary` that disagrees with the claims below it —
 * because the record is data meant to survive without loam, and anything may
 * have edited it since. The render lives with the writer it feeds
 * (`../store/render.ts` produces exactly the bytes `../store/commit.ts` swaps into
 * place; races and kills mid-write live there too), and the lock that
 * serialises writers is taken by `commands/verify/verify.ts` before this
 * module's authoritative read. Nothing here touches the filesystem except to
 * read.
 *
 * A package of its own (`core/verify/read/`, moved from `core/verify/file.ts`)
 * because the reader now leans on two modules that lean back on
 * `../record.ts`: kept in `core/verify` beside them it would have been a
 * package cycle that `import/no-cycle` cannot see.
 */
import { lstat, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "yaml";
import { conflictMarkerLines } from "../../conflict-markers.js";
import { verificationDir, verificationPath } from "../location.js";
import { type Verification } from "../record.js";
import { asVerification, summaryDisagreement } from "./shape.js";
import { assembleRecord } from "./union.js";

/**
 * What is on disk beside a feature: nothing, something unreadable, or a record.
 *
 * The three are kept apart because they call for opposite handling. "Absent" is
 * a feature nobody has verified — verify starts a fresh record over it without
 * a second thought. "Unreadable" is a file that IS somebody's record: it parses
 * as garbage, or its shape is not a record's, and every answer and attestation
 * it holds is unaccounted for. Collapsing the two (which this function used to
 * do, returning null for both) meant a hand-edited or half-written
 * verification.yaml read as "not verified" and the next `--record` overwrote a
 * whole fleet's attestations without a word.
 */
export type VerificationRead =
  | { state: "absent" }
  /**
   * `path` is the ONE file that failed — with several files making up the
   * record, "the record is unreadable" names nothing a person can open.
   * `reason` names the YAML line when the parser gave one, or the conflict
   * markers' lines. `advice` is the recipe, and it differs by file on purpose:
   * a `verification/<svc>.yaml` holds one service's word, so deleting it and
   * recording that service again loses nobody else's evidence, while the
   * one-file record may hold a whole fleet's attestations and must never be
   * the file a recipe tells somebody to delete. `code` is set for the one
   * unreadable that parses perfectly: a file whose `summary` contradicts its
   * own `claims[]`. That lives here rather than in a state of its own so every
   * reader which already refuses an unreadable record refuses this one too,
   * without a line of new code.
   */
  | { state: "unreadable"; path: string; reason: string; advice: string; code?: "verify.record-miscounted" }
  /**
   * `verification` is the union the readers use; `files` is what it was added
   * up from, each with the exact bytes it was parsed from. A writer merges over
   * the PARSE, but commits over the BYTES: `commitVerification` compares each
   * file it replaces or deletes against these immediately before its swap, so
   * an edit that landed between this read and that write — an editor, a writer
   * that ignored the docs lock — is refused and preserved instead of silently
   * buried.
   */
  | { state: "ok"; verification: Verification; files: RecordFiles };

/** One graded file of the record, with the bytes it was graded from. */
export interface RecordFile {
  path: string;
  verification: Verification;
  raw: Buffer;
}

/** The files a record was added up from: the one-file form, and the per-service files by service id. */
export interface RecordFiles {
  legacy: RecordFile | null;
  services: ReadonlyMap<string, RecordFile>;
}

type Unreadable = Extract<VerificationRead, { state: "unreadable" }>;
type FileRead = { state: "absent" } | Unreadable | { state: "ok"; file: RecordFile };

export async function readVerificationState(featureDir: string): Promise<VerificationRead> {
  const legacy = await readRecordFile(verificationPath(featureDir), null);
  if (legacy.state === "unreadable") return legacy;
  const listed = await serviceFiles(featureDir);
  if (!Array.isArray(listed)) return listed;
  const services = new Map<string, RecordFile>();
  for (const { service, path } of listed) {
    const read = await readRecordFile(path, service);
    if (read.state === "unreadable") return read;
    // Listed and then gone is a file a concurrent writer removed: absent.
    if (read.state === "ok") services.set(service, read.file);
  }
  const verification = assembleRecord(
    legacy.state === "ok" ? legacy.file.verification : null,
    [...services.values()].map((file) => file.verification),
  );
  if (verification === null) return { state: "absent" };
  return { state: "ok", verification, files: { legacy: legacy.state === "ok" ? legacy.file : null, services } };
}

/**
 * The per-service files, sorted by service id so the union is the same on
 * every machine. Dotfiles are skipped — staging parks its temp files beside
 * the target as `.<name>.loam-….tmp`, and a reader racing a writer must not
 * grade one — and so is anything that is not `*.yaml`: the directory is the
 * list of attestations, and a README beside them is not one.
 */
async function serviceFiles(featureDir: string): Promise<Array<{ service: string; path: string }> | Unreadable> {
  const dir = verificationDir(featureDir);
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    return {
      state: "unreadable",
      path: dir,
      reason: err instanceof Error ? err.message : String(err),
      advice: "It has to be a directory holding one <svc>.yaml per attesting service; move whatever is there aside, then record again.",
    };
  }
  return entries
    .filter((e) => !e.name.startsWith(".") && e.name.endsWith(".yaml") && !e.isDirectory())
    .map((e) => ({ service: e.name.slice(0, -".yaml".length), path: join(dir, e.name) }))
    .sort((a, b) => (a.service < b.service ? -1 : a.service > b.service ? 1 : 0));
}

/**
 * The recipe for a file loam could not use. See {@link VerificationRead} for
 * why the two kinds of file get different ones. Neither tells anybody to edit
 * the counts — a summary made to agree by hand still says nothing about what
 * was checked — and both end in a record that can actually run: the old
 * one-size "record the answers again" sent a miscounted record straight back
 * into this refusal, because `--record` will not write over a file it could
 * not read.
 */
function adviceFor(service: string | null): string {
  if (service !== null) {
    return (
      `It is ${service}'s attestation file and holds no other service's word: repair it by hand, or delete it and ` +
      `record ${service} again from that service's own repository (\`--service ${service} --record\`). ` +
      "After a merge, both sides of a conflict in it are that one service's attestations."
    );
  }
  return (
    "It may hold other services' attestations, so do not delete it: repair it by hand, or restore it from version " +
    "control — after a merge, take the copy on the branch you merged into — and then record again. A `--service` " +
    "record goes to verification/<svc>.yaml beside it and leaves this file as it is."
  );
}

/**
 * One file of the record, graded. `service` is the file's own service for a
 * `verification/<svc>.yaml` — the file NAME is the claim about whose word it
 * holds, so the content has to agree with it — and null for the one-file
 * record.
 */
async function readRecordFile(path: string, service: string | null): Promise<FileRead> {
  // The code rides in an object, as a `code:` property, rather than as a
  // parameter: a parameter named `code` makes this helper an emitter to the
  // stable-code collector, which then cannot read the slot at the call sites
  // that leave it out.
  const unreadable = (reason: string, coded: { code?: "verify.record-miscounted" } = {}): Unreadable => ({
    state: "unreadable",
    path,
    reason,
    advice: adviceFor(service),
    ...coded,
  });
  let raw: Buffer;
  try {
    raw = await readFile(path);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      // ENOENT is "absent" — except from a symlink whose target is gone, which
      // `existsSync` used to fold into the same answer. That mislabel was a
      // trap: the read said "no record" while the commit's exclusive link(2)
      // saw the link itself and refused EEXIST, so every `--record` answered
      // `record-raced` with advice (re-run) that could never work. The lstat
      // must CONFIRM the link before the message asserts one: a real file can
      // also appear between the two calls, and telling its owner to "remove
      // the link" would delete a valid record.
      let entry;
      try {
        entry = await lstat(path);
      } catch {
        return { state: "absent" };
      }
      if (entry.isSymbolicLink()) {
        return unreadable("it is a symlink whose target does not exist — replace the link with a real record, or remove it");
      }
      return unreadable("it appeared while being read — another writer is landing; re-run");
    }
    return unreadable(err instanceof Error ? err.message : String(err));
  }
  const text = raw.toString("utf8");
  // Before the parser, because the parser's answer to a merge is the wrong
  // one: YAML either fails on a line that is not the problem or — where the
  // markers land inside a block scalar — reads both sides as one plausible
  // document. Neither says "a merge left this", which is the one sentence that
  // leads to the right fix.
  const markers = conflictMarkerLines(text);
  if (markers.length > 0) {
    return unreadable(
      `it still contains git conflict markers (line${markers.length === 1 ? "" : "s"} ${markers.join(", ")}) — ` +
        "a merge left both sides in it, so nothing it says is anyone's record",
    );
  }
  let doc: unknown;
  try {
    doc = parse(text);
  } catch (err) {
    return unreadable(yamlReason(err));
  }
  const verification = asVerification(doc);
  if (verification === null) {
    return unreadable(
      "it parses as YAML but does not have a verification record's shape (feature, recorded, checklist, summary and claims)",
    );
  }
  const foreign = service === null ? null : notOnlyFrom(verification, service);
  if (foreign !== null) return unreadable(foreign);
  const miscount = summaryDisagreement(verification);
  // Spelled twice on purpose: the field is what a caller branches on, the
  // prose is what a terminal prints and what somebody greps for.
  if (miscount !== null) return unreadable(`verify.record-miscounted: ${miscount}`, { code: "verify.record-miscounted" });
  return { state: "ok", file: { path, verification, raw } };
}

/**
 * A per-service file must be exactly what its name says: a federated record
 * carrying that one service's attestation and that service's answers. loam
 * never writes anything else there, and the advice for a damaged file — delete
 * it and record that service again — is only safe while it is true.
 */
function notOnlyFrom(v: Verification, service: string): string | null {
  const attested = (v.attestations ?? []).map((a) => a.service);
  if (v.schema !== 2 || attested.length !== 1 || attested[0] !== service) {
    return `it is named for ${service} but does not hold exactly ${service}'s attestation (it holds ${attested.length === 0 ? "none" : attested.join(", ")})`;
  }
  const strays = v.claims.filter((c) => c.subject !== service).map((c) => c.id);
  return strays.length === 0 ? null : `it is named for ${service} but answers claims filed under another service: ${strays.join(", ")}`;
}

/** A YAML failure with its line, when the parser located one: that line is the fix. */
function yamlReason(err: unknown): string {
  const message = err instanceof Error ? err.message.split("\n")[0]!.trim() : String(err);
  const pos = (err as { linePos?: Array<{ line: number; col: number }> } | null)?.linePos;
  const line = Array.isArray(pos) ? pos[0]?.line : undefined;
  return line === undefined ? `YAML error: ${message}` : `YAML error at line ${line}: ${message}`;
}

/**
 * The record beside a feature, or null when there is none loam can use. Kept
 * for readers that have nothing to say about the difference (`loam list`'s
 * verification column shows one glyph either way); anything that WRITES must
 * use {@link readVerificationState} instead, or it overwrites what it could not
 * read.
 *
 * A record whose summary contradicts its own claims is one of the nulls now, so
 * no reader can print its counts as fact. Reading it as ABSENT is the safe half
 * of the truth and not the whole of it: a reader that can say why should take
 * {@link readVerificationState} and its `code`.
 */
export async function readVerification(featureDir: string): Promise<Verification | null> {
  const read = await readVerificationState(featureDir);
  return read.state === "ok" ? read.verification : null;
}
