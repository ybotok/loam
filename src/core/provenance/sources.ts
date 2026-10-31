/**
 * The `sources` list: vetting the entries an author wrote — patterns, escapes,
 * missing paths, the refusal vocabulary `loam vouch` and `loam validate` share
 * — and grading the vetted list against the service repo: resolved, unvouched,
 * current, stale, and whether the walk reached the whole repository. Vetting
 * and grading are one doctrine about one field, so they live in one file.
 */
import { existsSync } from "node:fs";
import { listField, stringField, type Frontmatter } from "../document/frontmatter.js";
import type { Finding } from "../vocabulary/report.js";
import { resolveInside } from "../kernel/path-safety.js";
import { decodeSourceIndex, holdsSourcesStamp, movedSources, sourcesDigest } from "./stamp.js";
import type { SkippedSource } from "./walk.js";
import { gitTrackedFiles } from "./git.js";

/**
 * The service repository `sources` resolve against, as the walk check needs
 * it: where it is, and which files in it are loam's own.
 */
export interface SourcesRepo {
  dir: string;
  /**
   * Repo-relative paths loam wrote and owns there — its `loam.json` and the
   * agent files `loam init` recorded in it — plus the subtrees it owns
   * outright, each spelled with a trailing `/` (`loamOwnedFiles`). No `sources`
   * list owes a reading of them, so `walkFindings` leaves them out of its
   * denominator.
   */
  loamOwned: readonly string[];
}

/**
 * One document's `sources` graded, plus what its list hands the walk check —
 * which is graded once per SERVICE, over every document's list together (see
 * `walkFindings`): the files the list expanded to; `unresolved` when it names
 * paths nothing here resolves, so a pooled reading would be short by an amount
 * nobody knows; undefined when there is nothing to pool — no list, or not this
 * service's repository.
 */
export interface SourcesGrade {
  findings: Finding[];
  walked?: string[] | "unresolved";
}

export async function sourceFindings(
  fm: Frontmatter,
  service: string,
  label: string,
  repo: SourcesRepo | undefined,
): Promise<SourcesGrade> {
  const sources = listField(fm, "sources");
  if (sources.length === 0) {
    return {
      findings: [
        {
          severity: "warn",
          code: "sources.absent",
          message: `${label} names no sources — nothing ties it to the code, so nothing can tell you when it goes out of date`,
        },
      ],
    };
  }
  // Someone else's repository: the paths describe a tree loam is not standing in.
  if (repo === undefined) return { findings: [] };
  const repoDir = repo.dir;

  // Before existence: a pattern entry would "not exist" as a literal path, and
  // grading it missing would send the author fixing the wrong thing.
  const patterns = patternSources(sources);
  if (patterns.length > 0) {
    return unresolved({
      severity: "error",
      code: "sources.path-missing",
      message: `${label}: ${patterns.length} source(s) are glob patterns — ${patterns.join(", ")}. Patterns are no longer supported: name files or directories (a directory already covers everything beneath it).`,
      details: patterns,
      text: { detailPrefix: "- " },
    });
  }

  const unsafe = unsafeSources(repoDir, sources);
  if (unsafe.length > 0) {
    return unresolved({
      severity: "error",
      code: "sources.path-outside",
      message: `${label}: ${unsafe.length} source(s) escape the service repo — ${unsafe.join(", ")}. Sources must be relative paths contained by this repository, including through symlinks.`,
      details: unsafe,
      text: { detailPrefix: "- " },
    });
  }

  const missing = missingSources(repoDir, sources);
  if (missing.length > 0) {
    return unresolved({
      severity: "error",
      code: "sources.path-missing",
      message: `${label}: ${missing.length} source(s) do not exist — ${missing.join(", ")}`,
      details: missing,
      text: { detailPrefix: "- " },
    });
  }
  const resolved: Finding = {
    severity: "ok",
    code: "sources.resolved",
    message: `${label}: ${sources.length} source(s) resolve`,
  };

  // The walk happens here rather than inside the staleness branch below, even
  // though only staleness needs the hashes: what the walk REFUSED to follow is
  // a hole in the tie to the code whether or not anybody has vouched yet, and
  // an unvouched service is exactly where a reader is about to decide the
  // sources list is honest. The files go back to the caller rather than into a
  // walk finding here: the walk is graded over the whole service.
  const now = await sourcesDigest(repoDir, sources);
  const { files, index, skipped } = now;
  const findings: Finding[] = [resolved, ...skippedFindings(skipped, label)];
  const graded = (last: Finding): SourcesGrade => ({ findings: [...findings, last], walked: files });

  // The paths are there; the question staleness answers is whether what is AT
  // them is still what somebody read.
  const stamped = stringField(fm, "sources_digest");
  if (stamped === undefined) {
    return graded({
      severity: "warn",
      code: "sources.unvouched",
      message: `${label}: no sources_digest — nobody has vouched for this against the code, so nothing can tell you when it goes stale. Run \`loam vouch --service ${service}\`.`,
    });
  }

  const since = stringField(fm, "last_verified") ?? "it was stamped";
  const recorded = decodeSourceIndex(stringField(fm, "sources_files"));
  if (holdsSourcesStamp(now, stamped, recorded)) {
    return graded({
      severity: "ok",
      code: "sources.current",
      message: `${label}: sources unchanged since ${since} (${files.length} file(s), digest ${stamped})`,
    });
  }

  // What MOVED, when the stamp recorded enough to say. Repeating the frontmatter's
  // own `sources` entries back at a reader — which is all this finding could do
  // before `sources_files` existed — answers a question nobody asked: they wrote
  // that list, and "one of these five directories changed somehow" is where the
  // search starts, not where it ends.
  const moved = movedSources(recorded, index);
  return graded({
    // A warning, not an error: the doc may still be right, and only a person
    // can say. What loam knows is that nobody has looked since the code moved.
    severity: "warn",
    code: "sources.stale",
    message: `${label}: sources changed since ${since}${moved.summary} — run \`loam vouch --pack --service ${service}\` for the reading list, then \`loam vouch --service ${service}\``,
    details: moved.paths ?? sources,
    text: { detailPrefix: "- " },
  });
}

/** A list that names paths nothing here resolves: its error, and nothing the walk may pool. */
function unresolved(finding: Finding): SourcesGrade {
  return { findings: [finding], walked: "unresolved" };
}

/** The first path segment — the top-level directory, or a root file's own name. */
function topLevel(path: string): string {
  const cut = path.indexOf("/");
  return cut === -1 ? path : path.slice(0, cut);
}

/**
 * Was the service WALKED, or only the part somebody wrote about?
 *
 * Every other check loam owns is computed from the documents, so a corpus can
 * agree with itself perfectly while describing a third of a service — the
 * failure `UNCHECKED` names as COMPLETENESS and then, correctly, declines to
 * grade. This is the one measurement that escapes that circle, because it
 * compares the document's `sources` against the REPOSITORY: a top-level path
 * git tracks and no source reaches into is a part of the service nobody opened.
 *
 * git is the denominator on purpose. The alternative is walking the tree and
 * excluding what does not look like source, which means a hand-maintained list
 * of build directories that is wrong for the first language nobody thought of —
 * and a check that is wrong for a whole ecosystem is a warning that ecosystem
 * learns to ignore. `git ls-files` already answers "what does this repository
 * consider its own", it is the author's own answer, and `node_modules` and
 * `target/` fall out of it for free. Where git cannot answer — not a
 * repository, not installed, a timeout — there is no denominator and therefore
 * no finding: proving nothing and saying nothing is the same doctrine
 * `sources.unverifiable-from-here` follows.
 *
 * TOP-LEVEL granularity, not a percentage threshold. A ratio needs a line
 * drawn somewhere, and an invented threshold is exactly the number this
 * codebase refuses to write into other people's dashboards; a named directory
 * needs no threshold and is answerable — either it holds nothing this document
 * owes, and the hand-back says so in one sentence, or the walk stopped early.
 * The ratio still rides along in the message as a dial, where it informs
 * without grading.
 *
 * ONE walk per service, over the files every one of its documents' `sources`
 * reach (`covered` is that union; the caller pools it). The walk asks whether
 * the SERVICE was read, and a person reads a repository once, then writes two
 * documents from it: graded per document, arch.spec.md listed `tests/` and the
 * contract it rarely owes while spec.md, beside it, had read both — a warning
 * no honest list could clear short of padding one document with the other's
 * reading, which the hand-back advice forbids.
 *
 * Two kinds of tracked file are NOT the service, and the denominator leaves
 * them out — both by a rule that needs no list of what source looks like:
 *
 *   - loam's OWN files: `loam.json`, the agent files `loam init` recorded in
 *     it, the generated suite under `<gherkinDir>/loam/` and a docs repo that
 *     lives inside this one (`SourcesRepo.loamOwned`; a trailing `/` marks a
 *     whole subtree, anything else is one exact path). loam wrote them and
 *     knows they hold nothing a spec owes; counting them made the warning fire
 *     in every service repo straight after a fresh vouch — and again after the
 *     first `loam gherkin` — with no honest way to clear it: listing loam.json
 *     in `sources` would stale the digest on every `loam init`, and listing the
 *     docs repo on every `loam vouch`.
 *   - `.gitignore`, at any depth: it is the file that DEFINES this check's
 *     denominator — what git considers the repository's own — so it is the
 *     measuring instrument, not a part of the service anybody could owe a
 *     reading of. The line is deliberately that narrow: `package.json`, a
 *     README or `.github/` are the author's call (they can hold what a spec
 *     owes), so they stay in and are answered in the hand-back as before.
 */
export async function walkFindings(repo: SourcesRepo, covered: string[], label: string): Promise<Finding[]> {
  const owned = new Set(repo.loamOwned.filter((p) => !p.endsWith("/")));
  const ownedTrees = repo.loamOwned.filter((p) => p.endsWith("/"));
  const tracked = (await gitTrackedFiles(repo.dir))?.filter(
    (p) =>
      !owned.has(p) &&
      !ownedTrees.some((tree) => p.startsWith(tree)) &&
      p !== ".gitignore" &&
      !p.endsWith("/.gitignore"),
  );
  if (tracked === undefined || tracked.length === 0) return [];

  // The honest intersection, not "every file under a directory somebody
  // touched": reading one file in src/ does not make the other four hundred
  // read, and a coverage number that says it does is worse than none.
  const coveredSet = new Set(covered);
  const hit = tracked.filter((p) => coveredSet.has(p)).length;
  const ratio = `${String(hit)} of ${String(tracked.length)} tracked file(s)`;

  const touched = new Set(covered.map(topLevel));
  const untouched = [...new Set(tracked.map(topLevel))].filter((t) => !touched.has(t)).sort();
  if (untouched.length === 0) {
    return [
      {
        severity: "ok",
        code: "sources.walked",
        message: `${label}: sources reach into every top-level path this repository tracks (${ratio})`,
      },
    ];
  }
  return [
    {
      severity: "warn",
      code: "sources.unwalked",
      message:
        `${label}: sources cover ${ratio}, and ${String(untouched.length)} top-level path(s) were never opened. ` +
        `Either they hold nothing the service's documents owe — say which, and why, in the hand-back — or the walk stopped early ` +
        `and the baseline describes part of a service.`,
      details: untouched,
      text: { detailPrefix: "- " },
    },
  ];
}

/**
 * The paths the digest walk would not follow. Never silent: a symlink dropped
 * on the floor is a file whose content nobody is watching, while the document
 * beside it says `verified` — the digest cannot go stale over bytes it never
 * hashed, so the one thing the stamp promises is quietly untrue for them.
 *
 * A warning, not an error, and for the same reason staleness is: the doc may be
 * perfectly right about the code behind that link. What loam can say is that it
 * is not watching it.
 */
function skippedFindings(skipped: SkippedSource[], label: string): Finding[] {
  if (skipped.length === 0) return [];
  return [
    {
      severity: "warn",
      code: "sources.skipped",
      message: `${label}: ${skipped.length} path(s) under the listed sources were not hashed — the digest says nothing about what is behind them`,
      details: skipped.map((s) => `${s.path} — ${s.reason}`),
      text: { detailPrefix: "- " },
    },
  ];
}

/** The characters that made an entry a pattern under the glob dialect loam no longer ships. */
const PATTERN_CHARS = /[*?[]/;

/**
 * The `sources` entries that look like glob patterns — anything containing
 * `*`, `?` or `[`. Patterns are refused loudly everywhere sources are consumed
 * (`loam vouch` refuses the run, `loam validate` grades an error), never
 * resolved: the glob dialect loam used to ship silently differed from the
 * gitignore/minimatch conventions authors assume — bracket classes literal,
 * its own `**` handling — so a pattern quietly digested a different file set
 * than intended, corrupting the staleness signal in both directions. A
 * directory already means "everything beneath it", so the fix is to name one.
 *
 * The cost accepted with the rule: a real file with `[` in its name (a Next.js
 * route, say) cannot be listed on its own — its parent directory covers it.
 */
export function patternSources(sources: string[]): string[] {
  return sources.filter((s) => PATTERN_CHARS.test(s.trim()));
}

/** The `sources` entries that resolve to nothing in this repo. */
export function missingSources(repoDir: string, sources: string[]): string[] {
  return sources.filter((s) => !sourceExists(repoDir, s));
}

/** Entries that are absolute, traverse upward, or escape through a symlink. */
export function unsafeSources(repoDir: string, sources: string[]): string[] {
  return sources.filter((source) => {
    const cleaned = source.trim();
    if (cleaned.length === 0) return false;
    try {
      resolveInside(repoDir, cleaned, `source '${source}'`);
      return false;
    } catch {
      return true;
    }
  });
}

/** Does a `sources` entry point at something real? Literal paths only, checked exactly. */
function sourceExists(repoDir: string, source: string): boolean {
  const cleaned = source.trim();
  if (cleaned.length === 0) return false;
  try {
    return existsSync(resolveInside(repoDir, cleaned, `source '${source}'`));
  } catch {
    return false;
  }
}
