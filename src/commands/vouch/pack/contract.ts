/**
 * What a reading pack IS: the request, the per-axis verdicts, and the one way
 * it can refuse. The same seam as `../contract.ts` one level up — the shapes
 * live apart from the derivation so the printer can name what it renders
 * without importing how it was computed.
 *
 * Every verdict is a discriminated union rather than optional-field soup, and
 * the arms are exactly the honest answers: a body is unchanged, or diffable
 * from a NAMED ancestor, or a full read with the reason — never a guessed
 * diff; sources are unchanged, a named delta, a counted-but-nameless move, a
 * state the re-vouch itself would refuse over, or simply unvouched.
 */
import type { DocsDir } from "../../../core/kernel/ids/dirs.js";
import type { PathableService } from "../../../core/kernel/ids/service.js";
import type { SkippedSource } from "../../../core/provenance/walk.js";
import type { LandscapeEdge } from "../../../core/vocabulary/maturity.js";
import type { PackSample, PackVouchScope, SectionDelta } from "./sections.js";

export interface PackRequest {
  docsDir: DocsDir;
  service: PathableService;
  /** The service's own repo — what the source delta resolves `sources` against. */
  repoDir: string;
  /**
   * `--sample <n>`, when the pack is being read as the reading list for a
   * SAMPLED vouch. The pack then prescribes exactly the sections that
   * `loam vouch --sample <n>` will stamp for, through the same seeded
   * derivation — a pack and a stamp that disagreed about which sections were
   * read would make the record worse than no record.
   */
  sample?: number;
}

/** The body half of one axis's pack: what to read of the document itself. */
export type PackBody =
  | { kind: "unchanged" }
  | { kind: "diff"; ancestorCommit: string; diff: string; sections: SectionDelta }
  | { kind: "full-read"; reason: string };

/** The source half: what moved under the code the document was written from. */
export type PackSources =
  | { kind: "unchanged" }
  | { kind: "delta"; added: string[]; changed: string[]; removed: string[] }
  /**
   * The digest moved but the stamp cannot name the paths — the count-only
   * >100-file fallback (`countThen` known) or an index that contradicts its
   * own digest (`countThen` null when even the count is unreadable).
   */
  | { kind: "uncounted"; countThen: number | null; countNow: number }
  /** The re-vouch itself would refuse over these sources; the reason IS the worklist. */
  | { kind: "unavailable"; reason: string }
  /** Sources resolve but carry no stamp — nothing to diff against yet. */
  | { kind: "unvouched" };

export interface PackAxis {
  /** Docs-relative, `/`-separated — the contract's path spelling. */
  path: string;
  /** The axis's filename — "spec.md" or "arch.spec.md". */
  file: string;
  /** The stamp's own fields, read back for the "already covered" listing. */
  vouchedBy?: string;
  lastVerified?: string;
  body: PackBody;
  sources: PackSources;
  /**
   * Paths under the listed sources the digest recompute would not hash —
   * walk.ts's skip record, carried on the axis because it is orthogonal to
   * the sources verdict (it can accompany unchanged, delta and unvouched
   * alike). Never dropped: these are the parts of the tree the re-vouch's
   * promise will NOT cover, and the pack is now the screen a person reads
   * BEFORE staking that promise. Empty when the vetting itself refused —
   * nobody walked, so nobody can name what a walk would skip.
   */
  skipped: SkippedSource[];
  /**
   * Every H2 heading of the current body — set whenever the whole file is the
   * read (`body.kind === "full-read"`: a first vouch, a never-vouched axis, a
   * body whose vouched ancestor cannot be reached), because a full read is
   * exactly where the listing IS the reading plan. Per axis, not per mode:
   * an arch.spec.md created after the last vouch gets its plan inside a
   * re-vouch pack.
   */
  headings?: string[];
  /**
   * The LAST vouch's scope, when that vouch was sampled — present-but-
   * undecodable included, because an unreadable scope on a verified document
   * must never read as a full vouch. Its presence withdraws the "already
   * covered" licence for this axis: `unchanged` says the text did not move,
   * and after a sampled vouch that is not the same fact as "somebody read it".
   */
  vouchScope?: PackVouchScope;
  /**
   * What a `--sample <n>` vouch would cover, under `--pack --sample <n>`. The
   * forward direction, where `vouchScope` above is the backward one: one says
   * what the next stamp will claim, the other what the last one did.
   */
  sample?: PackSample;
}

/** What the fleet map says about the service — the first read of a first vouch. */
export type PackLandscape =
  | { kind: "edges"; inbound: LandscapeEdge[]; outbound: LandscapeEdge[] }
  | { kind: "silent"; reason: string };

export interface PackReport {
  service: string;
  /** "first-vouch" when spec.md carries neither digest — nothing exists to diff against. */
  packMode: "re-vouch" | "first-vouch";
  /**
   * A predecessor's interrupted docs-repo commit journal exists, so what is
   * on disk may predate the write it was killed inside — including the very
   * stamps this pack read. The pack cannot roll the journal forward (recovery
   * is itself a write, and this command may not write), so it says so instead
   * of silently describing a state the next journaled writer will replace.
   */
  pendingCommit: boolean;
  spec: PackAxis;
  archSpec: PackAxis | null;
  /** First-vouch only (null otherwise): landscape claims come first in the reading order. */
  landscape: PackLandscape | null;
}

export type PackOutcome =
  | { ok: true; report: PackReport }
  | { ok: false; code: "unknown-target"; message: string };
