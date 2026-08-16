/**
 * What a vouch IS: the request, the stamp it writes, and every way it can
 * refuse.
 *
 * The outcome is a union rather than a result plus an error field because the
 * command prints a different shape for each arm, and the stamp only exists on
 * the arm that wrote one. A flat record would have every reader assert what the
 * writer already knew.
 */
import { type ErrorCode } from "../../core/envelope/json.js";
import type { PathableService } from "../../core/kernel/ids.js";
import type { SkippedSource } from "../../core/provenance/walk.js";


export interface VouchRequest {
  docsDir: string;
  service: PathableService;
  /** The service's own repo — what `sources` resolve against. */
  repoDir: string;
  /** The date to stamp. Injected rather than read off the clock, so it can be pinned. */
  today: string;
  /**
   * Who is vouching, as `vouched_by` is stamped — git's identity for `repoDir`.
   * Injected for the same reason `today` is: this function must be reproducible
   * from its arguments, and the resolution (and its refusal) belongs to the
   * command that can talk to a person about it.
   */
  vouchedBy: string;
}

/** One spec-axis file's share of a successful vouch. */
export interface StampedSpec {
  /** Absolute path of the file that was stamped. */
  path: string;
  /** The axis's filename — "spec.md" or "arch.spec.md". */
  file: string;
  /** Digest of the sources, as stamped into `sources_digest`. */
  digest: string;
  /** Digest of the document's own body, as stamped into `content_digest`. */
  contentDigest: string;
  /** The `sources` entries, as written in the frontmatter. */
  sources: string[];
  /** How many files those entries expanded to. */
  files: number;
  /**
   * Paths under those entries the digest would not hash. A vouch over a spec
   * with a skipped path is still a vouch — the person read what they read — but
   * they are told, because the stamp cannot go stale over bytes it never saw.
   */
  skipped: SkippedSource[];
}

export type VouchOutcome =
  | {
      ok: true;
      status: "verified";
      lastVerified: string;
      /** The identity stamped into every file this vouch touched. */
      vouchedBy: string;
      /**
       * Every spec-axis file stamped. Named, not ordered: spec.md is required
       * for a vouch to happen at all, and arch.spec.md is the only other file
       * one can touch, so the type is what says which is which. An array said it
       * in a comment instead, and every reader had to assert non-emptiness to
       * reach the file that comment promised was there.
       */
      stamped: { spec: StampedSpec; archSpec: StampedSpec | null };
    }
  | {
      ok: false;
      // The last three are the commit phase failing: `vouch-raced` says the
      // document moved under the run and nothing was written at all,
      // `merge-failed` says the rollback held (nothing was stamped, re-running
      // can work), `rollback-incomplete` says it did not and the message lists
      // the files.
      code: Extract<
        ErrorCode,
        | "unknown-target"
        | "sources-absent"
        | "sources-path-missing"
        // The spec is there but is not UTF-8 text: a diagnosable state, not the
        // unexpected throw `internal` is for.
        | "repository-unavailable"
        | "vouch-raced"
        | "merge-failed"
        | "rollback-incomplete"
      >;
      message: string;
    };
