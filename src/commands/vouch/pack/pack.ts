/**
 * The re-vouch reading pack: everything `loam vouch --pack` computes and
 * nothing it prints. Three derivations per spec-axis file, all read-only and
 * all from stamps `loam vouch` already writes — (a) the body's diff from the
 * last commit whose version of the file hashes to the stamped
 * `content_digest`, (b) the source files that moved against the stamped
 * per-file index, (c) the sections whose text is identical to the vouched
 * ancestor's, which the person need not re-read. Nothing here writes, locks
 * or stamps; a "pack" in vouch's vocabulary is always the READING pack — the
 * context pack (`core/pack/`) is a different artifact for a different reader.
 *
 * Why this mode may relax vouch's unattended refusal: the vouch gates
 * (identity, TTY, `--yes`, the docs lock) all defend the WRITE — a
 * `status: verified` no person stood behind. The pack writes nothing and can
 * stamp nothing, so refusing it unattended would only stop agents from doing
 * the one thing they are supposed to do here: prepare the exact reading list
 * a HUMAN then works through before running the vouch itself, which keeps
 * every one of its gates. That is also why `--pack --yes` is refused at the
 * flag boundary (vouch.ts): the two flags point at opposite halves of the
 * act, and a pack that stamped would defeat the read it just prescribed.
 * Journal recovery is different in kind: it is not a gate but a read-side
 * NEED (run.ts rolls it forward "before verification reads a byte" precisely
 * because it changes files a reader has already read), and the pack cannot
 * perform it because recovery is itself a write — so `buildPack` detects the
 * pending journal and reports it instead. What survives unchanged is the
 * wrong-repo gate — the source delta resolves `sources` against the
 * service's own repo, so from anywhere else the paths are someone else's.
 *
 * The fail-closed doctrine, stated once for all three parts: when git cannot
 * answer — no repository, no history, the walk's cap passed, a decline
 * mid-walk — the body degrades to "full read", never to a guessed diff; and
 * an unanswerable question never shrinks the list, because "nobody could
 * look" is not "nothing changed". Only the axis's UNCHANGED list may licence
 * skipping a section, and it is only ever computed from a found ancestor or
 * a digest-equal body.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { loadFile } from "../../../core/c4/likec4.js";
import { serviceResolver } from "../../../core/c4/resolve/service.js";
import { repoPath } from "../../../core/envelope/json.js";
import { parseFrontmatter, rawBody, stringField, type Frontmatter } from "../../../core/document/frontmatter.js";
import { sectionHeadings } from "../../../core/document/parse.js";
import type { DocsDir } from "../../../core/kernel/ids/dirs.js";
import { bodyDiffText, findVouchedAncestor } from "../../../core/provenance/gitq/vouched-ancestor.js";
import { contentDigest, decodeSourceIndex, sourceDelta } from "../../../core/provenance/stamp.js";
import { landscapePath, servicePathsAt, SPEC_AXES, unfiledServicePaths } from "../../../core/repo/paths.js";
import { enumeratedServices } from "../../../core/repo/service-target.js";
import { COMMIT_INTENT } from "../../../core/staging/interrupted.js";
import { NotUtf8Error, readUtf8 } from "../../../core/staging/writes.js";
import { landscapeEvidence } from "../../../core/vocabulary/maturity.js";
import { noLivingSpecMessage, verifySpec } from "../vet/verify.js";
import type { PackAxis, PackBody, PackLandscape, PackOutcome, PackRequest, PackSources } from "./contract.js";
import { forwardSample, priorScope, sectionDelta } from "./sections.js";

/** One axis file off disk: its text and header, or the reason nobody could read it. */
type AxisRead =
  | { kind: "read"; raw: string; fm: Frontmatter }
  | { kind: "unreadable"; reason: string };

async function readAxis(path: string): Promise<AxisRead> {
  try {
    const raw = await readUtf8(path);
    return { kind: "read", raw, fm: parseFrontmatter(raw) };
  } catch (err) {
    if (!(err instanceof NotUtf8Error)) throw err;
    return { kind: "unreadable", reason: err.message };
  }
}

export async function buildPack(req: PackRequest): Promise<PackOutcome> {
  // One enumeration answers both questions this function has: where the
  // service's files live (a filed service is not at the root join), and which
  // ids the landscape's resolver may bind to (the same `known` set every
  // other landscape reader passes). The two-line resolution below is
  // `locateServicePaths` (core/repo/service-target.ts) inlined — that helper
  // enumerates internally, and calling it here would walk the tree twice.
  const entries = await enumeratedServices(req.docsDir);
  const entry = entries.find((s) => s.id === req.service);
  const paths = entry === undefined ? unfiledServicePaths(req.docsDir, req.service) : servicePathsAt(entry.dir);
  if (!existsSync(paths.spec)) {
    // One sentence, from `vet/verify.ts`: these commands must not describe the
    // same absence differently, and the fix — adopt first — is the same fix.
    return { ok: false, code: "unknown-target", message: noLivingSpecMessage(paths.spec, req.service) };
  }
  const [specAxis, archAxis] = SPEC_AXES;
  const specRead = await readAxis(paths[specAxis.key]);

  // First vouch is a property of the REQUIRED axis: with neither digest
  // stamped on spec.md there is no prior read to diff against, so the pack is
  // the whole document, landscape claims first. A malformed or unreadable
  // header deliberately does NOT count as first-vouch — it cannot prove the
  // stamps absent, and claiming "first vouch" over a document that may carry
  // one would order the read around a guess.
  const firstVouch =
    specRead.kind === "read" &&
    !specRead.fm.malformed &&
    stringField(specRead.fm, "content_digest") === undefined &&
    stringField(specRead.fm, "sources_digest") === undefined;

  const spec = await packAxis(req, { path: paths[specAxis.key], file: specAxis.file, read: specRead });
  let archSpec: PackAxis | null = null;
  if (existsSync(paths[archAxis.key])) {
    const archRead = await readAxis(paths[archAxis.key]);
    archSpec = await packAxis(req, { path: paths[archAxis.key], file: archAxis.file, read: archRead });
  }
  const knownIds = new Set<string>(entries.map((s) => s.id));
  return {
    ok: true,
    report: {
      service: req.service,
      packMode: firstVouch ? "first-vouch" : "re-vouch",
      // One existsSync, the same one run.ts pays before verification reads a
      // byte: a predecessor's journal means the stamps just read may predate
      // the write it was killed inside. The pack cannot recover (a write) —
      // it warns, and the next journaled writer rolls the journal forward.
      pendingCommit: existsSync(join(req.docsDir, COMMIT_INTENT)),
      spec,
      archSpec,
      landscape: firstVouch ? await landscapeSlice(req.docsDir, req.service, knownIds) : null,
    },
  };
}

/** One spec-axis file's full share of the pack: body verdict, source verdict, stamp fields. */
async function packAxis(
  req: PackRequest,
  axis: { path: string; file: string; read: AxisRead },
): Promise<PackAxis> {
  const rel = repoPath(req.docsDir, axis.path);
  // The source half rides on verifySpec — the vouch's own vetting, message
  // for message. The pack never refuses over sources: "your re-vouch will
  // refuse, fix this first" IS the worklist, so the refusal sentence travels
  // as the `unavailable` reason instead of an exit code.
  const vetted = await verifySpec({ service: req.service, repoDir: req.repoDir }, axis.path, axis.file);
  // What the digest recompute would NOT hash. Empty on a refusal because
  // nobody walked — never because there is nothing to say.
  const skipped = vetted.ok ? vetted.skipped : [];

  if (axis.read.kind === "unreadable") {
    // Per-axis containment: an undecodable file suspends THIS axis with the
    // decode error as both reasons — the sibling axis still gets its pack.
    return {
      path: rel,
      file: axis.file,
      body: { kind: "full-read", reason: axis.read.reason },
      sources: { kind: "unavailable", reason: vetted.ok ? axis.read.reason : vetted.message },
      skipped,
    };
  }
  const { raw, fm } = axis.read;
  const vouchedBy = stringField(fm, "vouched_by");
  const lastVerified = stringField(fm, "last_verified");
  const body = await bodyArm(req, { rel, raw, fm });
  const sources = sourcesArm(vetted, fm);
  const stampedScope = priorScope(fm, body.kind === "unchanged" ? rawBody(raw) : null);
  return {
    path: rel,
    file: axis.file,
    ...(vouchedBy === undefined ? {} : { vouchedBy }),
    ...(lastVerified === undefined ? {} : { lastVerified }),
    body,
    sources,
    skipped,
    // A full read is exactly where the heading listing IS the reading plan —
    // per axis, not per mode, so an arch.spec.md created after the last vouch
    // gets its plan inside a re-vouch pack. `rawBody` first so no frontmatter
    // line can ever masquerade as a section.
    ...(body.kind === "full-read" ? { headings: sectionHeadings(rawBody(raw)).map((h) => h.text) } : {}),
    // Only an UNCHANGED body can license naming what the last sampled vouch
    // read: the recompute needs the bytes that vouch was taken over, and a
    // digest-equal body is exactly those bytes. When the body has moved the
    // scope is still reported — it still means the document was not read in
    // full — with no covered list behind it. Reaching back to the vouched
    // ancestor for the older body would be more information; it would also
    // put a git walk behind a claim about what a person read, and the answer
    // when git cannot speak would have to be this same one.
    ...(stampedScope === null ? {} : { vouchScope: stampedScope }),
    ...(req.sample === undefined || !vetted.ok
      ? {}
      : { sample: forwardSample({ service: req.service, raw, sourcesDigest: vetted.digest, n: req.sample }) }),
  };
}

/** The body verdict: unchanged, a diff from the vouched ancestor, or an honest full read. */
async function bodyArm(
  req: PackRequest,
  doc: { rel: string; raw: string; fm: Frontmatter },
): Promise<PackBody> {
  // Deliberately NOT branched on the report-level first-vouch mode: the mode
  // orders the read (landscape first), but each axis answers from its OWN
  // stamps. In the one corpus where they disagree — spec.md hand-reverted to
  // draft while arch.spec.md still carries a stamp — the stamped axis gets
  // its real diff rather than a false "nobody has read this yet".
  if (doc.fm.malformed) {
    return {
      kind: "full-read",
      reason: "the frontmatter cannot be read as YAML, so whatever content_digest it carries is unreachable — fix the header, then read the whole file",
    };
  }
  const stamped = stringField(doc.fm, "content_digest");
  if (stamped === undefined) {
    return {
      kind: "full-read",
      reason:
        stringField(doc.fm, "sources_digest") === undefined
          ? "this file has never been vouched, so the whole of it is the read"
          : "the last vouch predates content_digest, so no vouched body exists to diff from — read the whole file",
    };
  }
  // The cheap answer first, and without git: the digest recipe is byte-exact
  // over the working-tree file, so equality here IS "no byte of the body
  // moved since the stamp".
  if (contentDigest(doc.raw) === stamped) return { kind: "unchanged" };

  const ancestor = await findVouchedAncestor(req.docsDir, doc.rel, stamped);
  if (ancestor.kind !== "found") {
    return { kind: "full-read", reason: ancestor.kind === "none" ? ancestor.reason : ancestor.detail };
  }
  const diff = await bodyDiffText(req.docsDir, ancestor.commit, doc.rel);
  // An ancestor without a printable diff could still licence a section delta,
  // but a pack that says "these sections changed, no diff shown" invites
  // skipping the rest on this run's partial word — degrade the whole arm to
  // the full read instead; read more, never less.
  if (diff.kind === "failed") return { kind: "full-read", reason: diff.reason };
  return {
    kind: "diff",
    ancestorCommit: ancestor.commit,
    diff: diff.diff,
    sections: sectionDelta(rawBody(ancestor.text), rawBody(doc.raw)),
  };
}

/** The source verdict, from the vouch's own vetting plus the stamped digests. */
function sourcesArm(vetted: Awaited<ReturnType<typeof verifySpec>>, fm: Frontmatter): PackSources {
  if (!vetted.ok) return { kind: "unavailable", reason: vetted.message };
  const stamped = stringField(fm, "sources_digest");
  if (stamped === undefined) return { kind: "unvouched" };
  if (vetted.digest === stamped) return { kind: "unchanged" };
  const index = decodeSourceIndex(stringField(fm, "sources_files"));
  const delta = sourceDelta(index, vetted.index);
  if (delta === null) return { kind: "uncounted", countThen: index.count ?? null, countNow: vetted.index.length };
  return { kind: "delta", ...delta };
}

/**
 * The fleet map's claims about the service — a first vouch reads these before
 * the spec, because the landscape is the one document making claims ABOUT the
 * service that the person is not the author of. Absence and unparseability
 * both come back as `silent`: per landscapeEvidence's own rule they prove
 * nothing about who calls the service, and the pack says so rather than
 * printing an empty edge list that reads as "nobody does".
 */
async function landscapeSlice(docsDir: DocsDir, service: string, known: Set<string>): Promise<PackLandscape> {
  const silent: PackLandscape = {
    kind: "silent",
    reason: `the fleet map says nothing about ${service} (absent or unparseable)`,
  };
  const path = landscapePath(docsDir);
  if (!existsSync(path)) return silent;
  let land: Awaited<ReturnType<typeof loadFile>>;
  try {
    land = await loadFile(path);
  } catch {
    // Unreadable is not "no claims" — but for a reading list both collapse to
    // the same honest sentence: the map cannot brief this read.
    return silent;
  }
  if (land.errors.length > 0) return silent;
  const svcOf = serviceResolver(land.elements, known);
  const evidence = landscapeEvidence({
    id: service,
    parses: true,
    relationships: land.relationships,
    elementIds: land.elements.map((e) => e.id),
    svcOf,
  });
  return { kind: "edges", inbound: evidence.inbound, outbound: evidence.outbound };
}
